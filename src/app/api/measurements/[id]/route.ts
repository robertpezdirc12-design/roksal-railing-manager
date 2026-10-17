// /api/measurements/[id] — posamezna meritev
// GET   podrobnost z avtorjem+projektom+nalogom (measurements.read)
// PATCH popravek polj (measurements.write) + revizija MEASUREMENT_UPDATE
//
// R501 (issue #15 faza 2) — PROVENIENCA:
//   • `status`/`statusNote` izračuna STREŽNIK (merilno jedro), odjemalec ga ne
//     more poljubno prepisati. Pisarna (pravica quotes.approve — VODJA/ADMIN)
//     ima samo dva prehoda: CONFIRMED (potrditev odgovornosti) in
//     INVALIDATED (razveljavitev, razlog OBVEZEN). Monter ne more sam potrditi
//     lastne mere — zato monterju manjkajoča pravica pomeni 403.
//   • Sprememba GEOMETRIJE (params: točke/kalibracija) vrne dokazano merilo na
//     strežniško preračunano stanje — potrjena mera se ne more opreti na
//     referenco, ki je bila med tem popravljena.

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { MEASUREMENT_STATUS_LABELS, MEASUREMENT_STATUSES, deriveProvenance, type MeasurementStatus, type MeasureMode } from '@/lib/measure-engine'
import { invalidateQuotesForPackage } from '@/lib/quote-invalidation'
import { retryOnUnique } from '@/lib/versioning'
import { canonicalJson } from '@/lib/json'

type Params = { params: Promise<{ id: string }> }

const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'FOTO', 'OSTANEO']

// R542: params je jsonb OBJEKT (ne niz) — surovi prehod niza zaprt z zod
// (inventura R542-a: drugi od 2 surovih krajev Measurement.params).
const ParamsSchema = z.record(z.string(), z.unknown(), { error: 'params mora biti JSON objekt (ne niz).' }).nullish()

const INCLUDE = {
  author: { select: { name: true } },
  project: { select: { id: true, code: true, title: true } },
  workOrder: { select: { id: true, code: true, title: true } },
}

/** Obseg (issue #1): monter dostopa samo do lastnih meritev in meritev svojih nalogov. */
function scopeDenied (
  user: { id: string; role: string; email?: string; name?: string; perms?: string[] },
  m: { authorId: string | null; workOrder: { assigneeId: string | null } | null }
): boolean {
  return !readsAllData(user) && m.authorId !== user.id && m.workOrder?.assigneeId !== user.id
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scopeRow = await db.measurement.findUnique({
    where: { id },
    select: { authorId: true, workOrder: { select: { assigneeId: true } } },
  })
  if (!scopeRow) return jsonError(404, 'Meritev ne obstaja.')
  if (scopeDenied(user, scopeRow)) {
    return jsonError(403, 'Meritev ni v vašem obsegu.', 'Monter vidi samo svoje meritve in meritve svojih nalogov.')
  }

  const measurement = await db.measurement.findUnique({ where: { id }, include: INCLUDE })
  if (!measurement) return jsonError(404, 'Meritev ne obstaja.')
  return NextResponse.json({ data: measurement })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const existing = await db.measurement.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Meritev ne obstaja.')

  // obseg (issue #1): monter popravlja samo lastne meritve / meritve svojih nalogov
  if (!readsAllData(user)) {
    const wo = existing.workOrderId
      ? await db.workOrder.findUnique({ where: { id: existing.workOrderId }, select: { assigneeId: true } })
      : null
    if (existing.authorId !== user.id && wo?.assigneeId !== user.id) {
      return jsonError(403, 'Meritev ni v vašem obsegu.', 'Monter popravlja samo svoje meritve.')
    }
  }

  const patch: Record<string, unknown> = {}
  if (typeof body.type === 'string') {
    if (!TYPES.includes(body.type)) {
      return jsonError(400, 'Neznan tip meritve.', `Veljavni tipi: ${TYPES.join(', ')}.`)
    }
    patch.type = body.type
  }
  if (typeof body.location === 'string') patch.location = body.location.trim() || null
  if (typeof body.note === 'string') patch.note = body.note.trim() || null
  // R542: params vrata — objekt/null/neodvisno; niz (stara oblika) → 400.
  // Semantika kot prej: podan (tudi izrecno null) → zapiše; izpuščen → nedotaknjeno.
  const paramsParsed = ParamsSchema.safeParse((body as { params?: unknown }).params)
  if (!paramsParsed.success) {
    return jsonError(400, 'Neveljavni parametri meritve.', 'params mora biti JSON objekt (točke, kalibracija …) — ne niz.')
  }
  if (paramsParsed.data !== undefined) patch.params = paramsParsed.data as Prisma.InputJsonValue ?? Prisma.DbNull
  if (typeof body.handrail === 'boolean') patch.handrail = body.handrail

  const numOr = (v: unknown, key: string) => {
    if (v === null) { patch[key] = null; return }
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) patch[key] = v
  }
  numOr(body.lengthCm, 'lengthCm')
  numOr(body.heightCm, 'heightCm')
  numOr(body.slopeDeg, 'slopeDeg')
  if (body.posts === null) patch.posts = null
  else if (typeof body.posts === 'number' && Number.isFinite(body.posts) && body.posts >= 0) patch.posts = Math.round(body.posts)
  if (body.segments === null) patch.segments = null
  else if (typeof body.segments === 'number' && Number.isFinite(body.segments) && body.segments >= 0) patch.segments = Math.round(body.segments)

  // R501: prazni patch se preveri ŠELE po izpeljavi statusnega prehoda —
  // pisarna potrdi ali razveljavi mero SAMO s prehodom stanja (brez polj),
  // sicer bi bil potrditveni klik nedelujoč.

  // ── R501: ročni pregledovalni prehod (samo pisarna) ───────────────────────
  const canApprove = user.perms.includes('quotes.approve')
  const statusWanted = typeof body.status === 'string' && body.status ? body.status : null
  if (statusWanted !== null) {
    if (!(MEASUREMENT_STATUSES as string[]).includes(statusWanted)) {
      return jsonError(400, 'Neznan status meritve.', `Veljavni: ${MEASUREMENT_STATUSES.join(', ')}.`)
    }
    if (statusWanted !== 'CONFIRMED' && statusWanted !== 'INVALIDATED') {
      return jsonError(400, 'Status je izračunan, ne nastavljen.',
        'Ročno je dovoljena samo potrditev (CONFIRMED) ali razveljavitev (INVALIDATED); ostala stanja izračuna strežnik iz geometrije.')
    }
    if (!canApprove) {
      return jsonError(403, 'Dostop zavrnjen — manjka pravica quotes.approve.',
        'Meritev lahko potrdi ali razveljavi samo vodja ali administrator; monter je ne more sam odobriti.')
    }
  }
  const reason = typeof body.statusNote === 'string' ? body.statusNote.trim() : ''
  if (statusWanted === 'INVALIDATED' && reason.length < 3) {
    return jsonError(400, 'Razveljavitev zahteva razlog.', 'Navedite razlog (statusNote, min. 3 znaki) — razveljavitev mora biti sledljiva.')
  }

  // ── R501: sprememba geometrije razveljavi prej dokazano merilo ────────────
  // R542: primerjava po vsebini (canonicalJson — jsonb normalizira vrstni red
  // ključev, zato primerjava surovih nizov ni več poštena).
  const novoParams = paramsParsed.data ?? null
  const paramsChanged = paramsParsed.data !== undefined &&
    canonicalJson(novoParams) !== canonicalJson(existing.params ?? null)
  if (paramsChanged && statusWanted !== null) {
    return jsonError(400, 'Geometrije ni mogoče hkrati spreminjati in potrjevati.',
      'Najprej shranite spremembo točk/kalibracije (strežnik jo ponovno ovrednoti), nato jo posebej potrdite.')
  }
  let revalidated = false
  if (paramsChanged) {
    const novo = novoParams as { points?: unknown; calibration?: unknown; mode?: unknown; multiView?: unknown } | null
    const mv = novo?.multiView as { count?: number; conflict?: boolean } | undefined
    const rec = novo && (novo.points !== undefined || novo.calibration !== undefined)
      ? deriveProvenance({
        points: novo.points,
        calibration: novo.calibration,
        mode: typeof novo.mode === 'string' ? novo.mode as MeasureMode : null,
        legacyType: (patch.type as string | undefined) ?? existing.type,
        viewsAgreeing: !!mv && (mv.count ?? 0) >= 2 && mv.conflict !== true,
      })
      : { status: 'INVALIDATED' as const, reason: 'Geometrijska podlaga (točke/kalibracija) je bila iz zapisa odstranjena — merilo ni več dokazljivo.' }
    patch.status = rec.status
    patch.statusNote = rec.reason
    revalidated = rec.status !== existing.status
  } else if (statusWanted !== null) {
    patch.status = statusWanted
    patch.statusNote = reason || (statusWanted === 'CONFIRMED'
      ? `Potrjeno s strani pisarne (${user.name ?? user.email}) — odgovornost za številko je zdaj na pregledovalcu.`
      : '')
    revalidated = statusWanted !== existing.status
  } else {
    // R501: številke so se spremenile BREZ nove geometrije → ročni popravek.
    // Odgovornost preide na vpis (merilo ne more dokazovati vrednosti, ki je
    // nismo več izračunali iz slike).
    const numbersChanged = ['lengthCm', 'heightCm', 'slopeDeg', 'posts', 'segments'].some((k) => k in patch)
    if (numbersChanged && existing.source === 'KAMERA' && existing.status !== 'MANUAL') {
      patch.status = 'MANUAL'
      patch.statusNote = `Ročni popravek vrednosti (${user.name ?? user.email}) brez ponovnega izračuna geometrije — odgovornost je na vpisu, ne na merilu.`
      revalidated = true
    }
  }

  // R501: šele zdaj vemo, ali je za shraniti kaj početi (polja ALI prehod stanja)
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  // zgodovina verzij: posnetek STANJA PRED spremembo (kdo/kdaj/kaj — issue #1)
  // R536: dirka verzij — branje zadnje verzije in izračun naslednje sta ZNOTRAJ
  // retried fn (versioning.ts): ob sočasnem P2002 na @@unique([measurementId,
  // version]) se številka izračuna znova in poskus ponovi (posnetek `existing`
  // je stabilen znotraj te zahteve, zato je ponovitev varna). Create NI v
  // transakciji — razveljaviti ni treba ničesar.
  await retryOnUnique(async () => {
    const lastVersion = await db.measurementVersion.findFirst({
      where: { measurementId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    return db.measurementVersion.create({
      data: {
        measurementId: id,
        version: (lastVersion?.version ?? 0) + 1,
        userId: auth.user.id,
        // R542: data je jsonb objekt (ne niz) — params je v njem že objekt
        data: {
          type: existing.type, location: existing.location, note: existing.note, handrail: existing.handrail,
          lengthCm: existing.lengthCm, heightCm: existing.heightCm, posts: existing.posts,
          segments: existing.segments, slopeDeg: existing.slopeDeg, params: existing.params,
          status: existing.status, statusNote: existing.statusNote,
        },
        note: `Popravek: ${Object.keys(patch).join(', ')}`,
      },
    })
  })

  const updated = await db.measurement.update({ where: { id }, data: patch, include: INCLUDE })

  // ── R501 (issue #15 faza 2): ponovna validacija ODVISNIH zapisov ──────────
  // Meritev je edini vir količin za povezane pakete. Če se je njeno stanje
  // spremenilo (nova geometrija, ročni popravek, potrditev/razveljavitev),
  // obstoječe ponudbe ne smejo ostati veljavne z zdaj nedokazanimi številkami.
  // Kosovnice NE brišemo (invarianta rezervacij) — generiranje je novo zaprto
  // z vrati v /bom, obstoječe ponudbe pa dobijo zastavico ali prenovitev.
  let invalidiran = { paketi: 0, ponudbe: 0 }
  if (revalidated && updated.status !== existing.status) {
    const paketi = await db.projectPackage.findMany({
      where: { measurementId: id },
      select: { id: true, code: true, projectId: true, bom: { select: { code: true } } },
    })
    const razlog = `Meritev ${updated.type} je zdaj stanja «${MEASUREMENT_STATUS_LABELS[updated.status as MeasurementStatus] ?? updated.status}» (${(updated.statusNote ?? '').slice(0, 160)}) — količine in cene iz nje je treba preveriti.`
    let ponudbe = 0
    for (const p of paketi) {
      const res = await invalidateQuotesForPackage(
        { id: p.id, code: p.code, projectId: p.projectId }, razlog, auth.user.id
      )
      ponudbe += res.reset + res.flagged
    }
    invalidiran = { paketi: paketi.length, ponudbe }
  }

  await writeAudit({
    userId: auth.user.id,
    action: 'MEASUREMENT_UPDATE',
    entity: 'measurement',
    entityId: id,
    projectId: updated.projectId,
    detail: {
      from: {
        type: existing.type, location: existing.location, note: existing.note, handrail: existing.handrail,
        lengthCm: existing.lengthCm, heightCm: existing.heightCm, posts: existing.posts, segments: existing.segments, slopeDeg: existing.slopeDeg,
        status: existing.status,
      },
      to: patch,
      ...(invalidiran.paketi > 0 ? { invalidiranih_paketov: invalidiran.paketi, invalidiranih_ponudb: invalidiran.ponudbe } : {}),
    },
  })
  return NextResponse.json({ data: updated, ...(invalidiran.paketi > 0 ? { meta: { invalidiran } } : {}) })
}

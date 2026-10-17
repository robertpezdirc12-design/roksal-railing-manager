// /api/digital-twin/snapshot — snapshoti digitalnega dvojčka (R461 — issue #16 §9–§12/§22)
// GET  ?projectId[&kind] (projects.read) — seznam verzij s povzetki.
// POST (projects.write ALI measurements.write — montaža potrdi monter) —
//      AS_DESIGNED:  { projectId, kind, packageId, fotoVizId?, reason }
//      AS_PRODUCED:  { projectId, kind, bomId, spremembe?: [{opis, odobril}], reason }
//      AS_INSTALLED: { projectId, kind, finalSegments, notes, workOrderId?, reason }
//      AS_MEASURED se ustvari SAMO prek zaključka zajema (/capture-session/:id/finish).
//      Vsaka nova verzija ima povezavo na prejšnjo + obvezen razlog (§22).
//      R540 (transakcijska celovitost): vsak POST — snapshot (build*Snapshot na
//      tx klientu: VSA branja verige + zapis vrstice) + revizija
//      TWIN_SNAPSHOT_CREATE v ENI $transaction; retryOnUnique ZUNAJ okoli nje
//      (verzija snapshot-a je read-then-create na @@unique([projectId, kind,
//      version]) — P2002 v PG transakciji aborta celo tx, ugotovitev R536).
//      Vrata ok:false ne pišejo nič — prazna tx se potrdi, odgovor napake je
//      identičen prejšnjemu (semantika R539-b finish).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseTwinData, TWIN_KINDS } from '@/lib/capture-qa-engine'
import { projektDostopen } from '@/lib/capture-qa-access'
import { buildDesignedSnapshot, buildInstalledSnapshot, buildProducedSnapshot } from '@/lib/capture-qa-service'
import { retryOnUnique } from '@/lib/versioning'
import type { SessionUser } from '@/lib/auth'

async function requireTwinWrite (req: NextRequest): Promise<{ user: SessionUser } | NextResponse> {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.', 'Zahtevan je veljaven Authorization: Bearer žeton.')
  // pisarna (projects.write) ali teren (measurements.write — npr. montaža)
  if (!user.perms.includes('projects.write') && !user.perms.includes('measurements.write')) {
    return jsonError(403, 'Dostop zavrnjen — manjka projects.write ali measurements.write.')
  }
  return { user }
}

export async function GET (req: NextRequest) {
  const auth = await requireTwaRead(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return jsonError(400, 'Manjka projectId.')
  const kind = url.searchParams.get('kind')
  if (kind && !(kind in TWIN_KINDS)) return jsonError(400, 'Neveljaven kind.', `kind: ${Object.keys(TWIN_KINDS).join(' | ')}`)

  if (!(await projektDostopen(auth.user, projectId))) {
    return jsonError(403, 'Projekt ni na voljo vašim nalogom.')
  }

  const rows = await db.digitalTwinSnapshot.findMany({
    where: { projectId, ...(kind ? { kind } : {}) },
    orderBy: [{ kind: 'asc' }, { version: 'desc' }],
    include: { user: { select: { name: true } } },
  })
  const data = rows.map((s) => {
    // R542: data je jsonb — parseTwinData neposredno (vrne null ob slabi obliki)
    const parsed = parseTwinData(s.data)
    return {
      id: s.id, kind: s.kind, version: s.version, reason: s.reason,
      createdFrom: s.createdFrom, parentSnapshotId: s.parentSnapshotId,
      author: s.user?.name ?? null, createdAt: s.createdAt,
      // R542: sources je jsonb tabela — obramba za ne-tabelo ostaja
      sources: Array.isArray(s.sources) ? s.sources as unknown as { vrsta: string; id: string }[] : [],
      summary: {
        totalLengthCm: parsed?.totalLengthCm ?? null,
        segments: parsed?.segments.length ?? 0,
        produkt: parsed?.produkt?.ime ?? null,
        varianta: parsed?.produkt?.varianta ?? null,
        ral: parsed?.produkt?.ral ?? null,
        bom: parsed?.bom ?? null,
      },
    }
  })
  return NextResponse.json({ data })
}

async function requireTwaRead (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.', 'Zahtevan je veljaven Authorization: Bearer žeton.')
  if (!user.perms.includes('projects.read')) {
    return jsonError(403, 'Dostop zavrnjen — manjka projects.read.')
  }
  return { user }
}

export async function POST (req: NextRequest) {
  const auth = await requireTwinWrite(req)
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
  if (!projectId) return jsonError(400, 'Manjka projectId.')
  const kind = typeof body.kind === 'string' ? body.kind : ''
  if (!(kind in TWIN_KINDS)) return jsonError(400, 'Neveljaven kind.', `kind: ${Object.keys(TWIN_KINDS).join(' | ')}`)
  if (kind === 'AS_MEASURED') {
    return jsonError(400, 'AS-MEASURED se ustvari samo z zaključkom zajema.', 'Uporabite /api/capture-session/:id/finish (§9).')
  }
  const reason = typeof body.reason === 'string' && body.reason.trim().length >= 3 ? body.reason.trim().slice(0, 500) : null
  if (!reason) return jsonError(400, 'Manjka razlog (min. 3 znaki).', '§22: vsaka verzija potrebuje razlog spremembe.')

  if (!(await projektDostopen(user, projectId))) {
    return jsonError(403, 'Projekt ni na voljo vašim nalogom.')
  }

  let result:
    | { ok: true; snapshotId: string; version: number }
    | { ok: false; status: number; error: string; detail?: string }

  // ── R540 (transakcijska celovitost): build + revizija v ENI tx ─────────
  // build*Snapshot prejme tx klienta (VSA branja verige + create vrstice
  // čes njega — padec srednjega koraka ne pusti snapshot-a brez revizije).
  // Verzija snapshot-a je read-then-create na @@unique([projectId, kind,
  // version]): P2002 znotraj PG transakcije aborta celo tx (neobnovljiv,
  // R536), zato retryOnUnique ZUNAJ okoli nje — ponovni poskus verzijo
  // izračuna znova. Vrata ok:false NE pišejo ničesar: prazna tx se potrdi,
  // odgovor napake IZVEN tx je identičen prejšnjemu (semantika R539-b
  // finish). IDOR (projektDostopen) ostaja pred tx.

  if (kind === 'AS_DESIGNED') {
    const packageId = typeof body.packageId === 'string' && body.packageId ? body.packageId : null
    if (!packageId) return jsonError(400, 'Manjka packageId.', 'AS-DESIGNED izhaja iz projektnega paketa (§10).')
    const fotoVizId = typeof body.fotoVizId === 'string' && body.fotoVizId ? body.fotoVizId : null
    // R540: vzorec zgoraj — build + revizija atomarno (retryOnUnique zunaj).
    result = await retryOnUnique(() => db.$transaction(async (tx) => {
      const res = await buildDesignedSnapshot({ projectId, packageId, fotoVizId, reason, userId: user.id }, tx)
      if (res.ok) {
        await writeAudit({
          userId: user.id,
          action: 'TWIN_SNAPSHOT_CREATE',
          entity: 'digitalTwinSnapshot',
          entityId: res.snapshotId,
          projectId,
          detail: { kind, version: res.version, reason },
        }, tx)
      }
      return res
    }))
  } else if (kind === 'AS_PRODUCED') {
    const bomId = typeof body.bomId === 'string' && body.bomId ? body.bomId : null
    if (!bomId) return jsonError(400, 'Manjka bomId.', 'AS-PRODUCED izhaja iz kosovnice (§11).')
    const spremembeRaw = body.spremembe
    const spremembe = Array.isArray(spremembeRaw)
      ? spremembeRaw.filter((c): c is { opis: string; odobril: string } =>
          typeof c === 'object' && c !== null && typeof (c as { opis?: unknown }).opis === 'string' && typeof (c as { odobril?: unknown }).odobril === 'string')
      : []
    // §11: eksplicitni overridi mer (ključi seg-N iz AS-DESIGNED)
    const ovRaw = body.segmentOverrides
    const segmentOverrides = Array.isArray(ovRaw)
      ? ovRaw.filter((o): o is { key: string; lengthCm?: number | null; heightCm?: number | null } =>
          typeof o === 'object' && o !== null && typeof (o as { key?: unknown }).key === 'string')
          .map((o) => ({
            key: o.key,
            lengthCm: typeof o.lengthCm === 'number' ? o.lengthCm : null,
            heightCm: typeof o.heightCm === 'number' ? o.heightCm : null,
          }))
      : null
    // R540: vzorec zgoraj — build + revizija atomarno (retryOnUnique zunaj).
    result = await retryOnUnique(() => db.$transaction(async (tx) => {
      const res = await buildProducedSnapshot({ projectId, bomId, spremembe, reason, userId: user.id, segmentOverrides }, tx)
      if (res.ok) {
        await writeAudit({
          userId: user.id,
          action: 'TWIN_SNAPSHOT_CREATE',
          entity: 'digitalTwinSnapshot',
          entityId: res.snapshotId,
          projectId,
          detail: { kind, version: res.version, reason },
        }, tx)
      }
      return res
    }))
  } else {
    // AS_INSTALLED
    const finalRaw = body.finalSegments
    if (!Array.isArray(finalRaw) || finalRaw.length === 0) {
      return jsonError(400, 'Manjkajo končni segmenti.', 'finalSegments: [{ key, lengthCm?, heightCm? }] — ključi iz AS-DESIGNED (§12).')
    }
    const finalSegments: { key: string; label?: string; lengthCm?: number | null; heightCm?: number | null }[] = []
    for (const f of finalRaw) {
      if (typeof f !== 'object' || f === null || typeof (f as { key?: unknown }).key !== 'string') {
        return jsonError(400, 'Neveljaven finalSegments vnos.', '{ key, label?, lengthCm?, heightCm? }')
      }
      finalSegments.push({
        key: (f as { key: string }).key,
        ...(typeof (f as { label?: unknown }).label === 'string' ? { label: (f as { label: string }).label } : {}),
        lengthCm: typeof (f as { lengthCm?: unknown }).lengthCm === 'number' ? (f as { lengthCm: number }).lengthCm : null,
        heightCm: typeof (f as { heightCm?: unknown }).heightCm === 'number' ? (f as { heightCm: number }).heightCm : null,
      })
    }
    const notes = Array.isArray(body.notes)
      ? body.notes.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n) => n.slice(0, 300))
      : []
    const workOrderId = typeof body.workOrderId === 'string' && body.workOrderId ? body.workOrderId : null
    const photoCount = typeof body.photoCount === 'number' && Number.isFinite(body.photoCount) ? Math.max(0, Math.round(body.photoCount)) : undefined
    // R540: vzorec zgoraj — build + revizija atomarno (retryOnUnique zunaj).
    result = await retryOnUnique(() => db.$transaction(async (tx) => {
      const res = await buildInstalledSnapshot({ projectId, finalSegments, notes, workOrderId, photoCount, reason, userId: user.id }, tx)
      if (res.ok) {
        await writeAudit({
          userId: user.id,
          action: 'TWIN_SNAPSHOT_CREATE',
          entity: 'digitalTwinSnapshot',
          entityId: res.snapshotId,
          projectId,
          detail: { kind, version: res.version, reason },
        }, tx)
      }
      return res
    }))
  }

  if (!result.ok) {
    return jsonError(result.status, result.error, result.detail)
  }

  // R540: revizija je zapisana v isti transakciji kot snapshot (zgoraj).
  return NextResponse.json({ data: { id: result.snapshotId, kind, version: result.version } }, { status: 201 })
}

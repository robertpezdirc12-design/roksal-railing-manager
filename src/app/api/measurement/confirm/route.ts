// /api/measurement/confirm — potrditev izmerjene vrednosti s fotografije (issue #1)
// POST { photoId, type, location?, lengthCm, heightCm?, slopeDeg?, posts?, segments?,
//        handrail?, note?, projectId?, workOrderId?, points?, calibration? } (measurements.write)
// Shrani REZULTAT meritve v projekt/nalog: source=KAMERA, params nosijo photoId,
// točke in kalibracijo (ponovna izdelava/revizija). Ustvari tudi verzijo v1.
// Več klicev na isti photoId = več meritev na isti fotografiji.
//
// R455 (issue #10 — PROFESIONALNE KAMERNE MERITVE) — razširitve (vse opcijske,
// povratno združljive):
//   • views[] — dodatni pogledi (več fotografij istega objekta): vsak { photoId?,
//     points?, calibration? } — shranjeno v params.views za revizijo;
//   • quality — ocena kakovosti zajema { brightness?, blurScore?, dark?, bright?,
//     blurry? } (odjemalčeva analiza kadra — svetlost/ostrost);
//   • confidence — stopnja zaupanja 0..100 (izračun v UI iz kakovosti + kalibracije
//     + strinjanja pogledov; strežnik validira in zapiše);
//   • manualOverride — ročni popravek dolžine: { computedLengthCm, reason } —
//     razlog je OBVEZEN (sledljivost ročnih sprememb, §1 issue #10).
// Samodejni (VLM) predlogi NIKOLI niso potrjeni brez izrecnega dejanja uporabnika —
// točke s src=PREDLOG odjemalec sprejme pred potrditvijo (tu prispejo kot navadne).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'

const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'OSTANEO']

const MAX_VIEWS = 4

/** R455: normalizira en pogled (točke + kalibracija) — enaka pravila kot glavni. */
function parseView (v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { photoId?: unknown; points?: unknown; calibration?: unknown }
  const out: Record<string, unknown> = {}
  if (typeof o.photoId === 'string' && o.photoId) out.photoId = o.photoId
  if (Array.isArray(o.points)) {
    const pts = o.points.slice(0, 64).filter((p) => {
      if (!p || typeof p !== 'object') return false
      const q = p as { x?: unknown; y?: unknown }
      return Number.isFinite(Number(q.x)) && Number.isFinite(Number(q.y))
    })
    if (pts.length > 0) out.points = pts
  }
  if (o.calibration && typeof o.calibration === 'object') {
    const c = o.calibration as { px?: unknown; cm?: unknown; imgW?: unknown; imgH?: unknown }
    const cal: Record<string, number> = {}
    if (Number.isFinite(Number(c.px)) && Number(c.px) > 0) cal.px = Number(c.px)
    if (Number.isFinite(Number(c.cm)) && Number(c.cm) > 0) cal.cm = Number(c.cm)
    if (Number.isFinite(Number(c.imgW)) && Number(c.imgW) > 0) cal.imgW = Math.round(Number(c.imgW))
    if (Number.isFinite(Number(c.imgH)) && Number(c.imgH) > 0) cal.imgH = Math.round(Number(c.imgH))
    if (Object.keys(cal).length > 0) out.calibration = cal
  }
  return Object.keys(out).length > 0 ? out : null
}

function num (v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function int (v: unknown): number | null {
  const n = num(v)
  return n === null ? null : Math.round(n)
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const photoId = typeof body.photoId === 'string' && body.photoId ? body.photoId : null
  if (!photoId) return jsonError(400, 'Manjka photoId.', 'Podajte id fotografije, na kateri je bilo merjeno.')

  const photo = await db.measurement.findUnique({ where: { id: photoId }, select: { id: true, type: true, projectId: true, workOrderId: true, location: true } })
  if (!photo) return jsonError(404, 'Fotografija (meritev) ne obstaja.')

  const type = typeof body.type === 'string' && body.type ? body.type : 'OGRAJA'
  if (!TYPES.includes(type)) {
    return jsonError(400, 'Neznan tip meritve.', `Veljavni tipi: ${TYPES.join(', ')}.`)
  }

  const lengthCm = num(body.lengthCm)
  const heightCm = num(body.heightCm)
  const slopeDeg = num(body.slopeDeg)
  const posts = int(body.posts)
  const segments = int(body.segments)
  const handrail = typeof body.handrail === 'boolean' ? body.handrail : true
  if (lengthCm === null || lengthCm <= 0) {
    return jsonError(400, 'Potrditev zahteva dolžino.', 'lengthCm (cm) je obvezen in > 0.')
  }
  if ([lengthCm, heightCm, slopeDeg, posts, segments].some((n) => n !== null && n < 0)) {
    return jsonError(400, 'Številske vrednosti ne morejo biti negativne.')
  }
  if (lengthCm > 10000) return jsonError(400, 'Dolžina je nerealna (max 100 m).')

  const workOrderId = typeof body.workOrderId === 'string' && body.workOrderId ? body.workOrderId : photo.workOrderId
  let projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : photo.projectId

  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return jsonError(400, 'Projekt ne obstaja.', 'Podan projectId ni veljaven.')
  }

  // ── R455: ročni popravek dolžine — razlog je obvezen (sledljivost §1) ──
  let manualOverride: { computedLengthCm: number; reason: string } | null = null
  if (body.manualOverride && typeof body.manualOverride === 'object') {
    const mo = body.manualOverride as { computedLengthCm?: unknown; reason?: unknown }
    const computed = Number(mo.computedLengthCm)
    const reason = typeof mo.reason === 'string' ? mo.reason.trim() : ''
    if (!Number.isFinite(computed) || computed <= 0 || computed > 10000) {
      return jsonError(400, 'Ročni popravek: computedLengthCm je neveljaven.', 'Podajte izračunano dolžino (cm, > 0).')
    }
    if (reason.length < 3) {
      return jsonError(400, 'Ročni popravek zahteva razlog.', 'Obvezno navedite razlog ročne spremembe dolžine (sledljivost).')
    }
    manualOverride = { computedLengthCm: Math.round(computed * 10) / 10, reason: reason.slice(0, 200) }
  }

  // ── R455: stopnja zaupanja 0..100 ──
  let confidence: number | null = null
  if (body.confidence !== undefined && body.confidence !== null) {
    const c = Number(body.confidence)
    if (!Number.isFinite(c) || c < 0 || c > 100) {
      return jsonError(400, 'Neveljavna stopnja zaupanja.', 'confidence mora biti število 0..100.')
    }
    confidence = Math.round(c)
  }

  // ── R455: dodatni pogledi (max 4) ──
  let views: Record<string, unknown>[] | null = null
  if (body.views !== undefined && body.views !== null) {
    if (!Array.isArray(body.views)) {
      return jsonError(400, 'views mora biti seznam.', 'Podajte največ 4 dodatne poglede istega objekta.')
    }
    if (body.views.length > MAX_VIEWS) {
      return jsonError(400, `Preveč pogledov (max ${MAX_VIEWS}).`)
    }
    const parsed = body.views.map(parseView).filter((v): v is Record<string, unknown> => v !== null)
    if (parsed.length > 0) views = parsed
  }

  // ── R455: ocena kakovosti zajema (odjemalčeva analiza kadra) ──
  let quality: Record<string, unknown> | null = null
  if (body.quality && typeof body.quality === 'object') {
    const q = body.quality as { brightness?: unknown; blurScore?: unknown; dark?: unknown; bright?: unknown; blurry?: unknown }
    const out: Record<string, unknown> = {}
    const b = Number(q.brightness); const bl = Number(q.blurScore)
    if (Number.isFinite(b) && b >= 0 && b <= 255) out.brightness = Math.round(b)
    if (Number.isFinite(bl) && bl >= 0 && bl <= 10000) out.blurScore = Math.round(bl)
    if (typeof q.dark === 'boolean') out.dark = q.dark
    if (typeof q.bright === 'boolean') out.bright = q.bright
    if (typeof q.blurry === 'boolean') out.blurry = q.blurry
    if (Object.keys(out).length > 0) quality = out
  }
  if (workOrderId) {
    const workOrder = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, projectId: true } })
    if (!workOrder) return jsonError(400, 'Nalog ne obstaja.', 'Podan workOrderId ni veljaven.')
    projectId = workOrder.projectId ?? projectId // samodejna povezava vsega s projektom
  }

  // points + calibration shranimo v params (zapis postopka za revizijo/ponovno izdelavo)
  // points: normalizirane koordinate 0..1; calibration dodatno nosi imgW/imgH za
  // pretvorbo v piksle pri ponovnem izračunu (GET /api/railing-layout?measurementId)
  let params: string | null = null
  try {
    const extra: Record<string, unknown> = { photoId, source: 'KAMERA' }
    if (Array.isArray(body.points)) extra.points = body.points.slice(0, 64)
    if (body.calibration && typeof body.calibration === 'object') {
      const c = body.calibration as { px?: unknown; cm?: unknown; imgW?: unknown; imgH?: unknown }
      const cal: Record<string, unknown> = {}
      if (Number.isFinite(Number(c.px)) && Number(c.px) > 0) cal.px = Number(c.px)
      if (Number.isFinite(Number(c.cm)) && Number(c.cm) > 0) cal.cm = Number(c.cm)
      if (Number.isFinite(Number(c.imgW)) && Number(c.imgW) > 0) cal.imgW = Math.round(Number(c.imgW))
      if (Number.isFinite(Number(c.imgH)) && Number(c.imgH) > 0) cal.imgH = Math.round(Number(c.imgH))
      if (Object.keys(cal).length > 0) extra.calibration = cal
    }
    // R455: več pogledov, kakovost, zaupanje, ročni popravek — vse v params (revizija)
    if (views) extra.views = views
    if (quality) extra.quality = quality
    if (confidence !== null) extra.confidence = confidence
    if (manualOverride) extra.manualOverride = manualOverride
    params = JSON.stringify(extra)
  } catch { params = JSON.stringify({ photoId, source: 'KAMERA' }) }

  const measurement = await db.measurement.create({
    data: {
      type,
      source: 'KAMERA',
      projectId,
      workOrderId,
      authorId: user.id,
      location: typeof body.location === 'string' && body.location.trim() ? body.location.trim() : photo.location,
      lengthCm,
      heightCm,
      posts,
      segments,
      handrail,
      slopeDeg,
      params,
      note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    },
    include: {
      author: { select: { name: true } },
      project: { select: { id: true, code: true, title: true } },
      workOrder: { select: { id: true, code: true, title: true } },
    },
  })

  // verzija v1 — začetni posnetek (zgodovina verzij)
  const versionBits: string[] = []
  if (views) versionBits.push(`${views.length + 1} pogledov`)
  if (confidence !== null) versionBits.push(`zaupanje ${confidence} %`)
  if (manualOverride) versionBits.push('ročni popravek dolžine')
  await db.measurementVersion.create({
    data: {
      measurementId: measurement.id,
      version: 1,
      userId: user.id,
      data: JSON.stringify({
        type, lengthCm, heightCm, posts, segments, handrail, slopeDeg,
        location: measurement.location, note: measurement.note, params,
      }),
      note: versionBits.length > 0 ? `${versionBits.join(' · ')} — potrjeno s kamero` : 'Potrjeno s kamero (iz fotografije)',
    },
  })

  await writeAudit({
    userId: user.id,
    action: 'MEASUREMENT_CONFIRM',
    entity: 'measurement',
    entityId: measurement.id,
    projectId,
    detail: {
      photoId, type, lengthCm, heightCm, slopeDeg, workOrderId: workOrderId ?? null, location: measurement.location,
      // R455: razširjeni podatki o potrditvi (issue #10)
      ...(confidence !== null ? { confidence } : {}),
      ...(views ? { views: views.length } : {}),
      ...(quality ? { qualityFlags: Object.keys(quality) } : {}),
      ...(manualOverride ? { manualOverride } : {}),
    },
  })

  // R438 (issue #5): potrjena meritev → statusno obvestilo stranki (EMAIL, maskiran naslov)
  if (projectId) {
    const customer = await db.project.findUnique({
      where: { id: projectId },
      select: { customer: { select: { name: true, email: true } } },
    }).then((p) => p?.customer ?? null)
    if (customer?.email) {
      await emitEvent({
        type: 'MEASUREMENT_CONFIRMED',
        key: `measurement-confirmed:${measurement.id}`,
        title: 'Meritev potrjena',
        body: `Meritev potrjena — ${measurement.location ?? customer.name ?? 'teren'} (${type.toLowerCase()}, ${Math.round(lengthCm)} cm)`,
        projectId,
        customerEmail: customer.email,
        customerName: customer.name,
      })
    }
  }
  return NextResponse.json({ data: measurement }, { status: 201 })
}

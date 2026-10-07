// /api/railing-layout — izračun postavitve ograje iz točk (issue #1)
// POST { points: [{x,y}], calibration: { px, cm }, maxSpanCm?, workOrderId?, projectId? }
//      (measurements.write) → geometrija: dolžine segmentov med sosednjimi točkami,
//      koti v vogalih, višinske razlike, št. stebrov (razpon ≤ maxSpanCm, privzeto 120),
//      skupna dolžina, metri ročnika. Opcijsko shrani kot meritev (source=KAMERA).
// GET ?measurementId= (measurements.read) → izračun postavitve iz shranjene meritve
//      (params.points + params.calibration) brez shranjevanja.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

interface Pt { x: number; y: number }

const DEFAULT_MAX_SPAN_CM = 120

function parsePt (v: unknown): Pt | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { x?: unknown; y?: unknown }
  const x = Number(o.x); const y = Number(o.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/** Geometrija polilinije v slikovnih pikslih → cm prek kalibracije (cm na px). */
function computeLayout (pts: Pt[], cmPerPx: number, maxSpanCm: number) {
  const segments: { from: number; to: number; lengthCm: number; angleDeg: number; heightDiffCm: number }[] = []
  let totalLengthCm = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const dxPx = pts[i + 1].x - pts[i].x
    const dyPx = pts[i + 1].y - pts[i].y
    const lengthCm = Math.hypot(dxPx, dyPx) * cmPerPx
    // kot segmenta glede na horizontalo (deg, -90..90); višinska razlika iz dy
    const angleRad = Math.atan2(dyPx, dxPx)
    const angleDeg = Math.round((angleRad * 180) / Math.PI * 10) / 10
    const heightDiffCm = Math.round(dyPx * cmPerPx * 10) / 10
    segments.push({ from: i, to: i + 1, lengthCm: Math.round(lengthCm * 10) / 10, angleDeg, heightDiffCm })
    totalLengthCm += lengthCm
  }
  // vogali: notranji kot med zaporednimi segmenti (stopnišče/nagib)
  const corners: { at: number; interiorDeg: number }[] = []
  for (let i = 1; i + 1 < pts.length; i++) {
    const a1 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x)
    const a2 = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x)
    let d = ((a2 - a1) * 180) / Math.PI
    d = ((d % 360) + 360) % 360
    if (d > 180) d = 360 - d
    corners.push({ at: i, interiorDeg: Math.round(d * 10) / 10 })
  }
  // stebri: na obeh koncih vsakega segmenta + vmesni do maxSpanCm
  const postCount = segments.reduce((acc, s) => {
    const spans = Math.max(1, Math.ceil(s.lengthCm / maxSpanCm))
    return acc + spans + 1
  }, 0)
  const uniquePosts = segments.length === 0 ? 0 : postCount - (segments.length - 1) // skupni vogalni stebri
  return {
    segments,
    corners,
    totalLengthCm: Math.round(totalLengthCm * 10) / 10,
    posts: Math.max(segments.length > 0 ? 2 : 0, uniquePosts),
    handrailM: Math.round((totalLengthCm / 100) * 100) / 100,
    maxSpanCm,
    slopeDeg: segments.length === 1 ? Math.abs(segments[0].angleDeg) : null,
  }
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const measurementId = url.searchParams.get('measurementId')
  if (!measurementId) return jsonError(400, 'Manjka measurementId.')

  const m = await db.measurement.findUnique({ where: { id: measurementId } })
  if (!m) return jsonError(404, 'Meritev ne obstaja.')

  let layout: ReturnType<typeof computeLayout> | null = null
  if (m.params) {
    try {
      const p = JSON.parse(m.params) as {
        points?: unknown
        calibration?: { px?: unknown; cm?: unknown; imgW?: unknown; imgH?: unknown }
      }
      let pts = Array.isArray(p.points) ? p.points.map(parsePt).filter((q): q is Pt => q !== null) : []
      const px = Number(p.calibration?.px); const cm = Number(p.calibration?.cm)
      const imgW = Number(p.calibration?.imgW); const imgH = Number(p.calibration?.imgH)
      // točke so shranjene normalizirano (0..1) — pretvorba v piksle, če so dimenzije znane
      if (pts.length > 0 && Number.isFinite(imgW) && imgW > 0 && Number.isFinite(imgH) && imgH > 0) {
        const allNorm = pts.every((q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1)
        if (allNorm) pts = pts.map((q) => ({ x: q.x * imgW, y: q.y * imgH }))
      }
      if (pts.length >= 2 && Number.isFinite(px) && px > 0 && Number.isFinite(cm) && cm > 0) {
        layout = computeLayout(pts, cm / px, DEFAULT_MAX_SPAN_CM)
      }
    } catch { /* ni geometrije */ }
  }
  if (!layout) {
    return jsonError(422, 'Meritev nima shranjene geometrije točk.', 'Tocke so shranjene samo pri meritvah s kamero.')
  }
  return NextResponse.json({ data: { measurementId, ...layout } })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const rawPts: unknown[] = Array.isArray(body.points) ? body.points : []
  const pts = rawPts.map(parsePt).filter((p): p is Pt => p !== null)
  if (pts.length < 2) return jsonError(400, 'Za izračun so potrebne vsaj 2 točki.')

  const px = Number(body.calibration?.px)
  const cm = Number(body.calibration?.cm)
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(cm) || cm <= 0) {
    return jsonError(400, 'Manjka kalibracija.', 'calibration: { px, cm } — dolžina referenčnega objekta v px in cm.')
  }
  const maxSpanRaw = Number(body.maxSpanCm)
  const maxSpanCm = Number.isFinite(maxSpanRaw) && maxSpanRaw >= 40 && maxSpanRaw <= 300 ? maxSpanRaw : DEFAULT_MAX_SPAN_CM

  const layout = computeLayout(pts, cm / px, maxSpanCm)

  // opcijsko shrani kot meritev (povezava na projekt/nalog)
  let savedId: string | null = null
  if (body.save === true) {
    const workOrderId = typeof body.workOrderId === 'string' && body.workOrderId ? body.workOrderId : null
    const projectIdIn = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
    let projectId = projectIdIn
    if (workOrderId) {
      const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { projectId: true } })
      if (!wo) return jsonError(400, 'Nalog ne obstaja.')
      projectId = wo.projectId ?? projectId
    }
    if (projectId) {
      const pr = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
      if (!pr) return jsonError(400, 'Projekt ne obstaja.')
    }
    const saved = await db.measurement.create({
      data: {
        type: typeof body.type === 'string' && ['OGRAJA', 'BALUSTRADA', 'NAGIB'].includes(body.type) ? body.type : 'OGRAJA',
        source: 'KAMERA',
        projectId,
        workOrderId,
        authorId: user.id,
        location: typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null,
        lengthCm: layout.totalLengthCm,
        posts: layout.posts,
        segments: layout.segments.length,
        slopeDeg: layout.slopeDeg,
        params: JSON.stringify({ points: pts, calibration: { px, cm }, maxSpanCm, layout }),
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : 'Postavitev iz točk na fotografiji',
      },
    })
    savedId = saved.id
    await db.measurementVersion.create({
      data: {
        measurementId: saved.id,
        version: 1,
        userId: user.id,
        data: JSON.stringify({ lengthCm: layout.totalLengthCm, posts: layout.posts, segments: layout.segments.length, slopeDeg: layout.slopeDeg }),
        note: 'Postavitev (layout) iz točk',
      },
    })
    await writeAudit({
      userId: user.id,
      action: 'LAYOUT_CREATE',
      entity: 'measurement',
      entityId: saved.id,
      projectId,
      detail: { totalLengthCm: layout.totalLengthCm, posts: layout.posts, segments: layout.segments.length, workOrderId },
    })
  }

  return NextResponse.json({ data: { ...layout, savedId } }, { status: 201 })
}

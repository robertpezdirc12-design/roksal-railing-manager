// /api/railing-layout — izračun postavitve ograje iz točk (issue #1)
// POST { points: [{x,y}], calibration: { px, cm, pxY?, cmY?, imgW?, imgH? }, maxSpanCm?, workOrderId?, projectId? }
//      (measurements.write) → geometrija: dolžine segmentov med sosednjimi točkami,
//      koti v vogalih, višinske razlike, št. stebrov (razpon ≤ maxSpanCm, privzeto 120),
//      skupna dolžina, metri ročnika. Opcijsko shrani kot meritev (source=KAMERA).
// GET ?measurementId= (measurements.read) → izračun postavitve iz shranjene meritve
//      (params.points + params.calibration) brez shranjevanja.
//
// R501 (issue #15 faza 2): ruta je imela SVOJE geometrijsko-kalibracijsko jedro
// (lasten parse točk, lasten cm/px izračun) in je zato na nagnjenem kaderju ali
// z ločeno Y referenco tiho uporabila ENO merilo povsod. Geometrija in kalibracijska
// pogodba sta zdaj prevzeta iz merilnega jedra — istih točk ne računa več dva
// različna izračuna, izpis pa ostane oblikovno enak.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import {
  calibrationToParams, computeGeometry, deriveProvenance, parseCalibration,
  parseEnginePoints, provenanceForParams, type GeometryResult,
} from '@/lib/measure-engine'
import { retryOnUnique } from '@/lib/versioning'
import { asJsonObject } from '@/lib/json'
import type { Prisma } from '@prisma/client'

const DEFAULT_MAX_SPAN_CM = 120

/** Stebri, ročnik in naklon iz geometrije jedra — edina logika, ki je jedro ne pozna. */
function layoutFrom (geo: GeometryResult, maxSpanCm: number) {
  const segments = geo.segments.map((s) => ({
    from: s.from, to: s.to, lengthCm: s.lengthCm, angleDeg: s.angleDeg, heightDiffCm: s.heightDiffCm,
  }))
  // stebri: na obeh koncih vsakega segmenta + vmesni do maxSpanCm
  const postCount = segments.reduce((acc, s) => {
    const spans = Math.max(1, Math.ceil(s.lengthCm / maxSpanCm))
    return acc + spans + 1
  }, 0)
  const uniquePosts = segments.length === 0 ? 0 : postCount - (segments.length - 1) // skupni vogalni stebri
  return {
    segments,
    corners: geo.corners,
    totalLengthCm: geo.totalLengthCm,
    posts: Math.max(segments.length > 0 ? 2 : 0, uniquePosts),
    handrailM: Math.round((geo.totalLengthCm / 100) * 100) / 100,
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

  let layout: ReturnType<typeof layoutFrom> | null = null
  {
    // R542: params je jsonb objekt — branje brez JSON.parse
    const p = asJsonObject(m.params)
    const calib = parseCalibration(p?.calibration)
    // točke so shranjene normalizirano (0..1) — v piksle jih pretvori jedro
    // (toPx prek imgW/imgH), zato route nima več svoje pretvorbe.
    const pts = parseEnginePoints(p?.points)
    // Brez dokazanega merila (px/cm) jedro ne izračuna NiČ — brez tihega
    // predpostavljenega 1 cm/px (issue #15 faza 1/2).
    if (pts.length >= 2 && calib) layout = layoutFrom(computeGeometry(pts, calib), DEFAULT_MAX_SPAN_CM)
  }
  if (!layout) {
    return jsonError(422, 'Meritev nima izračunljive geometrije točk.', 'Točke in kalibracija (px/cm) sta shranjeni samo pri meritvah s kamero — brez merila postavitve ne moremo izračunati.')
  }
  return NextResponse.json({ data: { measurementId, ...layout } })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const pts = parseEnginePoints(body.points)
  if (pts.length < 2) return jsonError(400, 'Za izračun so potrebne vsaj 2 točki.')

  const calib = parseCalibration(body.calibration)
  if (!calib) {
    return jsonError(400, 'Manjka kalibracija.', 'calibration: { px, cm } — dolžina referenčnega objekta v px in cm; za nagnjen kader lahko tudi { pxY, cmY }.')
  }
  const maxSpanRaw = Number(body.maxSpanCm)
  const maxSpanCm = Number.isFinite(maxSpanRaw) && maxSpanRaw >= 40 && maxSpanRaw <= 300 ? maxSpanRaw : DEFAULT_MAX_SPAN_CM

  const layout = layoutFrom(computeGeometry(pts, calib), maxSpanCm)

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
    const type = typeof body.type === 'string' && ['OGRAJA', 'BALUSTRADA', 'NAGIB'].includes(body.type) ? body.type : 'OGRAJA'
    // R501: tudi ta zapis nosi provenienco, izračunano v jedru.
    const provenance = deriveProvenance({
      points: body.points,
      calibration: body.calibration,
      legacyType: type,
    })
    // R539 (transakcijska celovitost): meritev + verzija + revizija v ENI
    // transakciji — padec srednjega koraka ne pusti meritve brez zgodovine
    // verzije/revizije. retryOnUnique je OKOLI CELE transakcije (P2002 znotraj
    // PG transakcije aborta celo tx in je neobnovljiv — ugotovitev R536);
    // številka verzije se ob ponovnem poskusu znova izračuna ZNOTRAJ tx.
    // Za sveže shranjeno meritev (nov id) je to vedno 1, vzorec pa je enoten
    // z ostalimi mesti ustvarjanja verzij.
    const saved = await retryOnUnique(() => db.$transaction(async (tx) => {
      const created = await tx.measurement.create({
        data: {
          type,
          source: 'KAMERA',
          status: provenance.status,
          statusNote: provenance.reason,
          projectId,
          workOrderId,
          authorId: user.id,
          location: typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null,
          lengthCm: layout.totalLengthCm,
          posts: layout.posts,
          segments: layout.segments.length,
          slopeDeg: layout.slopeDeg,
          params: {
            points: pts, calibration: calibrationToParams(calib), maxSpanCm, layout,
            // R501: ista provenienca/pogodba kot confirm in sinhronizacija.
            provenance: provenanceForParams({ status: provenance.status, reason: provenance.reason, scale: provenance.scale, calibration: calib }),
          } as unknown as Prisma.InputJsonValue,
          note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : 'Postavitev iz točk na fotografiji',
        },
      })
      const last = await tx.measurementVersion.findFirst({
        where: { measurementId: created.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      await tx.measurementVersion.create({
        data: {
          measurementId: created.id,
          version: (last?.version ?? 0) + 1,
          userId: user.id,
          // R542: data je jsonb objekt (ne niz)
          data: { lengthCm: layout.totalLengthCm, posts: layout.posts, segments: layout.segments.length, slopeDeg: layout.slopeDeg },
          note: 'Postavitev (layout) iz točk',
        },
      })
      await writeAudit({
        userId: user.id,
        action: 'LAYOUT_CREATE',
        entity: 'measurement',
        entityId: created.id,
        projectId,
        detail: { totalLengthCm: layout.totalLengthCm, posts: layout.posts, segments: layout.segments.length, workOrderId, status: provenance.status },
      }, tx)
      return created
    }))
    savedId = saved.id
  }

  return NextResponse.json({ data: { ...layout, savedId } }, { status: 201 })
}

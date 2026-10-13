// /api/measure-engine/analyze — ROKSAL merilni engine (issue #12 §1/§14/§13)
// POST { mode, points: [{x,y,src?}], calibration: { px, cm, imgW?, imgH?,
//        method?, refObject? }, options?, quality?, tiltDeg?,
//        viewAgreementPct?, manualLengthCm? } (measurements.write)
// Kanonična deterministična analiza zajema: geometrija, §14 validacija,
// §13 confidence, §3 capture guide, §8–§11 domenski paket.
// Brez AI, brez pisanja v bazo (čist izračun — potrjevanje ostane na
// /api/measurement/confirm, ki zapiše rezultat engine-a v params + revizijo).

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import {
  MEASURE_MODES, runAnalysis,
  type AnalyzeInput, type DomainOptions, type EngineCalib, type EnginePoint,
  type MeasureMode, type Opening,
} from '@/lib/measure-engine'

const MAX_POINTS = 64

function parsePoint (v: unknown): EnginePoint | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { x?: unknown; y?: unknown; src?: unknown }
  const x = Number(o.x); const y = Number(o.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -1e6 || x > 1e6 || y < -1e6 || y > 1e6) return null
  const src = o.src === 'PREDLOG' ? 'PREDLOG' : 'ROCNO'
  return { x, y, src }
}

function numOrNull (v: unknown, min: number, max: number): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

/** §4: kalibracija z metapodatki (metoda/referenčni objekt). */
function parseCalib (v: unknown): EngineCalib | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { px?: unknown; cm?: unknown; pxY?: unknown; cmY?: unknown; imgW?: unknown; imgH?: unknown; method?: unknown; refObject?: unknown }
  const px = Number(o.px); const cm = Number(o.cm)
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(cm) || cm <= 0 || cm > 100000) return null
  const out: EngineCalib = { px, cm }
  // issue #15 faza 1: ločena Y referenca (nagnjen kader) sme v merilo samo v
  // paru in v območju — sicer ostane enotno, ne tiha polovična vrednost.
  const pxY = Number(o.pxY); const cmY = Number(o.cmY)
  if (Number.isFinite(pxY) && pxY > 0 && Number.isFinite(cmY) && cmY > 0 && cmY <= 100000) { out.pxY = pxY; out.cmY = cmY }
  const imgW = Number(o.imgW); const imgH = Number(o.imgH)
  if (Number.isFinite(imgW) && imgW > 0) out.imgW = Math.round(imgW)
  if (Number.isFinite(imgH) && imgH > 0) out.imgH = Math.round(imgH)
  if (typeof o.method === 'string' && ['MARKER', 'ZNANA_MERA', 'ZUNANJA_NAPRAVA', 'LIDAR', 'ROCNO'].includes(o.method)) {
    out.method = o.method as EngineCalib['method']
  }
  if (typeof o.refObject === 'string' && o.refObject.trim()) out.refObject = o.refObject.trim().slice(0, 80)
  return out
}

function parseOptions (v: unknown): DomainOptions {
  const out: DomainOptions = {}
  if (!v || typeof v !== 'object') return out
  const o = v as Record<string, unknown>
  const maxSpan = numOrNull(o.maxSpanCm, 40, 300)
  if (maxSpan != null) out.maxSpanCm = maxSpan
  const height = numOrNull(o.heightCm, 10, 300)
  if (height != null) out.heightCm = height
  const tileW = numOrNull(o.tileWcm, 1, 400)
  if (tileW != null) out.tileWcm = tileW
  const tileH = numOrNull(o.tileHcm, 1, 400)
  if (tileH != null) out.tileHcm = tileH
  const joint = numOrNull(o.jointMm, 0, 30)
  if (joint != null) out.jointMm = joint
  if (o.pattern === 'DIAGONALNO' || o.pattern === 'PRAVOKOTNO') out.pattern = o.pattern
  const pitch = numOrNull(o.pitchDeg, 0, 84)
  if (pitch != null) out.pitchDeg = pitch
  if (o.roofMaterial === 'KOVINSKA' || o.roofMaterial === 'BETONNA') out.roofMaterial = o.roofMaterial
  const steps = numOrNull(o.steps, 1, 100)
  if (steps != null) out.steps = Math.round(steps)
  if (Array.isArray(o.openings)) {
    const openings: Opening[] = []
    for (const raw of o.openings.slice(0, 20)) {
      if (!raw || typeof raw !== 'object') continue
      const w = (raw as { wCm?: unknown }).wCm
      const h = (raw as { hCm?: unknown }).hCm
      const c = (raw as { count?: unknown }).count
      const wCm = numOrNull(w, 1, 1000)
      const hCm = numOrNull(h, 1, 1000)
      const count = numOrNull(c, 1, 200)
      if (wCm != null && hCm != null && count != null) openings.push({ wCm, hCm, count: Math.round(count) })
    }
    if (openings.length > 0) out.openings = openings
  }
  return out
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const mode = typeof body.mode === 'string' ? body.mode : ''
  if (!(MEASURE_MODES as string[]).includes(mode)) {
    return jsonError(400, 'Neznan način izmere.', `Veljavni načini: ${MEASURE_MODES.join(', ')}.`)
  }
  const rawPts: unknown[] = Array.isArray(body.points) ? body.points : []
  if (rawPts.length > MAX_POINTS) return jsonError(400, `Preveč točk (max ${MAX_POINTS}).`)
  const points = rawPts.map(parsePoint).filter((p): p is EnginePoint => p !== null)
  if (points.length === 0) {
    return jsonError(400, 'Manjkajo točke.', 'Podajte vsaj 1 točko (x, y) — minimalno število po načinu preveri validacija.')
  }

  // §4: brez eksplicitne reference ni avtomatske potrditve — kalibracija je OBVEZNA
  const calibration = parseCalib(body.calibration)
  if (!calibration) {
    return jsonError(400, 'Manjka referenčna kalibracija.', 'calibration: { px, cm, method?, refObject? } — brez reference avtomatska dimenzija ni veljavna (§4).')
  }

  const options = parseOptions(body.options)
  const qualityRaw = body.quality && typeof body.quality === 'object'
    ? body.quality as { dark?: unknown; bright?: unknown; blurry?: unknown; brightness?: unknown; blurScore?: unknown }
    : null
  const quality = qualityRaw
    ? {
      dark: qualityRaw.dark === true,
      bright: qualityRaw.bright === true,
      blurry: qualityRaw.blurry === true,
      brightness: numOrNull(qualityRaw.brightness, 0, 255) ?? undefined,
      blurScore: numOrNull(qualityRaw.blurScore, 0, 10000) ?? undefined,
    }
    : null

  const input: AnalyzeInput = {
    mode: mode as MeasureMode,
    points,
    calibration,
    options,
    quality,
    tiltDeg: numOrNull(body.tiltDeg, 0, 180),
    viewAgreementPct: numOrNull(body.viewAgreementPct, 0, 100),
    manualLengthCm: numOrNull(body.manualLengthCm, 0.1, 100000),
    viewCount: numOrNull(body.viewCount, 0, 64) != null ? Math.round(numOrNull(body.viewCount, 0, 64) as number) : null,
  }
  const result = runAnalysis(input)
  return NextResponse.json({ data: result })
}

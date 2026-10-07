// /api/measurement/detect — samodejna zaznava robov/točk na fotografiji (issue #1)
// POST { measurementId } (measurements.write) → VLM analiza fotografije (z-ai-web-dev-sdk,
// SAMO backend): predlagane merilne točke, referenčni objekti za kalibracijo in opis prizora.
// Točke so v normaliziranih koordinatah 0..1 (x desno, y dol) — UI jih riše na sliko,
// monter jih sprejme ali ročno popravi (ročni vnos ostane fallback).

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const VLM_TIMEOUT_MS = 60_000

interface DetectedPoint { x: number; y: number; label: string }
interface RefObject { x1: number; y1: number; x2: number; y2: number; estCm: number; label: string }

const clamp01 = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null
}

function parseDetectJson (raw: string): { scene: string; points: DetectedPoint[]; refObjects: RefObject[] } | null {
  // VLM lahko ovije JSON v ```json …``` ali dodatek — izluščimo prvi veljavni objekt
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      scene?: unknown; points?: unknown; refObjects?: unknown
    }
    const points: DetectedPoint[] = []
    if (Array.isArray(parsed.points)) {
      for (const p of parsed.points.slice(0, 24)) {
        const o = p as { x?: unknown; y?: unknown; label?: unknown }
        const x = clamp01(o.x); const y = clamp01(o.y)
        if (x === null || y === null) continue
        points.push({ x, y, label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : `Točka ${points.length + 1}` })
      }
    }
    const refObjects: RefObject[] = []
    if (Array.isArray(parsed.refObjects)) {
      for (const r of parsed.refObjects.slice(0, 8)) {
        const o = r as { x1?: unknown; y1?: unknown; x2?: unknown; y2?: unknown; estCm?: unknown; label?: unknown }
        const x1 = clamp01(o.x1); const y1 = clamp01(o.y1); const x2 = clamp01(o.x2); const y2 = clamp01(o.y2)
        const estCm = Number(o.estCm)
        if (x1 === null || y1 === null || x2 === null || y2 === null || !Number.isFinite(estCm) || estCm <= 0 || estCm > 500) continue
        refObjects.push({ x1, y1, x2, y2, estCm: Math.round(estCm), label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : 'Referenca' })
      }
    }
    return {
      scene: typeof parsed.scene === 'string' && parsed.scene.trim() ? parsed.scene.trim().slice(0, 200) : '',
      points,
      refObjects,
    }
  } catch {
    return null
  }
}

const PROMPT = `Si pomočnik merilca ograj. Analiziraj fotografijo terena in pomagaj pri zajemu meritev.
Vrni SAMO veljaven JSON (brez kode, brez markdown ograje) točno te oblike:
{
  "scene": "kratek opis prizora v slovenščini (npr. stopnišče z ograjo, terasa, balkon)",
  "points": [
    { "x": 0.0, "y": 0.0, "label": "ime točke" }
  ],
  "refObjects": [
    { "x1": 0.0, "y1": 0.0, "x2": 0.0, "y2": 0.0, "estCm": 100, "label": "opis" }
  ]
}
Pravila:
- koordinate x,y so normalizirane 0..1 (x=0 levo, x=1 desno, y=0 zgoraj, y=1 spodaj) glede na celotno fotografijo;
- "points": 4–12 najbolj uporabnih merilnih točk — vogali ograje, robovi segmentov, robovi stopnic, tla ob stebrih, zgornji rob ročnika; točke razporedi po merilni poti od leve proti desni;
- "refObjects": znani objekti z ocenjeno realno dolžino v cm (višina stopnice 16–18, višina ograje 100–110, širina vrat 80–100, višina podboja 200, dolžina ploščice …) — uporabni se za kalibracijo merila;
- če kakšen podatka ne vidiš, vrni prazen seznam.`

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  const measurementId = typeof body?.measurementId === 'string' ? body.measurementId : ''
  if (!measurementId) return jsonError(400, 'Manjka measurementId.', 'Podajte id fotografije (meritev tipa FOTO).')

  const photo = await db.measurement.findUnique({ where: { id: measurementId } })
  if (!photo) return jsonError(404, 'Fotografija (meritev) ne obstaja.')
  if (photo.type !== 'FOTO') return jsonError(400, 'Meritev ni fotografija.', 'Zaznava deluje na meritvah tipa FOTO.')

  let dataUrl: string | null = null
  if (photo.params) {
    try {
      const parsed = JSON.parse(photo.params) as { photo?: unknown }
      if (typeof parsed.photo === 'string' && parsed.photo.startsWith('data:image/')) dataUrl = parsed.photo
    } catch { /* prazno */ }
  }
  if (!dataUrl) return jsonError(422, 'Fotografija nima veljavne slike.', 'Params ne vsebuje dataUrl slike.')

  let raw = ''
  try {
    const zai = await ZAI.create()
    const vision = await Promise.race([
      zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
        thinking: { type: 'disabled' },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), VLM_TIMEOUT_MS)),
    ])
    raw = vision.choices[0]?.message?.content ?? ''
  } catch (e) {
    return jsonError(
      502,
      'Samodejna zaznava trenutno ni na voljo.',
      e instanceof Error ? `VLM: ${e.message}. Točke lahko označite ročno — ročni vnos ostaja popolnoma podprt.` : undefined
    )
  }

  const detected = parseDetectJson(raw)
  if (!detected || (detected.points.length === 0 && detected.refObjects.length === 0)) {
    return jsonError(
      422,
      'Zaznava ni prepoznala uporabnih točk.',
      'Fotografijo poskusite posneti bolj frontalno ali točke označite ročno.'
    )
  }

  await writeAudit({
    userId: user.id,
    action: 'MEASUREMENT_DETECT',
    entity: 'measurement',
    entityId: measurementId,
    projectId: photo.projectId,
    detail: { points: detected.points.length, refObjects: detected.refObjects.length, scene: detected.scene.slice(0, 80) },
  })

  return NextResponse.json({ data: detected })
}

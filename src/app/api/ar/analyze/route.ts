// /api/ar/analyze — R454 (issue #7 §16 P3: NAPREDNI AR, route-map
// §„3D vizualizacije & AR": POST /api/ar/analyze).
// POST (measurements.write) { photo: dataUrl, hint?: string } → VLM analiza
// prizora (z-ai-web-dev-sdk, SAMO backend): opis prizora + predlogi, KAM in
// KAKŠNO ograjo postaviti (orientacija, ocena dolžine/višine, opombe), ovire
// in referenčni objekti za oceno mer. Rezultat je pomoč pri odločitvi —
// NE vzor resnice (veljavne mere ostajajo izmera/kalibracija, issue #1).
// Ne piše v bazo — shranjevanje je eksplicitno prek POST /api/ar-snapshots.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const VLM_TIMEOUT_MS = 60_000

interface Placement {
  label: string
  where: string
  estLenCm: number | null
  note: string | null
}

interface ArAnalysis {
  scene: string
  placement: Placement[]
  obstacles: string[]
  references: string[]
}

const PROMPT = `Si svetovalec za postavitev ograj in teras. Analiziraj fotografijo lokacije (AR predogled).
Vrni SAMO veljaven JSON (brez kode, brez markdown ograje) točno te oblike:
{
  "scene": "kratek opis prizora v slovenščini (npr. vhodna terasa z vrati, stopnišče, balkon, rob ploščadi)",
  "placement": [
    { "label": "kratko ime predloga", "where": "kje na sliki (npr. ob levem robu terase, ob stopnišču)", "estLenCm": 400, "note": "opomba (nosilnost, pritrditev, estetika)" }
  ],
  "obstacles": ["ovire/omejitve na sliki (npr. vrata se odpirajo navzven, naklon, instalacije)"],
  "references": ["referenčni objekti za oceno mer (npr. ploščice 40 cm, vrata 90 cm, višina parapeta 110 cm)"]
}
Pravila:
- "placement": 1–4 najbolj smiselna mesta za ograjo; estLenCm je OCENA dolžine v centimetrih (celo število) ali null, če ni mogoče oceniti;
- "obstacles" in "references": kratki stavki v slovenščini, največ 6 vsak;
- če kategorije ne vidiš, vrni prazen seznam.`

function parseAnalysisJson (raw: string): ArAnalysis | null {
  // VLM lahko ovije JSON v ```json …``` ali doda besedilo — izluščimo prvi veljavni objekt
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      scene?: unknown; placement?: unknown; obstacles?: unknown; references?: unknown
    }
    const placement: Placement[] = []
    if (Array.isArray(parsed.placement)) {
      for (const p of parsed.placement.slice(0, 4)) {
        const o = p as { label?: unknown; where?: unknown; estLenCm?: unknown; note?: unknown }
        const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 60) : null
        const where = typeof o.where === 'string' && o.where.trim() ? o.where.trim().slice(0, 200) : null
        if (!label || !where) continue
        const len = Number(o.estLenCm)
        placement.push({
          label,
          where,
          estLenCm: Number.isFinite(len) && len >= 20 && len <= 10_000 ? Math.round(len) : null,
          note: typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 200) : null,
        })
      }
    }
    const strList = (v: unknown): string[] => {
      if (!Array.isArray(v)) return []
      return v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 6)
        .map((x) => x.trim().slice(0, 200))
    }
    return {
      scene: typeof parsed.scene === 'string' && parsed.scene.trim() ? parsed.scene.trim().slice(0, 300) : '',
      placement,
      obstacles: strList(parsed.obstacles),
      references: strList(parsed.references),
    }
  } catch {
    return null
  }
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  const photo = typeof body?.photo === 'string' ? body.photo : ''
  const hint = typeof body?.hint === 'string' ? body.hint.trim().slice(0, 200) : ''
  if (!photo.startsWith('data:image/')) {
    return jsonError(400, 'Manjka veljavna fotografija.', 'Podajte photo kot dataUrl slike (data:image/…).')
  }

  let raw = ''
  try {
    const zai = await ZAI.create()
    const vision = await Promise.race([
      zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: hint ? `${PROMPT}\n\nNamig uporabnika: ${hint}` : PROMPT },
            { type: 'image_url', image_url: { url: photo } },
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
      'Analiza prizora trenutno ni na voljo.',
      e instanceof Error ? `VLM: ${e.message}. Poskusite znova ali nadaljujte brez analize.` : undefined
    )
  }

  const analysis = parseAnalysisJson(raw)
  if (!analysis || (analysis.placement.length === 0 && !analysis.scene)) {
    return jsonError(
      422,
      'Analiza ni prepoznala uporabnih predlogov.',
      'Fotografijo poskusite posneti bolj frontalno ali nadaljujte brez analize.'
    )
  }

  await writeAudit({
    userId: user.id,
    action: 'AR_ANALYZE',
    entity: 'arAnalysis',
    detail: { scene: analysis.scene, placements: analysis.placement.length, hint: hint || null },
  })

  return NextResponse.json({ data: analysis })
}

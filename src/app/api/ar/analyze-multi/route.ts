// /api/ar/analyze-multi — R558 (raziskava R557, V1.4): VEČFOTOGRAFSKA
// PREČKA (HOVER-style). POST (measurements.write) { photos: dataUrl[] (2–8),
// hint? } → VLM prečka (z-ai-web-dev-sdk, SAMO backend) primerja dimenzije
// MED posnetki, opozori na neskladja in predlaga št. stebrov.
// Rezultat je POMOČ pri odločitvi — NE vir resnice (issue §1: veljavne mere
// ostajajo izmera/kalibracija). Ne piše v bazo.
// Vzorec: /api/ar/analyze (R454) — isti timeout, isti vzorec napak.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { jsonError, requirePermission } from '@/lib/auth'

const VLM_TIMEOUT_MS = 90_000
/** največje število fotografij v prečki (HOVER uporablja 8). */
const MAX_FOTO = 8
/** najmanj — prečka ima smisel šele od 2 (primerjava). */
const MIN_FOTO = 2
/** zgornja meja velikosti ene fotografije (dataUrl, ~6 MB). */
const MAX_BYTES = 6 * 1024 * 1024

interface PreckaDim {
  foto: number
  kaj: string
  ocenaCm: number | null
}

interface PreckaAnalysis {
  scene: string
  dims: PreckaDim[]
  warnings: string[]
  postsHint: number | null
  note: string
}

const PROMPT = `Si svetovalec za postavitev ograj. Dobil si VEČ fotografij ISTE lokacije/ograje iz različnih kotov (zaporedne številke 1..N).
Naloga: PREČKA — primerjaj med posnetki, kje se ocene dimenzij UJEMAJO in kje NE.
Vrni SAMO veljaven JSON (brez kode, brez markdown ograje) točno te oblike:
{
  "scene": "kratek skupni opis lokacije v slovenščini",
  "dims": [
    { "foto": 1, "kaj": "dolžina ograje / višina parapeta / razmak stebrov (kaj ocenjuješ)", "ocenaCm": 400 }
  ],
  "warnings": ["neskladja med posnetki (npr. foto 2 kaže 5,2 m, foto 4 pa 6,0 m — preverite)"],
  "postsHint": 7,
  "note": "kratek nasvet za monterja (npr. katera fotografija je najbolj zanesljiva in zakaj)"
}
Pravila:
- "dims": za vsako fotografijo, ki kaj uporabnega pokaže (največ 8 vrstic); ocenaCm je celo število ali null, če ni mogoče oceniti;
- "warnings": SAMO resnična neskladja med posnetki (ne splošne nasvete); največ 6;
- "postsHint": predlog števila stebrov iz vseh posnetkov (celo število) ali null;
- če posnetki niso isti objekt, to zapiši v warnings — ne ugibaj.`

function parsePreckaJson (raw: string): PreckaAnalysis | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      scene?: unknown; dims?: unknown; warnings?: unknown; postsHint?: unknown; note?: unknown
    }
    const dims: PreckaDim[] = []
    if (Array.isArray(parsed.dims)) {
      for (const d of parsed.dims.slice(0, 8)) {
        const o = d as { foto?: unknown; kaj?: unknown; ocenaCm?: unknown }
        const foto = Number(o.foto)
        const kaj = typeof o.kaj === 'string' && o.kaj.trim() ? o.kaj.trim().slice(0, 120) : null
        const ocena = Number(o.ocenaCm)
        if (!Number.isInteger(foto) || foto < 1 || foto > MAX_FOTO || !kaj) continue
        dims.push({ foto, kaj, ocenaCm: Number.isFinite(ocena) && ocena >= 10 && ocena <= 20_000 ? Math.round(ocena) : null })
      }
    }
    const strList = (v: unknown): string[] => {
      if (!Array.isArray(v)) return []
      return v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 6)
        .map((x) => x.trim().slice(0, 240))
    }
    const ph = Number(parsed.postsHint)
    return {
      scene: typeof parsed.scene === 'string' && parsed.scene.trim() ? parsed.scene.trim().slice(0, 300) : '',
      dims,
      warnings: strList(parsed.warnings),
      postsHint: Number.isFinite(ph) && ph >= 2 && ph <= 60 ? Math.round(ph) : null,
      note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim().slice(0, 400) : '',
    }
  } catch {
    return null
  }
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  void user

  const body = await req.json().catch(() => null)
  const photos = body?.photos
  const hint = typeof body?.hint === 'string' ? body.hint.trim().slice(0, 200) : ''
  if (!Array.isArray(photos) || photos.length < MIN_FOTO) {
    return jsonError(400, 'Prečka zahteva vsaj 2 fotografiji.', 'Podajte photos kot seznam dataUrl-jev (2–8).')
  }
  if (photos.length > MAX_FOTO) {
    return jsonError(400, `Največ ${MAX_FOTO} fotografij v eni prečki.`, 'Razdelite na več klicev ali izberite najboljših 8.')
  }
  const veljavne: string[] = []
  for (const p of photos) {
    if (typeof p !== 'string' || !p.startsWith('data:image/')) {
      return jsonError(400, 'Ena od fotografij ni veljavna.', 'Vsaka fotografija mora biti dataUrl (data:image/…).')
    }
    if (p.length > MAX_BYTES) {
      return jsonError(400, 'Fotografija je prevelika.', 'Vsaka fotografija naj ostane pod ~6 MB (dataUrl).')
    }
    veljavne.push(p)
  }

  let raw = ''
  try {
    const zai = await ZAI.create()
    // SDK tip: VisionMultimodalContentItem[] — literalne vrste (text | image_url).
    const content: Array<{ type: 'text'; text: string; image_url?: undefined } | { type: 'image_url'; image_url: { url: string }; text?: undefined }> = [
      { type: 'text', text: hint ? `${PROMPT}\n\nNamig uporabnika: ${hint}` : PROMPT },
      ...veljavne.map((url): { type: 'image_url'; image_url: { url: string } } => ({ type: 'image_url', image_url: { url } })),
    ]
    const vision = await Promise.race([
      zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [{ role: 'user', content }],
        thinking: { type: 'disabled' },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), VLM_TIMEOUT_MS)),
    ])
    raw = vision.choices[0]?.message?.content ?? ''
  } catch (e) {
    return jsonError(
      502,
      'Prečka trenutno ni na voljo.',
      e instanceof Error ? `VLM: ${e.message}. Poskusite znova ali nadaljujte brez prečke.` : undefined
    )
  }

  const analysis = parsePreckaJson(raw)
  if (!analysis || (analysis.dims.length === 0 && !analysis.scene)) {
    return jsonError(
      422,
      'Prečka ni vrnila uporabnega odgovora.',
      'Poskusite z jasnejšimi fotografijami (isti objekt, več kotov) ali nadaljujte brez prečke.',
    )
  }
  return NextResponse.json({ data: analysis })
}

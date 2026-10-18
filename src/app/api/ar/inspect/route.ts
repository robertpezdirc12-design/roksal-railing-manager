// /api/ar/inspect — R559 (vprašanje lastnika »ali kamera sama zazna, kaj je
// ograja, kakšno okovje, keramika ali les«): VLM PREPOZNAVA OBSTOJEČE
// OGRAJE. POST (measurements.write) { photo: dataUrl, hint? } → glm-4.6v
// prepozna: ali je na sliki ograja, tip, MATERIAL ROČNIKA (les/keramika/
// inox/…), polnilo, stebri, OKOVJE (kljuka/tečaji/ključavnica) in stanje.
// Rezultat je PREDLOG s zaupanjem — NE vir resnice (issue §1: identiteto
// materiala na terenu vedno potrdi monter). Ne piše v bazo.
// Vzorec: /api/ar/analyze (R454) + /api/ar/analyze-multi (R558).
// Čista logika (tipi, prompt, parser) je v src/lib/inspect-core.ts.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { INSPECT_PROMPT, parseInspectJson } from '@/lib/inspect-core'

const VLM_TIMEOUT_MS = 60_000

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
  if (photo.length > 6 * 1024 * 1024) {
    return jsonError(400, 'Fotografija je prevelika.', 'Fotografija naj ostane pod ~6 MB (dataUrl).')
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
            { type: 'text', text: hint ? `${INSPECT_PROMPT}\n\nNamig uporabnika: ${hint}` : INSPECT_PROMPT },
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
      'Prepoznavanje trenutno ni na voljo.',
      e instanceof Error ? `VLM: ${e.message}. Poskusite znova ali nadaljujte brez prepoznavanja.` : undefined
    )
  }

  const inspect = parseInspectJson(raw)
  if (!inspect) {
    return jsonError(
      422,
      'Prepoznavanje ni vrnilo uporabnega odgovora.',
      'Poskusite z bolj frontalno fotografijo ograje ali nadaljujte brez prepoznavanja.'
    )
  }

  await writeAudit({
    userId: user.id,
    action: 'AR_INSPECT',
    entity: 'arInspect',
    detail: {
      jeOgraja: inspect.jeOgraja,
      tipOgraje: inspect.tipOgraje,
      rocnikMaterial: inspect.rocnik.material,
      rocnikZaupanje: inspect.rocnik.zaupanje,
      hint: hint || null,
    },
  })

  return NextResponse.json({ data: inspect })
}

// .zscripts/vlm-check.ts — R562: PREVERJANJE GLM-4.6V PREK STREŽNIKA (z-ai-web-dev-sdk).
// Namen: lastnikov ukaz »(GLM-4.6V prek strežnika) je zastonj, deluje — preveri,
// če ne, skripte naredi«. Ta skript preveri VSE poti, ki jih aplikacija uporablja:
//
//   1) DIREKTNA POT (kot /api/ar/analyze): ZAI.create() → createVision(model glm-4.6v)
//      z base64 dataUrl — NATANČNO tako, kot dela ruta (backend, nikoli client).
//   2) ODGOVOR NA PRAVI FOTOGRAFIJI (ne 1×1 px): ROKSAL WPC terasna ograja.
//   3) HITROST + dolžina odgovora (timeout ruta = 60 s — mora biti pod).
//
// Zagon: bun .zscripts/vlm-check.ts [pot-do-slike]
// Izhod: človeku berljivo poročilo + /tmp/r562-vlm-check.json (dokaz).

import ZAI from 'z-ai-web-dev-sdk'
import { readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'

const DEFAULT_IMAGE = 'public/assets/roksal/src/r495-deske-za-ograje-wpc-precna-balkonska-ograja_378.jpg'
const imagePath = process.argv[2] ?? DEFAULT_IMAGE

// Točno tako, kotruta preverja veljavnost vhoda (data:image/…):
function toDataUrl (p: string): string {
  const buf = readFileSync(p)
  const ext = extname(p).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

// Enak timeout, kot ga ima /api/ar/analyze (VLM_TIMEOUT_MS = 60 s):
const VLM_TIMEOUT_MS = 60_000

const PROMPT = `Analiziraj fotografijo. Naštej materiale in elemente (les, WPC, kovina, inox, keramika, vijaki …) ter oceni dimenzije. Odgovori v slovenščini, največ 15 vrstic.`

async function main (): Promise<void> {
  console.log('════ GLM-4.6V PREK STREŽNIKA — preverjanje (R562) ════')
  console.log(`Slika: ${imagePath}`)

  const photo = toDataUrl(imagePath)
  console.log(`dataUrl: ${photo.length.toLocaleString('sl-SI')} znakov (~${Math.round(photo.length * 0.75 / 1024)} kB slike)`)

  const t0 = Date.now()
  try {
    const zai = await ZAI.create()
    console.log('ZAI.create() ✓')

    const vision = await Promise.race([
      zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: photo } },
          ],
        }],
        thinking: { type: 'disabled' },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout ${VLM_TIMEOUT_MS} ms`)), VLM_TIMEOUT_MS)),
    ])
    const ms = Date.now() - t0
    const content: string = vision.choices[0]?.message?.content ?? ''
    const usage = vision.usage ?? null

    console.log(`\n── VLM ODGOVOR (${ms.toLocaleString('sl-SI')} ms, ${content.length} znakov) ──\n`)
    console.log(content)
    console.log('\n────────────────────────────────────────────────────')

    const ok = content.length > 50
    const report = {
      ok,
      model: 'glm-4.6v',
      image: imagePath,
      dataUrlChars: photo.length,
      ms,
      chars: content.length,
      usage,
      finishReason: vision.choices[0]?.finish_reason ?? null,
      createdAt: new Date().toISOString(),
      contentPreview: content.slice(0, 500),
    }
    writeFileSync('/tmp/r562-vlm-check.json', JSON.stringify(report, null, 2))
    console.log(`\n${ok ? '✓ DELUJE' : '✗ ODGOVOR PREKRATKOV'} — dokaz: /tmp/r562-vlm-check.json`)
    process.exit(ok ? 0 : 1)
  } catch (e) {
    const ms = Date.now() - t0
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`\n✗ NAPAKA po ${ms} ms: ${msg}`)
    writeFileSync('/tmp/r562-vlm-check.json', JSON.stringify({ ok: false, ms, error: msg }, null, 2))
    process.exit(1)
  }
}

void main()

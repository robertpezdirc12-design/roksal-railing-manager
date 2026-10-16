#!/usr/bin/env node
// ops/roksal-fetch.mjs — R533 (issue #16 Faza 4): ponovljiv, idempotenten
// pregled/prenos JAVNO dostopnih uradnih gradiv roksal.com za knjižnico.
//
// NAČELA (issue #16):
//  - BREZ plačljivih API-jev, brez AI, brez obvajanja zaščite: če strežnik
//    odgovori 403/429/izziv, se URL zabeleži kot BLOKIRAN (status + razlog)
//    in se nadaljuje — nikoli se ne obide prijave ali zaščite;
//  - idempotentno: SHA-256 vs obstoječi MANIFEST.json → PODVOJENO preskoči
//    (ista datoteka prek več URL-jev je ENO sredstvo);
//  - omejitev hitrosti: R533_PAUSE_MS (privzeto 1200 ms) med zahtevami;
//  - izvirniki se NE prepišejo: nove datoteke gredo v public/assets/roksal/src/
//    SAMO z --write, sicer samo poročilo (suha vožnja je privzeta);
//  - poročilo JSON na stdout (machine berljivo) + človeški povzetek na stderr.
//
// Uporaba:
//   node ops/roksal-fetch.mjs                    # suha vožnja (pregled)
//   node ops/roksal-fetch.mjs --write            # prenese NOVE datoteke
//   R533_URLS="url1,url2" node ops/roksal-fetch.mjs   # lasten seznam
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const SRC = path.join(REPO, 'public/assets/roksal/src')
const MANIFEST = path.join(SRC, 'MANIFEST.json')
const PAUSE = Number(process.env.R533_PAUSE_MS || 1200)
const WRITE = process.argv.includes('--write')
const UA = 'roksal-asset-fetch/1.0 (issue #16; contact: repository owner)'

// Faza 1 začetne strani (issue #16) + robots.txt (spoštovanje pogojev dostopa)
const STRANI = (process.env.R533_URLS ||
  'https://roksal.com/robots.txt,' +
  'https://roksal.com/woodcore-wpc-deske/pregradne-stene/pokoncne-deske/,' +
  'https://roksal.com/woodcore-wpc-deske/pregradne-stene/precne-deske/,' +
  'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/,' +
  'https://roksal.com/woodcore-wpc-deske/wpc-deske-za-fasado/,' +
  'https://roksal.com/woodcore-wpc-deske/terasne-deske/').split(',').filter(Boolean)

const porocilo = { strani: [], kandidati: 0, novo: [], podvojeno: [], blokirano: [], napake: [] }
const manifest = existsSync(MANIFEST)
  ? JSON.parse(await readFile(MANIFEST, 'utf8'))
  : { datoteke: {} }
const znaniSha = new Set()
for (const v of Object.values(manifest.datoteke || {})) if (v.sha256) znaniSha.add(v.sha256)

const spans = (ms) => new Promise((r) => setTimeout(r, ms))

async function pridobi (url, asText = true) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: asText ? 'text/html,*/*' : '*/*' }, redirect: 'follow' })
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
  return asText ? await r.text() : Buffer.from(await r.arrayBuffer())
}

// 1) strani: izlušči povezave do gradiv (izvirniki wp-content/uploads imajo
//    prednost pred pomanjšanimi sličicami; -150x150 tipi preskočeni)
const zanimiviUrl = new Set()
for (const url of STRANI) {
  try {
    const html = await pridobi(url)
    const najdeni = [...html.matchAll(/https:\/\/roksal\.com\/wp-content\/uploads\/[^"'\\\s)]+/g)]
      .map((m) => m[0]).filter((u) => !/-\d{2,4}x\d{2,4}\.(png|jpe?g|webp)$/i.test(u))
    for (const u of najdeni) zanimiviUrl.add(u.split('#')[0].split('?')[0])
    porocilo.strani.push({ url, status: 200, gradiv: najdeni.length })
  } catch (e) {
    porocilo.strani.push({ url, status: e.status ?? 0, napaka: e.message })
    porocilo.blokirano.push({ url, razlog: `stran nedosegljiva: ${e.message}` })
  }
  await spans(PAUSE)
}
porocilo.kandidati = zanimiviUrl.size

// 2) datoteke: SHA-256 dedup proti MANIFEST (novost: prenosi SAMO z --write)
for (const url of zanimiviUrl) {
  try {
    const buf = await pridobi(url, false)
    const sha = createHash('sha256').update(buf).digest('hex')
    if (znaniSha.has(sha)) {
      porocilo.podvojeno.push({ url, sha: sha.slice(0, 12) })
    } else {
      porocilo.novo.push({ url, sha, bajtov: buf.length })
      if (WRITE) {
        await mkdir(SRC, { recursive: true })
        const ime = url.split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_')
        await writeFile(path.join(SRC, ime), buf)
        // opomba: vnos v MANIFEST + vezava na SKU/varianto je NAMENNO ročna
        // (issue #16 Faza 2: avtomatika ne ugiba semantike — zapiše jo človek)
      }
    }
  } catch (e) {
    porocilo.blokirano.push({ url, razlog: e.message })
  }
  await spans(PAUSE)
}

console.log(JSON.stringify(porocilo, null, 2))
console.error(`── strani: ${porocilo.strani.length} (OK ${porocilo.strani.filter((s) => s.status === 200).length}) · kandidati: ${porocilo.kandidati} · NOVO: ${porocilo.novo.length} · podvojeno: ${porocilo.podvojeno.length} · blokirano: ${porocilo.blokirano.length}`)
if (!WRITE) console.error('── suha vožnja (brez --write nič ni zapisano)')

// ops/r524-cipi.mjs — R524 (issue #14): izrez čipov površine za OGRAJE iz
// URADNIH barvnih lestvic v izvirni ločljivosti.
//
// NEIZDAJALNO dokazno orodje (ne del aplikacije). Posplošitev metode
// ops/r523-cipi.mjs (dokazane na KUBO) na 4 ograjske izdelke:
//   ROK-OGP-POLNA-57   — namenska lestvica 57/32 (2217×675, lokalna od R523) — 3 čipi
//   ROK-OG-POLNA-128   — BARVNA_LESTVICA_4-polna-128-4.png (2560×683)      — 6 čipov
//   ROK-OGP-POLNA-100  — BARVNA_LESTVICA_2_polna.png (2560×600)            — 8 čipov
//   ROK-OG-ROMB-67     — BARVNA_LESTVICA_3-rombi4.png (2560×669)           — 7 čipov
// DESKA-150 NAMENOMERNO IZPUŠČENA: njena lestvica (terasa-150, »BARVE IN
// PROFILI«) kaže ŽLEBIČASTO stran terasne deskе, ograja DESKA 150 pa kaže
// GLADKO stran (VLM dokaz na uradni scenični fotografiji) — vir površine za
// DESKA-150 ostanejo scenične fotografije (dokazano R518), lestvica je zanjo
// zgolj barvna referenca.
//
// Postopek (identičen r523, determinističen, brez AI, reproducibilno):
//  1. detekcija čipov: stolpčna pokritost ne-ozadja → grozdi stolpcev;
//     vertikalna razpetina v grozdu → sredica in premer;
//  2. izrez vpisanega kvadrata s prilagodljivim krčenjem 0,70→0,42·r do
//     NIČ prosojnih pikslov (stran od roba čipa in sence);
//  3. izmera smeri vlaken: gradientna anisotropija |dI/dx| vs |dI/dy|;
//     REFERENCA = deska iz uradne fotografije POKONČNE ograje 57/32
//     (r495-deske-za-ograje-wpc-pokoncna_384.jpg — isti izrez kot ga dela
//     aplikacija, izmeriIzrezNavpicnePalice);
//  4. čip se rotira za 90° SAMO če so njegova vlakna vodoravna, referenčna
//     pa navpična (vlakna tečejo VZDOLŽ letvice — vse 4 ograje so pokončne);
//  5. dodelitev po VRSTNEM REDU OZNAK, ki jih je VLM prebral na lestvici
//     DVAKRAT (sličica 1024 px + izvirnik — ista zaporedja, dokaz v
//     raziskovalnem dnevniku R524); barvna bližina povprečja izreza do
//     ODTENKI_HEX (photo-replace-core) se izmeri in zapiše v revizijo —
//     če se NE strinja z oznakami, se zapiše opozorilo z številkami (ne
//     tiho), oznaka uradne grafike ostane primarna;
//  6. zapis PNG-jev v public/assets/roksal/src/ + poročilo ops/r524-cipi.json.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..')
const SRC = join(REPO, 'public/assets/roksal/src')

// Vrstni red oznak od leve proti desni — VLM prebral DVAKRAT (1024 px sličica
// in izvirnik); ujema se s številom in množico aktivnih variant kataloga.
const LESTVICE = [
  {
    sku: 'ROK-OGP-POLNA-57', file: 'roksal-barvna-lestvica-polna-57.png',
    predpona: 'roksal-polna57-cip',
    red: ['AMW', 'OKW', 'RWA'],
    vir: 'https://roksal.com/wp-content/uploads/2026/02/BARVNA_LESTVICA_5-polna-deska-57-32_3.png',
  },
  {
    sku: 'ROK-OG-POLNA-128', file: 'roksal-barvna-lestvica-polna-128-full.png',
    predpona: 'roksal-polna128-cip',
    red: ['AMW', 'ASH', 'BUT', 'OKW', 'ROAK', 'RWA'],
    vir: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_4-polna-128-4.png',
  },
  {
    sku: 'ROK-OGP-POLNA-100', file: 'roksal-barvna-lestvica-polna-100-full.png',
    predpona: 'roksal-polna100-cip',
    red: ['AMW', 'ASH', 'GLT', 'BUT', 'OKW', 'WHT', 'ROAK', 'RWA'],
    vir: 'https://roksal.com/wp-content/uploads/2024/10/BARVNA_LESTVICA_2_polna.png',
  },
  {
    sku: 'ROK-OG-ROMB-67', file: 'roksal-barvna-lestvica-romb-67-full.png',
    predpona: 'roksal-romb67-cip',
    red: ['AMW', 'ASH', 'GLT', 'BUT', 'OKW', 'ROAK', 'RWA'],
    vir: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_3-rombi4.png',
  },
]

// ODTENKI_HEX iz src/lib/photo-replace-core.ts (mediana uradnih lestvic)
const ODTENKI = {
  AMW: { ime: 'Amazon wood', hex: '#5e5e61' },
  ASH: { ime: 'Ash wood', hex: '#8f8f91' },
  GLT: { ime: 'Golden teak', hex: '#a27e76' },
  BUT: { ime: 'Burma teak', hex: '#8d756d' },
  OKW: { ime: 'Oak wood', hex: '#b0917c' },
  WHT: { ime: 'White', hex: '#c4c3c2' },
  ROAK: { ime: 'Rustic oak', hex: '#9c8061' },
  RWA: { ime: 'Rustic walnut', hex: '#71675c' },
}
const hexRgb = (h) => ({
  r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16),
})
const evklid = (a, b) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)

const izmeriAnizotropijo = (siv, w, h) => {
  let gx = 0, gy = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (x + 1 < w) gx += Math.abs(siv[i + 1] - siv[i])
    if (y + 1 < h) gy += Math.abs(siv[i + w] - siv[i])
  }
  return { gx, gy, razmerje: gy / Math.max(1, gx) }
}

// ── referenčna smer vlaken: uradna fotografija POKONČNE ograje 57/32 ────────
const TEKS = await import(join(REPO, 'src/lib/photo-replace-texture.ts'))
const imgRef = await loadImage(join(SRC, 'r495-deske-za-ograje-wpc-pokoncna_384.jpg'))
const cvRef = createCanvas(imgRef.width, imgRef.height)
const rCtx = cvRef.getContext('2d')
rCtx.drawImage(imgRef, 0, 0)
const izrezRef = TEKS.izmeriIzrezNavpicnePalice((x, y) => {
  const d = rCtx.getImageData(Math.round(x), Math.round(y), 1, 1).data
  return (d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114) / 255
}, imgRef.width, imgRef.height)
if (!izrezRef) throw new Error('referenčni izrez pokončne ograje ni uspel — ne morem izmeriti smeri vlaken')
const wR = izrezRef.w, hR = izrezRef.h
const dRef = rCtx.getImageData(izrezRef.x, 0, wR, hR).data
const sivRef = new Float32Array(wR * hR)
for (let i = 0; i < wR * hR; i++) {
  const j = i * 4
  sivRef[i] = 0.2126 * dRef[j] + 0.7152 * dRef[j + 1] + 0.0722 * dRef[j + 2]
}
const anizRef = izmeriAnizotropijo(sivRef, wR, hR)
console.log(`[referenca] pokončna ograja 57/32 (AMAZON WOOD), deska ${wR}×${hR}px — vlakna: |dI/dy|/|dI/dx| = ${anizRef.razmerje.toFixed(2)} (${anizRef.razmerje <= 1 ? 'NAVPIČNA' : 'vodoravna'})`)
if (anizRef.razmerje > 1) throw new Error('referenčna ograja kaže VODORAVNA vlakna — pokončna ograja jih ima navpične; preveri referenco')

const porocilo = { referenca: { slika: 'r495-deske-za-ograje-wpc-pokoncna_384.jpg', anizotropija: +anizRef.razmerje.toFixed(3) }, lestvice: [] }
const ROB_ZAC = 0.70, ROB_MIN = 0.42

for (const L of LESTVICE) {
  console.log(`\n▌ ${L.sku} — ${L.file}`)
  const img = await loadImage(join(SRC, L.file))
  const W = img.width, H = img.height
  console.log(`[lestvica] ${W}×${H}`)
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const D = ctx.getImageData(0, 0, W, H).data
  const jeMaterial = (i) => D[i + 3] > 200

  // 1. detekcija grozdov po stolpcih
  const pragStolpec = Math.round(H * 0.35)
  const pokritost = new Array(W).fill(0)
  for (let x = 0; x < W; x++) {
    let n = 0
    for (let y = 0; y < H; y++) if (jeMaterial((y * W + x) * 4)) n++
    pokritost[x] = n
  }
  const grozdi = []
  let tek = false, od = 0
  for (let x = 0; x <= W; x++) {
    const nad = x < W && pokritost[x] >= pragStolpec
    if (nad && !tek) { tek = true; od = x }
    if (!nad && tek) { tek = false; if (x - od >= 200) grozdi.push({ x0: od, x1: x }) }
  }
  if (grozdi.length !== L.red.length) throw new Error(`${L.sku}: pričakovanih ${L.red.length} čipov, najdenih ${grozdi.length} grozdov`)
  console.log(`[detekcija] ${grozdi.length} grozdov (širine: ${grozdi.map(g => g.x1 - g.x0).join(', ')})`)

  // 2. sredica + premer vsakega čipa
  const cipi = grozdi.map((g, idx) => {
    let xPeak = g.x0
    for (let x = g.x0; x < g.x1; x++) if (pokritost[x] > pokritost[xPeak]) xPeak = x
    let tekZacetek = -1, najTek = { od: -1, dol: 0 }, tekDol = 0
    for (let y = 0; y <= H; y++) {
      const material = y < H && jeMaterial((y * W + xPeak) * 4)
      if (material) { if (tekZacetek < 0) tekZacetek = y; tekDol++ }
      if (!material && tekZacetek >= 0) {
        if (tekDol > najTek.dol) najTek = { od: tekZacetek, dol: tekDol }
        tekZacetek = -1; tekDol = 0
      }
    }
    if (najTek.dol < 200) throw new Error(`${L.sku} čip ${idx + 1}: najdaljši zaporedni tek le ${najTek.dol}px — ni kroga`)
    return { idx, xPeak, yc: Math.round((najTek.od * 2 + najTek.dol - 1) / 2), premer: najTek.dol }
  })

  // 3. izrez z adaptivnim krčenjem + izmere
  const izrezi = cipi.map(c => {
    const r = c.premer / 2
    let pol = 0, x0 = 0, y0 = 0
    for (let s = Math.floor(r * ROB_ZAC); s >= Math.floor(r * ROB_MIN); s--) {
      const xs = c.xPeak - s, ys = c.yc - s, w = s * 2, h = s * 2
      if (xs < 0 || ys < 0 || xs + w > W || ys + h > H) continue
      let prosojnih = 0
      for (let y = ys; y < ys + h && prosojnih === 0; y++) {
        for (let x = xs; x < xs + w; x++) {
          if (D[(y * W + x) * 4 + 3] < 255) { prosojnih++; break }
        }
      }
      if (prosojnih === 0) { pol = s; x0 = xs; y0 = ys; break }
    }
    if (pol === 0) throw new Error(`${L.sku} čip ${c.idx + 1}: celoten izrez sega ven iz čipa`)
    const w = pol * 2, h = pol * 2
    const cvC = createCanvas(w, h)
    const cCtx = cvC.getContext('2d')
    cCtx.drawImage(img, x0, y0, w, h, 0, 0, w, h)
    const d = cCtx.getImageData(0, 0, w, h).data
    const siv = new Float32Array(w * h)
    let rAcc = 0, gAcc = 0, bAcc = 0
    for (let i = 0; i < w * h; i++) {
      const j = i * 4
      siv[i] = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]
      rAcc += d[j]; gAcc += d[j + 1]; bAcc += d[j + 2]
    }
    const n = w * h
    return { cip: c, x0, y0, w, h, rob: pol / r, platno: cvC, avg: { r: rAcc / n, g: gAcc / n, b: bAcc / n }, ...izmeriAnizotropijo(siv, w, h) }
  })

  // 4. dodelitev po vrstnem redu oznak + barvna bližina (poročana, opozorjena)
  const vnos = { sku: L.sku, lestvica: { file: L.file, W, H, vir: L.vir }, cipi: [] }
  izrezi.forEach((iz, i) => {
    const skuO = L.red[i]
    const odtenek = ODTENKI[skuO]
    const dDodeljena = evklid(iz.avg, hexRgb(odtenek.hex))
    // najbližji DRUGI odtenek (za poročilo ostrine dodelitve)
    let najDrugi = null, najDrugiD = Infinity
    for (const [k, o] of Object.entries(ODTENKI)) {
      if (k === skuO) continue
      const dd = evklid(iz.avg, hexRgb(o.hex))
      if (dd < najDrugiD) { najDrugiD = dd; najDrugi = k }
    }
    if (najDrugiD < dDodeljena) {
      console.log(`  ⚠ čip ${i + 1} (${odtenek.ime}): barvna bližina bi raje izbrala ${ODTENKI[najDrugi].ime} (${najDrugiD.toFixed(0)} < ${dDodeljena.toFixed(0)}) — oznaka uradne grafike ostane PRIMARNA (VLM jo prebral dvakrat)`)
    }
    // 5. rotacija: vlakna naj tečejo VZDOLŽ letvice (referenca: navpična)
    const vodoravnaVl = iz.razmerje > 1.15
    const rotiraj = vodoravnaVl && anizRef.razmerje <= 1
    let out = iz.platno
    if (rotiraj) {
      out = createCanvas(iz.h, iz.w)
      const o = out.getContext('2d')
      o.translate(iz.h / 2, iz.w / 2)
      o.rotate(Math.PI / 2)
      o.drawImage(iz.platno, -iz.w / 2, -iz.h / 2)
    }
    const file = `${L.predpona}-${skuO.toLowerCase()}.png`
    writeFileSync(join(SRC, file), out.toBuffer('image/png'))
    vnos.cipi.push({
      sku: `${L.sku}-${skuO}`, odtenek: odtenek.ime, hex: odtenek.hex, file,
      izrez: { x: iz.x0, y: iz.y0, w: iz.w, h: iz.h }, premerCipa: iz.cip.premer, rob: +iz.rob.toFixed(3),
      avgRgb: { r: +iz.avg.r.toFixed(1), g: +iz.avg.g.toFixed(1), b: +iz.avg.b.toFixed(1) },
      barvnaRazdalja: +dDodeljena.toFixed(1), najblizjiDrugi: { koda: najDrugi, razdalja: +najDrugiD.toFixed(1) },
      anizotropija: +iz.razmerje.toFixed(3), rotirano: rotiraj,
    })
    console.log(`  čip ${i + 1}: ${odtenek.ime.padEnd(13)} izrez ${iz.w}×${iz.h}px · avg(${iz.avg.r.toFixed(0)},${iz.avg.g.toFixed(0)},${iz.avg.b.toFixed(0)}) · d=${dDodeljena.toFixed(0)} · vlakna |dy/dx|=${iz.razmerje.toFixed(2)}${rotiraj ? ' · ROTIRANO 90°' : ''} → ${file}`)
  })
  porocilo.lestvice.push(vnos)
}

writeFileSync(join(REPO, 'ops/r524-cipi.json'), JSON.stringify(porocilo, null, 2))
const skupaj = porocilo.lestvice.reduce((a, l) => a + l.cipi.length, 0)
console.log(`\n[zapis] ${skupaj} čipov + ops/r524-cipi.json — revizijsko poročilo`)

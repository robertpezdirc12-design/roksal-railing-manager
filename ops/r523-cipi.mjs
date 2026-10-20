// ops/r523-cipi.mjs — R523 (issue #14): izrez čipov površine KUBO iz URADNE
// barvne lestvice v polni ločljivosti.
//
// NEIZDAJALNO dokazno orodje (ne del aplikacije). Lestvica
// BARVNA_LESTVICA_5-kubo4.png (2217×675, roksal.com wp-content/uploads) vsebuje
// 4 okrogle čipe FOTOGRAFSKE lesne površine — po enega za vsak uradni odtenek
// KUBO (Amazon wood, Oak wood, Rustic oak, Rustic walnut). Vsak čip je ~480 px
// premeru — 24–35× več ločljivosti na površino kot trak ene deske iz scenične
// namestitvene fotografije (17–21 px, R520).
//
// Postopek (determinističen, brez AI, reproducibilno):
//  1. detekcija 4 čipov: stolpčna pokritost ne-ozadja → grozdi stolpcev;
//     vertikalna razpetina v grozdu → sredica in premer;
//  2. izrez vpisanega kvadrata (0,62·r) — stran od roba čipa in sence;
//  3. izmera smeri vlaken: gradientna anizotropija |dI/dx| vs |dI/dy| na izrezu
//     in na REFERENČNI deski iz resnične KUBO fasade (b6cd18418118 — isti izrez
//     kot ga dela aplikacija, izmeriIzrezNavpicnePalice);
//  4. čip se rotira za 90° SAMO če so njegova vlakna vodoravna, referenčna
//     navpična (vlakna tečejo VZDOLŽ letvice — KUBO se montira navpično);
//  5. barvno ujemanje: povprečna RGB barva izreza vs ODTENKI_HEX iz jedra
//     (photo-replace-core) → dodelitev SKU; ZAHTeva bijektivnost in strinjanje
//     z vrstnim redom oznak, ki jih je VLM prebral na lestvici (AMW, OKW, ROAK,
//     RWA od leve proti desni) — dvakratni dokaz, ne ugibanje;
//  6. zapis 4 PNG-jev v public/assets/roksal/src/ + poročilo ops/r523-cipi.json.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..')
const SRC = join(REPO, 'public/assets/roksal/src')
const LESTVICA = join(SRC, 'roksal-barvna-lestvica-kubo-full.png')

// VLM je na lestvici prebral oznake od leve proti desni (dokaz: ops/r523
// raziskovalni dnevnik) — to je PRIČAKOVANI vrstni red za trditev 5.
const PRICAKOVANI_RED = ['AMW', 'OKW', 'ROAK', 'RWA']
const ODTENKI = {
  AMW: { ime: 'Amazon wood', hex: '#5e5e61' },
  OKW: { ime: 'Oak wood', hex: '#b0917c' },
  ROAK: { ime: 'Rustic oak', hex: '#9c8061' },
  RWA: { ime: 'Rustic walnut', hex: '#71675c' },
}

const hexRgb = (h) => ({
  r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16),
})
const hexLum = (h) => { const { r, g, b } = hexRgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b }

const img = await loadImage(LESTVICA)
const W = img.width, H = img.height
console.log(`[lestvica] ${W}×${H}`)
const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.drawImage(img, 0, 0)
const D = ctx.getImageData(0, 0, W, H).data

// material = NEPROSOJEN piksel (alpha > 200): čipi + besedilo. Ozadje lestvice
// je prosojno (alpha=0), zato pokritost po stolpcih čiste loči čipe (~340 px)
// od naslovnih vrstic (~80 px). AMW čip je namreč skoraj siv (Amazon wood
// #5e5e61) — prag barvnosti bi ga napačno izločil.
const jeMaterial = (i) => D[i + 3] > 200

// ── 1. detekcija čipov: pokritost po stolpcih ────────────────────────────────
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
console.log(`[detekcija] grozdov ≥ ${pragStolpec}px pokritosti: ${grozdi.length} (širine: ${grozdi.map(g => g.x1 - g.x0).join(', ')})`)
if (grozdi.length !== 4) throw new Error(`pričakovanih 4 čipi, najdenih ${grozdi.length} — preveri lestvico`)

// ── 2. sredica + premer vsakega čipa ────────────────────────────────────────
const cipi = grozdi.map((g, idx) => {
  // stolpec z največjo pokritostjo znotraj grozda = najbližje sredici kroga
  let xPeak = g.x0
  for (let x = g.x0; x < g.x1; x++) if (pokritost[x] > pokritost[xPeak]) xPeak = x
  // pri xPeak išči ZAPOREDNE teke — najdaljši tek je vertikalna tetiva kroga
  // (oznaka nad čipom in disclaimer pod njim sta od njega ločena s prosojnimi
  // vrzeli, zato ne moreta povleči razpetine)
  let tekZacetek = -1, najTek = { od: -1, dol: 0 }, tekDol = 0
  for (let y = 0; y <= H; y++) {
    const material = y < H && jeMaterial((y * W + xPeak) * 4)
    if (material) { if (tekZacetek < 0) tekZacetek = y; tekDol++ }
    if (!material && tekZacetek >= 0) {
      if (tekDol > najTek.dol) najTek = { od: tekZacetek, dol: tekDol }
      tekZacetek = -1; tekDol = 0
    }
  }
  if (najTek.dol < 200) throw new Error(`čip ${idx + 1}: najdaljši zaporedni tek le ${najTek.dol}px — ni kroga`)
  return {
    idx, x0: g.x0, x1: g.x1, xPeak,
    y0: najTek.od, y1: najTek.od + najTek.dol - 1,
    xc: xPeak, yc: Math.round((najTek.od * 2 + najTek.dol - 1) / 2),
    premer: najTek.dol,
  }
})

// ── 3. izrez največjega kvadrata, ki je CELOTA znotraj čipa ──────────────────
// Fiksni rob (npr. 0,62·r) je pri dveh čipih sekal krožno mejo (sredica iz
// pokritosti ni popolnoma točna) → prilagodljivo krčenje od 0,70·r navzdol,
// dokler izrez nima NIČ prosojnih pikslov. Deterministično in največje možno.
const ROB_ZAC = 0.70, ROB_MIN = 0.42
const izmeriAnizotropijo = (siv, w, h) => {
  let gx = 0, gy = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (x + 1 < w) gx += Math.abs(siv[i + 1] - siv[i])
    if (y + 1 < h) gy += Math.abs(siv[i + w] - siv[i])
  }
  return { gx, gy, razmerje: gy / Math.max(1, gx) }
}

const izrezi = cipi.map(c => {
  const r = c.premer / 2
  let pol = 0, x0 = 0, y0 = 0, d = null
  for (let s = Math.floor(r * ROB_ZAC); s >= Math.floor(r * ROB_MIN); s--) {
    const xs = c.xc - s, ys = c.yc - s, w = s * 2, h = s * 2
    if (xs < 0 || ys < 0 || xs + w > W || ys + h > H) continue
    let prosojnih = 0
    for (let y = ys; y < ys + h && prosojnih === 0; y++) {
      for (let x = xs; x < xs + w; x++) {
        if (D[(y * W + x) * 4 + 3] < 255) { prosojnih++; break }
      }
    }
    if (prosojnih === 0) { pol = s; x0 = xs; y0 = ys; break }
  }
  if (pol === 0) throw new Error(`čip ${c.idx + 1}: celoten izrez sega ven iz čipa — preveri sredico`)
  const w = pol * 2, h = pol * 2
  const cvC = createCanvas(w, h)
  const cCtx = cvC.getContext('2d')
  cCtx.drawImage(img, x0, y0, w, h, 0, 0, w, h)
  d = cCtx.getImageData(0, 0, w, h).data
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

// ── 4. referenčna smer vlaken iz RESNIČNE KUBO fasade (b6cd) ───────────────
// isti izrez, kot ga dela aplikacija (izmeriIzrezNavpicnePalice iz jedra)
const TEKS = await import(join(REPO, 'src/lib/photo-replace-texture.ts'))
const imgRef = await loadImage(join(SRC, 'b6cd18418118.jpg'))
const cvRef = createCanvas(imgRef.width, imgRef.height)
const rCtx = cvRef.getContext('2d')
rCtx.drawImage(imgRef, 0, 0)
const izrezRef = TEKS.izmeriIzrezNavpicnePalice((x, y) => {
  const d = rCtx.getImageData(Math.round(x), Math.round(y), 1, 1).data
  return (d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114) / 255
}, imgRef.width, imgRef.height)
if (!izrezRef) throw new Error('referenčni izrez b6cd ni uspel — ne morem izmeriti smeri vlaken')
const wR = izrezRef.w, hR = izrezRef.h
const dRef = rCtx.getImageData(izrezRef.x, 0, wR, hR).data
const sivRef = new Float32Array(wR * hR)
for (let i = 0; i < wR * hR; i++) {
  const j = i * 4
  sivRef[i] = 0.2126 * dRef[j] + 0.7152 * dRef[j + 1] + 0.0722 * dRef[j + 2]
}
const anizRef = izmeriAnizotropijo(sivRef, wR, hR)
console.log(`[referenca] b6cd deska ${wR}×${hR}px — vlakna: |dI/dy|/|dI/dx| = ${anizRef.razmerje.toFixed(2)} (${anizRef.razmerje > 1 ? 'NAKALO navpično' : 'vodoravno'})`)

// ── 5. barvno ujemanje + dodelitev SKU (bijektivno, dvakratni dokaz) ────────
const kandidati = PRICAKOVANI_RED.map(k => ({ koda: k, ...ODTENKI[k], rgb: hexRgb(ODTENKI[k].hex) }))
const dodelitve = []
const proste = new Set(kandidati.map(k => k.koda))
for (const iz of izrezi) {
  let najboljsa = null, najD = Infinity
  for (const k of kandidati) {
    if (!proste.has(k.koda)) continue
    const dR = iz.avg.r - k.rgb.r, dG = iz.avg.g - k.rgb.g, dB = iz.avg.b - k.rgb.b
    const d = Math.sqrt(dR * dR + dG * dG + dB * dB)
    if (d < najD) { najD = d; najboljsa = k }
  }
  if (!najboljsa) throw new Error('bijektivna dodelitev ni uspela')
  proste.delete(najboljsa.koda)
  dodelitve.push({ iz, sku: najboljsa, razdalja: najD })
}
// trditev: barvna bližina se STRINJA z vrstnim redom oznak od leve proti desni
dodelitve.forEach((d, i) => {
  if (d.sku.koda !== PRICAKOVANI_RED[i]) {
    throw new Error(`čip ${i + 1}: barvna bližina=${d.sku.koda}, oznaka na sliki=${PRICAKOVANI_RED[i]} — NE SOGRAJAJO`)
  }
})
console.log('[ujemanje] barvna bližina se strinja z oznakami na lestvici (dvakratni dokaz) ✓')
dodelitve.forEach((d, i) => {
  console.log(`  čip ${i + 1}: avg rgb(${d.iz.avg.r.toFixed(0)},${d.iz.avg.g.toFixed(0)},${d.iz.avg.b.toFixed(0)}) → ${d.sku.ime} (${d.sku.hex}), razdalja ${d.razdalja.toFixed(1)} · vlakna |dI/dy|/|dI/dx|=${d.iz.razmerje.toFixed(2)}`)
})

// ── 6. rotacija (če so vlakna čipa vodoravna, referenca pa navpična) in zapis
const porocilo = { lestvica: { W, H }, robOd: ROB_ZAC, anizotropijaReference: anizRef.razmerje, cipi: [] }
for (const d of dodelitve) {
  const { iz, sku } = d
  const vodoravnaVl = iz.razmerje > 1.15
  const rotiraj = vodoravnaVl && anizRef.razmerje <= 1
  // rotacija za 90°: vlakna postanejo navpična (tečejo vzdolž letvice KUBO)
  let out = iz.platno
  if (rotiraj) {
    out = createCanvas(iz.h, iz.w)
    const o = out.getContext('2d')
    o.translate(iz.h / 2, iz.w / 2)
    o.rotate(Math.PI / 2)
    o.drawImage(iz.platno, -iz.w / 2, -iz.h / 2)
  }
  const file = `roksal-kubo-cip-${sku.koda.toLowerCase()}.png`
  writeFileSync(join(SRC, file), out.toBuffer('image/png'))
  porocilo.cipi.push({
    sku: `ROK-FAS-KUBO-${sku.koda}`, odtenek: sku.ime, hex: sku.hex, file,
    izrez: { x: iz.x0, y: iz.y0, w: iz.w, h: iz.h }, premerCipa: iz.cip.premer, rob: +iz.rob.toFixed(3),
    avgRgb: { r: +iz.avg.r.toFixed(1), g: +iz.avg.g.toFixed(1), b: +iz.avg.b.toFixed(1) },
    barvnaRazdalja: +d.razdalja.toFixed(1),
    anizotropija: +iz.razmerje.toFixed(3),
    rotirano: rotiraj,
  })
  console.log(`[zapis] ${file} — izrez ${iz.w}×${iz.h}${rotiraj ? ' · ROTIRANO 90° (vlakna → navpično)' : ''}`)
}
writeFileSync(join(REPO, 'ops/r523-cipi.json'), JSON.stringify(porocilo, null, 2))
console.log(`[zapis] ops/r523-cipi.json — revizijsko poročilo (izrezi, barve, rotacije)`)

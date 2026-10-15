// ops/r524-analiza-lestvic.mjs — R524 (issue #14): DIAGNOSTIKA uradnih barvnih
// lestvic za ograje — ali vsebujejo FOTOGRAFSKE čipe površine (kot KUBO) ali
// zgolj ploske barvne kroge?
//
// NEIZDAJALNO diagnostično orodje (ne dela aplikacije, nič ne zapisuje).
// Enaka detekcija grozdov po neprosojnosti kot ops/r523-cipi.mjs (dokazana na
// KUBO), tokrat nad VSEMI lestvicami. Za vsak najdeni grozd izmeri:
//   - premer (najdaljši zaporedni tek pokritosti pri vrhuncu),
//   - barvno dispersijo (stddev kanalov na izrezu 0,62·r) — fotografsko
//     zrno ima veliko dispersijo, ploska barva majhno;
//   - gradientno anizotropijo |dI/dx| vs |dI/dy| (smer vlaken);
//   - povprečno RGB → primerjava z ODTENKI_HEX iz photo-replace-core.
// Referenca: KUBO čipi (fotografski) imajo stddev ~15–30, ploski krog bi imel
// <3. Iz tega poročila se odloči, katere lestvice so vir DETAJL čipov — brez
// ugibanja.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..')
const SRC = join(REPO, 'public/assets/roksal/src')

const LESTVICE = [
  'roksal-barvna-lestvica-kubo-full.png',   // referenca: 4 FOTOGRAFSKA čipa (R523)
  'roksal-barvna-lestvica-polna-57.png',     // namenska 57/32 (3 čipi po R523)
  'roksal-barvna-lestvica-polna-128.png',
  'roksal-barvna-lestvica-polna-100.png',
  'roksal-barvna-lestvica-romb-67.png',
  'roksal-barvna-lestvica-terasa-150.png',
  'roksal-barvna-lestvica-kubo.png',         // 1024 px sličica (referenca ločljivosti)
]

const ODTENKI = {
  AMW: { ime: 'Amazon wood', hex: '#5e5e61' },
  OKW: { ime: 'Oak wood', hex: '#b0917c' },
  ROAK: { ime: 'Rustic oak', hex: '#9c8061' },
  RWA: { ime: 'Rustic walnut', hex: '#71675c' },
  GRA: { ime: 'Siva (RAL 7016)', hex: '#383e42' },
 BELA: { ime: 'Bela', hex: '#e8e8e6' },
  ANTR: { ime: 'Antracit', hex: '#2f3336' },
}
const hexRgb = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) })
const dist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)

console.log('═'.repeat(100))
for (const f of LESTVICE) {
  const img = await loadImage(join(SRC, f))
  const W = img.width, H = img.height
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const D = ctx.getImageData(0, 0, W, H).data
  const jeMaterial = (i) => D[i + 3] > 200

  // detekcija grozdov po stolpcih (ista metoda kot r523-cipi.mjs)
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

  console.log(`\n▌ ${f}  (${W}×${H})`)
  console.log(`  grozdov ≥ ${pragStolpec}px pokritosti: ${grozdi.length} (širine: ${grozdi.map(g => g.x1 - g.x0).join(', ')})`)

  for (const [gi, g] of grozdi.entries()) {
    // vertikalna razpetina v grozdu → sredica + premer
    let y0 = H, y1 = 0
    for (let x = g.x0; x < g.x1; x++)
      for (let y = 0; y < H; y++)
        if (jeMaterial((y * W + x) * 4)) { if (y < y0) y0 = y; if (y > y1) y1 = y }
    const cy = (y0 + y1) / 2
    const premer = y1 - y0
    // izrez vpisanega kvadrata 0,62·r (stran od roba in sence — r523 standard)
    const r = premer / 2
    const stran = Math.round(0.62 * r * 2)
    const sx = Math.round((g.x0 + g.x1) / 2 - stran / 2)
    const sy = Math.round(cy - stran / 2)
    if (stran < 8 || sx < 0 || sy < 0 || sx + stran > W || sy + stran > H) {
      console.log(`    čip ${gi + 1}: premer ${premer}px — izrez izven meja (preskočen)`)
      continue
    }
    const d = ctx.getImageData(sx, sy, stran, stran).data
    let sr = 0, sg = 0, sb = 0, n = 0
    const vr = [], vg = [], vb = []
    for (let i = 0; i < d.length; i += 4) { vr.push(d[i]); vg.push(d[i + 1]); vb.push(d[i + 2]); sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++ }
    const avg = { r: sr / n, g: sg / n, b: sb / n }
    const std = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length) }
    const sR = std(vr), sG = std(vg), sB = std(vb)
    // gradientna anizotropija (smer vlaken)
    let gx = 0, gy = 0
    for (let y = 1; y < stran - 1; y++)
      for (let x = 1; x < stran - 1; x++) {
        const i = (y * stran + x) * 4
        gx += Math.abs(d[i + 4] - d[i - 4]); gy += Math.abs(d[i + stran * 4] - d[i - stran * 4])
      }
    const anizo = gx < 1 ? 999 : +(gy / gx).toFixed(2)
    // najbližji odtenek
    let najK = '?', najD = 1e9
    for (const [k, o] of Object.entries(ODTENKI)) { const dd = dist(avg, hexRgb(o.hex)); if (dd < najD) { najD = dd; najK = k } }
    console.log(`    čip ${gi + 1}: premer ${premer}px, izrez ${stran}×${stran}, avg(${Math.round(avg.r)},${Math.round(avg.g)},${Math.round(avg.b)}) → ${ODTENKI[najK].ime} (d=${Math.round(najD)}), σ(R,G,B)=(${sR.toFixed(1)},${sG.toFixed(1)},${sB.toFixed(1)}), |dy/dx|=${anizo}`)
  }
}
console.log('\n' + '═'.repeat(100))
console.log('Referenca: KUBO čipi (fotografski) σ ≈ 15–30, anizotropija 1,8–3,2 (vodoravna vlakna).')
console.log('Ploski barvni krog bi imel σ < 3 in anizotropijo ≈ 1 (naključni šum).')

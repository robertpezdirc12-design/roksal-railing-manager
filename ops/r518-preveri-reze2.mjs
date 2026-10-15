// ops/r518-preveri-reze2.mjs — R518: NATANČNA preverba rež SAMO znotraj kvadrata
// ograje (fixture hotel-bazen, primeri A in C). NEIZDAJALNO dokazno orodje.
// Metoda: na POTEM sliki znotraj označenega kvadrata (0.78–1.0 širine) vzamemo
// navpične črtice na 3 x-pozicijah; prag je FIKSEN (Otsu nad vzorci črtice),
// štejemo pasove deska/reža → pričakovano število desk izračunamo iz
// konfiguracije (višina ograje / (deska+reza)) in primerjamo.
import { createCanvas, loadImage } from '@napi-rs/canvas'

const REPO = import.meta.dir + '/..'
const QUAD = { x0: 0.78, x1: 1.0, y0: 0.585, y1: 0.875 } // fixture hotel-bazen

const PRIMERI = [
  { id: 'A', file: 'r518-A-potem.png', deskaMm: 128, rezaMm: 18, visinaCm: 74 },
  { id: 'C', file: 'r518-C-potem.png', deskaMm: 150, rezaMm: 30, visinaCm: 74 },
]

// Otsu prag nad danim histogramom
function otsu (v) {
  const min = Math.min(...v), max = Math.max(...v)
  const B = 64
  const hist = new Array(B).fill(0)
  for (const x of v) hist[Math.min(B - 1, Math.floor(((x - min) / (max - min + 1e-9)) * B))]++
  const n = v.length
  let sum = 0; for (let i = 0; i < B; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, prag = 0
  for (let i = 0; i < B; i++) {
    wB += hist[i]; if (wB === 0) continue
    const wF = n - wB; if (wF === 0) break
    sumB += i * hist[i]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const med = wB * wF * (mB - mF) ** 2
    if (med > best) { best = med; prag = min + ((i + 1) / B) * (max - min) }
  }
  return prag
}

for (const P of PRIMERI) {
  const img = await loadImage(`${REPO}/ops/${P.file}`)
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const W = img.width, H = img.height

  const xs = [0.82, 0.88, 0.94].map((f) => Math.round(f * W))
  const yTop = Math.round(0.60 * H), yBot = Math.round(0.86 * H) // znotraj kvadrata, stran od robov
  const skupnoTemnih = []
  for (const x of xs) {
    const svet = []
    for (let y = yTop; y < yBot; y++) {
      const d = ctx.getImageData(x, y, 1, 1).data
      svet.push(0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2])
    }
    const prag = otsu(svet)
    const znak = svet.map((v) => v < prag)
    let start = 0
    for (let i = 1; i <= znak.length; i++) {
      if (i === znak.length || znak[i] !== znak[start]) {
        if (znak[start] && i - start >= 2) skupnoTemnih.push(i - start)
        start = i
      }
    }
  }
  // obnavljaj: število rež v višini ograje na sliki
  const visinaPx = yBot - yTop
  const korakMm = P.deskaMm + P.rezaMm
  const pričakovaneReze = Math.max(1, Math.round((P.visinaCm * 10 * (visinaPx / (P.visinaCm * 10))) / korakMm) - 1)
  const debljinaRezePx = skupnoTemnih.length ? Math.round(skupnoTemnih.reduce((s, x) => s + x, 0) / skupnoTemnih.length) : 0
  const debljinaDeskePx = Math.round(visinaPx / (P.visinaCm * 10) * P.deskaMm)
  console.log(`[${P.id}] ${W}×${H} · najdenih rež (3 črtice): ${skupnoTemnih.length} (⌀ ${debljinaRezePx} px) · pričakovanih ≈ ${pričakovaneReze} × 3 = ${pričakovaneReze * 3} · ⌀ deska na sliki ≈ ${debljinaDeskePx} px · reza/deska = ${(debljinaRezePx / debljinaDeskePx).toFixed(2)} (pričakovano ${(P.rezaMm / P.deskaMm).toFixed(2)})`)
}

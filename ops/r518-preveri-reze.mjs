// ops/r518-preveri-reze.mjs — R518: PROGRAMSKA preverba rež v zoom izrezih.
// NEIZDAJALNA KODA (dokazno orodje): na dani višinski črti zoom izreza prešteje
// prehode svetla↔temna (lamela↔reža) in izmeri razmerje širine reže/lamele.
// Pričakovano: A (POLNA-128, reza 18/128 ≈ 0.14), B (POLNA-57, reza 20/57 ≈ 0.35),
// C (DESKA-150, reza 30/150 = 0.20), D (POLNA-100, reza 18/100 ≈ 0.18).
import { createCanvas, loadImage } from '@napi-rs/canvas'

const REPO = import.meta.dir + '/..'

const ZOOMI = [
  { id: 'A', file: 'r518-A-zoom.png', y: 0.5 },   // vodoravne deske → preverimo NAVPIČNO črto
  { id: 'B', file: 'r518-B-zoom.png', y: 0.35 },
  { id: 'C', file: 'r518-C-zoom.png', y: 0.5 },
  { id: 'D', file: 'r518-D-zoom.png', y: 0.5 },
]

for (const Z of ZOOMI) {
  const img = await loadImage(`${REPO}/ops/${Z.file}`)
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const w = img.width, h = img.height

  // A/C: vodoravne deske → črtica gre NAVPIČNO (skanjemo y), iščemo pasove.
  // B/D: navpične lamele → črtica gre VODORAVNO (skanjemo x).
  const navpicno = Z.id === 'A' || Z.id === 'C'
  const N = navpicno ? h : w
  const samples = []
  for (let k = 0; k < 3; k++) {
    const off = Math.round((Z.y + (k - 1) * 0.08) * (navpicno ? w : h))
    const svetlost = []
    for (let i = 0; i < N; i++) {
      const d = navpicno
        ? ctx.getImageData(off, i, 1, 1).data
        : ctx.getImageData(i, off, 1, 1).data
      svetlost.push(0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2])
    }
    samples.push(svetlost)
  }
  // združimo: povprečje treh črtic (zmanjša šum teksture)
  const avg = Array.from({ length: N }, (_, i) => samples.reduce((s, x) => s + x[i], 0) / 3)
  // lokalna mediana za prag: srednja vrednost vzorca
  const sorted = [...avg].sort((a, b) => a - b)
  const med = sorted[Math.floor(N / 2)]
  // prehodi: štejemo pole (zaporedne istega predznaka), izpustimo krajše od 3 px
  const znak = avg.map((v) => v < med * 0.82) // temno = reža/senca
  const pole = []
  let start = 0
  for (let i = 1; i <= N; i++) {
    if (i === N || znak[i] !== znak[start]) {
      if (i - start >= 3) pole.push({ temno: znak[start], len: i - start })
      start = i
    }
  }
  const temne = pole.filter((p) => p.temno).map((p) => p.len)
  const svetle = pole.filter((p) => !p.temno).map((p) => p.len)
  const pov = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0)
  console.log(`[zoom ${Z.id}] ${w}×${h} · pasov temnih ${temne.length} (⌀ ${pov(temne)} px) · svetlih ${svetle.length} (⌀ ${pov(svetle)} px)` +
    (temne.length && svetle.length
      ? ` · razmerje reza/panel ${(pov(temne) / (pov(temne) + pov(svetle))).toFixed(2)}`
      : ''))
}

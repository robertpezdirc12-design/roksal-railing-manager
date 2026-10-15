// R518: programski merjenje razmikov desk na Roksalovih fotografijah —
// vertikalni prerez skozi ograjo, šteje prehode (les ↔ ozadje) po svetlosti.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { join } from 'node:path'

async function izmeri (datoteka, xDelez, y0, y1, prag = 0.55) {
  const img = await loadImage(join(process.cwd(), 'public/assets/roksal/src', datoteka))
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const x = Math.round(img.width * xDelez)
  const A = Math.round(img.height * y0), B = Math.round(img.height * y1)
  const pas = []
  for (let y = A; y < B; y++) {
    const d = ctx.getImageData(x, y, 1, 1).data
    pas.push((d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114) / 255)
  }
  // gladilo (mediana 5)
  const g = pas.map((_, i) => {
    const okno = pas.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b)
    return okno[Math.floor(okno.length / 2)]
  })
  const sred = g.reduce((a, b) => a + b, 0) / g.length
  const vecji = g.map((v) => v > sred * prag + (1 - prag) * sred) // prag relativno na sredino
  // prehodi → odseki (debelina lesa vs reže)
  const odseki = []
  let tek = vecji[0], dol = 1
  for (let i = 1; i < vecji.length; i++) {
    if (vecji[i] === tek) dol++
    else { odseki.push({ tek, dol }); tek = vecji[i]; dol = 1 }
  }
  odseki.push({ tek, dol })
  // združi kratke odseke (< 3 px) — šum
  const cisti = []
  for (const o of odseki) {
    if (o.dol < 3 && cisti.length) { cisti[cisti.length - 1].dol += o.dol }
    else cisti.push({ ...o })
  }
  const les = cisti.filter((o) => o.tek).map((o) => o.dol)
  const reze = cisti.filter((o) => !o.tek).map((o) => o.dol)
  const skupaj = B - A
  console.log(`${datoteka} @x=${xDelez} y∈[${y0},${y1}] (${skupaj}px):`)
  console.log(`  odseki les: ${les.join(', ')} (n=${les.length}, mediana=${les.sort((a,b)=>a-b)[Math.floor(les.length/2)] ?? '—'} px)`)
  console.log(`  odseki reže: ${reze.join(', ')} (n=${reze.length})`)
  const mLes = les.reduce((a, b) => a + b, 0) / Math.max(1, les.length)
  const mReza = reze.length ? reze.reduce((a, b) => a + b, 0) / reze.length : 0
  console.log(`  POVP: les ${mLes.toFixed(1)} px · reža ${mReza.toFixed(1)} px · razmerje reža/les ${(mReza / Math.max(1, mLes)).toFixed(2)}`)
  console.log(`  če je deska 150 mm → reža ≈ ${(150 * mReza / Math.max(1, mLes)).toFixed(0)} mm; desk na 1 m višine ≈ ${(1000 / (mLes + mReza)).toFixed(1)} (px/m merilo približno)`)
  console.log()
}
await izmeri('r495-1g244-jt-scaled.jpg', 0.30, 0.55, 0.92)   // DESKA 150 GLT balkon
await izmeri('r495-precnapokoncna-ograja-burma.jpg', 0.35, 0.30, 0.75) // DESKA 150 BUT
await izmeri('r495-pokoncna-ograjam-burma128-2.jpg', 0.50, 0.25, 0.85) // POLNA 128 BUT pokončna
await izmeri('r495-Domzale-4-scaled.jpg', 0.50, 0.30, 0.80)            // POLNA 100 WHT
await izmeri('r495-deske-za-ograje-wpc-pokoncna_384.jpg', 0.50, 0.30, 0.80) // POLNA 57 AMW
await izmeri('r495-Polna-deska-57-32_salon1_NOVO.jpg', 0.50, 0.35, 0.80)    // POLNA 57 OKW salon

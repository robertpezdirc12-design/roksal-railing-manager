// R520: izmera razmikov na ROKSALOVIH namestitvenih fotografijah — dvojni dokaz
// uradnim podatkom roksal.com (terasa: »Med deskami je razmak 5-6mm«; KUBO
// fasada: »razmak med letvicami je poljuben«, profil 80×42×5800, SAMO navpično).
//
// Regije desk je določil VLM (glm-4.5v) nad istimi VERIFIED datotekami
// (0573714678e7 terasa x∈[0,0.77] y∈[0.77,1]; b6cd18418118 x∈[0.14,0.60]
// y∈[0.06,0.72]; 3a7bccebb297 x∈[0.02,0.43] y∈[0.23,0.97]).
// Metoda = R518 (ops/r518-izmeri.mjs): svetlostni prerez → gladilo → prehodi;
// razširitev: ROBUSTNA mediana — reža šteje samo, če je ožja od 40 % mediane
// deske (odseki čez to so vrata/ozadje/sonce, ne reža).
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { join } from 'node:path'

const REPO = process.cwd()

async function nalozi (datoteka) {
  const img = await loadImage(join(REPO, 'public/assets/roksal/src', datoteka))
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return { ctx, W: img.width, H: img.height }
}

const svetlost = (ctx, x, y) => {
  const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
  return (d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114) / 255
}

/** VEČ prerezov skozi regijo (stolpci za vodoravne deske, vrstice za navpične)
 * — združeni razponi; vrača { deskaPx, rezaPx, nDesk, nRez, razmerje }. */
async function izmeriRegijo (datoteka, reg, smer, prag = 0.55) {
  const { ctx, W, H } = await nalozi(datoteka)
  const vseDeske = [], vseReze = []
  const korakov = 9
  for (let k = 0; k < korakov; k++) {
    const t = (k + 0.5) / korakov
    let pas = []
    if (smer === 'stolpec') {
      const x = (reg.x0 + t * (reg.x1 - reg.x0)) * W
      for (let y = reg.y0 * H; y < reg.y1 * H; y++) pas.push(svetlost(ctx, x, y))
    } else {
      const y = (reg.y0 + t * (reg.y1 - reg.y0)) * H
      for (let x = reg.x0 * W; x < reg.x1 * W; x++) pas.push(svetlost(ctx, x, y))
    }
    // gladilo (mediana 5)
    const g = pas.map((_, i) => {
      const okno = pas.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b)
      return okno[Math.floor(okno.length / 2)]
    })
    const sred = g.reduce((a, b) => a + b, 0) / g.length
    const svetlo = g.map((v) => v > sred * prag + (1 - prag) * sred * 0.6 + 0.04)
    const odseki = []
    let tek = svetlo[0], dol = 1
    for (let i = 1; i < svetlo.length; i++) {
      if (svetlo[i] === tek) dol++
      else { odseki.push({ tek, dol }); tek = svetlo[i]; dol = 1 }
    }
    odseki.push({ tek, dol })
    for (const o of odseki) {
      if (o.tek && o.dol >= 8) vseDeske.push(o.dol)
      if (!o.tek && o.dol >= 2) vseReze.push(o.dol)
    }
  }
  if (vseDeske.length < 4) return null
  const sortiraneD = [...vseDeske].sort((a, b) => a - b)
  const medianaD = sortiraneD[Math.floor(sortiraneD.length / 2)]
  // ROBUSTNO: reža sme biti največ 40 % mediane deske (drugače je to presek
  // z oknom/ozadjem — ne šteje)
  const praveReze = vseReze.filter((r) => r <= medianaD * 0.4)
  if (praveReze.length < 3) return null
  const mReza = praveReze.reduce((a, b) => a + b, 0) / praveReze.length
  console.log(`${datoteka} [${smer}] regija x∈[${reg.x0},${reg.x1}] y∈[${reg.y0},${reg.y1}]:`)
  console.log(`  deske n=${vseDeske.length} mediana=${medianaD}px · reže (≤40 % deske) n=${praveReze.length}/${vseReze.length} povp=${mReza.toFixed(1)}px`)
  return { medianaD, mReza, razmerje: mReza / medianaD, nDesk: vseDeske.length, nRez: praveReze.length }
}

console.log('═══ TERASA (0573714678e7 — deske vzdolžno, prerezi po stolpcih) ═══')
const ter1 = await izmeriRegijo('0573714678e7.jpg', { x0: 0.02, x1: 0.60, y0: 0.80, y1: 0.98 }, 'stolpec')
const ter2 = await izmeriRegijo('0573714678e7.jpg', { x0: 0.62, x1: 0.75, y0: 0.78, y1: 0.97 }, 'stolpec')

console.log('\n═══ KUBO FASADA (navpične deske — prerezi po vrsticah) ═══')
const kub1 = await izmeriRegijo('b6cd18418118.jpg', { x0: 0.16, x1: 0.58, y0: 0.10, y1: 0.70 }, 'vrstica')
const kub2 = await izmeriRegijo('3a7bccebb297.jpg', { x0: 0.05, x1: 0.40, y0: 0.30, y1: 0.95 }, 'vrstica')

console.log('\n═══ IZID (razmerje reža/deska × uradna širina deske) ═══')
for (const [ime, iz, sirinaMm, uradno] of [
  ['terasa 0573714678e7 (levi del)', ter1, 150, '5–6 mm (uradni FAQ roksal.com)'],
  ['terasa 0573714678e7 (desni del)', ter2, 150, '5–6 mm (uradni FAQ roksal.com)'],
  ['kubo-fasada b6cd18418118', kub1, 80, 'poljuben (uradno: »razmak med letvicami je poljuben«)'],
  ['kubo-fasada 3a7bccebb297', kub2, 80, 'poljuben (uradno)'],
]) {
  if (!iz) { console.log(`${ime}: ni zanesljive izmere`); continue }
  console.log(`${ime}: razmerje ${iz.razmerje.toFixed(3)} × ${sirinaMm} mm = ≈ ${(iz.razmerje * sirinaMm).toFixed(1)} mm | uradno: ${uradno}`)
}

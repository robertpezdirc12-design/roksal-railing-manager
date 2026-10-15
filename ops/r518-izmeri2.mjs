// R518: vodoravni prerez skozi POKONČNE ograje — šteje pokončne deske po širini
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { join } from 'node:path'

async function izmeriH (datoteka, yDelez, x0, x1) {
  const img = await loadImage(join(process.cwd(), 'public/assets/roksal/src', datoteka))
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const y = Math.round(img.height * yDelez)
  const A = Math.round(img.width * x0), B = Math.round(img.width * x1)
  const pas = []
  for (let x = A; x < B; x++) {
    const d = ctx.getImageData(x, y, 1, 1).data
    pas.push((d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114) / 255)
  }
  const g = pas.map((_, i) => {
    const okno = pas.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b)
    return okno[Math.floor(okno.length / 2)]
  })
  const sred = g.reduce((a, b) => a + b, 0) / g.length
  const jeLes = g.map((v) => v > sred) // les je svetlejši od ozadja (ali obratno — od slike)
  const odseki = []
  let tek = jeLes[0], dol = 1
  for (let i = 1; i < jeLes.length; i++) {
    if (jeLes[i] === tek) dol++
    else { odseki.push({ tek, dol }); tek = jeLes[i]; dol = 1 }
  }
  odseki.push({ tek, dol })
  const cisti = []
  for (const o of odseki) {
    if (o.dol < 4 && cisti.length) cisti[cisti.length - 1].dol += o.dol
    else cisti.push({ ...o })
  }
  // dve možnosti: les = svetli ali temni — izberi tisto z VEČ odseki (deske so mnogo)
  const svetli = cisti.filter((o) => o.tek), temni = cisti.filter((o) => !o.tek)
  const [lesN, rezN] = svetli.length >= temni.length ? [svetli, temni] : [temni, svetli]
  const mL = lesN.reduce((a, b) => a + b.dol, 0) / Math.max(1, lesN.length)
  const mR = rezN.length ? rezN.reduce((a, b) => a + b.dol, 0) / rezN.length : 0
  console.log(`${datoteka} @y=${yDelez} x∈[${x0},${x1}]:`)
  console.log(`  desk (odsekov): ${lesN.length} · rež: ${rezN.length}`)
  console.log(`  POVP širina deske ${mL.toFixed(0)} px · reža ${mR.toFixed(0)} px · razmerje reža/deska ${(mR / Math.max(1, mL)).toFixed(2)}`)
  console.log()
}
await izmeriH('r495-pokoncna-ograjam-burma128-2.jpg', 0.55, 0.15, 0.85)
await izmeriH('r495-Domzale-4-scaled.jpg', 0.55, 0.15, 0.85)
await izmeriH('r495-deske-za-ograje-wpc-pokoncna_384.jpg', 0.55, 0.10, 0.90)

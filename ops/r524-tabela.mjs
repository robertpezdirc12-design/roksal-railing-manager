// ops/r524-tabela.mjs — R524: dokazna tabela vseh 24 čipov v eni sliki
// (NEIZDAJALNO dokazno orodje — NE dela aplikacije).
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..')
const SRC = join(REPO, 'public/assets/roksal/src')

const SKUPINE = [
  { naslov: 'ROK-OGP-POLNA-57 (3)', predpona: 'roksal-polna57-cip', kode: ['amw', 'okw', 'rwa'] },
  { naslov: 'ROK-OG-POLNA-128 (6)', predpona: 'roksal-polna128-cip', kode: ['amw', 'ash', 'but', 'okw', 'roak', 'rwa'] },
  { naslov: 'ROK-OGP-POLNA-100 (8)', predpona: 'roksal-polna100-cip', kode: ['amw', 'ash', 'glt', 'but', 'okw', 'wht', 'roak', 'rwa'] },
  { naslov: 'ROK-OG-ROMB-67 (7)', predpona: 'roksal-romb67-cip', kode: ['amw', 'ash', 'glt', 'but', 'okw', 'roak', 'rwa'] },
]

const VEL = 150, BL = 14, GLAVA = 46, ROB = 18
const vrstice = SKUPINE.reduce((a, s) => a + 1 + Math.ceil(s.kode.length / 8), 0)
const W = ROB * 2 + 8 * VEL + 7 * BL
const H = ROB * 2 + GLAVA * SKUPINE.length + vrstice * (VEL + BL) + 30
const cv = createCanvas(W, H)
const ctx = cv.getContext('2d')
ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
ctx.fillStyle = '#111827'; ctx.font = 'bold 21px sans-serif'
let y = ROB
for (const s of SKUPINE) {
  ctx.fillText(s.naslov, ROB, y + 16); y += GLAVA
  for (let i = 0; i < s.kode.length; i++) {
    const img = await loadImage(join(SRC, `${s.predpona}-${s.kode[i]}.png`))
    const x = ROB + (i % 8) * (VEL + BL)
    const yy = y + Math.floor(i / 8) * (VEL + BL)
    ctx.fillStyle = '#f3f4f6'; ctx.fillRect(x - 2, yy - 2, VEL + 4, VEL + 4)
    const k = Math.min(VEL / img.width, VEL / img.height)
    ctx.drawImage(img, x + (VEL - img.width * k) / 2, yy + (VEL - img.height * k) / 2, img.width * k, img.height * k)
    ctx.fillStyle = '#6b7280'; ctx.font = '12px sans-serif'
    ctx.fillText(s.kode[i].toUpperCase(), x, yy + VEL + 12)
  }
  y += Math.ceil(s.kode.length / 8) * (VEL + BL) + 12
}
writeFileSync(join(REPO, 'ops/r524-tabela-cipov.png'), cv.toBuffer('image/png'))
console.log(`[zapis] ops/r524-tabela-cipov.png (${W}×${H})`)

// ops/r524-render.mjs — R524 (issue #14): DOKAZNI IZRISI čipov površine OGRAJ.
//
// NEIZDAJALNA KODA (orodje za dokaz, ne del aplikacije): zrcali TOČNO cevovod
// foto-replace.tsx (korak izbire gradiva → nalaganje teksture [R524: enojna
// površina + izmera smeri vlaken + rotacija za PRECNA/POKOCNA] → jedro) —
// samo z @napi-rs/canvas namesto DOM canvasa. Enaka struktura kot
// ops/r518-render.mjs in ops/r523-render.mjs.
//
// Primeri (mere ostajajo IZ URADNIH virov — fixture-i r518, nič izmišljenega):
//   P1 POLNA-128 · Burma teak · PRECNA (družinska privzeta) — čip BUT,
//      ROTIRAN (vlakna vzdolž vodoravnih desk) — neposredna primerjava
//      z R518 A (isti fixture, ista varianta: prej scenični izrez)
//   P2 POLNA-57 · Rustic walnut · POKOCNA — čip RWA; v R518 (B2) je ta
//      varianta padla v SAMO_DRUZINA (ni bilo slike odtenka) — zdaj UPORABLJENO
//   P3 POLNA-100 · White · POKOCNA — čip WHT (najbolj položna tekstura)
//   P4 ROMB-67 · Golden teak · PRECNA — čip GLT, rotiran
//   P5 POLNA-128 · Burma teak · POKOCNA (uporabniška izbira) — čip BUT,
//      brez rotacije (vlakna vzdolž pokončnih palic)
//
// Zagon: DATABASE_URL=postgresql://… bun ops/r524-render.mjs (katalog iz dev baze)
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas'
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..')
const db = new PrismaClient()

function semeIzId (id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const CORE = await import(join(REPO, 'src/lib/photo-replace-core.ts'))
const MASK = await import(join(REPO, 'src/lib/photo-replace-mask.ts'))
const TEKS = await import(join(REPO, 'src/lib/photo-replace-texture.ts'))

const FIX = JSON.parse(await Bun.file(join(REPO, 'tests/fixtures/foto-montaza/manifest.json')).text())

const PRIMERI = [
  {
    id: 'P1', fixture: 'hotel-bazen-zicna-ograja-desno', ime: 'polna128-cip-burma',
    sku: 'ROK-OG-POLNA-128', varianta: 'ROK-OG-POLNA-128-BUT', tip: 'PRECNA',
    refSmer: 'VODORAVNO',
    zoom: { x: 0.60, y: 0.30, w: 0.40, h: 0.45 },
  },
  {
    id: 'P2', fixture: 'vt-terasa-panelna-ograja-za-pergolo', ime: 'polna57-cip-rusticwalnut',
    sku: 'ROK-OGP-POLNA-57', varianta: 'ROK-OGP-POLNA-57-RWA', tip: 'POKOCNA',
    refSmer: 'NAVPIČNO',
    zoom: { x: 0.05, y: 0.05, w: 0.55, h: 0.45 },
  },
  {
    id: 'P3', fixture: 'vt-terasa-panelna-ograja-za-pergolo', ime: 'polna100-cip-white',
    sku: 'ROK-OGP-POLNA-100', varianta: 'ROK-OGP-POLNA-100-WHT', tip: 'POKOCNA',
    refSmer: 'NAVPIČNO',
    zoom: { x: 0.05, y: 0.05, w: 0.55, h: 0.45 },
  },
  {
    id: 'P4', fixture: 'hotel-bazen-zicna-ograja-desno', ime: 'romb67-cip-golden',
    sku: 'ROK-OG-ROMB-67', varianta: 'ROK-OG-ROMB-67-GLT', tip: 'PRECNA',
    refSmer: 'VODORAVNO',
    zoom: { x: 0.60, y: 0.30, w: 0.40, h: 0.45 },
  },
  {
    id: 'P5', fixture: 'hotel-bazen-zicna-ograja-desno', ime: 'polna128-cip-burma-POKOCNA',
    sku: 'ROK-OG-POLNA-128', varianta: 'ROK-OG-POLNA-128-BUT', tip: 'POKOCNA',
    refSmer: 'VODORAVNO',
    zoom: { x: 0.60, y: 0.30, w: 0.40, h: 0.45 },
  },
]

const out = (name, buf) => {
  writeFileSync(join(REPO, 'ops', name), buf)
  console.log(`[shranjeno] ops/${name} (${Math.round(buf.length / 1024)} kB)`)
}

for (const P of PRIMERI) {
  console.log('\n' + '═'.repeat(78))
  console.log(`PRIMER ${P.id}: ${P.ime} — ${P.sku} · ${P.varianta} (${P.tip})`)
  console.log('═'.repeat(78))

  const primer = FIX.primeri.find((p) => p.id === P.fixture)
  if (!primer) throw new Error(`fixture ${P.fixture} ne obstaja`)
  const quad = primer.quad
  const maska = { ograja: primer.maska.ograja, izpusti: primer.maska.izpusti, prednji: primer.maska.prednji }

  const produkt = await db.product.findFirst({
    where: { sku: P.sku },
    include: { variants: true, family: { select: { code: true } } },
  })
  if (!produkt) throw new Error(`izdelek ${P.sku} ni v katalogu`)
  const varianta = produkt.variants.find((v) => v.sku === P.varianta)
  if (!varianta) throw new Error(`varianta ${P.varianta} ni v katalogu`)

  const assets = (await db.productAsset.findMany({
    where: { productId: produkt.id },
    select: { id: true, kind: true, orientation: true, view: true, colorName: true, variantSku: true, productId: true, filePath: true, sha256: true, status: true, permission: true, sourceName: true },
  })).map((a) => ({ ...a, productId: a.productId ?? null, orientation: a.orientation ?? null, view: a.view ?? null, colorName: a.colorName ?? null, variantSku: a.variantSku ?? null, filePath: a.filePath ?? null, sha256: a.sha256 ?? null }))

  const orientacija = P.tip === 'PRECNA' ? 'PRECNA' : 'POKOCNA'
  const izbira = TEKS.izberiGradivo(assets, {
    productId: produkt.id, variantSku: varianta.sku, orientation: orientacija,
  })
  console.log(`[katalog] izbira gradiva: ${izbira.stanje} · ${izbira.gradivo?.filePath?.split('/').pop() ?? '—'} (${izbira.gradivo?.kind ?? '—'})`)
  if (!izbira.gradivo) throw new Error(`brez gradiva za ${P.varianta} — preveri seed-r524`)

  const tech = produkt.tech ?? {}
  const sirinaProfila = produkt.widthMm ?? null
  const razmik = (tech.razmak != null ? Number(tech.razmak) : null) ?? (tech.razmikMm != null ? Number(tech.razmikMm) : null)
  const material = CORE.materialIzTecha(produkt.tech)
  const barva = CORE.barvaVariante({ ral: varianta.ral, color: varianta.color })

  const imgOriginal = await loadImage(join(REPO, primer.izvirnik))
  const photoW = imgOriginal.width, photoH = imgOriginal.height
  const imgTekstura = await loadImage(join(REPO, izbira.gradivo.filePath))
  console.log(`[slika] izvirnik ${photoW}×${photoH} · tekstura ${imgTekstura.width}×${imgTekstura.height} (${izbira.gradivo.kind})`)

  // ── tekstura: ISTA pot kot foto-replace.tsx po R524 ───────────────────────
  // DETAJL čip → izmera smeri vlaken + rotacija, kadar vlakna tečejo ČEZ
  // element (POKOCNA → vir naj ima navpična; PRECNA → vodoravna). Preslikava
  // ostaja NAVADNA mreža celic (jedro brez spremembe — izoliran poskus je
  // mrežo 9/10 potrdil proti podizrezu+zrcalu 6/10).
  let slikaVir = imgTekstura
  let sirinaPx = imgTekstura.width
  let visinaPx = imgTekstura.height
  if (izbira.gradivo.kind === 'DETAJL') {
    const mc = createCanvas(imgTekstura.width, imgTekstura.height)
    const mctx = mc.getContext('2d')
    mctx.drawImage(imgTekstura, 0, 0)
    const dd = mctx.getImageData(0, 0, imgTekstura.width, imgTekstura.height).data
    const smer = TEKS.izmeriSmerVlaken((x, y) => {
      const i = (y * imgTekstura.width + x) * 4
      return (dd[i] * 0.299 + dd[i + 1] * 0.587 + dd[i + 2] * 0.114) / 255
    }, imgTekstura.width, imgTekstura.height)
    const hocemoNavpicno = P.tip === 'POKOCNA'
    const imaNavpicno = smer <= 1
    console.log(`[vlakna] smer |dI/dy|/|dI/dx| = ${smer.toFixed(2)} (${imaNavpicno ? 'navpična' : 'vodoravna'}) · element ${P.tip} zahteva ${hocemoNavpicno ? 'navpična' : 'vodoravna'}`)
    if (hocemoNavpicno !== imaNavpicno) {
      const rc = createCanvas(imgTekstura.height, imgTekstura.width)
      const rctx = rc.getContext('2d')
      rctx.translate(rc.width / 2, rc.height / 2)
      rctx.rotate(Math.PI / 2)
      rctx.drawImage(imgTekstura, -imgTekstura.width / 2, -imgTekstura.height / 2)
      slikaVir = rc
      sirinaPx = imgTekstura.height
      visinaPx = imgTekstura.width
      console.log('[vlakna] ROTIRANO 90° — vlakna zdaj tečejo VZDOLŽ elementa')
    }
  }
  const tekstura = {
    slika: slikaVir, sirinaPx, visinaPx,
    doklad: izbira.doklad ?? '', oznaka: izbira.gradivo?.variantSku ?? izbira.gradivo?.id ?? '',
  }

  const spodnjiRobPx = Math.hypot((quad[1].x - quad[0].x) * photoW, (quad[1].y - quad[0].y) * photoH)
  const leviRobPx = Math.abs(quad[0].y - quad[3].y) * photoH
  const refCm = primer.referenca.cm
  let lengthCm, heightCm
  if (P.refSmer === 'NAVPIČNO') {
    heightCm = Math.round(refCm * 0.62)
    lengthCm = Math.round((refCm * spodnjiRobPx) / Math.max(1e-6, leviRobPx) * 0.62)
  } else {
    lengthCm = refCm
    heightCm = Math.round((refCm * leviRobPx) / Math.max(1e-6, spodnjiRobPx))
  }

  const config = {
    tip: P.tip,
    lengthCm, heightCm,
    posts: 3,
    handrail: true,
    lamelaMm: sirinaProfila ?? 70,
    rezaMm: razmik ?? 20,
    deskaMm: sirinaProfila ?? 120,
    pritrditev: 'TALNA',
    vijaki: tech.vijacenje ? tech.vijacenje.startsWith('skrito') === false : true,
  }
  console.log(`[konfig] ${config.tip} ${config.lengthCm}×${config.heightCm} cm · deska/lamela ${config.tip === 'PRECNA' ? config.deskaMm : config.lamelaMm} mm + reza ${config.rezaMm} mm · stebri ${config.posts} · vijaki ${config.vijaki}`)

  const params = {
    quad,
    reference: { tip: 'ROCNO', cm: refCm, opis: primer.referenca.opis },
    config,
    maska,
  }

  const W = Math.min(1100, photoW)
  const H = Math.max(1, Math.round(W * (photoH / photoW)))
  const cPiksli = createCanvas(W, H)
  const cCtx = cPiksli.getContext('2d')
  cCtx.drawImage(imgOriginal, 0, 0, W, H)
  const izvirnik = cCtx.getImageData(0, 0, W, H).data

  const pk = MASK.pokrij(maska, W, H)
  const obnova = MASK.obnoviOzadje(izvirnik, W, H, pk.ograja)
  const ozadjePlatno = createCanvas(W, H)
  ozadjePlatno.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(MASK.slojObnove(obnova, pk.ograja, W, H)), W, H), 0, 0)
  const prednjiPlatno = createCanvas(W, H)
  prednjiPlatno.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(MASK.slojPrednjega(izvirnik, W, H, pk.prednji)), W, H), 0, 0)

  const ozadje = {
    sloj: ozadjePlatno,
    nedokončano: obnova.razmerjeNedokončanega,
    pasovi: obnova.pasovi.filter((p) => p.pokritihPikslov > 0 && p.razmerje > 0).map((p) => `${p.ime} ${Math.round(p.razmerje * 100)} %`),
    sporocilo: obnova.sporocilo,
  }
  const SEME = semeIzId(`r524-dokaz-${P.ime}`)

  function renderPotem (meja) {
    const platno = createCanvas(W, H)
    const ctx = platno.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(imgOriginal, 0, 0, W, H)
    const svet = CORE.oceniSvetlobo(ctx, W, H, quad.map((t) => ({ x: t.x * W, y: t.y * H })))
    const plast = { gradivo: tekstura, ozadje, prednji: { sloj: prednjiPlatno } }
    const opozorila = meja !== undefined
      ? CORE.izrisiPrimerjavo(ctx, imgOriginal, W, H, params, barva, material, svet, meja, { ghost: 1, seme: SEME, prekrijStaro: true, ...plast })
      : CORE.izrisiOgrajo(ctx, W, H, params, barva, material, svet, { ghost: 1, seme: SEME, prekrijStaro: true, zig: true, ...plast })
    for (const o of opozorila) console.log(`[opozorilo] ${o.koda}: ${o.sporocilo.slice(0, 110)}`)
    return platno.toBuffer('image/png')
  }

  out(`r524-${P.id}-potem.png`, renderPotem())
  out(`r524-${P.id}-primerjava.png`, renderPotem(0.5))

  if (P.zoom) {
    const platnoZ = createCanvas(W, H)
    const zCtx = platnoZ.getContext('2d')
    zCtx.drawImage(imgOriginal, 0, 0, W, H)
    const svet = CORE.oceniSvetlobo(zCtx, W, H, quad.map((t) => ({ x: t.x * W, y: t.y * H })))
    CORE.izrisiOgrajo(zCtx, W, H, params, barva, material, svet, { ghost: 1, seme: SEME, prekrijStaro: true, gradivo: tekstura, ozadje, prednji: { sloj: prednjiPlatno } })
    const zx = Math.round(P.zoom.x * W), zy = Math.round(P.zoom.y * H)
    const zw = Math.round(P.zoom.w * W), zh = Math.round(P.zoom.h * H)
    const z = createCanvas(zw * 2, zh)
    z.getContext('2d').drawImage(platnoZ, zx, zy, zw, zh, 0, 0, zw, zh)
    z.getContext('2d').drawImage(cPiksli, zx, zy, zw, zh, zw, 0, zw, zh)
    out(`r524-${P.id}-zoom.png`, z.toBuffer('image/png'))
  }
}

await db.$disconnect()
console.log('\n[vozlišča] procesiranje končano (cpus: ' + (await import('node:os')).cpus().length + ')')

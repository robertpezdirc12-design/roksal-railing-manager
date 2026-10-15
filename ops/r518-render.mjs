// ops/r518-render.mjs — R518 (issue #14): DOKAZNI IZRISI za OSTALE modele/barve.
//
// NEIZDAJALNA KODA (orodje za dokaz, ne del aplikacije): za VSAK primer zrcali
// TOČNO cevovod foto-replace.tsx (korak 3/4/5) — enaki klici čistih modulov v
// enakem vrstnem redu (pokrij → obnoviOzadje → slojObnove → slojPrednjega →
// oceniSvetlobo → izrisiOgrajo/izrisiPrimerjavo z gradivo/ozadjem/prednjim) —
// samo z @napi-rs/canvas namesto DOM canvasa.
//
// Nadaljevanje R517 (ROMB 67 · Golden teak) na vse ostale ograjne modele:
//   A  hotel-bazen + ROK-OG-POLNA-128 · Burma teak   (PREČNA, 128 mm, reža 18 iz tech)
//   B  vt-terasa   + ROK-OGP-POLNA-57 · Oak wood     (POKONČNA, 57 mm, skrito vijačenje)
//   B2 vt-terasa   + ROK-OGP-POLNA-57 · Rustic oak   (POKONČNA — BREZ gradiva odtenka →
//                                                      SAMO_DRUZINA: struktura da, barva iz kataloga)
//   C  hotel-bazen + ROK-OG-DESKA-150 · Rustic oak   (PREČNA, 150 mm terasni profil, vidni vijaki)
//   D  vt-terasa   + ROK-OGP-POLNA-100 · White       (POKONČNA, 100 mm, svetla izvedba)
//   E  vt-terasa   + OGR-K-002 · Antracit RAL 7016   (POKONČNA ALU — NI preverjenega gradiva →
//                                                      pošteni barvni približek, brez teksture)
//
// Razmiki (reza): iz tech.razmakDeskMm (»5–30 (priporočeno)« → sredina 18) kjer
// obstaja; DESKA 150 s fotografij izmerjeno ~20-25 % širine deske (30 mm);
// POLNA 57 in ALU brez tech podatka → privzeta 20 mm (uporabnikovo polje).
//
// Zagon: DATABASE_URL=postgresql://… bun ops/r518-render.mjs (katalog iz dev baze)
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas'
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cpus } from 'node:os'

const REPO = join(import.meta.dir, '..')
const db = new PrismaClient()

// ─── isto kot foto-replace.tsx (semeIzId) ────────────────────────────────────
function semeIzId (id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ─── uvoz ČISTIH modulov (ista koda, ki jo poganja UI in validira strežnik) ──
const CORE = await import(join(REPO, 'src/lib/photo-replace-core.ts'))
const MASK = await import(join(REPO, 'src/lib/photo-replace-mask.ts'))
const TEKS = await import(join(REPO, 'src/lib/photo-replace-texture.ts'))

const FIX = JSON.parse(await Bun.file(join(REPO, 'tests/fixtures/foto-montaza/manifest.json')).text())

// ─── definicija primerov (kaj uporabnik »izbere« v UI) ──────────────────────
const PRIMERI = [
  {
    id: 'A', fixture: 'hotel-bazen-zicna-ograja-desno', ime: 'polna128-burma',
    sku: 'ROK-OG-POLNA-128', varianta: 'ROK-OG-POLNA-128-BUT',
    refSmer: 'VODORAVNO', // ležalnik 200 cm meri vzdolž spodnjega roba
    zoom: { x: 0.60, y: 0.30, w: 0.40, h: 0.45 },
  },
  {
    id: 'B', fixture: 'vt-terasa-panelna-ograja-za-pergolo', ime: 'polna57-oak',
    sku: 'ROK-OGP-POLNA-57', varianta: 'ROK-OGP-POLNA-57-OKW',
    refSmer: 'NAVPIČNO', // pergolin steber 220 cm meri višino
    zoom: { x: 0.05, y: 0.05, w: 0.55, h: 0.45 },
  },
  {
    id: 'B2', fixture: 'vt-terasa-panelna-ograja-za-pergolo', ime: 'polna57-rusticwalnut-BREZ',
    sku: 'ROK-OGP-POLNA-57', varianta: 'ROK-OGP-POLNA-57-RWA',
    refSmer: 'NAVPIČNO',
    // to je TOČNO pričakovani primer iz fixture: SAMO_DRUZINA (brez slike odtenka)
    // R523: RWA (ne ROAK — namenska uradna lestvica 57/32 ima 3 barve: AMW/OKW/RWA)
    pričakovanoStanje: 'SAMO_DRUZINA', pričakovanaDatoteka: 'c4a3c06d3e1b.jpg',
  },
  {
    id: 'C', fixture: 'hotel-bazen-zicna-ograja-desno', ime: 'deska150-rustic',
    sku: 'ROK-OG-DESKA-150', varianta: 'ROK-OG-DESKA-150-ROAK',
    refSmer: 'VODORAVNO', rezaMmPovsod: 30, // izmerjeno s produktnih fotografij ≈ 20–25 % širine
    zoom: { x: 0.60, y: 0.30, w: 0.40, h: 0.45 },
  },
  {
    id: 'D', fixture: 'vt-terasa-panelna-ograja-za-pergolo', ime: 'polna100-white',
    sku: 'ROK-OGP-POLNA-100', varianta: 'ROK-OGP-POLNA-100-WHT',
    refSmer: 'NAVPIČNO',
    zoom: { x: 0.05, y: 0.05, w: 0.55, h: 0.45 },
  },
  {
    id: 'E', fixture: 'vt-terasa-panelna-ograja-za-pergolo', ime: 'alu-lamele-antracit-BREZ',
    sku: 'OGR-K-002', varianta: 'OGR-K-002-ANT',
    refSmer: 'NAVPIČNO',
    pričakovanoStanje: 'NI_PREVERJENO', // 0 gradiv — pošteni barvni približek
  },
]

const out = (name, buf) => {
  writeFileSync(join(REPO, 'ops', name), buf)
  console.log(`[shranjeno] ops/${name} (${Math.round(buf.length / 1024)} kB)`)
}

for (const P of PRIMERI) {
  console.log('\n' + '═'.repeat(78))
  console.log(`PRIMER ${P.id}: ${P.ime} — ${P.sku} · ${P.varianta}`)
  console.log('═'.repeat(78))

  const primer = FIX.primeri.find((p) => p.id === P.fixture)
  if (!primer) throw new Error(`fixture ${P.fixture} ne obstaja`)
  const quad = primer.quad
  const maska = {
    ograja: primer.maska.ograaja ?? primer.maska.ograaja ?? primer.maska.ograja,
    izpusti: primer.maska.izpusti,
    prednji: primer.maska.prednji,
  }

  // ── katalog: izdelek + varianta + tech (ISTA pot kot UI) ──
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

  const izbira = TEKS.izberiGradivo(assets, {
    productId: produkt.id, variantSku: varianta.sku,
    orientation: produkt.family.code === 'OGRAJA_POKOCNA' ? 'POKOCNA' : primer.izbraniProdukt.orientacija,
  })
  console.log(`[katalog] izdelek ${produkt.sku} · varianta ${varianta.sku} (${varianta.color ?? varianta.ral ?? '—'})`)
  console.log(`[katalog] izbira gradiva: ${izbira.stanje} · ${izbira.gradivo?.filePath?.split('/').pop() ?? '—'}`)
  console.log(`[katalog] manjka: ${izbira.manjkajo.length ? izbira.manjkajo.join(', ') : 'NIČ'}`)
  if (P.pričakovanoStanje && izbira.stanje !== P.pričakovanoStanje) throw new Error(`stanje ${izbira.stanje} ≠ pričakovano ${P.pričakovanoStanje}`)
  if (P.pričakovanaDatoteka && izbira.gradivo?.filePath?.split('/').pop() !== P.pričakovanaDatoteka) throw new Error('datoteka gradiva ≠ pričakovana')

  // ── konfiguracija iz KATALOGA (isto kot izberiIzdelek v foto-replace.tsx) ──
  const sirinaProfila = CORE.lameleIzTecha(produkt.tech) // POLNA DESKA 128 → 128, 57/32 → 57
  const razmik = P.rezaMmPovsod ?? CORE.rezaIzTecha(produkt.tech) // »5–30« → 18; DESKA 150 → 30 (izmerjeno)
  const material = CORE.materialIzTecha(produkt.tech)
  const barva = CORE.barvaVariante({ ral: varianta.ral, color: varianta.color })
  const tech = JSON.parse(produkt.tech ?? '{}')

  // ── nalaganje slik ──
  const imgOriginal = await loadImage(join(REPO, primer.izvirnik))
  const photoW = imgOriginal.width, photoH = imgOriginal.height
  const imgTekstura = izbira.gradivo?.filePath ? await loadImage(join(REPO, izbira.gradivo.filePath)) : null
  console.log(`[slika] izvirnik ${photoW}×${photoH}${imgTekstura ? ` · tekstura ${imgTekstura.width}×${imgTekstura.height}` : ' · BREZ teksture (pošteni približek)'}`)

  // ── merilo iz reference: vodoravna mera (R517 formula) ali navpična ──
  const spodnjiRobPx = Math.hypot((quad[1].x - quad[0].x) * photoW, (quad[1].y - quad[0].y) * photoH)
  const leviRobPx = Math.abs(quad[0].y - quad[3].y) * photoH
  const refCm = primer.referenca.cm
  let lengthCm, heightCm
  if (P.refSmer === 'NAVPIČNO') {
    heightCm = Math.round(refCm * 0.62) // ograja je nižja od pergolinega stebra (~62 % višine)
    lengthCm = Math.round((refCm * spodnjiRobPx) / Math.max(1e-6, leviRobPx) * 0.62)
  } else {
    lengthCm = refCm
    heightCm = Math.round((refCm * leviRobPx) / Math.max(1e-6, spodnjiRobPx))
  }

  const config = {
    tip: produkt.family.code === 'OGRAJA_POKOCNA' ? 'POKOCNA' : 'PRECNA',
    lengthCm, heightCm,
    posts: 3,
    handrail: true,
    lamelaMm: sirinaProfila ?? 70,
    rezaMm: razmik ?? 20,
    deskaMm: sirinaProfila ?? 120,
    pritrditev: 'TALNA',
    vijaki: tech.vijacenje ? tech.vijacenje.startsWith('skrito') === false : true, // skrito → brez vidnih vijakov
  }
  console.log(`[katalog] profil ${String(tech.profil)} → širina ${sirinaProfila} mm · razmik ${razmik ?? 'privzeto 20'} mm · material ${material.vrsta} · barva ${barva}`)
  console.log(`[konfig] ${config.tip} ${config.lengthCm}×${config.heightCm} cm · deska/lamela ${config.tip === 'PRECNA' ? config.deskaMm : config.lamelaMm} mm + reza ${config.rezaMm} mm · stebri ${config.posts} · vijaki ${config.vijaki}`)

  const params = {
    quad,
    reference: { tip: 'ROCNO', cm: refCm, opis: primer.referenca.opis },
    config,
    maska,
  }

  // ── SLOJI: isto zaporedje kot foto-replace.tsx (komponenta sloji) ───────────
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
  const tekstura = imgTekstura ? {
    slika: imgTekstura, sirinaPx: imgTekstura.width, visinaPx: imgTekstura.height,
    doklad: izbira.doklad ?? '', oznaka: izbira.gradivo?.variantSku ?? izbira.gradivo?.id ?? '',
  } : null
  console.log(`[obnova] nedokončano: ${(obnova.razmerjeNedokončanega * 100).toFixed(1)} % · zahteva ročni poseg: ${obnova.zahtevaRočniPoseg}`)

  const ozadje = {
    sloj: ozadjePlatno,
    nedokončano: obnova.razmerjeNedokončanega,
    pasovi: obnova.pasovi.filter((p) => p.pokritihPikslov > 0 && p.razmerje > 0).map((p) => `${p.ime} ${Math.round(p.razmerje * 100)} %`),
    sporocilo: obnova.sporocilo,
  }
  const SEME = semeIzId(`r518-dokaz-${P.ime}`)

  // ── IZRIS POTEM (isto kot drawPotem v foto-replace.tsx) ─────────────────────
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

  out(`r518-${P.id}-potem.png`, renderPotem())
  out(`r518-${P.id}-primerjava.png`, renderPotem(0.5))

  if (P.zoom && tekstura) {
    const platnoZ = createCanvas(W, H)
    const zCtx = platnoZ.getContext('2d')
    zCtx.drawImage(imgOriginal, 0, 0, W, H)
    const svet = CORE.oceniSvetlobo(zCtx, W, H, quad.map((t) => ({ x: t.x * W, y: t.y * H })))
    CORE.izrisiOgrajo(zCtx, W, H, params, barva, material, svet, { ghost: 1, seme: SEME, prekrijStaro: true, gradivo: tekstura, ozadje, prednji: { sloj: prednjiPlatno } })
    const zx = Math.round(P.zoom.x * W), zy = Math.round(P.zoom.y * H)
    const zw = Math.round(P.zoom.w * W), zh = Math.round(P.zoom.h * H)
    const zoom = createCanvas(zw * 2, zh * 2)
    zoom.getContext('2d').drawImage(platnoZ, zx, zy, zw, zh, 0, 0, zw * 2, zh * 2)
    out(`r518-${P.id}-zoom.png`, zoom.toBuffer('image/png'))
  }
}

console.log(`\n[dokaz] ENGINE_VERSION ${CORE.ENGINE_VERSION} · jedro na ${cpus().length}-CPU brez AI`)
await db.$disconnect()

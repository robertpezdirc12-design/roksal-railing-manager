// ops/r517-render.mjs — R517 (issue #14): GLAVNI-BREZ DOKAZ IZRISA enega primera.
//
// NEIZDAJALNA KODA (orodje za dokaz, ne del aplikacije): zrcali TOČNO cevovod
// foto-replace.tsx (korak 3/4/5) — enaki klici čistih modulov v enakem vrstnem
// redu (pokrij → obnoviOzadje → slojObnove → slojPrednjega → oceniSvetlobo →
// izrisiOgrajo/izrisiPrimerjavo z gradivo/ozadjem/prednjim) — samo z
// @napi-rs/canvas namesto DOM canvasa, da lahko rezultat shranimo v PNG.
//
// Primer: tests/fixtures/foto-montaza/manifest.json »kupska-patio-zicna-ograja-levo«
//   izvirnik  public/assets/roksal/src/7d47a11b864e.jpg (1693×1270)
//   izdelek   ROK-OG-ROMB-67 · varianta ROK-OG-ROMB-67-GLT (Golden teak)
//   gradivo   r495-wpc-woodcore-romb-golden-precna-ograja-gasper1.jpg (VERIFIED)
//   referenca ROCNO 90 cm (standardni panel žične ograje)
//
// Zagon: bun ops/r517-render.mjs   (iz repo korena; bere dev bazo za katalog)
import { createCanvas, loadImage } from '@napi-rs/canvas'
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

const SEME = semeIzId('r517-dokaz-kupska-patio')

// ─── uvoz ČISTIH modulov (ista koda, ki jo poganja UI in validira strežnik) ──
const CORE = await import(join(REPO, 'src/lib/photo-replace-core.ts'))
const MASK = await import(join(REPO, 'src/lib/photo-replace-mask.ts'))
const TEKS = await import(join(REPO, 'src/lib/photo-replace-texture.ts'))

// ─── fixture (ročno označena maska, tests/fixtures/foto-montaza) ─────────────
const FIX = JSON.parse(await Bun.file(join(REPO, 'tests/fixtures/foto-montaza/manifest.json')).text())
const primer = FIX.primeri.find((p) => p.id === 'kupska-patio-zicna-ograja-levo')
if (!primer) throw new Error('fixture primer ne obstaja')

const T = (x, y) => ({ x, y })
const quad = primer.quad
const maska = {
  ograja: primer.maska.ograja,
  izpusti: primer.maska.izpusti,
  prednji: primer.maska.prednji,
}

// ─── katalog: izdelek + varianta + tech (ISTA pot kot UI) ────────────────────
const produkt = await db.product.findFirst({
  where: { sku: primer.izbraniProdukt.sku },
  include: { variants: true, family: { select: { code: true } } },
})
if (!produkt) throw new Error('izdelek ni v katalogu')
const varianta = produkt.variants.find((v) => v.sku === primer.izbraniProdukt.varianta)
if (!varianta) throw new Error('varianta ni v katalogu')

// gradiva izdelka — isti presek kot /api/product-assets vrne UI-ju
const assets = (await db.productAsset.findMany({
  where: { productId: produkt.id },
  select: { id: true, kind: true, orientation: true, view: true, colorName: true, variantSku: true, productId: true, filePath: true, sha256: true, status: true, permission: true, sourceName: true },
})).map((a) => ({ ...a, productId: a.productId ?? null, orientation: a.orientation ?? null, view: a.view ?? null, colorName: a.colorName ?? null, variantSku: a.variantSku ?? null, filePath: a.filePath ?? null, sha256: a.sha256 ?? null }))

const izbira = TEKS.izberiGradivo(assets, { productId: produkt.id, variantSku: varianta.sku, orientation: primer.izbraniProdukt.orientacija })
console.log(`[katalog] izdelek ${produkt.sku} · varianta ${varianta.sku} (${varianta.color})`)
console.log(`[katalog] izbira gradiva: ${izbira.stanje} · ${izbira.gradivo?.filePath ?? '—'}`)
console.log(`[katalog] manjka: ${izbira.manjkajo.length ? izbira.manjkajo.join(', ') : 'NIČ'}`)
if (izbira.stanje !== primer.pricakovano.stanje) throw new Error(`stanje ${izbira.stanje} ≠ pričakovano ${primer.pricakovano.stanje}`)
if (izbira.gradivo?.filePath !== primer.pricakovano.assetDatoteka) throw new Error('datoteka gradiva ≠ pričakovana')

// ─── konfiguracija iz KATALOGA (ne po občutku — vse iz tech/profila) ──────────
const sirinaProfila = CORE.lameleIzTecha(produkt.tech) // ROMB 67 → 67 mm
const material = CORE.materialIzTecha(produkt.tech) // WPC (HDPE) → WPC
const barva = CORE.barvaVariante({ ral: varianta.ral, color: varianta.color }) // Golden teak → lestvica
const tech = JSON.parse(produkt.tech ?? '{}')

// ─── nalaganje slik (izvirnik + preverjeno gradivo) ──────────────────────────
const imgOriginal = await loadImage(join(REPO, 'public/assets/roksal/src/7d47a11b864e.jpg'))
const imgTekstura = await loadImage(join(REPO, izbira.gradivo?.filePath || ''))
const photoW = imgOriginal.width
const photoH = imgOriginal.height
console.log(`[slika] izvirnik ${photoW}×${photoH} · tekstura ${imgTekstura.width}×${imgTekstura.height}`)

// višina iz razmerja kvada in referenčne mere — v PIKSLIH (x so v enotah
// širine, y v enotah višine slike — normalizirani koordinati niso ista merska!)
const spodnjiRobPx = Math.hypot((quad[1].x - quad[0].x) * photoW, (quad[1].y - quad[0].y) * photoH)
const leviRobPx = Math.abs(quad[0].y - quad[3].y) * photoH
const heightCm = Math.round((primer.referenca.cm * leviRobPx) / Math.max(1e-6, spodnjiRobPx))
const config = {
  tip: 'PRECNA', // romb deska leži prečno (jedro preverjene fotografije je prečna ograja)
  lengthCm: primer.referenca.cm, // spodnji rob kvada = referenčna mera 90 cm
  heightCm,
  posts: 2,
  handrail: true,
  lamelaMm: sirinaProfila ?? 67,
  rezaMm: 8, // tech: standardniRazmakFasadaMm za ROMB 67
  deskaMm: sirinaProfila ?? 67,
  pritrditev: 'TALNA',
  vijaki: tech.vijacenje === 'skrito (alu cev v jedru, RF vijaki)' ? false : true, // skrito vijačenje → brez vidnih vijakov
}
console.log(`[katalog] profil ${String(tech.profil)} → širina ${sirinaProfila} mm · material ${material.vrsta} · barva ${barva}`)
console.log(`[konfig] PRECNA ${config.lengthCm}×${config.heightCm} cm · deska ${config.deskaMm} mm + reza ${config.rezaMm} mm · stebri ${config.posts} · vijaki ${config.vijaki}`)

const params = {
  quad,
  reference: { tip: 'ROCNO', cm: primer.referenca.cm, opis: primer.referenca.opis },
  config,
  maska,
}

// ─── SLOJI: isto zaporedje kot foto-replace.tsx (komponenta sloji) ───────────
const W = Math.min(1100, photoW)
const H = Math.max(1, Math.round(W * (photoH / photoW)))
const cPiksli = createCanvas(W, H)
const cCtx = cPiksli.getContext('2d')
cCtx.drawImage(imgOriginal, 0, 0, W, H)
const izvirnik = cCtx.getImageData(0, 0, W, H).data // = piksliIzSlike

const pk = MASK.pokrij(maska, W, H)
const obnova = MASK.obnoviOzadje(izvirnik, W, H, pk.ograja)
const ozadjePlatno = createCanvas(W, H)
ozadjePlatno.getContext('2d').putImageData(new (await import('@napi-rs/canvas')).ImageData(new Uint8ClampedArray(MASK.slojObnove(obnova, pk.ograja, W, H)), W, H), 0, 0)
const prednjiPlatno = createCanvas(W, H)
prednjiPlatno.getContext('2d').putImageData(new (await import('@napi-rs/canvas')).ImageData(new Uint8ClampedArray(MASK.slojPrednjega(izvirnik, W, H, pk.prednji)), W, H), 0, 0)
const tekstura = {
  slika: imgTekstura, sirinaPx: imgTekstura.width, visinaPx: imgTekstura.height,
  doklad: izbira.doklad ?? '', oznaka: izbira.gradivo?.variantSku ?? izbira.gradivo?.id ?? '',
}
console.log(`[obnova] nedokončano: ${(obnova.razmerjeNedokončanega * 100).toFixed(1)} % · zahteva ročni poseg: ${obnova.zahtevaRočniPoseg}`)
console.log(`[obnova] ${obnova.sporocilo}`)

const ozadje = {
  sloj: ozadjePlatno,
  nedokončano: obnova.razmerjeNedokončanega,
  pasovi: obnova.pasovi.filter((p) => p.pokritihPikslov > 0 && p.razmerje > 0).map((p) => `${p.ime} ${Math.round(p.razmerje * 100)} %`),
  sporocilo: obnova.sporocilo,
}

// ─── IZRIS POTEM (isto kot drawPotem v foto-replace.tsx) ─────────────────────
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
  for (const o of opozorila) console.log(`[opozorilo] ${o.koda}: ${o.sporocilo}`)
  return { png: platno.toBuffer('image/png') }
}

// ─── PRIPRAVA: original + maska nad njim (dokaz označitve) ────────────────────
const platnoM = createCanvas(W, H)
const mCtx = platnoM.getContext('2d')
mCtx.drawImage(imgOriginal, 0, 0, W, H)
// ograja (modra), izpusti (rdeča), prednji (zelena) — iste barve kot UI
const BARVE = {
  ograja: ['rgba(56, 189, 248, 0.95)', 'rgba(56, 189, 248, 0.14)'],
  izpust: ['rgba(248, 113, 113, 0.95)', 'rgba(248, 113, 113, 0.20)'],
  prednji: ['rgba(74, 222, 128, 0.95)', 'rgba(74, 222, 128, 0.16)'],
}
const risi = (oblike, barva) => {
  for (const o of oblike) {
    if (o.length < 3) continue
    mCtx.beginPath()
    o.forEach((t, i) => { const x = t.x * W, y = t.y * H; i === 0 ? mCtx.moveTo(x, y) : mCtx.lineTo(x, y) })
    mCtx.closePath()
    mCtx.fillStyle = barva[1]
    mCtx.fill()
    mCtx.strokeStyle = barva[0]
    mCtx.lineWidth = 2
    mCtx.stroke()
  }
}
risi(maska.ograja, BARVE.ograja)
risi(maska.izpusti, BARVE.izpust)
risi(maska.prednji, BARVE.prednji)
// kvad — rumena črta (kot v UI)
mCtx.strokeStyle = 'rgba(250, 204, 21, 0.95)'
mCtx.lineWidth = 2
mCtx.beginPath()
quad.forEach((t, i) => { const x = t.x * W, y = t.y * H; i === 0 ? mCtx.moveTo(x, y) : mCtx.lineTo(x, y) })
mCtx.closePath()
mCtx.stroke()

// ─── ZAPIS DOKAZOV ───────────────────────────────────────────────────────────
const out = (name, buf) => {
  writeFileSync(join(REPO, 'ops', name), buf)
  console.log(`[shranjeno] ops/${name} (${Math.round(buf.length / 1024)} kB)`)
}
out('r517-1-original.jpg', await Bun.file(join(REPO, 'public/assets/roksal/src/7d47a11b864e.jpg')).arrayBuffer().then((b) => Buffer.from(b)))
out('r517-2-maska.png', platnoM.toBuffer('image/png'))
out('r517-3-potem.png', renderPotem().png)
out('r517-4-primerjava.png', renderPotem(0.5).png)

// še zoom na ograjo za pregled teksture (izrez LEVEGA dela, kjer je ograja:
// kvad pokriva x ∈ [0, 0.098], y ∈ [0.487, 0.705] — izrežemo pas okoli njega)
const zX = 0
const zY = Math.round(H * 0.42)
const zW = Math.max(60, Math.round(W * 0.24))
const zH = Math.round(H * 0.40)
const platnoZ = createCanvas(W, H)
const zCtx = platnoZ.getContext('2d')
zCtx.drawImage(imgOriginal, 0, 0, W, H)
{
  const svet = CORE.oceniSvetlobo(zCtx, W, H, quad.map((t) => ({ x: t.x * W, y: t.y * H })))
  CORE.izrisiOgrajo(zCtx, W, H, params, barva, material, svet, { ghost: 1, seme: SEME, prekrijStaro: true, gradivo: tekstura, ozadje, prednji: { sloj: prednjiPlatno } })
}
const zoom = createCanvas(zW * 2, zH * 2)
zoom.getContext('2d').drawImage(platnoZ, zX, zY, zW, zH, 0, 0, zW * 2, zH * 2)
out('r517-5-zoom-tekstura.png', zoom.toBuffer('image/png'))

console.log(`\n[dokaz] ENGINE_VERSION ${CORE.ENGINE_VERSION} · seme ${SEME} · jedro na ${cpus().length}-CPU brez AI`)
await db.$disconnect()

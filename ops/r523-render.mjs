// ops/r523-render.mjs — R523 (issue #14): DOKAZNI IZRISI kakovosti teksture KUBO.
//
// NEIZDAJALNA KODA (orodje za dokaz, ne del aplikacije): zrcali TOČNO cevovod
// foto-replace.tsx (korak 3/4/5) — enaki klici čistih modulov v enakem vrstnem
// redu — samo z @napi-rs/canvas namesto DOM canvasa. Enaka struktura kot
// ops/r518-render.mjs in ops/r520-render.mjs.
//
// Primeri (mere ostajajo IZ URADNIH virov roksal.com — nič novega izmišljenega):
//   K  kubo-fasada + ROK-FAS-KUBO · Rustic oak  — DETAJL ČIP uradne lestvice
//      (2217×675 izvirnik, izrez 204×204, vlakna navpično) — neposredna
//      primerjava z R520 F (isti fixture, ista varianta: prej 8–16 px na desko)
//   K2 kubo-fasada + ROK-FAS-KUBO · Oak wood    — drug odtenek, isti čip vir
//   K3 kubo-fasada + ROK-FAS-KUBO · Amazon wood — najtemnejši odtenek
//   KM kubo-fasada + ROK-FAS-KUBO brez variante — DRUŽINSKA rezerva: scenična
//      fotografija b6cd z MNOŽICO izrezov (40 desk) — vsaka letvica svoja
//      deska (deterministično seme), konec identičnih klonov
//
// Zagon: DATABASE_URL=postgresql://… bun ops/r523-render.mjs (katalog iz dev baze)
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas'
import { PrismaClient } from '@prisma/client'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cpus } from 'node:os'

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
    id: 'K', fixture: 'kubo-fasada-hisa-levo', ime: 'kubo-cip-rustic-oak',
    sku: 'ROK-FAS-KUBO', varianta: 'ROK-FAS-KUBO-ROAK', tip: 'FASADA',
    zoom: { x: 0.16, y: 0.20, w: 0.44, h: 0.45 },
  },
  {
    id: 'K2', fixture: 'kubo-fasada-hisa-levo', ime: 'kubo-cip-oak-wood',
    sku: 'ROK-FAS-KUBO', varianta: 'ROK-FAS-KUBO-OKW', tip: 'FASADA',
    zoom: { x: 0.16, y: 0.20, w: 0.44, h: 0.45 },
  },
  {
    id: 'K3', fixture: 'kubo-fasada-hisa-levo', ime: 'kubo-cip-amazon-wood',
    sku: 'ROK-FAS-KUBO', varianta: 'ROK-FAS-KUBO-AMW', tip: 'FASADA',
    zoom: { x: 0.16, y: 0.20, w: 0.44, h: 0.45 },
  },
  {
    id: 'KM', fixture: 'kubo-fasada-hisa-levo', ime: 'kubo-multistrip-druzina',
    sku: 'ROK-FAS-KUBO', varianta: null, tip: 'FASADA', // brez variante → družinska rezerva
    // DOKAZ POTI MNOŽICE IZREZOV: izrecno SCENIČNA družinska fotografija b6cd
    // (uraden FOTO_IZDELEK KUBO) kot vir — v produkciji ta pot zadi, kadar
    // izdelek nima DETAJL čipa površine (danes ga KUBO ima za vse 4 odtenke).
    virOverride: 'b6cd18418118.jpg',
    zoom: { x: 0.16, y: 0.20, w: 0.44, h: 0.45 },
  },
]

const out = (name, buf) => {
  writeFileSync(join(REPO, 'ops', name), buf)
  console.log(`[shranjeno] ops/${name} (${Math.round(buf.length / 1024)} kB)`)
}

for (const P of PRIMERI) {
  console.log('\n' + '═'.repeat(78))
  console.log(`PRIMER ${P.id}: ${P.ime} — ${P.sku}${P.varianta ? ' · ' + P.varianta : ' (BREZ variante → družinska rezerva)'} (${P.tip})`)
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
  const varianta = P.varianta ? produkt.variants.find((v) => v.sku === P.varianta) : null
  if (P.varianta && !varianta) throw new Error(`varianta ${P.varianta} ni v katalogu`)

  const assets = (await db.productAsset.findMany({
    where: { productId: produkt.id },
    select: { id: true, kind: true, orientation: true, view: true, colorName: true, variantSku: true, productId: true, filePath: true, sha256: true, status: true, permission: true, sourceName: true },
  })).map((a) => ({ ...a, productId: a.productId ?? null, orientation: a.orientation ?? null, view: a.view ?? null, colorName: a.colorName ?? null, variantSku: a.variantSku ?? null, filePath: a.filePath ?? null, sha256: a.sha256 ?? null }))

  const izbira = TEKS.izberiGradivo(assets, {
    productId: produkt.id, variantSku: varianta?.sku ?? null, orientation: 'SPLOSNO',
  })
  console.log(`[katalog] izbira gradiva: ${izbira.stanje} · ${izbira.gradivo?.filePath?.split('/').pop() ?? '—'} (${izbira.gradivo?.kind ?? '—'})`)

  // KM — dokaz poti množice izrezov: preklopi na uradno scenično FOTO_IZDELEK
  let dokladZaVir = izbira.doklad ?? ''
  if (P.virOverride) {
    const scenicni = assets.find((a) => a.filePath?.endsWith(P.virOverride) && a.status === 'VERIFIED')
    if (!scenicni) throw new Error(`manjka scenični vir ${P.virOverride} med gradivi`)
    izbira.gradivo = scenicni
    dokladZaVir = scenicni.sourceName + ' · ' + scenicni.filePath + ' · sha256 ' + (scenicni.sha256 ?? '').slice(0, 16)
    console.log(`[katalog] PREKLOP (dokaz poti): ${izbira.stanje} · vir → ${P.virOverride} (scenična FOTO_IZDELEK, množica izrezov)`)
  }

  const sirinaIzImena = CORE.sirinaIzImena(produkt.name)
  const razmikIzTecha = CORE.rezaIzTecha(produkt.tech)
  const material = CORE.materialIzTecha(produkt.tech)
  const barva = CORE.barvaVariante(varianta ? { ral: varianta.ral, color: varianta.color } : null)

  const imgOriginal = await loadImage(join(REPO, primer.izvirnik))
  const photoW = imgOriginal.width, photoH = imgOriginal.height
  const imgTekstura = izbira.gradivo?.filePath ? await loadImage(join(REPO, izbira.gradivo.filePath)) : null
  console.log(`[slika] izvirnik ${photoW}×${photoH}${imgTekstura ? ` · tekstura ${imgTekstura.width}×${imgTekstura.height}` : ' · BREZ teksture'}`)

  const spodnjiRobPx = Math.hypot((quad[1].x - quad[0].x) * photoW, (quad[1].y - quad[0].y) * photoH)
  const leviRobPx = Math.abs(quad[0].y - quad[3].y) * photoH
  const refCm = primer.referenca.cm
  const lengthCm = refCm
  const heightCm = Math.round((refCm * leviRobPx) / Math.max(1e-6, spodnjiRobPx))

  const config = {
    tip: P.tip,
    lengthCm, heightCm,
    posts: 2, handrail: false,
    lamelaMm: CORE.FASADA_SIRINA_MM,
    rezaMm: razmikIzTecha ?? CORE.FASADA_REZA_MM,
    deskaMm: sirinaIzImena ?? 150,
    pritrditev: 'TALNA',
    vijaki: false,
  }
  console.log(`[konfig] ${config.tip} ${config.lengthCm}×${config.heightCm} cm · letvica ${config.lamelaMm} mm · razmik ${config.rezaMm} mm · barva ${barva}`)

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

  // ── tekstura: ISTA pot kot foto-replace.tsx (korak izbere vir → UI izmeri
  // izreze za FASADO → jedro razdeli deske po letvicah s semeanom) ──────────
  const tekstura = imgTekstura ? (() => {
    let izrezi
    let izrez
    if (P.tip === 'FASADA') {
      const mc = createCanvas(imgTekstura.width, imgTekstura.height)
      const mctx = mc.getContext('2d')
      mctx.drawImage(imgTekstura, 0, 0)
      izrezi = TEKS.izmeriIzrezeNavpicnihPalic((x, y) => {
        const d = mctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
        return (d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114) / 255
      }, imgTekstura.width, imgTekstura.height)
      if (izrezi && izrezi.length > 0) {
        const sredina = imgTekstura.width / 2
        izrez = izrezi.reduce((a, b) => Math.abs(a.x + a.w / 2 - sredina) <= Math.abs(b.x + b.w / 2 - sredina) ? a : b)
        console.log(`[tekstura] množica izrezov: ${izrezi.length} desk (širine ${izrezi.slice(0, 8).map(p => p.w).join(',')}…) → vsaka letvica dobi svojo (seme)`)
      } else {
        console.log('[tekstura] posnetek ENE površine (DETAJL/čip) — uporabljen cela slika, brez reza')
      }
    }
    return {
      slika: imgTekstura, sirinaPx: imgTekstura.width, visinaPx: imgTekstura.height,
      doklad: dokladZaVir, oznaka: izbira.gradivo?.variantSku ?? izbira.gradivo?.id ?? '',
      ...(izrez ? { izrez } : {}),
      ...(izrezi && izrezi.length > 0 ? { izrezi } : {}),
    }
  })() : null

  const ozadje = {
    sloj: ozadjePlatno,
    nedokončano: obnova.razmerjeNedokončanega,
    pasovi: obnova.pasovi.filter((p) => p.pokritihPikslov > 0 && p.razmerje > 0).map((p) => `${p.ime} ${Math.round(p.razmerje * 100)} %`),
    sporocilo: obnova.sporocilo,
  }
  const SEME = semeIzId(`r523-dokaz-${P.ime}`)

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
    for (const o of opozorila) console.log(`[opozorilo] ${o.koda}: ${o.sporocilo.slice(0, 100)}`)
    return platno.toBuffer('image/png')
  }

  out(`r523-${P.id}-potem.png`, renderPotem())
  out(`r523-${P.id}-primerjava.png`, renderPotem(0.5))

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
    out(`r523-${P.id}-zoom.png`, zoom.toBuffer('image/png'))
  }
}

// ── PRIMERJAVA PREJ/POTEM (R520 F zoom — isti fixture in varianta) ──────────
{
  console.log('\n' + '═'.repeat(78))
  console.log('PRIMERJAVA: R520-F-zoom (stara scenična tekstura 8–16 px) ⊣⊢ R523-K-zoom (čip 204×204)')
  console.log('═'.repeat(78))
  const stari = await loadImage(join(REPO, 'ops/r520-F-zoom.png')).catch(() => null)
  const novi = await loadImage(join(REPO, 'ops/r523-K-zoom.png')).catch(() => null)
  if (stari && novi) {
    const h = 720
    const wStari = Math.round(stari.width * (h / stari.height))
    const wNovi = Math.round(novi.width * (h / novi.height))
    const sk = createCanvas(wStari + wNovi + 24, h)
    const s = sk.getContext('2d')
    s.fillStyle = '#ffffff'
    s.fillRect(0, 0, sk.width, sk.height)
    s.drawImage(stari, 0, 0, wStari, h)
    s.drawImage(novi, wStari + 24, 0, wNovi, h)
    s.fillStyle = '#111111'
    s.font = 'bold 22px sans-serif'
    s.fillText('R520 (traku 8–16 px, vse letvice enake)', 10, 30)
    s.fillText('R523 (čip uradne lestvice 204×204, vlakna navpično)', wStari + 34, 30)
    out('r523-primerjava-kakovosti.png', sk.toBuffer('image/png'))
  } else {
    console.log('[opozorilo] manjkata zoom dokaza za primerjavo — poženi r520-render in r523-render')
  }
}

console.log(`\n[dokaz] ENGINE_VERSION ${CORE.ENGINE_VERSION} · jedro na ${cpus().length}-CPU brez AI`)
await db.$disconnect()

// ops/r520-render.mjs — R520 (issue #14): DOKAZNI IZRISI za FASADE in TERASE.
//
// NEIZDAJALNA KODA (orodje za dokaz, ne del aplikacije): zrcali TOČNO cevovod
// foto-replace.tsx (korak 3/4/5) — enaki klici čistih modulov v enakem vrstnem
// redu (pokrij → obnoviOzadje → slojObnove → slojPrednjega → oceniSvetlobo →
// izrisiOgrajo/izrisiPrimerjavo z gradivo/ozadjem/prednjim) — samo z
// @napi-rs/canvas namesto DOM canvasa.
//
// Primeri (mere iz URADNIH virov roksal.com — enak vir kot tech.vir):
//   F  kubo-fasada + ROK-FAS-KUBO · Rustic oak  (FASADA: navpične letvice 80 mm,
//      razmik 20 mm izmerjen z namestitvenih fotografij — uradno »poljuben«)
//   F2 kubo-fasada + ROK-FAS-KUBO · Oak wood    (druga barva, isto pravilo)
//   T  hotel-bazen-terasa + ROK-TER-RUSTIC · Rustic oak (TERASA: deske 150 mm
//      IZ IMENA izdelka, reža 6 mm po uradnem FAQ »Med deskami je razmak 5-6mm«)
//   T2 hotel-bazen-terasa + ROK-TER-KLASIK · Burma teak (druga barva)
//   T3 hotel-bazen-terasa + TER-ALU-001 · Antracit (NI_PREVERJENO — 0 gradiv →
//      pošteni barvni približek brez teksture, enaka fail-closed pot kot R518 E)
//
// Zagon: DATABASE_URL=postgresql://… bun ops/r520-render.mjs (katalog iz dev baze)
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
    id: 'F', fixture: 'kubo-fasada-hisa-levo', ime: 'kubo-fasada-rustic-oak',
    sku: 'ROK-FAS-KUBO', varianta: 'ROK-FAS-KUBO-ROAK',
    tip: 'FASADA',
    // višina odseka ≈ 280 cm (pritličje) — stena je posneta skoraj frontalno,
    // zato px razmerje robov da dobro oceno
    zoom: { x: 0.16, y: 0.20, w: 0.44, h: 0.45 },
  },
  {
    id: 'F2', fixture: 'kubo-fasada-hisa-levo', ime: 'kubo-fasada-oak-wood',
    sku: 'ROK-FAS-KUBO', varianta: 'ROK-FAS-KUBO-OKW',
    tip: 'FASADA',
    zoom: { x: 0.16, y: 0.20, w: 0.44, h: 0.45 },
  },
  {
    id: 'T', fixture: 'hotel-bazen-terasa-tla', ime: 'terasa-rustic-oak',
    sku: 'ROK-TER-RUSTIC', varianta: 'ROK-TER-RUSTIC-ROAK',
    tip: 'TERASA',
    // GLOBINA v cm ni iz px razmerja: tla so v perspektivi SKRAJČANA
    // (foregroun bližji rob je višji v px kot daleč rob za isto globino).
    // Ocena iz scene: bazenska terasa globoka ~350 cm.
    visinaOcenaCm: 350,
    zoom: { x: 0.08, y: 0.62, w: 0.55, h: 0.36 },
  },
  {
    id: 'T2', fixture: 'hotel-bazen-terasa-tla', ime: 'terasa-burma-teak',
    sku: 'ROK-TER-KLASIK', varianta: 'ROK-TER-KLASIK-BUT',
    tip: 'TERASA',
    visinaOcenaCm: 350,
    zoom: { x: 0.08, y: 0.62, w: 0.55, h: 0.36 },
  },
  {
    id: 'T3', fixture: 'hotel-bazen-terasa-tla', ime: 'alu-terasa-antracit-BREZ',
    sku: 'TER-ALU-001', varianta: 'TER-ALU-001-ANT',
    tip: 'TERASA',
    visinaOcenaCm: 350,
    pričakovanoStanje: 'NI_PREVERJENO', // 0 gradiv — pošteni barvni približek
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
  const maska = {
    ograja: primer.maska.ograja,
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

  // R520: FASADA/TERASA gradiva so SPLOSNO orientacije (DETAJL SPREDAJ/DETAJL)
  const izbira = TEKS.izberiGradivo(assets, {
    productId: produkt.id, variantSku: varianta.sku, orientation: 'SPLOSNO',
  })
  console.log(`[katalog] izdelek ${produkt.sku} · varianta ${varianta.sku} (${varianta.color ?? varianta.ral ?? '—'})`)
  console.log(`[katalog] izbira gradiva: ${izbira.stanje} · ${izbira.gradivo?.filePath?.split('/').pop() ?? '—'}`)
  console.log(`[katalog] manjka: ${izbira.manjkajo.length ? izbira.manjkajo.join(', ') : 'NIČ'}`)
  if (P.pričakovanoStanje && izbira.stanje !== P.pričakovanoStanje) throw new Error(`stanje ${izbira.stanje} ≠ pričakovano ${P.pričakovanoStanje}`)

  // ── konfiguracija iz KATALOGA + URADNIH virov (isto kot izberiIzdelek) ──
  // FASADA: KUBO nima mere v tech ne v imenu → uradna 80 mm (roksal.com);
  // razmik uradno poljuben → 20 mm izmere z namestitvenih fotografij.
  // TERASA: deska 150×25 IZ IMENA izdelka (sirinaIzImena); reža 6 mm (FAQ 5–6).
  const sirinaIzImena = CORE.sirinaIzImena(produkt.name)
  const razmikIzTecha = CORE.rezaIzTecha(produkt.tech)
  const material = CORE.materialIzTecha(produkt.tech)
  const barva = CORE.barvaVariante({ ral: varianta.ral, color: varianta.color })

  // ── nalaganje slik ──
  const imgOriginal = await loadImage(join(REPO, primer.izvirnik))
  const photoW = imgOriginal.width, photoH = imgOriginal.height
  const imgTekstura = izbira.gradivo?.filePath ? await loadImage(join(REPO, izbira.gradivo.filePath)) : null
  console.log(`[slika] izvirnik ${photoW}×${photoH}${imgTekstura ? ` · tekstura ${imgTekstura.width}×${imgTekstura.height}` : ' · BREZ teksture (pošteni približek)'}`)

  // ── merilo iz reference ──
  // referenca umerja SPODNJI rob (dolžina) — FASADA frontalna stena: višino
  // ocenimo iz px razmerja robov; TERASA: globino ocenimo ločeno (skrajčanje!)
  const spodnjiRobPx = Math.hypot((quad[1].x - quad[0].x) * photoW, (quad[1].y - quad[0].y) * photoH)
  const leviRobPx = Math.abs(quad[0].y - quad[3].y) * photoH
  const refCm = primer.referenca.cm
  const lengthCm = refCm
  const heightCm = P.tip === 'TERASA'
    ? P.visinaOcenaCm
    : Math.round((refCm * leviRobPx) / Math.max(1e-6, spodnjiRobPx))

  const config = {
    tip: P.tip,
    lengthCm, heightCm,
    posts: 2, handrail: false, // FASADA/TERASA: brez stebrov/ročnika (ne rišeta se)
    lamelaMm: P.tip === 'FASADA' ? CORE.FASADA_SIRINA_MM : (sirinaIzImena ?? 150),
    rezaMm: razmikIzTecha ?? (P.tip === 'FASADA' ? CORE.FASADA_REZA_MM : CORE.TERASA_REZA_MM),
    deskaMm: sirinaIzImena ?? 150,
    pritrditev: 'TALNA',
    vijaki: false, // KUBO: pritrditev ZADAJ (uradno); terasa: podkonstrukcija
  }
  console.log(`[katalog] ${P.tip === 'FASADA' ? `KUBO profil uradno 80×42 mm → letvica ${config.lamelaMm} mm · razmik ${config.rezaMm} mm (uradno poljuben, izmere ~15–21 mm)` : `deska IZ IMENA »${produkt.name}« → ${sirinaIzImena} mm · reža ${config.rezaMm} mm (uradni FAQ 5–6 mm)`}`)
  console.log(`[konfig] ${config.tip} ${config.lengthCm}×${config.heightCm} cm · material ${material.vrsta} · barva ${barva}`)

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
  const tekstura = imgTekstura ? (() => {
    // R520→R523: FASADA — izmeri VSE deske iz scenične fotografije (ista
    // izmera kot UI: izmeriIzrezeNavpicnihPalic — vsaka letvica svoja).
    // DETAJL/čip ene površine ostane cel (izmera vrne null).
    let izrez
    let izrezi
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
        console.log(`[tekstura] množica izrezov: ${izrezi.length} desk → vsaka letvica svoja (seme); najbližja sredini w=${izrez.w}`)
      } else {
        console.log('[tekstura] posnetok ene površine (DETAJL/čip) — cela slika, brez reza')
      }
    }
    return {
      slika: imgTekstura, sirinaPx: imgTekstura.width, visinaPx: imgTekstura.height,
      doklad: izbira.doklad ?? '', oznaka: izbira.gradivo?.variantSku ?? izbira.gradivo?.id ?? '',
      ...(izrez ? { izrez } : {}),
      ...(izrezi && izrezi.length > 0 ? { izrezi } : {}),
    }
  })() : null
  console.log(`[obnova] nedokončano: ${(obnova.razmerjeNedokončanega * 100).toFixed(1)} % · zahteva ročni poseg: ${obnova.zahtevaRočniPoseg}`)

  const ozadje = {
    sloj: ozadjePlatno,
    nedokončano: obnova.razmerjeNedokončanega,
    pasovi: obnova.pasovi.filter((p) => p.pokritihPikslov > 0 && p.razmerje > 0).map((p) => `${p.ime} ${Math.round(p.razmerje * 100)} %`),
    sporocilo: obnova.sporocilo,
  }
  const SEME = semeIzId(`r520-dokaz-${P.ime}`)

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

  out(`r520-${P.id}-potem.png`, renderPotem())
  out(`r520-${P.id}-primerjava.png`, renderPotem(0.5))

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
    out(`r520-${P.id}-zoom.png`, zoom.toBuffer('image/png'))
  }
}

console.log(`\n[dokaz] ENGINE_VERSION ${CORE.ENGINE_VERSION} · jedro na ${cpus().length}-CPU brez AI`)
await db.$disconnect()

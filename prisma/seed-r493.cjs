// seed-r493.cjs — ISSUE #6: PRAVA ROKSAL PRODUKTNA LINIJA + ORIGINALNA GRADIVA
// Vir podatkov: roksal.com (javne produktne strani, FAQ, barvni odtenki) — zajeto 2026-10-12.
// Dovoljenje: izjava lastnika aplikacije (2026-10-12): izvajalec dela ZA Roksal —
//   uporaba javnih produktnih gradiv roksal.com v poslovnem orodju je odobrena.
// Iskrenost (issue #6 §4):
//   - imena odtenkov POTRJENA samo: Rustic Oak, Rustic Walnut (besedilo FAQ/strani barv)
//   - barvne lestvice obstajajo (5 URL-jev + alt besedil), DATOTEKE niso bile prenosljive
//     (WAF) → status MISSING z zabeleženim izvornim URL-jem, BREZ izmišljanja imen
//   - fotografije: prenesene prek z-ai image-search (OSS kopije roksal.com slik), sha256 zapisan
//   - VLM ocena barve je VEDNO samo približek (colorApprox), nikoli uradno ime
// Idempotenca: svoje zapise (prefix ROK- / sourceName marker) najprej pobriše.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

const SRC_DIR = path.join(__dirname, '..', 'public', 'assets', 'roksal', 'src')
const MARKER = '[R493]'
const SOURCE_NAME = 'Roksal d.o.o. — roksal.com (javna produktna stran)'
const PERMISSION = 'Lastnik aplikacije (2026-10-12): izvajalec dela za Roksal d.o.o. — javna produktna gradiva roksal.com dovoljena za poslovno orodje'

// ── 1. PRAVI IZDELKI WOODCORE WPC (roksal.com) ──────────────────────────────
// tehnični podatki iz strani: pokončna/prečna ograja, terasa, material, barvni odtenki
const PRODUCTS = [
  {
    sku: 'ROK-TER-KLASIK', family: 'TERASA', unit: 'm2',
    name: 'WoodCore WPC terasna deska KLASIK 150×25',
    desc: 'Terasna deska iz WPC lesnega kompozita (lesni delci + HDPE + aditivi). Enota stran ozka rebra, druga široka rebra. 15-letna garancija.',
    widthMm: 150, heightMm: 25, warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', dolzine: [4000, 2200], povrsine: 3, barv: 7, garancijaLet: 15, vir: 'https://roksal.com/woodcore-wpc-deske/wpc-deske-za-teraso/' }),
    variants: [
      { sku: 'ROK-TER-KLASIK-ROAK', name: 'KLASIK — Rustic Oak', color: 'Rustic oak' },
      { sku: 'ROK-TER-KLASIK-RWA', name: 'KLASIK — Rustic Walnut', color: 'Rustic walnut' },
    ],
  },
  {
    sku: 'ROK-TER-RUSTIC', family: 'TERASA', unit: 'm2',
    name: 'WoodCore WPC terasna deska RUSTIC (staran les) 150×25',
    desc: 'RUSTIC izvedba — ena stran popolnoma gladka, druga gosto rebričena. Izgled staranega lesa. 15-letna garancija.',
    widthMm: 150, heightMm: 25, warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', dolzine: [4000, 2200], povrsine: 'gladka/rebričena', barv: 7, garancijaLet: 15, vir: 'https://roksal.com/woodcore-wpc-deske/wpc-deske-za-teraso/' }),
    variants: [
      { sku: 'ROK-TER-RUSTIC-ROAK', name: 'RUSTIC — Rustic Oak', color: 'Rustic oak' },
      { sku: 'ROK-TER-RUSTIC-RWA', name: 'RUSTIC — Rustic Walnut', color: 'Rustic walnut' },
    ],
  },
  {
    sku: 'ROK-OGP-POLNA-57', family: 'OGRAJA_POKOCNA', unit: 'm',
    name: 'Pokončna ograja — POLNA DESKA 57/32',
    desc: 'Polna WPC deska za pokončne ograde, montaža na širino 57 ali 32 mm. Skrito vijačenje (RF vijaki skozi cev od zadaj). Standardna dolžina 5,8 m, rezljiva. Max razmak vodoravnih cevi 100 cm.',
    widthMm: 57, heightMm: 32, warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', profil: 'POLNA DESKA 57/32', dolzine: [5800], maxRazmakPodporeMm: 1000, vijacenje: 'skrito (RF od zadaj)', barv: 3, primerno: 'samo pokončna ograja', vir: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/' }),
    variants: [],
  },
  {
    sku: 'ROK-OGP-POLNA-100', family: 'OGRAJA_POKOCNA', unit: 'm',
    name: 'Pokončna ograja — POLNA DESKA 100',
    desc: 'Polna WPC deska širine 10 cm za pokončne ograde. Dolžina 5,8 m. Max razmak vodoravnih cevi 80 cm.',
    widthMm: 100, warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', profil: 'POLNA DESKA 100', dolzine: [5800], maxRazmakPodporeMm: 800, barv: 8, primerno: 'samo pokončna ograja', vir: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-ograja-pokoncna/' }),
    variants: [
      { sku: 'ROK-OGP-POLNA-100-ROAK', name: 'POLNA 100 — Rustic Oak', color: 'Rustic oak' },
      { sku: 'ROK-OGP-POLNA-100-RWA', name: 'POLNA 100 — Rustic Walnut', color: 'Rustic walnut' },
    ],
  },
  {
    sku: 'ROK-OG-POLNA-128', family: 'OGRAJA_PRECNA', unit: 'm',
    name: 'Ograja — POLNA DESKA 128 (pokončna ali prečna)',
    desc: 'Polna WPC deska širine 12,8 cm, dolžine 2,2 m. Uporabna pri prečni ALI pokončni ograji. Prečna: max razmak stebričkov 110 cm; pokončna: max razmap cevi 100 cm.',
    widthMm: 128, warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', profil: 'POLNA DESKA 128', dolzine: [2200], maxRazmakPrecnaMm: 1100, maxRazmakPokoncnaMm: 1000, barv: 5, primerno: 'prečna in pokončna ograja', vir: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-precna-ograja/' }),
    variants: [
      { sku: 'ROK-OG-POLNA-128-ROAK', name: 'POLNA 128 — Rustic Oak', color: 'Rustic oak' },
      { sku: 'ROK-OG-POLNA-128-RWA', name: 'POLNA 128 — Rustic Walnut', color: 'Rustic walnut' },
    ],
  },
  {
    sku: 'ROK-OG-ROMB-67', family: 'OGRAJA_PRECNA', unit: 'm',
    name: 'Ograja — ROMB DESKA 67 (pokončna ali prečna)',
    desc: 'WPC romb deska širine 6,7 cm. Prečna: dolžina 5,8 m, max razmak stebričkov 145 cm (L-kotnika levo/desno); pokončna: dolžina 2,8 m, max razmap cevi 110 cm. Skrito vijačenje skozi alu cev v sredini profila.',
    widthMm: 67, warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', profil: 'ROMB 67', dolzine: [2800, 5800], maxRazmakPrecnaMm: 1450, maxRazmakPokoncnaMm: 1100, vijacenje: 'skrito (alu cev v jedru, RF vijaki)', barv: 7, primerno: 'prečna in pokončna ograja, fasada', vir: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-precna-ograja/' }),
    variants: [
      { sku: 'ROK-OG-ROMB-67-ROAK', name: 'ROMB 67 — Rustic Oak', color: 'Rustic oak' },
      { sku: 'ROK-OG-ROMB-67-RWA', name: 'ROMB 67 — Rustic Walnut', color: 'Rustic walnut' },
    ],
  },
  {
    sku: 'ROK-OG-DESKA-150', family: 'OGRAJA_PRECNA', unit: 'm',
    name: 'Prečna ograja — DESKA 150 (terasni profil)',
    desc: 'Terasni profil WPC deske širine 15 cm za prečne ograde. Dolžina 4 m ali 2,2 m. Max razmak stebričkov 130 cm. Vijačenje vidno spredaj (vijaki skozi desko v konstrukcijo).',
    widthMm: 150, heightMm: 25, warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', profil: 'DESKA 150 (terasni)', dolzine: [4000, 2200], maxRazmakPrecnaMm: 1300, vijacenje: 'vidno spredaj', barv: 7, primerno: 'prečna ograja', vir: 'https://roksal.com/woodcore-wpc-deske/balkonske-ograje-in-dvoriscne-ograje/wpc-precna-ograja/' }),
    variants: [
      { sku: 'ROK-OG-DESKA-150-ROAK', name: 'DESKA 150 — Rustic Oak', color: 'Rustic oak' },
      { sku: 'ROK-OG-DESKA-150-RWA', name: 'DESKA 150 — Rustic Walnut', color: 'Rustic walnut' },
    ],
  },
  {
    sku: 'ROK-FAS-KUBO', family: 'FASADA', unit: 'm2',
    name: 'Fasada — KUBO profil',
    desc: 'WPC deska s profilom KUBO za fasade. Na voljo 4 barvni odtenki.',
    warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', profil: 'KUBO', barv: 4, primerno: 'fasada', vir: 'https://roksal.com/woodcore-wpc-deske/barvni-odtenki/' }),
    variants: [
      { sku: 'ROK-FAS-KUBO-ROAK', name: 'KUBO — Rustic Oak', color: 'Rustic oak' },
      { sku: 'ROK-FAS-KUBO-RWA', name: 'KUBO — Rustic Walnut', color: 'Rustic walnut' },
    ],
  },
  {
    sku: 'ROK-KOM-POD-LETV', family: 'KOMPONENTA', unit: 'm',
    name: 'Podložna letev WPC 40×30×2200',
    desc: 'Podkonstrukcija za WoodCore WPC terase iz WPC materiala. Višina terase s podkonstrukcijo 5,5 ali 6,5 cm.',
    widthMm: 40, heightMm: 30, warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', dimenzije: '40×30×2200 mm', vir: 'https://roksal.com/woodcore-wpc-deske/wpc-deske-za-teraso/' }),
    variants: [],
  },
  {
    sku: 'ROK-KOM-ZAKL-LETV', family: 'KOMPONENTA', unit: 'm',
    name: 'Zaključna letev za teraso 45×55',
    desc: 'Zaključna letev za WoodCore WPC teraso. Dolžine 4000 ali 2200 mm (različne dolžine so lahko iz različnih serij).',
    widthMm: 45, heightMm: 55, warrantyMonths: 180,
    tech: JSON.stringify({ material: 'WPC (HDPE)', dimenzije: '45×55×4000/2200 mm', vir: 'https://roksal.com/woodcore-wpc-deske/wpc-deske-za-teraso/' }),
    variants: [],
  },
]

// ── 2. BARVNE LESTVICE (uradne, roksal.com) — datoteke WAF-blokirane ────────
// Imena odtenkov ZNOTRAJ slik niso izluščena → status MISSING (iskreno), URL izvira zabeležen.
const COLOR_CHARTS = [
  { sku: 'ROK-TER-KLASIK', url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_1-terasa4-1024x272.png', alt: 'Barvna paleta odtenkov WPC desk za desko 150', barv: 7, profil: 'terasa/DESKA 150' },
  { sku: 'ROK-OGP-POLNA-100', url: 'https://roksal.com/wp-content/uploads/2024/10/BARVNA_LESTVICA_2_polna-1024x240.png', alt: 'BARVNA LESTVICA 2 polna', barv: 8, profil: 'POLNA DESKA (100/57/32)' },
  { sku: 'ROK-OG-ROMB-67', url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_3-rombi4-1024x268.png', alt: 'Barvna paleta odtenkov WPC desk za desko romb', barv: 7, profil: 'ROMB 67' },
  { sku: 'ROK-OG-POLNA-128', url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_4-polna-128-4-1024x273.png', alt: 'Barvna paleta odtenkov WPC desk za desko 128', barv: 5, profil: 'POLNA DESKA 128' },
  { sku: 'ROK-FAS-KUBO', url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_5-kubo4-1024x312.png', alt: 'BARVNA LESTVICA 5 kubo4', barv: 4, profil: 'KUBO' },
]

// ── 3. FOTOGRAFIJE (27) — prek z-ai image-search OSS kopij roksal.com ───────
// kind/orientation/namen določeni iz VLM klasifikacije + napisov iskanja.
// [file, productSku, kind, orientation, colorApprox, view]
const PHOTOS = [
  ['8aa687a4eb8c.jpg', 'ROK-OG-ROMB-67', 'PROFIL_PRESEK', 'SPLOSNO', 'rjava', 'DETAJL'],
  ['e7f9ca05c8fa.png', 'ROK-OG-ROMB-67', 'KOMPONENTA', 'SPLOSNO', 'siva', 'DETAJL'],
  ['377db96a6814.jpg', 'ROK-OG-ROMB-67', 'FOTO_IZDELEK', 'POKOCNA', 'svetla lesena in antracit', 'SPREDAJ'],
  ['0214cf5503e9.jpeg', 'ROK-OGP-POLNA-100', 'FOTO_IZDELEK', 'POKOCNA', 'bela/bež', 'SPREDAJ'],
  ['a288c99889de.jpg', 'ROK-TER-KLASIK', 'FOTO_IZDELEK', 'PRECNA', 'siva', 'POGLED'],
  ['55ca01247f56.jpeg', 'ROK-OGP-POLNA-100', 'FOTO_IZDELEK', 'POKOCNA', 'svetla rjava', 'SPREDAJ'],
  ['aad146772028.jpeg', 'ROK-OGP-POLNA-100', 'FOTO_IZDELEK', 'POKOCNA', 'bež', 'SPREDAJ'],
  ['5b2b7b5ad609.jpeg', 'ROK-OGP-POLNA-100', 'FOTO_IZDELEK', 'POKOCNA', 'rjava', 'SPREDAJ'],
  ['0ec3fb75f12f.jpg', 'ROK-OG-POLNA-128', 'FOTO_IZDELEK', 'PRECNA', 'antracit', 'SPREDAJ'],
  ['5239bb8da600.jpg', 'ROK-OG-DESKA-150', 'FOTO_IZDELEK', 'PRECNA', 'siva', 'SPREDAJ'],
  ['a2145b44acd8.jpg', 'ROK-OG-DESKA-150', 'FOTO_IZDELEK', 'PRECNA', 'siva', 'SPREDAJ'],
  ['57993911e17d.jpg', 'ROK-OG-DESKA-150', 'FOTO_IZDELEK', 'PRECNA', 'rjava', 'SPREDAJ'],
  ['93fa8bcd0cb2.jpg', 'ROK-OG-DESKA-150', 'FOTO_IZDELEK', 'PRECNA', 'siva', 'SPREDAJ'],
  ['68f0a14a745c.jpg', 'ROK-OG-DESKA-150', 'FOTO_IZDELEK', 'PRECNA', 'antracit', 'POGLED'],
  ['ea8710d61306.jpg', 'ROK-OG-DESKA-150', 'FOTO_IZDELEK', 'PRECNA', 'rjava', 'SPREDAJ'],
  ['71737f333ee6.png', 'ROK-FAS-KUBO', 'FOTO_IZDELEK', 'PRECNA', 'siva', 'POGLED'],
  ['b6cd18418118.jpg', 'ROK-FAS-KUBO', 'FOTO_IZDELEK', 'POKOCNA', 'bež', 'POGLED'],
  ['5406d2b5cfd6.jpg', 'ROK-FAS-KUBO', 'FOTO_IZDELEK', 'PRECNA', 'bež', 'POGLED'],
  ['3a7bccebb297.jpg', 'ROK-FAS-KUBO', 'FOTO_IZDELEK', 'POKOCNA', 'rjava', 'POGLED'],
  ['c4a3c06d3e1b.jpg', 'ROK-OGP-POLNA-57', 'FOTO_IZDELEK', 'POKOCNA', 'rjava', 'SPREDAJ'],
  ['665f35b2f8c7.jpg', 'ROK-OGP-POLNA-57', 'FOTO_IZDELEK', 'POKOCNA', 'rjava', 'SPREDAJ'],
  ['b99bf9a64078.jpg', 'ROK-OGP-POLNA-100', 'FOTO_IZDELEK', 'POKOCNA', 'antracit', 'SPREDAJ'],
  ['5813faa388c5.jpg', 'ROK-OGP-POLNA-100', 'FOTO_IZDELEK', 'POKOCNA', 'rjava', 'SPREDAJ'],
  ['1c1e56ca52bc.jpg', 'ROK-TER-KLASIK', 'GALERIJA', 'SPLOSNO', 'rjava', 'POGLED'],
  ['0573714678e7.jpg', 'ROK-TER-KLASIK', 'GALERIJA', 'SPLOSNO', 'rjava', 'POGLED'],
  ['7d47a11b864e.jpg', 'ROK-TER-KLASIK', 'GALERIJA', 'SPLOSNO', 'rjava', 'POGLED'],
  ['e1471e39aceb.jpg', 'ROK-KOM-POD-LETV', 'FOTO_IZDELEK', 'SPLOSNO', 'rjava', 'SPREDAJ'],
]

async function main () {
  console.log('[seed-r493] ── issue #6: prava Roksal produktua linija + gradiva ──')

  // idempotenca: pobriši svoje (marker v sourceName za assete, prefix ROK- za izdelke)
  await db.productAsset.deleteMany({ where: { sourceName: SOURCE_NAME } })
  const stari = await db.product.findMany({ where: { sku: { startsWith: 'ROK-' } }, select: { id: true } })
  for (const p of stari) await db.product.delete({ where: { id: p.id } }).catch(() => {})
  console.log(`[seed-r493] pobrisanih prejšnjih: izdelki ${stari.length}`)

  // izdelki + variante
  const bySku = {}
  for (const p of PRODUCTS) {
    const fam = await db.productFamily.findFirst({ where: { code: p.family } })
    if (!fam) throw new Error(`manjka družina ${p.family}`)
    const prod = await db.product.create({
      data: {
        familyId: fam.id, sku: p.sku, name: p.name, desc: p.desc, unit: p.unit,
        widthMm: p.widthMm ?? null, heightMm: p.heightMm ?? null,
        tech: p.tech, warrantyMonths: p.warrantyMonths,
      },
    })
    bySku[p.sku] = prod.id
    for (const v of p.variants) {
      await db.productVariant.create({
        data: { productId: prod.id, sku: v.sku, name: v.name, color: v.color, ral: null },
      })
    }
    console.log(`[seed-r493] izdelek ${p.sku} (+${p.variants.length} variant)`)
  }

  // manifest datotek (sha256/bytes)
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'MANIFEST.json'), 'utf8'))
  const mf = {}
  for (const m of manifest) mf[m.file] = m

  // fotografije → ProductAsset (VERIFIED)
  let n = 0
  for (const [file, sku, kind, orientation, colorApprox, view] of PHOTOS) {
    const m = mf[file]
    if (!m) throw new Error(`manjka v manifestu: ${file}`)
    const fp = path.join(SRC_DIR, file)
    if (!fs.existsSync(fp)) throw new Error(`manjka datoteka: ${fp}`)
    const sha = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex')
    if (sha !== m.sha256) throw new Error(`sha256 ne ujema: ${file}`)
    await db.productAsset.create({
      data: {
        productId: bySku[sku], kind, orientation, view, colorApprox,
        filePath: `public/assets/roksal/src/${file}`, cdnUrl: m.cdnUrl, sha256: sha, bytes: m.bytes,
        sourceName: SOURCE_NAME, permission: PERMISSION, status: 'VERIFIED',
        note: `Preneseno prek z-ai image-search (OSS kopija javne slike roksal.com). ${m.opis}`,
      },
    })
    n++
  }
  console.log(`[seed-r493] fotografij (VERIFIED): ${n}`)

  // barvne lestvice → ProductAsset (MISSING — datoteka ni pridobljiva, URL zabeležen)
  for (const c of COLOR_CHARTS) {
    await db.productAsset.create({
      data: {
        productId: bySku[c.sku], kind: 'BARVNA_LESTVICA', orientation: 'SPLOSNO',
        sourceUrl: c.url, sourceName: SOURCE_NAME, permission: PERMISSION, status: 'MISSING',
        note: `Uradna barvna lestvica (${c.profil}, ${c.barv} odtenkov) obstaja na roksal.com (alt: »${c.alt}«), toda prenos datoteke je blokiral WAF. Imena odtenkov so ZAPISANA V SLIKI in niso izluščena — za dokončno potrditev potrebujemo datoteke od Roksala.`,
      },
    })
  }
  console.log(`[seed-r493] barvnih lestvic (MISSING, URL+alt zabeležen): ${COLOR_CHARTS.length}`)

  const cnt = await db.productAsset.count()
  const prods = await db.product.count({ where: { sku: { startsWith: 'ROK-' } } })
  const vars = await db.productVariant.count({ where: { sku: { startsWith: 'ROK-' } } })
  console.log(`[seed-r493] KONEC: ${prods} izdelkov, ${vars} variant (imena Rustic Oak/Walnut potrjena), ${cnt} gradiv ${MARKER}`)
}

main().catch((e) => { console.error('[seed-r493] NAPAKA:', e); process.exit(1) }).finally(() => db.$disconnect())

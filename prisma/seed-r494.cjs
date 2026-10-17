// seed-r494.cjs — ISSUE #6 nadaljevanje (R494): URADNE BARVNE LESTVICE PRENESENE + POLNA PALETA ODTENKOV + VRtno POHIŠTVO
// Vir: roksal.com (2026-10-12, druga raziskovalna seja):
//   - barvne lestvice: datoteke prenesene z brskalniško sejo z javnih URL-jev roksal.com
//     (WAF izziv je reševal JS brskalnika; datoteke so NESPREMENJENI izvirniki, sha256 zapisan)
//   - imena odtenkov: prebrana iz slik lestvic (VLM, večkratno preverjanje po vzorcih) +
//     POTRJENA v besedilu vira (reference: Rustic Walnut/Oak, Amazon Wood, Ash Wood, Burma Teak, Oak Wood)
//   - vrtno pohištvo: strani /vrtno-pohistvo/ (8 izdelkov z dimenzijami)
//   - dopolnilni tehnični podatki: pregradne stene, montaža, material (sestava 60/30/10)
// Iskrenost:
//   - POLNA 128: slika lestvice prikazuje 6 odtenkov, besedilo strani pravi 5 — OBOJE zabeleženo
//   - POLNA 57/32: »trenutno 3 barve« (lestvica KUBO ima 4) — izbor NI naveden → brez novih variant
//   - Golden teak in White: potrjena SAMO iz slik lestvic (VLM, dosledno), ne iz besedila strani
// Idempotenca: poišče in posodobi obstoječe zapise (sourceUrl lestvic), variante upsert po SKU,
//   pohištveni izdelki (prefix ROK-VRT-) se pobrišejo in znova ustvarijo.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

// R542: tech je jsonb — vrednost v bazi je OBJEKT (ne niz). Branje jemlje objekt,
// primerjava idempotence potrebujeta kanonizacijo (jsonb ne ohranja vrstnega reda ključev).
const techObjekt = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
const canon = (v) => JSON.stringify(v, (_k, x) => {
  if (x && typeof x === 'object' && !Array.isArray(x)) { const o = {}; for (const k of Object.keys(x).sort()) o[k] = x[k]; return o }
  return x
})

const SRC_DIR = path.join(__dirname, '..', 'public', 'assets', 'roksal', 'src')
const MARKER = '[R494]'
const TODAY = '2026-10-12'

// ── 1. URADNE BARVNE LESTVICE (datoteke prenešene 2026-10-12) ────────────────
// ime = lokalna datoteka; url = izvirni URL na roksal.com (isti kot v R493 zapisu)
// productSkus: izvirna stran uporablja isto lestvico za več profilov
//   (razdelek »Deske za teraso in ograja — TERASNI profil« → KLASIK, RUSTIC, DESKA 150;
//    razdelek POLNA 57/32 prikazuje lestvico KUBO) → več povezav na isto datoteko.
const SCALES = [
  {
    file: 'roksal-barvna-lestvica-terasa-150.png',
    productSkus: ['ROK-TER-KLASIK', 'ROK-TER-RUSTIC', 'ROK-OG-DESKA-150'],
    url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_1-terasa4-1024x272.png',
    profil: 'terasa / DESKA 150 (KLASIK, RUSTIC, prečna ograja)', barv: 7,
    odtenki: ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'Rustic oak', 'Rustic walnut'],
    besediloVira: 'Reference potrjujejo: Rustic Walnut, Amazon Wood, Ash Wood, Burma Teak, Oak Wood; Rustic Oak (barvna stran).',
  },
  {
    file: 'roksal-barvna-lestvica-romb-67.png', productSkus: ['ROK-OG-ROMB-67'],
    url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_3-rombi4-1024x268.png',
    profil: 'ROMB 67', barv: 7,
    odtenki: ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'Rustic oak', 'Rustic walnut'],
    besediloVira: 'Reference potrjujejo: Burma Teak, Oak Wood; Rustic Oak/Walnut (barvna stran).',
  },
  {
    file: 'roksal-barvna-lestvica-kubo.png',
    productSkus: ['ROK-FAS-KUBO', 'ROK-OGP-POLNA-57'],
    url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_5-kubo4-1024x312.png',
    profil: 'KUBO (izvirnik prikazuje to lestvico tudi pri POLNA 57/32)', barv: 4,
    odtenki: ['Amazon wood', 'Oak wood', 'Rustic oak', 'Rustic walnut'],
    besediloVira: 'Rustic Oak/Walnut potrjena v besedilu barvne strani. POLNA 57/32: »trenutno na voljo tri barve« — točen izbor ni naveden v viru.',
  },
  {
    file: 'roksal-barvna-lestvica-polna-100.png', productSkus: ['ROK-OGP-POLNA-100'],
    url: 'https://roksal.com/wp-content/uploads/2024/10/BARVNA_LESTVICA_2_polna-1024x240.png',
    profil: 'POLNA DESKA 100', barv: 8,
    odtenki: ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'White', 'Rustic oak', 'Rustic walnut'],
    besediloVira: 'Reference potrjujejo: Burma Teak, Ash Wood.',
  },
  {
    file: 'roksal-barvna-lestvica-polna-128.png', productSkus: ['ROK-OG-POLNA-128'],
    url: 'https://roksal.com/wp-content/uploads/2024/09/BARVNA_LESTVICA_4-polna-128-4-1024x273.png',
    profil: 'POLNA DESKA 128', barv: 6,
    odtenki: ['Amazon wood', 'Ash wood', 'Burma teak', 'Oak wood', 'Rustic oak', 'Rustic walnut'],
    besediloVira: 'NESKLADJE: slika prikazuje 6 odtenkov, besedilo strani pravi »petimi barvami« — oboje zabeleženo.',
  },
]

// ── 2. POLNA PALETA VARIANT (kodne kratice) ────────────────────────────────
const KODA = {
  'Amazon wood': 'AMW', 'Ash wood': 'ASH', 'Golden teak': 'GLT', 'Burma teak': 'BUT',
  'Oak wood': 'OKW', 'White': 'WHT', 'Rustic oak': 'ROAK', 'Rustic walnut': 'RWA',
}
// izdelek → odtenki, ki jih DODAMO (ROAK/RWA iz R493 že obstajajo)
const NOVE_BARVE = {
  'ROK-TER-KLASIK': ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood'],
  'ROK-TER-RUSTIC': ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood'],
  'ROK-OGP-POLNA-100': ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood', 'White'],
  'ROK-OG-POLNA-128': ['Amazon wood', 'Ash wood', 'Burma teak', 'Oak wood'],
  'ROK-OG-ROMB-67': ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood'],
  'ROK-OG-DESKA-150': ['Amazon wood', 'Ash wood', 'Golden teak', 'Burma teak', 'Oak wood'],
  'ROK-FAS-KUBO': ['Amazon wood', 'Oak wood'],
  // ROK-OGP-POLNA-57: »trenutno 3 barve« — točen izbor NI naveden v viru → iskreno brez variant
}

// ── 3. VRTNO POHIŠTVO (roksal.com/vrtno-pohistvo/, 2026-10-12) ──────────────
const POHISTVO = [
  {
    sku: 'ROK-VRT-MIZA-KUBO', name: 'Vrtna miza Kubo', unit: 'kos',
    desc: 'Miza iz aluminijaste konstrukcije, prašno barvane črno (RAL 9005), in WPC desk profila Kubo 80×42 mm. Barvo desk izbere naročnik.',
    dims: { dolzina: 2200, sirina: 800, visina: 750 },
    tech: { konstrukcija: 'alu, prašno barvana RAL 9005', profil: 'KUBO 80×42 mm', dimenzije: '220×80×75 cm' },
  },
  {
    sku: 'ROK-VRT-KLOP-KUBO', name: 'Vrtna klop Kubo', unit: 'kos',
    desc: 'Klop iz aluminijaste konstrukcije, prašno barvane črno (RAL 9005), in WPC desk profila Kubo 80×42 mm. Barvo desk izbere naročnik.',
    dims: { dolzina: 2000, sirina: 450, visina: 450 },
    tech: { konstrukcija: 'alu, prašno barvana RAL 9005', profil: 'KUBO 80×42 mm', dimenzije: '200×45×45 cm' },
  },
  {
    sku: 'ROK-VRT-MIZA-LINEA', name: 'Vrtna miza Linea', unit: 'kos',
    desc: 'Miza iz aluminijaste konstrukcije, prašno barvane črno (RAL 9005), in WPC desk polnega profila 57×32. Barvo desk izbere naročnik.',
    dims: { dolzina: 2200, sirina: 810, visina: 450 },
    tech: { konstrukcija: 'alu, prašno barvana RAL 9005', profil: 'POLNA DESKA 57/32', dimenzije: '220×81×45 cm' },
  },
  {
    sku: 'ROK-VRT-KLOP-LINEA', name: 'Vrtna klop Linea', unit: 'kos',
    desc: 'Klop iz aluminijaste konstrukcije, prašno barvana črno (RAL 9005), in WPC deskah polnega profila 57×32. Opcija: klop z naslonom ali brez naslona. Barvo desk izbere naročnik.',
    dims: { dolzina: 2000, sirina: 410, visina: 450 },
    tech: { konstrukcija: 'alu, prašno barvana RAL 9005', profil: 'POLNA DESKA 57/32', dimenzije: '200×41×45 cm', opcija: 'z naslonom / brez naslona' },
  },
  {
    sku: 'ROK-VRT-MIZA-X', name: 'Vrtna miza X', unit: 'kos',
    desc: 'Miza iz jeklene konstrukcije z nogami v obliki črke X ter WPC polnih desk profila 128. Barvo desk izbere naročnik. Nakup posamično ali skupaj s klopjo.',
    dims: { dolzina: 2160, sirina: 912, visina: 761 },
    tech: { konstrukcija: 'jeklena, noge X', profil: 'POLNA DESKA 128', dimenzije: '216 × 91,2 × 76,1 cm' },
  },
  {
    sku: 'ROK-VRT-KLOP-X', name: 'Vrtna klop X z naslonom', unit: 'kos',
    desc: 'Klop z naslonom iz jeklene konstrukcije z nogami v obliki črke X ter WPC polnih desk profila 128. Barvo desk izbere naročnik. Nakup posamično ali kot komplet z mizo.',
    dims: { dolzina: 2160, sirina: 392, visina: 448 },
    tech: { konstrukcija: 'jeklena, noge X', profil: 'POLNA DESKA 128', dimenzije: '216 × 39,2 × 44,8 cm' },
  },
  {
    sku: 'ROK-VRT-MIZA-R', name: 'Vrtna miza R', unit: 'kos',
    desc: 'Miza iz jeklene konstrukcije z ravnimi nogami ter WPC polnih desk profila 128. Barvo desk izbere naročnik. Nakup posamično ali skupaj s klopjo.',
    dims: { dolzina: 2160, sirina: 912, visina: 761 },
    tech: { konstrukcija: 'jeklena, ravne noge', profil: 'POLNA DESKA 128', dimenzije: '216 × 91,2 × 76,1 cm' },
  },
  {
    sku: 'ROK-VRT-KLOP-R', name: 'Vrtna klop R', unit: 'kos',
    desc: 'Klop iz jeklene konstrukcije z ravnimi nogami ter WPC polnih desk profila 128. Barvo desk izbere naročnik. Nakup posamično ali kot komplet z mizo.',
    dims: { dolzina: 2160, sirina: 392, visina: 448 },
    tech: { konstrukcija: 'jeklena, ravne noge', profil: 'POLNA DESKA 128', dimenzije: '216 × 39,2 × 44,8 cm' },
  },
]

// ── 4. DOPOLNILNI TEHNIČNI PODATKI (merge v obstoječi tech JSON) ───────────
const TECH_UPDATE = {
  'ROK-OGP-POLNA-57': {
    vijak: 'dolg približno 2/3 globine profila', maxStebrickevMm: 1500, maxNosilciMm: 1000,
    barvOpomba: 'Trenutno na voljo 3 barve (lestvica KUBO ima 4 odtenke) — točen izbor ni naveden v viru',
  },
  'ROK-OGP-POLNA-100': {
    razmakDeskMm: '5–30 (priporočeno)', prekrivanje: 'možno — montaža iz obeh strani',
    maxStebrickev: '180 cm pri višini ≤ 150 cm, sicer 150 cm', obdelovanje: 'kot les — možno zaobljanje/poljubne oblike',
  },
  'ROK-OG-POLNA-128': {
    razmakDeskMm: '5–30 (priporočeno)', prekrivanje: 'možno — montaža iz obeh strani',
    maxStebrickev: '180 cm pri višini ≤ 150 cm, sicer 150 cm', obdelovanje: 'kot les — možno zaobljanje/poljubne oblike',
    barvOpomba: 'Slika lestvice: 6 odtenkov; besedilo strani: 5 barv (nepopoljnost vira zabeležena)',
  },
  'ROK-OG-ROMB-67': {
    aluCev: 'vključena v ceno romb deske — montaža brez nje NI mogoča',
    vrtanje: 'kniping vijak 3,9 → izvrtina 3,2 (romb + alu), nato razširitev na 4,2–4,5',
    standardniRazmakFasadaMm: 8,
    extraPovezava: 'razmak > 145 cm: povezava iz zgornje cevi (do 180 cm); ≥ 180 cm: dodaten stebriček',
  },
  'ROK-OG-DESKA-150': { spojNaStebricu: 'pritrdilni vijak 3 cm od roba reza deske' },
  'ROK-TER-KLASIK': { visinaPodkonstrukcije: '5,5 ali 6,5 cm (z obrnjeno podložno desko)' },
  'ROK-TER-RUSTIC': { visinaPodkonstrukcije: '5,5 ali 6,5 cm (z obrnjeno podložno desko)' },
}
// skupni tehnični podatki za VSE WPC izdelke
const TECH_SKUPNO = {
  sestavaMateriala: '60 % bambusova vlakna, 30 % reciklirani polietilen (HDPE), 10 % aditivi',
  posvetlitev: 'barva prvo leto posvetli 5–10 %, nato ostaja enaka',
  montaznaTemperatura: 'najmanj +5 °C',
  ciscenje: 'samo z vodo (tudi do 60 barov); odporno na glive, lišaje in mah',
  vijakPravila: 'min. 3 cm od roba reza; na ploščo max 15 cm; bočno max 10 cm',
  rocaj: 'vijačenje na 50 cm; luknja 1 mm večja od vijaka; pri spajanju max 4 m',
}

async function main () {
  console.log(`${MARKER} ── issue #6 (R494): lestvice + paleta + pohištvo ──`)

  // ── A. lestvice: MISSING → VERIFIED (poišči po sourceUrl; poveži na VSE relevantne izdelke) ──
  // R523: iskanje po (izdelek, vrsta) namesto po sourceUrl — veriga za r494
  // NADGRADI sourceUrl (r523: KUBO → izvirnik 2217×675, POLNA-57 → namenska
  // lestvica 57/32); iskanje po starem URL-ju bi ob ponovnem zagonu ustvarilo
  // podvojene zapise oz. padlo na manjkajočem zapisu.
  let scalesOk = 0
  for (const s of SCALES) {
    const fp = path.join(SRC_DIR, s.file)
    if (!fs.existsSync(fp)) throw new Error(`manjka datoteka: ${fp}`)
    const buf = fs.readFileSync(fp)
    const sha = crypto.createHash('sha256').update(buf).digest('hex')
    const prviSku = s.productSkus[0]
    const prviProd = await db.product.findUnique({ where: { sku: prviSku } })
    if (!prviProd) throw new Error(`manjka izdelek ${prviSku}`)
    const rec = (await db.productAsset.findFirst({ where: { sourceUrl: s.url, kind: 'BARVNA_LESTVICA' } }))
      ?? (await db.productAsset.findFirst({ where: { productId: prviProd.id, kind: 'BARVNA_LESTVICA' } }))
    if (!rec) throw new Error(`manjka zapis lestvice za ${s.url} — poženi seed-r493 najprej`)
    const data = {
      status: 'VERIFIED',
      sourceUrl: s.url,
      filePath: `public/assets/roksal/src/${s.file}`,
      sha256: sha,
      bytes: buf.length,
      capturedAt: new Date(),
      sourceName: rec.sourceName,
      permission: rec.permission,
      note: `Uradna barvna lestvica ${s.profil} (${s.barv} odtenkov), prenešena ${TODAY} z javnega URL-ja roksal.com (brskalniška seja, datoteka nespremenjena). Odtenki: ${s.odtenki.join(', ')}. ${s.besediloVira} Preverjanje: 2026-10-12 (R494, tests/r494.py).`,
    }
    for (const sku of s.productSkus) {
      const prod = await db.product.findUnique({ where: { sku } })
      if (!prod) throw new Error(`manjka izdelek ${sku}`)
      const zeObst = await db.productAsset.findFirst({
        where: { productId: prod.id, kind: 'BARVNA_LESTVICA' },
      })
      if (zeObst) {
        await db.productAsset.update({ where: { id: zeObst.id }, data })
      } else {
        await db.productAsset.create({
          data: { productId: prod.id, kind: 'BARVNA_LESTVICA', orientation: 'SPLOSNO', sourceUrl: s.url, ...data },
        })
      }
    }
    scalesOk++
    console.log(`${MARKER} lestvica ${s.profil.split(' (')[0]}: VERIFIED (${s.barv} odtenkov, ${s.productSkus.length}×izdelek, sha ${sha.slice(0, 10)}…)`)
  }

  // ── B. nove barvne variante (upsert po SKU) ──
  let varsOk = 0
  for (const [sku, barve] of Object.entries(NOVE_BARVE)) {
    const prod = await db.product.findUnique({ where: { sku } })
    if (!prod) throw new Error(`manjka izdelek ${sku}`)
    for (const barva of barve) {
      const vSku = `${sku}-${KODA[barva]}`
      const kratka = sku.split('-').slice(2).join(' ')
      await db.productVariant.upsert({
        where: { sku: vSku },
        create: { productId: prod.id, sku: vSku, name: `${kratka} — ${barva}`, color: barva, ral: null },
        update: { name: `${kratka} — ${barva}`, color: barva, ral: null, active: true },
      })
      varsOk++
    }
    console.log(`${MARKER} ${sku}: +${barve.length} variant (${barve.map(b => KODA[b]).join(',')})`)
  }

  // ── C. vrtno pohištvo (novo, idempotentno: zbriši ROK-VRT-*) ──
  const famVrt = await db.productFamily.findFirst({ where: { code: 'VRTNA_RESITEV' } })
  if (!famVrt) throw new Error('manjka družina VRTNA_RESITEV')
  const stariVrt = await db.product.findMany({ where: { sku: { startsWith: 'ROK-VRT-' } }, select: { id: true } })
  for (const p of stariVrt) await db.product.delete({ where: { id: p.id } }).catch(() => {})
  for (const item of POHISTVO) {
    await db.product.create({
      data: {
        familyId: famVrt.id, sku: item.sku, name: item.name, desc: item.desc, unit: item.unit,
        widthMm: item.dims.sirina, heightMm: item.dims.visina, depthMm: item.dims.dolzina,
        warrantyMonths: 180,
        tech: {
          ...item.tech, material: 'WPC (HDPE) + kovinska konstrukcija', garancijaLet: 15,
          opomba: 'Klopi in mize izdelajo tudi po meri naročnika.',
          vir: 'https://roksal.com/woodcore-wpc-deske/vrtno-pohistvo/',
        },
      },
    })
    console.log(`${MARKER} pohištvo: ${item.sku} (${item.tech.dimenzije})`)
  }

  // ── D. tehnični dopolnitve (merge v tech JSON) ──
  let techOk = 0
  const wpc = await db.product.findMany({ where: { sku: { startsWith: 'ROK-' } } })
  for (const p of wpc) {
    const t = techObjekt(p.tech)
    const dod = TECH_UPDATE[p.sku] || {}
    const nova = { ...t, ...TECH_SKUPNO, ...dod }
    if (canon(nova) !== canon(p.tech)) {
      await db.product.update({ where: { id: p.id }, data: { tech: nova } })
      techOk++
    }
  }
  console.log(`${MARKER} tehnično dopolnjenih izdelkov: ${techOk}`)

  // ── E. MANIFEST.json — dodaj lestvice ──
  const manPath = path.join(SRC_DIR, 'MANIFEST.json')
  const manifest = JSON.parse(fs.readFileSync(manPath, 'utf8'))
  for (const s of SCALES) {
    const buf = fs.readFileSync(path.join(SRC_DIR, s.file))
    const sha = crypto.createHash('sha256').update(buf).digest('hex')
    if (manifest.find(m => m.file === s.file)) continue
    manifest.push({
      file: s.file, kategorija: 'barvna-lestvica',
      opis: `Uradna barvna lestvica ${s.profil} (${s.barv} odtenkov)`,
      source: 'Roksal d.o.o. (roksal.com) — datoteka prenesena z javnega URL-ja (brskalniška seja)',
      sourceUrl: s.url, sha256: sha, bytes: buf.length,
    })
  }
  fs.writeFileSync(manPath, JSON.stringify(manifest, null, 1) + '\n')
  console.log(`${MARKER} MANIFEST.json posodobljen (${manifest.length} vnosov)`)

  // ── F. povzetek ──
  const assets = await db.productAsset.groupBy({ by: ['status'], _count: true })
  const vars = await db.productVariant.count({ where: { sku: { startsWith: 'ROK-' } } })
  const prods = await db.product.count({ where: { sku: { startsWith: 'ROK-' } } })
  console.log(`${MARKER} KONEC: ${scalesOk} lestvic VERIFIED, +${varsOk} novih variant, ${POHISTVO.length} pohištva, ${techOk} tech; skupaj ${prods} izdelkov / ${vars} variant`)
  console.log(`${MARKER} statusi gradiv: ${JSON.stringify(assets.map(a => ({ [a.status]: a._count })))}`)
}

main().catch((e) => { console.error(`${MARKER} NAPAKA:`, e); process.exit(1) }).finally(() => db.$disconnect())

// seed-r442.cjs — issue #7 P0 DATA CORE: produktni model v OBSTOJEČO demo bazo (idempotentno)
// Družine → izdelki → variante → komponente (BOM predloge z EKSPlicitnimi ID) → ceniki → paketi.
// Uporaba: node prisma/seed-r442.cjs
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

// ── 1. produktni družine (issue #7 §1) ────────────────────────────────────────
const FAMILIES = [
  { code: 'TERASA', name: 'Terase', unit: 'm2', sortOrder: 1, desc: 'WPC in alu terasni sistemi' },
  { code: 'OGRAJA_PRECNA', name: 'Ograje — prečne', unit: 'm', sortOrder: 2, desc: 'Horizontalna polnila' },
  { code: 'OGRAJA_POKOCNA', name: 'Ograje — pokončne', unit: 'm', sortOrder: 3, desc: 'Vertikalna polnila, lamelne ograje' },
  { code: 'FASADA', name: 'Fasade', unit: 'm2', sortOrder: 4, desc: 'Lamelni in kasetni fasadni sistemi' },
  { code: 'PREGRADA', name: 'Pregrade', unit: 'm2', sortOrder: 5, desc: 'Notranje steklene in alu pregrade' },
  { code: 'NAPUSC', name: 'Napušči', unit: 'm2', sortOrder: 6, desc: 'Alu napuščni oblogi' },
  { code: 'STROP', name: 'Stropi', unit: 'm2', sortOrder: 7, desc: 'Alu stropne lamele' },
  { code: 'STOPNICE', name: 'Stopnice', unit: 'kos', sortOrder: 8, desc: 'Stopniščne ograje in obloge' },
  { code: 'VRTNA_RESITEV', name: 'Vrtne rešitve', unit: 'kos', sortOrder: 9, desc: 'Pergole, vrtna oprema' },
  { code: 'KOMPONENTA', name: 'Komponente', unit: 'kos', sortOrder: 10, desc: 'Posamezni artikli in material' },
]

// ── 2. novi inventarni artikli (enote: m/m2/kos/l) ────────────────────────────
const NEW_ITEMS = [
  { sku: 'WPC-DES-150', name: 'WPC deska 150×25 mm', unit: 'm2', qty: 260, reorderAt: 80, cost: 38.0 },
  { sku: 'WPC-DES-145', name: 'WPC deska premium 145×22 mm', unit: 'm2', qty: 140, reorderAt: 60, cost: 45.5 },
  { sku: 'ALU-TER-130', name: 'Alu terača 130×30 mm', unit: 'm2', qty: 95, reorderAt: 40, cost: 79.0 },
  { sku: 'ALU-PK-4040', name: 'Alu podkonstrukcija 40×40', unit: 'm', qty: 840, reorderAt: 300, cost: 6.8 },
  { sku: 'DIST-45', name: 'Distančnik 45 mm (kompakten)', unit: 'kos', qty: 2400, reorderAt: 800, cost: 0.55 },
  { sku: 'ZAKL-ALU', name: 'Zaključni alu profil', unit: 'm', qty: 320, reorderAt: 100, cost: 7.2 },
  { sku: 'ALU-PROF-6060', name: 'Alu profil 60×60 (glavni)', unit: 'm', qty: 510, reorderAt: 200, cost: 11.4 },
  { sku: 'ALU-STEBER-80', name: 'Alu steber 80×80 z nastavkom', unit: 'kos', qty: 64, reorderAt: 24, cost: 28.5 },
  { sku: 'FAS-LAM-160', name: 'Fasadna lamela 160 mm', unit: 'm2', qty: 210, reorderAt: 80, cost: 42.0 },
  { sku: 'FAS-PODK', name: 'Fasadna podkonstrukcija', unit: 'm', qty: 680, reorderAt: 250, cost: 7.9 },
  { sku: 'FAS-KLIPA', name: 'Klipa za lamelo', unit: 'kos', qty: 3600, reorderAt: 1200, cost: 1.15 },
  { sku: 'VIJ-FAS-TB', name: 'Vijak torx TB s pokrovom', unit: 'kos', qty: 4200, reorderAt: 1500, cost: 0.65 },
  { sku: 'ALU-PLOSCA-3', name: 'Alu plošča 3 mm (komax)', unit: 'm2', qty: 88, reorderAt: 30, cost: 31.0 },
  { sku: 'ALU-LAM-STROP', name: 'Alu stropna lamela 100 mm', unit: 'm2', qty: 150, reorderAt: 60, cost: 26.0 },
]

// ── 3. izdelki z BOM predlogami (komponente po SKU artikla) ───────────────────
// qty = količina artikla (v njegovi enoti) na ENOTO osnove produkta.
const PRODUCTS = [
  {
    sku: 'TER-WPC-001', family: 'TERASA', name: 'WPC terasa Standard 150×25', unit: 'm2',
    cost: 39, sale: 68, warranty: 60, widthMm: 150, heightMm: 25,
    desc: 'WPC terasa s 5 % rezervo odpada, alu podkonstrukcijo in zaključki',
    tech: { material: 'WPC (60 % vlaken, 40 % HDPE)', obremenitev: '450 kg/m²', protizdrsna: 'R11' },
    bom: [
      { sku: 'WPC-DES-150', qty: 1.05, note: 'vključen 5 % odpad' },
      { sku: 'ALU-PK-4040', qty: 2.6 },
      { sku: 'DIST-45', qty: 8 },
      { sku: 'ZAKL-ALU', qty: 0.12, optional: true },
      { sku: 'VIJ-INOX-M8', qty: 24 },
    ],
    variants: [
      { sku: 'TER-WPC-001-GRA', name: 'Grafit', color: 'Grafit', ral: 'RAL 7016', sale: 68 },
      { sku: 'TER-WPC-001-MLB', name: 'Mlečno bela', color: 'Mlečno bela', ral: 'RAL 9003', sale: 70 },
      { sku: 'TER-WPC-001-SIV', name: 'Siva', color: 'Siva', ral: 'RAL 7005', sale: 69 },
    ],
  },
  {
    sku: 'TER-WPC-002', family: 'TERASA', name: 'WPC terasa Premium 145×22', unit: 'm2',
    cost: 46, sale: 79, warranty: 72, widthMm: 145, heightMm: 22,
    desc: 'Premium WPC s polno barvno paleto in oljno zaščito',
    tech: { material: 'WPC premium', obremenitev: '500 kg/m²', protizdrsna: 'R12' },
    bom: [
      { sku: 'WPC-DES-145', qty: 1.05, note: 'vključen 5 % odpad' },
      { sku: 'ALU-PK-4040', qty: 2.6 },
      { sku: 'DIST-45', qty: 8 },
      { sku: 'ZAKL-ALU', qty: 0.12, optional: true },
      { sku: 'VIJ-INOX-M8', qty: 22 },
    ],
    variants: [
      { sku: 'TER-WPC-002-TEA', name: 'Teak', color: 'Teak', ral: null, sale: 79 },
      { sku: 'TER-WPC-002-ORE', name: 'Oreh', color: 'Oreh', ral: null, sale: 81 },
    ],
  },
  {
    sku: 'TER-ALU-001', family: 'TERASA', name: 'Alu terasa 130×30', unit: 'm2',
    cost: 82, sale: 129, warranty: 120, widthMm: 130, heightMm: 30,
    desc: 'Celostna alu terača — neobstoječa, RAL po izbiri',
    tech: { material: 'Aluminij 6063 T5', obremenitev: '600 kg/m²', obloga: 'prah v RAL' },
    bom: [
      { sku: 'ALU-TER-130', qty: 1.02, note: '2 % odpad pri razrezu' },
      { sku: 'ALU-PK-4040', qty: 3.0 },
      { sku: 'DIST-45', qty: 10 },
      { sku: 'ZAKL-ALU', qty: 0.10 },
      { sku: 'VIJ-INOX-M8', qty: 18 },
    ],
    variants: [
      { sku: 'TER-ALU-001-ANT', name: 'Antracit', color: 'Antracit', ral: 'RAL 7016', sale: 129 },
      { sku: 'TER-ALU-001-BEL', name: 'Bela', color: 'Bela', ral: 'RAL 9016', sale: 132 },
    ],
  },
  {
    sku: 'OGR-P-001', family: 'OGRAJA_PRECNA', name: 'Prečna ograja ALU — horizontalna polnila', unit: 'm',
    cost: 54, sale: 92, warranty: 120, heightMm: 1000,
    desc: 'Prečna alu ograja z dvema vrsticama polnil in stebri do 3 m',
    tech: { material: 'Aluminij', visina: '1000 mm', stebri: 'razmik ≤ 120 cm' },
    bom: [
      { sku: 'ALU-PROF-6060', qty: 2.0, note: '2 vrstici polnil' },
      { sku: 'ALU-STEBER-80', qty: 0.34, note: 'razmik ~ 2,9 m' },
      { sku: 'ANC-M12', qty: 2 },
      { sku: 'ZAKL-ALU', qty: 0.4, optional: true },
      { sku: 'VIJ-INOX-M8', qty: 8 },
      { sku: 'RAL-7016', qty: 0.03, note: 'prah barvanje' },
    ],
    variants: [
      { sku: 'OGR-P-001-ANT', name: 'Antracit', color: 'Antracit', ral: 'RAL 7016', sale: 92 },
      { sku: 'OGR-P-001-BEL', name: 'Bela', color: 'Bela', ral: 'RAL 9016', sale: 94 },
      { sku: 'OGR-P-001-SRE', name: 'Srebrna', color: 'Srebrna', ral: 'RAL 9007', sale: 93 },
    ],
  },
  {
    sku: 'OGR-P-002', family: 'OGRAJA_PRECNA', name: 'Prečna ograja INOX', unit: 'm',
    cost: 71, sale: 118, warranty: 180, heightMm: 1050,
    desc: 'Inox V2A prečna ograja — za obalne objekte',
    tech: { material: 'Inox V2A (1.4301)', visina: '1050 mm' },
    bom: [
      { sku: 'INOX-50-6M', qty: 0.34, note: '2 vrstici iz 6 m cevi' },
      { sku: 'ALU-STEBER-80', qty: 0.34 },
      { sku: 'ANC-M12', qty: 2 },
      { sku: 'VIJ-INOX-M8', qty: 8 },
    ],
    variants: [],
  },
  {
    sku: 'OGR-K-001', family: 'OGRAJA_POKOCNA', name: 'Pokončna ograja ALU — vertikalna polnila', unit: 'm',
    cost: 62, sale: 104, warranty: 120, heightMm: 1000,
    desc: 'Pokončna ograja iz L profilov — klasična izvedba',
    tech: { material: 'Aluminij', visina: '1000 mm' },
    bom: [
      { sku: 'ALU-PROF-6060', qty: 1.0, note: 'okvir' },
      { sku: 'ALU-L-80-6M', qty: 0.07, note: 'stebri + polnila iz 6 m L profila' },
      { sku: 'VIJ-INOX-M8', qty: 8 },
      { sku: 'RAL-7016', qty: 0.03 },
    ],
    variants: [
      { sku: 'OGR-K-001-ANT', name: 'Antracit', color: 'Antracit', ral: 'RAL 7016', sale: 104 },
      { sku: 'OGR-K-001-BEL', name: 'Bela', color: 'Bela', ral: 'RAL 9016', sale: 106 },
    ],
  },
  {
    sku: 'OGR-K-002', family: 'OGRAJA_POKOCNA', name: 'Pokončna ograja z lamelami', unit: 'm',
    cost: 67, sale: 112, warranty: 120, heightMm: 1100,
    desc: 'Moderni lamelni sistem z nastavljivim zaklopom',
    tech: { material: 'Aluminij', visina: '1100 mm', lamele: '70 mm' },
    bom: [
      { sku: 'ALU-PROF-6060', qty: 1.2 },
      { sku: 'ALU-STEBER-80', qty: 0.34 },
      { sku: 'ZAKL-ALU', qty: 0.5 },
      { sku: 'VIJ-INOX-M8', qty: 10 },
      { sku: 'RAL-7016', qty: 0.035 },
    ],
    variants: [
      { sku: 'OGR-K-002-ANT', name: 'Antracit', color: 'Antracit', ral: 'RAL 7016', sale: 112 },
      { sku: 'OGR-K-002-BEL', name: 'Bela', color: 'Bela', ral: 'RAL 9016', sale: 115 },
    ],
  },
  {
    sku: 'FAS-L-001', family: 'FASADA', name: 'Fasada — lamelni sistem', unit: 'm2',
    cost: 58, sale: 98, warranty: 120,
    desc: 'Ventilirana fasada z alu lamelami 160 mm',
    tech: { material: 'Aluminij', lamele: '160 mm', ventilacija: 'da' },
    bom: [
      { sku: 'FAS-LAM-160', qty: 1.05, note: '5 % odpad' },
      { sku: 'FAS-PODK', qty: 2.2 },
      { sku: 'FAS-KLIPA', qty: 12 },
      { sku: 'VIJ-FAS-TB', qty: 10 },
    ],
    variants: [
      { sku: 'FAS-L-001-ANT', name: 'Antracit', color: 'Antracit', ral: 'RAL 7016', sale: 98 },
      { sku: 'FAS-L-001-BEL', name: 'Bela', color: 'Bela', ral: 'RAL 9016', sale: 101 },
    ],
  },
  {
    sku: 'FAS-K-002', family: 'FASADA', name: 'Fasada — kasetni sistem', unit: 'm2',
    cost: 66, sale: 112, warranty: 120,
    desc: 'Kasetna fasada iz alu plošč 3 mm s skritimi fijesi',
    tech: { material: 'Alu komax 3 mm', kasete: 'po meri' },
    bom: [
      { sku: 'ALU-PLOSCA-3', qty: 1.06 },
      { sku: 'FAS-PODK', qty: 2.4 },
      { sku: 'VIJ-FAS-TB', qty: 12 },
      { sku: 'ZAKL-ALU', qty: 0.3, optional: true },
    ],
    variants: [],
  },
  {
    sku: 'PRE-S-001', family: 'PREGRADA', name: 'Pregrada — ALU okvir + steklo 10 mm', unit: 'm2',
    cost: 89, sale: 145, warranty: 60,
    desc: 'Notranja steklena pregrada z alu okvirjem',
    tech: { steklo: '10 mm lamelirano ESG', akustika: '38 dB' },
    bom: [
      { sku: 'ALU-PROF-6060', qty: 2.8 },
      { sku: 'STIK-10-CL', qty: 1.05 },
      { sku: 'LEP-MS', qty: 0.15 },
      { sku: 'TES-SIL', qty: 0.3 },
      { sku: 'VIJ-INOX-M8', qty: 6 },
    ],
    variants: [
      { sku: 'PRE-S-001-CLR', name: 'Čisto steklo', color: 'Clear', ral: null, sale: 145 },
      { sku: 'PRE-S-001-SIV', name: 'Sivo steklo', color: 'Sivo', ral: null, sale: 152 },
    ],
  },
  {
    sku: 'NAP-A-001', family: 'NAPUSC', name: 'Napušč ALU 3 mm', unit: 'm2',
    cost: 52, sale: 87, warranty: 120,
    desc: 'Alu napušč iz plošče 3 mm s podkonstrukcijo',
    bom: [
      { sku: 'ALU-PLOSCA-3', qty: 1.05 },
      { sku: 'FAS-PODK', qty: 2.0 },
      { sku: 'ZAKL-ALU', qty: 0.4 },
      { sku: 'VIJ-FAS-TB', qty: 8 },
    ],
    variants: [],
  },
  {
    sku: 'STR-L-001', family: 'STROP', name: 'Strop — alu lamela 100', unit: 'm2',
    cost: 45, sale: 76, warranty: 120,
    desc: 'Alu stropne lamele na klipah',
    bom: [
      { sku: 'ALU-LAM-STROP', qty: 1.02 },
      { sku: 'FAS-PODK', qty: 1.8 },
      { sku: 'FAS-KLIPA', qty: 8 },
    ],
    variants: [],
  },
  {
    sku: 'STO-O-001', family: 'STOPNICE', name: 'Stopniščna ograja z ročnikom', unit: 'kos',
    cost: 385, sale: 640, warranty: 120,
    desc: 'Eno ramensko stopniščna ograja ~ 6 m z ročnikom Ø42',
    bom: [
      { sku: 'ALU-PROF-6060', qty: 6 },
      { sku: 'ALU-ROK-42-6M', qty: 1, note: '6 m ročnika' },
      { sku: 'VIJ-INOX-M8', qty: 30 },
      { sku: 'ZAKL-ALU', qty: 1, optional: true },
    ],
    variants: [],
  },
  {
    sku: 'VRT-PE-001', family: 'VRTNA_RESITEV', name: 'Vrtna pergola ALU', unit: 'kos',
    cost: 1140, sale: 1890, warranty: 180,
    desc: 'Samostoječa alu pergola 3×4 m z lamelno streho',
    bom: [
      { sku: 'ALU-PROF-6060', qty: 24 },
      { sku: 'ALU-L-80-6M', qty: 1, note: 'stebri' },
      { sku: 'VIJ-INOX-M8', qty: 60 },
      { sku: 'ANC-M12', qty: 12 },
    ],
    variants: [
      { sku: 'VRT-PE-001-ANT', name: 'Antracit', color: 'Antracit', ral: 'RAL 7016', sale: 1890 },
      { sku: 'VRT-PE-001-BEL', name: 'Bela', color: 'Bela', ral: 'RAL 9016', sale: 1940 },
    ],
  },
  {
    sku: 'KOM-DIST-45', family: 'KOMPONENTA', name: 'Distančnik 45 mm', unit: 'kos',
    cost: 0.55, sale: 1.9, warranty: 0,
    desc: 'Črni kompaktni distančnik za terasne deske',
    bom: [],
    variants: [],
  },
  {
    sku: 'KOM-ZAKL-ALU', family: 'KOMPONENTA', name: 'Zaključni profil — samostojni', unit: 'm',
    cost: 7.2, sale: 14.5, warranty: 0,
    desc: 'Alu zaključni profil za prodajo posebej',
    bom: [],
    variants: [],
  },
]

// ── 4. ceniki (issue #7 §6) ──────────────────────────────────────────────────
const MONTAZA = { // € na enoto produkta
  'TER-WPC-001': 18, 'TER-WPC-002': 19, 'TER-ALU-001': 22,
  'OGR-P-001': 26, 'OGR-P-002': 30, 'OGR-K-001': 28, 'OGR-K-002': 30,
  'FAS-L-001': 24, 'FAS-K-002': 28, 'PRE-S-001': 38, 'NAP-A-001': 21,
  'STR-L-001': 16, 'STO-O-001': 120, 'VRT-PE-001': 290, 'KOM-DIST-45': 0, 'KOM-ZAKL-ALU': 0,
}

async function main () {
  // ── družine ────────────────────────────────────────────────────────────────
  const famMap = new Map()
  for (const f of FAMILIES) {
    const found = await db.productFamily.findUnique({ where: { code: f.code } })
    const row = found ?? await db.productFamily.create({ data: f })
    famMap.set(f.code, row.id)
  }
  console.log('[seed-r442] družine:', famMap.size)

  // ── novi inventarni artikli ────────────────────────────────────────────────
  const itemMap = new Map() // sku → id
  for (const it of await db.inventoryItem.findMany()) itemMap.set(it.sku, it.id)
  for (const it of NEW_ITEMS) {
    if (itemMap.has(it.sku)) continue
    const { cost, ...data } = it
    const row = await db.inventoryItem.create({ data })
    itemMap.set(it.sku, row.id)
  }
  console.log('[seed-r442] artikli (skupaj):', itemMap.size)

  // ── izdelki + variante + BOM predloge ──────────────────────────────────────
  let nProd = 0; let nVar = 0; let nComp = 0
  for (const p of PRODUCTS) {
    const found = await db.product.findUnique({ where: { sku: p.sku } })
    if (found) continue
    const row = await db.product.create({
      data: {
        familyId: famMap.get(p.family), sku: p.sku, name: p.name, unit: p.unit,
        desc: p.desc ?? null, widthMm: p.widthMm ?? null, heightMm: p.heightMm ?? null,
        tech: p.tech ? JSON.stringify(p.tech) : null,
        costPrice: p.cost, salePrice: p.sale, warrantyMonths: p.warranty,
      },
    })
    nProd++
    for (const [i, v] of (p.variants ?? []).entries()) {
      await db.productVariant.create({
        data: {
          productId: row.id, sku: v.sku, name: v.name, color: v.color ?? null,
          ral: v.ral ?? null, salePrice: v.sale, sortOrder: i,
        },
      })
      nVar++
    }
    for (const [i, c] of (p.bom ?? []).entries()) {
      const itemId = itemMap.get(c.sku)
      if (!itemId) { console.warn('  ! manjka artikel', c.sku); continue }
      await db.productComponent.create({
        data: {
          productId: row.id, itemId, qty: c.qty,
          unitBasis: p.unit, optional: c.optional ?? false, note: c.note ?? null, sortOrder: i,
        },
      })
      nComp++
    }
  }
  console.log('[seed-r442] izdelki:', nProd, '· variante:', nVar, '· komponente (BOM predloge):', nComp)

  // ── ceniki: NABAVNA (artikli) / PRODAJNA (izdelki) / MONTAŽA ───────────────
  const lists = [
    { name: 'Nabavni cenik 2026', type: 'NABAVNA', note: 'Nabavne cene artiklov pri dobaviteljih' },
    { name: 'Prodajni cenik 2026', type: 'PRODAJNA', note: 'Veljavne prodajne cene izdelkov' },
    { name: 'Cenik montaž 2026', type: 'MONTAZA', note: 'Cena montaže na enoto izdelka' },
  ]
  const listMap = new Map()
  for (const l of lists) {
    const found = await db.priceList.findFirst({ where: { name: l.name } })
    const row = found ?? await db.priceList.create({ data: l })
    listMap.set(l.type, row.id)
  }
  let nRule = 0
  const nabavnaId = listMap.get('NABAVNA')
  for (const it of NEW_ITEMS) {
    const exists = await db.priceRule.findFirst({ where: { priceListId: nabavnaId, itemId: itemMap.get(it.sku) } })
    if (!exists) { await db.priceRule.create({ data: { priceListId: nabavnaId, itemId: itemMap.get(it.sku), price: it.cost, unit: it.unit } }); nRule++ }
  }
  // nabavne cene za obstoječe artikle (ocena iz zgodovine MaterialPrice/losi)
  const LEGACY_COST = {
    'ALU-L-80-6M': 78, 'ALU-OKR-60-6M': 92, 'ALU-ROK-42-6M': 44, 'ANC-M12': 2.1,
    'INOX-50-6M': 168, 'LEP-MS': 14.5, 'RAL-7016': 22.5, 'STIK-10-CL': 68,
    'TES-SIL': 3.2, 'VIJ-INOX-M8': 0.42,
  }
  for (const [sku, cost] of Object.entries(LEGACY_COST)) {
    const itemId = itemMap.get(sku)
    if (!itemId) continue
    const exists = await db.priceRule.findFirst({ where: { priceListId: nabavnaId, itemId } })
    if (!exists) { await db.priceRule.create({ data: { priceListId: nabavnaId, itemId, price: cost, unit: 'kos' } }); nRule++ }
  }
  const prodajnaId = listMap.get('PRODAJNA')
  const montazaId = listMap.get('MONTAZA')
  for (const p of PRODUCTS) {
    const prod = await db.product.findUnique({ where: { sku: p.sku } })
    if (!prod) continue
    let exists = await db.priceRule.findFirst({ where: { priceListId: prodajnaId, productId: prod.id } })
    if (!exists) { await db.priceRule.create({ data: { priceListId: prodajnaId, productId: prod.id, price: p.sale, unit: p.unit } }); nRule++ }
    exists = await db.priceRule.findFirst({ where: { priceListId: montazaId, productId: prod.id } })
    if (!exists && MONTAZA[p.sku] > 0) { await db.priceRule.create({ data: { priceListId: montazaId, productId: prod.id, price: MONTAZA[p.sku], unit: p.unit } }); nRule++ }
  }

  // ── R464 (GitHub issue #1): generična konfiguracijska pravila ocen ─────────
  // viz/3D konfigurator ocenjuje ceno iz cenika (note = 'KONFIG:<ključ>',
  // brez produkta/artikla). Vrednosti so naslednice prej hardcoded konstant
  // iz viz-3d.tsx — od sedaj jih ureja pooblaščena oseba v ceniku.
  const KONFIG_RULES = [
    { key: 'STEBER', price: 45, unit: 'kos' },       // € / steber
    { key: 'ROCNIK', price: 15, unit: 'm' },         // € / m ročnika
    { key: 'STEKLO', price: 85, unit: 'm2' },        // € / m² stekla (balustrada)
    { key: 'MONTAZA', price: 35, unit: 'm' },        // € / m montaže
    { key: 'PRIPRAVA', price: 15, unit: '%' },       // priprava in rezerva (%)
    { key: 'PROFIL_OCENA', price: 85, unit: 'm' },   // profil € / m, če ni izbran
  ]
  for (const r of KONFIG_RULES) {
    const note = 'KONFIG:' + r.key
    const exists = await db.priceRule.findFirst({ where: { priceListId: prodajnaId, productId: null, itemId: null, note } })
    if (!exists) { await db.priceRule.create({ data: { priceListId: prodajnaId, note, price: r.price, unit: r.unit } }); nRule++ }
  }
  console.log('[seed-r442] ceniki: 3 · nova pravila:', nRule)

  // ── projektni paketi + 1 demo BOM ──────────────────────────────────────────
  const pkgCount = await db.projectPackage.count()
  if (pkgCount === 0) {
    const p1 = await db.project.findUnique({ where: { code: 'P-2026-001' } })
    const p3 = await db.project.findUnique({ where: { code: 'P-2026-003' } })
    const p7 = await db.project.findUnique({ where: { code: 'P-2026-007' } })
    const ter = await db.product.findUnique({ where: { sku: 'TER-WPC-001' } })
    const ogr = await db.product.findUnique({ where: { sku: 'OGR-P-001' } })
    const ogrInx = await db.product.findUnique({ where: { sku: 'OGR-P-002' } })
    const fas = await db.product.findUnique({ where: { sku: 'FAS-L-001' } })
    const nap = await db.product.findUnique({ where: { sku: 'NAP-A-001' } })
    const terGra = await db.productVariant.findUnique({ where: { sku: 'TER-WPC-001-GRA' } })
    const ogrAnt = await db.productVariant.findUnique({ where: { sku: 'OGR-P-001-ANT' } })
    if (p1 && ter && ogr && terGra && ogrAnt) {
      const pk1 = await db.projectPackage.create({
        data: {
          code: 'PAK-P-2026-001-1', projectId: p1.id, productId: ter.id, variantId: terGra.id,
          name: 'Terasa — WPC Grafit 150×25', qty: 36.4, unit: 'm2', status: 'IZMERA',
          note: 'Glavna terasa + prizidek; padec 1,5 % proti robu',
        },
      })
      await db.projectPackage.create({
        data: {
          code: 'PAK-P-2026-001-2', projectId: p1.id, productId: ogr.id, variantId: ogrAnt.id,
          name: 'Ograja terase — prečna antracit', qty: 18.6, unit: 'm', status: 'KONFIGURACIJA',
          note: 'Višina 100 cm, stebri vsakih 2,9 m',
        },
      })
      // demo BOM za prvi paket (TERASA 36,4 m²) — iz predloge × količina
      const comps = await db.productComponent.findMany({ where: { productId: ter.id }, orderBy: { sortOrder: 'asc' } })
      const bom = await db.bom.create({
        data: {
          code: 'BOM-2026-001', packageId: pk1.id, productId: ter.id, variantId: terGra.id,
          qty: 36.4, unit: 'm2', status: 'OSNUTEK', note: 'Generirano iz predloge ob izmeri',
          lines: {
            create: comps.map((c, i) => ({
              itemId: c.itemId, qty: Math.round(c.qty * 36.4 * 100) / 100,
              unit: 'auto', note: c.note, sortOrder: i,
            })),
          },
        },
      })
      // popravi enote vrstic na dejanske enote artiklov
      for (const line of await db.bomLine.findMany({ where: { bomId: bom.id }, include: { item: true } })) {
        await db.bomLine.update({ where: { id: line.id }, data: { unit: line.item.unit } })
      }
      console.log('[seed-r442] demo BOM-2026-001:', comps.length, 'vrstic')
    }
    if (p3 && ogrInx) {
      await db.projectPackage.create({
        data: {
          code: 'PAK-P-2026-003-1', projectId: p3.id, productId: ogrInx.id,
          name: 'Balkonske ograje INOX', qty: 24.0, unit: 'm', status: 'PONUDBA',
          note: '12 balkonov × 2 m; obala — inox',
        },
      })
    }
    if (p7 && fas && nap) {
      await db.projectPackage.create({
        data: {
          code: 'PAK-P-2026-007-1', projectId: p7.id, productId: fas.id,
          name: 'Fasada — lamelna antracit', qty: 24.0, unit: 'm2', status: 'POVPRAŠEVANJE',
        },
      })
      await db.projectPackage.create({
        data: {
          code: 'PAK-P-2026-007-2', projectId: p7.id, productId: nap.id,
          name: 'Napušč ALU 3 mm', qty: 12.0, unit: 'm2', status: 'POVPRAŠEVANJE',
        },
      })
    }
    console.log('[seed-r442] projektni paketi:', await db.projectPackage.count())
  } else console.log('[seed-r442] paketi že obstajajo:', pkgCount)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())

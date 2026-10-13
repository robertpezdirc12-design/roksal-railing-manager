// Roksal Railing Manager — demo seed (rekonstrukcija R431)
/* eslint-disable @typescript-eslint/no-require-imports */
// Zrcali originalni prisma/seed.cjs: "demo podatki naseljeni (uporabniki, stranke, projekti, zaloga, profili)"
const crypto = require('crypto')

function hashPassword (password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

// podpis stranke — kompakten SVG (data URL), enaka oblika kot signatura modul
function sigDataUrl () {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="90"><rect width="260" height="90" fill="#ffffff"/><path d="M18 62 C 40 20, 58 18, 60 50 C 62 74, 74 76, 84 48 C 94 22, 108 24, 106 52 C 104 74, 120 76, 130 50 C 140 26, 152 28, 150 52 C 148 72, 162 74, 172 52 C 180 34, 192 36, 196 50 C 200 64, 216 60, 232 44" stroke="#1d2b3e" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M22 74 C 80 80, 180 78, 240 70" stroke="#f59e0b" stroke-width="1.5" fill="none"/></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

// demo fotografija zaključenega dela — SVG prizor ograje (enaka oblika params.photo kot foto modul)
function fotoSvg (label, post, accent, posts, handrail) {
  let p = ''
  for (let i = 0; i < posts; i++) { const x = 34 + i * ((412 - 12) / Math.max(posts - 1, 1)); p += `<rect x="${x - 4}" y="150" width="8" height="72" rx="2" fill="${post}"/>` }
  const hr = handrail ? `<rect x="30" y="146" width="420" height="7" rx="3.5" fill="${post}"/><rect x="30" y="170" width="420" height="4" rx="2" fill="${post}" opacity="0.7"/>` : `<rect x="30" y="146" width="420" height="7" rx="3.5" fill="${post}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><defs><linearGradient id="nebo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe0ef"/><stop offset="1" stop-color="#e9eff5"/></linearGradient><linearGradient id="tl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9a284"/><stop offset="1" stop-color="#a08c6f"/></linearGradient></defs><rect width="480" height="270" fill="url(#nebo)"/><circle cx="405" cy="48" r="22" fill="${accent}" opacity="0.85"/><path d="M0 222 L 480 214 L 480 270 L 0 270 Z" fill="url(#tl)"/><g>${p}${hr}</g><path d="M0 226 L 480 218" stroke="#8a7558" stroke-width="2"/><text x="24" y="250" font-family="sans-serif" font-size="13" fill="#5c4d36">${label}</text><rect x="0" y="264" width="480" height="6" fill="${accent}" opacity="0.6"/></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

async function main () {
  console.log('[seed] brišem obstoječe podatke …')
  // R497: SEZNAM IZBRISOV MORA POKRITI VESE, kar veriga seeded piše (seed.cjs in
  // seed-r437 … seed-r495). Stari seznam je imel 38 tabel, veriga jih piše 58 →
  // drugi zagon `db:seed` je padel (P2002 na EngineeringRule.key, prej SQLSTATE
  // 23001 na ProductComponent_itemId_fkey), čeprav docs zahteva "zaženi db:seed po
  // vsaki migraciji". Seznam in VRSTNI RED sta izpeljana iz žive sheme: zaprta
  // množica REFERRERJEV z onDelete: Restrict/No Action nad temi tabelami, nato
  // topološki vrstni red otrok→starš (58 vozlišč, brez ciklov).
  // Novi seeded koraki MORAJO dodati svojo tabelo sem (sicer je seed znova neponovljiv).
  await db.auditLog.deleteMany()
  await db.bomLine.deleteMany()
  await db.delivery.deleteMany()
  await db.equipmentCheckout.deleteMany()
  await db.installationMaterialUsage.deleteMany()
  await db.jobRun.deleteMany()
  await db.materialOrderLine.deleteMany()
  await db.materialPrice.deleteMany()
  await db.notification.deleteMany()
  await db.opportunity.deleteMany()
  await db.payment.deleteMany()
  await db.photoVisualization.deleteMany()
  await db.pickingLine.deleteMany()
  await db.playbookRun.deleteMany()
  await db.portalLink.deleteMany()
  await db.priceRule.deleteMany()
  await db.productAsset.deleteMany()
  await db.productComponent.deleteMany()
  await db.punchEntry.deleteMany()
  await db.qcCheck.deleteMany()
  await db.quoteLine.deleteMany()
  await db.ruleVersion.deleteMany()
  await db.catalogVersion.deleteMany()
  await db.serviceVisit.deleteMany()
  await db.session.deleteMany()
  await db.setting.deleteMany()
  await db.stockLot.deleteMany()
  await db.stockMovement.deleteMany()
  await db.stockReservation.deleteMany()
  await db.supplier.deleteMany()
  await db.survey.deleteMany()
  await db.warrantyVisit.deleteMany()
  await db.workOrderEvent.deleteMany()
  await db.vehicle.deleteMany()
  await db.equipment.deleteMany()
  await db.materialOrder.deleteMany()
  await db.lead.deleteMany()
  await db.invoice.deleteMany()
  await db.priceList.deleteMany()
  await db.productionOrder.deleteMany()
  await db.engineeringRule.deleteMany()
  await db.profile.deleteMany()
  await db.serviceCase.deleteMany()
  await db.inventoryItem.deleteMany()
  await db.bom.deleteMany()
  await db.quote.deleteMany()
  await db.claim.deleteMany()
  await db.projectPackage.deleteMany()
  await db.warranty.deleteMany()
  await db.productVariant.deleteMany()
  await db.measurement.deleteMany()
  await db.product.deleteMany()
  await db.workOrder.deleteMany()
  await db.productFamily.deleteMany()
  await db.project.deleteMany()
  await db.crew.deleteMany()
  await db.customer.deleteMany()
  await db.user.deleteMany()

  console.log('[seed] naseljujem uporabnike …')
  const users = await Promise.all([
    db.user.create({ data: { email: 'admin@roksal.si', passwordHash: hashPassword('Admin123!'), name: 'Robert Pezdirc', role: 'ADMIN' } }),
    db.user.create({ data: { email: 'vodja@roksal.si', passwordHash: hashPassword('Vodja123!'), name: 'Matej Kovač', role: 'VODJA' } }),
    db.user.create({ data: { email: 'monter@roksal.si', passwordHash: hashPassword('Monter123!'), name: 'Luka Novak', role: 'MONTER' } }),
    db.user.create({ data: { email: 'skladisce@roksal.si', passwordHash: hashPassword('Skladisce123!'), name: 'Tomaž Zupan', role: 'SKLADISCE' } }),
    db.user.create({ data: { email: 'proizvodnja@roksal.si', passwordHash: hashPassword('Proizvodnja123!'), name: 'Ana Kos', role: 'PROIZVODNJA' } })
  ])
  const [admin, vodja, monter, skladisce, proizvodnja] = users

  console.log('[seed] naseljujem stranke …')
  const cs = await Promise.all([
    db.customer.create({ data: { name: 'Marko Novak', email: 'marko.novak@gmail.com', phone: '041 234 567', address: 'Trg svobode 12', city: 'Ljubljana', taxId: 'SI12345678' } }),
    db.customer.create({ data: { name: 'Petra Horvat', email: 'petra.horvat@siol.net', phone: '031 987 654', address: 'Vrtna ulica 4', city: 'Kranj' } }),
    db.customer.create({ data: { name: 'Hotel Zvezda d.o.o.', email: 'info@hotelzvezda.si', phone: '01 555 12 34', address: 'Obala 8', city: 'Portorož', taxId: 'SI87654321' } }),
    db.customer.create({ data: { name: 'Janez Kovač', email: 'janez.kovac@outlook.com', phone: '040 111 222', address: 'Gozdarska 22', city: 'Celje' } }),
    db.customer.create({ data: { name: 'Vrtec Sonček', email: 'info@vtec-soncek.si', phone: '02 333 44 55', address: 'Ulica bratov Janša 3', city: 'Maribor' } }),
    db.customer.create({ data: { name: 'Ivan Zajc', email: 'ivan.zajc@gmail.com', phone: '051 777 888', address: 'Kettejeva 17', city: 'Nova Gorica' } }),
    db.customer.create({ data: { name: 'Stanovanjsko društvo Rožna dolina', email: 'uprava@sd-roznadolina.si', phone: '01 234 56 78', address: 'Rožna dolina 18', city: 'Ljubljana' } }),
    db.customer.create({ data: { name: 'Gostilna Pri Lipi', email: 'gostilna@prilipi.si', phone: '07 888 99 00', address: 'Lipa 5', city: 'Novo mesto' } })
  ])

  console.log('[seed] naseljujem projekte …')
  const D = (days) => new Date(Date.now() - 86400000 * days)
  const projects = await Promise.all([
    db.project.create({ data: { code: 'P-2026-001', title: 'Ograja terasa — Novak', status: 'TEREN', customerId: cs[0].id, address: 'Trg svobode 12, Ljubljana', note: 'Alu ograja, antracit RAL 7016', createdAt: D(45) } }),
    db.project.create({ data: { code: 'P-2026-002', title: 'Balustrada — Horvat', status: 'AKTIVNI', customerId: cs[1].id, address: 'Vrtna ulica 4, Kranj', note: 'Steklena balustrada z leseno oporo', createdAt: D(40) } }),
    db.project.create({ data: { code: 'P-2026-003', title: 'Hotel Zvezda — balkoni', status: 'NACRT', customerId: cs[2].id, address: 'Obala 8, Portorož', note: '48 balkonov, inox', createdAt: D(30) } }),
    db.project.create({ data: { code: 'P-2026-004', title: 'Nadstrešek + ograja — Kovač', status: 'ZAKLJUCEN', customerId: cs[3].id, address: 'Gozdarska 22, Celje', createdAt: D(120) } }),
    db.project.create({ data: { code: 'P-2026-005', title: 'Vrtec Sonček — igrala ograja', status: 'TEREN', customerId: cs[4].id, address: 'Ulica bratov Janša 3, Maribor', note: 'Varnostna ograja okoli igrišča', createdAt: D(60) } }),
    db.project.create({ data: { code: 'P-2026-006', title: 'Stanovanjska hiša Zajc — stopnišče', status: 'AKTIVNI', customerId: cs[5].id, address: 'Kettejeva 17, Nova Gorica', createdAt: D(20) } }),
    db.project.create({ data: { code: 'P-2026-007', title: 'SD Rožna dolina — skupne površine', status: 'NACRT', customerId: cs[6].id, address: 'Rožna dolina 18, Ljubljana', createdAt: D(14) } }),
    db.project.create({ data: { code: 'P-2026-008', title: 'Gostilna Pri Lipi — vrt', status: 'ARHIV', customerId: cs[7].id, address: 'Lipa 5, Novo mesto', createdAt: D(900) } })
  ])

  console.log('[seed] naseljujem ponudbe …')
  const quoteDefs = [
    { code: 'PON-2026-001', projectId: projects[0].id, customerId: cs[0].id, status: 'SPREJET', lines: [['Alu ograja L-profil, antracit', 24, 89], ['Stebri 80×80 mm', 13, 45], ['Montaža', 24, 35]] },
    { code: 'PON-2026-002', projectId: projects[1].id, customerId: cs[1].id, status: 'POSLAN', lines: [['Steklena balustrada 10 mm', 12, 145], ['Lesena opora (termo jesen)', 12, 68], ['Montaža', 12, 40]] },
    { code: 'PON-2026-003', projectId: projects[2].id, customerId: cs[2].id, status: 'OSNUTEK', lines: [['Inox balkonska ograja V2A', 380, 120], ['Montaža', 380, 25]] },
    { code: 'PON-2026-004', projectId: projects[3].id, customerId: cs[3].id, status: 'ZAKLENJEN', signedBy: 'Janez Kovač', signedAt: D(80), signature: sigDataUrl(), lines: [['Kovana ograja po meri', 18, 160], ['Nadstrešek polikarbonat', 12, 95], ['Montaža', 18, 45]] },
    { code: 'PON-2026-005', projectId: projects[4].id, customerId: cs[4].id, status: 'POSLAN', lines: [['Varnostna ograja igrišče', 65, 72], ['Vrata s samozapiranjem', 2, 320]] }
  ]
  const quotes = []
  for (const q of quoteDefs) {
    const lines = q.lines.map(([description, qty, unitPrice]) => ({ description, qty, unitPrice, total: qty * unitPrice }))
    const subtotal = lines.reduce((s, l) => s + l.total, 0)
    const vat = Math.round(subtotal * 0.22 * 100) / 100
    const { lines: _l, ...head } = q // podpis (signature/signedAt/signedBy) se prenese v create
    quotes.push(await db.quote.create({ data: { ...head, subtotal, vat, total: subtotal + vat, lines: { create: lines } } }))
  }

  console.log('[seed] naseljujem račune in plačila …')
  const invoices = await Promise.all([
    db.invoice.create({ data: { code: 'RA-2026-001', projectId: projects[0].id, quoteId: quotes[0].id, status: 'PLACAN', subtotal: quotes[0].subtotal, vat: quotes[0].vat, total: quotes[0].total, paid: quotes[0].total, dueDate: new Date('2026-09-20') } }),
    db.invoice.create({ data: { code: 'RA-2026-002', projectId: projects[3].id, quoteId: quotes[3].id, status: 'DELNO_PLACAN', subtotal: quotes[3].subtotal, vat: quotes[3].vat, total: quotes[3].total, paid: 1000, dueDate: new Date('2026-10-15') } }),
    db.invoice.create({ data: { code: 'RA-2026-003', projectId: projects[4].id, quoteId: quotes[4].id, status: 'IZDAN', subtotal: quotes[4].subtotal, vat: quotes[4].vat, total: quotes[4].total, paid: 0, dueDate: new Date('2026-11-01') } })
  ])
  await db.payment.create({ data: { invoiceId: invoices[0].id, amount: quotes[0].total, method: 'NAKAZNICA', reference: 'NAR-2026-991' } })
  await db.payment.create({ data: { invoiceId: invoices[1].id, amount: 1000, method: 'NAKAZNICA', reference: 'NAR-2026-992' } })

  console.log('[seed] naseljujem naloge (terenski tok) …')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tom = new Date(today); tom.setDate(tom.getDate() + 1)
  const wos = await Promise.all([
    db.workOrder.create({ data: { code: 'N-2026-001', projectId: projects[0].id, title: 'Montaža ograje — Novak, 1. dan', status: 'V_TEKU', assigneeId: monter.id, scheduledFor: today, startedAt: new Date(Date.now() - 3600000 * 3) } }),
    db.workOrder.create({ data: { code: 'N-2026-002', projectId: projects[4].id, title: 'Zajem mer — vrtec Sonček', status: 'V_ZAJEMU', assigneeId: monter.id, scheduledFor: today, startedAt: new Date(Date.now() - 3600000 * 5) } }),
    db.workOrder.create({ data: { code: 'N-2026-003', projectId: projects[1].id, title: 'Dostava stekla — Horvat', status: 'NAPROGRAMIRAN', assigneeId: monter.id, scheduledFor: tom } }),
    db.workOrder.create({ data: { code: 'N-2026-004', projectId: projects[5].id, title: 'Predmontaža stopnišča', status: 'V_PREVERI', assigneeId: monter.id, scheduledFor: today } }),
    db.workOrder.create({ data: { code: 'N-2026-005', projectId: projects[0].id, title: 'Montaža ograje — Novak, 2. dan', status: 'NAPROGRAMIRAN', assigneeId: monter.id, scheduledFor: tom } }),
    db.workOrder.create({ data: { code: 'N-2026-006', projectId: projects[3].id, title: 'Zaključna kontrola — Kovač', status: 'ZAKLJUCEN', assigneeId: monter.id, scheduledFor: new Date(Date.now() - 86400000 * 6), completedAt: new Date(Date.now() - 86400000 * 6), summary: 'Vse v redu, oddano.' } }),
    db.workOrder.create({ data: { code: 'N-2026-007', projectId: projects[2].id, title: 'Kontrolni pregled balkonov — Zvezda', status: 'NAPROGRAMIRAN', assigneeId: vodja.id, scheduledFor: new Date(Date.now() + 86400000 * 3) } })
  ])
  await db.workOrderEvent.createMany({ data: [
    { workOrderId: wos[0].id, userId: monter.id, type: 'DODELJEN', note: 'Dodeljeno monterju Luki' },
    { workOrderId: wos[0].id, userId: monter.id, type: 'ZACETEK', note: 'ZAČNI DELO — Na terenu' },
    { workOrderId: wos[1].id, userId: monter.id, type: 'ZACETEK', note: 'ZAČNI DELO' },
    { workOrderId: wos[1].id, userId: monter.id, type: 'ZAJEM', note: 'ZAJEM — merjenje igrišča' },
    { workOrderId: wos[5].id, userId: monter.id, type: 'ZAKLJUCEK', note: 'ZAKLJUČI TEREN' },
    { workOrderId: wos[6].id, userId: vodja.id, type: 'KOMENTAR', note: 'Dogovor z naročnikom — pregled vseh 48 balkonov pred naročilom materiala' }
  ] })

  console.log('[seed] naseljujem meritve …')
  await db.measurement.createMany({ data: [
    { projectId: projects[0].id, workOrderId: wos[0].id, authorId: monter.id, type: 'OGRAJA', location: 'Terasa — severna stran', lengthCm: 1240, heightCm: 110, posts: 9, segments: 4, handrail: true, note: 'Nagib terase 3°' },
    { projectId: projects[1].id, authorId: monter.id, type: 'BALUSTRADA', location: 'Dnevna soba', lengthCm: 480, heightCm: 95, posts: 0, segments: 2, handrail: true },
    { projectId: projects[4].id, workOrderId: wos[1].id, authorId: monter.id, type: 'OGRAJA', location: 'Igrišče — obod', lengthCm: 3200, heightCm: 120, posts: 22, segments: 8, handrail: false, slopeDeg: 2.5 },
    { projectId: projects[5].id, workOrderId: wos[3].id, authorId: monter.id, type: 'OGRAJA', location: 'Stopnišče — nadstropje 1', lengthCm: 860, heightCm: 100, posts: 6, segments: 3, handrail: true, slopeDeg: 38 }
  ] })

  console.log('[seed] naseljujem katalog profilov …')
  await db.profile.createMany({ data: [
    { sku: 'ALU-L-80', name: 'Alu L-profil 80×80', material: 'ALU', type: 'OGRAJA', pricePerM: 89, description: 'Anodiziran aluminij, RAL po naročilu' },
    { sku: 'ALU-OKR-60', name: 'Alu okrogli profil Ø60', material: 'ALU', type: 'OGRAJA', pricePerM: 76 },
    { sku: 'INOX-V2A-50', name: 'Inox cev V2A Ø50.8', material: 'INOX', type: 'OGRAJA', pricePerM: 120, description: 'Ploščato brusena izvedba' },
    { sku: 'INOX-BAL-10', name: 'Inox balustrada 10 mm steklo', material: 'STIKLO', type: 'BALUSTRADA', pricePerM: 145 },
    { sku: 'KOV-TRAD', name: 'Kovana ograja — tradicionalna', material: 'KOVANO ŽELEZO', type: 'OGRAJA', pricePerM: 160 },
    { sku: 'KOV-MOD', name: 'Kovana ograja — moderna', material: 'KOVANO ŽELEZO', type: 'OGRAJA', pricePerM: 175 },
    { sku: 'ALU-NAG-45', name: 'Alu nagibna ograja 45°', material: 'ALU', type: 'NAGIBNA', pricePerM: 95 },
    { sku: 'STIK-8-CL', name: 'Steklena stena 8 mm clear', material: 'STIKLO', type: 'BALUSTRADA', pricePerM: 130 },
    { sku: 'ALU-ROK-42', name: 'Alu ročaj Ø42', material: 'ALU', type: 'OGRAJA', pricePerM: 32 },
    { sku: 'INOX-ROK-42', name: 'Inox ročaj Ø42', material: 'INOX', type: 'OGRAJA', pricePerM: 48 },
    { sku: 'ALU-VR-100', name: 'Vrata ALU 1000 mm', material: 'ALU', type: 'OGRAJA', pricePerM: 320 },
    { sku: 'PRAG-ALU', name: 'Prag alu 40 mm', material: 'ALU', type: 'OGRAJA', pricePerM: 28 }
  ] })

  console.log('[seed] naseljujem zalogo …')
  const items = await Promise.all([
    db.inventoryItem.create({ data: { sku: 'ALU-L-80-6M', name: 'Alu L-profil 80×80, 6 m', unit: 'kos', qty: 42, reorderAt: 12, location: 'A-01' } }),
    db.inventoryItem.create({ data: { sku: 'ALU-OKR-60-6M', name: 'Alu okrogli profil Ø60, 6 m', unit: 'kos', qty: 8, reorderAt: 15, location: 'A-02' } }),
    db.inventoryItem.create({ data: { sku: 'INOX-50-6M', name: 'Inox cev V2A Ø50.8, 6 m', unit: 'kos', qty: 24, reorderAt: 8, location: 'B-01' } }),
    db.inventoryItem.create({ data: { sku: 'STIK-10-CL', name: 'Steklo 10 mm clear', unit: 'm2', qty: 36, reorderAt: 10, location: 'C-01' } }),
    db.inventoryItem.create({ data: { sku: 'RAL-7016', name: 'Barva RAL 7016 antracit', unit: 'l', qty: 18, reorderAt: 6, location: 'D-01' } }),
    db.inventoryItem.create({ data: { sku: 'VIJ-INOX-M8', name: 'Vijaki inox M8×60', unit: 'kos', qty: 950, reorderAt: 200, location: 'D-02' } }),
    db.inventoryItem.create({ data: { sku: 'LEP-MS', name: 'Lepilo za steklo MS', unit: 'kos', qty: 4, reorderAt: 10, location: 'D-03' } }),
    db.inventoryItem.create({ data: { sku: 'ALU-ROK-42-6M', name: 'Alu ročaj Ø42, 6 m', unit: 'kos', qty: 30, reorderAt: 10, location: 'A-03' } }),
    db.inventoryItem.create({ data: { sku: 'TES-SIL', name: 'Tesnilo silikon črno', unit: 'kos', qty: 120, reorderAt: 30, location: 'D-04' } }),
    db.inventoryItem.create({ data: { sku: 'ANC-M12', name: 'Sidrni kotički M12', unit: 'kos', qty: 65, reorderAt: 50, location: 'D-05' } })
  ])
  const suppliers = await Promise.all([
    db.supplier.create({ data: { name: 'AluPro d.o.o.', email: 'nabava@alupro.si', phone: '01 222 33 44' } }),
    db.supplier.create({ data: { name: 'InoxTrade s.r.o.', email: 'objednavky@inoxtrade.cz', phone: '+420 555 112 233' } }),
    db.supplier.create({ data: { name: 'Steklarna Vegova', email: 'info@steklarna-vegova.si', phone: '02 444 55 66' } })
  ])
  await db.stockLot.createMany({ data: [
    { itemId: items[0].id, qty: 30, unitCost: 52, supplierId: suppliers[0].id },
    { itemId: items[0].id, qty: 12, unitCost: 54, supplierId: suppliers[0].id },
    { itemId: items[2].id, qty: 24, unitCost: 88, supplierId: suppliers[1].id },
    { itemId: items[3].id, qty: 36, unitCost: 95, supplierId: suppliers[2].id },
    { itemId: items[7].id, qty: 30, unitCost: 19, supplierId: suppliers[0].id }
  ] })
  await db.materialPrice.createMany({ data: [
    { itemId: items[0].id, supplierId: suppliers[0].id, price: 54 },
    { itemId: items[2].id, supplierId: suppliers[1].id, price: 88 },
    { itemId: items[3].id, supplierId: suppliers[2].id, price: 95 }
  ] })

  console.log('[seed] naseljujem CRM …')
  const leads = await Promise.all([
    db.lead.create({ data: { customerId: null, name: 'Simon Vidmar', email: 'simon.vidmar@gmail.com', phone: '041 555 666', source: 'SPLET', status: 'NOV', note: 'Vprašanje prek spletne forme — ograja za hišo' } }),
    db.lead.create({ data: { customerId: null, name: 'Mojca Kos', email: 'mojca.kos@siol.net', phone: '031 444 333', source: 'PRIPOROČILO', status: 'KONTAKTIRAN', note: 'Priporočila sosedka (Novak)' } }),
    db.lead.create({ data: { customerId: cs[6].id, name: 'SD Rožna dolina — obnova', source: 'TELEFON', status: 'KVALIFIKACIJAN', note: 'Obnova ograj okoli treh blokov' } })
  ])
  await db.opportunity.createMany({ data: [
    { leadId: leads[0].id, title: 'Ograja hiša Vidmar', stage: 'PONUDBA', value: 4200, probability: 60, expectedClose: new Date('2026-10-20') },
    { leadId: leads[1].id, title: 'Terasa Kos — balustrada', stage: 'KVALIFIKACIJA', value: 2600, probability: 30, expectedClose: new Date('2026-11-05') },
    { leadId: leads[2].id, title: 'SD Rožna dolina — 3 bloki', stage: 'POGAJANJA', value: 18500, probability: 75, expectedClose: new Date('2026-10-30') }
  ] })

  console.log('[seed] naseljujem proizvodnjo …')
  await db.productionOrder.createMany({ data: [
    { code: 'PR-2026-001', projectId: projects[0].id, title: 'Izdelava segmentov ograje — Novak', status: 'V_IZDELAVI', dueAt: new Date(Date.now() + 86400000 * 2) },
    { code: 'PR-2026-002', projectId: projects[1].id, title: 'Rez stekla — Horvat', status: 'DOKONCAN', dueAt: new Date(Date.now() - 86400000) },
    { code: 'PR-2026-003', projectId: projects[5].id, title: 'Zvar stopniščnega okvirja — Zajc', status: 'NAVRTEN', dueAt: new Date(Date.now() + 86400000 * 5) }
  ] })
  const prods = await db.productionOrder.findMany({ orderBy: { code: 'asc' } })

  console.log('[seed] naseljujem kontrolo kakovosti (R434) …')
  await db.qcCheck.createMany({ data: [
    { productionOrderId: prods[0].id, item: 'Vertikalnost stebričev (±0,5°)', result: 'OK', userId: proizvodnja.id, note: 'Izmerjeno na 3 mestih' },
    { productionOrderId: prods[0].id, item: 'Zvarni šivi — vizualna kontrola', result: 'OK', userId: proizvodnja.id },
    { productionOrderId: prods[0].id, item: 'Praškarski premaz — debelina sloja', result: 'V_TEKU', userId: proizvodnja.id, note: 'Čaka na sušenje 2. sloja' },
    { productionOrderId: prods[1].id, item: 'Dimenzije stekla po nalogu', result: 'OK', userId: proizvodnja.id },
    { productionOrderId: prods[1].id, item: 'Robni obdelava — poliranje', result: 'NOK', userId: proizvodnja.id, note: 'Odstopanje na 2. robu — potrebna ponovna obdelava' },
    { productionOrderId: prods[1].id, item: 'Zaščitna folija nameščena', result: 'OK', userId: proizvodnja.id }
  ] })

  console.log('[seed] naseljujem garancije (R434) …')
  const gar1 = await db.warranty.create({ data: { projectId: projects[3].id, startsAt: D(6), months: 24, status: 'AKTIVNA', note: 'Kovana ograja + nadstrešek — standardna garancija' } })
  const gar2 = await db.warranty.create({ data: { projectId: projects[7].id, startsAt: new Date(Date.now() - 86400000 * 800), months: 24, status: 'AKTIVNA', note: 'Vrtna ograja — garancija na premaz' } })
  await db.warrantyVisit.createMany({ data: [
    { warrantyId: gar1.id, date: D(2), note: 'Pregled po predaji — brez pripomb', userId: vodja.id },
    { warrantyId: gar1.id, date: new Date(Date.now() + 86400000 * 60), note: 'Naročen pregled tesnila na nadstrešku (kontrola)', userId: vodja.id },
    { warrantyId: gar2.id, date: new Date(Date.now() - 86400000 * 200), note: 'Reklamacija — popravek premaza na 1 stebru', userId: monter.id }
  ] })

  console.log('[seed] naseljujem orodjarino …')
  const eq = await Promise.all([
    db.equipment.create({ data: { code: 'OR-001', name: 'Laserski daljinomer Leica DISTO D2', category: 'MERITEV', serialNumber: 'LD2-88412', status: 'NA_VOLJO', location: 'Skladišče — polica A1', calibrationDue: new Date(Date.now() + 86400000 * 90), note: 'Domet 100 m, meri tudi poševno' } }),
    db.equipment.create({ data: { code: 'OR-002', name: 'Digitalna vodovaga 120 cm', category: 'MERITEV', serialNumber: 'VV-120-77', status: 'IZPOSOJENO', holderId: monter.id, location: 'Teren — Novak', calibrationDue: new Date(Date.now() + 86400000 * 30) } }),
    db.equipment.create({ data: { code: 'OR-003', name: 'Digitalni kotnik s kontrolno lučko', category: 'MERITEV', serialNumber: 'KN-45-210', status: 'NA_VOLJO', location: 'Skladišče — predal M2' } }),
    db.equipment.create({ data: { code: 'OR-004', name: 'Merilni kolut 20 m', category: 'MERITEV', serialNumber: 'MK-20-004', status: 'NA_VOLJO', location: 'Skladišče — predal M1', calibrationDue: new Date(Date.now() - 86400000 * 10), note: 'ROK UMERITVE POTEKEL — preveriti' } }),
    db.equipment.create({ data: { code: 'OR-005', name: 'Vrtalni stroj Bosch GBH 2-28', category: 'MONTAZA', serialNumber: 'GBH-228-551', status: 'IZPOSOJENO', holderId: monter.id, location: 'Teren — vrtec Sonček' } }),
    db.equipment.create({ data: { code: 'OR-006', name: 'Kotna brusilka Metabo W 750', category: 'MONTAZA', serialNumber: 'W750-3321', status: 'V_SERVISU', location: 'Servis — d.o.o. Elektro Celje', note: 'Zamenjava ležaja, prihodnost teden' } }),
    db.equipment.create({ data: { code: 'EV-001', name: 'Detektor podzemnih instalacij Bosch GMS 120', category: 'PREVERITEV', serialNumber: 'GMS-120-89', status: 'NA_VOLJO', location: 'Skladišče — polica A3', calibrationDue: new Date(Date.now() + 86400000 * 150) } }),
    db.equipment.create({ data: { code: 'OR-007', name: 'Libela nivojska 180 cm', category: 'VZDRZEVANJE', status: 'POKVARJENO', location: 'Skladišče — za popravilo', note: 'Zračni mehurček počil' } })
  ])
  await db.equipmentCheckout.createMany({ data: [
    { equipmentId: eq[1].id, userId: monter.id, outAt: new Date(Date.now() - 86400000 * 2), note: 'Terenski dan — terasa Novak' },
    { equipmentId: eq[4].id, userId: monter.id, outAt: new Date(Date.now() - 86400000), note: 'Vrtanje stebrov — vrtec' },
    { equipmentId: eq[0].id, userId: vodja.id, outAt: new Date(Date.now() - 86400000 * 30), inAt: new Date(Date.now() - 86400000 * 27), note: 'Kontrolni pregled objekta' },
    { equipmentId: eq[3].id, userId: monter.id, outAt: new Date(Date.now() - 86400000 * 60), inAt: new Date(Date.now() - 86400000 * 58) },
    { equipmentId: eq[6].id, userId: proizvodnja.id, outAt: new Date(Date.now() - 86400000 * 14), inAt: new Date(Date.now() - 86400000 * 13), note: 'Preverjanje kablov pred rezom' }
  ] })

  console.log('[seed] naseljujem galerijo zaključenih del …')
  await db.measurement.createMany({ data: [
    { projectId: projects[3].id, authorId: monter.id, type: 'FOTO', location: 'Ograja — vhod, Kovač', note: 'Zaključeno delo: kovana ograja + nadstrešek', params: JSON.stringify({ photo: fotoSvg('Kovana ograja — vhod', '#2b3a4e', '#c9a227', 9, true) }) },
    { projectId: projects[3].id, authorId: monter.id, type: 'FOTO', location: 'Nadstrešek — dvorišče, Kovač', note: 'Polikarbonatna plošča, odvod na desno', params: JSON.stringify({ photo: fotoSvg('Nadstrešek — dvorišče', '#37475e', '#9fb4cc', 0, false) }) },
    { projectId: projects[7].id, authorId: vodja.id, type: 'FOTO', location: 'Vrtna ograja — Pri Lipi', note: 'Zaključeno + predano stranki', params: JSON.stringify({ photo: fotoSvg('Vrtna ograja — Pri Lipi', '#4a5a48', '#d9c9a3', 11, false) }) }
  ] })

  console.log('[seed] naseljujem portal stranke (R435) …')
  await db.portalLink.createMany({ data: [
    { token: 'pt-kovac-2026-demo', projectId: projects[3].id, note: 'Poslano na e-pošto po predaji dela', views: 7, lastViewedAt: new Date(Date.now() - 86400000 * 2), expiresAt: new Date(Date.now() + 86400000 * 60) },
    { token: 'pt-horvat-2026-staro', projectId: projects[1].id, note: 'Zamenjano z novo povezavo', views: 3, expiresAt: new Date(Date.now() - 86400000 * 45), revokedAt: new Date(Date.now() - 86400000 * 40) }
  ] })

  console.log('[seed] naseljujem vzdrževalna opravila (R435) …')
  await db.jobRun.createMany({ data: [
    { job: 'seje-gc', ok: true, affected: 2, detail: JSON.stringify({ note: 'cron (izvirnik) — potekle seje' }), startedAt: new Date(Date.now() - 86400000 * 1.2), finishedAt: new Date(Date.now() - 86400000 * 1.2 + 400) },
    { job: 'obvestila-gc', ok: true, affected: 0, detail: JSON.stringify({ note: 'cron (izvirnik) — prebrana obvestila > 30 dni' }), startedAt: new Date(Date.now() - 86400000 * 1.2), finishedAt: new Date(Date.now() - 86400000 * 1.2 + 120) }
  ] })

  console.log('[seed] naseljujem revizijo in obvestila …')
  await db.auditLog.createMany({ data: [
    { userId: admin.id, action: 'SETUP_COMPLETE', entity: 'sistem', detail: JSON.stringify({ note: 'Inicialna nastavitev' }) },
    { userId: admin.id, action: 'USER_ROLE_CHANGE', entity: 'user', entityId: monter.id, detail: JSON.stringify({ from: 'MONTER', to: 'MONTER', note: 'potrditev po setupu' }) },
    { userId: vodja.id, action: 'QUOTE_ISSUE', entity: 'quote', entityId: quotes[1].id, projectId: projects[1].id, detail: JSON.stringify({ code: 'PON-2026-002' }) },
    { userId: monter.id, action: 'WO_TRANSITION', entity: 'workOrder', entityId: wos[0].id, projectId: projects[0].id, detail: JSON.stringify({ from: 'NAPROGRAMIRAN', to: 'V_TEKU' }) },
    { userId: skladisce.id, action: 'STOCK_LOT_ADD', entity: 'inventoryItem', entityId: items[0].id, detail: JSON.stringify({ qty: 12, unitCost: 54 }) },
    { userId: proizvodnja.id, action: 'PRODUCTION_STATUS', entity: 'productionOrder', detail: JSON.stringify({ code: 'PR-2026-002', to: 'DOKONCAN' }) },
    { userId: proizvodnja.id, action: 'QC_CHECK', entity: 'productionOrder', entityId: prods[1].id, projectId: projects[1].id, detail: JSON.stringify({ item: 'Robni obdelava — poliranje', result: 'NOK' }) },
    { userId: vodja.id, action: 'WARRANTY_VISIT', entity: 'warranty', entityId: gar1.id, projectId: projects[3].id, detail: JSON.stringify({ note: 'Redni letni pregled' }) },
    { userId: admin.id, action: 'PAYMENT_RECORD', entity: 'invoice', entityId: invoices[0].id, projectId: projects[0].id, detail: JSON.stringify({ amount: quotes[0].total }) }
  ] })
  await db.notification.createMany({ data: [
    { userId: monter.id, title: 'Nov nalog dodeljen', body: 'N-2026-003 — Dostava stekla, Horvat (jutri)' },
    { userId: vodja.id, title: 'Nizka zaloga', body: 'Lepilo za steklo MS — pod mejo naročila (4/10)' },
    { userId: admin.id, title: 'Delno plačan račun', body: 'RA-2026-002 — prejeto 1.000,00 € od 4.542,60 €' }
  ] })

  console.log('[seed] naseljujem inženirska pravila, nabavo, prisotnost in ankete (R437) …')
  // inženirska pravila (uporabljena v izračunih geometrije/3D konfiguratorja)
  await db.engineeringRule.createMany({ data: [
    { key: 'max_razdalja_stebrov', label: 'Največja razdalja med stebri', value: 120, unit: 'cm', note: 'EN 1990 — togost konstrukcije' },
    { key: 'min_razdalja_stebrov', label: 'Najmanjša razdalja med stebri', value: 60, unit: 'cm' },
    { key: 'visina_ograje_min', label: 'Najmanjša višina ograje', value: 90, unit: 'cm', note: 'SIST EN 1264 (bivalne stavbe)' },
    { key: 'visina_ograje_max', label: 'Največja višina ograje', value: 110, unit: 'cm' },
    { key: 'max_nagib_rocnika', label: 'Največji nagib ročnika ob stopnišču', value: 45, unit: '°' },
    { key: 'max_prostor_steklo', label: 'Največji nepodprti prostor stekla', value: 80, unit: 'cm', note: '8 mm laminirano steklo' }
  ] })
  // naročila materiala (nabava) — eno prejeto (z losi v zalogi prek seeda zgoraj), eno poslano
  await db.materialOrder.createMany({ data: [
    { code: 'NAR-2026-001', supplierId: suppliers[0].id, status: 'PREJETO', createdBy: skladisce.id, note: 'Redna dobava profilov', sentAt: new Date(Date.now() - 86400000 * 9), receivedAt: new Date(Date.now() - 86400000 * 7) },
    { code: 'NAR-2026-002', supplierId: suppliers[1].id, status: 'POSLANO', createdBy: skladisce.id, note: 'Steklo za Kovač — nujno', sentAt: new Date(Date.now() - 86400000 * 1) }
  ] })
  const narocila = await db.materialOrder.findMany({ orderBy: { code: 'asc' } })
  await db.materialOrderLine.createMany({ data: [
    { orderId: narocila[0].id, itemId: items[0].id, itemName: items[0].name, qty: 30, unit: 'm', unitPrice: 52 },
    { orderId: narocila[0].id, itemId: items[7].id, itemName: items[7].name, qty: 20, unit: 'kos', unitPrice: 19 },
    { orderId: narocila[1].id, itemId: items[2].id, itemName: items[2].name, qty: 12, unit: 'm²', unitPrice: 88 }
  ] })
  // prisotnost — včerajšnji dan ekipe
  const vceraj = new Date(Date.now() - 86400000)
  const vcerajDan = vceraj.toISOString().slice(0, 10)
  await db.punchEntry.createMany({ data: [
    { userId: monter.id, day: vcerajDan, inAt: new Date(Date.now() - 86400000 * 1 + 7.5 * 3600000), outAt: new Date(Date.now() - 86400000 * 1 + 16 * 3600000), note: 'Terena Novak + Horvat' },
    { userId: proizvodnja.id, day: vcerajDan, inAt: new Date(Date.now() - 86400000 * 1 + 6 * 3600000), outAt: new Date(Date.now() - 86400000 * 1 + 14 * 3600000) },
    { userId: vodja.id, day: vcerajDan, inAt: new Date(Date.now() - 86400000 * 1 + 8 * 3600000), outAt: new Date(Date.now() - 86400000 * 1 + 17 * 3600000) }
  ] })
  // ankete / povpraševanja
  await db.survey.createMany({ data: [
    { name: 'Simon Vidmar', email: 'simon.vidmar@gmail.com', phone: '041 555 666', type: 'OGRAJA', lengthCm: 1800, location: 'Ljubljana — Vič', message: 'Zanima me nerjaveča ograja okoli vrta, prosim za ponudbo.' },
    { name: 'Anja Zupan', email: 'anja.zupan@gmail.com', type: 'STOPNISCE', lengthCm: 650, location: 'Domžale', message: 'Notranja stopniščna ograja, kovinska, belo lakirana.', handled: true },
    { name: 'Tadej Košir', phone: '051 222 111', type: 'TERASA', lengthCm: 1200, location: 'Kranj', message: 'Lesena terasa z stekleno ograjo na vhodni strani.' }
  ] })

  console.log('[seed] demo podatki naseljeni (uporabniki, stranke, projekti, zaloga, profili) ✓')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())

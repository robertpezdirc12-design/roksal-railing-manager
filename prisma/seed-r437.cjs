// seed-r437.cjs — enkratni dodatek R437 podatkov v OBSTOJEČO demo bazo (idempotentno)
// Uporaba: node prisma/seed-r437.cjs
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main () {
  // ── inženirska pravila ───────────────────────────────────────────────────
  const rulesCount = await db.engineeringRule.count()
  if (rulesCount === 0) {
    await db.engineeringRule.createMany({ data: [
      { key: 'max_razdalja_stebrov', label: 'Največja razdalja med stebri', value: 120, unit: 'cm', note: 'EN 1990 — togost konstrukcije' },
      { key: 'min_razdalja_stebrov', label: 'Najmanjša razdalja med stebri', value: 60, unit: 'cm' },
      { key: 'visina_ograje_min', label: 'Najmanjša višina ograje', value: 90, unit: 'cm', note: 'SIST EN 1264 (bivalne stavbe)' },
      { key: 'visina_ograje_max', label: 'Največja višina ograje', value: 110, unit: 'cm' },
      { key: 'max_nagib_rocnika', label: 'Največji nagib ročnika ob stopnišču', value: 45, unit: '°' },
      { key: 'max_prostor_steklo', label: 'Največji nepodprti prostor stekla', value: 80, unit: 'cm', note: '8 mm laminirano steklo' }
    ] })
    console.log('[seed-r437] inženirska pravila: 6')
  } else console.log('[seed-r437] pravila že obstajajo:', rulesCount)

  // ── naročila materiala ───────────────────────────────────────────────────
  const ordersCount = await db.materialOrder.count()
  if (ordersCount === 0) {
    const [skladisce, ...suppliersRaw] = await Promise.all([
      db.user.findFirst({ where: { role: 'SKLADISCE' } }),
      db.supplier.findMany({ orderBy: { name: 'asc' } }),
      db.inventoryItem.findMany({ orderBy: { sku: 'asc' } })
    ])
    const suppliers = suppliersRaw[0] ?? []
    const items = (suppliersRaw[1] ?? []).filter((i) => i)
    const profil = items.find((i) => i.sku?.toLowerCase().includes('prof') && i.unit === 'm') ?? items[0]
    const steklo = items.find((i) => i.unit === 'm²') ?? items[2]
    const pribor = items[items.length - 1] ?? items[7]
    await db.materialOrder.createMany({ data: [
      { code: 'NAR-2026-001', supplierId: suppliers[0]?.id ?? null, status: 'PREJETO', createdBy: skladisce?.id ?? null, note: 'Redna dobava profilov', sentAt: new Date(Date.now() - 86400000 * 9), receivedAt: new Date(Date.now() - 86400000 * 7) },
      { code: 'NAR-2026-002', supplierId: suppliers[1]?.id ?? null, status: 'POSLANO', createdBy: skladisce?.id ?? null, note: 'Steklo za Kovač — nujno', sentAt: new Date(Date.now() - 86400000 * 1) }
    ] })
    const narocila = await db.materialOrder.findMany({ orderBy: { code: 'asc' } })
    await db.materialOrderLine.createMany({ data: [
      { orderId: narocila[0].id, itemId: profil?.id ?? null, itemName: profil?.name ?? 'Profil RO-40×40', qty: 30, unit: 'm', unitPrice: 52 },
      { orderId: narocila[0].id, itemId: pribor?.id ?? null, itemName: pribor?.name ?? 'Spojnik 90°', qty: 20, unit: 'kos', unitPrice: 19 },
      { orderId: narocila[1].id, itemId: steklo?.id ?? null, itemName: steklo?.name ?? 'Steklo 8 mm', qty: 12, unit: 'm²', unitPrice: 88 }
    ] })
    console.log('[seed-r437] naročila materiala: 2 (3 pozicije)')
  } else console.log('[seed-r437] naročila že obstajajo:', ordersCount)

  // ── prisotnost (včeraj) ──────────────────────────────────────────────────
  const punchCount = await db.punchEntry.count()
  if (punchCount === 0) {
    const users = await db.user.findMany({ where: { active: true }, take: 3 })
    const dan = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    await db.punchEntry.createMany({ data: users.map((u, ix) => ({
      userId: u.id,
      day: dan,
      inAt: new Date(Date.now() - 86400000 + (6 + ix * 0.75) * 3600000),
      outAt: new Date(Date.now() - 86400000 + (14 + ix) * 3600000),
      note: ix === 0 ? 'Terenski dan' : null
    })) })
    console.log('[seed-r437] prisotnost:', users.length)
  } else console.log('[seed-r437] prisotnost že obstaja:', punchCount)

  // ── ankete ────────────────────────────────────────────────────────────────
  const surveysCount = await db.survey.count()
  if (surveysCount === 0) {
    await db.survey.createMany({ data: [
      { name: 'Simon Vidmar', email: 'simon.vidmar@gmail.com', phone: '041 555 666', type: 'OGRAJA', lengthCm: 1800, location: 'Ljubljana — Vič', message: 'Zanima me nerjaveča ograja okoli vrta, prosim za ponudbo.' },
      { name: 'Anja Zupan', email: 'anja.zupan@gmail.com', type: 'STOPNISCE', lengthCm: 650, location: 'Domžale', message: 'Notranja stopniščna ograja, kovinska, belo lakirana.', handled: true },
      { name: 'Tadej Košir', phone: '051 222 111', type: 'TERASA', lengthCm: 1200, location: 'Kranj', message: 'Lesena terasa s stekleno ograjo na vhodni strani.' }
    ] })
    console.log('[seed-r437] ankete: 3')
  } else console.log('[seed-r437] ankete že obstajajo:', surveysCount)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())

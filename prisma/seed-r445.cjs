// seed-r445.cjs — issue #7 §9 P1 DELIVERY + INSTALLATION: vozila, ekipe/podizvajalci,
// dostave in ekipa na obstoječem nalogu (v OBSTOJEČO demo bazo, idempotentno).
// Vzorec po seed-r442.cjs. Uporaba: node prisma/seed-r445.cjs
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

// ── 1. vozila (issue #7 §9: registracija, ime, nosilnost) ─────────────────────
const VEHICLES = [
  { plate: 'LJ 552-KP', name: 'Fiat Ducato — odprt', capacityNote: '≈ 14 m³, nosilnost 1.200 kg' },
  { plate: 'KR 817-TM', name: 'Renault Master — zaprt', capacityNote: '≈ 11 m³, zaprt prostor za profile' },
  { plate: 'MB 204-DN', name: 'Prikolica odprta', capacityNote: '≈ 8 m dolg material, klančnik' },
]

// ── 2. ekipe in podizvajalci (regija, tipi del, razpoložljivost, cena, kakovost, zgodovina) ──
const CREWS = [
  {
    name: 'Ekipa Novak', type: 'INTERNA', region: 'Gorenjska',
    contactName: 'Luka Novak', contactPhone: '041 234 567', contactEmail: null,
    workTypes: 'terase, ograje', availabilityNote: 'interni monterji — razpored prek nalogov',
    priceNote: 'interni strošek (ure)', rating: 5, active: true,
    note: 'Glavna montažna ekipa; brez reklamacij v 2026.',
  },
  {
    name: 'Ekipa Kovač', type: 'INTERNA', region: 'Ljubljana in okolica',
    contactName: 'Matej Kovač', contactPhone: '031 987 654', contactEmail: null,
    workTypes: 'fasade, napušči, stropi', availabilityNote: 'interni monterji — razpored prek nalogov',
    priceNote: 'interni strošek (ure)', rating: 4, active: true,
    note: 'Fasade in napušči; dodatna izobraževanja iz visečih odrov.',
  },
  {
    name: 'Alu-Mont d.o.o.', type: 'PODIZVAJALEC', region: 'Gorenjska',
    contactName: 'Aleš Zupan', contactPhone: '041 555 123', contactEmail: 'info@alumont.si',
    workTypes: 'terase, ograje, fasade', availabilityNote: 'prosti od 15. 10. 2026',
    priceNote: '26 €/m² teras (dogovor 2026)', rating: 4, active: true,
    note: 'Zanesljivi pri terminih; reklamacija 03/2026 (šum na zaključnem profilu) rešena v 5 dneh.',
  },
  {
    name: 'Inox Obala s.p.', type: 'PODIZVAJALEC', region: 'Obala',
    contactName: 'Marino Kos', contactPhone: '040 222 333', contactEmail: 'marino@inoxobala.si',
    workTypes: 'inox ograje, balkoni', availabilityNote: 'kapaciteta 2 ekipi; po dogovoru',
    priceNote: '30 €/m inox ograj (referenca 2025)', rating: 5, active: true,
    note: 'Specialisti za inox v obalnem okolju; brez reklamacij.',
  },
]

// koda <prefix><leto>-<NNN> iz zasedenih (enaka logika kot lib/codes.ts)
function nextCode (existing, prefix) {
  const year = new Date().getFullYear()
  const full = `${prefix}${year}-`
  const used = new Set(existing.filter((c) => c.startsWith(full)))
  let next = used.size + 1
  while (used.has(`${full}${String(next).padStart(3, '0')}`)) next++
  return `${full}${String(next).padStart(3, '0')}`
}

async function main () {
  // ── vozila (idempotentno po registrski) ────────────────────────────────────
  let nVeh = 0
  for (const v of VEHICLES) {
    const found = await db.vehicle.findUnique({ where: { plate: v.plate } })
    if (!found) { await db.vehicle.create({ data: v }); nVeh++ }
  }
  console.log('[seed-r445] vozila: nova', nVeh, '· skupaj', await db.vehicle.count())

  // ── ekipe (idempotentno po imenu) ──────────────────────────────────────────
  let nCrew = 0
  for (const c of CREWS) {
    const found = await db.crew.findFirst({ where: { name: c.name } })
    if (!found) { await db.crew.create({ data: c }); nCrew++ }
  }
  console.log('[seed-r445] ekipe: nove', nCrew, '· skupaj', await db.crew.count())

  // ── ekipa na obstoječem nalogu (NE razbijemo ničesar — samo crewId) ────────
  const wo = await db.workOrder.findUnique({ where: { code: 'N-2026-005' }, select: { id: true, crewId: true } })
  const interna = await db.crew.findFirst({ where: { name: 'Ekipa Novak', type: 'INTERNA' } })
  if (wo && interna && !wo.crewId) {
    await db.workOrder.update({ where: { id: wo.id }, data: { crewId: interna.id } })
    console.log('[seed-r445] nalog N-2026-005 → ekipa:', interna.name)
  } else {
    console.log('[seed-r445] naloga N-2026-005 ni (ali že ima ekipo) — preskočeno')
  }

  // ── dostave (samo če jih še ni — demo par po vzorcu seed-r442 paketov) ────
  const delCount = await db.delivery.count()
  if (delCount > 0) {
    console.log('[seed-r445] dostave že obstajajo:', delCount, '— preskočeno')
    return
  }

  const admin = await db.user.findUnique({ where: { email: 'admin@roksal.si' }, select: { id: true } })
  const monter = await db.user.findUnique({ where: { email: 'monter@roksal.si' }, select: { id: true } })
  const vehicle = await db.vehicle.findUnique({ where: { plate: 'LJ 552-KP' } })

  const existingCodes = (await db.delivery.findMany({ select: { code: true } })).map((d) => d.code)

  // 1) NACRTOVANO — iz ZAKLJUČENE picking liste (vrstice s POBRANIMI količinami,
  //    EKSPlicitni itemId; projekt prek BOM → paket)
  const picks = await db.pickingList.findMany({
    where: { status: 'ZAKLJUCENA' },
    orderBy: { createdAt: 'asc' },
    include: {
      lines: { orderBy: { sortOrder: 'asc' }, include: { item: true } },
      bom: { select: { code: true, package: { select: { code: true, name: true, project: { select: { id: true, code: true, title: true, address: true } } } } } },
    },
  })
  const pick = picks.find((p) => p.lines.some((l) => l.qtyPicked > 0))
  if (pick && admin) {
    const project = pick.bom?.package?.project ?? null
    const code1 = nextCode(existingCodes, 'DEL-')
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0)
    const d1 = await db.delivery.create({
      data: {
        code: code1, status: 'NACRTOVANO',
        projectId: project?.id ?? null,
        pickingListId: pick.id,
        plannedAt: tomorrow,
        address: project?.address ?? null,
        note: `Material za termin montaže ${project ? `na ${project.code}` : ''} (iz ${pick.code}).`,
        createdBy: admin.id,
        items: {
          create: pick.lines
            .filter((l) => l.qtyPicked > 0)
            .map((l) => ({
              itemId: l.itemId,
              description: `${l.item.sku} — ${l.item.name}`,
              qty: l.qtyPicked, unit: l.item.unit, note: l.note,
            })),
        },
      },
    })
    existingCodes.push(code1)
    console.log(`[seed-r445] dostava ${code1} NACRTOVANO: ${pick.lines.filter((l) => l.qtyPicked > 0).length} vrstic iz ${pick.code}${project ? `, projekt ${project.code}` : ''}`)
  } else {
    console.log('[seed-r445] ni primerne ZAKLJUČENE picking liste — prva dostava preskočena')
  }

  // 2) NA_POTI — voznik monter, pretekli časi (loadedAt/departedAt), ročne vrstice
  if (monter && vehicle) {
    const code2 = nextCode(existingCodes, 'DEL-')
    const now = Date.now()
    const h = 3600000
    const project = await db.project.findUnique({ where: { code: 'P-2026-005' }, select: { id: true, code: true, address: true } })
    const items = await db.inventoryItem.findMany({ where: { sku: { in: ['ALU-PROF-6060', 'VIJ-INOX-M8', 'ANC-M12'] } } })
    const bySku = new Map(items.map((i) => [i.sku, i]))
    const lines = [
      { sku: 'ALU-PROF-6060', qty: 42 },
      { sku: 'VIJ-INOX-M8', qty: 200 },
      { sku: 'ANC-M12', qty: 24 },
    ].filter((l) => bySku.has(l.sku))
    await db.delivery.create({
      data: {
        code: code2, status: 'NA_POTI',
        projectId: project?.id ?? null,
        vehicleId: vehicle.id,
        driverId: monter.id,
        plannedAt: new Date(now - 1 * h), // zamujena za uro — realističen prikaz toka
        loadedAt: new Date(now - 3 * h),
        departedAt: new Date(now - 2 * h),
        address: project?.address ?? 'Vrtec Sonček, Kranj',
        note: 'Dopoldanska dostava na teren vrtec; monter vozi sam.',
        createdBy: admin?.id ?? null,
        items: {
          create: lines.map((l) => {
            const it = bySku.get(l.sku)
            return { itemId: it.id, description: `${it.sku} — ${it.name}`, qty: l.qty, unit: it.unit }
          }),
        },
      },
    })
    console.log(`[seed-r445] dostava ${code2} NA_POTI: voznik monter, vozilo ${vehicle.plate}, ${lines.length} vrstic`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())

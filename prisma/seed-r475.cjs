// seed-r475 — R475 (issue #9 §5: KOLIČINE IZ SEGMENTOV)
// 1) inženirsko pravilo odpad_rez_pct (odpad pri rezanju profilov/polnil)
// 2) segmentne vloge na BOM predlogi OGR-P-001 (demo — prečna ograja):
//    ALU-PROF-6060 → POLNILO_M (2 m profila na m segmenta — 2 vrstici polnil),
//    ALU-STEBER-80 → STEBER (1 kos/steber; qty 0.34/m → 1),
//    ANC-M12       → STEBER (2 sidri/steber; qty ostane 2 — semantika kos/steber)
// Poganjanje: node prisma/seed-r475.cjs (idempotentno).
/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main () {
  // ── 1) pravilo odpada ──
  const waste = await p.engineeringRule.upsert({
    where: { key: 'odpad_rez_pct' },
    update: {},
    create: {
      key: 'odpad_rez_pct',
      label: 'Odpad pri rezanju profilov in polnil',
      value: 5,
      unit: '%',
      note: 'Rezerva za odrezke/žage pri rezanju na dolžino (R475, issue #9 §5)',
    },
  })
  console.log(`[seed-r475] pravilo odpad_rez_pct = ${waste.value} % (idempotentno)`)

  // ── 2) segmentne vloge na OGR-P-001 ──
  const product = await p.product.findUnique({ where: { sku: 'OGR-P-001' } })
  if (!product) {
    console.log('[seed-r475] OGR-P-001 manjka (seed-r442 ni pognan) — preskok vlog')
    return
  }
  const comps = await p.productComponent.findMany({
    where: { productId: product.id },
    include: { item: { select: { sku: true } } },
    orderBy: { sortOrder: 'asc' },
  })
  let n = 0
  for (const c of comps) {
    const sku = c.item.sku
    let role = null; let qty = c.qty; let note = c.note
    if (sku === 'ALU-PROF-6060') { role = 'POLNILO_M'; qty = 2.0 } // 2 vrstici polnil na m
    else if (sku === 'ALU-STEBER-80') { role = 'STEBER'; qty = 1; note = null } // 1 steber/steber (stara opomba o razmiku ne velja več)
    else if (sku === 'ANC-M12') { role = 'STEBER'; qty = 2 } // 2 sidri na steber
    else continue
    if (c.segmentRole === role && c.qty === qty && c.note === note) continue
    await p.productComponent.update({ where: { id: c.id }, data: { segmentRole: role, qty, note } })
    n++
    console.log(`[seed-r475] ${sku}: segmentRole=${role}, qty=${qty}`)
  }
  console.log(`[seed-r475] OGR-P-001: dodeljenih ${n} vlog (idempotentno)`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => p.$disconnect())

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'

// /api/material-suggestions — R452 (issue #7 §16 P3: AVTOMATSKI PREDLOG MATERIALA)
// GET (vrata inventory.read) — determinističen izračun predlogov naročila:
//   povpraševanje = Σ BomLine.qty po artikelu prek BOM-ov OSNUTEK/POTRJEN/REZERVIRAN
//     (REZERVIRAN BOM-i: njihove rezervacije že sedijo v »rezervirano«; PORABLJEN/
//     PREKLICAN izpuščeni — ne povprašujejo več)
//   fizična = InventoryItem.qty · rezervirano = Σ aktivnih StockReservation
//   razpoložljiva = max(fizična − rezervirano, 0)   ← invarianta R443 (§7)
//   manjka = max(povpraševanje − razpoložljiva, 0)
//   nizka zaloga = reorderAt > 0 IN fizična ≤ reorderAt
//   predlagana količina = max(manjka, nizka ? 2×reorderAt − fizična : 0, 0)
//   unitCost = uteženo povprečje pozitivnih lotov (§15: NIČ hardcoded cen),
//              fallback zadnja MaterialPrice, sicer 0
// V odgovoru so SAMO artikli z manjka > 0 ALI nizko zalogo, sortirani po
// (manjka × unitCost) padajoče, nato po imenu.

const DEMAND_STATUSES = ['OSNUTEK', 'POTRJEN', 'REZERVIRAN'] as const
const REPLENISH_FACTOR = 2

const round2 = (n: number) => Math.round(n * 100) / 100

interface SuggestionItem {
  itemId: string
  sku: string
  name: string
  unit: string
  demand: number
  reserved: number
  physical: number
  available: number
  missing: number
  lowStock: boolean
  suggestedQty: number
  unitCost: number
  supplierId: string | null
  supplierName: string | null
  boms: number
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  // 1) povpraševanje iz odprtih kosovnic (BomLine.qty je ŽE celotna količina BOM-a)
  const openBoms = await db.bom.findMany({
    where: { status: { in: [...DEMAND_STATUSES] } },
    select: { id: true, lines: { select: { itemId: true, qty: true } } },
  })
  const demand = new Map<string, number>()
  const bomIds = new Map<string, Set<string>>()
  for (const bom of openBoms) {
    for (const line of bom.lines) {
      demand.set(line.itemId, (demand.get(line.itemId) ?? 0) + line.qty)
      let set = bomIds.get(line.itemId)
      if (!set) { set = new Set(); bomIds.set(line.itemId, set) }
      set.add(bom.id)
    }
  }

  // 2) kandidati: artikli v povpraševanju ALI z mejami naročanja (lowStock se
  //    preveri kasneje — reorderAt > 0 je le pogoj kandidature)
  const demandIds = [...demand.keys()]
  const items = await db.inventoryItem.findMany({
    where: { OR: [{ id: { in: demandIds } }, { reorderAt: { gt: 0 } }] },
    include: {
      reservations: { where: { status: 'AKTIVNA' }, select: { qty: true } },
      lots: { select: { qty: true, unitCost: true, supplierId: true } },
      prices: { select: { price: true, supplierId: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { name: 'asc' },
  })

  const suppliers = await db.supplier.findMany({ select: { id: true, name: true } })
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]))

  const out: SuggestionItem[] = []
  for (const it of items) {
    const d = demand.get(it.id) ?? 0
    const reserved = it.reservations.reduce((s, r) => s + r.qty, 0)
    const available = Math.max(it.qty - reserved, 0)
    const missing = Math.max(d - available, 0)
    const lowStock = it.reorderAt > 0 && it.qty <= it.reorderAt
    if (missing <= 0 && !lowStock) continue // samo artikli, ki nekaj potrebujejo

    // nabavna cena: uteženo povprečje pozitivnih lotov → zadnja cenikovska → 0
    const posLots = it.lots.filter((l) => l.qty > 0)
    let unitCost = 0
    if (posLots.length > 0) {
      const qtySum = posLots.reduce((s, l) => s + l.qty, 0)
      unitCost = qtySum > 0 ? posLots.reduce((s, l) => s + l.qty * l.unitCost, 0) / qtySum : 0
    } else if (it.prices.length > 0) {
      unitCost = it.prices[0].price
    }

    // namig dobavitelja: najpogostejši med loti (deterministično), fallback cenik
    const counts = new Map<string, number>()
    for (const l of it.lots) {
      if (l.supplierId) counts.set(l.supplierId, (counts.get(l.supplierId) ?? 0) + 1)
    }
    let supplierId: string | null = null
    if (counts.size > 0) {
      supplierId = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]
    } else {
      const withSup = it.prices.find((p) => p.supplierId)
      supplierId = withSup?.supplierId ?? null
    }

    const uc = round2(unitCost)
    out.push({
      itemId: it.id,
      sku: it.sku,
      name: it.name,
      unit: it.unit,
      demand: round2(d),
      reserved: round2(reserved),
      physical: round2(it.qty),
      available: round2(available),
      missing: round2(missing),
      lowStock,
      suggestedQty: round2(Math.max(missing, lowStock ? REPLENISH_FACTOR * it.reorderAt - it.qty : 0, 0)),
      unitCost: uc,
      supplierId,
      supplierName: supplierId ? supplierName.get(supplierId) ?? null : null,
      boms: bomIds.get(it.id)?.size ?? 0,
    })
  }

  // sortiranje: (manjka × unitCost) padajoče, nato po imenu — stabilno/deterministično
  out.sort((a, b) => (b.missing * b.unitCost) - (a.missing * a.unitCost) || a.name.localeCompare(b.name))

  return NextResponse.json({
    data: {
      generatedAt: new Date().toISOString(),
      items: out,
      rules: {
        demandStatuses: [...DEMAND_STATUSES],
        replenishFactor: REPLENISH_FACTOR,
      },
    },
  })
}

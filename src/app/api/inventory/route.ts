import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// GET /api/inventory — seznam artiklov z losi + povprečno/zadnjo ceno (inventory.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const [items, prices, suppliers] = await Promise.all([
    db.inventoryItem.findMany({
      include: { lots: { orderBy: { deliveredAt: 'desc' } } },
      orderBy: { name: 'asc' },
    }),
    db.materialPrice.findMany({ orderBy: { createdAt: 'desc' } }),
    db.supplier.findMany({ select: { id: true, name: true } }),
  ])

  // supplierId je skalarno polje (brez relacije) → preslika ročno
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]))

  // zadnja cena po artiklu (najnovejši MaterialPrice)
  const lastPriceByItem = new Map<string, number>()
  for (const p of prices) {
    if (p.itemId && !lastPriceByItem.has(p.itemId)) lastPriceByItem.set(p.itemId, p.price)
  }

  const data = items.map((item) => {
    const lotsPositive = item.lots.filter((l) => l.qty > 0)
    const qtySum = lotsPositive.reduce((s, l) => s + l.qty, 0)
    const costSum = lotsPositive.reduce((s, l) => s + l.qty * l.unitCost, 0)
    const avgPrice = qtySum > 0 ? costSum / qtySum : 0
    const lastPrice = lastPriceByItem.get(item.id) ?? (item.lots[0]?.unitCost ?? 0)
    const lots = item.lots.map(({ supplierId, ...lot }) => ({
      ...lot,
      supplier: supplierId ? { name: supplierName.get(supplierId) ?? '—' } : null,
    }))
    return { ...item, lots, avgPrice, lastPrice }
  })

  return NextResponse.json({ data })
}

// PATCH /api/inventory — ročni popravek količine {id, delta} (inventory.write)
export async function PATCH (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  const delta = typeof body?.delta === 'number' ? body.delta : NaN
  if (!id) return jsonError(400, 'Manjka identifikator artikla.', 'Pričakovano polje id.')
  if (!Number.isFinite(delta) || delta === 0) return jsonError(400, 'Popravek mora biti število, različen od nič.', 'Pričakovano polje delta (npr. -3 ali 5).')

  const item = await db.inventoryItem.findUnique({ where: { id } })
  if (!item) return jsonError(404, 'Artikel ne obstaja.')

  const newQty = Math.round((item.qty + delta) * 1000) / 1000
  if (newQty < 0) return jsonError(400, 'Popravek bi povzročil negativno količino.', `Trenutna količina je ${item.qty} ${item.unit}.`)

  const updated = await db.inventoryItem.update({
    where: { id },
    data: { qty: newQty },
    include: { lots: { orderBy: { deliveredAt: 'desc' }, take: 1 } },
  })

  await writeAudit({
    userId: auth.user.id, action: 'INVENTORY_ADJUST', entity: 'inventoryItem', entityId: id,
    detail: { sku: item.sku, name: item.name, from: item.qty, delta, to: newQty },
  })
  return NextResponse.json({ data: updated })
}

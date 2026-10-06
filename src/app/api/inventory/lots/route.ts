import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// GET /api/inventory/lots — vsi losi z artiklom in dobaviteljem (inventory.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200)

  const [lots, suppliers] = await Promise.all([
    db.stockLot.findMany({
      include: { item: { select: { sku: true, name: true, unit: true } } },
      orderBy: { deliveredAt: 'desc' },
      take: limit,
    }),
    db.supplier.findMany({ select: { id: true, name: true } }),
  ])
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]))
  // supplierId je skalarno polje (brez relacije) → preslika ročno
  const data = lots.map(({ supplierId, ...lot }) => ({ ...lot, supplier: supplierId ? { name: supplierName.get(supplierId) ?? '—' } : null }))
  return NextResponse.json({ data })
}

// POST /api/inventory/lots — sprejem nove pošiljke {itemId, qty, unitCost, supplierId} (procurement.receive)
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'procurement.receive')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
  const qty = typeof body?.qty === 'number' ? body.qty : NaN
  const unitCost = typeof body?.unitCost === 'number' ? body.unitCost : NaN
  const supplierId = typeof body?.supplierId === 'string' && body.supplierId ? body.supplierId : null

  if (!itemId) return jsonError(400, 'Manjka artikel.', 'Pričakovano polje itemId.')
  if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'Količina mora biti pozitivno število.')
  if (!Number.isFinite(unitCost) || unitCost < 0) return jsonError(400, 'Nabavna cena mora biti nenegativno število.')

  const item = await db.inventoryItem.findUnique({ where: { id: itemId } })
  if (!item) return jsonError(404, 'Artikel ne obstaja.')
  if (supplierId) {
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } })
    if (!supplier) return jsonError(404, 'Dobavitelj ne obstaja.')
  }

  // lot + povečanje količine artikla + evidenca cene v isti transakciji
  const [lot] = await db.$transaction([
    db.stockLot.create({ data: { itemId, qty, unitCost, supplierId } }),
    db.inventoryItem.update({ where: { id: itemId }, data: { qty: { increment: qty } } }),
    db.materialPrice.create({ data: { itemId, supplierId, price: unitCost } }),
  ])

  await writeAudit({
    userId: auth.user.id, action: 'STOCK_LOT_ADD', entity: 'inventoryItem', entityId: itemId,
    detail: { sku: item.sku, name: item.name, qty, unitCost, supplierId, lotId: lot.id },
  })
  return NextResponse.json({ data: lot }, { status: 201 })
}

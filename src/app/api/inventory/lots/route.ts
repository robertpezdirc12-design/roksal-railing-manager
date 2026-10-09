import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { runStockTx } from '@/lib/stock-core'

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

  // lot + povečanje količine artikla + evidenca cene + DNEVNIK GIBANJA (R443)
  // v isti transakciji (R464: interaktivna transakcija pod procesno ključavnico —
  // sočasni sprejmi pošiljk se brez izgubljenih posodobitev seštejejo)
  const lot = await runStockTx(async (tx) => {
    // atomarno povečanje (WHERE id preveri obstoj; increment je komutativen)
    const upd = await tx.inventoryItem.updateMany({
      where: { id: itemId },
      data: { qty: { increment: qty } },
    })
    if (upd.count !== 1) return null // artikel je bil medtem izbrisan → prazna transakcija
    const created = await tx.stockLot.create({ data: { itemId, qty, unitCost, supplierId } })
    await tx.materialPrice.create({ data: { itemId, supplierId, price: unitCost } })
    await tx.stockMovement.create({
      data: {
        itemId, qty, type: 'PREVZEM', userId: auth.user.id,
        refType: 'stockLot', note: `Sprejem pošiljke${supplierId ? ' (dobavitelj)' : ''}`,
      },
    })
    // R464: revizija V isti transakciji (atomarna s sprejemom)
    await writeAudit({
      userId: auth.user.id, action: 'STOCK_LOT_ADD', entity: 'inventoryItem', entityId: itemId,
      detail: { sku: item.sku, name: item.name, qty, unitCost, supplierId, lotId: created.id },
    }, tx)
    return created
  })
  if (!lot) return jsonError(404, 'Artikel ne obstaja več.')

  return NextResponse.json({ data: lot }, { status: 201 })
}

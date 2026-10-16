// API /api/material-prices — R437 (route-map izvirnik: material-prices + zgodovina)
// GET  seznam cen (inventory.read) — ?itemId= ?supplierId= ?zgodovina=1
// POST zapiši novo ceno { itemId?, supplierId?, price } (price.override) → revizija MATERIAL_PRICE_CREATE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const itemId = url.searchParams.get('itemId')
  const supplierId = url.searchParams.get('supplierId')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 1000)

  const prices = await db.materialPrice.findMany({
    where: {
      ...(itemId ? { itemId } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // imena artikelov/dobaviteljev (skalarne povezave → ročna preslika, vzorec iz /api/inventory)
  const [items, suppliers] = await Promise.all([
    db.inventoryItem.findMany({ select: { id: true, name: true, unit: true } }),
    db.supplier.findMany({ select: { id: true, name: true } }),
  ])
  const itemName = new Map(items.map((i) => [i.id, i]))
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]))

  const data = prices.map((p) => ({
    id: p.id,
    itemId: p.itemId,
    item: p.itemId ? itemName.get(p.itemId) ?? null : null,
    supplierId: p.supplierId,
    supplierName: p.supplierId ? supplierName.get(p.supplierId) ?? null : null,
    price: p.price,
    createdAt: p.createdAt,
  }))
  // zgodovina=1: kronološko naraščajoče (prikaz razvoja cene skozi čas)
  if (url.searchParams.get('zgodovina') === '1') data.reverse()

  return NextResponse.json({ data })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'price.override')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const itemId = typeof body?.itemId === 'string' && body.itemId ? body.itemId : null
  const supplierId = typeof body?.supplierId === 'string' && body.supplierId ? body.supplierId : null
  const price = Number(body?.price)

  if (!itemId) return jsonError(400, 'itemId je obvezen (cena velja za artikel).')
  if (!Number.isFinite(price) || price <= 0) return jsonError(400, 'Cena mora biti večja od 0.')
  const item = await db.inventoryItem.findUnique({ where: { id: itemId } })
  if (!item) return jsonError(404, 'Artikel ne obstaja.')
  if (supplierId) {
    const sup = await db.supplier.findUnique({ where: { id: supplierId } })
    if (!sup) return jsonError(404, 'Dobavitelj ne obstaja.')
  }

  // R539 (transakcijska celovitost): nova cena + revizija atomarno (vzorec
  // R537-d; predbranji artikel/dobavitelj ostajata izven tx).
  const created = await db.$transaction(async (tx) => {
    const created = await tx.materialPrice.create({ data: { itemId, supplierId, price } })
    await writeAudit({
      userId: auth.user.id,
      action: 'MATERIAL_PRICE_CREATE',
      entity: 'materialPrice',
      entityId: created.id,
      detail: { item: item.name, price, supplierId },
    }, tx)
    return created
  })
  return NextResponse.json({ data: created }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// POST /api/price-lists/[id]/rules — novo/posodobljeno pravilo cenika (price.override → revizija)
// Telo: { productId? | itemId?, price, unit?, discountPct?, minPrice?, seasonFrom?, seasonTo?, note? }
// EKSPlicitna ID povezava (productId/itemId) — ne imena.
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'price.override')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const list = await db.priceList.findUnique({ where: { id } })
  if (!list) return jsonError(404, 'Cenik ne obstaja.')

  const body = await req.json().catch(() => null)
  const productId = typeof body?.productId === 'string' && body.productId ? body.productId : null
  const itemId = typeof body?.itemId === 'string' && body.itemId ? body.itemId : null
  const price = typeof body?.price === 'number' ? body.price : NaN

  if (!productId && !itemId) return jsonError(400, 'Pravilo potrebuje productId ali itemId (eksplicitna povezava).')
  if (productId && itemId) return jsonError(400, 'Pravilo velja za en cilj — productId ALI itemId.')
  if (!Number.isFinite(price) || price < 0) return jsonError(400, 'Cena mora biti nenegativno število.')

  if (productId) {
    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) return jsonError(404, 'Izdelek ne obstaja.')
  }
  if (itemId) {
    const item = await db.inventoryItem.findUnique({ where: { id: itemId } })
    if (!item) return jsonError(404, 'Artikel ne obstaja.')
  }

  const data = {
    price,
    unit: typeof body?.unit === 'string' ? body.unit : 'm2',
    discountPct: Number.isFinite(body?.discountPct) ? Math.min(Math.max(body.discountPct, 0), 100) : 0,
    minPrice: Number.isFinite(body?.minPrice) ? body.minPrice : null,
    seasonFrom: typeof body?.seasonFrom === 'string' && /^\d{2}-\d{2}$/.test(body.seasonFrom) ? body.seasonFrom : null,
    seasonTo: typeof body?.seasonTo === 'string' && /^\d{2}-\d{2}$/.test(body.seasonTo) ? body.seasonTo : null,
    note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
  }

  // idempotentna (po cilju v ceniku) posodobitev obstoječega pravila
  const existing = await db.priceRule.findFirst({ where: { priceListId: id, productId, itemId } })
  const rule = existing
    ? await db.priceRule.update({ where: { id: existing.id }, data })
    : await db.priceRule.create({ data: { priceListId: id, productId, itemId, ...data } })

  await writeAudit({
    userId: auth.user.id, action: existing ? 'PRICE_RULE_UPDATE' : 'PRICE_RULE_CREATE',
    entity: 'priceRule', entityId: rule.id,
    detail: { priceList: list.name, productId, itemId, price: data.price, discountPct: data.discountPct },
  })
  return NextResponse.json({ data: rule }, { status: existing ? 200 : 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { KONFIG_PRICE_KEYS, konfigRuleNote, type KonfigPriceKey } from '@/lib/product-core'

type Params = { params: Promise<{ id: string }> }

// POST /api/price-lists/[id]/rules — novo/posodobljeno pravilo cenika (price.override → revizija)
// Telo: { productId? | itemId? | key?, price, unit?, discountPct?, minPrice?, seasonFrom?, seasonTo?, note? }
// EKSPlicitna ID povezava (productId/itemId) — ne imena. R464 (issue #1): podpira
// tudi GENERIČNA konfiguracijska pravila (key: STEBER|ROCNIK|STEKLO|MONTAZA|
// PRIPRAVA|PROFIL_OCENA → note = "KONFIG:<key>", brez produkta/artikla) —
// konfiguratorjeve ocene so od sedaj čisti podatki cenika.
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'price.override')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const list = await db.priceList.findUnique({ where: { id } })
  if (!list) return jsonError(404, 'Cenik ne obstaja.')

  const body = await req.json().catch(() => null)
  const productId = typeof body?.productId === 'string' && body.productId ? body.productId : null
  const itemId = typeof body?.itemId === 'string' && body.itemId ? body.itemId : null
  const key = typeof body?.key === 'string' && body.key ? body.key.trim().toUpperCase() : ''
  const price = typeof body?.price === 'number' ? body.price : NaN

  if (key && (productId || itemId)) {
    return jsonError(400, 'Pravilo je ALI vezano na produkt/artikel ALI konfiguracijsko (key) — ne oboje.')
  }
  if (!key && !productId && !itemId) return jsonError(400, 'Pravilo potrebuje productId, itemId ali konfiguracijski key.')
  if (key && !(KONFIG_PRICE_KEYS as readonly string[]).includes(key)) {
    return jsonError(400, `Neznan konfiguracijski key (${KONFIG_PRICE_KEYS.join(', ')}).`)
  }
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
    unit: typeof body?.unit === 'string' ? body.unit : key ? defaultKonfigUnit(key as KonfigPriceKey) : 'm2',
    discountPct: Number.isFinite(body?.discountPct) ? Math.min(Math.max(body.discountPct, 0), 100) : 0,
    minPrice: Number.isFinite(body?.minPrice) ? body.minPrice : null,
    seasonFrom: typeof body?.seasonFrom === 'string' && /^\d{2}-\d{2}$/.test(body.seasonFrom) ? body.seasonFrom : null,
    seasonTo: typeof body?.seasonTo === 'string' && /^\d{2}-\d{2}$/.test(body.seasonTo) ? body.seasonTo : null,
    note: key
      ? konfigRuleNote(key as KonfigPriceKey)
      : typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
  }

  // idempotentna posodobitev obstoječega pravila — po cilju v ceniku
  // (generična pravila po note = KONFIG:<key>, vezana po productId/itemId)
  const existing = await db.priceRule.findFirst({
    where: key
      ? { priceListId: id, productId: null, itemId: null, note: konfigRuleNote(key as KonfigPriceKey) }
      : { priceListId: id, productId, itemId },
  })
  // R539 (transakcijska celovitost): pravilo (update ali create) + revizija
  // atomarno v ENI transakciji (vzorec R537-d; predbranje `existing` izven tx).
  const rule = await db.$transaction(async (tx) => {
    const rule = existing
      ? await tx.priceRule.update({ where: { id: existing.id }, data })
      : await tx.priceRule.create({ data: { priceListId: id, productId, itemId, ...data } })
    await writeAudit({
      userId: auth.user.id, action: existing ? 'PRICE_RULE_UPDATE' : 'PRICE_RULE_CREATE',
      entity: 'priceRule', entityId: rule.id,
      detail: { priceList: list.name, productId, itemId, key: key || null, price: data.price, discountPct: data.discountPct },
    }, tx)
    return rule
  })
  return NextResponse.json({ data: rule }, { status: existing ? 200 : 201 })
}

/** Fizična enota konfiguracijskega parametra (PRIPRAVA v %, ostalo kos/m/m2). */
function defaultKonfigUnit (key: KonfigPriceKey): string {
  switch (key) {
    case 'STEBER': return 'kos'
    case 'ROCNIK': case 'MONTAZA': case 'PROFIL_OCENA': return 'm'
    case 'STEKLO': return 'm2'
    case 'PRIPRAVA': return '%'
  }
}

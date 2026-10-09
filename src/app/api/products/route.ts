import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { FAMILY_CODES } from '@/lib/product-core'

const UNITS = ['m2', 'm', 'kos']

// GET /api/products?family=TERASA&q=… — izdelki po družini (catalog.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.read')
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const family = sp.get('family')
  const q = (sp.get('q') ?? '').trim()

  const products = await db.product.findMany({
    where: {
      active: true,
      ...(family && family !== 'all' ? { family: { code: family } } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { sku: 'asc' },
    include: {
      family: { select: { code: true, name: true, unit: true } },
      variants: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
      _count: { select: { components: true, packages: true } },
    },
  })
  return NextResponse.json({ data: products })
}

// POST /api/products — nov izdelek (catalog.write; občutljiva mutacija → revizija)
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const sku = typeof body?.sku === 'string' ? body.sku.trim().toUpperCase() : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const familyCode = typeof body?.familyCode === 'string' ? body.familyCode : ''
  const unit = typeof body?.unit === 'string' && UNITS.includes(body.unit) ? body.unit : 'm2'
  const costPrice = typeof body?.costPrice === 'number' ? body.costPrice : NaN
  const salePrice = typeof body?.salePrice === 'number' ? body.salePrice : NaN

  if (!sku) return jsonError(400, 'SKU izdelka je obvezen.')
  if (!name) return jsonError(400, 'Ime izdelka je obvezno.')
  if (!(FAMILY_CODES as readonly string[]).includes(familyCode)) return jsonError(400, 'Neznana produktna družina.')
  if (!Number.isFinite(costPrice) || costPrice < 0) return jsonError(400, 'Nabavna cena mora biti nenegativno število.')
  if (!Number.isFinite(salePrice) || salePrice < 0) return jsonError(400, 'Prodajna cena mora biti nenegativno število.')

  const family = await db.productFamily.findUnique({ where: { code: familyCode } })
  if (!family) return jsonError(404, 'Družina ne obstaja.')

  const dupe = await db.product.findUnique({ where: { sku } })
  if (dupe) return jsonError(409, `SKU ${sku} že obstaja.`, 'Izberite drugo kodo izdelka.')

  const product = await db.product.create({
    data: {
      familyId: family.id, sku, name, unit,
      desc: typeof body?.desc === 'string' && body.desc.trim() ? body.desc.trim() : null,
      widthMm: Number.isFinite(body?.widthMm) ? Number(body.widthMm) : null,
      heightMm: Number.isFinite(body?.heightMm) ? Number(body.heightMm) : null,
      costPrice, salePrice,
      warrantyMonths: Number.isFinite(body?.warrantyMonths) ? Math.max(0, Math.trunc(body.warrantyMonths)) : 24,
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'PRODUCT_CREATE', entity: 'product', entityId: product.id,
    detail: { sku, name, familyCode, unit, costPrice, salePrice },
  })
  return NextResponse.json({ data: product }, { status: 201 })
}

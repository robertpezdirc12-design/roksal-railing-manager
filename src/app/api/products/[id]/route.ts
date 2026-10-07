import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// GET /api/products/[id] — podrobnost: variante, komponente (BOM predloga), veljavne cene
export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'catalog.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const product = await db.product.findUnique({
    where: { id },
    include: {
      family: { select: { code: true, name: true, unit: true } },
      variants: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
      components: { orderBy: { sortOrder: 'asc' }, include: { item: true } },
      _count: { select: { packages: true, boms: true } },
    },
  })
  if (!product) return jsonError(404, 'Izdelek ne obstaja.')

  return NextResponse.json({ data: product })
}

// PATCH /api/products/[id] — urejanje osnovnih podatkov/cen (catalog.write → revizija)
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'catalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const existing = await db.product.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Izdelek ne obstaja.')

  const body = await req.json().catch(() => null)
  const patch: Record<string, unknown> = {}
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body?.desc === 'string') patch.desc = body.desc.trim() || null
  if (typeof body?.active === 'boolean') patch.active = body.active
  if (typeof body?.warrantyMonths === 'number' && Number.isFinite(body.warrantyMonths)) patch.warrantyMonths = Math.max(0, Math.trunc(body.warrantyMonths))
  for (const key of ['costPrice', 'salePrice'] as const) {
    if (typeof body?.[key] === 'number') {
      if (!Number.isFinite(body[key]) || body[key] < 0) return jsonError(400, `${key} mora biti nenegativno število.`)
      patch[key] = body[key]
    }
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  const updated = await db.product.update({ where: { id }, data: patch })
  await writeAudit({
    userId: auth.user.id, action: 'PRODUCT_UPDATE', entity: 'product', entityId: id,
    detail: { sku: existing.sku, ...patch },
  })
  return NextResponse.json({ data: updated })
}

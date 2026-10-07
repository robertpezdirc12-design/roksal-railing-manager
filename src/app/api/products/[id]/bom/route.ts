import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { planBom } from '@/lib/product-core'

type Params = { params: Promise<{ id: string }> }

// POST /api/products/[id]/bom — suhi zagon BOM (quotes.create: kalkulacija z maržo)
// Telo: { qty, variantId?, includeOptional? } → strukturiran načrt z eksplicitnimi ID.
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const qty = typeof body?.qty === 'number' ? body.qty : NaN
  const plan = await planBom({
    productId: id,
    variantId: typeof body?.variantId === 'string' && body.variantId ? body.variantId : null,
    qty,
    includeOptional: body?.includeOptional !== false,
  })
  if ('error' in plan) return jsonError(400, plan.error)
  return NextResponse.json({ data: plan })
}

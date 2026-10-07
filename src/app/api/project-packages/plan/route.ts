import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { planBom } from '@/lib/product-core'

// POST /api/project-packages/plan — DRY-RUN izračun konfiguratorja (R447, issue #7 §5)
// TANEK wrapper okoli product-core.planBom — brez podvajanja logike, BREZ pisanja v bazo.
// Tok: PRODUCT → VARIANT → MEASUREMENTS (qty) → COLOR/OPTIONS (includeOptional)
//       → CALCULATE → BOM vrstice → STOCK CHECK (covered/missing) → PRICE/MARGIN.
// Vrata: quotes.create (pisarna) — rezultat vsebuje nabavne cene in maržo,
// zato monter/terenske vloge dobi 403 (enako kot ostale kalkulacijske poti).
// Telo: { productId, variantId?, qty, includeOptional? } → { data: BomPlan + family }
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const productId = typeof body?.productId === 'string' ? body.productId : ''
  const variantId = typeof body?.variantId === 'string' && body.variantId ? body.variantId : null
  const qty = typeof body?.qty === 'number' ? body.qty : NaN
  const includeOptional = body?.includeOptional !== false // privzeto vključi (enako kot BOM generacija)

  if (!productId) return jsonError(400, 'productId je obvezen.')
  if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'Količina mora biti pozitivno število.')

  // predogled izdelka samo za statusno kodo (404) in družino za odgovor;
  // sam izračun ostane V planBom (en vir resnice)
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, active: true, family: { select: { code: true, name: true, unit: true } } },
  })
  if (!product || !product.active) return jsonError(404, 'Izdelek ne obstaja ali ni aktiven.')

  const plan = await planBom({ productId, variantId, qty, includeOptional })
  if ('error' in plan) return jsonError(400, plan.error)

  return NextResponse.json({ data: { ...plan, family: product.family } })
}

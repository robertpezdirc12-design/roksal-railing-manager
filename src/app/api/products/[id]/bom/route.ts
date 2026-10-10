import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { planBom } from '@/lib/product-core'
import { normalizeSegments, type RawSegmentRow } from '@/lib/segment-bom'

type Params = { params: Promise<{ id: string }> }

// POST /api/products/[id]/bom — suhi zagon BOM (quotes.create: kalkulacija z maržo)
// Telo: { qty, variantId?, includeOptional?,
//         segments?: [{ kljuc?, dolzina (m), visina? (m) }],  // R475
//         razmikStebrovM?: number }                            // R475
// → strukturiran načrt z eksplicitnimi ID.
// R475 (issue #9 §5 — količine iz segmentov): segmenti (m-forma konfiguratorja)
// se normalizirajo v cm s ključi seg-N; komponente z segmentRole dobijo
// količine PO SEGMENTU (stebri iz razmika, dolžine/ploščine z odpadom).
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const qty = typeof body?.qty === 'number' ? body.qty : NaN

  // R475: segmenti (dolžine v m → cm; ključi po vrstnem redu, če manjkajo)
  const segments = normalizeSegments(Array.isArray(body?.segments) ? body?.segments as RawSegmentRow[] : [])
  const spacingCm = typeof body?.razmikStebrovM === 'number' && body.razmikStebrovM > 0
    ? Math.round(body.razmikStebrovM * 100)
    : null

  const plan = await planBom({
    productId: id,
    variantId: typeof body?.variantId === 'string' && body.variantId ? body.variantId : null,
    qty,
    includeOptional: body?.includeOptional !== false,
    ...(segments.length > 0 ? { segments, ...(spacingCm != null ? { spacingCm } : {}) } : {}),
  })
  if ('error' in plan) return jsonError(400, plan.error)
  return NextResponse.json({ data: plan })
}

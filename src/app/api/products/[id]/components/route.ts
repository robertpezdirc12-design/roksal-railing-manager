import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { SEGMENT_ROLES } from '@/lib/segment-bom'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/products/[id]/components — R475 (issue #9 §5): dodeljevanje
// SEGMENTNE VLOGE komponenti BOM predloge (catalog.write).
// Telo: { componentId, segmentRole: 'STEBER'|'ROCNIK'|'POLNILO_M'|'POLNILO_M2'|null,
//         qty?: number }
//  • segmentRole = vloga komponente v segmentni matematiki (količine po
//    odseku iz tekača/konfiguratorja). Null odstrani vlogo (predloga × qty).
//  • qty = množitelj na enoto vloge (kos/steber oz. m/m oz. m²/m²) —
//    PRILAGODITEV ob spremembi vloge (semantika qty se spremeni!).
// Revizija: COMPONENT_ROLE_SET z before/after.
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'catalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const componentId = typeof body?.componentId === 'string' ? body.componentId : ''
  if (!componentId) return jsonError(400, 'Manjka componentId.')

  const role = body?.segmentRole === null ? null : body?.segmentRole
  if (role != null && !(SEGMENT_ROLES as readonly string[]).includes(role)) {
    return jsonError(400, `Neznana segmentna vloga. Dovoljene: ${SEGMENT_ROLES.join(', ')} ali null.`)
  }
  let qty: number | undefined
  if (body?.qty !== undefined) {
    if (typeof body.qty !== 'number' || !Number.isFinite(body.qty) || body.qty <= 0) {
      return jsonError(400, 'Količina (množitelj na enoto vloge) mora biti pozitivno število.')
    }
    qty = body.qty
  }

  const comp = await db.productComponent.findUnique({
    where: { id: componentId },
    include: { product: { select: { id: true, sku: true } }, item: { select: { sku: true, name: true } } },
  })
  if (!comp || comp.productId !== id) return jsonError(404, 'Komponenta ne pripada temu izdelku.')

  const updated = await db.productComponent.update({
    where: { id: componentId },
    data: {
      segmentRole: role,
      ...(qty !== undefined ? { qty } : {}),
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'COMPONENT_ROLE_SET', entity: 'productComponent', entityId: componentId,
    projectId: null,
    detail: {
      productSku: comp.product.sku, itemSku: comp.item.sku,
      before: { segmentRole: comp.segmentRole, qty: comp.qty },
      after: { segmentRole: updated.segmentRole, qty: updated.qty },
    },
  })

  return NextResponse.json({ data: { id: updated.id, segmentRole: updated.segmentRole, qty: updated.qty } })
}

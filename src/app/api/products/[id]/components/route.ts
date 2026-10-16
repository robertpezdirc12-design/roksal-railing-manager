import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import { SEGMENT_ROLES } from '@/lib/segment-bom'

type Params = { params: Promise<{ id: string }> }

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// componentId obvezen niz (kot prej — brez trim), segmentRole: veljavna vloga
// | null (odvzem) | nedoločeno (brez spremembe) — neznana vrednost ⇒ 400 z
// istim sporočilom (kot prej); qty (če je podan) mora biti pozitivno število
// (kot prej — niz, ki ni število, se zavrne, brez coerce).
const ComponentRoleSchema = z.object({
  componentId: z.string({ error: 'Manjka componentId.' }).min(1, 'Manjka componentId.'),
  segmentRole: z.enum(SEGMENT_ROLES, { error: `Neznana segmentna vloga. Dovoljene: ${SEGMENT_ROLES.join(', ')} ali null.` }).nullable().optional(),
  qty: z.number({ error: 'Količina (množitelj na enoto vloge) mora biti pozitivno število.' }).positive('Količina (množitelj na enoto vloge) mora biti pozitivno število.').optional(),
})

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

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, ComponentRoleSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const comp = await db.productComponent.findUnique({
    where: { id: data.componentId },
    include: { product: { select: { id: true, sku: true } }, item: { select: { sku: true, name: true } } },
  })
  if (!comp || comp.productId !== id) return jsonError(404, 'Komponenta ne pripada temu izdelku.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // dodelitev vloge + revizija COMPONENT_ROLE_SET v ENI transakciji.
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.productComponent.update({
      where: { id: data.componentId },
      data: {
        segmentRole: data.segmentRole,
        ...(data.qty !== undefined ? { qty: data.qty } : {}),
      },
    })

    await writeAudit({
      userId: auth.user.id, action: 'COMPONENT_ROLE_SET', entity: 'productComponent', entityId: data.componentId,
      projectId: null,
      detail: {
        productSku: comp.product.sku, itemSku: comp.item.sku,
        before: { segmentRole: comp.segmentRole, qty: comp.qty },
        after: { segmentRole: updated.segmentRole, qty: updated.qty },
      },
    }, tx)
    return updated
  })

  return NextResponse.json({ data: { id: updated.id, segmentRole: updated.segmentRole, qty: updated.qty } })
}

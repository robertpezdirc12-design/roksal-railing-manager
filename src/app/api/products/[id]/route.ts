import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

type Params = { params: Promise<{ id: string }> }

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// delni PATCH — vsa polja neobvezna; prazno ime/opis po trim se tiho preskoči
// (kot prej), opis ⇒ trim ali null, ceni (če sta podani kot števili) morata
// biti nenegativni — sicer 400 (kot prej), garancija: število ⇒ max(0, trunc)
// (kot prej), neveljavna vrednost se preskoči (kot prej).
const ProductPatchSchema = z.object({
  name: z.string({ error: 'Ime mora biti besedilo.' }).trim().optional().transform((v) => v || undefined),
  desc: z.string({ error: 'Opis mora biti besedilo.' }).nullish().transform((v) => (v === undefined ? undefined : v?.trim() || null)),
  active: z.boolean({ error: 'active mora biti logična vrednost (boolean).' }).optional(),
  warrantyMonths: z.unknown().transform((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : undefined)),
  costPrice: z.number({ error: 'costPrice mora biti nenegativno število.' }).nonnegative('costPrice mora biti nenegativno število.').nullish().transform((v) => v ?? undefined),
  salePrice: z.number({ error: 'salePrice mora biti nenegativno število.' }).nonnegative('salePrice mora biti nenegativno število.').nullish().transform((v) => v ?? undefined),
})

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

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, ProductPatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const patch: Record<string, unknown> = {}
  if (data.name !== undefined) patch.name = data.name
  if (data.desc !== undefined) patch.desc = data.desc
  if (data.active !== undefined) patch.active = data.active
  if (data.warrantyMonths !== undefined) patch.warrantyMonths = data.warrantyMonths
  if (data.costPrice !== undefined) patch.costPrice = data.costPrice
  if (data.salePrice !== undefined) patch.salePrice = data.salePrice
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // posodobitev izdelka + revizija PRODUCT_UPDATE v ENI transakciji.
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.product.update({ where: { id }, data: patch })
    await writeAudit({
      userId: auth.user.id, action: 'PRODUCT_UPDATE', entity: 'product', entityId: id,
      detail: { sku: existing.sku, ...patch },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

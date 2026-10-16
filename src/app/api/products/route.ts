import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import { FAMILY_CODES } from '@/lib/product-core'

const UNITS = ['m2', 'm', 'kos']

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// SKU/ime obvezna po trim (SKU → velike črke, kot prej), družina mora biti iz
// seznama (neznana ⇒ 400, kot prej), enota ima tihi privzetek m2 ob neznani
// vrednosti (kot prej), ceni morata biti nenegativni števili (kot prej),
// dimenzije/garancija: število ⇒ normalizirano (kot prej), sicer null/24.
const ProductCreateSchema = z.object({
  sku: z.string({ error: 'SKU izdelka je obvezen.' }).trim().min(1, 'SKU izdelka je obvezen.').transform((v) => v.toUpperCase()),
  name: z.string({ error: 'Ime izdelka je obvezno.' }).trim().min(1, 'Ime izdelka je obvezno.'),
  familyCode: z.enum(FAMILY_CODES, { error: 'Neznana produktna družina.' }),
  unit: z.unknown().transform((v) => (typeof v === 'string' && UNITS.includes(v) ? v : 'm2')),
  costPrice: z.number({ error: 'Nabavna cena mora biti nenegativno število.' }).nonnegative('Nabavna cena mora biti nenegativno število.'),
  salePrice: z.number({ error: 'Prodajna cena mora biti nenegativno število.' }).nonnegative('Prodajna cena mora biti nenegativno število.'),
  desc: z.string({ error: 'Opis mora biti besedilo.' }).nullish().transform((v) => v?.trim() || null),
  widthMm: z.unknown().transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)),
  heightMm: z.unknown().transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)),
  warrantyMonths: z.unknown().transform((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 24)),
})

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

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, ProductCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const family = await db.productFamily.findUnique({ where: { code: data.familyCode } })
  if (!family) return jsonError(404, 'Družina ne obstaja.')

  const dupe = await db.product.findUnique({ where: { sku: data.sku } })
  if (dupe) return jsonError(409, `SKU ${data.sku} že obstaja.`, 'Izberite drugo kodo izdelka.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // ustvarjanje izdelka + revizija PRODUCT_CREATE v ENI transakciji.
  const product = await db.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        familyId: family.id, sku: data.sku, name: data.name, unit: data.unit,
        desc: data.desc,
        widthMm: data.widthMm,
        heightMm: data.heightMm,
        costPrice: data.costPrice, salePrice: data.salePrice,
        warrantyMonths: data.warrantyMonths,
      },
    })

    await writeAudit({
      userId: auth.user.id, action: 'PRODUCT_CREATE', entity: 'product', entityId: product.id,
      detail: { sku: data.sku, name: data.name, familyCode: data.familyCode, unit: data.unit, costPrice: data.costPrice, salePrice: data.salePrice },
    }, tx)
    return product
  })
  return NextResponse.json({ data: product }, { status: 201 })
}

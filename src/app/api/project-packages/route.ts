import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextPackageCode, PACKAGE_STATUSES } from '@/lib/product-core'

// GET /api/project-packages?projectId=… — paketi projekta (projects.read)
// Varnost: kalkulacija (marža!) se prikaže SAMO vlogam z quotes.create.
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const projectId = sp.get('projectId')
  if (!projectId) return jsonError(400, 'projectId je obvezen.')

  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const packages = await db.projectPackage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    include: {
      product: { select: { sku: true, name: true, unit: true, family: { select: { code: true, name: true } } } },
      variant: { select: { sku: true, name: true } },
      bom: { select: { id: true, code: true, status: true, lines: { select: { id: true } } } },
      measurement: { select: { id: true, type: true, familyCode: true } },
    },
  })

  const canSeeCalc = auth.perms.includes('quotes.create')
  return NextResponse.json({
    data: packages.map((p) => ({
      ...p,
      calcJson: canSeeCalc ? p.calcJson : null, // marža ostaja v pisarni
    })),
  })
}

// POST /api/project-packages — nov paket (quotes.create → revizija)
// Telo: { projectId, productId, variantId?, name?, qty, unit?, note?, measurementId?,
//         status?, calcJson? }
// R447: calcJson (objekt) shrani strukturirane vhode konfiguratorja (inputs) in
// rezultat dry-run izračuna (plan). Ni nujno — če manjka, paket ostane brez kalkulacije.
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const productId = typeof body?.productId === 'string' ? body.productId : ''
  const variantId = typeof body?.variantId === 'string' && body.variantId ? body.variantId : null
  const qty = typeof body?.qty === 'number' ? body.qty : NaN
  const status = typeof body?.status === 'string' && (PACKAGE_STATUSES as readonly string[]).includes(body.status) ? body.status : 'POVPRAŠEVANJE'

  if (!projectId) return jsonError(400, 'projectId je obvezen.')
  if (!productId) return jsonError(400, 'productId je obvezen.')
  if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'Količina mora biti pozitivno število.')

  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')
  const product = await db.product.findUnique({ where: { id: productId }, include: { family: true } })
  if (!product || !product.active) return jsonError(404, 'Izdelek ne obstaja ali ni aktiven.')
  if (variantId) {
    const v = await db.productVariant.findUnique({ where: { id: variantId } })
    if (!v || v.productId !== product.id) return jsonError(400, 'Varianta ne pripada izdelku.')
  }

  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : `${product.family.name} — ${product.name}`

  // R447: strukturirana kalkulacija konfiguratorja (objekt → JSON niz); varovalka velikosti
  let calcJson: string | null = null
  if (body?.calcJson !== undefined && body?.calcJson !== null) {
    if (typeof body.calcJson !== 'object' || Array.isArray(body.calcJson)) {
      return jsonError(400, 'calcJson mora biti objekt (npr. { inputs, plan }).')
    }
    try {
      const serialized = JSON.stringify(body.calcJson)
      if (serialized.length > 128 * 1024) return jsonError(400, 'calcJson je prevelik (največ 128 kB).')
      calcJson = serialized
    } catch {
      return jsonError(400, 'calcJson ni veljaven JSON.')
    }
  }

  const pkg = await db.projectPackage.create({
    data: {
      code: await nextPackageCode(project.code),
      projectId, productId, variantId, name,
      qty, unit: product.unit, status,
      calcJson,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
      measurementId: typeof body?.measurementId === 'string' && body.measurementId ? body.measurementId : null,
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'PACKAGE_CREATE', entity: 'projectPackage', entityId: pkg.id,
    projectId,
    detail: { code: pkg.code, product: product.sku, variantId, qty, unit: pkg.unit, ...(calcJson ? { calcInputs: true } : {}) },
  })
  return NextResponse.json({ data: pkg }, { status: 201 })
}

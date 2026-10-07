import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextBomCode, planBom } from '@/lib/product-core'

type Params = { params: Promise<{ id: string }> }

// POST /api/project-packages/[id]/bom — generiraj in SHRANI kosovnico paketa
// (quotes.create → revizija BOM_GENERATE)
// Telo: { includeOptional? } — količina/product/variant vzame iz paketa.
// BOM vrstice vsebujejo EKSPlicitne itemId → InventoryItem (issue #7 §2).
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const pkg = await db.projectPackage.findUnique({
    where: { id },
    include: { bom: true, project: { select: { id: true, code: true } } },
  })
  if (!pkg) return jsonError(404, 'Paket ne obstaja.')

  const body = await req.json().catch(() => null)
  const plan = await planBom({
    productId: pkg.productId,
    variantId: pkg.variantId,
    qty: pkg.qty,
    includeOptional: body?.includeOptional !== false,
  })
  if ('error' in plan) return jsonError(400, plan.error)
  if (plan.lines.length === 0) {
    return jsonError(400, 'Izdelek nima definiranih komponent (BOM predloga je prazna).', 'Dodajte komponente v katalogu.')
  }

  // obstoječa kosovnica istega paketa se nadomesti (zgodovina ostane v reviziji)
  if (pkg.bom) {
    await db.bomLine.deleteMany({ where: { bomId: pkg.bom.id } })
    await db.bom.delete({ where: { id: pkg.bom.id } })
  }

  const bom = await db.bom.create({
    data: {
      code: await nextBomCode(),
      packageId: pkg.id,
      productId: pkg.productId,
      variantId: pkg.variantId,
      qty: pkg.qty,
      unit: pkg.unit,
      status: 'OSNUTEK',
      note: `Generirano iz predloge ${plan.product.sku}${plan.variant ? ` / ${plan.variant.sku}` : ''}`,
      lines: {
        create: plan.lines.map((l, i) => ({
          itemId: l.itemId, qty: l.qty, unit: l.unit, note: l.note, sortOrder: i,
        })),
      },
    },
  })

  // kalkulacija se shrani na paket (marža ostane v pisarni — issue #7 §12)
  const calc = {
    generatedAt: new Date().toISOString(),
    qty: plan.qty, unit: plan.unit,
    materialCost: plan.materialCost, montazaUnit: plan.montazaUnit,
    totalSale: plan.totalSale, margin: plan.margin, marginPct: plan.marginPct,
    priceSource: plan.priceSource,
    lines: plan.lines.length,
  }
  await db.projectPackage.update({
    where: { id: pkg.id },
    data: {
      calcJson: JSON.stringify(calc),
      status: pkg.status === 'KONFIGURACIJA' || pkg.status === 'IZMERA' ? 'KONFIGURACIJA' : pkg.status,
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'BOM_GENERATE', entity: 'bom', entityId: bom.id,
    projectId: pkg.projectId,
    detail: {
      code: bom.code, package: pkg.code, product: plan.product.sku,
      qty: plan.qty, unit: plan.unit, lines: plan.lines.length,
      materialCost: plan.materialCost, totalSale: plan.totalSale, marginPct: plan.marginPct,
    },
  })

  return NextResponse.json({
    data: {
      bom: { id: bom.id, code: bom.code, status: bom.status, qty: bom.qty, unit: bom.unit, lines: plan.lines },
      calc,
    },
  }, { status: 201 })
}

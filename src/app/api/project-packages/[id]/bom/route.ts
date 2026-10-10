import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextBomCode, planBom } from '@/lib/product-core'
import { invalidateQuotesForPackage } from '@/lib/quote-invalidation'

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

  // obstoječa kosovnica istega paketa se nadomesti (zgodovina ostaja v reviziji)
  // R443: NADOMEŠČANJE JE PREPUŠČENO SAMO "čistim" kosovnicam — če ima aktivne
  // rezervacije, povezane picking liste ali je material že poraban, bi izbris
  // prelomil invarianto FIZIČNA ≠ REZERVIRANA ≠ RAZPOLOŽLJIVA (osirotele
  // rezervacije z bomId=null bi za vedno držale zalogo).
  if (pkg.bom) {
    const activeRes = await db.stockReservation.count({ where: { bomId: pkg.bom.id, status: 'AKTIVNA' } })
    if (activeRes > 0) {
      return jsonError(409, `Kosovnica ${pkg.bom.code} ima ${activeRes} aktivnih rezervacij — najprej jih sprostite (Zaloga → Kosovnice → Sprosti).`)
    }
    const pickingCount = await db.pickingList.count({ where: { bomId: pkg.bom.id } })
    if (pickingCount > 0) {
      return jsonError(409, `Kosovnica ${pkg.bom.code} ima ${pickingCount} povezanih picking list — nadomeščanje ni mogoče (izgubila bi se zgodovina izdaje).`)
    }
    if (pkg.bom.status === 'REZERVIRAN' || pkg.bom.status === 'PORABLJEN') {
      return jsonError(409, `Kosovnica ${pkg.bom.code} je ${pkg.bom.status.toLowerCase()} — nadomeščanje ni mogoče. Ustvarite nov paket za ponovno konfiguracijo.`)
    }
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
  // R447: strukturirane VHODE konfiguratorja (calcJson.inputs) ohranimo čez
  // regeneracijo — izmera/segmenti so izvor količine in ne smejo biti izgubljeni.
  let preservedInputs: unknown = null
  if (pkg.calcJson) {
    try {
      const parsed = JSON.parse(pkg.calcJson) as { inputs?: unknown }
      if (parsed && typeof parsed === 'object' && parsed.inputs) preservedInputs = parsed.inputs
    } catch { /* starejše/prazne kalkulacije brez inputs — nič hudega */ }
  }
  const calc = {
    generatedAt: new Date().toISOString(),
    qty: plan.qty, unit: plan.unit,
    materialCost: plan.materialCost, montazaUnit: plan.montazaUnit,
    totalSale: plan.totalSale, margin: plan.margin, marginPct: plan.marginPct,
    priceSource: plan.priceSource,
    lines: plan.lines.length,
    ...(preservedInputs ? { inputs: preservedInputs } : {}),
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

  // R474 (issue #9 §5): regeneracija kosovnice = nov obseg → povezane ponudbe
  // invalidiramo (OSNUTEK/POSLAN → OSNUTEK; SPREJET/ZAKLENJEN samo zastavica)
  const invalidated = await invalidateQuotesForPackage(
    { id: pkg.id, code: pkg.code, projectId: pkg.projectId },
    `Kosovnica paketa ${pkg.code} je bila ponovno generirana — količine/cene so se lahko spremenile.`,
    auth.user.id
  )

  return NextResponse.json({
    data: {
      bom: { id: bom.id, code: bom.code, status: bom.status, qty: bom.qty, unit: bom.unit, lines: plan.lines },
      calc,
      ...(invalidated.reset + invalidated.flagged > 0 ? { invalidated } : {}),
    },
  }, { status: 201 })
}

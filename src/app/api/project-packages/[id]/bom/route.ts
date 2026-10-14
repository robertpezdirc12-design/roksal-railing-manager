import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextBomCode, planBom } from '@/lib/product-core'
import { invalidateQuotesForPackage } from '@/lib/quote-invalidation'
import { normalizeSegments, SEGMENT_BOM_VERSION, type RawSegmentRow } from '@/lib/segment-bom'
import { GEOMETRY_SOURCE_VERSION, izberiGeometrijo, type OdlokGeometrije } from '@/lib/measure-geometry-source'
import { MEASUREMENT_STATUS_LABELS, measurementStatusAllowsBusiness, type MeasurementStatus } from '@/lib/measure-engine'

type Params = { params: Promise<{ id: string }> }

// POST /api/project-packages/[id]/bom — generiraj in SHRANI kosovnico paketa
// (quotes.create → revizija BOM_GENERATE)
// Telo: { includeOptional? } — količina/product/variant vzame iz paketa.
// BOM vrstice vsebujejo EKSPlicitne itemId → InventoryItem (issue #7 §2).
//
// R475 (issue #9 §5 — KOLIČINE IZ SEGMENTOV): če paket vsebuje segmente
// (calcJson.inputs.segments, m-forma s ključi seg-N), se vrstice komponent z
// segmentRole izračunajo PO SEGMENTU (stebri iz razmika, dolžine/ploščine z
// odpadom iz pravila odpad_rez_pct) — vrstica ← segment je sledljiva.
//
// R501 (issue #15 faza 2 — H2 POSLOVNA VRATA): kosovnica je točka, kjer mera
// postane material in cena. Če je paket vezan na meritev, katere provenience je
// OCENA (ESTIMATED/AUTO_SUGGESTED) ali je bila razveljavljena (INVALIDATED),
// generacija ZAVRNE s 409 — številka brez dokazanega merila ne sme v nabavo.
// Vrata so na eni točki (generiranje), zato obstoječi tokovi brez vezane
// meritve tečejo naprej nespremenjeno.
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const pkg = await db.projectPackage.findUnique({
    where: { id },
    include: { bom: true, project: { select: { id: true, code: true } }, measurement: { select: { id: true, type: true, lengthCm: true, status: true, statusNote: true } } },
  })
  if (!pkg) return jsonError(404, 'Paket ne obstaja.')

  if (pkg.measurement && !measurementStatusAllowsBusiness(pkg.measurement.status)) {
    return jsonError(409, 'Meritev paketa ni poslovno uporabna.',
      `Meritev ${pkg.measurement.id} je stanja «${MEASUREMENT_STATUS_LABELS[pkg.measurement.status as MeasurementStatus] ?? pkg.measurement.status}» — ocene ali razveljavljene mere ne moremo pretvoriti v kosovnico. ${pkg.measurement.statusNote ? `Razlog: ${pkg.measurement.statusNote}` : ''} Ponovite meritev z dokazano referenco (kalibracija px/cm) ali jo potrdi pisarna (CONFIRMED).`)
  }

  const body = await req.json().catch(() => null)

  // R475: segmenti + razmik iz strukturiranih vhodov konfiguratorja (R447:
  // calcJson.inputs so izvor količine in se ohranijo čez regeneracijo).
  let segments: ReturnType<typeof normalizeSegments> = []
  let spacingCm: number | null = null
  if (pkg.calcJson) {
    try {
      const parsed = JSON.parse(pkg.calcJson) as {
        inputs?: { segments?: RawSegmentRow[]; razmikStebrovM?: number }
      }
      segments = normalizeSegments(Array.isArray(parsed?.inputs?.segments) ? parsed.inputs.segments : [])
      if (typeof parsed?.inputs?.razmikStebrovM === 'number' && parsed.inputs.razmikStebrovM > 0) {
        spacingCm = Math.round(parsed.inputs.razmikStebrovM * 100)
      }
    } catch { /* starejše/prazne kalkulacije brez inputs — predloga × qty */ }
  }

  // ── R511 (issue #7 §8/§10, issue #3 §4E): obseg iz POTRJENEGA tekača ───────
  // Paket, ki je nastal iz mere (§8 prenos), konfiguratorjevih segmentov nima,
  // zato je doslej tiho padel na „predloga × količina“ — brez stebrov po
  // razmiku, brez odpada in brez sledljivosti seg-N. Če na isto meritev visi
  // POTRJEN ograjni tekač, geometrijo vzamemo iz njega in jo podamo ISTI
  // obstoječi matematiki (`normalizeSegments` → `planBom`); novega jedra ni.
  // Vsak odlok (tudi zavrnitev) se zabeleži v kalkulacijo, da pisarna vidi,
  // ZAKAJ so količine samo predloge.
  let geometrija: OdlokGeometrije | null = null
  if (segments.length === 0 && pkg.measurement?.id) {
    const tekoci = await db.fenceRun.findMany({
      where: { measurementId: pkg.measurement.id },
      select: {
        id: true, status: true, projectId: true,
        segments: {
          orderBy: { order: 'asc' },
          select: { order: true, fromAtCm: true, toAtCm: true, lengthCm: true, heightCm: true, status: true },
        },
      },
    })
    geometrija = izberiGeometrijo({
      paketProjectId: pkg.projectId,
      paketZeImaSegmente: false,
      razmikStebrovCm: spacingCm,
      tekoci: tekoci.map((t) => ({ id: t.id, status: t.status, projectId: t.projectId, segmenti: t.segments })),
    })
    if (geometrija.odlok === 'TEKOC') segments = normalizeSegments(geometrija.rows)
  }

  const plan = await planBom({
    productId: pkg.productId,
    variantId: pkg.variantId,
    qty: pkg.qty,
    includeOptional: body?.includeOptional !== false,
    ...(segments.length > 0 ? { segments, ...(spacingCm != null ? { spacingCm } : {}) } : {}),
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
      note: `Generirano iz predloge ${plan.product.sku}${plan.variant ? ` / ${plan.variant.sku}` : ''}${geometrija?.odlok === 'TEKOC' && geometrija.fenceRunId ? ` — obseg iz potrjenega tekača ${geometrija.fenceRunId}` : ''}${geometrija?.odlok === 'PREDLOGA' ? ` — obseg tekač ne more dokazati: ${geometrija.razlog}` : ''}`,
      lines: {
        create: plan.lines.map((l, i) => ({
          itemId: l.itemId, qty: l.qty, unit: l.unit, note: l.note, sortOrder: i,
          segmentKey: l.segmentKey, group: l.group, wastePct: l.wastePct, sourceRule: l.sourceRule,
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
    // R475: segmentni režim — opozorila in verzija engine-a se shranijo v
    // kalkulacijo (revizijska sled izpeljave količin po segmentih)
    ...(plan.segmentsApplied > 0 ? {
      segmentsApplied: plan.segmentsApplied,
      segmentEngine: plan.segmentEngine ?? SEGMENT_BOM_VERSION,
      warnings: plan.warnings,
    } : {}),
    // R511: ZAKDaj so količine po segmentih oziroma zakaj so samo predloga —
    // odločitev o viru geometrije mora brati tudi čez tri mesece.
    ...(geometrija ? {
      geometrija: {
        verzija: GEOMETRY_SOURCE_VERSION,
        odlok: geometrija.odlok,
        razlog: geometrija.razlog,
        fenceRunId: geometrija.fenceRunId,
        dolzinaCm: geometrija.dolzinaCm,
        opozorila: geometrija.opozorila,
        segmentov: geometrija.rows.length,
      },
    } : {}),
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
      ...(plan.segmentsApplied > 0 ? { segmentsApplied: plan.segmentsApplied, segmentEngine: plan.segmentEngine } : {}),
      // R511: vir geometrije je del revizijske sledi (kje so količine nastale)
      ...(geometrija ? { geometrijaOdlok: geometrija.odlok, geometrijaRun: geometrija.fenceRunId, geometrijaRazlog: geometrija.razlog.slice(0, 200) } : {}),
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
      // R511: pisarna mora VIDETI, od kod so količine — ne šele v bazi
      ...(geometrija ? { geometrija } : {}),
      ...(invalidated.reset + invalidated.flagged > 0 ? { invalidated } : {}),
    },
  }, { status: 201 })
}

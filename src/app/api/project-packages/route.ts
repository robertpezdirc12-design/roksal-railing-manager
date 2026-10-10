import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextPackageCode, PACKAGE_STATUSES } from '@/lib/product-core'
import { isPackageTier } from '@/lib/quote-core'

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
//         status?, calcJson?, tier?, compareCode? | compare:true } // R476
// R447: calcJson (objekt) shrani strukturirane vhode konfiguratorja (inputs) in
// rezultat dry-run izračuna (plan). Ni nujno — če manjka, paket ostane brez kalkulacije.
// R476 (issue #9 §5 — PRIMERJALNI PAKETI): tier (STANDARD|BOLJSI|PREMIUM) skupaj
// z compareCode ( obstoječa skupina istega projekta) ali compare:true (nova).
// Nivo je enoličen znotraj skupine; skupina ne prečka projektov.

/** Zaporedna koda CMP-<leto>-<seq> — globalna (primerjava živi na projektu). */
async function nextCompareCode (): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `CMP-${year}-`
  const existing = await db.projectPackage.findMany({ where: { compareCode: { startsWith: prefix } }, select: { compareCode: true } })
  const seqs = existing
    .map((p) => parseInt((p.compareCode ?? '').slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
  const next = (seqs.length ? Math.max(...seqs) : 0) + 1
  return `${prefix}${String(next).padStart(3, '0')}`
}
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

  // ── R476: primerjalni paketi — tier + skupina ────────────────────────────
  const tierRaw = typeof body?.tier === 'string' && body.tier ? body.tier : null
  if (tierRaw != null && !isPackageTier(tierRaw)) {
    return jsonError(400, 'Neveljaven nivo paketa.', 'Dovoljeni: STANDARD, BOLJSI, PREMIUM.')
  }
  const compareCodeRaw = typeof body?.compareCode === 'string' && body.compareCode.trim() ? body.compareCode.trim() : null
  const newCompare = body?.compare === true
  if (compareCodeRaw != null && tierRaw == null) {
    return jsonError(400, 'Pridružitev obstoječi primerjavi zahteva tudi nivo (tier).')
  }
  if (newCompare && tierRaw == null) {
    return jsonError(400, 'Nova primerjava zahteva tudi nivo (tier).')
  }
  let compareCode: string | null = null
  if (tierRaw != null) {
    if (compareCodeRaw != null) {
      const member = await db.projectPackage.findFirst({
        where: { compareCode: compareCodeRaw },
        select: { projectId: true },
      })
      if (!member) return jsonError(404, 'Primerjava ne obstaja.', `Skupina ${compareCodeRaw} ni najdena.`)
      if (member.projectId !== projectId) {
        return jsonError(400, 'Primerjava pripada drugemu projektu.', 'Primerjalni paketi morajo ostati znotraj enega projekta.')
      }
      const dup = await db.projectPackage.findFirst({ where: { compareCode: compareCodeRaw, tier: tierRaw } })
      if (dup) {
        return jsonError(409, `V primerjavi ${compareCodeRaw} je nivo ${tierRaw} že zaseden.`, `Zaseden s paketom ${dup.code}.`)
      }
      compareCode = compareCodeRaw
    } else {
      compareCode = await nextCompareCode()
    }
  }

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
      tier: tierRaw,
      compareCode,
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'PACKAGE_CREATE', entity: 'projectPackage', entityId: pkg.id,
    projectId,
    detail: { code: pkg.code, product: product.sku, variantId, qty, unit: pkg.unit, ...(calcJson ? { calcInputs: true } : {}), ...(tierRaw ? { tier: tierRaw, compareCode } : {}) },
  })
  return NextResponse.json({ data: pkg }, { status: 201 })
}

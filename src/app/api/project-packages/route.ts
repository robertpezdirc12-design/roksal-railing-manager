import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import { retryOnUnique } from '@/lib/versioning'
import { PACKAGE_STATUSES } from '@/lib/product-core'
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

/** Zaporedna koda CMP-<leto>-<seq> — globalna (primerjava živi na projektu).
 *  R538: sprejme klienta (tx) — koda se izračuna ZNOTRAJ transakcije, ob
 *  ponovnem poskusu (P2002) pa znova (vzorec R535). */
async function nextCompareCode (client: Pick<Prisma.TransactionClient, 'projectPackage'>): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `CMP-${year}-`
  const existing = await client.projectPackage.findMany({ where: { compareCode: { startsWith: prefix } }, select: { compareCode: true } })
  const seqs = existing
    .map((p) => parseInt((p.compareCode ?? '').slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
  const next = (seqs.length ? Math.max(...seqs) : 0) + 1
  return `${prefix}${String(next).padStart(3, '0')}`
}

/** R538: zaporedna koda PAK-<projekt>-<n> na transakcijskem klientu — enaka
 *  logika kot nextPackageCode iz product-core (tam ostaja za klice na globalnem
 *  db), a teče ZNOTRAJ transakcije: ob sočasnem P2002 (dva POST-a si
 *  izračunata isto kodo) retryOnUnique ponovi celotno fn in se koda izračuna
 *  znova (vzorec R535 — read-then-create dirka je s tem zaprta). */
async function nextPackageCodeOn (client: Pick<Prisma.TransactionClient, 'projectPackage'>, projectCode: string): Promise<string> {
  const count = await client.projectPackage.count({ where: { code: { startsWith: `PAK-${projectCode}-` } } })
  let n = count + 1
  for (let i = 0; i < 500; i++) {
    const code = `PAK-${projectCode}-${n}`
    const exists = await client.projectPackage.findUnique({ where: { code } })
    if (!exists) return code
    n++
  }
  return `PAK-${projectCode}-${Date.now()}`
}

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// projectId/productId obvezna niza (kot prej), qty pozitivno število (kot prej —
// brez coerce), status ima tihi privzetek POVPRAŠEVANJE ob neznani vrednosti
// (kot prej), variantId/measurementId: neprazen niz ⇒ vrednost, sicer null
// (kot prej), tier/compareCode: neprazen niz po trim ⇒ vrednost, sicer null
// (kot prej), compare: strogo === true (kot prej), name/note: trim (kot prej),
// calcJson: posredovanje handlerju (poslovna validacija + serializacija —
// en vir resnice, kot prej).
const PackageCreateSchema = z.object({
  projectId: z.string({ error: 'projectId je obvezen.' }).min(1, 'projectId je obvezen.'),
  productId: z.string({ error: 'productId je obvezen.' }).min(1, 'productId je obvezen.'),
  variantId: z.string({ error: 'variantId mora biti besedilo.' }).nullish().transform((v) => v || null),
  qty: z.number({ error: 'Količina mora biti pozitivno število.' }).positive('Količina mora biti pozitivno število.'),
  status: z.unknown().transform((v) => (typeof v === 'string' && (PACKAGE_STATUSES as readonly string[]).includes(v) ? v : 'POVPRAŠEVANJE')),
  name: z.string({ error: 'Ime mora biti besedilo.' }).nullish().transform((v) => (v?.trim() ? v.trim() : undefined)),
  note: z.string({ error: 'Opomba mora biti besedilo.' }).nullish().transform((v) => (v?.trim() ? v.trim() : null)),
  measurementId: z.string({ error: 'measurementId mora biti besedilo.' }).nullish().transform((v) => v || null),
  tier: z.string({ error: 'Nivo paketa mora biti besedilo.' }).nullish().transform((v) => v || null),
  compareCode: z.string({ error: 'compareCode mora biti besedilo.' }).nullish().transform((v) => (v?.trim() ? v.trim() : null)),
  compare: z.unknown().transform((v) => v === true),
  calcJson: z.unknown().optional(),
})

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, PackageCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const project = await db.project.findUnique({ where: { id: data.projectId } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')
  const product = await db.product.findUnique({ where: { id: data.productId }, include: { family: true } })
  if (!product || !product.active) return jsonError(404, 'Izdelek ne obstaja ali ni aktiven.')
  if (data.variantId) {
    const v = await db.productVariant.findUnique({ where: { id: data.variantId } })
    if (!v || v.productId !== product.id) return jsonError(400, 'Varianta ne pripada izdelku.')
  }

  const name = data.name ?? `${product.family.name} — ${product.name}`

  // ── R476: primerjalni paketi — tier + skupina ────────────────────────────
  const tierRaw = data.tier
  if (tierRaw != null && !isPackageTier(tierRaw)) {
    return jsonError(400, 'Neveljaven nivo paketa.', 'Dovoljeni: STANDARD, BOLJSI, PREMIUM.')
  }
  const compareCodeRaw = data.compareCode
  if (compareCodeRaw != null && tierRaw == null) {
    return jsonError(400, 'Pridružitev obstoječi primerjavi zahteva tudi nivo (tier).')
  }
  if (data.compare && tierRaw == null) {
    return jsonError(400, 'Nova primerjava zahteva tudi nivo (tier).')
  }
  let joinCompareCode: string | null = null
  const novaSkupina = tierRaw != null && compareCodeRaw == null
  if (tierRaw != null && compareCodeRaw != null) {
    const member = await db.projectPackage.findFirst({
      where: { compareCode: compareCodeRaw },
      select: { projectId: true },
    })
    if (!member) return jsonError(404, 'Primerjava ne obstaja.', `Skupina ${compareCodeRaw} ni najdena.`)
    if (member.projectId !== data.projectId) {
      return jsonError(400, 'Primerjava pripada drugemu projektu.', 'Primerjalni paketi morajo ostati znotraj enega projekta.')
    }
    const dup = await db.projectPackage.findFirst({ where: { compareCode: compareCodeRaw, tier: tierRaw } })
    if (dup) {
      return jsonError(409, `V primerjavi ${compareCodeRaw} je nivo ${tierRaw} že zaseden.`, `Zaseden s paketom ${dup.code}.`)
    }
    joinCompareCode = compareCodeRaw
  }

  // R447: strukturirana kalkulacija konfiguratorja (jsonb objekt); varovalka velikosti
  // ostaja prek JSON.stringify (samo meritev dolžine — R542)
  let calcJson: Prisma.InputJsonValue | undefined
  if (data.calcJson !== undefined && data.calcJson !== null) {
    if (typeof data.calcJson !== 'object' || Array.isArray(data.calcJson)) {
      return jsonError(400, 'calcJson mora biti objekt (npr. { inputs, plan }).')
    }
    try {
      if (JSON.stringify(data.calcJson).length > 128 * 1024) return jsonError(400, 'calcJson je prevelik (največ 128 kB).')
      calcJson = data.calcJson as Prisma.InputJsonValue
    } catch {
      return jsonError(400, 'calcJson ni veljaven JSON.')
    }
  }

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  // + vzorec R535: koda PAK-… se izračuna ZNOTRAJ transakcije na tx klientu;
  // ob sočasnem P2002 (dva POST-a si izračunata isto kodo) do 3 poskusi —
  // read-then-create dirka je s tem zaprta. Koda CMP-… za NOVO primerjalno
  // skupino se prav tako izračuna znotraj tx (ob ponovnem poskusu znova).
  const pkg = await retryOnUnique(() => db.$transaction(async (tx) => {
    const code = await nextPackageCodeOn(tx, project.code)
    const compareCode = novaSkupina ? await nextCompareCode(tx) : joinCompareCode
    const pkg = await tx.projectPackage.create({
      data: {
        code,
        projectId: data.projectId, productId: data.productId, variantId: data.variantId, name,
        qty: data.qty, unit: product.unit, status: data.status,
        calcJson,
        note: data.note,
        measurementId: data.measurementId,
        tier: tierRaw,
        compareCode,
      },
    })

    await writeAudit({
      userId: auth.user.id, action: 'PACKAGE_CREATE', entity: 'projectPackage', entityId: pkg.id,
      projectId: data.projectId,
      detail: { code: pkg.code, product: product.sku, variantId: data.variantId, qty: data.qty, unit: pkg.unit, ...(calcJson ? { calcInputs: true } : {}), ...(tierRaw ? { tier: tierRaw, compareCode } : {}) },
    }, tx)
    return pkg
  }), 3)
  return NextResponse.json({ data: pkg }, { status: 201 })
}

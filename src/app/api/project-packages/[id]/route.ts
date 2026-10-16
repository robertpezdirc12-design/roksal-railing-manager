import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import { PACKAGE_STATUSES } from '@/lib/product-core'
import { invalidateQuotesForPackage } from '@/lib/quote-invalidation'

type Params = { params: Promise<{ id: string }> }

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// delni PATCH — vsa polja neobvezna; neznana status se tiho preskoči (kot prej),
// prazno ime se izpusti (kot prej), opomba ⇒ trim ali null (kot prej),
// qty (če je podan kot število) mora biti pozitiven — sicer 400 (kot prej),
// measurementId: neprazen niz ⇒ vrednost (obstoj preverja handler, kot prej).
const PackagePatchSchema = z.object({
  status: z.unknown().transform((v) => (typeof v === 'string' && (PACKAGE_STATUSES as readonly string[]).includes(v) ? v : undefined)),
  name: z.string({ error: 'Ime mora biti besedilo.' }).trim().optional().transform((v) => v || undefined),
  note: z.string({ error: 'Opomba mora biti besedilo.' }).nullish().transform((v) => (v === undefined ? undefined : v?.trim() || null)),
  qty: z.number({ error: 'Količina mora biti pozitivno število.' }).positive('Količina mora biti pozitivno število.').nullish().transform((v) => v ?? undefined),
  measurementId: z.string({ error: 'measurementId mora biti besedilo.' }).optional().transform((v) => v || undefined),
})

// GET /api/project-packages/[id] — podrobnost paketa (projects.read; kalkulacija samo pisarna)
export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const pkg = await db.projectPackage.findUnique({
    where: { id },
    include: {
      product: { select: { sku: true, name: true, unit: true, family: { select: { code: true, name: true } } } },
      variant: { select: { sku: true, name: true } },
      measurement: true,
      bom: { include: { lines: { orderBy: { sortOrder: 'asc' }, include: { item: true } } } },
    },
  })
  if (!pkg) return jsonError(404, 'Paket ne obstaja.')

  const canSeeCalc = auth.perms.includes('quotes.create')
  return NextResponse.json({ data: { ...pkg, calcJson: canSeeCalc ? pkg.calcJson : null } })
}

// PATCH /api/project-packages/[id] — status/količina/opomba (quotes.create → revizija)
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const existing = await db.projectPackage.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Paket ne obstaja.')

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, PackagePatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const patch: Record<string, unknown> = {}
  if (data.status !== undefined) patch.status = data.status
  if (data.name !== undefined) patch.name = data.name
  if (data.note !== undefined) patch.note = data.note
  if (data.qty !== undefined) patch.qty = data.qty
  if (data.measurementId !== undefined) {
    const m = await db.measurement.findUnique({ where: { id: data.measurementId } })
    if (!m) return jsonError(404, 'Izmera ne obstaja.')
    patch.measurementId = data.measurementId
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // posodobitev paketa + revizija PACKAGE_UPDATE v ENI transakciji.
  // Invalidacija povezanih ponudb (invalidateQuotesForPackage) teče po commitu
  // na globalnem klientu — služba piše prek globalnega db (izven tx, enako
  // kot R537-d pri meritvah).
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.projectPackage.update({ where: { id }, data: patch })
    await writeAudit({
      userId: auth.user.id, action: 'PACKAGE_UPDATE', entity: 'projectPackage', entityId: id,
      projectId: existing.projectId,
      detail: { code: existing.code, from: existing.status, ...patch },
    }, tx)
    return updated
  })

  // R474 (issue #9 §5): sprememba obsega (količina/izmera) invalidira povezane
  // ponudbe — ne pusti zastarele ponudbe kot veljavne.
  let invalidated: Awaited<ReturnType<typeof invalidateQuotesForPackage>> | null = null
  if (patch.qty !== undefined || patch.measurementId !== undefined) {
    invalidated = await invalidateQuotesForPackage(
      { id: existing.id, code: existing.code, projectId: existing.projectId },
      `Spremenjen obseg paketa ${existing.code} (${patch.qty !== undefined ? `količina → ${patch.qty}` : 'nova izmera'}) — ponudbo je treba ponovno pregledati.`,
      auth.user.id
    )
  }
  return NextResponse.json({ data: { ...updated, ...(invalidated ? { invalidated } : {}) } })
}

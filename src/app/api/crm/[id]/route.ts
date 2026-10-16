import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

const LEAD_STATUSES = ['NOV', 'KONTAKTIRAN', 'KVALIFIKACIJAN', 'PRETVORJEN', 'IZGUBLJEN']
const OPP_STAGES = ['KVALIFIKACIJA', 'PONUDBA', 'POGAJANJA', 'ZMAGOVALNA', 'IZGUBLJENA']

// PATCH /api/crm/[id] — lead status ALI opportunity stage/probability (crm.write)
// Vrsta zapisa: body.kind ('lead' | 'opportunity') oz. samodejno iz polj (stage/probability → opportunity).
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'crm.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const kind: 'lead' | 'opportunity' =
    body?.kind === 'opportunity' || body?.stage !== undefined || body?.probability !== undefined
      ? 'opportunity'
      : 'lead'

  if (kind === 'lead') {
    const status = typeof body?.status === 'string' ? body.status : ''
    if (!LEAD_STATUSES.includes(status)) {
      return jsonError(400, 'Neveljaven status voda.', `Dovoljeno: ${LEAD_STATUSES.join(', ')}.`)
    }
    const existing = await db.lead.findUnique({ where: { id } })
    if (!existing) return jsonError(404, 'Vod ne obstaja.')
    if (existing.status === status) return jsonError(400, 'Vod je že v tem statusu.')

    // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
    const updated = await db.$transaction(async (tx) => {
      const updated = await tx.lead.update({ where: { id }, data: { status } })
      await writeAudit({
        userId: auth.user.id, action: 'LEAD_STATUS', entity: 'lead', entityId: id,
        detail: { name: existing.name, from: existing.status, to: status },
      }, tx)
      return updated
    })
    return NextResponse.json({ data: updated })
  }

  // opportunity
  const existing = await db.opportunity.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Priložnost ne obstaja.')

  const patch: Record<string, unknown> = {}
  if (body?.stage !== undefined) {
    if (typeof body.stage !== 'string' || !OPP_STAGES.includes(body.stage)) {
      return jsonError(400, 'Neveljavna stopnja priložnosti.', `Dovoljeno: ${OPP_STAGES.join(', ')}.`)
    }
    patch.stage = body.stage
  }
  if (body?.probability !== undefined) {
    if (typeof body.probability !== 'number' || !Number.isInteger(body.probability) || body.probability < 0 || body.probability > 100) {
      return jsonError(400, 'Verjetnost mora biti celo število med 0 in 100.')
    }
    patch.probability = body.probability
  }
  if (typeof body?.note === 'string') patch.note = body.note.trim() || null
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.opportunity.update({ where: { id }, data: patch })
    await writeAudit({
      userId: auth.user.id, action: 'OPPORTUNITY_STAGE', entity: 'opportunity', entityId: id,
      detail: { title: existing.title, from: existing.stage, to: updated.stage, ...patch },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

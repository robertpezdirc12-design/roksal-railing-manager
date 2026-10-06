import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// Linearni tok proizvodnje (kot original): NAVRTEN → V_IZDELAVI → DOKONCAN → ODPOSLAN
const FLOW = ['NAVRTEN', 'V_IZDELAVI', 'DOKONCAN', 'ODPOSLAN'] as const

// PATCH /api/production/[id] — prehod statusa (production.manage)
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'production.manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const existing = await db.productionOrder.findUnique({
    where: { id },
    include: { project: { select: { code: true, title: true } } },
  })
  if (!existing) return jsonError(404, 'Proizvodni nalog ne obstaja.')

  const patch: Record<string, unknown> = {}

  if (body?.status !== undefined) {
    const status = typeof body.status === 'string' ? body.status : ''
    if (!FLOW.includes(status as (typeof FLOW)[number])) {
      return jsonError(400, 'Neveljaven status proizvodnje.', `Dovoljeno: ${FLOW.join(' → ')}.`)
    }
    const idx = FLOW.indexOf(existing.status as (typeof FLOW)[number])
    if (idx === FLOW.length - 1) return jsonError(400, 'Nalog je že odposlan — nadaljnjih prehodov ni.')
    const next = FLOW[idx + 1]
    if (status !== next) {
      return jsonError(400, `Prehod ${existing.status} → ${status} ni dovoljen.`, `Iz trenutnega statusa je dovoljen le prehod na ${next}.`)
    }
    patch.status = status
  }

  if (typeof body?.note === 'string') patch.note = body.note.trim() || null
  if (typeof body?.dueAt === 'string' && body.dueAt) {
    const dueAt = new Date(body.dueAt)
    if (Number.isNaN(dueAt.getTime())) return jsonError(400, 'Neveljaven rok izdelave.')
    patch.dueAt = dueAt
  }

  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  const updated = await db.productionOrder.update({
    where: { id },
    data: patch,
    include: { project: { select: { code: true, title: true } } },
  })

  if (patch.status) {
    await writeAudit({
      userId: auth.user.id, action: 'PRODUCTION_STATUS', entity: 'productionOrder', entityId: id,
      projectId: updated.projectId,
      detail: { code: existing.code, from: existing.status, to: patch.status },
    })
  } else {
    await writeAudit({
      userId: auth.user.id, action: 'PRODUCTION_UPDATE', entity: 'productionOrder', entityId: id,
      projectId: updated.projectId,
      detail: { code: existing.code, ...patch },
    })
  }
  return NextResponse.json({ data: updated })
}

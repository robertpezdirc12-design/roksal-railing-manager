// /api/nalog/[id]/transition — TERENSKI TOK (R429 §7, VERBATIM):
//   NAPROGRAMIRAN → V_TEKU   (ZAČNI DELO)
//   V_TEKU        → V_ZAJEMU (ZAJEM)
//   V_ZAJEMU      → V_PREVERI (PREVERI)
//   V_PREVERI     → ZAKLJUCEN (ZAKLJUČI TEREN)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

const FLOW: Record<string, { next: string; event: string; label: string }[]> = {
  NAPROGRAMIRAN: [{ next: 'V_TEKU', event: 'ZACETEK', label: 'ZAČNI DELO' }],
  V_TEKU: [
    { next: 'V_ZAJEMU', event: 'ZAJEM', label: 'ZAJEM' },
    { next: 'V_PREVERI', event: 'PREVERITEV', label: 'PREVERI' },
  ],
  V_ZAJEMU: [
    { next: 'V_PREVERI', event: 'PREVERITEV', label: 'PREVERI' },
  ],
  V_PREVERI: [
    { next: 'ZAKLJUCEN', event: 'ZAKLJUCEK', label: 'ZAKLJUČI TEREN' },
  ],
}

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.transition')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await req.json().catch(() => null)
  const to = typeof body?.to === 'string' ? body.to : ''
  const note = typeof body?.note === 'string' ? body.note : null

  const order = await db.workOrder.findUnique({ where: { id }, include: { project: { select: { id: true, code: true } } } })
  if (!order) return jsonError(404, 'Nalog ne obstaja.')

  const allowed = FLOW[order.status] ?? []
  const step = allowed.find((s) => s.next === to)
  if (!step) {
    return jsonError(
      400,
      `Prehod ${order.status} → ${to || '?'} ni dovoljen.`,
      `Dovoljeni prehodi: ${allowed.map((s) => `${order.status} → ${s.next} (${s.label})`).join('; ') || '—'}`
    )
  }

  const now = new Date()
  const updated = await db.workOrder.update({
    where: { id },
    data: {
      status: step.next,
      startedAt: step.event === 'ZACETEK' ? now : order.startedAt,
      completedAt: step.event === 'ZAKLJUCEK' ? now : order.completedAt,
      summary: step.event === 'ZAKLJUCEK' && note ? note : order.summary,
    },
  })
  await db.workOrderEvent.create({
    data: { workOrderId: id, userId: auth.user.id, type: step.event, note: note ?? step.label },
  })
  await writeAudit({
    userId: auth.user.id,
    action: 'WO_TRANSITION',
    entity: 'workOrder',
    entityId: id,
    projectId: order.project?.id ?? null,
    detail: { from: order.status, to: step.next, label: step.label, code: order.code },
  })
  return NextResponse.json({ data: updated })
}

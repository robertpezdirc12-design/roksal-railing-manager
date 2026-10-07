import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/nalog/[id]/termin — preurčitev delovnega naloga (route-map: POST /api/nalog/[id]/termin)
// Vrata: nalog.write. Dogodek KOMENTAR (tip TERMIN) v časovnico naloga + revizija WO_RESCHEDULE.

type Params = { params: Promise<{ id: string }> }

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const body = await req.json().catch(() => null) as { scheduledFor?: string; note?: string } | null
  if (!body?.scheduledFor) return jsonError(400, 'Manjka nov termin (scheduledFor).')
  const when = new Date(body.scheduledFor)
  if (Number.isNaN(when.getTime())) return jsonError(400, 'Neveljaven datum termina.')

  const order = await db.workOrder.findUnique({ where: { id }, select: { id: true, code: true, scheduledFor: true, status: true, projectId: true } })
  if (!order) return jsonError(404, 'Nalog ne obstaja.')
  if (order.status === 'ZAKLJUCEN') return jsonError(409, 'Zaključenega naloga ni mogoče preurčiti.')

  const from = order.scheduledFor
  await db.workOrder.update({ where: { id }, data: { scheduledFor: when } })
  await db.workOrderEvent.create({
    data: {
      workOrderId: id, userId: user.id, type: 'KOMENTAR',
      note: `PREURČITEV: ${from ? from.toLocaleDateString('sl-SI') : 'brez termina'} → ${when.toLocaleDateString('sl-SI')}${body.note ? ` — ${body.note}` : ''}`,
    },
  })
  await writeAudit({
    userId: user.id, action: 'WO_RESCHEDULE', entity: 'workOrder', entityId: id, projectId: order.projectId,
    detail: JSON.stringify({ code: order.code, from: from?.toISOString() ?? null, to: when.toISOString() }),
  })

  return NextResponse.json({ data: { id, scheduledFor: when.toISOString() } })
}

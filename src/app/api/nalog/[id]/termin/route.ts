import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { deliverEvent, recordEvent, fmtTermin } from '@/lib/notify'

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

  const order = await db.workOrder.findUnique({
    where: { id },
    select: {
      id: true, code: true, title: true, scheduledFor: true, status: true, projectId: true, assigneeId: true,
      project: { select: { id: true, code: true, customer: { select: { name: true, email: true } } } },
    },
  })
  if (!order) return jsonError(404, 'Nalog ne obstaja.')
  // obseg (issue #1): monter preuriči samo svoj nalog
  if (!readsAllData(user) && order.assigneeId !== user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Preurčitev tujega naloga ni dovoljena.')
  }
  if (order.status === 'ZAKLJUCEN') return jsonError(409, 'Zaključenega naloga ni mogoče preurčiti.')

  const from = order.scheduledFor
  // R537 (transakcijska celovitost): preurčitev + dogodek TERMIN + revizija +
  // zapis obvestila (outbox) v ENI transakciji — padec srednjega koraka NE pusti
  // spremembe termina brez revizije/dogodka. Dostava (monter IN_APP + stranka
  // EMAIL + webhook HTTP) teče PO commitu (deliverEvent, ognjevarna).
  const { recorded } = await db.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id }, data: { scheduledFor: when } })
    await tx.workOrderEvent.create({
      data: {
        workOrderId: id, userId: user.id, type: 'KOMENTAR',
        note: `PREURČITEV: ${from ? from.toLocaleDateString('sl-SI') : 'brez termina'} → ${when.toLocaleDateString('sl-SI')}${body.note ? ` — ${body.note}` : ''}`,
      },
    })
    await writeAudit({
      userId: user.id, action: 'WO_RESCHEDULE', entity: 'workOrder', entityId: id, projectId: order.projectId,
      detail: { code: order.code, from: from?.toISOString() ?? null, to: when.toISOString() },
    }, tx)

    // R438 (issue #5): monter + stranka dobita obvestilo o spremembi termina —
    // en dogodek (WO_TERMIN), več kanalov (IN_APP za monterja, EMAIL za stranko).
    const recorded = await recordEvent({
      type: 'WO_TERMIN',
      key: `wo-termin:${id}:${when.toISOString()}`,
      title: 'Sprememba termina',
      body: [
        `${order.code} — ${order.title}`,
        `nov termin: ${fmtTermin(when)}`,
        from ? `prej: ${fmtTermin(from)}` : null,
      ].filter(Boolean).join(' · '),
      projectId: order.projectId,
      customerEmail: order.project?.customer?.email ?? null,
      customerName: order.project?.customer?.name ?? null,
      userIds: order.assigneeId ? [order.assigneeId] : [],
    }, tx)
    return { recorded }
  })

  // dostava obvestila PO uspešnem commitu (ognjevarna — nikoli ne vrže napake)
  if (recorded) await deliverEvent(recorded)

  return NextResponse.json({ data: { id, scheduledFor: when.toISOString() } })
}

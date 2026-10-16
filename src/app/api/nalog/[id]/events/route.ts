// /api/nalog/[id]/events — prosti dogodki naloga (R444, issue #7 §8 MONTER: težave).
// POST (nalog.write) {type: 'TEZAVA' | 'KOMENTAR' | 'OPOMBA', note}
// Statusni dogodki (ZACETEK/ZAJEM/PREVERITEV/ZAKLJUCEK/DODELJEN) ostanejo IZKLJUČNO
// na /transition in /api/nalog — tu so dostopni samo prosti tipi.
// Težava je občutljiva mutacija → revizija WO_TROUBLE. MONTER le na svojem nalogu.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// prosti tipi (vsi ostali nastanejo skozi nadzirane prehode)
const FREE_TYPES = ['TEZAVA', 'KOMENTAR', 'OPOMBA'] as const

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const wo = await db.workOrder.findUnique({
    where: { id },
    select: { id: true, code: true, projectId: true, assigneeId: true },
  })
  if (!wo) return jsonError(404, 'Nalog ne obstaja.')
  // obseg (fail-closed): monter zabeleži dogodek SAMO na svojem nalogu
  if (!readsAllData(auth.user) && wo.assigneeId !== auth.user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Dogodke zapisujete na svojih nalogih.')
  }

  const body = await req.json().catch(() => null)
  const type = typeof body?.type === 'string' ? body.type : ''
  const note = typeof body?.note === 'string' ? body.note.trim() : ''

  if (!(FREE_TYPES as readonly string[]).includes(type)) {
    return jsonError(400, `Nepodprt tip dogodka ${type || '?'}.`, `Dovoljeni: ${FREE_TYPES.join(', ')}.`)
  }
  if (!note) return jsonError(400, 'Besedilo dogodka je obvezno.')
  if (note.length > 1000) return jsonError(400, 'Besedilo je predolgo (največ 1000 znakov).')

  // R537 (transakcijska celovitost): dogodek + (ob TEŽAVI) revizija v ENI
  // transakciji — občutljiva mutacija ne sme ostati brez sledi.
  const event = await db.$transaction(async (tx) => {
    const event = await tx.workOrderEvent.create({
      data: { workOrderId: id, userId: auth.user.id, type, note },
      include: { user: { select: { name: true } } },
    })

    if (type === 'TEZAVA') {
      await writeAudit({
        userId: auth.user.id, action: 'WO_TROUBLE', entity: 'workOrder', entityId: id,
        projectId: wo.projectId,
        detail: { workOrder: wo.code, note: note.slice(0, 400) },
      }, tx)
    }
    return event
  })
  return NextResponse.json({ data: event }, { status: 201 })
}

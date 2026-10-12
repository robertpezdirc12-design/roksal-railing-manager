// /api/nalog/[id]/qa/action — R489 (issue #12 §2C): korektivni ukrepi.
// POST  (nalog.write) — { deviationId, description, assigneeId?, dueAt? } —
//   revizija MONTAZA_ACTION_CREATE.
// PATCH (nalog.write) — { id, status, note?, photoId? } — linearni tok
//   ODPRTO → V_OBRAVNAVI → ODRAVLJENO → PREVERJENO (nazaj NI mogoče);
//   ODRAVLJENO zapiše completedAt, PREVERJENO verifiedAt/By — revizija
//   MONTAZA_ACTION_STATUS.

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { posodobiUkrep, ustvariUkrep } from '@/lib/montaza-qa-core'

type Params = { params: Promise<{ id: string }> }

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')
  if (typeof body.deviationId !== 'string' || !body.deviationId) return jsonError(400, 'Manjka deviationId.')
  if (typeof body.description !== 'string' || !body.description.trim()) {
    return jsonError(400, 'Opis korektivnega ukrepa je obvezen.')
  }

  const rez = await ustvariUkrep(auth.user, id, {
    deviationId: body.deviationId,
    description: body.description,
    assigneeId: typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null,
    dueAt: typeof body.dueAt === 'string' && body.dueAt ? body.dueAt : null,
  })

  if (rez.error && !rez.data) return jsonError(rez.status ?? (rez.conflict ? 409 : 400), rez.error)
  return NextResponse.json({ data: rez.data }, { status: 201 })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const actionId = typeof body?.id === 'string' ? body.id : ''
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!actionId) return jsonError(400, 'Manjka identifikator ukrepa.')
  if (!status) return jsonError(400, 'Manjka status ukrepa.')

  const rez = await posodobiUkrep(auth.user, id, actionId, status,
    typeof body?.note === 'string' ? body.note : null,
    typeof body?.photoId === 'string' && body.photoId ? body.photoId : null)

  if (rez.error && !rez.data) return jsonError(rez.status ?? (rez.conflict ? 409 : 400), rez.error)
  return NextResponse.json({ data: rez.data })
}

// /api/nalog/[id]/checklist — kontrolni seznam montažnega naloga (R444, issue #7 §8 MONTER).
// GET    (nalog.read)  — seznam točk; MONTER vidi SAMO svoje naloge (obseg po dodelitvi)
// POST   (nalog.write) — doda točko {label} (samo dodeljeni monter ali vodstvo)
// PATCH  (nalog.write) — odkljuka točko {id, done} (zapiše doneAt/doneBy)
// Mutacije so v reviziji (CHECKLIST_ADD / CHECKLIST_TOGGLE).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

/** Obseg (fail-closed): nalog mora obstajati; monter (ne readsAllData) le svoj. */
async function scopedWorkOrder (user: { id: string; role: string }, id: string) {
  const wo = await db.workOrder.findUnique({
    where: { id },
    select: { id: true, code: true, projectId: true, assigneeId: true },
  })
  if (!wo) return { error: jsonError(404, 'Nalog ne obstaja.') }
  if (!readsAllData(user) && wo.assigneeId !== user.id) {
    return { error: jsonError(403, 'Nalog ni dodeljen vam.', 'Monter vidi samo svoje naloge; dodelitve upravlja pisarna.') }
  }
  return { wo }
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const scoped = await scopedWorkOrder(auth.user, id)
  if ('error' in scoped) return scoped.error

  const rows = await db.installationChecklist.findMany({
    where: { workOrderId: id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { doneBy: { select: { name: true } } },
  })
  return NextResponse.json({ data: rows })
}

// POST /api/nalog/[id]/checklist — nova točka {label}
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const scoped = await scopedWorkOrder(auth.user, id)
  if ('error' in scoped) return scoped.error

  const body = await req.json().catch(() => null)
  const label = typeof body?.label === 'string' ? body.label.trim() : ''
  if (!label) return jsonError(400, 'Besedilo točke je obvezno.')
  if (label.length > 300) return jsonError(400, 'Besedilo točke je predolgo (največ 300 znakov).')

  // R537 (transakcijska celovitost): točka + revizija v ENI transakciji
  // (števec sortOrder se prebere ZNOTRAJ tx — sočasna doda ne more podvojiti zapisa).
  const row = await db.$transaction(async (tx) => {
    const count = await tx.installationChecklist.count({ where: { workOrderId: id } })
    const row = await tx.installationChecklist.create({
      data: { workOrderId: id, label, sortOrder: count },
      include: { doneBy: { select: { name: true } } },
    })

    await writeAudit({
      userId: auth.user.id, action: 'CHECKLIST_ADD', entity: 'installationChecklist', entityId: row.id,
      projectId: scoped.wo.projectId,
      detail: { workOrder: scoped.wo.code, label },
    }, tx)
    return row
  })
  return NextResponse.json({ data: row }, { status: 201 })
}

// PATCH /api/nalog/[id]/checklist — odkljuka točko {id, done}
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const scoped = await scopedWorkOrder(auth.user, id)
  if ('error' in scoped) return scoped.error

  const body = await req.json().catch(() => null)
  const rowId = typeof body?.id === 'string' ? body.id : ''
  const done = body?.done === true
  if (!rowId) return jsonError(400, 'Manjka identifikator točke.', 'Pričakovano polje id.')

  const row = await db.installationChecklist.findUnique({ where: { id: rowId } })
  if (!row || row.workOrderId !== id) return jsonError(404, 'Točka ne pripada temu nalogu.')

  // R537 (transakcijska celovitost): odkljuka + revizija v ENI transakciji.
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.installationChecklist.update({
      where: { id: rowId },
      data: {
        done,
        doneAt: done ? new Date() : null,
        doneById: done ? auth.user.id : null,
      },
      include: { doneBy: { select: { name: true } } },
    })

    await writeAudit({
      userId: auth.user.id, action: 'CHECKLIST_TOGGLE', entity: 'installationChecklist', entityId: rowId,
      projectId: scoped.wo.projectId,
      detail: { workOrder: scoped.wo.code, label: row.label, done },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

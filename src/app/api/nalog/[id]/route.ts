import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, managesAssignments, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent, fmtTermin } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params
  const order = await db.workOrder.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, code: true, title: true, address: true, customer: { select: { name: true } } } },
      assignee: { select: { id: true, name: true } },
      events: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      measurements: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!order) return jsonError(404, 'Nalog ne obstaja.')
  // obseg (issue #1): monter vidi podrobnosti SAMO svojih nalogov
  if (!readsAllData(user) && order.assigneeId !== user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Monter vidi samo svoje naloge; dodelitve upravlja pisarna.')
  }
  return NextResponse.json({ data: order })
}

// PATCH /api/nalog/[id] — urejanje naloga (R438, route-map izvirnika):
// title, instructions, projectId, summary; assigneeId (samo ADMIN/VODJA).
// Status gre IZKLJUČNO prek /transition, termin prek /termin (časovnica + revizija).
// Ob spremembi dodelitve → obvestilo WO_ASSIGNED (monter, brez ročnega posredovanja);
// ob spremembi navodil → WO_INSTRUCTIONS (monter). Oba emitEvent klica sta ognjevarna.
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const body = await req.json().catch(() => null) as {
    title?: unknown; instructions?: unknown; projectId?: unknown; summary?: unknown; assigneeId?: unknown
  } | null

  const order = await db.workOrder.findUnique({
    where: { id },
    include: { project: { select: { id: true, code: true } } },
  })
  if (!order) return jsonError(404, 'Nalog ne obstaja.')
  // obseg (issue #1): monter ureja samo svoj nalog
  if (!readsAllData(user) && order.assigneeId !== user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Monter ureja samo svoje naloge.')
  }

  const patch: Record<string, unknown> = {}
  if (typeof body?.title === 'string' && body.title.trim()) patch.title = body.title.trim()
  if (body?.instructions === null || typeof body?.instructions === 'string') {
    patch.instructions = typeof body.instructions === 'string' && body.instructions.trim() ? body.instructions.trim() : null
  }
  if (body?.summary === null || typeof body?.summary === 'string') {
    patch.summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null
  }
  if (typeof body?.projectId === 'string' && body.projectId) {
    const project = await db.project.findUnique({ where: { id: body.projectId }, select: { id: true } })
    if (!project) return jsonError(400, 'Projekt ne obstaja.')
    patch.projectId = project.id
  }

  // dodelitev (assigneeId): samo ADMIN/VODJA — enaka vrata kot POST (issue #1)
  let assigneeChanged = false
  if (body?.assigneeId !== undefined) {
    if (!managesAssignments(user)) {
      return jsonError(403, 'Dodelitve upravlja samo pisarna.', 'Spreminjanje assigneeId je dovoljeno roli ADMIN in VODJA.')
    }
    const newId = typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null
    if (newId) {
      const assignee = await db.user.findUnique({ where: { id: newId }, select: { id: true, active: true, name: true } })
      if (!assignee || !assignee.active) return jsonError(400, 'Izbrani monter ne obstaja ali ni aktiven.')
      assigneeChanged = newId !== order.assigneeId
      if (assigneeChanged) patch.assigneeId = newId
    } else if (order.assigneeId !== null) {
      assigneeChanged = true
      patch.assigneeId = null // odvzem dodelitve
    }
  }

  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  const updated = await db.workOrder.update({
    where: { id },
    data: patch,
    include: { project: { select: { code: true } }, assignee: { select: { name: true } } },
  })

  const instructionsChanged = 'instructions' in patch && patch.instructions !== order.instructions
  if (assigneeChanged && patch.assigneeId) {
    await db.workOrderEvent.create({
      data: {
        workOrderId: id, userId: user.id, type: 'DODELJEN',
        note: `Dodelitev: ${updated.assignee?.name ?? String(patch.assigneeId)}`,
      },
    })
  }
  await writeAudit({
    userId: user.id, action: 'WO_UPDATE', entity: 'workOrder', entityId: id, projectId: updated.projectId ?? order.projectId,
    detail: { code: order.code, polja: Object.keys(patch) },
  })

  // R438 (issue #5): obvestili — ognjevarti klici, ki ne motita odgovora ruta
  if (assigneeChanged && patch.assigneeId) {
    await emitEvent({
      type: 'WO_ASSIGNED',
      key: `wo-assign:${id}:${String(patch.assigneeId)}:${Date.now()}`,
      title: 'Nov nalog dodeljen',
      body: [
        `${updated.code} — ${updated.title}`,
        updated.project ? `projekt ${updated.project.code}` : null,
        updated.scheduledFor ? `termin: ${fmtTermin(updated.scheduledFor)}` : null,
        updated.instructions ? `navodila: ${updated.instructions.slice(0, 160)}` : null,
      ].filter(Boolean).join(' · '),
      projectId: updated.projectId ?? null,
      userIds: [String(patch.assigneeId)],
    })
  }
  if (instructionsChanged && updated.assigneeId) {
    await emitEvent({
      type: 'WO_INSTRUCTIONS',
      key: `wo-instructions:${id}:${Date.now()}`,
      title: 'Nova navodila za nalog',
      body: `${updated.code} — ${updated.title}: ${updated.instructions ?? ''}`.slice(0, 300),
      projectId: updated.projectId ?? null,
      userIds: [updated.assigneeId],
    })
  }

  return NextResponse.json({ data: updated })
}

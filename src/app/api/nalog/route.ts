import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, managesAssignments, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// GET /api/nalog?scope=today|open|mine|all — MONTER vedno vidi SAMO svoje naloge (issue #1)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') ?? 'all'
  const status = url.searchParams.get('status')
  const projectId = url.searchParams.get('projectId')

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 86400000)

  const where: Record<string, unknown> = {
    ...(status ? { status } : {}),
    ...(projectId ? { projectId } : {}),
  }
  // obseg (issue #1): monter vidi SAMO svoje naloge — neodvisno od scope (fail-closed)
  if (!readsAllData(user)) where.assigneeId = user.id
  if (scope === 'today') where.scheduledFor = { gte: today, lt: tomorrow }
  if (scope === 'mine') where.assigneeId = user.id
  if (scope === 'open') where.status = { not: 'ZAKLJUCEN' }

  const orders = await db.workOrder.findMany({
    where,
    include: {
      project: { select: { code: true, title: true, address: true, customer: { select: { name: true } } } },
      assignee: { select: { name: true } },
      _count: { select: { measurements: true, events: true } },
    },
    orderBy: [{ scheduledFor: 'asc' }, { code: 'asc' }],
  })
  return NextResponse.json({ data: orders })
}

// POST /api/nalog — nov nalog (nalog.write); dodelitev (assigneeId) samo ADMIN/VODJA
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const body = await req.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) return jsonError(400, 'Naslov naloga je obvezen.')

  const wantsAssignee = typeof body?.assigneeId === 'string' && !!body.assigneeId
  if (wantsAssignee && !managesAssignments(user)) {
    return jsonError(403, 'Dodelitve upravlja samo pisarna.', 'Spreminjanje assigneeId je dovoljeno roli ADMIN in VODJA.')
  }
  if (wantsAssignee) {
    const assignee = await db.user.findUnique({ where: { id: body.assigneeId }, select: { id: true, active: true } })
    if (!assignee || !assignee.active) return jsonError(400, 'Izbrani monter ne obstaja ali ni aktiven.')
  }

  let projectId: string | null = null
  if (typeof body?.projectId === 'string' && body.projectId) {
    const project = await db.project.findUnique({ where: { id: body.projectId }, select: { id: true } })
    if (!project) return jsonError(400, 'Projekt ne obstaja.')
    projectId = project.id
  }

  const instructions = typeof body?.instructions === 'string' && body.instructions.trim() ? body.instructions.trim() : null

  const year = new Date().getFullYear()
  const count = await db.workOrder.count()
  const code = `N-${year}-${String(count + 1).padStart(3, '0')}`

  const order = await db.workOrder.create({
    data: {
      code,
      title,
      projectId,
      assigneeId: wantsAssignee ? body.assigneeId : null,
      scheduledFor: body?.scheduledFor ? new Date(body.scheduledFor) : null,
      instructions,
    },
    include: { project: { select: { code: true, title: true } }, assignee: { select: { name: true } } },
  })

  // dogodek DODELJEN (kdo/kdaj/kaj) + revizija — občutljive spremembe ostanejo v auditu (issue #1)
  if (wantsAssignee) {
    await db.workOrderEvent.create({
      data: {
        workOrderId: order.id,
        userId: user.id,
        type: 'DODELJEN',
        note: `Dodelitev: ${order.assignee?.name ?? body.assigneeId}${instructions ? ` — navodila: ${instructions.slice(0, 120)}` : ''}`,
      },
    })
  }
  await writeAudit({
    userId: user.id,
    action: 'WO_CREATE',
    entity: 'workOrder',
    entityId: order.id,
    projectId,
    detail: { code, title, assigneeId: wantsAssignee ? body.assigneeId : null, hasInstructions: !!instructions },
  })
  return NextResponse.json({ data: order }, { status: 201 })
}

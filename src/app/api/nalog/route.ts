import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

// GET /api/nalog?scope=today|open|mine|all&status=…&projectId=…
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

// POST /api/nalog — nov nalog (nalog.write)
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) return jsonError(400, 'Naslov naloga je obvezen.')

  const year = new Date().getFullYear()
  const count = await db.workOrder.count()
  const code = `N-${year}-${String(count + 1).padStart(3, '0')}`

  const order = await db.workOrder.create({
    data: {
      code,
      title,
      projectId: typeof body?.projectId === 'string' && body.projectId ? body.projectId : null,
      assigneeId: typeof body?.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null,
      scheduledFor: body?.scheduledFor ? new Date(body.scheduledFor) : null,
    },
    include: { project: { select: { code: true, title: true } } },
  })
  return NextResponse.json({ data: order }, { status: 201 })
}

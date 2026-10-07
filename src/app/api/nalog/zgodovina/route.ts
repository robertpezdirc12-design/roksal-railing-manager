import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'

// /api/nalog/zgodovina — globalni dnevnik dogodkov delovnih nalogov (route-map: GET /api/nalog/zgodovina)
// Vrata: nalog.read. MONTER vidi samo dogodke svojih nalogov (obseg po pravicah), ostali vse.
// Query: ?take=50 (max 200), ?workOrderId=… (filter na en nalog).

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const takeRaw = Number(url.searchParams.get('take') ?? 50)
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(1, Math.trunc(takeRaw)), 200) : 50
  const workOrderId = url.searchParams.get('workOrderId')

  const where: Record<string, unknown> = {}
  if (workOrderId) where.workOrderId = workOrderId
  if (user.role === 'MONTER') where.workOrder = { assigneeId: user.id }

  const events = await db.workOrderEvent.findMany({
    where,
    include: {
      workOrder: { select: { code: true, title: true, status: true, project: { select: { code: true, title: true, customer: { select: { name: true } } } } } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  })

  return NextResponse.json({ data: events })
}

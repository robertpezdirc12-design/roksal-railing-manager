import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'

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

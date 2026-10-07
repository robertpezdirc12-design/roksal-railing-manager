import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

/** Obseg (issue #1): monter dostopa samo do projektov svojih nalogov. */
async function projectInScope (userId: string, id: string): Promise<'missing' | boolean> {
  const p = await db.project.findUnique({
    where: { id },
    select: { id: true, workOrders: { select: { assigneeId: true } } },
  })
  if (!p) return 'missing'
  return p.workOrders.some((w) => w.assigneeId === userId)
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  if (!readsAllData(user)) {
    const inScope = await projectInScope(user.id, id)
    if (inScope === 'missing') return jsonError(404, 'Projekt ne obstaja.')
    if (!inScope) return jsonError(403, 'Projekt ni v vašem obsegu.', 'Monter vidi samo projekte svojih nalogov.')
  }

  const project = await db.project.findUnique({
    where: { id },
    include: {
      customer: true,
      quotes: { include: { _count: { select: { lines: true } } }, orderBy: { createdAt: 'desc' } },
      workOrders: { include: { assignee: { select: { name: true } } }, orderBy: { scheduledFor: 'asc' } },
      measurements: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      invoices: { orderBy: { createdAt: 'desc' } },
      productionOrders: { orderBy: { dueAt: 'asc' } },
    },
  })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')
  return NextResponse.json({ data: project })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await req.json().catch(() => null)
  const existing = await db.project.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Projekt ne obstaja.')

  // obseg (issue #1): monter popravlja samo projekte svojih nalogov
  if (!readsAllData(auth.user)) {
    const inScope = await projectInScope(auth.user.id, id)
    if (!inScope) return jsonError(403, 'Projekt ni v vašem obsegu.', 'Monter popravlja samo projekte svojih nalogov.')
  }

  const patch: Record<string, unknown> = {}
  for (const key of ['title', 'status', 'address', 'note'] as const) {
    if (typeof body?.[key] === 'string') patch[key] = body[key]
  }
  if (typeof body?.customerId === 'string' || body?.customerId === null) patch.customerId = body.customerId || null
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  const updated = await db.project.update({ where: { id }, data: patch, include: { customer: { select: { name: true } } } })
  await writeAudit({
    userId: auth.user.id, action: 'PROJECT_UPDATE', entity: 'project', entityId: id, projectId: id,
    detail: patch as Record<string, unknown>,
  })
  return NextResponse.json({ data: updated })
}

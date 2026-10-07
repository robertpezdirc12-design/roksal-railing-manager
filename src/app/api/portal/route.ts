import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'

// /api/portal — povezave portala stranke (route-map izvirnika: /portal + /p/[token])
// GET  (projects.read): ?projectId=… → povezave projekta (+ status veljavnosti)
// POST (projects.write): { projectId, days?, note? } → nova povezava (žeton, rok)
// Revizija: PORTAL_CREATE.

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const now = new Date()

  const links = await db.portalLink.findMany({
    where: projectId ? { projectId } : {},
    include: { project: { select: { code: true, title: true } } },
    orderBy: { createdAt: 'desc' },
  })

  const data = links.map((l) => ({
    id: l.id,
    token: l.token,
    projectId: l.projectId,
    project: l.project,
    note: l.note,
    views: l.views,
    lastViewedAt: l.lastViewedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    expiresAt: l.expiresAt.toISOString(),
    revokedAt: l.revokedAt?.toISOString() ?? null,
    active: !l.revokedAt && l.expiresAt >= now,
  }))

  return NextResponse.json({ data })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as { projectId?: string; days?: number; note?: string } | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) return jsonError(400, 'Manjka projekt.')

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, customer: { select: { name: true, email: true } } },
  })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const days = Number(body?.days)
  const d = Number.isFinite(days) && days >= 1 && days <= 365 ? Math.trunc(days) : 90

  const link = await db.portalLink.create({
    data: {
      token: 'pt-' + randomUUID().replace(/-/g, ''),
      projectId,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
      expiresAt: new Date(Date.now() + d * 86400000),
    },
  })
  await writeAudit({
    userId: user.id, action: 'PORTAL_CREATE', entity: 'portalLink', entityId: link.id, projectId,
    detail: JSON.stringify({ project: project.code, days: d }),
  })

  // R438 (issue #5): objava portala → statusno obvestilo stranki (EMAIL).
  // Pozor: žetona NE vključimo v telo obvestila (varnost — povezavo posreduje pisarna).
  await emitEvent({
    type: 'PORTAL_PUBLISHED',
    key: `portal-published:${link.id}`,
    title: `Objavljen portal projekta ${project.code}`,
    body: `Objavljen portal projekta ${project.code} — sledite poteku del na povezavi, ki vam jo je posredovala pisarna.`,
    projectId,
    customerEmail: project.customer?.email ?? null,
    customerName: project.customer?.name ?? null,
  })

  return NextResponse.json({ data: link }, { status: 201 })
}

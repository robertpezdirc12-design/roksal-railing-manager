import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { VIZ_LINK_DEFAULT_DAYS, VIZ_LINK_MAX_DAYS } from '@/lib/viz-core'

// /api/projects/[id]/viz-link — JAVNA POVEZAVA VIZUALIZATORJA (R480 — issue #9 §10)
// GET    (portal.manage): obstoječe povezave projekta (+ stanje veljavnosti)
// POST   (portal.manage): { days? (privzeto 14, max 90), note? } → nova
//        povezava { token 'pv-…', url: '/v/<token>', expiresAt } — javna HTML
//        stran vizualizatorja je /v/[token] (frontend R480); JSON API pa
//        /api/public/viz?token=…
// DELETE (portal.manage): ?id=… (ali telo { id }) → preklic (revokedAt) —
//        javni dostop TAKOJ preneha (idempotentno).
// Objava na javni poti je dejanje PISARNE (portal.manage = ADMIN/VODJA —
// isti vzorec kot review-link iz R479; monter 403).
// Reviziji: VIZLINK_CREATE / VIZLINK_REVOKE (žeton v reviziji prikrit).

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'portal.manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const project = await db.project.findUnique({ where: { id }, select: { id: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const links = await db.vizLink.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
  })
  const now = new Date()
  return NextResponse.json({
    data: links.map((l) => ({
      id: l.id,
      token: l.token,
      url: `/v/${l.token}`,
      projectId: l.projectId,
      note: l.note,
      viewCount: l.viewCount,
      lastViewAt: l.lastViewAt?.toISOString() ?? null,
      revokedAt: l.revokedAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      expiresAt: l.expiresAt.toISOString(),
      active: !l.revokedAt && l.expiresAt >= now,
    })),
  })
}

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'portal.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const project = await db.project.findUnique({ where: { id }, select: { id: true, code: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const body = await req.json().catch(() => null) as { days?: number; note?: string } | null
  const daysNum = Number(body?.days)
  const days = Number.isFinite(daysNum) && daysNum >= 1 && daysNum <= VIZ_LINK_MAX_DAYS
    ? Math.trunc(daysNum)
    : VIZ_LINK_DEFAULT_DAYS

  const link = await db.vizLink.create({
    data: {
      token: 'pv-' + randomUUID().replace(/-/g, ''),
      projectId: id,
      createdById: user.id,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
      expiresAt: new Date(Date.now() + days * 86400000),
    },
  })
  await writeAudit({
    userId: user.id, action: 'VIZLINK_CREATE', entity: 'vizLink', entityId: link.id, projectId: id,
    detail: { project: project.code, days, expiresAt: link.expiresAt.toISOString() },
  })

  return NextResponse.json({
    data: {
      id: link.id,
      token: link.token,
      url: `/v/${link.token}`,
      expiresAt: link.expiresAt.toISOString(),
      note: link.note,
    },
  }, { status: 201 })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'portal.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const project = await db.project.findUnique({ where: { id }, select: { id: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const url = new URL(req.url)
  const body = await req.json().catch(() => null) as { id?: string } | null
  const linkId = url.searchParams.get('id') ?? (typeof body?.id === 'string' ? body.id : '')
  if (!linkId) return jsonError(400, 'Manjka id povezave.', 'Podajte ?id=… povezave, ki jo preklicujete.')

  const link = await db.vizLink.findUnique({ where: { id: linkId } })
  if (!link || link.projectId !== id) return jsonError(404, 'Povezava ne obstaja.')
  if (link.revokedAt) return NextResponse.json({ data: { revoked: true, id: linkId } }) // idempotentno

  await db.vizLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } })
  await writeAudit({
    userId: user.id, action: 'VIZLINK_REVOKE', entity: 'vizLink', entityId: linkId, projectId: id,
    detail: { token: link.token.slice(0, 8) + '…' }, // prikrit žeton (varnost)
  })

  return NextResponse.json({ data: { revoked: true, id: linkId } })
}

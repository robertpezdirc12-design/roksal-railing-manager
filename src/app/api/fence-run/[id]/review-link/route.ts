import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { fenceRunZaUporabnika } from '@/lib/fence-run-access'
import { REVIEW_LINK_DEFAULT_DAYS, REVIEW_LINK_MAX_DAYS } from '@/lib/pin-core'

// /api/fence-run/[id]/review-link — JAVNA DELITEV PREGLEDA (R479 — issue #9 §7)
// GET    (portal.manage): obstoječe povezave tekača (+ stanje veljavnosti)
// POST   (portal.manage): { days? (privzeto 14, max 90), note? } → nova
//        povezava { url: '/api/public/review?token=…', token, expiresAt }.
//        Objava na javni pot je dejanje PISARNE (portal.manage = ADMIN/VODJA
//        — isti vzorec kot upravljanje portala stranke).
// DELETE (portal.manage): ?id=… (ali telo { id }) → preklic (revokedAt) —
//        javni dostop TAKOJ preneha.
// Reviziji: REVIEWLINK_CREATE / REVIEWLINK_REVOKE.

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'portal.manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const scope = await fenceRunZaUporabnika(auth.user, id)
  if (scope instanceof NextResponse) return scope

  const links = await db.reviewLink.findMany({
    where: { fenceRunId: id },
    orderBy: { createdAt: 'desc' },
  })
  const now = new Date()
  return NextResponse.json({
    data: links.map((l) => ({
      id: l.id,
      token: l.token,
      url: `/api/public/review?token=${l.token}`,
      fenceRunId: l.fenceRunId,
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

  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope

  const body = await req.json().catch(() => null) as { days?: number; note?: string } | null
  const daysNum = Number(body?.days)
  const days = Number.isFinite(daysNum) && daysNum >= 1 && daysNum <= REVIEW_LINK_MAX_DAYS
    ? Math.trunc(daysNum)
    : REVIEW_LINK_DEFAULT_DAYS

  const link = await db.reviewLink.create({
    data: {
      token: 'rv-' + randomUUID().replace(/-/g, ''),
      fenceRunId: id,
      createdById: user.id,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
      expiresAt: new Date(Date.now() + days * 86400000),
    },
  })
  await writeAudit({
    userId: user.id, action: 'REVIEWLINK_CREATE', entity: 'reviewLink', entityId: link.id,
    projectId: scope.run.projectId,
    detail: { fenceRunId: id, run: scope.run.name, days, expiresAt: link.expiresAt.toISOString() },
  })

  return NextResponse.json({
    data: {
      id: link.id,
      token: link.token,
      url: `/api/public/review?token=${link.token}`,
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

  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope

  const url = new URL(req.url)
  const body = await req.json().catch(() => null) as { id?: string } | null
  const linkId = url.searchParams.get('id') ?? (typeof body?.id === 'string' ? body.id : '')
  if (!linkId) return jsonError(400, 'Manjka id povezave.', 'Podajte ?id=… povezave, ki jo preklicujete.')

  const link = await db.reviewLink.findUnique({ where: { id: linkId } })
  if (!link || link.fenceRunId !== id) return jsonError(404, 'Povezava ne obstaja.')
  if (link.revokedAt) return NextResponse.json({ data: { revoked: true, id: linkId } }) // idempotentno

  await db.reviewLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } })
  await writeAudit({
    userId: user.id, action: 'REVIEWLINK_REVOKE', entity: 'reviewLink', entityId: linkId,
    projectId: scope.run.projectId,
    detail: { fenceRunId: id, token: link.token.slice(0, 10) + '…' }, // prikrit žeton (varnost)
  })

  return NextResponse.json({ data: { revoked: true, id: linkId } })
}

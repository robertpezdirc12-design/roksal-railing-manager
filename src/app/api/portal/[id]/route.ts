import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/portal/[id] — preklic povezave portala (route-map: DELETE /api/portal/[id])
// DELETE (projects.write): preklic — javni dostop takoj preneha (revokedAt).
// Revizija: PORTAL_REVOKE.

type Params = { params: Promise<{ id: string }> }

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const link = await db.portalLink.findUnique({ where: { id }, include: { project: { select: { code: true } } } })
  if (!link) return jsonError(404, 'Povezava ne obstaja.')
  if (link.revokedAt) return NextResponse.json({ data: link }) // idempotentno

  const revoked = await db.portalLink.update({
    where: { id },
    data: { revokedAt: new Date() },
  })
  await writeAudit({
    userId: user.id, action: 'PORTAL_REVOKE', entity: 'portalLink', entityId: id, projectId: link.projectId,
    detail: { project: link.project.code, token: link.token.slice(0, 12) + '…' },
  })

  return NextResponse.json({ data: revoked })
}

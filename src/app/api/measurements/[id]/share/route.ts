// /api/measurements/[id]/share — R437 (issue #2): javna deljena povezava meritve
// (route-map izvirnika: /m/[token] → tu /api/public/measure?token=…)
// POST   (measurements.write): generira nov žeton 'jm-<uuid>', shrani, revizija MEASURE_SHARE
//        → { token, url: '/api/public/measure?token=…' } (nova povezava nadomesti prejšnjo)
// DELETE (measurements.write): preklic — shareToken = null, revizija MEASURE_SHARE_REVOKE
// Obseg: isti kot PATCH /api/measurements/[id] (monter samo svoje meritve / meritve svojih nalogov).

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// R535: življenjska doba deljene povezave — 30 dni od delitenja. Prej so žetoni
// jm- NIKOLI ne potekli (revizija analize: odstopanje od SECRETS.md „časovno
// omejene“). Stare povezave (shareExpiresAt = null) veljajo do preklica —
// združljivost nazaj, brez tihe podaljšanja novih.
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000

type Params = { params: Promise<{ id: string }> }

/** Obseg (issue #1, enak kot [id] PATCH): monter deli samo svoje meritve. */
async function scopeDenied (userId: string, allData: boolean, measurementId: string): Promise<boolean> {
  if (allData) return false
  const m = await db.measurement.findUnique({
    where: { id: measurementId },
    select: { authorId: true, workOrder: { select: { assigneeId: true } } },
  })
  return m === null || (m.authorId !== userId && m.workOrder?.assigneeId !== userId)
}

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const existing = await db.measurement.findUnique({ where: { id }, select: { id: true, projectId: true, type: true, location: true, shareToken: true } })
  if (!existing) return jsonError(404, 'Meritev ne obstaja.')

  if (await scopeDenied(user.id, readsAllData(user), id)) {
    return jsonError(403, 'Meritev ni v vašem obsegu.', 'Monter lahko deli samo svoje meritve in meritve svojih nalogov.')
  }

  // nov žeton ob vsakem deljenju (prejšnja povezava s tem izgubi veljavnost);
  // R535: hkrati se zapiše rok veljavnosti — prekliče se z DELETE
  const token = `jm-${randomUUID()}`
  const shareExpiresAt = new Date(Date.now() + SHARE_TTL_MS)

  // R538: transakcijska celovitost — žeton + revizija atomarno (vzorec R537-d)
  await db.$transaction(async (tx) => {
    await tx.measurement.update({ where: { id }, data: { shareToken: token, shareExpiresAt } })

    await writeAudit({
      userId: user.id,
      action: 'MEASURE_SHARE',
      entity: 'measurement',
      entityId: id,
      projectId: existing.projectId,
      detail: { type: existing.type, location: existing.location, regenerate: !!existing.shareToken },
    }, tx)
  })

  return NextResponse.json({ data: { token, url: `/api/public/measure?token=${token}`, expiresAt: shareExpiresAt.toISOString() } }, { status: 201 })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const existing = await db.measurement.findUnique({ where: { id }, select: { id: true, projectId: true, shareToken: true } })
  if (!existing) return jsonError(404, 'Meritev ne obstaja.')

  if (await scopeDenied(user.id, readsAllData(user), id)) {
    return jsonError(403, 'Meritev ni v vašem obsegu.', 'Monter lahko prekliče deljenje samo svojih meritev.')
  }

  // R538: transakcijska celovitost — umik žetona + revizija atomarno (vzorec R537-d)
  await db.$transaction(async (tx) => {
    await tx.measurement.update({ where: { id }, data: { shareToken: null, shareExpiresAt: null } })

    await writeAudit({
      userId: user.id,
      action: 'MEASURE_SHARE_REVOKE',
      entity: 'measurement',
      entityId: id,
      projectId: existing.projectId,
      detail: { hadToken: !!existing.shareToken },
    }, tx)
  })

  return NextResponse.json({ data: { ok: true, revoked: !!existing.shareToken } })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError } from '@/lib/auth'
import { permissionsForRole } from '@/lib/permissions-core'
import { writeAudit } from '@/lib/audit'

// /api/auth/sessions/[id] — preklic seje (route-map: DELETE /api/auth/sessions/[id])
// Uporabnik lahko prekliče SVOJO sejo; tujo samo s pravico security.read (ADMIN).
// Preklic TRENUTNE seje = odjava (dovoljeno — enako kot /api/auth/logout).

type Params = { params: Promise<{ id: string }> }

export async function DELETE (req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')
  const { id } = await params

  const session = await db.session.findUnique({
    where: { id },
    select: { id: true, userId: true, token: true, user: { select: { name: true } } },
  })
  if (!session) return jsonError(404, 'Seja ne obstaja (morda je že pretečena).')

  if (session.userId !== user.id) {
    const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { role: true } })
    if (!permissionsForRole(dbUser?.role ?? '').includes('security.read')) {
      return jsonError(403, 'Preklic tuje seje zahteva pravico security.read.')
    }
  }

  // R538: transakcijska celovitost — preklic seje + revizija atomarno (vzorec R537-d)
  await db.$transaction(async (tx) => {
    await tx.session.delete({ where: { id } })
    await writeAudit({
      userId: user.id, action: 'SESSION_REVOKE', entity: 'session', entityId: id,
      detail: { owner: session.userId, current: session.token === (req.headers.get('authorization') ?? '').slice(7).trim() },
    }, tx)
  })
  return NextResponse.json({ ok: true })
}

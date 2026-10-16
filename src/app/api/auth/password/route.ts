import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, hashPassword, jsonError, sessionTokenHash, verifyPassword } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/auth/password — sprememba lastnega gesla (route-map: POST /api/auth/password)
// Zahteva trenutno geslo; po uspehu prekliče VSE DRUGE seje (ostane samo trenutna).

export async function POST (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')

  const body = await req.json().catch(() => null) as { current?: string; next?: string } | null
  const current = body?.current ?? ''
  const next = body?.next ?? ''

  if (next.length < 8) return jsonError(400, 'Novo geslo mora imeti vsaj 8 znakov.')

  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } })
  if (!dbUser || !verifyPassword(current, dbUser.passwordHash)) {
    return jsonError(401, 'Trenutno geslo ni pravilno.')
  }
  if (current === next) return jsonError(400, 'Novo geslo mora biti različno od trenutnega.')

  const header = req.headers.get('authorization') ?? ''
  const currentToken = header.slice(7).trim()

  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(next) } })
  // preklic vseh ostalih sej (varnost: geslo se je spremenilo); trenutna se
  // obvaruje v OBEH oblikah (zgoščena + zgodovinska surova — R534 #21 §4)
  const removed = await db.session.deleteMany({
    where: { userId: user.id, NOT: { token: { in: [sessionTokenHash(currentToken), currentToken] } } },
  })
  await writeAudit({ userId: user.id, action: 'PASSWORD_CHANGE', entity: 'user', entityId: user.id, detail: { sessionsRevoked: removed.count } })

  return NextResponse.json({ ok: true, sessionsRevoked: removed.count })
}

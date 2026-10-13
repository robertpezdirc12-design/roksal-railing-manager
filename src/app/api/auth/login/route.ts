import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authRateLimited } from '@/lib/rate-limit'
import { createSession, jsonError, toSessionUser, verifyPassword } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

export async function POST (req: NextRequest) {
  // R496: zavora brute-force napada na gesla (glej rate-limit.ts — poštena meja)
  if (authRateLimited(req)) {
    return jsonError(429, 'Preveč poskusov prijave.', 'Počakaj eno minuto in poskusi znova.')
  }
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) {
    return jsonError(400, 'Manjkajo prijavni podatki.', 'Potrebna sta e-pošta in geslo.')
  }
  const user = await db.user.findUnique({ where: { email } })
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    return jsonError(401, 'Neveljavna prijava.', 'E-pošta ali geslo ni pravilno.')
  }
  const token = await createSession(user.id)
  await writeAudit({ userId: user.id, action: 'LOGIN', entity: 'user', entityId: user.id })
  return NextResponse.json({ token, user: toSessionUser(user) })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authRateLimited } from '@/lib/rate-limit'
import { createSession, hashPassword, jsonError, toSessionUser } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/setup — začetna namestitev (route-map izvirnika: /setup)
// GET  (javno): { needed } — ali aplikacija še nima nobenega uporabnika
// POST (javno, SAMO ko ni uporabnikov): ustvari prvega ADMIN-a in prijavi
// Takoj ko obstaja vsaj en uporabnik, POST vrne 403 (enkratna zaklenjena vrata).
// Revizija: SETUP_COMPLETE.

export const dynamic = 'force-dynamic'

export async function GET () {
  const count = await db.user.count()
  return NextResponse.json({ data: { needed: count === 0, users: count } })
}

export async function POST (req: NextRequest) {
  // R496: okno namestitve je javno — omejimo poskuse na IP (first-comer prevzeme SYSTEM)
  if (authRateLimited(req)) {
    return jsonError(429, 'Preveč poskusov.', 'Počakaj eno minuto in poskusi znova.')
  }
  const count = await db.user.count()
  if (count > 0) {
    return jsonError(403, 'Namestitev je že zaključena.', 'Obstajajoči uporabniki se prijavijo običajno.')
  }

  const body = await req.json().catch(() => null) as { name?: string; email?: string; password?: string } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (name.length < 2) return jsonError(400, 'Ime je prekratko.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, 'Neveljaven e-poštni naslov.')
  if (password.length < 8) return jsonError(400, 'Geslo mora imeti vsaj 8 znakov.')

  const user = await db.user.create({
    data: { email, passwordHash: hashPassword(password), name, role: 'ADMIN' },
  })
  await writeAudit({
    userId: user.id, action: 'SETUP_COMPLETE', entity: 'sistem',
    detail: { note: 'Začetna namestitev — prvi administrator', email },
  })

  const token = await createSession(user.id)
  return NextResponse.json({ data: { token, user: toSessionUser(user) } }, { status: 201 })
}

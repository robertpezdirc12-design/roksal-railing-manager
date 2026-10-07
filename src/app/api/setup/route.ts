import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSession, hashPassword, toSessionUser } from '@/lib/auth'
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
  const count = await db.user.count()
  if (count > 0) {
    return NextResponse.json({ error: 'Namestitev je že zaključena.', detail: 'Obstajajoči uporabniki se prijavijo običajno.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as { name?: string; email?: string; password?: string } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (name.length < 2) return NextResponse.json({ error: 'Ime je prekratko.' }, { status: 400 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Neveljaven e-poštni naslov.' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'Geslo mora imeti vsaj 8 znakov.' }, { status: 400 })

  const user = await db.user.create({
    data: { email, passwordHash: hashPassword(password), name, role: 'ADMIN' },
  })
  await writeAudit({
    userId: user.id, action: 'SETUP_COMPLETE', entity: 'sistem',
    detail: JSON.stringify({ note: 'Začetna namestitev — prvi administrator', email }),
  })

  const token = await createSession(user.id)
  return NextResponse.json({ data: { token, user: toSessionUser(user) } }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authRateLimited } from '@/lib/rate-limit'
import { createSession, jsonError, toSessionUser } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/auth/demo — demo dostop (route-map izvirnika; zahteva DEMO_ACCESS=on)
// R496: gesla demo računov NI VEČ v odjemalskem svežnju. Odjemalec pozna le
// e-pošto in oznako; sejo odpre strežnik SAM, potem ko preveri stikalo in
// seznam dovoljenih naslovov.
// GET  (javno): { enabled, accounts } — brez gesel; enabled = DEMO_ACCESS=on
// POST (javno): { email } → seja, SAMO za naštete račune in SAMO z vključenim stikalom
// Revizija: LOGIN_DEMO.

export const dynamic = 'force-dynamic'

/** Fiksni seznam demo računov (ujema prazne baze iz prisma/seed.cjs). */
const DEMO_ACCOUNTS = [
  { email: 'admin@roksal.si', label: 'Administrator', hint: 'Robert Pezdirc' },
  { email: 'vodja@roksal.si', label: 'Vodja', hint: 'Matej Kovač' },
  { email: 'monter@roksal.si', label: 'Monter', hint: 'Luka Novak' },
  { email: 'skladisce@roksal.si', label: 'Skladišče', hint: 'Tomaž Zupan' },
  { email: 'proizvodnja@roksal.si', label: 'Proizvodnja', hint: 'Ana Kos' },
] as const

const DEMO_EMAILS = new Set<string>(DEMO_ACCOUNTS.map((a) => a.email))

function demoEnabled (): boolean {
  return process.env.DEMO_ACCESS === 'on'
}

export async function GET () {
  if (!demoEnabled()) return NextResponse.json({ data: { enabled: false, accounts: [] } })
  return NextResponse.json({
    data: { enabled: true, accounts: DEMO_ACCOUNTS.map(({ email, label, hint }) => ({ email, label, hint })) },
  })
}

export async function POST (req: NextRequest) {
  if (!demoEnabled()) {
    // brez stikala se pot vede, kot da ne obstaja
    return jsonError(404, 'Ni prijave.', 'Demo dostop ni vklopljen (DEMO_ACCESS).')
  }
  if (await authRateLimited(req)) {
    return jsonError(429, 'Preveč poskusov prijave.', 'Počakaj eno minuto in poskusi znova.')
  }

  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!DEMO_EMAILS.has(email)) return jsonError(400, 'Račun ni demo račun.')

  const user = await db.user.findUnique({ where: { email } })
  if (!user || !user.active) return jsonError(401, 'Neveljavna prijava.', 'Demo račun ne obstaja ali je onemogočen.')

  const token = await createSession(user.id)
  await writeAudit({
    userId: user.id, action: 'LOGIN_DEMO', entity: 'user', entityId: user.id,
    detail: { note: 'Demo prijava prek /api/auth/demo (DEMO_ACCESS=on)', ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null },
  })
  return NextResponse.json({ data: { token, user: toSessionUser(user) } })
}

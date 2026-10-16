import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findSessionByToken, getSessionUser, jsonError } from '@/lib/auth'
import { permissionsForRole } from '@/lib/permissions-core'

// /api/auth/sessions — seznam sej (route-map: GET /api/auth/sessions)
// Privzeto LASTNE seje prijavljenega uporabnika; ?all=1 zahteva security.read (ADMIN) → vse seje.
// Žetonov NE izdajemo — samo id/ustvarjeno/poteče + oznaka trenutne seje.

export async function GET (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')

  const header = req.headers.get('authorization') ?? ''
  const currentToken = header.slice(7).trim()

  const all = new URL(req.url).searchParams.get('all') === '1'
  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { role: true } })
  if (all && !permissionsForRole(dbUser?.role ?? '').includes('security.read')) {
    return jsonError(403, 'Pregled vseh sej zahteva pravico security.read.')
  }

  const sessions = await db.session.findMany({
    where: all ? {} : { userId: user.id },
    select: { id: true, userId: true, createdAt: true, expiresAt: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // R534 (#21 §4): trenutno sejo poiščemo po pomočniku (zgoščeno + zgodovinsko
  // surovo z nadgradnjo na mestu) — žetonov NE izdajamo, samo oznaka »current«
  const current = await findSessionByToken(currentToken)
  return NextResponse.json({
    data: sessions.map((s) => ({ ...s, current: s.id === current?.id })),
    all,
  })
}

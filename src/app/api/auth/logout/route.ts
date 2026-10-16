import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookie, deleteSessionsByToken, getSessionUser, readSessionToken } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/auth/logout — odjava (route-map izvirnika)
// R538: sejo lahko nosi Bearer glava (programski odjemalci) ALI httpOnly
// piškotek `roksal_session` (brskalnik) — žeton preberemo po isti prednostni
// poti kot avtentikacija (readSessionToken). Ne glede na izvor na odgovoru
// POČISTIMO piškotek, da brskalnik pozabi žeton tudi takrat, ko vrstica v
// bazi že ne obstaja več (idempotentna odjava, kot doslej).

export async function POST (req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  const user = await getSessionUser(req)
  if (user) {
    const token = readSessionToken(req)
    // R534 (#21 §4): preklic pokrije zgoščeno IN zgodovinsko (surovo) vrstico
    if (token) await deleteSessionsByToken(token)
    await writeAudit({ userId: user.id, action: 'LOGOUT', entity: 'user', entityId: user.id })
  }
  clearSessionCookie(res) // R538: brskalnik pozabi piškotek seje (maxAge 0)
  return res
}

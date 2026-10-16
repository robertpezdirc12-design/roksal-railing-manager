import { NextRequest, NextResponse } from 'next/server'
import { deleteSessionsByToken, getSessionUser } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

export async function POST (req: NextRequest) {
  const user = await getSessionUser(req)
  if (user) {
    const header = req.headers.get('authorization') ?? ''
    const token = header.slice(7).trim()
    // R534 (#21 §4): preklic pokrije zgoščeno IN zgodovinsko (surovo) vrstico
    await deleteSessionsByToken(token)
    await writeAudit({ userId: user.id, action: 'LOGOUT', entity: 'user', entityId: user.id })
  }
  return NextResponse.json({ ok: true })
}

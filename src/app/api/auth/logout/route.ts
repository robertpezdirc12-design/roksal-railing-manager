import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

export async function POST (req: NextRequest) {
  const user = await getSessionUser(req)
  if (user) {
    const header = req.headers.get('authorization') ?? ''
    const token = header.slice(7).trim()
    await db.session.deleteMany({ where: { token } })
    await writeAudit({ userId: user.id, action: 'LOGOUT', entity: 'user', entityId: user.id })
  }
  return NextResponse.json({ ok: true })
}

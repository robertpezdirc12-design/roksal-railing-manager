import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError } from '@/lib/auth'

export async function GET (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')
  const url = new URL(req.url)
  const unreadOnly = url.searchParams.get('unread') === '1'
  const data = await db.notification.findMany({
    where: { OR: [{ userId: user.id }, { userId: null }], ...(unreadOnly ? { read: false } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  return NextResponse.json({ data, unread: data.filter((n) => !n.read).length })
}

export async function POST (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')
  await db.notification.updateMany({ where: { OR: [{ userId: user.id }, { userId: null }] }, data: { read: true } })
  return NextResponse.json({ ok: true })
}

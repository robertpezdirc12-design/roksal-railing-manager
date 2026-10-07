import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError } from '@/lib/auth'

// /api/notifications/deliveries — R438 (issue #5): sled dostav obvestil.
// GET (prijava): lastne dostave z event podatki; ?all=1 zahteva security.read
//    → vse dostave z uporabniškimi imeni; ?status=SENT|FAILED|SKIPPED|PENDING filter;
//    ?take=1..200 (privzeto 200). Prejemnik je vedno PRIKRITEN (maskiran ob zapisu).

const STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED']

/** Razčleni payload eventa (title/body) — odporen proti praznemu/pokvarjenemu JSON. */
function parsePayload (raw: string): { title: string; body: string } {
  try {
    const p = JSON.parse(raw) as { title?: string; body?: string }
    return { title: p.title ?? '', body: p.body ?? '' }
  } catch {
    return { title: '', body: '' }
  }
}

export async function GET (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')

  const url = new URL(req.url)
  const all = url.searchParams.get('all') === '1'
  const status = url.searchParams.get('status')
  const take = Math.min(Math.max(Number(url.searchParams.get('take') ?? 200) || 200, 1), 200)

  // ?all=1: celoten dnevnik dostav — samo security.read (ADMIN)
  if (all && !user.perms.includes('security.read')) {
    return jsonError(403, 'Dostop zavrnjen — manjka pravica security.read.', 'Celoten dnevnik dostav vidita samo ADMIN.')
  }
  if (status && !STATUSES.includes(status)) {
    return jsonError(400, 'Neveljaven status.', `Veljavni: ${STATUSES.join(', ')}.`)
  }

  const deliveries = await db.notificationDelivery.findMany({
    where: {
      ...(all ? {} : { userId: user.id }), // privzeto: SAMO lastne dostave
      ...(status ? { status } : {}),
    },
    include: {
      event: { select: { id: true, type: true, key: true, payload: true, createdAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  })

  // imena uporabnikov (dostava ima skalarni userId brez relacije — poizvedba posebej)
  let names = new Map<string, string>()
  if (all && deliveries.length > 0) {
    const ids = [...new Set(deliveries.map((d) => d.userId).filter((v): v is string => !!v))]
    if (ids.length > 0) {
      const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      names = new Map(users.map((u) => [u.id, u.name]))
    }
  }

  const rows = deliveries.map((d) => ({
    id: d.id,
    channel: d.channel,
    userId: d.userId,
    recipient: d.recipient, // prikrit že ob zapisu (maskEmail) — cel naslov NIKOLI ne zapusti strežnika
    status: d.status,
    attempts: d.attempts,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
    sentAt: d.sentAt?.toISOString() ?? null,
    event: {
      id: d.event.id,
      type: d.event.type,
      key: d.event.key,
      ...parsePayload(d.event.payload),
      createdAt: d.event.createdAt.toISOString(),
    },
    ...(all ? { user: d.userId ? { name: names.get(d.userId) ?? '—' } : null } : {}),
  }))

  return NextResponse.json({ data: rows })
}

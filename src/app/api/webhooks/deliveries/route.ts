import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

// /api/webhooks/deliveries — ZGODOVINA DOSTAV (R481 — issue #9 §9;
// integrations.manage). ?subscriptionId=&status=&limit= (zadnjih 100,
// privzeto 50, newest first). Prikazano BREZ secretHash (tudi tu: podpisni
// ključ nikoli ne gre ven) — vrstica nosi eventKey/tip/status/poskuse/čas.

const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED', 'DEAD']

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'integrations.manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const subscriptionId = url.searchParams.get('subscriptionId')
  const status = url.searchParams.get('status')
  const limitNum = Number(url.searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(limitNum) ? Math.min(Math.max(Math.trunc(limitNum), 1), 100) : 50

  if (status && !DELIVERY_STATUSES.includes(status)) {
    return jsonError(400, 'Neveljaven status.', `Veljavni: ${DELIVERY_STATUSES.join(', ')}.`)
  }
  if (subscriptionId) {
    const sub = await db.webhookSubscription.findUnique({ where: { id: subscriptionId }, select: { id: true } })
    if (!sub) return jsonError(404, 'Naročnina ne obstaja.')
  }

  const rows = await db.webhookDelivery.findMany({
    where: {
      ...(subscriptionId ? { subscriptionId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { subscription: { select: { url: true } } },
  })

  return NextResponse.json({
    data: rows.map((d) => ({
      id: d.id,
      subscriptionId: d.subscriptionId,
      url: d.subscription.url,
      eventKey: d.eventKey,
      eventType: d.eventType,
      status: d.status,
      attempts: d.attempts,
      lastAttemptAt: d.lastAttemptAt?.toISOString() ?? null,
      responseStatus: d.responseStatus,
      nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
      error: d.error,
      createdAt: d.createdAt.toISOString(),
    })),
  })
}

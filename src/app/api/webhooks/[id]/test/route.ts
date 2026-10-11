import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { rateLimited } from '@/lib/rate-limit'
import { attemptWebhookDelivery } from '@/lib/webhook-delivery'
import { publicWebhookPayload, WEBHOOK_TEST_EVENT } from '@/lib/webhook-core'

// /api/webhooks/[id]/test — TESTNI PING naročnine (R481 — issue #9 §9;
// integrations.manage). Pošlje enkratni WEBHOOK_TEST dogodek na ciljni URL
// (isti podpis/glaste kot prava dostava) → 200 { delivered, responseStatus,
// error? }. Tempomat 10/min na naročnino (rate-limit vzorec javnih poti).
// eventKey = `webhook-test:<id>:<epoch ms>` — NE sodeluje z idempotenco
// pravih dogodkov (vsak ping je sveža vrstica v zgodovini dostav).

type Params = { params: Promise<{ id: string }> }

const TEST_RATE_MAX = 10

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'integrations.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  if (rateLimited(`webhook-test:${id}`, TEST_RATE_MAX)) {
    return jsonError(429, 'Preveč testnih pingov.', `Tempomat: ${TEST_RATE_MAX}/min na naročnino.`)
  }

  const sub = await db.webhookSubscription.findUnique({ where: { id } })
  if (!sub) return jsonError(404, 'Naročnina ne obstaja.')
  if (!sub.active || sub.revokedAt) return jsonError(409, 'Naročnina ni aktivna.')

  const now = new Date()
  const eventKey = `webhook-test:${id}:${now.getTime()}`

  const delivery = await db.webhookDelivery.create({
    data: {
      subscriptionId: id,
      eventKey,
      eventType: WEBHOOK_TEST_EVENT,
      payload: JSON.stringify(publicWebhookPayload({
        eventKey,
        eventType: WEBHOOK_TEST_EVENT,
        occurredAt: now,
        title: 'Webhook test',
        body: 'To je testni ping naročnine ROKSAL — potrditev prejema (in podpisa).',
      })),
      status: 'PENDING',
    },
  })

  const result = await attemptWebhookDelivery(delivery.id)

  await writeAudit({
    userId: user.id,
    action: 'WEBHOOK_TEST',
    entity: 'webhookSubscription',
    entityId: id,
    detail: { delivered: result.ok, responseStatus: result.responseStatus, ...(result.error ? { error: result.error } : {}) },
  })

  return NextResponse.json({
    data: {
      delivered: result.ok,
      responseStatus: result.responseStatus,
      ...(result.error ? { error: result.error } : {}),
    },
  })
}

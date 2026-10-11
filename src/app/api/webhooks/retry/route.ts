import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { rateLimited } from '@/lib/rate-limit'
import { retryWebhookDeliveries } from '@/lib/webhook-delivery'

// /api/webhooks/retry — ROČNA PONOVITEV dostav (R481 — issue #9 §9;
// integrations.manage). Pobere PENDING/FAILED vrstice z nextAttemptAt <= zdaj
// in jih poskusi znova (backoff 1/5/30 min, mrtvo pismo po 5 poskusih).
// Namenjeno polepšanju dnevne zamude cron joba webhook-retry (jobs/run 03:30);
// tempomat 30/min na uporabnika (vzorec javnih poti; teste ponovitve poznajo).

const RETRY_RATE_MAX = 30

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'integrations.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  if (rateLimited(`webhook-retry:${user.id}`, RETRY_RATE_MAX)) {
    return jsonError(429, 'Preveč klicev ponovitve.', `Tempomat: ${RETRY_RATE_MAX}/min.`)
  }

  const result = await retryWebhookDeliveries(50)

  await writeAudit({
    userId: user.id,
    action: 'WEBHOOK_RETRY',
    entity: 'webhookDelivery',
    detail: { processed: result.processed, sent: result.sent, failed: result.failed, dead: result.dead },
  })

  return NextResponse.json({ data: result })
}

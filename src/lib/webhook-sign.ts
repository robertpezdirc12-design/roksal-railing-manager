// webhook-sign — R481 (issue #9 §9): STREŽNIŠKI podpisovalnik webhook dostav.
// Edino mesto z node:crypto za webhook plast (webhook-core ostane ČIST lib).
//
// Podpisna shema (dokumentirana v docs/webhooks.md):
//   key       = SHA-256 hex hasha skrivnosti (ta hash je shranjen v
//               WebhookSubscription.secretHash — skrivnost sama se NE shranjuje)
//   message   = `${X-ROKSAL-Timestamp}.${rawBody}` (webhookSignatureMessage)
//   signature = HMAC-SHA256(key, message) — poslano kot
//               X-ROKSAL-Signature: sha256=<hex>
// Partner izpelje isti ključ iz skrivnosti, ki jo pozna (sha256), in tako
// preverja pristnost + časovno okno (replay zaščita, priporočilo ≤ 5 min).

import { createHash, createHmac } from 'crypto'
import { WEBHOOK_SIGNATURE_PREFIX, webhookSignatureMessage } from './webhook-core'

/** SHA-256 hasha skrivnosti (hex) — vrednost, shranjena kot secretHash. */
export function sha256Hex (secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/** Izračunaj podpis dostave (X-ROKSAL-Signatura brez predpone). */
export function signWebhook (secretHashHex: string, timestamp: string, body: string): string {
  return createHmac('sha256', secretHashHex).update(webhookSignatureMessage(timestamp, body), 'utf8').digest('hex')
}

/** Celotna vrednost glave X-ROKSAL-Signature: `sha256=<hex>`. */
export function webhookSignatureHeader (secretHashHex: string, timestamp: string, body: string): string {
  return WEBHOOK_SIGNATURE_PREFIX + signWebhook(secretHashHex, timestamp, body)
}

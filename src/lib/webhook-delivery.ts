// webhook-delivery — R481 (issue #9 §9): DOSTAVNI MEHANIZEM webhook naročnin.
// Outbox vzorec (NotificationDelivery iz notify.ts, prilagojen §9):
//  • recordWebhookEvent — en poslovni dogodek → POVRSTICA WebhookDelivery za vsako
//    AKTIVNO naročnino, ki posluša tip (idempotenca: @@unique([subscriptionId,
//    eventKey]) — isti dogodek NE gre dvakrat; retry posodablja ISTO vrstico);
//  • deliverWebhookDeliveries — TAKOJŠNJI (inline) poskus dostave posamezne
//    vrstice (AbortSignal 10 s); pokliče se PO commitu transakcije (R537):
//    zapis outboxa je atomaren s poslovnim dogodkom, dostava (HTTP) pa NI
//    del transakcije;
//  • emitWebhookEvent — VGRADENA kombinacija (zapis + dostava na privzetem db
//    klientu) za klice IZVEN transakcij — obnašanje identično R481 (ognjevarno);
//  • dostava je OGNJEVARNA — odpoved (mreža/URL/timeout) NIKOLI ne vrže napake
//    v poslovni tok (vzorec emitEvent): vrstica dobi FAILED + nextAttemptAt;
//  • retryWebhookDeliveries — pobere PENDING/FAILED z nextAttemptAt <= zdaj
//    (job webhook-retry / POST /api/webhooks/retry); po WEBHOOK_MAX_ATTEMPTS
//    (5) poskusih vrstica postane DEAD (mrtvo pismo).
//
// Podpis: X-ROKSAL-Signature: sha256=<HMAC-SHA256(secretHash, `${ts}.${body}`)>
// + X-ROKSAL-Timestamp (epoch sekunde) + X-ROKSAL-Event (tip dogodka) —
// izračun v webhook-sign.ts (node:crypto; webhook-core ostane čist lib).

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_METHOD,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TIMEOUT_MS,
  WEBHOOK_MAX_ATTEMPTS,
  clampWebhookError,
  isWebhookEventType,
  nextAttemptAt,
  parseWebhookEvents,
  publicWebhookPayload,
} from './webhook-core'
import { webhookSignatureHeader } from './webhook-sign'

// ─── Zapis outboxa (tx-aware, R537) ────────────────────────────────────────

export interface EmitWebhookInput {
  /** Tip dogodka (WEBHOOK_EVENTS; neznani tip se tiho prezre — fail-safe). */
  type: string
  /** Idempotenca ključ dogodka (ENAK kot NotificationEvent.key — ena vrstica). */
  eventKey: string
  projectId?: string | null
  title?: string | null
  body?: string | null
  customerName?: string | null
  occurredAt?: Date
}

/** Odjemalec, prek katerega gre zapis outboxa: globalni db ALI transakcijski
 * klient (tx) — isti vzorec kot writeAudit (R464) in nextQuoteCode (R535). */
export type WebhookClient = Pick<Prisma.TransactionClient, 'webhookSubscription' | 'webhookDelivery'>

/**
 * ZAPIS outboxa: ustvari PENDING vrstico WebhookDelivery za vsako aktivno
 * naročnino, ki posluša tip (idempotenca po [subscriptionId, eventKey]).
 * R537 (transakcijski outbox): klic ZNOTRAJ $transaction prejme tx klienta —
 * vrstice se zapišejo ATOMARNO s poslovno mutacijo + revizijo + dogodkom.
 * Vrača id-je NOVIH vrstic (obstoječa vrstica po unique ključu = brez ponovne
 * dostave). NEPOSKUŠA dostave — HTTP teče šele po commitu (deliverWebhookDeliveries).
 * Napake baze se širijo naprej (v transakciji pomenijo rollback — sicer bi
 * nastal dogodek brez webhook vrstic).
 */
export async function recordWebhookEvent (input: EmitWebhookInput, client: WebhookClient = db): Promise<string[]> {
  if (!isWebhookEventType(input.type)) return [] // fail-safe: samo katalog
  if (!input.eventKey) return []

  // telo dostave (varni podskup) — ENAKO za vse naročnine tega dogodka
  const body = JSON.stringify(publicWebhookPayload({
    eventKey: input.eventKey,
    eventType: input.type,
    occurredAt: input.occurredAt ?? new Date(),
    projectId: input.projectId ?? null,
    title: input.title ?? null,
    body: input.body ?? null,
    customerName: input.customerName ?? null,
  }))

  // aktivne naročnine, ki poslušajo ta tip (events = JSON niz)
  const subs = await client.webhookSubscription.findMany({
    where: { active: true, revokedAt: null },
    select: { id: true, events: true },
  })
  const targets = subs.filter((s) => {
    const events = parseWebhookEvents(s.events)
    return events !== null && events.includes(input.type)
  })

  const created: string[] = []
  for (const sub of targets) {
    // idempotenca: unique [subscriptionId, eventKey] — obstoječa vrstica = NIČ
    const row = await client.webhookDelivery.create({
      data: {
        subscriptionId: sub.id,
        eventKey: input.eventKey,
        eventType: input.type,
        payload: body,
        status: 'PENDING',
      },
    }).catch(() => null) // P2002 (unique) → dogodek je že dostavljen/čaka
    if (row) created.push(row.id)
  }
  return created
}

// ─── Dostava (PO commitu, ognjevarna) ───────────────────────────────────────

/**
 * Poskusi dostaviti NADRAVNE vrstice outboxa (inline, PO commitu transakcije).
 * OGNJEVARNA: odpoved ene dostave NE ustavi ostalih in NIKOLI ne vrže napake
 * v poslovni tok (vsak poskus ima svoj catch + dnevnik; vrstica dobi FAILED
 * + nextAttemptAt prek attemptWebhookDelivery).
 */
export async function deliverWebhookDeliveries (deliveryIds: string[]): Promise<void> {
  for (const id of deliveryIds) {
    try {
      await attemptWebhookDelivery(id)
    } catch (err) {
      console.error('[webhook] dostava', id, 'spodletela (poslovni tok se nadaljuje):', err)
    }
  }
}

// ─── emitWebhookEvent (ognjevaren vhod, klici IZVEN transakcij) ─────────────

/**
 * Razdeli poslovni dogodek vsem aktivnim naročninam, ki poslušajo tip, in ga
 * takoj poskusi dostaviti. NIKOLI ne vrže napake (poslovni tok gre naprej).
 * NE ODVISA uporabniških obvestil (IN_APP/EMAIL) — to dela emitEvent vzporedno.
 * R537: sestavljena iz recordWebhookEvent + deliverWebhookDeliveries nad
 * privzetim db klientom — obnašanje identično R481.
 */
export async function emitWebhookEvent (input: EmitWebhookInput): Promise<void> {
  try {
    const ids = await recordWebhookEvent(input)
    await deliverWebhookDeliveries(ids)
  } catch (err) {
    console.error('[webhook] emitWebhookEvent odpoved (poslovni tok se nadaljuje):', input.type, input.eventKey, err)
  }
}

// ─── En poskus dostave ──────────────────────────────────────────────────────

export interface AttemptResult {
  ok: boolean
  status: string // SENT | FAILED | DEAD | SKIPPED
  responseStatus: number | null
  error: string | null
}

/**
 * Izvede en dostavni poskus vrstice outboxa (fetch + posodobi vrstico in
 * naročnino). Ne vrača izjem — rezultat je vedno { ok, status, … }.
 */
export async function attemptWebhookDelivery (deliveryId: string): Promise<AttemptResult> {
  const delivery = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { subscription: true },
  })
  if (!delivery) return { ok: false, status: 'SKIPPED', responseStatus: null, error: 'dostava ne obstaja' }

  const attempts = delivery.attempts + 1
  const now = new Date()

  // preklicana/neaktivna naročnina → mrtvo pismo (ni več poskusov)
  if (!delivery.subscription.active || delivery.subscription.revokedAt) {
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'DEAD', attempts, lastAttemptAt: now, nextAttemptAt: null, error: 'naročnina preklicana' },
    })
    return { ok: false, status: 'DEAD', responseStatus: null, error: 'naročnina preklicana' }
  }

  const timestamp = Math.floor(now.getTime() / 1000).toString()
  const signature = webhookSignatureHeader(delivery.subscription.secretHash, timestamp, delivery.payload)

  let ok = false
  let responseStatus: number | null = null
  let error: string | null = null
  try {
    const res = await fetch(delivery.subscription.url, {
      method: WEBHOOK_METHOD,
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signature,
        [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [WEBHOOK_EVENT_HEADER]: delivery.eventType,
      },
      body: delivery.payload, // DOBESEDEN niz, ki je bil podpisan (partner overja isto)
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    responseStatus = res.status
    ok = res.ok // 2xx = dostavljeno
    if (!ok) error = `HTTP ${res.status}`
  } catch (err) {
    error = clampWebhookError(err)
  }

  const next = nextAttemptAt(attempts, now)
  const dead = attempts >= WEBHOOK_MAX_ATTEMPTS || next === null
  await db.webhookDelivery.update({
    where: { id: delivery.id },
    data: ok
      ? { status: 'SENT', attempts, lastAttemptAt: now, responseStatus, deliveredAt: now, error: null, nextAttemptAt: null }
      : {
          status: dead ? 'DEAD' : 'FAILED',
          attempts,
          lastAttemptAt: now,
          responseStatus,
          nextAttemptAt: next,
          error,
        },
  })

  // časovni žigi naročnine (zadnja uspeh/napaka — za seznam integracij)
  await db.webhookSubscription.update({
    where: { id: delivery.subscriptionId },
    data: ok ? { lastSuccessAt: now } : { lastFailureAt: now },
  }).catch(() => {})

  return { ok, status: ok ? 'SENT' : (dead ? 'DEAD' : 'FAILED'), responseStatus, error }
}

// ─── Retry (job / ročna pot) ───────────────────────────────────────────────

export interface RetryResult {
  processed: number
  sent: number
  failed: number
  dead: number
}

/**
 * Ponovi PENDING/FAILED dostave z nextAttemptAt <= zdaj (najstarejše prve).
 * Uporabnika: job webhook-retry (jobs.ts) in POST /api/webhooks/retry.
 */
export async function retryWebhookDeliveries (limit = 50): Promise<RetryResult> {
  const due = await db.webhookDelivery.findMany({
    where: {
      OR: [{ status: 'PENDING' }, { status: 'FAILED' }],
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 200),
    select: { id: true },
  })

  let sent = 0
  let failed = 0
  let dead = 0
  for (const d of due) {
    const res = await attemptWebhookDelivery(d.id)
    if (res.ok) sent++
    else if (res.status === 'DEAD') dead++
    else failed++
  }
  return { processed: due.length, sent, failed, dead }
}

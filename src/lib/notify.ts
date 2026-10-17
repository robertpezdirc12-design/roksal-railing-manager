// notify — R438 (GitLab issue #5): jedro obvestil — event → delivery model.
//
// Načela:
//  • en poslovni dogodek (NotificationEvent) = en vir resnice; več kanalov porabi isti event;
//  • odpoved obvestil NIKOLI ne sme vreči napake v poslovni tok (emitEvent je ognjevaren);
//  • dedup po `key` (upsert) + @@unique([eventId, channel, userId]) na dostavi — retry varen;
//  • IN_APP piše v obstoječi model Notification (zvonec app-shell ostaja);
//  • R464 (GitHub issue #1, sklop 7): zunanji kanali gredo prek ADAPTER PLASTI
//    (src/lib/notify-providers.ts) — provider se izbere prek okolja (NOTIFY_*_PROVIDER);
//    privzeto vedenje ostaja: EMAIL = log adapter (SENT), SMS/WHATSAPP = kanal
//    ni konfiguriran (SKIPPED oz. FAILED ob poskusu). Poslovni klici se NE spreminjajo.
//  • R537 (transakcijski outbox): emitEvent je razcepljen na ZAPIS (recordEvent,
//    tx-aware — dogodek + prejemniki + webhook outbox VRSTICE v isti transakciji
//    kot poslovna mutacija + revizija) in DOSTAVO (deliverEvent — IN_APP/EMAIL/
//    SMS/WHATSAPP + webhook HTTP poskusi, IZVEN transakcije, PO commitu).
//    emitEvent = vgrajena kombinacija obeh nad privzetim db klientom — vsi
//    obstoječi klici (izven transakcij) obnašajo NESPREMENJENO.

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
} from '@/lib/notify-events'
import { providerConfigured, resolveProvider, type ProviderDelivery } from '@/lib/notify-providers'
import { deliverWebhookDeliveries, recordWebhookEvent } from '@/lib/webhook-delivery'

// ─── Vhod emitEvent ──────────────────────────────────────────────────────────

export interface EmitEventInput {
  type: NotificationEventType
  /** Dedup ključ (unikaten): npr. `wo-assign:<nalogId>:<assigneeId>:<ts>` */
  key: string
  title: string
  body: string
  projectId?: string | null
  /** Zunanji prejemnik (stranka) — e-pošta se v dostavi ZA vedno prikrije. */
  customerEmail?: string | null
  customerName?: string | null
  /** OFFICE = aktivni ADMIN/VODJA; ASSIGNEE se poda eksplicitno prek userIds. */
  audience?: 'ASSIGNEE' | 'OFFICE' | 'ALL'
  /** Eksplicitni prejemniki-app uporabniki (npr. [assigneeId]). */
  userIds?: string[]
}

interface EventPayload {
  title: string
  body: string
  customerEmail?: string
  customerName?: string
}

// ─── Pomožne funkcije ────────────────────────────────────────────────────────

/** Slovenski zapis termina za telo obvestila (strežniško varen — brez 'use client'). */
export function fmtTermin (d: Date): string {
  return new Intl.DateTimeFormat('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

/** Prikritje e-pošte: `j***@domain.tu` (NIKOLI celoten naslov v dostavi/dnevniku). */
export function maskEmail (email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

function parsePayload (raw: Prisma.JsonValue): EventPayload {
  // R542: payload je razčlenjen jsonb objekt (ne niz) — obramba ostaja za
  // neobjektne vrednosti (starejše vrstice so vedno objekti).
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { title: '', body: '' }
  const p = raw as Partial<EventPayload>
  return {
    title: typeof p.title === 'string' ? p.title : '',
    body: typeof p.body === 'string' ? p.body : '',
    customerEmail: typeof p.customerEmail === 'string' ? p.customerEmail : undefined,
    customerName: typeof p.customerName === 'string' ? p.customerName : undefined,
  }
}

/** Privzete vrednosti prefs: IN_APP VKLOPLJEN, EMAIL/SMS IZKLOPLJEN (za uporabnike). */
export function defaultPrefEnabled (channel: string): boolean {
  return channel === 'IN_APP'
}

/** Ali ima uporabnik kanal vklopljen za dogodev? (specifični pref → '*' pref → privzeto) */
async function prefEnabled (userId: string, event: string, channel: string): Promise<boolean> {
  const specific = await db.notificationPref.findUnique({
    where: { userId_event_channel: { userId, event, channel } },
  })
  if (specific) return specific.enabled
  const star = await db.notificationPref.findUnique({
    where: { userId_event_channel: { userId, event: '*', channel } },
  })
  if (star) return star.enabled
  return defaultPrefEnabled(channel)
}

/**
 * Izvede eno dostavo po kanalu in posodobi njen status.
 * IN_APP → vrstica v obstoječem modelu Notification (notranja dostava, brez providerja);
 * EMAIL/SMS/WHATSAPP → R464 adapter plast: provider iz okolja (privzeto EMAIL=log,
 * SMS/WHATSAPP=nekonfiguriran kanal). Neuspešna dostava NE podre poslovnega toka —
 * dostava dobi status FAILED, ponovni poskus prek joba obvestila-retry.
 */
async function sendDelivery (
  deliveryId: string,
  channel: string,
  userId: string | null,
  recipient: string | null,
  payload: EventPayload,
  ev: { key: string; type: string },
): Promise<'SENT' | 'FAILED'> {
  try {
    if (channel === 'IN_APP') {
      if (!userId) throw new Error('IN_APP dostava zahteva uporabnika.')
      await db.notification.create({ data: { userId, title: payload.title, body: payload.body } })
    } else {
      const provider = resolveProvider(channel)
      if (!provider) throw new Error('kanal ni konfiguriran')
      // realni dostavni cilj (SAMO providerju): EMAIL uporabnika iz profila,
      // sicer e-pošta stranke iz payloada; SMS/WHATSAPP nima številke v modelu.
      let address: string | null = null
      if (channel === 'EMAIL') {
        if (userId) {
          const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
          address = u?.email ?? null
        } else {
          address = payload.customerEmail ?? null
        }
      }
      const outcome = await provider.deliver({
        channel,
        recipient, // prikriti naslov — edini, ki se zapisuje v dostavo/dnevnik
        address,
        userId,
        title: payload.title,
        body: payload.body,
        eventKey: ev.key,
        eventType: ev.type,
        customerName: payload.customerName ?? null,
      } satisfies ProviderDelivery)
      if (!outcome.ok) throw new Error(outcome.error ?? `dostava prek ${provider.name} spodletela`)
      if (outcome.providerId) {
        console.log(`[notify] ${channel} dostavljena prek ${provider.name} (${outcome.providerId}) · ${recipient ?? '?'} · ${payload.title}`)
      }
    }
    await db.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SENT', sentAt: new Date(), error: null },
    })
    return 'SENT'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[notify] dostava ${deliveryId} (${channel}) spodletela:`, message)
    await db.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'FAILED', error: message.slice(0, 200) },
    }).catch(() => {})
    return 'FAILED'
  }
}

/** Ustvari dostavo (PENDING) in jo takoj izvede — ali označi SKIPPED, če je kanal izklopljen. */
async function createAndAttempt (
  eventId: string,
  channel: string,
  userId: string | null,
  recipient: string | null,
  enabled: boolean,
  payload: EventPayload,
  ev: { key: string; type: string },
): Promise<void> {
  // @@unique([eventId, channel, userId]) ščiti pred podvajanjem iste dostave
  const delivery = await db.notificationDelivery.create({
    data: { eventId, channel, userId, recipient, status: 'PENDING' },
  })
  if (!enabled) {
    // izklop obvestila NE prekine poslovnega toka — dostava se zabeleži kot SKIPPED
    await db.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'SKIPPED', error: 'izklopljeno v nastavitvah' },
    })
    return
  }
  await sendDelivery(delivery.id, channel, userId, recipient, payload, ev)
}

// ─── Zapis dogodka (tx-aware, R537) ───────────────────────────────────────

/** Odjemalec, prek katerega gre zapis dogodka + outboxa: globalni db ALI
 * transakcijski klient (tx) — isti vzorec kot writeAudit (R464). Vključuje
 * tudi webhook delegate (recordWebhookEvent zapiše outbox vrstice). */
export type NotifyClient = Pick<Prisma.TransactionClient, 'notificationEvent' | 'user' | 'webhookSubscription' | 'webhookDelivery'>

/** Zapisan dogodek (izhod recordEvent) — vhod za deliverEvent PO commitu. */
export interface RecordedEvent {
  /** Dogodek (en vir resnice) — id/key/type/createdAt za dostavo + webhook payload. */
  event: { id: string; key: string; type: string; createdAt: Date }
  /** Telo obvestila (title/body + kontakt stranke za zunanje kanale). */
  payload: EventPayload
  /** Prejemniki-app uporabniki (id → e-pošta) — IN_APP + EMAIL dostava po commitu. */
  userEmails: Map<string, string>
  /** Webhook outbox vrstice, zapisane V isti transakciji (prazno = ni naročnin
   *  oz. tip ni v katalogu) — HTTP dostava teče PO commitu. */
  webhookDeliveryIds: string[]
}

/**
 * ZAPIS poslovnega dogodka (transakcijski outbox, R537):
 *  1. dedup po ključu (isti dogodek NE obstaja dvakrat) → null;
 *  2. razrešitev prejemnikov (OFFICE = aktivni ADMIN/VODJA + eksplicitni userIds);
 *  3. NotificationEvent (en vir resnice) — NA PODANEM klientu (tx v ruti);
 *  4. WebhookDelivery PENDING vrstice (webhook outbox) — isto transakcijo.
 * Napake baze se širijo naprej: znotraj $transaction pomenijo rollback (brez
 * spremembe brez dogodka — to je točka vzorca), emitEvent jih ulovi sama.
 * Dostava (IN_APP/EMAIL/SMS/WHATSAPP + webhook HTTP) NI del zapisa —
 * pokliči deliverEvent PO uspešnem commitu.
 */
export async function recordEvent (input: EmitEventInput, client: NotifyClient = db): Promise<RecordedEvent | null> {
  // 1) dedup po ključu — isti dogodek (retry/dvoklik) NE ustvari novega eventa
  const existing = await client.notificationEvent.findUnique({ where: { key: input.key } })
  if (existing) return null

  const payload: EventPayload = {
    title: input.title,
    body: input.body,
    ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
    ...(input.customerName ? { customerName: input.customerName } : {}),
  }

  // 2) prejemniki: OFFICE (aktivni ADMIN/VODJA) + eksplicitni userIds (ASSIGNEE)
  const ids = new Set<string>(input.userIds ?? [])
  if (input.audience === 'OFFICE' || input.audience === 'ALL') {
    const office = await client.user.findMany({
      where: { active: true, role: { in: ['ADMIN', 'VODJA'] } },
      select: { id: true },
    })
    for (const u of office) ids.add(u.id)
  }
  let userEmails = new Map<string, string>()
  if (ids.size > 0) {
    const valid = await client.user.findMany({
      where: { id: { in: [...ids] }, active: true },
      select: { id: true, email: true },
    })
    userEmails = new Map(valid.map((u) => [u.id, u.email]))
  }

  // 3) event = en vir resnice (R542: payload je jsonb objekt — ne niz)
  const event = await client.notificationEvent.create({
    data: {
      key: input.key,
      type: input.type,
      payload: payload as unknown as Prisma.InputJsonValue,
      projectId: input.projectId ?? null,
    },
  })

  // 4) R481 (issue #9 §9) + R537: poslovno-dogodkovni WEBHOOK IZHOD — zapis
  //    outbox vrstic V isti transakciji kot dogodek (brez dvojnega emitiranja:
  //    dogodek je ŽE dedupliciran po key zgoraj). Dostava (HTTP) je ločena
  //    (deliverEvent PO commitu) in NE odvisa uporabniških obvestil —
  //    partner dobi varni podskup telesa (publicWebhookPayload).
  const webhookDeliveryIds = await recordWebhookEvent({
    type: input.type,
    eventKey: event.key,
    projectId: input.projectId ?? null,
    title: input.title,
    body: input.body,
    customerName: input.customerName ?? null,
    occurredAt: event.createdAt,
  }, client)

  return {
    event: { id: event.id, key: event.key, type: event.type, createdAt: event.createdAt },
    payload,
    userEmails,
    webhookDeliveryIds,
  }
}

// ─── Dostava (PO commitu, ognjevarna — R537) ───────────────────────────────

/**
 * Dostavi zapisan dogodek po vseh kanalih — kliče se PO uspešnem commitu
 * transakcije (zapis je že viden vsem povezavam). OGNJEVARNA: nikoli ne vrže
 * napake — odpoved dostave se samo zabeleži (dnevnik + status FAILED na
 * dostavi), poslovni tok (rute, ki je zapisala dogodek) se nadaljuje.
 */
export async function deliverEvent (rec: RecordedEvent): Promise<void> {
  try {
    const input = rec.payload
    // webhook HTTP poskusi (outbox vrstice iz zapisa — PO commitu)
    await deliverWebhookDeliveries(rec.webhookDeliveryIds)

    // dostave za uporabnike: IN_APP vedno (prek prefs), EMAIL prek prefs (privzeto IZKLOPLJEN)
    for (const uid of rec.userEmails.keys()) {
      const inAppOn = await prefEnabled(uid, rec.event.type, 'IN_APP')
      await createAndAttempt(rec.event.id, 'IN_APP', uid, null, inAppOn, rec.payload, { key: rec.event.key, type: rec.event.type })
      const emailOn = await prefEnabled(uid, rec.event.type, 'EMAIL')
      await createAndAttempt(rec.event.id, 'EMAIL', uid, emailOn ? maskEmail(rec.userEmails.get(uid) ?? '') : null, emailOn, rec.payload, { key: rec.event.key, type: rec.event.type })
    }

    // zunanji prejemnik (stranka): EMAIL + SMS/WHATSAPP prek adapter plasti —
    // nekonfiguriran kanal ostane SKIPPED (R438), konfiguriran provider pa se poskusi
    if (input.customerEmail) {
      await createAndAttempt(rec.event.id, 'EMAIL', null, maskEmail(input.customerEmail), true, rec.payload, { key: rec.event.key, type: rec.event.type })
      for (const ch of ['SMS', 'WHATSAPP'] as const) {
        if (providerConfigured(ch)) {
          await createAndAttempt(rec.event.id, ch, null, maskEmail(input.customerEmail), true, rec.payload, { key: rec.event.key, type: rec.event.type })
            .catch(() => {}) // unique spamet → ne prekini toka
        } else {
          await db.notificationDelivery.create({
            data: { eventId: rec.event.id, channel: ch, userId: null, recipient: null, status: 'SKIPPED', error: 'kanal ni konfiguriran' },
          }).catch(() => {}) // unique spamet → ne prekini toka
        }
      }
    }
  } catch (err) {
    // R438: odpoved obvestil NIKOLI ne sme prekiniti poslovnega toka
    console.error('[notify] deliverEvent odpoved (poslovni tok se nadaljuje):', rec.event.type, rec.event.key, err)
  }
}

// ─── emitEvent (ognjevaren, klici IZVEN transakcij) ────────────────────────

/**
 * Ustvari poslovni dogodek in ga razdeli po kanalih.
 * NIKOLI ne vrže napake — odpoved obvestil se samo zabeleži (console.error),
 * poslovni tok (ruta, ki je klicala emitEvent) se nadaljuje nespremenjeno.
 * R537: zapis + dostava (recordEvent/deliverEvent nad privzetim db) — za
 * klice znotraj $transaction uporabi recordEvent(input, tx) v transakciji
 * in deliverEvent(zapis) PO commitu.
 */
export async function emitEvent (input: EmitEventInput): Promise<void> {
  try {
    const rec = await recordEvent(input)
    if (rec) await deliverEvent(rec)
  } catch (err) {
    // R438: odpoved obvestil NIKOLI ne sme prekiniti poslovnega toka
    console.error('[notify] emitEvent odpoved (poslovni tok se nadaljuje):', input.type, input.key, err)
  }
}

// ─── Retry ───────────────────────────────────────────────────────────────────

/** Poišče veljaven tip dogodka (validacija za prefs API). */
export function isValidEventType (event: string): boolean {
  return event === '*' || (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(event)
}

/**
 * Ponovi PENDING/FAILED dostave z attempts < 3 (job obvestila-retry).
 * SKIPPED dostav NE ponavlja (izklopljeno ostane izklopljeno).
 */
export async function retryPending (limit = 50): Promise<{ processed: number; sent: number; failed: number }> {
  const pending = await db.notificationDelivery.findMany({
    where: { OR: [{ status: 'PENDING' }, { status: 'FAILED' }], attempts: { lt: 3 } },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 200),
    include: { event: true },
  })

  let sent = 0
  let failed = 0
  for (const d of pending) {
    await db.notificationDelivery.update({
      where: { id: d.id },
      data: { attempts: { increment: 1 } },
    })
    const payload = parsePayload(d.event.payload)
    const result = await sendDelivery(d.id, d.channel, d.userId, d.recipient, payload, { key: d.event.key, type: d.event.type })
    if (result === 'SENT') sent++
    else failed++
  }
  return { processed: pending.length, sent, failed }
}

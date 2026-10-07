// notify — R438 (GitLab issue #5): jedro obvestil — event → delivery model.
//
// Načela:
//  • en poslovni dogodek (NotificationEvent) = en vir resnice; več kanalov porabi isti event;
//  • odpoved obvestil NIKOLI ne sme vreči napake v poslovni tok (emitEvent je ognjevaren);
//  • dedup po `key` (upsert) + @@unique([eventId, channel, userId]) na dostavi — retry varen;
//  • IN_APP piše v obstoječi model Notification (zvonec app-shell ostaja);
//  • EMAIL = LOG ADAPTER (console.log + status SENT) — produkcijsko zamenljivo s SMTP
//    providerjem prek adapter vtičnika (vstavitev sendEmail() brez spremembe klicev);
//  • SMS/WHATSAPP = adapter NI konfiguriran → dostava SKIPPED (poslovni tok se nadaljuje).

import { db } from '@/lib/db'
import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
} from '@/lib/notify-events'

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

function parsePayload (raw: string): EventPayload {
  try {
    const p = JSON.parse(raw) as Partial<EventPayload>
    return { title: p.title ?? '', body: p.body ?? '', customerEmail: p.customerEmail, customerName: p.customerName }
  } catch {
    return { title: '', body: '' }
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
 * IN_APP → vrstica v obstoječem modelu Notification; EMAIL → log adapter;
 * SMS/WHATSAPP → napaka 'kanal ni konfiguriran' (adapter plast).
 */
async function sendDelivery (
  deliveryId: string,
  channel: string,
  userId: string | null,
  recipient: string | null,
  payload: EventPayload
): Promise<'SENT' | 'FAILED'> {
  try {
    if (channel === 'IN_APP') {
      if (!userId) throw new Error('IN_APP dostava zahteva uporabnika.')
      await db.notification.create({ data: { userId, title: payload.title, body: payload.body } })
    } else if (channel === 'EMAIL') {
      // R438: LOG ADAPTER — produkcijsko zamenljivo s SMTP providerjem (SendGrid/SES/…)
      // prek adapter vtičnika: sendEmail({ to, subject: title, text: body }).
      console.log(`[notify:EMAIL] → ${recipient ?? '?'} · ${payload.title}`)
    } else {
      // SMS/WHATSAPP: adapter ni konfiguriran (Issue #5: kanal obstaja, pošiljanje ne)
      throw new Error('kanal ni konfiguriran')
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
  payload: EventPayload
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
  await sendDelivery(delivery.id, channel, userId, recipient, payload)
}

// ─── emitEvent (ognjevaren) ──────────────────────────────────────────────────

/**
 * Ustvari poslovni dogodek in ga razdeli po kanalih.
 * NIKOLI ne vrže napake — odpoved obvestil se samo zabeleži (console.error),
 * poslovni tok (ruta, ki je klicala emitEvent) se nadaljuje nespremenjeno.
 */
export async function emitEvent (input: EmitEventInput): Promise<void> {
  try {
    // 1) dedup po ključu — isti dogodek (retry/dvoklik) NE ustvari novega eventa
    const existing = await db.notificationEvent.findUnique({ where: { key: input.key } })
    if (existing) return

    const payload: EventPayload = {
      title: input.title,
      body: input.body,
      ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
      ...(input.customerName ? { customerName: input.customerName } : {}),
    }

    // 2) prejemniki: OFFICE (aktivni ADMIN/VODJA) + eksplicitni userIds (ASSIGNEE)
    const ids = new Set<string>(input.userIds ?? [])
    if (input.audience === 'OFFICE' || input.audience === 'ALL') {
      const office = await db.user.findMany({
        where: { active: true, role: { in: ['ADMIN', 'VODJA'] } },
        select: { id: true },
      })
      for (const u of office) ids.add(u.id)
    }
    let userEmails = new Map<string, string>()
    if (ids.size > 0) {
      const valid = await db.user.findMany({
        where: { id: { in: [...ids] }, active: true },
        select: { id: true, email: true },
      })
      userEmails = new Map(valid.map((u) => [u.id, u.email]))
    }

    // 3) event = en vir resnice
    const event = await db.notificationEvent.create({
      data: {
        key: input.key,
        type: input.type,
        payload: JSON.stringify(payload),
        projectId: input.projectId ?? null,
      },
    })

    // 4) dostave za uporabnike: IN_APP vedno (prek prefs), EMAIL prek prefs (privzeto IZKLOPLJEN)
    for (const uid of userEmails.keys()) {
      const inAppOn = await prefEnabled(uid, input.type, 'IN_APP')
      await createAndAttempt(event.id, 'IN_APP', uid, null, inAppOn, payload)
      const emailOn = await prefEnabled(uid, input.type, 'EMAIL')
      await createAndAttempt(event.id, 'EMAIL', uid, emailOn ? maskEmail(userEmails.get(uid) ?? '') : null, emailOn, payload)
    }

    // 5) zunanji prejemnik (stranka): EMAIL (maskiran naslov) + SMS/WHATSAPP SKIPPED
    if (input.customerEmail) {
      await createAndAttempt(event.id, 'EMAIL', null, maskEmail(input.customerEmail), true, payload)
      for (const ch of ['SMS', 'WHATSAPP'] as const) {
        await db.notificationDelivery.create({
          data: { eventId: event.id, channel: ch, userId: null, recipient: null, status: 'SKIPPED', error: 'kanal ni konfiguriran' },
        }).catch(() => {}) // unique spamet → ne prekini toka
      }
    }
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
    const result = await sendDelivery(d.id, d.channel, d.userId, d.recipient, payload)
    if (result === 'SENT') sent++
    else failed++
  }
  return { processed: pending.length, sent, failed }
}

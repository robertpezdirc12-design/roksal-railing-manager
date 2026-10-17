import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { sha256Hex } from '@/lib/webhook-sign'
import {
  parseWebhookEvents,
  validWebhookSecret,
  validWebhookUrl,
  WEBHOOK_EVENTS,
} from '@/lib/webhook-core'

// /api/webhooks — WEBHOOK NAROČNINE (R481 — issue #9 §9; integrations.manage =
// ADMIN/VODJA — vzorec portal.manage; monter/skladišče/proizvodnja 403).
// GET  seznam naročnin + agregirana statistika dostav (SENT/FAILED/DEAD);
//      secretHash NI v odgovoru (to je podpisni ključ — nikoli ne gre ven).
// POST { url, events: [tipi], secret, description? } → 201 naročnina.
//      Skrivnost se NE shrani (samo SHA-256 has = podpisni ključ) in se NE
//      vrne niti v revizijo (WEBHOOK_CREATE brez secret-a!).
// URL: https (SSRF vrata); http/localhost SAMO v razvoju (allowLocal izven
// produkcije — testni sprejemnik).

const DESCRIPTION_MAX = 200

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'integrations.manage')
  if (auth instanceof NextResponse) return auth

  const subs = await db.webhookSubscription.findMany({
    orderBy: { createdAt: 'desc' },
    include: { deliveries: { select: { status: true } } },
  })

  return NextResponse.json({
    data: subs.map((s) => {
      const counts: Record<string, number> = {}
      for (const d of s.deliveries) counts[d.status] = (counts[d.status] ?? 0) + 1
      const events = parseWebhookEvents(s.events) ?? []
      return {
        id: s.id,
        url: s.url,
        events,
        active: s.active,
        description: s.description,
        createdAt: s.createdAt.toISOString(),
        revokedAt: s.revokedAt?.toISOString() ?? null,
        lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
        deliveries: {
          total: s.deliveries.length,
          sent: counts.SENT ?? 0,
          failed: counts.FAILED ?? 0,
          dead: counts.DEAD ?? 0,
          pending: counts.PENDING ?? 0,
        },
      }
    }),
    events: WEBHOOK_EVENTS, // katalog za UI izbire
  })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'integrations.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as {
    url?: unknown
    events?: unknown
    secret?: unknown
    description?: unknown
  } | null

  // ── URL (https; razvoj dovoli http/127.0.0.1 za testni sprejemnik) ──────
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  const allowLocal = process.env.NODE_ENV !== 'production'
  if (!validWebhookUrl(url, { allowLocal })) {
    return jsonError(400, 'Neveljaven URL naročnine.', 'Zahtevan je https URL (brez localhost/privatnih naslovov).')
  }

  // ── events: neprazen seznam veljavnih tipov ──────────────────────────────
  const rawEvents = body?.events
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    return jsonError(400, 'Manjka seznam dogodkov.', `events: [tip, …] — veljavni: ${WEBHOOK_EVENTS.join(', ')}.`)
  }
  // R542: parseWebhookEvents sprejema jsonb tabelo (ali stari niz) neposredno
  const events = parseWebhookEvents(rawEvents)
  if (!events) {
    return jsonError(400, 'Neveljavni dogodki.', `Vsak tip mora biti iz kataloga (max ${WEBHOOK_EVENTS.length}): ${WEBHOOK_EVENTS.join(', ')}.`)
  }

  // ── secret: 16–200 znakov; shrani SAMO SHA-256 has (podpisni ključ) ──────
  const secret = typeof body?.secret === 'string' ? body.secret : ''
  if (!validWebhookSecret(secret)) {
    return jsonError(400, 'Neveljavna skrivnost.', `Skrivnost mora imeti 16–200 znakov (partner jo vidi SAMO ob ustvarjanju).`)
  }

  const description = typeof body?.description === 'string' && body.description.trim()
    ? body.description.trim().slice(0, DESCRIPTION_MAX)
    : null

  // R537 (transakcijska celovitost): naročnina + revizija v ENI transakciji.
  const sub = await db.$transaction(async (tx) => {
    const sub = await tx.webhookSubscription.create({
      data: {
        url,
        secretHash: sha256Hex(secret),
        events, // R542: jsonb tabela (parseWebhookEvents že deduplicira)
        active: true,
        description,
        createdById: user.id,
      },
    })

    // revizija BREZ skrivnosti (in brez hash-a — hash je podpisni ključ)
    await writeAudit({
      userId: user.id,
      action: 'WEBHOOK_CREATE',
      entity: 'webhookSubscription',
      entityId: sub.id,
      detail: { url, events, ...(description ? { description } : {}) },
    }, tx)
    return sub
  })

  return NextResponse.json({
    data: {
      id: sub.id,
      url: sub.url,
      events,
      active: sub.active,
      description: sub.description,
      // skrivnost se NE vrača in NI nikjer shranjena (samo njen has)
      secretInfo: 'shranjeno (hash) — skrivnost shranite sedaj, več je ne bo mogoče videti',
    },
  }, { status: 201 })
}

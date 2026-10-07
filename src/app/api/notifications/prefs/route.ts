import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError } from '@/lib/auth'
import { defaultPrefEnabled, isValidEventType } from '@/lib/notify'
import {
  NOTIFICATION_EVENT_ALL,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_PREF_CHANNELS,
} from '@/lib/notify-events'

// /api/notifications/prefs — R438 (issue #5): nastavitve obveščanja (Samo LASTNE).
// GET  (prijava): lastne prefs + privzete vrednosti za vse tipe dogodkov.
// POST (prijava): { event, channel, enabled } → upsert LASTNE pref (userId iz seje —
//      tujega userId ni mogoče nastaviti). Velidacija: kanal IN_APP|EMAIL|SMS,
//      event v seznamu tipov ali '*'.

/** Učinkovita vrednost: specifični pref → '*' pref → privzeto (IN_APP 1, EMAIL/SMS 0). */
async function effectiveEnabled (userId: string, event: string, channel: string): Promise<boolean> {
  const specific = await db.notificationPref.findUnique({
    where: { userId_event_channel: { userId, event, channel } },
  })
  if (specific) return specific.enabled
  const star = await db.notificationPref.findUnique({
    where: { userId_event_channel: { userId, event: NOTIFICATION_EVENT_ALL, channel } },
  })
  if (star) return star.enabled
  return defaultPrefEnabled(channel)
}

export async function GET (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')

  const raw = await db.notificationPref.findMany({ where: { userId: user.id } })

  // matrika: vsak tip dogodka × kanal z učinkovito (privzeto + shranjeno) vrednostjo
  const events = await Promise.all(
    [NOTIFICATION_EVENT_ALL, ...NOTIFICATION_EVENT_TYPES].map(async (event) => ({
      event,
      label: event === NOTIFICATION_EVENT_ALL ? 'Vsi dogodki (privzeto)' : NOTIFICATION_EVENT_LABELS[event] ?? event,
      channels: Object.fromEntries(
        await Promise.all(
          NOTIFICATION_PREF_CHANNELS.map(async (ch) => [ch, await effectiveEnabled(user.id, event, ch)]),
        ),
      ) as Record<string, boolean>,
    })),
  )

  return NextResponse.json({ data: { events, raw } })
}

export async function POST (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.')

  const body = await req.json().catch(() => null) as { event?: unknown; channel?: unknown; enabled?: unknown } | null
  const event = typeof body?.event === 'string' ? body.event : ''
  const channel = typeof body?.channel === 'string' ? body.channel : ''
  const enabled = body?.enabled

  if (!isValidEventType(event)) {
    return jsonError(400, 'Neznan tip dogodka.', `Veljavni: ${[NOTIFICATION_EVENT_ALL, ...NOTIFICATION_EVENT_TYPES].join(', ')}.`)
  }
  if (!NOTIFICATION_PREF_CHANNELS.includes(channel as (typeof NOTIFICATION_PREF_CHANNELS)[number])) {
    return jsonError(400, 'Neveljaven kanal.', `Veljavni: ${NOTIFICATION_PREF_CHANNELS.join(', ')}. (WHATSAPP je zunanji kanal brez nastavitve.)`)
  }
  if (typeof enabled !== 'boolean') return jsonError(400, 'Manjka enabled (true/false).')

  // vedno LASTNA pref — userId v telesu se IGNORIRA (RBAC po seji)
  const pref = await db.notificationPref.upsert({
    where: { userId_event_channel: { userId: user.id, event, channel } },
    create: { userId: user.id, event, channel, enabled },
    update: { enabled },
  })

  return NextResponse.json({ data: pref })
}

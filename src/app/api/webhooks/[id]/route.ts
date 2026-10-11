import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseWebhookEvents, serializeWebhookEvents, WEBHOOK_EVENTS } from '@/lib/webhook-core'

// /api/webhooks/[id] — SPREMEMBA/PREKLIC naročnine (R481 — issue #9 §9;
// integrations.manage = ADMIN/VODJA). Naročnina ostane v bazi za zgodovino
// dostav (preklic = active=false + revokedAt, NE brisanje — revizijska sled).
// PATCH  { active?, events?, description? } → posodobljena naročnina
//        (URL in skrivnost se NE spreminjata — za novo ciljno mesto ustvarite
//        novo naročnino; skrivnosti ni mogoče ponovno prikazati).
// DELETE → preklic (idempotentno) + revizija WEBHOOK_REVOKE.

type Params = { params: Promise<{ id: string }> }

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'integrations.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const sub = await db.webhookSubscription.findUnique({ where: { id } })
  if (!sub) return jsonError(404, 'Naročnina ne obstaja.')
  if (sub.revokedAt) return jsonError(409, 'Preklicane naročnine ni mogoče spreminjati.')

  const body = await req.json().catch(() => null) as {
    active?: unknown
    events?: unknown
    description?: unknown
  } | null

  const data: Record<string, unknown> = {}

  if (body?.active !== undefined) {
    if (typeof body.active !== 'boolean') return jsonError(400, 'active mora biti true/false.')
    data.active = body.active
  }

  if (body?.events !== undefined) {
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return jsonError(400, 'Manjka seznam dogodkov.', `events: [tip, …] — veljavni: ${WEBHOOK_EVENTS.join(', ')}.`)
    }
    const events = parseWebhookEvents(JSON.stringify(body.events))
    if (!events) {
      return jsonError(400, 'Neveljavni dogodki.', `Vsak tip mora biti iz kataloga: ${WEBHOOK_EVENTS.join(', ')}.`)
    }
    data.events = serializeWebhookEvents(events)
  }

  if (body?.description !== undefined) {
    if (body.description === null) data.description = null
    else if (typeof body.description === 'string' && body.description.trim()) data.description = body.description.trim().slice(0, 200)
    else return jsonError(400, 'description mora biti neprazen niz (≤ 200) ali null.')
  }

  if (Object.keys(data).length === 0) {
    return jsonError(400, 'Ni sprememb za izvedbo.', 'Podajte vsaj eno polje: active, events, description.')
  }

  const updated = await db.webhookSubscription.update({ where: { id }, data })

  await writeAudit({
    userId: user.id,
    action: 'WEBHOOK_UPDATE',
    entity: 'webhookSubscription',
    entityId: id,
    detail: {
      fields: Object.keys(data).filter((f) => f !== 'events'),
      ...(data.events ? { events: parseWebhookEvents(updated.events) ?? [] } : {}),
    },
  })

  return NextResponse.json({
    data: {
      id: updated.id,
      url: updated.url,
      events: parseWebhookEvents(updated.events) ?? [],
      active: updated.active,
      description: updated.description,
    },
  })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'integrations.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const sub = await db.webhookSubscription.findUnique({ where: { id } })
  if (!sub) return jsonError(404, 'Naročnina ne obstaja.')
  if (sub.revokedAt) return NextResponse.json({ data: { revoked: true, id } }) // idempotentno

  await db.webhookSubscription.update({
    where: { id },
    data: { active: false, revokedAt: new Date() },
  })
  await writeAudit({
    userId: user.id,
    action: 'WEBHOOK_REVOKE',
    entity: 'webhookSubscription',
    entityId: id,
    detail: { url: sub.url }, // javni cilj (brez skrivnosti — ta ni nikoli shranjena)
  })

  return NextResponse.json({ data: { revoked: true, id } })
}

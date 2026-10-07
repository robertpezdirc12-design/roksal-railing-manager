// API /api/surveys — R437 (route-map izvirnik: ankete / povpraševanja)
// GET  seznam anket (crm.read) — ?handled=0|1
// POST nova anketa { name, email?, phone?, type?, lengthCm?, location?, message? } (crm.write)
//      ali obdelava { id, handled: true|false } → reviziji SURVEY_CREATE / SURVEY_HANDLED.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'

const TYPES = ['OGRAJA', 'STOPNISCE', 'TERASA', 'DRUGO']

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'crm.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const handled = url.searchParams.get('handled')

  const surveys = await db.survey.findMany({
    where: handled === '0' ? { handled: false } : handled === '1' ? { handled: true } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ data: surveys })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'crm.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)

  // ── varianta 2: obdelava obstoječe ankete ────────────────────────────────
  if (typeof body?.id === 'string' && body.id) {
    const handled = body.handled
    if (typeof handled !== 'boolean') return jsonError(400, 'Manjka handled (true/false).')
    const survey = await db.survey.findUnique({ where: { id: body.id } })
    if (!survey) return jsonError(404, 'Anketa ne obstaja.')
    const updated = await db.survey.update({ where: { id: body.id }, data: { handled } })
    await writeAudit({
      userId: auth.user.id,
      action: 'SURVEY_HANDLED',
      entity: 'survey',
      entityId: survey.id,
      detail: { name: survey.name, handled },
    })
    return NextResponse.json({ data: updated })
  }

  // ── varianta 1: nova anketa / povpraševanje ──────────────────────────────
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' && body.email.trim() ? body.email.trim() : null
  const phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : null
  const type = typeof body?.type === 'string' && TYPES.includes(body.type) ? body.type : 'OGRAJA'
  const lengthCm = body?.lengthCm === undefined || body?.lengthCm === null || body?.lengthCm === ''
    ? null
    : Number(body.lengthCm)
  const location = typeof body?.location === 'string' && body.location.trim() ? body.location.trim() : null
  const message = typeof body?.message === 'string' ? body.message : null

  if (!name) return jsonError(400, 'Ime kontaktirane osebe je obvezno.')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, 'E-pošta ni veljavna.')
  if (lengthCm !== null && (!Number.isFinite(lengthCm) || lengthCm <= 0)) {
    return jsonError(400, 'Ocenjena dolžina mora biti večja od 0.')
  }

  const survey = await db.survey.create({
    data: { name, email, phone, type, lengthCm, location, message },
  })
  await writeAudit({
    userId: auth.user.id,
    action: 'SURVEY_CREATE',
    entity: 'survey',
    entityId: survey.id,
    detail: { name, type },
  })

  // R438 (issue #5): novo povpraševanje → obvestilo pisarni (OFFICE)
  await emitEvent({
    type: 'SURVEY_NEW',
    key: `survey-new:${survey.id}`,
    title: 'Novo povpraševanje',
    body: `Novo povpraševanje: ${name} (${type}${location ? `, ${location}` : ''}${lengthCm ? `, ~${Math.round(lengthCm)} cm` : ''})`,
    audience: 'OFFICE',
  })
  return NextResponse.json({ data: survey }, { status: 201 })
}

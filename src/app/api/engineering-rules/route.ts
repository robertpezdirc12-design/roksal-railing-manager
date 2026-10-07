// API /api/engineering-rules — R437 (route-map izvirnik: engineering-rules)
// GET  seznam aktivnih pravil (projects.read) — ?all=1 vključno z neaktivnimi
// POST novo/posodobi pravilo { key, label, value, unit?, note? } (production.manage)
//      — upsert po ključu; value > 0 → revizija ENGINEERING_RULE_UPSERT.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const UNITS = ['cm', 'm', '°', 'kos', 'mm']

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const all = url.searchParams.get('all') === '1'

  const rules = await db.engineeringRule.findMany({
    where: all ? {} : { active: true },
    orderBy: { key: 'asc' },
  })
  return NextResponse.json({ data: rules })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'production.manage')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const key = typeof body?.key === 'string' ? body.key.trim().toLowerCase().replace(/\s+/g, '_') : ''
  const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : ''
  const value = Number(body?.value)
  const unit = typeof body?.unit === 'string' && UNITS.includes(body.unit) ? body.unit : 'cm'
  const note = typeof body?.note === 'string' ? body.note : null
  const active = typeof body?.active === 'boolean' ? body.active : true

  if (!key) return jsonError(400, 'Ključ pravila je obvezen (npr. max_razdalja_stebrov).')
  if (key.length > 60) return jsonError(400, 'Ključ je predolg (max 60 znakov).')
  if (!label) return jsonError(400, 'Oznaka (label) je obvezna.')
  if (!Number.isFinite(value) || value <= 0) return jsonError(400, 'Vrednost mora biti večja od 0.')

  const rule = await db.engineeringRule.upsert({
    where: { key },
    create: { key, label, value, unit, note, active },
    update: { label, value, unit, note, active },
  })
  await writeAudit({
    userId: auth.user.id,
    action: 'ENGINEERING_RULE_UPSERT',
    entity: 'engineeringRule',
    entityId: rule.id,
    detail: { key, value, unit, active },
  })
  return NextResponse.json({ data: rule }, { status: 201 })
}

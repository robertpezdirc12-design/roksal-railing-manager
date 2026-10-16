// API /api/engineering-rules — R437 (route-map izvirnik: engineering-rules)
// GET  seznam aktivnih pravil (projects.read) — ?all=1 vključno z neaktivnimi
// POST novo/posodobi pravilo { key, label, value, unit?, note? } (production.manage)
//      — upsert po ključu; value > 0 → revizija ENGINEERING_RULE_UPSERT.
//      R449 (issue #8): vsak upsert zapiše RuleVersion (staro→novo) + revizijo RULE_VERSION.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const UNITS = ['cm', 'm', '°', 'kos', 'mm']

/** R449 (issue #8): posnetek stanja pravila za zgodovino vrednosti. */
function ruleSnapshot (r: {
  key: string; label: string; value: number; unit: string
  note: string | null; active: boolean
}): Record<string, unknown> {
  return { key: r.key, label: r.label, value: r.value, unit: r.unit, note: r.note, active: r.active }
}

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

  const existing = await db.engineeringRule.findUnique({ where: { key } })
  // R539 (transakcijska celovitost): upsert pravila + zgodovina verzije + OBE
  // reviziji v ENI transakciji — padec srednjega koraka ne pusti pravila brez
  // zgodovine verzije (vzorec R537-d; predbranje `existing` ostaja izven tx).
  const rule = await db.$transaction(async (tx) => {
    const rule = await tx.engineeringRule.upsert({
      where: { key },
      create: { key, label, value, unit, note, active },
      update: { label, value, unit, note, active },
    })

    // R449 (issue #8): zgodovina vrednosti — staro→novo ob vsakem upsertu
    const version = await tx.ruleVersion.create({
      data: {
        ruleId: rule.id,
        userId: auth.user.id,
        oldValue: existing ? JSON.stringify(ruleSnapshot(existing)) : null,
        newValue: JSON.stringify(ruleSnapshot(rule)),
        note: existing ? `Posodobitev pravila ${key}` : `Novo pravilo ${key}`,
      },
    })

    await writeAudit({
      userId: auth.user.id,
      action: 'ENGINEERING_RULE_UPSERT',
      entity: 'engineeringRule',
      entityId: rule.id,
      detail: { key, value, unit, active },
    }, tx)
    await writeAudit({
      userId: auth.user.id,
      action: 'RULE_VERSION',
      entity: 'ruleVersion',
      entityId: version.id,
      detail: { ruleId: rule.id, key, operacija: existing ? 'posodobitev' : 'nastanek' },
    }, tx)
    return rule
  })
  return NextResponse.json({ data: rule }, { status: 201 })
}

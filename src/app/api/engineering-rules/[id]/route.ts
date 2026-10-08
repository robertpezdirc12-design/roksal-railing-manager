// API /api/engineering-rules/[id] — R437 (route-map izvirnik)
// GET    eno pravilo (projects.read)
// PATCH  { label?, value?, unit?, note?, active? } (production.manage) → revizija ENGINEERING_RULE_UPDATE
//        R449 (issue #8): vsak popravek zapiše RuleVersion (staro→novo) + revizijo RULE_VERSION.
// DELETE deaktivacija (NE fizični izbris — pravila so referenca izračunov) (production.manage)
//        R449 (issue #8): tudi deaktivacija zapiše RuleVersion (sprememba polja active).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const UNITS = ['cm', 'm', '°', 'kos', 'mm']

type Ctx = { params: Promise<{ id: string }> }

/** R449 (issue #8): posnetek stanja pravila za zgodovino vrednosti. */
function ruleSnapshot (r: {
  key: string; label: string; value: number; unit: string
  note: string | null; active: boolean
}): Record<string, unknown> {
  return { key: r.key, label: r.label, value: r.value, unit: r.unit, note: r.note, active: r.active }
}

export async function GET (req: NextRequest, ctx: Ctx) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  const rule = await db.engineeringRule.findUnique({ where: { id } })
  if (!rule) return jsonError(404, 'Pravilo ne obstaja.')
  return NextResponse.json({ data: rule })
}

export async function PATCH (req: NextRequest, ctx: Ctx) {
  const auth = await requirePermission(req, 'production.manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  const rule = await db.engineeringRule.findUnique({ where: { id } })
  if (!rule) return jsonError(404, 'Pravilo ne obstaja.')

  const body = await req.json().catch(() => null)
  const patch: { label?: string; value?: number; unit?: string; note?: string | null; active?: boolean } = {}
  if (typeof body?.label === 'string' && body.label.trim()) patch.label = body.label.trim()
  if (body?.value !== undefined) {
    const value = Number(body.value)
    if (!Number.isFinite(value) || value <= 0) return jsonError(400, 'Vrednost mora biti večja od 0.')
    patch.value = value
  }
  if (typeof body?.unit === 'string' && UNITS.includes(body.unit)) patch.unit = body.unit
  if (typeof body?.note === 'string') patch.note = body.note
  if (typeof body?.active === 'boolean') patch.active = body.active
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb.')

  const updated = await db.engineeringRule.update({ where: { id }, data: patch })

  // R449 (issue #8): zgodovina vrednosti — staro→novo
  const version = await db.ruleVersion.create({
    data: {
      ruleId: rule.id,
      userId: auth.user.id,
      oldValue: JSON.stringify(ruleSnapshot(rule)),
      newValue: JSON.stringify(ruleSnapshot(updated)),
      note: `Popravek: ${Object.keys(patch).join(', ')}`,
    },
  })

  await writeAudit({
    userId: auth.user.id,
    action: 'ENGINEERING_RULE_UPDATE',
    entity: 'engineeringRule',
    entityId: rule.id,
    detail: { key: rule.key, from: { value: rule.value, active: rule.active }, to: patch },
  })
  await writeAudit({
    userId: auth.user.id,
    action: 'RULE_VERSION',
    entity: 'ruleVersion',
    entityId: version.id,
    detail: { ruleId: rule.id, key: rule.key, spremembe: Object.keys(patch) },
  })
  return NextResponse.json({ data: updated })
}

export async function DELETE (req: NextRequest, ctx: Ctx) {
  const auth = await requirePermission(req, 'production.manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await ctx.params
  const rule = await db.engineeringRule.findUnique({ where: { id } })
  if (!rule) return jsonError(404, 'Pravilo ne obstaja.')

  // pravila se deaktivirajo (zgodovina izračunov se sklicuje nanje)
  const updated = await db.engineeringRule.update({ where: { id }, data: { active: false } })

  // R449 (issue #8): deaktivacija je sprememba (active) → tudi zgodovina vrednosti
  const version = await db.ruleVersion.create({
    data: {
      ruleId: rule.id,
      userId: auth.user.id,
      oldValue: JSON.stringify(ruleSnapshot(rule)),
      newValue: JSON.stringify(ruleSnapshot(updated)),
      note: 'Deaktivacija pravila',
    },
  })

  await writeAudit({
    userId: auth.user.id,
    action: 'ENGINEERING_RULE_UPDATE',
    entity: 'engineeringRule',
    entityId: rule.id,
    detail: { key: rule.key, deactivated: true },
  })
  await writeAudit({
    userId: auth.user.id,
    action: 'RULE_VERSION',
    entity: 'ruleVersion',
    entityId: version.id,
    detail: { ruleId: rule.id, key: rule.key, operacija: 'deaktivacija' },
  })
  return NextResponse.json({ data: updated })
}

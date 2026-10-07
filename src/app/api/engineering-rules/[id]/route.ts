// API /api/engineering-rules/[id] — R437 (route-map izvirnik)
// GET    eno pravilo (projects.read)
// PATCH  { label?, value?, unit?, note?, active? } (production.manage) → revizija ENGINEERING_RULE_UPDATE
// DELETE deaktivacija (NE fizični izbris — pravila so referenca izračunov) (production.manage)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const UNITS = ['cm', 'm', '°', 'kos', 'mm']

type Ctx = { params: Promise<{ id: string }> }

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
  await writeAudit({
    userId: auth.user.id,
    action: 'ENGINEERING_RULE_UPDATE',
    entity: 'engineeringRule',
    entityId: rule.id,
    detail: { key: rule.key, from: { value: rule.value, active: rule.active }, to: patch },
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
  await writeAudit({
    userId: auth.user.id,
    action: 'ENGINEERING_RULE_UPDATE',
    entity: 'engineeringRule',
    entityId: rule.id,
    detail: { key: rule.key, deactivated: true },
  })
  return NextResponse.json({ data: updated })
}

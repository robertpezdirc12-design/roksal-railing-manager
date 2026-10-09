import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

const MATERIALS = ['ALU', 'INOX', 'KOVANO ŽELEZO', 'STIKLO']
const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIBNA']

/** R449 (issue #8): posnetek celotnega profila za verzijo kataloga. */
function profileSnapshot (p: {
  sku: string; name: string; material: string; type: string; pricePerM: number
  description: string | null; active: boolean
}): Record<string, unknown> {
  return {
    sku: p.sku, name: p.name, material: p.material, type: p.type,
    pricePerM: p.pricePerM, description: p.description, active: p.active,
  }
}

// PATCH /api/catalog/[id] — urejanje profila / cene (catalog.write)
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'catalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const existing = await db.profile.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Profil ne obstaja.')

  const patch: Record<string, unknown> = {}
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body?.material === 'string' && MATERIALS.includes(body.material)) patch.material = body.material
  if (typeof body?.type === 'string' && TYPES.includes(body.type)) patch.type = body.type
  if (typeof body?.description === 'string') patch.description = body.description.trim() || null
  if (typeof body?.active === 'boolean') patch.active = body.active
  if (typeof body?.pricePerM === 'number') {
    if (!Number.isFinite(body.pricePerM) || body.pricePerM < 0) {
      return jsonError(400, 'Cena na meter mora biti nenegativno število.')
    }
    patch.pricePerM = body.pricePerM
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  const updated = await db.profile.update({ where: { id }, data: patch })

  // R449 (issue #8): verzija ob vsaki spremembi — staro→novo (le spremenjena polja) + celoten posnetek
  const before: Record<string, unknown> = {}
  for (const key of Object.keys(patch)) {
    before[key] = (existing as Record<string, unknown>)[key]
  }
  const version = await db.catalogVersion.create({
    data: {
      profileId: id,
      userId: auth.user.id,
      data: JSON.stringify({ before, after: patch, profile: profileSnapshot({ ...updated, pricePerM: updated.pricePerM.toNumber() }) }),
      note: `Sprememba: ${Object.keys(patch).join(', ')}`,
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'PROFILE_UPDATE', entity: 'profile', entityId: id,
    detail: { sku: existing.sku, ...patch },
  })
  await writeAudit({
    userId: auth.user.id, action: 'CATALOG_VERSION', entity: 'catalogVersion', entityId: version.id,
    detail: { profileId: id, sku: updated.sku, spremembe: Object.keys(patch) },
  })
  return NextResponse.json({ data: updated })
}

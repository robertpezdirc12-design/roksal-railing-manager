import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

type Params = { params: Promise<{ id: string }> }

const MATERIALS = ['ALU', 'INOX', 'KOVANO ŽELEZO', 'STIKLO']
const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIBNA']

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// delni PATCH — vsa polja neobvezna; neveljavna/neznana vrednost se tiho
// preskoči (kot prej: material/type izven seznamov se ignorira, prazno ime
// se izpusti), opis: niz ⇒ trim, prazno ⇒ null; cena (če je podana kot
// število) mora biti ≥ 0 — sicer 400 (kot prej).

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

const ProfilePatchSchema = z.object({
  name: z.string({ error: 'Ime mora biti besedilo.' }).trim().optional().transform((v) => v || undefined),
  material: z.unknown().transform((v) => (typeof v === 'string' && MATERIALS.includes(v) ? v : undefined)),
  type: z.unknown().transform((v) => (typeof v === 'string' && TYPES.includes(v) ? v : undefined)),
  description: z.string({ error: 'Opis mora biti besedilo.' }).nullish().transform((v) => (v === undefined ? undefined : v?.trim() || null)),
  active: z.boolean({ error: 'active mora biti logična vrednost (boolean).' }).optional(),
  pricePerM: z.number({ error: 'Cena na meter mora biti nenegativno število.' }).nonnegative('Cena na meter mora biti nenegativno število.').nullish().transform((v) => v ?? undefined),
})

// PATCH /api/catalog/[id] — urejanje profila / cene (catalog.write)
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'catalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const existing = await db.profile.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Profil ne obstaja.')

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, ProfilePatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const patch: Record<string, unknown> = {}
  if (data.name !== undefined) patch.name = data.name
  if (data.material !== undefined) patch.material = data.material
  if (data.type !== undefined) patch.type = data.type
  if (data.description !== undefined) patch.description = data.description
  if (data.active !== undefined) patch.active = data.active
  if (data.pricePerM !== undefined) patch.pricePerM = data.pricePerM
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // posodobitev + verzija kataloga + OBE reviziji v ENI transakciji.
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.profile.update({ where: { id }, data: patch })

    // R449 (issue #8): verzija ob vsaki spremembi — staro→novo (le spremenjena polja) + celoten posnetek
    const before: Record<string, unknown> = {}
    for (const key of Object.keys(patch)) {
      before[key] = (existing as Record<string, unknown>)[key]
    }
    const version = await tx.catalogVersion.create({
      data: {
        profileId: id,
        userId: auth.user.id,
        // R542: data je jsonb objekt (ne niz)
        data: { before, after: patch, profile: profileSnapshot({ ...updated, pricePerM: updated.pricePerM.toNumber() }) } as unknown as Prisma.InputJsonValue,
        note: `Sprememba: ${Object.keys(patch).join(', ')}`,
      },
    })

    await writeAudit({
      userId: auth.user.id, action: 'PROFILE_UPDATE', entity: 'profile', entityId: id,
      detail: { sku: existing.sku, ...patch },
    }, tx)
    await writeAudit({
      userId: auth.user.id, action: 'CATALOG_VERSION', entity: 'catalogVersion', entityId: version.id,
      detail: { profileId: id, sku: updated.sku, spremembe: Object.keys(patch) },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

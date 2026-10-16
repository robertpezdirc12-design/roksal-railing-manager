import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

const MATERIALS = ['ALU', 'INOX', 'KOVANO ŽELEZO', 'STIKLO']
const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIBNA']

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// sku/ime obvezna po trim (sku se normalizira na velike črke, kot prej),
// material/type ohranjata TIHI privzetek ob neznani vrednosti (kot prej —
// brez zavrnitve), pricePerM mora biti število ≥ 0 (nekončno/negativno ⇒ 400,
// kot prej), opis: neprazen po trim ⇒ povržen, sicer null (kot prej).
const ProfileCreateSchema = z.object({
  sku: z.string({ error: 'SKU profila je obvezen.' }).trim().min(1, 'SKU profila je obvezen.').transform((v) => v.toUpperCase()),
  name: z.string({ error: 'Ime profila je obvezno.' }).trim().min(1, 'Ime profila je obvezno.'),
  material: z.unknown().transform((v) => (typeof v === 'string' && MATERIALS.includes(v) ? v : 'ALU')),
  type: z.unknown().transform((v) => (typeof v === 'string' && TYPES.includes(v) ? v : 'OGRAJA')),
  pricePerM: z.number({ error: 'Cena na meter mora biti nenegativno število.' }).nonnegative('Cena na meter mora biti nenegativno število.'),
  description: z.string({ error: 'Opis mora biti besedilo.' }).nullish().transform((v) => v?.trim() || null),
})

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

// GET /api/catalog — seznam aktivnih profilov (catalog.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.read')
  if (auth instanceof NextResponse) return auth

  const profiles = await db.profile.findMany({
    where: { active: true },
    orderBy: { sku: 'asc' },
  })
  return NextResponse.json({ data: profiles })
}

// POST /api/catalog — nov profil (catalog.write)
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.write')
  if (auth instanceof NextResponse) return auth

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, ProfileCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const dupe = await db.profile.findUnique({ where: { sku: data.sku } })
  if (dupe) return jsonError(409, `SKU ${data.sku} že obstaja.`, 'Izberite drugo kodo profila.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // profil + verzija kataloga + OBE reviziji v ENI transakciji (prej ločeni
  // await-i — padec srednjega koraka bi pustil profil brez verzije/revizije).
  const profile = await db.$transaction(async (tx) => {
    const profile = await tx.profile.create({
      data: {
        sku: data.sku, name: data.name, material: data.material, type: data.type, pricePerM: data.pricePerM,
        description: data.description,
      },
    })

    // R449 (issue #8): verzija ob vsaki spremembi — ob nastanku je before = null
    // pricePerM: Decimal(12,2) → number (posnetek se serializira v JSON)
    const snapshot = profileSnapshot({ ...profile, pricePerM: profile.pricePerM.toNumber() })
    const version = await tx.catalogVersion.create({
      data: {
        profileId: profile.id,
        userId: auth.user.id,
        data: JSON.stringify({ before: null, after: snapshot, profile: snapshot }),
        note: 'Nov profil v katalogu',
      },
    })

    await writeAudit({
      userId: auth.user.id, action: 'CATALOG_UPDATE', entity: 'profile', entityId: profile.id,
      detail: { sku: data.sku, name: data.name, material: data.material, type: data.type, pricePerM: data.pricePerM, operacija: 'nov profil' },
    }, tx)
    await writeAudit({
      userId: auth.user.id, action: 'CATALOG_VERSION', entity: 'catalogVersion', entityId: version.id,
      detail: { profileId: profile.id, sku: data.sku, operacija: 'nov profil' },
    }, tx)
    return profile
  })
  return NextResponse.json({ data: profile }, { status: 201 })
}

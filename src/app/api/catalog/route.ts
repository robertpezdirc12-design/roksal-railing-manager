import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const MATERIALS = ['ALU', 'INOX', 'KOVANO ŽELEZO', 'STIKLO']
const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIBNA']

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

  const body = await req.json().catch(() => null)
  const sku = typeof body?.sku === 'string' ? body.sku.trim().toUpperCase() : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const material = typeof body?.material === 'string' && MATERIALS.includes(body.material) ? body.material : 'ALU'
  const type = typeof body?.type === 'string' && TYPES.includes(body.type) ? body.type : 'OGRAJA'
  const pricePerM = typeof body?.pricePerM === 'number' ? body.pricePerM : NaN

  if (!sku) return jsonError(400, 'SKU profila je obvezen.')
  if (!name) return jsonError(400, 'Ime profila je obvezno.')
  if (!Number.isFinite(pricePerM) || pricePerM < 0) return jsonError(400, 'Cena na meter mora biti nenegativno število.')

  const dupe = await db.profile.findUnique({ where: { sku } })
  if (dupe) return jsonError(409, `SKU ${sku} že obstaja.`, 'Izberite drugo kodo profila.')

  const profile = await db.profile.create({
    data: {
      sku, name, material, type, pricePerM,
      description: typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : null,
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'CATALOG_UPDATE', entity: 'profile', entityId: profile.id,
    detail: { sku, name, material, type, pricePerM, operacija: 'nov profil' },
  })
  return NextResponse.json({ data: profile }, { status: 201 })
}

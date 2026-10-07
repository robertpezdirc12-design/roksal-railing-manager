import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { hasPerm } from '@/lib/permissions-core'

const TYPES = ['NABAVNA', 'PRODAJNA', 'MONTAZA']

// GET /api/price-lists — ceniki s pravili (catalog.read)
// Varnost (issue #7 §12): brez price.override uporabnik vidi SAMO prodajne/montažne
// cenike — NABAVNA pravila (nabavne cene) ostanejo izključno na pooblaščeni osebi.
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.read')
  if (auth instanceof NextResponse) return auth

  const canSeeNabavna = hasPerm(auth.perms, 'price.override')
  const lists = await db.priceList.findMany({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    include: {
      rules: {
        where: { active: true },
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
          item: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
    },
  })
  const filtered = lists
    .filter((l) => canSeeNabavna || l.type !== 'NABAVNA')
    .map((l) => ({ ...l, rules: l.rules.slice(0, 200) }))
  return NextResponse.json({ data: filtered })
}

// POST /api/price-lists — nov cenik (price.override → revizija)
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'price.override')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const type = typeof body?.type === 'string' && TYPES.includes(body.type) ? body.type : 'PRODAJNA'
  if (!name) return jsonError(400, 'Ime cenika je obvezno.')

  const list = await db.priceList.create({
    data: {
      name, type,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
      validFrom: typeof body?.validFrom === 'string' && body.validFrom ? new Date(body.validFrom) : new Date(),
      validTo: typeof body?.validTo === 'string' && body.validTo ? new Date(body.validTo) : null,
    },
  })
  await writeAudit({
    userId: auth.user.id, action: 'PRICE_LIST_CREATE', entity: 'priceList', entityId: list.id,
    detail: { name, type },
  })
  return NextResponse.json({ data: list }, { status: 201 })
}

// /api/measurement/products — izdelki (profili) primerni za tip meritve (issue #1)
// GET ?type=OGRAJA|BALUSTRADA|NAGIB (measurements.read) → profili iz kataloga z
// ceno na meter, materialom in tipom — izbira izdelka po izmerjeni geometriji.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIB']

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  if (type && !TYPES.includes(type)) {
    return jsonError(400, 'Neznan tip meritve.', `Veljavni tipi: ${TYPES.join(', ')}.`)
  }

  const profiles = await db.profile.findMany({
    where: { active: true },
    select: { id: true, sku: true, name: true, material: true, type: true, pricePerM: true },
    orderBy: [{ type: 'asc' }, { sku: 'asc' }],
  })

  // razvrstimo po ustreznosti: najprej profili točno tipa, nato ostali
  const suitable = type
    ? [...profiles.filter((p) => p.type === type), ...profiles.filter((p) => p.type !== type)]
    : profiles

  return NextResponse.json({ data: suitable })
}

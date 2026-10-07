import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'

// /api/equipment/events — R437 (route-map izvirnika): dnevnik izposoj orodjarine
// GET (equipment.read): ?equipmentId= filter + ?limit=1..200 (privzeto 100)
// Seznam EquipmentCheckout z orodjem (code, name, status, category) in uporabnikom,
// urejeno po outAt padajoče.

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'equipment.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const equipmentId = url.searchParams.get('equipmentId')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 200)

  const data = await db.equipmentCheckout.findMany({
    where: equipmentId ? { equipmentId } : {},
    include: {
      equipment: { select: { code: true, name: true, status: true, category: true } },
      user: { select: { name: true } },
    },
    orderBy: { outAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ data })
}

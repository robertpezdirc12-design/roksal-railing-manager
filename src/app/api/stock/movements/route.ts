import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { MOVEMENT_TYPES } from '@/lib/stock-core'

// GET /api/stock/movements?itemId=&type=&limit= — nemutabilni dnevnik gibanj (inventory.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const itemId = sp.get('itemId')
  const type = sp.get('type')
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 100), 1), 500)

  const movements = await db.stockMovement.findMany({
    where: {
      ...(itemId ? { itemId } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      item: { select: { sku: true, name: true, unit: true } },
      user: { select: { name: true, role: true } },
    },
  })
  return NextResponse.json({ data: movements })
}

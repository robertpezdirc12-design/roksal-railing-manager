import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

// GET /api/bom?status=&projectId= — seznam kosovnic z vrsticami (inventory.read)
// Skladišče/pisarna: vrstice z EKSPlicitnimi itemId (picking). Brez marž.
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const status = sp.get('status')
  const projectId = sp.get('projectId')
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 100), 1), 500)

  const boms = await db.bom.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(projectId ? { package: { projectId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      product: { select: { sku: true, name: true, unit: true } },
      variant: { select: { sku: true, name: true } },
      package: { select: { code: true, name: true, projectId: true, project: { select: { code: true, title: true } } } },
      lines: { orderBy: { sortOrder: 'asc' }, include: { item: { select: { sku: true, name: true, unit: true, qty: true } } } },
    },
  })
  return NextResponse.json({ data: boms })
}

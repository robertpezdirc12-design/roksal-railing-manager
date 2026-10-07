import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

// GET /api/product-families — družine s številom aktivnih izdelkov (catalog.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.read')
  if (auth instanceof NextResponse) return auth

  const families = await db.productFamily.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { products: { where: { active: true } } } } },
  })
  return NextResponse.json({
    data: families.map((f) => ({
      id: f.id, code: f.code, name: f.name, desc: f.desc, unit: f.unit,
      sortOrder: f.sortOrder, productCount: f._count.products,
    })),
  })
}

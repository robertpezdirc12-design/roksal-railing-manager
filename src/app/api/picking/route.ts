import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { createPickingFromBom } from '@/lib/stock-core'

// GET /api/picking?status= — seznam picking list (inventory.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const status = sp.get('status')
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 100), 1), 200)

  const rows = await db.pickingList.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      bom: { select: { code: true, product: { select: { sku: true, name: true } }, package: { select: { code: true, name: true, project: { select: { code: true, title: true } } } } } },
      lines: { include: { item: { select: { sku: true, name: true, unit: true } } } },
      _count: { select: { lines: true } },
    },
  })
  return NextResponse.json({ data: rows })
}

// POST /api/picking — nova picking lista iz kosovnice {bomId} (inventory.write)
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const bomId = typeof body?.bomId === 'string' ? body.bomId : ''
  if (!bomId) return jsonError(400, 'bomId je obvezen.')

  const res = await createPickingFromBom(bomId, auth.user.id)
  if (!res.ok) return jsonError(409, res.error)

  await writeAudit({
    userId: auth.user.id, action: 'PICKING_CREATE', entity: 'pickingList', entityId: res.id,
    detail: { code: res.code, bomId },
  })
  return NextResponse.json({ data: { id: res.id, code: res.code } }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { cancelPicking, completePicking } from '@/lib/stock-core'

type Params = { params: Promise<{ id: string }> }

// GET /api/picking/[id] — podrobnost picking liste (inventory.read)
export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const picking = await db.pickingList.findUnique({
    where: { id },
    include: {
      bom: { select: { code: true, qty: true, unit: true, product: { select: { sku: true, name: true } }, package: { select: { code: true, name: true, project: { select: { code: true, title: true } } } } } },
      lines: { orderBy: { sortOrder: 'asc' }, include: { item: true } },
    },
  })
  if (!picking) return jsonError(404, 'Picking lista ne obstaja.')
  return NextResponse.json({ data: picking })
}

// PATCH /api/picking/[id] — zaključi picking {action: 'complete', lines: [{lineId, qtyPicked}]}
// ali prekliči {action: 'cancel'} (inventory.write; izdaja se zapiše v dnevnik)
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const action = typeof body?.action === 'string' ? body.action : 'complete'

  if (action === 'cancel') {
    const res = await cancelPicking(id)
    if (!res.ok) return jsonError(409, res.error)
    await writeAudit({
      userId: auth.user.id, action: 'PICKING_CANCEL', entity: 'pickingList', entityId: id,
      detail: {},
    })
    return NextResponse.json({ data: { cancelled: true } })
  }

  if (action !== 'complete') return jsonError(400, 'Neznana akcija (complete | cancel).')
  const lines = Array.isArray(body?.lines)
    ? body.lines.filter((l: { lineId?: unknown; qtyPicked?: unknown }) => typeof l?.lineId === 'string' && typeof l?.qtyPicked === 'number')
    : []
  const res = await completePicking(id, lines, auth.user.id)
  if (!res.ok) return jsonError(409, res.error)

  const picking = await db.pickingList.findUnique({
    where: { id },
    select: { code: true, bom: { select: { code: true, package: { select: { projectId: true } } } } },
  })
  await writeAudit({
    userId: auth.user.id, action: 'PICKING_COMPLETE', entity: 'pickingList', entityId: id,
    projectId: picking?.bom?.package?.projectId ?? null,
    detail: { code: picking?.code ?? id, issued: res.issued, bom: picking?.bom?.code ?? null },
  })
  return NextResponse.json({ data: { issued: res.issued } })
}

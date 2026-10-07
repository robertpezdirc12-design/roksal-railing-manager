import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { recordMovement } from '@/lib/stock-core'

// POST /api/stock/returns — vračilo materiala z terena/iz montaže nazaj v zalogo.
// VRACILO gibanje (+ fizična zaloga). Vezava na projekt/nalog prek refType/refId (issue #7 §7).
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
  const qty = typeof body?.qty === 'number' ? body.qty : NaN
  const projectId = typeof body?.projectId === 'string' && body.projectId ? body.projectId : null
  const workOrderId = typeof body?.workOrderId === 'string' && body.workOrderId ? body.workOrderId : null
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null

  if (!itemId) return jsonError(400, 'itemId je obvezen.')
  if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'Količina vračila mora biti pozitivno število.')

  // če je podan projekt, mora obstajati (fail-closed na tuje ID-je)
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, code: true } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
  }
  if (workOrderId) {
    const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, code: true } })
    if (!wo) return jsonError(404, 'Delovni nalog ne obstaja.')
  }

  const refType = workOrderId ? 'workOrder' : projectId ? 'project' : 'rocni'
  const refId = workOrderId ?? projectId

  const res = await recordMovement({
    itemId, qty: Math.round(qty * 1000) / 1000, type: 'VRACILO',
    userId: auth.user.id, refType, refId,
    note: note ?? 'Vračilo materiala',
  })
  if (!res.ok) return jsonError(409, res.error)

  const item = await db.inventoryItem.findUnique({ where: { id: itemId }, select: { sku: true, name: true, unit: true, qty: true } })
  await writeAudit({
    userId: auth.user.id, action: 'STOCK_RETURN', entity: 'inventoryItem', entityId: itemId,
    projectId,
    detail: { sku: item?.sku ?? itemId, qty, project: projectId ?? null, workOrder: workOrderId ?? null, note },
  })
  return NextResponse.json({
    data: {
      itemId, qty,
      sku: item?.sku, physical: item?.qty, unit: item?.unit,
    },
  }, { status: 201 })
}

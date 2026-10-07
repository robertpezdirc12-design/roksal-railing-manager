import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'

// /api/qc — kontrola kakovosti proizvodnih nalogov (route-map: GET/POST /api/qc)
// GET  (production.read): ?productionOrderId=… → kontrole naloga (+ osnovni podatki naloga)
// POST (production.manage): nova kontrola { productionOrderId, item, result: OK|NOK|NA|V_TEKU, note? }
// Revizija: QC_CHECK.

const RESULTS = ['OK', 'NOK', 'NA', 'V_TEKU']

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'production.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const productionOrderId = url.searchParams.get('productionOrderId')

  const checks = await db.qcCheck.findMany({
    where: productionOrderId ? { productionOrderId } : {},
    include: {
      user: { select: { name: true } },
      productionOrder: { select: { code: true, title: true, status: true, project: { select: { code: true, title: true } } } },
    },
    orderBy: [{ productionOrder: { code: 'asc' } }, { createdAt: 'asc' }],
  })

  return NextResponse.json({ data: checks })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'production.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as { productionOrderId?: string; item?: string; result?: string; note?: string } | null
  const productionOrderId = typeof body?.productionOrderId === 'string' ? body.productionOrderId : ''
  const item = typeof body?.item === 'string' ? body.item.trim() : ''
  const result = typeof body?.result === 'string' ? body.result : 'V_TEKU'

  if (!productionOrderId) return jsonError(400, 'Manjka proizvodni nalog.')
  if (!item) return jsonError(400, 'Kontrolna točka je obvezna.')
  if (!RESULTS.includes(result)) return jsonError(400, `Neveljaven rezultat — dovoljeni: ${RESULTS.join(', ')}.`)

  const order = await db.productionOrder.findUnique({ where: { id: productionOrderId }, select: { id: true, code: true, projectId: true } })
  if (!order) return jsonError(404, 'Proizvodni nalog ne obstaja.')

  const check = await db.qcCheck.create({
    data: {
      productionOrderId,
      item,
      result,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
      userId: user.id,
    },
  })

  await writeAudit({
    userId: user.id, action: 'QC_CHECK', entity: 'productionOrder', entityId: order.id, projectId: order.projectId,
    detail: JSON.stringify({ code: order.code, item, result }),
  })

  // R438 (issue #5): neustrezna kontrola (NOK) → obvestilo pisarni (OFFICE)
  if (result === 'NOK') {
    await emitEvent({
      type: 'QC_NOK',
      key: `qc-nok:${check.id}`,
      title: 'QC neustrezno',
      body: `Kontrola NOK na ${order.code}: ${item}${body?.note ? ` — ${String(body.note).slice(0, 160)}` : ''}`,
      projectId: order.projectId,
      audience: 'OFFICE',
    })
  }

  return NextResponse.json({ data: check }, { status: 201 })
}

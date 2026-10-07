import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { PACKAGE_STATUSES } from '@/lib/product-core'

type Params = { params: Promise<{ id: string }> }

// GET /api/project-packages/[id] — podrobnost paketa (projects.read; kalkulacija samo pisarna)
export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const pkg = await db.projectPackage.findUnique({
    where: { id },
    include: {
      product: { select: { sku: true, name: true, unit: true, family: { select: { code: true, name: true } } } },
      variant: { select: { sku: true, name: true } },
      measurement: true,
      bom: { include: { lines: { orderBy: { sortOrder: 'asc' }, include: { item: true } } } },
    },
  })
  if (!pkg) return jsonError(404, 'Paket ne obstaja.')

  const canSeeCalc = auth.perms.includes('quotes.create')
  return NextResponse.json({ data: { ...pkg, calcJson: canSeeCalc ? pkg.calcJson : null } })
}

// PATCH /api/project-packages/[id] — status/količina/opomba (quotes.create → revizija)
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const existing = await db.projectPackage.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Paket ne obstaja.')

  const body = await req.json().catch(() => null)
  const patch: Record<string, unknown> = {}
  if (typeof body?.status === 'string' && (PACKAGE_STATUSES as readonly string[]).includes(body.status)) patch.status = body.status
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body?.note === 'string') patch.note = body.note.trim() || null
  if (typeof body?.qty === 'number') {
    if (!Number.isFinite(body.qty) || body.qty <= 0) return jsonError(400, 'Količina mora biti pozitivno število.')
    patch.qty = body.qty
  }
  if (typeof body?.measurementId === 'string' && body.measurementId) {
    const m = await db.measurement.findUnique({ where: { id: body.measurementId } })
    if (!m) return jsonError(404, 'Izmera ne obstaja.')
    patch.measurementId = body.measurementId
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  const updated = await db.projectPackage.update({ where: { id }, data: patch })
  await writeAudit({
    userId: auth.user.id, action: 'PACKAGE_UPDATE', entity: 'projectPackage', entityId: id,
    projectId: existing.projectId,
    detail: { code: existing.code, from: existing.status, ...patch },
  })
  return NextResponse.json({ data: updated })
}

// /api/nalog/[id]/material — poraba materiala na terenu (R444, issue #7 §8 MONTER).
// GET  (nalog.read)  — seznam porabe z artikli; MONTER vidi SAMO svoje naloge.
// POST (nalog.write) — zabeleži porabo {itemId, qty, note} SAMO za nalog dodeljen
//   uporabniku ALI za uporabnika z inventory.write (pisarna/skladišče).
// Transakcijsko: InstallationMaterialUsage + StockMovement IZDAJA (recordMovement —
// en vir resnice za zalogo; preveri fizično pokritost → 409) + revizija STOCK_USAGE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { recordMovement } from '@/lib/stock-core'

type Params = { params: Promise<{ id: string }> }

const round3 = (n: number) => Math.round(n * 1000) / 1000

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const wo = await db.workOrder.findUnique({
    where: { id },
    select: { id: true, code: true, assigneeId: true },
  })
  if (!wo) return jsonError(404, 'Nalog ne obstaja.')
  // obseg (fail-closed): monter vidi porabo SAMO svojih nalogov
  if (!readsAllData(auth.user) && wo.assigneeId !== auth.user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Monter vidi samo svoje naloge; dodelitve upravlja pisarna.')
  }

  const rows = await db.installationMaterialUsage.findMany({
    where: { workOrderId: id },
    orderBy: { createdAt: 'desc' },
    include: {
      item: { select: { sku: true, name: true, unit: true, qty: true } },
      user: { select: { name: true } },
    },
  })
  return NextResponse.json({ data: rows })
}

// POST /api/nalog/[id]/material — zabeleži porabo na terenu
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const wo = await db.workOrder.findUnique({
    where: { id },
    select: { id: true, code: true, projectId: true, assigneeId: true },
  })
  if (!wo) return jsonError(404, 'Nalog ne obstaja.')
  // obseg: SAMO nalog dodeljen uporabniku ALI uporabnik z inventory.write (pisarna)
  if (wo.assigneeId !== auth.user.id && !auth.perms.includes('inventory.write')) {
    return jsonError(403, 'Porabo lahko zabeleži samo dodeljeni monter ali pisarna.', 'Za tuje naloge je potrebna pravica inventory.write.')
  }

  const body = await req.json().catch(() => null)
  const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
  const qty = typeof body?.qty === 'number' ? body.qty : NaN
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null

  if (!itemId) return jsonError(400, 'itemId je obvezen.')
  if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'Količina mora biti pozitivno število.')

  const item = await db.inventoryItem.findUnique({ where: { id: itemId } })
  if (!item) return jsonError(404, 'Artikel ne obstaja.')

  const qtyR = round3(qty)

  // 1) gibanje IZDAJA (transakcijsko posodobi fizično zalogo; preveri pokritost → 409)
  const moved = await recordMovement({
    itemId, qty: -qtyR, type: 'IZDAJA',
    userId: auth.user.id, refType: 'workOrder', refId: wo.id,
    note: `Poraba na terenu — ${wo.code}`,
  })
  if (!moved.ok) return jsonError(409, moved.error)

  // 2) zapis porabe vezan na nalog (ob neuspehu kompenziramo z vračilom — dnevnik ostane dosleden)
  try {
    const usage = await db.installationMaterialUsage.create({
      data: { workOrderId: wo.id, itemId, qty: qtyR, note, userId: auth.user.id },
      include: {
        item: { select: { sku: true, name: true, unit: true, qty: true } },
        user: { select: { name: true } },
      },
    })
    await writeAudit({
      userId: auth.user.id, action: 'STOCK_USAGE', entity: 'workOrder', entityId: wo.id,
      projectId: wo.projectId,
      detail: { workOrder: wo.code, sku: item.sku, itemId, qty: qtyR, note },
    })
    return NextResponse.json({ data: usage }, { status: 201 })
  } catch {
    await recordMovement({
      itemId, qty: qtyR, type: 'VRACILO',
      userId: auth.user.id, refType: 'workOrder', refId: wo.id,
      note: `Popravek neuspele prijave porabe — ${wo.code}`,
    })
    return jsonError(500, 'Zapis porabe ni uspel — gibanje je bilo povrnjeno.')
  }
}

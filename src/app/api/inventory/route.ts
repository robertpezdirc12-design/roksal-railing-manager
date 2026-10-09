import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { runStockTx } from '@/lib/stock-core'

// GET /api/inventory — seznam artiklov z losi + povprečno/zadnjo ceno (inventory.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const [items, prices, suppliers] = await Promise.all([
    db.inventoryItem.findMany({
      include: { lots: { orderBy: { deliveredAt: 'desc' } } },
      orderBy: { name: 'asc' },
    }),
    db.materialPrice.findMany({ orderBy: { createdAt: 'desc' } }),
    db.supplier.findMany({ select: { id: true, name: true } }),
  ])

  // supplierId je skalarno polje (brez relacije) → preslika ročno
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]))

  // zadnja cena po artiklu (najnovejši MaterialPrice)
  const lastPriceByItem = new Map<string, number>()
  for (const p of prices) {
    if (p.itemId && !lastPriceByItem.has(p.itemId)) lastPriceByItem.set(p.itemId, p.price)
  }

  const data = items.map((item) => {
    const lotsPositive = item.lots.filter((l) => l.qty > 0)
    const qtySum = lotsPositive.reduce((s, l) => s + l.qty, 0)
    const costSum = lotsPositive.reduce((s, l) => s + l.qty * l.unitCost, 0)
    const avgPrice = qtySum > 0 ? costSum / qtySum : 0
    const lastPrice = lastPriceByItem.get(item.id) ?? (item.lots[0]?.unitCost ?? 0)
    const lots = item.lots.map(({ supplierId, ...lot }) => ({
      ...lot,
      supplier: supplierId ? { name: supplierName.get(supplierId) ?? '—' } : null,
    }))
    return { ...item, lots, avgPrice, lastPrice }
  })

  return NextResponse.json({ data })
}

// PATCH /api/inventory — ročni popravek količine {id, delta} (inventory.write)
// R464: popravek teče kot ATOMARNA POGOJNA posodobitev znotraj interaktivne
// transakcije — pri negativnem delti WHERE qty >= −delta zagotovi, da
// sočasni popravki NIKOLI ne padejo pod nič (prej: branje + pisanje naivno
// = izgubljene posodobitve / negativna zaloga ob sočasnih klicih).
export async function PATCH (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  const delta = typeof body?.delta === 'number' ? body.delta : NaN
  if (!id) return jsonError(400, 'Manjka identifikator artikla.', 'Pričakovano polje id.')
  if (!Number.isFinite(delta) || delta === 0) return jsonError(400, 'Popravek mora biti število, različen od nič.', 'Pričakovano polje delta (npr. -3 ali 5).')

  const item = await db.inventoryItem.findUnique({ where: { id } })
  if (!item) return jsonError(404, 'Artikel ne obstaja.')

  const res = await runStockTx(async (tx) => {
    // atomarna pogojna posodobitev (vrstična ključavnica + invarianta)
    const upd = delta < 0
      ? await tx.inventoryItem.updateMany({
          where: { id, qty: { gte: -delta } },
          data: { qty: { increment: delta } },
        })
      : await tx.inventoryItem.updateMany({
          where: { id },
          data: { qty: { increment: delta } },
        })
    if (upd.count !== 1) {
      const cur = await tx.inventoryItem.findUnique({ where: { id }, select: { qty: true, unit: true } })
      if (!cur) return { ok: false as const, status: 404, error: 'Artikel ne obstaja več.', hint: undefined, updated: null }
      return {
        ok: false as const, status: 400,
        error: 'Popravek bi povzročil negativno količino.',
        hint: `Trenutna količina je ${cur.qty} ${cur.unit}.`,
        updated: null,
      }
    }
    // DNEVNIK GIBANJA (R443: INVENTURA) v isti transakciji + sveže stanje za odgovor
    await tx.stockMovement.create({
      data: {
        itemId: id, qty: delta, type: 'INVENTURA', userId: auth.user.id,
        refType: 'rocni', note: 'Ročni popravek količine',
      },
    })
    const updated = await tx.inventoryItem.findUnique({
      where: { id },
      include: { lots: { orderBy: { deliveredAt: 'desc' }, take: 1 } },
    })
    // R464: revizija V isti transakciji (atomarna s popravkom)
    await writeAudit({
      userId: auth.user.id, action: 'INVENTORY_ADJUST', entity: 'inventoryItem', entityId: id,
      detail: { sku: item.sku, name: item.name, from: item.qty, delta, to: updated?.qty },
    }, tx)
    return { ok: true as const, status: 200, error: undefined, hint: undefined, updated }
  })

  if (!res.ok) return jsonError(res.status, res.error, res.hint)

  return NextResponse.json({ data: res.updated })
}

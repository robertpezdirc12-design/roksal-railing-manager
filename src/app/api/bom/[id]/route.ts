import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { BOM_STATUSES } from '@/lib/product-core'

type Params = { params: Promise<{ id: string }> }

// GET /api/bom/[id] — podrobnost kosovnice (inventory.read)
// R443: vključi rezervirane količine po vrsticah (fizična/rezervirana/razpoložljiva)
export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const bom = await db.bom.findUnique({
    where: { id },
    include: {
      product: { select: { sku: true, name: true, unit: true } },
      variant: { select: { sku: true, name: true } },
      package: { select: { code: true, name: true, projectId: true, project: { select: { code: true, title: true } } } },
      lines: { orderBy: { sortOrder: 'asc' }, include: { item: true } },
      reservations: { where: { status: 'AKTIVNA' }, select: { itemId: true, qty: true } },
      pickings: { where: { status: { in: ['PRIPRAVLJENA', 'V_ZAKLJUCEVANJU'] } }, select: { id: true, code: true, status: true } },
    },
  })
  if (!bom) return jsonError(404, 'Kosovnica ne obstaja.')

  // rezervirano po vrstici (Σ aktivnih rezervacij tega BOM za artikel)
  const reservedByItem = new Map<string, number>()
  for (const r of bom.reservations) {
    reservedByItem.set(r.itemId, (reservedByItem.get(r.itemId) ?? 0) + r.qty)
  }
  // globalno rezervirano po artiklu (VSE aktivne rezervacije — vir za razpoložljivost)
  const globalRes = await db.stockReservation.groupBy({
    by: ['itemId'],
    where: { itemId: { in: bom.lines.map((l) => l.itemId) }, status: 'AKTIVNA' },
    _sum: { qty: true },
  })
  const globalByItem = new Map(globalRes.map((g) => [g.itemId, Math.round((g._sum.qty ?? 0) * 100) / 100]))
  const lines = bom.lines.map((l) => ({
    ...l,
    reserved: Math.round((reservedByItem.get(l.itemId) ?? 0) * 100) / 100, // za ta BOM
    reservedGlobal: globalByItem.get(l.itemId) ?? 0,
    available: Math.round((l.item.qty - (globalByItem.get(l.itemId) ?? 0)) * 100) / 100, // fizična − globalno rezervirana
  }))
  return NextResponse.json({ data: { ...bom, lines } })
}

// PATCH /api/bom/[id] — sprememba statusa (inventory.write → revizija)
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!(BOM_STATUSES as readonly string[]).includes(status)) {
    return jsonError(400, `Neznan status. Dovoljeni: ${BOM_STATUSES.join(', ')}.`)
  }
  // R443: integriteta skladiščnega toka — REZERVIRAN nastane SAMO prek POST /reserve
  // (atomarno z rezervacijami), PORABLJEN SAMO z zaključkom pickinga (izdaja+poraba).
  // Direkten PATCH v ta statusa bi prelomil invarianto FIZIČNA ≠ REZERVIRANA ≠ RAZPOLOŽLJIVA.
  if (status === 'REZERVIRAN' || status === 'PORABLJEN') {
    return jsonError(409, `Status ${status} ni mogoče nastaviti ročno — uporabite ${status === 'REZERVIRAN' ? 'POST /api/bom/[id]/reserve' : 'zaključek picking liste (PATCH /api/picking/[id])'}.`)
  }
  const existing = await db.bom.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Kosovnica ne obstaja.')
  // prehod iz REZERVIRAN/PORABLJEN nazaj na ročne statuse bi pustil odvečne aktivne rezervacije
  if ((existing.status === 'REZERVIRAN' || existing.status === 'PORABLJEN')) {
    const active = await db.stockReservation.count({ where: { bomId: id, status: 'AKTIVNA' } })
    if (active > 0) {
      return jsonError(409, `Kosovnica ima ${active} aktivnih rezervacij — najprej jih sprostite (POST /api/bom/[id]/release).`)
    }
  }

  const updated = await db.bom.update({ where: { id }, data: { status, note: typeof body?.note === 'string' ? body.note : existing.note } })
  await writeAudit({
    userId: auth.user.id, action: 'BOM_STATUS', entity: 'bom', entityId: id,
    projectId: existing.packageId ?? null,
    detail: { code: existing.code, from: existing.status, to: status },
  })
  return NextResponse.json({ data: updated })
}

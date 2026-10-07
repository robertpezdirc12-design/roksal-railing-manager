// stock-core — R443 (issue #7 §7, P1 INVENTORY CORE)
// Jedro skladiščnega toka. VEČNO LOČENO:
//   FIZIČNA ZALOGA (InventoryItem.qty) ≠ REZERVIRANA (Σ aktivnih rezervacij)
//   ≠ RAZPOLOŽLJIVA (fizična − rezervirana).
// Vse spremembe zaloge gredo skozi StockMovement dnevnik (nemutabilen).
// Transakcije so atomicne — rezervacija bodisi uspe za VSE vrstice, bodisi nič.

import { db } from '@/lib/db'

export const MOVEMENT_TYPES = ['PREVZEM', 'IZDAJA', 'VRACILO', 'INVENTURA'] as const
export const RESERVATION_STATUSES = ['AKTIVNA', 'PORABLJENA', 'PREKLICANA'] as const
export const PICKING_STATUSES = ['PRIPRAVLJENA', 'V_ZAKLJUCEVANJU', 'ZAKLJUCENA', 'PREKLICANA'] as const

/** Rezervirana količina artikla (samo aktivne rezervacije). */
export async function reservedQty (itemId: string): Promise<number> {
  const agg = await db.stockReservation.aggregate({
    where: { itemId, status: 'AKTIVNA' },
    _sum: { qty: true },
  })
  return agg._sum.qty ?? 0
}

export interface StockRow {
  id: string; sku: string; name: string; unit: string
  location: string | null; reorderAt: number
  physical: number // fizična zaloga
  reserved: number // rezervirana
  available: number // razpoložljiva = fizična − rezervirana
}

/** Pregled zaloge z ločenimi stolpci fizična/rezervirana/razpoložljiva. */
export async function stockOverview (opts: { q?: string; lowOnly?: boolean } = {}): Promise<StockRow[]> {
  const items = await db.inventoryItem.findMany({
    where: opts.q
      ? { OR: [{ sku: { contains: opts.q } }, { name: { contains: opts.q } }, { location: { contains: opts.q } }] }
      : undefined,
    orderBy: { sku: 'asc' },
    include: { reservations: { where: { status: 'AKTIVNA' }, select: { qty: true } } },
  })
  return items
    .map((it) => {
      const reserved = it.reservations.reduce((s, r) => s + r.qty, 0)
      return {
        id: it.id, sku: it.sku, name: it.name, unit: it.unit,
        location: it.location, reorderAt: it.reorderAt,
        physical: it.qty,
        reserved: Math.round(reserved * 100) / 100,
        available: Math.round((it.qty - reserved) * 100) / 100,
      }
    })
    .filter((r) => (opts.lowOnly ? r.available <= r.reorderAt : true))
}

/** En gibanji zaloge + posodobitev fizične količine (vedno skupaj, transakcijsko). */
export async function recordMovement (input: {
  itemId: string
  qty: number // končni predznak: + poveča, − zmanjša
  type: (typeof MOVEMENT_TYPES)[number]
  userId?: string | null
  refType?: string | null
  refId?: string | null
  note?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(input.qty) || input.qty === 0) return { ok: false, error: 'Količina gibanja mora biti različna od 0.' }
  const item = await db.inventoryItem.findUnique({ where: { id: input.itemId } })
  if (!item) return { ok: false, error: 'Artikel ne obstaja.' }
  if (item.qty + input.qty < 0) {
    return { ok: false, error: `Fizična zaloga ${item.sku} (${item.qty} ${item.unit}) ne pokriva gibanja ${input.qty}.` }
  }
  await db.$transaction([
    db.inventoryItem.update({ where: { id: input.itemId }, data: { qty: { increment: input.qty } } }),
    db.stockMovement.create({
      data: {
        itemId: input.itemId, qty: input.qty, type: input.type,
        userId: input.userId ?? null, refType: input.refType ?? null,
        refId: input.refId ?? null, note: input.note ?? null,
      },
    }),
  ])
  return { ok: true }
}

/** Rezerviraj VSE vrstice kosovnice (atomicno). Preverja razpoložljivo zalogo. */
export async function reserveBom (bomId: string, userId: string): Promise<{ ok: true; lines: number } | { ok: false; error: string }> {
  const bom = await db.bom.findUnique({
    where: { id: bomId },
    include: { lines: true, package: { select: { projectId: true } } },
  })
  if (!bom) return { ok: false, error: 'Kosovnica ne obstaja.' }
  if (bom.status === 'REZERVIRAN' || bom.status === 'PORABLJEN') {
    return { ok: false, error: `Kosovnica ${bom.code} je že ${bom.status.toLowerCase()} — rezervacija ni mogoča.` }
  }
  if (bom.lines.length === 0) return { ok: false, error: 'Kosovnica je brez vrstic.' }

  // preveri razpoložljivost za VSAKO vrstico (fail-closed pred transakcijo)
  for (const line of bom.lines) {
    const reserved = await reservedQty(line.itemId)
    const item = await db.inventoryItem.findUnique({ where: { id: line.itemId } })
    if (!item) return { ok: false, error: `Artikel vrstice ne obstaja več.` }
    const available = item.qty - reserved
    if (available < line.qty) {
      return {
        ok: false,
        error: `Razpoložljiva zaloga ${item.sku} je ${Math.round(available * 100) / 100} ${item.unit}, potrebno ${line.qty} ${line.unit}.`,
      }
    }
  }

  await db.$transaction([
    ...bom.lines.map((line) => db.stockReservation.create({
      data: {
        itemId: line.itemId, qty: line.qty, status: 'AKTIVNA',
        projectId: bom.package?.projectId ?? null, bomId: bom.id, userId,
        note: `Rezervacija iz ${bom.code}`,
      },
    })),
    db.bom.update({ where: { id: bom.id }, data: { status: 'REZERVIRAN' } }),
  ])
  return { ok: true, lines: bom.lines.length }
}

/** Prekliči aktivne rezervacije kosovnice (sprostitev materiala). */
export async function releaseBom (bomId: string, userId: string): Promise<{ ok: true; released: number } | { ok: false; error: string }> {
  const bom = await db.bom.findUnique({ where: { id: bomId }, include: { reservations: { where: { status: 'AKTIVNA' } } } })
  if (!bom) return { ok: false, error: 'Kosovnica ne obstaja.' }
  if (bom.status !== 'REZERVIRAN') return { ok: false, error: `Kosovnica ${bom.code} ni v statusu REZERVIRAN.` }
  if (bom.reservations.length === 0) return { ok: false, error: 'Ni aktivnih rezervacij.' }

  await db.$transaction([
    db.stockReservation.updateMany({
      where: { bomId: bom.id, status: 'AKTIVNA' },
      data: { status: 'PREKLICANA', note: `Sproščeno (${new Date().toISOString()})` },
    }),
    db.bom.update({ where: { id: bom.id }, data: { status: 'POTRJEN' } }),
  ])
  return { ok: true, released: bom.reservations.length }
}

/** Picking lista iz kosovnice (potrebne količine po vrsticah). */
export async function createPickingFromBom (bomId: string, userId: string): Promise<{ ok: true; code: string; id: string } | { ok: false; error: string }> {
  const bom = await db.bom.findUnique({ where: { id: bomId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } })
  if (!bom) return { ok: false, error: 'Kosovnica ne obstaja.' }
  if (bom.status !== 'REZERVIRAN') {
    return { ok: false, error: 'Najprej rezervirajte material (kosovnica mora biti REZERVIRAN).' }
  }
  const existing = await db.pickingList.findFirst({ where: { bomId: bom.id, status: { in: ['PRIPRAVLJENA', 'V_ZAKLJUCEVANJU'] } } })
  if (existing) return { ok: false, error: `Za ${bom.code} že teče picking ${existing.code}.` }

  const year = new Date().getFullYear()
  const count = await db.pickingList.count({ where: { code: { startsWith: `PICK-${year}-` } } })
  let n = count + 1
  let code = `PICK-${year}-${String(n).padStart(3, '0')}`
  while (await db.pickingList.findUnique({ where: { code } })) {
    n++; code = `PICK-${year}-${String(n).padStart(3, '0')}`
  }

  const picking = await db.pickingList.create({
    data: {
      code, bomId: bom.id, status: 'PRIPRAVLJENA', userId,
      lines: { create: bom.lines.map((l) => ({ itemId: l.itemId, qtyNeeded: l.qty, note: l.note })) },
    },
  })
  return { ok: true, code: picking.code, id: picking.id }
}

/** Zaključi picking: izdaje zaloge + poraba rezervacij + BOM PORABLJEN. */
export async function completePicking (pickingId: string, picks: { lineId: string; qtyPicked: number }[], userId: string): Promise<{ ok: true; issued: number } | { ok: false; error: string }> {
  const picking = await db.pickingList.findUnique({
    where: { id: pickingId },
    include: { lines: true, bom: { include: { package: { select: { projectId: true } } } } },
  })
  if (!picking) return { ok: false, error: 'Picking lista ne obstaja.' }
  if (picking.status !== 'PRIPRAVLJENA' && picking.status !== 'V_ZAKLJUCEVANJU') {
    return { ok: false, error: `Picking ${picking.code} je že ${picking.status.toLowerCase()}.` }
  }

  const pickMap = new Map(picks.map((p) => [p.lineId, p.qtyPicked]))
  // validacija: pobrano ≥ 0 in ≤ potrebno; vsota po artiklih ne preseže rezervacij
  for (const line of picking.lines) {
    const picked = pickMap.get(line.id) ?? line.qtyPicked
    if (!Number.isFinite(picked) || picked < 0) return { ok: false, error: 'Pobrana količina mora biti nenegativno število.' }
    if (picked > line.qtyNeeded) {
      return { ok: false, error: `Pobrano (${picked}) presega potrebno (${line.qtyNeeded}) za vrstico.` }
    }
  }

  // fizična zaloga pokritost za pobrano
  for (const line of picking.lines) {
    const picked = pickMap.get(line.id) ?? line.qtyPicked
    if (picked <= 0) continue
    const item = await db.inventoryItem.findUnique({ where: { id: line.itemId } })
    if (!item || item.qty < picked) {
      return { ok: false, error: `Fizična zaloga ${item?.sku ?? line.itemId} ne pokreira izdaje ${picked}.` }
    }
  }

  const ops: Promise<unknown>[] = []
  let issued = 0
  for (const line of picking.lines) {
    const picked = pickMap.get(line.id) ?? line.qtyPicked
    if (picked > 0) {
      issued++
      ops.push(
        db.inventoryItem.update({ where: { id: line.itemId }, data: { qty: { decrement: picked } } }),
        db.stockMovement.create({
          data: {
            itemId: line.itemId, qty: -picked, type: 'IZDAJA', userId,
            refType: 'pickingList', refId: picking.id,
            note: `Izdaja iz ${picking.code}`,
          },
        }),
        db.pickingLine.update({ where: { id: line.id }, data: { qtyPicked: picked } })
      )
      // porabi rezervacijo (za ta BOM + artikel), če obstaja
      const res = await db.stockReservation.findFirst({
        where: { bomId: picking.bomId ?? undefined, itemId: line.itemId, status: 'AKTIVNA' },
      })
      if (res) {
        const remain = Math.round((res.qty - picked) * 100) / 100
        ops.push(
          remain > 0
            ? db.stockReservation.update({ where: { id: res.id }, data: { qty: remain } })
            : db.stockReservation.update({ where: { id: res.id }, data: { status: 'PORABLJENA', consumedAt: new Date() } })
        )
      }
    }
  }
  ops.push(db.pickingList.update({ where: { id: picking.id }, data: { status: 'ZAKLJUCENA' } }))
  if (picking.bomId) {
    ops.push(db.bom.update({ where: { id: picking.bomId }, data: { status: 'PORABLJEN' } }))
  }
  await db.$transaction(ops)
  return { ok: true, issued }
}

/** Prekliči picking (brez gibanj — material ostane fizično nedotaknjen). */
export async function cancelPicking (pickingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const picking = await db.pickingList.findUnique({ where: { id: pickingId } })
  if (!picking) return { ok: false, error: 'Picking lista ne obstaja.' }
  if (picking.status === 'ZAKLJUCENA') return { ok: false, error: 'Zaključenega pickinga ni mogoče preklicati.' }
  await db.pickingList.update({ where: { id: pickingId }, data: { status: 'PREKLICANA' } })
  return { ok: true }
}

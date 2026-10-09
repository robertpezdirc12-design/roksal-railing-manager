// stock-core — R443 (issue #7 §7, P1 INVENTORY CORE) · R464 (issue #1 §4: ZAŠČITA STOCK/RESERVATION TOKOV)
// Jedro skladiščnega toka. VEČNO LOČENO:
//   FIZIČNA ZALOGA (InventoryItem.qty) ≠ REZERVIRANA (Σ aktivnih rezervacij)
//   ≠ RAZPOLOŽLJIVA (fizična − rezervirana).
// Vse spremembe zaloge gredo skozi StockMovement dnevnik (nemutabilen).
// Transakcije so atomicne — rezervacija bodisi uspe za VSE vrstice, bodisi nič.
//
// R464 — zaščita pred sočasnimi zahtevami (prej: preverjanje ZUNAJ transakcije,
// mutacija POTEM → dva requesta sta lahko oba videla isto razpoložljivo stanje):
//   1. VSA preverjanja + mutacije tečejo v ENI interaktivni transakciji (runStockTx).
//      Poslovne napake prekinejo transakcijo (rollback) in se vrnejo kot { ok: false }.
//   2. Invariante varujejo ATOMARNE POGOJNE posodobitve — updateMany z WHERE, ki
//      izraža invarianto, + preverjen affected count (vzorec, ki deluje na sqlite
//      IN postgresql):
//        izdaja/popravek: WHERE qty >= količina → fizična zaloga NIKOLI negativna;
//        statusni prehodi: WHERE status ∈ {dovoljena izhodišča} → natanko en
//                          zaključek rezervacije/pickinga/sprostitve.
//   3. Vrstična ključavnica brez SELECT … FOR UPDATE (na sqlite ne obstaja):
//      no-op atomarna posodobitev (qty + 0) zaklene artikel v OBEH providerjih;
//      na PostgreSQL (READ COMMITTED) se WHERE po zaklepu ponovno ovrednoti
//      proti sveže potrjeni vrstici, zato je kasnejše branje znotraj transakcije
//      vedno sveže.
//   4. Zaklepi VEDNO v istem vrstnem redu — artikli sortirano po id, hierarhija
//      picking → kosovnica → artikel → rezervacija → brez deadlockov.
//   5. Procesna ključavnica (withStockLock) serializera inventory tokove znotraj
//      enega strežniškega procesa (odpravi viharje SQLITE_BUSY na razvojnem
//      providerju); na PostgreSQL je neškodljiva — za več instanc poskrbita
//      točki 2 in 3.
//   6. P2034 (write conflict/deadlock), P1008/P2024 (timeout) in SQLITE_BUSY
//      sprožijo avtomatsko ponovitev CELE transakcije.

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'

export const MOVEMENT_TYPES = ['PREVZEM', 'IZDAJA', 'VRACILO', 'INVENTURA'] as const
export const RESERVATION_STATUSES = ['AKTIVNA', 'PORABLJENA', 'PREKLICANA'] as const
export const PICKING_STATUSES = ['PRIPRAVLJENA', 'V_ZAKLJUCEVANJU', 'ZAKLJUCENA', 'PREKLICANA'] as const

type Tx = Prisma.TransactionClient

/** Interni signal: transakcija se takoj ROLLA BACK, klicatelj pa dobi `value`. */
class TxAbort<T> { constructor (readonly value: T) {} }

/** Prekini transakcijo (rollback) in vrni podan rezultat. */
function abort<T> (value: T): never { throw new TxAbort<T>(value) }

const RETRYABLE_TX_CODES = new Set(['P1008', 'P2024', 'P2028', 'P2034'])

function isRetryableTxError (err: unknown): boolean {
  const code = (err as { code?: string })?.code
  if (typeof code === 'string' && RETRYABLE_TX_CODES.has(code)) return true
  return /database is locked|SQLITE_BUSY/i.test(String((err as Error)?.message ?? ''))
}

// ── procesna ključavnica inventory tokov (promise-chain, FIFO) ──────────────
// Serializera vse inventory mutacije znotraj procesa: na sqlite odpravi
// sočasne BEGIN IMMEDIATE spore (SQLITE_BUSY → 5 s timeouti), na postgresql
// pa zmanjša verjetnost deadlockov. Neškodljiva za prepustnost (tx so kratke).
let stockLockTail: Promise<unknown> = Promise.resolve()

function withStockLock<T> (fn: () => Promise<T>): Promise<T> {
  const run = stockLockTail.then(fn, fn)
  stockLockTail = run.catch(() => undefined)
  return run
}

/**
 * Interaktivna transakcija pod procesno ključavnico + ponovitev ob ponovljivih
 * napakah (P2034/P1008/P2024/P2028/SQLITE_BUSY). Poslovne prekinitve (abort)
 * vrnejo svojo vrednost, transakcija pa se povrne (rollback).
 */
export async function runStockTx<T> (fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withStockLock(async () => {
    let lastErr: unknown
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        return await db.$transaction(fn, { timeout: 10_000, maxWait: 5_000 })
      } catch (err) {
        if (err instanceof TxAbort) return err.value as T
        lastErr = err
        if (!isRetryableTxError(err) || attempt === 5) break
        await new Promise((r) => setTimeout(r, 15 * attempt + Math.random() * 20))
      }
    }
    throw lastErr
  })
}

// ── bralni pomočniki ────────────────────────────────────────────────────────

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

// ── mutacije (vse pod runStockTx) ──────────────────────────────────────────

/** En gibanji zaloge + posodobitev fizične količine (vedno skupaj, transakcijsko).
 * Atomarna pogojna posodobitev: pri izdaji WHERE qty >= −qty zagotovi, da
 * fizična zaloga NIKOLI ne pade pod nič — tudi ob sočasnih klicih. */
export async function recordMovement (input: {
  itemId: string
  qty: number // končni predznak: + poveča, − zmanjša
  type: (typeof MOVEMENT_TYPES)[number]
  userId?: string | null
  refType?: string | null
  refId?: string | null
  note?: string | null
  /** R464: revizija gibanja — zapiše se V isti transakciji (izvedbeno-atomarna). */
  audit?: {
    action: string
    entity: string
    entityId?: string | null
    projectId?: string | null
    detail?: Record<string, unknown> | null
  }
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(input.qty) || input.qty === 0) return { ok: false, error: 'Količina gibanja mora biti različna od 0.' }
  const item = await db.inventoryItem.findUnique({ where: { id: input.itemId } })
  if (!item) return { ok: false, error: 'Artikel ne obstaja.' }
  return runStockTx(async (tx) => {
    // atomarna pogojna posodobitev (vrstična ključavnica + invarianta v enem koraku)
    const upd = input.qty < 0
      ? await tx.inventoryItem.updateMany({
          where: { id: input.itemId, qty: { gte: -input.qty } },
          data: { qty: { increment: input.qty } },
        })
      : await tx.inventoryItem.updateMany({
          where: { id: input.itemId },
          data: { qty: { increment: input.qty } },
        })
    if (upd.count !== 1) {
      const cur = await tx.inventoryItem.findUnique({ where: { id: input.itemId } })
      if (!cur) return { ok: false, error: 'Artikel ne obstaja več.' }
      return { ok: false, error: `Fizična zaloga ${cur.sku} (${cur.qty} ${cur.unit}) ne pokriva gibanja ${input.qty}.` }
    }
    await tx.stockMovement.create({
      data: {
        itemId: input.itemId, qty: input.qty, type: input.type,
        userId: input.userId ?? null, refType: input.refType ?? null,
        refId: input.refId ?? null, note: input.note ?? null,
      },
    })
    if (input.audit) {
      await writeAudit({ userId: input.userId, ...input.audit }, tx)
    }
    return { ok: true }
  })
}

/** Rezerviraj VSE vrstice kosovnice (atomicno). Preverjanje razpoložljivosti
 * teče ZNOTRAJ transakcije, za atomarno zahtevanim statusom in zaklepi
 * artiklov — dva sočasna klica ne moreta oba videti istega prostega stanja. */
export async function reserveBom (bomId: string, userId: string): Promise<{ ok: true; lines: number } | { ok: false; error: string }> {
  return runStockTx(async (tx) => {
    const bom = await tx.bom.findUnique({
      where: { id: bomId },
      include: { lines: true, package: { select: { projectId: true } } },
    })
    if (!bom) abort({ ok: false, error: 'Kosovnica ne obstaja.' })
    if (bom.status === 'REZERVIRAN' || bom.status === 'PORABLJEN') {
      abort({ ok: false, error: `Kosovnica ${bom.code} je že ${bom.status.toLowerCase()} — rezervacija ni mogoča.` })
    }
    if (bom.lines.length === 0) abort({ ok: false, error: 'Kosovnica je brez vrstic.' })

    // 1) ATOMARNA ZAHTEVA statusa (claim): OSNUTEK|POTRJEN → REZERVIRAN.
    //    Dva sočasna rezervacijska klica iste kosovnice ne moreta oba uspeti;
    //    hkrati vrstica dobi ključavnico, ki serializera vse njene tokove.
    const claim = await tx.bom.updateMany({
      where: { id: bom.id, status: { in: ['OSNUTEK', 'POTRJEN'] } },
      data: { status: 'REZERVIRAN' },
    })
    if (claim.count !== 1) {
      abort({ ok: false, error: `Kosovnica ${bom.code} je že rezervirana ali porabljena — rezervacija ni mogoča.` })
    }

    // 2) zaklep VSEH artiklov vrstic (no-op atomarna posodobitev = vrstična
    //    ključavnica; sortirano po id → dosleden vrstni red = brez deadlockov)
    const itemIds = [...new Set(bom.lines.map((l) => l.itemId))].sort()
    for (const itemId of itemIds) {
      const lock = await tx.inventoryItem.updateMany({ where: { id: itemId }, data: { qty: { increment: 0 } } })
      if (lock.count !== 1) abort({ ok: false, error: 'Artikel vrstice ne obstaja več.' })
    }

    // 3) preveri razpoložljivost ZA ZAKLEPENIMI vrsticami (sočasna
    //    rezervacija istega artikla iz druge transakcije tu že vidimo)
    for (const line of bom.lines) {
      const [agg, item] = await Promise.all([
        tx.stockReservation.aggregate({ where: { itemId: line.itemId, status: 'AKTIVNA' }, _sum: { qty: true } }),
        tx.inventoryItem.findUnique({ where: { id: line.itemId } }),
      ])
      if (!item) abort({ ok: false, error: 'Artikel vrstice ne obstaja več.' })
      const available = Math.round((item.qty - (agg._sum.qty ?? 0)) * 100) / 100
      if (available < line.qty) {
        abort({
          ok: false,
          error: `Razpoložljiva zaloga ${item.sku} je ${available} ${item.unit}, potrebno ${line.qty} ${line.unit}.`,
        })
      }
    }

    // 4) rezervacije — commit je enoten za VSE vrstice (status je že zahtevan v 1)
    for (const line of bom.lines) {
      await tx.stockReservation.create({
        data: {
          itemId: line.itemId, qty: line.qty, status: 'AKTIVNA',
          projectId: bom.package?.projectId ?? null, bomId: bom.id, userId,
          note: `Rezervacija iz ${bom.code}`,
        },
      })
    }
    // R464: revizija V transakciji (atomarna z rezervacijo; prej je bila
    // zapis po transakciji z ločenim odjemalcem → SQLITE_BUSY/P1008 pod neurjem)
    await writeAudit({
      userId, action: 'BOM_RESERVE', entity: 'bom', entityId: bom.id,
      projectId: bom.package?.projectId ?? null,
      detail: { code: bom.code, lines: bom.lines.length },
    }, tx)
    return { ok: true, lines: bom.lines.length }
  })
}

/** Prekliči aktivne rezervacije kosovnice (sprostitev materiala).
 * Atomarni claim REZERVIRAN → POTRJEN: natanko ena sprostitev tudi ob
 * sočasnih klicih (drugi dobijo 409). */
export async function releaseBom (bomId: string, userId: string): Promise<{ ok: true; released: number } | { ok: false; error: string }> {
  return runStockTx(async (tx) => {
    const bom = await tx.bom.findUnique({
      where: { id: bomId },
      include: { package: { select: { projectId: true } } },
    })
    if (!bom) abort({ ok: false, error: 'Kosovnica ne obstaja.' })
    // atomarna pogojna posodobitev statusa — sočasna sprostitev/rezervacija/
    // zaključek pickinga ne morejo vsidrati v isto kosovnico
    const claim = await tx.bom.updateMany({
      where: { id: bom.id, status: 'REZERVIRAN' },
      data: { status: 'POTRJEN' },
    })
    if (claim.count !== 1) abort({ ok: false, error: `Kosovnica ${bom.code} ni v statusu REZERVIRAN.` })
    const rel = await tx.stockReservation.updateMany({
      where: { bomId: bom.id, status: 'AKTIVNA' },
      data: { status: 'PREKLICANA', note: `Sproščeno (${new Date().toISOString()})` },
    })
    if (rel.count === 0) abort({ ok: false, error: 'Ni aktivnih rezervacij.' })
    await writeAudit({
      userId, action: 'BOM_RELEASE', entity: 'bom', entityId: bom.id,
      projectId: bom.package?.projectId ?? null,
      detail: { code: bom.code, released: rel.count },
    }, tx)
    return { ok: true, released: rel.count }
  })
}

/** Picking lista iz kosovnice (potrebne količine po vrsticah).
 * Zaklep kosovnice (no-op status write) prepreči podvojen picking tudi
 * ob sočasnem ustvarjanju; koda se ob trku (P2002) poskusi z naslednjo. */
export async function createPickingFromBom (bomId: string, userId: string): Promise<{ ok: true; code: string; id: string } | { ok: false; error: string }> {
  return runStockTx(async (tx) => {
    const bom = await tx.bom.findUnique({ where: { id: bomId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } })
    if (!bom) abort({ ok: false, error: 'Kosovnica ne obstaja.' })
    if (bom.status !== 'REZERVIRAN') {
      abort({ ok: false, error: 'Najprej rezervirajte material (kosovnica mora biti REZERVIRAN).' })
    }
    // zaklep kosovnice (atomarna statusna posodobitev = vrstična ključavnica)
    // — serializera sočasno ustvarjanje picking list in zaključke pickinga
    const lock = await tx.bom.updateMany({
      where: { id: bom.id, status: 'REZERVIRAN' },
      data: { status: 'REZERVIRAN' },
    })
    if (lock.count !== 1) abort({ ok: false, error: 'Najprej rezervirajte material (kosovnica mora biti REZERVIRAN).' })
    const existing = await tx.pickingList.findFirst({ where: { bomId: bom.id, status: { in: ['PRIPRAVLJENA', 'V_ZAKLJUCEVANJU'] } } })
    if (existing) abort({ ok: false, error: `Za ${bom.code} že teče picking ${existing.code}.` })

    const year = new Date().getFullYear()
    let n = (await tx.pickingList.count({ where: { code: { startsWith: `PICK-${year}-` } } })) + 1
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = `PICK-${year}-${String(n).padStart(3, '0')}`
      try {
        const picking = await tx.pickingList.create({
          data: {
            code, bomId: bom.id, status: 'PRIPRAVLJENA', userId,
            lines: {
              create: bom.lines.map((l, i) => ({
                itemId: l.itemId, qtyNeeded: l.qty, sortOrder: i, note: l.note,
              })),
            },
          },
        })
        await writeAudit({
          userId, action: 'PICKING_CREATE', entity: 'pickingList', entityId: picking.id,
          detail: { code: picking.code, bomId: bom.id },
        }, tx)
        return { ok: true, code: picking.code, id: picking.id }
      } catch (err) {
        // P2002: sočasno zgenerirana enaka koda (druga kosovnica) → naslednja
        if ((err as { code?: string })?.code === 'P2002') { n++; continue }
        throw err
      }
    }
    abort({ ok: false, error: 'Zaporedna koda picking liste ni na voljo.' })
  })
}

/** Zaključi picking: izdaje zaloge + poraba rezervacij + BOM PORABLJEN.
 * Atomarna zahteva statusa pickinga prepreči dvojni zaključek; izdaja poteka
 * kot pogojna posodobitev WHERE qty >= Σ pobrano po artiklu → fizična zaloga
 * NIKOLI negativna, tudi ko zaloga ne pokriva vseh sočasnih izdaj. */
export async function completePicking (pickingId: string, picks: { lineId: string; qtyPicked: number }[], userId: string): Promise<{ ok: true; issued: number } | { ok: false; error: string }> {
  return runStockTx(async (tx) => {
    const picking = await tx.pickingList.findUnique({
      where: { id: pickingId },
      include: { lines: true, bom: { include: { package: { select: { projectId: true } } } } },
    })
    if (!picking) abort({ ok: false, error: 'Picking lista ne obstaja.' })
    if (picking.status !== 'PRIPRAVLJENA' && picking.status !== 'V_ZAKLJUCEVANJU') {
      abort({ ok: false, error: `Picking ${picking.code} je že zaključen ali preklican.` })
    }

    const pickMap = new Map(picks.map((p) => [p.lineId, p.qtyPicked]))
    // validacija: pobrano ≥ 0 in ≤ potrebno (čisto, pred vsakim zapisom)
    for (const line of picking.lines) {
      const picked = pickMap.get(line.id) ?? line.qtyPicked
      if (!Number.isFinite(picked) || picked < 0) abort({ ok: false, error: 'Pobrana količina mora biti nenegativno število.' })
      if (picked > line.qtyNeeded) {
        abort({ ok: false, error: `Pobrano (${picked}) presega potrebno (${line.qtyNeeded}) za vrstico.` })
      }
    }

    // 1) ATOMARNA ZAHTEVA statusa pickinga: PRIPRAVLJENA|V_ZAKLJUCEVANJU →
    //    ZAKLJUCENA. Sočasen zaključek/preklic iste liste dobi count 0 → 409.
    const claim = await tx.pickingList.updateMany({
      where: { id: picking.id, status: { in: ['PRIPRAVLJENA', 'V_ZAKLJUCEVANJU'] } },
      data: { status: 'ZAKLJUCENA' },
    })
    if (claim.count !== 1) abort({ ok: false, error: `Picking ${picking.code} je že zaključen ali preklican.` })

    // 2) BOM → PORABLJEN (pred zaklepi artiklov: enoten vrstni red zaklepov)
    if (picking.bomId) {
      await tx.bom.update({ where: { id: picking.bomId }, data: { status: 'PORABLJEN' } })
    }

    // 3) ATOMARNA pogojna izdaja po artiklih: WHERE qty >= Σ pobrano →
    //    fizična zaloga NIKOLI negativna; nezadostna zaloga = rollback celote
    const pickedByItem = new Map<string, number>()
    for (const line of picking.lines) {
      const picked = pickMap.get(line.id) ?? line.qtyPicked
      if (picked > 0) {
        pickedByItem.set(line.itemId, Math.round(((pickedByItem.get(line.itemId) ?? 0) + picked) * 1000) / 1000)
      }
    }
    for (const [itemId, total] of [...pickedByItem.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const dec = await tx.inventoryItem.updateMany({
        where: { id: itemId, qty: { gte: total } },
        data: { qty: { decrement: total } },
      })
      if (dec.count !== 1) {
        const item = await tx.inventoryItem.findUnique({ where: { id: itemId } })
        abort({ ok: false, error: `Fizična zaloga ${item?.sku ?? itemId} (${item?.qty ?? 0}) ne pokriva izdaje ${total}.` })
      }
    }

    // 4) dnevnik izdaj + zapis pobranih količin + poraba rezervacij (ista transakcija)
    let issued = 0
    for (const line of picking.lines) {
      const picked = pickMap.get(line.id) ?? line.qtyPicked
      if (picked > 0) {
        issued++
        await tx.stockMovement.create({
          data: {
            itemId: line.itemId, qty: -picked, type: 'IZDAJA', userId,
            refType: 'pickingList', refId: picking.id,
            note: `Izdaja iz ${picking.code}`,
          },
        })
        await tx.pickingLine.update({ where: { id: line.id }, data: { qtyPicked: picked } })
        // porabi rezervacijo (za ta BOM + artikel), če obstaja
        const res = await tx.stockReservation.findFirst({
          where: { bomId: picking.bomId ?? undefined, itemId: line.itemId, status: 'AKTIVNA' },
        })
        if (res) {
          const remain = Math.round((res.qty - picked) * 100) / 100
          await (remain > 0
            ? tx.stockReservation.update({ where: { id: res.id }, data: { qty: remain } })
            : tx.stockReservation.update({ where: { id: res.id }, data: { status: 'PORABLJENA', consumedAt: new Date() } }))
        }
      }
    }
    await writeAudit({
      userId, action: 'PICKING_COMPLETE', entity: 'pickingList', entityId: picking.id,
      projectId: picking.bom?.package?.projectId ?? null,
      detail: { code: picking.code, issued, bom: picking.bom?.code ?? null },
    }, tx)
    return { ok: true, issued }
  })
}

/** Prekliči picking (brez gibanj — material ostane fizično nedotaknjen).
 * Pogojna posodobitev statusa: zaključene/preklicane liste ni mogoče preklicati
 * niti ob teku sočasnega zaključka. */
export async function cancelPicking (pickingId: string, userId?: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  return runStockTx(async (tx) => {
    const picking = await tx.pickingList.findUnique({ where: { id: pickingId } })
    if (!picking) abort({ ok: false, error: 'Picking lista ne obstaja.' })
    const upd = await tx.pickingList.updateMany({
      where: { id: pickingId, status: { in: ['PRIPRAVLJENA', 'V_ZAKLJUCEVANJU'] } },
      data: { status: 'PREKLICANA' },
    })
    if (upd.count !== 1) abort({ ok: false, error: 'Zaključenega pickinga ni mogoče preklicati.' })
    await writeAudit({
      userId: userId ?? null, action: 'PICKING_CANCEL', entity: 'pickingList', entityId: pickingId,
      detail: {},
    }, tx)
    return { ok: true }
  })
}

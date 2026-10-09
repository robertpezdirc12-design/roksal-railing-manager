// API /api/material-orders — R437 (route-map izvirnik: material-orders + history)
// GET   seznam naročil s pozicijami (inventory.read) — ?status= ?history=1 (poslana/prejeta/prekinjena)
// POST  ustvari naročilo { supplierId?, note?, lines: [{ itemId?, itemName, qty, unit?, unitPrice? }] }
//       (inventory.write) ali spremeni status { id, status } — PREJETO zahteva procurement.receive
//       in ustvari losa v zalogi (povezava nabava → zaloga) → reviziji MATERIAL_ORDER_CREATE / MATERIAL_ORDER_STATUS.
//       R450 (issue #9): PREJETO odgovor nosi lotsCreated + linesSkipped (imena vrstic BREZ itemId,
//       za katere lot ni bil ustvarjen) + linesSkippedCount; ustvarjanje z vrsticami brez itemId
//       vrne opozorilo (warning) — obstoječi odgovori ostajajo nespremenjeni (samo aditivno).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const STATUSES = ['PRIPRAVA', 'POSLANO', 'PREJETO', 'PREKINJENO']

/** R450 (issue #9): slovenska mnočina za opozorila (1 pozicija je / 2 poziciji sta / 3-4 pozicije so / 5+ pozicij je). */
function brezArtiklaFraza (n: number, imena: string[], kontekst: 'prejeto' | 'ustvarjanje'): string {
  const stevnik = n === 1 ? 'pozicija je brez' : n === 2 ? 'poziciji sta brez' : n <= 4 ? 'pozicije so brez' : 'pozicij je brez'
  if (kontekst === 'ustvarjanje') {
    return `${n} ${stevnik} povezave na artikel (${imena.join(', ')}) — ob prejemu ne bodo vnesene v zalogo.`
  }
  return `${n} ${stevnik} povezave na artikel — lot v zalogi NI bil ustvarjen za: ${imena.join(', ')}.`
}

async function nextCode (): Promise<string> {
  const year = new Date().getFullYear()
  // R464: trajni števec v Setting (vrstična ključavnica FOR UPDATE) — koda
  // dokumenta se NIKOLI ne reciklira, tudi če se naročilo izbriše (revizija
  // se nanaša na enolično kodo; prej: count/max-based → ponovna uporaba po
  // brisanju je povzročila trke v revizijski sledi).
  const key = `materialOrderSeq.${year}`
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "value" FROM "Setting" WHERE "key" = ${key} FOR UPDATE`
    let setting = await tx.setting.findUnique({ where: { key } })
    if (!setting) {
      // prvi zagon števca: upoštej VSE kode kdajkoli izdane — obstoječa
      // naročila + revizijsko sled (izbrisana naročila imajo immutabilen zapis)
      const orders = await tx.materialOrder.findMany({
        where: { code: { startsWith: `NAR-${year}-` } },
        select: { code: true },
        take: 500,
      })
      const audit = await tx.auditLog.findMany({
        where: { action: 'MATERIAL_ORDER_CREATE' },
        select: { detail: true },
        take: 500,
        orderBy: { createdAt: 'desc' },
      })
      let maxSeq = 0
      for (const c of [...orders.map(o => o.code), ...audit.map(a => {
        try { return (JSON.parse(a.detail ?? '{}') as { code?: string }).code ?? '' } catch { return '' }
      })]) {
        const n = Number(String(c).split('-')[2])
        if (Number.isFinite(n) && n > maxSeq) maxSeq = n
      }
      setting = await tx.setting.create({ data: { key, value: String(maxSeq) } })
    }
    const seq = Number(setting.value) + 1
    if (!Number.isFinite(seq) || seq < 1) throw new Error('Neveljavna vrednost števca naročil.')
    await tx.setting.update({ where: { key }, data: { value: String(seq) } })
    return `NAR-${year}-${String(seq).padStart(3, '0')}`
  })
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const history = url.searchParams.get('history') === '1'

  const orders = await db.materialOrder.findMany({
    where: status
      ? { status }
      : history
        ? { status: { in: ['POSLANO', 'PREJETO', 'PREKINJENO'] } }
        : {},
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const [suppliers, users] = await Promise.all([
    db.supplier.findMany({ select: { id: true, name: true } }),
    db.user.findMany({ select: { id: true, name: true } }),
  ])
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]))
  const userName = new Map(users.map((u) => [u.id, u.name]))

  const data = orders.map((o) => ({
    id: o.id,
    code: o.code,
    status: o.status,
    note: o.note,
    supplierId: o.supplierId,
    supplierName: o.supplierId ? supplierName.get(o.supplierId) ?? null : null,
    createdByName: o.createdBy ? userName.get(o.createdBy) ?? null : null,
    total: o.lines.reduce((sum, l) => sum + l.qty * l.unitPrice.toNumber(), 0),
    linesCount: o.lines.length,
    lines: o.lines,
    createdAt: o.createdAt,
    sentAt: o.sentAt,
    receivedAt: o.receivedAt,
  }))
  return NextResponse.json({ data })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)

  // ── varianta 2: sprememba statusa obstoječega naročila ─────────────────────
  if (typeof body?.id === 'string' && body.id) {
    const status = typeof body.status === 'string' ? body.status : ''
    if (!STATUSES.includes(status)) {
      return jsonError(400, 'Neveljaven status.', `Dovoljeni: ${STATUSES.join(', ')}.`)
    }
    // prejem blaga je ločena pravica (katalog 38: procurement.receive)
    if (status === 'PREJETO') {
      const perm = await requirePermission(req, 'procurement.receive')
      if (perm instanceof NextResponse) return perm
    }
    const order = await db.materialOrder.findUnique({ where: { id: body.id }, include: { lines: true } })
    if (!order) return jsonError(404, 'Naročilo ne obstaja.')
    if (order.status === 'PREJETO' || order.status === 'PREKINJENO') {
      return jsonError(409, `Naročilo je že v končnem statusu ${order.status}.`)
    }
    if (status === 'POSLANO' && order.status !== 'PRIPRAVA') {
      return jsonError(409, 'Poslati je mogoče samo naročilo v pripravi.')
    }

    // PREJETO: ustvari losa v zalogi za pozicije s povezanim artikelom (nabava → zaloga)
    // R450 (issue #9): vrstice BREZ itemId se izpišejo v odgovoru (prej tiho preskočene)
    let lotsCreated = 0
    const linesSkipped: string[] = []
    if (status === 'PREJETO') {
      for (const line of order.lines) {
        if (!line.itemId) {
          linesSkipped.push(line.itemName)
          continue
        }
        await db.stockLot.create({
          data: {
            itemId: line.itemId,
            qty: line.qty,
            unitCost: line.unitPrice,
            supplierId: order.supplierId,
          },
        })
        lotsCreated++
      }
    }

    const updated = await db.materialOrder.update({
      where: { id: order.id },
      data: {
        status,
        sentAt: status === 'POSLANO' ? new Date() : order.sentAt,
        receivedAt: status === 'PREJETO' ? new Date() : order.receivedAt,
      },
    })
    await writeAudit({
      userId: auth.user.id,
      action: 'MATERIAL_ORDER_STATUS',
      entity: 'materialOrder',
      entityId: order.id,
      detail: { code: order.code, from: order.status, to: status, lotsCreated, linesSkipped: linesSkipped.length, linesSkippedNames: linesSkipped },
    })
    return NextResponse.json({
      data: updated,
      lotsCreated,
      linesSkipped,
      linesSkippedCount: linesSkipped.length,
      ...(linesSkipped.length > 0
        ? { warning: brezArtiklaFraza(linesSkipped.length, linesSkipped, 'prejeto') }
        : {}),
    })
  }

  // ── varianta 1: novo naročilo s pozicijami ────────────────────────────────
  const supplierId = typeof body?.supplierId === 'string' && body.supplierId ? body.supplierId : null
  const note = typeof body?.note === 'string' ? body.note : null
  const lines = Array.isArray(body?.lines) ? body.lines : []

  if (lines.length === 0) return jsonError(400, 'Naročilo potrebuje vsaj eno pozicijo.')
  if (lines.length > 100) return jsonError(400, 'Preveč pozicij (max 100).')

  const validated: { itemId: string | null; itemName: string; qty: number; unit: string; unitPrice: number }[] = []
  for (const l of lines) {
    const itemName = typeof l?.itemName === 'string' && l.itemName.trim() ? l.itemName.trim() : ''
    const qty = Number(l?.qty)
    const unit = typeof l?.unit === 'string' && l.unit ? l.unit : 'm'
    const unitPrice = Number(l?.unitPrice ?? 0)
    if (!itemName) return jsonError(400, 'Vsaka pozicija potrebuje ime artikla.')
    if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, `Količina za "${itemName}" mora biti večja od 0.`)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return jsonError(400, `Cena za "${itemName}" ni veljavna.`)
    validated.push({
      itemId: typeof l?.itemId === 'string' && l.itemId ? l.itemId : null,
      itemName,
      qty,
      unit,
      unitPrice,
    })
  }

  if (supplierId) {
    const sup = await db.supplier.findUnique({ where: { id: supplierId } })
    if (!sup) return jsonError(404, 'Dobavitelj ne obstaja.')
  }
  // preveri povezane article
  for (const v of validated) {
    if (v.itemId) {
      const item = await db.inventoryItem.findUnique({ where: { id: v.itemId } })
      if (!item) return jsonError(404, `Artikel "${v.itemName}" (id) ne obstaja.`)
    }
  }

  const order = await db.materialOrder.create({
    data: {
      code: await nextCode(),
      supplierId,
      note,
      createdBy: auth.user.id,
      lines: { create: validated },
    },
    include: { lines: true },
  })
  await writeAudit({
    userId: auth.user.id,
    action: 'MATERIAL_ORDER_CREATE',
    entity: 'materialOrder',
    entityId: order.id,
    detail: { code: order.code, supplierId, positions: validated.length, brezArtikla: validated.filter((v) => !v.itemId).map((v) => v.itemName) },
  })
  // R450 (issue #9): proaktivno opozorilo ob ustvarjanju — vrstice brez povezave na
  // artikel ob PREJETO ne bodo vnesene v zalogo (aditivno polje, ne zavrnemo)
  const noItem = validated.filter((v) => !v.itemId).map((v) => v.itemName)
  return NextResponse.json({
    data: order,
    ...(noItem.length > 0
      ? { warning: brezArtiklaFraza(noItem.length, noItem, 'ustvarjanje') }
      : {}),
  }, { status: 201 })
}

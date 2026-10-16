// /api/deliveries/[id] — podrobnost + PREHODI dostave (R445, issue #7 §9).
// GET   (projects.read) — podrobnost (isti obseg kot seznam: monter = voznik ALI nalog njegov).
// PATCH (akcije, vsaka s svojimi vrati; vsak prehod preverja izvorni status → sicer 409):
//   plan    {vehicleId?, driverId?, plannedAt?, address?} (pisarna) — dopolni načrt v NACRTOVANO/PRIPRAVLJENO
//   prepare (pisarna)   NACRTOVANO → PRIPRAVLJENO (material pripravljen — picking zaključen)
//   load    (pisarna ALI voznik) PRIPRAVLJENO → NATOVARJENO; zahteva dodeljeno vozilo (sicer 409); loadedAt
//   depart  (pisarna ALI voznik) NATOVARJENO → NA_POTI; departedAt
//   deliver {recipientNote?} (pisarna ALI voznik) NA_POTI → DOSTAVLJENO; deliveredAt
//   cancel  {note?} (pisarna) NACRTOVANO/PRIPRAVLJENO/NATOVARJENO → PREKLICANA
// Revizije: DELIVERY_PLAN / DELIVERY_STATUS {from, to}.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { DELIVERY_FLOW_DESC, DELIVERY_INCLUDE, deliveryInScope } from '@/lib/delivery-core'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const delivery = await db.delivery.findUnique({ where: { id }, include: DELIVERY_INCLUDE })
  if (!delivery) return jsonError(404, 'Dostava ne obstaja.')
  if (!readsAllData(user) && !deliveryInScope(delivery, user.id)) {
    return jsonError(403, 'Dostava ni v vašem obsegu.', 'Monter vidi samo dostave, kjer je voznik ali ki so vezane na njegove naloge.')
  }
  return NextResponse.json({ data: delivery })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  // osnovna vrata: projects.read (vse vloge); pravice po akciji se preverjajo spodaj
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // pisarna = uporabnik, ki vidi vse podatke IN ima projects.write (ADMIN/VODJA);
  // monter ima sicer projects.write (terenski projekti), a logistike ne vodi — fail-closed
  const office = readsAllData(user) && auth.perms.includes('projects.write')

  const { id } = await params
  const delivery = await db.delivery.findUnique({
    where: { id },
    include: { workOrder: { select: { assigneeId: true } } },
  })
  if (!delivery) return jsonError(404, 'Dostava ne obstaja.')

  // obseg: uporabnik z omejenim branjem (monter) dela SAMO na svojih dostavah
  if (!readsAllData(user) && !deliveryInScope(delivery, user.id)) {
    return jsonError(403, 'Dostava ni v vašem obsegu.', 'Monter vidi samo dostave, kjer je voznik ali ki so vezane na njegove naloge.')
  }

  const body = await req.json().catch(() => null)
  const action = typeof body?.action === 'string' ? body.action : ''
  const isDriver = delivery.driverId === user.id
  const wrongStatus = (need: string) =>
    jsonError(409, `Dostava ${delivery.code} je v statusu ${delivery.status}; akcija '${action}' zahteva ${need}.`, `Dovoljen tok: ${DELIVERY_FLOW_DESC}.`)

  // ── PLAN: dopolnitev načrta (samo pisarna) ─────────────────────────────────
  if (action === 'plan') {
    if (!office) return jsonError(403, 'Načrtovanje dostav ureja pisarna.')
    if (delivery.status !== 'NACRTOVANO' && delivery.status !== 'PRIPRAVLJENO') {
      return wrongStatus('NACRTOVANO ali PRIPRAVLJENO')
    }
    const patch: Record<string, unknown> = {}
    if (body?.vehicleId !== undefined) {
      if (body.vehicleId === null || body.vehicleId === '') patch.vehicleId = null
      else {
        const vehicle = await db.vehicle.findUnique({ where: { id: String(body.vehicleId) } })
        if (!vehicle) return jsonError(404, 'Vozilo ne obstaja.')
        if (!vehicle.active) return jsonError(409, `Vozilo ${vehicle.plate} ni aktivno.`)
        patch.vehicleId = vehicle.id
      }
    }
    if (body?.driverId !== undefined) {
      if (body.driverId === null || body.driverId === '') patch.driverId = null
      else {
        const driver = await db.user.findUnique({ where: { id: String(body.driverId) }, select: { id: true, active: true } })
        if (!driver || !driver.active) return jsonError(404, 'Voznik ne obstaja ali ni aktiven.')
        patch.driverId = driver.id
      }
    }
    if (body?.plannedAt !== undefined) {
      if (body.plannedAt === null || body.plannedAt === '') patch.plannedAt = null
      else {
        const t = new Date(String(body.plannedAt))
        if (Number.isNaN(t.getTime())) return jsonError(400, 'Neveljaven načrtovani čas dostave.')
        patch.plannedAt = t
      }
    }
    if (body?.address !== undefined) {
      patch.address = typeof body.address === 'string' && body.address.trim() ? body.address.trim().slice(0, 300) : null
    }
    if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo (vehicleId | driverId | plannedAt | address).')

    // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
    const updated = await db.$transaction(async (tx) => {
      const updated = await tx.delivery.update({ where: { id }, data: patch, include: DELIVERY_INCLUDE })
      await writeAudit({
        userId: user.id, action: 'DELIVERY_PLAN', entity: 'delivery', entityId: id, projectId: delivery.projectId,
        detail: { code: delivery.code, polja: Object.keys(patch) },
      }, tx)
      return updated
    })
    return NextResponse.json({ data: updated })
  }

  // ── PREPARE: NACRTOVANO → PRIPRAVLJENO (samo pisarna) ──────────────────────
  if (action === 'prepare') {
    if (!office) return jsonError(403, 'Pripravo dostav ureja pisarna.')
    if (delivery.status !== 'NACRTOVANO') return wrongStatus('NACRTOVANO')
    // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
    const updated = await db.$transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id }, data: { status: 'PRIPRAVLJENO' }, include: DELIVERY_INCLUDE,
      })
      await writeAudit({
        userId: user.id, action: 'DELIVERY_STATUS', entity: 'delivery', entityId: id, projectId: delivery.projectId,
        detail: { code: delivery.code, from: 'NACRTOVANO', to: 'PRIPRAVLJENO' },
      }, tx)
      return updated
    })
    return NextResponse.json({ data: updated })
  }

  // ── LOAD / DEPART / DELIVER: pisarna ALI voznik dostave ────────────────────
  if (action === 'load' || action === 'depart' || action === 'deliver') {
    if (!office && !isDriver) {
      return jsonError(403, `Akcijo '${action}' lahko izvede pisarna ali voznik dostave.`, 'Voznik je dodeljen prek plana dostave.')
    }

    if (action === 'load') {
      if (delivery.status !== 'PRIPRAVLJENO') return wrongStatus('PRIPRAVLJENO')
      if (!delivery.vehicleId) {
        return jsonError(409, `Dostava ${delivery.code} nima dodeljenega vozila.`, 'Pred natovarjanjem dodelite vozilo (plan → vozilo).')
      }
      // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
      const updated = await db.$transaction(async (tx) => {
        const updated = await tx.delivery.update({
          where: { id }, data: { status: 'NATOVARJENO', loadedAt: new Date() }, include: DELIVERY_INCLUDE,
        })
        await writeAudit({
          userId: user.id, action: 'DELIVERY_STATUS', entity: 'delivery', entityId: id, projectId: delivery.projectId,
          detail: { code: delivery.code, from: 'PRIPRAVLJENO', to: 'NATOVARJENO' },
        }, tx)
        return updated
      })
      return NextResponse.json({ data: updated })
    }

    if (action === 'depart') {
      if (delivery.status !== 'NATOVARJENO') return wrongStatus('NATOVARJENO')
      // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
      const updated = await db.$transaction(async (tx) => {
        const updated = await tx.delivery.update({
          where: { id }, data: { status: 'NA_POTI', departedAt: new Date() }, include: DELIVERY_INCLUDE,
        })
        await writeAudit({
          userId: user.id, action: 'DELIVERY_STATUS', entity: 'delivery', entityId: id, projectId: delivery.projectId,
          detail: { code: delivery.code, from: 'NATOVARJENO', to: 'NA_POTI' },
        }, tx)
        return updated
      })
      return NextResponse.json({ data: updated })
    }

    // deliver
    if (delivery.status !== 'NA_POTI') return wrongStatus('NA_POTI')
    const recipientNote = typeof body?.recipientNote === 'string' && body.recipientNote.trim()
      ? body.recipientNote.trim().slice(0, 300)
      : null
    // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
    const updated = await db.$transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id },
        data: { status: 'DOSTAVLJENO', deliveredAt: new Date(), ...(recipientNote ? { recipientNote } : {}) },
        include: DELIVERY_INCLUDE,
      })
      await writeAudit({
        userId: user.id, action: 'DELIVERY_STATUS', entity: 'delivery', entityId: id, projectId: delivery.projectId,
        detail: { code: delivery.code, from: 'NA_POTI', to: 'DOSTAVLJENO', recipientNote },
      }, tx)
      return updated
    })
    return NextResponse.json({ data: updated })
  }

  // ── CANCEL: → PREKLICANA (samo pisarna, samo iz začetnih statusov) ─────────
  if (action === 'cancel') {
    if (!office) return jsonError(403, 'Preklice dostav ureja pisarna.')
    if (!['NACRTOVANO', 'PRIPRAVLJENO', 'NATOVARJENO'].includes(delivery.status)) {
      return jsonError(409, `Preklic ni mogoč iz statusa ${delivery.status} (samo NACRTOVANO, PRIPRAVLJENO ali NATOVARJENO).`)
    }
    const cancelNote = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null
    const note = cancelNote
      ? [delivery.note, `Preklic: ${cancelNote}`].filter(Boolean).join(' · ')
      : delivery.note
    // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
    const updated = await db.$transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id }, data: { status: 'PREKLICANA', note }, include: DELIVERY_INCLUDE,
      })
      await writeAudit({
        userId: user.id, action: 'DELIVERY_STATUS', entity: 'delivery', entityId: id, projectId: delivery.projectId,
        detail: { code: delivery.code, from: delivery.status, to: 'PREKLICANA', note: cancelNote },
      }, tx)
      return updated
    })
    return NextResponse.json({ data: updated })
  }

  return jsonError(400, 'Neznana akcija (plan | prepare | load | depart | deliver | cancel).')
}

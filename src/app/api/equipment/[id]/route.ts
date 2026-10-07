// API /api/equipment/[id] — podrobnost z zgodovino izposoj + akcije
// PATCH body.action:
//   checkout {note?} — samopostrežna izposoja (equipment.read), 409 če ni NA_VOLJO
//   return   {note?} — vrnitev (imetnik ALI ADMIN/VODJA)
//   service  {note?, location?} — V_SERVISU (ADMIN/VODJA; izposojeno najprej zapre izposojo)
//   broken   — POKVARJENO (ADMIN/VODJA)
//   repair   — nazaj NA_VOLJO (ADMIN/VODJA)
// Next.js 16: params je Promise.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

function isAdminOrVodja (role: string): boolean {
  return role === 'ADMIN' || role === 'VODJA'
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'equipment.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const equipment = await db.equipment.findUnique({
    where: { id },
    include: {
      holder: { select: { id: true, name: true } },
      checkouts: {
        orderBy: { outAt: 'desc' },
        include: { user: { select: { id: true, name: true, role: true } } },
      },
    },
  })
  if (!equipment) return jsonError(404, 'Orodje ne obstaja.')
  return NextResponse.json({ data: equipment })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'equipment.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const action = typeof body?.action === 'string' ? body.action : ''
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null

  const equipment = await db.equipment.findUnique({
    where: { id },
    include: {
      holder: { select: { id: true, name: true } },
      checkouts: { where: { inAt: null }, orderBy: { outAt: 'desc' } },
    },
  })
  if (!equipment) return jsonError(404, 'Orodje ne obstaja.')
  const openCheckout = equipment.checkouts[0] ?? null

  // ── izposoja (samopostrežna) ───────────────────────────────────────────────
  if (action === 'checkout') {
    if (equipment.status !== 'NA_VOLJO') {
      return jsonError(409, 'Orodje ni na voljo.', `Trenutni status: ${equipment.status}.`)
    }
    const updated = await db.$transaction(async (tx) => {
      await tx.equipmentCheckout.create({
        data: { equipmentId: id, userId: user.id, outAt: new Date(), note },
      })
      return tx.equipment.update({
        where: { id },
        data: { status: 'IZPOSOJENO', holderId: user.id },
        include: {
          holder: { select: { id: true, name: true } },
          checkouts: { where: { inAt: null }, include: { user: { select: { id: true, name: true } } } },
        },
      })
    })
    await writeAudit({
      userId: user.id, action: 'EQUIP_CHECKOUT', entity: 'equipment', entityId: id,
      detail: { code: equipment.code, to: user.name, note },
    })
    return NextResponse.json({ data: updated })
  }

  // ── vrnitev ────────────────────────────────────────────────────────────────
  if (action === 'return') {
    if (equipment.status !== 'IZPOSOJENO') {
      return jsonError(409, 'Orodje ni izposojeno.', `Trenutni status: ${equipment.status}.`)
    }
    if (!isAdminOrVodja(user.role) && equipment.holderId !== user.id) {
      return jsonError(403, 'Orodje lahko vrne samo imetnik ali vodja.', `Imetnik: ${equipment.holder?.name ?? 'neznan'}.`)
    }
    if (!openCheckout) {
      return jsonError(409, 'Odprta izposoja ne obstaja.', 'Podatkovna nekonsistentnost — obvestite administratorja.')
    }
    const updated = await db.$transaction(async (tx) => {
      await tx.equipmentCheckout.update({
        where: { id: openCheckout.id },
        data: {
          inAt: new Date(),
          // opombo vrnitve pripnemo k obstoječi opombi izposoje
          note: [openCheckout.note, note ? `Vrnitev: ${note}` : null].filter(Boolean).join(' · ') || null,
        },
      })
      return tx.equipment.update({
        where: { id },
        data: { status: 'NA_VOLJO', holderId: null },
        include: {
          holder: { select: { id: true, name: true } },
          checkouts: { where: { inAt: null }, include: { user: { select: { id: true, name: true } } } },
        },
      })
    })
    await writeAudit({
      userId: user.id, action: 'EQUIP_RETURN', entity: 'equipment', entityId: id,
      detail: { code: equipment.code, by: user.name, note },
    })
    return NextResponse.json({ data: updated })
  }

  // ── administrativne akcije: samo ADMIN/VODJA ───────────────────────────────
  if (!isAdminOrVodja(user.role)) {
    return jsonError(403, 'Administrativne akcije orodjarine so rezervirane za vodjo ali administratorja.', 'Status orodja spreminjata samo vlogi ADMIN/VODJA.')
  }

  if (action === 'service') {
    if (equipment.status === 'V_SERVISU') return jsonError(409, 'Orodje je že v servisu.')
    if (equipment.status === 'POKVARJENO') {
      return jsonError(409, 'Pokvarjenega orodja ne moremo poslati v servis.', 'Najprej ga označite za popravljeno.')
    }
    const location = typeof body?.location === 'string' && body.location.trim() ? body.location.trim() : equipment.location
    const updated = await db.$transaction(async (tx) => {
      // če je izposojeno — najprej zapri odprto izposojo
      if (equipment.status === 'IZPOSOJENO' && openCheckout) {
        await tx.equipmentCheckout.update({
          where: { id: openCheckout.id },
          data: {
            inAt: new Date(),
            note: [openCheckout.note, 'Predčasna vrnitev — orodje v servis'].filter(Boolean).join(' · '),
          },
        })
      }
      return tx.equipment.update({
        where: { id },
        data: {
          status: 'V_SERVISU', holderId: null, location,
          note: [equipment.note, note ? `Servis: ${note}` : null].filter(Boolean).join(' · '),
        },
        include: {
          holder: { select: { id: true, name: true } },
          checkouts: { where: { inAt: null }, include: { user: { select: { id: true, name: true } } } },
        },
      })
    })
    await writeAudit({
      userId: user.id, action: 'EQUIP_STATUS', entity: 'equipment', entityId: id,
      detail: { code: equipment.code, from: equipment.status, to: 'V_SERVISU', location, note },
    })
    return NextResponse.json({ data: updated })
  }

  if (action === 'broken') {
    if (equipment.status === 'POKVARJENO') return jsonError(409, 'Orodje je že označeno kot pokvarjeno.')
    const updated = await db.$transaction(async (tx) => {
      if (equipment.status === 'IZPOSOJENO' && openCheckout) {
        await tx.equipmentCheckout.update({
          where: { id: openCheckout.id },
          data: {
            inAt: new Date(),
            note: [openCheckout.note, 'Predčasna vrnitev — orodje pokvarjeno'].filter(Boolean).join(' · '),
          },
        })
      }
      return tx.equipment.update({
        where: { id },
        data: {
          status: 'POKVARJENO', holderId: null,
          note: [equipment.note, note ? `Okvara: ${note}` : null].filter(Boolean).join(' · '),
        },
        include: {
          holder: { select: { id: true, name: true } },
          checkouts: { where: { inAt: null }, include: { user: { select: { id: true, name: true } } } },
        },
      })
    })
    await writeAudit({
      userId: user.id, action: 'EQUIP_STATUS', entity: 'equipment', entityId: id,
      detail: { code: equipment.code, from: equipment.status, to: 'POKVARJENO', note },
    })
    return NextResponse.json({ data: updated })
  }

  if (action === 'repair') {
    if (equipment.status !== 'POKVARJENO' && equipment.status !== 'V_SERVISU') {
      return jsonError(409, 'Orodje ni v servisu niti pokvarjeno.', `Trenutni status: ${equipment.status}.`)
    }
    const updated = await db.equipment.update({
      where: { id },
      data: {
        status: 'NA_VOLJO',
        note: [equipment.note, note ? `Popravljeno: ${note}` : 'Popravljeno'].join(' · '),
      },
      include: {
        holder: { select: { id: true, name: true } },
        checkouts: { where: { inAt: null }, include: { user: { select: { id: true, name: true } } } },
      },
    })
    await writeAudit({
      userId: user.id, action: 'EQUIP_STATUS', entity: 'equipment', entityId: id,
      detail: { code: equipment.code, from: equipment.status, to: 'NA_VOLJO', note },
    })
    return NextResponse.json({ data: updated })
  }

  return jsonError(400, 'Neznana akcija.', 'Dovoljene akcije: checkout, return, service, broken, repair.')
}

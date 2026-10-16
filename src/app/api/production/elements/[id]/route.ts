// /api/production/elements/[id] — posodobitev prefab elementa (R465 — issue #4 §3)
// PATCH (production.manage) { status?, note? }:
//   • status: SAMO naslednji korak linearnega toka NAVRTEN → REZANJE →
//     IZDELAVA → POVRSINA → DOKONCAN (enačno kot nalog proizvodnje — brez
//     preskakovanja); DOKONCAN je končno stanje
//   • note: poljubna opomba na lističu
// Vsaka sprememba → revizija (PREFAB_STATUS / PREFAB_UPDATE) + userId.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { ELEMENT_FLOW, nextElementStatus } from '@/lib/prefab-core'

type Params = { params: Promise<{ id: string }> }

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'production.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const element = await db.productionElement.findUnique({
    where: { id },
    include: { productionOrder: { select: { id: true, code: true, projectId: true } } },
  })
  if (!element) return jsonError(404, 'Proizvodni element ne obstaja.')

  const patch: { status?: string; note?: string | null } = {}

  if (body.status !== undefined) {
    const status = typeof body.status === 'string' ? body.status : ''
    if (!ELEMENT_FLOW.includes(status as (typeof ELEMENT_FLOW)[number])) {
      return jsonError(400, 'Neveljaven status elementa.', `Dovoljeno: ${ELEMENT_FLOW.join(' → ')}.`)
    }
    const next = nextElementStatus(element.status)
    if (next === null) {
      return jsonError(400, 'Element je že dokončan — nadaljnjih prehodov ni.')
    }
    if (status !== next) {
      return jsonError(400, `Prehod ${element.status} → ${status} ni dovoljen.`, `Iz trenutnega statusa je dovoljen le prehod na ${next}.`)
    }
    patch.status = status
  }

  if (body.note !== undefined) {
    patch.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null
  }

  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  // R539 (transakcijska celovitost): posodobitev elementa + revizija atomarno
  // v ENI transakciji (vzorec R537-d; predbranje `element` ostaja izven tx).
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.productionElement.update({
      where: { id },
      data: { ...patch, userId: user.id },
    })

    if (patch.status) {
      await writeAudit({
        userId: user.id,
        action: 'PREFAB_STATUS',
        entity: 'productionElement',
        entityId: id,
        projectId: element.productionOrder.projectId,
        detail: {
          order: element.productionOrder.code,
          key: element.key,
          from: element.status,
          to: patch.status,
        },
      }, tx)
    } else {
      await writeAudit({
        userId: user.id,
        action: 'PREFAB_UPDATE',
        entity: 'productionElement',
        entityId: id,
        projectId: element.productionOrder.projectId,
        detail: { order: element.productionOrder.code, key: element.key, note: patch.note },
      }, tx)
    }
    return updated
  })

  return NextResponse.json({
    data: {
      id: updated.id, key: updated.key, status: updated.status, note: updated.note,
      updatedAt: updated.updatedAt,
    },
  })
}

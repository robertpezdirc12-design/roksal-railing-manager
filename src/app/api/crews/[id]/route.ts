// /api/crews/[id] — EKIPA / PODIZVAJALEC (R445, issue #7 §9).
// GET   (projects.read)  — podrobnost ekipe z zadnjimi nalogi.
// PATCH (projects.write + pisarna) — urejanje (delno, samo podana polja). Revizija CREW_UPDATE.
//   MONTER ima sicer projects.write, a ekipe/podizvajalce vodi pisarna (fail-closed).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseCrewPatch } from '@/lib/crew-core'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const crew = await db.crew.findUnique({
    where: { id },
    include: {
      workOrders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, code: true, title: true, status: true, scheduledFor: true, project: { select: { code: true, title: true } } },
      },
    },
  })
  if (!crew) return jsonError(404, 'Ekipa ne obstaja.')
  return NextResponse.json({ data: crew })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth

  // ekipe/podizvajalce ureja PISARNICA (fail-closed — enako kot POST)
  if (!readsAllData(auth.user)) {
    return jsonError(403, 'Ekipe ureja pisarna.', 'Urejanje ekip/podizvajalcev je namenjeno pisarni, ne terenu.')
  }

  const { id } = await params

  const crew = await db.crew.findUnique({ where: { id } })
  if (!crew) return jsonError(404, 'Ekipa ne obstaja.')

  const body = await req.json().catch(() => null)
  const parsed = parseCrewPatch(body)
  if (!parsed.ok) return jsonError(400, parsed.error)

  const updated = await db.crew.update({ where: { id }, data: parsed.data })
  await writeAudit({
    userId: auth.user.id, action: 'CREW_UPDATE', entity: 'crew', entityId: id,
    detail: { name: updated.name, polja: Object.keys(parsed.data) },
  })
  return NextResponse.json({ data: updated })
}

// /api/crews/[id] — EKIPA / PODIZVAJALEC (R445, issue #7 §9).
// GET   (projects.read)  — podrobnost ekipe z zadnjimi nalogi.
// PATCH (projects.write + pisarna) — urejanje (delno, samo podana polja). Revizija CREW_UPDATE.
//   MONTER ima sicer projects.write, a ekipe/podizvajalce vodi pisarna (fail-closed).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import { parseCrewPatch } from '@/lib/crew-core'

type Params = { params: Promise<{ id: string }> }

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// samo formalizacija OBLIKE telesa (JSON objekt, polja NEZNANA → naprej) —
// delni PATCH še naprej validira skupni crew-core (parseCrewPatch, sporočila
// so vir resnice; lib je izven lastništva te naloge).
const CrewPatchSchema = z.looseObject({})

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

  const parsed = await parseBody(req, CrewPatchSchema)
  if (!parsed.ok) return parsed.response
  const crewParsed = parseCrewPatch(parsed.data)
  if (!crewParsed.ok) return jsonError(400, crewParsed.error)

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.crew.update({ where: { id }, data: crewParsed.data })
    await writeAudit({
      userId: auth.user.id, action: 'CREW_UPDATE', entity: 'crew', entityId: id,
      detail: { name: updated.name, polja: Object.keys(crewParsed.data) },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

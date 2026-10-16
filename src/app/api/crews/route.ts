// /api/crews — EKIPA / PODIZVAJALEC (R445, issue #7 §9).
// GET  (projects.read) — seznam ekip (?all=1 vključi neaktivne; ?type=INTERNA|PODIZVAJALEC).
// POST (projects.write + pisarna) — nova ekipa; revizija CREW_CREATE. Validacija: crew-core.
//   MONTER ima sicer projects.write, a ekipe/podizvajalce vodi pisarna (fail-closed).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import { parseCrewBody } from '@/lib/crew-core'

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// samo formalizacija OBLIKE telesa (JSON objekt, vsa polja NEZNANA → naprej) —
// vsebino še naprej validira skupni crew-core (parseCrewBody), katerega
// slovenska sporočila so vir resnice za POST in PATCH (lib je izven lastništva).
const CrewBodySchema = z.looseObject({})

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const includeInactive = sp.get('all') === '1'
  const type = sp.get('type')

  const rows = await db.crew.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(type ? { type } : {}),
    },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { workOrders: true } } },
  })
  return NextResponse.json({ data: rows })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth

  // ekipe/podizvajalce vodi PISARNICA (fail-closed — enako kot dostave in vozila)
  if (!readsAllData(auth.user)) {
    return jsonError(403, 'Ekipe ureja pisarna.', 'Ustvarjanje ekip/podizvajalcev je namenjeno pisarni, ne terenu.')
  }

  const parsed = await parseBody(req, CrewBodySchema)
  if (!parsed.ok) return parsed.response
  const crewParsed = parseCrewBody(parsed.data)
  if (!crewParsed.ok) return jsonError(400, crewParsed.error)

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  const crew = await db.$transaction(async (tx) => {
    const crew = await tx.crew.create({ data: crewParsed.data })
    await writeAudit({
      userId: auth.user.id, action: 'CREW_CREATE', entity: 'crew', entityId: crew.id,
      detail: { name: crew.name, type: crew.type, region: crew.region },
    }, tx)
    return crew
  })
  return NextResponse.json({ data: crew }, { status: 201 })
}

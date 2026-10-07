// /api/crews — EKIPA / PODIZVAJALEC (R445, issue #7 §9).
// GET  (projects.read) — seznam ekip (?all=1 vključi neaktivne; ?type=INTERNA|PODIZVAJALEC).
// POST (projects.write + pisarna) — nova ekipa; revizija CREW_CREATE. Validacija: crew-core.
//   MONTER ima sicer projects.write, a ekipe/podizvajalce vodi pisarna (fail-closed).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseCrewBody } from '@/lib/crew-core'

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

  const body = await req.json().catch(() => null)
  const parsed = parseCrewBody(body)
  if (!parsed.ok) return jsonError(400, parsed.error)

  const crew = await db.crew.create({ data: parsed.data })
  await writeAudit({
    userId: auth.user.id, action: 'CREW_CREATE', entity: 'crew', entityId: crew.id,
    detail: { name: crew.name, type: crew.type, region: crew.region },
  })
  return NextResponse.json({ data: crew }, { status: 201 })
}

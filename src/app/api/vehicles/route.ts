// /api/vehicles — VOZILO za dostavo (R445, issue #7 §9).
// GET  (projects.read) — seznam vozil (?all=1 vključi neaktivna).
// POST (projects.write + pisarna) — novo vozilo {plate, name, capacityNote}; plate
//   obvezna in unikatna (409). Revizija VEHICLE_CREATE.
//   MONTER ima sicer projects.write (terenski projekti), a vozila vodi pisarna —
//   enak fail-closed vzorec kot /api/deliveries POST (readsAllData).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// registrska in ime obvezna po trim; opomba kapacitete neobvezna
// (prazno ⇒ null, z rezino 300 — kot prej). Unikatnost registrske je
// poslovna zavrnitev (409) in ostaja v handlerju.
const VehicleCreateSchema = z.object({
  plate: z.string().trim().min(1, 'Registrska oznaka je obvezna.'),
  name: z.string().trim().min(1, 'Ime vozila je obvezno.'),
  capacityNote: z.string().trim().nullish().transform((v) => (v ? v.slice(0, 300) : null)),
})

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const includeInactive = new URL(req.url).searchParams.get('all') === '1'
  const rows = await db.vehicle.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ active: 'desc' }, { plate: 'asc' }],
    include: { _count: { select: { deliveries: true } } },
  })
  return NextResponse.json({ data: rows })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth

  // vozila načrtuje PISARNA: monterjev projects.write pokriva terenske projekte,
  // ne floto (fail-closed — enako kot dostave)
  if (!readsAllData(auth.user)) {
    return jsonError(403, 'Vozila ureja pisarna.', 'Ustvarjanje vozil je namenjeno pisarni, ne terenu.')
  }

  const parsed = await parseBody(req, VehicleCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data
  const { plate, name } = data

  const dup = await db.vehicle.findUnique({ where: { plate } })
  if (dup) return jsonError(409, `Vozilo s registrsko oznako ${plate} že obstaja.`, 'Registrska mora biti unikatna.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  const vehicle = await db.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.create({ data: { plate, name, capacityNote: data.capacityNote } })
    await writeAudit({
      userId: auth.user.id, action: 'VEHICLE_CREATE', entity: 'vehicle', entityId: vehicle.id,
      detail: { plate, name },
    }, tx)
    return vehicle
  })
  return NextResponse.json({ data: vehicle }, { status: 201 })
}

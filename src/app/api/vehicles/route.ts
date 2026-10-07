// /api/vehicles — VOZILO za dostavo (R445, issue #7 §9).
// GET  (projects.read) — seznam vozil (?all=1 vključi neaktivna).
// POST (projects.write + pisarna) — novo vozilo {plate, name, capacityNote}; plate
//   obvezna in unikatna (409). Revizija VEHICLE_CREATE.
//   MONTER ima sicer projects.write (terenski projekti), a vozila vodi pisarna —
//   enak fail-closed vzorec kot /api/deliveries POST (readsAllData).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

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

  const body = await req.json().catch(() => null)
  const plate = typeof body?.plate === 'string' ? body.plate.trim() : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const capacityNote = typeof body?.capacityNote === 'string' && body.capacityNote.trim()
    ? body.capacityNote.trim().slice(0, 300)
    : null

  if (!plate) return jsonError(400, 'Registrska oznaka je obvezna.')
  if (!name) return jsonError(400, 'Ime vozila je obvezno.')

  const dup = await db.vehicle.findUnique({ where: { plate } })
  if (dup) return jsonError(409, `Vozilo s registrsko oznako ${plate} že obstaja.`, 'Registrska mora biti unikatna.')

  const vehicle = await db.vehicle.create({ data: { plate, name, capacityNote } })
  await writeAudit({
    userId: auth.user.id, action: 'VEHICLE_CREATE', entity: 'vehicle', entityId: vehicle.id,
    detail: { plate, name },
  })
  return NextResponse.json({ data: vehicle }, { status: 201 })
}

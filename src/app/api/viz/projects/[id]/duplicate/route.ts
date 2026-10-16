// /api/viz/projects/[id]/duplicate — R454 (NAPREDNI 3D, route-map
// §„3D vizualizacije & AR": POST /api/viz/projects/[id]/duplicate).
// POST (measurements.write) — podvoji konfiguracijo: ime „… (kopija)",
// podeduje tip/params/projectId/note, nov avtor = klicatelj.
// → revizija VIZ_PROJECT_DUPLICATE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const existing = await db.vizProject.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Vizualizacijski projekt ne obstaja.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // podvajanje (kopija podeduje tip/params/projectId/note) + revizija
  // VIZ_PROJECT_DUPLICATE v ENI transakciji — delna kopija ne more nastati.
  const copy = await db.$transaction(async (tx) => {
    const copy = await tx.vizProject.create({
      data: {
        name: `${existing.name} (kopija)`.slice(0, 120),
        projectId: existing.projectId,
        authorId: user.id,
        tip: existing.tip,
        params: existing.params,
        note: existing.note,
      },
    })

    await writeAudit({
      userId: user.id,
      action: 'VIZ_PROJECT_DUPLICATE',
      entity: 'vizProject',
      entityId: copy.id,
      projectId: copy.projectId,
      detail: { from: existing.id, fromName: existing.name, name: copy.name },
    }, tx)
    return copy
  })

  return NextResponse.json({ data: copy }, { status: 201 })
}

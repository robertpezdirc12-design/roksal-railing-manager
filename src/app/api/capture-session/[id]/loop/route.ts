// /api/capture-session/[id]/loop — loop closure (R462 — issue #17 §5)
// POST { startCode, endCode, expectedCm, measuredCm, heightDiffCm?, note? }
//      (measurements.write) → LOOP_CLOSED / LOOP_WARNING / LOOP_FAILED.
//      FAILED: območje konflikta označeno, starih potrjenih meritev NE
//      spreminjamo, vse verzije ostanejo (§5). Revizija LOOP_CLOSURE_CREATE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { loopClosureCheck } from '@/lib/reality-r2p-engine'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { geoContext, toleranceRules } from '@/lib/reality-r2p-service'
import { TOLERANCE_RULE_KEYS, toleranceFromRules } from '@/lib/reality-r2p-engine'

export async function POST (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access
  if (access.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je zaključen.', 'Loop checkov ni mogoče dodajati zaključenemu zajemu (§22).')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const startCode = typeof body.startCode === 'string' && body.startCode.trim() ? body.startCode.trim().slice(0, 20) : null
  const endCode = typeof body.endCode === 'string' && body.endCode.trim() ? body.endCode.trim().slice(0, 20) : null
  if (!startCode || !endCode) return jsonError(400, 'Manjkata startCode/endCode.', 'Referenci na začetku in ob povratku (npr. REF-001 / GEO-001).')
  const expectedCm = typeof body.expectedCm === 'number' && Number.isFinite(body.expectedCm) && body.expectedCm >= 0 ? body.expectedCm : null
  const measuredCm = typeof body.measuredCm === 'number' && Number.isFinite(body.measuredCm) && body.measuredCm >= 0 ? body.measuredCm : null
  if (expectedCm == null || measuredCm == null) return jsonError(400, 'Manjkata expectedCm/measuredCm.', 'Prijavljena razdalja po teku + zunanje merilo ob povratku (cm).')
  let heightDiffCm: number | null = null
  if (body.heightDiffCm !== undefined && body.heightDiffCm !== null) {
    if (typeof body.heightDiffCm !== 'number' || !Number.isFinite(body.heightDiffCm)) {
      return jsonError(400, 'Neveljaven heightDiffCm.')
    }
    heightDiffCm = body.heightDiffCm
  }

  // toleranca zanke IZ pravila (§12) — sicer privzeta
  const rules = await toleranceRules()
  const tol = toleranceFromRules(rules, 'loop')

  const result = loopClosureCheck({ expectedCm, measuredCm, heightDiffCm, toleranceCm: tol.toleranceCm })

  // R539 (transakcijska celovitost): zanka + revizija LOOP_CLOSURE_CREATE v
  // ENI transakciji — zapis brez sledi ne more nastati.
  const loop = await db.$transaction(async (tx) => {
    const loop = await tx.loopClosure.create({
      data: {
        sessionId: id, startCode, endCode,
        expectedCm, measuredCm,
        heightDiffCm,
        positionDiffCm: result.positionDiffCm,
        status: result.status,
        userId: user.id,
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null,
      },
    })

    await writeAudit({
      userId: user.id,
      action: 'LOOP_CLOSURE_CREATE',
      entity: 'loopClosure',
      entityId: loop.id,
      projectId: access.session.projectId,
      detail: {
        sessionId: id, status: result.status,
        positionDiffCm: result.positionDiffCm,
        startCode, endCode,
        ...(tol.noRule ? { toleranceFrom: `privzeta (pravilo ${TOLERANCE_RULE_KEYS.loop} manjka)` } : { toleranceFrom: TOLERANCE_RULE_KEYS.loop }),
      },
    }, tx)

    return loop
  })

  const ctx = await geoContext(id)
  return NextResponse.json({
    data: {
      id: loop.id, status: result.status,
      positionDiffCm: result.positionDiffCm, heightDiffCm: result.heightDiffCm,
      reasons: result.reasons,
      toleranceCm: tol.toleranceCm,
      toleranceNoRule: tol.noRule,
      context: ctx,
    },
  }, { status: 201 })
}

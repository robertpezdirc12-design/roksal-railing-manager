// /api/fence-run/[id]/verify — VERIFIED meritev iz zunanjega merilnika
// (R460 — issue #15 §10/§9)
// POST { segmentId, measuredCm, method: LASER|MICNIK|DRUGO, device?, note? }
//      (measurements.write) → segment.status = VERIFIED, verifiedCm zapisan,
//      odstopanje od izračuna + toleranca (2 cm + 1 %) vračata; prekoračitev
//      NE popravi mere tiho (§19) — konflikt se pokaže v validaciji, dokler
//      geometrija ne uskladi ali ponovno ne preveri. Revizija FENCE_RUN_VERIFY.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { conflictToleranceCm, round1 } from '@/lib/fence-run-engine'
import { analyzeContext, loadRunContext, syncSegments } from '@/lib/fence-run-service'
import { fenceRunZaUporabnika } from '@/lib/fence-run-access'

type Params = { params: Promise<{ id: string }> }

const METHODS = ['LASER', 'MICNIK', 'DRUGO']

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope
  if (scope.run.status === 'POTRJEN') {
    return jsonError(409, 'Potrjenega tekača ni mogoče preverjati.', 'Izmera je že potrjena — za spremembo ustvarite nov tekač.')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const segmentId = typeof body.segmentId === 'string' && body.segmentId ? body.segmentId : null
  if (!segmentId) return jsonError(400, 'Manjka segmentId.')

  const measuredCm = Number(body.measuredCm)
  if (!Number.isFinite(measuredCm) || measuredCm < 5 || measuredCm > 10000) {
    return jsonError(400, 'Neveljavna izmerjena dolžina.', 'measuredCm (cm) mora biti med 5 in 10000.')
  }

  const method = String(body.method ?? '')
  if (!METHODS.includes(method)) {
    return jsonError(400, 'Neveljavna metoda preverjanja.', `Veljavne metode: ${METHODS.join(', ')}.`)
  }

  const segment = await db.fenceSegment.findUnique({ where: { id: segmentId } })
  if (!segment || segment.fenceRunId !== id) {
    return jsonError(404, 'Segment ne pripada temu tekaču.')
  }

  const deviationCm = round1(Math.abs(segment.lengthCm - measuredCm))
  const toleranceCm = round1(conflictToleranceCm(measuredCm))
  const conflict = deviationCm > toleranceCm

  // R539 (transakcijska celovitost): preveritev segmenta + ponoven izračun
  // (quality §3) + revizija v ENI transakciji — preverjen segment brez
  // revizije ni več možen. Brez zapisa verzije tekača → brez dirke P2002.
  await db.$transaction(async (tx) => {
    await tx.fenceSegment.update({
      where: { id: segmentId },
      data: {
        status: 'VERIFIED',
        verifiedCm: round1(measuredCm),
        verifyMethod: method,
        verifyNote: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null,
      },
    })

    // osveži quality + validacijo (konflikt se izrazi, če je) — na tx klientu
    const ctx = await loadRunContext(id, tx)
    if (ctx) await syncSegments(ctx, tx)

    await writeAudit({
      userId: user.id,
      action: 'FENCE_RUN_VERIFY',
      entity: 'fenceSegment',
      entityId: segmentId,
      projectId: scope.run.projectId,
      detail: {
        fenceRunId: id,
        segmentOrder: segment.order,
        method,
        ...(typeof body.device === 'string' && body.device.trim() ? { device: body.device.trim().slice(0, 80) } : {}),
        computedCm: segment.lengthCm,
        measuredCm: round1(measuredCm),
        deviationCm,
        toleranceCm,
        conflict,
      },
    }, tx)
  })

  const fresh = await loadRunContext(id)
  const analysis = fresh ? analyzeContext(fresh) : null
  return NextResponse.json({
    data: {
      segmentId,
      computedCm: segment.lengthCm,
      measuredCm: round1(measuredCm),
      deviationCm,
      toleranceCm,
      conflict,
      analysis,
    },
  })
}

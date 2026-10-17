// /api/capture-session/[id]/drift — drift vzorec + re-lokalizacija (R461 — issue #16 §3)
// POST { offsetCm, atCm? } (measurements.write) → vzorec registra se doda,
//      status se sveže izračuna (DRIFT_OK / DRIFT_WARNING / RE_LOC_REQUIRED).
//      Re-lokalizacija = nova referenca (POST /reference) — dogodek se zapiše
//      v revizijo, vzorci NISO tiho počiščeni (§3: ne popravlja tiho).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseDrift, driftStatus, type DriftSample } from '@/lib/capture-qa-engine'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { analyzeSession, loadCaptureContext } from '@/lib/capture-qa-service'
import { Prisma } from '@prisma/client'

export async function POST (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access
  if (access.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je zaključen.', 'Drift vzorcev ni mogoče dodajati zaključenemu zajemu.')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  if (typeof body.offsetCm !== 'number' || !Number.isFinite(body.offsetCm) || Math.abs(body.offsetCm) > 1000) {
    return jsonError(400, 'Neveljaven offsetCm.', 'Odmik registra (cm, −1000..1000).')
  }
  let atCm: number | undefined
  if (body.atCm !== undefined && body.atCm !== null) {
    if (typeof body.atCm !== 'number' || !Number.isFinite(body.atCm) || body.atCm < 0) {
      return jsonError(400, 'Neveljaven atCm.', 'Položaj vzorca ob teku (cm, ≥ 0).')
    }
    atCm = body.atCm
  }

  const ctx = await loadCaptureContext(id)
  if (!ctx) return jsonError(404, 'Zajem ne obstaja.')

  // vzorci iz posnetkov + ročni vzorci ostanejo; nov vzorec se doda (max 200)
  // R542: drift je jsonb objekt — parseDrift neposredno (slaba oblika → privzeto)
  const existing = parseDrift(access.session.drift) ?? { samples: [], status: 'DRIFT_OK' as const, lastRefCode: null }
  const photoSamples: DriftSample[] = ctx.photos
    .filter((p) => p.offsetCm != null)
    .map((p) => ({ offsetCm: p.offsetCm as number, ts: p.capturedAt.toISOString() }))
  const manual = existing.samples.filter((m) => !photoSamples.some((s) => s.ts === m.ts && s.offsetCm === m.offsetCm))
  const sample: DriftSample = { offsetCm: body.offsetCm, ts: new Date().toISOString(), ...(atCm != null ? { atCm } : {}) }
  const all = [...photoSamples, ...manual, sample].slice(-200)
  const status = driftStatus(all)

  // R539 (transakcijska celovitost): drift vzorec + revizija CAPTURE_DRIFT v
  // ENI transakciji; sveža analiza ostane PO commitu (piše prek globalnega db).
  await db.$transaction(async (tx) => {
    await tx.captureSession.update({
      where: { id },
      data: {
        // R542: jsonb — objekt direktno (ne JSON.stringify)
        drift: { samples: all, status: status.state, lastRefCode: existing.lastRefCode } as unknown as Prisma.InputJsonValue,
      },
    })

    await writeAudit({
      userId: user.id,
      action: 'CAPTURE_DRIFT',
      entity: 'captureSession',
      entityId: id,
      projectId: access.session.projectId,
      detail: { offsetCm: body.offsetCm, state: status.state, maxAbsCm: status.maxAbsCm },
    }, tx)
  })

  const fresh = await loadCaptureContext(id)
  const analysis = fresh ? await analyzeSession(fresh) : null
  return NextResponse.json({ data: { state: status.state, maxAbsCm: status.maxAbsCm, reasons: status.reasons, analysis } }, { status: 201 })
}

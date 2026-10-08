// /api/capture-session/[id]/finish — zaključek zajema z VRATI (R461 — issue #16 §1/§7/§9/§26)
// POST { obstojeco? } (measurements.write) → vsa vrata morajo pasti:
//   1. pokritost: vse kritične cone ustrezno zajete (§1)
//   2. vodena ruta: obvezni koraki opravljeni (KALIBRACIJA/COVERAGE, §2)
//   3. reference: ≥ 1 aktivna, 0 konfliktov, dodatna ref ob slabih pogojih (§4/§16)
//   4. drift: ne RE_LOC_REQUIRED (§3)
// Uspeh → ZAKLJUCEN + AS-MEASURED digital twin snapshot v1+ (§9) + reviziji.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { analyzeSession, finishCaptureSession, loadCaptureContext } from '@/lib/capture-qa-service'

export async function POST (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => ({}))
  const obstojeco = body && typeof body === 'object' && typeof (body as { obstojeco?: unknown }).obstojeco === 'string'
    ? (body as { obstojeco: string }).obstojeco.trim().slice(0, 500) || null
    : null

  const ctx = await loadCaptureContext(id)
  if (!ctx) return jsonError(404, 'Zajem ne obstaja.')

  if (ctx.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je že zaključen.', `Snapshot: ${ctx.session.snapshotId ?? '—'}`)
  }

  const result = await finishCaptureSession(ctx, user.id, obstojeco)
  if (!result.ok) {
    return jsonError(409, 'Zajem ne more biti zaključen — manjkajoči pogoji.', (result.reasons ?? []).join(' '))
  }

  // kritična vrata mer se vrnejo v odgovoru (ZA PONUDBO/KONFIGURACIJO/PROIZVODNJO, §7)
  const fresh = await loadCaptureContext(id)
  const analysis = fresh ? await analyzeSession(fresh) : null

  await writeAudit({
    userId: user.id,
    action: 'CAPTURE_FINISH',
    entity: 'captureSession',
    entityId: id,
    projectId: access.session.projectId,
    detail: {
      name: access.session.name,
      snapshotId: result.snapshotId,
      version: result.version,
      ...(analysis?.criticalGate ? { gate: analysis.criticalGate } : {}),
    },
  })
  await writeAudit({
    userId: user.id,
    action: 'TWIN_SNAPSHOT_CREATE',
    entity: 'digitalTwinSnapshot',
    entityId: result.snapshotId as string,
    projectId: access.session.projectId,
    detail: { kind: 'AS_MEASURED', version: result.version, reason: 'Zaključek zajema' },
  })

  return NextResponse.json({
    data: {
      snapshotId: result.snapshotId,
      version: result.version,
      criticalGate: analysis?.criticalGate ?? null,
    },
  }, { status: 201 })
}

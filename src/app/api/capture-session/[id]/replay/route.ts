// /api/capture-session/[id]/replay — CAPTURE REPLAY (R465 — issue #4 §2)
// GET (measurements.read) — predvajanje zajema PO KORAKIH za revizijo in
// izobraževanje. READ-ONLY: ničesar ne spreminja (niti recomputeSession!) —
// pokritost/drift se izračunata KUMULATIVNO po vsakem posnetku iz že
// shranjenih podatkov (ista pravila kot v živo: computeCoverage/driftStatus).
// Korak = posnetek v časovnem vrstnem redu:
//   photo { id, zone, zoneLabel, kind, quality, offsetCm, thumb, capturedAt }
//   coverageAfter { zones[], gateOk, criticalMissing } — stanje PO tem posnetku
//   driftAfter { state, maxAbsCm, lastAbsCm, sampleCount } — vzorci do tedaj
// Referenčne točke so poseben dogodek (createdAt) — vrnjene v meta delu,
// ker pokritosti ne spreminjajo.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { loadCaptureContext } from '@/lib/capture-qa-service'
import { computeCoverage, driftStatus, parseQuality } from '@/lib/capture-qa-engine'
import type { DriftSample, PhotoQuality } from '@/lib/capture-qa-engine'

// R542: quality je jsonb objekt — parseQuality (validator) neposredno.
function safeParseQuality (raw: unknown): PhotoQuality {
  return parseQuality(raw) ?? {}
}

export async function GET (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access

  const ctx = await loadCaptureContext(id)
  if (!ctx) return jsonError(404, 'Zajem ne obstaja.')

  const project = await db.project.findUnique({
    where: { id: ctx.session.projectId },
    select: { code: true, title: true },
  })

  // ── koraki: posnetek po posnetku (ctx.photos so že po capturedAt ASC) ──
  const steps: unknown[] = []
  const samples: DriftSample[] = []
  const photoInputs = ctx.photos.map((p) => ({ zone: p.zone, quality: safeParseQuality(p.quality) }))
  for (let i = 0; i < ctx.photos.length; i++) {
    const p = ctx.photos[i]
    if (p.offsetCm != null) {
      samples.push({ offsetCm: p.offsetCm, ts: p.capturedAt.toISOString() })
    }
    const cov = computeCoverage(ctx.plan, photoInputs.slice(0, i + 1))
    const drift = driftStatus(samples)
    const stop = ctx.plan.find((s) => s.id === p.zone) ?? null
    steps.push({
      n: i + 1,
      photo: {
        id: p.id,
        zone: p.zone,
        zoneLabel: stop?.label ?? p.zone,
        zoneKind: stop?.kind ?? null,
        critical: stop?.critical ?? false,
        quality: safeParseQuality(p.quality),
        offsetCm: p.offsetCm,
        thumb: p.thumb,
        capturedAt: p.capturedAt,
      },
      coverageAfter: {
        zones: cov.zones.map((z) => ({
          stopId: z.stopId, label: z.label, critical: z.critical,
          state: z.state, photoCount: z.photoCount, goodCount: z.goodCount,
        })),
        gateOk: cov.gateOk,
        criticalMissing: cov.criticalMissing,
      },
      driftAfter: {
        state: drift.state,
        maxAbsCm: drift.maxAbsCm,
        lastAbsCm: drift.lastAbsCm,
        sampleCount: samples.length,
      },
    })
  }

  // ── končno (avtoritativno) stanje iz shranjenega zajema (R542: jsonb) ──
  const finalCoverage: unknown = ctx.session.coverage ?? null
  const finalDrift: unknown = ctx.session.drift ?? null

  const totalCm = ctx.run && ctx.run.segments.length > 0
    ? ctx.run.segments[ctx.run.segments.length - 1].toAtCm
    : null

  return NextResponse.json({
    data: {
      session: {
        id: ctx.session.id, name: ctx.session.name, status: ctx.session.status,
        mode: ctx.session.mode, note: ctx.session.note,
        authorId: ctx.session.authorId,
        snapshotId: ctx.session.snapshotId,
      },
      project,
      device: ctx.device,
      outdoor: ctx.outdoor,
      run: ctx.run
        ? { id: ctx.run.id, name: ctx.run.name, status: ctx.run.status, segments: ctx.run.segments.length, totalCm }
        : null,
      plan: ctx.plan.map((s) => ({ id: s.id, kind: s.kind, label: s.label, atCm: s.atCm ?? null, critical: s.critical })),
      refs: ctx.refs.map((r) => ({
        code: r.code, label: r.label, atCm: r.atCm, measureCm: r.measureCm,
        method: r.method, status: r.status, note: r.note, createdAt: r.createdAt,
      })),
      steps,
      final: { coverage: finalCoverage, drift: finalDrift },
    },
  })
}

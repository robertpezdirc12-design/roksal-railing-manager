// /api/capture-session/[id] — podrobnost/RESUME + posodobitev + brisanje (R461)
// GET    (measurements.read) — polno stanje za nadaljevanje (§17 offline+resume):
//        plan, coverage, drift, reference, vrata, tekač povzetek.
// PATCH  (measurements.write) — zunanji pogoji, opravljeni postanki, PREKINJEN/
//        V_TEKU (prekinitev in nadaljevanje), opomba. ZAKLJUCEN samo prek /finish.
// DELETE (measurements.write) — samo V_TEKU/PREKINJEN (zaključeni imajo snapshot).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseOutdoor, parseState, OUTDOOR_CONDITIONS } from '@/lib/capture-qa-engine'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { analyzeSession, loadCaptureContext } from '@/lib/capture-qa-service'

export async function GET (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access

  const ctx = await loadCaptureContext(id)
  if (!ctx) return jsonError(404, 'Zajem ne obstaja.')
  const analysis = await analyzeSession(ctx)

  return NextResponse.json({
    data: {
      id: ctx.session.id,
      name: ctx.session.name,
      status: ctx.session.status,
      mode: ctx.session.mode,
      projectId: ctx.session.projectId,
      fenceRunId: ctx.session.fenceRunId,
      snapshotId: ctx.session.snapshotId,
      note: ctx.session.note,
      device: ctx.device,
      outdoor: ctx.outdoor,
      state: ctx.state,
      run: ctx.run ? {
        id: ctx.run.id, name: ctx.run.name, status: ctx.run.status,
        measurementId: ctx.run.measurementId,
        segments: ctx.run.segments.map((s) => ({
          order: s.order, lengthCm: s.lengthCm, heightCm: s.heightCm,
          slopeDeg: s.slopeDeg, status: s.status, hasGate: s.hasGate,
        })),
      } : null,
      references: ctx.refs.map((r) => ({
        id: r.id, code: r.code, label: r.label, atCm: r.atCm, measureCm: r.measureCm,
        method: r.method, device: r.device, status: r.status, confidence: r.confidence,
        note: r.note, createdAt: r.createdAt,
      })),
      photos: ctx.photos.map((p) => ({
        id: p.id, clientKey: p.clientKey, zone: p.zone, quality: p.quality ? JSON.parse(p.quality) : null,
        offsetCm: p.offsetCm, capturedAt: p.capturedAt,
      })),
      analysis,
    },
  })
}

export async function PATCH (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access
  if (access.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je zaključen.', 'Zaključen zajem je nespremenljiv (§22 — brez tihega prepisovanja).')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const ctx = await loadCaptureContext(id)
  if (!ctx) return jsonError(404, 'Zajem ne obstaja.')

  const data: Record<string, unknown> = {}

  // zunanji pogoji (§16)
  if (body.outdoor !== undefined) {
    const outdoor = parseOutdoor(body.outdoor)
    if (!outdoor) {
      return jsonError(400, 'Neveljavni zunanji pogoji.', `outdoor: { conditions: [${OUTDOOR_CONDITIONS.map((c) => c.id).join(' | ')}], note? }`)
    }
    data.outdoor = JSON.stringify(outdoor)
  }

  // opravljeni postanki + trenutni korak (§2/§17 — vodena ruta, resume)
  if (body.doneStops !== undefined || body.currentStopId !== undefined) {
    const merged = parseState({
      currentStopId: body.currentStopId !== undefined
        ? (typeof body.currentStopId === 'string' && body.currentStopId ? body.currentStopId : null)
        : ctx.state.currentStopId,
      doneStops: Array.isArray(body.doneStops)
        ? body.doneStops.filter((s): s is string => typeof s === 'string')
        : ctx.state.doneStops,
    })
    if (!merged) return jsonError(400, 'Neveljavno stanje.', 'state: { currentStopId?, doneStops: string[] }')
    const planIds = new Set(ctx.plan.map((p) => p.id))
    for (const stopId of merged.doneStops) {
      if (!planIds.has(stopId)) return jsonError(400, `Neznan postanek »${stopId}«.`)
    }
    if (merged.currentStopId && !planIds.has(merged.currentStopId)) {
      return jsonError(400, `Neznan trenutni postanek »${merged.currentStopId}«.`)
    }
    data.state = JSON.stringify(merged)
  }

  // status: PREKINJEN (prekinitev zajema) / V_TEKU (nadaljevanje)
  if (body.status !== undefined) {
    if (body.status === 'PREKINJEN' || body.status === 'V_TEKU') {
      data.status = body.status
    } else {
      return jsonError(400, 'Neveljaven status.', 'Dovoljena: PREKINJEN | V_TEKU (ZAKLJUCEN samo prek /finish).')
    }
  }

  if (typeof body.note === 'string') data.note = body.note.trim().slice(0, 500) || null

  if (Object.keys(data).length === 0) return jsonError(400, 'Nič za posodobiti.')

  // R539 (transakcijska celovitost): posodobitev + revizija CAPTURE_UPDATE v
  // ENI transakciji; sveža analiza (pisanje pokritosti/drifta prek globalnega
  // db) ostane PO commitu — potrebuje viden posodobljeni zajem.
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.captureSession.update({ where: { id }, data: data as never })
    await writeAudit({
      userId: user.id,
      action: 'CAPTURE_UPDATE',
      entity: 'captureSession',
      entityId: id,
      projectId: access.session.projectId,
      detail: {
        polja: Object.keys(data).join(', '),
        ...(typeof data.status === 'string' ? { status: data.status } : {}),
      },
    }, tx)
    return updated
  })

  const fresh = await loadCaptureContext(id)
  const analysis = fresh ? await analyzeSession(fresh) : null
  return NextResponse.json({ data: { id: updated.id, status: updated.status, analysis } })
}

export async function DELETE (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access
  if (access.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zaključenega zajema ni mogoče izbrisati.', 'Zajem ima AS-MEASURED snapshot (§22 — zgodovina ostane).')
  }

  // R539 (transakcijska celovitost): brisanje + revizija CAPTURE_DELETE v
  // ENI transakciji — zajem ne izgine brez sledi.
  await db.$transaction(async (tx) => {
    await tx.captureSession.delete({ where: { id } })
    await writeAudit({
      userId: user.id,
      action: 'CAPTURE_DELETE',
      entity: 'captureSession',
      entityId: id,
      projectId: access.session.projectId,
      detail: { name: access.session.name },
    }, tx)
  })
  return NextResponse.json({ data: { ok: true } })
}

// /api/capture-session/[id]/reference — referenčna mreža (R461 — issue #16 §4/§6)
// GET   seznam referenc z verigo + konflikti (measurements.read)
// POST  nova referenca: { atCm, measureCm, method, label?, device?, note? }
//       (measurements.write) → koda REF-00n samodejno, veriga se preveri,
//       konflikt je IZRECEN (status KONFLIKT — ne tiho rešen).
// PATCH reševanje konflikta: { referenceId, action: 'ZAVRCI' | 'AKTIVIRAJ', reason }
//       (measurements.write) — ZAVRCI zahteva razlog (§18 sled spremembe).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { REF_METHODS, referenceNetwork } from '@/lib/capture-qa-engine'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { analyzeSession, loadCaptureContext, syncReferenceStatuses } from '@/lib/capture-qa-service'

export async function GET (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access

  const ctx = await loadCaptureContext(id)
  if (!ctx) return jsonError(404, 'Zajem ne obstaja.')

  const net = await syncReferenceStatuses(id)
  return NextResponse.json({
    data: {
      references: ctx.refs.map((r) => ({
        id: r.id, code: r.code, label: r.label, atCm: r.atCm, measureCm: r.measureCm,
        method: r.method, device: r.device, status: r.status, confidence: r.confidence,
        note: r.note, createdAt: r.createdAt,
      })),
      network: net,
    },
  })
}

export async function POST (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access
  if (access.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je zaključen.', 'Referenc ni mogoče dodajati zaključenemu zajemu.')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const atCm = typeof body.atCm === 'number' && Number.isFinite(body.atCm) && body.atCm >= 0 && body.atCm <= 100000 ? body.atCm : null
  if (atCm == null) return jsonError(400, 'Neveljaven atCm.', 'Položaj reference ob teku (cm, 0..100000).')
  const measureCm = typeof body.measureCm === 'number' && Number.isFinite(body.measureCm) && body.measureCm > 0 && body.measureCm <= 100000 ? body.measureCm : null
  if (measureCm == null) return jsonError(400, 'Neveljaven measureCm.', 'Zunanje izmerjena razdalja od prejšnje reference (cm, > 0).')

  const method = typeof body.method === 'string' ? body.method : ''
  const m = REF_METHODS.find((x) => x.id === method)
  if (!m) return jsonError(400, 'Neveljavna metoda.', `method: ${REF_METHODS.map((x) => x.id).join(' | ')}`)

  // koda REF-00n (zaporedna po številu referenc zajema)
  const count = await db.captureReference.count({ where: { sessionId: id } })
  const code = `REF-${String(count + 1).padStart(3, '0')}`

  const ref = await db.captureReference.create({
    data: {
      sessionId: id, code,
      label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : null,
      atCm, measureCm, method,
      device: typeof body.device === 'string' && body.device.trim() ? body.device.trim().slice(0, 120) : null,
      operatorId: user.id,
      confidence: m.confidence,
      note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null,
    },
  })

  // veriga se preveri; konflikti se OZNAČIJO (ne rešijo tiho)
  const net = await syncReferenceStatuses(id)
  const fresh = await loadCaptureContext(id)
  const analysis = fresh ? await analyzeSession(fresh) : null

  // označi referenco, ki je v konfliktu (sveže stanje po sync)
  const savedRef = await db.captureReference.findUnique({ where: { id: ref.id } })

  await writeAudit({
    userId: user.id,
    action: 'REFERENCE_CREATE',
    entity: 'captureReference',
    entityId: ref.id,
    projectId: access.session.projectId,
    detail: {
      sessionId: id, code, atCm, measureCm, method,
      confidence: m.confidence,
      ...(savedRef?.status === 'KONFLIKT' ? { konflikt: true } : {}),
    },
  })

  return NextResponse.json({
    data: {
      id: ref.id, code, status: savedRef?.status ?? 'AKTIVNA',
      network: net, analysis,
    },
  }, { status: 201 })
}

export async function PATCH (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access
  if (access.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je zaključen.', 'Referenc ni mogoče spreminjati zaključenemu zajemu.')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const referenceId = typeof body.referenceId === 'string' && body.referenceId ? body.referenceId : null
  if (!referenceId) return jsonError(400, 'Manjka referenceId.')
  const ref = await db.captureReference.findUnique({ where: { id: referenceId } })
  if (!ref || ref.sessionId !== id) return jsonError(404, 'Referenca ne obstaja (v tem zajemu).')

  const action = body.action
  if (action !== 'ZAVRCI' && action !== 'AKTIVIRAJ') {
    return jsonError(400, 'Neveljavna akcija.', 'action: ZAVRCI | AKTIVIRAJ')
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : null
  if (action === 'ZAVRCI' && !reason) {
    return jsonError(400, 'Zavrnitev reference zahteva razlog.', '§18: sprememba kritične meritve potrebuje zapis razloga.')
  }

  await db.captureReference.update({
    where: { id: referenceId },
    data: {
      status: action === 'ZAVRCI' ? 'ZAVRACENA' : 'AKTIVNA',
      note: reason ?? ref.note,
    },
  })
  const net = await syncReferenceStatuses(id)
  const fresh = await loadCaptureContext(id)
  const analysis = fresh ? await analyzeSession(fresh) : null

  await writeAudit({
    userId: user.id,
    action: action === 'ZAVRCI' ? 'REFERENCE_REJECT' : 'REFERENCE_ACTIVATE',
    entity: 'captureReference',
    entityId: referenceId,
    projectId: access.session.projectId,
    detail: { sessionId: id, code: ref.code, ...(reason ? { reason } : {}) },
  })

  return NextResponse.json({ data: { id: referenceId, status: action === 'ZAVRCI' ? 'ZAVRACENA' : 'AKTIVNA', network: net, analysis } })
}

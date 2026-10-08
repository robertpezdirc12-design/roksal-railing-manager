// /api/sync — R439 (GitLab issue #6): MOBILNI TEREN & OFFLINE.
// Zanesljivo delo monterja brez signala + samodejna IDEMPOTENTNA sinhronizacija.
//
// POST { deviceId, ops: [{ opId (uuid — generira ODJEMALEC), kind, payload, clientTs }] }
//   → { data: { results: [{ opId, status: 'OK'|'CONFLICT'|'ERROR', data?, error? }], synced, conflicts } }
//
// Načela:
//  • IDEMPOTENCA: SyncOp zadetek po opId — ponovno pošiljanje istega opa vrne
//    shranjen rezultat (status OK) BREZ ponovitve operacije (podvajanje nemogoče);
//  • vsak op je NEODVISEN — napaka/conflict enega ne ustavi ostalih;
//  • OBSEG (fail-closed): monter (ne readsAllData) izvaja operacije SAMO na svojih
//    nalogih / projektih svojih nalogov — sicer CONFLICT/ERROR 'ni v vašem obsegu';
//  • poslovna logika je IDENTIČNA obstoječim rutam (confirm / measure/photo /
//    transition) — sync je transport, ne nov nalog sistem;
//  • CONFLICT = spor stanja (npr. nalog je že v statusu X) — ostane v odjemalski
//    vrsti in je uporabniku viden;
//  • ob zaključku: writeAudit SYNC_RUN (entity 'sync').

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, jsonError, readsAllData, type SessionUser } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'
import { izvediAkcijo, type AkcijaVhod } from '@/lib/playbook-engine'

// R439: terenski tok — VERBATIM iz /api/nalog/[id]/transition
const FLOW: Record<string, { next: string; event: string; label: string }[]> = {
  NAPROGRAMIRAN: [{ next: 'V_TEKU', event: 'ZACETEK', label: 'ZAČNI DELO' }],
  V_TEKU: [
    { next: 'V_ZAJEMU', event: 'ZAJEM', label: 'ZAJEM' },
    { next: 'V_PREVERI', event: 'PREVERITEV', label: 'PREVERI' },
  ],
  V_ZAJEMU: [{ next: 'V_PREVERI', event: 'PREVERITEV', label: 'PREVERI' }],
  V_PREVERI: [{ next: 'ZAKLJUCEN', event: 'ZAKLJUCEK', label: 'ZAKLJUČI TEREN' }],
}

const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'OSTANEO']
const KINDS = ['meritev', 'foto', 'nalog-opomba', 'nalog-status', 'nalog-zakljucek', 'playbook-step'] as const
type SyncKind = (typeof KINDS)[number]

const MAX_OPS = 50
const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB dataURL-a (~6 MB slike) — enako measure/photo

interface SyncOpIn { opId: string; kind: string; payload: unknown; clientTs?: string }
interface SyncResult { opId: string; status: 'OK' | 'CONFLICT' | 'ERROR'; data?: unknown; error?: string }

function num (v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function int (v: unknown): number | null {
  const n = num(v)
  return n === null ? null : Math.round(n)
}
function str (v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Obseg (fail-closed, issue #6): ali sme uporabnik pisati na ta nalog/projekt? */
async function scopeCheck (
  user: SessionUser,
  workOrderId: string | null,
  projectId: string | null
): Promise<string | null> {
  if (readsAllData(user)) {
    // pisarna: preveri samo obstoj
    if (workOrderId) {
      const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } })
      if (!wo) return 'Nalog ne obstaja.'
    }
    if (projectId) {
      const p = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
      if (!p) return 'Projekt ne obstaja.'
    }
    return null
  }
  // monter: SAMO svoji nalogi / projekti svojih nalogov
  if (workOrderId) {
    const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, assigneeId: true } })
    if (!wo) return 'Nalog ne obstaja.'
    if (wo.assigneeId !== user.id) return 'Nalog ni v vašem obsegu.'
    return null
  }
  if (projectId) {
    const own = await db.workOrder.findFirst({
      where: { assigneeId: user.id, projectId },
      select: { id: true },
    })
    if (!own) return 'Projekt ni v vašem obsegu.'
    return null
  }
  return 'Manjka povezava na nalog ali projekt.'
}

/** Strankina e-pošta za obvestilo o meritvi (kot confirm). */
async function customerOf (projectId: string | null): Promise<{ email: string | null; name: string | null }> {
  if (!projectId) return { email: null, name: null }
  const p = await db.project.findUnique({
    where: { id: projectId },
    select: { customer: { select: { name: true, email: true } } },
  }).catch(() => null)
  return { email: p?.customer?.email ?? null, name: p?.customer?.name ?? null }
}

/** Meritev (ISTA logika kot /api/measurement/confirm) + verzija v1 + revizija + obvestilo. */
async function opMeritev (
  user: SessionUser,
  payload: Record<string, unknown>,
  photoId: string | null
): Promise<{ data?: unknown; error?: string; conflict?: boolean }> {
  const workOrderId = str(payload.workOrderId)
  let projectId = str(payload.projectId)

  const scopeErr = await scopeCheck(user, workOrderId, projectId)
  if (scopeErr) return { error: scopeErr }

  const type = str(payload.type) ?? 'OGRAJA'
  if (!TYPES.includes(type)) {
    return { error: `Neznan tip meritve. Veljavni tipi: ${TYPES.join(', ')}.` }
  }

  const lengthCm = num(payload.lengthCm)
  const heightCm = num(payload.heightCm)
  const slopeDeg = num(payload.slopeDeg)
  const posts = int(payload.posts)
  const segments = int(payload.segments)
  const handrail = typeof payload.handrail === 'boolean' ? payload.handrail : true
  const source = payload.source === 'KAMERA' ? 'KAMERA' : 'ROCNO'

  if (lengthCm === null || lengthCm <= 0) return { error: 'Meritev zahteva dolžino (lengthCm > 0).' }
  if ([lengthCm, heightCm, slopeDeg, posts, segments].some((n) => n !== null && n < 0)) {
    return { error: 'Številske vrednosti ne morejo biti negativne.' }
  }
  if (lengthCm > 10000) return { error: 'Dolžina je nerealna (max 100 m).' }

  if (workOrderId) {
    const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { projectId: true } })
    if (wo) projectId = wo.projectId ?? projectId
  }

  const measurement = await db.measurement.create({
    data: {
      type,
      source,
      projectId,
      workOrderId,
      authorId: user.id,
      location: str(payload.location),
      lengthCm,
      heightCm,
      posts,
      segments,
      handrail,
      slopeDeg,
      params: JSON.stringify({ ...(photoId ? { photoId } : {}), synced: true }),
      note: str(payload.note),
    },
    include: {
      author: { select: { name: true } },
      project: { select: { id: true, code: true, title: true } },
      workOrder: { select: { id: true, code: true, title: true } },
    },
  })

  // verzija v1 — začetni posnetek (zgodovina verzij, issue #1)
  await db.measurementVersion.create({
    data: {
      measurementId: measurement.id,
      version: 1,
      userId: user.id,
      data: JSON.stringify({
        type, lengthCm, heightCm, posts, segments, handrail, slopeDeg,
        location: measurement.location, note: measurement.note, params: measurement.params,
      }),
      note: photoId ? 'Potrjeno s kamero (offline sinhronizacija)' : 'Shranjeno prek sinhronizacije (offline)',
    },
  })

  await writeAudit({
    userId: user.id,
    action: 'MEASUREMENT_CONFIRM',
    entity: 'measurement',
    entityId: measurement.id,
    projectId,
    detail: { photoId, type, lengthCm, heightCm, slopeDeg, workOrderId, location: measurement.location, synced: true },
  })

  // R438: potrjena meritev → statusno obvestilo stranki (EMAIL, maskiran naslov)
  const customer = await customerOf(projectId)
  if (customer.email) {
    await emitEvent({
      type: 'MEASUREMENT_CONFIRMED',
      key: `measurement-confirmed:${measurement.id}`,
      title: 'Meritev potrjena',
      body: `Meritev potrjena — ${measurement.location ?? customer.name ?? 'teren'} (${type.toLowerCase()}, ${Math.round(lengthCm)} cm)`,
      projectId,
      customerEmail: customer.email,
      customerName: customer.name,
    })
  }
  return { data: measurement }
}

/** FOTO meritev (ISTA kot /api/measure/photo) + vezana meritev, če so podatki v payloadu. */
async function opFoto (
  user: SessionUser,
  payload: Record<string, unknown>
): Promise<{ data?: unknown; error?: string; conflict?: boolean }> {
  const dataUrl = typeof payload.dataUrl === 'string' ? payload.dataUrl : ''
  if (!dataUrl.startsWith('data:image/')) {
    return { error: 'Manjka fotografija. Pričakovan je dataUrl (data:image/…;base64).' }
  }
  if (dataUrl.length > MAX_PHOTO_BYTES) {
    return { error: 'Fotografija je prevelika. Največja dovoljena velikost je 8 MB.' }
  }

  const workOrderId = str(payload.workOrderId)
  const projectId = str(payload.projectId)
  const scopeErr = await scopeCheck(user, workOrderId, projectId)
  if (scopeErr) return { error: scopeErr }

  let resolvedProjectId = projectId
  if (workOrderId) {
    const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { projectId: true } })
    resolvedProjectId = wo?.projectId ?? projectId
  }

  const photo = await db.measurement.create({
    data: {
      type: 'FOTO',
      source: 'KAMERA',
      projectId: resolvedProjectId,
      workOrderId,
      authorId: user.id,
      location: str(payload.location),
      params: JSON.stringify({ photo: dataUrl, stage: 'ZAJEM', synced: true }),
    },
    include: {
      author: { select: { name: true } },
      project: { select: { id: true, code: true, title: true } },
      workOrder: { select: { id: true, code: true, title: true } },
    },
  })

  await writeAudit({
    userId: user.id,
    action: 'PHOTO_UPLOAD',
    entity: 'measurement',
    entityId: photo.id,
    projectId: resolvedProjectId,
    detail: { workOrderId, bytes: dataUrl.length, location: photo.location, synced: true },
  })

  // foto op nosi tudi merilne podatke (offline zajem s kamero) → še meritev + verzija
  if (num(payload.lengthCm) !== null && (num(payload.lengthCm) ?? 0) > 0) {
    const m = await opMeritev(user, { ...payload, source: 'KAMERA' }, photo.id)
    if (m.error && !m.data) return m
    return { data: { photo, measurement: m.data } }
  }
  return { data: photo }
}

/** Prehod statusa (ISTA logika kot /api/nalog/[id]/transition); spor → CONFLICT. */
async function opTransition (
  user: SessionUser,
  workOrderId: string,
  to: string,
  note: string | null,
  forceZakljucek: boolean
): Promise<{ data?: unknown; error?: string; conflict?: boolean }> {
  const order = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      project: { select: { id: true, code: true, customer: { select: { name: true, email: true } } } },
      assignee: { select: { id: true } },
    },
  })
  if (!order) return { error: 'Nalog ne obstaja.' }

  // obseg (fail-closed): monter samo svoj nalog
  if (!readsAllData(user) && order.assignee?.id !== user.id) {
    return { error: 'Nalog ni v vašem obsegu.', conflict: true }
  }

  const target = forceZakljucek ? 'ZAKLJUCEN' : to
  const allowed = FLOW[order.status] ?? []
  const step = allowed.find((s) => s.next === target)
  if (!step) {
    const reason = target === order.status
      ? `Nalog je že v statusu ${order.status}.`
      : order.status === 'ZAKLJUCEN'
        ? 'Nalog je že zaključen.'
        : `Prehod ${order.status} → ${target} ni dovoljen. Dovoljeni prehodi: ${allowed.map((s) => `${order.status} → ${s.next}`).join('; ') || '—'}.`
    return { error: reason, conflict: true }
  }

  const now = new Date()
  const updated = await db.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: step.next,
      startedAt: step.event === 'ZACETEK' ? now : order.startedAt,
      completedAt: step.event === 'ZAKLJUCEK' ? now : order.completedAt,
      summary: step.event === 'ZAKLJUCEK' && note ? note : order.summary,
    },
  })
  await db.workOrderEvent.create({
    data: { workOrderId, userId: user.id, type: step.event, note: note ?? step.label },
  })
  await writeAudit({
    userId: user.id,
    action: 'WO_TRANSITION',
    entity: 'workOrder',
    entityId: workOrderId,
    projectId: order.project?.id ?? null,
    detail: { from: order.status, to: step.next, label: step.label, code: order.code, synced: true },
  })

  // R438: zaključek terena → pisarna (OFFICE) + stranka (EMAIL), dedup po ključu
  if (step.next === 'ZAKLJUCEN') {
    await emitEvent({
      type: 'WO_COMPLETED',
      key: `wo-completed:${workOrderId}`,
      title: 'Zaključek terena',
      body: `Nalog ${order.code} je zaključen${order.project ? ` (projekt ${order.project.code})` : ''}${note ? ` — ${note.slice(0, 160)}` : ''}`,
      projectId: order.project?.id ?? null,
      audience: 'OFFICE',
      customerEmail: order.project?.customer?.email ?? null,
      customerName: order.project?.customer?.name ?? null,
    })
  }
  return { data: updated }
}

export async function POST (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.', 'Zahtevan je veljaven Authorization: Bearer žeton.')

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const deviceId = typeof body.deviceId === 'string' && body.deviceId.trim() ? body.deviceId.trim() : null
  if (!deviceId) return jsonError(400, 'Manjka deviceId.', 'Identifikacija naprave je obvezna za sled sinhronizacije.')

  const ops = Array.isArray(body.ops) ? (body.ops as SyncOpIn[]) : []
  if (ops.length > MAX_OPS) {
    return jsonError(400, `Preveč operacij naenkrat (max ${MAX_OPS}).`, 'Pošljite manjše pakete.')
  }

  const results: SyncResult[] = []
  let synced = 0
  let conflicts = 0

  for (const op of ops) {
    const opId = typeof op?.opId === 'string' && op.opId ? op.opId : null
    if (!opId) {
      results.push({ opId: '', status: 'ERROR', error: 'Manjka opId (uuid, generira odjemalec).' })
      continue
    }

    // ── idempotenca: obstoječi SyncOp zadetek → shranjen rezultat, BREZ ponovitve ──
    const existing = await db.syncOp.findUnique({ where: { id: opId } }).catch(() => null)
    if (existing) {
      let saved: unknown = null
      try { saved = JSON.parse(existing.result) } catch { saved = null }
      results.push({ opId, status: 'OK', data: saved })
      synced++
      continue
    }

    const payload = (op.payload && typeof op.payload === 'object' ? op.payload : null) as Record<string, unknown> | null
    if (!payload) {
      results.push({ opId, status: 'ERROR', error: 'Manjka payload operacije.' })
      continue
    }

    let outcome: { data?: unknown; error?: string; conflict?: boolean }
    try {
      if (!KINDS.includes(op.kind as SyncKind)) {
        outcome = { error: `Neznan kind operacije. Veljavni: ${KINDS.join(', ')}.` }
      } else if (op.kind === 'meritev') {
        if (!user.perms.includes('measurements.write')) outcome = { error: 'Manjka pravica measurements.write.' }
        else outcome = await opMeritev(user, payload, null)
      } else if (op.kind === 'foto') {
        if (!user.perms.includes('measurements.write')) outcome = { error: 'Manjka pravica measurements.write.' }
        else outcome = await opFoto(user, payload)
      } else if (op.kind === 'nalog-opomba') {
        if (!user.perms.includes('nalog.transition')) outcome = { error: 'Manjka pravica nalog.transition.' }
        else {
          const woId = str(payload.workOrderId)
          const note = str(payload.note)
          if (!woId) outcome = { error: 'Manjka workOrderId.' }
          else if (!note) outcome = { error: 'Opomba je obvezna.' }
          else {
            const order = await db.workOrder.findUnique({
              where: { id: woId },
              select: { id: true, assigneeId: true, project: { select: { id: true } } },
            })
            if (!order) outcome = { error: 'Nalog ne obstaja.' }
            else if (!readsAllData(user) && order.assigneeId !== user.id) {
              outcome = { error: 'Nalog ni v vašem obsegu.', conflict: true }
            } else {
              await db.workOrderEvent.create({
                data: { workOrderId: woId, userId: user.id, type: 'OPOMBA', note },
              })
              await writeAudit({
                userId: user.id,
                action: 'WO_NOTE',
                entity: 'workOrder',
                entityId: woId,
                projectId: order.project?.id ?? null,
                detail: { note: note.slice(0, 200), synced: true },
              })
              outcome = { data: { workOrderId: woId, note } }
            }
          }
        }
      } else if (op.kind === 'nalog-status') {
        if (!user.perms.includes('nalog.transition')) outcome = { error: 'Manjka pravica nalog.transition.' }
        else {
          const woId = str(payload.workOrderId)
          const to = str(payload.to)
          if (!woId) outcome = { error: 'Manjka workOrderId.' }
          else if (!to) outcome = { error: 'Manjka ciljni status (to).' }
          else outcome = await opTransition(user, woId, to, null, false)
        }
      } else if (op.kind === 'playbook-step') {
        // R458 (issue #13 §13): offline akcija nad korakom playbooka — ISTA
        // logika kot /api/playbook/runs/[id]/action (sync je transport, ne nov sistem)
        if (!user.perms.includes('nalog.write')) outcome = { error: 'Manjka pravica nalog.write.' }
        else {
          const runId = str(payload.runId)
          const stepId = str(payload.stepId)
          const akcija = str(payload.akcija)
          if (!runId || !stepId || !akcija) {
            outcome = { error: 'Manjka runId, stepId ali akcija.' }
          } else {
            const rez = await izvediAkcijo(user, {
              runId, stepId,
              akcija: akcija as AkcijaVhod['akcija'],
              evidence: (payload.evidence && typeof payload.evidence === 'object'
                ? payload.evidence as Record<string, unknown>
                : null) as AkcijaVhod['evidence'],
              razlog: typeof payload.razlog === 'string' ? payload.razlog : null,
            })
            if (rez.stanje) {
              outcome = { data: { runId, stepId, akcija, napredek: rez.stanje.napredek, naslednji: rez.stanje.naslednji } }
            } else if (rez.napake && rez.napake.length > 0) {
              outcome = { error: rez.napake.join(' ') }
            } else {
              outcome = { error: rez.napaka ?? 'Napaka akcije nad korakom.' }
            }
          }
        }
      } else { // nalog-zakljucek
        if (!user.perms.includes('nalog.transition')) outcome = { error: 'Manjka pravica nalog.transition.' }
        else {
          const woId = str(payload.workOrderId)
          const summary = str(payload.summary)
          if (!woId) outcome = { error: 'Manjka workOrderId.' }
          else outcome = await opTransition(user, woId, 'ZAKLJUCEN', summary, true)
        }
      }
    } catch (err) {
      outcome = { error: err instanceof Error ? err.message : 'Napaka obdelave operacije.' }
    }

    if (outcome.error && !outcome.data) {
      const status = outcome.conflict ? 'CONFLICT' : 'ERROR'
      results.push({ opId, status, error: outcome.error })
      if (status === 'CONFLICT') conflicts++
      continue
    }

    // uspešno obdelan op → SyncOp zadetek (idempotenca za vsako ponovitev)
    await db.syncOp.create({
      data: {
        id: opId,
        deviceId,
        userId: user.id,
        kind: op.kind,
        result: JSON.stringify(outcome.data ?? null),
      },
    }).catch(() => {}) // unique → že zapisan (paralelna dostava) → ne prekini
    results.push({ opId, status: 'OK', data: outcome.data ?? null })
    synced++
  }

  // revizija celotnega sync zagona (sistemski dogodek — projectId null)
  await writeAudit({
    userId: user.id,
    action: 'SYNC_RUN',
    entity: 'sync',
    entityId: deviceId,
    detail: { deviceId, ops: ops.length, synced, conflicts },
  })

  return NextResponse.json({ data: { results, synced, conflicts } })
}

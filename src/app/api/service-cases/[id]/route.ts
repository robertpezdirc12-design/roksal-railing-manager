// /api/service-cases/[id] — SERVISNI PRIMER: podrobnost + tok (R446, issue #7 §10).
// GET   (projects.read) — podrobnost z obiski (+ tehnik), claimom, projektom in garancijo.
//       OBSEG: monter vidi primer SAMO če ima na njem svoj obisk (sicer 403).
// PATCH (projects.write + pisarna) — tok PREVERITEV → ODOBRENA | ZAVRNJENA
//       (obvezno decision + decisionNote ≥ 5 znakov; zapiše se decidedBy/decidedAt),
//       ODOBRENA → V_SERVISU | ZAKLJUCEN, V_SERVISU → ZAKLJUCEN (obvezno
//       resolutionNote); vsi ostali prehodi → 409. Ob zaključku/zavrnitvi se
//       povezani claim v ISTI transakciji premakne v ZAKLJUCENA | ZAVRNJENA.
//       billable se ob odobriti samodejno izračuna (garancija velja → false,
//       sicer true), uporabnik pa jo lahko prepiše. Brez statusa se lahko
//       dopolnijo decision/decisionNote/resolutionNote/billable.
//       Revizija SERVICE_CASE_DECISION / SERVICE_CASE_STATUS / SERVICE_CASE_UPDATE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import {
  SERVICE_CASE_INCLUDE, SERVICE_CASE_STATUSES, SERVICE_CASE_TRANSITIONS,
  SERVICE_DECISIONS, SERVICE_FLOW_DESC, warrantyValid,
} from '@/lib/service-core'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const serviceCase = await db.serviceCase.findUnique({ where: { id }, include: SERVICE_CASE_INCLUDE })
  if (!serviceCase) return jsonError(404, 'Servisni primer ne obstaja.')

  // obseg (fail-closed): monter vidi SAMO primere s svojimi obiski
  if (!readsAllData(user) && !serviceCase.visits.some((v) => v.userId === user.id)) {
    return jsonError(403, 'Nimate obiska na tem servisnem primeru.', 'Monter vidi samo svoje servisne primere.')
  }
  return NextResponse.json({ data: serviceCase })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // tok servisa VODI pisarna (odločitve, zaključki) — monterjev terenski
  // projects.write tu ne zadostuje
  if (!readsAllData(user)) {
    return jsonError(403, 'Tok servisnega primera vodi pisarna.', 'Monter zapisuje obiske, odločitve pa sprejema pisarna.')
  }

  const { id } = await params
  const serviceCase = await db.serviceCase.findUnique({
    where: { id },
    include: { warranty: { select: { id: true, status: true, startsAt: true, months: true } }, visits: { select: { userId: true } } },
  })
  if (!serviceCase) return jsonError(404, 'Servisni primer ne obstaja.')

  const body = await req.json().catch(() => null) as {
    status?: string; decision?: string; decisionNote?: string; resolutionNote?: string; billable?: boolean
  } | null

  // ── pomožna polja (brez prehoda statusa) ────────────────────────────────────
  const extra: { decision?: string; decisionNote?: string; resolutionNote?: string; billable?: boolean } = {}
  if (typeof body?.decision === 'string') {
    if (!(SERVICE_DECISIONS as readonly string[]).includes(body.decision)) {
      return jsonError(400, 'Neveljavna odločitev.', 'Veljavne odločitve: UTEMELJENA, DELNO_UTEMELJENA, NEUTEMELJENA.')
    }
    extra.decision = body.decision
  }
  if (typeof body?.decisionNote === 'string') extra.decisionNote = body.decisionNote.trim().slice(0, 2000)
  if (typeof body?.resolutionNote === 'string') extra.resolutionNote = body.resolutionNote.trim().slice(0, 2000)
  if (typeof body?.billable === 'boolean') extra.billable = body.billable

  // ── prehod statusa ──────────────────────────────────────────────────────────
  if (typeof body?.status === 'string') {
    const to = body.status
    if (!(SERVICE_CASE_STATUSES as readonly string[]).includes(to)) {
      return jsonError(400, 'Neveljaven status servisnega primera.', `Veljavni statusi: ${SERVICE_CASE_STATUSES.join(', ')}.`)
    }
    const allowed = SERVICE_CASE_TRANSITIONS[serviceCase.status] ?? []
    if (!allowed.includes(to)) {
      return jsonError(409, `Prehod ${serviceCase.status} → ${to} ni dovoljen.`, `Tok: ${SERVICE_FLOW_DESC} (+ ZAVRNJENA iz PREVERITEV). Dovoljeni prehodi iz ${serviceCase.status}: ${allowed.join(', ') || '—'}.`)
    }

    // PREVERITEV → ODOBRENA | ZAVRNJENA: OBVEZNA odločitev + utemeljitev
    if (serviceCase.status === 'PREVERITEV') {
      const decision = extra.decision ?? serviceCase.decision
      const decisionNote = extra.decisionNote ?? serviceCase.decisionNote ?? ''
      if (!decision) return jsonError(400, 'Odločitev (UTEMELJENA / DELNO_UTEMELJENA / NEUTEMELJENA) je obvezna.')
      if (decisionNote.trim().length < 5) {
        return jsonError(400, 'Utemeljitev odločitve je obvezna (vsaj 5 znakov).')
      }
    }

    // zaključek zahteva opombo o rešitvi
    if (to === 'ZAKLJUCEN') {
      const resolution = extra.resolutionNote ?? serviceCase.resolutionNote ?? ''
      if (resolution.trim().length < 5) {
        return jsonError(400, 'Ob zaključku je obvezna opomba o rešitvi (vsaj 5 znakov).')
      }
    }

    const patch: Record<string, unknown> = { status: to, ...extra }

    if (serviceCase.status === 'PREVERITEV') {
      patch.decidedById = user.id
      patch.decidedAt = new Date()
      // billable: garancija pokriva → NE zaračunamo; uporabnik lahko prepiše
      if (typeof extra.billable !== 'boolean') {
        patch.billable = serviceCase.warrantyId ? !warrantyValid(serviceCase.warranty) : true
      }
    }

    // zaključek/zavrnitev primera povleče tudi claim (ista transakcija)
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.serviceCase.update({ where: { id: serviceCase.id }, data: patch, include: SERVICE_CASE_INCLUDE })
      if (serviceCase.claimId && (to === 'ZAKLJUCEN' || to === 'ZAVRNJENA')) {
        await tx.claim.update({
          where: { id: serviceCase.claimId },
          data: { status: to === 'ZAKLJUCEN' ? 'ZAKLJUCENA' : 'ZAVRNJENA' },
        })
      }
      return row
    })

    await writeAudit({
      userId: user.id,
      action: serviceCase.status === 'PREVERITEV' ? 'SERVICE_CASE_DECISION' : 'SERVICE_CASE_STATUS',
      entity: 'serviceCase', entityId: serviceCase.id, projectId: serviceCase.projectId,
      detail: { code: serviceCase.code, iz: serviceCase.status, na: to, odlocitev: updated.decision, zracunano: updated.billable },
    })
    return NextResponse.json({ data: updated })
  }

  // ── dopolnitev brez prehoda (decision/decisionNote/resolutionNote/billable) ─
  if (Object.keys(extra).length === 0) {
    return jsonError(400, 'Ni sprememb za izvedbo.', 'Podprite polja: status, decision, decisionNote, resolutionNote, billable.')
  }
  const updated = await db.serviceCase.update({
    where: { id: serviceCase.id },
    data: extra,
    include: SERVICE_CASE_INCLUDE,
  })
  await writeAudit({
    userId: user.id, action: 'SERVICE_CASE_UPDATE', entity: 'serviceCase', entityId: serviceCase.id, projectId: serviceCase.projectId,
    detail: { code: serviceCase.code, polja: Object.keys(extra) },
  })
  return NextResponse.json({ data: updated })
}

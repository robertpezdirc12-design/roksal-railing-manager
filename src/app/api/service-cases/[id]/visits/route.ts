// /api/service-cases/[id]/visits — SERVISNI OBISKI (R446, issue #7 §10).
// GET  (projects.read) — seznam obiskov primera (+ tehnik); monter SAMO za
//      primere s svojim obiskom (isti obseg kot podrobnost primera).
// POST (nalog.write) — zapiše obisk {date?, note, userId?, hours?}.
//      TEHNIK zapiše obisk ZASE (vzorec /api/nalog/[id]/material); PISARNA
//      (projects.write + readsAllData) za kogarkoli. Obisk je mogoč samo na
//      ODOBRENEM ali V_SERVISU primeru (sicer 409). Ob PRVEM obisku se primer
//      samodejno premakne iz ODOBRENA v V_SERVISU (ista transakcija).
//      Revizija SERVICE_VISIT_CREATE s projectId primera.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

const VISIT_INCLUDE = { user: { select: { id: true, name: true, role: true } } }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const serviceCase = await db.serviceCase.findUnique({
    where: { id },
    select: { id: true, code: true, visits: { select: { userId: true } } },
  })
  if (!serviceCase) return jsonError(404, 'Servisni primer ne obstaja.')

  // obseg (fail-closed): monter vidi obiske SAMO svojih primerov
  if (!readsAllData(user) && !serviceCase.visits.some((v) => v.userId === user.id)) {
    return jsonError(403, 'Nimate obiska na tem servisnem primeru.', 'Monter vidi samo svoje servisne primere.')
  }

  const visits = await db.serviceVisit.findMany({
    where: { caseId: id },
    include: VISIT_INCLUDE,
    orderBy: { date: 'asc' },
  })
  return NextResponse.json({ data: visits })
}

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { user, perms } = auth

  const { id } = await params
  const serviceCase = await db.serviceCase.findUnique({
    where: { id },
    select: { id: true, code: true, status: true, projectId: true },
  })
  if (!serviceCase) return jsonError(404, 'Servisni primer ne obstaja.')

  // obiski se izvajajo na odobrenem primeru ali med servisom
  if (serviceCase.status !== 'ODOBRENA' && serviceCase.status !== 'V_SERVISU') {
    return jsonError(409, `Obisk ni mogoč — primer je ${serviceCase.status}.`, 'Obiske izvajajte na odobrenem ali v servisnem primeru.')
  }

  const body = await req.json().catch(() => null) as {
    date?: string; note?: string; userId?: string; hours?: number
  } | null

  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  if (!note) return jsonError(400, 'Opis obiska je obvezen.')

  let date = new Date()
  if (body?.date !== undefined && body?.date !== null && body?.date !== '') {
    const t = new Date(String(body.date))
    if (Number.isNaN(t.getTime())) return jsonError(400, 'Neveljaven datum obiska.')
    date = t
  }

  let hours: number | null = null
  if (body?.hours !== undefined && body?.hours !== null) {
    const h = Number(body.hours)
    if (!Number.isFinite(h) || h <= 0 || h > 24) return jsonError(400, 'Ure dela morajo biti med 0 in 24.')
    hours = Math.round(h * 100) / 100
  }

  // tehnik = uporabnik z nalog.write BREZ pisarniškega obsega → obisk SAMO ZASE;
  // pisarna (projects.write + readsAllData) lahko zapiše obisk za kogarkoli
  const isOffice = readsAllData(user) && perms.includes('projects.write')
  let visitUserId = user.id
  if (isOffice && typeof body?.userId === 'string' && body.userId) {
    const target = await db.user.findUnique({ where: { id: body.userId }, select: { id: true, name: true, active: true } })
    if (!target || !target.active) return jsonError(404, 'Tehnik ne obstaja ali ni aktiven.')
    visitUserId = target.id
  } else if (!isOffice && typeof body?.userId === 'string' && body.userId && body.userId !== user.id) {
    return jsonError(403, 'Tehnik zapiše obisk samo zase.', 'Za obisk drugega tehnika je potreben pisarniški dostop.')
  }

  // obisk + morebiten samodejni premik ODOBRENA → V_SERVISU v ENI transakciji
  const visit = await db.$transaction(async (tx) => {
    const row = await tx.serviceVisit.create({
      data: { caseId: serviceCase.id, date, note: note.slice(0, 2000), userId: visitUserId, hours },
      include: VISIT_INCLUDE,
    })
    if (serviceCase.status === 'ODOBRENA') {
      await tx.serviceCase.update({ where: { id: serviceCase.id }, data: { status: 'V_SERVISU' } })
    }
    return row
  })

  await writeAudit({
    userId: user.id, action: 'SERVICE_VISIT_CREATE', entity: 'serviceVisit', entityId: visit.id, projectId: serviceCase.projectId,
    detail: { code: serviceCase.code, tehnik: visit.user.name, ure: hours, prviObisk: serviceCase.status === 'ODOBRENA' },
  })
  return NextResponse.json({ data: visit }, { status: 201 })
}

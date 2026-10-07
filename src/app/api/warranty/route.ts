import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/warranty — garancije projektov (route-map: GET/POST /api/warranty + /api/warranty/[id]/visits)
// GET  (projects.read): ?projectId=… → garancije (+ obiski, projekt) z izračunom veljavnosti
// POST (projects.write):
//   { projectId, startsAt?, months?, note? }          → nova garancija (samo ZAKLJUCEN/ARHIV projekt)
//   { warrantyId, visitNote: string, visitDate? }     → nov obisk garancije
// Revizija: WARRANTY_CREATE / WARRANTY_VISIT.

const ADD_MONTHS = (d: Date, months: number): Date => {
  const r = new Date(d)
  r.setMonth(r.getMonth() + months)
  return r
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const now = new Date()

  const warranties = await db.warranty.findMany({
    where: projectId ? { projectId } : {},
    include: {
      visits: { orderBy: { date: 'asc' } },
      project: { select: { code: true, title: true, status: true, customer: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const data = warranties.map((w) => {
    const endsAt = ADD_MONTHS(w.startsAt, w.months)
    const nextVisit = w.visits.find((v) => v.date >= now) ?? null
    return {
      ...w,
      endsAt: endsAt.toISOString(),
      valid: w.status === 'AKTIVNA' && endsAt >= now,
      nextVisit: nextVisit ? { id: nextVisit.id, date: nextVisit.date.toISOString(), note: nextVisit.note } : null,
    }
  })

  return NextResponse.json({ data })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as {
    projectId?: string; startsAt?: string; months?: number; note?: string
    warrantyId?: string; visitNote?: string; visitDate?: string
  } | null

  // ── varianta B: nov obisk obstoječe garancije ──
  if (body?.warrantyId) {
    const visitNote = typeof body.visitNote === 'string' ? body.visitNote.trim() : ''
    if (!visitNote) return jsonError(400, 'Opis obiska je obvezen.')

    const warranty = await db.warranty.findUnique({ where: { id: body.warrantyId }, include: { project: { select: { id: true, code: true } } } })
    if (!warranty) return jsonError(404, 'Garancija ne obstaja.')

    const date = body.visitDate ? new Date(body.visitDate) : new Date()
    if (Number.isNaN(date.getTime())) return jsonError(400, 'Neveljaven datum obiska.')

    const visit = await db.warrantyVisit.create({
      data: { warrantyId: warranty.id, date, note: visitNote, userId: user.id },
    })
    await writeAudit({
      userId: user.id, action: 'WARRANTY_VISIT', entity: 'warranty', entityId: warranty.id, projectId: warranty.projectId,
      detail: { project: warranty.project.code, note: visitNote, date: date.toISOString() },
    })
    return NextResponse.json({ data: visit }, { status: 201 })
  }

  // ── varianta A: nova garancija projekta ──
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) return jsonError(400, 'Manjka projekt.')

  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, status: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')
  if (project.status !== 'ZAKLJUCEN' && project.status !== 'ARHIV') {
    return jsonError(409, 'Garancijo je mogoče oddati samo za zaključen ali arhiviran projekt.')
  }

  const existing = await db.warranty.findFirst({ where: { projectId }, select: { id: true } })
  if (existing) return jsonError(409, 'Projekt ima že garancijo.')

  const months = Number(body?.months)
  const m = Number.isFinite(months) && months >= 1 && months <= 120 ? Math.trunc(months) : 24
  const startsAt = body?.startsAt ? new Date(body.startsAt) : new Date()
  if (Number.isNaN(startsAt.getTime())) return jsonError(400, 'Neveljaven začetek garancije.')

  const warranty = await db.warranty.create({
    data: {
      projectId,
      startsAt,
      months: m,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
    },
  })
  await writeAudit({
    userId: user.id, action: 'WARRANTY_CREATE', entity: 'warranty', entityId: warranty.id, projectId,
    detail: { project: project.code, months: m },
  })

  return NextResponse.json({ data: warranty }, { status: 201 })
}

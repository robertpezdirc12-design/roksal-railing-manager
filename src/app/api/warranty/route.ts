import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

// /api/warranty — garancije projektov (route-map: GET/POST /api/warranty + /api/warranty/[id]/visits)
// GET  (projects.read): ?projectId=… → garancije (+ obiski, projekt) z izračunom veljavnosti
// POST (projects.write):
//   { projectId, startsAt?, months?, note? }          → nova garancija (samo ZAKLJUCEN/ARHIV projekt)
//   { warrantyId, visitNote: string, visitDate? }     → nov obisk garancije
// Revizija: WARRANTY_CREATE / WARRANTY_VISIT.

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// obe varianti delita telo — warrantyId NEPRAZEN niz odloča varianto B (prazno
// ⇒ null ⇒ varianta A, kot prej po truthy preverbi); projectId neobvezen
// (handler vrne 400 „Manjka projekt.“ samo v varianti A); months gre NEZNAN
// naprej — pretvorba Number() s privzetim 24 ob neveljavnem ostaja v handlerju
// (z.coerce.number bi neveljavne vrednosti ZAVRNIL namesto privzetja, kot prej);
// startsAt/visitDate sta niza, ki ju handler pretvori v Date s specifičnima 400
// sporočiloma (ista kot prej).
const WarrantyBodySchema = z.object({
  projectId: z.string().nullish().transform((v) => v || ''),
  startsAt: z.string().nullish(),
  months: z.unknown(),
  note: z.string().trim().nullish().transform((v) => v || null),
  warrantyId: z.string().nullish().transform((v) => v || null),
  visitNote: z.string().trim().nullish().transform((v) => v ?? ''),
  visitDate: z.string().nullish(),
})

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

  const parsed = await parseBody(req, WarrantyBodySchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // ── varianta B: nov obisk obstoječe garancije ──
  if (data.warrantyId) {
    const visitNote = data.visitNote
    if (!visitNote) return jsonError(400, 'Opis obiska je obvezen.')

    const warranty = await db.warranty.findUnique({ where: { id: data.warrantyId }, include: { project: { select: { id: true, code: true } } } })
    if (!warranty) return jsonError(404, 'Garancija ne obstaja.')

    const date = data.visitDate ? new Date(data.visitDate) : new Date()
    if (Number.isNaN(date.getTime())) return jsonError(400, 'Neveljaven datum obiska.')

    // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
    const visit = await db.$transaction(async (tx) => {
      const visit = await tx.warrantyVisit.create({
        data: { warrantyId: warranty.id, date, note: visitNote, userId: user.id },
      })
      await writeAudit({
        userId: user.id, action: 'WARRANTY_VISIT', entity: 'warranty', entityId: warranty.id, projectId: warranty.projectId,
        detail: { project: warranty.project.code, note: visitNote, date: date.toISOString() },
      }, tx)
      return visit
    })
    return NextResponse.json({ data: visit }, { status: 201 })
  }

  // ── varianta A: nova garancija projekta ──
  const projectId = data.projectId
  if (!projectId) return jsonError(400, 'Manjka projekt.')

  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, status: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')
  if (project.status !== 'ZAKLJUCEN' && project.status !== 'ARHIV') {
    return jsonError(409, 'Garancijo je mogoče oddati samo za zaključen ali arhiviran projekt.')
  }

  const existing = await db.warranty.findFirst({ where: { projectId }, select: { id: true } })
  if (existing) return jsonError(409, 'Projekt ima že garancijo.')

  // Number() s privzetim 24 (kot prej — shema ne zavrne, ker je privzet del
  // sprejemljivosti: neveljaven months ⇒ 24 mesecev)
  const months = Number(data.months)
  const m = Number.isFinite(months) && months >= 1 && months <= 120 ? Math.trunc(months) : 24
  const startsAt = data.startsAt ? new Date(data.startsAt) : new Date()
  if (Number.isNaN(startsAt.getTime())) return jsonError(400, 'Neveljaven začetek garancije.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  const warranty = await db.$transaction(async (tx) => {
    const warranty = await tx.warranty.create({
      data: {
        projectId,
        startsAt,
        months: m,
        note: data.note,
      },
    })
    await writeAudit({
      userId: user.id, action: 'WARRANTY_CREATE', entity: 'warranty', entityId: warranty.id, projectId,
      detail: { project: project.code, months: m },
    }, tx)
    return warranty
  })

  return NextResponse.json({ data: warranty }, { status: 201 })
}

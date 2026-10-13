// /api/measurements — zajem meritev (OGRAJA / BALUSTRADA / NAGIB / FOTO)
// GET  ?projectId&workOrderId&type — seznam z avtorjem+projektom+nalogom (measurements.read)
// POST ustvari meritev, avtor = prijavljeni uporabnik (measurements.write)
//      R450 (issue #9): ob ustvarjanju zapiše tudi verzijo v1 (zgodovina kdo/kdaj/kaj
//      ob nastanku — enako kot /api/sync, /api/measurement/confirm, /api/railing-layout).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { FAMILY_CODES, type FamilyCode } from '@/lib/product-core'
import { deriveProvenance, photoRecordProvenance } from '@/lib/measure-engine'

const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'FOTO', 'OSTANEO']

function num (v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function int (v: unknown): number | null {
  const n = num(v)
  return n === null ? null : Math.round(n)
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const workOrderId = url.searchParams.get('workOrderId')
  const type = url.searchParams.get('type')

  if (type && !TYPES.includes(type)) {
    return jsonError(400, 'Neznan tip meritve.', `Veljavni tipi: ${TYPES.join(', ')}.`)
  }

  const measurements = await db.measurement.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(workOrderId ? { workOrderId } : {}),
      ...(type ? { type } : {}),
      // obseg (issue #1): monter vidi samo meritve svojih nalogov in lastne
      ...(readsAllData(user) ? {} : { OR: [{ authorId: user.id }, { workOrder: { assigneeId: user.id } }] }),
    },
    include: {
      author: { select: { name: true } },
      project: { select: { id: true, code: true, title: true } },
      workOrder: { select: { id: true, code: true, title: true } },
      // R437: include vrača tudi skalar shareToken (javna povezava) — avtoriziranim
      // uporabnikom ni skrivnost; javna povezava izdaja samo varen podsklop polj.
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ data: measurements })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const type = typeof body.type === 'string' && body.type ? body.type : 'OGRAJA'
  if (!TYPES.includes(type)) {
    return jsonError(400, 'Neznan tip meritve.', `Veljavni tipi: ${TYPES.join(', ')}.`)
  }

  const lengthCm = num(body.lengthCm)
  const heightCm = num(body.heightCm)
  const slopeDeg = num(body.slopeDeg)
  const posts = int(body.posts)
  const segments = int(body.segments)
  if ([lengthCm, heightCm, slopeDeg, posts, segments].some((n) => n !== null && n < 0)) {
    return jsonError(400, 'Številske vrednosti ne morejo biti negativne.')
  }

  const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
  const workOrderId = typeof body.workOrderId === 'string' && body.workOrderId ? body.workOrderId : null

  let project: { id: string } | null = null
  if (projectId) {
    project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return jsonError(400, 'Projekt ne obstaja.', 'Podan projectId ni veljaven.')
  }

  let workOrder: { id: string; projectId: string | null } | null = null
  if (workOrderId) {
    workOrder = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, projectId: true } })
    if (!workOrder) return jsonError(400, 'Nalog ne obstaja.', 'Podan workOrderId ni veljaven.')
  }

  // R501 (issue #15 faza 2): PROVENIENCA. Ročni vnos nosi odgovornost na vpisu
  // (MANUAL), fotografski zapis brez geometrije pa ni poslovna mera (ESTIMATED).
  // Stanje izračuna jedro samo takrat, ko params res nosijo točke + merilo.
  let paramsGeo: { points?: unknown; calibration?: unknown } | null = null
  if (typeof body.params === 'string') {
    try { paramsGeo = JSON.parse(body.params) } catch { paramsGeo = null }
  }
  const provenance = type === 'FOTO' && !paramsGeo?.points
    ? photoRecordProvenance()
    : deriveProvenance({ points: paramsGeo?.points, calibration: paramsGeo?.calibration, legacyType: type })

  const measurement = await db.measurement.create({
    data: {
      type,
      status: provenance.status,
      statusNote: provenance.reason,
      familyCode: typeof body.familyCode === 'string' && FAMILY_CODES.includes(body.familyCode as FamilyCode) ? body.familyCode : null, // R442: generalizacija meritev na produktno družino
      projectId: projectId ?? workOrder?.projectId ?? null,
      workOrderId,
      authorId: user.id,
      location: typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null,
      lengthCm,
      heightCm,
      posts,
      segments,
      handrail: typeof body.handrail === 'boolean' ? body.handrail : true,
      slopeDeg,
      params: typeof body.params === 'string' ? body.params : null,
      note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    },
    include: {
      author: { select: { name: true } },
      project: { select: { id: true, code: true, title: true } },
      workOrder: { select: { id: true, code: true, title: true } },
    },
  })

  // R450 (issue #9): verzija v1 — začetni posnetek (isti vzorec kot /api/sync — opMeritev)
  await db.measurementVersion.create({
    data: {
      measurementId: measurement.id,
      version: 1,
      userId: user.id,
      data: JSON.stringify({
        type, lengthCm, heightCm, posts, segments, handrail: measurement.handrail, slopeDeg,
        location: measurement.location, note: measurement.note, params: measurement.params,
        status: provenance.status, statusNote: provenance.reason,
      }),
      note: type === 'FOTO' ? 'Ročna foto meritev' : 'Ročna meritev',
    },
  })

  await writeAudit({
    userId: user.id,
    action: 'MEASUREMENT_CREATE',
    entity: 'measurement',
    entityId: measurement.id,
    projectId: measurement.projectId,
    detail: { type, workOrderId: workOrderId ?? null, location: measurement.location, lengthCm, slopeDeg, isPhoto: type === 'FOTO', status: provenance.status },
  })
  return NextResponse.json({ data: measurement }, { status: 201 })
}

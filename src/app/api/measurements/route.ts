// /api/measurements — zajem meritev (OGRAJA / BALUSTRADA / NAGIB / FOTO)
// GET  ?projectId&workOrderId&type — seznam z avtorjem+projektom+nalogom (measurements.read)
// POST ustvari meritev, avtor = prijavljeni uporabnik (measurements.write)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

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
    },
    include: {
      author: { select: { name: true } },
      project: { select: { id: true, code: true, title: true } },
      workOrder: { select: { id: true, code: true, title: true } },
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

  const measurement = await db.measurement.create({
    data: {
      type,
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

  await writeAudit({
    userId: user.id,
    action: 'MEASUREMENT_CREATE',
    entity: 'measurement',
    entityId: measurement.id,
    projectId: measurement.projectId,
    detail: { type, workOrderId: workOrderId ?? null, location: measurement.location, lengthCm, slopeDeg, isPhoto: type === 'FOTO' },
  })
  return NextResponse.json({ data: measurement }, { status: 201 })
}

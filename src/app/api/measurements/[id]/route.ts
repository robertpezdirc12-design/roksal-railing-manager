// /api/measurements/[id] — posamezna meritev
// GET   podrobnost z avtorjem+projektom+nalogom (measurements.read)
// PATCH popravek polj (measurements.write) + revizija MEASUREMENT_UPDATE

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'FOTO', 'OSTANEO']

const INCLUDE = {
  author: { select: { name: true } },
  project: { select: { id: true, code: true, title: true } },
  workOrder: { select: { id: true, code: true, title: true } },
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const measurement = await db.measurement.findUnique({ where: { id }, include: INCLUDE })
  if (!measurement) return jsonError(404, 'Meritev ne obstaja.')
  return NextResponse.json({ data: measurement })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const existing = await db.measurement.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Meritev ne obstaja.')

  const patch: Record<string, unknown> = {}
  if (typeof body.type === 'string') {
    if (!TYPES.includes(body.type)) {
      return jsonError(400, 'Neznan tip meritve.', `Veljavni tipi: ${TYPES.join(', ')}.`)
    }
    patch.type = body.type
  }
  if (typeof body.location === 'string') patch.location = body.location.trim() || null
  if (typeof body.note === 'string') patch.note = body.note.trim() || null
  if (typeof body.params === 'string') patch.params = body.params
  if (typeof body.handrail === 'boolean') patch.handrail = body.handrail

  const numOr = (v: unknown, key: string) => {
    if (v === null) { patch[key] = null; return }
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) patch[key] = v
  }
  numOr(body.lengthCm, 'lengthCm')
  numOr(body.heightCm, 'heightCm')
  numOr(body.slopeDeg, 'slopeDeg')
  if (body.posts === null) patch.posts = null
  else if (typeof body.posts === 'number' && Number.isFinite(body.posts) && body.posts >= 0) patch.posts = Math.round(body.posts)
  if (body.segments === null) patch.segments = null
  else if (typeof body.segments === 'number' && Number.isFinite(body.segments) && body.segments >= 0) patch.segments = Math.round(body.segments)

  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  const updated = await db.measurement.update({ where: { id }, data: patch, include: INCLUDE })

  await writeAudit({
    userId: auth.user.id,
    action: 'MEASUREMENT_UPDATE',
    entity: 'measurement',
    entityId: id,
    projectId: updated.projectId,
    detail: {
      from: {
        type: existing.type, location: existing.location, note: existing.note, handrail: existing.handrail,
        lengthCm: existing.lengthCm, heightCm: existing.heightCm, posts: existing.posts, segments: existing.segments, slopeDeg: existing.slopeDeg,
      },
      to: patch,
    },
  })
  return NextResponse.json({ data: updated })
}

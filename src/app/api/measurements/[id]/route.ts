// /api/measurements/[id] — posamezna meritev
// GET   podrobnost z avtorjem+projektom+nalogom (measurements.read)
// PATCH popravek polj (measurements.write) + revizija MEASUREMENT_UPDATE

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'FOTO', 'OSTANEO']

const INCLUDE = {
  author: { select: { name: true } },
  project: { select: { id: true, code: true, title: true } },
  workOrder: { select: { id: true, code: true, title: true } },
}

/** Obseg (issue #1): monter dostopa samo do lastnih meritev in meritev svojih nalogov. */
function scopeDenied (
  user: { id: string; role: string; email?: string; name?: string; perms?: string[] },
  m: { authorId: string | null; workOrder: { assigneeId: string | null } | null }
): boolean {
  return !readsAllData(user) && m.authorId !== user.id && m.workOrder?.assigneeId !== user.id
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scopeRow = await db.measurement.findUnique({
    where: { id },
    select: { authorId: true, workOrder: { select: { assigneeId: true } } },
  })
  if (!scopeRow) return jsonError(404, 'Meritev ne obstaja.')
  if (scopeDenied(user, scopeRow)) {
    return jsonError(403, 'Meritev ni v vašem obsegu.', 'Monter vidi samo svoje meritve in meritve svojih nalogov.')
  }

  const measurement = await db.measurement.findUnique({ where: { id }, include: INCLUDE })
  if (!measurement) return jsonError(404, 'Meritev ne obstaja.')
  return NextResponse.json({ data: measurement })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const existing = await db.measurement.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Meritev ne obstaja.')

  // obseg (issue #1): monter popravlja samo lastne meritve / meritve svojih nalogov
  if (!readsAllData(user)) {
    const wo = existing.workOrderId
      ? await db.workOrder.findUnique({ where: { id: existing.workOrderId }, select: { assigneeId: true } })
      : null
    if (existing.authorId !== user.id && wo?.assigneeId !== user.id) {
      return jsonError(403, 'Meritev ni v vašem obsegu.', 'Monter popravlja samo svoje meritve.')
    }
  }

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

  // zgodovina verzij: posnetek STANJA PRED spremembo (kdo/kdaj/kaj — issue #1)
  const lastVersion = await db.measurementVersion.findFirst({
    where: { measurementId: id },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  await db.measurementVersion.create({
    data: {
      measurementId: id,
      version: (lastVersion?.version ?? 0) + 1,
      userId: auth.user.id,
      data: JSON.stringify({
        type: existing.type, location: existing.location, note: existing.note, handrail: existing.handrail,
        lengthCm: existing.lengthCm, heightCm: existing.heightCm, posts: existing.posts,
        segments: existing.segments, slopeDeg: existing.slopeDeg, params: existing.params,
      }),
      note: `Popravek: ${Object.keys(patch).join(', ')}`,
    },
  })

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

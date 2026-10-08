// /api/viz/projects/[id] — R454 (NAPREDNI 3D): podrobnost, posodobitev, brisanje.
// GET    (projects.read) — podrobnost z avtorjem in projektom.
// PATCH  (measurements.write) — { name?, tip?, params?, note?, projectId? };
//        params morajo ostati veljaven JSON; projectId mora obstajati (§15).
//        Revizija VIZ_PROJECT_UPDATE (before → after).
// DELETE (measurements.write) — brisanje → revizija VIZ_PROJECT_DELETE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const TIPS = ['OGRAJA', 'BALUSTRADA', 'NAGIB']

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await db.vizProject.findUnique({
    where: { id },
    include: {
      author: { select: { name: true, role: true } },
      project: { select: { id: true, code: true, title: true } },
    },
  })
  if (!project) return jsonError(404, 'Vizualizacijski projekt ne obstaja.')
  return NextResponse.json({ data: project })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const existing = await db.vizProject.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Vizualizacijski projekt ne obstaja.')

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const data: Record<string, string | null> = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 120)
    if (!name) return jsonError(400, 'Ime ne sme biti prazno.')
    data.name = name
  }
  if (typeof body.tip === 'string') {
    if (!TIPS.includes(body.tip)) return jsonError(400, 'Neveljaven tip (OGRAJA | BALUSTRADA | NAGIB).')
    data.tip = body.tip
  }
  if (typeof body.params === 'string') {
    try {
      const parsed = JSON.parse(body.params) as unknown
      if (!parsed || typeof parsed !== 'object') throw new Error('ni objekt')
    } catch {
      return jsonError(400, 'Params niso veljaven JSON.')
    }
    data.params = body.params.trim()
  }
  if (typeof body.note === 'string') {
    data.note = body.note.trim().slice(0, 500) || null
  }
  if (body.projectId !== undefined) {
    if (body.projectId === null || body.projectId === '') {
      data.projectId = null
    } else if (typeof body.projectId === 'string') {
      const project = await db.project.findUnique({ where: { id: body.projectId }, select: { id: true } })
      if (!project) return jsonError(404, 'Projekt ne obstaja.')
      data.projectId = project.id
    }
  }

  if (Object.keys(data).length === 0) return jsonError(400, 'Ni polj za posodobitev.')

  const updated = await db.vizProject.update({ where: { id }, data })

  await writeAudit({
    userId: user.id,
    action: 'VIZ_PROJECT_UPDATE',
    entity: 'vizProject',
    entityId: id,
    projectId: updated.projectId,
    detail: {
      before: { name: existing.name, tip: existing.tip, note: existing.note },
      after: { name: updated.name, tip: updated.tip, note: updated.note },
    },
  })
  return NextResponse.json({ data: updated })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const existing = await db.vizProject.findUnique({ where: { id }, select: { id: true, name: true, projectId: true } })
  if (!existing) return jsonError(404, 'Vizualizacijski projekt ne obstaja.')

  await db.vizProject.delete({ where: { id } })

  await writeAudit({
    userId: user.id,
    action: 'VIZ_PROJECT_DELETE',
    entity: 'vizProject',
    entityId: id,
    projectId: existing.projectId,
    detail: { name: existing.name },
  })
  return NextResponse.json({ data: { ok: true, id } })
}

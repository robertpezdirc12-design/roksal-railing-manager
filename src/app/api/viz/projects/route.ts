// /api/viz/projects — R454 (issue #7 §16 P3: NAPREDNI 3D, route-map
// §„3D vizualizacije & AR": GET/POST /api/viz/projects).
// GET  (projects.read) — seznam shranjenih 3D konfiguracij (novejši first,
//      max 200) z avtorjem in poslovnim projektom; ?projectId= filter.
// POST (measurements.write) — shrani konfiguracijo { name, projectId?, tip,
//      params (JSON konfiguratorja), note? } → revizija VIZ_PROJECT_CREATE.
//      tip: OGRAJA | BALUSTRADA | NAGIB; params so JSON niz naše viz.tsx.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const TIPS = ['OGRAJA', 'BALUSTRADA', 'NAGIB']

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')

  const projects = await db.vizProject.findMany({
    where: projectId ? { projectId } : {},
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: {
      author: { select: { name: true, role: true } },
      project: { select: { code: true, title: true } },
    },
  })
  return NextResponse.json({ data: projects })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (!name) return jsonError(400, 'Manjka ime projekta.')

  const tip = typeof body.tip === 'string' && TIPS.includes(body.tip) ? body.tip : 'OGRAJA'

  const params = typeof body.params === 'string' && body.params.trim() ? body.params.trim() : ''
  if (!params) return jsonError(400, 'Manjkajo params konfiguratorja (JSON).')
  try {
    const parsed = JSON.parse(params) as unknown
    if (!parsed || typeof parsed !== 'object') throw new Error('ni objekt')
  } catch {
    return jsonError(400, 'Params niso veljaven JSON.')
  }

  // projectId (neobvezno, a če je → mora obstajati — eksplicitna ID povezava §15)
  let projectId: string | null = null
  if (typeof body.projectId === 'string' && body.projectId) {
    const project = await db.project.findUnique({ where: { id: body.projectId }, select: { id: true } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
    projectId = project.id
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null

  const created = await db.vizProject.create({
    data: { name, projectId, authorId: user.id, tip, params, note },
  })

  await writeAudit({
    userId: user.id,
    action: 'VIZ_PROJECT_CREATE',
    entity: 'vizProject',
    entityId: created.id,
    projectId,
    detail: { name, tip, note },
  })

  return NextResponse.json({ data: created }, { status: 201 })
}

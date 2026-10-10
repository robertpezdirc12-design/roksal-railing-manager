// /api/ar-snapshots — R454 (issue #7 §16 P3: NAPREDNI AR, route-map
// §„3D vizualizacije & AR": GET/POST /api/ar-snapshots).
// GET  (projects.read) — seznam AR posnetkov (novejši first, max 200);
//      filter ?projectId= poveže na poslovni projekt. Seznam NE vrača
//      params (fotografije base64 so lahko velike) — samo metapodatke.
// POST (measurements.write) — nov AR posnetek { projectId?, scene?, analysis?,
//      params?, note? } → revizija AR_SNAPSHOT_CREATE (občutljiva mutacija).
//      analysis/params sta JSON niza — shranita se NEPREVERJENA struktura
//      (veljavnost kliče preveri sam, izvor je naš UI).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { sanitizeSceneResult, serializeSceneResult } from '@/lib/scene-understanding-core'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')

  const snapshots = await db.arSnapshot.findMany({
    where: projectId ? { projectId } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, projectId: true, authorId: true, scene: true,
      analysis: true, note: true, createdAt: true,
      author: { select: { name: true, role: true } },
      project: { select: { code: true, title: true } },
    },
  })
  return NextResponse.json({ data: snapshots })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  // projectId (neobvezno, a če je → mora obstajati — eksplicitna ID povezava §15)
  let projectId: string | null = null
  if (typeof body.projectId === 'string' && body.projectId) {
    const project = await db.project.findUnique({ where: { id: body.projectId }, select: { id: true } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
    projectId = project.id
  }

  const scene = typeof body.scene === 'string' ? body.scene.trim().slice(0, 300) || null : null
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null
  const analysis = typeof body.analysis === 'string' && body.analysis.trim() ? body.analysis.slice(0, 20_000) : null
  const params = typeof body.params === 'string' && body.params.trim() ? body.params.slice(0, 4_000_000) : null
  // R467: razumevanje prizora (objekt → stroga validacija → serializacija)
  const sceneUnderstanding = sanitizeSceneResult(body.sceneUnderstanding)
  const sceneJson = sceneUnderstanding ? serializeSceneResult(sceneUnderstanding) : null
  if (!params && !analysis && !note && !sceneJson) {
    return jsonError(400, 'Posnetek potrebuje vsaj params (posnetek), analysis, scene ali opombo.')
  }

  const snapshot = await db.arSnapshot.create({
    data: { projectId, authorId: user.id, scene, analysis, params, note, sceneJson },
  })

  await writeAudit({
    userId: user.id,
    action: 'AR_SNAPSHOT_CREATE',
    entity: 'arSnapshot',
    entityId: snapshot.id,
    projectId,
    detail: { scene, hasPhoto: !!params, note, sceneElements: sceneUnderstanding?.elements.length ?? 0 },
  })

  return NextResponse.json({ data: { id: snapshot.id, createdAt: snapshot.createdAt } }, { status: 201 })
}

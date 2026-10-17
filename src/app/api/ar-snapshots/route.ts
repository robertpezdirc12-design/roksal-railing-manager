// /api/ar-snapshots — R454 (issue #7 §16 P3: NAPREDNI AR, route-map
// §„3D vizualizacije & AR": GET/POST /api/ar-snapshots).
// GET  (projects.read) — seznam AR posnetkov (novejši first, max 200);
//      filter ?projectId= poveže na poslovni projekt. Seznam NE vrača
//      params (fotografije base64 so lahko velike) — samo metapodatke.
// POST (measurements.write) — nov AR posnetek { projectId?, scene?, analysis?,
//      params?, note? } → revizija AR_SNAPSHOT_CREATE (občutljiva mutacija).
//      R542: analysis/params sta jsonb OBJEKTA (ne niza več) — surovi prehod
//      je zaprt z zod (inventura R542-a: zadnji surovi kraji); veljavnost
//      notranje strukture kliče preveri sam, izvor je naš UI.

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { sanitizeSceneResult } from '@/lib/scene-understanding-core'

// R542: prostoro-tehnični tovor kot objekt (niz → 400; stara oblika niza).
const JsonObjectSchema = z.record(z.string(), z.unknown(), { error: 'mora biti JSON objekt (ne niz).' }).nullish()

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
  // R542: analysis/params — samo objekt (stara oblika niza → 400, slovensko)
  const analysisParsed = JsonObjectSchema.safeParse((body as { analysis?: unknown }).analysis)
  if (!analysisParsed.success) {
    return jsonError(400, 'Neveljavna analiza.', 'analysis mora biti JSON objekt (ne niz) — npr. { placement, ovire, reference }.')
  }
  const paramsParsed = JsonObjectSchema.safeParse((body as { params?: unknown }).params)
  if (!paramsParsed.success) {
    return jsonError(400, 'Neveljavni parametri posnetka.', 'params mora biti JSON objekt (ne niz) — posnetek + nastavitve.')
  }
  // velikostna varovalka ostaja (serializirana dolžina — fotografija je znotraj params)
  if (paramsParsed.data && JSON.stringify(paramsParsed.data).length > 4_000_000) {
    return jsonError(400, 'Posnetek je prevelik.', 'params (fotografija + nastavitve) presega 4 MB.')
  }
  const analysis = analysisParsed.data ?? null
  const params = paramsParsed.data ?? null
  // R467: razumevanje prizora (objekt → stroga validacija → shranitev objekta)
  const sceneUnderstanding = sanitizeSceneResult(body.sceneUnderstanding)
  // R542: sceneJson je jsonb — shranimo OBJEKT (prej JSON niz)
  const sceneJson = sceneUnderstanding ?? null
  if (!params && !analysis && !note && !sceneJson) {
    return jsonError(400, 'Posnetek potrebuje vsaj params (posnetek), analysis, scene ali opombo.')
  }

  // R537 (transakcijska celovitost): posnetek + revizija v ENI transakciji.
  // R542: analysis/params/sceneJson so jsonb objekti — null gre eksplicitno kot
  // DB NULL; zod (R542-b) je surove prehode nizov že zaprl.
  const snapshot = await db.$transaction(async (tx) => {
    const snapshot = await tx.arSnapshot.create({
      data: {
        projectId, authorId: user.id, scene,
        analysis: analysis ? analysis as Prisma.InputJsonValue : Prisma.DbNull,
        params: params ? params as Prisma.InputJsonValue : Prisma.DbNull,
        note,
        sceneJson: sceneJson !== null ? sceneJson as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      },
    })

    await writeAudit({
      userId: user.id,
      action: 'AR_SNAPSHOT_CREATE',
      entity: 'arSnapshot',
      entityId: snapshot.id,
      projectId,
      detail: { scene, hasPhoto: !!params, note, sceneElements: sceneUnderstanding?.elements.length ?? 0 },
    }, tx)
    return snapshot
  })

  return NextResponse.json({ data: { id: snapshot.id, createdAt: snapshot.createdAt } }, { status: 201 })
}

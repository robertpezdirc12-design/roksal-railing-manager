// /api/ar-snapshots/[id] — R454 (NAPREDNI AR): podrobnost, preimenovanje, brisanje.
// GET    (projects.read) — podrobnost Z params (posnetek) za predogled.
// PATCH  (measurements.write) — dopolnitev { scene?, note? } (preimenovanje/opis).
// DELETE (measurements.write) — brisanje posnetka → revizija AR_SNAPSHOT_DELETE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const snapshot = await db.arSnapshot.findUnique({
    where: { id },
    include: {
      author: { select: { name: true, role: true } },
      project: { select: { id: true, code: true, title: true } },
    },
  })
  if (!snapshot) return jsonError(404, 'AR posnetek ne obstaja.')
  return NextResponse.json({ data: snapshot })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const snapshot = await db.arSnapshot.findUnique({ where: { id }, select: { id: true, scene: true, note: true } })
  if (!snapshot) return jsonError(404, 'AR posnetek ne obstaja.')

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const scene = typeof body.scene === 'string' ? body.scene.trim().slice(0, 300) || null : undefined
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : undefined
  if (scene === undefined && note === undefined) {
    return jsonError(400, 'Podajte scene ali note.')
  }

  // R537 (transakcijska celovitost): preimenovanje/opis + revizija v ENI transakciji.
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.arSnapshot.update({
      where: { id },
      data: {
        ...(scene !== undefined ? { scene } : {}),
        ...(note !== undefined ? { note } : {}),
      },
      select: { id: true, scene: true, note: true },
    })

    await writeAudit({
      userId: user.id,
      action: 'AR_SNAPSHOT_UPDATE',
      entity: 'arSnapshot',
      entityId: id,
      detail: { before: { scene: snapshot.scene, note: snapshot.note }, after: { scene: updated.scene, note: updated.note } },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const snapshot = await db.arSnapshot.findUnique({ where: { id }, select: { id: true, projectId: true, scene: true } })
  if (!snapshot) return jsonError(404, 'AR posnetek ne obstaja.')

  // R537 (transakcijska celovitost): brisanje + revizija v ENI transakciji.
  await db.$transaction(async (tx) => {
    await tx.arSnapshot.delete({ where: { id } })

    await writeAudit({
      userId: user.id,
      action: 'AR_SNAPSHOT_DELETE',
      entity: 'arSnapshot',
      entityId: id,
      projectId: snapshot.projectId,
      detail: { scene: snapshot.scene },
    }, tx)
  })
  return NextResponse.json({ data: { ok: true, id } })
}

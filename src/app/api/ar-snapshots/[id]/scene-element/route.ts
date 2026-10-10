// /api/ar-snapshots/[id]/scene-element — R467 (issue #8 Faza 1, §2):
// POPRAVEK RAZREDA/STATUSA zaznanega elementa prizora.
// PATCH (measurements.write) { elementId, cls?, status?, kind? } →
//   popravek se shrani kot OZNAČEN PODATEK (append v sceneJson.edits),
//   izvirni element iz zajema SE NIKOLI NE PREPIŠE (revizija SCENE_EDIT).
// GET  (projects.read) — elementi z apliciranimi popravki (applyEdits) +
//   izvirniki + zgodovina popravkov (transparentnost).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import {
  SCENE_CLASSES, SCENE_LIMITS, SCENE_STATUSES, SURFACE_KINDS,
  applyEdits, sanitizeSceneResult, serializeSceneResult,
  type SceneUnderstandingResult,
} from '@/lib/scene-understanding-core'

type Params = { params: Promise<{ id: string }> }

function parseStored (raw: string | null): SceneUnderstandingResult | null {
  if (!raw) return null
  try {
    return sanitizeSceneResult(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const snapshot = await db.arSnapshot.findUnique({ where: { id }, select: { id: true, sceneJson: true } })
  if (!snapshot) return jsonError(404, 'AR posnetek ne obstaja.')

  const result = parseStored(snapshot.sceneJson)
  if (!result) return jsonError(404, 'Posnetek nima razumevanja prizora.')

  return NextResponse.json({
    data: {
      id: snapshot.id,
      result,
      displayed: applyEdits(result), // elementi Z apliciranimi popravki (za prikaz)
    },
  })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const snapshot = await db.arSnapshot.findUnique({ where: { id }, select: { id: true, sceneJson: true, projectId: true } })
  if (!snapshot) return jsonError(404, 'AR posnetek ne obstaja.')

  const result = parseStored(snapshot.sceneJson)
  if (!result) return jsonError(404, 'Posnetek nima razumevanja prizora.')

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')
  const elementId = typeof body.elementId === 'string' && body.elementId ? body.elementId : null
  if (!elementId) return jsonError(400, 'Podajte elementId.')

  const cls = SCENE_CLASSES.includes(body.cls) ? body.cls : undefined
  const status = SCENE_STATUSES.includes(body.status) ? body.status : undefined
  const kind = SURFACE_KINDS.includes(body.kind) ? body.kind : undefined
  if (!cls && !status && !kind) {
    return jsonError(400, `Podajte vsaj en popravek: cls (${SCENE_CLASSES.join('/')}), status (${SCENE_STATUSES.join('/')}) ali kind.`)
  }

  // element mora obstajati v izvirniku — popravek brez izvirnika je sumljiv
  const element = result.elements.find((e) => e.id === elementId)
  if (!element) return jsonError(404, 'Element prizora ne obstaja na tem posnetku.')

  if (result.edits.length >= SCENE_LIMITS.maxEdits) {
    return jsonError(409, 'Dosežen največji število popravkov na posnetku.')
  }

  const edit = { elementId, cls, status, kind, by: user.name || user.id, at: Date.now() }
  const updated: SceneUnderstandingResult = { ...result, edits: [...result.edits, edit] }

  await db.arSnapshot.update({
    where: { id },
    data: { sceneJson: serializeSceneResult(updated) },
    select: { id: true },
  })

  await writeAudit({
    userId: user.id,
    action: 'SCENE_EDIT',
    entity: 'arSnapshot',
    entityId: id,
    projectId: snapshot.projectId,
    detail: { edit, before: { cls: element.cls, status: element.status, kind: element.kind ?? null } },
  })

  return NextResponse.json({ data: { ok: true, edit } })
}

// /api/ar-snapshots/[id]/scene-element — R467 (issue #8 Faza 1, §2):
// POPRAVEK RAZREDA/STATUSA zaznanega elementa prizora.
// R468 (issue #8 Faza 2, §3): popravek NAKLONA (slopeDeg, ročno izmerjen
//   ali potrjen) — zapiše se z virom ROCNO + statusom IZMERJENO.
// R469 (issue #8 Faza 3, §4): popravek STOPNIC — potrjeno število nastopov
//   (steps, 1..20) in smer vzpenjanja (ascent: levo/desno/globina).
// R470 (issue #8 §5): popravek MERE — { label, valueCm, toleranceCm? } →
//   edit.measure; METODO izpelje applyEdits (prvi vnos na naziv =
//   ROCNI_VNOS, ponovni = ROCNO_POPRAVLJENO) — odjemalec je ne more določiti.
// R471 (issue #8 Faza 4): MERILO Z GLOBINO — { measure, depth } s VALJAVNIM
//   manifestom senzorja (depth) se zapiše kot senzorska pot: applyEdits iz
//   manifesta izpelje metodo DEPTH_AR (izjava izvora, ne trditev metode —
//   method polje ostane prezrto za DEPTH_AR). Neveljaven manifest → 400.
// PATCH (measurements.write) { elementId, cls?, status?, kind?, slopeDeg?, steps?, ascent?, measure?, depth? } →
//   popravek se shrani kot OZNAČEN PODATEK (append v sceneJson.edits),
//   izvirni element iz zajema SE NIKOLI NE PREPIŠE (revizija SCENE_EDIT).
// GET  (projects.read) — elementi z apliciranimi popravki (applyEdits) +
//   izvirniki + zgodovina popravkov (transparentnost).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import {
  SCENE_CLASSES, SCENE_LIMITS, SCENE_STATUSES, STAIR_ASCENTS, SURFACE_KINDS,
  applyEdits, isDepthManifest, sanitizeSceneResult, serializeSceneResult,
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
  // R468 (F2 §3): ročno potrjen naklon — veljavna številka znotraj meje
  const slopeDeg = typeof body.slopeDeg === 'number' && Number.isFinite(body.slopeDeg) &&
    Math.abs(body.slopeDeg) <= SCENE_LIMITS.slopeAbsMax
    ? Math.round(body.slopeDeg * 10) / 10
    : undefined
  // R469 (F3 §4): potrjeno število nastopov (celo število 1..maxSteps) + smer
  const stepsRaw = typeof body.steps === 'number' && Number.isFinite(body.steps) ? Math.round(body.steps) : null
  const steps = stepsRaw != null && stepsRaw >= 1 && stepsRaw <= SCENE_LIMITS.maxSteps ? stepsRaw : undefined
  const ascent = STAIR_ASCENTS.includes(body.ascent) ? body.ascent : undefined
  // R470 (§5): izmerjena mera — { label, valueCm, toleranceCm? }; metodo izpelje
  // applyEdits pri prikazu (ROCNI_VNOS oz. ROCNO_POPRAVLJENO) — surov vnos se
  // shrani kot označen podatek (edit.measure), izvirni element ostaja nedotaknjen.
  const mRaw = body.measure && typeof body.measure === 'object' ? body.measure as Record<string, unknown> : null
  let measure: { label: string; valueCm: number; toleranceCm?: number } | undefined
  if (mRaw) {
    const mLabel = typeof mRaw.label === 'string' ? mRaw.label.trim().slice(0, SCENE_LIMITS.measureLabelMaxLen) : ''
    const mVal = typeof mRaw.valueCm === 'number' && Number.isFinite(mRaw.valueCm) ? Math.round(mRaw.valueCm * 10) / 10 : null
    if (!mLabel || mVal == null || mVal < 0.1 || mVal > SCENE_LIMITS.measureCmMax) {
      return jsonError(400, `Neveljavna mera: label (1..${SCENE_LIMITS.measureLabelMaxLen} znakov) in valueCm (0,1..${SCENE_LIMITS.measureCmMax}) sta obvezna.`)
    }
    const mTol = typeof mRaw.toleranceCm === 'number' && Number.isFinite(mRaw.toleranceCm) &&
      mRaw.toleranceCm >= 0 && mRaw.toleranceCm <= mVal ? Math.round(mRaw.toleranceCm * 10) / 10 : undefined
    measure = { label: mLabel, valueCm: mVal, ...(mTol != null ? { toleranceCm: mTol } : {}) }
  }
  // R471 (F4): manifest senzorja globine — obvezen pri meri z globino (DEPTH_AR).
  // Veljaven manifest je izjava izvora (enaka raven zaupanja kot referenca pri
  // kalibrirani fotografiji); method polje mere se za DEPTH_AR IGNORIRA —
  // metodo izpelje applyEdits IZKLJUČNO iz manifesta.
  const depthRaw = body.depth != null ? body.depth : (mRaw != null && mRaw.depth != null ? mRaw.depth : null)
  let depth: ReturnType<typeof isDepthManifest> | undefined
  if (depthRaw != null) {
    depth = isDepthManifest(depthRaw)
    if (depth == null) {
      return jsonError(400, 'Neveljaven manifest senzorja globine (provider WEBXR_DEPTH, depthFormat, rawValueToMeters > 0, width/height 1..4096, focalPx > 0, timestamp).')
    }
    if (measure == null) {
      return jsonError(400, 'Manifest globine zahteva tudi measure { label, valueCm }.')
    }
  }
  if (!cls && !status && !kind && slopeDeg == null && steps == null && ascent == null && measure == null) {
    return jsonError(400, `Podajte vsaj en popravek: cls (${SCENE_CLASSES.join('/')}), status (${SCENE_STATUSES.join('/')}), kind, slopeDeg (±${SCENE_LIMITS.slopeAbsMax}°), steps (1..${SCENE_LIMITS.maxSteps}), ascent (${STAIR_ASCENTS.join('/')}) ali measure ({label, valueCm} [,{depth}]).`)
  }

  // element mora obstajati v izvirniku — popravek brez izvirnika je sumljiv
  const element = result.elements.find((e) => e.id === elementId)
  if (!element) return jsonError(404, 'Element prizora ne obstaja na tem posnetku.')

  if (result.edits.length >= SCENE_LIMITS.maxEdits) {
    return jsonError(409, 'Dosežen največji število popravkov na posnetku.')
  }

  const edit = { elementId, cls, status, kind, slopeDeg, steps, ascent, measure: measure != null ? { ...measure, ...(depth != null ? { depth } : {}) } : undefined, by: user.name || user.id, at: Date.now() }
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
    detail: {
      edit,
      // R471 (F4): povzetek izvora globine (sledljivost brez podvajanja)
      ...(depth != null ? { depthSource: { provider: depth.provider, format: depth.depthFormat, width: depth.width, height: depth.height, timestamp: depth.timestamp } } : {}),
      before: {
        cls: element.cls, status: element.status, kind: element.kind ?? null,
        slopeDeg: element.slopeDeg ?? null,
        steps: element.steps ?? null,
        ascent: element.ascent ?? null,
        // R470 (§5): prejšnje mere istega naziva (transparentnost popravka)
        measures: (element.measures ?? []).map((m) => ({ label: m.label, valueCm: m.valueCm, method: m.method })),
      },
    },
  })

  return NextResponse.json({ data: { ok: true, edit } })
}

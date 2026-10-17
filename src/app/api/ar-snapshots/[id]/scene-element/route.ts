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
// R485 (issue #8 — §1/§2): POST — ROČNO DODANA OZNAKA: zaznavanje nikoli ne
//   producira NEZNANO (poštenost), a je bila pot »tapni za označitev« slepa
//   ulica (monter ni mogel dodati elementa). { cls, bbox, label?, status? }
//   → nov element v sceneJson.elements z virom ROCNO; OSEBA ZAVRNJEN
//   (zasebnost §5); revizija SCENE_ELEMENT_ADD. PATCH — popravek kota ROBA
//   (angleDeg −90..360, normalizacija mod 180 v applyEdits).
// PATCH (measurements.write) { elementId, cls?, status?, kind?, slopeDeg?, steps?, ascent?, angleDeg?, measure?, depth? } →
//   popravek se shrani kot OZNAČEN PODATEK (append v sceneJson.edits),
//   izvirni element iz zajema SE NIKOLI NE PREPIŠE (revizija SCENE_EDIT).
// GET  (projects.read) — elementi z apliciranimi popravki (applyEdits) +
//   izvirniki + zgodovina popravkov (transparentnost).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import {
  SCENE_CLASSES, SCENE_LIMITS, SCENE_STATUSES, STAIR_ASCENTS, SURFACE_KINDS,
  applyEdits, isDepthManifest, newSceneId, sanitizeSceneResult,
  type SceneClass, SceneElement, SceneStatus, SceneUnderstandingResult, StairAscent, SurfaceKind,
} from '@/lib/scene-understanding-core'
import { Prisma } from '@prisma/client'

type Params = { params: Promise<{ id: string }> }

// R485: beli seznam razredov za ROČNO dodajanje — brez OSEBA (zasebnost §5:
// živa zaznava oseb se NE persistira).
const MANUAL_CLASSES = SCENE_CLASSES.filter((c) => c !== 'OSEBA')

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// elementId obvezen niz (kot prej — brez trim), cls/status/kind/ascent: znana
// vrednost iz seznama ⇒ vrednost, sicer tiho preskočeno (kot prej), slopeDeg:
// veljavno število znotraj ±meje ⇒ zaokroženo na 1 decimalko, sicer preskočeno
// (kot prej), steps: celo število 1..max ⇒ Math.round, sicer preskočeno (kot
// prej), angleDeg: število −90..360 (izven ⇒ izrecen 400 — monter mora vedeti,
// kot prej), measure/depth: posredovano handlerju (poslovna validacija z
// istimi sporočili — en vir resnice, kot prej).
const SceneElementPatchSchema = z.object({
  elementId: z.string({ error: 'Podajte elementId.' }).min(1, 'Podajte elementId.'),
  cls: z.unknown().transform((v) => (typeof v === 'string' && (SCENE_CLASSES as readonly string[]).includes(v) ? (v as SceneClass) : undefined)),
  status: z.unknown().transform((v) => (typeof v === 'string' && (SCENE_STATUSES as readonly string[]).includes(v) ? (v as SceneStatus) : undefined)),
  kind: z.unknown().transform((v) => (typeof v === 'string' && (SURFACE_KINDS as readonly string[]).includes(v) ? (v as SurfaceKind) : undefined)),
  slopeDeg: z.unknown().transform((v) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= SCENE_LIMITS.slopeAbsMax ? Math.round(v * 10) / 10 : undefined)),
  steps: z.unknown().transform((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
    const r = Math.round(v)
    return r >= 1 && r <= SCENE_LIMITS.maxSteps ? r : undefined
  }),
  ascent: z.unknown().transform((v) => (typeof v === 'string' && (STAIR_ASCENTS as readonly string[]).includes(v) ? (v as StairAscent) : undefined)),
  angleDeg: z.unknown()
    .superRefine((v, ctx) => {
      if (typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) > 360)) {
        ctx.addIssue({ code: 'custom', message: 'Neveljaven kot roba: angleDeg mora biti med −90 in 360 (stopinj).' })
      }
    })
    .transform((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined)),
  measure: z.unknown().optional(),
  depth: z.unknown().optional(),
})

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// cls iz belega seznama brez OSEBA (neznana/ne-razred vrednost ⇒ 400 z istim
// sporočilom, kot prej), status: iz seznama ali tihi privzetek PREPOZNANO
// (kot prej), bbox: [x, y, w, h] z vrednostmi 0..1 in w/h > 0 (oba 400 kot
// prej — ročni vnos se NE tiho popravlja), zaokroženo na 3 decimalke (kot
// prej), label: trim + omejitev, prazna ⇒ izpust (kot prej).
const SceneElementAddSchema = z.object({
  cls: z.enum(MANUAL_CLASSES, { error: `Razred mora biti iz: ${MANUAL_CLASSES.join('/')} (OSEBA ni dovoljen — živa zaznava oseb se ne persistira).` }),
  status: z.unknown().transform((v) => (typeof v === 'string' && (SCENE_STATUSES as readonly string[]).includes(v) ? (v as SceneStatus) : 'PREPOZNANO')),
  bbox: z.array(z.number({ error: 'bbox mora biti [x, y, w, h] z vrednostmi 0..1.' }))
    .length(4, 'bbox mora biti [x, y, w, h] z vrednostmi 0..1.')
    .refine((a) => a.every((v) => Number.isFinite(v) && v >= 0 && v <= 1), 'bbox mora biti [x, y, w, h] z vrednostmi 0..1.')
    .refine((a) => a[2] > 0 && a[3] > 0, 'bbox širina in višina morata biti večji od 0.')
    .transform((a) => a.map((v) => Math.round(v * 1000) / 1000) as [number, number, number, number]),
  label: z.string({ error: 'Oznaka mora biti besedilo.' }).trim().optional().transform((v) => (v ? v.slice(0, SCENE_LIMITS.elementLabelMaxLen) : undefined)),
})

// R542: sceneJson je jsonb objekt — sanitizeSceneResult (validator) neposredno,
// brez JSON.parse (slaba oblika → null → 404, kot prej).
function parseStored (raw: unknown): SceneUnderstandingResult | null {
  return sanitizeSceneResult(raw)
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

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, SceneElementPatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // R470 (§5): izmerjena mera — { label, valueCm, toleranceCm? }; metodo izpelje
  // applyEdits pri prikazu (ROCNI_VNOS oz. ROCNO_POPRAVLJENO) — surov vnos se
  // shrani kot označen podatek (edit.measure), izvirni element ostaja nedotaknjen.
  const mRaw = data.measure && typeof data.measure === 'object' ? data.measure as Record<string, unknown> : null
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
  const depthRaw = data.depth != null ? data.depth : (mRaw != null && mRaw.depth != null ? mRaw.depth : null)
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
  if (!data.cls && !data.status && !data.kind && data.slopeDeg == null && data.steps == null && data.ascent == null && data.angleDeg == null && measure == null) {
    return jsonError(400, `Podajte vsaj en popravek: cls (${SCENE_CLASSES.join('/')}), status (${SCENE_STATUSES.join('/')}), kind, slopeDeg (±${SCENE_LIMITS.slopeAbsMax}°), steps (1..${SCENE_LIMITS.maxSteps}), ascent (${STAIR_ASCENTS.join('/')}), angleDeg (−90..360°) ali measure ({label, valueCm} [,{depth}]).`)
  }

  // element mora obstajati v izvirniku — popravek brez izvirnika je sumljiv
  const element = result.elements.find((e) => e.id === data.elementId)
  if (!element) return jsonError(404, 'Element prizora ne obstaja na tem posnetku.')

  if (result.edits.length >= SCENE_LIMITS.maxEdits) {
    return jsonError(409, 'Dosežen največji število popravkov na posnetku.')
  }

  const edit = { elementId: data.elementId, cls: data.cls, status: data.status, kind: data.kind, slopeDeg: data.slopeDeg, steps: data.steps, ascent: data.ascent, angleDeg: data.angleDeg, measure: measure != null ? { ...measure, ...(depth != null ? { depth } : {}) } : undefined, by: user.name || user.id, at: Date.now() }
  const updated: SceneUnderstandingResult = { ...result, edits: [...result.edits, edit] }

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // zapis popravka v sceneJson + revizija SCENE_EDIT v ENI transakciji.
  await db.$transaction(async (tx) => {
    await tx.arSnapshot.update({
      where: { id },
      // R542: sceneJson je jsonb — objekt direktno (ne JSON niz)
      data: { sceneJson: updated as unknown as Prisma.InputJsonValue },
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
          angleDeg: element.angleDeg ?? null,
          // R470 (§5): prejšnje mere istega naziva (transparentnost popravka)
          measures: (element.measures ?? []).map((m) => ({ label: m.label, valueCm: m.valueCm, method: m.method })),
        },
      },
    }, tx)
  })

  return NextResponse.json({ data: { ok: true, edit } })
}

// R485 (issue #8 §1): ROČNO DODANA OZNAKA — »neprepoznano, tapni za
// označitev« prej ni imela poti: edini vir elementov je bila živa zanka,
// PATCH pa zahteva OBSTOJEČI elementId. Ta vrata omogočajo monterju, da na
// PERSISTIRANEM posnetku doda element, ki ga zaznavanje ni prepoznalo
// (privzeti razred NEZNANO — razred potem popravi PATCH/izbirnik).
// Nov element ima vir ROCNO in confidence 1 (izjava monterja) in gre MED
// elemente (NE med edits — ne prepisuje ničesar izvirnega). OSEBA je
// ZAVRNJENA (zasebnost §5: živa zaznava oseb se NE persistira).
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const snapshot = await db.arSnapshot.findUnique({ where: { id }, select: { id: true, sceneJson: true, projectId: true } })
  if (!snapshot) return jsonError(404, 'AR posnetek ne obstaja.')

  // IDOR: posnetek vezan na projekt — vezava mora biti veljavna (projekt
  // obstaja); revizija se zapiše pod projekt posnetka (sledljivost).
  if (snapshot.projectId != null) {
    const project = await db.project.findUnique({ where: { id: snapshot.projectId }, select: { id: true } })
    if (!project) return jsonError(404, 'Projekt posnetka ne obstaja.')
  }

  const result = parseStored(snapshot.sceneJson)
  if (!result) return jsonError(404, 'Posnetek nima razumevanja prizora.')

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d) —
  // razred (beli seznam brez OSEBA), status (privzetek PREPOZNANO), bbox in
  // opomba; vso logiko glej opombo ob SceneElementAddSchema zgoraj.
  const parsed = await parseBody(req, SceneElementAddSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  if (result.elements.length >= SCENE_LIMITS.maxElements) {
    return jsonError(409, 'Doseženo največje število elementov na posnetku.')
  }

  const element: SceneElement = {
    id: newSceneId(),
    cls: data.cls,
    status: data.status,
    source: 'ROCNO',
    confidence: 1,
    bbox: data.bbox,
    at: Date.now(),
    ...(data.label != null ? { label: data.label } : {}),
  }
  const updated: SceneUnderstandingResult = { ...result, elements: [...result.elements, element] }

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // dodajanje elementa v sceneJson + revizija SCENE_ELEMENT_ADD v ENI transakciji.
  await db.$transaction(async (tx) => {
    await tx.arSnapshot.update({
      where: { id },
      // R542: sceneJson je jsonb — objekt direktno (ne JSON niz)
      data: { sceneJson: updated as unknown as Prisma.InputJsonValue },
      select: { id: true },
    })

    await writeAudit({
      userId: user.id,
      action: 'SCENE_ELEMENT_ADD',
      entity: 'arSnapshot',
      entityId: id,
      projectId: snapshot.projectId,
      detail: {
        element: { id: element.id, cls: element.cls, status: element.status, source: element.source, bbox: element.bbox, label: data.label ?? null },
        // stanje pred dodajanjem — transparentnost koliko elementov je bilo izvirnih
        elementsBefore: result.elements.length,
      },
    }, tx)
  })

  return NextResponse.json({ data: { ok: true, element } }, { status: 201 })
}

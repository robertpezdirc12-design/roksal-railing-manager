// model-core — ROKSAL MERILNI MODEL (R473 — issue #9 §3 HOVER PARITY)
// IZPELJAVA merilno skalirane svetovne geometrije IZ ograjnega tekača
// (R460). Tekač ostaja VIR RESNICE (vozlišča/teren/kalibracija/verifikacije)
// — model je deterministična projekcija z lastno verzijo engine-a.
//
// NAČELO POŠTENOSTI (iz #8/#9): model ne izumlja podatkov.
//  • Tekač ne beleži smeri zavojev (le notranji kot) → smer LEVO/DESNO je
//    IZRECNA predpostavka klicatelja in je zapisana v quality.assumptions.
//  • Vogal brez kota → zvezno (brez loma) + predpostavka INFO.
//  • σ (ocena napake) iz EngineeringRule (tol_pozicija_modela) če obstaja,
//    sicer POŠTENO označena ocena po metodi kalibracije, sicer null.
//  • Nezajeto/nepreverjeno je vidno: verifiedShare, unverified, statusi po
//    segmentu (ESTIMATED … CONFIRMED) se prenesejo 1:1 iz tekača.
//
// Sključevanje: segmenti nosijo ključe `seg-N` (order 0-based → N = order+1)
// — ISTI ključi kot digitalni dvojček (capture-qa TwinSnapshotData) in
// prefab lističi. To omogoča prostorsko AS-* primerjavo in (F2) količine
// po segmentu.
//
// ČIST lib: NIČ strežniških uvozov — uporaben na odjemalcu (pregledovalnik)
// in strežniku (API). Deterministično, brez runtime AI.

import {
  CALIB_METHODS, terrainAt,
  type QualityResult, type RunCalibration, type NodeKind, type SegmentStatus,
} from '@/lib/fence-run-engine'

// ─── Verzija ────────────────────────────────────────────────────────────────

export const MODEL_ENGINE_VERSION = 'model-core/1.0'

// ─── Vrste ──────────────────────────────────────────────────────────────────

/** Svetovna točka v cm. Izvor = prvo vozlišče tekača, +X = smer prvega
 * segmenta, +Z = višina nad izhodiščem (0 = teren na izvoru). */
export interface ModelPoint { x: number; y: number; z: number }

export type CornerTurn = 'LEVO' | 'DESNO'

/** Vozlišče modela (fizična točka na terenu). */
export interface ModelNode {
  key: string // 'node-0' …
  kind: NodeKind
  atCm: number // položaj ob teku (cm) — isti vir kot tekač
  p: ModelPoint // tla (x, y, z=teren)
  heightCm: number | null // višina stebra nad terenom
  pritrditev: string | null
  podlaga: string | null
  gateWcm: number | null
  interiorDeg: number | null // samo VOGAL
  manual: boolean
  note: string | null
}

/** Segment modela — izpeljan iz tekača, ključ usklajen z dvojčkom/prefab. */
export interface ModelSegment {
  key: string // 'seg-1' … (ISTO kot twin/prefab)
  order: number
  fromKey: string
  toKey: string
  a: ModelPoint // tla začetka
  b: ModelPoint // tla konca
  lengthCm: number // 3D dolžina po padini (iz tekača)
  horizontalCm: number // horizontalna projekcija (plan)
  planCm: number // razdalja v tlorisu med a in b (XY)
  heightDiffCm: number
  slopeDeg: number
  interiorDeg: number | null // notranji kot na končnem vozlišču (VOGAL)
  heightCm: number | null // višina polnila
  posts: number // vmesni stebri
  status: SegmentStatus
  verifiedCm: number | null
  verifyMethod: string | null
  sigmaCm: number | null // ocena napake položaja (cm; vir v quality.sigmaSource)
}

/** Predpostavke izpeljave — IZRECNO zapisane, nikoli tihe. */
export interface ModelAssumption {
  code: 'ZAVOJ_SMER_PRIVZETA' | 'ZAVOJ_SMER_NASTAVLJENA' | 'VOGAL_BREZ_KOTA' | 'BREZ_KALIBRACIJE' | 'BREZ_TERENA'
  severity: 'INFO' | 'OPOZORILO'
  message: string
}

export interface ModelQuality {
  gate: { state: string; score: number } | null // iz tekača (qualityGate) če je podan
  verifiedShare: number // delež segmentov VERIFIED/CONFIRMED (0..1)
  unverified: number // št. segmentov brez preveritve
  sigmaCm: number | null // ocena napake položaja (cm)
  sigmaSource: 'RULE:tol_pozicija_modela' | 'OCENA_METODE' | 'NI_PODATKA'
  assumptions: ModelAssumption[]
}

export interface PlanModel {
  engineVersion: string
  units: 'cm'
  originNote: string // opis izvora/orientacije (človeško berljiv)
  run: { id: string; name: string; status: string; runVersion: number | null }
  nodes: ModelNode[]
  segments: ModelSegment[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number; minZ: number; maxZ: number }
  totalLengthCm: number
  totalPlanCm: number // dolžina po tlorisu (vsota planCm)
  closureGapCm: number | null // razlika začetek↔konec v tlorisu (informativno)
  quality: ModelQuality
}

// ─── σ iz vira (pošteno: pravilo > ocena metode > ni podatka) ───────────────

/** Tehniške ocene napake položaja po metodi kalibracije (cm) — NISO
 * preverjena pravila; uporabljene samo kadar EngineeringRule manjka.
 * PISNO označene kot OCENA_METODE (ne RULE). */
export const METHOD_SIGMA_CM: Record<string, number> = {
  LIDAR: 3,
  ZUNANJA_NAPRAVA: 5,
  MARKER: 8,
  ZNANA_MERA: 12,
  ROCNO: 25,
}

export function sigmaFromSources (
  ruleSigmaCm: number | null | undefined,
  calibration: RunCalibration | null
): { sigmaCm: number | null; sigmaSource: ModelQuality['sigmaSource'] } {
  if (ruleSigmaCm != null && Number.isFinite(ruleSigmaCm) && ruleSigmaCm > 0 && ruleSigmaCm <= 200) {
    return { sigmaCm: Math.round(ruleSigmaCm * 10) / 10, sigmaSource: 'RULE:tol_pozicija_modela' }
  }
  if (calibration && METHOD_SIGMA_CM[calibration.method] != null) {
    return { sigmaCm: METHOD_SIGMA_CM[calibration.method], sigmaSource: 'OCENA_METODE' }
  }
  return { sigmaCm: null, sigmaSource: 'NI_PODATKA' }
}

// ─── Izpeljava tlorisa (XY) iz verige ───────────────────────────────────────

/** Kot spremembe smeri pri vogalu (deg): notranji kot → zunanji zasuk.
 * interiorDeg 90 (prav kot) → zasuk 90°; 180 (ravno) → 0°. */
export function turnFromInterior (interiorDeg: number): number {
  return 180 - interiorDeg
}

function normDeg (d: number): number {
  let x = d
  while (x <= -180) x += 360
  while (x > 180) x -= 360
  return x
}

export interface BuildModelArgs {
  runId: string
  runName: string
  runStatus: string
  runVersion?: number | null
  /** razčlenjena vozlišča tekača (sortirana po atCm — isti vir kot engine) */
  nodes: {
    kind: NodeKind; atCm: number; heightCm?: number; pritrditev?: string; podlaga?: string
    interiorDeg?: number; gateWcm?: number; note?: string; manual?: boolean
  }[]
  /** obstoječi (persistirani) segmenti tekača — statusi/verifikacije */
  segments: {
    order: number; fromAtCm: number; toAtCm: number; lengthCm: number; horizontalCm?: number
    heightCm: number | null; angleDeg: number | null; slopeDeg: number; heightDiffCm: number
    posts: number; status: string; verifiedCm: number | null; verifyMethod: string | null
  }[]
  terrain: { distCm: number; elevCm: number }[] | null
  calibration: RunCalibration | null
  gate?: { state: string; score: number } | null
  /** smeri zavojev po vrstnem redu vogalov (index = zaporedje vogalov, ne
   *  vozlišč). Manjkajoči znaki → privzeta smer. Default: vse LEVO. */
  turns?: CornerTurn[]
  /** σ iz EngineeringRule (tol_pozicija_modela) — če obstaja */
  ruleSigmaCm?: number | null
}

/** Izpelje merilni model iz tekača. Deterministično; brez tihih predpostavk. */
export function buildPlanModel (args: BuildModelArgs): PlanModel {
  const assumptions: ModelAssumption[] = []
  const sorted = [...args.nodes].sort((a, b) => a.atCm - b.atCm)

  // σ (napaka položaja) — pošteno: pravilo > ocena metode > ni podatka
  const { sigmaCm, sigmaSource } = sigmaFromSources(args.ruleSigmaCm, args.calibration)
  if (!args.calibration) {
    assumptions.push({
      code: 'BREZ_KALIBRACIJE', severity: 'OPOZORILO',
      message: 'Tekač nima referenčne kalibracije — mere so ocena; model ni merilno zanesljiv.',
    })
  }
  if (!args.terrain || args.terrain.length === 0) {
    assumptions.push({
      code: 'BREZ_TERENA', severity: 'INFO',
      message: 'Manjka višinski profil terena — višine so glede na ravnino izhodišča.',
    })
  }

  // hoja po verigi → XY tloris
  const modelNodes: ModelNode[] = []
  let x = 0; let y = 0
  let heading = 0 // deg, 0 = +X
  let cornerIdx = 0
  let anyTurnSet = false

  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]
    if (i > 0) {
      // premik po smeri od prejšnjega vozlišča (plan = horizontalna projekcija)
      const d = Math.max(0, n.atCm - sorted[i - 1].atCm)
      const rad = (heading * Math.PI) / 180
      x += d * Math.cos(rad)
      y += d * Math.sin(rad)
    }
    // zasuk ob PRIHODU na vogal (lom je v vozlišču)
    if (n.kind === 'VOGAL' && n.interiorDeg != null) {
      const turn = turnFromInterior(n.interiorDeg)
      const dir = args.turns?.[cornerIdx] ?? 'LEVO'
      if (args.turns?.[cornerIdx] != null) anyTurnSet = true
      cornerIdx++
      heading = normDeg(dir === 'LEVO' ? heading + turn : heading - turn)
    } else if (n.kind === 'VOGAL') {
      assumptions.push({
        code: 'VOGAL_BREZ_KOTA', severity: 'INFO',
        message: `Vogal na ${(n.atCm / 100).toFixed(1)} m brez kota — prikazan zvezno (brez loma).`,
      })
    }
    modelNodes.push({
      key: `node-${i}`,
      kind: n.kind,
      atCm: n.atCm,
      p: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: terrainAt(args.terrain, n.atCm) },
      heightCm: n.heightCm ?? null,
      pritrditev: n.pritrditev ?? null,
      podlaga: n.podlaga ?? null,
      gateWcm: n.gateWcm ?? null,
      interiorDeg: n.interiorDeg ?? null,
      manual: n.manual === true,
      note: n.note ?? null,
    })
  }

  // predpostavka smeri zavojev — izrecno zapisana
  if (cornerIdx > 0) {
    assumptions.unshift(anyTurnSet
      ? {
          code: 'ZAVOJ_SMER_NASTAVLJENA', severity: 'INFO',
          message: `Smeri ${cornerIdx} zavojev so ročno nastavljene — tloris sledi tem izbiram.`,
        }
      : {
          code: 'ZAVOJ_SMER_PRIVZETA', severity: 'OPOZORILO',
          message: `Tekač ne beleži smeri zavojev (${cornerIdx} ${cornerIdx === 1 ? 'vogala' : 'vogalov'}) — privzeto LEVO; tloris je orientacijski, mere segmentov so neodvisne od te predpostavke.`,
        })
  }

  // segmenti — 1:1 iz tekača + ključi seg-N (usklajeno z dvojčkom/prefab)
  const segByOrder = new Map<number, BuildModelArgs['segments'][number]>()
  for (const s of args.segments) segByOrder.set(s.order, s)
  const modelSegments: ModelSegment[] = []
  for (let i = 0; i + 1 < modelNodes.length; i++) {
    const a = modelNodes[i]; const b = modelNodes[i + 1]
    const s = segByOrder.get(i)
    const planCm = Math.round(Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) * 10) / 10
    modelSegments.push({
      key: `seg-${i + 1}`, // tekačev order je 0-based; dvojček/prefab so 1-based
      order: i,
      fromKey: a.key,
      toKey: b.key,
      a: a.p,
      b: b.p,
      lengthCm: s?.lengthCm ?? Math.round(Math.hypot(b.atCm - a.atCm, b.p.z - a.p.z) * 10) / 10,
      horizontalCm: s?.horizontalCm ?? Math.round((b.atCm - a.atCm) * 10) / 10,
      planCm,
      heightDiffCm: s?.heightDiffCm ?? Math.round((b.p.z - a.p.z) * 10) / 10,
      slopeDeg: s?.slopeDeg ?? 0,
      interiorDeg: s?.angleDeg ?? null,
      heightCm: s?.heightCm ?? null,
      posts: s?.posts ?? 0,
      status: (s?.status ?? 'ESTIMATED') as SegmentStatus,
      verifiedCm: s?.verifiedCm ?? null,
      verifyMethod: s?.verifyMethod ?? null,
      sigmaCm,
    })
  }

  const verified = modelSegments.filter((s) => s.status === 'VERIFIED' || s.status === 'CONFIRMED').length
  const quality: ModelQuality = {
    gate: args.gate ?? null,
    verifiedShare: modelSegments.length > 0 ? Math.round((verified / modelSegments.length) * 100) / 100 : 0,
    unverified: modelSegments.length - verified,
    sigmaCm,
    sigmaSource,
    assumptions,
  }

  const xs = modelNodes.map((n) => n.p.x); const ys = modelNodes.map((n) => n.p.y); const zs = modelNodes.map((n) => n.p.z)
  const first = modelNodes[0]; const last = modelNodes[modelNodes.length - 1]

  return {
    engineVersion: MODEL_ENGINE_VERSION,
    units: 'cm',
    originNote: `Izvor = prvo vozlišče (${first ? first.key : '—'}), +X = smer prvega segmenta, +Z = gor. Vir: tekač ${args.runName} (verzija ${args.runVersion ?? 1}).`,
    run: { id: args.runId, name: args.runName, status: args.runStatus, runVersion: args.runVersion ?? null },
    nodes: modelNodes,
    segments: modelSegments,
    bounds: {
      minX: xs.length ? Math.min(...xs) : 0, minY: ys.length ? Math.min(...ys) : 0,
      maxX: xs.length ? Math.max(...xs) : 0, maxY: ys.length ? Math.max(...ys) : 0,
      minZ: zs.length ? Math.min(...zs) : 0, maxZ: zs.length ? Math.max(...zs) : 0,
    },
    totalLengthCm: Math.round(modelSegments.reduce((acc, s) => acc + s.lengthCm, 0) * 10) / 10,
    totalPlanCm: Math.round(modelSegments.reduce((acc, s) => acc + s.planCm, 0) * 10) / 10,
    closureGapCm: modelNodes.length >= 2
      ? Math.round(Math.hypot(last.p.x - first.p.x, last.p.y - first.p.y) * 10) / 10
      : null,
    quality,
  }
}

// ─── Projekcije (tloris / profil / 3D) — čista matematika za UI ─────────────

export interface PlanEdge { key: string; order: number; x1: number; y1: number; x2: number; y2: number; labelCm: number; status: string }

/** Tloris: povezave z merami za izris. */
export function projectPlan (m: PlanModel): PlanEdge[] {
  return m.segments.map((s) => ({
    key: s.key, order: s.order,
    x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y,
    labelCm: s.lengthCm, status: s.status,
  }))
}

/** Profil (elevacija): odvita ravnina ob teku — x = atCm, z = teren. */
export interface ProfilePoint { atCm: number; zGround: number; zTop: number | null; key: string; kind: NodeKind }
export interface ProfileSeg { key: string; order: number; x1: number; z1: number; x2: number; z2: number; slopeDeg: number; status: string }

export function projectProfile (m: PlanModel): { points: ProfilePoint[]; segs: ProfileSeg[] } {
  const points: ProfilePoint[] = m.nodes.map((n) => ({
    atCm: n.atCm, zGround: n.p.z, zTop: n.heightCm != null ? Math.round((n.p.z + n.heightCm) * 10) / 10 : null,
    key: n.key, kind: n.kind,
  }))
  const segs: ProfileSeg[] = m.segments.map((s) => ({
    key: s.key, order: s.order,
    x1: nodeByIndex(m, s.order)?.atCm ?? 0, z1: s.a.z,
    x2: nodeByIndex(m, s.order + 1)?.atCm ?? 0, z2: s.b.z,
    slopeDeg: s.slopeDeg, status: s.status,
  }))
  return { points, segs }
}

function nodeByIndex (m: PlanModel, i: number): ModelNode | undefined {
  return m.nodes[i]
}

/** Perspektivna projekcija svetovnih cm na zaslon (y svet navzdol → zaslon
 * gor). f = gorišče v px; yaw/pitch v stopinjah. Preprost pinhole — ENAK
 * pristop kot viz-3d (R464), prilagojen modelu. */
export function project3d (
  p: ModelPoint, yawDeg: number, pitchDeg: number, f: number
): { sx: number; sy: number; depth: number } {
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180
  const x1 = p.x * Math.cos(yaw) - p.y * Math.sin(yaw)
  const y1 = p.x * Math.sin(yaw) + p.y * Math.cos(yaw)
  const z1 = p.z
  const y2 = y1 * Math.cos(pitch) - z1 * Math.sin(pitch)
  const z2 = y1 * Math.sin(pitch) + z1 * Math.cos(pitch)
  const denom = Math.max(1, f - z2)
  return { sx: (x1 * f) / denom, sy: (-y2 * f) / denom, depth: z2 }
}

// ─── Zadetek segmenta v tlorisu (za klik v UI) ──────────────────────────────

/** Razdalja točke od daljice v cm + najbližji segment (≤ maxDistCm). */
export function nearestSegment (
  m: PlanModel, px: number, py: number, maxDistCm: number
): { key: string; distCm: number } | null {
  let best: { key: string; distCm: number } | null = null
  for (const s of m.segments) {
    const dx = s.b.x - s.a.x; const dy = s.b.y - s.a.y
    const len2 = dx * dx + dy * dy
    if (len2 < 0.01) continue
    let t = ((px - s.a.x) * dx + (py - s.a.y) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const cx = s.a.x + t * dx; const cy = s.a.y + t * dy
    const d = Math.hypot(px - cx, py - cy)
    if (d <= maxDistCm && (best === null || d < best.distCm)) best = { key: s.key, distCm: Math.round(d * 10) / 10 }
  }
  return best
}

// ─── Geometrijski diff modelov (AS-* po seg ključih — prostorska različica) ─

export interface ModelDiffRow {
  key: string
  metric: 'DOLZINA' | 'VISINA' | 'NAGIB' | 'STEBRI'
  a: number | null
  b: number | null
  diff: number | null
  unit: string
}

export interface ModelDiff {
  rows: ModelDiffRow[]
  compared: number
  deviations: number
  maxAbsDiffCm: number | null
  toleranceCm: number | null
}

/** Diff dveh modelov po ključih segmentov (cm/°/kos). Toleranca iz klicalca
 *  (EngineeringRule tol_dolzina_segmenta) — brez pravila je null (odkrito). */
export function diffModels (
  a: PlanModel, b: PlanModel, toleranceCm: number | null
): ModelDiff {
  const rows: ModelDiffRow[] = []
  let compared = 0
  let deviations = 0
  let maxAbs: number | null = null
  const mapA = new Map(a.segments.map((s) => [s.key, s]))
  for (const sb of b.segments) {
    const sa = mapA.get(sb.key)
    if (!sa) continue
    compared++
    const metrics: { m: ModelDiffRow['metric']; va: number | null; vb: number | null; unit: string }[] = [
      { m: 'DOLZINA', va: sa.lengthCm, vb: sb.lengthCm, unit: 'cm' },
      { m: 'VISINA', va: sa.heightCm, vb: sb.heightCm, unit: 'cm' },
      { m: 'NAGIB', va: sa.slopeDeg, vb: sb.slopeDeg, unit: '°' },
      { m: 'STEBRI', va: sa.posts, vb: sb.posts, unit: 'kos' },
    ]
    for (const { m, va, vb, unit } of metrics) {
      const diff = va != null && vb != null ? Math.round((vb - va) * 10) / 10 : null
      rows.push({ key: sb.key, metric: m, a: va, b: vb, diff, unit })
      if (m === 'DOLZINA' && diff != null) {
        maxAbs = maxAbs === null ? Math.abs(diff) : Math.max(maxAbs, Math.abs(diff))
        if (toleranceCm != null && Math.abs(diff) > toleranceCm) deviations++
      }
    }
  }
  return { rows, compared, deviations, maxAbsDiffCm: maxAbs === null ? null : Math.round(maxAbs * 10) / 10, toleranceCm }
}

// ─── Parserji (strežnik: turn niz iz query) ─────────────────────────────────

/** 'LD L' → ['LEVO','DESNO','LEVO'] (neznani znaki se preskočijo); prazno → []. */
export function parseTurns (v: string | null | undefined): CornerTurn[] | null {
  if (v == null) return null
  const s = v.trim().toUpperCase()
  if (!s) return []
  const out: CornerTurn[] = []
  for (const ch of s) {
    if (ch === 'L') out.push('LEVO')
    else if (ch === 'D') out.push('DESNO')
    else return null // neveljaven znak → zavrnjeno (fail-closed)
  }
  return out
}

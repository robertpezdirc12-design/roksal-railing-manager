// reality-r2p-service — strežniška logika REALITY-TO-PRODUCTION (R462 — issue #17)
// AS-BUILT QA poročilo (§9–§11/§27), 4D timeline (§15), provenance elementa
// (§13) in geo kontekst zajema. Tolerance IZKLJUČNO iz EngineeringRule (§12).

import { db } from '@/lib/db'
import {
  DEVIATION_STATUSES, HEAT_STATES, LOOP_STATUSES, R2P_VERSION, REG_QUALITY,
  deviationStatus, toleranceFromRules,
  type DeviationStatus, type HeatZone, type TolRuleMap,
} from '@/lib/reality-r2p-engine'
import { diffTwin, parseTwinData, type TwinSnapshotData } from '@/lib/capture-qa-engine'
import { parseNodes, parseTerrain } from '@/lib/fence-run-engine'

// ─── Tolerance iz EngineeringRule (§12) ─────────────────────────────────────

export async function toleranceRules (): Promise<TolRuleMap> {
  const rows = await db.engineeringRule.findMany({ where: { active: true } })
  const out: TolRuleMap = {}
  for (const r of rows) {
    out[r.key] = { value: r.value, unit: r.unit, label: r.label }
  }
  return out
}

export async function heightLimitRules (): Promise<{ minCm: number | null; maxCm: number | null }> {
  const rows = await db.engineeringRule.findMany({ where: { active: true, key: { in: ['visina_ograje_min', 'visina_ograje_max'] } } })
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null
  return { minCm: get('visina_ograje_min'), maxCm: get('visina_ograje_max') }
}

// ─── §9–§11: diff z tolerancami ─────────────────────────────────────────────

export interface DeviationRow {
  key: string
  label: string
  metric: 'DOLZINA' | 'VISINA' | 'KOT' | 'NAGIB' | 'STEBRI' | 'TOTAL'
  a: number | null
  b: number | null
  diff: number | null
  unit: string
  status: DeviationStatus
  ruleKey: string
}

export interface StageDiff {
  stage: 'MEASURED_VS_DESIGNED' | 'DESIGNED_VS_PRODUCED' | 'PRODUCED_VS_INSTALLED'
  label: string
  from: { id: string; version: number } | null
  to: { id: string; version: number } | null
  available: boolean
  rows: DeviationRow[]
  summary: { compared: number; within: number; review: number; blocking: number; noRule: number }
}

function stageRows (
  diff: ReturnType<typeof diffTwin>,
  rules: TolRuleMap,
  approvedOverrideKeys: Set<string> = new Set()
): DeviationRow[] {
  return diff.rows.map((r) => {
    const isAngle = r.unit === '°'
    const kind = r.metric === 'VISINA' ? 'height' : r.metric === 'KOT' ? 'angle' : r.metric === 'NAGIB' ? 'slope' : 'length'
    const tol = toleranceFromRules(rules, kind)
    let status = deviationStatus(r.diff != null ? Math.abs(r.diff) : null, tol, isAngle)
    // §10: odobrene spremembe (producedOverrideKeys) niso blokirajoče — so dokumentirane
    const segKey = r.key.split(':')[0]
    if (approvedOverrideKeys.has(segKey) && status !== 'WITHIN_TOLERANCE') {
      status = 'APPROVED_CHANGE'
    }
    return {
      key: r.key, label: r.label, metric: r.metric, a: r.a, b: r.b, diff: r.diff,
      unit: r.unit, status, ruleKey: tol.ruleKey,
    }
  })
}

async function latestTwin (projectId: string, kind: string): Promise<{ id: string; version: number; data: TwinSnapshotData | null } | null> {
  const s = await db.digitalTwinSnapshot.findFirst({ where: { projectId, kind }, orderBy: { version: 'desc' } })
  if (!s) return null
  // R542: data je jsonb — parseTwinData neposredno (vrne null ob napačni obliki)
  return { id: s.id, version: s.version, data: parseTwinData(s.data) }
}

async function stageDiff (
  projectId: string,
  stage: StageDiff['stage'],
  fromKind: string,
  toKind: string,
  label: string,
  rules: TolRuleMap
): Promise<StageDiff> {
  const from = await latestTwin(projectId, fromKind)
  const to = await latestTwin(projectId, toKind)
  const out: StageDiff = {
    stage, label,
    from: from ? { id: from.id, version: from.version } : null,
    to: to ? { id: to.id, version: to.version } : null,
    available: !!(from?.data && to?.data),
    rows: [],
    summary: { compared: 0, within: 0, review: 0, blocking: 0, noRule: 0 },
  }
  if (!out.available || !from?.data || !to?.data) return out
  const diff = diffTwin(from.data, to.data)
  // §10: za designed→produced upoštevaj odobrene overridе
  const approvedKeys = stage === 'DESIGNED_VS_PRODUCED' && to.data.producedOverrideKeys
    ? new Set(to.data.producedOverrideKeys)
    : new Set<string>()
  out.rows = stageRows(diff, rules, approvedKeys)
  out.summary = {
    compared: out.rows.filter((r) => r.diff != null).length,
    within: out.rows.filter((r) => r.status === 'WITHIN_TOLERANCE').length,
    review: out.rows.filter((r) => r.status === 'REVIEW_REQUIRED').length,
    blocking: out.rows.filter((r) => r.status === 'BLOCKING').length,
    noRule: out.rows.filter((r) => r.status === 'NO_VERIFIED_TOLERANCE_RULE').length,
  }
  return out
}

// ─── §27: AS-BUILT QA POROČILO ──────────────────────────────────────────────

export interface AsBuiltReport {
  projectId: string
  generatedAt: string
  engineVersion: string
  stages: StageDiff[]
  provenance: {
    kaj: string
    kje: string
    kdaj: string
    kako: string
    referenca: string
    kakovost: string
    kdo: string
    verzija: string
    izpeljanoIz: string
  }[]
  snapshotChain: { id: string; kind: string; version: number; reason: string; createdAt: string; userId: string | null }[]
  toleranceRulesDefined: { key: string; value: number; unit: string; label: string }[]
  verdict: {
    asBuiltOk: boolean
    blocking: number
    review: number
    message: string
  }
}

/** Celotno AS-BUILT QA poročilo (§27): vsi diffi + provenance + tolerance. */
export async function asBuiltReport (projectId: string): Promise<AsBuiltReport> {
  const rules = await toleranceRules()
  const [md, dp, pi] = await Promise.all([
    stageDiff(projectId, 'MEASURED_VS_DESIGNED', 'AS_MEASURED', 'AS_DESIGNED', 'AS-MEASURED ↔ AS-DESIGNED (§9)', rules),
    stageDiff(projectId, 'DESIGNED_VS_PRODUCED', 'AS_DESIGNED', 'AS_PRODUCED', 'AS-DESIGNED ↔ AS-PRODUCED (§10)', rules),
    stageDiff(projectId, 'PRODUCED_VS_INSTALLED', 'AS_PRODUCED', 'AS_INSTALLED', 'AS-PRODUCED ↔ AS-INSTALLED (§11)', rules),
  ])
  const stages = [md, dp, pi]
  const snapshots = await db.digitalTwinSnapshot.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, version: true, reason: true, createdAt: true, userId: true },
  })

  // provenance (§20) — iz snapshot verige
  const provenance: AsBuiltReport['provenance'] = snapshots.map((s) => ({
    kaj: `Digitalni dvojček ${s.kind} v${s.version}`,
    kje: `projekt ${projectId}`,
    kdaj: s.createdAt.toISOString(),
    kako: 'R461/R462 pipeline (capture QA → snapshot)',
    referenca: 'sources JSON na snapshotu',
    kakovost: 'quality gate iz zajema (R461 §3)',
    kdo: s.userId ?? 'sistem',
    verzija: `${s.kind} v${s.version}`,
    izpeljanoIz: s.reason,
  }))

  const blocking = stages.reduce((a, s) => a + s.summary.blocking, 0)
  const review = stages.reduce((a, s) => a + s.summary.review, 0)
  const tolRulesDefined = Object.entries(rules)
    .filter(([k]) => k.startsWith('tol_'))
    .map(([k, v]) => ({ key: k, value: v.value, unit: v.unit, label: v.label }))

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    engineVersion: R2P_VERSION,
    stages,
    provenance,
    snapshotChain: snapshots.map((s) => ({
      id: s.id, kind: s.kind, version: s.version,
      reason: s.reason, createdAt: s.createdAt.toISOString(), userId: s.userId,
    })),
    toleranceRulesDefined: tolRulesDefined,
    verdict: {
      asBuiltOk: blocking === 0 && stages.some((s) => s.available),
      blocking, review,
      message: blocking > 0
        ? `AS-BUILT NE USTREZA — ${blocking} blokirajočih odstopanj.`
        : stages.some((s) => s.available)
          ? review > 0 ? `AS-BUILT sprejet z ${review} odstopanji za kontrolo.` : 'AS-BUILT USTREZA — vsa odstopanja znotraj tolerance.'
          : 'Manjkajo snapshoti za AS-BUILT primerjavo (ustvarite zajem/načrt/proizvodnjo/montažo).',
    },
  }
}

// ─── §15: 4D TIMELINE ───────────────────────────────────────────────────────

export interface Timeline4d {
  entries: { t: string; label: string; at: string | null; detail: string }[]
}

/** Časovnica T0–T6 iz snapshotov + zajemov projekta (§15). */
export async function timeline4d (projectId: string): Promise<Timeline4d> {
  const [snapshots, sessions] = await Promise.all([
    db.digitalTwinSnapshot.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    db.captureSession.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
  ])
  const entries: Timeline4d['entries'] = []
  // T0 obstoječe stanje: prvi AS_MEASURED (ali zajem z obstoječim opisom)
  const firstMeasured = snapshots.find((s) => s.kind === 'AS_MEASURED')
  if (firstMeasured) {
    // R542: jsonb — brez JSON.parse
    const d = parseTwinData(firstMeasured.data)
    const obstojeco = d?.obstojeco?.opis ?? ''
    entries.push({ t: 'T0', label: 'OBSTOJEČE STANJE', at: firstMeasured.createdAt.toISOString(), detail: obstojeco || 'posneto z zajemom' })
  }
  const firstSession = sessions[0]
  if (firstSession) {
    entries.push({ t: 'T1', label: 'MERITEV', at: firstSession.createdAt.toISOString(), detail: `${sessions.length} zajem(ov) · ${firstSession.name}` })
  }
  const designed = snapshots.filter((s) => s.kind === 'AS_DESIGNED')
  if (designed.length > 0) {
    entries.push({ t: 'T2', label: 'NAČRT', at: designed[0].createdAt.toISOString(), detail: `${designed.length} verzij načrta` })
  }
  const quotes = await db.quote.count({ where: { projectId } })
  if (quotes > 0) {
    entries.push({ t: 'T3', label: 'PONUDBA/POTRDITEV', at: null, detail: `${quotes} ponudb` })
  }
  const produced = snapshots.filter((s) => s.kind === 'AS_PRODUCED')
  if (produced.length > 0) {
    entries.push({ t: 'T4', label: 'PROIZVODNJA', at: produced[0].createdAt.toISOString(), detail: `${produced.length} proizvodnih snapshotov` })
  }
  const installed = snapshots.filter((s) => s.kind === 'AS_INSTALLED')
  if (installed.length > 0) {
    entries.push({ t: 'T5', label: 'MONTAŽA', at: installed[0].createdAt.toISOString(), detail: `${installed.length} montažnih snapshotov` })
  }
  const serviceCases = await db.serviceCase.count({ where: { projectId } })
  if (serviceCases > 0 || snapshots.length > 1) {
    entries.push({ t: 'T6', label: 'SERVIS/SPREMEMBA', at: null, detail: serviceCases > 0 ? `${serviceCases} servisnih primerov` : `${snapshots.length} snapshotov skupaj` })
  }
  return { entries }
}

// ─── §13: ELEMENT PROVENANCE ────────────────────────────────────────────────

export interface ElementProvenance {
  key: string
  label: string
  photo: { zone: string; count: number } | null
  meritev: { id: string; lengthCm: number | null; heightCm: number | null; slopeDeg: number | null; source: string } | null
  tekač: { id: string; name: string; status: string } | null
  produkt: { productId: string; ime: string | null; varianta: string | null; ral: string | null } | null
  bom: { code: string; status: string; lines: number } | null
  snapshots: { kind: string; version: number; value: number | null }[]
  zgodovina: { opis: string; at: string }[]
}

/** Provenance elementa (§13): foto/2D/3D/meritev/produkt/BOM/montaža. */
export async function elementProvenance (projectId: string, key: string): Promise<ElementProvenance | null> {
  const run = await db.fenceRun.findFirst({
    where: { projectId },
    orderBy: { updatedAt: 'desc' },
    include: { segments: { orderBy: { order: 'asc' } }, measurement: true, product: true, variant: true },
  })
  const order = key.startsWith('seg-') ? parseInt(key.slice(4), 10) - 1 : NaN
  if (!run || !Number.isFinite(order) || order < 0 || order >= run.segments.length) return null
  const seg = run.segments[order]

  const photos = await db.capturePhoto.count({ where: { session: { projectId }, zone: key } })
  const bom = run.product
    ? await db.bom.findFirst({ where: { package: { projectId } }, orderBy: { createdAt: 'desc' }, include: { lines: { select: { id: true } } } })
    : null
  const snapshots = await db.digitalTwinSnapshot.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } })
  const snapValues: ElementProvenance['snapshots'] = []
  for (const s of snapshots) {
    // R542: data je jsonb — brez JSON.parse (slaba oblika → null → vrednost null)
    const d = parseTwinData(s.data)
    const v = d?.segments.find((x) => x.key === key)?.lengthCm ?? null
    snapValues.push({ kind: s.kind, version: s.version, value: v })
  }
  const versions = await db.fenceRunVersion.findMany({
    where: { fenceRunId: run.id },
    orderBy: { version: 'asc' },
    select: { version: true, note: true, createdAt: true },
    take: 10,
  })

  return {
    key,
    label: `Segment ${order + 1}`,
    photo: photos > 0 ? { zone: key, count: photos } : null,
    meritev: run.measurement
      ? { id: run.measurement.id, lengthCm: run.measurement.lengthCm, heightCm: run.measurement.heightCm, slopeDeg: run.measurement.slopeDeg, source: run.measurement.source }
      : null,
    tekač: { id: run.id, name: run.name, status: run.status },
    produkt: run.product
      ? { productId: run.productId ?? '', ime: run.product.name, varianta: run.variant?.name ?? null, ral: run.variant?.ral ?? null }
      : null,
    bom: bom ? { code: bom.code, status: bom.status, lines: bom.lines.length } : null,
    snapshots: snapValues,
    zgodovina: versions.map((v) => ({ opis: `verzija tekača v${v.version}: ${v.note ?? '—'}`, at: v.createdAt.toISOString() })),
  }
}

// ─── §16: RECAPTURE primerjava ──────────────────────────────────────────────

export interface RecaptureCompare {
  sessions: { id: string; name: string; createdAt: string; geoCount: number; photoCount: number; snapshotId: string | null }[]
  message: string
}

/** Ponovni zajem (§16): seznami zajemov projekta za primerjavo skozi čas. */
export async function recaptureOverview (projectId: string): Promise<RecaptureCompare> {
  const sessions = await db.captureSession.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    include: { geoRefs: { select: { id: true } }, photos: { select: { id: true } } },
  })
  return {
    sessions: sessions.map((s) => ({
      id: s.id, name: s.name, createdAt: s.createdAt.toISOString(),
      geoCount: s.geoRefs.length, photoCount: s.photos.length, snapshotId: s.snapshotId,
    })),
    message: sessions.length > 1
      ? `${sessions.length} zajemov na isti lokaciji — primerjajte snapshot-e (diff) in georeference skozi čas.`
      : 'Za primerjavo skozi čas je potreben vsaj še en zajem iste lokacije.',
  }
}

// ─── geo kontekst zajema ────────────────────────────────────────────────────

export interface GeoContext {
  geoRefs: {
    id: string; code: string; tier: string; lat: number; lon: number; altM: number | null
    atCm: number | null; coordinateSystem: string; datum: string | null; geoid: string | null
    hAccM: number | null; vAccM: number | null; source: string; rtkStatus: string | null
    correctionAgeSec: number | null; device: string | null; status: string; note: string | null
    createdAt: string
  }[]
  registrations: { id: string; version: number; quality: string; rmsCm: number; transform: unknown; createdAt: string }[]
  loops: { id: string; status: string; positionDiffCm: number; heightDiffCm: number | null; startCode: string; endCode: string; createdAt: string }[]
}

export async function geoContext (sessionId: string): Promise<GeoContext> {
  const [refs, regs, loops] = await Promise.all([
    db.geoReference.findMany({ where: { sessionId }, orderBy: { atCm: 'asc' } }),
    db.registration.findMany({ where: { sessionId }, orderBy: { version: 'desc' } }),
    db.loopClosure.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' } }),
  ])
  return {
    geoRefs: refs.map((r) => ({
      id: r.id, code: r.code, tier: r.tier, lat: r.lat, lon: r.lon, altM: r.altM,
      atCm: r.atCm, coordinateSystem: r.coordinateSystem, datum: r.datum, geoid: r.geoid,
      hAccM: r.hAccM, vAccM: r.vAccM, source: r.source, rtkStatus: r.rtkStatus,
      correctionAgeSec: r.correctionAgeSec, device: r.device, status: r.status, note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
    registrations: regs.map((r) => ({
      id: r.id, version: r.version, quality: r.quality, rmsCm: r.rmsCm,
      transform: r.transform, createdAt: r.createdAt.toISOString(),
    })),
    loops: loops.map((l) => ({
      id: l.id, status: l.status, positionDiffCm: l.positionDiffCm, heightDiffCm: l.heightDiffCm,
      startCode: l.startCode, endCode: l.endCode, createdAt: l.createdAt.toISOString(),
    })),
  }
}

// ─── pomožno za UI preslikave ───────────────────────────────────────────────

export const R2P_LABELS = { DEVIATION_STATUSES, HEAT_STATES, LOOP_STATUSES, REG_QUALITY }

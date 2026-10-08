// capture-qa-service — strežniška logika zajema QA + digitalnega dvojčka
// (R461 — issue #16). Persist + kanonični izračuni iz capture-qa-engine;
// tekač (R460) ostaja vir geometrije — ta sloj NE podvaja engine-a.
// Brez runtime AI, brez fuzzy matchinga, brez tihih sprememb (§25).

import { db } from '@/lib/db'
import {
  CAPTURE_QA_VERSION, buildAsDesigned, buildAsInstalled, buildAsMeasured, buildAsProduced,
  computeCoverage, crossCheckSources, criticalGate, deviceTier, diffTwin, driftStatus,
  outdoorReliability, parseDevice, parseDrift, parseOutdoor, parsePlan, parseQuality, parseState,
  parseTwinData, referenceNetwork,
  type CoverageResult, type CrossCheckRow, type DeviceCapsInput, type DeviceTier,
  type DriftSample, type DriftState, type GateSegment, type MissingItem,
  type OutdoorResult, type PlanStop, type RefNetworkResult, type TwinSnapshotData,
} from '@/lib/capture-qa-engine'
import { parseNodes, parseTerrain, round1, type RunNode, type TerrainPoint } from '@/lib/fence-run-engine'

// ─── Kontekst zajema ────────────────────────────────────────────────────────

export interface CaptureRefRow {
  id: string; code: string; label: string | null; atCm: number; measureCm: number
  method: string; device: string | null; operatorId: string | null
  status: string; confidence: number | null; note: string | null; createdAt: Date
}

export interface CapturePhotoRow {
  id: string; clientKey: string; zone: string; quality: string | null
  offsetCm: number | null; thumb: string | null; capturedAt: Date
}

export interface CaptureContext {
  session: {
    id: string; projectId: string; workOrderId: string | null; fenceRunId: string | null
    authorId: string | null; name: string; status: string; mode: string
    device: string | null; outdoor: string | null; plan: string | null; state: string | null
    coverage: string | null; drift: string | null; snapshotId: string | null; note: string | null
  }
  plan: PlanStop[]
  device: { tier: DeviceTier; caps: DeviceCapsInput } | null
  outdoor: { conditions: string[]; note?: string } | null
  state: { currentStopId: string | null; doneStops: string[] }
  refs: CaptureRefRow[]
  photos: CapturePhotoRow[]
  run: {
    id: string; name: string; status: string; measurementId: string | null
    nodes: RunNode[]; terrain: TerrainPoint[] | null; hasCalibration: boolean
    segments: GateSegment[]
  } | null
}

function safeParse<T> (json: string | null, fn: (v: unknown) => T | null, fallback: T): T {
  if (!json) return fallback
  try { return fn(JSON.parse(json)) ?? fallback } catch { return fallback }
}

/** Naloži zajem z razčlenjenim stanjem + vezanim tekačem (če je FENCE_RUN). */
export async function loadCaptureContext (sessionId: string): Promise<CaptureContext | null> {
  const s = await db.captureSession.findUnique({
    where: { id: sessionId },
    include: {
      references: { orderBy: { atCm: 'asc' } },
      photos: { orderBy: { capturedAt: 'asc' } },
    },
  })
  if (!s) return null

  let run: CaptureContext['run'] = null
  if (s.fenceRunId) {
    const fr = await db.fenceRun.findUnique({
      where: { id: s.fenceRunId },
      include: { segments: { orderBy: { order: 'asc' } } },
    })
    if (fr) {
      run = {
        id: fr.id, name: fr.name, status: fr.status, measurementId: fr.measurementId,
        nodes: safeParse(fr.nodes, parseNodes, []),
        terrain: safeParse(fr.terrain, parseTerrain, null),
        hasCalibration: safeParse(fr.calibration, (v) => (v && typeof v === 'object' ? v as object : null), null) != null,
        segments: fr.segments.map((seg) => ({
          order: seg.order, fromAtCm: seg.fromAtCm, toAtCm: seg.toAtCm,
          lengthCm: seg.lengthCm, heightCm: seg.heightCm, slopeDeg: seg.slopeDeg,
          angleDeg: seg.angleDeg, status: seg.status, hasGate: seg.toKind === 'VRATA',
        })),
      }
    }
  }

  return {
    session: {
      id: s.id, projectId: s.projectId, workOrderId: s.workOrderId, fenceRunId: s.fenceRunId,
      authorId: s.authorId, name: s.name, status: s.status, mode: s.mode,
      device: s.device, outdoor: s.outdoor, plan: s.plan, state: s.state,
      coverage: s.coverage, drift: s.drift, snapshotId: s.snapshotId, note: s.note,
    },
    plan: safeParse(s.plan, parsePlan, []),
    device: safeParse(s.device, parseDevice, null as unknown as { tier: DeviceTier; caps: DeviceCapsInput } | null),
    outdoor: safeParse(s.outdoor, parseOutdoor, { conditions: [] }),
    state: safeParse(s.state, parseState, { currentStopId: null, doneStops: [] }),
    refs: s.references.map((r) => ({
      id: r.id, code: r.code, label: r.label, atCm: r.atCm, measureCm: r.measureCm,
      method: r.method, device: r.device, operatorId: r.operatorId,
      status: r.status, confidence: r.confidence, note: r.note, createdAt: r.createdAt,
    })),
    photos: s.photos.map((p) => ({
      id: p.id, clientKey: p.clientKey, zone: p.zone, quality: p.quality,
      offsetCm: p.offsetCm, thumb: p.thumb, capturedAt: p.capturedAt,
    })),
    run,
  }
}

// ─── Preverjanje mreže referenc (§4) + persist statusov ─────────────────────

/** Preveri verigo referenc in posodobi statuse (KONFLIKT izrecen, ne tih). */
export async function syncReferenceStatuses (sessionId: string): Promise<RefNetworkResult> {
  const refs = await db.captureReference.findMany({
    where: { sessionId },
    orderBy: { atCm: 'asc' },
  })
  const net = referenceNetwork(refs.map((r) => ({
    code: r.code, atCm: r.atCm, measureCm: r.measureCm, method: r.method, status: r.status,
  })))
  // pari so v vrstnem redu; konflikt para oznaci TO referenco
  const conflictCodes = new Set(net.pairs.filter((p) => p.conflict).map((p) => p.toCode))
  for (const r of refs) {
    if (r.status === 'ZAVRACENA') continue // ročno rešene ostanejo
    const should = conflictCodes.has(r.code) ? 'KONFLIKT' : 'AKTIVNA'
    if (r.status !== should) {
      await db.captureReference.update({ where: { id: r.id }, data: { status: should } })
    }
  }
  return net
}

// ─── Ponovni izračun pokritosti + drifta (ob vsakem posnetku) ───────────────

export interface SessionAnalysis {
  plan: PlanStop[]
  coverage: CoverageResult
  drift: { samples: DriftSample[]; state: DriftState; lastRefCode: string | null; maxAbsCm: number }
  refs: RefNetworkResult
  outdoorFactor: number
  requireExtraReference: boolean
  criticalGate: { ponudba: boolean; konfiguracija: boolean; proizvodnja: boolean; manjka: MissingItem[] } | null
  gates: {
    coverageOk: boolean
    stopsDone: boolean
    referencesOk: boolean
    driftOk: boolean
    allOk: boolean
    reasons: string[]
  }
}

/** Izračuna pokritost + drift iz posnetkov ter SHRANI na zajem. */
export async function recomputeSession (ctx: CaptureContext): Promise<{ coverage: CoverageResult; drift: ReturnType<typeof driftStatus> }> {
  const photos = ctx.photos.map((p) => ({
    zone: p.zone,
    quality: safeParse(p.quality, parseQuality, {}),
  }))
  const coverage = computeCoverage(ctx.plan, photos)
  const samples: DriftSample[] = ctx.photos
    .filter((p) => p.offsetCm != null)
    .map((p) => ({ offsetCm: p.offsetCm as number, ts: p.capturedAt.toISOString() }))
  const drift = driftStatus(samples)
  const driftState = safeParse(ctx.session.drift, parseDrift, { samples: [], status: 'DRIFT_OK' as DriftState, lastRefCode: null })
  // ročni vzorci (iz POST /drift) ostanejo združeni s foto vzorci
  const manual = driftState.samples.filter((m) => !samples.some((s) => s.ts === m.ts && s.offsetCm === m.offsetCm))
  const all = [...samples, ...manual]
  const combined = driftStatus(all)
  await db.captureSession.update({
    where: { id: ctx.session.id },
    data: {
      coverage: JSON.stringify(coverage),
      drift: JSON.stringify({ samples: all.slice(-200), status: combined.state, lastRefCode: driftState.lastRefCode }),
    },
  })
  return { coverage, drift: combined }
}

/** Celotna analiza zajema (GET resume + finish vrata). */
export async function analyzeSession (ctx: CaptureContext): Promise<SessionAnalysis> {
  const { coverage, drift } = await recomputeSession(ctx)
  const net = await syncReferenceStatuses(ctx.session.id)
  // ponovno naloži statuse referenc po sinhronizaciji
  const freshRefs = await db.captureReference.findMany({
    where: { sessionId: ctx.session.id },
    orderBy: { atCm: 'asc' },
  })
  const netFresh = referenceNetwork(freshRefs.map((r) => ({
    code: r.code, atCm: r.atCm, measureCm: r.measureCm, method: r.method, status: r.status,
  })))
  const outdoorRes: OutdoorResult = outdoorReliability(ctx.outdoor?.conditions ?? [])

  // kritična vrata mer iz tekača (§7)
  let gate: SessionAnalysis['criticalGate'] = null
  if (ctx.run && ctx.run.segments.length > 0) {
    const hasPodlaga = ctx.run.nodes.some((n) => n.podlaga != null)
    gate = criticalGate({
      segments: ctx.run.segments,
      hasCalibration: ctx.run.hasCalibration,
      hasTerrain: ctx.run.terrain != null && ctx.run.terrain.length > 0,
      hasPodlaga,
    })
  }

  // vrata zaključka (§1/§2/§3/§4/§16)
  const reasons: string[] = []
  const coverageOk = coverage.gateOk
  if (!coverageOk) {
    const primeri = coverage.criticalMissing.slice(0, 3).join('; ')
    reasons.push(`Pokritost: manjka ${coverage.criticalMissing.length} kritičnih con (${primeri}${coverage.criticalMissing.length > 3 ? '; …' : ''}).`)
  }
  const criticalActions = ctx.plan.filter((p) => p.critical && ['REFERENCA', 'COVERAGE', 'KALIBRACIJA'].includes(p.kind))
  const missingActions = criticalActions.filter((p) => !ctx.state.doneStops.includes(p.id))
  const stopsDone = missingActions.length === 0
  if (!stopsDone) reasons.push(`Vodena ruta: obvezni koraki niso opravljeni (${missingActions.map((m) => m.label).join('; ')}).`)
  const activeCount = freshRefs.filter((r) => r.status !== 'ZAVRACENA').length
  const refsOk = netFresh.conflicts.length === 0 && activeCount >= 1 && (!outdoorRes.requireExtraReference || activeCount >= 2)
  if (netFresh.conflicts.length > 0) reasons.push(`REFERENCE CONFLICT: ${netFresh.conflicts.length} konflikt(ov) — zahtevana preverba.`)
  if (activeCount < 1) reasons.push('Manjka vsaj ena aktivna referenčna točka.')
  if (outdoorRes.requireExtraReference && activeCount < 2) reasons.push('Zunanji pogoji zmanjšujejo zanesljivost — obvezna dodatna referenca (§16).')
  const driftOk = drift.state !== 'RE_LOC_REQUIRED'
  if (!driftOk) reasons.push('Drift presega toleranco — potrebna RE-LOKALIZACIJA (nova referenca + ponovni zajem).')

  return {
    plan: ctx.plan,
    coverage,
    drift: { samples: [], state: drift.state, lastRefCode: safeParse(ctx.session.drift, parseDrift, { samples: [], status: 'DRIFT_OK' as DriftState, lastRefCode: null }).lastRefCode, maxAbsCm: drift.maxAbsCm },
    refs: netFresh,
    outdoorFactor: outdoorRes.factor,
    requireExtraReference: outdoorRes.requireExtraReference,
    criticalGate: gate,
    gates: {
      coverageOk, stopsDone, referencesOk: refsOk, driftOk,
      allOk: coverageOk && stopsDone && refsOk && driftOk,
      reasons,
    },
  }
}

// ─── Zaključek zajema (§1/§26) → AS-MEASURED snapshot ───────────────────────

export interface FinishResult {
  ok: boolean
  reasons?: string[]
  snapshotId?: string
  version?: number
}

/** Zaključi zajem: vsa vrata morajo pasti → ustvari AS-MEASURED snapshot. */
export async function finishCaptureSession (
  ctx: CaptureContext,
  userId: string,
  obstojeco: string | null
): Promise<FinishResult> {
  if (ctx.session.status === 'ZAKLJUCEN') {
    return { ok: false, reasons: ['Zajem je že zaključen.'] }
  }
  const analysis = await analyzeSession(ctx)
  if (!analysis.gates.allOk) {
    return { ok: false, reasons: analysis.gates.reasons }
  }
  const fresh = await loadCaptureContext(ctx.session.id)
  if (!fresh) return { ok: false, reasons: ['Zajem ne obstaja več.'] }

  const data = buildAsMeasured({
    segments: fresh.run?.segments ?? [],
    terrain: fresh.run?.terrain ? fresh.run.terrain.map((t) => ({ atCm: t.distCm, elevCm: t.elevCm })) : null,
    refs: fresh.refs.map((r) => ({
      code: r.code, atCm: r.atCm, measureCm: r.measureCm, method: r.method, status: r.status,
    })),
    coverage: analysis.coverage,
    device: fresh.device ? { tier: fresh.device.tier } : null,
    outdoor: fresh.outdoor ? { conditions: fresh.outdoor.conditions, factor: analysis.outdoorFactor } : null,
    photoCount: fresh.photos.length,
    obstojeco,
  })

  const snapshot = await createTwinSnapshotRow({
    projectId: fresh.session.projectId,
    kind: 'AS_MEASURED',
    data,
    sources: [
      ...(fresh.session.fenceRunId ? [{ vrsta: 'fenceRun', id: fresh.session.fenceRunId }] : []),
      ...(fresh.run?.measurementId ? [{ vrsta: 'measurement', id: fresh.run.measurementId }] : []),
    ],
    reason: `Zaključen zajem »${fresh.session.name}« (pokritost ${analysis.coverage.zones.length} con, ${fresh.photos.length} posnetkov, ${fresh.refs.length} referenc).`,
    createdFrom: fresh.session.id,
    userId,
  })

  await db.captureSession.update({
    where: { id: fresh.session.id },
    data: { status: 'ZAKLJUCEN', snapshotId: snapshot.id },
  })
  return { ok: true, snapshotId: snapshot.id, version: snapshot.version }
}

// ─── Digitalni dvojček: snapshoti (§8–§12/§22) ──────────────────────────────

export async function createTwinSnapshotRow (args: {
  projectId: string
  kind: 'AS_MEASURED' | 'AS_DESIGNED' | 'AS_PRODUCED' | 'AS_INSTALLED'
  data: TwinSnapshotData
  sources: { vrsta: string; id: string; version?: number | null }[]
  reason: string
  createdFrom?: string | null
  userId: string
}): Promise<{ id: string; version: number }> {
  const last = await db.digitalTwinSnapshot.findFirst({
    where: { projectId: args.projectId, kind: args.kind },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  })
  const version = (last?.version ?? 0) + 1
  const created = await db.digitalTwinSnapshot.create({
    data: {
      projectId: args.projectId,
      kind: args.kind,
      version,
      parentSnapshotId: last?.id ?? null,
      data: JSON.stringify(args.data),
      sources: JSON.stringify(args.sources),
      reason: args.reason.slice(0, 500),
      createdFrom: args.createdFrom ?? null,
      userId: args.userId,
    },
  })
  return { id: created.id, version }
}

/** Zadnji snapshot dane vrste (ali null). */
export async function latestSnapshot (projectId: string, kind: string): Promise<{ id: string; version: number; data: TwinSnapshotData | null } | null> {
  const s = await db.digitalTwinSnapshot.findFirst({
    where: { projectId, kind },
    orderBy: { version: 'desc' },
  })
  if (!s) return null
  return { id: s.id, version: s.version, data: safeParse(s.data, parseTwinData, null as unknown as TwinSnapshotData | null) }
}

/** Segmenti iz meritev projekta (iz tekačev, sicer polja meritve). */
export async function segmentsZaProjekt (projectId: string): Promise<{ segments: GateSegment[]; measurementId: string | null; totalCm: number }> {
  const runs = await db.fenceRun.findMany({
    where: { projectId },
    orderBy: { updatedAt: 'desc' },
    include: { segments: { orderBy: { order: 'asc' } } },
    take: 1,
  })
  const run = runs[0]
  if (run && run.segments.length > 0) {
    return {
      segments: run.segments.map((seg) => ({
        order: seg.order, fromAtCm: seg.fromAtCm, toAtCm: seg.toAtCm,
        lengthCm: seg.lengthCm, heightCm: seg.heightCm, slopeDeg: seg.slopeDeg,
        angleDeg: seg.angleDeg, status: seg.status, hasGate: seg.toKind === 'VRATA',
      })),
      measurementId: run.measurementId,
      totalCm: round1(run.segments.reduce((a, s) => a + s.lengthCm, 0)),
    }
  }
  // brez tekača: zadnja kanonična meritev kot en segment
  const m = await db.measurement.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  })
  if (m && m.lengthCm != null && m.lengthCm > 0) {
    return {
      segments: [{
        order: 0, fromAtCm: 0, toAtCm: m.lengthCm, lengthCm: m.lengthCm,
        heightCm: m.heightCm, slopeDeg: m.slopeDeg ?? 0, angleDeg: null,
        status: 'MANUAL', hasGate: false,
      }],
      measurementId: m.id,
      totalCm: m.lengthCm,
    }
  }
  return { segments: [], measurementId: null, totalCm: 0 }
}

// ─── AS-DESIGNED iz projektnega paketa (§10) ────────────────────────────────

export async function buildDesignedSnapshot (args: {
  projectId: string
  packageId: string
  fotoVizId?: string | null
  reason: string
  userId: string
}): Promise<
  | { ok: true; snapshotId: string; version: number }
  | { ok: false; status: number; error: string; detail?: string }
> {
  const pkg = await db.projectPackage.findUnique({
    where: { id: args.packageId },
    include: { product: true, variant: true, measurement: true },
  })
  if (!pkg) return { ok: false, status: 404, error: 'Paket ne obstaja.' }
  if (pkg.projectId !== args.projectId) return { ok: false, status: 400, error: 'Paket pripada drugemu projektu.' }

  let fotoViz: { id: string; variantLabel: string; engineVersion: string } | null = null
  if (args.fotoVizId) {
    const pv = await db.photoVisualization.findUnique({ where: { id: args.fotoVizId } })
    if (!pv) return { ok: false, status: 404, error: 'Foto-vizualizacija ne obstaja.' }
    if (pv.projectId !== args.projectId) return { ok: false, status: 400, error: 'Foto-vizualizacija pripada drugemu projektu.' }
    // §19: vizualizacija MORA biti vezana na ISTO konfiguracijo (paket)
    if (pv.productId !== pkg.productId || (pkg.variantId && pv.variantId && pv.variantId !== pkg.variantId)) {
      return {
        ok: false, status: 409, error: 'Konfiguracija vizualizacije se ne ujema s paketom.',
        detail: '§19: en objekt → ena verzirana konfiguracija. Merilna in vizualizacijska konfiguracija morata biti isti.',
      }
    }
    fotoViz = { id: pv.id, variantLabel: pv.variantLabel, engineVersion: pv.engineVersion }
  }

  const base = await segmentsZaProjekt(args.projectId)
  let config: Record<string, unknown> | null = null
  if (pkg.calcJson) {
    try { config = JSON.parse(pkg.calcJson) as Record<string, unknown> } catch { config = null }
  }
  const data = buildAsDesigned({
    segments: base.segments.map((s) => ({
      key: `seg-${s.order + 1}`, label: `Segment ${s.order + 1}`, lengthCm: s.lengthCm,
      heightCm: s.heightCm, slopeDeg: s.slopeDeg, angleDeg: s.angleDeg, posts: null,
    })),
    totalLengthCm: base.segments.length > 0 ? round1(base.segments.reduce((a, s) => a + s.lengthCm, 0)) : null,
    produkt: {
      productId: pkg.productId, variantId: pkg.variantId,
      ime: pkg.product?.name ?? '', varianta: pkg.variant?.name ?? null,
      ral: pkg.variant?.ral ?? null,
    },
    config,
    fotoViz,
    measurement: base.measurementId ? { id: base.measurementId, version: null } : null,
  })
  const snap = await createTwinSnapshotRow({
    projectId: args.projectId,
    kind: 'AS_DESIGNED',
    data,
    sources: [
      { vrsta: 'package', id: pkg.id },
      { vrsta: 'product', id: pkg.productId },
      ...(pkg.variantId ? [{ vrsta: 'variant', id: pkg.variantId }] : []),
      ...(fotoViz ? [{ vrsta: 'photoVisualization', id: fotoViz.id }] : []),
      ...(base.measurementId ? [{ vrsta: 'measurement', id: base.measurementId }] : []),
    ],
    reason: args.reason,
    createdFrom: pkg.id,
    userId: args.userId,
  })
  return { ok: true, snapshotId: snap.id, version: snap.version }
}

// ─── AS-PRODUCED iz kosovnice (§11) ────────────────────────────────────────

export async function buildProducedSnapshot (args: {
  projectId: string
  bomId: string
  spremembe: { opis: string; odobril: string }[]
  reason: string
  userId: string
}): Promise<
  | { ok: true; snapshotId: string; version: number }
  | { ok: false; status: number; error: string; detail?: string }
> {
  const bom = await db.bom.findUnique({
    where: { id: args.bomId },
    include: { package: true, lines: { select: { id: true } } },
  })
  if (!bom) return { ok: false, status: 404, error: 'Kosovnica ne obstaja.' }
  if (!bom.package || bom.package.projectId !== args.projectId) {
    return { ok: false, status: 400, error: 'Kosovnica ni vezana na projekt.', detail: 'Kosovnica mora imeti projektni paket tega projekta.' }
  }
  if (!['POTRJEN', 'REZERVIRAN', 'PORABLJEN'].includes(bom.status)) {
    return { ok: false, status: 409, error: 'Kosovnica ni potrjena za proizvodnjo.', detail: `Status ${bom.status} — sprejemljivi: POTRJEN, REZERVIRAN, PORABLJEN.` }
  }
  const designed = await latestSnapshot(args.projectId, 'AS_DESIGNED')
  if (!designed || !designed.data) {
    return { ok: false, status: 409, error: 'Manjka AS-DESIGNED snapshot.', detail: '§11: proizvodnja se primerja z načrtom — najprej ustvarite AS-DESIGNED.' }
  }
  const data = buildAsProduced({
    designed: designed.data,
    bom: { code: bom.code, status: bom.status, lines: bom.lines.length, qty: bom.qty, unit: bom.unit },
    spremembe: args.spremembe.map((c) => ({ opis: c.opis, odobril: c.odobril, ts: new Date().toISOString() })),
  })
  const snap = await createTwinSnapshotRow({
    projectId: args.projectId,
    kind: 'AS_PRODUCED',
    data,
    sources: [
      { vrsta: 'bom', id: bom.id },
      ...(bom.packageId ? [{ vrsta: 'package', id: bom.packageId }] : []),
      { vrsta: 'designedSnapshot', id: designed.id, version: designed.version },
    ],
    reason: args.reason,
    createdFrom: bom.id,
    userId: args.userId,
  })
  return { ok: true, snapshotId: snap.id, version: snap.version }
}

// ─── AS-INSTALLED po montaži (§12) ─────────────────────────────────────────

export async function buildInstalledSnapshot (args: {
  projectId: string
  finalSegments: { key: string; label?: string; lengthCm?: number | null; heightCm?: number | null }[]
  notes: string[]
  workOrderId?: string | null
  photoCount?: number
  reason: string
  userId: string
}): Promise<
  | { ok: true; snapshotId: string; version: number }
  | { ok: false; status: number; error: string; detail?: string }
> {
  const designed = await latestSnapshot(args.projectId, 'AS_DESIGNED')
  if (!designed || !designed.data) {
    return { ok: false, status: 409, error: 'Manjka AS-DESIGNED snapshot.', detail: '§12: montaža se primerja z načrtom — najprej ustvarite AS-DESIGNED.' }
  }
  const designedKeys = new Set(designed.data.segments.map((s) => s.key))
  for (const f of args.finalSegments) {
    if (!designedKeys.has(f.key)) {
      return { ok: false, status: 400, error: `Neznan segment »${f.key}«.`, detail: 'Ključi morajo biti iz AS-DESIGNED snapshot-a (brez fuzzy matchinga).' }
    }
  }
  let workOrderId: string | null = null
  if (args.workOrderId) {
    const wo = await db.workOrder.findUnique({ where: { id: args.workOrderId }, select: { id: true, projectId: true } })
    if (!wo) return { ok: false, status: 404, error: 'Nalog ne obstaja.' }
    if (wo.projectId && wo.projectId !== args.projectId) return { ok: false, status: 400, error: 'Nalog pripada drugemu projektu.' }
    workOrderId = wo.id
  }
  const data = buildAsInstalled({
    designed: designed.data,
    finalSegments: args.finalSegments.map((f) => ({
      key: f.key,
      label: f.label ?? designed.data?.segments.find((s) => s.key === f.key)?.label ?? f.key,
      lengthCm: f.lengthCm ?? null,
      heightCm: f.heightCm ?? null,
    })),
    notes: args.notes,
    workOrderId,
    photoCount: args.photoCount,
  })
  const snap = await createTwinSnapshotRow({
    projectId: args.projectId,
    kind: 'AS_INSTALLED',
    data,
    sources: [
      { vrsta: 'designedSnapshot', id: designed.id, version: designed.version },
      ...(workOrderId ? [{ vrsta: 'workOrder', id: workOrderId }] : []),
    ],
    reason: args.reason,
    createdFrom: workOrderId,
    userId: args.userId,
  })
  return { ok: true, snapshotId: snap.id, version: snap.version }
}

// ─── Pregled dvojčka (§8) + cross-check (§14) ───────────────────────────────

export interface TwinOverview {
  snapshots: { id: string; kind: string; version: number; reason: string; createdAt: string; summary: { totalLengthCm: number | null; segments: number } }[]
  criticalGate: { ponudba: boolean; konfiguracija: boolean; proizvodnja: boolean; manjka: MissingItem[] } | null
  consistency: ReturnType<typeof crossCheckSources>
  counts: {
    measurements: number; fenceRuns: number; packages: number; photoViz: number
    vizProjects: number; boms: number; captureSessions: number; photos: number
  }
}

/** Enoten pregled digitalnega dvojčka projekta (viri + snapshoti + vrata). */
export async function twinOverview (projectId: string): Promise<TwinOverview> {
  const [snapshots, base, measurements, fenceRuns, packages, photoViz, vizProjects, boms, sessions, photos] = await Promise.all([
    db.digitalTwinSnapshot.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    segmentsZaProjekt(projectId),
    db.measurement.count({ where: { projectId } }),
    db.fenceRun.count({ where: { projectId } }),
    db.projectPackage.count({ where: { projectId } }),
    db.photoVisualization.count({ where: { projectId } }),
    db.vizProject.count({ where: { projectId } }),
    db.bom.count({ where: { package: { projectId } } }),
    db.captureSession.count({ where: { projectId } }),
    db.capturePhoto.count({ where: { session: { projectId } } }),
  ])

  // kritična vrata (§7) iz zadnjega tekača
  let gate: TwinOverview['criticalGate'] = null
  const run = await db.fenceRun.findFirst({
    where: { projectId },
    orderBy: { updatedAt: 'desc' },
    include: { segments: { orderBy: { order: 'asc' } } },
  })
  if (run && run.segments.length > 0) {
    const nodes = safeParse(run.nodes, parseNodes, [])
    const terrain = safeParse(run.terrain, parseTerrain, null)
    gate = criticalGate({
      segments: run.segments.map((seg) => ({
        order: seg.order, fromAtCm: seg.fromAtCm, toAtCm: seg.toAtCm,
        lengthCm: seg.lengthCm, heightCm: seg.heightCm, slopeDeg: seg.slopeDeg,
        angleDeg: seg.angleDeg, status: seg.status, hasGate: seg.toKind === 'VRATA',
      })),
      hasCalibration: run.calibration != null,
      hasTerrain: terrain != null && terrain.length > 0,
      hasPodlaga: nodes.some((n) => n.podlaga != null),
    })
  }

  // cross-check virov (§14): PHOTO / 2D / 3D / MERITEV
  const rows: CrossCheckRow[] = []
  const camMeasurement = await db.measurement.findFirst({
    where: { projectId, source: 'KAMERA' },
    orderBy: { createdAt: 'desc' },
  })
  const viz3d = await db.vizProject.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } })
  const viz3dLength = viz3d?.params ? safeParseRecord(viz3d.params)?.lengthCm : null
  const zones = await db.capturePhoto.groupBy({
    by: ['zone'],
    where: { session: { projectId } },
    _count: { _all: true },
  })
  const photoZones = new Set(zones.map((z) => z.zone))
  const camParams = camMeasurement?.params ? safeParseRecord(camMeasurement.params) : null

  for (const seg of base.segments) {
    const key = `seg-${seg.order + 1}`
    rows.push({
      key,
      label: `Segment ${seg.order + 1}`,
      photo: photoZones.has(key),
      sketch2d: camParams != null && Array.isArray(camParams.segments) && (camParams.segments as unknown[]).length === base.segments.length,
      threeD: viz3d != null,
      measurement: true,
      lengths: {
        photo: null,
        sketch2d: camMeasurement?.lengthCm ?? null,
        threeD: typeof viz3dLength === 'number' ? viz3dLength : null,
        measurement: seg.lengthCm,
      },
    })
  }

  return {
    snapshots: snapshots.map((s) => {
      const d = safeParse(s.data, parseTwinData, null as unknown as TwinSnapshotData | null)
      return {
        id: s.id, kind: s.kind, version: s.version, reason: s.reason, createdAt: s.createdAt.toISOString(),
        summary: { totalLengthCm: d?.totalLengthCm ?? null, segments: d?.segments.length ?? 0 },
      }
    }),
    criticalGate: gate,
    consistency: crossCheckSources(rows),
    counts: {
      measurements, fenceRuns, packages, photoViz, vizProjects, boms,
      captureSessions: sessions, photos,
    },
  }
}

function safeParseRecord (json: string): Record<string, unknown> | null {
  try { return JSON.parse(json) as Record<string, unknown> } catch { return null }
}

// ─── Geometrijski diff (§13) ────────────────────────────────────────────────

export async function twinDiff (
  projectId: string,
  fromKind: string,
  toKind: string
): Promise<
  | { ok: true; diff: ReturnType<typeof diffTwin>; from: { id: string; version: number }; to: { id: string; version: number } }
  | { ok: false; status: number; error: string; detail?: string }
> {
  const from = await latestSnapshot(projectId, fromKind)
  const to = await latestSnapshot(projectId, toKind)
  if (!from || !from.data) return { ok: false, status: 404, error: `Snapshot ${fromKind} ne obstaja.` }
  if (!to || !to.data) return { ok: false, status: 404, error: `Snapshot ${toKind} ne obstaja.` }
  return {
    ok: true,
    diff: diffTwin(from.data, to.data),
    from: { id: from.id, version: from.version },
    to: { id: to.id, version: to.version },
  }
}

// ─── Pomožno: zaznavanje naprave na strežniku (fallback, §15) ───────────────

export function tierFromCapsInput (caps: DeviceCapsInput): { tier: DeviceTier; reasons: string[] } {
  return deviceTier(caps)
}

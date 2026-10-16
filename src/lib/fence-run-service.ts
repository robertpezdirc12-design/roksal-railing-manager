// fence-run-service — strežniška logika ograjnega tekača (R460 — issue #15)
// Kanonični izračun + persist: segmenti se upsertajo (stabilni ID-ji za
// ujemajoče razpone ±1 cm), kvaliteta se osveži, verzije snapshotajo.
// Brez runtime AI (§18) — čist deterministični izračun iz fence-run-engine.

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import {
  DEFAULT_RULES, ENGINE_VERSION, computeSegments, parseCalibration, parseNodes, parseTerrain,
  productRulesFromTech, qualityGate, reconcileSegments, suggestPosts, summarizeRun,
  terrainAt, validateRun, round1,
  type ProductRules, type QualityResult, type RunCalibration, type RunNode,
  type SegmentCalc, type TerrainPoint, type ValidationIssue,
} from '@/lib/fence-run-engine'
import { retryOnUnique } from '@/lib/versioning'

/** R539 (transakcijska celovitost): klient, prek katerega gre branje/pisanje
 * tekača — globalni db (privzeto) ALI transakcijski klient (tx) iz poslovne
 * rute. Isti vzorec kot writeAudit (AuditClient) / recordEvent (NotifyClient):
 * obstoječi klici brez argumenta ostanejo na globalnem db. */
export type FenceRunClient = Pick<Prisma.TransactionClient, 'fenceRun' | 'fenceSegment' | 'fenceRunVersion'>

// ─── Kontekst tekača ────────────────────────────────────────────────────────

export interface RunRow {
  id: string; projectId: string; workOrderId: string | null; authorId: string | null
  name: string; status: string; productId: string | null; variantId: string | null
  measurementId: string | null; calibration: string | null; terrain: string | null
  nodes: string | null; quality: string | null; note: string | null
  createdAt: Date; updatedAt: Date
}

export interface SegmentRow {
  id: string; order: number; fromKind: string; toKind: string
  fromAtCm: number; toAtCm: number; lengthCm: number; heightCm: number | null
  angleDeg: number | null; slopeDeg: number; heightDiffCm: number; posts: number
  status: string; verifiedCm: number | null; verifyMethod: string | null
  verifyNote: string | null; source: string; version: number; note: string | null
}

export interface RunContext {
  run: RunRow
  nodes: RunNode[]
  terrain: TerrainPoint[] | null
  calibration: RunCalibration | null
  rules: ProductRules
  segments: SegmentRow[]
}

function safeParse<T> (json: string | null, fn: (v: unknown) => T | null): T | null {
  if (!json) return null
  try { return fn(JSON.parse(json)) } catch { return null }
}

/** Naloži tekač z razčlenjenimi vozlišči/terenom/kalibracijo + produktnimi pravili.
 *  R539 (transakcijska celovitost): neobvezen klient — globalni db (privzeto,
 *  vsi obstoječi klici) ali tx iz verige zapisa, da branje ZNOTRAJ transakcije
 *  vidi še ne-potrjene spremembe (npr. sveže ustvarjen tekač v POST-u). */
export async function loadRunContext (runId: string, client: FenceRunClient = db): Promise<RunContext | null> {
  const run = await client.fenceRun.findUnique({
    where: { id: runId },
    include: { product: { select: { tech: true } } },
  })
  if (!run) return null
  const nodes = safeParse(run.nodes, parseNodes) ?? []
  const terrain = safeParse(run.terrain, parseTerrain)
  const calibration = safeParse(run.calibration, parseCalibration)
  const rules: ProductRules = { ...DEFAULT_RULES, ...productRulesFromTech((run.product as { tech: string | null } | null)?.tech) }
  const segments = await client.fenceSegment.findMany({
    where: { fenceRunId: runId },
    orderBy: { order: 'asc' },
  })
  return {
    run: {
      id: run.id, projectId: run.projectId, workOrderId: run.workOrderId, authorId: run.authorId,
      name: run.name, status: run.status, productId: run.productId, variantId: run.variantId,
      measurementId: run.measurementId, calibration: run.calibration, terrain: run.terrain,
      nodes: run.nodes, quality: run.quality, note: run.note,
      createdAt: run.createdAt, updatedAt: run.updatedAt,
    },
    nodes, terrain, calibration, rules,
    segments: segments.map((s) => ({
      id: s.id, order: s.order, fromKind: s.fromKind, toKind: s.toKind,
      fromAtCm: s.fromAtCm, toAtCm: s.toAtCm, lengthCm: s.lengthCm, heightCm: s.heightCm,
      angleDeg: s.angleDeg, slopeDeg: s.slopeDeg, heightDiffCm: s.heightDiffCm, posts: s.posts,
      status: s.status, verifiedCm: s.verifiedCm, verifyMethod: s.verifyMethod,
      verifyNote: s.verifyNote, source: s.source, version: s.version, note: s.note,
    })),
  }
}

// ─── Sinhronizacija segmentov (upsert — stabilni ID-ji) ────────────────────

/** Preveritve iz obstoječih segmentov (za §19 konflikt + §9 statuse). */
function verificationsFrom (segments: SegmentRow[]): { fromAtCm: number; toAtCm: number; verifiedCm: number }[] {
  return segments
    .filter((s) => s.verifiedCm != null)
    .map((s) => ({ fromAtCm: s.fromAtCm, toAtCm: s.toAtCm, verifiedCm: s.verifiedCm as number }))
}

/**
 * Ponovno izračuna segmente iz vozlišč + terena in jih upserta: segment z
 * nespremenjenim razponom (±1 cm) ohrani id/status/verifikacijo (version+1),
 * spremenjena geometrija POŠTENO razveljavi preveritev (ESTIMATED v1, §19).
 * Osveži tudi quality JSON na tekaču. Vrača sveže segmente.
 * R539 (transakcijska celovitost): neobvezen klient — globalni db (privzeto)
 * ali tx iz verige zapisa, da je ponoven izračun segmentov atomarno vezan na
 * spremembo, ki ga je povzročila (vsi obstoječi klici nespremenjeni).
 */
export async function syncSegments (ctx: RunContext, client: FenceRunClient = db): Promise<SegmentRow[]> {
  const computed: SegmentCalc[] = computeFor(ctx)
  const old = ctx.segments
  const ups = reconcileSegments(computed, old)
  // novi segmenti: baseline status iz kalibracije + ročnih vozlišč (§9)
  const nodesByAt = [...ctx.nodes].sort((a, b) => a.atCm - b.atCm)
  for (const u of ups) {
    if (u.version === 1) {
      const fromNode = nodesByAt.find((n) => Math.abs(n.atCm - u.fromAtCm) < 1)
      const toNode = nodesByAt.find((n) => Math.abs(n.atCm - u.toAtCm) < 1)
      const manual = fromNode?.manual === true || toNode?.manual === true
      u.status = manual ? 'MANUAL' : ctx.calibration ? 'CALIBRATED' : 'ESTIMATED'
    }
  }

  const matchedIds = new Set<string>()
  for (const u of ups) {
    const match = old.find(
      (o) => Math.abs(o.fromAtCm - u.fromAtCm) < 1 && Math.abs(o.toAtCm - u.toAtCm) < 1
    )
    if (match) {
      matchedIds.add(match.id)
      await client.fenceSegment.update({
        where: { id: match.id },
        data: {
          order: u.order, fromKind: u.fromKind, toKind: u.toKind,
          fromAtCm: u.fromAtCm, toAtCm: u.toAtCm, lengthCm: u.lengthCm,
          heightCm: u.heightCm, angleDeg: u.angleDeg, slopeDeg: u.slopeDeg,
          heightDiffCm: u.heightDiffCm, posts: u.posts, status: u.status,
          version: u.version, source: 'ROCNO',
        },
      })
    } else {
      await client.fenceSegment.create({
        data: {
          fenceRunId: ctx.run.id, order: u.order, fromKind: u.fromKind, toKind: u.toKind,
          fromAtCm: u.fromAtCm, toAtCm: u.toAtCm, lengthCm: u.lengthCm,
          heightCm: u.heightCm, angleDeg: u.angleDeg, slopeDeg: u.slopeDeg,
          heightDiffCm: u.heightDiffCm, posts: u.posts, status: u.status,
          version: 1, source: 'ENGINE',
        },
      })
    }
  }
  // pobriši odvečne (geometrija se je skrčila)
  for (const o of old) {
    if (!matchedIds.has(o.id)) await client.fenceSegment.delete({ where: { id: o.id } })
  }

  const fresh = await client.fenceSegment.findMany({ where: { fenceRunId: ctx.run.id }, orderBy: { order: 'asc' } })
  // osveži quality (§3)
  const analysis = analyzeContext({ ...ctx, segments: fresh.map(toSegmentRow) })
  await client.fenceRun.update({
    where: { id: ctx.run.id },
    data: { quality: JSON.stringify(analysis.quality) },
  })
  return fresh
}

function toSegmentRow (s: {
  id: string; order: number; fromKind: string; toKind: string; fromAtCm: number; toAtCm: number
  lengthCm: number; heightCm: number | null; angleDeg: number | null; slopeDeg: number
  heightDiffCm: number; posts: number; status: string; verifiedCm: number | null
  verifyMethod: string | null; verifyNote: string | null; source: string; version: number; note: string | null
}): SegmentRow {
  return {
    id: s.id, order: s.order, fromKind: s.fromKind, toKind: s.toKind,
    fromAtCm: s.fromAtCm, toAtCm: s.toAtCm, lengthCm: s.lengthCm, heightCm: s.heightCm,
    angleDeg: s.angleDeg, slopeDeg: s.slopeDeg, heightDiffCm: s.heightDiffCm, posts: s.posts,
    status: s.status, verifiedCm: s.verifiedCm, verifyMethod: s.verifyMethod,
    verifyNote: s.verifyNote, source: s.source, version: s.version, note: s.note,
  }
}

/** Izračun segmentov iz konteksta (vozlišča + teren + pravila). */
export function computeFor (ctx: RunContext): SegmentCalc[] {
  const heights = ctx.nodes.map((n) => n.heightCm).filter((h): h is number => h != null)
  const defaultHeight = heights.length > 0 ? Math.round(heights.reduce((a, b) => a + b, 0) / heights.length) : 110
  return computeSegments({
    nodes: ctx.nodes, terrain: ctx.terrain, rules: ctx.rules, defaultHeightCm: defaultHeight,
  }).map((s) => {
    const match = ctx.segments.find(
      (o) => Math.abs(o.fromAtCm - s.fromAtCm) < 1 && Math.abs(o.toAtCm - s.toAtCm) < 1
    )
    return { ...s, status: (match?.status ?? 'ESTIMATED') as SegmentCalc['status'] }
  })
}

// ─── Analiza (validacija + quality + povzetek — za GET/confirm) ─────────────

export interface RunAnalysis {
  validation: ValidationIssue[]
  quality: QualityResult
  summary: ReturnType<typeof summarizeRun> & { verifiedCount: number }
  pendingPosts: ReturnType<typeof suggestPosts>
  terrainProfile: { atCm: number; elevCm: number }[]
}

export function analyzeContext (ctx: RunContext): RunAnalysis {
  const computed = computeFor(ctx)
  const pendingPosts = suggestPosts(computed, ctx.rules)
  const validation = validateRun({
    nodes: ctx.nodes,
    segments: computed,
    terrain: ctx.terrain,
    rules: ctx.rules,
    calibration: ctx.calibration,
    verifications: verificationsFrom(ctx.segments),
    pendingPosts,
  })
  const verifiedRows = ctx.segments.filter((s) => s.status === 'VERIFIED' || s.status === 'CONFIRMED')
  const quality = qualityGate({
    nodes: ctx.nodes,
    segments: computed,
    validation,
    calibration: ctx.calibration,
    terrain: ctx.terrain,
    verifications: verifiedRows.length,
  })
  const summary = summarizeRun(ctx.nodes, computed, ctx.terrain)
  // profil terena po vozliščih (§12: zgornja/spodnja linija za prikaz)
  const terrainProfile = ctx.nodes.map((n) => ({ atCm: round1(n.atCm), elevCm: round1(terrainAt(ctx.terrain, n.atCm)) }))
  return { validation, quality, summary: { ...summary, verifiedCount: verifiedRows.length }, pendingPosts, terrainProfile }
}

// ─── Verzije (§17: posnetek ob vsaki spremembi) ────────────────────────────

/**
 * Zapiše posnetek tekača kot naslednjo verzijo NA PODANEM klientu (R539 —
 * transakcijska celovitost), BREZ notranjega retryOnUnique: v PG transakciji
 * P2002 aborta CELO transakcijo in je neobnovljiv (ugotovitev R536), zato
 * ponovne poskuse pokriva ZUNANJA retryOnUnique okoli CELE transakcije v
 * klicatelju — ob ponovnem poskusu se ta funkcija (branje zadnje verzije
 * vključno) izvede znova. Run brez obstoja se NE zapiše (kot prej) — vrne
 * izračunano številko.
 */
export async function snapshotVersionOn (
  client: FenceRunClient,
  runId: string,
  userId: string,
  note: string
): Promise<number> {
  const last = await client.fenceRunVersion.findFirst({
    where: { fenceRunId: runId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const version = (last?.version ?? 0) + 1
  const run = await client.fenceRun.findUnique({ where: { id: runId } })
  if (!run) return version
  const segments = await client.fenceSegment.findMany({
    where: { fenceRunId: runId },
    orderBy: { order: 'asc' },
    select: { order: true, fromAtCm: true, toAtCm: true, lengthCm: true, slopeDeg: true, status: true, verifiedCm: true, version: true },
  })
  await client.fenceRunVersion.create({
    data: {
      fenceRunId: runId, version, userId, note,
      data: JSON.stringify({
        status: run.status, productId: run.productId, variantId: run.variantId,
        nodes: run.nodes, terrain: run.terrain, calibration: run.calibration,
        quality: run.quality, engineVersion: ENGINE_VERSION,
        segments,
      }),
    },
  })
  return version
}

/**
 * Zapiše posnetek tekača kot naslednjo verzijo (nikoli prepis, §17) —
 * samostojno, na globalnem db (obstoječi klici izven transakcij).
 *
 * R536: dirka verzij — branje zadnje verzije + create sta ZNOTRAJ retried fn
 * (versioning.ts): dvema sočasnima klicema (npr. PATCH tekača + confirm) baza
 * zavrne drugega s P2002 na @@unique([fenceRunId, version]), poskus se ponovi
 * z naslednjo številko. Posnetek (run/segmenti) se ob vsakem poskusu prebere
 * znova, da zmagoviti zapis nosi sveže stanje. Create ni v transakciji —
 * razveljavljanje ni potrebno. Run brez obstoja se NE zapiše (kot prej).
 * R539: znotraj poslovne $transaction uporabi snapshotVersionOn(tx, …) —
 * notranji retry tam ni možen (P2002 aborta celo tx).
 */
export async function snapshotVersion (
  runId: string,
  userId: string,
  note: string
): Promise<number> {
  return retryOnUnique(() => snapshotVersionOn(db, runId, userId, note))
}

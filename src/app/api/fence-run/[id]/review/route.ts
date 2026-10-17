import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { fenceRunZaUporabnika } from '@/lib/fence-run-access'
import { loadRunContext } from '@/lib/fence-run-service'
import { computeSegments, qualityGate, validateRun } from '@/lib/fence-run-engine'
import { buildPlanModel, parseTurns } from '@/lib/model-core'
import { consentStatus, photosBlockedReason } from '@/lib/pin-core'
import { exportChecks } from '@/lib/export-core'

// /api/fence-run/[id]/review — ENOTEN OBSEG PRIKAZA (R479 — issue #9 §7)
// GET (measurements.read; IDOR = fenceRunZaUporabnika — isti obseg kot tekač):
// vse, kar enotni pregledovalnik potrebuje, v ENEM klicu:
//   • model  — isti PlanModel kot /api/fence-run/[id]/model (R473, buildPlanModel
//     iz model-core — NI kopija, skupna izpeljava; tekač = vir resnice)
//   • fotografije — sličice zajemov tekača s cono/atCm; POŠTENO: posnetki
//     zajema NISO prostorsko registrirani (imajo samo cono pokritosti + thumb,
//     past #5) → vsak nosi spatiallyRegistered: false
//   • pins — vsi pripeti komentarji (interno: z internalNote)
//   • replay — KAZALCI na obstoječi /api/capture-session/[id]/replay (R465,
//     read-only predvajalnik; NE podvajamo motorja — past #4)
//   • consent — GDPR stanje soglasja projekta (pin-core.consentStatus)
//   • checks — isto presojo kot izvozi R477 (export-core.exportChecks)

type Params = { params: Promise<{ id: string }> }

interface PlanStop { id: string; kind: string; label: string; atCm?: number; critical?: boolean }

// R542: plan je jsonb — branje brez JSON.parse (obramba za ne-tabelo ostaja)
function parsePlan (raw: unknown): PlanStop[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is PlanStop => {
    if (typeof s !== 'object' || s === null) return false
    const x = s as Record<string, unknown>
    return typeof x.id === 'string'
  }).map((s) => ({
    id: s.id, kind: String(s.kind ?? ''), label: String(s.label ?? s.id),
    atCm: typeof s.atCm === 'number' ? s.atCm : undefined,
    critical: s.critical === true,
  }))
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  // IDOR — isti obseg dostopa kot tekač
  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope

  const ctx = await loadRunContext(id)
  if (!ctx) return jsonError(404, 'Tekač ne obstaja.')

  const url = new URL(req.url)
  const turns = parseTurns(url.searchParams.get('turns'))
  if (url.searchParams.get('turns') != null && turns === null) {
    return jsonError(400, 'Neveljaven turns.', 'Zapišite smeri zavojev kot niz L/D (npr. „LDL“ — po vrstnem redu vogalov).')
  }

  // ── model (SKUPNA izpeljava z /api/fence-run/[id]/model — model-core) ──
  const sigmaRule = await db.engineeringRule.findFirst({ where: { key: 'tol_pozicija_modela', active: true } })
  const spacingRule = await db.engineeringRule.findFirst({ where: { key: 'max_razdalja_stebrov', active: true } })
  const wasteRule = await db.engineeringRule.findFirst({ where: { key: 'odpad_rez_pct', active: true } })

  const computed = computeSegments({ nodes: ctx.nodes, terrain: ctx.terrain, rules: ctx.rules })
  const verifications = ctx.segments
    .filter((s) => s.verifiedCm != null)
    .map((s) => ({ fromAtCm: s.fromAtCm, toAtCm: s.toAtCm, verifiedCm: s.verifiedCm as number }))
  const validation = validateRun({
    nodes: ctx.nodes, segments: computed, terrain: ctx.terrain, rules: ctx.rules,
    calibration: ctx.calibration, verifications,
  })
  const gate = qualityGate({
    nodes: ctx.nodes, segments: computed, validation,
    calibration: ctx.calibration, terrain: ctx.terrain,
    verifications: verifications.length,
  })

  const model = buildPlanModel({
    runId: ctx.run.id,
    runName: ctx.run.name,
    runStatus: ctx.run.status,
    nodes: ctx.nodes,
    segments: ctx.segments.map((s) => ({
      order: s.order, fromAtCm: s.fromAtCm, toAtCm: s.toAtCm, lengthCm: s.lengthCm,
      heightCm: s.heightCm, angleDeg: s.angleDeg, slopeDeg: s.slopeDeg,
      heightDiffCm: s.heightDiffCm, posts: s.posts, status: s.status,
      verifiedCm: s.verifiedCm, verifyMethod: s.verifyMethod,
    })),
    terrain: ctx.terrain,
    calibration: ctx.calibration,
    gate: { state: gate.state, score: gate.score },
    turns: turns ?? undefined,
    ruleSigmaCm: sigmaRule ? Number(sigmaRule.value) : null,
  })

  // ── projekt/izdelek (prikaz brez cen) ──
  const [project, product, variant] = await Promise.all([
    db.project.findUnique({
      where: { id: ctx.run.projectId },
      select: {
        code: true, title: true, status: true,
        photoConsentAt: true, photoConsentExpiresAt: true,
        customer: { select: { name: true } },
      },
    }),
    ctx.run.productId
      ? db.product.findUnique({ where: { id: ctx.run.productId }, select: { id: true, sku: true, name: true, unit: true } })
      : null,
    ctx.run.variantId
      ? db.productVariant.findUnique({ where: { id: ctx.run.variantId }, select: { id: true, sku: true, name: true, ral: true } })
      : null,
  ])

  // ── zajemi + fotografije (POŠTENO: niso prostorsko registrirane — past #5) ──
  const sessions = await db.captureSession.findMany({
    where: { fenceRunId: id },
    select: {
      id: true, name: true, status: true, plan: true, createdAt: true,
      photos: {
        select: { id: true, zone: true, thumb: true, offsetCm: true, capturedAt: true },
        orderBy: { capturedAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const photos = sessions.flatMap((sess) => {
    const plan = parsePlan(sess.plan)
    return sess.photos.map((ph) => {
      const stop = plan.find((s) => s.id === ph.zone) ?? null
      return {
        id: ph.id,
        sessionId: sess.id,
        sessionName: sess.name,
        zone: ph.zone,
        zoneLabel: stop?.label ?? ph.zone,
        atCm: stop?.atCm ?? null, // cona → položaj ob teku (posredno; NE prava prostorska vezava)
        spatiallyRegistered: false, // posnetek ima samo cono pokritosti — past #5
        thumb: ph.thumb,
        offsetCm: ph.offsetCm,
        capturedAt: ph.capturedAt.toISOString(),
      }
    })
  })

  // replay KAZALCI na obstoječi motor (past #4 — ne podvajaj replay engine-a)
  const replay = sessions.map((sess) => ({
    id: sess.id,
    name: sess.name,
    status: sess.status,
    photoCount: sess.photos.length,
    replayUrl: `/api/capture-session/${sess.id}/replay`,
  }))

  // ── pini (interni pogled — z internalNote, avtorji z imeni) ──
  const pinRows = await db.reviewPin.findMany({
    where: { fenceRunId: id },
    include: {
      author: { select: { id: true, name: true } },
      resolvedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const pins = pinRows.map((p) => ({
    id: p.id, fenceRunId: p.fenceRunId, targetType: p.targetType, targetKey: p.targetKey,
    x: p.x == null ? null : Number(p.x), y: p.y == null ? null : Number(p.y),
    note: p.note, internalNote: p.internalNote, status: p.status,
    resolvedAt: p.resolvedAt ? p.resolvedAt.toISOString() : null,
    author: p.author ? { id: p.author.id, name: p.author.name } : null,
    resolvedBy: p.resolvedBy ? { id: p.resolvedBy.id, name: p.resolvedBy.name } : null,
    snapshot: p.snapshot,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  }))

  // ── GDPR soglasje projekta ──
  const consent = consentStatus(project)
  const photosBlocked = photosBlockedReason(consent)

  // ── preverjanja (isto kot izvozi R477 — export-core, brez tihih predpostavk) ──
  const staleQuotes = await db.quote.count({
    where: { projectId: ctx.run.projectId, staleAt: { not: null } },
  })
  const unverified = model.segments.filter((s) => !['VERIFIED', 'CONFIRMED', 'CALIBRATED'].includes(s.status)).length
  const checks = exportChecks({
    wastePct: wasteRule ? Number(wasteRule.value) : null,
    postSpacingCm: spacingRule ? Number(spacingRule.value) : null,
    unverifiedSegments: unverified,
    quoteStale: staleQuotes > 0,
    linesWithoutSegment: 0, // kosovnica ni del tega obsega (izvozi jo nosijo sami)
    hasSegments: model.segments.length > 0,
  })

  return NextResponse.json({
    data: {
      run: {
        id: ctx.run.id, name: ctx.run.name, status: ctx.run.status,
        projectId: ctx.run.projectId, createdAt: ctx.run.createdAt.toISOString(),
        updatedAt: ctx.run.updatedAt.toISOString(),
      },
      project: project
        ? {
            code: project.code, title: project.title, status: project.status,
            customerName: project.customer?.name ?? null,
          }
        : null,
      productId: ctx.run.productId, product, variantId: ctx.run.variantId, variant,
      model,
      photos,
      photosSpatiallyRegistered: false, // poštena oznaka celega nabora (past #5)
      pins,
      replay,
      consent: { status: consent, photosBlocked },
      checks,
    },
  })
}

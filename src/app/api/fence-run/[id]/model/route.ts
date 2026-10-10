// /api/fence-run/[id]/model — MERILNI MODEL tekača (R473 — issue #9 §3)
// GET  izpeljava merilno skalirane geometrije IZ tekača (measurements.read;
//      monter vidi svoje naloge/svoje — isti obseg dostopa kot tekač).
//      Query: turns='LDL…' (smeri zavojev po vrstnem redu vogalov; privzeto
//      vse LEVO — predpostavka je IZRECNO zapisana v model.quality).
//      Model NI persistiran — tekač je vir resnice; model se deterministično
//      regenerira (ENGINE_VERSION model-core/1.0). Brez tihih predpostavk.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { computeSegments, qualityGate, validateRun } from '@/lib/fence-run-engine'
import { fenceRunZaUporabnika } from '@/lib/fence-run-access'
import { loadRunContext } from '@/lib/fence-run-service'
import { buildPlanModel, parseTurns } from '@/lib/model-core'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope

  const ctx = await loadRunContext(id)
  if (!ctx) return jsonError(404, 'Tekač ne obstaja.')

  const url = new URL(req.url)
  const turns = parseTurns(url.searchParams.get('turns'))
  if (url.searchParams.get('turns') != null && turns === null) {
    return jsonError(400, 'Neveljaven turns.', 'Zapišite smeri zavojev kot niz L/D (npr. „LDL“ — po vrstnem redu vogalov).')
  }

  // σ iz EngineeringRule (če obstaja in je AKTIVNO) — sicer poštena ocena po metodi kalibracije
  const sigmaRule = await db.engineeringRule.findFirst({ where: { key: 'tol_pozicija_modela', active: true } })
  const tolDolzina = await db.engineeringRule.findFirst({ where: { key: 'tol_dolzina_segmenta', active: true } })

  // quality gate tekača (enak izračun kot /api/fence-run/[id] GET)
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

  // produktni vir (kot pri /api/fence-run/[id])
  const [product, variant, project] = await Promise.all([
    ctx.run.productId
      ? db.product.findUnique({ where: { id: ctx.run.productId }, select: { id: true, sku: true, name: true, unit: true, tech: true } })
      : null,
    ctx.run.variantId
      ? db.productVariant.findUnique({ where: { id: ctx.run.variantId }, select: { id: true, sku: true, name: true, ral: true } })
      : null,
    db.project.findUnique({ where: { id: ctx.run.projectId }, select: { code: true, title: true } }),
  ])

  return NextResponse.json({
    data: {
      run: { id: ctx.run.id, name: ctx.run.name, status: ctx.run.status, projectId: ctx.run.projectId, project },
      productId: ctx.run.productId, product, variantId: ctx.run.variantId, variant,
      calibration: ctx.calibration,
      tolerance: {
        sigmaRule: sigmaRule ? { key: sigmaRule.key, valueCm: Number(sigmaRule.value) } : null,
        dolzinaRule: tolDolzina ? { key: tolDolzina.key, valueCm: Number(tolDolzina.value) } : null,
      },
      model,
    },
  })
}

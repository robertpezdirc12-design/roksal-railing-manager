import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimited, tokenBucketKey } from '@/lib/rate-limit'
import { loadRunContext } from '@/lib/fence-run-service'
import { computeSegments, qualityGate, validateRun } from '@/lib/fence-run-engine'
import { buildPlanModel, parseTurns } from '@/lib/model-core'
import { consentStatus, photosBlockedReason, publicPin, REVIEW_TOKEN_MAX, REVIEW_TOKEN_MIN } from '@/lib/pin-core'

// /api/public/review — JAVNI pogled enotnega pregleda tekača (R479 — issue #9 §7)
// Brez avtentikacije — dostop ureja neuraden žeton povezave (ReviewLink:
// veljaven, ne preklican, ne pretekel — vzorec /api/public/portal).
// Tempomat 60 zahtev/min na žeton (skupni R437 rate-limit lib). Šteje ogled.
//
// VARNI PODSKUP (§7: „ne sme razkriti internih opomb ali podatkov drugih
// projektov“):
//  • model risbe iz model-core (brez cen/marž — teh v modelu ni)
//  • pini: publicPin projekcija — BREZ internalNote, brez e-pošte/ID-jev
//    uporabnikov (samo imena)
//  • fotografije: SAMO ob GDPR soglasju VELJAVNO (sicer photosBlocked z
//    razlogom; risbe ostanejo) — sličice zajema (thumb ≤ 120 KB), brez
//    internih QA podatkov (kakovost/odmik)
//  • NIČ: internih opomb, e-pošte uporabnikov, cen, marž, revizij, drugih
//    projektov, replay motorja (ta je notranji)

export const dynamic = 'force-dynamic'

interface PlanStop { id: string; kind: string; label: string; atCm?: number; critical?: boolean }

function parsePlan (raw: string | null): PlanStop[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((s): s is PlanStop => {
      if (typeof s !== 'object' || s === null) return false
      const x = s as Record<string, unknown>
      return typeof x.id === 'string'
    }).map((s) => ({
      id: s.id, kind: String(s.kind ?? ''), label: String(s.label ?? s.id),
      atCm: typeof s.atCm === 'number' ? s.atCm : undefined,
      critical: s.critical === true,
    }))
  } catch { return [] }
}

export async function GET (req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token || token.length < REVIEW_TOKEN_MIN || token.length > REVIEW_TOKEN_MAX) {
    return NextResponse.json({ error: 'Neveljavna povezava.' }, { status: 404 })
  }
  if (await rateLimited(tokenBucketKey('review', token))) {
    return NextResponse.json({ error: 'Preveč zahtev — poskusite kasneje.' }, { status: 429 })
  }

  const link = await db.reviewLink.findUnique({
    where: { token },
    include: {
      fenceRun: {
        select: {
          id: true, name: true, status: true, projectId: true,
          productId: true, variantId: true,
          calibration: true, terrain: true, nodes: true, quality: true,
          createdAt: true, updatedAt: true,
        },
      },
    },
  })
  if (!link || link.revokedAt || link.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Povezava ne velja več (preklicana ali potekla).' }, { status: 404 })
  }

  // štetje ogleda (vzorec PortalLink)
  await db.reviewLink.update({
    where: { id: link.id },
    data: { viewCount: { increment: 1 }, lastViewAt: new Date() },
  })

  const run = link.fenceRun
  const ctx = await loadRunContext(run.id)
  if (!ctx) return NextResponse.json({ error: 'Povezava ne velja več.' }, { status: 404 })

  const url = new URL(req.url)
  const turns = parseTurns(url.searchParams.get('turns')) // smeri zavojev so NEŠKODLJIVE za javnost

  // ── model risbe (skupna izpeljava model-core — brez cen, brez internih opomb) ──
  const sigmaRule = await db.engineeringRule.findFirst({ where: { key: 'tol_pozicija_modela', active: true } })
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
    runId: ctx.run.id, runName: ctx.run.name, runStatus: ctx.run.status,
    nodes: ctx.nodes,
    segments: ctx.segments.map((s) => ({
      order: s.order, fromAtCm: s.fromAtCm, toAtCm: s.toAtCm, lengthCm: s.lengthCm,
      heightCm: s.heightCm, angleDeg: s.angleDeg, slopeDeg: s.slopeDeg,
      heightDiffCm: s.heightDiffCm, posts: s.posts, status: s.status,
      verifiedCm: s.verifiedCm, verifyMethod: s.verifyMethod,
    })),
    terrain: ctx.terrain, calibration: ctx.calibration,
    gate: { state: gate.state, score: gate.score },
    turns: turns ?? undefined,
    ruleSigmaCm: sigmaRule ? Number(sigmaRule.value) : null,
  })

  // ── projekt + GDPR soglasje ──
  const project = await db.project.findUnique({
    where: { id: run.projectId },
    select: {
      code: true, title: true,
      photoConsentAt: true, photoConsentExpiresAt: true,
      customer: { select: { name: true } },
    },
  })
  const consent = consentStatus(project)
  const photosBlocked = photosBlockedReason(consent)

  // ── fotografije: SAMO ob VELJAVNEM soglasju (sicer zamaknjene z razlogom) ──
  let photos: {
    id: string; zone: string; zoneLabel: string; atCm: number | null
    thumb: string | null; capturedAt: string
  }[] = []
  if (consent === 'VELJAVNO') {
    const sessions = await db.captureSession.findMany({
      where: { fenceRunId: run.id },
      select: {
        plan: true,
        photos: {
          select: { id: true, zone: true, thumb: true, capturedAt: true },
          orderBy: { capturedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    photos = sessions.flatMap((sess) => {
      const plan = parsePlan(sess.plan)
      return sess.photos.map((ph) => {
        const stop = plan.find((s) => s.id === ph.zone) ?? null
        return {
          id: ph.id,
          zone: ph.zone,
          zoneLabel: stop?.label ?? ph.zone,
          atCm: stop?.atCm ?? null, // posredna vezava (cona → plan); NI prostorska registracija
          thumb: ph.thumb, // sličica ≤ 120 KB (celotne fotografije ostajajo interne)
          capturedAt: ph.capturedAt.toISOString(),
        }
      })
    })
  }

  // ── pini: publicPin projekcija (BREZ internalNote, brez e-pošte/ID uporabnikov) ──
  const pinRows = await db.reviewPin.findMany({
    where: { fenceRunId: run.id },
    include: {
      author: { select: { name: true } },
      resolvedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const pins = pinRows.map((p) => publicPin({
    id: p.id, fenceRunId: p.fenceRunId, targetType: p.targetType, targetKey: p.targetKey,
    x: p.x, y: p.y, note: p.note, status: p.status,
    resolvedAt: p.resolvedAt, resolvedBy: p.resolvedBy ?? null,
    author: p.author ?? null, snapshot: p.snapshot, createdAt: p.createdAt,
  }))

  return NextResponse.json({
    data: {
      run: { name: run.name, status: run.status },
      project: project
        ? { code: project.code, title: project.title, customerName: project.customer?.name ?? null }
        : null,
      model,
      photos,
      photosBlocked, // null = ni zamika; sicer 'MANJKA_SOGLASJE' | 'SOGLASJE_POTEKLO'
      pins,
      consent,
      link: { expiresAt: link.expiresAt.toISOString() },
    },
  })
}

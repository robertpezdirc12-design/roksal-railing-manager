// /api/fence-run/[id]/layout — samodejni razpored stebrov (R460 — issue #15 §11)
// POST { maxSpanCm? (override 40..300), apply?: boolean } (measurements.write)
// Predlog vmesnih stebrov za segmente, ki presegajo max razpon PRODUKTA
// (§8: isti vir kot konfigurator; override samo eksplicitno).
// apply=true vstavi stebre (kind STEBER) → ponoven izračun + verzija + revizija.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { suggestPosts, type RunNode } from '@/lib/fence-run-engine'
import { analyzeContext, loadRunContext, snapshotVersion, syncSegments } from '@/lib/fence-run-service'
import { fenceRunZaUporabnika } from '@/lib/fence-run-access'

type Params = { params: Promise<{ id: string }> }

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope
  if (scope.run.status === 'POTRJEN') {
    return jsonError(409, 'Potrjene izmere ni mogoče spreminjati.')
  }

  const body = await req.json().catch(() => ({}))
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  // eksplicitni override razpona (sicer produktna pravila)
  let rulesOverride: number | null = null
  if (body.maxSpanCm !== undefined && body.maxSpanCm !== null) {
    const n = Number(body.maxSpanCm)
    if (!Number.isFinite(n) || n < 40 || n > 300) {
      return jsonError(400, 'Neveljaven maxSpanCm.', 'Override razpona: 40..300 cm (sicer se uporabi pravilo produkta).')
    }
    rulesOverride = Math.round(n)
  }

  const ctx = await loadRunContext(id)
  if (!ctx) return jsonError(404, 'Tekač ne obstaja.')

  const effectiveRules = rulesOverride ? { ...ctx.rules, maxSpanCm: rulesOverride } : ctx.rules
  const suggestions = suggestPosts(
    ctx.segments.map((s) => ({
      order: s.order, fromKind: s.fromKind, toKind: s.toKind,
      fromAtCm: s.fromAtCm, toAtCm: s.toAtCm, lengthCm: s.lengthCm,
    })),
    effectiveRules
  )

  if (body.apply !== true) {
    return NextResponse.json({
      data: {
        suggestions,
        applied: 0,
        rules: effectiveRules,
        note: 'Predlog — pošljite apply: true za vstavljanje stebrov.',
      },
    })
  }

  // vstavi predlagane stebre kot vozlišča (§11: ročna sprememba ostaja možna)
  if (suggestions.length === 0) {
    return NextResponse.json({ data: { suggestions: [], applied: 0, rules: effectiveRules, note: 'Ni segmentov nad max razponom.' } })
  }
  const nodes: RunNode[] = [
    ...ctx.nodes,
    ...suggestions.map((s) => ({ kind: 'STEBER' as const, atCm: s.afterAtCm })),
  ]
  nodes.sort((a, b) => a.atCm - b.atCm)
  // odstrani morebitne duplikate položajev (±5 cm — enaka pravila kot parser)
  const dedup: RunNode[] = []
  for (const n of nodes) {
    if (dedup.length === 0 || n.atCm - dedup[dedup.length - 1].atCm >= 5) dedup.push(n)
  }

  await db.fenceRun.update({ where: { id }, data: { nodes: JSON.stringify(dedup) } })
  const fresh = await loadRunContext(id)
  if (fresh) await syncSegments(fresh)
  const version = await snapshotVersion(id, user.id, `Vstavljenih ${dedup.length - ctx.nodes.length} stebrov (razpored)`)

  await writeAudit({
    userId: user.id,
    action: 'FENCE_RUN_LAYOUT',
    entity: 'fenceRun',
    entityId: id,
    projectId: scope.run.projectId,
    detail: {
      inserted: dedup.length - ctx.nodes.length,
      maxSpanCm: effectiveRules.maxSpanCm,
      override: rulesOverride ?? null,
      version,
    },
  })

  const after = await loadRunContext(id)
  return NextResponse.json({
    data: {
      suggestions,
      applied: dedup.length - ctx.nodes.length,
      rules: effectiveRules,
      version,
      analysis: after ? analyzeContext(after) : null,
    },
  })
}

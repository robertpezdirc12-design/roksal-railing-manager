// /api/capture-session/[id]/qa — element-level QA + heatmapi (R462 — issue #17 §6/§7/§8)
// GET (measurements.read) → element QA (stabilni ID-ji seg-N/stebri-N/…),
// coverage heatmap (🟢🟡🔴⚪ po conah), quality heatmap posnetkov (§7),
// geo/registracije/loopi (§1–§5) in recaptcha kontekst.

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { loadCaptureContext, analyzeSession } from '@/lib/capture-qa-service'
import {
  coverageHeatmap, elementQa, frameQuality, structuralZones,
} from '@/lib/reality-r2p-engine'
import { geoContext, heightLimitRules, toleranceRules } from '@/lib/reality-r2p-service'
import { asJsonObject } from '@/lib/json'

// R542: quality je jsonb objekt — brez JSON.parse (obramba za neobjektno obliko)
function safeParseQ (v: unknown): { dark?: boolean; bright?: boolean; blurry?: boolean; blurScore?: number } {
  return (asJsonObject(v) ?? {}) as { dark?: boolean; bright?: boolean; blurry?: boolean; blurScore?: number }
}

export async function GET (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access

  const ctx = await loadCaptureContext(id)
  if (!ctx) return jsonError(404, 'Zajem ne obstaja.')

  const analysis = await analyzeSession(ctx)
  const [rules, heights, geo] = await Promise.all([
    toleranceRules(),
    heightLimitRules(),
    geoContext(id),
  ])

  // element QA iz segmentov tekača (§8)
  const elements = ctx.run
    ? elementQa(
        ctx.run.segments.map((s) => ({
          order: s.order, fromKind: s.fromKind ?? '', toKind: s.toKind ?? '',
          lengthCm: s.lengthCm, heightCm: s.heightCm, slopeDeg: s.slopeDeg,
          angleDeg: s.angleDeg, posts: 0, status: s.status,
        })),
        rules, heights,
      )
    : []

  // coverage heatmap (§6) + strukturne cone
  const heat = coverageHeatmap(analysis.coverage.zones)
  const structural = ctx.run ? structuralZones(ctx.run.nodes.map((n) => ({ kind: n.kind, atCm: n.atCm, podlaga: n.podlaga, pritrditev: n.pritrditev }))) : []

  // quality heatmap posnetkov (§7)
  const frames = ctx.photos.map((p) => ({
    photoId: p.id, zone: p.zone, capturedAt: p.capturedAt.toISOString(),
    ...frameQuality(safeParseQ(p.quality)),
  }))

  return NextResponse.json({
    data: {
      sessionId: id,
      elements,
      coverageHeatmap: heat,
      structuralZones: structural,
      frames,
      geo,
      toleranceRulesDefined: Object.entries(rules).filter(([k]) => k.startsWith('tol_')).map(([k, v]) => ({ key: k, value: v.value, unit: v.unit })),
    },
  })
}

// /api/digital-twin/as-built — AS-BUILT QA poročilo (R462 — issue #17 §9–§11/§27)
// GET ?projectId= (projects.read) → vsi diffi (measured↔designed↔produced↔installed)
// s statusi WITHIN/REVIEW/BLOCKING/NO VERIFIED TOLERANCE RULE (§12), provenance
// (§20), veriga snapshotov, definirana tolerance pravila + zaključek.

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { projektDostopen } from '@/lib/capture-qa-access'
import { asBuiltReport, recaptureOverview } from '@/lib/reality-r2p-service'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return jsonError(400, 'Manjka projectId.')

  if (!(await projektDostopen(user, projectId))) {
    return jsonError(403, 'Projekt ni na voljo vašim nalogom.')
  }

  const [report, recapture] = await Promise.all([
    asBuiltReport(projectId),
    recaptureOverview(projectId),
  ])
  return NextResponse.json({ data: { ...report, recapture } })
}

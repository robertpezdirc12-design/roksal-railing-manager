// /api/digital-twin/timeline — 4D časovnica dvojčka (R462 — issue #17 §15)
// GET ?projectId= (projects.read) → T0..T6 (obstoječe stanje → meritev → načrt
// → ponudba → proizvodnja → montaža → servis/sprememba) iz snapshotov/zajemov.

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { projektDostopen } from '@/lib/capture-qa-access'
import { timeline4d } from '@/lib/reality-r2p-service'

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

  const tl = await timeline4d(projectId)
  return NextResponse.json({ data: tl })
}

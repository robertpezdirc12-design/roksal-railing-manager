// /api/digital-twin/consistency — cross-check virov PHOTO/2D/3D/MERITEV (R461 — issue #16 §14)
// GET ?projectId= (projects.read) → matrika po segmentih + DATA CONSISTENCY
// WARNING seznama. Konfliktni podatki se NE združujejo tiho.

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { projektDostopen } from '@/lib/capture-qa-access'
import { twinOverview } from '@/lib/capture-qa-service'

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

  const overview = await twinOverview(projectId)
  return NextResponse.json({ data: overview.consistency })
}

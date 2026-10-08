// /api/digital-twin — enoten pregled digitalnega dvojčka projekta (R461 — issue #16 §8)
// GET ?projectId= (projects.read) → viri (foto/2D/3D/meritve/paketi/BOM/zajemi),
// snapshoti AS-MEASURED → AS-INSTALLED, kritična vrata mer (§7) in cross-check (§14).

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
    return jsonError(403, 'Projekt ni na voljo vašim nalogom.', 'Monter vidi dvojčke projektov svojih delovnih nalogov.')
  }

  const overview = await twinOverview(projectId)
  return NextResponse.json({ data: overview })
}

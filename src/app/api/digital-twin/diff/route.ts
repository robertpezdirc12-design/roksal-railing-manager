// /api/digital-twin/diff — geometrijska primerjava verzij (R461 — issue #16 §13)
// GET ?projectId=&from=AS_DESIGNED&to=AS_INSTALLED (projects.read)
// → vrstice: dolžina/višina/kot/nagib/stebri + skupna; primerja SAMO znane
//   vrednosti (brez ugibanj); odstopanja z razliko v cm.

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { TWIN_KINDS } from '@/lib/capture-qa-engine'
import { projektDostopen } from '@/lib/capture-qa-access'
import { twinDiff } from '@/lib/capture-qa-service'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const from = url.searchParams.get('from') ?? 'AS_DESIGNED'
  const to = url.searchParams.get('to') ?? 'AS_INSTALLED'
  if (!projectId) return jsonError(400, 'Manjka projectId.')
  if (!(from in TWIN_KINDS) || !(to in TWIN_KINDS)) {
    return jsonError(400, 'Neveljaven kind.', `from/to: ${Object.keys(TWIN_KINDS).join(' | ')}`)
  }
  if (from === to) return jsonError(400, 'from in to morata biti različna.')

  if (!(await projektDostopen(user, projectId))) {
    return jsonError(403, 'Projekt ni na voljo vašim nalogom.')
  }

  const result = await twinDiff(projectId, from, to)
  if (!result.ok) return jsonError(result.status, result.error, result.detail)

  return NextResponse.json({ data: { from: result.from, to: result.to, diff: result.diff } })
}

// /api/digital-twin/element — provenance elementa (R462 — issue #17 §13)
// GET ?projectId=&key=seg-1 (projects.read) → klik na element pokaže VSE
// povezane podatke: foto cona, meritev, tekač, produkt/varianta, BOM,
// snapshot vrednosti skozi zgodovino + verzije tekača. Brez fuzzy matchinga
// (ključ mora biti točno seg-N iz tekača).

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { projektDostopen } from '@/lib/capture-qa-access'
import { elementProvenance } from '@/lib/reality-r2p-service'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const key = url.searchParams.get('key')
  if (!projectId) return jsonError(400, 'Manjka projectId.')
  if (!key || !/^seg-\d+$/.test(key)) {
    return jsonError(400, 'Neveljaven ključ elementa.', 'key: seg-N (stabilni ID iz tekača, brez fuzzy matchinga).')
  }

  if (!(await projektDostopen(user, projectId))) {
    return jsonError(403, 'Projekt ni na voljo vašim nalogam.')
  }

  const prov = await elementProvenance(projectId, key)
  if (!prov) return jsonError(404, 'Element ne obstaja na projektu.', `Ključ ${key} ne ustreza segmentom tekača.`)
  return NextResponse.json({ data: prov })
}

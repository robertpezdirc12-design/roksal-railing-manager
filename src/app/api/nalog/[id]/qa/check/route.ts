// /api/nalog/[id]/qa/check — R489 (issue #12 §2B): posodobitev kontrolne točke.
// PATCH (nalog.write) — { checkId, status, note?, photoId?, resolutionNote?,
//   deviationReason?, deviationLocation?, deviationTargetKey?, deviationImpact* }.
// ISTA logika kot sync vrsta 'montaza-check' (jedro: posodobiCheck).
// Pravila: NAPAKA zahteva razlog (ustvari odstopanje); NI_RELEVANTNO zahteva
// opombo; odprava (NAPAKA/CAKA → V_REDU) zahteva resolutionNote.

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { posodobiCheck } from '@/lib/montaza-qa-core'

type Params = { params: Promise<{ id: string }> }

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')
  if (typeof body.checkId !== 'string' || !body.checkId) return jsonError(400, 'Manjka checkId kontrolne točke.')
  if (typeof body.status !== 'string' || !body.status) return jsonError(400, 'Manjka status.')

  const rez = await posodobiCheck(auth.user, id, {
    checkId: body.checkId,
    status: body.status,
    note: typeof body.note === 'string' ? body.note : null,
    photoId: typeof body.photoId === 'string' && body.photoId ? body.photoId : null,
    resolutionNote: typeof body.resolutionNote === 'string' ? body.resolutionNote : null,
    deviationReason: typeof body.deviationReason === 'string' ? body.deviationReason : null,
    deviationLocation: typeof body.deviationLocation === 'string' ? body.deviationLocation : null,
    deviationTargetKey: typeof body.deviationTargetKey === 'string' ? body.deviationTargetKey : null,
    deviationImpactMaterial: body.deviationImpactMaterial === true,
    deviationImpactPrice: body.deviationImpactPrice === true,
    deviationImpactSafety: body.deviationImpactSafety === true,
  })

  if (rez.error && !rez.data) {
    return jsonError(rez.status ?? (rez.conflict ? 409 : 400), rez.error)
  }
  return NextResponse.json({ data: rez.data })
}

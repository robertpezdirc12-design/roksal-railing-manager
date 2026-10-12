// /api/nalog/[id]/qa/deviation — R489 (issue #12 §2B/§2C): odstopanja.
// POST  (nalog.write) — ročno odstopanje (izvedeno stanje ≠ potrjeni načrt):
//   { reason (obvezno), checkId?, location?, targetKey?, photoId?, impactMaterial?,
//     impactPrice?, impactSafety?, note? } — revizija MONTAZA_DEVIATION_CREATE.
// PATCH (nalog.write) — odprava: { id } → resolvedAt/resolvedBy —
//   revizija MONTAZA_DEVIATION_RESOLVE (prejšnjih zapisov ne prepiše).

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { resiOdstopanje, ustvariOdstopanje } from '@/lib/montaza-qa-core'

type Params = { params: Promise<{ id: string }> }

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')
  if (typeof body.reason !== 'string' || !body.reason.trim()) {
    return jsonError(400, 'Razlog odstopanja je obvezen.')
  }

  const rez = await ustvariOdstopanje(auth.user, id, {
    reason: body.reason,
    checkId: typeof body.checkId === 'string' && body.checkId ? body.checkId : null,
    location: typeof body.location === 'string' ? body.location : null,
    targetKey: typeof body.targetKey === 'string' ? body.targetKey : null,
    photoId: typeof body.photoId === 'string' && body.photoId ? body.photoId : null,
    impactMaterial: body.impactMaterial === true,
    impactPrice: body.impactPrice === true,
    impactSafety: body.impactSafety === true,
    note: typeof body.note === 'string' ? body.note : null,
  })

  if (rez.error && !rez.data) return jsonError(rez.status ?? (rez.conflict ? 409 : 400), rez.error)
  return NextResponse.json({ data: rez.data }, { status: 201 })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const deviationId = typeof body?.id === 'string' ? body.id : ''
  if (!deviationId) return jsonError(400, 'Manjka identifikator odstopanja.')

  const rez = await resiOdstopanje(auth.user, id, deviationId)
  if (rez.error && !rez.data) return jsonError(rez.status ?? (rez.conflict ? 409 : 400), rez.error)
  return NextResponse.json({ data: rez.data })
}

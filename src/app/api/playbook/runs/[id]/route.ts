// /api/playbook/runs/[id] — R458 (issue #13)
// GET — polno stanje zagona: definicija (snapshot verzije §14), koraki,
//       izračunan naslednji korak (§2), napredek (§3/§12), handoff (§11).
//       Monter vidi SAMO svoje zagone (fail-closed obseg).

import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { stanjeZagona } from '@/lib/playbook-engine'

export async function GET (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const rez = await stanjeZagona(auth.user, id)
  if ('napaka' in rez) return jsonError(rez.status, rez.napaka)
  return NextResponse.json({ data: rez.stanje })
}

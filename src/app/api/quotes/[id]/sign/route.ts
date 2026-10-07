// API /api/quotes/[id]/sign — podpis stranke → zaklep posla (vrata deal.lock)
// Shrani signature (data URL) + signedAt + signedBy, status → ZAKLENJEN, revizija DEAL_LOCK.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

const SIGNABLE_STATUSES = ['POSLAN', 'SPREJET']

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'deal.lock')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const signature = typeof body?.signature === 'string' ? body.signature : ''
  const signedBy = typeof body?.signedBy === 'string' ? body.signedBy.trim() : ''

  if (!signedBy) return jsonError(400, 'Ime podpisnika je obvezno.')
  if (!signature.startsWith('data:image/')) {
    return jsonError(400, 'Podpis ni veljaven.', 'Pričakovan je podpis iz podpisne tablice (data URL slike).')
  }
  if (signature.length > 2_000_000) return jsonError(400, 'Podpis je prevelik.', 'Največja dovoljena velikost je 2 MB.')

  const quote = await db.quote.findUnique({ where: { id } })
  if (!quote) return jsonError(404, 'Ponudba ne obstaja.')
  if (quote.status === 'ZAKLENJEN') {
    return jsonError(400, 'Ponudba je že zaklenjena.', 'Posel je bil zaklenjen s podpisom stranke.')
  }
  if (!SIGNABLE_STATUSES.includes(quote.status)) {
    return jsonError(400, 'Podpisati je mogoče le ponudbo v statusu Poslan ali Sprejet.', `Trenutni status: ${quote.status}.`)
  }

  const updated = await db.quote.update({
    where: { id },
    data: { signature, signedBy, signedAt: new Date(), status: 'ZAKLENJEN' },
    include: {
      customer: { select: { name: true, city: true } },
      project: { select: { code: true, title: true } },
      _count: { select: { lines: true } },
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'DEAL_LOCK', entity: 'quote', entityId: id, projectId: quote.projectId,
    detail: { code: quote.code, signedBy, total: quote.total }, // podpis NE gre v revizijo (velikost)
  })

  // R438 (issue #5): podpis ponudbe → obvestilo pisarni (OFFICE, IN_APP)
  await emitEvent({
    type: 'QUOTE_SIGNED',
    key: `quote-signed:${id}`,
    title: 'Podpis ponudbe',
    body: `Ponudba ${quote.code} je podpisana (${signedBy}) — znesek ${quote.total.toFixed(2)} €, posel zaklenjen`,
    projectId: quote.projectId,
    audience: 'OFFICE',
  })
  return NextResponse.json({ data: updated })
}

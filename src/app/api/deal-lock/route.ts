import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/deal-lock — R437 (route-map izvirnika): zaklep/odklep posla (deal.lock)
// GET  (deal.lock): ponudbe s statusom ZAKLENJEN — vključno s projektom, stranko,
//      podpisom (signature/signedAt/signedBy) in številom računov (pregled za postsig).
// POST (deal.lock): { quoteId, locked }
//      locked=true  → status ZAKLENJEN (dovoljeno iz POSLAN/SPREJET; sicer 409), revizija DEAL_LOCK
//      locked=false → nazaj na SPREJET (409, če ima ponudba že račune), revizija DEAL_UNLOCK

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'deal.lock')
  if (auth instanceof NextResponse) return auth

  const quotes = await db.quote.findMany({
    where: { status: 'ZAKLENJEN' },
    include: {
      project: { select: { id: true, code: true, title: true, status: true } },
      customer: { select: { id: true, name: true, email: true, phone: true } },
      _count: { select: { invoices: true, lines: true } },
    },
    orderBy: { signedAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ data: quotes })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'deal.lock')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as { quoteId?: unknown; locked?: unknown } | null
  const quoteId = typeof body?.quoteId === 'string' ? body.quoteId : ''
  const locked = body?.locked === true // undefined/null → 400
  if (!quoteId || typeof body?.locked !== 'boolean') {
    return jsonError(400, 'Potrebna sta quoteId in locked (boolean).')
  }

  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: { _count: { select: { invoices: true } } },
  })
  if (!quote) return jsonError(404, 'Ponudba ne obstaja.')

  if (locked) {
    // zaklep: dovoljen samo iz POSLAN (ročno) ali SPREJET (pred podpisom stranke)
    if (quote.status !== 'POSLAN' && quote.status !== 'SPREJET') {
      return jsonError(409, 'Zaklep ni mogoč iz trenutnega statusa.', `Ponudba ${quote.code} je v statusu ${quote.status}; zaklep je dovoljen samo iz POSLAN ali SPREJET.`)
    }
    // R538: transakcijska celovitost — zaklep + revizija atomarno (vzorec R537-d)
    const updated = await db.$transaction(async (tx) => {
      const updated = await tx.quote.update({ where: { id: quoteId }, data: { status: 'ZAKLENJEN' } })
      await writeAudit({
        userId: user.id, action: 'DEAL_LOCK', entity: 'quote', entityId: quoteId, projectId: quote.projectId,
        detail: { code: quote.code, from: quote.status, to: 'ZAKLENJEN', manual: true },
      }, tx)
      return updated
    })
    return NextResponse.json({ data: updated })
  }

  // odklep: nazaj na SPREJET; če so iz ponudbe že izdani računi, posel ostane zaklenjen
  if (quote.status !== 'ZAKLENJEN') {
    return jsonError(409, 'Ponudba ni zaklenjena.', `Ponudba ${quote.code} je v statusu ${quote.status}; odklep je možen samo iz ZAKLENJEN.`)
  }
  if (quote._count.invoices > 0) {
    return jsonError(409, 'Zaklenjene ponudbe z izdanimi računi ni mogoče odkleniti.', `Ponudba ${quote.code} ima ${quote._count.invoices} račun(ov).`)
  }
  // R538: transakcijska celovitost — odklep + revizija atomarno (vzorec R537-d)
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.quote.update({ where: { id: quoteId }, data: { status: 'SPREJET' } })
    await writeAudit({
      userId: user.id, action: 'DEAL_UNLOCK', entity: 'quote', entityId: quoteId, projectId: quote.projectId,
      detail: { code: quote.code, from: 'ZAKLENJEN', to: 'SPREJET' },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

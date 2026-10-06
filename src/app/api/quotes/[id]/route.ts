// API /api/quotes/[id] — podrobnost s pozicijami (quotes.read) + sprememba statusa
// PATCH: osnovna vrata quotes.create; če status → SPREJET, dodatno zahtevaj quotes.approve.
// ZAKLENJEN je dosegljiv IZKLJUČNO prek podpisa stranke (/api/quotes/[id]/sign — deal.lock).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

const PATCHABLE_STATUSES = ['OSNUTEK', 'POSLAN', 'SPREJET', 'ZAVRNJEN']

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'quotes.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const quote = await db.quote.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, city: true, email: true } },
      project: { select: { id: true, code: true, title: true } },
      lines: true,
      invoices: { select: { id: true, code: true, status: true, total: true } },
    },
  })
  if (!quote) return jsonError(404, 'Ponudba ne obstaja.')
  return NextResponse.json({ data: quote })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!status) return jsonError(400, 'Status je obvezen.')
  if (status === 'ZAKLENJEN') {
    return jsonError(400, 'Zaklenitev poteka samo s podpisom stranke.', 'Uporabite modul Signatura (podpis → zaklep posla).')
  }
  if (!PATCHABLE_STATUSES.includes(status)) {
    return jsonError(400, 'Neveljaven status ponudbe.', `Dovoljeni: ${PATCHABLE_STATUSES.join(', ')}.`)
  }
  if (status === 'SPREJET' && !auth.perms.includes('quotes.approve')) {
    return jsonError(403, 'Sprejem ponudbe zahteva pravico quotes.approve.', 'Vrata določa permissions-core katalog.')
  }

  const existing = await db.quote.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Ponudba ne obstaja.')
  if (existing.status === 'ZAKLENJEN') {
    return jsonError(400, 'Zaklenjene ponudbe ni mogoče spreminjati.', 'Posel je zaklenjen s podpisom stranke.')
  }
  if (existing.status === status) return jsonError(400, 'Ponudba je že v tem statusu.')

  const updated = await db.quote.update({
    where: { id },
    data: { status },
    include: {
      customer: { select: { name: true, city: true } },
      project: { select: { code: true, title: true } },
      lines: true,
    },
  })
  await writeAudit({
    userId: auth.user.id, action: 'QUOTE_STATUS', entity: 'quote', entityId: id, projectId: existing.projectId,
    detail: { code: existing.code, from: existing.status, to: status },
  })
  return NextResponse.json({ data: updated })
}

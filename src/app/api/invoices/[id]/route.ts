// API /api/invoices/[id] — podrobnost s plačili (invoices.read) + ročna sprememba statusa (invoices.issue)
// PLACAN / DELNO_PLACAN določata SAMO zapisana plačila (/api/payments — payments.manage, R425).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

type Params = { params: Promise<{ id: string }> }

const MANUAL_STATUSES = ['OSNUTEK', 'IZDAN', 'ZAPRT']

// R536: zod shema za ročno spremembo statusa računa — status obvezen niz;
// poslovna pravila (PLACAN/DELNO_PLACAN izključno prek plačil) ostajajo v handlerju.
const InvoiceStatusSchema = z.object({
  status: z.string().min(1, 'Status je obvezen.'),
})

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'invoices.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, code: true, title: true, customer: { select: { name: true } } } },
      quote: { select: { id: true, code: true, status: true } },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!invoice) return jsonError(404, 'Račun ne obstaja.')
  return NextResponse.json({ data: invoice })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'invoices.issue')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const parsed = await parseBody(req, InvoiceStatusSchema)
  if (!parsed.ok) return parsed.response
  const status = parsed.data.status
  if (status === 'PLACAN' || status === 'DELNO_PLACAN') {
    return jsonError(400, 'Statusa Plačan in Delno plačan določata zapisana plačila.', 'Uporabite Zapiši plačilo (payments.manage).')
  }
  if (!MANUAL_STATUSES.includes(status)) {
    return jsonError(400, 'Neveljaven status računa.', `Dovoljeni: ${MANUAL_STATUSES.join(', ')}.`)
  }

  const existing = await db.invoice.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Račun ne obstaja.')
  if (existing.status === status) return jsonError(400, 'Račun je že v tem statusu.')

  const updated = await db.invoice.update({
    where: { id },
    data: { status },
    include: {
      project: { select: { code: true, title: true, customer: { select: { name: true } } } },
      quote: { select: { code: true } },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  })
  await writeAudit({
    userId: auth.user.id, action: 'INVOICE_STATUS', entity: 'invoice', entityId: id, projectId: existing.projectId,
    detail: { code: existing.code, from: existing.status, to: status },
  })
  return NextResponse.json({ data: updated })
}

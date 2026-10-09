// API /api/payments — R425 LOČITEV plačil od računov
// GET  seznam plačil z računi (payments.read)
// POST zapiši plačilo { invoiceId, amount, method, reference? } (payments.manage)
//      → posodobi invoice.paid + status (PLACAN / DELNO_PLACAN), revizija PAYMENT_RECORD.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'

const METHODS = ['NAKAZNICA', 'GOTOVINA', 'KARTICA']

const round2 = (n: number) => Math.round(n * 100) / 100

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'payments.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const invoiceId = url.searchParams.get('invoiceId')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 500)

  const payments = await db.payment.findMany({
    where: invoiceId ? { invoiceId } : {},
    include: {
      invoice: {
        select: {
          id: true, code: true, status: true, total: true, paid: true,
          project: { select: { customer: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ data: payments })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'payments.manage')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : ''
  const amount = Number(body?.amount)
  const method = typeof body?.method === 'string' && body.method ? body.method : 'NAKAZNICA'

  if (!invoiceId) return jsonError(400, 'invoiceId je obvezen.')
  if (!Number.isFinite(amount) || amount <= 0) return jsonError(400, 'Znesek plačila mora biti večji od 0.')
  if (!METHODS.includes(method)) return jsonError(400, 'Neveljaven način plačila.', `Dovoljeni: ${METHODS.join(', ')}.`)

  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } })
  if (!invoice) return jsonError(404, 'Račun ne obstaja.')
  if (invoice.status === 'ZAPRT') return jsonError(400, 'Zaprtemu računu ni mogoče zapisati plačila.')

  const payment = await db.payment.create({
    data: {
      invoiceId,
      amount: round2(amount),
      method,
      reference: typeof body?.reference === 'string' && body.reference.trim() ? body.reference.trim() : null,
    },
  })

  // ponovni izračun iz VSEH plačil tega računa (robustno)
  const paid = round2([...invoice.payments, payment].reduce((s, p) => s + p.amount.toNumber(), 0))
  const status = paid + 0.005 >= invoice.total.toNumber() ? 'PLACAN' : 'DELNO_PLACAN'

  const updated = await db.invoice.update({
    where: { id: invoiceId },
    data: { paid, status },
    include: {
      project: { select: { code: true, title: true, customer: { select: { name: true } } } },
      quote: { select: { code: true } },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'PAYMENT_RECORD', entity: 'payment', entityId: payment.id, projectId: invoice.projectId,
    detail: { amount: payment.amount, method, reference: payment.reference, invoiceCode: invoice.code, paid, status },
  })

  // R438 (issue #5): prejeto plačilo → obvestilo pisarni (OFFICE, znesek v body)
  await emitEvent({
    type: 'PAYMENT_RECEIVED',
    key: `payment-received:${payment.id}`,
    title: 'Prejeto plačilo',
    body: `Plačilo ${payment.amount.toFixed(2)} € (${method}) na račun ${invoice.code} — status: ${status}`,
    projectId: invoice.projectId,
    audience: 'OFFICE',
  })
  return NextResponse.json({ data: { payment, invoice: updated } }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/payments/[id] — R437 (route-map izvirnika): urejanje/brisanje posameznega plačila
// GET    (payments.read):  plačilo + račun (koda, status, zneski, stranka)
// PATCH  (payments.manage): { amount?, method?, reference? } — validacija kot pri POST;
//        po spremembi se invoice.paid prešteje iz VSEH plačil računa + status
//        (PLACAN ≥ total, DELNO_PLACAN > 0, sicer IZDAN); 400, če je račun ZAPRT.
// DELETE (payments.manage): 400, če je račun ZAPRT; izbris + ponoven izračun.
// Reviziji PAYMENT_EDIT / PAYMENT_DELETE (R425 ločitev pravic ostaja).

type Params = { params: Promise<{ id: string }> }

const METHODS = ['NAKAZNICA', 'GOTOVINA', 'KARTICA']
const round2 = (n: number) => Math.round(n * 100) / 100

/** Ponovni izračun invoice.paid + status iz VSEH plačil računa (ZAPRT ohrani status). */
async function recalcInvoice (invoiceId: string): Promise<{ paid: number; status: string }> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } })
  if (!invoice) return { paid: 0, status: 'IZDAN' }
  const paid = round2(invoice.payments.reduce((s, p) => s + p.amount.toNumber(), 0))
  const status = invoice.status === 'ZAPRT'
    ? 'ZAPRT'
    : paid + 0.005 >= invoice.total.toNumber() ? 'PLACAN' : paid > 0 ? 'DELNO_PLACAN' : 'IZDAN'
  await db.invoice.update({ where: { id: invoiceId }, data: { paid, status } })
  return { paid, status }
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'payments.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      invoice: {
        select: {
          id: true, code: true, status: true, total: true, paid: true,
          project: { select: { code: true, title: true, customer: { select: { name: true } } } },
        },
      },
    },
  })
  if (!payment) return jsonError(404, 'Plačilo ne obstaja.')
  return NextResponse.json({ data: payment })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'payments.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const existing = await db.payment.findUnique({ where: { id }, include: { invoice: true } })
  if (!existing) return jsonError(404, 'Plačilo ne obstaja.')
  if (existing.invoice.status === 'ZAPRT') {
    return jsonError(400, 'Plačila zaprtega računa ni mogoče spreminjati.', `Račun ${existing.invoice.code} je ZAPRT.`)
  }

  const patch: Record<string, unknown> = {}
  if (body.amount !== undefined) {
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) return jsonError(400, 'Znesek plačila mora biti večji od 0.')
    patch.amount = round2(amount)
  }
  if (body.method !== undefined) {
    if (typeof body.method !== 'string' || !METHODS.includes(body.method)) {
      return jsonError(400, 'Neveljaven način plačila.', `Dovoljeni: ${METHODS.join(', ')}.`)
    }
    patch.method = body.method
  }
  if (body.reference !== undefined) {
    if (body.reference === null) patch.reference = null
    else if (typeof body.reference === 'string') patch.reference = body.reference.trim() || null
    else return jsonError(400, 'Referenca mora biti niz ali null.')
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.', 'Podana polja: amount, method, reference.')

  await db.payment.update({ where: { id }, data: patch })
  const recalc = await recalcInvoice(existing.invoiceId)

  await writeAudit({
    userId: user.id, action: 'PAYMENT_EDIT', entity: 'payment', entityId: id, projectId: existing.invoice.projectId,
    detail: {
      from: { amount: existing.amount, method: existing.method, reference: existing.reference },
      to: patch,
      invoiceCode: existing.invoice.code,
      paid: recalc.paid, status: recalc.status,
    },
  })

  const updated = await db.payment.findUnique({
    where: { id },
    include: { invoice: { select: { id: true, code: true, status: true, total: true, paid: true } } },
  })
  return NextResponse.json({ data: { payment: updated, invoice: updated?.invoice, recalc } })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'payments.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const existing = await db.payment.findUnique({ where: { id }, include: { invoice: true } })
  if (!existing) return jsonError(404, 'Plačilo ne obstaja.')
  if (existing.invoice.status === 'ZAPRT') {
    return jsonError(400, 'Plačila zaprtega računa ni mogoče brisati.', `Račun ${existing.invoice.code} je ZAPRT.`)
  }

  await db.payment.delete({ where: { id } })
  const recalc = await recalcInvoice(existing.invoiceId)

  await writeAudit({
    userId: user.id, action: 'PAYMENT_DELETE', entity: 'payment', entityId: id, projectId: existing.invoice.projectId,
    detail: { amount: existing.amount, method: existing.method, invoiceCode: existing.invoice.code, paid: recalc.paid, status: recalc.status },
  })

  return NextResponse.json({ data: { ok: true, recalc } })
}

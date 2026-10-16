import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

// /api/payments/[id] — R437 (route-map izvirnika): urejanje/brisanje posameznega plačila
// GET    (payments.read):  plačilo + račun (koda, status, zneski, stranka)
// PATCH  (payments.manage): { amount?, method?, reference? } — validacija kot pri POST;
//        po spremembi se invoice.paid prešteje iz VSEH plačil računa + status
//        (PLACAN ≥ total, DELNO_PLACAN > 0, sicer IZDAN); 400, če je račun ZAPRT.
// DELETE (payments.manage): 400, če je račun ZAPRT; izbris + ponoven izračun.
// Reviziji PAYMENT_EDIT / PAYMENT_DELETE (R425 ločitev pravic ostaja).

type Params = { params: Promise<{ id: string }> }

const round2 = (n: number) => Math.round(n * 100) / 100

// R536: zod shema za popravek plačila — delni PATCH: amount > 0 (z.coerce kot
// Number() prej), method iz dovoljenega seznama, reference niz ali null (prazno ⇒ null).
const PaymentPatchSchema = z.object({
  amount: z.coerce.number({ error: 'Znesek plačila mora biti večji od 0.' }).positive('Znesek plačila mora biti večji od 0.').optional(),
  method: z.enum(['NAKAZNICA', 'GOTOVINA', 'KARTICA'], { error: 'Neveljaven način plačila.' }).optional(),
  reference: z.string().trim().nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
})

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

  const parsed = await parseBody(req, PaymentPatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const existing = await db.payment.findUnique({ where: { id }, include: { invoice: true } })
  if (!existing) return jsonError(404, 'Plačilo ne obstaja.')
  if (existing.invoice.status === 'ZAPRT') {
    return jsonError(400, 'Plačila zaprtega računa ni mogoče spreminjati.', `Račun ${existing.invoice.code} je ZAPRT.`)
  }

  const patch: Record<string, unknown> = {}
  if (data.amount !== undefined) patch.amount = round2(data.amount)
  if (data.method !== undefined) patch.method = data.method
  if (data.reference !== undefined) patch.reference = data.reference
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

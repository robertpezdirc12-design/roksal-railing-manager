// API /api/payments — R425 LOČITEV plačil od računov
// GET  seznam plačil z računi (payments.read)
// POST zapiši plačilo { invoiceId, amount, method, reference? } (payments.manage)
//      → posodobi invoice.paid + status (PLACAN / DELNO_PLACAN), revizija PAYMENT_RECORD.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { deliverEvent, recordEvent } from '@/lib/notify'
import { parseBody } from '@/lib/validate'

const METHODS = ['NAKAZNICA', 'GOTOVINA', 'KARTICA']

const round2 = (n: number) => Math.round(n * 100) / 100

// R536: zod shema za zapis plačila — invoiceId obvezen, znesek > 0 (z.coerce
// sprejme tudi številske nize — kot Number() prej); method neobvezen s privzetim
// NAKAZNICA (prazen niz ⇒ privzet, kot prej), dovoljene vrednosti preveri handler.
const PaymentCreateSchema = z.object({
  invoiceId: z.string().min(1, 'invoiceId je obvezen.'),
  amount: z.coerce.number({ error: 'Znesek plačila mora biti večji od 0.' }).positive('Znesek plačila mora biti večji od 0.'),
  method: z.string().nullish().transform((v) => v || 'NAKAZNICA'),
  reference: z.string().trim().nullish().transform((v) => v || null),
})

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

  const parsed = await parseBody(req, PaymentCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data
  const { invoiceId } = data
  const method = data.method

  if (!METHODS.includes(method)) return jsonError(400, 'Neveljaven način plačila.', `Dovoljeni: ${METHODS.join(', ')}.`)

  // R537 (transakcijska celovitost): plačilo + ponovni izračun računa + revizija +
  // zapis dogodka (outbox) v ENI transakciji — prej sta bila plačilo in posodobitev
  // računa LOČENA await-a (padec srednjega koraka = plačilo brez posodobljenega
  // statusa/revizije/dogodka). Račun se prebere ZNOTRAJ tx (znesek `paid` iz VSEH
  // plačil — sočasno plačilo na isti račun ne more več izmikaniti branja).
  // Dostava obvestila (OFFICE IN_APP + webhook HTTP) teče PO commitu (deliverEvent).
  const rezultat = await db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } })
    if (!invoice) return { napaka: jsonError(404, 'Račun ne obstaja.') }
    if (invoice.status === 'ZAPRT') return { napaka: jsonError(400, 'Zaprtemu računu ni mogoče zapisati plačila.') }

    const payment = await tx.payment.create({
      data: {
        invoiceId,
        amount: round2(data.amount),
        method,
        reference: data.reference,
      },
    })

    // ponovni izračun iz VSEH plačil tega računa (robustno)
    const paid = round2([...invoice.payments, payment].reduce((s, p) => s + p.amount.toNumber(), 0))
    const status = paid + 0.005 >= invoice.total.toNumber() ? 'PLACAN' : 'DELNO_PLACAN'

    const updated = await tx.invoice.update({
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
    }, tx)

    // R438 (issue #5): prejeto plačilo → obvestilo pisarni (OFFICE, znesek v body) —
    // R537: ZAPIS dogodka v isti tx (outbox), dostava PO commitu (ognjevarna).
    const recorded = await recordEvent({
      type: 'PAYMENT_RECEIVED',
      key: `payment-received:${payment.id}`,
      title: 'Prejeto plačilo',
      body: `Plačilo ${payment.amount.toFixed(2)} € (${method}) na račun ${invoice.code} — status: ${status}`,
      projectId: invoice.projectId,
      audience: 'OFFICE',
    }, tx)
    return { payment, updated, recorded }
  })
  if ('napaka' in rezultat && rezultat.napaka) return rezultat.napaka

  // dostava obvestila PO uspešnem commitu (ognjevarna — nikoli ne vrže napake)
  if (rezultat.recorded) await deliverEvent(rezultat.recorded)
  return NextResponse.json({ data: { payment: rezultat.payment, invoice: rezultat.updated } }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
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
// R538: PATCH/DELETE sta zrcalo R537 POST /api/payments — plačilo, račun in VSA
// plačila se preberejo ZNOTRAJ transakcije; sprememba + ponovni izračun računa +
// revizija so atomarni (vzorec R537-d).

type Params = { params: Promise<{ id: string }> }

const round2 = (n: number) => Math.round(n * 100) / 100

// R536: zod shema za popravek plačila — delni PATCH: amount > 0 (z.coerce kot
// Number() prej), method iz dovoljenega seznama, reference niz ali null (prazno ⇒ null).
const PaymentPatchSchema = z.object({
  amount: z.coerce.number({ error: 'Znesek plačila mora biti večji od 0.' }).positive('Znesek plačila mora biti večji od 0.').optional(),
  method: z.enum(['NAKAZNICA', 'GOTOVINA', 'KARTICA'], { error: 'Neveljaven način plačila.' }).optional(),
  reference: z.string().trim().nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
})

/** Odjemalec, prek katerega teče ponovni izračun: globalni db ALI transakcijski
 * klient (tx) — isti vzorec kot writeAudit (R464), R538. */
type RecalcClient = Pick<Prisma.TransactionClient, 'invoice'>

/** Ponovni izračun invoice.paid + status iz VSEH plačil računa (ZAPRT ohrani
 * status) — R538: na podanem klientu (branje + posodobitev znotraj tx). */
async function recalcInvoice (invoiceId: string, client: RecalcClient = db): Promise<{ paid: number; status: string }> {
  const invoice = await client.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } })
  if (!invoice) return { paid: 0, status: 'IZDAN' }
  const paid = round2(invoice.payments.reduce((s, p) => s + p.amount.toNumber(), 0))
  const status = invoice.status === 'ZAPRT'
    ? 'ZAPRT'
    : paid + 0.005 >= invoice.total.toNumber() ? 'PLACAN' : paid > 0 ? 'DELNO_PLACAN' : 'IZDAN'
  await client.invoice.update({ where: { id: invoiceId }, data: { paid, status } })
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

  // R538: transakcijska celovitost — sprememba plačila + ponovni izračun računa +
  // revizija atomarno (vzorec R537-d, zrcalo R537 POST /api/payments): plačilo in
  // račun se prebereta ZNOTRAJ tx, znesek `paid` iz VSEH plačil — sočasna
  // sprememba na istem računu ne more več izmikaniti branju.
  const rezultat = await db.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { id }, include: { invoice: true } })
    if (!existing) return { napaka: jsonError(404, 'Plačilo ne obstaja.') }
    if (existing.invoice.status === 'ZAPRT') {
      return { napaka: jsonError(400, 'Plačila zaprtega računa ni mogoče spreminjati.', `Račun ${existing.invoice.code} je ZAPRT.`) }
    }

    const patch: Record<string, unknown> = {}
    if (data.amount !== undefined) patch.amount = round2(data.amount)
    if (data.method !== undefined) patch.method = data.method
    if (data.reference !== undefined) patch.reference = data.reference
    if (Object.keys(patch).length === 0) {
      return { napaka: jsonError(400, 'Ni sprememb za izvedbo.', 'Podana polja: amount, method, reference.') }
    }

    await tx.payment.update({ where: { id }, data: patch })
    const recalc = await recalcInvoice(existing.invoiceId, tx)

    await writeAudit({
      userId: user.id, action: 'PAYMENT_EDIT', entity: 'payment', entityId: id, projectId: existing.invoice.projectId,
      detail: {
        from: { amount: existing.amount, method: existing.method, reference: existing.reference },
        to: patch,
        invoiceCode: existing.invoice.code,
        paid: recalc.paid, status: recalc.status,
      },
    }, tx)

    const updated = await tx.payment.findUnique({
      where: { id },
      include: { invoice: { select: { id: true, code: true, status: true, total: true, paid: true } } },
    })
    return { updated, recalc }
  })
  if ('napaka' in rezultat && rezultat.napaka) return rezultat.napaka

  return NextResponse.json({ data: { payment: rezultat.updated, invoice: rezultat.updated?.invoice, recalc: rezultat.recalc } })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'payments.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  // R538: transakcijska celovitost — izbris plačila + ponovni izračun računa +
  // revizija atomarno (vzorec R537-d, zrcalo R537 POST /api/payments): preostala
  // plačila se preberejo ZNOTRAJ tx (znesek `paid` iz vseh preostalih plačil).
  const rezultat = await db.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { id }, include: { invoice: true } })
    if (!existing) return { napaka: jsonError(404, 'Plačilo ne obstaja.') }
    if (existing.invoice.status === 'ZAPRT') {
      return { napaka: jsonError(400, 'Plačila zaprtega računa ni mogoče brisati.', `Račun ${existing.invoice.code} je ZAPRT.`) }
    }

    await tx.payment.delete({ where: { id } })
    const recalc = await recalcInvoice(existing.invoiceId, tx)

    await writeAudit({
      userId: user.id, action: 'PAYMENT_DELETE', entity: 'payment', entityId: id, projectId: existing.invoice.projectId,
      detail: { amount: existing.amount, method: existing.method, invoiceCode: existing.invoice.code, paid: recalc.paid, status: recalc.status },
    }, tx)

    return { recalc }
  })
  if ('napaka' in rezultat && rezultat.napaka) return rezultat.napaka

  return NextResponse.json({ data: { ok: true, recalc: rezultat.recalc } })
}

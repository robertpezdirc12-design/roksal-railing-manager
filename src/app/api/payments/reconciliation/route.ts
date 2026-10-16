import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/payments/reconciliation — R437 (route-map izvirnika): uskladitev plačil z računi
// POST (payments.read): poročilo za vse račune (status != OSNUTEK):
//   vsak račun → { code, customer, total, paid, sumPayments, diff, status, paymentsCount, lastPaymentAt }
//   povzetek   → skupaj total/paid/odprto, št. PLACAN/DELNO/NEPLACAN/ZAPRT,
//                seznam preplačil (paid > total) in odstopanj (paid != sumPayments)
// ?fix=1 (payments.manage): sinhronizira invoice.paid = vsota svojih plačil + status
//   (ZAPRT ohrani status) + revizija PAYMENT_RECONCILE (detail: koliko popravljenih).
// Odgovor je vedno (posodobljeno) poročilo.

const round2 = (n: number) => Math.round(n * 100) / 100

export async function POST (req: NextRequest) {
  const fix = new URL(req.url).searchParams.get('fix') === '1'
  const auth = await requirePermission(req, fix ? 'payments.manage' : 'payments.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // ── uskladitev (?fix=1): paid ← vsota plačil, status ← pravilo ──────────────
  let fixed = 0
  if (fix) {
    // R539 (transakcijska celovitost): uskladitev VSEH računov + revizija v
    // ENI transakciji — prej bi padec srednjega koraka pustil DELNO usklajene
    // račune brez revizije. Branje računov+plačil je ZNOTRAJ tx (vsote morajo
    // biti sveže glede na zapis — zrcalo /api/payments iz R537-d); poročilo
    // se bere PO commitu na globalnem klientu (vedno sveže stanje).
    await db.$transaction(async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: { status: { not: 'OSNUTEK' } },
        include: { payments: true },
      })
      for (const inv of invoices) {
        const sumPayments = round2(inv.payments.reduce((s, p) => s + p.amount.toNumber(), 0))
        const status = inv.status === 'ZAPRT'
          ? 'ZAPRT'
          : sumPayments + 0.005 >= inv.total.toNumber() ? 'PLACAN' : sumPayments > 0 ? 'DELNO_PLACAN' : 'IZDAN'
        const paidDiffers = Math.abs(inv.paid.toNumber() - sumPayments) > 0.005
        if (paidDiffers || inv.status !== status) {
          await tx.invoice.update({ where: { id: inv.id }, data: { paid: sumPayments, status } })
          fixed++
        }
      }
      if (fixed > 0) {
        await writeAudit({
          userId: user.id, action: 'PAYMENT_RECONCILE', entity: 'invoice',
          detail: { popravljenih: fixed, obseg: 'paid ← vsota plačil + status' },
        }, tx)
      } else {
        await writeAudit({ userId: user.id, action: 'PAYMENT_RECONCILE', entity: 'invoice', detail: { popravljenih: 0 } }, tx)
      }
    })
  }

  // ── poročilo (po morebitni uskladitvi — vedno sveže stanje) ─────────────────
  const invoices = await db.invoice.findMany({
    where: { status: { not: 'OSNUTEK' } },
    include: {
      payments: { orderBy: { createdAt: 'desc' } },
      project: { select: { customer: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const rows = invoices.map((inv) => {
    const sumPayments = round2(inv.payments.reduce((s, p) => s + p.amount.toNumber(), 0))
    return {
      id: inv.id,
      code: inv.code,
      customer: inv.project?.customer?.name ?? null,
      total: round2(inv.total.toNumber()),
      paid: round2(inv.paid.toNumber()),
      sumPayments,
      diff: round2(inv.paid.toNumber() - sumPayments),
      status: inv.status,
      paymentsCount: inv.payments.length,
      lastPaymentAt: inv.payments[0]?.createdAt.toISOString() ?? null,
    }
  })

  const summary = {
    invoices: rows.length,
    total: round2(rows.reduce((s, r) => s + r.total, 0)),
    paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
    open: round2(rows.reduce((s, r) => s + Math.max(r.total - r.paid, 0), 0)),
    placani: rows.filter((r) => r.status === 'PLACAN').length,
    delnoPlacani: rows.filter((r) => r.status === 'DELNO_PLACAN').length,
    neplacani: rows.filter((r) => r.status === 'IZDAN').length,
    zaprti: rows.filter((r) => r.status === 'ZAPRT').length,
  }
  const preplacila = rows.filter((r) => r.paid > r.total + 0.005).map((r) => ({ code: r.code, paid: r.paid, total: r.total }))
  const odstopanja = rows.filter((r) => Math.abs(r.diff) > 0.005).map((r) => ({ code: r.code, paid: r.paid, sumPayments: r.sumPayments, diff: r.diff }))

  return NextResponse.json({ data: { rows, summary, preplacila, odstopanja, ...(fix ? { fixed } : {}) } })
}

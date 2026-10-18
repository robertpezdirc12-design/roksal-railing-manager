// API /api/quotes/[id] — podrobnost s pozicijami (quotes.read) + sprememba statusa
// PATCH: osnovna vrata quotes.create; če status → SPREJET, dodatno zahtevaj quotes.approve.
// ZAKLENJEN je dosegljiv IZKLJUČNO prek podpisa stranke (/api/quotes/[id]/sign — deal.lock).
//
// R476 (issue #9 §5): PATCH { discountPct } — popust na celotno ponudbo (0..100 %).
// DDV se preračuna iz osnove PO popustu. Popust je mogoče spreminjati SAMO na
// OSNUTKU (poslane/sprejete/zaklenjene ponudbe se tiho ne spreminjajo).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { computeQuoteTotals, parseDiscountPct } from '@/lib/quote-core'

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
  const hasStatus = typeof body?.status === 'string' && body.status.length > 0
  const hasDiscount = body?.discountPct !== undefined && body?.discountPct !== null
  if (!hasStatus && !hasDiscount) {
    return jsonError(400, 'Podajte status ali discountPct.', 'Primer telesa: { status: "POSLAN" } ali { discountPct: 5 }.')
  }
  if (hasStatus && hasDiscount) {
    return jsonError(400, 'Status in popust se spreminjata ločeno.', 'Dva klica PATCH — status in discountPct.')
  }

  const existing = await db.quote.findUnique({ where: { id }, include: { lines: true } })
  if (!existing) return jsonError(404, 'Ponudba ne obstaja.')
  if (existing.status === 'ZAKLENJEN') {
    return jsonError(400, 'Zaklenjene ponudbe ni mogoče spreminjati.', 'Posel je zaklenjen s podpisom stranke.')
  }

  // ── R476: sprememba popusta (samo osnutek) ─────────────────────────────────
  if (hasDiscount) {
    const discountPct = parseDiscountPct(body.discountPct)
    if (discountPct === null) {
      return jsonError(400, 'Popust mora biti število med 0 in 100 %.')
    }
    if (existing.status !== 'OSNUTEK') {
      return jsonError(400, 'Popust je mogoče spremeniti samo na osnutku ponudbe.', `Ta ponudba je v statusu ${existing.status} — poslanih/sprejetih ponudb se ne spreminja tiho.`)
    }
    const totals = computeQuoteTotals(existing.lines.map((l) => l.total.toNumber()), discountPct)
    // R537 (transakcijska celovitost): popust (preračun zneskov) + revizija v ENI transakciji.
    const updated = await db.$transaction(async (tx) => {
      const updated = await tx.quote.update({
        where: { id },
        data: {
          discountPct: discountPct > 0 ? discountPct : null,
          discount: totals.discount,
          subtotal: totals.subtotal,
          vat: totals.vat,
          total: totals.total,
        },
        include: {
          customer: { select: { name: true, city: true } },
          project: { select: { code: true, title: true } },
          lines: true,
        },
      })
      await writeAudit({
        userId: auth.user.id, action: 'QUOTE_DISCOUNT', entity: 'quote', entityId: id, projectId: existing.projectId,
        detail: {
          code: existing.code,
          fromPct: existing.discountPct?.toNumber() ?? 0,
          toPct: discountPct,
          ...totals,
        },
      }, tx)
      return updated
    })
    return NextResponse.json({ data: updated })
  }

  // ── sprememba statusa (obstoječi tok) ─────────────────────────────────────
  const status = body?.status as string
  if (status === 'ZAKLENJEN') {
    return jsonError(400, 'Zaklenitev poteka samo s podpisom stranke.', 'Uporabite modul Signatura (podpis → zaklep posla).')
  }
  if (!PATCHABLE_STATUSES.includes(status)) {
    return jsonError(400, 'Neveljaven status ponudbe.', `Dovoljeni: ${PATCHABLE_STATUSES.join(', ')}.`)
  }
  if (status === 'SPREJET' && !auth.perms.includes('quotes.approve')) {
    return jsonError(403, 'Sprejem ponudbe zahteva pravico quotes.approve.', 'Vrata določa permissions-core katalog.')
  }
  if (existing.status === status) return jsonError(400, 'Ponudba je že v tem statusu.')

  // R564 (issue #24): ZAVEZUJOČA ponudba (POSLAN/SPREJET) zahteva cene iz
  // ODODRENega cenika (priceCheck=APPROVED). Demo/neodobrene/nepreverjene
  // cene NE postanejo tiho zavezujoče — izjema je IZRECEN override z razlogom
  // (priceOverride.reason) z dobrimbeno pravico quotes.approve, ki se zapiše
  // v revizijo; ponudba ostane vidno označena kot okvirna.
  if ((status === 'POSLAN' || status === 'SPREJET') && existing.priceCheck !== 'APPROVED') {
    const ov = body?.priceOverride
    const razlog = typeof ov?.reason === 'string' ? ov.reason.trim().slice(0, 300) : ''
    if (!razlog) {
      return jsonError(
        409,
        `Ponudba ima cene brez odobritve (${existing.priceCheck === 'DEMO' ? 'demo/neodobren cenik' : 'vir cene ni preverjen'}) in ne more postati zavezujoča.`,
        'Odobrite cenik (PATCH /api/price-lists/[id] → APPROVED) in ponovno izdelajte ponudbo, ali podajte priceOverride.reason (zahteva quotes.approve) za izrecno okvirno ponudbo.'
      )
    }
    if (!auth.perms.includes('quotes.approve')) {
      return jsonError(403, 'Override cen zahteva pravico quotes.approve.', 'Samo odgovorna oseba lahko pošlje okvirno ponudbo z neodobljenimi cenami.')
    }
  }

  // R537 (transakcijska celovitost): sprememba statusa + revizija v ENI transakciji.
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.quote.update({
      where: { id },
      data: {
        status,
        // R474: izrecna sprememba statusa = pisarna je zastarelost pregledala
        ...(existing.staleAt ? { staleAt: null, staleReason: null } : {}),
      },
      include: {
        customer: { select: { name: true, city: true } },
        project: { select: { code: true, title: true } },
        lines: true,
      },
    })
    await writeAudit({
      userId: auth.user.id, action: 'QUOTE_STATUS', entity: 'quote', entityId: id, projectId: existing.projectId,
      detail: {
        code: existing.code, from: existing.status, to: status,
        priceCheck: existing.priceCheck,
        ...(typeof body?.priceOverride?.reason === 'string' && body.priceOverride.reason.trim()
          ? { priceOverride: body.priceOverride.reason.trim().slice(0, 300) }
          : {}),
      },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

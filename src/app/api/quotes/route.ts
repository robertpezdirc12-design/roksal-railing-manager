// API /api/quotes — seznam s številom pozicij (quotes.read) + ustvarjanje s pozicijami (quotes.create)
// Izračun: subtotal → [popust −] → DDV 22 % → total (R476: DDV iz osnove PO popustu).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { computeQuoteTotals, parseDiscountPct, round2 } from '@/lib/quote-core'

/** Zaporedna koda PON-<leto>-<seq> — robustno glede na obstoječe kode istega leta. */
async function nextQuoteCode (): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `PON-${year}-`
  const existing = await db.quote.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } })
  const seqs = existing
    .map((c) => parseInt(c.code.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
  const next = (seqs.length ? Math.max(...seqs) : 0) + 1
  return `${prefix}${String(next).padStart(3, '0')}`
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'quotes.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  const status = url.searchParams.get('status')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500)

  const quotes = await db.quote.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q ? {
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { note: { contains: q, mode: 'insensitive' } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
          { project: { title: { contains: q, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    include: {
      customer: { select: { name: true, city: true } },
      project: { select: { code: true, title: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ data: quotes })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)

  // stranka / projekt (opcijsko, a če sta podana — morata obstajati)
  const customerId = typeof body?.customerId === 'string' && body.customerId ? body.customerId : null
  const projectId = typeof body?.projectId === 'string' && body.projectId ? body.projectId : null
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId } })
    if (!customer) return jsonError(404, 'Stranka ne obstaja.')
  }
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
  }
  // R474 (issue #9 §5): povezava na paket — omogoča invalidacijo ob spremembi obsega
  const packageId = typeof body?.packageId === 'string' && body.packageId ? body.packageId : null
  if (packageId) {
    const pkg = await db.projectPackage.findUnique({ where: { id: packageId }, select: { id: true, projectId: true } })
    if (!pkg) return jsonError(404, 'Paket ne obstaja.')
    if (projectId && pkg.projectId !== projectId) {
      return jsonError(400, 'Paket pripada drugemu projektu.', 'Ponudba in paket morata biti na istem projektu.')
    }
  }

  // pozicije
  const rawLines: unknown[] = Array.isArray(body?.lines) ? body.lines : []
  if (rawLines.length === 0) return jsonError(400, 'Ponudba potrebuje vsaj eno pozicijo.')
  // R476 (issue #9 §5): popust na celotno ponudbo (0..100 %) — neobvezen
  const discountPct = body?.discountPct === undefined || body?.discountPct === null
    ? 0
    : parseDiscountPct(body.discountPct)
  if (discountPct === null) {
    return jsonError(400, 'Popust mora biti število med 0 in 100 %.')
  }

  const lines: { description: string; qty: number; unitPrice: number; total: number }[] = []
  for (const [i, l] of rawLines.entries()) {
    const line = l as { description?: unknown; qty?: unknown; unitPrice?: unknown } | null
    const description = typeof line?.description === 'string' ? line.description.trim() : ''
    const qty = Number(line?.qty)
    const unitPrice = Number(line?.unitPrice)
    if (!description) return jsonError(400, `Pozicija ${i + 1}: opis je obvezen.`)
    if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, `Pozicija ${i + 1}: količina mora biti večja od 0.`)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return jsonError(400, `Pozicija ${i + 1}: cena na enoto ni veljavna.`)
    lines.push({ description, qty, unitPrice, total: round2(qty * unitPrice) })
  }

  const totals = computeQuoteTotals(lines.map((l) => l.total), discountPct)
  const code = await nextQuoteCode()

  const quote = await db.quote.create({
    data: {
      code,
      status: 'OSNUTEK',
      customerId,
      projectId,
      packageId,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
      discountPct: discountPct > 0 ? discountPct : null,
      discount: totals.discount,
      subtotal: totals.subtotal,
      vat: totals.vat,
      total: totals.total,
      lines: { create: lines },
    },
    include: {
      customer: { select: { name: true, city: true } },
      project: { select: { code: true, title: true } },
      _count: { select: { lines: true } },
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'QUOTE_CREATE', entity: 'quote', entityId: quote.id, projectId,
    detail: { code, customerId, packageId, lines: lines.length, ...totals },
  })
  return NextResponse.json({ data: quote }, { status: 201 })
}

// API /api/invoices — seznam (invoices.read) + izdaja iz ponudbe (invoices.issue, R425 ločitev)
// POST { quoteId, projectId?, dueDate? } — prekopira zneske ponudbe, koda RA-<leto>-<seq>.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const ISSUABLE_QUOTE_STATUSES = ['SPREJET', 'ZAKLENJEN']

/** Zaporedna koda RA-<leto>-<seq> — robustno glede na obstoječe kode istega leta. */
async function nextInvoiceCode (): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `RA-${year}-`
  const existing = await db.invoice.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } })
  const seqs = existing
    .map((c) => parseInt(c.code.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
  const next = (seqs.length ? Math.max(...seqs) : 0) + 1
  return `${prefix}${String(next).padStart(3, '0')}`
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'invoices.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  const status = url.searchParams.get('status')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500)

  const invoices = await db.invoice.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q ? {
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { project: { title: { contains: q, mode: 'insensitive' } } },
          { project: { customer: { name: { contains: q, mode: 'insensitive' } } } },
          { quote: { code: { contains: q, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    include: {
      project: { select: { code: true, title: true, customer: { select: { name: true } } } },
      quote: { select: { code: true } },
      _count: { select: { payments: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ data: invoices })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'invoices.issue')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const quoteId = typeof body?.quoteId === 'string' ? body.quoteId : ''
  if (!quoteId) return jsonError(400, 'quoteId je obvezen.', 'Račun se izda iz sprejete ponudbe.')

  const quote = await db.quote.findUnique({ where: { id: quoteId } })
  if (!quote) return jsonError(404, 'Ponudba ne obstaja.')
  if (!ISSUABLE_QUOTE_STATUSES.includes(quote.status)) {
    return jsonError(400, 'Račun je mogoče izdati samo iz sprejete ali zaklenjene ponudbe.', `Status ponudbe ${quote.code}: ${quote.status}.`)
  }

  const projectId = typeof body?.projectId === 'string' && body.projectId ? body.projectId : quote.projectId
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
  }

  let dueDate: Date | null = null
  if (typeof body?.dueDate === 'string' && body.dueDate) {
    const parsed = new Date(body.dueDate)
    if (Number.isNaN(parsed.getTime())) return jsonError(400, 'Rok plačila ni veljaven datum.')
    dueDate = parsed
  } else {
    dueDate = new Date(Date.now() + 30 * 86400000) // privzeto 30 dni
  }

  const code = await nextInvoiceCode()
  // R476: račun podeduje OSNOVO PO POPUSTU (subtotal − discount) — tako so
  // zneski računa aritmetično konsistentni (osnova + DDV = skupaj). Popust se
  // je zgodil na ponudbi; račun zaračuna dogovorjeni (popustljeni) znesek.
  const invoiceSubtotal = quote.subtotal.minus(quote.discount)
  const invoice = await db.invoice.create({
    data: {
      code,
      status: 'IZDAN',
      projectId,
      quoteId,
      subtotal: invoiceSubtotal,
      vat: quote.vat,
      total: quote.total,
      paid: 0,
      dueDate,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
    },
    include: {
      project: { select: { code: true, title: true, customer: { select: { name: true } } } },
      quote: { select: { code: true } },
      _count: { select: { payments: true } },
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'INVOICE_ISSUE', entity: 'invoice', entityId: invoice.id, projectId,
    detail: { code, quoteCode: quote.code, total: quote.total, dueDate: dueDate.toISOString() },
  })
  return NextResponse.json({ data: invoice }, { status: 201 })
}

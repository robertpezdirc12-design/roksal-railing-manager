// API /api/invoices — seznam (invoices.read) + izdaja iz ponudbe (invoices.issue, R425 ločitev)
// POST { quoteId, projectId?, dueDate? } — prekopira zneske ponudbe, koda RA-<leto>-<seq>.

import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import { retryOnUnique } from '@/lib/versioning'

const ISSUABLE_QUOTE_STATUSES = ['SPREJET', 'ZAKLENJEN']

// R536: zod shema za izdajo računa — quoteId obvezen; projectId/dueDate/note
// neobvezni (privzeti: projekt ponudbe, rok +30 dni, brez opombe).
const InvoiceIssueSchema = z.object({
  quoteId: z.string().min(1, 'quoteId je obvezen.'),
  projectId: z.string().nullish().transform((v) => v || null),
  dueDate: z.string().nullish().transform((v) => v || null),
  note: z.string().trim().nullish().transform((v) => v || null),
})

/** Zaporedna koda RA-<leto>-<seq> — robustno glede na obstoječe kode istega leta.
 *  R537 (vzorec R535 nextQuoteCode): izračun teče ZNOTRAJ transakcije (sprejme
 *  tx), s čimer je koda+zapis+revizija enota; sočasnost rešuje ponovljen
 *  poskus ob P2002 (v POST prek retryOnUnique). */
async function nextInvoiceCode (tx: Prisma.TransactionClient = db): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `RA-${year}-`
  const existing = await tx.invoice.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } })
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

  const parsed = await parseBody(req, InvoiceIssueSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data
  const quoteId = data.quoteId

  const quote = await db.quote.findUnique({ where: { id: quoteId } })
  if (!quote) return jsonError(404, 'Ponudba ne obstaja.')
  if (!ISSUABLE_QUOTE_STATUSES.includes(quote.status)) {
    return jsonError(400, 'Račun je mogoče izdati samo iz sprejete ali zaklenjene ponudbe.', `Status ponudbe ${quote.code}: ${quote.status}.`)
  }

  const projectId = data.projectId ?? quote.projectId
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
  }

  let dueDate: Date | null = null
  if (data.dueDate) {
    const parsedDate = new Date(data.dueDate)
    if (Number.isNaN(parsedDate.getTime())) return jsonError(400, 'Rok plačila ni veljaven datum.')
    dueDate = parsedDate
  } else {
    dueDate = new Date(Date.now() + 30 * 86400000) // privzeto 30 dni
  }

  // R476: račun podeduje OSNOVO PO POPUSTU (subtotal − discount) — tako so
  // zneski računa aritmetično konsistentni (osnova + DDV = skupaj). Popust se
  // je zgodil na ponudbi; račun zaračuna dogovorjeni (popustljeni) znesek.
  const invoiceSubtotal = quote.subtotal.minus(quote.discount)
  // R537 (transakcijska celovitost, vzorec R535 za ponudbe): koda + račun +
  // revizija v ENI transakciji; ob sočasnem P2002 (dva izida si izračunata
  // isto kodo) do 3 poskusi (retryOnUnique — fn znova prebere kode).
  const invoice = await retryOnUnique(() => db.$transaction(async (tx) => {
    const code = await nextInvoiceCode(tx)
    const invoice = await tx.invoice.create({
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
        note: data.note,
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
    }, tx)
    return invoice
  }), 3)
  return NextResponse.json({ data: invoice }, { status: 201 })
}

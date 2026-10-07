// API /api/documents — POENOTEN ARHIV dokumentov (documents.read)
// Združi ponudbe (vrsta PONUDBA) in račune (vrsta RACUN) v en kronološki seznam.
// Filtri: ?q= (koda/stranka) &type=ponudba|racun &status=
// PDF izvoz je ločen modul (documents.generate) — tu zgolj arhiv.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'

interface DocRow {
  id: string
  kind: 'PONUDBA' | 'RACUN'
  code: string
  status: string
  total: number
  paid: number | null // samo računi
  customerName: string | null
  projectCode: string | null
  projectTitle: string | null
  dueDate: string | null
  createdAt: Date
  signed: boolean
  signedBy: string | null
  signedAt: Date | null
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'documents.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  const type = url.searchParams.get('type') // ponudba | racun
  const status = url.searchParams.get('status')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 200) || 200, 1), 500)

  if (type && type !== 'ponudba' && type !== 'racun') {
    return NextResponse.json({ error: 'Neveljaven tip dokumenta.', detail: 'Dovoljeno: ponudba, racun.' }, { status: 400 })
  }

  const wantQuotes = type !== 'racun'
  const wantInvoices = type !== 'ponudba'

  const quoteFilter = {
    ...(status ? { status } : {}),
    ...(q ? {
      OR: [
        { code: { contains: q } },
        { customer: { name: { contains: q } } },
        { project: { title: { contains: q } } },
      ],
    } : {}),
  }
  const invoiceFilter = {
    ...(status ? { status } : {}),
    ...(q ? {
      OR: [
        { code: { contains: q } },
        { project: { customer: { name: { contains: q } } } },
        { project: { title: { contains: q } } },
      ],
    } : {}),
  }

  const [quotes, invoices] = await Promise.all([
    wantQuotes ? db.quote.findMany({
      where: quoteFilter,
      include: {
        customer: { select: { name: true } },
        project: { select: { code: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) : Promise.resolve([]),
    wantInvoices ? db.invoice.findMany({
      where: invoiceFilter,
      include: {
        project: { select: { code: true, title: true, customer: { select: { name: true } } } },
        quote: { select: { customer: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) : Promise.resolve([]),
  ])

  const documents: DocRow[] = [
    ...quotes.map((qq): DocRow => ({
      id: qq.id,
      kind: 'PONUDBA',
      code: qq.code,
      status: qq.status,
      total: qq.total,
      paid: null,
      customerName: qq.customer?.name ?? null,
      projectCode: qq.project?.code ?? null,
      projectTitle: qq.project?.title ?? null,
      dueDate: null,
      createdAt: qq.createdAt,
      signed: !!qq.signature,
      signedBy: qq.signedBy,
      signedAt: qq.signedAt,
    })),
    ...invoices.map((iv): DocRow => ({
      id: iv.id,
      kind: 'RACUN',
      code: iv.code,
      status: iv.status,
      total: iv.total,
      paid: iv.paid,
      customerName: iv.project?.customer?.name ?? iv.quote?.customer?.name ?? null,
      projectCode: iv.project?.code ?? null,
      projectTitle: iv.project?.title ?? null,
      dueDate: iv.dueDate,
      createdAt: iv.createdAt,
      signed: false,
      signedBy: null,
      signedAt: null,
    })),
  ]

  documents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return NextResponse.json({ data: { documents: documents.slice(0, limit) } })
}

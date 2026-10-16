// API /api/quotes — seznam s številom pozicij (quotes.read) + ustvarjanje s pozicijami (quotes.create)
// Izračun: subtotal → [popust −] → DDV 22 % → total (R476: DDV iz osnove PO popustu).

import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { projectIdsZaUporabnika } from '@/lib/fence-run-access'
import { writeAudit } from '@/lib/audit'
import { computeQuoteTotals, parseDiscountPct, round2 } from '@/lib/quote-core'
import { parseBody } from '@/lib/validate'

// R536: zod shema za ustvarjanje ponudbe — zrcali prejšnjo ročno validacijo:
//  • stranka/projekt/paket neobvezni (null ⇒ brez; obstoj se preverja v handlerju)
//  • lines: vsaj ena pozicija; opis neprazen po trim; qty > 0; unitPrice ≥ 0
//    (z.coerce sprejme tudi številske nize — kot Number() prej)
//  • discountPct: število ali niz (dopusti decimalno vejico), 0..100 — meje
//    ostaja preverjati parseDiscountPct (en vir resnice iz quote-core)
//  • note: neobvezna (prazno ⇒ null)
const QuoteLineSchema = z.object({
  description: z.string().trim().min(1, 'opis je obvezen'),
  qty: z.coerce.number().positive('količina mora biti večja od 0'),
  unitPrice: z.coerce.number().nonnegative('cena na enoto ni veljavna'),
})
const QuoteCreateSchema = z.object({
  customerId: z.string().nullish().transform((v) => v || null),
  projectId: z.string().nullish().transform((v) => v || null),
  packageId: z.string().nullish().transform((v) => v || null),
  lines: z.array(QuoteLineSchema).min(1, 'Ponudba potrebuje vsaj eno pozicijo.'),
  discountPct: z.union([z.number(), z.string()]).nullish(),
  note: z.string().trim().nullish().transform((v) => v || null),
})

/** Zaporedna koda PON-<leto>-<seq> — robustno glede na obstoječe kode istega leta.
 *  R535: izračun teče ZNOTRAJ transakcije (sprejme tx), s čimer je koda+zapis
 *  enota; sočasnost rešuje ponovljen poskus ob P2002 (v POST). */
async function nextQuoteCode (tx: Prisma.TransactionClient = db): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `PON-${year}-`
  const existing = await tx.quote.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } })
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

  // R535 (revizija analize): obseg MONTER — isti vzorec kot /api/nalog in
  // /api/fence-run: uporabnik z omejenim branjem vidi SAMO ponudbe svojih
  // projektov (nalog, dodeljenih njemu). Prazna dodelitev = prazen seznam
  // (fail-closed), nikoli „vidi vse“ z zneski vseh strank.
  const scopeIds = await projectIdsZaUporabnika(auth.user) // null = brez filtra (pisarna)

  const quotes = await db.quote.findMany({
    where: {
      ...(scopeIds ? { projectId: { in: scopeIds } } : {}),
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

  const parsed = await parseBody(req, QuoteCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // stranka / projekt (opcijsko, a če sta podana — morata obstajati)
  const { customerId, projectId } = data
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId } })
    if (!customer) return jsonError(404, 'Stranka ne obstaja.')
  }
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
  }
  // R474 (issue #9 §5): povezava na paket — omogoča invalidacijo ob spremembi obsega
  const packageId = data.packageId
  if (packageId) {
    const pkg = await db.projectPackage.findUnique({ where: { id: packageId }, select: { id: true, projectId: true } })
    if (!pkg) return jsonError(404, 'Paket ne obstaja.')
    if (projectId && pkg.projectId !== projectId) {
      return jsonError(400, 'Paket pripada drugemu projektu.', 'Ponudba in paket morata biti na istem projektu.')
    }
  }

  // pozicije: zneski pozicije izračuna strežnik (round2) — enostransko zaupanje
  const lines = data.lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, total: round2(l.qty * l.unitPrice) }))

  // R476 (issue #9 §5): popust na celotno ponudbo (0..100 %) — neobvezen
  const discountPct = data.discountPct === undefined || data.discountPct === null
    ? 0
    : parseDiscountPct(data.discountPct)
  if (discountPct === null) {
    return jsonError(400, 'Popust mora biti število med 0 in 100 %.')
  }

  const totals = computeQuoteTotals(lines.map((l) => l.total), discountPct)

  // R535: koda + zapis v ENI transakciji, ob sočasnem P2002 (dva POST si
  // izračunata isto kodo) do 3 poskusi — read-then-create dirka je s tem zaprta.
  const isCodeCollision = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'P2002'
  const buildWithCode = () => db.$transaction(async (tx) => {
    const code = await nextQuoteCode(tx)
    return tx.quote.create({
      data: {
        code,
        status: 'OSNUTEK',
        customerId,
        projectId,
        packageId,
        note: data.note,
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
  })
  let quote: Awaited<ReturnType<typeof buildWithCode>>
  for (let attempt = 1; ; attempt++) {
    try {
      quote = await buildWithCode()
      break
    } catch (err) {
      if (isCodeCollision(err) && attempt < 3) continue // sočasni POST je vzel isto kodo → preberi ponovno
      throw err
    }
  }

  await writeAudit({
    userId: auth.user.id, action: 'QUOTE_CREATE', entity: 'quote', entityId: quote.id, projectId,
    detail: { code: quote.code, customerId, packageId, lines: lines.length, ...totals },
  })
  return NextResponse.json({ data: quote }, { status: 201 })
}

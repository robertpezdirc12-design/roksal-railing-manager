// API /api/pdf/[type]/[id] — izvoz ponudbe/računa/foto-vizualizacije v PDF (documents.generate)
// GET → application/pdf (inline; filename="<koda>.pdf"), lasten generator pdf-mini.
// R459: tip photoviz — dokument FOTO-VIZUALIZACIJE s PREJ/POTEM slikama (issue #14 §14).
// Revizija: DOC_GENERATE (entity quote|invoice|photoviz).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { jpegSize, pdfDoc, AMBER, GRAY, LIGHT, NAVY, PAGE_W, type Rgb } from '@/lib/pdf-mini'
import { vizZaUporabnika } from '@/lib/photo-replace-engine'
import { VIZ_ZIG } from '@/lib/photo-replace-core'

type Params = { params: Promise<{ type: string; id: string }> }

const M = 48          // levi rob
const R = PAGE_W - 48 // desni rob (547)
const VAT_LABEL = 'DDV 22 %'

const GREEN: Rgb = [0.05, 0.55, 0.35]

const QUOTE_STATUS: Record<string, string> = {
  OSNUTEK: 'Osnutek', POSLAN: 'Poslan', SPREJET: 'Sprejet', ZAVRNJEN: 'Zavrnjen', ZAKLENJEN: 'Zaklenjen (podpisano)',
}
const INVOICE_STATUS: Record<string, string> = {
  OSNUTEK: 'Osnutek', IZDAN: 'Izdan', DELNO_PLACAN: 'Delno plačan', PLACAN: 'Plačan', ZAPRT: 'Zaprt',
}
const PAY_METHOD: Record<string, string> = { NAKAZNICA: 'Nakaznica', GOTOVINA: 'Gotovina', KARTICA: 'Kartica' }

const fmtDate = (d: Date | string | null | undefined): string => {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime())
    ? '—'
    : `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`
}

const fmtEUR = (n: number | null | undefined): string =>
  new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR' }).format(n ?? 0)

const num = (v: number | null | undefined, digits = 2): string =>
  (v ?? 0).toFixed(digits).replace('.', ',')

interface CustomerLike {
  name?: string | null; address?: string | null; city?: string | null
  taxId?: string | null; email?: string | null; phone?: string | null
}

/** Glava + naslov + blok stranke → vrne y za nadaljevanje. */
function drawHeader (
  doc: ReturnType<typeof pdfDoc>,
  title: string,
  code: string,
  statusLabel: string,
  dateLabel: string,
  customer: CustomerLike | null,
  projectLabel: string | null
): number {
  doc.text(M, 54, 'ROKSAL RAILING MANAGER', { size: 16, bold: true, color: NAVY })
  doc.text(R, 50, 'info@roksal.si · +386 1 234 56 78', { size: 8, color: GRAY, align: 'right' })
  doc.text(R, 60, 'Lesarska cesta 12, 2380 Slovenj Graddek', { size: 8, color: GRAY, align: 'right' })
  doc.line(M, 70, R, 70, { width: 2.5, color: AMBER })

  doc.text(M, 108, title, { size: 22, bold: true })
  doc.text(R, 100, code, { size: 12, bold: true, color: NAVY, align: 'right' })
  doc.text(R, 114, `Datum izdaje: ${dateLabel}`, { size: 9, color: GRAY, align: 'right' })
  doc.text(R, 127, `Status: ${statusLabel}`, { size: 9, color: GRAY, align: 'right' })

  let y = 156
  doc.text(M, y, 'STRANKA', { size: 8, bold: true, color: LIGHT })
  y += 16
  if (customer) {
    doc.text(M, y, customer.name || '—', { size: 12, bold: true })
    y += 15
    const lines = [
      [customer.address, customer.city].filter(Boolean).join(', '),
      customer.taxId ? `Davčna št.: ${customer.taxId}` : null,
      [customer.email, customer.phone].filter(Boolean).join(' · '),
    ].filter((l): l is string => !!l && l.trim().length > 0)
    for (const line of lines) {
      doc.text(M, y, line, { size: 9.5, color: GRAY })
      y += 13
    }
  } else {
    doc.text(M, y, '— ni določene stranke —', { size: 10, color: GRAY })
    y += 13
  }
  if (projectLabel) {
    doc.text(M, y, projectLabel, { size: 9.5, color: GRAY })
    y += 13
  }
  return y + 16
}

interface TablePageState { y: number }

/** Tabela pozicij z glavo; samodejo prelomi na novo stran. */
function drawLinesTable (
  doc: ReturnType<typeof pdfDoc>,
  state: TablePageState,
  lines: { description: string; qty: number; unitPrice: number; total: number }[]
): void {
  const drawHead = (continued: boolean): number => {
    const headY = state.y + 6
    doc.line(M, headY - 6, R, headY - 6, { width: 1, color: NAVY })
    doc.text(M + 4, headY + 6, continued ? 'Opis (nadaljevanje)' : 'Opis', { size: 9, bold: true, color: NAVY })
    doc.text(390, headY + 6, 'Količina', { size: 9, bold: true, color: NAVY, align: 'right' })
    doc.text(470, headY + 6, 'Cena (EUR)', { size: 9, bold: true, color: NAVY, align: 'right' })
    doc.text(R, headY + 6, 'Skupaj (EUR)', { size: 9, bold: true, color: NAVY, align: 'right' })
    doc.line(M, headY + 12, R, headY + 12, { width: 1, color: NAVY })
    return headY + 28
  }
  let y = drawHead(false)

  lines.forEach((line, idx) => {
    const descLines = doc.wrap(line.description || '—', 320, 9.5)
    const rowH = Math.max(18, descLines.length * 12 + 6)
    // prelom strani
    if (y + rowH > 730) {
      doc.addPage()
      state.y = 60
      y = drawHead(true)
    }
    if (idx % 2 === 1) doc.rect(M, y - 9, R - M, rowH, { fill: [0.965, 0.965, 0.95] })
    descLines.forEach((dl, i) => {
      doc.text(M + 4, y + i * 12, dl, { size: 9.5 })
    })
    doc.text(390, y, num(line.qty, line.qty % 1 === 0 ? 0 : 2), { size: 9.5, align: 'right' })
    doc.text(470, y, num(line.unitPrice), { size: 9.5, align: 'right' })
    doc.text(R, y, num(line.total), { size: 9.5, align: 'right' })
    y += rowH
    doc.line(M, y - 4, R, y - 4, { width: 0.4 })
  })
  state.y = y + 6
}

/** Skupaj blok (desno poravnan). Vrne končni y. */
function drawTotals (
  doc: ReturnType<typeof pdfDoc>,
  startY: number,
  rows: { label: string; value: string; bold?: boolean; color?: Rgb }[]
): number {
  let y = startY + 6
  for (const row of rows) {
    if (row.bold) doc.line(410, y - 10, R, y - 10, { width: 1, color: NAVY })
    doc.text(470, y, row.label, { size: row.bold ? 11 : 9.5, bold: row.bold, color: row.color ?? (row.bold ? NAVY : GRAY), align: 'right' })
    doc.text(R, y, row.value, { size: row.bold ? 11 : 9.5, bold: row.bold, color: row.color ?? [0.1, 0.12, 0.16], align: 'right' })
    y += row.bold ? 18 : 14
  }
  return y
}

function drawNote (doc: ReturnType<typeof pdfDoc>, y: number, note: string | null | undefined): number {
  if (!note || !note.trim()) return y
  const lines = doc.wrap(note, R - M - 8, 9.5)
  let yy = y + 8
  doc.text(M, yy, 'Opomba', { size: 8, bold: true, color: LIGHT })
  yy += 13
  for (const l of lines) {
    doc.text(M, yy, l, { size: 9.5, color: GRAY })
    yy += 12
  }
  return yy
}

function setFooter (doc: ReturnType<typeof pdfDoc>): void {
  doc.footer((page, total, d) => {
    d.line(M, 792, R, 792, { width: 0.5 })
    d.text(M, 806, 'Roksal · ograje in balustrade', { size: 8, color: LIGHT })
    d.text(PAGE_W / 2, 806, `Stran ${page + 1} / ${total}`, { size: 8, color: LIGHT, align: 'center' })
    d.text(R, 806, 'info@roksal.si', { size: 8, color: LIGHT, align: 'right' })
  })
}

// ─── PONUDBA ─────────────────────────────────────────────────────────────────

async function renderQuotePdf (id: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; code: string; projectId: string | null } | NextResponse> {
  const quote = await db.quote.findUnique({
    where: { id },
    include: {
      customer: true,
      project: { select: { code: true, title: true } },
      lines: true,
    },
  })
  if (!quote) return jsonError(404, 'Ponudba ne obstaja.')

  const doc = pdfDoc()
  setFooter(doc)

  const y0 = drawHeader(
    doc, 'PONUDBA', quote.code,
    QUOTE_STATUS[quote.status] ?? quote.status,
    fmtDate(quote.createdAt),
    quote.customer,
    quote.project ? `Projekt: ${quote.project.code} — ${quote.project.title}` : null
  )

  const state: TablePageState = { y: y0 }
  drawLinesTable(doc, state, quote.lines.map((l) => ({
    description: l.description, qty: l.qty, unitPrice: l.unitPrice.toNumber(), total: l.total.toNumber(),
  })))

  // R476 (issue #9 §5): popust na ponudbo — vidna vrstica v zneskih (DDV je že
  // izračunan iz osnove PO popustu na API-ju; tukaj samo prikaz).
  const discountPct = quote.discountPct?.toNumber() ?? 0
  const discountAmt = quote.discount.toNumber()
  let y = drawTotals(doc, state.y, [
    { label: 'Osnova:', value: fmtEUR(quote.subtotal.toNumber()) },
    ...(discountPct > 0
      ? [{ label: `Popust ${num(discountPct, discountPct % 1 === 0 ? 0 : 2)} %:`, value: `− ${fmtEUR(discountAmt)}` }]
      : []),
    { label: `${VAT_LABEL}:`, value: fmtEUR(quote.vat.toNumber()) },
    { label: 'SKUPAJ Z DDV:', value: fmtEUR(quote.total.toNumber()), bold: true },
  ])

  y = drawNote(doc, y, quote.note)

  if (quote.signature && quote.signedBy) {
    let yy = Math.max(y + 14, 660)
    if (yy > 720) { doc.addPage(); yy = 80 }
    doc.line(M, yy, M + 190, yy, { width: 0.75, color: GRAY })
    doc.text(M, yy + 14, 'PODPIS STRANKE', { size: 8, bold: true, color: LIGHT })
    doc.text(M, yy + 27, `Podpisano elektronsko: ${quote.signedBy}, ${fmtDate(quote.signedAt)}`, { size: 9.5 })
  }

  return { bytes: doc.build(), code: quote.code, projectId: quote.projectId }
}

// ─── RAČUN ───────────────────────────────────────────────────────────────────

async function renderInvoicePdf (id: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; code: string; projectId: string | null } | NextResponse> {
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      project: { select: { code: true, title: true, customer: true } },
      quote: { select: { code: true } },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!invoice) return jsonError(404, 'Račun ne obstaja.')

  const customer = invoice.project?.customer ?? null
  const doc = pdfDoc()
  setFooter(doc)

  const projectLabel = invoice.project
    ? `Projekt: ${invoice.project.code} — ${invoice.project.title}`
    : (invoice.quote ? `Iz ponudbe: ${invoice.quote.code}` : null)

  const y0 = drawHeader(
    doc, 'RAČUN', invoice.code,
    INVOICE_STATUS[invoice.status] ?? invoice.status,
    fmtDate(invoice.createdAt),
    customer,
    projectLabel
  )

  // podatki o plačilu
  let metaY = y0 - 16
  doc.text(M, metaY, `Rok plačila: ${fmtDate(invoice.dueDate)}`, { size: 9.5, bold: true })
  doc.text(R, metaY, `Sklic: ${invoice.code}`, { size: 9.5, bold: true, align: 'right' })
  metaY += 20

  const state: TablePageState = { y: metaY }
  drawLinesTable(doc, state, [{
    description: `Izdelava in montaža po ponudbi ${invoice.quote?.code ?? '—'}`,
    qty: 1, unitPrice: invoice.subtotal.toNumber(), total: invoice.subtotal.toNumber(),
  }])

  // zgodovina plačil
  let payY = state.y + 6
  if (invoice.payments.length > 0) {
    doc.text(M, payY, 'ZGODOVINA PLAČIL', { size: 8, bold: true, color: LIGHT })
    payY += 13
    doc.line(M, payY - 5, R, payY - 5, { width: 0.75, color: GRAY })
    for (const p of invoice.payments) {
      if (payY > 730) { doc.addPage(); payY = 70 }
      doc.text(M + 4, payY + 8, fmtDate(p.createdAt), { size: 9 })
      doc.text(300, payY + 8, PAY_METHOD[p.method] ?? p.method, { size: 9 })
      doc.text(430, payY + 8, p.reference ?? '—', { size: 9 })
      doc.text(R, payY + 8, fmtEUR(p.amount.toNumber()), { size: 9, align: 'right' })
      payY += 17
      doc.line(M, payY - 4, R, payY - 4, { width: 0.4 })
    }
    payY += 4
  }

  const remaining = Math.max(0, invoice.total.toNumber() - invoice.paid.toNumber())
  let y = drawTotals(doc, payY, [
    { label: 'Osnova:', value: fmtEUR(invoice.subtotal.toNumber()) },
    { label: `${VAT_LABEL}:`, value: fmtEUR(invoice.vat.toNumber()) },
    { label: 'SKUPAJ Z DDV:', value: fmtEUR(invoice.total.toNumber()), bold: true },
    { label: 'Plačano:', value: fmtEUR(invoice.paid.toNumber()), color: GREEN },
    { label: 'ZA PLAČILO:', value: fmtEUR(remaining), bold: true, color: remaining > 0 ? NAVY : GREEN },
  ])

  drawNote(doc, y, invoice.note)

  return { bytes: doc.build(), code: invoice.code, projectId: invoice.projectId }
}

// ─── FOTO-VIZUALIZACIJA (R459 — issue #14 §14: vključitev v PDF) ──────────

/** data URL (image/jpeg) → bajti; neveljaven → null. */
function dataUrlToJpeg (dataUrl: string | null | undefined): Uint8Array | null {
  if (!dataUrl || !dataUrl.startsWith('data:image/jpeg;base64,')) return null
  try {
    const b64 = dataUrl.slice('data:image/jpeg;base64,'.length)
    const buf = Buffer.from(b64, 'base64')
    return buf.length > 100 && jpegSize(buf) ? buf : null
  } catch {
    return null
  }
}

interface VizRowFull {
  id: string
  variantLabel: string
  status: string
  sourcePhoto: string
  rendered: string | null
  renderParams: string
  engineVersion: string
  note: string | null
  createdAt: Date
  measurementId: string | null
  measurementVersion: number | null
  projectId: string
  productId: string
  variantId: string | null
  authorId: string | null
  project: { code: string; title: string; customer: { name: string } | null } | null
  product: { sku: string; name: string; family: { code: string } } | null
  variant: { sku: string; name: string; ral: string | null; color: string | null } | null
  author: { name: string } | null
}

async function renderPhotoVizPdf (id: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; code: string; projectId: string | null } | NextResponse> {
  const viz = await db.photoVisualization.findUnique({
    where: { id },
    include: {
      project: { select: { code: true, title: true, customer: { select: { name: true } } } },
      product: { select: { sku: true, name: true, family: { select: { code: true } } } },
      variant: { select: { sku: true, name: true, ral: true, color: true } },
      author: { select: { name: true } },
    },
  }) as VizRowFull | null
  if (!viz) return jsonError(404, 'Vizualizacija ne obstaja.')

  // konfiguracija iz posnetka (prikaz povzetka)
  let cfgInfo = ''
  try {
    const p = JSON.parse(viz.renderParams) as { config?: Record<string, unknown>; reference?: { cm?: number; tip?: string } }
    const c = p.config ?? {}
    const deli = [
      `Tip: ${String(c.tip ?? '—')}`,
      `Dolžina: ${String(c.lengthCm ?? '—')} cm`,
      `Višina: ${String(c.heightCm ?? '—')} cm`,
      `Stebri: ${String(c.posts ?? '—')}`,
      c.handrail === false ? 'Brez ročnika' : 'Z ročnikom',
    ]
    cfgInfo = deli.join(' · ')
  } catch { cfgInfo = '—' }

  const doc = pdfDoc()
  setFooter(doc)

  doc.text(M, 54, 'ROKSAL RAILING MANAGER', { size: 16, bold: true, color: NAVY })
  doc.text(R, 50, 'info@roksal.si · +386 1 234 56 78', { size: 8, color: GRAY, align: 'right' })
  doc.text(R, 60, 'Lesarska cesta 12, 2380 Slovenj Graddek', { size: 8, color: GRAY, align: 'right' })
  doc.line(M, 70, R, 70, { width: 2.5, color: AMBER })

  doc.text(M, 104, 'FOTO-VIZUALIZACIJA', { size: 22, bold: true })
  doc.text(R, 100, `${viz.project?.code ?? ''} — varianta ${viz.variantLabel}`, { size: 12, bold: true, color: NAVY, align: 'right' })
  doc.text(R, 114, `Datum: ${fmtDate(viz.createdAt)}`, { size: 9, color: GRAY, align: 'right' })
  doc.text(R, 127, `Status: ${viz.status === 'IZBRANA' ? 'Izbrana varianta' : viz.status === 'ARHIV' ? 'Arhivirana' : 'Osnutek'}`, { size: 9, color: GRAY, align: 'right' })

  let y = 152
  doc.text(M, y, 'PROJEKT', { size: 8, bold: true, color: LIGHT }); y += 14
  doc.text(M, y, viz.project ? `${viz.project.code} — ${viz.project.title}` : '—', { size: 11, bold: true }); y += 14
  if (viz.project?.customer) { doc.text(M, y, `Stranka: ${viz.project.customer.name}`, { size: 9.5, color: GRAY }); y += 13 }
  doc.text(M, y, `Izdelek: ${viz.product?.name ?? '—'} (${viz.product?.sku ?? '—'})`, { size: 9.5, color: GRAY }); y += 13
  doc.text(M, y, `Barva/varianta: ${viz.variant ? `${viz.variant.name}${viz.variant.ral ? ` — ${viz.variant.ral}` : ''}` : '—'}`, { size: 9.5, color: GRAY }); y += 13
  doc.text(M, y, `Konfiguracija: ${cfgInfo}`, { size: 9.5, color: GRAY }); y += 13
  if (viz.measurementId) {
    doc.text(M, y, `Vezana meritev: ${viz.measurementId.slice(-8)} (verzija ${viz.measurementVersion ?? 1}) — proizvodne mere izhajajo IZKLJUČNO iz merilnega poteka.`, { size: 9, color: GRAY })
    y += 13
  }
  y += 6

  // §15: jasna ločitev VIZUALIZACIJA ≠ proizvodna mera
  doc.rect(M, y, R - M, 24, { fill: [0.996, 0.949, 0.851] })
  doc.text(M + 8, y + 15, `${VIZ_ZIG} — ni dokaz proizvodne točnosti.`, { size: 10, bold: true, color: [0.55, 0.35, 0.02] })
  y += 36

  const prej = dataUrlToJpeg(viz.sourcePhoto)
  const potem = dataUrlToJpeg(viz.rendered)
  const imgW = R - M

  doc.text(M, y, 'PREJ — obstoječe stanje', { size: 10, bold: true, color: NAVY }); y += 6
  if (prej) {
    const size = jpegSize(prej)
    if (size) {
      const imgH = Math.min(300, (imgW * size.height) / size.width)
      doc.image(M, y, imgW, imgH, prej)
      y += imgH + 14
    }
  } else {
    doc.text(M, y + 14, '— fotografija ni na voljo —', { size: 9.5, color: GRAY }); y += 32
  }

  doc.text(M, y, 'POTEM — nova ROKSAL ograja (vizualizacija)', { size: 10, bold: true, color: NAVY }); y += 6
  if (potem) {
    const size = jpegSize(potem)
    if (size) {
      let imgH = Math.min(300, (imgW * size.height) / size.width)
      if (y + imgH > 760) { // prelom — POTEM na novo stran
        doc.addPage()
        doc.text(M, 60, 'POTEM — nova ROKSAL ograja (vizualizacija)', { size: 10, bold: true, color: NAVY })
        y = 66
      }
      doc.image(M, y, imgW, imgH, potem)
      y += imgH + 14
    }
  } else {
    doc.text(M, y + 14, '— izrisana sličica še ni shranjena — izvozite jo iz zavihka Foto vizualizacija —', { size: 9.5, color: GRAY }); y += 32
  }

  if (viz.note && viz.note.trim()) {
    drawNote(doc, y, viz.note)
  }

  return { bytes: doc.build(), code: `FOTO-VIZ-${viz.project?.code ?? ''}-${viz.variantLabel}`, projectId: viz.projectId }
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'documents.generate')
  if (auth instanceof NextResponse) return auth
  const { type, id } = await params

  if (type !== 'quote' && type !== 'invoice' && type !== 'photoviz') {
    return jsonError(400, 'Neznana vrsta dokumenta.', 'Veljavni tipi: quote, invoice, photoviz.')
  }
  if (!id) return jsonError(400, 'Manjka identifikator dokumenta.')

  // R459: foto-vizualizacija ima lasten obseg dostopa (§13 IDOR — fotografije
  // strank ne smejo priti do tujih uporabnikov tudi prek PDF dokumenta)
  if (type === 'photoviz') {
    const res = await vizZaUporabnika(auth.user, id)
    if (res instanceof NextResponse) return res
  }

  const rendered = type === 'quote'
    ? await renderQuotePdf(id)
    : type === 'invoice'
      ? await renderInvoicePdf(id)
      : await renderPhotoVizPdf(id)
  if (rendered instanceof NextResponse) return rendered

  await writeAudit({
    userId: auth.user.id,
    action: 'DOC_GENERATE',
    entity: type,
    entityId: id,
    projectId: rendered.projectId,
    detail: { code: rendered.code },
  })

  // Blob zagotavlja veljaven BodyInit neodvisno od verzije Uint8Array generikov
  const body = new Blob([rendered.bytes], { type: 'application/pdf' })
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${rendered.code}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}

// /api/export/[kind]/[id] — R477 (issue #9 §6 Faza 4): izvozi BOM/ponudb.
// GET ?format=csv|xlsx|json (privzeto csv)
//   kind=bom   → id = paket (ProjectPackage); vrstice kosovnice z vezavo na
//                segmente (seg-N), skupine, odpad, vir količine.
//   kind=quote → id = ponudba; pozicije + zneski (popust R476) + status.
// Pred vsakim izvozom se izvedejo PREVERJANJA INŽENIRSKIH PRAVIL
// (exportChecks) — opozorila so VIDNA: v CSV (# OPOZORILO), v XLSX (list
// „Preverjanja“) in v JSON (checks[]).
// CSV: podpično, UTF-8 BOM, decimalna VEJICA (SI) — usklajeno z izvozom
// meritve (issue #12 §19). XLSX: lasten pisalnik xlsx-mini (brez paketov).
// Revizija: EXPORT_GENERATE (entity bom|quote).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import {
  bomCsv, bomXlsx, quoteCsv, quoteXlsx, exportChecks,
  type BomExportLine, type QuoteExportLine, type ExportCheck,
} from '@/lib/export-core'
import { POSTS_RULE_KEY, WASTE_RULE_KEY, type RawSegmentRow } from '@/lib/segment-bom'

type Params = { params: Promise<{ kind: string; id: string }> }

const nowIso = (): string => new Date().toISOString()

// ─── BOM izvoz (id = paket) ───────────────────────────────────────────────────

interface BomRow {
  id: string
  qty: number
  unit: string
  note: string | null
  segmentKey: string | null
  group: string | null
  wastePct: number | null
  sourceRule: string | null
  item: { sku: string; name: string }
}

async function loadBomExport (id: string): Promise<{
  pkg: { id: string; code: string; name: string; qty: number; unit: string; productId: string; projectId: string; calcJson: string | null; product: { sku: string; name: string } }
  bom: { code: string; status: string } | null
  lines: BomRow[]
  project: { code: string; title: string } | null
} | NextResponse> {
  const pkg = await db.projectPackage.findUnique({
    where: { id },
    include: {
      bom: { select: { id: true, code: true, status: true } },
      product: { select: { sku: true, name: true } },
      project: { select: { code: true, title: true } },
    },
  })
  if (!pkg) return jsonError(404, 'Paket ne obstaja.')
  if (!pkg.bom) {
    return jsonError(409, 'Paket nima kosovnice.', 'Najprej generirajte kosovnico (Projekti → paket → BOM).')
  }
  const lines = await db.bomLine.findMany({
    where: { bomId: pkg.bom.id },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { item: { select: { sku: true, name: true } } },
  })
  return {
    pkg: {
      id: pkg.id, code: pkg.code, name: pkg.name, qty: pkg.qty, unit: pkg.unit,
      productId: pkg.productId, projectId: pkg.projectId, calcJson: pkg.calcJson,
      product: { sku: pkg.product.sku, name: pkg.product.name },
    },
    bom: pkg.bom,
    lines: lines.map((l) => ({
      id: l.id, qty: l.qty, unit: l.unit, note: l.note,
      segmentKey: l.segmentKey, group: l.group, wastePct: l.wastePct, sourceRule: l.sourceRule,
      item: { sku: l.item.sku, name: l.item.name },
    })),
    project: pkg.project,
  }
}

// ─── PONUDBA izvoz ────────────────────────────────────────────────────────────

interface QuoteRow {
  id: string
  description: string
  qty: number
  unitPrice: number
  total: number
}

async function loadQuoteExport (id: string): Promise<{
  quote: {
    id: string; code: string; status: string; createdAt: Date; validUntil: Date | null; note: string | null
    subtotal: number; discountPct: number | null; discount: number; vat: number; total: number
    staleAt: Date | null; staleReason: string | null; packageId: string | null
    customer: { name: string } | null
    project: { id: string; code: string; title: string } | null
  }
  lines: QuoteRow[]
} | NextResponse> {
  const q = await db.quote.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      project: { select: { id: true, code: true, title: true } },
      lines: true,
    },
  })
  if (!q) return jsonError(404, 'Ponudba ne obstaja.')
  return {
    quote: {
      id: q.id, code: q.code, status: q.status, createdAt: q.createdAt, validUntil: null,
      note: q.note, subtotal: q.subtotal.toNumber(), discountPct: q.discountPct?.toNumber() ?? null,
      discount: q.discount.toNumber(), vat: q.vat.toNumber(), total: q.total.toNumber(),
      staleAt: q.staleAt, staleReason: q.staleReason, packageId: q.packageId,
      customer: q.customer, project: q.project,
    },
    lines: q.lines.map((l) => ({
      id: l.id, description: l.description, qty: l.qty,
      unitPrice: l.unitPrice.toNumber(), total: l.total.toNumber(),
    })),
  }
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET (req: NextRequest, { params }: Params) {
  const { kind, id } = await params
  if (kind !== 'bom' && kind !== 'quote') {
    return jsonError(400, 'Neznana vrsta izvoza.', 'Veljavne vrste: bom, quote.')
  }
  if (!id) return jsonError(400, 'Manjka identifikator.')

  const url = new URL(req.url)
  const format = url.searchParams.get('format') ?? 'csv'
  if (format !== 'csv' && format !== 'xlsx' && format !== 'json') {
    return jsonError(400, 'Neveljaven format.', 'Podprti formati: csv, xlsx, json.')
  }

  const auth = await requirePermission(req, 'quotes.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const fmtDate = (d: Date | null | undefined): string =>
    d == null ? '—' : new Date(d).toISOString().slice(0, 10)

  if (kind === 'bom') {
    const loaded = await loadBomExport(id)
    if (loaded instanceof NextResponse) return loaded

    // preverjanja: pravila + segmenti iz calcJson.inputs
    const rules = await db.engineeringRule.findMany({
      where: { active: true, key: { in: [POSTS_RULE_KEY, WASTE_RULE_KEY] } },
    })
    const posts = rules.find((r) => r.key === POSTS_RULE_KEY)
    const waste = rules.find((r) => r.key === WASTE_RULE_KEY)
    let hasSegments = false
    try {
      const parsed = JSON.parse(loaded.pkg.calcJson ?? '{}') as {
        inputs?: { segments?: RawSegmentRow[] }
      }
      hasSegments = Array.isArray(parsed?.inputs?.segments) && (parsed.inputs.segments.length ?? 0) > 0
    } catch { hasSegments = false }
    const checks = exportChecks({
      wastePct: waste ? Number(waste.value) : null,
      postSpacingCm: posts ? Number(posts.value) : null,
      unverifiedSegments: 0,
      quoteStale: false,
      linesWithoutSegment: loaded.lines.filter((l) => l.segmentKey == null).length,
      hasSegments,
    })

    const lines: BomExportLine[] = loaded.lines.map((l) => ({
      group: l.group, segmentKey: l.segmentKey, sku: l.item.sku, name: l.item.name,
      qty: l.qty, unit: l.unit, wastePct: l.wastePct, sourceRule: l.sourceRule, note: l.note,
    }))
    const meta = {
      packageCode: loaded.pkg.code,
      productName: loaded.pkg.product.name,
      projectCode: loaded.project?.code ?? null,
      projectTitle: loaded.project?.title ?? null,
      qty: loaded.pkg.qty,
      unit: loaded.pkg.unit,
      generatedAt: nowIso(),
    }

    await writeAudit({
      userId: user.id,
      action: 'EXPORT_GENERATE',
      entity: 'bom',
      entityId: loaded.pkg.id,
      projectId: loaded.pkg.projectId,
      detail: { format, code: loaded.bom?.code ?? loaded.pkg.code, lines: lines.length },
    })

    if (format === 'json') {
      return NextResponse.json({
        data: {
          kind: 'bom', bom: loaded.bom, package: meta, lines, checks,
          engineVersion: 'export-core/1.0',
        },
      })
    }
    if (format === 'xlsx') {
      const body = new Blob([bomXlsx(meta, lines, checks)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="kosovnica-${loaded.pkg.code}.xlsx"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    const csv = bomCsv(meta, lines, checks)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="kosovnica-${loaded.pkg.code}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // ── kind === 'quote' ──
  const loaded = await loadQuoteExport(id)
  if (loaded instanceof NextResponse) return loaded
  const { quote, lines } = loaded
  const stale = quote.staleAt != null

  // R477: pri ponudbi je edino relevantno predizvozno preverjanje ZASTARELOST
  // (segmentna pravila so zadeva kosovnic, ne dokumentov ponudbe).
  const checks: ExportCheck[] = stale
    ? [{
        code: 'ZASTARELA_PONUDBA', severity: 'OPOZORILO',
        message: `Ponudba je ZASTARELA — ${quote.staleReason ?? 'obseg paketa/kosovnice se je spremenil po izdaji ponudbe (invalidacija R474).'}`,
      }]
    : []

  const meta = {
    code: quote.code,
    status: quote.status,
    createdAt: fmtDate(quote.createdAt),
    validUntil: quote.validUntil ? fmtDate(quote.validUntil) : null,
    customerName: quote.customer?.name ?? null,
    projectCode: quote.project?.code ?? null,
    projectTitle: quote.project?.title ?? null,
    note: quote.note,
    subtotal: quote.subtotal,
    discountPct: quote.discountPct,
    discount: quote.discount,
    vat: quote.vat,
    total: quote.total,
    stale,
    staleReason: quote.staleReason,
  }

  await writeAudit({
    userId: user.id,
    action: 'EXPORT_GENERATE',
    entity: 'quote',
    entityId: quote.id,
    projectId: quote.project?.id ?? null,
    detail: { format, code: quote.code, lines: lines.length },
  })

  if (format === 'json') {
    return NextResponse.json({
      data: { kind: 'quote', quote: meta, lines, checks, engineVersion: 'export-core/1.0' },
    })
  }
  if (format === 'xlsx') {
    const body = new Blob([quoteXlsx(meta, lines)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="ponudba-${quote.code}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  }
  const csv = quoteCsv(meta, lines, checks)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ponudba-${quote.code}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

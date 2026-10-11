// /api/import/[kind] — R478 (issue #9 §6 zaključek — HOVER PARITY): UVOZ.
//   kind=bom   → multipart/form-data: file (.csv|.xlsx|.json), packageId,
//                mode=preveri|uvozi. Uvozi kosovnico iz izvoza R477 (LASTNA
//                oblika — round-trip dokaz) ali iz od drugod pripravljene
//                tabele z enako glavo.
//   kind=quote → multipart/form-data: file (.json), mode=preveri|uvozi,
//                projectId?/customerId?/packageId? (opcijske eksplicitne veze).
//
// NAČELA (enaka kot pri izvozu R477 — brez tihih predpostavk):
//  • PREVERI (dry-run) NE piše — vrne diff/napake/opozorila.
//  • Neznan SKU, segment, skupina, negativna količina → NAPAKA (409/400).
//  • Kalkulacija (cena/marža) se ob uvozu NE spreminja — datoteka nosi samo
//    količine; cene ostanejo zadeva ponudbe (izdelava ponudbe izračuna cene).
//  • Ponudba: zneski se PONOVNO izračunajo (quote-core); odstopanje od
//    datoteke je opozorilo, ne tiha predpostavka. Nova koda, status OSNUTEK —
//    uvožena ponudba NIKOLI ne prepiše obstoječe.
//  • Obe vrsti zahtevata quotes.create (enako kot izdelava kosovnice/ponudbe).
//  • Meja datoteke: 2 MB.
//
// Revizija: BOM_IMPORT / QUOTE_IMPORT.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextBomCode } from '@/lib/product-core'
import { invalidateQuotesForPackage } from '@/lib/quote-invalidation'
import { computeQuoteTotals, parseDiscountPct, round2 } from '@/lib/quote-core'
import { BOM_CSV_HEADER } from '@/lib/export-core'
import {
  IMPORT_CORE_VERSION, parseBomCsv, parseBomJson, parseQuoteJson, sheetRowsToBom, bomImportDiff,
  type BomImportLine, type ImportRowError,
} from '@/lib/import-core'
import { readXlsx, findSheetWithHeader } from '@/lib/xlsx-read'

type Params = { params: Promise<{ kind: string }> }

const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB

/** Zaporedna koda PON-<leto>-<seq> (usklajeno z /api/quotes). */
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

async function readForm (req: NextRequest): Promise<FormData | NextResponse> {
  try {
    return await req.formData()
  } catch {
    return jsonError(400, 'Telo mora biti multipart/form-data z datoteko.')
  }
}

function requireFile (form: FormData): { file: File } | NextResponse {
  const file = form.get('file')
  if (!(file instanceof File)) return jsonError(400, 'Manjka datoteka (polje „file“).')
  if (file.size > MAX_FILE_BYTES) return jsonError(413, 'Datoteka je prevelika.', 'Meja uvoza je 2 MB.')
  return { file }
}

function requireMode (form: FormData): { mode: 'preveri' | 'uvozi' } | NextResponse {
  const mode = String(form.get('mode') ?? 'preveri')
  if (mode !== 'preveri' && mode !== 'uvozi') return jsonError(400, 'Neveljaven način.', 'Uporabite preveri ali uvozi.')
  return { mode }
}

// ─── uvoz kosovnice ─────────────────────────────────────────────────────────

interface ParsedBomUpload {
  lines: BomImportLine[]
  errors: ImportRowError[]
  warnings: string[]
}

/** Datoteko (CSV/XLSX/JSON) → veljavne vrstice + napake vrstic. */
async function parseBomFile (file: File): Promise<ParsedBomUpload> {
  const name = file.name.toLowerCase()
  const buf = new Uint8Array(await file.arrayBuffer())

  // JSON (po končnici ali vsebini)
  const headText = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, 64)).trimStart()
  if (name.endsWith('.json') || headText.startsWith('{')) {
    let obj: unknown
    try {
      obj = JSON.parse(new TextDecoder().decode(buf))
    } catch (e) {
      return { lines: [], errors: [{ row: 1, field: 'JSON', problem: `JSON se ne razčleni: ${e instanceof Error ? e.message : '?'}` }], warnings: [] }
    }
    return parseBomJson(obj)
  }

  // XLSX (PK\3\4 ali končnica) — podpira lastne izvoze (STORE) in Excel
  // re-save (DEFLATE + sharedStrings)
  if (name.endsWith('.xlsx') || (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
    let sheets: Map<string, string[][]>
    try {
      sheets = readXlsx(buf).sheets
    } catch (e) {
      return { lines: [], errors: [{ row: 1, field: 'XLSX', problem: `Datoteke XLSX ni mogoče prebrati: ${e instanceof Error ? e.message : '?'}` }], warnings: [] }
    }
    const sheet = findSheetWithHeader({ sheets }, BOM_CSV_HEADER, 'Kosovnica')
    if (sheet == null) {
      return { lines: [], errors: [{ row: 1, field: 'XLSX', problem: `V nobenem listu ni glave kosovnice (${BOM_CSV_HEADER.join(';')}).` }], warnings: [] }
    }
    return sheetRowsToBom(sheet.rows)
  }

  // CSV (privzeto — UTF-8, tolerira BOM)
  const text = new TextDecoder().decode(buf)
  return parseBomCsv(text)
}

async function importBom (req: NextRequest, userId: string): Promise<NextResponse> {
  const form = await readForm(req)
  if (form instanceof NextResponse) return form
  const f = requireFile(form)
  if (f instanceof NextResponse) return f
  const { file } = f
  const m = requireMode(form)
  if (m instanceof NextResponse) return m
  const { mode } = m

  const packageId = String(form.get('packageId') ?? '')
  if (!packageId) return jsonError(400, 'Manjka ciljni paket (packageId).')

  const pkg = await db.projectPackage.findUnique({
    where: { id: packageId },
    include: { bom: true, project: { select: { id: true, code: true } } },
  })
  if (!pkg) return jsonError(404, 'Paket ne obstaja.')

  const parsed = await parseBomFile(file)
  if (parsed.errors.length > 0) {
    return NextResponse.json({
      error: `Datoteka ima ${parsed.errors.length} napak v vrsticah.`,
      rowErrors: parsed.errors.slice(0, 20),
    }, { status: 409 })
  }
  if (parsed.lines.length === 0) return jsonError(400, 'Datoteka nima veljavnih vrstic kosovnice.')

  // vsak SKU mora obstajati v katalogu (InventoryItem — vir resnice za BOM)
  const skus = [...new Set(parsed.lines.map((l) => l.sku))]
  const items = await db.inventoryItem.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true, name: true, unit: true },
  })
  const itemBySku = new Map(items.map((i) => [i.sku, i]))
  const unknown = skus.filter((s) => !itemBySku.has(s))
  if (unknown.length > 0) {
    return jsonError(409, `Neznani SKU (${unknown.length}): ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? ' …' : ''}.`, 'Dodajte artikle v katalog ali popravite datoteko.')
  }

  // diff proti trenutni kosovnici (če obstaja)
  let currentLines: { sku: string; segmentKey: string | null; qty: number }[] = []
  if (pkg.bom != null) {
    const rows = await db.bomLine.findMany({
      where: { bomId: pkg.bom.id },
      include: { item: { select: { sku: true } } },
    })
    currentLines = rows.map((r) => ({ sku: r.item.sku, segmentKey: r.segmentKey, qty: r.qty }))
  }
  const diff = bomImportDiff(parsed.lines, currentLines)

  const warnings = [...parsed.warnings]
  if (pkg.bom == null) warnings.push('Paket še nima kosovnice — uvoz bo ustvaril novo.')
  warnings.push('Kalkulacija (cena/marža) se ob uvozu NE spreminja — datoteka nosi samo količine. Cene izračuna ponudba.')

  if (mode === 'preveri') {
    return NextResponse.json({
      data: {
        mode: 'preveri',
        file: { name: file.name, size: file.size },
        package: { id: pkg.id, code: pkg.code, bomCode: pkg.bom?.code ?? null },
        lines: parsed.lines.length,
        skus: skus.length,
        diff,
        warnings,
        engineVersion: IMPORT_CORE_VERSION,
      },
    })
  }

  // ── mode === 'uvozi' ──
  // Enake varovalke kot pri regeneraciji (R443 invarianta skladišča):
  if (pkg.bom != null) {
    const activeRes = await db.stockReservation.count({ where: { bomId: pkg.bom.id, status: 'AKTIVNA' } })
    if (activeRes > 0) {
      return jsonError(409, `Kosovnica ${pkg.bom.code} ima ${activeRes} aktivnih rezervacij — najprej jih sprostite (Zaloga → Kosovnice → Sprosti).`)
    }
    const pickingCount = await db.pickingList.count({ where: { bomId: pkg.bom.id } })
    if (pickingCount > 0) {
      return jsonError(409, `Kosovnica ${pkg.bom.code} ima ${pickingCount} povezanih picking list — nadomeščanje ni mogoče (izgubila bi se zgodovina izdaje).`)
    }
    if (pkg.bom.status === 'REZERVIRAN' || pkg.bom.status === 'PORABLJEN') {
      return jsonError(409, `Kosovnica ${pkg.bom.code} je ${pkg.bom.status.toLowerCase()} — nadomeščanje ni mogoče. Ustvarite nov paket za ponovno konfiguracijo.`)
    }
    await db.bomLine.deleteMany({ where: { bomId: pkg.bom.id } })
    await db.bom.delete({ where: { id: pkg.bom.id } })
  }

  const bom = await db.bom.create({
    data: {
      code: await nextBomCode(),
      packageId: pkg.id,
      productId: pkg.productId,
      variantId: pkg.variantId,
      qty: pkg.qty,
      unit: pkg.unit,
      status: 'OSNUTEK',
      note: `Uvoženo iz datoteke ${file.name} (${IMPORT_CORE_VERSION}, ${parsed.lines.length} vrstic)`,
      lines: {
        create: parsed.lines.map((l, i) => ({
          itemId: itemBySku.get(l.sku)!.id,
          qty: l.qty,
          unit: l.unit,
          note: l.note,
          sortOrder: i,
          segmentKey: l.segmentKey,
          group: l.group,
          wastePct: l.wastePct,
          sourceRule: l.sourceRule ?? 'uvoz', // vir količine je datoteka
        })),
      },
    },
  })

  await writeAudit({
    userId,
    action: 'BOM_IMPORT', entity: 'bom', entityId: bom.id,
    projectId: pkg.projectId,
    detail: {
      code: bom.code, package: pkg.code, file: file.name,
      lines: parsed.lines.length,
      diff: {
        added: diff.entries.filter((e) => e.kind === 'DODANO').length,
        removed: diff.entries.filter((e) => e.kind === 'ODSTRANJENO').length,
        changed: diff.entries.filter((e) => e.kind === 'SPREMENJENA_KOLICINA').length,
        unchanged: diff.unchanged,
      },
      replacedCode: pkg.bom?.code ?? null,
      engineVersion: IMPORT_CORE_VERSION,
    },
  })

  // R474: sprememba obsega kosovnice invalidira povezane ponudbe
  const invalidated = await invalidateQuotesForPackage(
    { id: pkg.id, code: pkg.code, projectId: pkg.projectId },
    `Kosovnica paketa ${pkg.code} je bila uvožena iz datoteke — količine so se lahko spremenile.`,
    userId
  )

  return NextResponse.json({
    data: {
      mode: 'uvozi',
      bom: { id: bom.id, code: bom.code, status: bom.status, lines: parsed.lines.length },
      package: { id: pkg.id, code: pkg.code },
      diff,
      warnings,
      ...(invalidated.reset + invalidated.flagged > 0 ? { invalidated } : {}),
      engineVersion: IMPORT_CORE_VERSION,
    },
  }, { status: 201 })
}

// ─── uvoz ponudbe (JSON) ─────────────────────────────────────────────────────

async function importQuote (req: NextRequest, userId: string): Promise<NextResponse> {
  const form = await readForm(req)
  if (form instanceof NextResponse) return form
  const f = requireFile(form)
  if (f instanceof NextResponse) return f
  const { file } = f
  const m = requireMode(form)
  if (m instanceof NextResponse) return m
  const { mode } = m

  let obj: unknown
  try {
    obj = JSON.parse(new TextDecoder().decode(await file.arrayBuffer()))
  } catch (e) {
    return jsonError(400, 'Ponudba se uvaža IZKLJUČNO iz JSON (CSV/XLSX izvoza sta dokument za ljudi).', e instanceof Error ? e.message : undefined)
  }
  const { parsed, error } = parseQuoteJson(obj)
  if (parsed == null || error != null) return jsonError(400, error ?? 'Datoteka ni veljavna ponudba.')

  const warnings = [...parsed.warnings]

  // ── projekt: eksplicitni projectId ALI koda iz datoteke (deterministična,
  //    koda je enolična — vezanje je poročano v opozorilih)
  let projectId: string | null = null
  const formProjectId = String(form.get('projectId') ?? '')
  if (formProjectId !== '') {
    const project = await db.project.findUnique({ where: { id: formProjectId }, select: { id: true, code: true } })
    if (project == null) return jsonError(404, 'Navedeni projekt ne obstaja.')
    projectId = project.id
  } else if (parsed.projectCode != null) {
    const project = await db.project.findUnique({ where: { code: parsed.projectCode }, select: { id: true, code: true } })
    if (project != null) {
      projectId = project.id
      warnings.push(`Projekt vezan po kodi iz datoteke (${project.code}).`)
    } else {
      warnings.push(`Projekt ${parsed.projectCode} iz datoteke tu ne obstaja — ponudba je brez projekta.`)
    }
  }

  // ── stranka: eksplicitni customerId ALI točno ujemanje imena (poročano)
  let customerId: string | null = null
  const formCustomerId = String(form.get('customerId') ?? '')
  if (formCustomerId !== '') {
    const customer = await db.customer.findUnique({ where: { id: formCustomerId }, select: { id: true, name: true } })
    if (customer == null) return jsonError(404, 'Navedena stranka ne obstaja.')
    customerId = customer.id
  } else if (parsed.customerName != null) {
    const customer = await db.customer.findFirst({ where: { name: parsed.customerName }, select: { id: true, name: true } })
    if (customer != null) {
      customerId = customer.id
      warnings.push(`Stranka vezana po imenu iz datoteke (${customer.name}).`)
    } else {
      warnings.push(`Stranka „${parsed.customerName}“ iz datoteke tu ne obstaja — ponudba je brez stranke.`)
    }
  }

  // ── paket: ekspliciten, mora biti istega projekta kot ponudba
  const formPackageId = String(form.get('packageId') ?? '')
  if (formPackageId !== '') {
    const p = await db.projectPackage.findUnique({ where: { id: formPackageId }, select: { id: true, projectId: true, code: true } })
    if (p == null) return jsonError(404, 'Navedeni paket ne obstaja.')
    if (projectId != null && p.projectId !== projectId) {
      return jsonError(400, 'Paket pripada drugemu projektu.', 'Ponudba in paket morata biti na istem projektu.')
    }
    if (projectId == null) projectId = p.projectId
  }

  // ── zneski se PONOVNO izračunajo (datoteki ne zaupamo)
  const totals = computeQuoteTotals(parsed.lines.map((l) => round2(l.qty * l.unitPrice)), parsed.discountPct ?? 0)
  if (parsed.fileTotals?.total != null && Math.abs(parsed.fileTotals.total - totals.total) > 0.01) {
    warnings.push(`SKUPAJ iz datoteke (${parsed.fileTotals.total.toFixed(2)} EUR) se razlikuje od preračunanega (${totals.total.toFixed(2)} EUR) — uvožen je PRERAČUNANI znesek.`)
  }
  const discountPct = parseDiscountPct(parsed.discountPct ?? 0)
  if (discountPct == null) return jsonError(400, 'Popust iz datoteke ni veljaven (0..100).')

  if (mode === 'preveri') {
    return NextResponse.json({
      data: {
        mode: 'preveri',
        file: { name: file.name, size: file.size },
        original: { code: parsed.code, status: parsed.status },
        lines: parsed.lines.length,
        totals: { ...totals, discountPct: parsed.discountPct },
        resolution: { projectId, customerId, packageId: formPackageId !== '' ? formPackageId : null },
        warnings,
        engineVersion: IMPORT_CORE_VERSION,
      },
    })
  }

  const code = await nextQuoteCode()
  const quote = await db.quote.create({
    data: {
      code,
      status: 'OSNUTEK',
      customerId,
      projectId,
      packageId: formPackageId !== '' ? formPackageId : null,
      note: [parsed.note, `Uvoženo iz ${file.name} (izvorna koda ${parsed.code ?? '?'}).`].filter(Boolean).join(' — '),
      discountPct: discountPct > 0 ? discountPct : null,
      discount: totals.discount,
      subtotal: totals.subtotal,
      vat: totals.vat,
      total: totals.total,
      lines: {
        create: parsed.lines.map((l) => ({
          description: l.description, qty: l.qty, unitPrice: l.unitPrice, total: round2(l.qty * l.unitPrice),
        })),
      },
    },
  })

  await writeAudit({
    userId,
    action: 'QUOTE_IMPORT', entity: 'quote', entityId: quote.id,
    projectId,
    detail: {
      code: quote.code, fromCode: parsed.code, file: file.name,
      lines: parsed.lines.length, discountPct: quote.discountPct,
      total: totals.total, projectId, customerId, packageId: formPackageId !== '' ? formPackageId : null,
      engineVersion: IMPORT_CORE_VERSION,
    },
  })

  return NextResponse.json({
    data: {
      mode: 'uvozi',
      quote: { id: quote.id, code: quote.code, status: quote.status, lines: parsed.lines.length },
      totals: { ...totals, discountPct: parsed.discountPct },
      resolution: { projectId, customerId, packageId: formPackageId !== '' ? formPackageId : null },
      warnings,
      engineVersion: IMPORT_CORE_VERSION,
    },
  }, { status: 201 })
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST (req: NextRequest, { params }: Params) {
  const { kind } = await params
  if (kind !== 'bom' && kind !== 'quote') {
    return jsonError(400, 'Neznana vrsta uvoza.', 'Veljavne vrste: bom, quote.')
  }

  const auth = await requirePermission(req, 'quotes.create')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  if (kind === 'bom') return importBom(req, user.id)
  return importQuote(req, user.id)
}

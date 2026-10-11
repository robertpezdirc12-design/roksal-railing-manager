// import-core — R478 (issue #9 §6 zaključek — HOVER PARITY): UVOZ (round-trip
// import) kosovnic (CSV/XLSX/JSON) in ponudb (JSON).
//
// Filozofija (enaka kot pri izvozu R477): DATOTEKA JE PONUDBA ZA SPREMEMBO.
// Uvoz je dvofazen — PREVERI (dry-run, brez zapisov) nato UVOZI. Vsako
// odstopanje je VIDNO (diff po SKU+segmentu); neznani SKU/segment/skupina so
// NAPAKE (brez tihih preslikav). Denar se ob uvozu PONOVNO izračuna
// (quote-core) — zneski v datoteki se ne zaupajo, ampak poročajo razliko.
//
// KONVENCIJE (usklajeno z export-core R477):
//  • CSV: podpično, UTF-8 BOM, decimalna VEJICA (SI); # komentarji preskočeni.
//  • XLSX: števila so števila (pika v XML) — prebrane kot nizi, nato
//    parseSiNumber sprejme OBE ločili.
//  • JSON: oblika izvoza /api/export (kind + lines + meta).
//
// ČIST lib: NIČ strežniških uvozov — uporaben na odjemalcu in strežniku.
// (Razpakiranje ZIP za XLSX je v xlsx-read.ts — strežniško zaradi node:zlib.)

import { parseCsv, BOM_CSV_HEADER } from '@/lib/export-core'

export const IMPORT_CORE_VERSION = 'import-core/1.0'

// ─── Števila (SI vejica ALI pika — oboje veljavno pri uvozu) ─────────────────

/** "1,5" | "1.5" | "-3" → number; vse ostalo → null (BREZ tihe predpostavke). */
export function parseSiNumber (v: string | null | undefined): number | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '') return null
  // dovoljena: ena vejica ALI ena pika, ne oboje
  if (/^-?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'))
  // tisočice z vejico ("1.234,5") so izrecno ZAVRnjene — dvoumno
  return null
}

// ─── Skupne vrste ────────────────────────────────────────────────────────────

export interface BomImportLine {
  group: string | null
  segmentKey: string | null
  sku: string
  name: string
  qty: number
  unit: string
  wastePct: number | null
  sourceRule: string | null
  note: string | null
}

export interface BomImportParse {
  lines: BomImportLine[]
  /** opozorila parserja (npr. prazna vrstica preskočena) — ne ustavijo uvoza */
  warnings: string[]
}

export interface ImportRowError {
  /** 1-based vrstica v tabeli (glava = 1) */
  row: number
  field: string
  problem: string
}

export const BOM_GROUPS = ['STEBRI', 'ROCNIK', 'POLNILO', 'OSTALO'] as const
const SEGMENT_RE = /^seg-\d+$/

// ─── Validacija vrstic (skupna za CSV/XLSX/JSON) ─────────────────────────────

/** Skupna vrstica pred validacijo (celice kot nizi; količine še niso števila). */
export interface RawBomRow {
  group: string | null
  segmentKey: string | null
  sku: string
  name: string
  qtyRaw: string
  unit: string
  wastePctRaw: string | null
  sourceRule: string | null
  note: string | null
}

/**
 * Validira suhe vrstice v uvozne. NEZNANO je NAPAKA (neznani SKU se preverja
 * ob API klicu proti katalogu; tukaj samo oblika):
 *  • SKU obvezen; količina > 0; enota obvezna
 *  • segmentKey: prazen ali seg-N (isti ključi kot model/prefab/dvojček)
 *  • skupina: prazna ali STEBRI/ROCNIK/POLNILO/OSTALO
 *  • odpad %: prazen ali 0..100
 */
export function validateBomRows (rows: RawBomRow[]): { lines: BomImportLine[]; errors: ImportRowError[] } {
  const lines: BomImportLine[] = []
  const errors: ImportRowError[] = []

  for (const [i, r] of rows.entries()) {
    const rowNo = i + 2 // glava je vrstica 1
    const sku = r.sku.trim()
    if (sku === '') { errors.push({ row: rowNo, field: 'SKU', problem: 'SKU je obvezen.' }); continue }

    const qty = parseSiNumber(r.qtyRaw)
    if (qty == null || qty <= 0) {
      errors.push({ row: rowNo, field: 'Količina', problem: `Količina "${r.qtyRaw}" ni veljavno pozitivno število.` })
      continue
    }

    const unit = r.unit.trim()
    if (unit === '') { errors.push({ row: rowNo, field: 'Enota', problem: 'Enota je obvezna (m, kos …).' }); continue }

    if (r.segmentKey != null && r.segmentKey.trim() !== '' && !SEGMENT_RE.test(r.segmentKey.trim())) {
      errors.push({ row: rowNo, field: 'Segment', problem: `Segment "${r.segmentKey}" ni veljaven (pričakovan seg-N, npr. seg-1).` })
      continue
    }

    let wastePct: number | null = null
    if (r.wastePctRaw != null && r.wastePctRaw.trim() !== '') {
      wastePct = parseSiNumber(r.wastePctRaw)
      if (wastePct == null || wastePct < 0 || wastePct > 100) {
        errors.push({ row: rowNo, field: 'Odpad %', problem: `Odpad "${r.wastePctRaw}" ni veljaven (0..100).` })
        continue
      }
    }

    if (r.group != null && r.group.trim() !== '' && !(BOM_GROUPS as readonly string[]).includes(r.group.trim())) {
      errors.push({ row: rowNo, field: 'Skupina', problem: `Skupina "${r.group}" ni znana (${BOM_GROUPS.join('/')}).` })
      continue
    }

    lines.push({
      group: r.group != null && r.group.trim() !== '' ? r.group.trim() : null,
      segmentKey: r.segmentKey != null && r.segmentKey.trim() !== '' ? r.segmentKey.trim() : null,
      sku,
      name: r.name.trim(),
      qty,
      unit,
      wastePct,
      sourceRule: r.sourceRule != null && r.sourceRule.trim() !== '' ? r.sourceRule.trim() : null,
      note: r.note != null && r.note.trim() !== '' ? r.note.trim() : null,
    })
  }

  // podvojitve (SKU + segment) — eksplicitna napaka, brez tihega seštevanja
  const seen = new Map<string, number>()
  for (const l of lines) {
    const k = `${l.sku}|${l.segmentKey ?? ''}`
    const prev = seen.get(k)
    if (prev != null) {
      errors.push({ row: prev + 1, field: 'SKU', problem: `Podvojen par SKU+segment (${l.sku}${l.segmentKey ? ' · ' + l.segmentKey : ' · brez'}) — vrstici ${prev + 1} in ${lines.indexOf(l) + 2}.` })
    } else {
      seen.set(k, lines.indexOf(l) + 2)
    }
  }

  return { lines, errors }
}

// ─── CSV uvoz kosovnice ( LASTEN izvoz → vrstice ) ──────────────────────────

/**
 * Prebere CSV kosovnice v obliki, ki jo zapiše bomCsv (glava BOM_CSV_HEADER,
 * decimalna vejica, # komentarji). NEVALIDIRANE vrstice so napake — vrača
 * lines (veljavne) + errors (vrstica/polje/težava).
 */
export function parseBomCsv (text: string): { lines: BomImportLine[]; errors: ImportRowError[]; warnings: string[] } {
  const parsed = parseCsv(text)
  const warnings: string[] = []

  const headerOk = parsed.header.length >= BOM_CSV_HEADER.length &&
    BOM_CSV_HEADER.every((h, i) => parsed.header[i] === h)
  if (!headerOk) {
    return {
      lines: [],
      errors: [{ row: 1, field: 'Glava', problem: `Glava se ne ujema s pričakovano (${BOM_CSV_HEADER.join(';')}).` }],
      warnings,
    }
  }

  const rows: RawBomRow[] = []
  for (const [i, row] of parsed.rows.entries()) {
    if (row.every((c) => c === '')) { warnings.push(`Vrstica ${i + 2}: prazna — preskočena.`); continue }
    const cells = [...row, ...Array(9).fill('')] // podaljšaj na 9 stolpcev
    rows.push({
      group: cells[0], segmentKey: cells[1], sku: cells[2], name: cells[3],
      qtyRaw: cells[4], unit: cells[5], wastePctRaw: cells[6], sourceRule: cells[7], note: cells[8],
    })
  }
  const { lines, errors } = validateBomRows(rows)
  return { lines, errors, warnings }
}

// ─── JSON uvoz kosovnice (oblika /api/export/bom?format=json) ──────────────

interface RawJsonBomLine {
  group?: unknown; segmentKey?: unknown; sku?: unknown; name?: unknown
  qty?: unknown; unit?: unknown; wastePct?: unknown; sourceRule?: unknown; note?: unknown
}

export function parseBomJson (obj: unknown): { lines: BomImportLine[]; errors: ImportRowError[]; warnings: string[] } {
  const warnings: string[] = []
  // izvoz /api/export vrne { data: { kind, … } } — sprejmemo OBE obliki
  // (ovijalnik ali golo vsebino; npr. ročno sestavljen JSON brez ovijalnika)
  const raw = obj as { data?: unknown } | null
  if (raw != null && typeof raw === 'object' && raw.data != null && typeof raw.data === 'object') obj = raw.data
  const o = obj as { kind?: unknown; lines?: unknown; package?: { packageCode?: unknown } } | null
  if (o == null || typeof o !== 'object') {
    return { lines: [], errors: [{ row: 1, field: 'JSON', problem: 'Datoteka ni veljaven JSON objekt.' }], warnings }
  }
  if (o.kind !== 'bom') {
    return { lines: [], errors: [{ row: 1, field: 'JSON', problem: 'JSON ni kosovnica (kind ≠ "bom").' }], warnings }
  }
  if (!Array.isArray(o.lines) || o.lines.length === 0) {
    return { lines: [], errors: [{ row: 1, field: 'JSON', problem: 'Kosovnica nima vrstic.' }], warnings }
  }
  const rows: RawBomRow[] = (o.lines as RawJsonBomLine[]).map((l) => ({
    group: typeof l?.group === 'string' ? l.group : null,
    segmentKey: typeof l?.segmentKey === 'string' ? l.segmentKey : null,
    sku: typeof l?.sku === 'string' ? l.sku : '',
    name: typeof l?.name === 'string' ? l.name : '',
    qtyRaw: l?.qty == null ? '' : String(l.qty),
    unit: typeof l?.unit === 'string' ? l.unit : '',
    wastePctRaw: l?.wastePct == null ? null : String(l.wastePct),
    sourceRule: typeof l?.sourceRule === 'string' ? l.sourceRule : null,
    note: typeof l?.note === 'string' ? l.note : null,
  }))
  const { lines, errors } = validateBomRows(rows)
  if (typeof o.package?.packageCode === 'string' && o.package.packageCode !== '') {
    warnings.push(`Datoteka je izvožena s paketa ${String(o.package.packageCode)} — uvoz cilja na izbrani paket.`)
  }
  return { lines, errors, warnings }
}

// ─── XLSX podpora (čisti del: XML lista → vrstice; razpakiranje v xlsx-read) ─

/** Poišče vrstico z glavo tabele med prvimi N vrsticami lista. */
export function findHeaderRow (rows: string[][], header: readonly string[], scan = 12): number {
  for (let i = 0; i < Math.min(rows.length, scan); i++) {
    const row = rows[i]
    if (row == null) continue
    const norm = row.map((c) => (c ?? '').trim())
    if (header.every((h, j) => norm[j] === h)) return i
  }
  return -1
}

/** Vrstice lista (od glave naprej) → suhe vrstice kosovnice. */
export function sheetRowsToBom (rows: string[][]): { lines: BomImportLine[]; errors: ImportRowError[]; warnings: string[] } {
  const warnings: string[] = []
  const headerIdx = findHeaderRow(rows, BOM_CSV_HEADER)
  if (headerIdx < 0) {
    return {
      lines: [],
      errors: [{ row: 1, field: 'Glava', problem: `V listu ni glave kosovnice (${BOM_CSV_HEADER.join(';')}).` }],
      warnings,
    }
  }
  if (headerIdx > 0) warnings.push(`Prvih ${headerIdx} vrstic je metapodatkov — preskočene.`)

  const raw: RawBomRow[] = []
  for (const [i, row] of rows.slice(headerIdx + 1).entries()) {
    if (row == null || row.every((c) => c == null || c === '')) { warnings.push(`Vrstica ${headerIdx + i + 2}: prazna — preskočena.`); continue }
    const cells = [...row.map((c) => c ?? ''), ...Array(9).fill('')]
    raw.push({
      group: cells[0], segmentKey: cells[1], sku: cells[2], name: cells[3],
      qtyRaw: cells[4], unit: cells[5], wastePctRaw: cells[6], sourceRule: cells[7], note: cells[8],
    })
  }
  const { lines, errors } = validateBomRows(raw)
  return { lines, errors, warnings }
}

// ─── Diff (preveri) — primerjava uvoženih vrstic s trenutno kosovnico ───────

export interface BomDiffEntry {
  sku: string
  segmentKey: string | null
  kind: 'DODANO' | 'ODSTRANJENO' | 'SPREMENJENA_KOLICINA'
  fromQty?: number
  toQty?: number
}

export interface BomDiff {
  unchanged: number
  entries: BomDiffEntry[]
}

/**
 * Primerja uvožene vrstice s trenutnimi (ključ SKU + segmentKey).
 * Vrne eksplicitne vnose: DODANO / ODSTRANJENO / SPREMENJENA_KOLICINA.
 * Neznani SKU v uvozu NI diff — to je napaka uvoza (preverja API proti katalogu).
 */
export function bomImportDiff (
  imported: BomImportLine[],
  current: { sku: string; segmentKey: string | null; qty: number }[]
): BomDiff {
  const cur = new Map(current.map((l) => [`${l.sku}|${l.segmentKey ?? ''}`, l.qty]))
  const imp = new Map(imported.map((l) => [`${l.sku}|${l.segmentKey ?? ''}`, l.qty]))
  const entries: BomDiffEntry[] = []
  let unchanged = 0

  for (const [key, toQty] of imp) {
    const fromQty = cur.get(key)
    const [sku, seg] = key.split('|')
    if (fromQty == null) {
      entries.push({ sku, segmentKey: seg !== '' ? seg : null, kind: 'DODANO', toQty })
    } else if (Math.abs(fromQty - toQty) > 0.005) {
      entries.push({ sku, segmentKey: seg !== '' ? seg : null, kind: 'SPREMENJENA_KOLICINA', fromQty, toQty })
    } else {
      unchanged++
    }
  }
  for (const [key, fromQty] of cur) {
    if (!imp.has(key)) {
      const [sku, seg] = key.split('|')
      entries.push({ sku, segmentKey: seg !== '' ? seg : null, kind: 'ODSTRANJENO', fromQty })
    }
  }

  // deterministični vrstni red: sku → segment
  entries.sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : (a.segmentKey ?? '').localeCompare(b.segmentKey ?? ''))
  return { unchanged, entries }
}

// ─── JSON uvoz ponudbe (oblika /api/export/quote?format=json) ───────────────

export interface QuoteImportLine {
  description: string
  qty: number
  unitPrice: number
}

export interface QuoteImportParse {
  code: string | null
  status: string | null
  customerName: string | null
  projectCode: string | null
  note: string | null
  discountPct: number | null
  fileTotals: { subtotal: number | null; discount: number | null; vat: number | null; total: number | null } | null
  lines: QuoteImportLine[]
  warnings: string[]
}

/**
 * Prebere JSON izvoz ponudbe. Zneski iz datoteke se vrnejo SAMO kot
 * fileTotals (za primerjavo); pozicije (opis/količina/cena) so vir resnice.
 */
export function parseQuoteJson (obj: unknown): { parsed: QuoteImportParse | null; error: string | null } {
  const warnings: string[] = []
  // izvoz /api/export vrne { data: { kind, … } } — sprejmemo OBE obliki
  const rawWrap = obj as { data?: unknown } | null
  if (rawWrap != null && typeof rawWrap === 'object' && rawWrap.data != null && typeof rawWrap.data === 'object') obj = rawWrap.data
  const o = obj as {
    kind?: unknown; quote?: {
      code?: unknown; status?: unknown; customerName?: unknown; projectCode?: unknown
      note?: unknown; discountPct?: unknown; subtotal?: unknown; discount?: unknown
      vat?: unknown; total?: unknown; stale?: unknown
    }; lines?: unknown
  } | null
  if (o == null || typeof o !== 'object') return { parsed: null, error: 'Datoteka ni veljaven JSON objekt.' }
  if (o.kind !== 'quote') return { parsed: null, error: 'JSON ni ponudba (kind ≠ "quote").' }
  const rawLines = o.lines
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { parsed: null, error: 'Ponudba nima pozicij.' }
  }

  const lines: QuoteImportLine[] = []
  for (const [i, l] of (rawLines as { description?: unknown; qty?: unknown; unitPrice?: unknown }[]).entries()) {
    const description = typeof l?.description === 'string' ? l.description.trim() : ''
    const qty = Number(l?.qty)
    const unitPrice = Number(l?.unitPrice)
    if (!description) return { parsed: null, error: `Pozicija ${i + 1}: opis je obvezen.` }
    if (!Number.isFinite(qty) || qty <= 0) return { parsed: null, error: `Pozicija ${i + 1}: količina ni veljavna.` }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { parsed: null, error: `Pozicija ${i + 1}: cena na enoto ni veljavna.` }
    lines.push({ description, qty, unitPrice })
  }

  let discountPct: number | null = null
  if (o.quote?.discountPct != null) {
    const pct = Number(o.quote.discountPct)
    if (Number.isFinite(pct) && pct > 0 && pct <= 100) discountPct = pct
    else if (Number.isFinite(pct) && pct !== 0) warnings.push(`Popust ${String(o.quote.discountPct)} % ni veljaven (0..100) — uvožen brez popusta.`)
  }

  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const fileTotals = o.quote != null
    ? {
        subtotal: num(o.quote.subtotal),
        discount: num(o.quote.discount),
        vat: num(o.quote.vat),
        total: num(o.quote.total),
      }
    : null
  if (fileTotals != null && fileTotals.total == null) warnings.push('Datoteka ne vsebuje zneska SKUPAJ — zneski se bodo izračunali na novo.')

  if (o.quote?.stale === true) {
    warnings.push('Izvirna ponudba je bila ZASTARELA — uvožena kopija začne kot OSNUTEK z novimi zneski.')
  }

  return {
    parsed: {
      code: typeof o.quote?.code === 'string' ? o.quote.code : null,
      status: typeof o.quote?.status === 'string' ? o.quote.status : null,
      customerName: typeof o.quote?.customerName === 'string' && o.quote.customerName !== '' ? o.quote.customerName : null,
      projectCode: typeof o.quote?.projectCode === 'string' && o.quote.projectCode !== '' ? o.quote.projectCode : null,
      note: typeof o.quote?.note === 'string' && o.quote.note.trim() !== '' ? o.quote.note.trim() : null,
      discountPct,
      fileTotals,
      lines,
      warnings,
    },
    error: null,
  }
}

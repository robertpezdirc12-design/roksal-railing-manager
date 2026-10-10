// export-core — R477 (issue #9 §6 HOVER PARITY — Faza 4): izvozi BOM/ponudb v
// CSV/XLSX/JSON + PREVERJANJE INŽENIRSKIH PRAVIL PRED IZVOZOM + round-trip
// parser (za bodoči uvoz in za testne dokaze).
//
// KONVENCIJE (usklajene z measure-engine izvozom, issue #12 §19):
//  • CSV: PODPIČNO ločilo, UTF-8 BOM, decimalna VEJICA (SI), glava + vrstice.
//  • Komentarske vrstice se začnejo z '#' (metapodatki/opozorila) — parser
//    jih preskoči; tabela ostane strogo tabularna (round-trip varna).
//  • XLSX: števila ostanejo števila (pika v XML — standard OOXML); prikaz
//    ločila določi locale pregledovalnika.
//  • Opozorila so VIDNA: v CSV kot # OPOZORILO, v XLSX kot drugi list
//    »Preverjanja«, v JSON kot checks[].
//
// ČIST lib: NIČ strežniških uvozov — uporaben na odjemalcu in strežniku.

import { buildXlsx, type XRow, type XlsxSheet } from '@/lib/xlsx-mini'

export const EXPORT_CORE_VERSION = 'export-core/1.0'

// ─── Preverjanja pred izvozom (inženirska pravila — §6) ─────────────────────

export interface ExportCheck {
  code: string
  severity: 'OPOZORILO' | 'INFO'
  message: string
}

export interface ExportCheckInputs {
  /** pravilo odpad_rez_pct (vrednost ali null, če ni nastavljeno) */
  wastePct: number | null
  /** pravilo max_razdalja_stebrov v cm (null = ni nastavljeno) */
  postSpacingCm: number | null
  /** št. segmentov brez preveritve (ESTIMATED/AUTO_SUGGESTED/MANUAL) */
  unverifiedSegments: number
  /** ponudba zastarela (R474 invalidacija)? */
  quoteStale: boolean
  /** št. vrstic BOM brez vezave na segment (0 = vse vezane) */
  linesWithoutSegment: number
  /** ali BOM sploh vsebuje segmente (calcJson.inputs.segments) */
  hasSegments: boolean
}

/** Presoja inženirskih pravil pred izvozom — BREZ tihih predpostavk. */
export function exportChecks (inp: ExportCheckInputs): ExportCheck[] {
  const out: ExportCheck[] = []
  if (!inp.hasSegments) {
    out.push({
      code: 'BREZ_SEGMENTOV', severity: 'INFO',
      message: 'Paket nima segmentov (izmera po odsekih) — količine so iz predloge izdelka (predloga × skupna količina).',
    })
  } else {
    if (inp.postSpacingCm == null) {
      out.push({
        code: 'BREZ_RAZMIKA', severity: 'OPOZORILO',
        message: 'Pravilo max_razdalja_stebrov ni nastavljeno — vmesni stebri niso izračunani, štejejo se samo čelni.',
      })
    }
    if (inp.wastePct == null) {
      out.push({
        code: 'BREZ_ODPADA', severity: 'OPOZORILO',
        message: 'Pravilo odpad_rez_pct ni nastavljeno — dolžine/ploščine so brez rezerve za odpad rezanja.',
      })
    }
    if (inp.linesWithoutSegment > 0) {
      out.push({
        code: 'VRSTICE_BREZ_SEGMENTA', severity: 'INFO',
        message: `${inp.linesWithoutSegment} vrstic kosovnice ni vezanih na segment (pripadnosti/priprava).`,
      })
    }
  }
  if (inp.unverifiedSegments > 0) {
    out.push({
      code: 'NEPREVERJENI_SEGMENTI', severity: 'OPOZORILO',
      message: `${inp.unverifiedSegments} segmentov izmere nima preveritve (ESTIMATED/ROCNO) — mere so ocena.`,
    })
  }
  if (inp.quoteStale) {
    out.push({
      code: 'ZASTARELA_PONUDBA', severity: 'OPOZORILO',
      message: 'Ponudba je ZASTARELA — obseg paketa/kosovnice se je spremenil po izdaji ponudbe (invalidacija R474).',
    })
  }
  return out
}

// ─── CSV (podpično, UTF-8 BOM, decimalna vejica) ──────────────────────────────

export interface CsvCell { v: string | number | null }

/** Ena celica → varna CSV vrednost (vejica za decimalke, escape podpičij). */
export function csvCell (v: string | number | null | undefined): string {
  if (v == null) return ''
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    // SI decimalna vejica; podpičja v številkih ne morejo biti
    return String(Math.round(v * 100) / 100).replace('.', ',')
  }
  const s = String(v)
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"` // ; je ločilo → esc
  return s
}

export function csvRow (cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(';')
}

/** Denarni znesek — VEDNO 2 decimalki, decimalna vejica (1207,80 EUR). */
export function moneyCell (v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return ''
  return v.toFixed(2).replace('.', ',')
}

/** Tabela (glava + vrstice) + neobvezni komentarji → CSV brez BOM predpone. */
export function csvTable (header: string[], rows: (string | number | null | undefined)[][], comments: string[] = []): string {
  const lines: string[] = []
  for (const c of comments) lines.push(`# ${c}`)
  if (comments.length > 0) lines.push('')
  lines.push(csvRow(header))
  for (const r of rows) lines.push(csvRow(r))
  return lines.join('\r\n') + '\r\n'
}

/** UTF-8 BOM predpona (za Excel). */
export const CSV_BOM = '\uFEFF'

// ─── Round-trip parser (uvozna kompatibilnost + testni dokaz) ────────────────

export interface ParsedCsv { header: string[]; rows: string[][]; comments: string[] }

/**
 * Prebere CSV, ki ga zapiše csvTable (podpično, vejica za decimalno, BOM
 * se tolerira, # komentarji se preskočijo, "" escape). To je DOKAZ, da je
 * izvoz strogo okrogel (round-trip): vse, kar izvozimo, znamo prebrati.
 */
export function parseCsv (text: string): ParsedCsv {
  let s = text
  if (s.startsWith(CSV_BOM)) s = s.slice(CSV_BOM.length)
  const comments: string[] = []
  const tableRows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let startedCell = false

  const pushCell = (): void => {
    // število z vejico → pika (samo če je čisto število)
    let v = cell
    if (/^-?\d+(,\d+)?$/.test(v)) v = v.replace(',', '.')
    row.push(v)
    cell = ''
    startedCell = false
  }
  const pushRow = (): void => {
    pushCell()
    if (row.length === 1 && row[0] === '') { row = []; return } // prazna vrstica
    const isComment = row[0].startsWith('# ')
    if (isComment) comments.push(row[0].slice(2))
    else tableRows.push(row)
    row = []
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"' && !startedCell && cell === '') { inQuotes = true; startedCell = true; continue }
    if (ch === ';') { pushCell(); continue }
    if (ch === '\n') { pushRow(); continue }
    if (ch === '\r') continue // CRLF
    cell += ch
    startedCell = true
  }
  if (cell !== '' || row.length > 0 || startedCell) pushRow()

  const [header, ...rows] = tableRows
  return { header: header ?? [], rows, comments }
}

// ─── BOM izvoz ────────────────────────────────────────────────────────────────

export interface BomExportLine {
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

export interface BomExportMeta {
  packageCode: string
  productName: string
  projectCode: string | null
  projectTitle: string | null
  qty: number
  unit: string
  generatedAt: string // ISO
}

export const BOM_CSV_HEADER = ['Skupina', 'Segment', 'SKU', 'Artikel', 'Količina', 'Enota', 'Odpad %', 'Vir količine', 'Opomba'] as const

const GROUP_ORDER: Record<string, number> = { STEBRI: 0, ROCNIK: 1, POLNILO: 2, OSTALO: 3 }

/** Vrstice BOM sortirane po skupini → segmentu → SKU (deterministično). */
export function bomRowsSorted (lines: BomExportLine[]): BomExportLine[] {
  return [...lines].sort((a, b) => {
    const ga = GROUP_ORDER[a.group ?? 'OSTALO'] ?? 9
    const gb = GROUP_ORDER[b.group ?? 'OSTALO'] ?? 9
    if (ga !== gb) return ga - gb
    const sa = a.segmentKey ?? ''
    const sb = b.segmentKey ?? ''
    if (sa !== sb) return sa < sb ? -1 : 1
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0
  })
}

export function bomCsv (meta: BomExportMeta, lines: BomExportLine[], checks: ExportCheck[]): string {
  const comments = [
    `Kosovnica ${meta.packageCode} — ${meta.productName} (${meta.qty} ${meta.unit})`,
    ...(meta.projectCode ? [`Projekt: ${meta.projectCode} — ${meta.projectTitle ?? ''}`] : []),
    `Izvoženo: ${meta.generatedAt}`,
    ...checks.map((c) => `${c.severity === 'OPOZORILO' ? 'OPOZORILO' : 'INFO'}: ${c.message}`),
  ]
  return CSV_BOM + csvTable(
    [...BOM_CSV_HEADER],
    bomRowsSorted(lines).map((l) => [
      l.group ?? '', l.segmentKey ?? '', l.sku, l.name, l.qty, l.unit, l.wastePct, l.sourceRule ?? '', l.note ?? '',
    ]),
    comments,
  )
}

export function bomXlsx (meta: BomExportMeta, lines: BomExportLine[], checks: ExportCheck[]): Uint8Array<ArrayBuffer> {
  const head: XRow = [...BOM_CSV_HEADER]
  const rows: XRow[] = bomRowsSorted(lines).map((l) => [
    l.group ?? '', l.segmentKey ?? '', l.sku, l.name, l.qty, l.unit, l.wastePct, l.sourceRule ?? '', l.note ?? '',
  ])
  // somaterial po skupini (sum količin po SKU — kontrola za skladišče)
  const sums = new Map<string, { group: string; name: string; unit: string; qty: number }>()
  for (const l of lines) {
    const k = l.sku
    const prev = sums.get(k)
    sums.set(k, { group: l.group ?? 'OSTALO', name: l.name, unit: l.unit, qty: (prev?.qty ?? 0) + l.qty })
  }
  const sumRows: XRow[] = [...sums.entries()]
    .sort((a, b) => (GROUP_ORDER[a[1].group] ?? 9) - (GROUP_ORDER[b[1].group] ?? 9) || a[0].localeCompare(b[0]))
    .map(([sku, v]) => [v.group, sku, v.name, v.qty, v.unit])

  const sheets: XlsxSheet[] = [
    {
      name: 'Kosovnica',
      rows: [
        [`Kosovnica ${meta.packageCode}`],
        [`${meta.productName} (${meta.qty} ${meta.unit})`],
        ...(meta.projectCode ? [[`Projekt: ${meta.projectCode} — ${meta.projectTitle ?? ''}`]] : []),
        [`Izvoženo: ${meta.generatedAt}`],
        [],
        head, ...rows,
      ],
    },
    {
      name: 'Sume po artiklih',
      rows: [['Skupina', 'SKU', 'Artikel', 'Količina skupaj', 'Enota'], ...sumRows],
    },
  ]
  if (checks.length > 0) {
    sheets.push({
      name: 'Preverjanja',
      rows: [
        ['Preverjanje inženirskih pravil pred izvozom'],
        [],
        ['Stopnja', 'Koda', 'Sporočilo'],
        ...checks.map((c) => [c.severity, c.code, c.message]),
      ],
    })
  }
  return buildXlsx(sheets)
}

// ─── PONUDBA izvoz ───────────────────────────────────────────────────────────

export interface QuoteExportLine {
  description: string
  qty: number
  unitPrice: number
  total: number
}

export interface QuoteExportMeta {
  code: string
  status: string
  createdAt: string // ISO
  validUntil: string | null // ISO
  customerName: string | null
  projectCode: string | null
  projectTitle: string | null
  note: string | null
  subtotal: number
  discountPct: number | null
  discount: number
  vat: number
  total: number
  stale: boolean
  staleReason: string | null
}

export const QUOTE_CSV_HEADER = ['Opis', 'Količina', 'Cena (EUR)', 'Vrstica (EUR)'] as const

export function quoteCsv (meta: QuoteExportMeta, lines: QuoteExportLine[], checks: ExportCheck[]): string {
  const comments = [
    `Ponudba ${meta.code} — status ${meta.status}`,
    ...(meta.customerName ? [`Stranka: ${meta.customerName}`] : []),
    ...(meta.projectCode ? [`Projekt: ${meta.projectCode} — ${meta.projectTitle ?? ''}`] : []),
    `Izdana: ${meta.createdAt}`,
    ...(meta.validUntil ? [`Veljavnost: ${meta.validUntil}`] : []),
    ...checks.map((c) => `${c.severity === 'OPOZORILO' ? 'OPOZORILO' : 'INFO'}: ${c.message}`),
  ]
  const rows: (string | number | null)[][] = lines.map((l) => [l.description, l.qty, l.unitPrice, l.total])
  rows.push([]) // prazna ločilna vrstica? NE — tabularno: vsota gre v komentarje
  return CSV_BOM + csvTable([...QUOTE_CSV_HEADER], rows.slice(0, -1), [
    ...comments,
    `Osnova: ${moneyCell(meta.subtotal)} EUR`,
    ...(meta.discountPct != null && meta.discountPct > 0
      ? [`Popust ${csvCell(meta.discountPct)} %: -${moneyCell(meta.discount)} EUR`] : []),
    `DDV 22 %: ${moneyCell(meta.vat)} EUR`,
    `SKUPAJ Z DDV: ${moneyCell(meta.total)} EUR`,
  ])
}

export function quoteXlsx (meta: QuoteExportMeta, lines: QuoteExportLine[]): Uint8Array<ArrayBuffer> {
  const rows: XRow[] = [
    [`Ponudba ${meta.code} — status ${meta.status}`],
    ...(meta.customerName ? [[`Stranka: ${meta.customerName}`]] : []),
    ...(meta.projectCode ? [[`Projekt: ${meta.projectCode} — ${meta.projectTitle ?? ''}`]] : []),
    [`Izdana: ${meta.createdAt}`],
    ...(meta.validUntil ? [[`Veljavnost: ${meta.validUntil}`]] : []),
    [],
    [...QUOTE_CSV_HEADER],
    ...lines.map((l) => [l.description, l.qty, l.unitPrice, l.total]),
    [],
    ['Osnova:', null, null, meta.subtotal],
    ...(meta.discountPct != null && meta.discountPct > 0
      ? [[`Popust ${meta.discountPct} %:`, null, null, -meta.discount]] : []),
    ['DDV 22 %:', null, null, meta.vat],
    ['SKUPAJ Z DDV:', null, null, meta.total],
  ]
  return buildXlsx([{ name: 'Ponudba', rows }])
}

// xlsx-mini — R477 (issue #9 §6): MINIMALEN lasten pisalnik XLSX brez zunanjih
// paketov. Veljaven OOXML delovni zvezek = ZIP (metoda STORE, brez kompresije)
// z: [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml
// .rels, xl/styles.xml, xl/worksheets/sheetN.xml.
//
// Celice: inlineStr (besedilo, xml:space=preserve) ali število (<v>). Dva
// sloga (0 = navadna, 1 = krepka glava) — nič več, da ostane datoteka majhna
// in deterministicna. Števila ostanejo števila (ločilo PIKA v XML — pravilno
// za ponovni uvoz v vseh orodjih; prikaz ločila je odvisnost od locale
// pregledovalnika, ne od datoteke).
//
// Datumi/čas v ZIP glavi so fiksni (1980-01-01 00:00) → deterministicen
// izvoz (enaki bajti za enake vnose; primerno za testiranje).

export const XLSX_MINI_VERSION = 'xlsx-mini/1.0'

// ─── CRC32 (IEEE 802.3, reflektiran) ────────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32 (buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ─── ZIP (STORE) ─────────────────────────────────────────────────────────────

interface ZipEntry { name: string; data: Uint8Array; crc: number }

function dosTime (): { time: number; date: number } {
  // fiksno: 1980-01-01 00:00 — deterministicno
  return { time: 0, date: (1 << 9) | (1 << 5) | 1 }
}

function zipStore (entries: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const zipped: ZipEntry[] = entries.map((e) => ({
    name: e.name, data: e.data, crc: crc32(e.data),
  }))
  const { time, date } = dosTime()

  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let pos = 0

  const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff]
  const u32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]

  for (const e of zipped) {
    const nameB = new TextEncoder().encode(e.name)
    // lokalna glava
    const lh = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800) /* UTF-8 ime */, ...u16(0) /* STORE */,
      ...u16(time), ...u16(date), ...u32(e.crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(nameB.length), ...u16(0),
    ]
    const lhB = new Uint8Array(lh)
    chunks.push(lhB, nameB, e.data)
    pos += lhB.length + nameB.length + e.data.length
    // centralni imenik (zamik se doda na koncu)
    const cd = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(time), ...u16(date), ...u32(e.crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(pos - e.data.length - nameB.length - lhB.length),
    ]
    central.push(new Uint8Array(cd), nameB)
  }

  const centralStart = pos
  let centralLen = 0
  for (const c of central) centralLen += c.length

  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(zipped.length), ...u16(zipped.length),
    ...u32(centralLen), ...u32(centralStart), ...u16(0),
  ])

  const out = new Uint8Array(pos + centralLen + end.length)
  let o = 0
  for (const c of [...chunks, ...central, end]) { out.set(c, o); o += c.length }
  return out
}

// ─── OOXML deli ──────────────────────────────────────────────────────────────

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

function xmlEsc (s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\t|\r|\n/g, ' ')
}

/** 0 → A, 1 → B, 26 → AA … */
export function colName (i: number): string {
  let s = ''
  let n = i
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

/** Vrstica: število ali niz (null = prazna celica). */
export type XCell = string | number | null | undefined
export type XRow = XCell[]

export interface XlsxSheet { name: string; rows: XRow[] }

const CONTENT_TYPES = (nSheets: number): string => XML_HEAD +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  Array.from({ length: nSheets }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
  '</Types>'

const ROOT_RELS = XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'

const WORKBOOK = (sheets: { name: string }[]): string => XML_HEAD +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  `<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
  '</workbook>'

const WORKBOOK_RELS = (nSheets: number): string => XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  Array.from({ length: nSheets }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
  `<Relationship Id="rId${nSheets + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  '</Relationships>'

const STYLES = XML_HEAD +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Navadno" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

function sheetXml (rows: XRow[]): string {
  const body = rows.map((row, r) => {
    const cells = row
      .map((cell, c) => {
        const ref = `${colName(c)}${r + 1}`
        if (cell == null || cell === '') return ''
        if (typeof cell === 'number' && Number.isFinite(cell)) {
          return `<c r="${ref}"><v>${cell}</v></c>`
        }
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(cell))}</t></is></c>`
      })
      .join('')
    return `<row r="${r + 1}">${cells}</row>`
  }).join('')
  return XML_HEAD + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

/**
 * Zgradi XLSX iz listov (vsak: ime ≤ 31 znakov + vrstice).
 * Prva vrstica vsakega lista se oblikuje KREPKO (slog 1) — dogovor te knjižnice.
 */
export function buildXlsx (sheets: XlsxSheet[]): Uint8Array<ArrayBuffer> {
  if (sheets.length === 0) sheets = [{ name: 'List1', rows: [] }]
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
  const parts: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: enc(CONTENT_TYPES(sheets.length)) },
    { name: '_rels/.rels', data: enc(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: enc(WORKBOOK(sheets)) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(WORKBOOK_RELS(sheets.length)) },
    { name: 'xl/styles.xml', data: enc(STYLES) },
  ]
  sheets.forEach((s, i) => {
    parts.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s.rows)) })
  })
  return zipStore(parts)
}

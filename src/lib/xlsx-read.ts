// xlsx-read — R478 (issue #9 §6 zaključek): MINIMALEN lasten bralnik XLSX.
// Dopolnilo pisalniku xlsx-mini (R477) — bere LASTNE izvoze (ZIP STORE) IN
// datoteke, ki jih je znova shranil Excel/LibreOffice (DEFLATE + sharedStrings).
//
// STREŽNIŠKI modul (node:zlib za DEFLATE) — uporablja ga API uvoza; čisti
// razčlenjevalniki (parseSheetXml/findHeaderRow/sheetRowsToBom) so v
// import-core.ts in ostanejo uporabni kjerkoli.
//
// Zavestne meje (poštenost — dokumentirano, ne skrito):
//  • bere vrednosti celic (inlineStr, sharedStrings, števila, t="str");
//    FORMULE se NE ovrednotijo (prebere se zadnji prikazani <v> če obstaja)
//  • brez datumskih stilov — za naše tabele (količine/SQL/besedilo) ni treba
//  • ZIP64 ni podprt (meja datoteke je 4 GB — uvoz je omejen na 2 MB v API-ju)

import { inflateRawSync } from 'node:zlib'
import { findHeaderRow } from '@/lib/import-core'

export const XLSX_READ_VERSION = 'xlsx-read/1.0'

// ─── ZIP razpakiranje (STORE + DEFLATE) ──────────────────────────────────────

interface ZipEntry { name: string; data: Uint8Array }

function unzip (buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const u16 = (p: number): number => dv.getUint16(p, true)
  const u32 = (p: number): number => dv.getUint32(p, true)

  // EOCD (konec centralnega imenika) — išči od konca
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (u32(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Ni arhiva ZIP (manjka EOCD).')
  const count = u16(eocd + 10)
  let ptr = u32(eocd + 16) // zamik centralnega imenika

  const out = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (u32(ptr) !== 0x02014b50) throw new Error('Pokvarjen centralni imenik ZIP.')
    const method = u16(ptr + 10)
    const compSize = u32(ptr + 20)
    const nameLen = u16(ptr + 28)
    const extraLen = u16(ptr + 30)
    const commentLen = u16(ptr + 32)
    const localOff = u32(ptr + 42)
    const name = new TextDecoder().decode(buf.subarray(ptr + 46, ptr + 46 + nameLen))
    ptr += 46 + nameLen + extraLen + commentLen

    // lokalna glava: preskoči do podatkov
    if (u32(localOff) !== 0x04034b50) throw new Error('Pokvarjena lokalna glava ZIP.')
    const lNameLen = u16(localOff + 26)
    const lExtraLen = u16(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)

    let data: Uint8Array
    if (method === 0) data = raw // STORE
    else if (method === 8) data = inflateRawSync(raw) // DEFLATE (Excel re-save)
    else throw new Error(`Nepodprta metoda ZIP (${method}) — podprta sta STORE in DEFLATE.`)
    out.set(name, data)
  }
  return out
}

// ─── XML lista → vrstice (nizi; števila ostanejo nizi s piko) ────────────────

/** Vrstice lista: celice po ref (A1 → stolpec 0); manjkajoče = null. */
export function parseSheetXml (xml: string, sharedStrings: string[] = []): string[][] {
  const rows: string[][] = []
  const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row[^>]*\br="(\d+)"[^>]*\/>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const r = parseInt(rowMatch[1] ?? rowMatch[3], 10) - 1
    const body = rowMatch[2] ?? ''
    const cells: (string | null)[] = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(body)) !== null) {
      const attrs = cellMatch[1] ?? ''
      const inner = cellMatch[2] ?? ''
      const refM = /\br="([A-Z]+)(\d+)"/.exec(attrs)
      if (refM == null) continue // celica brez ref — preskoči (ne vemo kam)
      let col = 0
      for (const ch of refM[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
      col -= 1
      const rowIdx = parseInt(refM[2], 10) - 1

      let value = ''
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1]
      if (type === 'inlineStr') {
        value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')
      } else if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''
        const idx = parseInt(v, 10)
        value = Number.isFinite(idx) ? sharedStrings[idx] ?? '' : ''
      } else if (type === 'str') {
        value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''
      } else {
        value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''
      }

      // XML entitete
      value = value
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))

      while (cells.length < col) cells.push(null)
      cells[col] = value
    }
    while (rows.length < r) rows.push([])
    rows[r] = cells.map((c) => c ?? '')
  }
  return rows
}

// ─── Delovni zvezek: imena listov + razrešitev ciljnega lista ────────────────

function decodeXml (s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&') // &amp; ZADNJI (drugače dvojno dekodiranje)
}

/** Imena listov iz xl/workbook.xml v vrstnem redu. */
function workbookSheetNames (workbookXml: string): string[] {
  return [...workbookXml.matchAll(/<sheet\b[^>]*?name="([^"]*)"[^>]*?(?:r:id="(rId\d+)")?[^>]*?\/>/g)]
    .map((m) => decodeXml(m[1]))
}

/** sharedStrings.xml → nizi po indeksu (Excel ponavadi shranjuje besedilo sem). */
function readSharedStrings (xml: string | undefined): string[] {
  if (xml == null) return []
  const out: string[] = []
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const text = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')
    out.push(decodeXml(text))
  }
  return out
}

export interface XlsxReadResult {
  /** ime lista → vrstice */
  sheets: Map<string, string[][]>
}

/**
 * Prebere XLSX delovni zvezek v vrstice po listih (celice kot nizi).
 * Vrne prazne nize za prazne celice; vrstice so gneče po r atributu.
 */
export function readXlsx (buf: Uint8Array): XlsxReadResult {
  const files = unzip(buf)
  const get = (name: string): string | undefined => {
    const d = files.get(name)
    return d != null ? new TextDecoder().decode(d) : undefined
  }

  const workbook = get('xl/workbook.xml')
  if (workbook == null) throw new Error('XLSX brez xl/workbook.xml — ni delovni zvezek.')

  // ciljne poti listov: 1:1 po vrstnem redu rId → worksheets/sheetN.xml
  const relsXml = get('xl/_rels/workbook.xml.rels') ?? ''
  const relTargets = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?Id="(rId\d+)"[^>]*?Target="([^"]*)"[^>]*?\/>/g)) {
    relTargets.set(m[1], m[2].startsWith('/') ? m[2].slice(1) : `xl/${m[2]}`)
  }

  const names = workbookSheetNames(workbook)
  const rIds = [...workbook.matchAll(/<sheet\b[^>]*?r:id="(rId\d+)"/g)].map((m) => m[1])

  const shared = readSharedStrings(get('xl/sharedStrings.xml'))

  const sheets = new Map<string, string[][]>()
  if (rIds.length > 0) {
    rIds.forEach((rid, i) => {
      const target = relTargets.get(rid)
      const name = names[i] ?? `List${i + 1}`
      const xml = target != null ? get(target) : undefined
      sheets.set(name, xml != null ? parseSheetXml(xml, shared) : [])
    })
  } else {
    // naš pisalnik: worksheets/sheetN.xml po vrstnem redu brez r:id
    names.forEach((name, i) => {
      const xml = get(`xl/worksheets/sheet${i + 1}.xml`)
      sheets.set(name, xml != null ? parseSheetXml(xml, shared) : [])
    })
    if (names.length === 0) {
      // zasilni način: kar vse sheetN.xml po vrsti
      let n = 1
      while (files.has(`xl/worksheets/sheet${n}.xml`)) {
        sheets.set(`List${n}`, parseSheetXml(get(`xl/worksheets/sheet${n}.xml`) ?? '', shared))
        n++
      }
    }
  }
  return { sheets }
}

/** Poišče list z glavo tabele (po imenu, sicer po vsebini). */
export function findSheetWithHeader (res: XlsxReadResult, header: readonly string[], preferredName?: string): { name: string; rows: string[][] } | null {
  if (preferredName != null) {
    const rows = res.sheets.get(preferredName)
    if (rows != null && findHeaderRow(rows, header) >= 0) return { name: preferredName, rows }
  }
  for (const [name, rows] of res.sheets) {
    if (findHeaderRow(rows, header) >= 0) return { name, rows }
  }
  return null
}

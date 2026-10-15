// price-import-core.ts — R516 (issue #15 Faza 6, cenovni del brez lastnika):
// AVTOMATSKI UVOZ CENIKOV (CSV/XLSX/JSON) v obstoječi disciplini import-core.
//
// Zakaj: stalna pogodba projekta je »poslovne cene NISO hardcoded — ostanejo
// zadeva podatka (PriceList/PriceRule)«. Ročni vnos vsake cene posebej pa za
// lastnika ni izvedljiv ob stotičah artiklov; zato pogodba izrecno zahteva
// ZMOŽNOST VNOSA CEN »vključno z avtomatskim uvozom«. Ta modul je čisti del
// tega uvoza: razčlenitev + validacija + predogled (diff). Zapis v bazo je
// SAMO v API plasti (/api/import/cenik) — tu ni Prisme, ni next, ni datotek.
//
// NAČELA (enaka kot import-core za kosovnice — brez tihih predpostavk):
//  • SKU je obvezen; podvojen SKU v isti datoteki je NAPAKA (ne zadnji zmaga).
//  • Cena mora biti > 0; dovoljena SI vejica ALI pika (parseSiNumber).
//  • Popust: prazno → 0; sicer 0..100. Min cena: prazno → brez; sicer 0..cena.
//  • Datuma: ISO (YYYY-MM-DD) ali SI (DD.MM.YYYY) → normalizirano na ISO;
//    veljavno od > veljavno do je NAPAKA.
//  • Enota v datoteki je NEOBVEZNA, a resolucija je vidna v predogledu:
//    datoteka → katalog (produkt/artikel) → napaka, če nobena. Brez tihega
//    privzeka (PriceRule.unit privzeto "m2" se tu NE uporabi).
//  • NEZNAN SKU ni preskočen — viden je v predogledu in (ob uvozu) zaustavi
//    CEL uvoz (vse ali nič), ker delni cenik pomeni napačne izračune ponudb.
//
// Revizija: PRICE_LIST_IMPORT (API plast).

export const PRICE_IMPORT_CORE_VERSION = 'price-import-core/1.0'

export const PRICE_CSV_HEADER = ['SKU', 'Cena', 'Enota', 'Popust %', 'Min cena', 'Veljavno od', 'Veljavno do', 'Opomba'] as const

// ─── Vrste ──────────────────────────────────────────────────────────────────

import { parseSiNumber, findHeaderRow, type ImportRowError } from '@/lib/import-core'
import { parseCsv } from '@/lib/export-core'

/** Ena veljavna uvozna vrstica cenika (cene so PODATEK, ne koda). */
export interface CenikImportLine {
  sku: string
  price: number
  /** null = iz datoteke ni znana; API jo razreši iz kataloga (vidno v predogledu) */
  unit: string | null
  discountPct: number
  minPrice: number | null
  validFrom: string | null // ISO YYYY-MM-DD
  validTo: string | null // ISO YYYY-MM-DD
  note: string | null
}

/** Suha vrstica pred validacijo (celice kot nizi). */
export interface RawCenikRow {
  sku: string
  priceRaw: string
  unit: string | null
  discountRaw: string | null
  minPriceRaw: string | null
  validFromRaw: string | null
  validToRaw: string | null
  note: string | null
}

// ─── Datumi (ISO ali SI → ISO) ──────────────────────────────────────────────

/** "2026-11-01" | "01.11.2026" → "2026-11-01"; vse ostalo → null. */
export function parseSiDate (v: string | null | undefined): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '') return null
  let y = '', mo = '', d = ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { y = s.slice(0, 4); mo = s.slice(5, 7); d = s.slice(8, 10) }
  else {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s)
    if (m != null) { d = String(m[1]).padStart(2, '0'); mo = String(m[2]).padStart(2, '0'); y = m[3] }
    else return null
  }
  // obseg meseca/dneva — "1.13.2026" in "32.01.2026" NISTA datuma (ne izmišljujemo)
  const mm = Number(mo)
  const dd = Number(d)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const iso = `${y}-${mo}-${d}`
  // round-trip: 29.02. v neprestolem letu ipd. se ne izteče v isti ISO datum
  const dt = new Date(Date.UTC(Number(y), mm - 1, dd))
  if (Number.isNaN(dt.getTime()) || dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null
  return iso
}

// ─── Validacija vrstic ──────────────────────────────────────────────────────

/**
 * Validira suhe vrstice. Vsako NEVELJAVNO vrstico javi kot napako (vrstica,
 * polje, težava) — ni preskokov, ni tihega popravljanja. Podvojen SKU v isti
 * datoteki je napaka na drugi pojavitvi.
 */
export function validateCenikRows (rows: RawCenikRow[]): { lines: CenikImportLine[]; errors: ImportRowError[] } {
  const lines: CenikImportLine[] = []
  const errors: ImportRowError[] = []
  const seen = new Map<string, number>()

  for (const [i, r] of rows.entries()) {
    const rowNo = i + 2 // glava je vrstica 1
    const sku = r.sku.trim()
    if (sku === '') { errors.push({ row: rowNo, field: 'SKU', problem: 'SKU je obvezen.' }); continue }

    const price = parseSiNumber(r.priceRaw)
    if (price == null || price <= 0) {
      errors.push({ row: rowNo, field: 'Cena', problem: `Cena "${r.priceRaw}" ni veljavno pozitivno število.` })
      continue
    }

    let discountPct = 0
    if (r.discountRaw != null && r.discountRaw.trim() !== '') {
      discountPct = parseSiNumber(r.discountRaw) ?? -1
      if (discountPct < 0 || discountPct > 100) {
        errors.push({ row: rowNo, field: 'Popust %', problem: `Popust "${r.discountRaw}" ni veljaven (0..100).` })
        continue
      }
    }

    let minPrice: number | null = null
    if (r.minPriceRaw != null && r.minPriceRaw.trim() !== '') {
      minPrice = parseSiNumber(r.minPriceRaw)
      if (minPrice == null || minPrice < 0) {
        errors.push({ row: rowNo, field: 'Min cena', problem: `Min cena "${r.minPriceRaw}" ni veljavno število (≥ 0).` })
        continue
      }
      if (minPrice > price) {
        errors.push({ row: rowNo, field: 'Min cena', problem: `Min cena (${minPrice}) je višja od cene (${price}).` })
        continue
      }
    }

    const validFrom = parseSiDate(r.validFromRaw)
    if (r.validFromRaw != null && r.validFromRaw.trim() !== '' && validFrom == null) {
      errors.push({ row: rowNo, field: 'Veljavno od', problem: `Datum "${r.validFromRaw}" ni veljaven (YYYY-MM-DD ali DD.MM.YYYY).` })
      continue
    }
    const validTo = parseSiDate(r.validToRaw)
    if (r.validToRaw != null && r.validToRaw.trim() !== '' && validTo == null) {
      errors.push({ row: rowNo, field: 'Veljavno do', problem: `Datum "${r.validToRaw}" ni veljaven (YYYY-MM-DD ali DD.MM.YYYY).` })
      continue
    }
    if (validFrom != null && validTo != null && validFrom > validTo) {
      errors.push({ row: rowNo, field: 'Veljavno od', problem: `Veljavno od (${validFrom}) je za veljavno do (${validTo}).` })
      continue
    }

    const prev = seen.get(sku)
    if (prev != null) {
      errors.push({ row: rowNo, field: 'SKU', problem: `Podvojen SKU ${sku} — že v vrstici ${prev}.` })
      continue
    }
    seen.set(sku, rowNo)

    lines.push({
      sku,
      price,
      unit: r.unit != null && r.unit.trim() !== '' ? r.unit.trim() : null,
      discountPct,
      minPrice,
      validFrom,
      validTo,
      note: r.note != null && r.note.trim() !== '' ? r.note.trim() : null,
    })
  }

  return { lines, errors }
}

// ─── CSV (LASTNA oblika, podpičje, decimalna vejica ali pika) ───────────────

export function parseCenikCsv (text: string): { lines: CenikImportLine[]; errors: ImportRowError[]; warnings: string[] } {
  const parsed = parseCsv(text)
  const warnings: string[] = []

  const headerOk = parsed.header.length >= PRICE_CSV_HEADER.length &&
    PRICE_CSV_HEADER.every((h, i) => parsed.header[i] === h)
  if (!headerOk) {
    return {
      lines: [],
      errors: [{ row: 1, field: 'Glava', problem: `Glava se ne ujema s pričakovano (${PRICE_CSV_HEADER.join(';')}).` }],
      warnings,
    }
  }

  const rows: RawCenikRow[] = []
  for (const [i, row] of parsed.rows.entries()) {
    if (row.every((c) => c === '')) { warnings.push(`Vrstica ${i + 2}: prazna — preskočena.`); continue }
    const cells = [...row, ...Array(8).fill('')] // podaljšaj na 8 stolpcev
    rows.push({
      sku: cells[0], priceRaw: cells[1], unit: cells[2], discountRaw: cells[3],
      minPriceRaw: cells[4], validFromRaw: cells[5], validToRaw: cells[6], note: cells[7],
    })
  }
  const { lines, errors } = validateCenikRows(rows)
  return { lines, errors, warnings }
}

// ─── JSON (oblika izvoza / v ročno pripravljene tabele) ──────────────────────

interface RawJsonCenikLine {
  sku?: unknown; price?: unknown; unit?: unknown; discountPct?: unknown
  minPrice?: unknown; validFrom?: unknown; validTo?: unknown; note?: unknown
}

export function parseCenikJson (obj: unknown): { lines: CenikImportLine[]; errors: ImportRowError[]; warnings: string[] } {
  const warnings: string[] = []
  // sprejmi { data: { kind, lines } } ali golo { kind, lines } ali gol ARRAY
  const raw = obj as { data?: unknown } | null
  if (raw != null && typeof raw === 'object' && raw.data != null && typeof raw.data === 'object') obj = raw.data
  const o = obj as { kind?: unknown; lines?: unknown } | null
  if (o == null || typeof o !== 'object' || Array.isArray(obj)) {
    if (Array.isArray(obj)) {
      // gol array vrstic — dopustimo (enostavna priprava)
      const { lines, errors } = validateCenikRows((obj as RawJsonCenikLine[]).map(rawJsonToRow))
      return { lines, errors, warnings }
    }
    return { lines: [], errors: [{ row: 1, field: 'JSON', problem: 'Datoteka ni veljaven JSON objekt.' }], warnings }
  }
  if (o.kind !== 'cenik') {
    return { lines: [], errors: [{ row: 1, field: 'JSON', problem: 'JSON ni cenik (kind ≠ "cenik").' }], warnings }
  }
  if (!Array.isArray(o.lines) || o.lines.length === 0) {
    return { lines: [], errors: [{ row: 1, field: 'JSON', problem: 'Cenik nima vrstic.' }], warnings }
  }
  const { lines, errors } = validateCenikRows((o.lines as RawJsonCenikLine[]).map(rawJsonToRow))
  return { lines, errors, warnings }
}

function rawJsonToRow (l: RawJsonCenikLine): RawCenikRow {
  return {
    sku: typeof l?.sku === 'string' ? l.sku : '',
    priceRaw: l?.price == null ? '' : String(l.price),
    unit: typeof l?.unit === 'string' ? l.unit : null,
    discountRaw: l?.discountPct == null ? null : String(l.discountPct),
    minPriceRaw: l?.minPrice == null ? null : String(l.minPrice),
    validFromRaw: typeof l?.validFrom === 'string' ? l.validFrom : null,
    validToRaw: typeof l?.validTo === 'string' ? l.validTo : null,
    note: typeof l?.note === 'string' ? l.note : null,
  }
}

// ─── XLSX (vrstice lista → suhe vrstice) ────────────────────────────────────

export function sheetRowsToCenik (rows: string[][]): { lines: CenikImportLine[]; errors: ImportRowError[]; warnings: string[] } {
  const warnings: string[] = []
  const headerIdx = findHeaderRow(rows, PRICE_CSV_HEADER)
  if (headerIdx < 0) {
    return {
      lines: [],
      errors: [{ row: 1, field: 'Glava', problem: `V listu ni glave cenika (${PRICE_CSV_HEADER.join(';')}).` }],
      warnings,
    }
  }
  if (headerIdx > 0) warnings.push(`Prvih ${headerIdx} vrstic je metapodatkov — preskočene.`)

  const raw: RawCenikRow[] = []
  for (const [i, row] of rows.slice(headerIdx + 1).entries()) {
    if (row == null || row.every((c) => c == null || c === '')) { warnings.push(`Vrstica ${headerIdx + i + 2}: prazna — preskočena.`); continue }
    const cells = [...row.map((c) => c ?? ''), ...Array(8).fill('')]
    raw.push({
      sku: cells[0], priceRaw: cells[1], unit: cells[2], discountRaw: cells[3],
      minPriceRaw: cells[4], validFromRaw: cells[5], validToRaw: cells[6], note: cells[7],
    })
  }
  const { lines, errors } = validateCenikRows(raw)
  return { lines, errors, warnings }
}

// ─── Predogled (diff proti katalogu in obstoječemu ceniku) ──────────────────

export type CenikDiffKind = 'NOVO' | 'POSODOBLJENO' | 'NEZNAN_SKU'

export interface CenikDiffEntry {
  kind: CenikDiffKind
  sku: string
  /** rešena enota (datoteka → katalog) ali null, če je ni ne zdatoteke ne iz kataloga */
  unit: string | null
  /** obstoječa cena (samo POSODOBLJENO) */
  fromPrice?: number
  toPrice: number
}

export interface CenikDiff {
  entries: CenikDiffEntry[]
  novo: number
  posodobljeno: number
  neznani: string[]
  /** vrstice, kjer ni niti datotečne niti kataloške enote — uvoz jih bo zavrl */
  brezEnote: string[]
}

/**
 * Predogled uvoza: za vsako vrstico pove, ali je SKU v katalogu (products +
 * inventory items — SKUji se posredujejo kot Set) in ali v ciljnem ceniku že
 * obstaja PRAVILO za ta SKU (posodobljeno = nadomestitev, ne seštevanje).
 * NEZNAN_SKU in BREZ ENOTE se ob uvozu zavrneta — tukaj so vidni že v PREVERI.
 */
export function cenikImportPreview (
  lines: CenikImportLine[],
  knownSkus: Set<string>,
  /** sku → enota iz kataloga (produkt ali artikel) */
  catalogUnits: Map<string, string>,
  /** sku → obstoječe aktivno pravilo v ciljnem ceniku (sku, cena) */
  existing: Map<string, { price: number }>,
): CenikDiff {
  const entries: CenikDiffEntry[] = []
  let novo = 0
  let posodobljeno = 0
  const neznani: string[] = []
  const brezEnote: string[] = []

  for (const l of lines) {
    if (!knownSkus.has(l.sku)) {
      neznani.push(l.sku)
      entries.push({ kind: 'NEZNAN_SKU', sku: l.sku, unit: l.unit, toPrice: l.price })
      continue
    }
    // prazna kataloška enota JE manjkajoča (ne privzeta, ne prazna)
    const catUnit = catalogUnits.get(l.sku)
    const unit = l.unit ?? (catUnit != null && catUnit.trim() !== '' ? catUnit : null)
    if (unit == null) brezEnote.push(l.sku)
    const ex = existing.get(l.sku)
    if (ex != null) {
      posodobljeno += 1
      entries.push({ kind: 'POSODOBLJENO', sku: l.sku, unit, fromPrice: ex.price, toPrice: l.price })
    } else {
      novo += 1
      entries.push({ kind: 'NOVO', sku: l.sku, unit, toPrice: l.price })
    }
  }

  return { entries, novo, posodobljeno, neznani, brezEnote }
}

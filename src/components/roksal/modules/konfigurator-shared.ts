// KONFIGURATOR — skupni tipi, tabele in pomočniki (R546: en vir resnice).
// Čist TS modul brez JSX/odvisnosti — uporabljajo ga konfigurator.tsx (stanje/tok),
// konfigurator-steps.tsx (koraki 1,2,4,5,6) in konfigurator-meritve.tsx (korak 3).

import type { PackageTier } from '@/lib/quote-core'

// ─── Družinski obrazci (issue #7 §4 — vhodi po družinah) ──────────────────────

/** Preslikava družina → vrsta vhodnega obrazca. */
export function formTypeOf (familyCode: string): 'm2' | 'm' | 'kos' {
  if (familyCode === 'OGRAJA_PRECNA' || familyCode === 'OGRAJA_POKOCNA') return 'm'
  if (familyCode === 'STOPNICE' || familyCode === 'VRTNA_RESITEV' || familyCode === 'KOMPONENTA') return 'kos'
  return 'm2' // TERASA | FASADA | PREGRADA | NAPUSC | STROP
}

export const PODLAGE_TERASA = [
  'Beton',
  'Estrih',
  'Pesek / dražena podlaga',
  'Lesena podkonstrukcija',
  'Alu podkonstrukcija',
]

export const NACINI_PRITRDITVE = [
  { value: 'TALNA', label: 'Talna pritrditev (vijaki v podlago)' },
  { value: 'STEBRI_V_BETON', label: 'Stebri v beton' },
  { value: 'BOCNA_NA_STENO', label: 'Bočna pritrditev na steno' },
]

export const CLOSED_PROJECT_STATUSES = ['ZAKLJUCEN', 'ARHIV']

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export interface ProjectRow {
  id: string; code: string; title: string; status: string
  customer: { name: string; city: string | null } | null
}
export interface FamilyRow { id: string; code: string; name: string; unit: string }
export interface VariantRow {
  id: string; sku: string; name: string; color: string | null; ral: string | null
  salePrice: number | null
}
export interface ProductRow {
  id: string; sku: string; name: string; unit: string; salePrice: number
  family: { code: string; name: string; unit: string }
  variants: VariantRow[]
  _count: { components: number; packages: number }
}
export interface ProductDetail extends ProductRow {
  components: {
    id: string; qty: number; unitBasis: string; optional: boolean; note: string | null
    item: { sku: string; name: string; unit: string }
  }[]
}
export interface PlanLine {
  itemId: string; sku: string; name: string; unit: string
  qty: number; optional: boolean; note: string | null
  unitCost: number; lineCost: number
  stockQty: number; covered: boolean; missing: number
  segmentKey: string | null; group: string | null; wastePct: number | null; sourceRule: string | null // R475
}
export interface PlanData {
  product: { id: string; sku: string; name: string; unit: string }
  variant: { id: string; sku: string; name: string } | null
  qty: number; unit: string
  lines: PlanLine[]
  materialCost: number; salePriceUnit: number; montazaUnit: number
  totalSale: number; totalCost: number; margin: number; marginPct: number
  priceSource: string
  segmentsApplied: number; warnings: { code: string; message: string }[]; segmentEngine: string | null // R475
  family: { code: string; name: string; unit: string }
}

export interface Seg2 { id: number; len: string; wid: string }
export interface SegM { id: number; len: string; h: string }
export interface Odb { id: number; opis: string; m2: string }

export interface SaveResult {
  packageId: string; packageCode: string
  bomCode: string | null; quoteCode: string | null
  tier: string | null; compareCode: string | null // R476: primerjalni paket
}

/** Ena obstoječa primerjava na projektu (R476) — nivoji + prosti nivoji. */
export interface CompareGroupRow {
  code: string
  tiers: string[]
  free: PackageTier[]
}

// ─── Pomočniki ────────────────────────────────────────────────────────────────

/** Toleranten numerični vnos (sprejme tudi decimalno vejico — SI navada). */
export function parseNum (s: string): number {
  const v = Number(String(s).trim().replace(',', '.'))
  return Number.isFinite(v) ? v : NaN
}
export const round2 = (n: number) => Math.round(n * 100) / 100
export const pos = (n: number) => Number.isFinite(n) && n > 0

/**
 * R488 (P2 — end-to-end veriga): PRAVI segmenti tekača iz params meritve
 * (dolžine/višine po segmentu; ključe seg-N razreši strežnik ob izračunu BOM).
 * Vrne null, če meritev NI nastala iz ograjnega tekača (manjka
 * params.fenceRunId ali params.segments) — takrat velja stara flat pretvorba.
 * R542: params je jsonb objekt — niz ostane le kot obramba za starejše oblike.
 * R546: fizično se je preselil iz konfigurator.tsx (brez spremembe obnašanja).
 */
export function runSegmentsFromParams (params: Record<string, unknown> | string | null): { lengthCm: number; heightCm: number | null }[] | null {
  if (!params) return null
  const o = (typeof params === 'string'
    ? (() => { try { return JSON.parse(params) as unknown } catch { return null } })()
    : params) as {
    fenceRunId?: unknown
    segments?: { lengthCm?: unknown; heightCm?: unknown }[] | null
  } | null
  if (!o || typeof o !== 'object') return null
  if (typeof o.fenceRunId !== 'string' || !o.fenceRunId) return null
  if (!Array.isArray(o.segments) || o.segments.length === 0) return null
  const out: { lengthCm: number; heightCm: number | null }[] = []
  for (const s of o.segments) {
    const lenCm = Number(s?.lengthCm)
    if (!Number.isFinite(lenCm) || lenCm <= 0) continue // preskoči neveljavne
    const h = Number(s?.heightCm)
    out.push({ lengthCm: lenCm, heightCm: Number.isFinite(h) && h > 0 ? h : null })
  }
  return out.length > 0 ? out : null
}

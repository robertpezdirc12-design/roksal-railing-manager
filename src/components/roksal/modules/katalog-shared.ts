// KATALOG — skupni tipi, oznake in preslikave (R548: en vir resnice).
// Čist TS modul — uporabljajo ga katalog.tsx (lupina), katalog-izdelki.tsx,
// katalog-ceniki.tsx in katalog-gradiva.tsx. Izvlečeno iz katalog.tsx BREZ
// spremembe obnašanja (razbitje po vzorcu R546/R547).

// ─── tipi ────────────────────────────────────────────────────────────────────

export interface FamilyRow { id: string; code: string; name: string; desc: string | null; unit: string; productCount: number }

export interface VariantRow { id: string; sku: string; name: string; color: string | null; ral: string | null; salePrice: number | null }

export interface ComponentRow {
  id: string; qty: number; unitBasis: string; optional: boolean; note: string | null; sortOrder: number
  segmentRole: string | null // R475: STEBER | ROCNIK | POLNILO_M | POLNILO_M2 | null
  item: { id: string; sku: string; name: string; unit: string; qty: number }
}

export interface ProductRow {
  id: string; sku: string; name: string; desc: string | null; unit: string
  widthMm: number | null; heightMm: number | null
  costPrice: number; salePrice: number; warrantyMonths: number; active: boolean
  family: { code: string; name: string; unit: string }
  variants: VariantRow[]
  _count: { components: number; packages: number }
}

export interface ProductDetail extends Omit<ProductRow, '_count'> {
  components: ComponentRow[]
  tech: string | null
  _count: { packages: number; boms: number; components: number }
}

export interface BomPlanLine {
  itemId: string; sku: string; name: string; unit: string; qty: number
  optional: boolean; note: string | null; unitCost: number; lineCost: number
  stockQty: number; covered: boolean; missing: number
  segmentKey: string | null; group: string | null; wastePct: number | null; sourceRule: string | null // R475
}

export interface BomPlan {
  product: { id: string; sku: string; name: string; unit: string }
  variant: { id: string; sku: string; name: string } | null
  qty: number; unit: string
  lines: BomPlanLine[]
  materialCost: number; salePriceUnit: number; montazaUnit: number
  totalSale: number; totalCost: number; margin: number; marginPct: number
  priceSource: string
  segmentsApplied: number; warnings: { code: string; message: string }[]; segmentEngine: string | null // R475
}

export interface PriceRuleRow {
  id: string; price: number; unit: string; discountPct: number; minPrice: number | null
  seasonFrom: string | null; seasonTo: string | null; note: string | null
  product: { id: string; sku: string; name: string; unit: string } | null
  item: { id: string; sku: string; name: string; unit: string } | null
}

export interface PriceListRow {
  id: string; name: string; type: string; currency: string; note: string | null
  validFrom: string; validTo: string | null
  rules: PriceRuleRow[]
}

// ── R464 (GitHub issue #1): generična konfiguracijska pravila (KONFIG:<ključ>,
// brez produkta/artikla) — ocene viz/3D konfiguratorja, ki živijo v ceniku.
export const KONFIG_RULE_LABELS: Record<string, string> = {
  'KONFIG:STEBER': 'Steber (konfigurator) — ocena',
  'KONFIG:ROCNIK': 'Ročnik na meter (konfigurator)',
  'KONFIG:STEKLO': 'Steklena plošča na m² (konfigurator)',
  'KONFIG:MONTAZA': 'Montaža na meter (konfigurator)',
  'KONFIG:PRIPRAVA': 'Priprava in rezerva % (konfigurator)',
  'KONFIG:PROFIL_OCENA': 'Profil — ocena na meter (konfigurator)',
}
export const konfigLabel = (r: PriceRuleRow | null): string | null =>
  r?.note != null && r.note.startsWith('KONFIG:')
    ? (KONFIG_RULE_LABELS[r.note] ?? r.note)
    : null

// ── R448 (issue #7 §11): preslikava kod družin v slovenska imena hitrega filtra ──
export const FAMILY_LABELS: Record<string, string> = {
  TERASA: 'Terase',
  OGRAJA_PRECNA: 'Ograje prečne',
  OGRAJA_POKOCNA: 'Ograje pokončne',
  FASADA: 'Fasade',
  PREGRADA: 'Pregrade',
  NAPUSC: 'Napušči',
  STROP: 'Stropi',
  STOPNICE: 'Stopnice',
  VRTNA_RESITEV: 'Vrtne rešitve',
  KOMPONENTA: 'Komponente',
}

export function familyLabel (code: string, fallback: string): string {
  return FAMILY_LABELS[code] ?? fallback
}

// quote-core — R476 (issue #9 §5 HOVER PARITY — PRIMERJALNI PAKETI + POPUST)
//
// Skupne konstante in ČISTA matematika za ponudbe in primerjalne pakete:
//  • POPUST na celotno ponudbo: odstotek (0..100) → znesek; DDV 22 % se
//    izračuna iz osnove PO popustu (pošteno do stranke in do knjigovodstva).
//  • PRIMERJALNI PAKETI: isti obseg (izmera) v nivojih STANDARD / BOLJSI /
//    PREMIUM — vrednosti so ASCII (zapis v bazo/API), oznake pa slovenske
//    z šumniki (samo za prikaz).
//
// ČIST lib: NIČ strežniških uvozov — uporaben na odjemalcu in strežniku.

// ─── Verzija ────────────────────────────────────────────────────────────────

export const QUOTE_CORE_VERSION = 'quote-core/1.0'

// ─── DDV ─────────────────────────────────────────────────────────────────────

export const VAT_RATE = 0.22

// ─── Popust ───────────────────────────────────────────────────────────────────

export const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Preveri in normaliziraj odstotek popusta.
 * @returns veljavno število 0..100 ali null (neveljaven vnos)
 */
export function parseDiscountPct (v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(String(v).replace(',', '.')) : NaN
  if (!Number.isFinite(n)) return null
  if (n < 0 || n > 100) return null
  return round2(n)
}

/** Zneski ponudbe z (opcionalnim) popustom — en vir resnice za API in UI. */
export interface QuoteTotals {
  subtotal: number // vsota pozicij
  discountPct: number // 0..100 (0 = brez popusta)
  discount: number // subtotal × pct/100, zaokroženo na 2 decimalki
  base: number // subtotal − discount (osnova za DDV)
  vat: number // base × 22 %, zaokroženo
  total: number // base + vat, zaokroženo
}

/**
 * Izračuna zneske ponudbe iz vsot pozicij in odstotka popusta.
 * Vsa zaokroževanja na 2 decimalki; DDV IZKLJUČNO iz osnove po popustu.
 */
export function computeQuoteTotals (lineTotals: number[], discountPct = 0): QuoteTotals {
  const pct = Number.isFinite(discountPct) ? Math.min(100, Math.max(0, discountPct)) : 0
  const subtotal = round2(lineTotals.reduce((s, t) => s + (Number.isFinite(t) ? t : 0), 0))
  const discount = round2(subtotal * (pct / 100))
  const base = round2(subtotal - discount)
  const vat = round2(base * VAT_RATE)
  const total = round2(base + vat)
  return { subtotal, discountPct: pct, discount, base, vat, total }
}

// ─── Primerjalni paketi (tier) ────────────────────────────────────────────────

/** Nivoji primerjalne ponudbe — ASCII vrednosti (baza/API), oznake spodaj. */
export const PACKAGE_TIERS = ['STANDARD', 'BOLJSI', 'PREMIUM'] as const
export type PackageTier = (typeof PACKAGE_TIERS)[number]

export const TIER_LABELS: Record<PackageTier, string> = {
  STANDARD: 'Standard',
  BOLJSI: 'Boljši',
  PREMIUM: 'Premium',
}

/** Vrstni red prikaza nivojev v primerjavi. */
export const TIER_ORDER: readonly PackageTier[] = PACKAGE_TIERS

/** Kratek opis poslovnega pomena nivoja (hint v konfiguratorju). */
export const TIER_HINTS: Record<PackageTier, string> = {
  STANDARD: 'osnovna rešitev — najboljša cena',
  BOLJSI: 'boljši materiali/izvedba — ravnovesje',
  PREMIUM: 'vrhunska izvedba — brez kompromisov',
}

export function isPackageTier (v: unknown): v is PackageTier {
  return typeof v === 'string' && (PACKAGE_TIERS as readonly string[]).includes(v)
}

/** Oznaka nivoja za prikaz (neznane vrednosti pokaže izvorno). */
export function tierLabel (tier: string | null | undefined): string {
  return tier != null && isPackageTier(tier) ? TIER_LABELS[tier] : (tier ?? '')
}

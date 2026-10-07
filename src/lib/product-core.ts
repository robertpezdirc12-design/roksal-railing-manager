// product-core — R442 (issue #7 P0 DATA CORE)
// Jedro produktnega modela: razreševanje cen iz cenikov + generacija BOM iz predlog.
// PRAVILA (issue #7 §2/§6/§15):
//  - BOM uporablja IZKLJUČNO eksplicitne ID povezave (productId → itemId) — nikoli imena;
//  - poslovne cene NISO hardcoded — vedno gredo skozi PriceList/PriceRule z veljavnostjo;
//  - vse funkcije vračajo struktirane rezultate (račun je razložljiv in revizijsko sledljiv).

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

// ─── Družine ─────────────────────────────────────────────────────────────────

export const FAMILY_CODES = [
  'TERASA', 'OGRAJA_PRECNA', 'OGRAJA_POKOCNA', 'FASADA', 'PREGRADA',
  'NAPUSC', 'STROP', 'STOPNICE', 'VRTNA_RESITEV', 'KOMPONENTA',
] as const
export type FamilyCode = (typeof FAMILY_CODES)[number]

export const FAMILY_LABELS: Record<string, string> = {
  TERASA: 'Terase',
  OGRAJA_PRECNA: 'Ograje — prečne',
  OGRAJA_POKOCNA: 'Ograje — pokončne',
  FASADA: 'Fasade',
  PREGRADA: 'Pregrade',
  NAPUSC: 'Napušči',
  STROP: 'Stropi',
  STOPNICE: 'Stopnice',
  VRTNA_RESITEV: 'Vrtne rešitve',
  KOMPONENTA: 'Komponente',
}

export const BOM_STATUSES = ['OSNUTEK', 'POTRJEN', 'REZERVIRAN', 'PORABLJEN', 'PREKLICAN'] as const
export const PACKAGE_STATUSES = [
  'POVPRAŠEVANJE', 'IZMERA', 'KONFIGURACIJA', 'PONUDBA', 'POTRJENO',
  'REZERVIRANO', 'V_IZDELAVI', 'DOSTAVLJENO', 'MONTIRANO', 'PREDANO',
] as const

// ─── Razreševanje cen (issue #7 §6) ─────────────────────────────────────────

export interface ResolvedPrice {
  price: number
  source: 'PRICE_RULE' | 'FALLBACK' // PRICE_RULE = cenik; FALLBACK = osnovna cena izdelka/artikla
  priceListName?: string
  discountPct: number
}

/** Veljavno prodajno/nabavno/montažno pravilo za produkt (ali artikel) na dan. */
export async function resolvePrice (input: {
  type: 'NABAVNA' | 'PRODAJNA' | 'MONTAZA'
  productId?: string | null
  itemId?: string | null
  date?: Date
  /** skipDiscount ignorira popust (npr. za interni prikaz nabavne strani) */
  applyDiscount?: boolean
}): Promise<ResolvedPrice | null> {
  const now = input.date ?? new Date()
  const where: Prisma.PriceRuleWhereInput = {
    active: true,
    priceList: { active: true, type: input.type, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
    OR: [{ validTo: null }, { validTo: { gte: now } }],
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.itemId ? { itemId: input.itemId } : {}),
  }
  const rule = await db.priceRule.findFirst({ where, orderBy: { updatedAt: 'desc' }, include: { priceList: true } })
  if (!rule) return null
  let price = rule.price
  if (input.applyDiscount !== false && rule.discountPct > 0) {
    price = price * (1 - rule.discountPct / 100)
    if (rule.minPrice != null && price < rule.minPrice) price = rule.minPrice
  }
  return { price, source: 'PRICE_RULE', priceListName: rule.priceList.name, discountPct: rule.discountPct }
}

/** Prodajna cena izdelka (+ varianta override → cenik → osnovna cena produkta). */
export async function resolveSalePrice (product: { id: string; salePrice: number }, variant?: { salePrice: number | null } | null): Promise<ResolvedPrice> {
  const rule = await resolvePrice({ type: 'PRODAJNA', productId: product.id })
  if (rule) return rule
  if (variant?.salePrice != null) return { price: variant.salePrice, source: 'FALLBACK', discountPct: 0 }
  return { price: product.salePrice, source: 'FALLBACK', discountPct: 0 }
}

/** Nabavna cena artikla (cenik NABAVNA → zadnja MaterialPrice → 0). */
export async function resolveItemCost (item: { id: string }): Promise<ResolvedPrice> {
  const rule = await resolvePrice({ type: 'NABAVNA', itemId: item.id })
  if (rule) return rule
  const last = await db.materialPrice.findFirst({ where: { itemId: item.id }, orderBy: { createdAt: 'desc' } })
  if (last) return { price: last.price, source: 'FALLBACK', discountPct: 0 }
  return { price: 0, source: 'FALLBACK', discountPct: 0 }
}

/** Cena montaže za produkt (cenik MONTAZA → 0 = brez montaže). */
export async function resolveMontaza (productId: string): Promise<ResolvedPrice | null> {
  return resolvePrice({ type: 'MONTAZA', productId })
}

// ─── Generacija BOM (issue #7 §2: izključno eksplicitne ID povezave) ────────

export interface BomPlanLine {
  itemId: string
  sku: string
  name: string
  unit: string
  qty: number
  optional: boolean
  note: string | null
  /** nabavna cena na enoto artikla (veljavna iz cenika) */
  unitCost: number
  lineCost: number
  /** fizična zaloga artikla (P0: InventoryItem.qty; P1 bo ločil fizično/rezervirano/razpoložljivo) */
  stockQty: number
  /** pokritost: zaloga ≥ potrebna količina */
  covered: boolean
  missing: number
}

export interface BomPlan {
  product: { id: string; sku: string; name: string; unit: string }
  variant: { id: string; sku: string; name: string } | null
  qty: number
  unit: string
  lines: BomPlanLine[]
  materialCost: number // vsota stroškov vrstic
  salePriceUnit: number // prodajna cena na enoto
  montazaUnit: number // montaža na enoto
  totalSale: number // (prodajna + montaža) × qty
  totalCost: number // materialCost + (montazaUnits × nabavni delež ≈ 0) — strošek materiala
  margin: number // totalSale − materialCost
  marginPct: number // marža v %
  priceSource: string // od kod cena (cenik/fallback)
}

/**
 * Generira BOM načrt za produkt × količina — brez pisanja v bazo (dry-run za konfigurator).
 * Količine vrstic = predloga (ProductComponent.qty na enoto osnove) × količina.
 */
export async function planBom (input: {
  productId: string
  variantId?: string | null
  qty: number
  includeOptional?: boolean
}): Promise<BomPlan | { error: string }> {
  if (!Number.isFinite(input.qty) || input.qty <= 0) return { error: 'Količina mora biti pozitivno število.' }
  const product = await db.product.findUnique({
    where: { id: input.productId },
    include: { family: true },
  })
  if (!product || !product.active) return { error: 'Izdelek ne obstaja ali ni aktiven.' }
  let variant: { id: string; sku: string; name: string; salePrice: number | null } | null = null
  if (input.variantId) {
    const v = await db.productVariant.findUnique({ where: { id: input.variantId } })
    if (!v || v.productId !== product.id) return { error: 'Varianta ne pripada izdelku.' }
    variant = { id: v.id, sku: v.sku, name: v.name, salePrice: v.salePrice }
  }

  const comps = await db.productComponent.findMany({
    where: { productId: product.id, ...(input.includeOptional === false ? { optional: false } : {}) },
    orderBy: { sortOrder: 'asc' },
    include: { item: true },
  })

  const lines: BomPlanLine[] = []
  for (const c of comps) {
    const cost = await resolveItemCost(c.item)
    const qty = Math.round(c.qty * input.qty * 100) / 100
    const stockQty = c.item.qty
    lines.push({
      itemId: c.itemId, sku: c.item.sku, name: c.item.name, unit: c.item.unit,
      qty, optional: c.optional, note: c.note,
      unitCost: cost.price, lineCost: Math.round(cost.price * qty * 100) / 100,
      stockQty, covered: stockQty >= qty, missing: Math.max(0, Math.round((qty - stockQty) * 100) / 100),
    })
  }

  const materialCost = Math.round(lines.filter((l) => !l.optional || true).reduce((s, l) => s + l.lineCost, 0) * 100) / 100
  const sale = await resolveSalePrice(product, variant)
  const montaza = await resolveMontaza(product.id)
  const montazaUnit = montaza?.price ?? 0
  const totalSale = Math.round((sale.price + montazaUnit) * input.qty * 100) / 100
  const totalCost = materialCost
  const margin = Math.round((totalSale - totalCost) * 100) / 100
  const marginPct = totalSale > 0 ? Math.round((margin / totalSale) * 1000) / 10 : 0

  return {
    product: { id: product.id, sku: product.sku, name: product.name, unit: product.unit },
    variant: variant ? { id: variant.id, sku: variant.sku, name: variant.name } : null,
    qty: input.qty, unit: product.unit, lines,
    materialCost, salePriceUnit: sale.price, montazaUnit, totalSale, totalCost, margin, marginPct,
    priceSource: sale.source === 'PRICE_RULE' ? (sale.priceListName ?? 'cenik') : 'osnovna cena',
  }
}

// ─── Zaporedna koda (BOM-2026-###) ───────────────────────────────────────────

export async function nextBomCode (): Promise<string> {
  const year = new Date().getFullYear()
  const count = await db.bom.count({ where: { code: { startsWith: `BOM-${year}-` } } })
  let n = count + 1
  // preskoči zasedene kode (ob zgodovinskih vrzelih)
  for (let i = 0; i < 500; i++) {
    const code = `BOM-${year}-${String(n).padStart(3, '0')}`
    const exists = await db.bom.findUnique({ where: { code } })
    if (!exists) return code
    n++
  }
  return `BOM-${year}-${Date.now()}`
}

export async function nextPackageCode (projectCode: string): Promise<string> {
  const count = await db.projectPackage.count({ where: { code: { startsWith: `PAK-${projectCode}-` } } })
  let n = count + 1
  for (let i = 0; i < 500; i++) {
    const code = `PAK-${projectCode}-${n}`
    const exists = await db.projectPackage.findUnique({ where: { code } })
    if (!exists) return code
    n++
  }
  return `PAK-${projectCode}-${Date.now()}`
}

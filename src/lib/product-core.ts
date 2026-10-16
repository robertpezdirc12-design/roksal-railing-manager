// product-core — R442 (issue #7 P0 DATA CORE)
// Jedro produktnega modela: razreševanje cen iz cenikov + generacija BOM iz predlog.
// PRAVILA (issue #7 §2/§6/§15):
//  - BOM uporablja IZKLJUČNO eksplicitne ID povezave (productId → itemId) — nikoli imena;
//  - poslovne cene NISO hardcoded — vedno gredo skozi PriceList/PriceRule z veljavnostjo;
//  - vse funkcije vračajo struktirane rezultate (račun je razložljiv in revizijsko sledljiv).

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import {
  segmentLinesForComponent, SEGMENT_BOM_VERSION, SEGMENT_ROLES,
  POSTS_RULE_KEY, WASTE_RULE_KEY,
  type SegmentInput, type SegmentRole, type SegmentRules, type SegmentWarning,
} from '@/lib/segment-bom'

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
  // Decimal(12,2) → number na meji (izračun popusta ostaja številski, kot prej s Float)
  let price = rule.price.toNumber()
  if (input.applyDiscount !== false && rule.discountPct > 0) {
    price = price * (1 - rule.discountPct / 100)
    if (rule.minPrice != null && price < rule.minPrice.toNumber()) price = rule.minPrice.toNumber()
  }
  return { price, source: 'PRICE_RULE', priceListName: rule.priceList.name, discountPct: rule.discountPct }
}

/** Prodajna cena izdelka (+ varianta override → cenik → osnovna cena produkta). */
export async function resolveSalePrice (product: { id: string; salePrice: number | Prisma.Decimal }, variant?: { salePrice: number | null } | null): Promise<ResolvedPrice> {
  const rule = await resolvePrice({ type: 'PRODAJNA', productId: product.id })
  if (rule) return rule
  if (variant?.salePrice != null) return { price: variant.salePrice, source: 'FALLBACK', discountPct: 0 }
  return { price: typeof product.salePrice === 'number' ? product.salePrice : product.salePrice.toNumber(), source: 'FALLBACK', discountPct: 0 }
}

/** Nabavna cena artikla (cenik NABAVNA → zadnja MaterialPrice → 0). */
export async function resolveItemCost (item: { id: string }): Promise<ResolvedPrice> {
  const rule = await resolvePrice({ type: 'NABAVNA', itemId: item.id })
  if (rule) return rule
  const last = await db.materialPrice.findFirst({ where: { itemId: item.id }, orderBy: { createdAt: 'desc' } })
  if (last) return { price: last.price.toNumber(), source: 'FALLBACK', discountPct: 0 }
  return { price: 0, source: 'FALLBACK', discountPct: 0 }
}

/** Cena montaže za produkt (cenik MONTAZA → 0 = brez montaže). */
export async function resolveMontaza (productId: string): Promise<ResolvedPrice | null> {
  return resolvePrice({ type: 'MONTAZA', productId })
}

// ─── Konfigurator ograj — ocena cene (R464, issue #1 P0 §1) ─────────────────
// VIZ/3D konfigurator ocenjuje ceno iz geometrije (dolžina/višina/stebri/
// ročnik/steklo/montaža). Do R463 so bile cene hardcoded v viz-3d.tsx —
// zdaj ŽIVIJO IZKLJUČNO tukaj, v pricing core-u, kot PriceRule pravila:
//  - pravilo brez produkta/artikla (productId=null, itemId=null),
//  - note = "KONFIG:<KLJUČ>" (stroga konvencija ključa),
//  - price = vrednost, unit = fizična enota ('kos'|'m'|'m2'|'%').
// PRIPRAVA: price v % (npr. 15 → 15 %). PROFIL_OCENA: padec, če profil NI
// izbran (izbran profil vedno uporabi Profile.pricePerM iz kataloga).

export const KONFIG_PRICE_KEYS = [
  'STEBER', 'ROCNIK', 'STEKLO', 'MONTAZA', 'PRIPRAVA', 'PROFIL_OCENA',
] as const
export type KonfigPriceKey = (typeof KONFIG_PRICE_KEYS)[number]

export const konfigRuleNote = (key: KonfigPriceKey): string => `KONFIG:${key}`

/** Veljavno generično konfiguracijsko pravilo (KONFIG:<ključ>) v aktivnem PRODAJNA ceniku. */
export async function resolveKonfigRule (
  key: KonfigPriceKey,
  date?: Date,
): Promise<{ price: number; priceListName: string } | null> {
  const now = date ?? new Date()
  const rule = await db.priceRule.findFirst({
    where: {
      active: true,
      productId: null,
      itemId: null,
      note: konfigRuleNote(key),
      priceList: {
        active: true, type: 'PRODAJNA',
        validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
    orderBy: { updatedAt: 'desc' },
    include: { priceList: { select: { name: true } } },
  })
  if (!rule) return null
  return { price: rule.price.toNumber(), priceListName: rule.priceList.name }
}

export interface KonfigCenaPostavka {
  key: string
  label: string
  qty: number
  qtyUnit: string
  unitPrice: number
  total: number
}

export interface KonfigCenaVhod {
  tip: 'OGRAJA' | 'BALUSTRADA' | 'NAGIB'
  lengthCm: number
  heightCm: number
  posts: number
  handrail: boolean
  montaza: boolean
  profileId?: string | null
  colorLabel?: string
}

export interface KonfigCenaRezultat {
  postavke: KonfigCenaPostavka[]
  skupaj: number
  dolzinaM: number
  /** od kod cene (cenik / katalog profilov / delno brez pravil) */
  priceSource: string
  /** razrešene vrednosti KONFIG pravil (za prikaz v UI; PRIPRAVA kot ulomek) */
  unitPrices: Partial<Record<KonfigPriceKey, number>>
}

const TIP_SHORT_SRV: Record<KonfigCenaVhod['tip'], string> = {
  OGRAJA: 'ograja', BALUSTRADA: 'balustrada', NAGIB: 'stopniški nagib',
}

const fmtMSrv = (cm: number): string => {
  const m = cm / 100
  return m.toFixed(m % 1 === 0 ? 0 : 2).replace('.', ',')
}

/**
 * Izračun ocene cene konfiguracije ograje — IZKLJUČNO iz cenikov (PriceRule)
 * in kataloga profilov (Profile.pricePerM). Brez hardcoded poslovnih cen:
 * manjkajoče pravilo → postavka se IZPUSTI (cena je odgovornost cenika).
 */
export async function calcKonfigCena (v: KonfigCenaVhod): Promise<KonfigCenaRezultat> {
  const m = v.lengthCm / 100
  const postavke: KonfigCenaPostavka[] = []
  const unitPrices: Partial<Record<KonfigPriceKey, number>> = {}
  const color = v.colorLabel ?? ''

  // profil: izbran profil iz kataloga → Profile.pricePerM; sicer cenik (ocena)
  let profilCena: number | null = null
  let skuOznaka = 'Profil (ocena)'
  let izKataloga = false
  if (v.profileId) {
    const profile = await db.profile.findUnique({ where: { id: v.profileId } })
    if (profile) {
      profilCena = profile.pricePerM.toNumber()
      skuOznaka = profile.sku
      izKataloga = true
    }
  }
  if (profilCena == null) {
    const ocena = await resolveKonfigRule('PROFIL_OCENA')
    if (ocena) {
      profilCena = ocena.price
      unitPrices.PROFIL_OCENA = ocena.price
    }
  }
  if (profilCena != null) {
    postavke.push({
      key: 'profil',
      label: `${skuOznaka} — ${TIP_SHORT_SRV[v.tip]}, ${fmtMSrv(v.lengthCm)} m${color ? `, ${color}` : ''}`,
      qty: m, qtyUnit: 'm', unitPrice: profilCena, total: profilCena * m,
    })
  }

  // stebri × cenik
  const steber = await resolveKonfigRule('STEBER')
  if (steber) {
    unitPrices.STEBER = steber.price
    postavke.push({
      key: 'stebri',
      label: `Stebri ${v.posts} kos`,
      qty: v.posts, qtyUnit: 'kos', unitPrice: steber.price, total: steber.price * v.posts,
    })
  }

  // ročnik × m (izklop s toggle)
  if (v.handrail) {
    const rocnik = await resolveKonfigRule('ROCNIK')
    if (rocnik) {
      unitPrices.ROCNIK = rocnik.price
      postavke.push({
        key: 'rocnik',
        label: `Ročnik — ${fmtMSrv(v.lengthCm)} m${color ? ` (${color})` : ''}`,
        qty: m, qtyUnit: 'm', unitPrice: rocnik.price, total: rocnik.price * m,
      })
    }
  }

  // steklene plošče (samo balustrada) × m²
  if (v.tip === 'BALUSTRADA') {
    const steklo = await resolveKonfigRule('STEKLO')
    if (steklo) {
      unitPrices.STEKLO = steklo.price
      const povrsina = m * (v.heightCm / 100)
      postavke.push({
        key: 'steklo',
        label: `Steklene plošče — ${povrsina.toLocaleString('sl-SI', { maximumFractionDigits: 2 })} m²`,
        qty: povrsina, qtyUnit: 'm²', unitPrice: steklo.price, total: steklo.price * povrsina,
      })
    }
  }

  // priprava in rezerva — odstotek vmesne vsote (price v % → ulomek)
  const priprava = await resolveKonfigRule('PRIPRAVA')
  if (priprava) {
    const pct = Math.min(Math.max(priprava.price, 0), 100) / 100
    if (pct > 0) {
      unitPrices.PRIPRAVA = pct
      const sub = postavke.reduce((s, p) => s + p.total, 0)
      postavke.push({
        key: 'priprava',
        label: `Priprava in rezerva (${Math.round(pct * 100)} %)`,
        qty: 1, qtyUnit: 'kos', unitPrice: sub * pct, total: sub * pct,
      })
    }
  }

  // montaža × m (izklop s toggle)
  if (v.montaza) {
    const montaza = await resolveKonfigRule('MONTAZA')
    if (montaza) {
      unitPrices.MONTAZA = montaza.price
      postavke.push({
        key: 'montaza',
        label: `Montaža — ${fmtMSrv(v.lengthCm)} m`,
        qty: m, qtyUnit: 'm', unitPrice: montaza.price, total: montaza.price * m,
      })
    }
  }

  const rounded = postavke.map((p) => ({
    ...p,
    qty: Math.round(p.qty * 100) / 100,
    unitPrice: Math.round(p.unitPrice * 100) / 100,
    total: Math.round(p.total * 100) / 100,
  }))
  const skupaj = Math.round(rounded.reduce((s, p) => s + p.total, 0) * 100) / 100
  const nPravil = Object.keys(unitPrices).length
  const priceSource = izKataloga
    ? `katalog profilov + cenik (${nPravil} pravil)`
    : nPravil > 0
      ? `cenik (${nPravil} pravil)`
      : 'brez veljavnih pravil'

  return { postavke: rounded, skupaj, dolzinaM: m, priceSource, unitPrices }
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
  // ── R475 (issue #9 §5 — količine iz segmentov) ──
  /** vezava vrstice na segment verige (seg-N) — null za pripadnosti */
  segmentKey: string | null
  /** skupina pozicij (STEBRI | ROCNIK | POLNILO | OSTALO) */
  group: string | null
  /** upoštevani odpad rezanja (%) — vir: pravilo odpad_rez_pct */
  wastePct: number | null
  /** ključ pravila/vnosa iz katerega je količina izpeljana */
  sourceRule: string | null
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
  // ── R475 (issue #9 §5): segmentni režim ──
  /** št. segmentov, iz katerih so količine izpeljane (0 = predloga × qty) */
  segmentsApplied: number
  /** opozorila segmentne izpeljave (vidna v UI, zapisana v kalkulacijo) */
  warnings: SegmentWarning[]
  /** verzija segmentne matematike (segment-bom/1.0) ko je aktivna */
  segmentEngine: string | null
}

/** Prebere pravila za segmentno matematiko (razmik + odpad). */
async function resolveSegmentRules (spacingCm: number | null): Promise<SegmentRules> {
  const rows = await db.engineeringRule.findMany({
    where: { active: true, key: { in: [POSTS_RULE_KEY, WASTE_RULE_KEY] } },
  })
  const posts = rows.find((r) => r.key === POSTS_RULE_KEY)
  const waste = rows.find((r) => r.key === WASTE_RULE_KEY)
  return {
    spacingCm: spacingCm ?? (posts ? posts.value : null),
    spacingSource: spacingCm != null ? 'vnos:razmik' : (posts ? `RULE:${POSTS_RULE_KEY}` : null),
    wastePct: waste ? waste.value : 0,
    wasteSource: waste ? `RULE:${WASTE_RULE_KEY}` : null,
  }
}

/**
 * Generira BOM načrt za produkt × količina — brez pisanja v bazo (dry-run za konfigurator).
 * Količine vrstic = predloga (ProductComponent.qty na enoto osnove) × količina.
 *
 * R475 (issue #9 §5 — KOLIČINE IZ SEGMENTOV): če `segments` so podani IN komponenta
 * ima segmentRole, se količina izračuna PO SEGMENTU (stebri iz razmika, dolžine/
 * ploščine z odpadom) — vrstice nosijo segmentKey/skupino/vir pravila.
 */
export async function planBom (input: {
  productId: string
  variantId?: string | null
  qty: number
  includeOptional?: boolean
  /** R475: segmenti verige (ključi seg-N, dolžine v cm) */
  segments?: SegmentInput[]
  /** R475: razmik stebrov v cm iz VNOSa uporabnika (imeL pred pravilom) */
  spacingCm?: number | null
}): Promise<BomPlan | { error: string }> {
  if (!Number.isFinite(input.qty) || input.qty <= 0) return { error: 'Količina mora biti pozitivno število.' }
  const segments = (input.segments ?? []).filter((s) => Number.isFinite(s.lengthCm) && s.lengthCm > 0)
  const useSegments = segments.length > 0
  const product = await db.product.findUnique({
    where: { id: input.productId },
    include: { family: true },
  })
  if (!product || !product.active) return { error: 'Izdelek ne obstaja ali ni aktiven.' }
  let variant: { id: string; sku: string; name: string; salePrice: number | null } | null = null
  if (input.variantId) {
    const v = await db.productVariant.findUnique({ where: { id: input.variantId } })
    if (!v || v.productId !== product.id) return { error: 'Varianta ne pripada izdelku.' }
    variant = { id: v.id, sku: v.sku, name: v.name, salePrice: v.salePrice == null ? null : v.salePrice.toNumber() }
  }

  const comps = await db.productComponent.findMany({
    where: { productId: product.id, ...(input.includeOptional === false ? { optional: false } : {}) },
    orderBy: { sortOrder: 'asc' },
    include: { item: true },
  })

  // R475: pravila segmentne matematike preberemo SAMO kadar so segmenti podani
  const segRules = useSegments ? await resolveSegmentRules(input.spacingCm ?? null) : null
  const warnings: SegmentWarning[] = []

  const lines: BomPlanLine[] = []
  for (const c of comps) {
    const cost = await resolveItemCost(c.item)
    const stockQty = c.item.qty
    const validRole = c.segmentRole != null && (SEGMENT_ROLES as readonly string[]).includes(c.segmentRole)
    const hasRole = useSegments && validRole

    if (useSegments && c.segmentRole != null && !validRole) {
      // POŠTENO: neznana vloga se ne tiho ignorira — vidno opozorilo + predloga
      warnings.push({
        code: 'NEZNANA_VLOGA',
        message: `Komponenta ${c.item.sku} ima neznano segmentno vlogo „${c.segmentRole}“ — uporabljena je predloga × količina.`,
      })
    }

    if (hasRole) {
      // ── R475: količina PO SEGMENTU (stebri/ročnik/polnilo + odpad) ──
      const { lines: segLines, warnings: segWarn } = segmentLinesForComponent(
        c.segmentRole as SegmentRole, c.qty, segments, segRules as SegmentRules,
      )
      warnings.push(...segWarn)
      for (const sl of segLines) {
        lines.push({
          itemId: c.itemId, sku: c.item.sku, name: c.item.name, unit: c.item.unit,
          qty: sl.qty, optional: c.optional,
          note: [c.note, sl.note].filter(Boolean).join(' — ') || null,
          unitCost: cost.price, lineCost: Math.round(cost.price * sl.qty * 100) / 100,
          stockQty, covered: stockQty >= sl.qty, missing: Math.max(0, Math.round((sl.qty - stockQty) * 100) / 100),
          segmentKey: sl.segmentKey, group: sl.group, wastePct: sl.wastePct, sourceRule: sl.sourceRule,
        })
      }
      continue
    }

    // ── predloga × skupna količina (obnašanje do R474) ──
    const qty = Math.round(c.qty * input.qty * 100) / 100
    lines.push({
      itemId: c.itemId, sku: c.item.sku, name: c.item.name, unit: c.item.unit,
      qty, optional: c.optional, note: c.note,
      unitCost: cost.price, lineCost: Math.round(cost.price * qty * 100) / 100,
      stockQty, covered: stockQty >= qty, missing: Math.max(0, Math.round((qty - stockQty) * 100) / 100),
      segmentKey: null,
      group: useSegments ? 'OSTALO' : null, // pripadnosti brez vloge — skupina samo v segmentnem režimu
      wastePct: null, sourceRule: null,
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
    segmentsApplied: segments.length,
    warnings,
    segmentEngine: useSegments ? SEGMENT_BOM_VERSION : null,
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

/**
 * Zaporedna koda PAK-<projekt>-<n> NA PODANEM klientu (R539 — transakcijska
 * celovitost): ista logika kot nextPackageCode, a teče ZNOTRAJ poslovne
 * transakcije (tx) — ob sočasnem P2002 (dva handoffa si izračunata isto
 * kodo) ZUNANJA retryOnUnique okoli CELE transakcije ponovi tudi izračun
 * kode (vzorec R535/R536 — read-then-create dirka je s tem zaprta).
 */
export async function nextPackageCodeOn (
  client: Pick<Prisma.TransactionClient, 'projectPackage'>,
  projectCode: string
): Promise<string> {
  const count = await client.projectPackage.count({ where: { code: { startsWith: `PAK-${projectCode}-` } } })
  let n = count + 1
  for (let i = 0; i < 500; i++) {
    const code = `PAK-${projectCode}-${n}`
    const exists = await client.projectPackage.findUnique({ where: { code } })
    if (!exists) return code
    n++
  }
  return `PAK-${projectCode}-${Date.now()}`
}

/** R539: wrapper na globalnem db — obstoječi klici (npr. handoff
 *  /api/measurement/confirm) ostanejo nespremenjeni; znotraj transakcije
 *  uporabi nextPackageCodeOn(tx, …). */
export async function nextPackageCode (projectCode: string): Promise<string> {
  return nextPackageCodeOn(db, projectCode)
}

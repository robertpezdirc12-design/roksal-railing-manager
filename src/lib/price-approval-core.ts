// src/lib/price-approval-core.ts — R564 (issue #24): VIR CEN PONUDBE.
//
// Načelo (issue #24): tehnično delujoč cenovni engine ŠE NE pomeni, da so v
// sistemu poslovno odobrene ROKSAL cene. Demo/tehnične vrednosti se NE smejo
// tiho pretvoriti v zavezujočo ponudbo ali proizvodni nalog.
//
// Ta modul je ČIST (brez Prisme/next — enako testirljiv kot quote-core):
//  • PriceList.status: DEMO (seed/import tehnične vrednosti) | DRAFT |
//    PENDING_APPROVAL | APPROVED (izrecna odobritev, kdo/kdaj/vir).
//  • preveriCeneVrstic: za VSAKO vrstico ponudbe poskusi najti pravilo iz
//    cenika, ki (a) po SKU/kodi produkta/artikla ustreza opisu vrstice IN
//    (b) se njegova efektivna cena (cena − popust pravila) ujema z unitPrice
//    vrstice (± 0,01). Brez ujemanja NE ugiba — vrstica je NEPREVERJENA.
//  • Rezultat Quote.priceCheck: APPROVED (vse vrstice iz odobrenih cenikov)
//    | DEMO (vsaj ena vrstica ima vir, a cenik ni odobren) | NEPREVERJENO
//    (vsaj ena vrstica brez razpoznavnega vira cene).
//  • sestaviSnapshot: zapiše različice cenikov, vezavo vrstica→pravilo,
//    DDV in popust — poznejša sprememba cenika ne spremeni stare ponudbe.
//
// POŠTENOST: ujemanje po opisu je HEVRISTIKA (žeton SKU/kode v opisu) — če
// se ne najde ujemanje, je to izrecno NEPREVERJENO, ne napaka niti tiha
// privzeta cena. Ujemanje po ceni samo (brez SKU) NI dovoljeno (preveč
// lažnih pozitivk — dve različni produktu z enako ceno).

export const PRICE_APPROVAL_CORE_VERSION = 'price-approval-core/1.0'

/** Dovoljeni statusi življenjskega cikla cenika (issue #24 točka 3). */
export const PRICE_LIST_STATUSI = ['DEMO', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED'] as const
export type PriceListStatus = (typeof PRICE_LIST_STATUSI)[number]

export function jePriceListStatus (v: unknown): v is PriceListStatus {
  return typeof v === 'string' && (PRICE_LIST_STATUSI as readonly string[]).includes(v)
}

/** Zbirka rezultatov preverjanja ponudbe. */
export type QuotePriceCheck = 'NEPREVERJENO' | 'DEMO' | 'APPROVED'

/** Vrstica ponudbe, kot jo preverjamo (iz QuoteLine). */
export interface VrsticaZaPreverjanje {
  description: string
  qty: number
  unitPrice: number
}

/** Pravilo cenika s kontekstom seznama (iz PoB poizvedbe). */
export interface PraviloZaUjemanje {
  ruleId: string
  price: number
  discountPct: number
  /** SKU ali koda produkta/artikla, na katerega se pravilo nanaša (null = splošno). */
  sku: string | null
  priceListId: string
  priceListName: string
  priceListVersion: number
  priceListStatus: string
}

/** Izid preverjanja ene vrstice. */
export interface VrsticaIzid {
  description: string
  unitPrice: number
  /** null = brez razpoznavnega vira (NEPREVERJENA vrstica). */
  matchedRuleId: string | null
  priceListId: string | null
  priceListName: string | null
  priceListVersion: number | null
  priceListStatus: string | null
}

export interface PreveritevIzid {
  check: QuotePriceCheck
  lines: VrsticaIzid[]
  /** Različice vseh cenikov, ki so se pojavile v ujemanjih (za snapshot). */
  lists: Array<{ id: string; name: string; version: number; status: string }>
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Efektivna cena pravila po popustu pravila (ne popusta ponudbe). */
export function efektivnaCena (r: Pick<PraviloZaUjemanje, 'price' | 'discountPct'>): number {
  return round2(r.price * (1 - (r.discountPct ?? 0) / 100))
}

/** Ali žeton SKU/kode stoji kot beseda v opisu vrstice (velike/male ne štejejo). */
export function skuVOpisu (description: string, sku: string | null): boolean {
  if (!sku || sku.length < 2) return false
  const esc = sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, 'i').test(description)
}

/**
 * Preveri vse vrstice ponudbe proti pravilom cenikov.
 * Ujemanje = SKU v opisu IN enaka efektivna cena (± 0,01). Med več ujemanji
 * IMETA prednost odobreni ceniki (seznam je razvrščen: APPROVED prvi).
 */
export function preveriCeneVrstic (lines: VrsticaZaPreverjanje[], rules: PraviloZaUjemanje[]): PreveritevIzid {
  const poOdobritvi = [...rules].sort((a, b) => {
    const ao = a.priceListStatus === 'APPROVED' ? 0 : 1
    const bo = b.priceListStatus === 'APPROVED' ? 0 : 1
    return ao - bo
  })

  const izidi: VrsticaIzid[] = lines.map((l) => {
    const match = poOdobritvi.find(
      (r) => skuVOpisu(l.description, r.sku) && Math.abs(efektivnaCena(r) - l.unitPrice) <= 0.011
    )
    return {
      description: l.description,
      unitPrice: l.unitPrice,
      matchedRuleId: match?.ruleId ?? null,
      priceListId: match?.priceListId ?? null,
      priceListName: match?.priceListName ?? null,
      priceListVersion: match?.priceListVersion ?? null,
      priceListStatus: match?.priceListStatus ?? null,
    }
  })

  const listsMap = new Map<string, { id: string; name: string; version: number; status: string }>()
  for (const i of izidi) {
    if (i.priceListId) {
      listsMap.set(i.priceListId, { id: i.priceListId, name: i.priceListName ?? '', version: i.priceListVersion ?? 1, status: i.priceListStatus ?? '' })
    }
  }

  let check: QuotePriceCheck = 'APPROVED'
  if (izidi.length === 0 || izidi.some((i) => !i.matchedRuleId)) check = 'NEPREVERJENO'
  else if (izidi.some((i) => i.priceListStatus !== 'APPROVED')) check = 'DEMO'

  return { check, lines: izidi, lists: [...listsMap.values()] }
}

/** Snapshot cen ponudbe (issue #24 točka 5) — shranjen ob izdelavi ponudbe. */
export interface PriceSnapshot {
  engine: string
  checkedAt: string // ISO
  vatRate: number
  discountPct: number | null
  check: QuotePriceCheck
  lists: Array<{ id: string; name: string; version: number; status: string }>
  lines: VrsticaIzid[]
}

export function sestaviSnapshot (
  izid: PreveritevIzid,
  opts: { vatRate: number; discountPct: number | null }
): PriceSnapshot {
  return {
    engine: PRICE_APPROVAL_CORE_VERSION,
    checkedAt: new Date().toISOString(),
    vatRate: opts.vatRate,
    discountPct: opts.discountPct,
    check: izid.check,
    lists: izid.lists,
    lines: izid.lines,
  }
}

/** Človeško berljiva oznaka stanja za UI/PDF. */
export function priceCheckOznaka (check: string): string {
  switch (check) {
    case 'APPROVED': return 'cene iz odobrenega cenika'
    case 'DEMO': return 'okvirna ponudba — demo/neodobrene cene'
    default: return 'cene brez potrditve vira (okvirno)'
  }
}

// viz-core — ROKSAL JAVNI VIZUALIZATOR (R480 — issue #9 §10)
// ČIST lib: NIČ strežniških/db uvozov (vzorec pin-core.ts) — uporaben na
// odjemalcu (javna stran /v/[token]) in strežniku (API rute).
//
// GDPR soglasje se NE podvaja: consentStatus/photosBlockedReason sta v
// pin-core (R479) — uvoz med čistima liboma je dovoljen, en vir resnice.
//
// JAVNA VARNOST (§10: „stranka ne more urejati internih cen, zaloge,
// proizvodnih pravil ali drugih projektov"):
//  • publicVizVisualization() je EDINA dovoljena oblika variante na javni
//    poti — BREZ note pisarne (past #4), BREZ renderParams (vhod engine-a:
//    quad + referenca), BREZ avtorja, BREZ statusa (IZBRANA = izbira
//    PISARNE), BREZ cen (costPrice/salePrice so kanal ponudbe, ne vizualizacije);
//  • fotografije (sourcePhoto + rendered) grejo ven SAMO, če je strežniška
//    ruta izračunala photosAllowed (consentStatus === 'VELJAVNO') — v obeh
//    blobih je hiša stranke (past #5);
//  • choiceSummary() je javni povzetek izbora — brez kontakta in leadId.
//
// APPEND-ONLY (§10: „pisarna ne prepisuje podatkov"): izbire so dnevnik —
// NI PATCH/DELETE API-ja; „urejanja" so nova vrstica; zadnji zapis na
// projektu = trenutni izbor.

import { consentStatus, photosBlockedReason } from './pin-core'
import type { ConsentStatus, PhotosBlockedReason } from './pin-core'
import { asJsonObject, asJsonObjectLoose } from './json'

// re-izvoz za enovit uvoz iz viz-core (rute/javna stran ne rabita poznati pin-core)
export { consentStatus, photosBlockedReason }
export type { ConsentStatus, PhotosBlockedReason }

// ─── Žeton javne povezave vizualizatorja ────────────────────────────────────

export const VIZ_TOKEN_PREFIX = 'pv-'
export const VIZ_TOKEN_MIN = 8
export const VIZ_TOKEN_MAX = 80

/** Privzeti rok javne povezave vizualizatorja (dni) + meji. */
export const VIZ_LINK_MIN_DAYS = 1
export const VIZ_LINK_MAX_DAYS = 90
export const VIZ_LINK_DEFAULT_DAYS = 14

// ─── Zahteve stranke (izbor spremstva ob izbiri variante) ───────────────────

export const VIZ_REQUEST_TYPES = ['PONUDBA', 'OGLED', 'IZMERA'] as const
export type VizRequestType = (typeof VIZ_REQUEST_TYPES)[number]

export const VIZ_REQUEST_TYPE_LABELS: Record<VizRequestType, string> = {
  PONUDBA: 'Zahtevam ponudbo',
  OGLED: 'Zahtevam ogled objekta',
  IZMERA: 'Zahtevam izmero na terenu',
}

/** Razčleni vrsto zahteve stranke (PONUDBA | OGLED | IZMERA); smeti → null. */
export function parseVizRequestType (v: unknown): VizRequestType | null {
  return typeof v === 'string' && (VIZ_REQUEST_TYPES as readonly string[]).includes(v)
    ? v as VizRequestType
    : null
}

// ─── Oznake variant (A|B|C — enako kot photo-replace-core) ──────────────────

export const VIZ_VARIANT_LABELS = ['A', 'B', 'C'] as const

export function isVizVariantLabel (v: unknown): v is string {
  return typeof v === 'string' && (VIZ_VARIANT_LABELS as readonly string[]).includes(v)
}

// ─── configSummary — JAVNI del renderParams ─────────────────────────────────
// renderParams = { quad, reference, config }: quad (4 točke na fotografiji) in
// reference (merilo) sta INTERNI vhod engine-a — ne gresta na javno pot.
// config je javna konfiguracija ograje (dimenzije + tip), kot jo vidi stranka.

export interface VizConfigSummary {
  tip: string // POKOCNA | PRECNA | STEKLO
  lengthCm: number
  heightCm: number
  posts: number
  handrail: boolean
  pritrditev: string // TALNA | STEBRI_V_BETON | BOCNA_NA_STENO
  lamelaMm?: number
  rezaMm?: number
  deskaMm?: number
}

const CONFIG_NUM_MAX = 100000

/** Varno izlušči JAVNI del renderParams (config); smeti/napake → null.
 *  R542: renderParams je jsonb objekt (testni mostič r480 pošilja JSON niz —
 *  asJsonObjectLoose sprejme oboje). */
export function vizConfigSummary (renderParams: unknown): VizConfigSummary | null {
  const parsed = asJsonObjectLoose(renderParams)
  if (!parsed) return null
  const cfg = asJsonObject(parsed.config)
  if (!cfg) return null
  const c = cfg
  const num = (v: unknown): number | undefined => {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > CONFIG_NUM_MAX) return undefined
    return v
  }
  const summary: VizConfigSummary = {
    tip: typeof c.tip === 'string' ? c.tip : '',
    lengthCm: num(c.lengthCm) ?? 0,
    heightCm: num(c.heightCm) ?? 0,
    posts: num(c.posts) ?? 0,
    handrail: c.handrail === true,
    pritrditev: typeof c.pritrditev === 'string' ? c.pritrditev : '',
    ...(num(c.lamelaMm) != null ? { lamelaMm: num(c.lamelaMm) as number } : {}),
    ...(num(c.rezaMm) != null ? { rezaMm: num(c.rezaMm) as number } : {}),
    ...(num(c.deskaMm) != null ? { deskaMm: num(c.deskaMm) as number } : {}),
  }
  return summary
}

// ─── publicVizVisualization — projekcija za JAVNO pot (žeton) ────────────────

export interface PublicVizVisualization {
  id: string
  variantLabel: string
  product: { sku: string; name: string } | null
  variant: { sku: string; name: string; ral: string | null } | null
  configSummary: VizConfigSummary | null
  /** PREJ — originalna fotografija (data URL); SAMO ob veljavnem soglasju. */
  sourcePhoto: string | null
  /** POTEM — izrisana sličica z žigom (data URL); SAMO ob veljavnem soglasju. */
  rendered: string | null
  updatedAt: string
}

/**
 * Projekcija variante za javni žeton: BREZ note pisarne, BREZ renderParams
 * (samo javni configSummary), BREZ avtorja, BREZ statusa, BREZ cen, BREZ
 * verzij. Sliki (sourcePhoto + rendered) izda SAMO ob photosAllowed (veljavno
 * GDPR soglasje na projektu — odloči strežniška ruta, ne lib).
 */
export function publicVizVisualization (
  v: {
    id: string
    variantLabel: string
    renderParams?: unknown
    sourcePhoto?: string | null
    rendered?: string | null
    updatedAt?: Date | string
    product?: { sku: string; name: string } | null
    variant?: { sku: string; name: string; ral: string | null } | null
  },
  photosAllowed: boolean
): PublicVizVisualization {
  const iso = (d: Date | string | undefined): string =>
    d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : new Date(0).toISOString()
  return {
    id: v.id,
    variantLabel: v.variantLabel,
    product: v.product ?? null,
    variant: v.variant ?? null,
    configSummary: vizConfigSummary(v.renderParams),
    sourcePhoto: photosAllowed ? (v.sourcePhoto ?? null) : null,
    rendered: photosAllowed ? (v.rendered ?? null) : null,
    updatedAt: iso(v.updatedAt),
  }
}

// ─── choiceSummary — javni povzetek izbora ──────────────────────────────────

export interface ChoiceSummary {
  id: string
  variantLabel: string
  chosenAt: string
  chosenVia: string
  requestType: string
  requestTypeLabel: string
  note: string | null
  consentAcceptedAt: string
  createdAt: string
}

/**
 * Javni povzetek strankinega izbora (potrdilo po oddaji + „Vaš izbor" na javni
 * strani). BREZ kontakta in leadId — to sta interni podatka (pisarna ju vidi
 * prek /api/projects/[id]/viz-choices).
 */
export function choiceSummary (c: {
  id: string
  variantLabel: string
  chosenAt: Date | string
  chosenVia: string
  requestType: string
  note?: string | null
  consentAcceptedAt: Date | string
  createdAt?: Date | string
}): ChoiceSummary {
  const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString())
  return {
    id: c.id,
    variantLabel: c.variantLabel,
    chosenAt: iso(c.chosenAt),
    chosenVia: c.chosenVia,
    requestType: c.requestType,
    requestTypeLabel: parseVizRequestType(c.requestType)
      ? VIZ_REQUEST_TYPE_LABELS[c.requestType as VizRequestType]
      : c.requestType,
    note: c.note ?? null,
    consentAcceptedAt: iso(c.consentAcceptedAt),
    createdAt: iso(c.createdAt ?? c.chosenAt),
  }
}

// ─── Validacija javnega vnosa izbire ────────────────────────────────────────

export const VIZ_CHOICE_NOTE_MAX = 500
export const VIZ_CONTACT_MAX = 200
export const VIZ_PHONE_MAX = 40

export interface VizChoiceInput {
  visualizationId: string
  variantLabel: string
  requestType: VizRequestType
  note: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
}

const CUID_RE = /^c[0-9a-z]{19,31}$/

/**
 * Validira telo POST /api/public/viz-choice:
 *  • visualizationId — neprazen niz (cuid oblika; obstojnost preveri ruta);
 *  • variantLabel — A | B | C (mora se ujemati z vizualizacijo — preveri ruta);
 *  • requestType — PONUDBA | OGLED | IZMERA (obvezen „način zahteve");
 *  • note — ≤ 500 znakov (strankino sporočilo);
 *  • kontakti — prosti formati, a omejene dolžine (ime/e-pošta ≤ 200, telefon ≤ 40);
 *  • consentAccepted — OBVEZNO true (GDPR obvestilo o obdelavi, sicer 400).
 */
export function validVizChoiceInput (v: unknown): { ok: true; value: VizChoiceInput } | { ok: false; napaka: string } {
  if (typeof v !== 'object' || v === null) return { ok: false, napaka: 'Manjka telo zahteve.' }
  const o = v as Record<string, unknown>

  if (o.consentAccepted !== true) {
    return { ok: false, napaka: 'Potrditi morate obvestilo o obdelavi podatkov (consentAccepted: true).' }
  }

  if (typeof o.visualizationId !== 'string' || !CUID_RE.test(o.visualizationId)) {
    return { ok: false, napaka: 'Manjka ali neveljavna vizualizacija (visualizationId).' }
  }

  if (!isVizVariantLabel(o.variantLabel)) {
    return { ok: false, napaka: 'Oznaka variante mora biti A, B ali C.' }
  }

  const requestType = parseVizRequestType(o.requestType)
  if (!requestType) {
    return { ok: false, napaka: 'Vrsta zahteve mora biti PONUDBA, OGLED ali IZMERA.' }
  }

  const str = (val: unknown, max: number, polje: string): { v: string | null } | { napaka: string } => {
    if (val == null) return { v: null }
    if (typeof val !== 'string') return { napaka: `Polje ${polje} mora biti niz.` }
    const s = val.trim()
    if (!s) return { v: null }
    if (s.length > max) return { napaka: `Polje ${polje} presega dovoljenih ${max} znakov.` }
    return { v: s }
  }

  const fields: Array<[keyof VizChoiceInput, unknown, number]> = [
    ['note', o.note, VIZ_CHOICE_NOTE_MAX],
    ['contactName', o.contactName, VIZ_CONTACT_MAX],
    ['contactPhone', o.contactPhone, VIZ_PHONE_MAX],
    ['contactEmail', o.contactEmail, VIZ_CONTACT_MAX],
  ]
  const cleaned: Partial<Record<keyof VizChoiceInput, string | null>> = {}
  for (const [polje, val, max] of fields) {
    const r = str(val, max, polje)
    if ('napaka' in r) return { ok: false, napaka: r.napaka }
    cleaned[polje] = r.v
  }

  // telefon/e-pošta: prosti format (stranka lahko pusti kdorkoli) — samo dolžina
  return {
    ok: true,
    value: {
      visualizationId: o.visualizationId,
      variantLabel: o.variantLabel,
      requestType,
      note: cleaned.note ?? null,
      contactName: cleaned.contactName ?? null,
      contactPhone: cleaned.contactPhone ?? null,
      contactEmail: cleaned.contactEmail ?? null,
    },
  }
}

// tipi.ts — skupni tipi in konstante modula Foto vizualizacija (R537-c: čisto
// razbitje foto-replace.tsx v podmapo, brez sprememb obnašanja). Čisti TS brez
// komponent/hookov — BREZ 'use client'. Uporabniki: foto-replace.tsx (vstop) +
// vsi deli v tej podmapi.

import type { useToast } from '@/hooks/use-toast'
import type { NacinPritrditve, Opozorilo, RenderParams, TipPolnila, Tocka } from '@/lib/photo-replace-core'
import type { Maska, Oblika } from '@/lib/photo-replace-mask'

export const VARIANT_LABELS = ['A', 'B', 'C'] as const
export type VariantLabel = (typeof VARIANT_LABELS)[number]

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface ProjectRow { id: string; code: string; title: string; status: string; customer: { name: string; city: string | null } | null }
export interface VariantRow { id: string; sku: string; name: string; color: string | null; ral: string | null }
export interface ProductRow {
  id: string; sku: string; name: string; unit: string; tech: Record<string, unknown> | null // R542: jsonb
  family: { code: string; name: string }
  variants: VariantRow[]
}
export interface MeasurementRow {
  id: string; type: string; location: string | null; lengthCm: number | null; heightCm: number | null
  posts: number | null; params: Record<string, unknown> | null; createdAt: string // R542: jsonb
}
export interface SavedVizRow {
  id: string; variantLabel: string; status: string; note: string | null
  measurementId: string | null; measurementVersion: number | null
  productId: string; variantId: string | null; engineVersion: string
  createdAt: string; updatedAt: string
  author: { name: string; role: string } | null
  product: { sku: string; name: string } | null
  variant: { sku: string; name: string; ral: string | null } | null
  _count: { versions: number }
}

/** Stanje ene variante (zavihek A/B/C) — delovno + savedId po shranjevanju. */
export interface SlotState {
  quad: Tocka[]
  /** R507 §1: lastna maska — oblike namesto kvada, izpusti in prednji plan. */
  maskaOgraja: Oblika[]
  maskaIzpusti: Oblika[]
  maskaPrednji: Oblika[]
  refTip: 'MERITEV' | 'ROCNO'
  measurementId: string
  refCmS: string
  refOpis: string
  productId: string
  variantId: string
  tip: TipPolnila
  pritrditev: NacinPritrditve
  lengthCmS: string
  heightCmS: string
  postsS: string
  handrail: boolean
  lamelaMmS: string
  rezaMmS: string
  deskaMmS: string
  vijaki: boolean
  note: string
  savedId: string | null
  /** R536: seme izrisa (uint32) — generirano ob nastanku, shranjeno V
   *  renderParams; null = zapis BREZ semena (odprt stari zapis) → izris izpelje
   *  iz savedId (bajtno identično prejšnjemu vedenju). */
  seme: number | null
  /** R510: meritev tipa FOTO, iz katere izvira trenutna fotografija (null = naložena datoteka). */
  photoSourceId: string | null
}

/** Katero vrsto oblike maska-trenutno rišemo (3. korak). */
export type MaskaVrsta = 'ograja' | 'izpust' | 'prednji'

/** ProductAsset vrstica iz /api/product-assets (samo polja, ki jih potrebuje izbira gradiva). */
export interface AssetRow {
  id: string; kind: string; orientation: string | null; view: string | null
  colorName: string | null; variantSku: string | null; productId: string | null
  filePath: string | null; sha256: string | null; status: string
  permission: string; sourceName: string
}

/** Dokazna veriga izvedene slike (R510) — kar je ob shranjevanju POTRDIL strežnik. */
export interface DokazVeriga {
  meritev: { status: string; verzija: number | null } | null
  izvirnikFotografije: string | null
  gradivo: { assetId: string; kind: string; pot: string; sha256: string } | null
  gradivoRazlog: string | null
}

/** Stanje maske za izris (memo maskaStanje): veljavna maska ali padec na kvad + napake preverbe. */
export interface MaskaStanje { maska: Maska | null; napake: string[] }

/** Foto-dokaz meritve (m) + njegov data URL fotografije — memo fotoMeasurements. */
export interface FotoMeasurement { m: MeasurementRow; foto: string | null }

/** GET /api/photo-visualization/[id] → data: polja, ki jih potrebujeta odpri() (vstop) in slotIzZapisa() (stanje.ts). */
export interface OdpriZapis {
  id: string; variantLabel: string; status: string; sourcePhoto: string
  renderParams: Record<string, unknown>; measurementId: string | null; note: string | null // R542: jsonb
  sourcePhotoId: string | null
  productId: string; variantId: string | null
  product: { id: string; sku: string; name: string; tech: Record<string, unknown> | null; family: { code: string } } // R542: tech jsonb
  opozorila: Opozorilo[]
  dokaz: DokazVeriga | null
}

/** renderParams shranjene vizualizacije (R542: jsonb objekt) — delno zaupanja vreden vhod (stari zapisi imajo manjkajoča polja). */
export interface ParsedRenderParams {
  quad?: Tocka[]; reference?: { tip?: string; cm?: number; opis?: string }; config?: Record<string, unknown>
  maska?: { ograja?: Tocka[][]; izpusti?: Tocka[][]; prednji?: Tocka[][] }
  seme?: unknown
}

/** toast iz useToast() — podpis, ki ga sprejemajo hooki in akcije tega modula. */
export type ToastFn = ReturnType<typeof useToast>['toast']

/** Podpis skupnega izrisa POTEM (drawPotem iz primerjava.tsx) — isti klic poganja predogled, primerjavo in izvoze. */
export type DrawPotemFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  p: RenderParams,
  opts: { meja?: number; zig?: boolean; ghostAlpha?: number; seme: number },
) => Opozorilo[]

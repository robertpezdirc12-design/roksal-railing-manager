// MERITVE S KAMERO — skupni tipi in konstante vseh delov modula.
// R537-a: razbitje meritve-kamera.tsx (issue #1, R439/R455/R457/R506) —
// izhodiščne glave posameznih delov selijo skupaj s kodo, ki jo
// dokumentirajo; ta datoteka nosi samo skupno pogodbo.
// Namerno BREZ 'use client': so tipi/konstante, ki jih delijo .tsx deli
// in čisti .ts pomožniki.

import type { useToast } from '@/hooks/use-toast'
import type { OrientationStatus } from '@/lib/exif-orientation'

/** Funkcija `toast` iz useToast() — stabilna identiteta (modulska funkcija),
 *  zato jo dele prek propsov/argumentov varno sprejema isti primerek. */
export type ToastFn = ReturnType<typeof useToast>['toast']

export interface Pt { x: number; y: number; label?: string; src?: 'ROCNO' | 'PREDLOG' }
export interface PhotoRow {
  id: string; type: string; location: string | null; params: string | null; createdAt: string
  project: { code: string } | null
}
export interface ProjectOption { id: string; code: string; title: string }
export interface WorkOrderOption { id: string; code: string; title: string }
// R439: predpomnjena vrstica naloga (offline izbor v kameri)
export interface CachedWoRow { id: string; code: string; title: string }

/** R455: kakovost zajema — izračun na odjemalcu (advisory, §2/§4). */
export interface Quality {
  brightness: number // povprečna svetlost 0..255
  blurScore: number // variacija Laplace-ovega jedra (višje = ostreje)
  dark: boolean
  bright: boolean
  blurry: boolean
  ok: boolean
}

/** R455: en pogled (fotografija istega objekta) s svojimi točkami in kalibracijo. */
export interface View {
  key: number
  photoId: string | null
  dataUrl: string
  imgW: number
  imgH: number
  quality: Quality | null
  points: Pt[]
  /** R506 (issue #15 faza 4): `pxY`/`cmY` sta LOČENA referenca v smeri Y na
   *  sliki. Kadar obstaja par, merilo ni enako v vseh smereh (nagnjen kader)
   *  in jedro računa anizotropno. Polovičen par (samo ena vrednost) jedro
   *  zavrže — zato ju UI vedno nastavi skupaj. */
  calib: { px: number; cm: number; pxY?: number; cmY?: number; plane?: { points: { x: number; y: number }[]; widthCm: number; heightCm: number } } | null
  calibLocked: boolean
}

/** R455: posnetek za undo/redo (§4) — {views, activeView}. */
export interface ZgodovinaVnos { views: View[]; activeView: number }

/** R455: vlečenje točke (§1/§4) — vključuje stanje pred vlečenjem (undo). */
export interface DragState { view: number; point: number; startX: number; startY: number; moved: boolean; preViews: View[] }

/** R455: povečevalno steklo (§4) — točka kazalca med vlečenjem točke. */
export interface LensState { x: number; y: number; view: number }

export const MAX_IMG_W = 1600
export const MAX_VIEWS = 4
/** Prag variacije Laplacea pod katerim sliko ocenimo kot mehko (iz prakse, advisory). */
export const BLUR_THRESHOLD = 45

export const PHASES = ['Zajem', 'Kalibracija', 'Meritev', 'Preverjanje', 'Potrditev'] as const

/**
 * R506 (issue #15 faza 4, H8): kratek, POŠTEN napis ugotovitve o orientaciji.
 *『NI DOKAZA』je namenoma neprijeten — koda z njim prizna, da usklajenosti
 * pikselnega in prikaznega prostora ni mogla potrditi, ne pa da trdi »v redu«.
 */
export const ORIENTACIJA_NAPIS: Record<OrientationStatus, string> = {
  NI_PODATKA: 'brez EXIF',
  PRAVOKOTNA: 'ravna (EXIF 1)',
  UPORABLJENA: 'EXIF uporabljen',
  NEUPORABLJENA: 'EXIF obrat smo izvedli sami',
  NI_DOKAZA: 'orientacija NI DOKAZANA',
}

/** R500 (issue #15 faza 1): kako monterju poveljemo, katera količina meritve je
 *  dokazana in katera je predpostavka (veljavnost po količinah). */
export const KOLICINA_LABEL: Record<'DOLZINA' | 'PLOSCEVINA' | 'KOT' | 'VISINA', string> = {
  DOLZINA: 'Dolžina', PLOSCEVINA: 'Površina', KOT: 'Koti', VISINA: 'Višina',
}
export const KOLICINA_STATE_LABEL: Record<'VELJAVNA' | 'PREDPOSTAVKA' | 'NEZADOSTNI_PODATKI', string> = {
  VELJAVNA: 'dokazano', PREDPOSTAVKA: 'predpostavka', NEZADOSTNI_PODATKI: 'manjka podatek',
}

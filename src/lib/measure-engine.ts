// measure-engine — ROKSAL MERILNI ENGINE (issue #12 »VRHUNSKI MERILNI ENGINE«)
// ─────────────────────────────────────────────────────────────────────────────
// Enoten, ČISTO DETERMINISTIČEN izračun (brez runtime AI — avtomatika je
// predlog, ne avtoriteta; VLM zaznava ostaja ločena opcijska ponudba).
// Uporaben na odjemalcu (živi izračun v UI) in na strežniku (kanonična
// analiza ob preverjanju — POST /api/measure-engine/analyze).
//
// Zgrajen po načelih benchmarka (HOVER, Polycam, magicplan, MeasureSquare,
// Leica DISTO Plan, Roofr/EagleView, ARXITO):
//   §2  adaptivni načini (OGRAJA … SPLOSNO) z lastnimi pravili;
//   §3  Smart Capture Guide — DOBRO / OPOZORILO / NEZADOSTNO;
//   §4  profesionalna kalibracija (5 metod) z metapodatki;
//   §8–§11 domenski paketi (ograje, keramika, streha, fasada, stopnice,
//        prostor) — izmera neposredno napaja BOM/ceno/ponudbo;
//   §13 confidence + quality (vir + kalibracija + kakovost + zaupanje);
//   §14 avtomatska geometrijska kontrola;
//   §16 zmogljivosti naprave → priporočena metoda;
//   §19 export (CSV / JSON).
//
// Vhodi: točke so NORMALIZIRANE (0..1) z imgW/imgH (kot v kameri) ali
// neposredno v pikslih (brez imgW/imgH — kompatibilno z railing-layout).

// (brez 'use client' — knjižnica je čisti TS, uporabna na odjemalcu in strežniku)

// ── Tipi ─────────────────────────────────────────────────────────────────────

export type MeasureMode = 'OGRAJA' | 'KERAMIKA' | 'STREHA' | 'FASADA' | 'STOPNICE' | 'PROSTOR' | 'SPLOSNO'
export const MEASURE_MODES: MeasureMode[] = ['OGRAJA', 'KERAMIKA', 'STREHA', 'FASADA', 'STOPNICE', 'PROSTOR', 'SPLOSNO']

export type CalibrationMethod = 'MARKER' | 'ZNANA_MERA' | 'ZUNANJA_NAPRAVA' | 'LIDAR' | 'ROCNO'

/**
 * ENA lestvica metod kalibracije za VSE plasti (issue #15 faza 2: »različne
 * plasti ne smejo imeti različne interpretacije iste reference«). Merilni
 * engine, tekač ogradnje (`fence-run-engine`) in UI uporabljajo TISTO tabelo —
 * `base` je zaupanje metode v cm referenčnem tekaču (0..100), `desc` vodilo
 * za moneterja.
 */
export const CALIB_METHODS: { id: CalibrationMethod; label: string; desc: string; base: number }[] = [
  { id: 'MARKER', label: 'Fizični marker', desc: 'Merilni marker (šahovnica) v kadru — znana velikost', base: 80 },
  { id: 'ZNANA_MERA', label: 'Znana mera objekta', desc: 'Vrata, okno, ploščica … znana dejanska dolžina', base: 70 },
  { id: 'ZUNANJA_NAPRAVA', label: 'Zunanja naprava', desc: 'Leica DISTO / laser — referenčna razdalja', base: 88 },
  { id: 'LIDAR', label: 'LiDAR / depth skala', desc: 'Globinska senzorika naprave (kjer je podprta)', base: 92 },
  { id: 'ROCNO', label: 'Ročna referenca', desc: 'Ročno izmerjena referenca na objektu', base: 55 },
]

export interface EnginePoint { x: number; y: number; src?: 'ROCNO' | 'PREDLOG' }
export interface EngineCalib {
  px: number // dolžina reference v pikslih (smer X na sliki)
  cm: number // dolžina reference v cm (smer X na sliki)
  /** issue #15 faza 1: ločena referenca v smeri Y na sliki. Kadar je podana,
   *  merilo NI enako v vseh smereh (nagnjen kader) in izračun uporabi
   *  anizotropno merilo namesto enega globalnega razmerja. */
  pxY?: number
  cmY?: number
  imgW?: number
  imgH?: number
  method?: CalibrationMethod
  refObject?: string
}

export const CALIB_METHOD_IDS: CalibrationMethod[] = CALIB_METHODS.map((m) => m.id)

/**
 * ENOTNA kalibracijska pogodba (issue #15, faza 2).
 *
 * Pred tem so bili ŠTYRJE ločeni parse-i kalibracije (analyze, confirm, sync,
 * railing-layout) z rahlo različnimi pravili: ista kalibracija je na eni poti
 * veljala, na drugi se je tiho izgubila (offline sinhronizacija je npr. zavrgla
 * pxY/cmY in celoten `engine`). Vslednji vnos zdaj kliče TO funkcijo, zato se
 * pravila ne morejo več razhajati.
 *
 * Vrne `null` kadar merila NI (px/cm para ni) — klicatelj odloči, ali to pomeni
 * 400 (izračun) ali samo odsotno merilo (shranjevanje → status ESTIMATED).
 */
export function parseCalibration (v: unknown): EngineCalib | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as { px?: unknown; cm?: unknown; pxY?: unknown; cmY?: unknown; imgW?: unknown; imgH?: unknown; method?: unknown; refObject?: unknown }
  const px = Number(o.px); const cm = Number(o.cm)
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(cm) || cm <= 0 || cm > 100000) return null
  const out: EngineCalib = { px, cm }
  // Ločena Y referenca (nagnjen kader) sme v merilo SAMO v paru — sicer bi
  // polovičen podatek tiho spremenil smer merila iz dokazanega v nedokazanega.
  const pxY = Number(o.pxY); const cmY = Number(o.cmY)
  if (Number.isFinite(pxY) && pxY > 0 && Number.isFinite(cmY) && cmY > 0 && cmY <= 100000) { out.pxY = pxY; out.cmY = cmY }
  const imgW = Number(o.imgW); const imgH = Number(o.imgH)
  if (Number.isFinite(imgW) && imgW > 0) out.imgW = Math.round(imgW)
  if (Number.isFinite(imgH) && imgH > 0) out.imgH = Math.round(imgH)
  if (typeof o.method === 'string' && (CALIB_METHOD_IDS as string[]).includes(o.method)) {
    out.method = o.method as CalibrationMethod
  }
  if (typeof o.refObject === 'string' && o.refObject.trim()) out.refObject = o.refObject.trim().slice(0, 80)
  return out
}

/** Oblika točk, ki jo sprejmejo VSI vhodi (issue #15 faza 2): normalizirane
 *  0..1 ali že piksli; `src` se ohrani samo za znani vrednosti, neznani izpade.
 *  Pred tem je imel vsak endpoint svoj `parsePt` — zato so se pravila o
 *  predlogih (PREDLOG ne šteje) lahko tiho razhajala. */
export function parseEnginePoints (v: unknown, max = 64): EnginePoint[] {
  if (!Array.isArray(v)) return []
  const out: EnginePoint[] = []
  for (const p of v.slice(0, max)) {
    if (!p || typeof p !== 'object') continue
    const q = p as { x?: unknown; y?: unknown; src?: unknown }
    const x = Number(q.x); const y = Number(q.y)
    // Pikslovne koordinate nad 1 M so vedno napaka vnosa ali tuji podatek;
    // takšna točka bi geometrijo pokvarila brez kakršnega koli opozorila.
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) continue
    out.push({ x, y, ...(q.src === 'ROCNO' || q.src === 'PREDLOG' ? { src: q.src } : {}) })
  }
  return out
}

/** Oblika za `params.calibration` — ključi ostanejo BITNO enaki dosedanjim. */
export function calibrationToParams (c: EngineCalib): Record<string, number | string> {
  const out: Record<string, number | string> = { px: c.px, cm: c.cm }
  if (c.pxY != null && c.cmY != null) { out.pxY = c.pxY; out.cmY = c.cmY }
  if (c.imgW != null) out.imgW = c.imgW
  if (c.imgH != null) out.imgH = c.imgH
  if (c.method != null) out.method = c.method
  if (c.refObject != null) out.refObject = c.refObject
  return out
}

/**
 * Kalibracija za SHRAMBO (params.calibration). Razlika od `parseCalibration`:
 * če popolnega para px/cm ni, vseeno zapišemo dokumentarne vrednosti (metoda,
 * referenčni objekt, dimenzije slike, posamezno referenco), da starejši ali
 * nepopolni klienti ne izgubijo zapisa — merilo pa kljub temu ostane NEZNANO,
 * zato tak zapis nikoli ne more biti poslovna mera (`deriveMeasurementStatus`).
 */
export function calibrationForParams (v: unknown): Record<string, number | string> | null {
  const full = parseCalibration(v)
  if (full) return calibrationToParams(full)
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const out: Record<string, number | string> = {}
  const pos = (x: unknown): number | null => {
    const n = Number(x)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const px = pos(o.px); const cm = pos(o.cm)
  if (px !== null) out.px = px
  if (cm !== null) out.cm = cm
  const pxY = pos(o.pxY); const cmY = pos(o.cmY)
  if (pxY !== null) out.pxY = pxY
  if (cmY !== null) out.cmY = cmY
  const imgW = pos(o.imgW); const imgH = pos(o.imgH)
  if (imgW !== null) out.imgW = Math.round(imgW)
  if (imgH !== null) out.imgH = Math.round(imgH)
  if (typeof o.method === 'string' && (CALIB_METHOD_IDS as string[]).includes(o.method)) out.method = o.method
  if (typeof o.refObject === 'string' && o.refObject.trim()) out.refObject = o.refObject.trim().slice(0, 80)
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Dovoleni nabor rezultatov engine-a, ki SMEJO biti shranjeni v `params.engine`
 * (revizija/izvoz). Isti seznam uporablja tudi offline sinhronizacija — prej je
 * imela vsaka pot svojga in je zato izpustila `scale`/`validity`.
 */
export const ENGINE_EXTRA_KEYS = ['domain', 'validation', 'confidence', 'captureGuide', 'scale', 'validity'] as const
export const ENGINE_MAX_BYTES = 8000

export function pickEngineExtras (e: unknown): Record<string, unknown> | null {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null
  const src = e as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  if (src.domain && typeof src.domain === 'object') picked.domain = src.domain
  if (Array.isArray(src.validation)) picked.validation = src.validation.slice(0, 40)
  if (src.confidence && typeof src.confidence === 'object') picked.confidence = src.confidence
  if (src.captureGuide && typeof src.captureGuide === 'object') picked.captureGuide = src.captureGuide
  // issue #15 faza 1: model merila in veljavnost po količinah morata preživeti
  // v zapisu — sicer bi revizija videla samo številke brez vira resnice.
  if (src.scale && typeof src.scale === 'object') picked.scale = src.scale
  if (src.validity && typeof src.validity === 'object') picked.validity = src.validity
  if (Object.keys(picked).length === 0) return null
  if (JSON.stringify(picked).length > ENGINE_MAX_BYTES) return null
  return picked
}

export interface StoredPoint { x: number; y: number; label?: string; src?: 'ROCNO' | 'PREDLOG' }

/**
 * Točke za SHRAMBO v `params` (issue #15 faza 2): enotna normalizacija za mrežno
 * potrjevanje in offline sinhronizacijo. Prej je vsaka pot pasala surov seznam
 * naprej, zato so se neveljavne točke lahko usedle v zapis in pri ponovnem
 * izračunu tiho spremenile dolžino. `label`/`src` ostaneta; neveljavne točke
 * (NaN ali koordinate zunaj razumnega območja) se vržejo ven.
 */
export function pointsForStorage (v: unknown, max = 64): StoredPoint[] | null {
  if (!Array.isArray(v)) return null
  const out: StoredPoint[] = []
  for (const p of v.slice(0, max)) {
    if (!p || typeof p !== 'object') continue
    const q = p as { x?: unknown; y?: unknown; label?: unknown; src?: unknown }
    const x = Number(q.x); const y = Number(q.y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) continue
    const label = typeof q.label === 'string' && q.label.trim() ? q.label.trim().slice(0, 60) : null
    const src = q.src === 'ROCNO' || q.src === 'PREDLOG' ? q.src : null
    out.push({ x, y, ...(label ? { label } : {}), ...(src ? { src } : {}) })
  }
  return out.length > 0 ? out : null
}

/**
 * ENOTNA oblika dodatnega pogleda (issue #15 faza 2). Obstajali so trije ločeni
 * parse-i (confirm, sync, kamera) in je offline pot iz pogleda izpustila metodo
 * kalibracije in ločeno Y referenco — isti zajem je imel zato na terenu in v
 * pisarni različno merilo.
 */
export function viewForStorage (v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as { photoId?: unknown; points?: unknown; calibration?: unknown }
  const out: Record<string, unknown> = {}
  if (typeof o.photoId === 'string' && o.photoId) out.photoId = o.photoId
  const pts = pointsForStorage(o.points)
  if (pts) out.points = pts
  const cal = calibrationForParams(o.calibration)
  if (cal) out.calibration = cal
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Dolžina ENEGA pogleda iz točk + kalibracije (R487): tanek sloj nad obstoječim
 * determinističnim computeGeometry — merilnega jedra ne podvajamo. Točke so
 * normalizirane 0..1 (takrat `imgW`/`imgH` v kalibraciji) ali že v pikslih;
 * predlogi (PREDLOG) ne štejejo, ker avtomatika ni avtoriteta (§5).
 */
export function viewLengthCm (points: unknown, calibration: unknown): number | null {
  const calib = parseCalibration(calibration)
  if (!calib) return null
  const pts = parseEnginePoints(points)
  if (pts.length < 2) return null
  const total = computeGeometry(pts, calib).totalLengthCm
  return total > 0 ? total : null
}

export interface MultiViewConsolidation {
  count: number
  values: number[]
  mean: number
  spreadPct: number
  conflict: boolean
  manualOverride?: boolean
}

/**
 * R487/R501: konsolidacija več pogledov — ISTI izračun za mrežno potrditev in
 * offline sinhronizacijo. Prej je ga poznala samo mrežna pot, zato je bil
 * kritičen konflikt pogledov na terenu mogoč brez kakršnega koli sledu —
 * vrata bi bila zaobiti s pošiljanjem, ko pade signal.
 *
 * `conflict` je VIDLJIVO dejstvo (razpršenost > praga) in ga ročni popravek NE
 * izniči — ostane v zapisu za revizijo. `blocked` je VRATA: zaprta samo, kadar
 * konflikta nihče ni razrešil z ročnim popravkom in razlogom. Obe poti
 * (confirm in sync) uporabita `blocked`, sicer bi bila teren strožji od
 * pisarne in bi monter zares izmerjene mere ne morel oddati.
 */
export function consolidateViews (args: {
  primaryPoints: unknown
  primaryCalibration: unknown
  views: unknown[]
  manualOverride: boolean
  conflictPct: number
}): { multiView: MultiViewConsolidation | null; conflict: boolean; blocked: boolean } {
  const lengths: number[] = []
  const primary = viewLengthCm(args.primaryPoints, args.primaryCalibration)
  if (primary !== null) lengths.push(primary)
  for (const v of args.views) {
    if (!v || typeof v !== 'object') continue
    const l = viewLengthCm((v as { points?: unknown }).points, (v as { calibration?: unknown }).calibration)
    if (l !== null) lengths.push(l)
  }
  const stats = multiViewStats(lengths)
  if (!stats) return { multiView: null, conflict: false, blocked: false }
  const conflict = stats.spreadPct > args.conflictPct
  const multiView: MultiViewConsolidation = {
    count: stats.count,
    values: stats.values,
    mean: stats.mean,
    spreadPct: stats.spreadPct,
    conflict,
    ...(args.manualOverride ? { manualOverride: true } : {}),
  }
  return { multiView, conflict, blocked: conflict && !args.manualOverride }
}

export interface Segment { from: number; to: number; lengthCm: number; angleDeg: number; heightDiffCm: number; horizontalCm: number }
export interface Corner { at: number; interiorDeg: number }
export interface Diagonal { i: number; j: number; lengthCm: number }

export type Severity = 'NAPAKA' | 'OPOZORILO' | 'INFO'
export interface ValidationIssue { code: string; severity: Severity; message: string }

export type CheckState = 'DOBRO' | 'OPOZORILO' | 'NEZADOSTNO'
export interface CaptureCheck { code: string; label: string; state: CheckState; detail: string }

// ── §2: pravila načinov ──────────────────────────────────────────────────────

export interface ModeRule {
  id: MeasureMode
  label: string
  desc: string
  polygon: boolean // točke tvorijo zaprt poligon (površina)
  minPoints: number
  range: { minCm: number; maxCm: number } // pričakovano območje skupne mere
  hint: string // vodilo za označevanje
  legacyType: 'OGRAJA' | 'BALUSTRADA' | 'NAGIB' | 'OSTANEO' // preslikava v obstoječi tip meritve
}

export const MODE_RULES: Record<MeasureMode, ModeRule> = {
  OGRAJA: {
    id: 'OGRAJA', label: 'Ograja', desc: 'Segmenti, vogali, stebri, razmaki, vrata, polnilo',
    polygon: false, minPoints: 2, range: { minCm: 50, maxCm: 10000 }, legacyType: 'OGRAJA',
    hint: 'Označite vogale ograje v zaporedju (tloris) — stebri se izračunajo iz razmaka.',
  },
  KERAMIKA: {
    id: 'KERAMIKA', label: 'Keramika / tla', desc: 'Prostor, površina, ploščice, rezi, odpad',
    polygon: true, minPoints: 3, range: { minCm: 60, maxCm: 100000 }, legacyType: 'OSTANEO',
    hint: 'Označite vogale prostora v zaporedju (v smeri urnega kazalca) — poligon se samodejno zapre.',
  },
  STREHA: {
    id: 'STREHA', label: 'Streha', desc: 'Ploskev, naklon, površina, material, odpad',
    polygon: true, minPoints: 3, range: { minCm: 100, maxCm: 100000 }, legacyType: 'OSTANEO',
    hint: 'Označite obris strešne ploskve (tloris) — naklon vnesite v možnostih.',
  },
  FASADA: {
    id: 'FASADA', label: 'Fasada / hiša', desc: 'Fasadna površina, odprtine, neto površina',
    polygon: true, minPoints: 3, range: { minCm: 60, maxCm: 30000 }, legacyType: 'OSTANEO',
    hint: 'Označite obris fasadne ploskve; okna/vrata vnesite kot odprtine v možnostih.',
  },
  STOPNICE: {
    id: 'STOPNICE', label: 'Stopnice', desc: 'Vzpon, čežnost, nagib, št. stopnic',
    polygon: false, minPoints: 2, range: { minCm: 30, maxCm: 2000 }, legacyType: 'NAGIB',
    hint: 'Označite 2 točki vzdolž roba stopnic (spodaj → zgoraj).',
  },
  PROSTOR: {
    id: 'PROSTOR', label: 'Prostor', desc: 'Površina, obseg, diagonale, kontrola pravokotnosti',
    polygon: true, minPoints: 3, range: { minCm: 100, maxCm: 100000 }, legacyType: 'OSTANEO',
    hint: 'Označite vogale prostora — pri 4 točkah se preverita diagonali (kontrola pravokotnosti).',
  },
  SPLOSNO: {
    id: 'SPLOSNO', label: 'Splošna meritev', desc: 'Dolžine, koti, verige segmentov',
    polygon: false, minPoints: 2, range: { minCm: 1, maxCm: 100000 }, legacyType: 'OSTANEO',
    hint: 'Označite točke merjene poti — izračunajo se dolžine, koti in višinske razlike.',
  },
}

/**
 * Preslikava STAREGA tipa meritve v način (issue #15 faza 2). Kadar odjemalec
 * načina (`mode`) ne pošlje, ga strežnik izpelje iz tipa — brez načina ne more
 * izračunati veljavnosti, veljavnost pa odloča o poslovnem statusu meritve.
 * Neznani tipovi (FOTO, OSTANEO) spadajo v SPLOSNO, ki ima najširša pravila in
 * zato ničesar ne zavrne napačno.
 */
export function modeForLegacyType (type: string | null | undefined): MeasureMode {
  const t = (type ?? '').toUpperCase()
  if (t === 'OGRAJA' || t === 'BALUSTRADA') return 'OGRAJA'
  if (t === 'NAGIB') return 'STOPNICE'
  return 'SPLOSNO'
}

// ── Geometrija (deterministična) ─────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
/** decimalna VEJICA — za besedila, ki jih monter bere (razlogi, note, izvoz). */
const r1c = (n: number) => String(r1(n)).replace('.', ',')
const r2c = (n: number) => String(r2(n)).replace('.', ',')

/** §4 / issue #15 faza 1: do kakšnega nagiba je eno globalno merilo za VSE
 *  smeri še zaglobljivo (napaka ≤ 1,5 % zaradi cos(tilt)). Nad pragom smer Y
 *  na sliki ni enaka smeri X — potrebuje ločeno referenco (pxY/cmY). */
export const TILT_ENOTNO_MERILO_MAX_DEG = 10

export type ScaleBasis = 'ENOTNO_Z_DOKAZOM' | 'ENOTNO_BREZ_DOKAZA' | 'ANIZOTROPNO' | 'NEZNANO'

export interface ScaleModel {
  /** Ali sploh obstaja številsko merilo. `false` = NIKAKIŠNJIH cm-številk ni
   *  dovoljeno uporabiti (poslovna mera); opomba: TIHO merilo 1 cm/px ne
   *  obstaja več — prejšnja različica ga je uporabila kot rezervo. */
  known: boolean
  /** Ali je eno merilo za vse smeri podprto z dokazom (pravokotnost ali
   *  ločena Y referenca). `false` pri nagnjenem kaderu brez Y reference. */
  isotropicProven: boolean
  cmPerPxX: number | null
  cmPerPxY: number | null
  basis: ScaleBasis
  tiltDeg: number | null
  /** Največji kot med smermi merjenih segmentov v sliki (0..180). */
  directionSpreadDeg: number | null
  /** Merilo velja za smeri pod tem kotom; nad njim je izračun napačen. */
  validWithinDeg: number | null
  reasons: string[]
}

export interface ScaleContext { tiltDeg?: number | null; spreadDeg?: number | null }

/** Ena definicija merila — uporabijo jo vsi geometrijski izračuni (issue #15:
 *  ne trih ločenih `calib.px > 0 ? … : 1`). */
export function resolveScale (calib: EngineCalib | null | undefined, ctx: ScaleContext = {}): ScaleModel {
  const tilt = ctx.tiltDeg != null && Number.isFinite(ctx.tiltDeg) ? Math.abs(ctx.tiltDeg) : null
  const spread = ctx.spreadDeg != null && Number.isFinite(ctx.spreadDeg) ? ctx.spreadDeg : null
  const px = Number(calib?.px); const cm = Number(calib?.cm)
  const base: ScaleModel = {
    known: false, isotropicProven: false, cmPerPxX: null, cmPerPxY: null,
    basis: 'NEZNANO', tiltDeg: tilt, directionSpreadDeg: spread, validWithinDeg: null, reasons: [],
  }
  if (!(px > 0) || !(cm > 0)) {
    base.reasons.push('Merilo ni znano (kalibracija px/cm manjka ali je ≤ 0) — cm-vrednosti se NE izračunajo, tudi izpisa s predpostavljenim 1 cm/px ne.')
    return base
  }
  const sx = cm / px
  const pxY = Number(calib?.pxY); const cmY = Number(calib?.cmY)
  const sy = pxY > 0 && cmY > 0 ? cmY / pxY : null
  if (sy !== null) {
    return {
      ...base, known: true, isotropicProven: true, cmPerPxX: sx, cmPerPxY: sy, basis: 'ANIZOTROPNO',
      validWithinDeg: 180,
      reasons: [`ločena referenca X ${r2c(sx)} cm/px, Y ${r2c(sy)} cm/px — merilo je podano posebej za obe smeri`],
    }
  }
  if (tilt == null) {
    return {
      ...base, known: true, isotropicProven: false, cmPerPxX: sx, cmPerPxY: sx, basis: 'ENOTNO_BREZ_DOKAZA',
      validWithinDeg: TILT_ENOTNO_MERILO_MAX_DEG,
      reasons: [`eno merilo ${r2c(sx)} cm/px za vse smeri — nagib naprave ni merjen, zato je pravokotnost na ravnino PREDPOSTAVKA in ne dokaz`],
    }
  }
  if (tilt <= TILT_ENOTNO_MERILO_MAX_DEG) {
    return {
      ...base, known: true, isotropicProven: true, cmPerPxX: sx, cmPerPxY: sx, basis: 'ENOTNO_Z_DOKAZOM',
      validWithinDeg: 180,
      reasons: [`kader je pravokoten na ravnino (nagib ${r1c(tilt)}° ≤ ${TILT_ENOTNO_MERILO_MAX_DEG}°) — eno merilo ${r2c(sx)} cm/px velja v vseh smereh`],
    }
  }
  // Napaka zaradi cos(tilt) v smeri Y: 1/cos − 1 (pri 30° = 15,5 %).
  const errPct = (1 / Math.cos((tilt * Math.PI) / 180) - 1) * 100
  const validWithin = spread != null && spread <= TILT_ENOTNO_MERILO_MAX_DEG ? 180 : TILT_ENOTNO_MERILO_MAX_DEG
  return {
    ...base, known: true,
    isotropicProven: spread != null && spread <= TILT_ENOTNO_MERILO_MAX_DEG,
    cmPerPxX: sx, cmPerPxY: sx, basis: 'ENOTNO_BREZ_DOKAZA',
    validWithinDeg: validWithin,
    reasons: [
      `nagib ${r1c(tilt)}° > ${TILT_ENOTNO_MERILO_MAX_DEG}°: smer Y na sliki je krajšana za ≈ ${r1c(errPct)} %, eno merilo (${r2c(sx)} cm/px) velja samo za smeri blizu reference`,
      spread != null ? `smeri merjenih segmentov se razhajata do ${r1c(spread)}°` : 'smeri merjenih segmentov nista podani',
      'rešitev: ločena Y referenca (pxY/cmY) ali kader pravokoten na ravnino',
    ],
  }
}

/** Kot (°) med zaporednima točkama v slikovnih pikslih — za razpršenost smeri. */
function smerDeg (dx: number, dy: number): number { return (Math.atan2(dy, dx) * 180) / Math.PI }

/** Največje razhajanje med smermi segmentov polyline (0..180, normalize na os). */
function razprsenostSmer (px: { x: number; y: number }[]): number | null {
  const smi: number[] = []
  for (let i = 0; i + 1 < px.length; i++) {
    const dx = px[i + 1].x - px[i].x; const dy = px[i + 1].y - px[i].y
    if (dx === 0 && dy === 0) continue
    let a = smerDeg(dx, dy) % 180
    if (a < 0) a += 180
    smi.push(a)
  }
  if (smi.length === 0) return null
  if (smi.length === 1) return 0
  let worst = 0
  for (let i = 0; i < smi.length; i++) {
    for (let j = i + 1; j < smi.length; j++) {
      let d = Math.abs(smi[i] - smi[j])
      if (d > 90) d = 180 - d
      if (d > worst) worst = d
    }
  }
  return r1(worst)
}

/** Razdalja v pikslih med dvema točkama (normalizirano 0..1 z imgW/imgH ali že v px). */
function toPx (pts: EnginePoint[], calib: EngineCalib | null | undefined): { x: number; y: number }[] {
  const hasDim = (calib?.imgW ?? 0) > 0 && (calib?.imgH ?? 0) > 0
  return pts.map((p) => ({ x: p.x * (hasDim ? (calib?.imgW as number) : 1), y: p.y * (hasDim ? (calib?.imgH as number) : 1) }))
}

export interface GeometryResult {
  segments: Segment[]
  corners: Corner[]
  totalLengthCm: number
  /** Enotno merilo (cm/px) ali `null`, kadar merila ni. Za odločitev o
   *  veljavnosti po smereh uporabi `scale` (`issue #15` faza 1). */
  cmPerPx: number | null
  scale: ScaleModel
  bbox: { wCm: number; hCm: number }
}

/** Polilinija: dolžine/koti segmentov + vogali (vzorec railing-layout, §12).
 *  `opts.tiltDeg` je dokaz o nagibu naprave; brez njega je eno merilo za vse
 *  smeri nedokazana predpostavka (`scale.isotropicProven = false`). */
export function computeGeometry (ptsIn: EnginePoint[], calib: EngineCalib | null | undefined, opts: { tiltDeg?: number | null } = {}): GeometryResult {
  const pts = ptsIn.filter((p) => p.src !== 'PREDLOG') // predlogi ne štejejo (§5 avtomatika ni avtoriteta)
  const px = toPx(pts, calib)
  const scale = resolveScale(calib, { tiltDeg: opts.tiltDeg ?? null, spreadDeg: razprsenostSmer(px) })
  const prazna: GeometryResult = { segments: [], corners: [], totalLengthCm: 0, cmPerPx: null, scale, bbox: { wCm: 0, hCm: 0 } }
  if (!scale.known || scale.cmPerPxX === null || scale.cmPerPxY === null) return prazna
  const sx = scale.cmPerPxX; const sy = scale.cmPerPxY
  const segments: Segment[] = []
  let total = 0
  for (let i = 0; i + 1 < px.length; i++) {
    const dx = px[i + 1].x - px[i].x
    const dy = px[i + 1].y - px[i].y
    const lengthCm = Math.hypot(dx * sx, dy * sy)
    segments.push({
      from: i, to: i + 1,
      lengthCm: r1(lengthCm),
      angleDeg: Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10,
      heightDiffCm: r1(dy * sy),
      horizontalCm: r1(Math.abs(dx) * sx),
    })
    total += lengthCm
  }
  const corners: Corner[] = []
  for (let i = 1; i + 1 < px.length; i++) {
    const a1 = Math.atan2(px[i].y - px[i - 1].y, px[i].x - px[i - 1].x)
    const a2 = Math.atan2(px[i + 1].y - px[i].y, px[i + 1].x - px[i].x)
    let d = (((a2 - a1) * 180) / Math.PI % 360 + 360) % 360
    if (d > 180) d = 360 - d
    corners.push({ at: i, interiorDeg: Math.round(d * 10) / 10 })
  }
  const xs = px.map((p) => p.x); const ys = px.map((p) => p.y)
  return {
    segments, corners,
    totalLengthCm: r1(total),
    cmPerPx: sx === sy ? sx : null,
    scale,
    bbox: px.length > 0
      ? { wCm: r1((Math.max(...xs) - Math.min(...xs)) * sx), hCm: r1((Math.max(...ys) - Math.min(...ys)) * sy) }
      : { wCm: 0, hCm: 0 },
  }
}

export interface PolygonResult {
  closed: boolean
  closureCm: number // razmik prva↔zadnja točka
  closurePct: number // % obsega
  areaM2: number // bruto površina (šahovnica)
  perimeterCm: number
  edges: Segment[] // robovi poligona (vključno s zaklepalko)
  scale: ScaleModel
}

/** Poligon (§9/§10/§11): samodejno zaprtje, površina (shoelace), obseg.
 *  Kadar merila ni, so vse cm-vrednosti 0 in `scale.known = false` — NICOČ
 *  ni izmerjena mera, je pa eksplicitno neznano merilo (issue #15 faza 1). */
export function polygonMetrics (ptsIn: EnginePoint[], calib: EngineCalib | null | undefined, opts: { tiltDeg?: number | null } = {}): PolygonResult {
  const pts = ptsIn.filter((p) => p.src !== 'PREDLOG')
  const px = toPx(pts, calib)
  const scale = resolveScale(calib, { tiltDeg: opts.tiltDeg ?? null, spreadDeg: razprsenostSmer(px) })
  const sx = scale.cmPerPxX; const sy = scale.cmPerPxY
  if (!scale.known || sx === null || sy === null) {
    return { closed: pts.length >= 3, closureCm: 0, closurePct: 100, areaM2: 0, perimeterCm: 0, edges: [], scale }
  }
  const closed = pts.length >= 3
  const closureCm = pts.length >= 3 ? r1(Math.hypot((px[0].x - px[px.length - 1].x) * sx, (px[0].y - px[px.length - 1].y) * sy)) : 0
  const ring = px.map((p) => ({ x: p.x * sx, y: p.y * sy })) // v cm (po smereh)
  // robovi: zaporedni + zaklepalka nazaj na prvo točko
  const edges: Segment[] = []
  let perimeter = 0
  for (let i = 0; i + 1 < ring.length; i++) {
    const dx = ring[i + 1].x - ring[i].x; const dy = ring[i + 1].y - ring[i].y
    const len = Math.hypot(dx, dy)
    edges.push({ from: i, to: i + 1, lengthCm: r1(len), angleDeg: Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10, heightDiffCm: r1(dy), horizontalCm: r1(Math.abs(dx)) })
    perimeter += len
  }
  if (ring.length >= 3) {
    const dx = ring[0].x - ring[ring.length - 1].x; const dy = ring[0].y - ring[ring.length - 1].y
    const len = Math.hypot(dx, dy)
    edges.push({ from: ring.length - 1, to: 0, lengthCm: r1(len), angleDeg: Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10, heightDiffCm: r1(dy), horizontalCm: r1(Math.abs(dx)) })
    perimeter += len
  }
  // shoelace
  let area2 = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length]
    area2 += a.x * b.y - b.x * a.y
  }
  return {
    closed,
    closureCm,
    closurePct: perimeter > 0 ? r1((closureCm / perimeter) * 100) : 100,
    areaM2: ring.length >= 3 ? r2(Math.abs(area2) / 2 / 10000) : 0,
    perimeterCm: r1(perimeter),
    edges,
    scale,
  }
}

/** Diagonale (§12): pri 4 točkah (0↔2, 1↔3), sicer praški prek vogalov. */
export function diagonalMetrics (ptsIn: EnginePoint[], calib: EngineCalib | null | undefined, opts: { tiltDeg?: number | null } = {}): Diagonal[] {
  const pts = ptsIn.filter((p) => p.src !== 'PREDLOG')
  if (pts.length < 4) return []
  const scale = resolveScale(calib, { tiltDeg: opts.tiltDeg ?? null })
  if (!scale.known || scale.cmPerPxX === null || scale.cmPerPxY === null) return []
  const sx = scale.cmPerPxX; const sy = scale.cmPerPxY
  const px = toPx(pts, calib)
  const pairs: [number, number][] = pts.length === 4 ? [[0, 2], [1, 3]] : [[0, Math.floor(pts.length / 2)]]
  return pairs.map(([i, j]) => ({ i, j, lengthCm: r1(Math.hypot((px[j].x - px[i].x) * sx, (px[j].y - px[i].y) * sy)) }))
}

// ── R487 (issue #3 §4C): statistika strinjanja pogledov ──────────────────────
// ISTA definicija povprečja/razpršenosti kot v kamera UI (multi memo) in AR
// konsolidatorju (scene-understanding-core: (max−min)/mean, prag 15 %) — tanek
// sloj NAD obstoječim computeGeometry (dolžine pogledov se izračunajo z njim),
// NE nova konsolidacijska semantika. Uporabljena na strežniku (confirm) za
// neodvisen, ponovljiv izračun (issue #3 §6 — ista koda, isti rezultat).

export interface MultiViewStats {
  count: number // število pogledov z izračunano dolžino
  values: number[] // dolžine pogledov (cm, r1)
  mean: number // povprečje (cm, r1)
  spreadPct: number // razpršenost (max−min)/mean × 100 (r1)
}

/** Strinjanje dolžin pogledov: ≥ 2 veljavne vrednosti, sicer null (ni
 *  konsolidacije, kadar podatki ne omogočajo — §4C »samo kadar podatki to
 *  omogočajo«). Deterministična, brez stanja — ista na odjemalcu in strežniku. */
export function multiViewStats (lengths: number[]): MultiViewStats | null {
  const vals = lengths.filter((n) => Number.isFinite(n) && n > 0).map((n) => r1(n))
  if (vals.length < 2) return null
  const meanRaw = vals.reduce((a, b) => a + b, 0) / vals.length
  const spreadPct = ((Math.max(...vals) - Math.min(...vals)) / meanRaw) * 100
  return { count: vals.length, values: vals, mean: r1(meanRaw), spreadPct: r1(spreadPct) }
}

// ── §14: avtomatska geometrijska kontrola ────────────────────────────────────

export function validateGeometry (
  mode: MeasureMode,
  ptsIn: EnginePoint[],
  calib: EngineCalib | null,
  opts: { manualLengthCm?: number | null; computedLengthCm?: number | null; steps?: number | null; tiltDeg?: number | null } = {}
): ValidationIssue[] {
  const rule = MODE_RULES[mode]
  const issues: ValidationIssue[] = []
  const pts = ptsIn.filter((p) => p.src !== 'PREDLOG')

  if (pts.length < rule.minPoints) {
    issues.push({ code: 'PREMAJHNO_TOCK', severity: 'NAPAKA', message: `Način ${rule.label} zahteva vsaj ${rule.minPoints} točk (označenih ${pts.length}).` })
    return issues
  }
  if (!calib || !(calib.px > 0) || !(calib.cm > 0)) {
    issues.push({ code: 'MANJKA_KALIBRACIJA', severity: 'NAPAKA', message: 'Brez eksplicitne referenčne kalibracije avtomatska dimenzija ni potrjena poslovna mera (§4).' })
    return issues
  }
  const geo = computeGeometry(pts, calib, { tiltDeg: opts.tiltDeg ?? null })

  // issue #15 faza 1: eno globalno merilo za VSE smeri je veljavno samo, kadar
  // je pravokotnost dokazana (nagib ≤ praga) ali je podana ločena Y referenca.
  // Nagnjen kader + več smeri merjenja = napaka, ki jo mora videti monter, ne
  // tiho predelati v številko, ki je videti kot mera.
  if (geo.scale.basis === 'ENOTNO_BREZ_DOKAZA' && geo.scale.tiltDeg != null &&
      geo.scale.tiltDeg > TILT_ENOTNO_MERILO_MAX_DEG && (geo.scale.directionSpreadDeg ?? 0) > TILT_ENOTNO_MERILO_MAX_DEG) {
    issues.push({
      code: 'MERILO_NEZADOSTNO',
      severity: 'NAPAKA',
      message: `Slika ni pravokotna na merjeno ravnino (nagib ${r1c(geo.scale.tiltDeg)}°), merjene smeri pa se razhajajo do ${r1c(geo.scale.directionSpreadDeg ?? 0)}° — eno razmerje cm/piksel ne more veljati v vseh smereh. Dodajte ločeno Y referenco (pxY/cmY) ali posnemite pravokotno na ravnino.`,
    })
  }

  // poligon: samodejno zaprtje (kot magicplan/MeasureSquare) — obroč = točke +
  // implicirana zaklepalka nazaj na prvo točko. §14 »ali je poligon zaprt« =
  // strukturna veljavnost: ≥ 3 točke, neničelna površina; če je uporabnik prvo
  // točko ponovil na koncu (eksplicitno zaprtje), je zaklepalka ničelna (INFO).
  // Zamujeni vogal se ne da zanesljivo zaznati geometrijsko — zadnja obramba je
  // review zaslon s narisanim poligonom (§15).
  if (rule.polygon) {
    const poly = polygonMetrics(pts, calib, { tiltDeg: opts.tiltDeg ?? null })
    if (poly.closurePct < 2 && pts.length >= 3) {
      issues.push({ code: 'ZAKLOPNA_TOCKA', severity: 'INFO', message: 'Prva in zadnja točka se skoraj prekrivata — poligon je eksplicitno zaprt (zaklepalka ničelna).' })
    }
    if (poly.areaM2 <= 0.01 && pts.length >= 3) {
      issues.push({ code: 'POVSRSINA_NICLA', severity: 'NAPAKA', message: 'Označene točke ležijo na premici — površina je 0. Premaknite točke ali dodajte vogal.' })
    }
  }

  // vogali smiselni (§14 »ali so koti smiselni«)
  const degenerate = geo.corners.filter((c) => c.interiorDeg < 10 || c.interiorDeg > 350)
  if (degenerate.length > 0) {
    issues.push({ code: 'KOT_NESMISELEN', severity: 'OPOZORILO', message: `Vogal${degenerate.length > 1 ? 'i' : ''} ${degenerate.map((c) => c.at + 1).join(', ')} je skoraj izravn${degenerate.length > 1 ? 'ani' : 'an'} (<10°) — točke se morda podvajajo ali prekrivajo.` })
  }
  if (geo.corners.length > 0 && geo.corners.every((c) => c.interiorDeg <= 2)) {
    issues.push({ code: 'TOCKE_KOLINEARNE', severity: 'INFO', message: 'Vse točke ležijo na isti premici — dodajte vogale za površino/objekt.' })
  }

  // območje (§14 »rezultat izven pričakovanega območja«)
  const total = geo.totalLengthCm
  if (total < rule.range.minCm || total > rule.range.maxCm) {
    issues.push({ code: 'ZUNAJ_OBMOCJA', severity: 'OPOZORILO', message: `Skupna meritev ${r1(total)} cm je izven pričakovanega območja za ${rule.label} (${rule.range.minCm}–${rule.range.maxCm} cm) — preverite kalibracijo.` })
  }

  // kratki segmenti (§14 »ali se segmenti stikajo« — sum podvojitve)
  const short = geo.segments.filter((s) => s.lengthCm > 0 && s.lengthCm < 5)
  if (short.length > 0) {
    issues.push({ code: 'SEGMENT_KRATEK', severity: 'INFO', message: `Segment${short.length > 1 ? 'i' : ''} ${short.map((s) => `${s.from + 1}→${s.to + 1}`).join(', ')} je krajši od 5 cm — morda podvojena točka.` })
  }

  // ročna vs avtomatska mera (§14)
  if (opts.manualLengthCm != null && opts.computedLengthCm != null && opts.computedLengthCm > 0) {
    const diffPct = Math.abs(opts.manualLengthCm - opts.computedLengthCm) / opts.computedLengthCm * 100
    if (diffPct > 15) {
      issues.push({ code: 'ROCA_AUTO_ODSTOPANJE', severity: 'OPOZORILO', message: `Ročna mera odstopa ${r1(diffPct)} % od izračunane (${r1(opts.computedLengthCm)} cm) — preverite kalibracijo ali točke.` })
    } else if (diffPct > 5) {
      issues.push({ code: 'ROCA_AUTO_ODSTOPANJE', severity: 'INFO', message: `Ročna mera odstopa ${r1(diffPct)} % od izračunane — v okviru tolerance.` })
    }
  }

  // stopnice: ergonomija (§12 diagonale/koti kot kontrola)
  if (mode === 'STOPNICE' && geo.segments.length > 0) {
    const s = geo.segments[0]
    const steps = opts.steps != null && opts.steps > 0 ? opts.steps : null
    if (steps != null) {
      const rise = Math.abs(s.heightDiffCm) / steps
      const run = s.horizontalCm / steps
      if (rise > 0 && (rise < 15 || rise > 20)) {
        issues.push({ code: 'STOPNICE_ERGONOMIJA', severity: 'OPOZORILO', message: `Vzpon ${r1(rise)} cm na stopnico je izven udobnega območja 15–20 cm.` })
      }
      if (run > 0 && (run < 24 || run > 32)) {
        issues.push({ code: 'STOPNICE_ERGONOMIJA', severity: 'OPOZORILO', message: `Čežnost ${r1(run)} cm na stopnico je izven udobnega območja 24–32 cm.` })
      }
    }
  }
  return issues
}

// ── issue #15 faza 1: veljavnost PO POSAMEZNI quantities ─────────────────────
// Koser skupne ocene »uspešno/napotno« ločeno ocenimo, kaj iz katerega
// podatka sploh sme slediti. Iz planarnega overlay-a (točke na SLIKI +
// merilo) smejo biti dolžine in površine v ravnini; višinske/3D trditve iz
// njega ne smejo biti — slikovni Δy je projekcija, ne meritev višine.

export type QuantityKind = 'DOLZINA' | 'PLOSCEVINA' | 'KOT' | 'VISINA'
export type QuantityState = 'VELJAVNA' | 'PREDPOSTAVKA' | 'NEZADOSTNI_PODATKI'
export interface QuantityValidity { quantity: QuantityKind; state: QuantityState; note: string }

export function quantityValidity (scale: ScaleModel, measured: QuantityKind[]): QuantityValidity[] {
  const tilt = scale.tiltDeg
  const out: QuantityValidity[] = []
  for (const q of measured) {
    if (!scale.known) {
      out.push({ quantity: q, state: 'NEZADOSTNI_PODATKI', note: 'merilo (cm/px) ni znano — vrednosti ni iz česa izračunati' })
      continue
    }
    if (q === 'VISINA') {
      // Višina iz planarnega overlay-a NIKOLI ni dokazana: potrebna je
      // leveleiranje, globinski senzor ali zunanja naprava.
      out.push({ quantity: q, state: 'NEZADOSTNI_PODATKI', note: 'slikovni navpični premik je projekcija v ravnini, ne izmerjena višina — potreben je levelirni/globinski podatek' })
      continue
    }
    if (scale.isotropicProven) {
      out.push({ quantity: q, state: 'VELJAVNA', note: scale.basis === 'ANIZOTROPNO' ? 'ločeni merili X in Y' : `pravokoten kader (nagib ${r1c(tilt ?? 0)}°)` })
      continue
    }
    if (tilt == null) {
      out.push({ quantity: q, state: 'PREDPOSTAVKA', note: 'pravokotnost na ravnino ni merjena — eno merilo je predpostavka, ne dokaz' })
      continue
    }
    if (q === 'PLOSCEVINA' || (scale.directionSpreadDeg ?? 0) > TILT_ENOTNO_MERILO_MAX_DEG) {
      out.push({ quantity: q, state: 'NEZADOSTNI_PODATKI', note: `nagib ${r1c(tilt)}° brez ločene Y reference — sistemska napaka ≈ ${r1c((1 / Math.cos((tilt * Math.PI) / 180) - 1) * 100)} %` })
      continue
    }
    out.push({ quantity: q, state: 'PREDPOSTAVKA', note: `smer je blizu reference (razpršenost ${r1c(scale.directionSpreadDeg ?? 0)}°), popačenje nagiba ${r1c(tilt)}° je majhno` })
  }
  return out
}

export interface MeasureValidity {
  status: 'VELJAVNA' | 'NEZADOSTNI_PODATKI' | 'NESKLADJE_GEOMETRIJE'
  /** Ali sme rezultat sploh v poslovno/proizvodno mero (BOM, ponudba). */
  businessMeasureAllowed: boolean
  quantities: QuantityValidity[]
  reasons: string[]
}

export function measureValidity (args: {
  scale: ScaleModel
  measured: QuantityKind[]
  issues: ValidationIssue[]
}): MeasureValidity {
  const quantities = quantityValidity(args.scale, args.measured)
  const reasons: string[] = []
  const napake = args.issues.filter((i) => i.severity === 'NAPAKA')
  const nezadostni = quantities.filter((q) => q.state === 'NEZADOSTNI_PODATKI')
  if (napake.length > 0) reasons.push(...napake.map((i) => i.message))
  if (nezadostni.length > 0) reasons.push(...nezadostni.map((q) => `${q.quantity}: ${q.note}`))
  const status: MeasureValidity['status'] = !args.scale.known || nezadostni.length > 0
    ? 'NEZADOSTNI_PODATKI'
    : napake.length > 0 ? 'NESKLADJE_GEOMETRIJE' : 'VELJAVNA'
  return {
    status,
    // Višina je NIKOLI poslovno veljavna iz planarnega overlay-a; vse ostalo
    // sme naprej, ko ni neznano merilo in ni geometrijske napake.
    businessMeasureAllowed: status === 'VELJAVNA' && !args.measured.includes('VISINA'),
    quantities,
    reasons,
  }
}

// ── issue #15 faza 2: status meritve (provenienca) ──────────────────────────

/**
 * Lestvica zaupanja je NAMENOMA ista kot `SegmentStatus` v
 * `src/lib/fence-run-engine.ts:146` (tekač ogradnje jo že uporablja) +
 * razveljavitev. Podvojene lestvice z enakimi imeni smo se izognili zato, ker
 * je hierarhija ena sama: ista beseda mora pomeniti isto raven zaupanja.
 */
export type MeasurementStatus =
  | 'ESTIMATED' // številke iz predpostavke (nedokazano merilo) — NE sme v BOM
  | 'AUTO_SUGGESTED' // samodejni predlog, Monter ga še ni potrdil z lastnim vhodom
  | 'MANUAL' // človek je vrednost vpisal sam (trak/ročno) — lastna odgovornost
  | 'CALIBRATED' // merilo je DOKAZANO (pravokoten kader ali ločena Y referenca)
  | 'VERIFIED' // CALIBRATED + več pogledov se strinja (strežniško izmerjeno)
  | 'CONFIRMED' // pisarna je meritvo izrecno potrdila za poslovno mero
  | 'INVALIDATED' // referenca/merilo se je spremenilo PO uporabi — mere niso več zaupanja vredne

export const MEASUREMENT_STATUSES: MeasurementStatus[] = [
  'ESTIMATED', 'AUTO_SUGGESTED', 'MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED', 'INVALIDATED',
]

export const MEASUREMENT_STATUS_LABELS: Record<MeasurementStatus, string> = {
  ESTIMATED: 'Ocena (merilo ni dokazano)',
  AUTO_SUGGESTED: 'Samodejni predlog (nepotrjen)',
  MANUAL: 'Ročni vnos',
  CALIBRATED: 'Kalibrirano (merilo dokazano)',
  VERIFIED: 'Preverjeno (več pogledov se strinja)',
  CONFIRMED: 'Potrjeno (pisarna)',
  INVALIDATED: 'Razveljavljeno (referenca se je spremenila)',
}

/** Ravni, ki ju poslovni izračun (BOM/kosovnica) ZAVRNE. */
export const MEASUREMENT_BLOCKED_STATUSES: MeasurementStatus[] = ['ESTIMATED', 'AUTO_SUGGESTED', 'INVALIDATED']

export function measurementStatusAllowsBusiness (status: string | null | undefined): boolean {
  // fail-closed v OBE smeri: neznano, prazno ali prihodnje stanje, ki ga lestvica
  // ne pozna, NI poslovna mera. Sicer bi nov stolpec v bazi tiho odprl vrata.
  if (!(MEASUREMENT_STATUSES as string[]).includes(status ?? '')) return false
  return !MEASUREMENT_BLOCKED_STATUSES.includes(status as MeasurementStatus)
}

/**
 * Vrstni red ravni zaupanja (najšibkejši člen odloča). `INVALIDATED` tu NI,
 * ker ni raven na poti navzgor: gre za zunanjo razveljavitev po uporabi, ki
 * vedno blokira poslovno mero. Tekač ogradnje (`SEGMENT_STATUSES`) uporablja
 * iste številke — dve lestvici z istim imenom bi bila dva vira resnice.
 */
export const MEASUREMENT_STATUS_ORDER: Record<Exclude<MeasurementStatus, 'INVALIDATED'>, number> = {
  ESTIMATED: 0,
  AUTO_SUGGESTED: 1,
  MANUAL: 2,
  CALIBRATED: 3,
  VERIFIED: 4,
  CONFIRMED: 5,
}

/**
 * Agregat segmentnega tekača: meritev, ki nastane iz potrjenega tekača, nosi
 * stanje NAJŠIBKEJŠEGA segmenta. Tekač ima svoja vrata (pod `MANUAL` ne sme
 * biti potrjen), a dokaz je šele tukaj — en nepreverjen odsek sicer ne more
 * tiho dvigniti celotne meritve v poslovno raven.
 */
export function segmentLadderProvenance (statuses: Array<string | null | undefined>): { status: MeasurementStatus; reason: string } {
  if (statuses.length === 0) {
    return { status: 'ESTIMATED', reason: 'tekač nima nobenega segmenta — ni iz česa izračunati mere' }
  }
  let najSlabsi: MeasurementStatus = 'CONFIRMED'
  for (const s of statuses) {
    const raven = (MEASUREMENT_STATUS_ORDER as Record<string, number | undefined>)[s ?? '']
    if (raven === undefined) {
      return { status: 'ESTIMATED', reason: `segment s stanjem «${s ?? 'prazno'}» ni na lestvici zaupanja` }
    }
    if (raven < MEASUREMENT_STATUS_ORDER[najSlabsi]) najSlabsi = s as MeasurementStatus
  }
  const število = statuses.filter((s) => s === najSlabsi).length
  return {
    status: najSlabsi,
    reason: `najšibkejši člen tekača: ${število}/${statuses.length} segmentov je stanja «${MEASUREMENT_STATUS_SHORT[najSlabsi]}»`,
  }
}

/**
 * Fotografski zapis brez merljene geometrije (stopnja ZAJEM): nima točk ne
 * merila, zato ga `deriveProvenance` ne more izračunati. Stanje je odločitev
 * jedra na enem mestu, ker ga ustvari več vstopnih točk (naložena fotografija,
 * offline sinhronizacija, ročni zapis).
 */
export function photoRecordProvenance (): { status: MeasurementStatus; reason: string } {
  return { status: 'ESTIMATED', reason: 'Fotografski zapis brez merljene geometrije — ni poslovna mera.' }
}

/**
 * Izračun statusa IZ PODATKOV, ne iz trditve odjemalca (issue #15: »strežnik
 * izračuna, odjemalec ne sporoča«). `scale` in `validity` sta rezultat
 * PONOVO izračunane geometrije na strežniku.
 *
 * Lestvica (najšibejši zadetek zmaga):
 *   • brez merila ali ob napaki geometrije  → ESTIMATED (ne sme v BOM)
 *   • samo samodejne točke (PREDLOG)        → AUTO_SUGGESTED (ne sme v BOM)
 *   • ročni popravek z razlogom             → MANUAL (človek prevzame odgovornost)
 *   • veljavno + dokazano merilo            → CALIBRATED
 *   • CALIBRATED + vsaj dva pogleda se strinja → VERIFIED
 *   • pisarna potrdi ročno                  → CONFIRMED (zunanji action, ne ta funkcija)
 *   • referenca se je spremenila po uporabi  → INVALIDATED (zunanji action)
 */
export function deriveMeasurementStatus (args: {
  /** Ali zapis izvira iz slike (ima točke ALI kalibracijo); sicer je ročni vnos. */
  fromImage: boolean
  scale: ScaleModel
  validity: MeasureValidity
  /** Vsi vhodi so prišli iz samodejnega predloga (VLM) brez ročnega posega. */
  autoOnly?: boolean
  /** Ročni popravek dolžine z razlogom — človek prevzame odgovornost. */
  manualOverride?: boolean
  /** Strežniška konsolidacija ≥ 2 pogledov brez kritičnega konflikta. */
  viewsAgreeing?: boolean
}): { status: MeasurementStatus; reason: string } {
  if (!args.fromImage) return { status: 'MANUAL', reason: 'vrednost je brez slikovne geometrije — ročni vnos' }
  if (args.autoOnly) return { status: 'AUTO_SUGGESTED', reason: 'točke so samodejni predlog; monter jih ni potrdil s svojim vhodom' }
  if (args.manualOverride) return { status: 'MANUAL', reason: 'ročni popravek dolžine z razlogom — odgovornost je na vpisu, ne na merilu' }
  if (!args.scale.known) return { status: 'ESTIMATED', reason: 'merilo (px/cm) ni podano — cm-vrednosti so ocena' }
  if (args.validity.status !== 'VELJAVNA') {
    return { status: 'ESTIMATED', reason: args.validity.reasons[0] ?? `veljavnost: ${args.validity.status}` }
  }
  const dokaz = args.scale.isotropicProven
    ? `merilo dokazano (${args.scale.basis}): ${args.scale.reasons[0] ?? ''}`
    : `merilo z dokumentirano referenco, enotnost po smereh je predpostavka (${args.scale.reasons[0] ?? 'nagiba naprave nismo merili'})`
  if (args.viewsAgreeing) {
    return { status: 'VERIFIED', reason: `${dokaz} in vsaj dva pogleda se strinja v mejah tolerance` }
  }
  return { status: 'CALIBRATED', reason: dokaz }
}

/**
 * IZKLJUČEN izračun provenience (issue #15 faza 2): potrditev meritve in
 * offline sinhronizacija uporabita TO, ne vsaka svoja izpeljava —
 * sicer bi ista meritve dobila različen status glede na to, kdaj je prišla v
 * sistem (kar je natanko tisto, kar issue prepoveduje).
 *
 * Odjemalčeve trditve NISO vir: `points`/`calibration` se ponovno preračunajo
 * skozi `computeGeometry` + `validateGeometry` + `measureValidity`.
 */
export function deriveProvenance (input: {
  points: unknown
  calibration: unknown
  mode?: MeasureMode | null
  /** Stari tip meritve (OGRAJA | BALUSTRADA | NAGIB | OSTANEO | FOTO). */
  legacyType?: string | null
  manualOverride?: boolean
  /** Strežniška konsolidacija ≥ 2 pogledov brez kritičnega konflikta. */
  viewsAgreeing?: boolean
}): { status: MeasurementStatus; reason: string; scale: ScaleModel; validity: MeasureValidity } {
  const calib = parseCalibration(input.calibration)
  const pts = parseEnginePoints(input.points)
  const mode: MeasureMode = input.mode ?? modeForLegacyType(input.legacyType)
  const geometry = computeGeometry(pts, calib)
  const validity = measureValidity({
    scale: geometry.scale,
    measured: MODE_QUANTITIES[mode],
    issues: validateGeometry(mode, pts, calib),
  })
  const st = deriveMeasurementStatus({
    // Zapis je »iz slike«, kadar ima geometrijske vhodne podatke (točke ALI
    // kalibracijo). Brez merila je taka številka OCENA (ESTIMATED), ne ročni
    // vnos — sicer bi teren brez kalibracije dobil poslovno dovoljeno stanje,
    // kar je natanko tisto, kar prepoveduje migracija (issue #15 H2).
    fromImage: pts.length >= 2 || calib !== null,
    scale: geometry.scale,
    validity,
    autoOnly: pts.length >= 2 && pts.every((p) => p.src === 'PREDLOG'),
    manualOverride: input.manualOverride === true,
    viewsAgreeing: input.viewsAgreeing === true,
  })
  return { ...st, scale: geometry.scale, validity }
}

/**
 * Kratke oznake za značke (UI). BESEDILA so ena sama lestvica za uporabo
 * (meritve, tekač ogradnje, izvoz) — druga lestvica z istimi imeni bi bila
 * drugi vir resnice. Dolga razlaga je v `MEASUREMENT_STATUS_LABELS`.
 */
export const MEASUREMENT_STATUS_SHORT: Record<MeasurementStatus, string> = {
  ESTIMATED: 'Ocena',
  AUTO_SUGGESTED: 'Predlog',
  MANUAL: 'Ročno',
  CALIBRATED: 'Kalibrirano',
  VERIFIED: 'Preverjeno',
  CONFIRMED: 'Potrjeno',
  INVALIDATED: 'Razveljavljeno',
}

/**
 * Verzija KALIBRACIJSKE POGODBE (issue #15 faza 2: »shrani kalibracijsko
 * metodo/verzijo in uporabljeno transformacijo«). Kdor prebere stari zapis,
 * ve, po katerih pravilih je bil napisan — pravila se lahko spreminjajo,
 * zapis pa ne sme ostati brez oznake.
 */
export const CALIB_CONTRACT_VERSION = 'kalibracija/2.0'

/**
 * Provenienca za SHRAMBO v `params` (issue #15 faza 2): kaj je strežnik
 * izračunal IN KAKO — stanje, razlog, model merila (transformacija), metoda in
 * referenčni objekt. Kompakten zapis (brez `engine` podatkov) zato, ker ga
 * ustvari strežnik in ga mora prebrati tudi revizija/izvoz brez slikovnih
 * točk. Starejši zapisi polja NIMAJO — bralci morajo tolerirati odsotnost.
 */
export function provenanceForParams (p: {
  status: MeasurementStatus
  reason: string
  scale: ScaleModel
  calibration: EngineCalib | null
}): Record<string, unknown> {
  return {
    v: CALIB_CONTRACT_VERSION,
    status: p.status,
    reason: p.reason,
    basis: p.scale.basis,
    isotropicProven: p.scale.isotropicProven,
    cmPerPxX: p.scale.cmPerPxX,
    cmPerPxY: p.scale.cmPerPxY,
    ...(p.scale.tiltDeg != null ? { tiltDeg: p.scale.tiltDeg } : {}),
    ...(p.calibration?.method != null ? { method: p.calibration.method } : {}),
    ...(p.calibration?.refObject != null ? { refObject: p.calibration.refObject } : {}),
  }
}

// ── §8–§11: domenski paketi ──────────────────────────────────────────────────

export interface Opening { wCm: number; hCm: number; count: number }

// ── issue #15 faza 4: VIR vsakega domenskega vhoda ───────────────────────────
//
// Domenski paketi (§8–§11) imajo vrednosti, ki jih monter NI vpisal, ampak jih
// je dala koda (razmak 120 cm, naklon 35°, vzpon 17 cm, odpad 10 %). Faza 1 je
// takšno stanje označila samo pri naklonu strehe (`pitchSource`); pravilo je
// zdaj splošno in brez izjeme: noben privzet ali pravilom izpeljan podatek ne
// sme v PDF-ju, CSV-ju ali UI-ju izgledati kot izmerjen.

/** `VNOS` = monter je vrednost vpisal; `PRIVZET` = dala jo je koda, ker vnosa
 *  ni bilo; `PRAVILO` = inženirski približek (npr. 4 kg/m² lepkar C2). */
export type InputSource = 'VNOS' | 'PRIVZET' | 'PRAVILO'

export const INPUT_SOURCE_LABELS: Record<InputSource, string> = {
  VNOS: 'vpisano',
  PRIVZET: 'PRIVZETO — ni izmerjeno',
  PRAVILO: 'izračunano po pravilu (ni izmerjeno)',
}

export interface DomainInput { key: string; label: string; vrednost: string; enota: string; vir: InputSource }

export interface DomainOptions {
  maxSpanCm?: number // OGRAJA: razmak stebrov (privzeto 120)
  heightCm?: number // OGRAJA: višina polnila (privzeto 100)
  tileWcm?: number // KERAMIKA: širina ploščice (privzeto 60)
  tileHcm?: number // KERAMIKA: višina ploščice (privzeto 60)
  jointMm?: number // KERAMIKA: fuga (privzeto 3)
  pattern?: 'PRAVOKOTNO' | 'DIAGONALNO' // KERAMIKA (privzeto PRAVOKOTNO)
  openings?: Opening[] // FASADA/KERAMIKA: odprtine
  pitchDeg?: number // STREHA: naklon (privzeto 35)
  roofMaterial?: 'BETONNA' | 'KOVINSKA' // STREHA (privzeto BETONNA)
  steps?: number // STOPNICE: št. stopnic
}

export interface OgrajaDomain {
  mode: 'OGRAJA'
  totalLengthCm: number
  segments: Segment[]
  corners: Corner[]
  posts: number
  spacingCm: number
  /** faza 4: višina polnila, iz katere je izračunana površina — brez tega
   *  izvoz pokaže m², za katere ni vedeti, iz katere višine so. */
  infillHeightCm: number
  handrailM: number
  infillM2: number
  sources: Partial<Record<'maxSpanCm' | 'heightCm', InputSource>>
}

export interface KeramikaDomain {
  mode: 'KERAMIKA'
  areaM2: number
  openingsM2: number
  netAreaM2: number
  perimeterCm: number
  tileWcm: number
  tileHcm: number
  jointMm: number
  pattern: 'PRAVOKOTNO' | 'DIAGONALNO'
  rows: number
  cols: number
  tilesCount: number
  cuts: number
  netTiles: number
  wastePct: number
  adhesiveKg: number
  fugueKg: number
  sources: Partial<Record<'tileWcm' | 'tileHcm' | 'jointMm' | 'pattern' | 'openings', InputSource>>
  /** faza 4: INŽENIRSKI PRIBLIŽKI, ki so vplivali na številko. Niso mera in
   *  niso monterjev vnos — izvoz ju mora izpisati, sicer je 39 kg lepaka videti
   *  kot izračun iz meritve (je pa iz pravila 4 kg/m²). */
  rules: string[]
}

export interface StrehaDomain {
  mode: 'STREHA'
  footprintM2: number
  pitchDeg: number
  /** issue #15 faza 1 (H6): ali je naklon VNESEN ali PRIVZET — privzetega
   *  35° ne sme prikazati kot izmerjenega. */
  pitchSource: 'VNOS' | 'PRIVZET'
  faceAreaM2: number
  perimeterCm: number
  ridgeCm: number
  eaveCm: number
  material: 'BETONNA' | 'KOVINSKA'
  wastePct: number
  materialM2: number
  sources: Partial<Record<'pitchDeg' | 'roofMaterial', InputSource>>
  /** faza 4: slemen je IZBRAN kot najdaljši rob — model enoslivne strehe, ne
   *  izmerjen podatek. Brez oznake bi izvoz trdil, da je slemen premerjen. */
  ridgeBasis: 'NAJDALJSI_ROB'
  rules: string[]
}

export interface FasadaDomain {
  mode: 'FASADA'
  grossM2: number
  perimeterCm: number
  openings: { wCm: number; hCm: number; count: number; areaM2: number }[]
  openingsM2: number
  netM2: number
  sources: Partial<Record<'openings', InputSource>>
  /** faza 4: odprtine so lahko večje od ploskve (napačen vnos) — neto se NE
   *  sme tiho pripeti na 0. */
  openingsExceedGross: boolean
}

export interface StopniceDomain {
  mode: 'STOPNICE'
  slopeLengthCm: number
  heightDiffCm: number
  /** issue #15 faza 1 (H7): višinska razlika iz navpičnice SLIKE je projekcija
   *  v merjeno ravnino, ne izmerjena višina — iz planarnega overlay-a se 3D ne
   *  trdi (glej `quantityValidity('VISINA')`). */
  heightBasis: 'PROJEKCIJA_SLIKE'
  horizontalCm: number
  angleDeg: number
  steps: number
  riseCm: number
  runCm: number
  sources: Partial<Record<'steps', InputSource>>
  /** faza 4: kadar stopnic ni nihče prešteel, jih koda predpostavi po 17 cm
   *  vzponu. Vrednost pravila mora biti zapisana, ne tiho. */
  stepsRuleCm: number | null
}

export interface ProstorDomain {
  mode: 'PROSTOR'
  areaM2: number
  perimeterCm: number
  diagonals: Diagonal[]
  rectangleOk: boolean | null
  closureCm: number
  rules: string[]
}

export interface SplosnoDomain { mode: 'SPLOSNO'; totalLengthCm: number; segments: Segment[] }

export type DomainResult = OgrajaDomain | KeramikaDomain | StrehaDomain | FasadaDomain | StopniceDomain | ProstorDomain | SplosnoDomain

/**
 * issue #15 faza 4: ENOTNI pogled na domenske vhode z oznako vira. UI, izvoz
 * (CSV/PDF) in testi uporabijo ta seznam, zato privzete vrednosti ne more
 * nobena plast pokazati kot izmerjene — dodajanje novega prikaza ne sme
 * pozabiti na vir, ker vir že živi v podatku.
 */
export function domainInputs (d: DomainResult): DomainInput[] {
  const n1 = (n: number): string => String(r1(n)).replace('.', ',')
  const i = (key: string, label: string, vrednost: string, enota: string, vir: InputSource): DomainInput =>
    ({ key, label, vrednost, enota, vir })
  switch (d.mode) {
    case 'OGRAJA':
      return [
        i('maxSpanCm', 'Razmak stebrov', String(Math.round(d.spacingCm)), 'cm', d.sources.maxSpanCm ?? 'PRIVZET'),
        i('heightCm', 'Višina polnila', String(Math.round(d.infillHeightCm)), 'cm', d.sources.heightCm ?? 'PRIVZET'),
        // število stebrov je posledica razmaka — nasleduje njegov vir
        i('posts', 'Število stebrov (iz razmaka)', String(d.posts), 'kos', d.sources.maxSpanCm ?? 'PRIVZET'),
      ]
    case 'KERAMIKA':
      return [
        i('tileWcm', 'Širina ploščice', String(Math.round(d.tileWcm)), 'cm', d.sources.tileWcm ?? 'PRIVZET'),
        i('tileHcm', 'Višina ploščice', String(Math.round(d.tileHcm)), 'cm', d.sources.tileHcm ?? 'PRIVZET'),
        i('jointMm', 'Fuga', String(d.jointMm), 'mm', d.sources.jointMm ?? 'PRIVZET'),
        i('pattern', 'Vzorec polaganja', d.pattern, '', d.sources.pattern ?? 'PRIVZET'),
        i('openings', 'Odprtine', d.openingsM2 > 0 ? `${n1(d.openingsM2)} m²` : 'brez (ni vpisano)', 'm²', d.sources.openings ?? 'PRIVZET'),
        ...d.rules.map((r) => i(`rule:${r}`, `Pravilo: ${r}`, '—', '', 'PRAVILO')),
      ]
    case 'STREHA':
      return [
        i('pitchDeg', 'Naklon strehe', String(Math.round(d.pitchDeg)), '°', d.sources.pitchDeg ?? 'PRIVZET'),
        i('roofMaterial', 'Material kritine', d.material, '', d.sources.roofMaterial ?? 'PRIVZET'),
        i('ridgeCm', 'Slemen (najdaljši rob)', n1(d.ridgeCm), 'cm', 'PRAVILO'),
        ...d.rules.map((r) => i(`rule:${r}`, `Pravilo: ${r}`, '—', '', 'PRAVILO')),
      ]
    case 'FASADA':
      return [
        i('openings', 'Odprtine', d.openings.length > 0 ? `${d.openings.length} vrst, ${n1(d.openingsM2)} m²` : 'brez (ni vpisano)', 'm²', d.sources.openings ?? 'PRIVZET'),
      ]
    case 'STOPNICE':
      return [
        i('steps', 'Število stopnic', String(d.steps), '', d.sources.steps ?? 'PRIVZET'),
        ...(d.stepsRuleCm != null
          ? [i('stepsRule', `Pravilo: predpostavljen vzpon ${d.stepsRuleCm} cm`, String(d.stepsRuleCm), 'cm', 'PRAVILO' as InputSource)]
          : []),
      ]
    case 'PROSTOR':
      return d.rules.map((r) => i(`rule:${r}`, `Pravilo: ${r}`, '—', '', 'PRAVILO'))
    default:
      return []
  }
}

/** Samo tisto, kar monter NI izmeril/vpisal — to mora biti videti drugače. */
export function privzetiVhodi (d: DomainResult): DomainInput[] {
  return domainInputs(d).filter((x) => x.vir !== 'VNOS')
}

/**
 * issue #15 faza 4: ugotovitve, ki jih geometrijska kontrola (§14) ne more
 * vedeti, ker so odvisne od VHOPOV domenskega paketa. NAMENOMA samo tri vrste,
 * da ne dvignejo praga za obstoječe mere:
 *  • NAPAKA — številka je Nemogoča (odprtine večje od ploskve),
 *  • INFO   — številka je veljavna, a NEIZMERJENA (privzeti naklon, predpostavljen
 *             niz stopnic, odprtine »brez«), da review zaslon vidi od kod gre.
 * OPOZORILO tu namenoma NI, ker bi znižalo `confidence` (§13) in s tem
 * preoblikovalo že izmerjene vrednosti obstoječih meritev.
 */
export function domainFindings (d: DomainResult): ValidationIssue[] {
  const out: ValidationIssue[] = []
  if (d.mode === 'FASADA' && d.openingsExceedGross) {
    out.push({
      code: 'FASADA_ODPRINE_NEMOGOCE',
      severity: 'NAPAKA',
      message: `Vpisane odprtine (${r2(d.openingsM2)} m²) presegajo fasadno ploskev (${r2(d.grossM2)} m²) — neto površina je lahko samo 0, kar pomeni napačen vnos, ne meritve. Preveri dimenzije ali število odprtin.`,
    })
  }
  if (d.mode === 'KERAMIKA' && d.openingsM2 > d.areaM2 + 0.005) {
    out.push({
      code: 'KERAMIKA_ODPRINE_NEMOGOCE',
      severity: 'NAPAKA',
      message: `Vpisane odprtine (${r2(d.openingsM2)} m²) presegajo merjeno ploskev (${r2(d.areaM2)} m²) — neto površina je lahko samo 0, kar pomeni napačen vnos, ne meritve. Preveri dimenzije ali število odprtin.`,
    })
  }
  if (d.mode === 'STREHA' && d.pitchSource === 'PRIVZET') {
    out.push({ code: 'STREHA_NAKLON_PRIVZET', severity: 'INFO', message: 'Naklon 35° je PRIVZET (ni izmerjen) — površina ploskve in količina materiala sta posledično oceni. Izmeri naklon in ga vpiši.' })
  }
  if (d.mode === 'STOPNICE' && d.sources.steps === 'PRIVZET') {
    out.push({ code: 'STOPNICE_STETJE_PRIVZETO', severity: 'INFO', message: `Število stopnic (${d.steps}) je izpeljano iz predpostavljenega vzpona ${d.stepsRuleCm} cm, ne prešteeto. Preštej stopnice na terenu in vpiši število.` })
  }
  if (d.mode === 'OGRAJA' && (d.sources.maxSpanCm === 'PRIVZET' || d.sources.heightCm === 'PRIVZET')) {
    const kaj = [
      d.sources.maxSpanCm === 'PRIVZET' ? `razmak stebrov (privzeto ${d.spacingCm} cm) ni vpisan` : null,
      d.sources.heightCm === 'PRIVZET' ? `višina polnila (privzeto ${d.infillHeightCm} cm) ni vpisana` : null,
    ].filter(Boolean).join(' in ')
    out.push({ code: 'OGRAJA_VHOD_PRIVZET', severity: 'INFO', message: `Pri ograji ${kaj} — število stebrov in površina polnila se računata iz privzetka, ne iz naročila.` })
  }
  if ((d.mode === 'FASADA' || d.mode === 'KERAMIKA') && d.sources.openings === 'PRIVZET') {
    out.push({ code: `${d.mode}_ODPRINE_BREZ`, severity: 'INFO', message: 'Odprtine niso vpisane — neto površina predpostavlja, da odprtin NI. Če na objektu obstajajo okna ali vrata, jih vpiši.' })
  }
  return out
}

/**
 * issue #15 faza 4: VODENI ZAJEM PO TIPU OBJEKTA. Načrt pove, kaj mora monter
 * za ta tip dejansko narediti, da številka sploh lahko velja — brez AI-ja,
 * brez obljub. `obvezno: true` pomeni: dokler manjka, je rezultat ocena, ne mera.
 */
export interface CapturePlanStep { key: string; navodilo: string; obvezno: boolean }
export interface CapturePlan { mode: MeasureMode; steps: CapturePlanStep[]; minTock: number; minPogledi: number }

const CAPTURE_PLANS: Record<MeasureMode, Omit<CapturePlan, 'mode' | 'minTock'>> = {
  OGRAJA: {
    minPogledi: 2,
    steps: [
      { key: 'VOGALI', navodilo: 'Označi vogale ograje v zaporedju (tloris) — vsak vogal je točka.', obvezno: true },
      { key: 'REFERENCA', navodilo: 'Postavi referenčno mero na TAKI ravnini kot je merjena ograja (npr. znana širina stopa 100 cm).', obvezno: true },
      { key: 'RAZMAK', navodilo: 'Vpiši razmak stebrov iz naročila (brez vpisa jih koda predpostavi 120 cm — to NI mera).', obvezno: false },
      { key: 'VISINA', navodilo: 'Vpiši višino polnila (brez vpisa se predpostavi 100 cm — površina polnila je potem ocena).', obvezno: false },
      { key: 'DRUGI_POGLED', navodilo: 'Posnemi še drugi konec ograje, da se dolžina potrdi z dvema pogledoma.', obvezno: false },
    ],
  },
  PROSTOR: {
    minPogledi: 1,
    steps: [
      { key: 'VOGALI', navodilo: 'Označi vse vogale prostora — poligon se sam zapre; pri 4 točkah se preverita diagonali.', obvezno: true },
      { key: 'PRAVOKOTNOST', navodilo: 'Izmeri obe diagonali; brez njiju pravokotnost ni dokazana (prag 1 %).', obvezno: false },
      { key: 'REFERENCA', navodilo: 'Referenčna mera mora ležati na tleh, ne na steni — sicer je površina napačna.', obvezno: true },
    ],
  },
  KERAMIKA: {
    minPogledi: 1,
    steps: [
      { key: 'VOGALI', navodilo: 'Označi vogale prostora v smeri urnega kazalca.', obvezno: true },
      { key: 'PLOSCICA', navodilo: 'Vpiši dimenzijo ploščice in fugo (brez vpisa 60×60 cm oziroma 3 mm — zaloga je potem približek).', obvezno: false },
      { key: 'ODPRINE', navodilo: 'Vpiši odprtine (vrata, okna). Če jih ne vpíšeš, neto površina predpostavlja, da jih NI.', obvezno: false },
      { key: 'REFERENCA', navodilo: 'Referenca na tleh; pravokoten kader (nagib ≤ 10°), sicer je merilo po smerih različno.', obvezno: true },
    ],
  },
  STREHA: {
    minPogledi: 2,
    steps: [
      { key: 'TLORIS', navodilo: 'Označi obris strešne ploskve (tloris) — vsaj 3 točke.', obvezno: true },
      { key: 'NAKLON', navodilo: 'IZMERI naklon (nagibomer/laser) in ga vpiši. Brez vpisa koda predpostavi 35° — površina ploskve je takrat ocena, ne mera.', obvezno: false },
      { key: 'MATERIAL', navodilo: 'Vpiši material kritine (betonska 10 % / kovinska 7 % odpada sta pravili, ne meritev).', obvezno: false },
      { key: 'SLIV', navodilo: 'Načrt predpostavi ENOSLIVNO ploskev; večslivna streha potrebuje ločene ploskve (po en poligon na ploskev).', obvezno: false },
      { key: 'SLEMEN', navodilo: 'Slemen je izbran kot najdaljši rob tlorisa — na terenu ga preveri z dvema pogledoma.', obvezno: false },
    ],
  },
  FASADA: {
    minPogledi: 2,
    steps: [
      { key: 'OBRIS', navodilo: 'Označi obris fasadne ploskve (vogali) — za pravokotno steno 4 točke.', obvezno: true },
      { key: 'PRAVOKOTNOST', navodilo: 'Stoj približno pravokotno na steno (nagib ≤ 10°) ali dodaj Y referenco; sicer je površina popačena.', obvezno: true },
      { key: 'ODPRINE', navodilo: 'Vpiši odprtine (širina × višina × število). Brez vpisa neto trdi, da odprtin ni.', obvezno: false },
      { key: 'VEC_POGLEDOV', navodilo: 'Posnemi fasado iz dveh mest, da se robovi ujemajo (razpršenost > 15 % je konflikt).', obvezno: false },
    ],
  },
  STOPNICE: {
    minPogledi: 2,
    steps: [
      { key: 'ROB', navodilo: 'Označi spodnji in zgornji rob stopnišča (za en niz zadostata 2 točki).', obvezno: true },
      { key: 'STETJE', navodilo: 'PREŠTEJ stopnice in vpiši število. Brez vpisa ga koda predpostavi po 17 cm vzponu — višina posamezne stopnice je potem ocena.', obvezno: false },
      { key: 'VISINA', navodilo: 'Višina iz slike je PROJEKCIJA, ne izmerjena višina — za poslovno mero potrebuješ levelirno ali globinsko referenco.', obvezno: true },
      { key: 'ERGONOMIKA', navodilo: 'Preveri vzpon 15–20 cm in čežnost; izven območja jedro javi opozorilo.', obvezno: false },
    ],
  },
  SPLOSNO: {
    minPogledi: 1,
    steps: [
      { key: 'TOCKE', navodilo: 'Označi točke merjene poti — izračunajo se dolžine, koti in višinske razlike.', obvezno: true },
      { key: 'REFERENCA', navodilo: 'Postavi znano mero v isti ravnini.', obvezno: true },
    ],
  },
}

/** Načrt zajema za tip objekta. `minTock` je vedno ISTO pravilo kot pri
 *  geometrijski validaciji (`MODE_RULES.minPoints`) — druga številka v načrtu
 *  bi bila drugi vir resnice. */
export function capturePlan (mode: MeasureMode): CapturePlan {
  return { mode, minTock: MODE_RULES[mode].minPoints, ...CAPTURE_PLANS[mode] }
}

/** Kaj od obveznega vnosa za tip objekta še manjka (prazno = vse vpisano). */
export function manjkajociVnosi (mode: MeasureMode, opts: DomainOptions = {}): string[] {
  const ima = (k: keyof DomainOptions): boolean => {
    const v = opts[k]
    if (k === 'openings') return Array.isArray(v) && (v as Opening[]).length > 0
    if (typeof v === 'string') return v.length > 0
    return typeof v === 'number' && Number.isFinite(v)
  }
  const OUT: Record<MeasureMode, [string, string][]> = {
    OGRAJA: [['maxSpanCm', 'Razmak stebrov (privzeto 120 cm)'], ['heightCm', 'Višina polnila (privzeto 100 cm)']],
    KERAMIKA: [['tileWcm', 'Dimenzija ploščice (privzeto 60 cm)'], ['jointMm', 'Fuga (privzeto 3 mm)'], ['openings', 'Odprtine (privzeto: brez)']],
    STREHA: [['pitchDeg', 'Naklon strehe (privzeto 35°)'], ['roofMaterial', 'Material kritine (privzeto betonska)']],
    FASADA: [['openings', 'Odprtine (privzeto: brez odprtin)']],
    STOPNICE: [['steps', 'Število stopnic (privzeto izračun po 17 cm vzponu)']],
    PROSTOR: [],
    SPLOSNO: [],
  }
  return OUT[mode].filter(([k]) => !ima(k as keyof DomainOptions)).map(([, label]) => label)
}

/**
 * issue #15 faza 4: napredek vodnega zajema. Stanje koraka se IZRAČUNA iz
 * dejanskih podatkov (točke, kalibracija, pogledi, vnosi) — monter ne more
 * »obkljukati« koraka, ki ga ni naredil, zato seznam ne more lagati.
 * Tri stanja so namenoma:
 *  • ZAKLJUČENO  — pogoj je v podatkih izpolnjen,
 *  • MANJKA      — pogoj v podatkih ni izpolnjen (in ga lahko monter še naredi),
 *  • PREVERI_ROČNO — pogoja iz teh podatkov ni mogoče vedeti (nagibomer,
 *                    preverjanje slemena na terenu, ergonomija stopnic);
 *                    koda ne trdi, da je narejeno, in ne trdi, da manjka.
 */
export type CaptureStepState = 'ZAKLJUČENO' | 'MANJKA' | 'PREVERI_ROČNO'

export interface CaptureContext {
  pointCount: number
  calibPresent: boolean
  viewCount: number
  tiltDeg: number | null
  options: DomainOptions
}

export interface CaptureProgressStep extends CapturePlanStep { state: CaptureStepState; dokaz: string }
export interface CaptureProgress { mode: MeasureMode; steps: CaptureProgressStep[]; obvezniManjkajo: string[] }

const TOCKE_KEYS = ['VOGALI', 'TLORIS', 'OBRIS', 'TOCKE', 'ROB']
const POGLEDI_KEYS = ['DRUGI_POGLED', 'VEC_POGLEDOV']
const ROCNO_KEYS = ['SLIV', 'SLEMEN', 'ERGONOMIKA']

export function captureProgress (mode: MeasureMode, ctx: CaptureContext): CaptureProgress {
  const plan = capturePlan(mode)
  const o = ctx.options
  const ima = (k: keyof DomainOptions): boolean => {
    const v = o[k]
    if (k === 'openings') return Array.isArray(v) && (v as Opening[]).length > 0
    if (typeof v === 'string') return v.length > 0
    return typeof v === 'number' && Number.isFinite(v)
  }
  const steps = plan.steps.map((s): CaptureProgressStep => {
    if (TOCKE_KEYS.includes(s.key)) {
      const ok = ctx.pointCount >= plan.minTock
      return { ...s, state: ok ? 'ZAKLJUČENO' : 'MANJKA', dokaz: `točk ${ctx.pointCount} / ${plan.minTock}` }
    }
    if (s.key === 'REFERENCA') {
      return { ...s, state: ctx.calibPresent ? 'ZAKLJUČENO' : 'MANJKA', dokaz: ctx.calibPresent ? 'referenca je postavljena' : 'referenca še ni postavljena' }
    }
    if (POGLEDI_KEYS.includes(s.key)) {
      const ok = ctx.viewCount >= plan.minPogledi
      return { ...s, state: ok ? 'ZAKLJUČENO' : 'MANJKA', dokaz: `pogledov ${ctx.viewCount} / ${plan.minPogledi}` }
    }
    if (s.key === 'RAZMAK' || s.key === 'NAKLON' || s.key === 'MATERIAL' || s.key === 'STETJE') {
      const kluc: keyof DomainOptions = s.key === 'RAZMAK' ? 'maxSpanCm' : s.key === 'NAKLON' ? 'pitchDeg' : s.key === 'MATERIAL' ? 'roofMaterial' : 'steps'
      return { ...s, state: ima(kluc) ? 'ZAKLJUČENO' : 'MANJKA', dokaz: ima(kluc) ? 'vpisano' : 'ni vpisano' }
    }
    if (s.key === 'VISINA') {
      if (mode === 'STOPNICE') {
        return { ...s, state: 'PREVERI_ROČNO', dokaz: 'slikovna višina je projekcija — §12 jo vedno označi kot NEZADOSTNI_PODATKI, ročna potrditev z levelirno/globinsko referenco' }
      }
      return { ...s, state: ima('heightCm') ? 'ZAKLJUČENO' : 'MANJKA', dokaz: ima('heightCm') ? 'vpisano' : 'ni vpisano' }
    }
    if (s.key === 'PLOSCICA') {
      const ok = ima('tileWcm') && ima('tileHcm') && ima('jointMm')
      return { ...s, state: ok ? 'ZAKLJUČENO' : 'MANJKA', dokaz: ok ? 'vpisano' : 'manjka ploščica ali fuga' }
    }
    if (s.key === 'ODPRINE') {
      return { ...s, state: ima('openings') ? 'ZAKLJUČENO' : 'PREVERI_ROČNO', dokaz: ima('openings') ? 'vpisano' : 'ni vpisano — neto predpostavlja, da odprtin NI' }
    }
    if (s.key === 'PRAVOKOTNOST') {
      if (mode === 'FASADA') {
        if (ctx.tiltDeg == null) return { ...s, state: 'PREVERI_ROČNO', dokaz: 'nagib merjenja ni podan' }
        return { ...s, state: ctx.tiltDeg <= 10 ? 'ZAKLJUČENO' : 'MANJKA', dokaz: `nagib ${r1(ctx.tiltDeg)}° (prag 10°)` }
      }
      return { ...s, state: 'PREVERI_ROČNO', dokaz: 'diagonali morata biti izmerjene in vpisani, ne samo posneti' }
    }
    if (ROCNO_KEYS.includes(s.key)) {
      return { ...s, state: 'PREVERI_ROČNO', dokaz: 'tega iz podatkov o zajemu ni mogoče vedeti' }
    }
    return { ...s, state: 'PREVERI_ROČNO', dokaz: 'ročni pregled' }
  })
  return {
    mode,
    steps,
    obvezniManjkajo: steps.filter((s) => s.obvezno && s.state === 'MANJKA').map((s) => s.navodilo),
  }
}

export function analyzeDomain (mode: MeasureMode, pts: EnginePoint[], calib: EngineCalib | null | undefined, opts: DomainOptions = {}, geoCtx: { tiltDeg?: number | null } = {}): DomainResult {
  const geo = computeGeometry(pts, calib, { tiltDeg: geoCtx.tiltDeg ?? null })
  switch (mode) {
    case 'OGRAJA': {
      const maxSpanVnos = opts.maxSpanCm != null && opts.maxSpanCm >= 40 && opts.maxSpanCm <= 300
      const heightVnos = opts.heightCm != null && opts.heightCm > 10 && opts.heightCm <= 300
      const maxSpan = maxSpanVnos ? (opts.maxSpanCm as number) : 120
      const height = heightVnos ? (opts.heightCm as number) : 100
      const raw = geo.segments.reduce((acc, s) => acc + Math.max(1, Math.ceil(s.lengthCm / maxSpan)) + 1, 0)
      const posts = Math.max(geo.segments.length > 0 ? 2 : 0, raw - Math.max(0, geo.segments.length - 1))
      return {
        mode: 'OGRAJA',
        totalLengthCm: geo.totalLengthCm,
        segments: geo.segments,
        corners: geo.corners,
        posts,
        spacingCm: maxSpan,
        infillHeightCm: height,
        handrailM: r2(geo.totalLengthCm / 100),
        infillM2: r2((geo.totalLengthCm / 100) * (height / 100)),
        sources: {
          maxSpanCm: maxSpanVnos ? 'VNOS' : 'PRIVZET',
          heightCm: heightVnos ? 'VNOS' : 'PRIVZET',
        },
      }
    }
    case 'KERAMIKA': {
      const poly = polygonMetrics(pts, calib, { tiltDeg: geoCtx.tiltDeg ?? null })
      const tileWVnos = opts.tileWcm != null && opts.tileWcm > 0
      const tileHVnos = opts.tileHcm != null && opts.tileHcm > 0
      const jointVnos = opts.jointMm != null && opts.jointMm >= 0 && opts.jointMm <= 30
      const patternVnos = opts.pattern === 'DIAGONALNO' || opts.pattern === 'PRAVOKOTNO'
      const openingsVnos = Array.isArray(opts.openings) && opts.openings.length > 0
      const tileW = tileWVnos ? (opts.tileWcm as number) : 60
      const tileH = tileHVnos ? (opts.tileHcm as number) : 60
      const jointMm = jointVnos ? (opts.jointMm as number) : 3
      const pattern = opts.pattern === 'DIAGONALNO' ? 'DIAGONALNO' : 'PRAVOKOTNO'
      const openingsM2 = r2((opts.openings ?? []).reduce((s, o) => s + (o.wCm * o.hCm * o.count) / 10000, 0))
      const netAreaM2 = r2(Math.max(0, poly.areaM2 - openingsM2))
      // razporeditev po omejitvenem okviru (deterministično)
      const jointCm = jointMm / 10
      const rows = Math.max(1, Math.ceil(geo.bbox.hCm / (tileH + jointCm)))
      const cols = Math.max(1, Math.ceil(geo.bbox.wCm / (tileW + jointCm)))
      let tiles = rows * cols
      if (pattern === 'DIAGONALNO') tiles = Math.ceil(tiles * 1.1) // diagonalna namestitev: klasični 10 % dodatek na reze
      const cuts = pattern === 'DIAGONALNO' ? rows * 2 : rows // rez na robu vsake vrstice (+1 ob diagonali)
      const netTiles = Math.max(1, Math.ceil((netAreaM2 * 10000) / (tileW * tileH)))
      const wastePct = Math.max(0, Math.ceil(((tiles - netTiles) / netTiles) * 100))
      // lepak C2: ~4 kg/m² (nazobčena lopatica 8–10 mm)
      const adhesiveKg = Math.ceil(netAreaM2 * 4)
      // fugue: (W+H)/(W·H) × globina(8 mm) × širina fuge × gostota 1,6 g/cm³
      const fugueKg = Math.ceil(netAreaM2 * ((tileW * 10 + tileH * 10) / (tileW * 10 * tileH * 10)) * 8 * jointMm * 1.6)
      return {
        mode: 'KERAMIKA', areaM2: poly.areaM2, openingsM2, netAreaM2, perimeterCm: poly.perimeterCm,
        tileWcm: tileW, tileHcm: tileH, jointMm, pattern, rows, cols, tilesCount: tiles, cuts,
        netTiles, wastePct, adhesiveKg: Math.max(0, adhesiveKg), fugueKg: Math.max(0, fugueKg),
        sources: {
          tileWcm: tileWVnos ? 'VNOS' : 'PRIVZET',
          tileHcm: tileHVnos ? 'VNOS' : 'PRIVZET',
          jointMm: jointVnos ? 'VNOS' : 'PRIVZET',
          pattern: patternVnos ? 'VNOS' : 'PRIVZET',
          openings: openingsVnos ? 'VNOS' : 'PRIVZET',
        },
        // faza 4: KJE približek se dotakne številke, mora biti tudi zapisan.
        rules: ['RAZPOREDITEV_IZ_OKVIRA_TLORISA', 'LEPAK_C2_4_KG_M2', 'FUGA_8_MM_G_1600', ...(pattern === 'DIAGONALNO' ? ['DIAGONALNO_DODATEK_10_PCT'] : [])],
      }
    }
    case 'STREHA': {
      const poly = polygonMetrics(pts, calib, { tiltDeg: geoCtx.tiltDeg ?? null })
      const pitchVnos = opts.pitchDeg != null && opts.pitchDeg >= 0 && opts.pitchDeg < 85
      const pitch = pitchVnos ? (opts.pitchDeg as number) : 35
      const materialVnos = opts.roofMaterial === 'KOVINSKA' || opts.roofMaterial === 'BETONNA'
      const material = opts.roofMaterial === 'KOVINSKA' ? 'KOVINSKA' : 'BETONNA'
      const faceArea = r2(poly.areaM2 / Math.cos((pitch * Math.PI) / 180))
      const sorted = [...poly.edges].sort((a, b) => b.lengthCm - a.lengthCm)
      const ridge = sorted.length > 0 ? sorted[0].lengthCm : 0 // najdaljši rob = slemen
      const eave = r1(poly.perimeterCm - ridge)
      const wastePct = material === 'KOVINSKA' ? 7 : 10
      return {
        mode: 'STREHA', footprintM2: poly.areaM2, pitchDeg: pitch, pitchSource: pitchVnos ? 'VNOS' : 'PRIVZET', faceAreaM2: faceArea,
        perimeterCm: poly.perimeterCm, ridgeCm: ridge, eaveCm: eave, material, wastePct,
        materialM2: r2(faceArea * (1 + wastePct / 100)),
        sources: { pitchDeg: pitchVnos ? 'VNOS' : 'PRIVZET', roofMaterial: materialVnos ? 'VNOS' : 'PRIVZET' },
        ridgeBasis: 'NAJDALJSI_ROB',
        rules: [material === 'KOVINSKA' ? 'ODPAD_KOVINSKA_KRITINA_7_PCT' : 'ODPAD_BETONNA_KRITINA_10_PCT', 'ENOSLIVNA_PLOSKEV_KOS_TANT'],
      }
    }
    case 'FASADA': {
      const poly = polygonMetrics(pts, calib, { tiltDeg: geoCtx.tiltDeg ?? null })
      const openingsVnos = Array.isArray(opts.openings) && opts.openings.length > 0
      const openings = (opts.openings ?? []).map((o) => ({ wCm: o.wCm, hCm: o.hCm, count: o.count, areaM2: r2((o.wCm * o.hCm * o.count) / 10000) }))
      const openingsM2 = r2(openings.reduce((s, o) => s + o.areaM2, 0))
      return {
        mode: 'FASADA', grossM2: poly.areaM2, perimeterCm: poly.perimeterCm, openings,
        openingsM2, netM2: r2(Math.max(0, poly.areaM2 - openingsM2)),
        sources: { openings: openingsVnos ? 'VNOS' : 'PRIVZET' },
        // faza 4: če je vpisanih odprtin več kot ploskve, neto NA PAPIRJU ni
        // resničen — numericno ga pripnem na 0, a tega ne smem zamolčati.
        openingsExceedGross: openingsM2 > poly.areaM2 + 0.005,
      }
    }
    case 'STOPNICE': {
      const s = geo.segments[0] ?? { lengthCm: 0, heightDiffCm: 0, horizontalCm: 0, angleDeg: 0, from: 0, to: 1 }
      const heightDiff = Math.abs(s.heightDiffCm)
      const stepsVnos = opts.steps != null && opts.steps > 0
      const steps = stepsVnos ? Math.round(opts.steps as number) : Math.max(1, Math.ceil(heightDiff / 17))
      return {
        mode: 'STOPNICE',
        slopeLengthCm: s.lengthCm,
        heightDiffCm: r1(heightDiff),
        heightBasis: 'PROJEKCIJA_SLIKE',
        horizontalCm: s.horizontalCm,
        angleDeg: Math.round((Math.atan2(heightDiff, s.horizontalCm || 1) * 180) / Math.PI * 10) / 10,
        steps,
        riseCm: r1(heightDiff / steps),
        runCm: r1(s.horizontalCm / steps),
        sources: { steps: stepsVnos ? 'VNOS' : 'PRIVZET' },
        stepsRuleCm: stepsVnos ? null : 17,
      }
    }
    case 'PROSTOR': {
      const poly = polygonMetrics(pts, calib, { tiltDeg: geoCtx.tiltDeg ?? null })
      const diags = diagonalMetrics(pts, calib, { tiltDeg: geoCtx.tiltDeg ?? null })
      const rectangleOk = diags.length === 2 && diags[1].lengthCm > 0
        ? Math.abs(diags[0].lengthCm - diags[1].lengthCm) / Math.max(diags[0].lengthCm, diags[1].lengthCm) <= 0.01
        : null
      return { mode: 'PROSTOR', areaM2: poly.areaM2, perimeterCm: poly.perimeterCm, diagonals: diags, rectangleOk, closureCm: poly.closureCm, rules: ['PRAVOKOTNOST_PRAG_1_PCT'] }
    }
    default:
      return { mode: 'SPLOSNO', totalLengthCm: geo.totalLengthCm, segments: geo.segments }
  }
}

// ── §13: confidence + quality ────────────────────────────────────────────────

export interface QualityInput { dark?: boolean; bright?: boolean; blurry?: boolean; blurScore?: number }
export interface ConfidenceResult { confidence: number; band: 'VISOK' | 'SREDNJI' | 'NIZEK'; reasons: string[] }

export function computeConfidence (args: {
  calibMethod?: CalibrationMethod | null
  quality?: QualityInput | null
  viewAgreementPct?: number | null
  issues?: ValidationIssue[]
}): ConfidenceResult {
  let c = 60
  const reasons: string[] = []
  const m = args.calibMethod ?? null
  if (m === 'LIDAR') { c += 20; reasons.push('kalibracija LiDAR/depth (+20)') } else if (m === 'ZUNANJA_NAPRAVA') { c += 18; reasons.push('referenca zunanje merilne naprave (+18)') } else if (m === 'MARKER') { c += 15; reasons.push('fizični marker (+15)') } else if (m === 'ZNANA_MERA') { c += 12; reasons.push('znana mera objekta (+12)') } else if (m === 'ROCNO') { c += 5; reasons.push('ročna referenca (+5)') } else { c -= 25; reasons.push('brez referenčne kalibracije (−25)') }
  const q = args.quality ?? null
  if (q) {
    if (q.blurry) { c -= 15; reasons.push('mehka slika (−15)') } else if (!q.dark && !q.bright) { c += 10; reasons.push('kakovost zajema dobra (+10)') }
    if (q.dark) { c -= 8; reasons.push('temna slika (−8)') }
    if (q.bright) { c -= 8; reasons.push('presočena slika / bleščanje (−8)') }
  }
  const ag = args.viewAgreementPct
  if (ag != null) {
    if (ag >= 95) { c += 10; reasons.push('pogledi se odlično strinjajo (+10)') } else if (ag >= 90) { c += 5; reasons.push('pogledi se dobro strinjajo (+5)') } else if (ag < 80) { c -= 10; reasons.push('pogledi se slabo strinjajo (−10)') }
  }
  const errs = (args.issues ?? []).filter((i) => i.severity === 'NAPAKA').length
  const warns = (args.issues ?? []).filter((i) => i.severity === 'OPOZORILO').length
  const penalty = Math.min(30, errs * 15 + warns * 7)
  if (penalty > 0) { c -= penalty; reasons.push(`geometrijska kontrola: ${errs} napak, ${warns} opozoril (−${penalty})`) }
  c = Math.max(5, Math.min(99, Math.round(c)))
  return { confidence: c, band: c >= 80 ? 'VISOK' : c >= 60 ? 'SREDNJI' : 'NIZEK', reasons }
}

// ── §3: Smart Capture Guide ──────────────────────────────────────────────────

export function captureGuide (args: {
  quality: QualityInput & { brightness?: number; blurScore?: number } | null
  tiltDeg?: number | null
  calibPresent: boolean
  viewCount: number
  /** issue #15 faza 1: model merila (če je izračunan) — brez njega se
   *  pravokotnost obravnava kot NI MERJENA, ne kot dokazana. */
  scale?: ScaleModel | null
}): { checks: CaptureCheck[]; status: CheckState } {
  const q = args.quality
  const checks: CaptureCheck[] = []
  const bs = q?.blurScore ?? null
  if (bs == null) {
    checks.push({ code: 'BLUR', label: 'Ostrost', state: 'DOBRO', detail: 'ni podatka (naložena slika)' })
  } else if (bs < 20) {
    checks.push({ code: 'BLUR', label: 'Ostrost', state: 'NEZADOSTNO', detail: `slika je zelo mehka (${bs}) — posnemite znova` })
  } else if (bs < 45) {
    checks.push({ code: 'BLUR', label: 'Ostrost', state: 'OPOZORILO', detail: `slika je mehka (${bs}) — dodajte jasen posnetek` })
  } else {
    checks.push({ code: 'BLUR', label: 'Ostrost', state: 'DOBRO', detail: `ostra (${bs})` })
  }
  const br = q?.brightness ?? null
  if (br == null) {
    checks.push({ code: 'LIGHT', label: 'Svetloba', state: 'DOBRO', detail: 'ni podatka' })
  } else if (br < 25 || br > 240) {
    checks.push({ code: 'LIGHT', label: 'Svetloba', state: 'NEZADOSTNO', detail: br < 25 ? 'pretemno za zanesljivo meritev' : 'presvetlo / bleščanje — spremenite kot' })
  } else if (br < 45 || br > 225) {
    checks.push({ code: 'LIGHT', label: 'Svetloba', state: 'OPOZORILO', detail: br < 45 ? 'temno — dodajte osvetlitev' : 'svetlo — pazite na bleščanje (steklo, kovina)' })
  } else {
    checks.push({ code: 'LIGHT', label: 'Svetloba', state: 'DOBRO', detail: `ustrezna (${Math.round(br)})` })
  }
  const t = args.tiltDeg ?? null
  checks.push(t == null
    ? { code: 'TILT', label: 'Nagib naprave', state: 'DOBRO', detail: 'ni merjeno (nalaganje)' }
    : t > 45
      ? { code: 'TILT', label: 'Nagib naprave', state: 'NEZADOSTNO', detail: `zelo velik nagib (${Math.round(t)}°) — postavite se pravokotno` }
      : t > 25
        ? { code: 'TILT', label: 'Nagib naprave', state: 'OPOZORILO', detail: `večji nagib (${Math.round(t)}°) — perspektiva popači mero` }
        : { code: 'TILT', label: 'Nagib naprave', state: 'DOBRO', detail: `pravokotno (${Math.round(t)}°)` })
  checks.push(args.calibPresent
    ? { code: 'REF', label: 'Referenčna mera', state: 'DOBRO', detail: 'kalibracija je postavljena' }
    : { code: 'REF', label: 'Referenčna mera', state: 'NEZADOSTNO', detail: 'brez reference ni potrjene poslovne mere (§4)' })
  // issue #15 faza 1: velja eno merilo za vse smeri ali ne?
  {
    const s = args.scale ?? null
    const tg = s?.tiltDeg ?? args.tiltDeg ?? null
    const spread = s?.directionSpreadDeg ?? null
    let stanje: CheckState = 'DOBRO'
    let podrobnost = 'eno merilo cm/px velja za vse smeri (pravokotnost ni merjena — predpostavka)'
    if (!args.calibPresent) {
      stanje = 'NEZADOSTNO'; podrobnost = 'merilo (cm/px) ni znano — iz slikovnih točk ni poslovne mere'
    } else if (s?.isotropicProven) {
      stanje = 'DOBRO'
      podrobnost = s.basis === 'ANIZOTROPNO' ? 'ločeni merili za X in Y smer' : `pravokoten kader (nagib ${r1c(tg ?? 0)}°)`
    } else if (tg != null && tg > TILT_ENOTNO_MERILO_MAX_DEG && (spread ?? 0) > TILT_ENOTNO_MERILO_MAX_DEG) {
      stanje = 'NEZADOSTNO'
      podrobnost = `nagib ${r1c(tg)}° in smeri do ${r1c(spread ?? 0)}° razpršene — eno merilo ne zvelja (bodisi Y referenca bodisi pravokoten kader)`
    } else if (tg != null && tg > TILT_ENOTNO_MERILO_MAX_DEG) {
      stanje = 'OPOZORILO'
      podrobnost = `nagib ${r1c(tg)}° — merilo je zanesljivo samo vzdolž reference`
    }
    checks.push({ code: 'MERILO', label: 'Veljavnost merila', state: stanje, detail: podrobnost })
  }
  checks.push(args.viewCount >= 2
    ? { code: 'COVERAGE', label: 'Pokritost (pogledi)', state: 'DOBRO', detail: `${args.viewCount} pogledi istega objekta` }
    : args.viewCount === 1
      ? { code: 'COVERAGE', label: 'Pokritost (pogledi)', state: 'OPOZORILO', detail: 'en sam pogled — dodajte še enega iz drugega kota' }
      : { code: 'COVERAGE', label: 'Pokritost (pogledi)', state: 'NEZADOSTNO', detail: 'ni še zajema' })
  const order: Record<CheckState, number> = { DOBRO: 0, OPOZORILO: 1, NEZADOSTNO: 2 }
  const status = checks.reduce<CheckState>((worst, c) => order[c.state] > order[worst] ? c.state : worst, 'DOBRO')
  return { checks, status }
}

// ── §16: zmogljivosti naprave (le brskalnik — varno tudi na strežniku) ───────

export interface DeviceCaps {
  camera: boolean
  orientation: boolean
  gps: boolean
  network: boolean
  storageMb: number | null
  webgl: boolean
}

export function detectDeviceCapsSync (): DeviceCaps {
  const w = typeof window !== 'undefined' ? window : undefined
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  let webgl = false
  try { webgl = !!document.createElement('canvas').getContext('webgl') } catch { webgl = false }
  return {
    camera: !!w && !!nav?.mediaDevices?.getUserMedia,
    orientation: !!w && 'DeviceOrientationEvent' in w,
    gps: !!nav && 'geolocation' in nav,
    network: !!nav?.onLine,
    storageMb: null,
    webgl,
  }
}

export async function detectDeviceCaps (): Promise<DeviceCaps> {
  const caps = detectDeviceCapsSync()
  try {
    const est = await navigator.storage?.estimate?.()
    if (est?.quota != null) caps.storageMb = Math.round(est.quota / 1e6)
  } catch { /* ni podatka */ }
  return caps
}

/**
 * Priporočilo metodi. POZOR (issue #15 H4): besedilo NE SME obljubljati
 * 3D-rekonstrukcije, je ni. Več pogledov združujemo izključno statistično
 * (`consolidateViews`), vsak pogled rabi svojo referenčno mero.
 */
export interface MethodRecommendation { method: 'KAMERA_REFERENCA' | 'VEC_POGLEDOV' | 'ROCNO'; label: string; reason: string }

/** §16/§18: priporočena metoda iz zmogljivosti (provider-agnostic, brez vezave). */
export function recommendMethod (caps: DeviceCaps): MethodRecommendation {
  if (!caps.camera) {
    return { method: 'ROCNO', label: 'Ročni vnos + referenca', reason: 'Kamera ni na voljo — profesionalni ročni način s skico in referenčnimi merami (§12).' }
  }
  if (caps.orientation && caps.webgl) {
    return { method: 'VEC_POGLEDOV', label: 'Kamera + več pogledov (statistika)', reason: 'Naprava ne javlja LiDAR/depth. Več fotografij združimo samo kot povprečje in razpršenost pogledov — prava 3D-rekonstrukcija (SfM) v tej aplikaciji NI izvedena, zato mora vsak pogled nositi svojo referenčno mero.' }
  }
  return { method: 'KAMERA_REFERENCA', label: 'Kamera + referenčna mera', reason: 'En foto pogled z eksplicitno referenco (marker/znana mera/zunanja naprava).' }
}

// ── Združevalnik (kanonična analiza za strežnik in UI) ───────────────────────

export interface AnalyzeInput {
  mode: MeasureMode
  points: EnginePoint[]
  calibration: EngineCalib
  options?: DomainOptions
  quality?: QualityInput & { brightness?: number; blurScore?: number } | null
  tiltDeg?: number | null
  viewAgreementPct?: number | null
  manualLengthCm?: number | null
  viewCount?: number | null
}

/** Kaj kateri način sploh meri (issue #15 faza 1 — veljavnost po quantities).
 *  VISINA je vključena samo tam, kjer domenski paket številko višine dejansko
 *  izpelje iz slike (STOPNICE), ne v OGRAJI, kjer je višina polnila vnos. */
export const MODE_QUANTITIES: Record<MeasureMode, QuantityKind[]> = {
  OGRAJA: ['DOLZINA', 'KOT'],
  KERAMIKA: ['DOLZINA', 'PLOSCEVINA', 'KOT'],
  STREHA: ['DOLZINA', 'PLOSCEVINA', 'KOT'],
  FASADA: ['DOLZINA', 'PLOSCEVINA', 'KOT'],
  STOPNICE: ['DOLZINA', 'KOT', 'VISINA'],
  PROSTOR: ['DOLZINA', 'PLOSCEVINA', 'KOT'],
  SPLOSNO: ['DOLZINA', 'KOT'],
}

export interface AnalyzeResult {
  mode: MeasureMode
  geometry: GeometryResult
  /** issue #15 faza 1: model merila (enotno/anizotropno/neznano) + razlogi. */
  scale: ScaleModel
  polygon: PolygonResult | null
  diagonals: Diagonal[]
  validation: ValidationIssue[]
  /** issue #15 faza 1: ali rezultat sme v poslovno/proizvodno mero. */
  validity: MeasureValidity
  confidence: ConfidenceResult
  captureGuide: { checks: CaptureCheck[]; status: CheckState }
  domain: DomainResult
  /** issue #15 faza 4: od kod poznamo vsako domensko številko (VNOS/PRIVZET/PRAVILO). */
  inputs: DomainInput[]
  /** issue #15 faza 4: vodeni zajem po tipu objekta (pravi pogled + obvezni vnosi). */
  plan: CapturePlan
  generatedAt: string
}

export function runAnalysis (input: AnalyzeInput): AnalyzeResult {
  const rule = MODE_RULES[input.mode]
  const tilt = input.tiltDeg ?? null
  const geometry = computeGeometry(input.points, input.calibration, { tiltDeg: tilt })
  const scale = geometry.scale
  const polygon = rule.polygon ? polygonMetrics(input.points, input.calibration, { tiltDeg: tilt }) : null
  const diagonals = diagonalMetrics(input.points, input.calibration, { tiltDeg: tilt })
  const domain = analyzeDomain(input.mode, input.points, input.calibration, input.options ?? {}, { tiltDeg: tilt })
  const validation = [
    ...validateGeometry(input.mode, input.points, input.calibration, {
      manualLengthCm: input.manualLengthCm ?? null,
      computedLengthCm: input.manualLengthCm != null ? geometry.totalLengthCm : null,
      steps: input.options?.steps ?? null,
      tiltDeg: tilt,
    }),
    // issue #15 faza 4: ugotovitve, ki jih §14 ne more vedeti (vhodi paketa).
    ...domainFindings(domain),
  ]
  const validity = measureValidity({ scale, measured: MODE_QUANTITIES[input.mode], issues: validation })
  const confidence = computeConfidence({
    calibMethod: input.calibration.method ?? null,
    quality: input.quality ?? null,
    viewAgreementPct: input.viewAgreementPct ?? null,
    issues: validation,
  })
  const guide = captureGuide({
    quality: input.quality ?? null,
    tiltDeg: input.tiltDeg ?? null,
    calibPresent: scale.known,
    viewCount: input.viewCount ?? 1,
    scale,
  })
  return {
    mode: input.mode,
    geometry,
    scale,
    polygon,
    diagonals,
    validation,
    validity,
    confidence,
    captureGuide: guide,
    domain,
    /** faza 4: vir vsakega domenskega vhoda (vpisano / privzeto / pravilo). */
    inputs: domainInputs(domain),
    /** faza 4: vodeni zajem po tipu objekta. */
    plan: capturePlan(input.mode),
    generatedAt: new Date().toISOString(),
  }
}

// ── §19: export ──────────────────────────────────────────────────────────────

export interface ExportRow { skupina: string; polje: string; vrednost: string; enota: string }

/** Izvoz in UI uporabita isto besedje za količine (issue #15 faza 1). */
export const KOLICINA_LABEL: Record<QuantityKind, string> = {
  DOLZINA: 'Dolžina', PLOSCEVINA: 'Površina', KOT: 'Koti', VISINA: 'Višina',
}

export interface ExportSource {
  id: string
  createdAt: string
  type: string
  mode?: string
  location?: string | null
  lengthCm?: number | null
  heightCm?: number | null
  slopeDeg?: number | null
  posts?: number | null
  segments?: number | null
  note?: string | null
  source?: string
  authorName?: string | null
  projectCode?: string | null
  projectTitle?: string | null
  workOrderCode?: string | null
  workOrderTitle?: string | null
  version?: number | null
  /** R501 (issue #15 faza 2): provenienca zapisa — stanje in razlog ju izračuna
   *  strežnik; izvoz ju mora nositi, sicer bi bil PDF videti kot potrjena mera. */
  status?: string | null
  statusNote?: string | null
  params?: {
    mode?: string
    calibration?: { method?: string; refObject?: string; px?: number; cm?: number } | null
    confidence?: number | null
    quality?: Record<string, unknown> | null
    photoId?: string
    /** R487 (issue #3): strežniško izračunana konsolidacija pogledov (confirm). */
    multiView?: { count?: number; values?: number[]; mean?: number; spreadPct?: number; conflict?: boolean; manualOverride?: boolean } | null
    engine?: { domain?: DomainResult | null; validation?: ValidationIssue[] | null; scale?: ScaleModel | null; validity?: MeasureValidity | null } | null
  } | null
}

/** Zgradi vrstice izvoza (CSV/JSON skupni vir). */
export function buildExportRows (m: ExportSource): ExportRow[] {
  const rows: ExportRow[] = []
  const push = (skupina: string, polje: string, vrednost: string, enota = ''): void => {
    rows.push({ skupina, polje, vrednost, enota })
  }
  /** Varen zapis števila (delni/star domenski objekt → — in ne NaN/undefined). */
  const f1 = (n: number | null | undefined): string => (n != null && Number.isFinite(n) ? r1(n).toString().replace('.', ',') : '—')
  const f2 = (n: number | null | undefined): string => (n != null && Number.isFinite(n) ? r2(n).toString().replace('.', ',') : '—')
  const fi = (n: number | null | undefined): string => (n != null && Number.isFinite(n) ? String(Math.round(n)) : '—')
  push('Dokument', 'Izvoz', 'ROKSAL meritev', '')
  push('Dokument', 'Datum izvoza', new Date().toISOString().slice(0, 16).replace('T', ' '), '')
  push('Dokument', 'Verzija meritve', m.version != null ? String(m.version) : '1', '')
  push('Kontekst', 'Projekt', m.projectCode ? `${m.projectCode} — ${m.projectTitle ?? ''}`.trim() : '—', '')
  push('Kontekst', 'Nalog', m.workOrderCode ? `${m.workOrderCode} — ${m.workOrderTitle ?? ''}`.trim() : '—', '')
  push('Kontekst', 'Lokacija / objekt', m.location ?? '—', '')
  push('Kontekst', 'Datum meritve', m.createdAt.slice(0, 10), '')
  push('Kontekst', 'Operater', m.authorName ?? '—', '')
  push('Meritev', 'Način', m.mode ?? m.type, '')
  push('Meritev', 'Vir', m.source ?? '—', '')
  // R501 (issue #15 faza 2): PROVENIENCA v izvozu — kdo je odgovoren za številko
  // in ali je merilo dokazano. Brez tega vrstica 'Dolžina' izgleda enako ne glede
  // na to, ali gre za oceno ali potrjeno mero.
  if (m.status) {
    push('Provenienca', 'Stanje zapisa', MEASUREMENT_STATUS_LABELS[m.status as MeasurementStatus] ?? m.status, '')
    push('Provenienca', 'Poslovna mera dovoljena', measurementStatusAllowsBusiness(m.status) ? 'DA' : 'NE', '')
    if (m.statusNote) push('Provenienca', 'Obrazložitev stanja', m.statusNote, '')
  }
  push('Meritev', 'Dolžina', m.lengthCm != null ? r1(m.lengthCm).toString().replace('.', ',') : '—', 'cm')
  if (m.heightCm != null) push('Meritev', 'Višina', r1(m.heightCm).toString().replace('.', ','), 'cm')
  if (m.slopeDeg != null) push('Meritev', 'Nagib', String(m.slopeDeg), '°')
  if (m.posts != null) push('Meritev', 'Stebri', String(m.posts), 'kos')
  if (m.segments != null) push('Meritev', 'Segmenti', String(m.segments), '')
  const cal = m.params?.calibration
  if (cal?.method) push('Reference', 'Kalibracija', cal.method, '')
  if (cal?.refObject) push('Reference', 'Referenčni objekt', cal.refObject, '')
  if (cal?.px != null && cal?.cm != null) push('Reference', 'Referenčna mera', `${r1(cal.cm).toString().replace('.', ',')} / ${Math.round(cal.px)}`, 'cm / px')
  // R500 (issue #15 faza 1): merilo in veljavnost po količinah morata biti
  // vidna v izvozu — sicer bi PDF/CSV pustil vtis, da je številka brez vira.
  const sc = m.params?.engine?.scale
  if (sc) {
    push('Merilo', 'Baza merila', sc.basis, '')
    if (sc.cmPerPxX != null) push('Merilo', 'cm/px (smer X)', f2(sc.cmPerPxX), 'cm/px')
    if (sc.cmPerPxY != null && sc.cmPerPxY !== sc.cmPerPxX) push('Merilo', 'cm/px (smer Y)', f2(sc.cmPerPxY), 'cm/px')
    if (sc.tiltDeg != null) push('Merilo', 'Nagib naprave', f1(sc.tiltDeg), '°')
    push('Merilo', 'Pravokotnost dokazana', sc.isotropicProven ? 'DA' : 'NE (predpostavka)', '')
    sc.reasons.slice(0, 3).forEach((r, i) => push('Merilo', `Obrazložitev ${i + 1}`, r, ''))
  }
  const vl = m.params?.engine?.validity
  if (vl) {
    push('Veljavnost', 'Status meritve', vl.status, '')
    push('Veljavnost', 'Poslovna mera dovoljena', vl.businessMeasureAllowed ? 'DA' : 'NE', '')
    vl.quantities.forEach((q) => push('Veljavnost', KOLICINA_LABEL[q.quantity], `${q.state} — ${q.note}`, ''))
  }
  const conf = m.params?.confidence
  if (conf != null) push('Zaupanje', 'Confidence', String(conf), '%')
  const q = m.params?.quality
  if (q && typeof q.brightness === 'number') push('Zaupanje', 'Svetlost zajema', String(q.brightness), '0–255')
  if (q && typeof q.blurScore === 'number') push('Zaupanje', 'Ostrost (Laplace)', String(q.blurScore), '')
  // R487 (issue #3 §4C): konsolidacija pogledov v izvozu — povprečje,
  // razpršenost in izrecen zapis konflikta (NE tiho poravnano).
  const mv = m.params?.multiView
  if (mv) {
    push('Pogledi', 'Število pogledov', mv.count != null ? String(Math.round(mv.count)) : '—', '')
    if (mv.mean != null) push('Pogledi', 'Povprečje', f1(mv.mean), 'cm')
    if (mv.spreadPct != null) push('Pogledi', 'Razpršenost', f1(mv.spreadPct), '%')
    push('Pogledi', 'Strinjanje', mv.conflict ? (mv.manualOverride ? 'KONFLIKT — rešen z ročnim popravkom' : 'KONFLIKT') : 'strinjajo se', '')
  }
  if (m.params?.photoId) push('Viri', 'Fotografija', m.params.photoId, 'id')
  if (m.note) push('Opombe', 'Opomba', m.note, '')
  // domenski rezultat (§8–§11)
  const d = m.params?.engine?.domain ?? null
  if (d) {
    const g = 'Domenski paket'
    switch (d.mode) {
      case 'OGRAJA':
        push(g, 'Skupna dolžina', f1(d.totalLengthCm), 'cm')
        push(g, 'Stebri', fi(d.posts), 'kos')
        push(g, 'Razmak stebrov', fi(d.spacingCm), 'cm')
        push(g, 'Ročnik', f2(d.handrailM), 'm')
        push(g, 'Površina polnila', f2(d.infillM2), 'm²')
        break
      case 'KERAMIKA':
        push(g, 'Bruto površina', f2(d.areaM2), 'm²')
        push(g, 'Neto površina', f2(d.netAreaM2), 'm²')
        push(g, 'Ploščice', fi(d.tilesCount), 'kos')
        push(g, 'Odpad', fi(d.wastePct), '%')
        push(g, 'Lepak (C2)', fi(d.adhesiveKg), 'kg')
        push(g, 'Fuga', fi(d.fugueKg), 'kg')
        break
      case 'STREHA':
        push(g, 'Površina ploskve', f2(d.faceAreaM2), 'm²')
        push(g, 'Naklon', fi(d.pitchDeg), '°')
        push(g, 'Slemen', f1(d.ridgeCm), 'cm')
        push(g, 'Material z odpadom', f2(d.materialM2), 'm²')
        break
      case 'FASADA':
        push(g, 'Bruto površina', f2(d.grossM2), 'm²')
        push(g, 'Odprtine', f2(d.openingsM2), 'm²')
        push(g, 'Neto površina', f2(d.netM2), 'm²')
        break
      case 'STOPNICE':
        push(g, 'Št. stopnic', fi(d.steps), '')
        push(g, 'Vzpon', f1(d.riseCm), 'cm')
        push(g, 'Čežnost', f1(d.runCm), 'cm')
        push(g, 'Nagib', fi(d.angleDeg), '°')
        break
      case 'PROSTOR':
        push(g, 'Površina', f2(d.areaM2), 'm²')
        push(g, 'Obseg', f1(d.perimeterCm), 'cm')
        if (d.rectangleOk != null) push(g, 'Pravokotnost', d.rectangleOk ? 'DA (diagonali enaki)' : 'NE (diagonali odstopata)', '')
        break
      case 'SPLOSNO':
        push(g, 'Skupna dolžina', f1(d.totalLengthCm), 'cm')
        break
    }
    // issue #15 faza 4: izvor domenskih številk MORA biti v izvozu. Brez te
    // skupine bi bil »Naklon 35°« v PDF-ju videti enako, če ga je monter izmeril
    // ali pa ga je predpostavila koda.
    const neizmerjeni = domainInputs(d).filter((x) => x.vir !== 'VNOS')
    if (neizmerjeni.length > 0) {
      const vg = 'Viri domenskih vhodov'
      push(vg, 'Opozorilo', 'Spodnje številke NISO izmerjene na terenu.', '')
      neizmerjeni.forEach((x) => push(vg, x.label, `${x.vrednost === '—' ? '' : `${x.vrednost} ${x.enota}`.trim()} — ${INPUT_SOURCE_LABELS[x.vir]}`.trim(), ''))
    }
  }
  const val = m.params?.engine?.validation
  if (val && val.length > 0) {
    val.forEach((i, k) => push('Geometrijska kontrola', `${k + 1}. ${i.severity}`, i.message, ''))
  } else if (val) {
    push('Geometrijska kontrola', 'Status', 'brez ugotovitev — geometrija v redu', '')
  }
  return rows
}

/** CSV izvoz: podpično ločeno, UTF-8 BOM glava se doda v ruti (§19). */
export function exportCsv (m: ExportSource): string {
  const esc = (s: string): string => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const head = 'Skupina;Polje;Vrednost;Enota'
  const rows = buildExportRows(m).map((r) => [r.skupina, r.polje, r.vrednost, r.enota].map(esc).join(';'))
  return [head, ...rows].join('\r\n')
}

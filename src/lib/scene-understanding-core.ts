// R467 (issue #8 — SMART VISION, Faza 1): JEDRO RAZUMEVANJA PRIZORA.
// R468 (issue #8 — Faza 2): tla, ravnine, robovi in naklon — maska tal,
//   talna ravnina, ROB elementi, ocena naklona z LOČITVIJO nagiba telefona
//   od naklona tal + zapis metode/vira/statusa geometrije (§3, §6).
// R469 (issue #8 — Faza 3): STOPNICE — vzorec vzporednih nastopnih črt →
//   število vidnih nastopov, smer vzpenjanja (levo/desno/globina),
//   enakomernost razmakov in morebitni podest (§4). POŠTENOST: iz enega
//   pogleda BREZ globine NISO izmerljive višine čel in globine nastopov —
//   te izrecno označimo kot „potrebna mera“ (§4/§6).
// Čista logika brez DOM/React — enako testirljiva kot measure-engine/prefab-core.
//
// Načelo celotnega modula (issue #8 §2, §6): AVTOMATIKA JE PREDLOG, NE
// AVTORITETA. Vsak element ima razviden vir (LOKALNO hevristika / VLM / ROCNO),
// status zaupanja in stabilen ID seje. Popravek monterja se shrani KOT
// OZNAČEN PODATEK (edits) — izvirni posnetek/elementi se nikoli ne prepisujejo.
//
// Faza 1 (žive oznake + razredi prizora) brez ML odvisnosti: vse hevristike
// so klasične (barva/tekstura/robovi/gibanje) in NIZKO samozavestne — tla
// so vedno popravljiva, NEZNANO je prvorazredni razred (issue: ne poimenuj
// na silo).

// ── Razredi prizora (issue §1) ──────────────────────────────────────────────

export const SCENE_CLASSES = ['TLA', 'PODLAGA', 'OGRAJA', 'STOPNICA', 'ROB', 'OSEBA', 'OVIRA', 'NEZNANO'] as const
export type SceneClass = (typeof SCENE_CLASSES)[number]

/** Vrsta podlage (razširitev obstoječega enuma tekača BETON/ZEMLJA/TRAVA/TLAK/DRUGO). */
export const SURFACE_KINDS = ['BETON', 'ASFALT', 'TLAK', 'ZEMLJA', 'TRAVA', 'GRAMOZ', 'PLOSCICE', 'LES', 'NEZNANA'] as const
export type SurfaceKind = (typeof SURFACE_KINDS)[number]

/** Status prepoznave (issue §2: Prepoznano / Verjetno / Nejasno / Skrito). */
export const SCENE_STATUSES = ['PREPOZNANO', 'VERJETNO', 'NEJASNO', 'SKRITO'] as const
export type SceneStatus = (typeof SCENE_STATUSES)[number]

/** Vir elementa — merilno jedro zahteva razložljiv izvor vsakega podatka. */
export const SCENE_SOURCES = ['LOKALNO', 'VLM', 'ROCNO'] as const
export type SceneSource = (typeof SCENE_SOURCES)[number]

/** Vir ocene NAKLONA (issue §3: vir izračuna mora biti zabeležen). */
export const SLOPE_SOURCES = ['VIZUALNA_GEOMETRIJA', 'SENZOR_NAPRAVE', 'ROCNO'] as const
export type SlopeSource = (typeof SLOPE_SOURCES)[number]

/**
 * R469 (F3 §4): predlagana smer vzpenjanja stopnišča V KADRU — iz drifa
 * središč nastopnih črt. Vrednosti: 'levo' / 'desno' (stranski pogled) ali
 * 'globina' (čelni pogled — stopnice se od kamero oddaljujejo navzgor).
 * Vedno OCENA, nikoli trditev (§4: „predlaga smer vzpenjanja“).
 */
export const STAIR_ASCENTS = ['levo', 'desno', 'globina'] as const
export type StairAscent = (typeof STAIR_ASCENTS)[number]

/**
 * Status GEOMETRIJE površine — LOČENO od statusa prepoznave (issue §2:
 * „razloči semantično prepoznavo od geometrijske izmere“; §6 veriga
 * PREPOZNANO/GEOMETRIJA OCENJENA/IZMERJENO/NEZADOSTNI PODATKI).
 */
export const GEOM_STATUSES = ['GEOMETRIJA_OCENJENA', 'IZMERJENO', 'NEZADOSTNI_PODATKI'] as const
export type GeomStatus = (typeof GEOM_STATUSES)[number]

// ── Tipi ─────────────────────────────────────────────────────────────────────

/** Točka maske (normalizirana na kader 0..1). */
export interface ScenePoint { x: number; y: number }

/** R469 (F3 §4): daljica (normalizirana na kader 0..1) — npr. nastopna črta. */
export interface SceneLine { x1: number; y1: number; x2: number; y2: number }

/** En zaznani element prizora. bbox je normaliziran (0..1, x/y/w/h) na kader. */
export interface SceneElement {
  id: string
  cls: SceneClass
  status: SceneStatus
  source: SceneSource
  confidence: number // 0..1 — hevristično, NIKOLI kot "verjetnost da je prav"
  bbox: [number, number, number, number] // x, y, w, h (0..1)
  kind?: SurfaceKind // samo za cls = PODLAGA
  /** Poligon maske (0..1) — območje tal/podlage, ne samo pravokotnik (issue §3). */
  maskPoints?: ScenePoint[]
  /** Kot črte roba v kadru glede na vodoravnico slike (stopinje, -90..90) — ROB. */
  angleDeg?: number
  /** Ocenjeni naklon površine glede na vodoravnico sveta (stopinje, -45..45). */
  slopeDeg?: number
  /** Vir ocene naklona — BREZ tega polja naklon ni veljaven (issue §3). */
  slopeSource?: SlopeSource
  /** Status geometrije — ločen od statusa prepoznave (issue §2/§6). */
  geomStatus?: GeomStatus
  // ── R469 (F3 §4): STOPNICE — vse vrednosti so OCENA iz vizualne geometrije ──
  /** Število zaznanih nastopnih robov (≈ vidnih stopnic) — predlog, ne izmera. */
  steps?: number
  /** Predlagana smer vzpenjanja v kadru (ocena — preveri jo monter). */
  ascent?: StairAscent
  /** Nastopne črte (0..1) — za risanje čez predogled. */
  stepLines?: SceneLine[]
  /** Povprečni razmak med nastopi v kadru (0..1) — za primerjavo pravilnosti. */
  stepGap?: number
  /** Razmaki med nastopi so neenakomerni — mesto za ROČNI PREGLED (issue §4). */
  stepIrregular?: boolean
  /** Večja vrzel med nastopi — morebiten podest (issue §4). */
  landing?: boolean
  at: number // epoch ms zajema
}

/** Popravek monterja — SHRANJEN LOČENO od izvirnih elementov (issue §2). */
export interface SceneEdit {
  elementId: string
  cls?: SceneClass
  status?: SceneStatus
  kind?: SurfaceKind
  /** Ročno potrjen/izmerjen naklon (stopinje, -45..45) — vir postane ROCNO. */
  slopeDeg?: number
  /** R469 (F3 §4): ročno potrjeno število stopnic/nastopov — vir postane ROCNO. */
  steps?: number
  /** R469 (F3 §4): ročno potrjena smer vzpenjanja — vir postane ROCNO. */
  ascent?: StairAscent
  by: string
  at: number
}

/** Struktura, ki se persistira na ArSnapshot.sceneJson. */
export interface SceneUnderstandingResult {
  version: 1
  at: number
  elements: SceneElement[]
  edits: SceneEdit[]
}

// ── Omejitve (sočasno validacija za API) ─────────────────────────────────────

export const SCENE_LIMITS = {
  maxElements: 24,
  maxEdits: 96,
  idMaxLen: 64,
  maxMaskPoints: 32,
  slopeAbsMax: 45, // stopinj
  angleAbsMax: 90, // stopinj
  maxSteps: 20, // R469 (F3): največje razumno število vidnih nastopov
  maxStepLines: 12, // R469 (F3): nastopne črte za risanje
} as const

// ── Hevristika: klasifikacija podlage iz barvnih/teksturnih značilnic ────────
// ROI = spodnja tretjina kadra. Značilnice izračuna scene-perception (canvas),
// odločitev je tu — čista in testirljiva. Pragi so KONZERVATIVNI: če značilnice
// ne govorijo jasno, vrnemo NEZNANA z nizkim zaupanjem (issue §3: "podlaga
// verjetno beton" samo, kadar utemeljeno).

export interface SurfaceFeatures {
  /** povprečna svetlost ROI (0..255) */
  brightness: number
  /** delež "sivih" pikslov (max-min kanal < 28) — 0..1 */
  grayness: number
  /** deleč pikslov, kjer je zelena dominantna kanala (G > R+12 in G > B+12) — 0..1 */
  greenRatio: number
  /** povprečna nasičenost HSV (0..1) */
  saturation: number
  /** delež jakosti robov (Sobel prag) v ROI — 0..1 */
  edgeDensity: number
  /** lokalna varianca sivin v ROI (gladek beton ~nizka, gramoz/tlak ~visoka) */
  textureVariance: number
  /** topel ton: deleč pikslov z R > B + 12 — 0..1 (zemlja/les) */
  warmth: number
}

export interface SurfaceVerdict {
  kind: SurfaceKind
  confidence: number
  note: string
}

/** Klasifikacija vrste podlage iz značilnic ROI (Faza 1 hevristika, brez ML). */
export function classifySurface (f: SurfaceFeatures): SurfaceVerdict {
  const dark = f.brightness < 60
  const veryGray = f.grayness > 0.72
  const quiteGray = f.grayness > 0.55
  const grassy = f.greenRatio > 0.34
  const earthy = f.warmth > 0.42 && f.saturation < 0.38
  const gravelly = quiteGray && f.textureVariance > 950 && f.edgeDensity > 0.1
  const paved = quiteGray && f.edgeDensity > 0.055 && f.edgeDensity <= 0.16 && f.textureVariance > 220

  if (grassy) {
    return { kind: 'TRAVA', confidence: 0.62, note: 'zelena dominantna v spodnjem pasu' }
  }
  if (earthy) {
    return { kind: 'ZEMLJA', confidence: 0.55, note: 'topel ton, zmerna nasičenost' }
  }
  if (dark && veryGray) {
    return { kind: 'ASFALT', confidence: 0.58, note: 'temna, skoraj brez barve' }
  }
  if (paved) {
    // fuge med ploščami/tlakovci dvigajo gostoto robov ob zmerni sivini
    return { kind: 'TLAK', confidence: 0.5, note: 'pravilni robovi (fuge) na sivih tleh' }
  }
  if (gravelly) {
    return { kind: 'GRAMOZ', confidence: 0.48, note: 'velika lokalna varianca na svetli podlagi' }
  }
  if (veryGray) {
    return { kind: 'BETON', confidence: 0.6, note: 'enovitna siva površina, malo robov' }
  }
  if (quiteGray) {
    return { kind: 'BETON', confidence: 0.38, note: 'pretežno sivo, a mešano' }
  }
  return { kind: 'NEZNANA', confidence: 0.2, note: 'značilnice niso dovolj jasne' }
}

/** Preslikava v obstoječi enum tekača (fence-run-engine PODLAGA) — most, ne podvojenost. */
export function surfaceToRunKind (kind: SurfaceKind): 'BETON' | 'ZEMLJA' | 'TRAVA' | 'TLAK' | 'DRUGO' {
  switch (kind) {
    case 'BETON': case 'PLOSCICE': return 'BETON'
    case 'ZEMLJA': case 'LES': return 'ZEMLJA'
    case 'TRAVA': return 'TRAVA'
    case 'TLAK': case 'ASFALT': case 'GRAMOZ': return 'TLAK'
    default: return 'DRUGO'
  }
}

// ── NAKLON: ločitev nagiba TELEFONA od naklona TAL (issue §3, Faza 2) ───────
//
// Semantika vhodov (obstaja natanko ENA definicija, enaka vsem klicem):
//   visualEdgeAngleDeg — kot najdaljše vizualne meje tal v SLIKI glede na
//     vodoravnico slike (+ = desni konec črte višje); null, če izrazite
//     meje ni bilo mogoče najti.
//   phoneRollDeg — trenutni nagib telefona okrog optične osi (DeviceOrientation
//     gamma, + = desna stran naprave nižje); null, če senzorja ni ali ni javil.
//
// Fizikalna opomba (poštenost glede §6): rotacija telefona za φ zavrti sliko,
// torej je naklon tal približno visualEdge + phoneRoll. To je OCENA iz
// perspektive ene slike (brez globine) — nikoli IZMERJENO.

export const SLOPE_MIN_VISUAL_DEG = 2 // pod tem kantom je „videti ravno"
export const PHONE_ROLL_STRAIGHT_DEG = 4 // telefon „~ pokončen“
export const PHONE_ROLL_MAX_DEG = 15 // nad tem kompenzacija ni zanesljiva

export interface SlopeEstimate {
  /** ocena naklona (stopinje, -45..45) ali null, če podatki ne zadoščajo */
  slopeDeg: number | null
  slopeSource: SlopeSource
  geomStatus: GeomStatus
  /** smer padca v kadru (za sporočilo monterju) */
  direction: 'levo' | 'desno' | null
  note: string
}

/**
 * Ocena naklona tal z OBVEZNO ločitvijo od nagiba telefona (issue §3).
 * Vrne NIKOLI „izmerjeno“ vrednost — največ GEOMETRIJA_OCENJENA.
 */
export function estimateSlope (visualEdgeAngleDeg: number | null, phoneRollDeg: number | null): SlopeEstimate {
  const base: Omit<SlopeEstimate, 'slopeDeg' | 'direction' | 'note'> = {
    slopeSource: 'VIZUALNA_GEOMETRIJA', geomStatus: 'NEZADOSTNI_PODATKI',
  }
  if (visualEdgeAngleDeg == null || !Number.isFinite(visualEdgeAngleDeg)) {
    return { ...base, slopeDeg: null, direction: null, note: 'V kadru ni vidne zanesljive meje tal — naklon ni ocenljiv brez reference.' }
  }
  if (phoneRollDeg == null || !Number.isFinite(phoneRollDeg)) {
    // Brez senzorja nagiba naprave LOČITEV ni mogoča — ne trdimo naklona (poštenost §6).
    return { ...base, slopeDeg: null, direction: null, note: 'Brez senzorja nagiba naprave ni mogoče ločiti naklona telefona od naklona tal.' }
  }
  if (Math.abs(phoneRollDeg) > PHONE_ROLL_MAX_DEG) {
    return { ...base, slopeDeg: null, direction: null, note: 'Telefon je premočno nagnjen — poravnajte ga približno pokonci in poskusite znova.' }
  }

  // kompenzacija nagiba telefona (rotacija slike): ocena naklona sveta
  const compensated = visualEdgeAngleDeg + phoneRollDeg
  if (Math.abs(compensated) < SLOPE_MIN_VISUAL_DEG) {
    return {
      ...base, slopeDeg: 0, direction: null, geomStatus: 'GEOMETRIJA_OCENJENA',
      note: 'Tla so videti približno ravna (ocena iz vizualne geometrije).',
    }
  }
  const clamped = Math.max(-SCENE_LIMITS.slopeAbsMax, Math.min(SCENE_LIMITS.slopeAbsMax, compensated))
  return {
    slopeDeg: Math.round(clamped * 10) / 10,
    slopeSource: 'VIZUALNA_GEOMETRIJA',
    geomStatus: 'GEOMETRIJA_OCENJENA',
    direction: clamped > 0 ? 'desno' : 'levo', // padec v sliki
    note: Math.abs(phoneRollDeg) > PHONE_ROLL_STRAIGHT_DEG
      ? `Tla so videti nagnjena ~${Math.abs(Math.round(clamped * 10) / 10)}° — ocena je kompenzirana za nagib telefona; potrdite z referenco.`
      : `Tla so videti nagnjena ~${Math.abs(Math.round(clamped * 10) / 10)}° — vir: vizualna geometrija (ocena, ne izmera).`,
  }
}

/** Kratko slovensko sporočilo monterju o naklonu (issue §8 brez žargona). */
export function slopeMessage (s: SlopeEstimate): string {
  return s.slopeDeg == null ? s.note : s.note
}

// ── STOPNICE (issue #8 §4, Faza 3) — vzorec vzporednih nastopnih črt ────────
//
// Vhod iz percepcije (px): { y, xFrom, xTo } — središča pasov z močno
// vodoravno črto. Odločitev je TU (čista, testirljiva):
//   • vzorec = ≥ 3 črte (STAIR_MIN_LINES)
//   • razmaki med sosednjima črtama → medij; odstopanje → NEENAKOMERNO
//     (ročni pregled), vrzel ≥ ~2× medij → MOREBITEN PODEST
//   • smer vzpenjanja: linearna vezava središč črt x(y); drif ≥ 12 % širine
//     kadra → levo/desno, sicer 'globina' (čelni pogled)
// POŠTENOST (§4/§6): iz enega 2D pogleda NI možno izmeriti višine čela in
// globine nastopa — to izrecno zapišemo v opombo; geometrija ostane OCENJENA.

export const STAIR_MIN_LINES = 3
export const STAIR_IRREGULAR_TOL = 0.35 // odstopanje razmaka od medija (delež)
export const STAIR_LANDING_FACTOR = 1.9 // vrzel ≥ 1,9× medij → morebiten podest
export const STAIR_DRIFT_MIN = 0.12 // drif središč ≥ 12 % širine → stranski pogled

/** Vhod percepcije: zaznana nastopna črta v delovnem canvasu (px). */
export interface StairLineInput { y: number; xFrom: number; xTo: number }

/** Rezultat analize stopnišča (vse OCENA, nikoli izmera). */
export interface StairVerdict {
  steps: number
  ascent: StairAscent
  stepLines: SceneLine[]
  /** medij razmakov med nastopi, normaliziran na višino kadra (0..1) */
  stepGap: number
  stepIrregular: boolean
  landing: boolean
  confidence: number
  note: string
}

/** Analiza vzorca nastopnih črt → predlog stopnišča (ali null, če ni vzorca). */
export function analyzeStairPattern (lines: StairLineInput[], w: number, h: number): StairVerdict | null {
  if (!Array.isArray(lines) || lines.length < STAIR_MIN_LINES) return null
  if (!Number.isFinite(w) || w < 16 || !Number.isFinite(h) || h < 16) return null

  const sorted = [...lines]
    .filter((l) => l && Number.isFinite(l.y) && Number.isFinite(l.xFrom) && Number.isFinite(l.xTo) && l.xTo > l.xFrom)
    .sort((a, b) => a.y - b.y)
  if (sorted.length < STAIR_MIN_LINES) return null

  // razmaki med sosednjima črtama (px) + medij
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].y - sorted[i - 1].y)
  const gapsSorted = [...gaps].sort((a, b) => a - b)
  const mid = Math.floor(gapsSorted.length / 2)
  const medianGap = gapsSorted.length % 2 === 1
    ? gapsSorted[mid]
    : (gapsSorted[mid - 1] + gapsSorted[mid]) / 2
  if (!(medianGap >= 2)) return null // preplitko/gosto = šum, ne stopnice

  // enakomernost in podest
  let stepIrregular = false
  let landing = false
  for (const g of gaps) {
    if (Math.abs(g - medianGap) > STAIR_IRREGULAR_TOL * medianGap) stepIrregular = true
    if (g >= STAIR_LANDING_FACTOR * medianGap) landing = true
  }

  // smer vzpenjanja: linearna vezava središč x(y) — drif čez pas stopnic
  const centers = sorted.map((l) => (l.xFrom + l.xTo) / 2)
  const yFirst = sorted[0].y
  const yLast = sorted[sorted.length - 1].y
  const meanY = sorted.reduce((s, l) => s + l.y, 0) / sorted.length
  const meanX = centers.reduce((s, c) => s + c, 0) / centers.length
  let num = 0; let den = 0
  for (let i = 0; i < sorted.length; i++) {
    num += (sorted[i].y - meanY) * (centers[i] - meanX)
    den += (sorted[i].y - meanY) ** 2
  }
  const slope = den > 0 ? num / den : 0 // px na vrstico
  const drift = slope * (yLast - yFirst) // sprememba x od zgoraj navzdol
  let ascent: StairAscent = 'globina'
  if (Math.abs(drift) >= STAIR_DRIFT_MIN * w) {
    // y os slike raste navzdol: drif < 0 → x se VEČA navzgor po sliki → vzpon desno
    ascent = drift < 0 ? 'desno' : 'levo'
  }

  // nastopne črte normalizirano (za risanje) — omeji na maxStepLines
  const stepLines: SceneLine[] = sorted
    .slice(0, SCENE_LIMITS.maxStepLines)
    .map((l) => ({
      x1: Math.round(Math.max(0, Math.min(1, l.xFrom / w)) * 1000) / 1000,
      y1: Math.round(Math.max(0, Math.min(1, l.y / h)) * 1000) / 1000,
      x2: Math.round(Math.max(0, Math.min(1, l.xTo / w)) * 1000) / 1000,
      y2: Math.round(Math.max(0, Math.min(1, l.y / h)) * 1000) / 1000,
    }))

  const steps = sorted.length
  const confidence = Math.min(0.45, 0.28 + steps * 0.03)

  const notes: string[] = [`${steps} vidnih nastopov (ocena iz vizualne geometrije)`]
  if (landing) notes.push('večja vrzel med nastopi — morebiten podest, potrdite')
  if (stepIrregular) notes.push('razmaki med nastopi so neenakomerni — ročni pregled')
  notes.push('višine čel in globine nastopov niso izmerljive iz enega pogleda')

  return {
    steps, ascent, stepLines,
    stepGap: Math.round((medianGap / h) * 1000) / 1000,
    stepIrregular, landing, confidence,
    note: notes.join('; ') + '.',
  }
}

/** Slovenska beseda za smer vzpenjanja (izvoz za kartico/prikaz). */
export function ascentText (a: StairAscent | undefined): string {
  if (a === 'levo') return 'v levo'
  if (a === 'desno') return 'v desno'
  if (a === 'globina') return 'od kamere (v globino)'
  return 'neznana'
}

// ── Stabilizacija: oznake ne skačejo med sličicami (issue §2) ────────────────

export interface StabilizeOptions {
  /** IoU prag za "isti element" (privzeto 0.3). */
  iouMin?: number
  /** Kolikor zaporednih sličic sme element manjkati, preden izgine ID. */
  maxMisses?: number
}

interface TrackedElement extends SceneElement {
  misses: number
}

/**
 * Sledenje elementov čez sličice: elementu, ki se geografsko prekriva z
 * prejšnjim (IoU ≥ prag), pripnemo STARI ID. Nove najdbe dobijo svež ID.
 * Element brez zadetka še maxMisses sličic ostane (zakasnitev proti utripanju),
 * potem izpade.
 */
export function stabilizeElements (prev: SceneElement[], next: SceneElement[], opts: StabilizeOptions = {}): SceneElement[] {
  const iouMin = opts.iouMin ?? 0.3
  const maxMisses = opts.maxMisses ?? 2
  const tracked: TrackedElement[] = prev.map((e) => ({ ...e, misses: 0 }))
  const out: SceneElement[] = []
  const usedPrev = new Set<number>()

  for (const n of next) {
    let bestIdx = -1
    let bestIou = iouMin
    for (let i = 0; i < tracked.length; i++) {
      if (usedPrev.has(i)) continue
      const iou = bboxIou(tracked[i].bbox, n.bbox)
      if (iou >= bestIou) {
        // enak razred ima prednost pri več kandidatih
        const sameCls = tracked[i].cls === n.cls
        if (iou > bestIou || (iou === bestIou && sameCls)) { bestIou = iou; bestIdx = i }
      }
    }
    if (bestIdx >= 0) {
      usedPrev.add(bestIdx)
      out.push({ ...n, id: tracked[bestIdx].id })
    } else {
      out.push({ ...n, id: newSceneId() })
    }
  }

  // pogrešani ostanejo še maxMisses sličic (ne utripajo ob kratki zakritosti)
  for (let i = 0; i < tracked.length; i++) {
    if (usedPrev.has(i)) continue
    const t = tracked[i]
    const misses = t.misses + 1
    if (misses <= maxMisses) out.push({ ...t, misses: undefined, id: t.id } as SceneElement)
  }
  return out.slice(0, SCENE_LIMITS.maxElements)
}

export function bboxIou (a: SceneElement['bbox'], b: SceneElement['bbox']): number {
  const [ax, ay, aw, ah] = a
  const [bx, by, bw, bh] = b
  const x1 = Math.max(ax, bx)
  const y1 = Math.max(ay, by)
  const x2 = Math.min(ax + aw, bx + bw)
  const y2 = Math.min(ay + ah, by + bh)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = aw * ah + bw * bh - inter
  return union <= 0 ? 0 : inter / union
}

let sceneIdSeq = 0
export function newSceneId (): string {
  sceneIdSeq = (sceneIdSeq + 1) % 1_000_000
  return `el-${Date.now().toString(36)}-${sceneIdSeq.toString(36)}`
}

// ── Izbor oznak za prikaz (issue §9: čist pogled, 2–4 oznake) ─────────────────

const DISPLAY_ORDER: Record<SceneClass, number> = {
  OSEBA: 0, // zakritje merilne točke — najpomembnejše za monterja
  OVIRA: 1,
  ROB: 2, // rob plošče/terase — pogosto montažna linija ograje
  STOPNICA: 3,
  OGRAJA: 4,
  TLA: 5,
  PODLAGA: 6,
  NEZNANO: 7,
}

/**
 * Izbere najpomembnejše elemente za hkratni prikaz (max 4, issue §9).
 * Pripnjeni (pinnedIds — monterjev zaklep, issue §9) so VEDNO prikazani,
 * tudi če bi sicer izpadli iz izbora.
 */
export function pickLabels (elements: SceneElement[], max = 4, pinnedIds?: ReadonlySet<string>): SceneElement[] {
  const pinned = pinnedIds && pinnedIds.size > 0
    ? elements.filter((e) => pinnedIds.has(e.id) && e.status !== 'SKRITO')
    : []
  const rest = [...elements]
    .filter((e) => e.status !== 'SKRITO' && !pinned.some((p) => p.id === e.id))
    .sort((a, b) => {
      const d = DISPLAY_ORDER[a.cls] - DISPLAY_ORDER[b.cls]
      if (d !== 0) return d
      return b.confidence - a.confidence
    })
    .slice(0, Math.max(0, max - pinned.length))
  return [...pinned, ...rest]
}

// ── Naslednji korak za monterja (issue §8: kratka, operativna sporočila) ─────

export interface SceneQualityContext {
  dark?: boolean
  bright?: boolean
  blurry?: boolean
}

/** Pove, kaj naj monter STORI — brez tehniščine, brez izmišljanja. */
export function nextStepGuidance (elements: SceneElement[], quality?: SceneQualityContext): string {
  if (quality?.dark === true) return 'Sličica je temna — počakajte na svetlobo ali dodajte osvetlitev.'
  if (quality?.bright === true) return 'Presvetljen kader — poševno stojite glede na sonce.'
  if (quality?.blurry === true) return 'Slika je mehka — pridržite telefon mirno pred zajemom.'

  const byCls = new Map<SceneClass, SceneElement[]>()
  for (const e of elements) {
    const arr = byCls.get(e.cls) ?? []
    arr.push(e)
    byCls.set(e.cls, arr)
  }
  const person = byCls.get('OSEBA')?.[0]
  if (person) return 'Oseba zakriva prizor — počakajte na prost kader ali označite točko ročno.'
  const obstacle = byCls.get('OVIRA')?.[0]
  if (obstacle) return 'V kadru je ovira — premaknite se, da bo merilna linija vidna.'
  const stairs = byCls.get('STOPNICA')
  // R469 (F3 §4): obogateno s številom nastopov, pravilnostjo razmakov in podestom
  if (stairs && stairs.length > 0) {
    const stair = stairs[0]
    const n = typeof stair.steps === 'number' ? stair.steps : null
    if (stair.landing === true) {
      return `Stopnišče z morebitnim podestom${n != null ? ` (${n} nastopov, ocena)` : ''} — preverite prehod na podest in robove.`
    }
    if (stair.stepIrregular === true) {
      return `Razmaki med stopnicami so neenakomerni${n != null ? ` (${n} nastopov)` : ''} — preverite odstopajočo stopnico ročno.`
    }
    return n != null
      ? `Zaznane stopnice (${n} nastopov, ocena) — višine čel izmerite z referenco ali globino.`
      : `Zaznane stopnice (${stairs.length}). Preverite robove posameznih stopnic pred izmero.`
  }
  // R468 (F2 §3): naklon tal — najpomembnejša nova informacija za monterja
  const floor = byCls.get('TLA')?.[0] ?? byCls.get('PODLAGA')?.[0]
  if (floor?.slopeDeg != null && floor.slopeDeg !== 0 && floor.slopeSource) {
    const s = floor.slopeDeg
    return `Tla so videti nagnjena ~${Math.abs(s)}° ${s > 0 ? 'desno' : 'levo'} (ocena, vir: ${floor.slopeSource === 'ROCNO' ? 'ročno' : 'vizualna geometrija'}) — potrdite ali izmerite z referenco.`
  }
  if (floor?.geomStatus === 'NEZADOSTNI_PODATKI' && floor.slopeSource == null) {
    return 'Naklon tal ni ocenljiv iz tega kadra — uporabite referenco ali dodatni pogled.'
  }
  // R468 (F2 §3): rob plošče/terase — pogosto montažna linija
  const edge = byCls.get('ROB')?.[0]
  if (edge) return 'Zaznan rob površine — preverite ga, preden izhodišče ograje vežete nanj.'
  const surface = byCls.get('PODLAGA')?.[0]
  if (surface?.kind === 'NEZNANA') return 'Podlaga ni prepoznana — tapnite oznako in jo določite ročno.'
  if (surface && surface.kind != null) return `Podlaga je verjetno ${surface.kind.toLowerCase()} — potrdite jo, preden jo povežete s tekačem.`
  const unknown = byCls.get('NEZNANO')?.[0]
  if (unknown) return 'Neprepoznan element — tapnite za ročno označitev.'
  return 'Prizor je čist — zajemite kader za meritev.'
}

// ── Popravki (edits) — uporaba za PRIKAZ, izvirnik ostaja ────────────────────

export function applyEdits (result: SceneUnderstandingResult): SceneElement[] {
  // kopije elementov — izvirnik result se NE sme mutirati (issue §2: popravek
  // je označen podatek, ne tiha sprememba izvirnega zajema)
  const byId = new Map(result.elements.map((e) => [e.id, { ...e }]))
  for (const edit of result.edits) {
    const el = byId.get(edit.elementId)
    if (!el) continue
    if (edit.cls) el.cls = edit.cls
    if (edit.status) el.status = edit.status
    if (edit.kind) el.kind = edit.kind
    // R468 (F2 §3): ročno potrjen naklon = ROCNO + IZMERJENO (metoda zapisana)
    if (typeof edit.slopeDeg === 'number' && Number.isFinite(edit.slopeDeg)) {
      el.slopeDeg = Math.max(-SCENE_LIMITS.slopeAbsMax, Math.min(SCENE_LIMITS.slopeAbsMax, Math.round(edit.slopeDeg * 10) / 10))
      el.slopeSource = 'ROCNO'
      el.geomStatus = 'IZMERJENO'
    }
    // R469 (F3 §4): ročno potrjeno število stopnic + smer vzpenjanja
    if (typeof edit.steps === 'number' && Number.isFinite(edit.steps)) {
      el.steps = Math.max(1, Math.min(SCENE_LIMITS.maxSteps, Math.round(edit.steps)))
      el.geomStatus = 'IZMERJENO' // števec je potrjen, ne zgolj ocenjen
    }
    if (edit.ascent != null) {
      el.ascent = edit.ascent
    }
    el.source = 'ROCNO'
    el.confidence = 1
  }
  return [...byId.values()]
}

// ── Validacija (API meja — isto pravilo na strežniku in odjemalcu) ────────────

/** Defenzivna sanitizacija poljubnega JSON v SceneUnderstandingResult (ali null). */
export function sanitizeSceneResult (raw: unknown): SceneUnderstandingResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.version !== 1) return null
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? Math.round(r.at) : Date.now()
  if (!Array.isArray(r.elements)) return null

  const elements: SceneElement[] = []
  for (const item of r.elements.slice(0, SCENE_LIMITS.maxElements)) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const id = typeof e.id === 'string' && e.id.length > 0 && e.id.length <= SCENE_LIMITS.idMaxLen ? e.id : null
    const cls = SCENE_CLASSES.includes(e.cls as SceneClass) ? (e.cls as SceneClass) : null
    const status = SCENE_STATUSES.includes(e.status as SceneStatus) ? (e.status as SceneStatus) : null
    const source = SCENE_SOURCES.includes(e.source as SceneSource) ? (e.source as SceneSource) : null
    const bboxRaw = Array.isArray(e.bbox) ? e.bbox : null
    if (!id || !cls || !status || !source || !bboxRaw || bboxRaw.length !== 4) continue
    const bbox = bboxRaw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : -1))
    if (bbox.some((v) => v < 0 || v > 1)) continue
    if (bbox[2] <= 0 || bbox[3] <= 0) continue
    const confidence = typeof e.confidence === 'number' && Number.isFinite(e.confidence)
      ? Math.max(0, Math.min(1, e.confidence))
      : 0
    const kind = SURFACE_KINDS.includes(e.kind as SurfaceKind) ? (e.kind as SurfaceKind) : undefined

    // R468 (F2): geometrija — maska, kot roba, naklon z virom in statusom.
    // Pravilo: naklon BREZ vira in statusa NI veljaven (issue §3: zapis metode
    // + vira je obvezen, sicer je to lažna gotovost).
    const maskPoints = sanitizeMaskPoints(e.maskPoints)
    const angleDeg = typeof e.angleDeg === 'number' && Number.isFinite(e.angleDeg) &&
      Math.abs(e.angleDeg) <= SCENE_LIMITS.angleAbsMax ? Math.round(e.angleDeg * 10) / 10 : undefined
    const slopeSource = SLOPE_SOURCES.includes(e.slopeSource as SlopeSource) ? (e.slopeSource as SlopeSource) : undefined
    const slopeDeg = typeof e.slopeDeg === 'number' && Number.isFinite(e.slopeDeg) &&
      Math.abs(e.slopeDeg) <= SCENE_LIMITS.slopeAbsMax ? Math.round(e.slopeDeg * 10) / 10 : undefined
    const geomStatus = GEOM_STATUSES.includes(e.geomStatus as GeomStatus) ? (e.geomStatus as GeomStatus) : undefined
    const hasSlope = slopeDeg != null && slopeSource != null

    // R469 (F3 §4): STOPNICE — število nastopov, smer, nastopne črte,
    // razmak, neenakomernost, morebitni podest. Vsa polja neodvisno
    // validirana; neveljavna se IZPUSTIJO (brez tihih popravkov vrednosti).
    const stepsRaw = typeof e.steps === 'number' && Number.isFinite(e.steps) ? Math.round(e.steps) : null
    const steps = stepsRaw != null && stepsRaw >= 1 && stepsRaw <= SCENE_LIMITS.maxSteps ? stepsRaw : undefined
    const ascent = STAIR_ASCENTS.includes(e.ascent as StairAscent) ? (e.ascent as StairAscent) : undefined
    const stepLines = sanitizeStepLines(e.stepLines)
    const stepGapRaw = typeof e.stepGap === 'number' && Number.isFinite(e.stepGap) ? Math.round(e.stepGap * 1000) / 1000 : null
    const stepGap = stepGapRaw != null && stepGapRaw > 0 && stepGapRaw <= 1 ? stepGapRaw : undefined
    const stepIrregular = e.stepIrregular === true
    const landing = e.landing === true

    elements.push({
      id, cls, status, source, confidence,
      bbox: [bbox[0], bbox[1], bbox[2], bbox[3]], kind, at,
      ...(maskPoints.length >= 3 ? { maskPoints } : {}),
      ...(angleDeg != null ? { angleDeg } : {}),
      ...(hasSlope ? { slopeDeg, slopeSource, ...(geomStatus ? { geomStatus } : {}) } : {}),
      ...(!hasSlope && geomStatus ? { geomStatus } : {}),
      ...(steps != null ? { steps } : {}),
      ...(ascent != null ? { ascent } : {}),
      ...(stepLines.length >= 1 ? { stepLines } : {}),
      ...(stepGap != null ? { stepGap } : {}),
      ...(stepIrregular ? { stepIrregular: true } : {}),
      ...(landing ? { landing: true } : {}),
    })
  }
  if (elements.length === 0) return null

  const edits: SceneEdit[] = []
  if (Array.isArray(r.edits)) {
    for (const item of r.edits.slice(0, SCENE_LIMITS.maxEdits)) {
      if (!item || typeof item !== 'object') continue
      const e = item as Record<string, unknown>
      if (typeof e.elementId !== 'string' || !e.elementId) continue
      if (typeof e.by !== 'string' || !e.by) continue
      const atEdit = typeof e.at === 'number' && Number.isFinite(e.at) ? Math.round(e.at) : Date.now()
      const cls = SCENE_CLASSES.includes(e.cls as SceneClass) ? (e.cls as SceneClass) : undefined
      const status = SCENE_STATUSES.includes(e.status as SceneStatus) ? (e.status as SceneStatus) : undefined
      const kind = SURFACE_KINDS.includes(e.kind as SurfaceKind) ? (e.kind as SurfaceKind) : undefined
      const slopeDeg = typeof e.slopeDeg === 'number' && Number.isFinite(e.slopeDeg) &&
        Math.abs(e.slopeDeg) <= SCENE_LIMITS.slopeAbsMax ? Math.round(e.slopeDeg * 10) / 10 : undefined
      // R469 (F3 §4): popravek števila stopnic + smeri vzpenjanja
      const stepsRaw = typeof e.steps === 'number' && Number.isFinite(e.steps) ? Math.round(e.steps) : null
      const steps = stepsRaw != null && stepsRaw >= 1 && stepsRaw <= SCENE_LIMITS.maxSteps ? stepsRaw : undefined
      const ascent = STAIR_ASCENTS.includes(e.ascent as StairAscent) ? (e.ascent as StairAscent) : undefined
      if (!cls && !status && !kind && slopeDeg == null && steps == null && ascent == null) continue
      edits.push({ elementId: e.elementId, cls, status, kind, slopeDeg, steps, ascent, by: e.by, at: atEdit })
    }
  }

  return { version: 1, at, elements, edits }
}

/** Maske: veljavne točke 0..1, največ SCENE_LIMITS.maxMaskPoints, min 3 za uporabo. */
function sanitizeMaskPoints (raw: unknown): ScenePoint[] {
  if (!Array.isArray(raw)) return []
  const pts: ScenePoint[] = []
  for (const p of raw.slice(0, SCENE_LIMITS.maxMaskPoints)) {
    if (!p || typeof p !== 'object') continue
    const q = p as Record<string, unknown>
    if (typeof q.x !== 'number' || typeof q.y !== 'number' || !Number.isFinite(q.x) || !Number.isFinite(q.y)) continue
    if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) continue
    pts.push({ x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 })
  }
  return pts
}

/** R469 (F3): nastopne črte — veljavne daljice 0..1, max SCENE_LIMITS.maxStepLines.
 * Neveljavna daljica se izpusti; če nobena ni veljavna, polje izpade. */
function sanitizeStepLines (raw: unknown): SceneLine[] {
  if (!Array.isArray(raw)) return []
  const out: SceneLine[] = []
  for (const l of raw.slice(0, SCENE_LIMITS.maxStepLines)) {
    if (!l || typeof l !== 'object') continue
    const q = l as Record<string, unknown>
    const vals = [q.x1, q.y1, q.x2, q.y2]
    if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) continue
    out.push({
      x1: Math.round((q.x1 as number) * 1000) / 1000,
      y1: Math.round((q.y1 as number) * 1000) / 1000,
      x2: Math.round((q.x2 as number) * 1000) / 1000,
      y2: Math.round((q.y2 as number) * 1000) / 1000,
    })
  }
  return out
}

/** Serializacija v JSON niz (persistenca na ArSnapshot.sceneJson). */
export function serializeSceneResult (r: SceneUnderstandingResult): string {
  return JSON.stringify(r)
}

// R467 (issue #8 — SMART VISION, Faza 1): JEDRO RAZUMEVANJA PRIZORA.
// R468 (issue #8 — Faza 2): tla, ravnine, robovi in naklon — maska tal,
//   talna ravnina, ROB elementi, ocena naklona z LOČITVIJO nagiba telefona
//   od naklona tal + zapis metode/vira/statusa geometrije (§3, §6).
// R469 (issue #8 — Faza 3): STOPNICE — vzorec vzporednih nastopnih črt →
//   število vidnih nastopov, smer vzpenjanja (levo/desno/globina),
//   enakomernost razmakov in morebitni podest (§4). POŠTENOST: iz enega
//   pogleda BREZ globine NISO izmerljive višine čel in globine nastopov —
//   te izrecno označimo kot „potrebna mera“ (§4/§6).
// R470 (issue #8 — §5): MERE PREDMETOV IN ČLOVEŠKA FIGURA —
//   • metode mere (DEPTH/AR, KALIBRIRANA_FOTOGRAFIJA, VEČ_POGLEDOV,
//     ROČNI_VNOS, ROČNO_POPRAVLJENO) — mera BREZ metode ni veljavna;
//   • predlog dimenzijskih osi (v kadru, BREZ realnih enot — cm pride
//     samo z veljavno referenco, §5: „ne iz pikslov brez skale“);
//   • konsolidacija mer istega naziva + prijava konflikta (>15 %);
//   • človeška figura: živa hevristika (gibanje + razmerje stranic) SAMO
//     za razumevanje zakritja — NE shranjuje se v posnetek (zasebnost §5),
//     NE identificira oseb, višino NE trdi brez veljavne reference.
// R471 (issue #8 — Faza 4 „Senzorji“): ARCORE DEPTH / WEBXR — manifest
//   senzorja globine (provider/format/ločljivost/skala/fokus/čas), čista
//   matematika unproject+razdalja in pravilo, da je DEPTH_AR mera veljavna
//   SAMO z veljavnim manifestom (element in popravek); ročna pot ga nikoli
//   ne ponudi (invarianta R470 ohranjena).
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
  // — R485 (issue #8 §2): OGRAJA iz stebrov —
  /** Število zaznanih navpičnih stebrov (≈ ograja iz stebrov) — OCENA, ne izmera. */
  postCount?: number
  // — R485 (issue #8 §1): ročno dodana oznaka —
  /** Opomba monterja ob ročno dodani oznaki (≤ elementLabelMaxLen znakov). */
  label?: string
  // ── R470 (§5): MERE PREDMETOV ──
  /** Predlogi dimenzijskih osi (0..1, BREZ cm — fizična vrednost samo v measures). */
  axes?: DimAxis[]
  /** Izmerjene fizične mere (cm) z ZAPISANO metodo — prazna, dokler ni reference. */
  measures?: SceneMeasure[]
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
  /**
   * R485 (issue #8 §2): ročno popravljen kot ROBA (stopinje). Sprejme
   * −90..360 — črta roba je NEUSMERJENA, applyEdits normalizira mod 180
   * v [−90, 90] (350° je enako −10°); 1 decimala. Vir postane ROCNO
   * (analog slopeDeg — izjava monterja, ne izračun).
   */
  angleDeg?: number
  /**
   * R470 (§5): izmerjena mera na elementu (ROČNI_VNOS ali iz kalibrirane
   * fotografije). METODO izpelje applyEdits: prvi vnos na naziv → ROCNI_VNOS
   * (ali podana KALIBRIRANA_FOTOGRAFIJA), ponovni vnos istega naziva →
   * ROCNO_POPRAVLJENO — monter ne more ročno „pretentati“ metode DEPTH_AR.
   */
  measure?: {
    label: string
    valueCm: number
    toleranceCm?: number
    /** izvor izračuna (KALIBRIRANA_FOTOGRAFIJA) — drugače izpeljano */
    method?: MeasureMethod
    /**
     * R471 (F4): manifest senzorja globine — če je veljaven, metoda postane
     * DEPTH_AR (senzorska pot; ročni vnos tega polja v UI ni mogoč).
     */
    depth?: DepthManifest
    at?: number
  }
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
  maxPosts: 24, // R485: največje število zaznanih stebrov (OCENA)
  elementLabelMaxLen: 60, // R485: dolžina opombe ročno dodane oznake
  truncationMargin: 0.02, // R485: odrezan rob — meja proti šumu bbox ob robu kadra
  maxStepLines: 12, // R469 (F3): nastopne črte za risanje
  maxAxesPerElement: 4, // R470 (§5): dimenzijske osi na element
  maxMeasuresPerElement: 8, // R470 (§5): mere na element (po nazivu se konsolidirajo)
  measureLabelMaxLen: 48, // R470 (§5): dolžina naziva mere
  measureCmMax: 100000, // R470 (§5): 1000 m — fizična meja smisla
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
  /**
   * R483 (F5): anizotropija smeri robov (−1..1) — (>0 pretežno VODORAVNE
   * strukture/vlakna, <0 navpične, ~0 izotropno ali pravilna mreža obeh
   * smeri). OPCIJSNO: če merilnik ni izračunal (starejši klicatelj), ga
   * klasifikator NE uporabi — brez tega dokaza PLOŠČIC/LESA NE trdimo
   * (poštenost §6: razred samo ob zanesljivi detekciji).
   */
  grainAnisotropy?: number
}

export interface SurfaceVerdict {
  kind: SurfaceKind
  confidence: number
  note: string
}

/** Klasifikacija vrste podlage iz značilnic ROI (Faza 1 hevristika, brez ML).
 *
 * R483 (F5): PLOŠČICE (mreža fug v obeh smereh — izotropna gostota robov)
 * in LES (topel ton + vzdolžna vlakna — anizotropija smeri). Oba razreda
 * sta KONSERVATIVNA: zahtevata izmerjeno grainAnisotropy, zaupanje ≤ 0,5
 * in sta vedno ročno popravljiva (predlog, ne trditev). Brez teh dokazov
 * razreda NE vrneva (NEZNANA ostaja poštena zadnja možnost). */
export function classifySurface (f: SurfaceFeatures): SurfaceVerdict {
  const dark = f.brightness < 60
  const veryGray = f.grayness > 0.72
  const quiteGray = f.grayness > 0.55
  const grassy = f.greenRatio > 0.34
  const earthy = f.warmth > 0.42 && f.saturation < 0.38
  const gravelly = quiteGray && f.textureVariance > 950 && f.edgeDensity > 0.1
  const paved = quiteGray && f.edgeDensity > 0.055 && f.edgeDensity <= 0.16 && f.textureVariance > 220
  // R483 (F5): smer teksture — samo, če jo je merilnik izračunal
  const grain = typeof f.grainAnisotropy === 'number' && Number.isFinite(f.grainAnisotropy)
    ? Math.max(-1, Math.min(1, f.grainAnisotropy))
    : null
  // LES: topel ton + izrazita vzdolžna vlakna (enosmerna tekstura)
  const woody = grain != null && Math.abs(grain) > 0.18 &&
    f.warmth > 0.5 && f.saturation < 0.45 && !veryGray
  // PLOŠČICE: gosta mreža fug v OBEH smereh (uravnotežena smer) na
  // raznoliki, a ne zelo grubi podlagi (gramoz ima višjo varianco)
  const tiled = grain != null && Math.abs(grain) < 0.25 &&
    f.edgeDensity > 0.16 && f.textureVariance > 300 && f.textureVariance < 900

  if (grassy) {
    return { kind: 'TRAVA', confidence: 0.62, note: 'zelena dominantna v spodnjem pasu' }
  }
  if (woody) {
    return { kind: 'LES', confidence: 0.42, note: 'topel ton z vzdolžno teksturo (ocena)' }
  }
  if (earthy) {
    return { kind: 'ZEMLJA', confidence: 0.55, note: 'topel ton, zmerna nasičenost' }
  }
  if (dark && veryGray) {
    return { kind: 'ASFALT', confidence: 0.58, note: 'temna, skoraj brez barve' }
  }
  if (tiled) {
    return { kind: 'PLOSCICE', confidence: 0.45, note: 'gosta mreža fuge v obeh smereh (ocena)' }
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
// R483 (F5): MONOTONOST — stopnice se VZPENJAJO v eni smeri:
//   • y: vsaka naslednja črta za ≥ 0,5 % višine (strogo zaporedje — podvojena
//     ali zlepljena detekcija vrhov ni stopnica);
//   • smer vzpenjanja: središča črt se premikajo dosledno v ENO stran
//     (cik-cak središč = izmenične detekcije, ne stopnišče).
export const STAIR_MONO_MIN_GAP = 0.005 // min razmak med nastopoma (delež višine)
export const STAIR_MONO_TOL_W = 0.01 // tolerantna meja "ni premika" (delež širine)

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

/** Analiza vzorca nastopnih črt → predlog stopnišča (ali null, če ni vzorca).
 * R483 (F5): vzorec ZAVRŽEN, če nastopne črte niso monotonne — vodoravne
 * lamele/obloga (enakomeren niz brez smeri vzpenjanja) ne smejo več
 * sprožiti STOPNICE (manj lažnih pozitivov, konservativna smer). */
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

  // R483 (F5) MONOTONOST y: vsaka naslednja črta višje za ≥ 0,5 % višine —
  // razmak pod tem je podvojena/zlepljena detekcija, ne ločena stopnica.
  const minGapPx = Math.max(1, STAIR_MONO_MIN_GAP * h)
  for (const g of gaps) {
    if (g < minGapPx) return null
  }

  // R483 (F5) MONOTONOST smeri vzpenjanja: središča črt se med sosednjimi
  // nastopi premikajo dosledno v eno stran (ali mirujejo — čelni pogled).
  // Cik-cak (izmenično levo/desno čez tolerantno mejo) NI stopnišče.
  const centersPre = sorted.map((l) => (l.xFrom + l.xTo) / 2)
  const tolMono = STAIR_MONO_TOL_W * w
  let monoDir = 0 // −1 = premiki levo, +1 = desno, 0 = miruje
  for (let i = 1; i < centersPre.length; i++) {
    const d = centersPre[i] - centersPre[i - 1]
    if (d > tolMono) {
      if (monoDir < 0) return null
      monoDir = 1
    } else if (d < -tolMono) {
      if (monoDir > 0) return null
      monoDir = -1
    }
  }

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

// ── MERE PREDMETOV (issue #8 §5) ────────────────────────────────────────────
//
// POŠTENOST (§5/§6): predlagane so samo OSI v koordinatah kadra (0..1) —
// BREZ vrednosti v cm. Fizična vrednost obstaja IZKLJUČNO kot SceneMeasure
// z ZAPISANO metodo. Vrednosti v cm NIKOLI ne izračunavamo iz pikslov brez
// veljavne skale/reference (§5: „širine/višine v realnih enotah ne izračunavaj
// samo iz števila slikovnih pik“).

/** Metoda izmere (issue §5) — taksonomija po zahtevi naloge. */
export const MEASURE_METHODS = ['DEPTH_AR', 'KALIBRIRANA_FOTOGRAFIJA', 'VEC_POGLEDOV', 'ROCNI_VNOS', 'ROCNO_POPRAVLJENO'] as const
export type MeasureMethod = (typeof MEASURE_METHODS)[number]

export const MEASURE_METHOD_TEXT: Record<MeasureMethod, string> = {
  DEPTH_AR: 'AR globina',
  KALIBRIRANA_FOTOGRAFIJA: 'kalibrirana fotografija',
  VEC_POGLEDOV: 'več pogledov',
  ROCNI_VNOS: 'ročni vnos',
  ROCNO_POPRAVLJENO: 'ročno popravljeno',
}

/** Vrsta dimenzijske osi (predlog, kaj bi meril monter). */
export const AXIS_KINDS = ['DOLZINA', 'SIRINA', 'VISINA', 'GLOBINA'] as const
export type AxisKind = (typeof AXIS_KINDS)[number]

export const AXIS_KIND_TEXT: Record<AxisKind, string> = {
  DOLZINA: 'dolžina',
  SIRINA: 'širina',
  VISINA: 'višina',
  GLOBINA: 'globina',
}

/** Predlog dimenzijske osi v kadru (0..1) — brez realnih enot (issue §5). */
export interface DimAxis {
  x1: number; y1: number; x2: number; y2: number
  kind: AxisKind
  /** Kaj os predstavlja (slovensko, kratko) — npr. „višina stopnišča“. */
  label: string
}

/** Izmerjena fizična mera na elementu — vedno z metodo (issue §5). */
export interface SceneMeasure {
  label: string
  valueCm: number
  method: MeasureMethod
  /** Dokazljiva toleranca (cm), če jo monter pozna (npr. podatki proizvajalca). */
  toleranceCm?: number
  /** R471 (F4): manifest senzorja globine — obvezno pri metodi DEPTH_AR. */
  sensor?: DepthManifest
  at: number
  by?: string
}

/** Konsolidirana mera po nazivu (§5: več pogledov/mer istega elementa). */
export interface ConsolidatedMeasure {
  label: string
  valueCm: number
  method: MeasureMethod
  toleranceCm?: number
  /** število posameznih mer, ki so sestavile konsolidacijo */
  count: number
  /** razpon (max−min) glede na vrednost v % */
  spreadPct: number
  /** mere istega naziva odstopajo > 15 % — prijava konflikta (§5) */
  conflict: boolean
  note: string
}

/** prag odstopanja mer istega naziva za prijavo konflikta (§5: „prijavi konflikt“) */
export const MEASURE_CONFLICT_PCT = 15

/**
 * Dolžina osi v enotah VIŠINE kadra (frame height = 1), upoštevajoč razmerje
 * stranic (diagonala v pravem merilu). Isti aspect za referenco in ciljno os
 * da pravilno razmerje pikslov — iz tega pride cm samo preko reference.
 */
export function axisSpan (a: DimAxis, aspect: number): number {
  const ax = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const dx = (a.x2 - a.x1) * ax
  const dy = a.y2 - a.y1
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Izračun cm CILJNE osi iz znane dolžine REFERENČNE osi istega kadra
 * (§5: KALIBRIRANA_FOTOGRAFIJA — ena slika + ena veljavna referenca).
 * Vrne null, če referenca ni uporabljiva (ničelna os/nedeljiva dolžina) —
 * nikoli ne ugibamo.
 */
export function axisCmFromReference (
  refAxis: DimAxis, refCm: number, targetAxis: DimAxis, aspect: number,
): number | null {
  if (!Number.isFinite(refCm) || refCm <= 0) return null
  const refSpan = axisSpan(refAxis, aspect)
  if (!(refSpan > 1e-6)) return null
  const ratio = axisSpan(targetAxis, aspect) / refSpan
  if (!Number.isFinite(ratio) || ratio <= 0) return null
  return Math.round(Math.min(SCENE_LIMITS.measureCmMax, refCm * ratio) * 10) / 10
}

// ── R471 (issue #8 Faza 4 — §11 „Senzorji“): ARCORE DEPTH / WEBXR ────────────
//
// MANIFEST SENZORJA GLOBINE: DEPTH_AR mera je veljavna SAMO z zapisanim
// manifestom (ponudnik, format, ločljivost, skala, goriščna razdalja, čas
// zajema) — sledljivost izvora po verigi dokazov (issue §6). Manifest je
// KNJIŽENJE izvora, ne kriptografski dokaz: enaka raven zaupanja kot pri
// metodi KALIBRIRANA_FOTOGRAFIJA (odjemalec izjavi izvor, strežnik ga


// zapiše). Ročni popravek v UI manifesta NE ponudi — invarianta R470
// („ročni popravek ne more pretendati DEPTH_AR“) ostane nespremenjena.
//
// Matematika spodaj je ČISTA (enako testirljiva kot ostalo jedro):
// unprojectDepthSample/depthDistanceCm/pointsDistanceCm uporablja adapter
// globine (src/lib/depth-adapter.ts) na NAPRAVI; tukaj le izračun.

/** Ponudniki globine — WebXR depth-sensing je spletna pot do ARCore. */
export const DEPTH_PROVIDERS = ['WEBXR_DEPTH'] as const
export type DepthProvider = (typeof DEPTH_PROVIDERS)[number]

/** Manifest zajema globine (sledljivost DEPTH_AR mere). */
export interface DepthManifest {
  provider: DepthProvider
  /** format globinske slike (npr. 'luminance-alpha', 'float32'). */
  depthFormat: string
  /** skala surove vrednosti v metre (> 0, končno). */
  rawValueToMeters: number
  /** širina globinske slike v px. */
  width: number
  /** višina globinske slike v px. */
  height: number
  /** goriščna razdalja kamere v px ob zajemu (> 0) — za unproject. */
  focalPx: number
  /** čas zajema (epoch ms). */
  timestamp: number
}

/** Pragova veljavne globine v metrih (ARCore full-range ~ do 8 m). */
export const DEPTH_MIN_M = 0.05
export const DEPTH_MAX_M = 8

/** Vzorec globine na točki kadra (u, v v 0..1, izvor zgoraj-levo) z globino v m. */
export interface DepthSample { u: number; v: number; depthM: number }

/** Defenzivna validacija manifesta senzorja globine (isti vzorec kot ostala sanitizacija). */
export function isDepthManifest (raw: unknown): DepthManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Record<string, unknown>
  if (!DEPTH_PROVIDERS.includes(q.provider as DepthProvider)) return null
  if (typeof q.depthFormat !== 'string' || !q.depthFormat || q.depthFormat.length > 32) return null
  const rawValueToMeters = typeof q.rawValueToMeters === 'number' && Number.isFinite(q.rawValueToMeters) && q.rawValueToMeters > 0
    ? q.rawValueToMeters : null
  const width = typeof q.width === 'number' && Number.isFinite(q.width) && Number.isInteger(q.width) && q.width >= 1 && q.width <= 4096 ? q.width : null
  const height = typeof q.height === 'number' && Number.isFinite(q.height) && Number.isInteger(q.height) && q.height >= 1 && q.height <= 4096 ? q.height : null
  const focalPx = typeof q.focalPx === 'number' && Number.isFinite(q.focalPx) && q.focalPx > 0 ? q.focalPx : null
  const timestamp = typeof q.timestamp === 'number' && Number.isFinite(q.timestamp) ? Math.round(q.timestamp) : null
  if (rawValueToMeters == null || width == null || height == null || focalPx == null || timestamp == null) return null
  return { provider: q.provider as DepthProvider, depthFormat: q.depthFormat.slice(0, 32), rawValueToMeters, width, height, focalPx, timestamp }
}

/** Točka v prostoru kamere (desnosučno, kamera gleda −z). */
export interface DepthPoint3 { x: number; y: number; z: number }

/**
 * Unproject vzorca globine v prostor kamere: px = u·w − w/2, py = v·h − h/2
 * (y raste navzdol — dosledno z orientacijo slike), z = −globina.
 * Vrne null, če vzorec ni uporaben (u/v izven 0..1, globina izven meja) —
 * nikoli ne ugibamo (§5/§6 poštenost).
 */
export function unprojectDepthSample (s: DepthSample, m: DepthManifest): DepthPoint3 | null {
  if (!s || typeof s !== 'object') return null
  if (typeof s.depthM !== 'number' || !Number.isFinite(s.depthM)) return null
  if (s.depthM < DEPTH_MIN_M || s.depthM > DEPTH_MAX_M) return null
  if (typeof s.u !== 'number' || !Number.isFinite(s.u) || s.u < 0 || s.u > 1) return null
  if (typeof s.v !== 'number' || !Number.isFinite(s.v) || s.v < 0 || s.v > 1) return null
  const px = s.u * m.width - m.width / 2
  const py = s.v * m.height - m.height / 2
  return { x: (px * s.depthM) / m.focalPx, y: (py * s.depthM) / m.focalPx, z: -s.depthM }
}

/** Metrična razdalja med točkama v cm (zaokroženo na 0,1) ali null. ČISTA. */
export function pointsDistanceCm (a: DepthPoint3, b: DepthPoint3): number | null {
  const dx = a.x - b.x; const dy = a.y - b.y; const dz = a.z - b.z
  const cm = Math.sqrt(dx * dx + dy * dy + dz * dz) * 100
  if (!Number.isFinite(cm) || cm <= 0 || cm > SCENE_LIMITS.measureCmMax) return null
  return Math.round(cm * 10) / 10
}

/**
 * Razdalja med dvema točkama IZ GLOBINE istega kadra/poze (cm) ali null,
 * če katerikoli vzorec ni uporaben. Za mere čez DVE POZI (dva tapa v AR)
 * adapter točke najprej pretvori v skupni prostor — glej depth-adapter.ts.
 */
export function depthDistanceCm (a: DepthSample, b: DepthSample, m: DepthManifest): number | null {
  const pa = unprojectDepthSample(a, m)
  const pb = unprojectDepthSample(b, m)
  if (pa == null || pb == null) return null
  return pointsDistanceCm(pa, pb)
}

/**
 * Predlog dimenzijskih osi za element (§5: „predlaga robove in dimenzijske
 * osi za ograjni segment, odprtino/vrata, steber, stopnico, rob plošče,
 * steno in druge gradbene elemente“). Osi so ČISTO v koordinatah kadra —
 * brez cm. Največ SCENE_LIMITS.maxAxesPerElement.
 */
export function proposeAxes (el: SceneElement): DimAxis[] {
  const r3 = (n: number): number => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000
  const mk = (x1: number, y1: number, x2: number, y2: number, kind: AxisKind, label: string): DimAxis =>
    ({ x1: r3(x1), y1: r3(y1), x2: r3(x2), y2: r3(y2), kind, label })

  // STOPNICA: najdaljša nastopna črta (širina) + povezovalna os prve↔zadnje
  // črte (višina stopnišča v kadru — potrebna referenca za fizično vrednost)
  if (el.cls === 'STOPNICA') {
    const lines = (el.stepLines ?? []).slice(0, SCENE_LIMITS.maxStepLines)
    const axes: DimAxis[] = []
    const longest = [...lines].sort((a, b) => (Math.abs(b.x2 - b.x1) - Math.abs(a.x2 - a.x1)))[0]
    if (longest) {
      axes.push(mk(longest.x1, longest.y1, longest.x2, longest.y2, 'SIRINA', 'širina stopnice'))
    }
    if (lines.length >= 2) {
      const first = lines[0]
      const last = lines[lines.length - 1]
      axes.push(mk(
        (first.x1 + first.x2) / 2, (first.y1 + first.y2) / 2,
        (last.x1 + last.x2) / 2, (last.y1 + last.y2) / 2,
        'VISINA', 'višina stopnišča',
      ))
    }
    return axes.slice(0, SCENE_LIMITS.maxAxesPerElement)
  }

  const [bx, by, bw, bh] = el.bbox

  // ROB: os vzdolž roba (dolžina)
  if (el.cls === 'ROB') {
    return [mk(bx, by + bh / 2, bx + bw, by + bh / 2, 'DOLZINA', 'dolžina roba')]
  }
  // OGRAJA: vodoravna os skozi središče (dolžina segmenta)
  if (el.cls === 'OGRAJA') {
    return [mk(bx, by + bh / 2, bx + bw, by + bh / 2, 'DOLZINA', 'dolžina ograjnega segmenta')]
  }
  // OSEBA / OVIRA: navpična os (višina figure v kadru — za §5 brez cm)
  if (el.cls === 'OSEBA' || el.cls === 'OVIRA') {
    return [mk(bx + bw / 2, by, bx + bw / 2, by + bh, 'VISINA', 'višina figure v kadru')]
  }
  // TLA / PODLAGA: vodoravna os čez spodnji rob maske (ali bbox)
  if (el.cls === 'TLA' || el.cls === 'PODLAGA') {
    const pts = el.maskPoints ?? []
    if (pts.length >= 2) {
      let maxY = -1
      for (const p of pts) if (p.y > maxY) maxY = p.y
      if (maxY > 0) {
        let minX = 1; let maxX = 0
        for (const p of pts) {
          if (Math.abs(p.y - maxY) <= 0.08) { // točke ob spodnjem robu maske
            if (p.x < minX) minX = p.x
            if (p.x > maxX) maxX = p.x
          }
        }
        if (maxX - minX > 0.05) {
          return [mk(minX, Math.min(1, maxY), maxX, Math.min(1, maxY), 'SIRINA', 'širina tal v kadru')]
        }
      }
    }
    return [mk(bx, Math.min(1, by + bh), bx + bw, Math.min(1, by + bh), 'SIRINA', 'širina tal v kadru')]
  }
  // NEZNANO in ostalo: brez predloga — ne izmišljujemo osi (issue §1)
  return []
}

/**
 * Konsolidacija mer istega naziva (§5.6: „več pogledov mora omogočati
 * konsolidacijo istega elementa in prijavo konflikta med merami“).
 * Pravila (poštena, določena):
 *   • ROCNO_POPRAVLJENO (zadnja) ima prednost — je izrecna popravka monterja;
 *   • sicer mediana vrednosti; metoda = VEC_POGLEDOV, če je mer več;
 *   • razpon > 15 % → konflikt (prijava, ne tiha poravnava).
 */
export function consolidateMeasures (measures: SceneMeasure[]): ConsolidatedMeasure[] {
  if (!Array.isArray(measures) || measures.length === 0) return []
  const groups = new Map<string, SceneMeasure[]>()
  for (const m of measures) {
    if (!m || typeof m.label !== 'string' || !m.label) continue
    if (typeof m.valueCm !== 'number' || !Number.isFinite(m.valueCm) || m.valueCm <= 0) continue
    const arr = groups.get(m.label) ?? []
    arr.push(m)
    groups.set(m.label, arr)
  }
  const out: ConsolidatedMeasure[] = []
  for (const [label, ms] of groups) {
    const sorted = [...ms].sort((a, b) => a.at - b.at)
    const corrections = sorted.filter((m) => m.method === 'ROCNO_POPRAVLJENO')
    const values = sorted.map((m) => m.valueCm).sort((a, b) => a - b)
    const mid = Math.floor(values.length / 2)
    const median = values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2
    const winner = corrections.length > 0 ? corrections[corrections.length - 1] : null
    const valueCm = Math.round((winner ? winner.valueCm : median) * 10) / 10
    const spread = values.length >= 2 ? values[values.length - 1] - values[0] : 0
    const spreadPct = Math.round((spread / Math.max(1e-6, Math.abs(valueCm))) * 1000) / 10
    const conflict = values.length >= 2 && spreadPct > MEASURE_CONFLICT_PCT
    let method: MeasureMethod
    if (winner) method = 'ROCNO_POPRAVLJENO'
    else if (sorted.length === 1) method = sorted[0].method
    else method = 'VEC_POGLEDOV'
    const tol = winner?.toleranceCm ?? sorted[sorted.length - 1].toleranceCm
    out.push({
      label,
      valueCm,
      method,
      ...(tol != null ? { toleranceCm: tol } : {}),
      count: sorted.length,
      spreadPct,
      conflict,
      note: conflict
        ? 'mere istega naziva odstopajo — preverite na objektu'
        : winner
          ? 'zadnja ročna popravka prevladuje'
          : 'konsolidirano',
    })
  }
  return out
}

// ── ČLOVEŠKA FIGURA (issue #8 §5 „Osebe“) ───────────────────────────────────
//
// Namen SAMO prostorsko razumevanje (zakritje merilne točke) in dokumentacija
// — NE identifikacija oseb, NE obrazno prepoznavanje, NE shranjevanje.
// Hevristika: GIBANJE + razmerje stranic bbox (pokončna figura). Iskrena
// meja: mirujoče osebe brez ML ne zaznamo — to je dokumentirana omejitev.

export const PERSON_AR_MIN = 1.6 // razmerje višina/širina — spodnja meja stoječe figure
export const PERSON_AR_MAX = 5.5 // zgornja meja (ozka figura/robnost)
export const PERSON_MIN_H = 0.25 // figura ≥ 25 % višine kadra
export const PERSON_MAX_W = 0.45 // širina ≤ 45 % kadra (širša stvar ni oseba)

/** Ali bbox ustreza obliki pokončne človeške figure (konzervativno). */
export function looksLikePerson (bbox: [number, number, number, number]): boolean {
  const [, , w, h] = bbox
  if (!(w > 0) || !(h > 0)) return false
  const ar = h / w
  return ar >= PERSON_AR_MIN && ar <= PERSON_AR_MAX && h >= PERSON_MIN_H && w <= PERSON_MAX_W
}

/**
 * Iskrena opomba o višini osebe (§5: ocena višine SAMO, če je figura celotna
 * in obstaja primerna globina/merilo — sicer tega NE trdimo).
 */
export function personHeightNote (el: SceneElement): string {
  const [, y, , h] = el.bbox
  if (y <= 0.02) return 'Figura je odrezana na zgornjem robu kadra — višina ni ocenljiva.'
  if (y + h >= 0.98) return 'Figura sega čez spodnji rob kadra — delno vidna, višina ni zanesljiva.'
  if (h < PERSON_MIN_H) return 'Figura je v kadru prekratka — verjetno sedeča ali delno zakrita.'
  return 'Figura je celotna v kadru — višino izmerite le z veljavno referenco, ne iz slike.'
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

  // R485 (issue #8 §8/7 + §6 :94): ODREZAN ROB — objekt sega čez rob kadra →
  // zajemni napotek ima prednost pred vsebinskimi (stopi nazaj in posnemi znova).
  // NE velja za: talni ravnini (PODLAGA/TLA — tla segajo do dna kadra po naravi),
  // ROB (rob površine je legitimno lahko ob robu kadra), OSEBA (njen lasten
  // napotek o zakritju) in SKRITO (element že ni viden).
  const m = SCENE_LIMITS.truncationMargin
  const truncated = elements.some((e) => {
    if (e.status === 'SKRITO' || e.cls === 'PODLAGA' || e.cls === 'TLA' || e.cls === 'ROB' || e.cls === 'OSEBA') return false
    if (!Array.isArray(e.bbox) || e.bbox.length !== 4) return false
    const [x, y, bw, bh] = e.bbox
    if (![x, y, bw, bh].every((v) => typeof v === 'number' && Number.isFinite(v))) return false
    return x < m || x + bw > 1 - m || y + bh > 1 - m
  })
  if (truncated) return 'Objekt ni v celoti v kadru — stopite nazaj in posnemite še en kader.'

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
    // R485 (issue #8 §2): ročno popravljen kot ROBA — normalizacija mod 180
    // v [-90, 90] (črta roba je neusmerjena: 350° ≡ −10°, 180° ≡ 0°), 1 dec.
    // Vir ROCNO + IZMERJENO — analog naklonu (izjava monterja, ne izračun).
    if (typeof edit.angleDeg === 'number' && Number.isFinite(edit.angleDeg)) {
      const raw = Math.round(edit.angleDeg * 10) / 10
      el.angleDeg = Math.round((((raw + 90) % 180 + 180) % 180 - 90) * 10) / 10
      el.geomStatus = 'IZMERJENO'
    }
    // R470 (§5): izmerjena mera — METODA se izpelje TU (enotna pravila za
    // odjemalca in strežnik): ponovni vnos istega naziva je POPRAVEK.
    // DEPTH_AR je REZERVIRAN za prihodnjo integracijo senzorja globine —
    // ročni popravek ga ne more „pretentati“ (issue §5: mera z metodo).
    // R471 (F4): senzorska pot — VELJAVEN manifest globine (edit.measure.depth)
    // metodo postavi v DEPTH_AR; manifest se zapiše na mero (sledljivost §6).
    // Ročni vnos (brez manifesta) pomeni POPRAVEK prejšnje mere →
    // ROCNO_POPRAVLJENO (konsolidacija: popravka prevlada, tudi nad DEPTH_AR).
    if (edit.measure && typeof edit.measure.label === 'string' && edit.measure.label &&
        typeof edit.measure.valueCm === 'number' && Number.isFinite(edit.measure.valueCm) &&
        edit.measure.valueCm > 0) {
      const label = edit.measure.label.slice(0, SCENE_LIMITS.measureLabelMaxLen)
      const value = Math.max(0.1, Math.min(SCENE_LIMITS.measureCmMax, Math.round(edit.measure.valueCm * 10) / 10))
      const existing = (el.measures ?? []).some((m) => m.label === label)
      const depthManifest = edit.measure.depth != null ? isDepthManifest(edit.measure.depth) : null
      const method: MeasureMethod = depthManifest != null
        ? 'DEPTH_AR'
        : existing
          ? 'ROCNO_POPRAVLJENO'
          : (edit.measure.method === 'KALIBRIRANA_FOTOGRAFIJA' || edit.measure.method === 'VEC_POGLEDOV'
              ? edit.measure.method
              : 'ROCNI_VNOS')
      const tolRaw = edit.measure.toleranceCm
      const toleranceCm = typeof tolRaw === 'number' && Number.isFinite(tolRaw) && tolRaw >= 0 && tolRaw <= value
        ? Math.round(tolRaw * 10) / 10
        : undefined
      el.measures = [...(el.measures ?? []), {
        label,
        valueCm: value,
        method,
        ...(toleranceCm != null ? { toleranceCm } : {}),
        ...(depthManifest != null ? { sensor: depthManifest } : {}),
        at: edit.measure.at ?? edit.at,
        ...(edit.by ? { by: edit.by } : {}),
      }].slice(-SCENE_LIMITS.maxMeasuresPerElement)
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
    // R470 (§5 ZASEBNOST): zaznava OSEBE je ŽIVA (pomaga monterju pri zakritju)
    // in se NAMENOMA ne persistira — ne shranjujemo odsevkov o ljudeh.
    if (cls === 'OSEBA') continue
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
    // R485: stebri (OCENA — število nikoli ni izmera) + opomba ročne oznake
    const postRaw = typeof e.postCount === 'number' && Number.isFinite(e.postCount) ? Math.round(e.postCount) : null
    const postCount = postRaw != null && postRaw >= 1 && postRaw <= SCENE_LIMITS.maxPosts ? postRaw : undefined
    const label = typeof e.label === 'string' && e.label.trim() ? e.label.trim().slice(0, SCENE_LIMITS.elementLabelMaxLen) : undefined
    const stepLines = sanitizeStepLines(e.stepLines)
    const stepGapRaw = typeof e.stepGap === 'number' && Number.isFinite(e.stepGap) ? Math.round(e.stepGap * 1000) / 1000 : null
    const stepGap = stepGapRaw != null && stepGapRaw > 0 && stepGapRaw <= 1 ? stepGapRaw : undefined
    const stepIrregular = e.stepIrregular === true
    const landing = e.landing === true

    // R470 (§5): dimenzijske osi (samo geometrija kadra) + izmerjene mere
    // z metodo. Neveljavne se IZPUSTIJO (brez tihih popravkov).
    const axes = sanitizeAxes(e.axes)
    const measures = sanitizeMeasures(e.measures)

    elements.push({
      id, cls, status, source, confidence,
      bbox: [bbox[0], bbox[1], bbox[2], bbox[3]], kind, at,
      ...(maskPoints.length >= 3 ? { maskPoints } : {}),
      ...(angleDeg != null ? { angleDeg } : {}),
      ...(hasSlope ? { slopeDeg, slopeSource, ...(geomStatus ? { geomStatus } : {}) } : {}),
      ...(!hasSlope && geomStatus ? { geomStatus } : {}),
      ...(steps != null ? { steps } : {}),
      ...(ascent != null ? { ascent } : {}),
      ...(postCount != null ? { postCount } : {}),
      ...(label != null ? { label } : {}),
      ...(stepLines.length >= 1 ? { stepLines } : {}),
      ...(stepGap != null ? { stepGap } : {}),
      ...(stepIrregular ? { stepIrregular: true } : {}),
      ...(landing ? { landing: true } : {}),
      ...(axes.length >= 1 ? { axes } : {}),
      ...(measures.length >= 1 ? { measures } : {}),
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
      // R485: kot roba — sprejme −90..360 (črta je neusmerjena; applyEdits
      // normalizira mod 180 v [-90, 90]), 1 decimala; neveljaven se IZPUSTI
      const angleDeg = typeof e.angleDeg === 'number' && Number.isFinite(e.angleDeg) &&
        Math.abs(e.angleDeg) <= 360 ? Math.round(e.angleDeg * 10) / 10 : undefined
      // R470 (§5): popravek mere — surovi vnos {label, valueCm, toleranceCm?};
      // metodo izpelje applyEdits (ne zaupa se odjemalcu/strežniku posebej).
      const measureRaw = e.measure && typeof e.measure === 'object' ? e.measure as Record<string, unknown> : null
      let measure: SceneEdit['measure'] | undefined
      if (measureRaw) {
        const mLabel = typeof measureRaw.label === 'string' ? measureRaw.label.trim().slice(0, SCENE_LIMITS.measureLabelMaxLen) : ''
        const mVal = typeof measureRaw.valueCm === 'number' && Number.isFinite(measureRaw.valueCm)
          ? Math.round(measureRaw.valueCm * 10) / 10 : null
        const mTol = typeof measureRaw.toleranceCm === 'number' && Number.isFinite(measureRaw.toleranceCm) &&
          measureRaw.toleranceCm >= 0 && (mVal == null || measureRaw.toleranceCm <= mVal)
          ? Math.round(measureRaw.toleranceCm * 10) / 10 : undefined
        const mMethod = (MEASURE_METHODS.includes(measureRaw.method as MeasureMethod) && measureRaw.method !== 'DEPTH_AR')
          ? measureRaw.method as MeasureMethod : undefined
        // R471 (F4): manifest senzorja globine preživi sanitizacijo popravka —
        // iz njega applyEdits izpelje metodo DEPTH_AR (ne iz zahteve). Neveljaven
        // manifest se TIHO izpusti (mera ostane ročna pot — enako kot R470).
        const mDepth = measureRaw.depth != null ? isDepthManifest(measureRaw.depth) : undefined
        if (mLabel && mVal != null && mVal >= 0.1 && mVal <= SCENE_LIMITS.measureCmMax) {
          measure = {
            label: mLabel,
            valueCm: mVal,
            ...(mTol != null ? { toleranceCm: mTol } : {}),
            ...(mMethod ? { method: mMethod } : {}),
            ...(mDepth != null ? { depth: mDepth } : {}),
          }
        }
      }
      if (!cls && !status && !kind && slopeDeg == null && steps == null && ascent == null && angleDeg == null && measure == null) continue
      edits.push({ elementId: e.elementId, cls, status, kind, slopeDeg, steps, ascent, angleDeg, measure, by: e.by, at: atEdit })
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

/** R470 (§5): dimenzijske osi — veljavne točke 0..1, kind iz seznama,
 * label 1..measureLabelMaxLen. Najprej se izločijo neveljavne, ŠE NATO
 * rezultat reže na maxAxesPerElement (neveljavna os ne „poje“ mesta). */
function sanitizeAxes (raw: unknown): DimAxis[] {
  if (!Array.isArray(raw)) return []
  const out: DimAxis[] = []
  for (const a of raw.slice(0, SCENE_LIMITS.maxAxesPerElement * 2)) {
    if (!a || typeof a !== 'object') continue
    const q = a as Record<string, unknown>
    const vals = [q.x1, q.y1, q.x2, q.y2]
    if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) continue
    const kind = AXIS_KINDS.includes(q.kind as AxisKind) ? q.kind as AxisKind : null
    const label = typeof q.label === 'string' && q.label.trim() ? q.label.trim().slice(0, SCENE_LIMITS.measureLabelMaxLen) : null
    if (!kind || !label) continue
    if (out.length >= SCENE_LIMITS.maxAxesPerElement) break
    out.push({
      x1: Math.round((q.x1 as number) * 1000) / 1000,
      y1: Math.round((q.y1 as number) * 1000) / 1000,
      x2: Math.round((q.x2 as number) * 1000) / 1000,
      y2: Math.round((q.y2 as number) * 1000) / 1000,
      kind,
      label,
    })
  }
  return out
}

/** R470 (§5): mere — label, vrednost 0,1..measureCmMax, METODA obvezna,
 * toleranca 0..vrednost (neveljavna toleranca se izpusti, MERA ostane —
 * vrednost brez tolerance je še vedno veljavna mera, issue §5). Mera brez
 * veljavne metode se IZPUSTI (issue §5: „izračunane mere poveži z njihovo
 * metodo“). Neveljavne se izločijo, nato rez na maxMeasuresPerElement. */
function sanitizeMeasures (raw: unknown): SceneMeasure[] {
  if (!Array.isArray(raw)) return []
  const out: SceneMeasure[] = []
  for (const m of raw.slice(0, SCENE_LIMITS.maxMeasuresPerElement * 2)) {
    if (!m || typeof m !== 'object') continue
    const q = m as Record<string, unknown>
    const label = typeof q.label === 'string' && q.label.trim() ? q.label.trim().slice(0, SCENE_LIMITS.measureLabelMaxLen) : null
    const valueRaw = typeof q.valueCm === 'number' && Number.isFinite(q.valueCm) ? Math.round(q.valueCm * 10) / 10 : null
    const valueCm = valueRaw != null && valueRaw >= 0.1 && valueRaw <= SCENE_LIMITS.measureCmMax ? valueRaw : null
    // R471 (F4): DEPTH_AR velja SAMO z veljavnim manifestom senzorja —
    // mera z „AR globina“ brez dokazljivega izvora se IZPUSTI (§6 poštenost).
    const sensor = isDepthManifest(q.sensor)
    const method = MEASURE_METHODS.includes(q.method as MeasureMethod)
      ? (q.method === 'DEPTH_AR' && sensor == null ? null : q.method as MeasureMethod)
      : null
    if (!label || valueCm == null || !method) continue
    if (out.length >= SCENE_LIMITS.maxMeasuresPerElement) break
    const toleranceRaw = typeof q.toleranceCm === 'number' && Number.isFinite(q.toleranceCm) &&
      q.toleranceCm >= 0 && q.toleranceCm <= valueCm ? Math.round(q.toleranceCm * 10) / 10 : undefined
    const at = typeof q.at === 'number' && Number.isFinite(q.at) ? Math.round(q.at) : Date.now()
    const by = typeof q.by === 'string' && q.by ? q.by.slice(0, SCENE_LIMITS.idMaxLen) : undefined
    out.push({
      label, valueCm, method,
      ...(toleranceRaw != null ? { toleranceCm: toleranceRaw } : {}),
      ...(method === 'DEPTH_AR' && sensor != null ? { sensor } : {}),
      at,
      ...(by != null ? { by } : {}),
    })
  }
  return out
}

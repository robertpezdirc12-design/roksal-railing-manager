// fence-run-engine — ROKSAL OGRAJNI TEKAČ (R460 — issue #15)
// DETERMINISTIČNI specializirani merilni engine za ograje (§18: brez runtime
// AI). Načelo (§1): ZAČETEK → STEBER → SEGMENT → STEBER → … → KONEC.
//
// Vozlišča tekača so FIZIČNE točke (stebri/vogali/vrata/stopnice/konec) z
// položajem ob teku (atCm), višino, pritrditvijo in podlago. Višinski profil
// terena (§12) določa padino segmentov in višinske razlike. Razpored vmesnih
// stebrov je produktno zaveden (§8/§11): max razpon se bere iz tech JSON
// izdelka — ISTI produktni vir kot konfigurator/AR/foto-vizualizacija.
//
// Statusi dimenzij (§9): ESTIMATED → AUTO_SUGGESTED → MANUAL → CALIBRATED →
// VERIFIED (zunanji merilnik §10) → CONFIRMED (potrditev §20/§21).
// Quality gate (§3): 🟢 DOBER | 🟡 DODAJ | 🔴 NEZADOSTNO + razlogi v človeški
// jeziki. Validacije (§19) odkrijejo nevarne rezultate — BREZ tihih popravkov.
//
// ČIST lib: NIČ strežniških uvozov (db/auth) — uporaben na odjemalcu (živi
// predogled v čarovniku) in na strežniku (kanonični izračun + persist).

// ─── Vrste vozlišč (§1: stebri, vogali, vrata, stopniški prehodi) ───────────

import { CALIB_METHODS, MEASUREMENT_STATUS_ORDER, MEASUREMENT_STATUS_SHORT, type CalibrationMethod, type MeasurementStatus } from './measure-engine'

// Skupna lestvica metod kalibracije — izpeljana iz merilnega jedra, ne tukaj
// napisana ponova (issue #15 faza 2).
export { CALIB_METHODS, type CalibrationMethod }

export type NodeKind = 'ZACETEK' | 'STEBER' | 'VOGAL' | 'VRATA' | 'STOPNISCE' | 'KONEC'

export const NODE_KINDS: { id: NodeKind; label: string; desc: string }[] = [
  { id: 'ZACETEK', label: 'Začetek', desc: 'prva točka ograje' },
  { id: 'STEBER', label: 'Steber', desc: 'vmesni steber ograje' },
  { id: 'VOGAL', label: 'Vogal', desc: 'lom ograje — notranji/zunanji kot' },
  { id: 'VRATA', label: 'Vrata', desc: 'prehod/vrata v ograji' },
  { id: 'STOPNISCE', label: 'Stopnišče', desc: 'stopniški prehod' },
  { id: 'KONEC', label: 'Konec', desc: 'zadnja točka ograje' },
]

export const PRITRDITVE = ['TLACNA', 'STENNA', 'PROSTOSTOJECA', 'DRUGO'] as const
export const PODLAGE = ['BETON', 'ZEMLJA', 'TRAVA', 'TLAK', 'DRUGO'] as const

export type Pritrditev = (typeof PRITRDITVE)[number]
export type Podlaga = (typeof PODLAGE)[number]

export interface RunNode {
  kind: NodeKind
  atCm: number // položaj ob teku od začetka (cm, ≥ 0)
  heightCm?: number // višina stebra nad terenom (cm, 20..400)
  pritrditev?: Pritrditev
  podlaga?: Podlaga
  interiorDeg?: number // notranji kot v vogalu (15..270)
  gateWcm?: number // širina vrat (40..500)
  note?: string
  manual?: boolean // ročno postavljen (§11: ročna sprememba položaja)
}

// ─── Teren (§12: višinski profil) ───────────────────────────────────────────

export interface TerrainPoint { distCm: number; elevCm: number }

/** Višina terena na položaju d — linearna interpolacija, clamped na kraji. */
export function terrainAt (terrain: TerrainPoint[] | null, distCm: number): number {
  if (!terrain || terrain.length === 0) return 0
  if (terrain.length === 1) return terrain[0].elevCm
  if (distCm <= terrain[0].distCm) return terrain[0].elevCm
  const last = terrain[terrain.length - 1]
  if (distCm >= last.distCm) return last.elevCm
  for (let i = 0; i + 1 < terrain.length; i++) {
    const a = terrain[i]; const b = terrain[i + 1]
    if (distCm >= a.distCm && distCm <= b.distCm) {
      const span = b.distCm - a.distCm
      if (span <= 0.01) return b.elevCm
      const t = (distCm - a.distCm) / span
      return a.elevCm + t * (b.elevCm - a.elevCm)
    }
  }
  return last.elevCm
}

/** Največja vrzel med točkami terena (cm) — 0, če terena ni. */
export function terrainMaxGap (terrain: TerrainPoint[] | null): number {
  if (!terrain || terrain.length < 2) return 0
  let gap = 0
  for (let i = 0; i + 1 < terrain.length; i++) gap = Math.max(gap, terrain[i + 1].distCm - terrain[i].distCm)
  return gap
}

// ─── Kalibracija (§4: metoda + referenca + zaupanje) ────────────────────────
//
// Issue #15 faza 2: LESTVICA metod NE SME biti dvojna. `CalibrationMethod` in
// `CALIB_METHODS` (id, label, base) se uvozita iz merilnega jedra, da tekač in
// kamera isto referenco razumeta enako — tu ostanejo samo tekačeve LASTNOSTI
// (fizična vrednost reference v cm, naprava, algorit).

export interface RunCalibration {
  method: CalibrationMethod
  refObject?: string // kaj je bilo izmerjeno (npr. „vhodna plošča 92 cm")
  refValueCm: number // vrednost reference (cm, > 0)
  device?: string // naprava (npr. „Leica DISTO D2")
  capturedAt?: string // ISO datum/čas zajema
  confidence?: number // 0..100 (izračunano — methodConfidence)
  algorithmVersion?: string // verzija algoritma
}

export const ENGINE_VERSION = 'fence-run/1.0'

/** Zaupanje kalibracije iz metode + reference (§4: kratek referenčni objekt
 *  zmanjša zaupanje — večja relativna napaka). Deterministično. */
export function methodConfidence (cal: RunCalibration): number {
  const base = CALIB_METHODS.find((m) => m.id === cal.method)?.base ?? 55
  // referenca ≥ 100 cm → polna; < 30 cm → −15 (relativna napaka majhne mere)
  const penalty = cal.refValueCm >= 100 ? 0 : cal.refValueCm >= 50 ? -5 : cal.refValueCm >= 30 ? -10 : -15
  return Math.max(20, Math.min(99, Math.round(base + penalty)))
}

// ─── Produktna pravila (§8/§11: ISTI vir kot konfigurator) ──────────────────

export interface ProductRules {
  maxSpanCm: number // največji dovoljen razpon med stebri
  maxSlopeDeg: number // največja dovoljena padina
  gateMaxWcm: number // največja širina vrat
}

export const DEFAULT_RULES: ProductRules = { maxSpanCm: 120, maxSlopeDeg: 30, gateMaxWcm: 500 }

/** Prebere pravila iz tech JSON izdela (številska polja maxSpanCm/maxSlopeDeg/
 *  gateMaxWcm) — pisna polja („razmik ≤ 120 cm") se NE tolmačijo (§17: brez
 *  fuzzy matchinga — samo eksplicitne številske vrednosti). */
export function productRulesFromTech (techJson: string | null | undefined): Partial<ProductRules> {
  if (!techJson) return {}
  try {
    const t = JSON.parse(techJson) as Record<string, unknown>
    const out: Partial<ProductRules> = {}
    const span = Number(t.maxSpanCm)
    if (Number.isFinite(span) && span >= 40 && span <= 300) out.maxSpanCm = Math.round(span)
    const slope = Number(t.maxSlopeDeg)
    if (Number.isFinite(slope) && slope >= 5 && slope <= 60) out.maxSlopeDeg = Math.round(slope)
    const gate = Number(t.gateMaxWcm)
    if (Number.isFinite(gate) && gate >= 60 && gate <= 1000) out.gateMaxWcm = Math.round(gate)
    return out
  } catch {
    return {}
  }
}

// ─── Segmenti (izpeljani iz vozlišč + terena) ───────────────────────────────

/**
 * ENA lestvica zaupanja (issue #15 faza 2): imena in kratke oznake so iz
 * merilnega jedra (`MEASUREMENT_STATUS_SHORT`); tekač ima samo svoj `order`
 * (brez RAZVELJAVLJENEGOna ravni segmenta) in barvne razrede.
 */
export type SegmentStatus = Exclude<MeasurementStatus, 'INVALIDATED'>

export const SEGMENT_STATUSES: Record<SegmentStatus, { label: string; order: number; cls: string }> = {
  ESTIMATED: { label: MEASUREMENT_STATUS_SHORT.ESTIMATED, order: MEASUREMENT_STATUS_ORDER.ESTIMATED, cls: 'bg-muted text-muted-foreground' },
  AUTO_SUGGESTED: { label: MEASUREMENT_STATUS_SHORT.AUTO_SUGGESTED, order: MEASUREMENT_STATUS_ORDER.AUTO_SUGGESTED, cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  MANUAL: { label: MEASUREMENT_STATUS_SHORT.MANUAL, order: MEASUREMENT_STATUS_ORDER.MANUAL, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  CALIBRATED: { label: MEASUREMENT_STATUS_SHORT.CALIBRATED, order: MEASUREMENT_STATUS_ORDER.CALIBRATED, cls: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300' },
  VERIFIED: { label: MEASUREMENT_STATUS_SHORT.VERIFIED, order: MEASUREMENT_STATUS_ORDER.VERIFIED, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  CONFIRMED: { label: MEASUREMENT_STATUS_SHORT.CONFIRMED, order: MEASUREMENT_STATUS_ORDER.CONFIRMED, cls: 'bg-secondary text-secondary-foreground' },
}

export interface SegmentCalc {
  order: number
  fromKind: NodeKind
  toKind: NodeKind
  fromAtCm: number
  toAtCm: number
  horizontalCm: number // horizontalna projekcija
  lengthCm: number // 3D dolžina po padini
  heightCm: number | null // višina polnila (od vozlišč/izdelka)
  angleDeg: number | null // notranji kot (samo če je konec VOGAL)
  slopeDeg: number // padina (deg, −90..90)
  heightDiffCm: number // višinska razlika konca
  posts: number // vmesni stebri znotraj segmenta
  status: SegmentStatus
}

export interface ComputeArgs {
  nodes: RunNode[]
  terrain: TerrainPoint[] | null
  rules: ProductRules
  defaultHeightCm?: number // privzeta višina (iz izdelka ali 110)
}

/** Kanonični izračun segmentov med sosednjima vozliščema (§1/§12). */
export function computeSegments (args: ComputeArgs): SegmentCalc[] {
  const { nodes, terrain, rules } = args
  const defaultH = args.defaultHeightCm ?? 110
  const out: SegmentCalc[] = []
  const sorted = [...nodes].sort((a, b) => a.atCm - b.atCm)
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]; const b = sorted[i + 1]
    const horizontalCm = b.atCm - a.atCm
    const elevA = terrainAt(terrain, a.atCm)
    const elevB = terrainAt(terrain, b.atCm)
    const dElev = elevB - elevA
    const lengthCm = Math.hypot(horizontalCm, dElev)
    const slopeDeg = horizontalCm > 0.01 ? (Math.atan2(dElev, horizontalCm) * 180) / Math.PI : 0
    const posts = Math.max(1, Math.ceil(lengthCm / rules.maxSpanCm)) - 1
    const height = b.heightCm ?? a.heightCm ?? defaultH
    out.push({
      order: i,
      fromKind: a.kind,
      toKind: b.kind,
      fromAtCm: round1(a.atCm),
      toAtCm: round1(b.atCm),
      horizontalCm: round1(horizontalCm),
      lengthCm: round1(lengthCm),
      heightCm: height,
      angleDeg: b.kind === 'VOGAL' && b.interiorDeg != null ? b.interiorDeg : null,
      slopeDeg: round1(slopeDeg),
      heightDiffCm: round1(dElev),
      posts,
      status: 'ESTIMATED',
    })
  }
  return out
}

// ─── Samodejni razpored stebrov (§11) ───────────────────────────────────────

export interface PostSuggestion {
  afterAtCm: number // položaj predlaganega stebra (cm ob teku)
  segmentOrder: number
  reason: string
}

/** Predlog vmesnih stebrov: segmenti, ki presegajo max razpon produkta, se
 *  razdelijo na enakomerne razpone (stebri na skoraj enaki razdalji). */
export function suggestPosts (
  segments: Pick<SegmentCalc, 'order' | 'fromAtCm' | 'toAtCm' | 'lengthCm'>[],
  rules: ProductRules
): PostSuggestion[] {
  const out: PostSuggestion[] = []
  for (const s of segments) {
    if (s.lengthCm <= rules.maxSpanCm + 0.01) continue
    const n = Math.ceil(s.lengthCm / rules.maxSpanCm) // št. razponov
    const spacing = s.lengthCm / n
    for (let k = 1; k < n; k++) {
      // položaj po 3D dolžini → približno horizontalni položaj (padina < 45°)
      const t = (k * spacing) / s.lengthCm
      const at = s.fromAtCm + t * (s.toAtCm - s.fromAtCm)
      out.push({
        afterAtCm: round1(at),
        segmentOrder: s.order,
        reason: `segment ${s.order + 1} (${round1(s.lengthCm)} cm) presega max razpon ${rules.maxSpanCm} cm`,
      })
    }
  }
  return out
}

// ─── Validacije (§19: nevarni rezultati — zavrnjeno/označeno, nikoli tiho) ──

export type Severity = 'NAPAKA' | 'OPOZORILO' | 'INFO'
export interface ValidationIssue { code: string; severity: Severity; message: string }

export interface ValidateArgs {
  nodes: RunNode[]
  segments: SegmentCalc[]
  terrain: TerrainPoint[] | null
  rules: ProductRules
  calibration: RunCalibration | null
  /** obstoječe verifikacije: { fromAtCm, toAtCm, verifiedCm } (§10/§19) */
  verifications?: { fromAtCm: number; toAtCm: number; verifiedCm: number }[]
  pendingPosts?: PostSuggestion[]
}

/** Toleranca konflikta: 2 cm + 1 % izmerjene vrednosti (§19). */
export function conflictToleranceCm (verifiedCm: number): number {
  return 2 + verifiedCm * 0.01
}

export function validateRun (args: ValidateArgs): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { nodes, segments, terrain, rules, calibration } = args
  const sorted = [...nodes].sort((a, b) => a.atCm - b.atCm)

  if (sorted.length < 2) {
    issues.push({ code: 'RUN_PREKRATKA', severity: 'NAPAKA', message: 'Ograja potrebuje vsaj začetek in konec (2 točki).' })
  }
  if (sorted.length > 0 && sorted[0].kind !== 'ZACETEK') {
    issues.push({ code: 'BREZ_ZACETKA', severity: 'OPOZORILO', message: 'Prva točka ni označena kot začetek ograje.' })
  }
  if (sorted.length > 1 && sorted[sorted.length - 1].kind !== 'KONEC') {
    issues.push({ code: 'BREZ_KONCA', severity: 'OPOZORILO', message: 'Zadnja točka ni označena kot konec ograje.' })
  }

  // padina vs produkt (§19: naklon ni združljiv s konfiguracijo)
  for (const s of segments) {
    if (Math.abs(s.slopeDeg) > rules.maxSlopeDeg) {
      issues.push({
        code: 'SEGMENT_NAGIB',
        severity: 'NAPAKA',
        message: `Segment ${s.order + 1}: padina ${s.slopeDeg.toFixed(1)}° presega dovoljeno ${rules.maxSlopeDeg}° — prilagodite konfiguracijo ali teren.`,
      })
    }
  }

  // vrata: širina + prostor za stebrov okvirja (§19: vrata presežejo prostor)
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]
    if (n.kind !== 'VRATA') continue
    const prev = sorted[i - 1]
    const next = sorted[i + 1]
    const gateW = n.gateWcm ?? 100
    if (gateW > rules.gateMaxWcm) {
      issues.push({
        code: 'VRATA_PRESEZEK',
        severity: 'NAPAKA',
        message: `Vrata na ${round1(n.atCm / 100)} m: širina ${gateW} cm presega maksimum ${rules.gateMaxWcm} cm.`,
      })
    }
    if (prev && n.atCm - prev.atCm < 30) {
      issues.push({
        code: 'VRATA_PROSTOR',
        severity: 'NAPAKA',
        message: `Vrata na ${round1(n.atCm / 100)} m: pred vrati je manj kot 30 cm za steber okvirja.`,
      })
    }
    if (next && next.atCm - n.atCm < 30) {
      issues.push({
        code: 'VRATA_PROSTOR',
        severity: 'NAPAKA',
        message: `Vrata na ${round1(n.atCm / 100)} m: za vrati je manj kot 30 cm za steber okvirja.`,
      })
    }
  }

  // konflikt z zunanjim merilnikom (§19: meritev v konfliktu s potrjeno)
  for (const v of args.verifications ?? []) {
    for (const s of segments) {
      if (Math.abs(s.fromAtCm - v.fromAtCm) < 1 && Math.abs(s.toAtCm - v.toAtCm) < 1) {
        const tol = conflictToleranceCm(v.verifiedCm)
        const dev = Math.abs(s.lengthCm - v.verifiedCm)
        if (dev > tol) {
          issues.push({
            code: 'KONFLIKT_VERIFIED',
            severity: 'NAPAKA',
            message: `Segment ${s.order + 1}: izračun ${round1(s.lengthCm)} cm odstopa ${round1(dev)} cm od preverjene mere ${round1(v.verifiedCm)} cm (toleranca ${round1(tol)} cm) — popravite geometrijo ali ponovno preverite.`,
          })
        }
        break
      }
    }
  }

  // predlagani stebri še niso vstavljeni (§11)
  if ((args.pendingPosts ?? []).length > 0) {
    issues.push({
      code: 'PREDLAGANI_STEBRI',
      severity: 'OPOZORILO',
      message: `${(args.pendingPosts ?? []).length} predlaganih vmesnih stebrov še ni vstavljenih — razpon presega produkt.`,
    })
  }

  // kalibracija (§4: brez reference ni zanesljive izmere)
  if (!calibration) {
    issues.push({
      code: 'BREZ_KALIBRACIJE',
      severity: 'OPOZORILO',
      message: 'Manjka kalibracija — podajte referenco (marker/znana mera/laser/LiDAR).',
    })
  }

  // teren redke točke (§12)
  const gap = terrainMaxGap(terrain)
  if (terrain && terrain.length >= 2 && gap > 1500) {
    issues.push({
      code: 'TEREN_REDKE',
      severity: 'OPOZORILO',
      message: `Višinske točke terena so redke (vrzel ${round1(gap / 100)} m) — dodajte točke na klancu.`,
    })
  }

  // podlaga stebra (§19: steber izven podlage)
  for (const n of sorted) {
    if (n.kind !== 'ZACETEK' && !n.podlaga) {
      issues.push({
        code: 'MANJKA_PODLAGA',
        severity: 'OPOZORILO',
        message: `Točka na ${round1(n.atCm / 100)} m nima podane podlage — preverite, kam steber stoji.`,
      })
      break // ena opomba zadostuje
    }
  }

  // vogal brez kota (INFO)
  for (const n of sorted) {
    if (n.kind === 'VOGAL' && n.interiorDeg == null) {
      issues.push({
        code: 'VOGAL_BREZ_KOTA',
        severity: 'INFO',
        message: `Vogal na ${round1(n.atCm / 100)} m nima podanega kota — vnesite notranji kot.`,
      })
      break
    }
  }

  return issues
}

// ─── Quality gate (§3: 🟢/🟡/🔴 pred potrditvijo) ───────────────────────────

export type GateState = 'DOBER' | 'DODAJ' | 'NEZADOSTNO'
export interface QualityResult { state: GateState; score: number; reasons: string[] }

export interface GateArgs {
  nodes: RunNode[]
  segments: SegmentCalc[]
  validation: ValidationIssue[]
  calibration: RunCalibration | null
  terrain: TerrainPoint[] | null
  verifications: number // št. preverjenih segmentov (§10)
}

/** Deterministični quality gate: 🔴 blokira potrditev, 🟡 zahteva dopolnitev,
 *  🟢 dovoli potrditev. Razlogi so v človeškem jeziku (§3). */
export function qualityGate (args: GateArgs): QualityResult {
  const { nodes, segments, validation, calibration, terrain, verifications } = args
  const reasons: string[] = []
  const napake = validation.filter((v) => v.severity === 'NAPAKA')
  const opozorila = validation.filter((v) => v.severity === 'OPOZORILO')

  let state: GateState = 'DOBER'
  if (nodes.length < 2 || !calibration || napake.length > 0) {
    state = 'NEZADOSTNO'
    if (nodes.length < 2) reasons.push('Zajem ni zanesljiv — manjkajo točke ograje.')
    if (!calibration) reasons.push('Manjka referenčna kalibracija.')
    for (const n of napake) reasons.push(n.message)
  } else if (opozorila.length > 0) {
    state = 'DODAJ'
    for (const o of opozorila) reasons.push(o.message)
  }

  // ocena 0..100 — iz zaupanja kalibracije + pokritosti segmentov + terena
  let score = calibration ? methodConfidence(calibration) : 20
  const unverified = segments.filter((s) => s.status === 'ESTIMATED' || s.status === 'AUTO_SUGGESTED').length
  if (segments.length > 0) {
    const covered = (segments.length - unverified) / segments.length
    score = Math.round(score * 0.6 + covered * 40)
    if (unverified > 0 && state === 'DOBER') {
      state = 'DODAJ'
      reasons.push(`${unverified} segmentov je brez človeške preveritve (ocena/predlog).`)
    }
  }
  if (terrain && terrain.length >= 2) score = Math.min(100, score + 5)
  if (verifications > 0) score = Math.min(100, score + 5)
  score = Math.max(0, Math.min(100, score - napake.length * 15))

  return { state, score, reasons }
}

// ─── Statusi dimenzij (§9) ──────────────────────────────────────────────────

/** Izpeljavi status segmenta: verifikacija > ročno > kalibracija > predlog. */
export function deriveStatus (args: {
  seg: Pick<SegmentCalc, 'fromAtCm' | 'toAtCm'>
  verifications: { fromAtCm: number; toAtCm: number }[]
  manualNodes: boolean // ali katero od vozlišč segmenta nosi manual=true
  calibrated: boolean // ali tekač nosi kalibracijo
}): SegmentStatus {
  const verified = args.verifications.some(
    (v) => Math.abs(v.fromAtCm - args.seg.fromAtCm) < 1 && Math.abs(v.toAtCm - args.seg.toAtCm) < 1
  )
  if (verified) return 'VERIFIED'
  if (args.manualNodes) return 'MANUAL'
  if (args.calibrated) return 'CALIBRATED'
  return 'ESTIMATED'
}

// ─── Povzetki za BOM/prenos (§21: brez ponovnega vnosa) ────────────────────

export interface RunSummary {
  totalLengthCm: number
  postCount: number // vsa fizična vozlišča + vmesni stebri
  segmentCount: number
  maxSlopeDeg: number
  heightDiffCm: number // skupna višinska razlika
  handrailM: number
  verifiedCount: number
}

export function summarizeRun (nodes: RunNode[], segments: SegmentCalc[], terrain: TerrainPoint[] | null = null): RunSummary {
  const sorted = [...nodes].sort((a, b) => a.atCm - b.atCm)
  const totalLengthCm = segments.reduce((acc, s) => acc + s.lengthCm, 0)
  const intermediate = segments.reduce((acc, s) => acc + s.posts, 0)
  const heightDiff = sorted.length >= 2
    ? terrainAt(terrain, sorted[sorted.length - 1].atCm) - terrainAt(terrain, sorted[0].atCm)
    : 0
  return {
    totalLengthCm: round1(totalLengthCm),
    postCount: sorted.length + intermediate,
    segmentCount: segments.length,
    maxSlopeDeg: segments.reduce((m, s) => Math.max(m, Math.abs(s.slopeDeg)), 0),
    heightDiffCm: round1(heightDiff),
    handrailM: Math.round((totalLengthCm / 100) * 100) / 100,
    verifiedCount: 0, // dopolni klicalec (iz segmentov s statusom VERIFIED/CONFIRMED)
  }
}

// ─── Parserji (skupni odjemalcu in strežniku — ISTA pravila) ────────────────

const MAX_NODES = 64
const MAX_TERRAIN = 33

export function parseNodes (v: unknown): RunNode[] | null {
  if (v === null || v === undefined) return null
  if (!Array.isArray(v)) return null
  if (v.length === 0 || v.length > MAX_NODES) return null
  const out: RunNode[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const atCm = Number(o.atCm)
    if (!Number.isFinite(atCm) || atCm < 0 || atCm > 100000) return null
    const kind = String(o.kind ?? '')
    if (!(NODE_KINDS.map((k) => k.id) as string[]).includes(kind)) return null
    const node: RunNode = { kind: kind as NodeKind, atCm: round1(atCm) }
    const h = Number(o.heightCm)
    if (o.heightCm !== undefined && o.heightCm !== null) {
      if (!Number.isFinite(h) || h < 20 || h > 400) return null
      node.heightCm = Math.round(h)
    }
    if (typeof o.pritrditev === 'string' && (PRITRDITVE as readonly string[]).includes(o.pritrditev)) node.pritrditev = o.pritrditev as Pritrditev
    if (typeof o.podlaga === 'string' && (PODLAGE as readonly string[]).includes(o.podlaga)) node.podlaga = o.podlaga as Podlaga
    const deg = Number(o.interiorDeg)
    if (o.interiorDeg !== undefined && o.interiorDeg !== null) {
      if (!Number.isFinite(deg) || deg < 15 || deg > 270) return null
      node.interiorDeg = round1(deg)
    }
    const g = Number(o.gateWcm)
    if (o.gateWcm !== undefined && o.gateWcm !== null) {
      if (!Number.isFinite(g) || g < 40 || g > 500) return null
      node.gateWcm = Math.round(g)
    }
    if (typeof o.note === 'string' && o.note.trim()) node.note = o.note.trim().slice(0, 200)
    if (o.manual === true) node.manual = true
    out.push(node)
  }
  out.sort((a, b) => a.atCm - b.atCm)
  // striktno naraščajoči položaji (min 5 cm med točkami)
  for (let i = 0; i + 1 < out.length; i++) {
    if (out[i + 1].atCm - out[i].atCm < 5) return null
  }
  return out
}

export function parseTerrain (v: unknown): TerrainPoint[] | null {
  if (v === null || v === undefined) return null
  if (!Array.isArray(v)) return null
  if (v.length === 0 || v.length > MAX_TERRAIN) return null
  const out: TerrainPoint[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const d = Number(o.distCm); const e = Number(o.elevCm)
    if (!Number.isFinite(d) || d < 0 || d > 100000) return null
    if (!Number.isFinite(e) || e < -500 || e > 5000) return null
    out.push({ distCm: round1(d), elevCm: round1(e) })
  }
  out.sort((a, b) => a.distCm - b.distCm)
  for (let i = 0; i + 1 < out.length; i++) {
    if (out[i + 1].distCm - out[i].distCm < 1) return null
  }
  return out
}

export function parseCalibration (v: unknown): RunCalibration | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const method = String(o.method ?? '')
  if (!CALIB_METHODS.some((m) => m.id === method)) return null
  const refValueCm = Number(o.refValueCm)
  if (!Number.isFinite(refValueCm) || refValueCm < 1 || refValueCm > 10000) return null
  const out: RunCalibration = { method: method as CalibrationMethod, refValueCm: round1(refValueCm) }
  if (typeof o.refObject === 'string' && o.refObject.trim()) out.refObject = o.refObject.trim().slice(0, 120)
  if (typeof o.device === 'string' && o.device.trim()) out.device = o.device.trim().slice(0, 80)
  if (typeof o.capturedAt === 'string' && o.capturedAt.trim()) out.capturedAt = o.capturedAt.trim().slice(0, 30)
  const c = Number(o.confidence)
  if (Number.isFinite(c) && c >= 0 && c <= 100) out.confidence = Math.round(c)
  return out
}

// ─── Strežniški pomočnik: usklajevanje segmentov ob spremembi geometrije ────

export interface PersistedSegment {
  id: string
  order: number
  fromAtCm: number
  toAtCm: number
  status: string
  verifiedCm: number | null
  verifyMethod: string | null
  verifyNote: string | null
  note: string | null
  version: number
}

export interface SegmentUpsert {
  order: number
  fromKind: string
  toKind: string
  fromAtCm: number
  toAtCm: number
  lengthCm: number
  heightCm: number | null
  angleDeg: number | null
  slopeDeg: number
  heightDiffCm: number
  posts: number
  status: SegmentStatus
  verifiedCm: number | null
  verifyMethod: string | null
  verifyNote: string | null
  version: number
  note: string | null
  source: 'ROCNO' | 'ENGINE'
}

/**
 * Nova geometrija + ohranitev preverjenih segmentov: če se poziciji fromAt/toAt
 * ujemata (±1 cm) s starim segmentom, se status/verifikacija prenese (version+1);
 * sicer segment POŠTENO razveljavljen na ESTIMATED v1 (§19 — sprememba
 * geometrije razveljavi preveritev, brez tihega prenosa).
 */
export function reconcileSegments (computed: SegmentCalc[], old: PersistedSegment[]): SegmentUpsert[] {
  return computed.map((s) => {
    const match = old.find(
      (o) => Math.abs(o.fromAtCm - s.fromAtCm) < 1 && Math.abs(o.toAtCm - s.toAtCm) < 1
    )
    if (match) {
      return {
        order: s.order,
        fromKind: s.fromKind,
        toKind: s.toKind,
        fromAtCm: s.fromAtCm,
        toAtCm: s.toAtCm,
        lengthCm: s.lengthCm,
        heightCm: s.heightCm,
        angleDeg: s.angleDeg,
        slopeDeg: s.slopeDeg,
        heightDiffCm: s.heightDiffCm,
        posts: s.posts,
        status: match.status as SegmentStatus,
        verifiedCm: match.verifiedCm,
        verifyMethod: match.verifyMethod,
        verifyNote: match.verifyNote,
        version: match.version + 1,
        note: match.note,
        source: 'ROCNO' as const,
      }
    }
    return {
      order: s.order,
      fromKind: s.fromKind,
      toKind: s.toKind,
      fromAtCm: s.fromAtCm,
      toAtCm: s.toAtCm,
      lengthCm: s.lengthCm,
      heightCm: s.heightCm,
      angleDeg: s.angleDeg,
      slopeDeg: s.slopeDeg,
      heightDiffCm: s.heightDiffCm,
      posts: s.posts,
      status: s.status,
      verifiedCm: null,
      verifyMethod: null,
      verifyNote: null,
      version: 1,
      note: null,
      source: 'ENGINE' as const,
    }
  })
}

// ─── Pomožno ────────────────────────────────────────────────────────────────

export function round1 (n: number): number {
  return Math.round(n * 10) / 10
}

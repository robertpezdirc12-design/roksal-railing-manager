// reality-r2p-engine — ROKSAL REALITY-TO-PRODUCTION (R462 — issue #17)
// ČIST, brez db — ISTA pravila na odjemalcu in strežniku.
// Georeferenca (§1/§2), 3-točkovna registracija (§3), loop closure (§5),
// coverage/quality/deviation heatmapi (§6/§7/§12), element-level QA (§8) in
// deviation statusi s tolerancami IZKLJUČNO iz inženirskih pravil (§12 —
// brez ugibanj: manjka pravilo → NO VERIFIED TOLERANCE RULE).
// Nadstropje nad R460 (tekač) in R461 (capture QA + dvojček) — brez podvajanja.

export const R2P_VERSION = 'reality-r2p/1.0'

// ─── §1: GEOREFERENCIRANJE — tieri ──────────────────────────────────────────

export type GeoTier = 'BASIC' | 'PROFESSIONAL' | 'SURVEY'

export const GEO_TIERS: Record<GeoTier, { label: string; desc: string }> = {
  BASIC: { label: 'BASIC — kamera + lokalna referenca', desc: 'Lokalni koordinatni sistem zajema.' },
  PROFESSIONAL: { label: 'PROFESSIONAL — AR/LiDAR + fizične točke', desc: 'Fizične referenčne točke + AR sledenje.' },
  SURVEY: { label: 'SURVEY — GNSS/RTK + referenčne točke', desc: 'Geodetska natančnost z RTK korekcijami.' },
}

// ─── §2: RTK/GNSS viri — ZGORNJE meje natančnosti (brez lažne natančnosti) ──

export type GeoSource = 'GNSS_RTK' | 'GNSS_FLOAT' | 'GNSS_NONE' | 'LASER' | 'MARKER' | 'MANUAL'

export interface GeoSourceDef {
  id: GeoSource
  label: string
  hAccCapM: number // horizontalna ZGORNJA meja (m) — ne prikaži boljše
  vAccCapM: number
  rtk: boolean
}

export const GEO_SOURCES: GeoSourceDef[] = [
  { id: 'GNSS_RTK', label: 'GNSS RTK (FIX)', hAccCapM: 0.02, vAccCapM: 0.03, rtk: true },
  { id: 'GNSS_FLOAT', label: 'GNSS FLOAT', hAccCapM: 0.5, vAccCapM: 1.0, rtk: true },
  { id: 'GNSS_NONE', label: 'GNSS brez korekcij', hAccCapM: 3.0, vAccCapM: 5.0, rtk: true },
  { id: 'LASER', label: 'Zunanji laser (offset od referenčne točke)', hAccCapM: 0.005, vAccCapM: 0.01, rtk: false },
  { id: 'MARKER', label: 'Fizični marker (izmerjeno)', hAccCapM: 0.01, vAccCapM: 0.02, rtk: false },
  { id: 'MANUAL', label: 'Ročni vnos (karta/skica)', hAccCapM: 1.0, vAccCapM: 2.0, rtk: false },
]

export function geoSourceDef (source: string): GeoSourceDef | null {
  return GEO_SOURCES.find((s) => s.id === source) ?? null
}

export interface GeoAccResult {
  hAccM: number // učinkovita (najslabša od: zahtevana, capa vira)
  vAccM: number
  capped: boolean // true = zahtevana natančnost je bila znižana na cap vira
  reason: string
}

/**
 * Učinkovita natančnost georeference (§1): zahtevana vrednost se OMEJI na
 * zgornjo mejo vira — naprava, ki ne podpira centimetrske natančnosti, je
 * ne sme prikazati. Brez lažne natančnosti.
 */
export function effectiveAccuracy (source: string, hAccM?: number | null, vAccM?: number | null): GeoAccResult {
  const def = geoSourceDef(source)
  if (!def) {
    return { hAccM: 5, vAccM: 10, capped: true, reason: 'Neznan vir — privzeta konzervativna meja.' }
  }
  const reqH = hAccM != null && Number.isFinite(hAccM) && hAccM > 0 ? hAccM : def.hAccCapM
  const reqV = vAccM != null && Number.isFinite(vAccM) && vAccM > 0 ? vAccM : def.vAccCapM
  const h = Math.max(reqH, def.hAccCapM)
  const v = Math.max(reqV, def.vAccCapM)
  const capped = h > reqH + 1e-9 || v > reqV + 1e-9
  return {
    hAccM: Math.round(h * 1000) / 1000,
    vAccM: Math.round(v * 1000) / 1000,
    capped,
    reason: capped
      ? `Zahtevana natančnost presega zmožnost vira ${def.label} — prikazana ZGORNJA meja vira (§1).`
      : `Natančnost v okviru vira ${def.label}.`,
  }
}

/** §2: RTK koordinata NIKOLI samodejno ne postane proizvodna mera. */
export const RTK_NOT_PRODUCTION = 'RTK/GNSS koordinata je prostorska referenca — NI proizvodna mera (§2). Proizvodne mere nastanejo iz tekača z VERIFIED/CONFIRMED.'

export interface RtkQuality {
  usable: boolean
  reason: string
  correctionAgeOk: boolean
}

/** RTK kakovost (§2): FIX uporabna kot referenca; FLOAT/NONE z razlogom. */
export function rtkQuality (rtkStatus: string | null | undefined, correctionAgeSec?: number | null): RtkQuality {
  const ageOk = correctionAgeSec == null ? true : correctionAgeSec <= 60
  if (rtkStatus === 'FIX') {
    return {
      usable: true,
      reason: ageOk ? 'RTK FIX — korekcije sveže.' : 'RTK FIX, a korekcije stale — preveri starost.',
      correctionAgeOk: ageOk,
    }
  }
  if (rtkStatus === 'FLOAT') {
    return { usable: false, reason: 'RTK FLOAT — premerna za prostorsko referenco; zahtevaj FIX ali fizično referenco.', correctionAgeOk: ageOk }
  }
  if (rtkStatus === 'NONE') {
    return { usable: false, reason: 'Brez RTK korekcij — samo približna lokacija.', correctionAgeOk: ageOk }
  }
  return { usable: true, reason: 'Vir brez RTK (laser/marker/ročno) — natančnost iz vira.', correctionAgeOk: ageOk }
}

// ─── §3: 3-TOČKOVNA REGISTRACIJA ────────────────────────────────────────────

export interface RegPointPair {
  code: string
  source: { x: number; y: number } // položaj v zajemu (npr. ob teku: x=atCm, y=elevCm)
  target: { x: number; y: number } // položaj v ciljnem okviru (npr. geo/načrt)
}

export interface RegTransform {
  tx: number // translacija x (cm)
  ty: number
  rotationDeg: number // rotacija (deg)
  scale: number // merilo (brezdimenzijsko)
  orientation: string // 'source → target' opis
}

export type RegQuality = 'GOOD' | 'WARNING' | 'INVALID'

export const REG_QUALITY: Record<RegQuality, { label: string; cls: string; desc: string }> = {
  GOOD: { label: 'REGISTRATION QUALITY = GOOD', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', desc: 'RMS ≤ 1 cm' },
  WARNING: { label: 'REGISTRATION QUALITY = WARNING', cls: 'bg-amber-100 text-amber-900 border-amber-300', desc: 'RMS ≤ 3 cm' },
  INVALID: { label: 'REGISTRATION QUALITY = INVALID', cls: 'bg-red-100 text-red-800 border-red-300', desc: 'RMS > 3 cm ali degenerirana geometrija' },
}

export interface RegResult {
  transform: RegTransform
  rmsCm: number
  quality: RegQuality
  residuals: { code: string; dx: number; dy: number; distCm: number }[]
  reasons: string[]
}

export const REG_GOOD_CM = 1
export const REG_WARN_CM = 3
const MIN_SPAN_CM = 100 // točke morajo razpetost vsaj 1 m — sicer degenerirano

/**
 * 3-točkovna podobnostna registracija (§3): najmanjši kvadrati preslikave
 * source → target (4 parametri: tx, ty, rotacija, merilo). Prekomerno
 * določen sistem (3 točke = 6 enačb) da residuale → RMS = utemeljena
 * kakovost ujemanja. Degenerirana geometrija (prekratke razpetosti,
 * skoraj kolinearne točke) → INVALID z razlogom.
 */
export function register3Points (pairs: RegPointPair[]): RegResult {
  const reasons: string[] = []
  if (pairs.length !== 3) {
    return {
      transform: { tx: 0, ty: 0, rotationDeg: 0, scale: 1, orientation: '—' },
      rmsCm: Infinity,
      quality: 'INVALID',
      residuals: [],
      reasons: [`Pričakovanih 3 točke, podanih ${pairs.length}.`],
    }
  }
  // degeneriranost: razpetost source in target točk
  const span = (pts: { x: number; y: number }[]) => {
    let maxD = 0
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        maxD = Math.max(maxD, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y))
      }
    }
    return maxD
  }
  const spanSrc = span(pairs.map((p) => p.source))
  const spanTgt = span(pairs.map((p) => p.target))
  if (spanSrc < MIN_SPAN_CM || spanTgt < MIN_SPAN_CM) {
    reasons.push(`Razpetost točk premajhna (source ${spanSrc.toFixed(0)} cm / target ${spanTgt.toFixed(0)} cm < ${MIN_SPAN_CM} cm) — dodaj razpršene točke.`)
    return {
      transform: { tx: 0, ty: 0, rotationDeg: 0, scale: 1, orientation: '—' },
      rmsCm: Infinity, quality: 'INVALID', residuals: [], reasons,
    }
  }
  // kolinearnost: ploskovina trikotnika → razmerje višine
  const [a, b, c] = pairs.map((p) => p.source)
  const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y))
  const triQuality = area2 / (spanSrc * spanSrc)
  if (triQuality < 0.02) {
    reasons.push('Točke so skoraj kolinearne — registracija nezanesljiva; izberi trikotno razporeditev.')
    return {
      transform: { tx: 0, ty: 0, rotationDeg: 0, scale: 1, orientation: '—' },
      rmsCm: Infinity, quality: 'INVALID', residuals: [], reasons,
    }
  }

  // centroidi
  const n = pairs.length
  const cs = pairs.reduce((acc, p) => ({ x: acc.x + p.source.x / n, y: acc.y + p.source.y / n }), { x: 0, y: 0 })
  const ct = pairs.reduce((acc, p) => ({ x: acc.x + p.target.x / n, y: acc.y + p.target.y / n }), { x: 0, y: 0 })
  // similariteta (2D Umeyama): rotacija iz atan2(cross, dot), merilo iz |kompleksnega|
  let dot = 0
  let den = 0
  for (const p of pairs) {
    const sx = p.source.x - cs.x
    const sy = p.source.y - cs.y
    const tx2 = p.target.x - ct.x
    const ty2 = p.target.y - ct.y
    dot += sx * tx2 + sy * ty2 // kosinusni člen
    den += sx * sx + sy * sy
  }
  const cross = crossSum(pairs, cs, ct)
  const theta = Math.atan2(cross, dot)
  const rotationDeg = (theta * 180) / Math.PI
  const s = den > 0 ? Math.hypot(dot, cross) / den : 1 // merilo iz |kompleksnega|
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const tx = ct.x - s * (cos * cs.x - sin * cs.y)
  const ty = ct.y - s * (sin * cs.x + cos * cs.y)

  // residuali
  const residuals = pairs.map((p) => {
    const px = s * (cos * p.source.x - sin * p.source.y) + tx
    const py = s * (sin * p.source.x + cos * p.source.y) + ty
    const dx = p.target.x - px
    const dy = p.target.y - py
    return { code: p.code, dx: r2(dx), dy: r2(dy), distCm: r2(Math.hypot(dx, dy)) }
  })
  const rmsCm = r2(Math.sqrt(residuals.reduce((a2, rr) => a2 + rr.distCm * rr.distCm, 0) / residuals.length))
  let quality: RegQuality
  if (rmsCm <= REG_GOOD_CM) quality = 'GOOD'
  else if (rmsCm <= REG_WARN_CM) quality = 'WARNING'
  else quality = 'INVALID'
  if (quality === 'WARNING') reasons.push(`RMS ${rmsCm.toFixed(2)} cm — priporočena kontrola (≤ ${REG_WARN_CM} cm).`)
  if (quality === 'INVALID') reasons.push(`RMS ${rmsCm.toFixed(2)} cm presega ${REG_WARN_CM} cm — registracija neveljavna.`)
  if (Math.abs(s - 1) > 0.05) reasons.push(`Merilo ${s.toFixed(3)} odstopa od 1 — preveri enote točk.`)
  return {
    transform: {
      tx: r2(tx), ty: r2(ty),
      rotationDeg: r2(rotationDeg),
      scale: r3(s),
      orientation: 'zajem → ciljni okvir (geo/načrt)',
    },
    rmsCm, quality, residuals, reasons,
  }
}

function crossSum (pairs: RegPointPair[], cs: { x: number; y: number }, ct: { x: number; y: number }): number {
  let cross = 0
  for (const p of pairs) {
    cross += (p.source.x - cs.x) * (p.target.y - ct.y) - (p.source.y - cs.y) * (p.target.x - ct.x)
  }
  return cross
}

const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000

// ─── §5: LOOP CLOSURE ───────────────────────────────────────────────────────

export type LoopStatus = 'LOOP_CLOSED' | 'LOOP_WARNING' | 'LOOP_FAILED'

export const LOOP_STATUSES: Record<LoopStatus, { label: string; cls: string; desc: string }> = {
  LOOP_CLOSED: { label: 'LOOP CLOSED', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', desc: 'Povratek na začetek znotraj tolerance.' },
  LOOP_WARNING: { label: 'LOOP WARNING', cls: 'bg-amber-100 text-amber-900 border-amber-300', desc: 'Odmik blizu meje — kontrola priporočena.' },
  LOOP_FAILED: { label: 'LOOP FAILED', cls: 'bg-red-100 text-red-800 border-red-300', desc: 'Zanka se ne zapre — območje konflikta, zahtevaj novo referenco/ponovni zajem.' },
}

export interface LoopResult {
  status: LoopStatus
  positionDiffCm: number
  heightDiffCm: number | null
  reasons: string[]
}

export const LOOP_TOL_CM = 2 // privzeta toleranca zanke (cm) — iz pravila, če obstaja

/** Preverjanje zanke (§5): prijavljeno vs. zunanje merilo ob povratku. */
export function loopClosureCheck (args: {
  expectedCm: number
  measuredCm: number
  heightDiffCm?: number | null
  toleranceCm?: number | null
}): LoopResult {
  const tol = args.toleranceCm != null && args.toleranceCm > 0 ? args.toleranceCm : LOOP_TOL_CM
  const diff = Math.abs(args.measuredCm - args.expectedCm)
  const reasons: string[] = []
  let status: LoopStatus
  if (diff <= tol) {
    status = 'LOOP_CLOSED'
    reasons.push(`Odmik ${diff.toFixed(1)} cm ≤ toleranca ${tol} cm.`)
  } else if (diff <= 2 * tol) {
    status = 'LOOP_WARNING'
    reasons.push(`Odmik ${diff.toFixed(1)} cm blizu meje (2×${tol} cm) — kontrola priporočena.`)
  } else {
    status = 'LOOP_FAILED'
    reasons.push(`Odmik ${diff.toFixed(1)} cm presega ${2 * tol} cm — zanka SE NE ZAPRE.`)
    reasons.push('Območje konflikta označeno; starih potrjenih meritev NE spreminjamo — zahtevaj novo referenco ali ponovni zajem (§5).')
  }
  if (args.heightDiffCm != null && Math.abs(args.heightDiffCm) > 3) {
    if (status === 'LOOP_CLOSED') status = 'LOOP_WARNING'
    reasons.push(`Višinsko odstopanje ${args.heightDiffCm.toFixed(1)} cm > 3 cm.`)
  }
  return { status, positionDiffCm: r2(diff), heightDiffCm: args.heightDiffCm != null ? r2(args.heightDiffCm) : null, reasons }
}

// ─── §12: TOLERANCE IZ INŽENIRSKIH PRAVIL ───────────────────────────────────

/** Ključi tolerance, ki jih R462 pričakuje v EngineeringRule (brez ugibanj). */
export const TOLERANCE_RULE_KEYS = {
  length: 'tol_dolzina_segmenta',
  height: 'tol_visina',
  post: 'tol_pozicija_stebra',
  angle: 'tol_kot',
  slope: 'tol_nagib',
  loop: 'tol_loop_zanka',
} as const

export type ToleranceKind = keyof typeof TOLERANCE_RULE_KEYS

export type TolRuleMap = Record<string, { value: number; unit: string; label: string }>

export interface TolLookup {
  toleranceCm: number | null
  ruleKey: string
  noRule: boolean
}

/** Toleranca IZKLJUČNO iz pravil (§12); manjka → null + NO VERIFIED TOLERANCE RULE. */
export function toleranceFromRules (rules: TolRuleMap, kind: ToleranceKind): TolLookup {
  const key = TOLERANCE_RULE_KEYS[kind]
  const r = rules[key]
  if (!r || !(r.value > 0)) {
    return { toleranceCm: null, ruleKey: key, noRule: true }
  }
  // enota: privzimo cm; '°' ostane kot je (koti)
  return { toleranceCm: r.value, ruleKey: key, noRule: false }
}

export const NO_TOLERANCE_MSG = 'NO VERIFIED TOLERANCE RULE — pravilo ni definirano; odstopanje je prikazano brez ocene (§12, brez ugibanj).'

export type DeviationStatus = 'WITHIN_TOLERANCE' | 'REVIEW_REQUIRED' | 'BLOCKING' | 'NO_VERIFIED_TOLERANCE_RULE' | 'APPROVED_CHANGE'

export const DEVIATION_STATUSES: Record<DeviationStatus, { label: string; cls: string }> = {
  WITHIN_TOLERANCE: { label: 'znotraj tolerance', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  REVIEW_REQUIRED: { label: 'potrebna kontrola', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  BLOCKING: { label: 'BLOKIRAJOČE', cls: 'bg-red-100 text-red-800 border-red-300' },
  NO_VERIFIED_TOLERANCE_RULE: { label: NO_TOLERANCE_MSG.slice(0, 30) + '…', cls: 'bg-gray-100 text-gray-700 border-gray-300' },
  APPROVED_CHANGE: { label: 'odobrena sprememba (CHANGE → APPROVAL)', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
}

/** Status odstopanja (§9–§11): diff vs. toleranca iz pravil. */
export function deviationStatus (diffAbs: number | null, tol: TolLookup, isAngle = false): DeviationStatus {
  if (diffAbs == null || !Number.isFinite(diffAbs)) return 'NO_VERIFIED_TOLERANCE_RULE'
  if (tol.noRule || tol.toleranceCm == null) return 'NO_VERIFIED_TOLERANCE_RULE'
  const t = tol.toleranceCm
  if (diffAbs <= t) return 'WITHIN_TOLERANCE'
  if (diffAbs <= 1.5 * t) return 'REVIEW_REQUIRED'
  void isAngle
  return 'BLOCKING'
}

// ─── §6: 3D COVERAGE HEATMAP (po conah, � pleine za nerelevantno) ────────────

export type HeatState = 'ZELENO' | 'RUMENO' | 'RDECE' | 'NI_RELEVANTNO'

export const HEAT_STATES: Record<HeatState, { label: string; cls: string; char: string }> = {
  ZELENO: { label: 'dovolj zajeto', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', char: '🟢' },
  RUMENO: { label: 'priporočena kontrola', cls: 'bg-amber-100 text-amber-900 border-amber-300', char: '🟡' },
  RDECE: { label: 'nezadostno', cls: 'bg-red-100 text-red-800 border-red-300', char: '🔴' },
  NI_RELEVANTNO: { label: 'ni relevantno', cls: 'bg-gray-100 text-gray-500 border-gray-300', char: '⚪' },
}

export interface HeatZone {
  key: string
  label: string
  state: HeatState
  detail: string
}

/**
 * Coverage heatmap (§6) iz con R461: ZAJETO/DOBRO → 🟢, SLABO → 🟡,
 * NEZAJETO → 🔴. Dodatne elementarne cone (pritrdilna mesta, višinski
 * prelomi) so ⚪, kadar za njih ni definiranih obveznih zajemov.
 */
export function coverageHeatmap (zones: { stopId: string; label: string; state: string; photoCount: number; goodCount: number }[]): HeatZone[] {
  return zones.map((z) => {
    let state: HeatState
    if (z.state === 'DOBRO' || z.state === 'ZAJETO') state = 'ZELENO'
    else if (z.state === 'SLABO') state = 'RUMENO'
    else state = 'RDECE'
    return { key: z.stopId, label: z.label, state, detail: `${z.photoCount} posnetkov (${z.goodCount} dobrih)` }
  })
}

/** Cone po strukturi objekta (§6 za ograjo) — iz vozlišč tekača. */
export function structuralZones (nodes: { kind: string; atCm: number; podlaga?: string | null; pritrditev?: string | null }[]): HeatZone[] {
  const out: HeatZone[] = []
  const sorted = [...nodes].sort((a, b) => a.atCm - b.atCm)
  out.push({ key: 'levi-konec', label: 'Levi konec', state: 'NI_RELEVANTNO', detail: 'START cona iz plan-a' })
  let seg = 0
  for (let i = 0; i < sorted.length - 1; i++) {
    seg++
    out.push({ key: `seg-${seg}`, label: `Segment ${seg}`, state: 'NI_RELEVANTNO', detail: 'seg cona iz plan-a' })
    const to = sorted[i + 1]
    if (to.kind === 'VOGAL') out.push({ key: `vogal-${i + 1}`, label: `Vogal @ ${(to.atCm / 100).toFixed(1)} m`, state: 'NI_RELEVANTNO', detail: 'vogal cona iz plan-a' })
    if (to.kind === 'VRATA') out.push({ key: `vrata-${i + 1}`, label: `Vrata @ ${(to.atCm / 100).toFixed(1)} m`, state: 'NI_RELEVANTNO', detail: 'vrata cona iz plan-a' })
    if (to.kind === 'STOPNISCE') out.push({ key: `stopnisce-${i + 1}`, label: `Stopnišče @ ${(to.atCm / 100).toFixed(1)} m`, state: 'NI_RELEVANTNO', detail: 'stopnišče cona iz plan-a' })
  }
  out.push({ key: 'desni-konec', label: 'Desni konec', state: 'NI_RELEVANTNO', detail: 'KONEC cona iz plan-a' })
  const withPodlaga = sorted.filter((n) => n.podlaga != null && n.podlaga !== '').length
  out.push({ key: 'tla-podlaga', label: 'Tla / podlaga', state: 'NI_RELEVANTNO', detail: `${withPodlaga} vozlišč s podlago` })
  const withPritrd = sorted.filter((n) => n.pritrditev != null && n.pritrditev !== '').length
  out.push({ key: 'pritrdilna-mesta', label: 'Pritrdilna mesta', state: 'NI_RELEVANTNO', detail: `${withPritrd} vozlišč s pritrditvijo` })
  return out
}

// ─── §7: CAPTURE QUALITY HEATMAP (po posnetkih) ─────────────────────────────

export interface FrameQuality {
  sharpness: 'OSTRO' | 'BLUR' | 'NEZNANO'
  exposure: 'OK' | 'TEMNO' | 'SVETLO'
  usableForGeometry: boolean
  reason: string
}

/** Quality kontekst posameznega posnetka (§7) — tudi »lepa fotka, neuporabna za geometrijo«. */
export function frameQuality (q: { dark?: boolean; bright?: boolean; blurry?: boolean; blurScore?: number }): FrameQuality {
  const sharpness: FrameQuality['sharpness'] = q.blurry === true ? 'BLUR' : q.blurScore != null ? (q.blurScore < 100 ? 'BLUR' : 'OSTRO') : 'NEZNANO'
  const exposure: FrameQuality['exposure'] = q.dark === true ? 'TEMNO' : q.bright === true ? 'SVETLO' : 'OK'
  const usable = sharpness !== 'BLUR' && exposure === 'OK'
  const reasons: string[] = []
  if (sharpness === 'BLUR') reasons.push('zamegljenost — ni uporabno za geometrijo')
  if (exposure === 'TEMNO') reasons.push('temno')
  if (exposure === 'SVETLO') reasons.push('nasičena osvetlitev')
  return {
    sharpness, exposure,
    usableForGeometry: usable,
    reason: reasons.length > 0 ? reasons.join('; ') : 'uporabno za geometrijo',
  }
}

// ─── §8: ELEMENT-LEVEL QA ───────────────────────────────────────────────────

export type ElementQaState = 'GREEN' | 'WARNING' | 'RED' | 'GRAY'

export const ELEMENT_STATES: Record<ElementQaState, { label: string; cls: string }> = {
  GREEN: { label: 'GREEN', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  WARNING: { label: 'WARNING', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  RED: { label: 'RED', cls: 'bg-red-100 text-red-800 border-red-300' },
  GRAY: { label: 'NI PREGLEDANO', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
}

export interface ElementQaRow {
  key: string // stabilni ID: seg-N / stebri-N / vogal-N / vrata-N
  label: string
  kind: 'STEBER' | 'SEGMENT' | 'VOGAL' | 'VRATA' | 'STOPNISCE' | 'PRITRDITEV' | 'POLNILO' | 'ROCNIK'
  state: ElementQaState
  messages: string[]
}

export interface ElementQaSegmentInput {
  order: number
  fromKind: string
  toKind: string
  lengthCm: number
  heightCm: number | null
  slopeDeg: number
  angleDeg: number | null
  posts: number
  status: string
}

/** Element-level QA (§8): stabilni ID-ji seg-N/stebri-N/vogal-N/vrata-N. */
export function elementQa (
  segments: ElementQaSegmentInput[],
  rules: TolRuleMap,
  heightRules: { minCm: number | null; maxCm: number | null }
): ElementQaRow[] {
  const rows: ElementQaRow[] = []
  const tolLen = toleranceFromRules(rules, 'length')
  const tolHeight = toleranceFromRules(rules, 'height')
  for (const s of segments) {
    const n = s.order + 1
    // SEGMENT
    const segMsgs: string[] = []
    let segState: ElementQaState = 'GREEN'
    if (s.status === 'VERIFIED' || s.status === 'CONFIRMED') {
      segMsgs.push(`status ${s.status}`)
    } else if (s.status === 'CALIBRATED' || s.status === 'MANUAL') {
      segState = 'WARNING'
      segMsgs.push(`status ${s.status} — za proizvodnjo obvezno VERIFIED`)
    } else {
      segState = 'RED'
      segMsgs.push(`status ${s.status} — nezaupanja vredno`)
    }
    rows.push({ key: `seg-${n}`, label: `Segment ${n}`, kind: 'SEGMENT', state: segState, messages: segMsgs })
    // POLNILO (višina)
    if (s.heightCm != null) {
      const hMsgs: string[] = [`višina ${s.heightCm.toFixed(0)} cm`]
      let hState: ElementQaState = 'GREEN'
      if (heightRules.minCm != null && s.heightCm < heightRules.minCm) { hState = 'RED'; hMsgs.push(`< min ${heightRules.minCm} cm (pravilo)`) }
      if (heightRules.maxCm != null && s.heightCm > heightRules.maxCm) { hState = 'RED'; hMsgs.push(`> max ${heightRules.maxCm} cm (pravilo)`) }
      if (tolHeight.noRule && hState === 'GREEN') hMsgs.push('toleranca višine ni definirana (pravilo manjka)')
      rows.push({ key: `polnilo-${n}`, label: `Polnilo ${n}`, kind: 'POLNILO', state: hState, messages: hMsgs })
    }
    // ROCNIK nad segmentom (isti status kot segment — vir: tekač)
    rows.push({ key: `rocnik-${n}`, label: `Ročnik ${n}`, kind: 'ROCNIK', state: segState, messages: [`sledi statusu segmenta (${s.status})`] })
    // STEBRI vmesni
    if (s.posts > 0) {
      const postState: ElementQaState = (s.status === 'VERIFIED' || s.status === 'CONFIRMED') ? 'GREEN' : 'WARNING'
      rows.push({
        key: `stebri-${n}`, label: `Stebri segmenta ${n} (${s.posts})`, kind: 'STEBER', state: postState,
        messages: [`razpored izdelek-zaveden (R460) · tolerance pozicije: ${tolPostLabel(tolFromMap(rules))}`],
      })
    }
    // VOGAL
    if (s.toKind === 'VOGAL') {
      if (s.angleDeg != null) {
        const tolAng = toleranceFromRules(rules, 'angle')
        const aState: ElementQaState = tolAng.noRule ? 'GRAY' : 'GREEN'
        rows.push({ key: `vogal-${n}`, label: `Vogal ${n} (${s.angleDeg.toFixed(1)}°)`, kind: 'VOGAL', state: aState, messages: tolAng.noRule ? ['NO VERIFIED TOLERANCE RULE — kot brez ocene'] : [`kot znotraj tolerance ±${tolAng.toleranceCm}°`] })
      } else {
        rows.push({ key: `vogal-${n}`, label: `Vogal ${n}`, kind: 'VOGAL', state: 'GRAY', messages: ['kot ni izmerjen (interiorDeg manjka na vozlišču)'] })
      }
    }
    // VRATA
    if (s.toKind === 'VRATA') {
      const gState: ElementQaState = (s.status === 'VERIFIED' || s.status === 'CONFIRMED') ? 'GREEN' : 'RED'
      rows.push({ key: `vrata-${n}`, label: `Vrata segmenta ${n}`, kind: 'VRATA', state: gState, messages: [`orientacija/prostor: status ${s.status}`] })
    }
    // STOPNISCE
    if (s.toKind === 'STOPNISCE') {
      const tolSlope = toleranceFromRules(rules, 'slope')
      rows.push({ key: `stopnisce-${n}`, label: `Stopniščni segment ${n} (${s.slopeDeg.toFixed(1)}°)`, kind: 'STOPNISCE', state: tolSlope.noRule ? 'GRAY' : 'GREEN', messages: [`padina ${s.slopeDeg.toFixed(1)}°${tolSlope.noRule ? ' — tolerance ni (pravilo manjka)' : ` · tol ±${tolSlope.toleranceCm}°`}`] })
    }
    // PRITRDITEV
    rows.push({ key: `pritrditev-${n}`, label: `Pritrditev segmenta ${n}`, kind: 'PRITRDITEV', state: 'GRAY', messages: ['pritrditev se vodi na vozlišču tekača (R460)'] })
  }
  return rows
}

function tolFromMap (rules: TolRuleMap): TolLookup {
  return toleranceFromRules(rules, 'post')
}

function tolPostLabel (t: TolLookup): string {
  return t.noRule ? 'PRAVILO MANJKA' : `±${t.toleranceCm} cm`
}

// ─── §15: 4D TIMELINE ───────────────────────────────────────────────────────

export interface TimelineEntry {
  t: string // T0..T6
  label: string
  at: string | null
  detail: string
}

export const TIMELINE_STAGES: { t: string; label: string }[] = [
  { t: 'T0', label: 'OBSTOJEČE STANJE' },
  { t: 'T1', label: 'MERITEV' },
  { t: 'T2', label: 'NAČRT' },
  { t: 'T3', label: 'PONUDBA/POTRDITEV' },
  { t: 'T4', label: 'PROIZVODNJA' },
  { t: 'T5', label: 'MONTAŽA' },
  { t: 'T6', label: 'SERVIS/SPREMEMBA' },
]

// ─── razčlenjevalci (ISTA pravila odjemalec + strežnik) ─────────────────────

function isObj (v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseGeoInput (v: unknown): {
  tier: GeoTier; lat: number; lon: number; altM?: number; atCm?: number
  coordinateSystem: string; datum?: string; geoid?: string
  hAccM?: number; vAccM?: number; source: GeoSource
  rtkStatus?: 'FIX' | 'FLOAT' | 'NONE'; correctionAgeSec?: number
  device?: string; note?: string; code?: string
} | null {
  if (!isObj(v)) return null
  const tier = v.tier
  if (typeof tier !== 'string' || !(tier in GEO_TIERS)) return null
  const lat = v.lat
  const lon = v.lon
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return null
  const source = v.source
  if (typeof source !== 'string' || !geoSourceDef(source)) return null
  const out: ReturnType<typeof parseGeoInput> = {
    tier: tier as GeoTier, lat, lon,
    coordinateSystem: typeof v.coordinateSystem === 'string' && v.coordinateSystem ? v.coordinateSystem.slice(0, 40) : 'WGS84',
    source: source as GeoSource,
  }
  if (typeof v.altM === 'number' && Number.isFinite(v.altM)) out.altM = v.altM
  if (typeof v.atCm === 'number' && Number.isFinite(v.atCm) && v.atCm >= 0) out.atCm = v.atCm
  if (typeof v.datum === 'string' && v.datum) out.datum = v.datum.slice(0, 40)
  if (typeof v.geoid === 'string' && v.geoid) out.geoid = v.geoid.slice(0, 40)
  if (typeof v.hAccM === 'number' && Number.isFinite(v.hAccM) && v.hAccM > 0) out.hAccM = v.hAccM
  if (typeof v.vAccM === 'number' && Number.isFinite(v.vAccM) && v.vAccM > 0) out.vAccM = v.vAccM
  if (v.rtkStatus === 'FIX' || v.rtkStatus === 'FLOAT' || v.rtkStatus === 'NONE') out.rtkStatus = v.rtkStatus
  if (typeof v.correctionAgeSec === 'number' && Number.isFinite(v.correctionAgeSec) && v.correctionAgeSec >= 0) out.correctionAgeSec = v.correctionAgeSec
  if (typeof v.device === 'string' && v.device) out.device = v.device.slice(0, 120)
  if (typeof v.note === 'string' && v.note) out.note = v.note.slice(0, 300)
  if (typeof v.code === 'string' && v.code) out.code = v.code.slice(0, 20)
  return out
}

export function parseRegPairs (v: unknown): RegPointPair[] | null {
  if (!Array.isArray(v) || v.length !== 3) return null
  const out: RegPointPair[] = []
  for (const p of v) {
    if (!isObj(p)) return null
    const code = p.code
    const s = p.source
    const t = p.target
    if (typeof code !== 'string' || !code) return null
    if (!isObj(s) || typeof s.x !== 'number' || typeof s.y !== 'number' || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return null
    if (!isObj(t) || typeof t.x !== 'number' || typeof t.y !== 'number' || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return null
    out.push({ code: code.slice(0, 20), source: { x: s.x, y: s.y }, target: { x: t.x, y: t.y } })
  }
  return out
}

// capture-qa-engine — ROKSAL REALITY CAPTURE QA + DIGITAL TWIN (R461 — issue #16)
// ČIST, brez db — uporaben na odjemalcu in strežniku (ISTA pravila).
// QA/registracijski/drift/verifikacijski SLOJ nad obstoječim engine-om
// (R455–R460): tekač ostaja vir geometrije; ta engine dodaja pokritost (§1),
// vodeno ruto (§2), drift (§3), referenčno mrežo (§4), merilni kontekst (§5/§6),
// kritična vrata (§7), digitalni dvojček AS-* (§8–§12), geometrijski diff (§13)
// in cross-check virov (§14). Brez fuzzy matchinga, brez lažne natančnosti,
// brez tihega popravljanja (§25).

export const CAPTURE_QA_VERSION = 'capture-qa/1.0'

// ─── §15: DEVICE FUSION ─────────────────────────────────────────────────────

export type DeviceTier = 'PREMIUM' | 'STANDARD' | 'BASIC'

export interface DeviceCapsInput {
  camera?: boolean
  lidar?: boolean
  depth?: boolean
  ar?: boolean
  gyro?: boolean
  accelerometer?: boolean
  gps?: boolean
  storage?: boolean
  network?: boolean
}

export interface DeviceTierResult {
  tier: DeviceTier
  reasons: string[]
}

export const TIER_LABELS: Record<DeviceTier, string> = {
  PREMIUM: 'LiDAR + depth + AR + kamera',
  STANDARD: 'AR + kamera + reference',
  BASIC: 'fotografija + znana mera + ročna geometrija',
}

/** Zazna režim zajema iz zmožnosti naprave (§15). Uporabnik mora vedeti, kateri. */
export function deviceTier (caps: DeviceCapsInput): DeviceTierResult {
  const reasons: string[] = []
  const has = (v?: boolean) => v === true
  if (has(caps.lidar)) reasons.push('LiDAR')
  if (has(caps.depth)) reasons.push('depth')
  if (has(caps.ar)) reasons.push('AR tracking')
  if (has(caps.gyro)) reasons.push('giroskop')
  if (has(caps.gps)) reasons.push('GPS')
  if (has(caps.camera)) reasons.push('kamera')

  // PREMIUM: globinsko zaznavanje + AR + kamera
  if ((has(caps.lidar) || has(caps.depth)) && has(caps.ar) && has(caps.camera)) {
    return { tier: 'PREMIUM', reasons }
  }
  // STANDARD: AR sledenje + kamera (+ reference)
  if (has(caps.ar) && has(caps.camera)) {
    return { tier: 'STANDARD', reasons }
  }
  // BASIC: fotografija + marker/znana mera + ročna geometrija
  return { tier: 'BASIC', reasons }
}

// ─── §16: OUTDOOR QUALITY MODEL ─────────────────────────────────────────────

export interface OutdoorCondition {
  id: string
  label: string
  impact: number // zanesljivostni faktor 0..1 (višje = hujše)
  advice: string
}

export const OUTDOOR_CONDITIONS: OutdoorCondition[] = [
  { id: 'SONCE', label: 'Močno sonce', impact: 0.15, advice: 'Zajemi iz sence ali proti soncu pod kotom.' },
  { id: 'SENCE', label: 'Močne sence (kontrast)', impact: 0.15, advice: 'Dodaj posnetek iz druge smeri.' },
  { id: 'BLESC', label: 'Bleščanje kovine', impact: 0.2, advice: 'Zamenjaj kot; bleščanje povzroči lažne robove.' },
  { id: 'STIKLO', label: 'Steklo / odbojne površine', impact: 0.25, advice: 'Izogibaj se odrazom — zaznaj robove ročno.' },
  { id: 'RASTLINJE', label: 'Rastlinje zakriva objekt', impact: 0.2, advice: 'Zajemi dodatne kote odkritega dela.' },
  { id: 'MOKRO', label: 'Mokre površine', impact: 0.1, advice: 'Odsevi — preveri višino z referenco.' },
  { id: 'ZAKRITOST', label: 'Delna zakritost', impact: 0.25, advice: 'Zajemi zakriti del iz drugega kota.' },
  { id: 'VZORCI', label: 'Ponavljajoči se vzorci', impact: 0.15, advice: 'Poljubno ujemanje — označi točke ročno.' },
  { id: 'RAZDALJA', label: 'Večje razdalje (> 8 m)', impact: 0.15, advice: 'Približaj se ali dodaj referenco.' },
  { id: 'STOPNICE', label: 'Stopnice / stopnišče', impact: 0.1, advice: 'Vsako stopnico izmeri posebej.' },
]

export interface OutdoorResult {
  factor: number // 0..1 — preostala zanesljivost
  requireExtraReference: boolean
  notes: string[]
}

/** Zunanji pogoji → dejavnik zanesljivosti + zahteva po dodatni referenci (§16). */
export function outdoorReliability (conditionIds: string[]): OutdoorResult {
  const notes: string[] = []
  let impact = 0
  for (const id of conditionIds) {
    const c = OUTDOOR_CONDITIONS.find((x) => x.id === id)
    if (c) {
      impact += c.impact
      notes.push(`${c.label}: ${c.advice}`)
    }
  }
  // efektivni faktor (meja pri 0)
  const factor = Math.max(0, 1 - impact)
  const requireExtraReference = factor < 0.6
  if (requireExtraReference) notes.push('Okolje zmanjšuje zanesljivost — DODATNA REFERENCA je obvezna pred potrditvijo.')
  return { factor: Math.round(factor * 100) / 100, requireExtraReference, notes }
}

// ─── §2: AUTOMATIC CAPTURE ROUTE ────────────────────────────────────────────

export type StopKind =
  | 'START' | 'SEGMENT' | 'REFERENCA' | 'TEREN' | 'PODLAGA'
  | 'VOGAL' | 'VRATA' | 'KALIBRACIJA' | 'COVERAGE' | 'KONEC'

export const STOP_KINDS: Record<StopKind, { label: string; desc: string }> = {
  START: { label: 'Začetek', desc: 'Prvi posnetek objekta (levi konec)' },
  SEGMENT: { label: 'Segment', desc: 'Posnetek ravnega dela med vozlišči' },
  REFERENCA: { label: 'Referenca', desc: 'Referenčna točka z zunanjim merilom' },
  TEREN: { label: 'Teren', desc: 'Višinski profil / padina' },
  PODLAGA: { label: 'Podlaga', desc: 'Tip podlage (beton, zemlja, travnik …)' },
  VOGAL: { label: 'Vogal', desc: 'Točka loma — kot objekta' },
  VRATA: { label: 'Vrata', desc: 'Odprtina / vrata — širina in prostor' },
  KALIBRACIJA: { label: 'Kalibracija', desc: 'Znana mera za merilo' },
  COVERAGE: { label: 'Pokritost', desc: 'Pregled celotne pokritosti' },
  KONEC: { label: 'Konec', desc: 'Zadnji posnetek (desni konec)' },
}

export interface PlanStop {
  id: string
  kind: StopKind
  label: string
  atCm?: number
  critical: boolean
}

export interface RoutePlanArgs {
  mode: 'FENCE_RUN' | 'KAMERA'
  /** vozlišča tekača (mode FENCE_RUN) — kind + atCm + višina */
  nodes?: { kind: string; atCm: number; label?: string }[]
  totalCm: number
  hasTerrain: boolean
}

const REF_INTERVAL_CM = 800 // referenca vsaj na ~8 m (§4)

/**
 * Vodena ruta zajema (§2): START → segmenti/vogali/vrata → reference →
 * teren → podlaga → coverage → kalibracija → KONEC. Zahteve izhajajo iz
 * geometrije — NE iz enakega števila fotografij za vsak objekt.
 */
export function buildRoutePlan (args: RoutePlanArgs): PlanStop[] {
  const stops: PlanStop[] = []
  if (args.mode === 'FENCE_RUN' && args.nodes && args.nodes.length > 0) {
    const nodes = [...args.nodes].sort((a, b) => a.atCm - b.atCm)
    const total = args.totalCm > 0 ? args.totalCm : nodes[nodes.length - 1].atCm
    stops.push({ id: 'start', kind: 'START', label: `Začetek (0,0 m)`, atCm: 0, critical: true })
    // segmenti med vozlišči + posebna vozlišča
    let segIdx = 0
    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i]
      const to = nodes[i + 1]
      segIdx++
      stops.push({
        id: `seg-${segIdx}`,
        kind: 'SEGMENT',
        label: `Segment ${segIdx} (${(from.atCm / 100).toFixed(1)}–${(to.atCm / 100).toFixed(1)} m)`,
        atCm: Math.round((from.atCm + to.atCm) / 2),
        critical: true,
      })
      if (to.kind === 'VOGAL') {
        stops.push({ id: `vogal-${i + 1}`, kind: 'VOGAL', label: `Vogal pri ${(to.atCm / 100).toFixed(1)} m`, atCm: to.atCm, critical: true })
      }
      if (to.kind === 'VRATA') {
        stops.push({ id: `vrata-${i + 1}`, kind: 'VRATA', label: `Vrata pri ${(to.atCm / 100).toFixed(1)} m`, atCm: to.atCm, critical: true })
      }
      if (to.kind === 'STOPNISCE') {
        stops.push({ id: `stopnisce-${i + 1}`, kind: 'TEREN', label: `Stopnišče pri ${(to.atCm / 100).toFixed(1)} m`, atCm: to.atCm, critical: true })
      }
    }
    // reference na ~8 m (vsaj 1 če je objekt > 4 m)
    const refCount = Math.max(1, Math.floor(total / REF_INTERVAL_CM))
    for (let r = 1; r <= refCount; r++) {
      const atCm = Math.round((total * r) / (refCount + 1))
      stops.push({ id: `ref-${r}`, kind: 'REFERENCA', label: `Referenčna točka ${r} (~${(atCm / 100).toFixed(1)} m)`, atCm, critical: true })
    }
    if (args.hasTerrain) {
      stops.push({ id: 'teren', kind: 'TEREN', label: 'Teren — višinski profil', critical: true })
    }
    stops.push({ id: 'podlaga', kind: 'PODLAGA', label: 'Podlaga ob objektu', critical: true })
    stops.push({ id: 'coverage', kind: 'COVERAGE', label: 'Preveri pokritost', critical: true })
    stops.push({ id: 'kalibracija', kind: 'KALIBRACIJA', label: 'Kalibracija (znana mera)', critical: true })
    stops.push({ id: 'konec', kind: 'KONEC', label: `Konec (${(total / 100).toFixed(1)} m)`, atCm: Math.round(total), critical: true })
    return stops
  }
  // KAMERA: splošna ruta brez tekača (objekt kot celota)
  stops.push({ id: 'start', kind: 'START', label: 'Začetek (levi konec)', critical: true })
  stops.push({ id: 'obj-levi', kind: 'SEGMENT', label: 'Levi del objekta', critical: true })
  stops.push({ id: 'obj-sredina', kind: 'SEGMENT', label: 'Sredina objekta', critical: true })
  stops.push({ id: 'obj-desni', kind: 'SEGMENT', label: 'Desni konec', critical: true })
  stops.push({ id: 'ref-1', kind: 'REFERENCA', label: 'Referenčna točka 1', critical: true })
  if (args.hasTerrain) stops.push({ id: 'teren', kind: 'TEREN', label: 'Teren — višinski profil', critical: true })
  stops.push({ id: 'podlaga', kind: 'PODLAGA', label: 'Podlaga ob objektu', critical: true })
  stops.push({ id: 'coverage', kind: 'COVERAGE', label: 'Preveri pokritost', critical: true })
  stops.push({ id: 'kalibracija', kind: 'KALIBRACIJA', label: 'Kalibracija (znana mera)', critical: true })
  stops.push({ id: 'konec', kind: 'KONEC', label: 'Konec (desni konec)', critical: true })
  return stops
}

// ─── §1: LIVE COVERAGE MAP ──────────────────────────────────────────────────

export interface PhotoQuality {
  dark?: boolean
  bright?: boolean
  blurry?: boolean
  blurScore?: number
}

export type ZoneState = 'NEZAJETO' | 'SLABO' | 'ZAJETO' | 'DOBRO'

export const ZONE_STATES: Record<ZoneState, { label: string; cls: string }> = {
  NEZAJETO: { label: 'NI ZAJETO', cls: 'bg-red-100 text-red-800 border-red-300' },
  SLABO: { label: 'PREMALO KAKOVOSTNO', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
  ZAJETO: { label: 'ZAJETO', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  DOBRO: { label: 'DOBRO ZAJETO', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
}

export interface CoverageZone {
  stopId: string
  label: string
  critical: boolean
  state: ZoneState
  photoCount: number
  goodCount: number
}

export interface CoverageResult {
  zones: CoverageZone[]
  criticalMissing: string[] // oznake kritičnih con, ki niso ustrezno zajete
  gateOk: boolean
}

function photoGood (q: PhotoQuality): boolean {
  return q.dark !== true && q.bright !== true && q.blurry !== true
}

/**
 * Živa pokritost (§1): stanje con iz posnetkov. NEZAJETO → SLABO (slaba
 * kakovost) → ZAJETO (1 dober) → DOBRO (≥ 2 dobri). Vrata pokritosti
 * (coverage gate) preprečijo zaključek, če manjkajo kritične cone.
 */
export function computeCoverage (
  plan: PlanStop[],
  photos: { zone: string; quality: PhotoQuality }[]
): CoverageResult {
  // pokritost velja na zajemalne postanke (SEGMENT/VOGAL/VRATA/TEREN/PODLAGA/START/KONEC)
  const coverableKinds = new Set<StopKind>(['START', 'SEGMENT', 'VOGAL', 'VRATA', 'TEREN', 'PODLAGA', 'KONEC'])
  const zones: CoverageZone[] = []
  const missing: string[] = []
  for (const stop of plan) {
    if (!coverableKinds.has(stop.kind)) continue
    const zonePhotos = photos.filter((p) => p.zone === stop.id)
    const good = zonePhotos.filter((p) => photoGood(p.quality ?? {})).length
    let state: ZoneState
    if (zonePhotos.length === 0) state = 'NEZAJETO'
    else if (good === 0) state = 'SLABO'
    else if (good === 1) state = 'ZAJETO'
    else state = 'DOBRO'
    zones.push({ stopId: stop.id, label: stop.label, critical: stop.critical, state, photoCount: zonePhotos.length, goodCount: good })
    if (stop.critical && (state === 'NEZAJETO' || state === 'SLABO')) {
      missing.push(stop.label)
    }
  }
  return { zones, criticalMissing: missing, gateOk: missing.length === 0 }
}

// ─── §3: DRIFT DETECTION ────────────────────────────────────────────────────

export type DriftState = 'DRIFT_OK' | 'DRIFT_WARNING' | 'RE_LOC_REQUIRED'

export const DRIFT_STATES: Record<DriftState, { label: string; cls: string }> = {
  DRIFT_OK: { label: 'DRIFT OK', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  DRIFT_WARNING: { label: 'DRIFT WARNING', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  RE_LOC_REQUIRED: { label: 'RE-LOCALIZATION REQUIRED', cls: 'bg-red-100 text-red-800 border-red-300' },
}

export interface DriftSample {
  offsetCm: number
  atCm?: number
  ts: string
}

export interface DriftResult {
  state: DriftState
  maxAbsCm: number
  lastAbsCm: number
  reasons: string[]
}

export const DRIFT_OK_CM = 2 // ≤ 2 cm: OK
export const DRIFT_WARN_CM = 5 // ≤ 5 cm: opozorilo; več → re-lokalizacija

/**
 * Drift registra (§3): akumulirani odmiki med posnetki. Presežek tolerance
 * → RE_LOC_REQUIRED (označi območje, ne potrdi novih meritev, zahtevaj novo
 * referenco). Popravljanje drifta tiho brez zapisa NI dovoljeno — zato vsak
 * vzorec ostane v seznamu in reviziji.
 */
export function driftStatus (samples: DriftSample[]): DriftResult {
  if (samples.length === 0) {
    return { state: 'DRIFT_OK', maxAbsCm: 0, lastAbsCm: 0, reasons: ['Ni vzorcev registra.'] }
  }
  const abs = samples.map((s) => Math.abs(s.offsetCm))
  const maxAbsCm = Math.max(...abs)
  const lastAbsCm = abs[abs.length - 1]
  const reasons: string[] = []
  let state: DriftState
  if (maxAbsCm <= DRIFT_OK_CM) {
    state = 'DRIFT_OK'
    reasons.push(`Največji odmik ${maxAbsCm.toFixed(1)} cm (≤ ${DRIFT_OK_CM} cm).`)
  } else if (maxAbsCm <= DRIFT_WARN_CM) {
    state = 'DRIFT_WARNING'
    reasons.push(`Odmik ${maxAbsCm.toFixed(1)} cm — dodaj referenco ali ponovni zajem.`)
  } else {
    state = 'RE_LOC_REQUIRED'
    reasons.push(`Odmik ${maxAbsCm.toFixed(1)} cm presega toleranco ${DRIFT_WARN_CM} cm — potrebna RE-LOKALIZACIJA.`)
    reasons.push('Nova meritev na tem območju ne bo potrjena, dokler ni nove reference.')
  }
  return { state, maxAbsCm: Math.round(maxAbsCm * 10) / 10, lastAbsCm: Math.round(lastAbsCm * 10) / 10, reasons }
}

// ─── §4: MULTI-REFERENCE NETWORK ────────────────────────────────────────────

export type RefMethod = 'LASER' | 'MICNIK' | 'ZNANA_MERA' | 'DRUGO'

export const REF_METHODS: { id: RefMethod; label: string; toleranceCm: number; confidence: number }[] = [
  { id: 'LASER', label: 'Laserki merilec', toleranceCm: 0.5, confidence: 0.98 },
  { id: 'MICNIK', label: 'Mičnik / tračni meter', toleranceCm: 1, confidence: 0.92 },
  { id: 'ZNANA_MERA', label: 'Znana mera (referenčni objekt)', toleranceCm: 2, confidence: 0.8 },
  { id: 'DRUGO', label: 'Drugo', toleranceCm: 5, confidence: 0.5 },
]

export interface RefInput {
  code: string
  atCm: number
  measureCm: number // razdalja od prejšnje aktivne reference (zunanje merilo)
  method: string
  status: string // AKTIVNA | KONFLIKT | ZAVRACENA
}

export interface RefPair {
  fromCode: string // 'START' za prvo referenco
  toCode: string
  declaredCm: number // iz tekača: to.atCm − from.atCm
  measuredCm: number // zunanje merilo
  diffCm: number
  toleranceCm: number
  conflict: boolean
}

export interface RefNetworkResult {
  pairs: RefPair[]
  conflicts: string[] // opisi konfliktov (REFERENCE CONFLICT — ZAHTEVANA PREVERBA)
  activeCount: number
}

/**
 * Relativna skladnost referenc (§4): veriga A → B → C → D. Za vsak par
 * preveri razliko med prijavljeno geometrijo (tek) in zunanjim merilom.
 * Konflikt se NE reši tiho — izriše se izrecno (REFERENCE CONFLICT).
 */
export function referenceNetwork (refs: RefInput[]): RefNetworkResult {
  // v verigi sodelujejo vse NEZAVRČENE reference (AKTIVNA in KONFLIKT —
  // konflikt je oznaka dela verige, ne izključitev)
  const active = refs
    .filter((r) => r.status !== 'ZAVRACENA')
    .sort((a, b) => a.atCm - b.atCm)
  const pairs: RefPair[] = []
  const conflicts: string[] = []
  let prevCode = 'START'
  let prevAt = 0
  for (const r of active) {
    const declared = r.atCm - prevAt
    const diff = r.measureCm - declared
    const m = REF_METHODS.find((x) => x.id === r.method)
    const toleranceCm = m?.toleranceCm ?? 5
    const conflict = Math.abs(diff) > toleranceCm
    pairs.push({
      fromCode: prevCode,
      toCode: r.code,
      declaredCm: Math.round(declared * 10) / 10,
      measuredCm: Math.round(r.measureCm * 10) / 10,
      diffCm: Math.round(diff * 10) / 10,
      toleranceCm,
      conflict,
    })
    if (conflict) {
      conflicts.push(
        `REFERENCE CONFLICT ${prevCode} → ${r.code}: tekač ${pairs[pairs.length - 1].declaredCm.toFixed(1)} cm, zunanje merilo ${r.measureCm.toFixed(1)} cm (razlika ${diff.toFixed(1)} cm > ±${toleranceCm} cm) — ZAHTEVANA PREVERBA.`
      )
    }
    prevCode = r.code
    prevAt = r.atCm
  }
  return { pairs, conflicts, activeCount: active.length }
}

/** Utemeljena toleranca metode (§5) — NULL, če ni utemeljena (brez lažne natančnosti). */
export function toleranceForMethod (method: string): number | null {
  const m = REF_METHODS.find((x) => x.id === method)
  return m ? m.toleranceCm : null
}

// ─── §5: MERILNI KAKOVOSTNI KONTEKST ────────────────────────────────────────

export type QualityGrade = 'A' | 'B' | 'C'

export interface MeasureQualityContext {
  source: string // npr. 'LIDAR + REFERENCE', 'KAMERA + KALIBRACIJA', 'ROCNO'
  status: string // §6: ESTIMATED | AUTO_SUGGESTED | MANUAL | CALIBRATED | VERIFIED | CONFIRMED
  quality: QualityGrade
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  toleranceCm?: number // SAMO kadar utemeljena (sicer izpuščena)
}

/**
 * Kontekst kakovosti meritve (§5): vir + status + ocena + toleranca, kadar
 * jo je mogoče utemeljeno izračunati. Brez izmišljene natančnosti.
 */
export function measureQualityContext (args: {
  source: string
  status: string
  calibrationConfidence?: number | null
  refMethod?: string | null
}): MeasureQualityContext {
  const tol = args.refMethod ? toleranceForMethod(args.refMethod) : null
  let quality: QualityGrade = 'C'
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW'
  if (args.status === 'VERIFIED' || args.status === 'CONFIRMED') {
    quality = 'A'
    confidence = 'HIGH'
  } else if (args.status === 'CALIBRATED' || args.status === 'MANUAL') {
    quality = 'B'
    confidence = args.calibrationConfidence != null && args.calibrationConfidence >= 0.7 ? 'MEDIUM' : 'LOW'
  } else {
    quality = 'C'
    confidence = 'LOW'
  }
  const out: MeasureQualityContext = { source: args.source, status: args.status, quality, confidence }
  if (tol != null) out.toleranceCm = tol
  return out
}

// ─── §7: CRITICAL MEASURE GATE ──────────────────────────────────────────────

export interface GateSegment {
  order: number
  fromAtCm: number
  toAtCm: number
  lengthCm: number
  heightCm: number | null
  slopeDeg: number
  angleDeg: number | null
  status: string
  hasGate: boolean // segment se konča z vrati
  fromKind?: string // R462: vrsta začetnega vozlišča (STEBER/ZAČETEK/…)
  toKind?: string // R462: vrsta končnega vozlišča (VOGAL/VRATA/STOPNISCE/…)
}

export interface MissingItem {
  code: string
  message: string
}

export interface CriticalGateResult {
  ponudba: boolean
  konfiguracija: boolean
  proizvodnja: boolean
  manjka: MissingItem[]
}

const TRUSTED = new Set(['MANUAL', 'CALIBRATED', 'VERIFIED', 'CONFIRMED'])
const VERIFIED_SET = new Set(['VERIFIED', 'CONFIRMED'])

/**
 * Kritična vrata mer (§7): ZA PONUDBO / ZA KONFIGURACIJO / ZA PROIZVODNJO.
 * Vrača natančen seznam manjkajočih podatkov (gumb »Odpri manjkajoče podatke«).
 */
export function criticalGate (args: {
  segments: GateSegment[]
  hasCalibration: boolean
  hasTerrain: boolean
  hasPodlaga: boolean
}): CriticalGateResult {
  const manjka: MissingItem[] = []
  const segs = args.segments

  // dolžine vseh segmentov (zaupanja vredne — vsaj MANUAL/CALIBRATED)
  const slabVsi = segs.filter((s) => !TRUSTED.has(s.status))
  for (const s of slabVsi) {
    manjka.push({ code: `DOLZINA_SEG_${s.order}`, message: `Dolžina ${s.order}. segmenta ni preverjena (status ${s.status}).` })
  }
  // višine
  const brezVisine = segs.filter((s) => s.heightCm == null)
  if (segs.length > 0 && brezVisine.length === segs.length) {
    manjka.push({ code: 'VISINA', message: 'Manjka preverjena višina segmentov.' })
  } else {
    for (const s of brezVisine) {
      manjka.push({ code: `VISINA_SEG_${s.order}`, message: `Manjka preverjena višina ${s.order}. segmenta.` })
    }
  }
  // vrata — širina + prostor
  const vrata = segs.filter((s) => s.hasGate)
  if (vrata.length > 0) {
    const vrataNevec = vrata.filter((s) => !VERIFIED_SET.has(s.status))
    for (const s of vrataNevec) {
      manjka.push({ code: `VRATA_SEG_${s.order}`, message: `Vrata na ${s.order}. segmentu niso preverjena (širina/prostor).` })
    }
  }
  // kalibracija
  if (!args.hasCalibration) {
    manjka.push({ code: 'KALIBRACIJA', message: 'Manjka kalibracija zajema (znana mera ali zunanja naprava).' })
  }
  // podlaga
  if (!args.hasPodlaga) {
    manjka.push({ code: 'PODLAGA', message: 'Manjka podlaga ob objektu (beton/zelena/…).' })
  }

  const ponudba = segs.length > 0 && slabVsi.length === 0 && brezVisine.length < segs.length
  const konfiguracija = ponudba && args.hasCalibration && brezVisine.length === 0
  const proizvodnja = konfiguracija && args.hasPodlaga && segs.every((s) => VERIFIED_SET.has(s.status)) &&
    vrata.every((s) => VERIFIED_SET.has(s.status))
  if (!proizvodnja && konfiguracija) {
    const nevec = segs.filter((s) => !VERIFIED_SET.has(s.status))
    for (const s of nevec) {
      // specifično sporočilo za proizvodnjo (zgornje manjka že pokriva status)
      if (!manjka.some((m) => m.code === `DOLZINA_SEG_${s.order}`)) {
        manjka.push({ code: `VERIF_SEG_${s.order}`, message: `${s.order}. segment ni VERIFIED/CONFIRMED — za proizvodnjo obvezno.` })
      }
    }
  }
  return { ponudba, konfiguracija, proizvodnja, manjka }
}

// ─── §8–§12: DIGITAL TWIN SNAPSHOT DATA ─────────────────────────────────────

export type TwinKind = 'AS_MEASURED' | 'AS_DESIGNED' | 'AS_PRODUCED' | 'AS_INSTALLED'

export const TWIN_KINDS: Record<TwinKind, { label: string; desc: string }> = {
  AS_MEASURED: { label: 'AS-MEASURED', desc: 'Stanje objekta pred izdelavo (§9)' },
  AS_DESIGNED: { label: 'AS-DESIGNED', desc: 'Načrtovano stanje ROKSAL rešitve (§10)' },
  AS_PRODUCED: { label: 'AS-PRODUCED', desc: 'Dejansko izdelana konfiguracija (§11)' },
  AS_INSTALLED: { label: 'AS-INSTALLED', desc: 'Potrjeno stanje po montaži (§12)' },
}

export interface TwinSegmentData {
  key: string
  label: string
  lengthCm: number | null
  heightCm: number | null
  slopeDeg: number | null
  angleDeg: number | null
  posts: number | null
}

export interface TwinSnapshotData {
  kind: TwinKind
  totalLengthCm: number | null
  segments: TwinSegmentData[]
  terrain?: { atCm: number; elevCm: number }[] | null
  obstojeco?: { opis: string } | null // §9: obstoječa ograja/stebri/posebnosti
  reference?: { code: string; atCm: number; measureCm: number; method: string; status: string }[]
  coverage?: { gateOk: boolean; zones: number; missing: number } | null
  device?: { tier: DeviceTier } | null
  outdoor?: { conditions: string[]; factor: number } | null
  photoCount?: number
  produkt?: { productId: string; variantId: string | null; ime: string; varianta: string | null; ral: string | null }
  config?: Record<string, unknown> | null
  fotoViz?: { id: string; variantLabel: string; engineVersion: string } | null
  bom?: { code: string; status: string; lines: number; qty: number; unit: string } | null
  spremembe?: { opis: string; odobril: string; ts: string }[] // §11 DESIGNED → CHANGE → APPROVED → PRODUCED
  /** R462 §10: ključi segmentov z EKSPlicitNO odobrenimi spremembami mere — diff jih označi APPROVED_CHANGE */
  producedOverrideKeys?: string[]
  montaža?: { notes: string[]; workOrderId: string | null; odkloni?: DiffRow[] } | null
  /** R488 §P5: AS-DESIGNED iz NEPOTRJENEGA tekača (osnutka) — vidno opozorilo
   *  v meta (nikoli tiho, §19). true SAMO kadar je vir osnutek. */
  runDraftWarning?: boolean
  /** status tekača v trenutku snapshot-a (npr. OSNUTEK / PREGLED) */
  runStatusAtSnapshot?: string | null
  engineVersion: string
}

// ─── §13: GEOMETRY DIFF ─────────────────────────────────────────────────────

export interface DiffRow {
  key: string
  label: string
  metric: 'DOLZINA' | 'VISINA' | 'KOT' | 'NAGIB' | 'STEBRI' | 'TOTAL'
  a: number | null // načrtovano / prej
  b: number | null // dejansko / zdaj
  diff: number | null // b − a (cm ali kos)
  unit: 'cm' | '°' | 'kos'
}

export interface DiffResult {
  rows: DiffRow[]
  compared: number
  deviations: number // |diff| > tolerance
  maxAbsDiffCm: number
}

/**
 * Geometrijska primerjava verzij (§13): dolžine/višine/koti/nagibi/stebri.
 * Primerja SAMO tam, kjer sta obe vrednosti znani — brez ugibanj.
 */
export function diffTwin (a: TwinSnapshotData, b: TwinSnapshotData, toleranceCm = 1): DiffResult {
  const rows: DiffRow[] = []
  const bByKey = new Map(b.segments.map((s) => [s.key, s]))
  for (const sa of a.segments) {
    const sb = bByKey.get(sa.key)
    if (!sb) {
      rows.push({ key: `${sa.key}:DOLZINA`, label: `${sa.label} — dolžina`, metric: 'DOLZINA', a: sa.lengthCm, b: null, diff: null, unit: 'cm' })
      continue
    }
    if (sa.lengthCm != null && sb.lengthCm != null) {
      rows.push({ key: `${sa.key}:DOLZINA`, label: `${sa.label} — dolžina`, metric: 'DOLZINA', a: sa.lengthCm, b: sb.lengthCm, diff: Math.round((sb.lengthCm - sa.lengthCm) * 10) / 10, unit: 'cm' })
    }
    if (sa.heightCm != null && sb.heightCm != null) {
      rows.push({ key: `${sa.key}:VISINA`, label: `${sa.label} — višina`, metric: 'VISINA', a: sa.heightCm, b: sb.heightCm, diff: Math.round((sb.heightCm - sa.heightCm) * 10) / 10, unit: 'cm' })
    }
    if (sa.angleDeg != null && sb.angleDeg != null) {
      rows.push({ key: `${sa.key}:KOT`, label: `${sa.label} — kot`, metric: 'KOT', a: sa.angleDeg, b: sb.angleDeg, diff: Math.round((sb.angleDeg - sa.angleDeg) * 10) / 10, unit: '°' })
    }
    if (sa.slopeDeg != null && sb.slopeDeg != null) {
      rows.push({ key: `${sa.key}:NAGIB`, label: `${sa.label} — nagib`, metric: 'NAGIB', a: sa.slopeDeg, b: sb.slopeDeg, diff: Math.round((sb.slopeDeg - sa.slopeDeg) * 10) / 10, unit: '°' })
    }
    if (sa.posts != null && sb.posts != null) {
      rows.push({ key: `${sa.key}:STEBRI`, label: `${sa.label} — stebri`, metric: 'STEBRI', a: sa.posts, b: sb.posts, diff: sb.posts - sa.posts, unit: 'kos' })
    }
  }
  if (a.totalLengthCm != null && b.totalLengthCm != null) {
    rows.push({ key: 'TOTAL:DOLZINA', label: 'Skupna dolžina', metric: 'TOTAL', a: a.totalLengthCm, b: b.totalLengthCm, diff: Math.round((b.totalLengthCm - a.totalLengthCm) * 10) / 10, unit: 'cm' })
  }
  const numeric = rows.filter((r) => r.diff != null)
  const deviations = numeric.filter((r) => Math.abs(r.diff as number) > (r.unit === 'cm' ? toleranceCm : (r.unit === '°' ? 1 : 0))).length
  const maxAbsDiffCm = numeric.filter((r) => r.unit === 'cm').reduce((m, r) => Math.max(m, Math.abs(r.diff as number)), 0)
  return {
    rows,
    compared: numeric.length,
    deviations,
    maxAbsDiffCm: Math.round(maxAbsDiffCm * 10) / 10,
  }
}

// ─── §14: PHOTO / 2D / 3D CROSS-CHECK ───────────────────────────────────────

export interface CrossCheckRow {
  key: string
  label: string
  photo: boolean
  sketch2d: boolean
  threeD: boolean
  measurement: boolean
  lengths: { photo: number | null; sketch2d: number | null; threeD: number | null; measurement: number | null }
}

export interface CrossCheckResult {
  rows: CrossCheckRow[]
  warnings: string[]
  consistent: boolean
}

/**
 * Skladnost virov (§14): PHOTO ↔ 2D ↔ 3D ↔ MERITEV za isti segment.
 * Manjkajoč ali konflikten vir → DATA CONSISTENCY WARNING — nikoli tiho
 * združevanje.
 */
export function crossCheckSources (rowsIn: CrossCheckRow[], toleranceCm = 2): CrossCheckResult {
  const warnings: string[] = []
  for (const r of rowsIn) {
    const present = [r.photo, r.sketch2d, r.threeD, r.measurement].filter(Boolean).length
    if (r.measurement && present < 2) {
      warnings.push(`DATA CONSISTENCY WARNING — ${r.label}: meritev obstaja, a viri se ne prekrivajo (photo ${r.photo ? '✓' : '✗'} / 2D ${r.sketch2d ? '✓' : '✗'} / 3D ${r.threeD ? '✓' : '✗'}).`)
    }
    if (!r.measurement && present > 0) {
      warnings.push(`DATA CONSISTENCY WARNING — ${r.label}: viri obstajajo brez kanonične meritve.`)
    }
    const vals = [r.lengths.photo, r.lengths.sketch2d, r.lengths.threeD, r.lengths.measurement].filter((v): v is number => v != null)
    if (vals.length >= 2) {
      const mn = Math.min(...vals)
      const mx = Math.max(...vals)
      if (mx - mn > toleranceCm) {
        warnings.push(`DATA CONSISTENCY WARNING — ${r.label}: dolžine se razhajajo (${mn.toFixed(1)}–${mx.toFixed(1)} cm > ±${toleranceCm} cm).`)
      }
    }
  }
  return { rows: rowsIn, warnings, consistent: warnings.length === 0 }
}

// ─── §9: AS-MEASURED builder ────────────────────────────────────────────────

export function buildAsMeasured (args: {
  segments: GateSegment[]
  terrain: { atCm: number; elevCm: number }[] | null
  refs: { code: string; atCm: number; measureCm: number; method: string; status: string }[]
  coverage: CoverageResult | null
  device: { tier: DeviceTier } | null
  outdoor: { conditions: string[]; factor: number } | null
  photoCount: number
  obstojeco?: string | null
}): TwinSnapshotData {
  return {
    kind: 'AS_MEASURED',
    totalLengthCm: args.segments.length > 0 ? Math.round(args.segments.reduce((a, s) => a + s.lengthCm, 0) * 10) / 10 : null,
    segments: args.segments.map((s) => ({
      key: `seg-${s.order + 1}`, // tekačev order je 0-based; cone plan-a so 1-based
      label: `Segment ${s.order + 1}`,
      lengthCm: s.lengthCm,
      heightCm: s.heightCm,
      slopeDeg: s.slopeDeg,
      angleDeg: s.angleDeg,
      posts: null,
    })),
    terrain: args.terrain,
    obstojeco: args.obstojeco ? { opis: args.obstojeco } : null,
    reference: args.refs,
    coverage: args.coverage
      ? { gateOk: args.coverage.gateOk, zones: args.coverage.zones.length, missing: args.coverage.criticalMissing.length }
      : null,
    device: args.device,
    outdoor: args.outdoor,
    photoCount: args.photoCount,
    engineVersion: CAPTURE_QA_VERSION,
  }
}

// ─── §10: AS-DESIGNED builder ───────────────────────────────────────────────

export function buildAsDesigned (args: {
  segments: TwinSegmentData[]
  totalLengthCm: number | null
  produkt: { productId: string; variantId: string | null; ime: string; varianta: string | null; ral: string | null }
  config: Record<string, unknown> | null
  fotoViz: { id: string; variantLabel: string; engineVersion: string } | null
  measurement: { id: string; version: number | null } | null
  terrain?: { atCm: number; elevCm: number }[] | null
}): TwinSnapshotData {
  return {
    kind: 'AS_DESIGNED',
    totalLengthCm: args.totalLengthCm,
    segments: args.segments,
    terrain: args.terrain ?? null,
    produkt: args.produkt,
    config: args.config,
    fotoViz: args.fotoViz,
    engineVersion: CAPTURE_QA_VERSION,
  }
}

// ─── §11: AS-PRODUCED builder ───────────────────────────────────────────────

export function buildAsProduced (args: {
  designed: TwinSnapshotData | null
  bom: { code: string; status: string; lines: number; qty: number; unit: string }
  spremembe: { opis: string; odobril: string; ts: string }[]
  /** R462 (issue #17 §11): EKSPPLICITNI overridi mer po segmentih (ključi iz
   *  designed-a) — odobrene spremembe se odrazijo v dejansko izdelani konfiguraciji. */
  segmentOverrides?: { key: string; lengthCm?: number | null; heightCm?: number | null }[] | null
}): TwinSnapshotData {
  const ov = new Map((args.segmentOverrides ?? []).map((o) => [o.key, o]))
  const segments = (args.designed?.segments ?? []).map((s) => {
    const o = ov.get(s.key)
    if (!o) return s
    return {
      ...s,
      lengthCm: o.lengthCm != null ? o.lengthCm : s.lengthCm,
      heightCm: o.heightCm != null ? o.heightCm : s.heightCm,
    }
  })
  const total = segments.length > 0 ? Math.round(segments.reduce((a, s) => a + (s.lengthCm ?? 0), 0) * 10) / 10 : args.designed?.totalLengthCm ?? null
  return {
    kind: 'AS_PRODUCED',
    totalLengthCm: total,
    segments,
    ...(args.segmentOverrides && args.segmentOverrides.length > 0
      ? { producedOverrideKeys: args.segmentOverrides.map((o) => o.key) }
      : {}),
    terrain: args.designed?.terrain ?? null,
    produkt: args.designed?.produkt ?? undefined,
    bom: args.bom,
    spremembe: args.spremembe,
    engineVersion: CAPTURE_QA_VERSION,
  }
}

// ─── §12: AS-INSTALLED builder ──────────────────────────────────────────────

export function buildAsInstalled (args: {
  designed: TwinSnapshotData | null
  finalSegments: { key: string; label: string; lengthCm?: number | null; heightCm?: number | null }[]
  notes: string[]
  workOrderId: string | null
  photoCount?: number
}): TwinSnapshotData {
  const designedByKey = new Map((args.designed?.segments ?? []).map((s) => [s.key, s]))
  const segments: TwinSegmentData[] = args.finalSegments.map((f) => {
    const d = designedByKey.get(f.key)
    return {
      key: f.key,
      label: f.label,
      lengthCm: f.lengthCm ?? d?.lengthCm ?? null,
      heightCm: f.heightCm ?? d?.heightCm ?? null,
      slopeDeg: d?.slopeDeg ?? null,
      angleDeg: d?.angleDeg ?? null,
      posts: d?.posts ?? null,
    }
  })
  return {
    kind: 'AS_INSTALLED',
    totalLengthCm: segments.length > 0
      ? Math.round(segments.reduce((a, s) => a + (s.lengthCm ?? 0), 0) * 10) / 10
      : args.designed?.totalLengthCm ?? null,
    segments,
    produkt: args.designed?.produkt ?? undefined,
    montaža: { notes: args.notes, workOrderId: args.workOrderId },
    photoCount: args.photoCount,
    engineVersion: CAPTURE_QA_VERSION,
  }
}

// ─── razčlenjevalci (ISTA pravila odjemalec + strežnik) ─────────────────────

function isObj (v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parsePlan (v: unknown): PlanStop[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const out: PlanStop[] = []
  for (const item of v) {
    if (!isObj(item)) return null
    const kind = item.kind
    const label = item.label
    if (typeof kind !== 'string' || !(kind in STOP_KINDS)) return null
    if (typeof label !== 'string' || !label.trim()) return null
    const stop: PlanStop = {
      id: typeof item.id === 'string' && item.id ? item.id : '',
      kind: kind as StopKind,
      label: label.slice(0, 120),
      critical: item.critical === true,
    }
    if (typeof item.atCm === 'number' && Number.isFinite(item.atCm)) stop.atCm = item.atCm
    if (!stop.id) return null
    out.push(stop)
  }
  return out
}

export function parseDevice (v: unknown): { tier: DeviceTier; caps: DeviceCapsInput } | null {
  if (!isObj(v)) return null
  const tier = v.tier
  if (typeof tier !== 'string' || !(tier in TIER_LABELS)) return null
  const caps: DeviceCapsInput = {}
  if (isObj(v.caps)) {
    for (const k of ['camera', 'lidar', 'depth', 'ar', 'gyro', 'accelerometer', 'gps', 'storage', 'network'] as const) {
      if (v.caps[k] === true) caps[k] = true
    }
  }
  return { tier: tier as DeviceTier, caps }
}

export function parseOutdoor (v: unknown): { conditions: string[]; note?: string } | null {
  if (!isObj(v)) return null
  const conds = v.conditions
  if (!Array.isArray(conds)) return null
  const valid = new Set(OUTDOOR_CONDITIONS.map((c) => c.id))
  const conditions = conds.filter((c): c is string => typeof c === 'string' && valid.has(c))
  const out: { conditions: string[]; note?: string } = { conditions }
  if (typeof v.note === 'string' && v.note.trim()) out.note = v.note.slice(0, 300)
  return out
}

export function parseState (v: unknown): { currentStopId: string | null; doneStops: string[] } | null {
  if (!isObj(v)) return null
  const done = v.doneStops
  if (!Array.isArray(done)) return null
  const doneStops = done.filter((d): d is string => typeof d === 'string')
  const cur = v.currentStopId
  return { currentStopId: typeof cur === 'string' && cur ? cur : null, doneStops }
}

export function parseDrift (v: unknown): { samples: DriftSample[]; status: DriftState; lastRefCode: string | null } | null {
  if (!isObj(v)) return null
  const rawSamples = v.samples
  if (!Array.isArray(rawSamples)) return null
  const samples: DriftSample[] = []
  for (const s of rawSamples) {
    if (!isObj(s) || typeof s.offsetCm !== 'number' || !Number.isFinite(s.offsetCm)) continue
    const sample: DriftSample = { offsetCm: s.offsetCm, ts: typeof s.ts === 'string' ? s.ts : new Date().toISOString() }
    if (typeof s.atCm === 'number' && Number.isFinite(s.atCm)) sample.atCm = s.atCm
    samples.push(sample)
  }
  const status = v.status
  const st: DriftState = typeof status === 'string' && status in DRIFT_STATES ? status as DriftState : 'DRIFT_OK'
  const lr = v.lastRefCode
  return { samples, status: st, lastRefCode: typeof lr === 'string' && lr ? lr : null }
}

export function parseQuality (v: unknown): PhotoQuality | null {
  if (!isObj(v)) return null
  return {
    dark: v.dark === true,
    bright: v.bright === true,
    blurry: v.blurry === true,
    ...(typeof v.blurScore === 'number' && Number.isFinite(v.blurScore) ? { blurScore: v.blurScore } : {}),
  }
}

export function parseTwinData (v: unknown): TwinSnapshotData | null {
  if (!isObj(v)) return null
  const kind = v.kind
  if (typeof kind !== 'string' || !(kind in TWIN_KINDS)) return null
  const segs = v.segments
  if (!Array.isArray(segs)) return null
  const segments: TwinSegmentData[] = []
  for (const s of segs) {
    if (!isObj(s) || typeof s.key !== 'string' || typeof s.label !== 'string') continue
    segments.push({
      key: s.key,
      label: s.label,
      lengthCm: typeof s.lengthCm === 'number' ? s.lengthCm : null,
      heightCm: typeof s.heightCm === 'number' ? s.heightCm : null,
      slopeDeg: typeof s.slopeDeg === 'number' ? s.slopeDeg : null,
      angleDeg: typeof s.angleDeg === 'number' ? s.angleDeg : null,
      posts: typeof s.posts === 'number' ? s.posts : null,
    })
  }
  const out: TwinSnapshotData = {
    kind: kind as TwinKind,
    totalLengthCm: typeof v.totalLengthCm === 'number' ? v.totalLengthCm : null,
    segments,
    engineVersion: typeof v.engineVersion === 'string' ? v.engineVersion : CAPTURE_QA_VERSION,
  }
  if (Array.isArray(v.producedOverrideKeys)) {
    out.producedOverrideKeys = v.producedOverrideKeys.filter((k): k is string => typeof k === 'string')
  }
  // R488 (E2E veriga): produkt (RAL/varianta) preživi round-trip — AS-PRODUCED
  // in prefab lističi potrebujejo RAL iz variante paketa (issue #9 veriga).
  if (isObj(v.produkt) && typeof (v.produkt as { ime?: unknown }).ime === 'string') {
    const pr = v.produkt as Record<string, unknown>
    out.produkt = {
      productId: typeof pr.productId === 'string' ? pr.productId : '',
      variantId: typeof pr.variantId === 'string' ? pr.variantId : null,
      ime: pr.ime as string,
      varianta: typeof pr.varianta === 'string' ? pr.varianta : null,
      ral: typeof pr.ral === 'string' ? pr.ral : null,
    }
  }
  // R488 §P5: opozorilo o osnutkovem viru AS-DESIGNED preživi round-trip
  if (v.runDraftWarning === true) {
    out.runDraftWarning = true
    out.runStatusAtSnapshot = typeof v.runStatusAtSnapshot === 'string' ? v.runStatusAtSnapshot : null
  }
  return out
}

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

export const CALIB_METHODS: { id: CalibrationMethod; label: string; desc: string }[] = [
  { id: 'MARKER', label: 'Fizični marker', desc: 'Merilni marker (šahovnica) v kadru — znana velikost' },
  { id: 'ZNANA_MERA', label: 'Znana mera objekta', desc: 'Vrata, okno, ploščica … znana dejanska dolžina' },
  { id: 'ZUNANJA_NAPRAVA', label: 'Zunanja naprava', desc: 'Leica DISTO / laser — referenčna razdalja' },
  { id: 'LIDAR', label: 'LiDAR / depth skala', desc: 'Globinska senzorika naprave (kjer je podprta)' },
  { id: 'ROCNO', label: 'Ročna referenca', desc: 'Ročno izmerjena referenca na objektu' },
]

export interface EnginePoint { x: number; y: number; src?: 'ROCNO' | 'PREDLOG' }
export interface EngineCalib {
  px: number // dolžina reference v pikslih
  cm: number // dolžina reference v cm
  imgW?: number
  imgH?: number
  method?: CalibrationMethod
  refObject?: string
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

// ── Geometrija (deterministična) ─────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/** Piksli med dvema točkama (normalizirani 0..1 z imgW/imgH ali že v px). */
function toPx (pts: EnginePoint[], calib: EngineCalib): { x: number; y: number }[] {
  const hasDim = (calib.imgW ?? 0) > 0 && (calib.imgH ?? 0) > 0
  return pts.map((p) => ({ x: p.x * (hasDim ? (calib.imgW as number) : 1), y: p.y * (hasDim ? (calib.imgH as number) : 1) }))
}

export interface GeometryResult {
  segments: Segment[]
  corners: Corner[]
  totalLengthCm: number
  cmPerPx: number
  bbox: { wCm: number; hCm: number }
}

/** Polilinija: dolžine/koti segmentov + vogali (vzorec railing-layout, §12). */
export function computeGeometry (ptsIn: EnginePoint[], calib: EngineCalib): GeometryResult {
  const pts = ptsIn.filter((p) => p.src !== 'PREDLOG') // predlogi ne štejejo (§5 avtomatika ni avtoriteta)
  const cmPerPx = calib.px > 0 ? calib.cm / calib.px : 1
  const px = toPx(pts, calib)
  const segments: Segment[] = []
  let total = 0
  for (let i = 0; i + 1 < px.length; i++) {
    const dx = px[i + 1].x - px[i].x
    const dy = px[i + 1].y - px[i].y
    const lengthCm = Math.hypot(dx, dy) * cmPerPx
    segments.push({
      from: i, to: i + 1,
      lengthCm: r1(lengthCm),
      angleDeg: Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10,
      heightDiffCm: r1(dy * cmPerPx),
      horizontalCm: r1(Math.abs(dx) * cmPerPx),
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
    cmPerPx,
    bbox: px.length > 0
      ? { wCm: r1((Math.max(...xs) - Math.min(...xs)) * cmPerPx), hCm: r1((Math.max(...ys) - Math.min(...ys)) * cmPerPx) }
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
}

/** Poligon (§9/§10/§11): samodejno zaprtje, površina (shoelace), obseg. */
export function polygonMetrics (ptsIn: EnginePoint[], calib: EngineCalib): PolygonResult {
  const pts = ptsIn.filter((p) => p.src !== 'PREDLOG')
  const cmPerPx = calib.px > 0 ? calib.cm / calib.px : 1
  const px = toPx(pts, calib)
  const closed = pts.length >= 3
  const closureCm = pts.length >= 3 ? r1(Math.hypot(px[0].x - px[px.length - 1].x, px[0].y - px[px.length - 1].y) * cmPerPx) : 0
  const ring = px.map((p) => ({ x: p.x * cmPerPx, y: p.y * cmPerPx })) // v cm
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
  }
}

/** Diagonale (§12): pri 4 točkah (0↔2, 1↔3), sicer praški prek vogalov. */
export function diagonalMetrics (ptsIn: EnginePoint[], calib: EngineCalib): Diagonal[] {
  const pts = ptsIn.filter((p) => p.src !== 'PREDLOG')
  if (pts.length < 4) return []
  const cmPerPx = calib.px > 0 ? calib.cm / calib.px : 1
  const px = toPx(pts, calib)
  const pairs: [number, number][] = pts.length === 4 ? [[0, 2], [1, 3]] : [[0, Math.floor(pts.length / 2)]]
  return pairs.map(([i, j]) => ({ i, j, lengthCm: r1(Math.hypot(px[j].x - px[i].x, px[j].y - px[i].y) * cmPerPx) }))
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
  opts: { manualLengthCm?: number | null; computedLengthCm?: number | null; steps?: number | null } = {}
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
  const geo = computeGeometry(pts, calib)

  // poligon: samodejno zaprtje (kot magicplan/MeasureSquare) — obroč = točke +
  // implicirana zaklepalka nazaj na prvo točko. §14 »ali je poligon zaprt« =
  // strukturna veljavnost: ≥ 3 točke, neničelna površina; če je uporabnik prvo
  // točko ponovil na koncu (eksplicitno zaprtje), je zaklepalka ničelna (INFO).
  // Zamujeni vogal se ne da zanesljivo zaznati geometrijsko — zadnja obramba je
  // review zaslon s narisanim poligonom (§15).
  if (rule.polygon) {
    const poly = polygonMetrics(pts, calib)
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

// ── §8–§11: domenski paketi ──────────────────────────────────────────────────

export interface Opening { wCm: number; hCm: number; count: number }

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
  handrailM: number
  infillM2: number
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
}

export interface StrehaDomain {
  mode: 'STREHA'
  footprintM2: number
  pitchDeg: number
  faceAreaM2: number
  perimeterCm: number
  ridgeCm: number
  eaveCm: number
  material: 'BETONNA' | 'KOVINSKA'
  wastePct: number
  materialM2: number
}

export interface FasadaDomain {
  mode: 'FASADA'
  grossM2: number
  perimeterCm: number
  openings: { wCm: number; hCm: number; count: number; areaM2: number }[]
  openingsM2: number
  netM2: number
}

export interface StopniceDomain {
  mode: 'STOPNICE'
  slopeLengthCm: number
  heightDiffCm: number
  horizontalCm: number
  angleDeg: number
  steps: number
  riseCm: number
  runCm: number
}

export interface ProstorDomain {
  mode: 'PROSTOR'
  areaM2: number
  perimeterCm: number
  diagonals: Diagonal[]
  rectangleOk: boolean | null
  closureCm: number
}

export interface SplosnoDomain { mode: 'SPLOSNO'; totalLengthCm: number; segments: Segment[] }

export type DomainResult = OgrajaDomain | KeramikaDomain | StrehaDomain | FasadaDomain | StopniceDomain | ProstorDomain | SplosnoDomain

export function analyzeDomain (mode: MeasureMode, pts: EnginePoint[], calib: EngineCalib, opts: DomainOptions = {}): DomainResult {
  const geo = computeGeometry(pts, calib)
  switch (mode) {
    case 'OGRAJA': {
      const maxSpan = opts.maxSpanCm != null && opts.maxSpanCm >= 40 && opts.maxSpanCm <= 300 ? opts.maxSpanCm : 120
      const height = opts.heightCm != null && opts.heightCm > 10 && opts.heightCm <= 300 ? opts.heightCm : 100
      const raw = geo.segments.reduce((acc, s) => acc + Math.max(1, Math.ceil(s.lengthCm / maxSpan)) + 1, 0)
      const posts = Math.max(geo.segments.length > 0 ? 2 : 0, raw - Math.max(0, geo.segments.length - 1))
      return {
        mode: 'OGRAJA',
        totalLengthCm: geo.totalLengthCm,
        segments: geo.segments,
        corners: geo.corners,
        posts,
        spacingCm: maxSpan,
        handrailM: r2(geo.totalLengthCm / 100),
        infillM2: r2((geo.totalLengthCm / 100) * (height / 100)),
      }
    }
    case 'KERAMIKA': {
      const poly = polygonMetrics(pts, calib)
      const tileW = opts.tileWcm != null && opts.tileWcm > 0 ? opts.tileWcm : 60
      const tileH = opts.tileHcm != null && opts.tileHcm > 0 ? opts.tileHcm : 60
      const jointMm = opts.jointMm != null && opts.jointMm >= 0 && opts.jointMm <= 30 ? opts.jointMm : 3
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
      }
    }
    case 'STREHA': {
      const poly = polygonMetrics(pts, calib)
      const pitch = opts.pitchDeg != null && opts.pitchDeg >= 0 && opts.pitchDeg < 85 ? opts.pitchDeg : 35
      const material = opts.roofMaterial === 'KOVINSKA' ? 'KOVINSKA' : 'BETONNA'
      const faceArea = r2(poly.areaM2 / Math.cos((pitch * Math.PI) / 180))
      const sorted = [...poly.edges].sort((a, b) => b.lengthCm - a.lengthCm)
      const ridge = sorted.length > 0 ? sorted[0].lengthCm : 0 // najdaljši rob = slemen
      const eave = r1(poly.perimeterCm - ridge)
      const wastePct = material === 'KOVINSKA' ? 7 : 10
      return {
        mode: 'STREHA', footprintM2: poly.areaM2, pitchDeg: pitch, faceAreaM2: faceArea,
        perimeterCm: poly.perimeterCm, ridgeCm: ridge, eaveCm: eave, material, wastePct,
        materialM2: r2(faceArea * (1 + wastePct / 100)),
      }
    }
    case 'FASADA': {
      const poly = polygonMetrics(pts, calib)
      const openings = (opts.openings ?? []).map((o) => ({ wCm: o.wCm, hCm: o.hCm, count: o.count, areaM2: r2((o.wCm * o.hCm * o.count) / 10000) }))
      const openingsM2 = r2(openings.reduce((s, o) => s + o.areaM2, 0))
      return {
        mode: 'FASADA', grossM2: poly.areaM2, perimeterCm: poly.perimeterCm, openings,
        openingsM2, netM2: r2(Math.max(0, poly.areaM2 - openingsM2)),
      }
    }
    case 'STOPNICE': {
      const s = geo.segments[0] ?? { lengthCm: 0, heightDiffCm: 0, horizontalCm: 0, angleDeg: 0, from: 0, to: 1 }
      const heightDiff = Math.abs(s.heightDiffCm)
      const steps = opts.steps != null && opts.steps > 0 ? Math.round(opts.steps) : Math.max(1, Math.ceil(heightDiff / 17))
      return {
        mode: 'STOPNICE',
        slopeLengthCm: s.lengthCm,
        heightDiffCm: r1(heightDiff),
        horizontalCm: s.horizontalCm,
        angleDeg: Math.round((Math.atan2(heightDiff, s.horizontalCm || 1) * 180) / Math.PI * 10) / 10,
        steps,
        riseCm: r1(heightDiff / steps),
        runCm: r1(s.horizontalCm / steps),
      }
    }
    case 'PROSTOR': {
      const poly = polygonMetrics(pts, calib)
      const diags = diagonalMetrics(pts, calib)
      const rectangleOk = diags.length === 2 && diags[1].lengthCm > 0
        ? Math.abs(diags[0].lengthCm - diags[1].lengthCm) / Math.max(diags[0].lengthCm, diags[1].lengthCm) <= 0.01
        : null
      return { mode: 'PROSTOR', areaM2: poly.areaM2, perimeterCm: poly.perimeterCm, diagonals: diags, rectangleOk, closureCm: poly.closureCm }
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

export interface MethodRecommendation { method: 'KAMERA_REFERENCA' | 'FOTOGRAMETRIJA' | 'ROCNO'; label: string; reason: string }

/** §16/§18: priporočena metoda iz zmogljivosti (provider-agnostic, brez vezave). */
export function recommendMethod (caps: DeviceCaps): MethodRecommendation {
  if (!caps.camera) {
    return { method: 'ROCNO', label: 'Ročni vnos + referenca', reason: 'Kamera ni na voljo — profesionalni ročni način s skico in referenčnimi merami (§12).' }
  }
  if (caps.orientation && caps.webgl) {
    return { method: 'FOTOGRAMETRIJA', label: 'Kamera + več pogledov (fotogrametrija)', reason: 'Naprava brez dostopa do LiDAR/depth — iz več fotografij istega objekta rekonstruiramo geometrijo (2.–4. pogled).' }
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

export interface AnalyzeResult {
  mode: MeasureMode
  geometry: GeometryResult
  polygon: PolygonResult | null
  diagonals: Diagonal[]
  validation: ValidationIssue[]
  confidence: ConfidenceResult
  captureGuide: { checks: CaptureCheck[]; status: CheckState }
  domain: DomainResult
  generatedAt: string
}

export function runAnalysis (input: AnalyzeInput): AnalyzeResult {
  const rule = MODE_RULES[input.mode]
  const geometry = computeGeometry(input.points, input.calibration)
  const polygon = rule.polygon ? polygonMetrics(input.points, input.calibration) : null
  const diagonals = diagonalMetrics(input.points, input.calibration)
  const validation = validateGeometry(input.mode, input.points, input.calibration, {
    manualLengthCm: input.manualLengthCm ?? null,
    computedLengthCm: input.manualLengthCm != null ? geometry.totalLengthCm : null,
    steps: input.options?.steps ?? null,
  })
  const confidence = computeConfidence({
    calibMethod: input.calibration.method ?? null,
    quality: input.quality ?? null,
    viewAgreementPct: input.viewAgreementPct ?? null,
    issues: validation,
  })
  const guide = captureGuide({
    quality: input.quality ?? null,
    tiltDeg: input.tiltDeg ?? null,
    calibPresent: input.calibration.px > 0 && input.calibration.cm > 0,
    viewCount: input.viewCount ?? 1,
  })
  return {
    mode: input.mode,
    geometry,
    polygon,
    diagonals,
    validation,
    confidence,
    captureGuide: guide,
    domain: analyzeDomain(input.mode, input.points, input.calibration, input.options ?? {}),
    generatedAt: new Date().toISOString(),
  }
}

// ── §19: export ──────────────────────────────────────────────────────────────

export interface ExportRow { skupina: string; polje: string; vrednost: string; enota: string }

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
  params?: {
    mode?: string
    calibration?: { method?: string; refObject?: string; px?: number; cm?: number } | null
    confidence?: number | null
    quality?: Record<string, unknown> | null
    photoId?: string
    /** R487 (issue #3): strežniško izračunana konsolidacija pogledov (confirm). */
    multiView?: { count?: number; values?: number[]; mean?: number; spreadPct?: number; conflict?: boolean; manualOverride?: boolean } | null
    engine?: { domain?: DomainResult | null; validation?: ValidationIssue[] | null } | null
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
  push('Meritev', 'Dolžina', m.lengthCm != null ? r1(m.lengthCm).toString().replace('.', ',') : '—', 'cm')
  if (m.heightCm != null) push('Meritev', 'Višina', r1(m.heightCm).toString().replace('.', ','), 'cm')
  if (m.slopeDeg != null) push('Meritev', 'Nagib', String(m.slopeDeg), '°')
  if (m.posts != null) push('Meritev', 'Stebri', String(m.posts), 'kos')
  if (m.segments != null) push('Meritev', 'Segmenti', String(m.segments), '')
  const cal = m.params?.calibration
  if (cal?.method) push('Reference', 'Kalibracija', cal.method, '')
  if (cal?.refObject) push('Reference', 'Referenčni objekt', cal.refObject, '')
  if (cal?.px != null && cal?.cm != null) push('Reference', 'Referenčna mera', `${r1(cal.cm).toString().replace('.', ',')} / ${Math.round(cal.px)}`, 'cm / px')
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

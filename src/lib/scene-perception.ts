// R467 (issue #8 — SMART VISION, Faza 1): ŽIVA PERCEPCIJA PRIZORA (odjemalec).
// R468 (issue #8 — Faza 2): maska tal (segmentacija z regijo rasti), detekcija
//   dolgih robov (ROB), ocena talne ravnine in naklona z ločitvijo od nagiba
//   telefona (getPhoneRollDeg → estimateSlope v jedru).
// R469 (issue #8 — Faza 3): STOPNICE — detekcija nastopnih črt (vrhovi
//   vodoravnih gradientov + najdaljši tek močnih stolpcev), analiza vzorca
//   pa je v jedru (analyzeStairPattern): števec, smer vzpenjanja, enakomernost,
//   morebitni podest. Iz enega pogleda NI metrske izmere (poštenost §4).
// R470 (issue #8 — §5): ČLOVEŠKA FIGURA — gibanje + razmerje stranic bbox
//   (looksLikePerson v jedru) → element OSEBA (status NEJASNO — hevristika
//   NE trdi „oseba“, dokler ne pokaže oblike figure). DOKUMENTIRANA MEJA:
//   mirujoče osebe brez ML ne zaznamo; zaznava je ŽIVA in se ne persistira
//   (zasebnost §5 — strip v sanitizeSceneResult).
// DOM/canvas plast nad scene-understanding-core (čista logika): poganja
// nizkofrekvenčno analizo kadrov iz <video> in vrača SceneElement[].
//
// FAZA 1–3 BREZ ML: vse hevristike so klasične računalniškovidezne osnove
// (svetlost, Laplace, Sobel robovi, razlika sličic za gibanje, barvne
// značilnosti podlage, regija rasti za masko tal, sledenje črt za robove in
// stopnice). NISO merilne — rezultat je PREDLOG, ki ga monter potrdi ali
// popravi (core načelo: avtomatika ni avtoriteta).
//
// Zmogljivost: canvas ≤ 320 px, interval privzeto 250 ms (~4 Hz), izklop ob
// document.hidden — namenjeno telefonom brez pregrevanja (issue §10).
//
// R471 (issue #8 — Faza 4 „Optimizacija“): GUVERNER ZMOGLJIVOSTI — meri čas
//   obdelave vsake sličice in ob 3 zaporednih POČASNIH kadrčkih (> 60 %
//   intervala) enostopenjsko degradira (interval ×1,4 do 750 ms, delovna
//   širina ÷1,3 do 160 px). DEGRADACIJA JE ENOSMERNA znotraj seje: brez
//   avtomatskega okrevanja — izognemo se nihanju obremenitve in toplotnim
//   sunkom (issue §10: „temperatura, pomnilnik, delovanje offline“). Nova
//   seja začne spet od osnovnega načrta. Medpomnilniki sivin se PONOVNO
//   uporabijo (ni alokacije Float32Array na vsakem kadrčku — manj GC pritiska).
//
// R483 (issue #8 — Faza 5 „popravki prepoznavanja“): PET konservativnih
//   popravkov lažnih pozitivov (brez novih obljub — vsak samo ZMANJŠA
//   napačne trditve ali izpelje podatke iz dejansko zaznanih dokazov):
//   (1) OGRAJA: zahteva ≥ 2 vzporedni črti, bbox iz dejanskega obsega črt
//       (prej: ena črta + namišljen polnoširinski bbox [0.05, …, 0.9, 0.14]);
//   (2) gibanje: POVEZANE KOMPONENTE mreže zadetkov (≥ 2 % kadra) — vsaka
//       svoj element (oseba ob robu + rastlina ≠ en velik okvir); stabilne
//       ID-je čez sličice podari obstoječi stabilizeElements (IoU);
//   (3) PLOŠČICE/LES: klasifikacija podlage iz anizotropije smeri robov
//       (jedro) — brez izmerjene smeri razreda NE trdimo (NEZNANA);
//   (4) STOPNICA: monotonost zaporedja (y + smer središč, jedro) in
//       enakomeren lamelni niz v KADRU gre v OGRAJO, ne v STOPNICO;
//   (5) PODLAGA: bbox iz točk dejanske maske tal (ne fiksna spodnja tretjina).

import {
  analyzeStairPattern, classifySurface, estimateSlope, looksLikePerson, newSceneId, stabilizeElements,
  type SceneElement, type ScenePoint, type StairLineInput, type SurfaceFeatures,
} from '@/lib/scene-understanding-core'

export interface PerceptionQuality {
  brightness: number
  blurScore: number
  dark: boolean
  bright: boolean
  blurry: boolean
}

export interface PerceptionFrame {
  elements: SceneElement[]
  quality: PerceptionQuality
}

export interface SceneLoopOptions {
  /** interval analize v ms (privzeto 250, min 120). */
  intervalMs?: number
  /** širina delovnega canvasa (privzeto 320, 160..640). */
  workWidth?: number
  /**
   * R468 (F2 §3): trenutni nagib telefona okrog optične osi (stopinje,
   * + = desna stran nižje) ali null, če senzorja ni / ni javil. Odjemalec
   * priskrbei lastno DeviceOrientation poslušanje — percepcija ostane čista.
   */
  getPhoneRollDeg?: () => number | null
  /**
   * R471 (F4): poročanje o stanju guvernerja (opcijsko — HUD brez šuma).
   *   Kliče se ob vsaki SPREMEMBI načrta (degradacija), ne na vsakem kadrčku.
   */
  onPerf?: (perf: PerceptionPerf) => void
  onFrame: (frame: PerceptionFrame) => void
}

/** R471 (F4): poročilo guvernerja — za prikaz/diagnostiko. */
export interface PerceptionPerf {
  intervalMs: number
  workWidth: number
  /** zadnji čas obdelave sličice (ms) ali null (preskočena). */
  lastTickMs: number | null
  /** kolikokrat je guverner degradiral v tej seji. */
  degradations: number
}

// ── R471 (F4): GUVERNER ZMOGLJIVOSTI — ČISTA ODLOČITEV (testirljiva) ──────

/** Načrt izvajanja percepcije (meje: interval 120..750 ms, širina 160..640). */
export interface PerceptionPlan {
  intervalMs: number
  workWidth: number
  /** zaporedni počasni kadrčki (interni števec degradacije). */
  slowRun: number
}

export const PERCEPTION_LIMITS = {
  intervalMinMs: 120,
  intervalMaxMs: 750,
  workWidthMin: 160,
  workWidthMax: 640,
  /** obdelava naj poje največ ta delež intervala, sicer je kadrček „počasen“. */
  budgetRatio: 0.6,
  /** koliko zaporednih počasnih kadrčkov sproži degradacijo (prag proti GC sunkom). */
  slowThreshold: 3,
} as const

function clampPlan (p: PerceptionPlan): PerceptionPlan {
  const intervalMs = Math.round(Math.min(PERCEPTION_LIMITS.intervalMaxMs, Math.max(PERCEPTION_LIMITS.intervalMinMs, p.intervalMs)))
  const workWidth = Math.round(Math.min(PERCEPTION_LIMITS.workWidthMax, Math.max(PERCEPTION_LIMITS.workWidthMin, p.workWidth)))
  const slowRun = Number.isFinite(p.slowRun) && p.slowRun > 0 ? Math.min(99, Math.floor(p.slowRun)) : 0
  return { intervalMs, workWidth, slowRun }
}

/**
 * Naslednji korak guvernerja (ČISTO, brez DOM):
 *  • tickMs = null → kadrček brez obdelave (skrit zavihek) — števci se
 *    ponastavijo, načrt ostane;
 *  • tickMs > intervalMs · 0,6 → počasen kadrček; po 3 zaporednih SE
 *    degradira EN korak (interval ×1,4 do 750, širina ÷1,3 do 160) in
 *    števec ponastavi;
 *  • sicer → udoben kadrček, števec počasnih se ponastavi.
 * Degradacija je NAMENOMA enosmerna (glej glavo datoteke — toplotna
 * stabilnost). Rezultat je VEDNO znotraj meja PERCEPTION_LIMITS.
 */
export function nextPerfPlan (plan: PerceptionPlan, tickMs: number | null): PerceptionPlan {
  const p = clampPlan(plan)
  if (tickMs == null || !Number.isFinite(tickMs) || tickMs < 0) {
    return { intervalMs: p.intervalMs, workWidth: p.workWidth, slowRun: 0 }
  }
  const budget = p.intervalMs * PERCEPTION_LIMITS.budgetRatio
  if (tickMs > budget) {
    const slowRun = p.slowRun + 1
    if (slowRun < PERCEPTION_LIMITS.slowThreshold) {
      return { intervalMs: p.intervalMs, workWidth: p.workWidth, slowRun }
    }
    return clampPlan({
      intervalMs: Math.round((p.intervalMs * 1.4) / 10) * 10,
      workWidth: Math.round((p.workWidth / 1.3) / 10) * 10,
      slowRun: 0,
    })
  }
  return { intervalMs: p.intervalMs, workWidth: p.workWidth, slowRun: 0 }
}

const SOBEL_THRESHOLD = 52 // jakost roba na 0..255 sivinah
const MOTION_PIXEL_THRESHOLD = 26 // |Δsivina| za "piksel se je spremenil"
const MOTION_RATIO_MIN = 0.008 // ≥ 0,8 % spremenjenih pikslov = gibanje
const HLINE_STRONG = 0.16 // delež močnih vodoravnih robov v vrstici = "črta"

// ── R483 (F5): OGRAJA iz dejanskih dokazov + GIBANJE po komponentah ────────
const FENCE_MIN_LINES = 2 // ≥ 2 vzporedni črti = dokaz o ograji (ročaj+lef)
const MOTION_COMPONENT_MIN = 0.02 // komponenta gibanja < 2 % kadra = šum
const MOTION_MAX_COMPONENTS = 4 // zgornja meja elementov gibanja na kader
const LAMELLA_GAP_TOL = 0.25 // razmaki znotraj ±25 % mediana = "enakomerno"
const LAMELLA_SPAN_TOL = 0.12 // razponi znotraj ±12 % mediana = "lamele"

// ── R469 (F3 §4): STOPNICE — iskanje nastopnih črt ──────────────────────────
const STAIR_SEARCH_TOP = 0.15 // pas iskanja nastopov (od zgoraj) — širše kot ROB
const STAIR_SEARCH_BOT = 0.92 // pas iskanja nastopov (od zgoraj)
const STAIR_LINE_MIN_SPAN = 0.22 // nastopna črta ≥ 22 % širine kadra

// ── R468 (F2): segmentacija tal + detekcija robov ──────────────────────────
const FLOOR_CELL = 8 // px — velikost celice mreže (ista mreža kot gibanje)
const FLOOR_LUM_TOL = 30 // |Δsvetlost| med sosedo in regijo
const FLOOR_CHROMA_TOL = 84 // |Δr|+|Δg|+|Δb| med sosedo in regijo
const FLOOR_MIN_COVERAGE = 0.08 // < 8 % kadra → ni vidnih tal
const EDGE_LINE_MIN_SPAN = 0.35 // črta ≥ 35 % širine kadra = kandidat ROB
const EDGE_LINE_MAX_STEP = 3 // px skoka med sosednjima stolpcema (sledenje)
const EDGE_LINE_MAX_COUNT = 2 // najdaljši 2 črti → ROB elementa
const EDGE_SEARCH_TOP = 0.18 // pas iskanja robov (od zgoraj)
const EDGE_SEARCH_BOT = 0.92 // pas iskanja robov (od zgoraj)

/**
 * Zažene živo percepcijo nad <video>. Vrne stop(). Varno: ob napaki zanka
 * utihne, kamera ostane pri uporabniku — zajem nikoli ni odvisen od percepcije.
 *
 * R471 (F4 — optimizacija): zanka sledi guvernerju (nextPerfPlan) — ob
 * preobremenitvi se interval podaljša in delovna širina zmanjša (toplotna
 * stabilnost). Sivinski medpomnilnik se ponovno uporablja (brez alokacij
 * na vsakem kadrčku); ob spremembi mere se zgodovina (prejšnji kadrček)
 * ponastavi — gibanje se meri samo znotraj istih mer.
 */
export function startSceneLoop (video: HTMLVideoElement, opts: SceneLoopOptions): () => void {
  const getPhoneRollDeg = typeof opts.getPhoneRollDeg === 'function' ? opts.getPhoneRollDeg : null
  const onFrame = opts.onFrame
  const onPerf = typeof opts.onPerf === 'function' ? opts.onPerf : null

  // guverner: osnovni načrt iz želje odjemalca, znotraj meja
  let plan = clampPlan({ intervalMs: opts.intervalMs ?? 250, workWidth: opts.workWidth ?? 320, slowRun: 0 })
  let degradations = 0

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  // R471: PONOVNA UPORABA medpomnilnikov — dva sivinska medpomnilnika se
  // zamenjata (swap), alokacija samo ob spremembi mere (degradacija).
  let grayBuf: Float32Array | null = null
  let prevBuf: Float32Array | null = null
  let prevW = 0
  let prevElements: SceneElement[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let running = true

  function applyTimer (): void {
    if (timer != null) clearInterval(timer)
    timer = setInterval(tick, plan.intervalMs)
  }

  function tick (): void {
    if (!running) return
    if (document.hidden || !ctx || video.videoWidth === 0) return
    const t0 = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : null
    try {
      const w = plan.workWidth
      const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w)) || 1
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      ctx.drawImage(video, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data

      // sivine + kakovost (isti vzorec kot meritve-kamera — advisory)
      if (grayBuf == null || grayBuf.length !== w * h) { grayBuf = new Float32Array(w * h); prevBuf = null }
      const gray = grayBuf
      gray.fill(0)
      let sum = 0
      for (let i = 0; i < w * h; i++) {
        const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
        gray[i] = g
        sum += g
      }
      const brightness = sum / (w * h)
      let lapSum = 0; let lapSq = 0; let n = 0
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
          lapSum += lap; lapSq += lap * lap; n++
        }
      }
      const variance = n > 0 ? lapSq / n - (lapSum / n) ** 2 : 0
      const blurScore = Math.max(0, Math.min(10000, Math.round(variance)))
      const quality: PerceptionQuality = {
        brightness: Math.round(brightness),
        blurScore,
        dark: brightness < 45,
        bright: brightness > 225,
        blurry: blurScore < 45,
      }

      const hasPrev = prevBuf != null && prevW === w
      let phoneRollDeg: number | null = null
      if (getPhoneRollDeg) {
        try { phoneRollDeg = getPhoneRollDeg() } catch { phoneRollDeg = null }
      }
      const raw = analyzeFrame(data, gray, w, h, hasPrev ? prevBuf : null, phoneRollDeg)
      // R471: SWAP — trenutni kadrček postane prejšnji, STARI prejšnji pa
      // naslednji delovni medpomnilnik (recikliranje — brez alokacije)
      const recycled = prevBuf
      prevBuf = gray
      grayBuf = recycled
      prevW = w

      // stabilizacija: isti element obdrži ID med sličicami (oznake ne skačejo)
      const elements = stabilizeElements(prevElements, raw, { iouMin: 0.25, maxMisses: 1 })
      prevElements = elements
      onFrame({ elements, quality })
    } catch {
      // tiho — percepcija je dodatek; zajem mora vedno delovati (issue §7)
    } finally {
      // R471: GUVERNER — meri čas obdelave in po potrebi degradira
      const tickMs = t0 != null && typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now() - t0
        : null
      const next = nextPerfPlan(plan, tickMs)
      if (next.intervalMs !== plan.intervalMs || next.workWidth !== plan.workWidth) {
        degradations += 1
        plan = next
        if (running) applyTimer()
        if (onPerf) {
          try { onPerf({ intervalMs: plan.intervalMs, workWidth: plan.workWidth, lastTickMs: tickMs, degradations }) } catch { /* HUD ne sme ustaviti zanke */ }
        }
      }
    }
  }

  timer = setInterval(tick, plan.intervalMs)
  tick()

  return () => {
    running = false
    if (timer != null) clearInterval(timer)
    grayBuf = null
    prevBuf = null
    prevW = 0
  }
}

/** Analiza ene sličice → novi elementi (brez stabilizacije).
 * R483 (F5): ČISTA funkcija (brez DOM) — izvožena za enotsko testiranje
 * popravkov prepoznavanja (sintetični kadri v bun). */
export function analyzeFrame (
  data: Uint8ClampedArray, gray: Float32Array, w: number, h: number,
  prevGray: Float32Array | null, phoneRollDeg: number | null,
): SceneElement[] {
  const at = Date.now()
  const elements: SceneElement[] = []

  // ── ROBOVI (F2 §3): dolge povezane črte v pasu — predlog ROB-ov in vir
  //    vizualnega kota talne meje (za oceno naklona) ──────────────────────
  const lines = detectEdgeLines(gray, w, h)

  // ── PODLAGA + MASKA TAL + NAKLON (F2 §3) ────────────────────────────────
  const y0 = Math.floor(h * 2 / 3)
  let surface = computeSurfaceFeatures(data, w, y0, h)
  surface = withEdgeDensity(surface, gray, w, y0, h)
  const verdict = classifySurface(surface)

  // maska tal: regija rasti od dna kadra (barvna podobnost, 8-px celice)
  const floorMask = segmentFloor(data, w, h)

  // vizualni kot talne meje: najdaljša črta, ki leži v spodnji polovici
  const floorLine = lines
    .filter((l) => l.yAvg >= h * 0.42)
    .sort((a, b) => b.span - a.span)[0] ?? null
  const slope = estimateSlope(floorLine != null ? floorLine.angleDeg : null, phoneRollDeg)

  elements.push({
    id: newSceneId(),
    cls: 'PODLAGA',
    status: verdict.confidence >= 0.55 ? 'PREPOZNANO' : verdict.confidence >= 0.4 ? 'VERJETNO' : 'NEJASNO',
    source: 'LOKALNO',
    confidence: verdict.confidence,
    // R483 (F5): bbox iz dejanske maske tal (min/max točk poligona) — pri
    // kameri pod kotom prikaz sledi zaznani regiji, ne fiksni tretjini.
    // Fallback na staro območje samo, če maske ni (pošten padec).
    bbox: bboxFromMaskPoints(floorMask?.maskPoints ?? []) ?? [0, 2 / 3, 1, 1 / 3],
    kind: verdict.kind,
    ...(floorMask != null ? { maskPoints: floorMask.maskPoints } : {}),
    ...(slope.slopeDeg != null
      ? { slopeDeg: slope.slopeDeg, slopeSource: slope.slopeSource, geomStatus: slope.geomStatus }
      : { geomStatus: slope.geomStatus }),
    at,
  })

  // ── STOPNICE (F3 §4): vrhovi vodoravnih črt → nastopne črte → analiza
  //    vzorca v jedru (števec, smer, enakomernost, podest) ──────────────
  const stairDetect = detectStairLines(gray, w, h)
  const stair = analyzeStairPattern(stairDetect.lines, w, h)

  // ── ROB elementi (F2 §3): najdaljši črti, ki NISO del stopničnega vzorca
  //    (vzorec ≥3 nastopnih črt = stopnice — te pripadajo STOPNICA) ────
  if (stair == null) {
    for (const line of lines.slice(0, EDGE_LINE_MAX_COUNT)) {
      elements.push({
        id: newSceneId(),
        cls: 'ROB',
        status: line.span >= 0.55 ? 'VERJETNO' : 'NEJASNO',
        source: 'LOKALNO',
        confidence: Math.min(0.45, 0.25 + line.spanRatio * 0.25),
        bbox: [
          Math.max(0, (line.xFrom - w * 0.01) / w),
          Math.max(0, (line.yTop - h * 0.02) / h),
          Math.min(1, (line.xTo - line.xFrom) / w + 0.02),
          Math.max(0.08, (line.yBot - line.yTop) / h + 0.05),
        ],
        angleDeg: line.angleDeg,
        geomStatus: 'GEOMETRIJA_OCENJENA',
        at,
      })
    }
  }

  // ── GIBANJE (F1) + FIGURA (R470 §5): razlika sličic → bbox; če oblika
  //    ustreza pokončni človeški figuri (razmerje stranic + velikost),
  //    element postane OSEBA — NAMEN je samo zakritje merilne točke
  //    (§5: prostorsko razumevanje, NE identifikacija; ne persistira se).
  //    Ostanek gibanja ostane OVIRA (hevristika NE trdi „oseba“ brez
  //    oblike figure — issue §5 poštenost). ────────────────────────────────
  if (prevGray) {
    // R483 (F5): POVEZANE KOMPONENTE gibanja — vsaka komponenta svoj element
    // (oseba ob robu + majhna rastlina = DVA objekta, ne en velik okvir, §2).
    // Oseba/ovira klasifikacija po komponenti (looksLikePerson), stabilne
    // ID-je čez sličice podari stabilizeElements — enako kot za vse elemente.
    for (const box of detectMotionBoxes(gray, prevGray, w, h)) {
      const personLike = looksLikePerson(box)
      elements.push({
        id: newSceneId(),
        cls: personLike ? 'OSEBA' : 'OVIRA',
        status: personLike ? 'NEJASNO' : 'VERJETNO',
        source: 'LOKALNO',
        confidence: personLike ? 0.3 : 0.35,
        bbox: box,
        at,
      })
    }
  }

  // ── STRUKTURA: STOPNICA (F3 §4) z bogatimi podatki ALI OGRAJA (F1) ─────────
  // R483 (F5): enakomeren niz vzporednih črt (isti razmaki, isti razponi) je
  // v enem 2D pogledu bolj verjetno ograja/lamele ali fasadna obloga kot
  // stopnice — prave stopnice kažejo perspektivne razlike med nastopi. Tak
  // vzorec NE sproži STOPNICE (konservativno zavračanje) in gre v OGRAJO,
  // če ima ≥ 2 črti (dokaz o vzporednih letvah).
  const lamellaLike = isUniformLamellaStack(stairDetect.lines)
  if (stair != null && !lamellaLike) {
    // bbox iz unije nastopnih črt (+ blazina)
    const xs = stair.stepLines.flatMap((l) => [l.x1, l.x2])
    const ys = stair.stepLines.flatMap((l) => [l.y1, l.y2])
    const x0 = Math.max(0, Math.min(...xs) - 0.02)
    const x1 = Math.min(1, Math.max(...xs) + 0.02)
    const y0 = Math.max(0, Math.min(...ys) - 0.02)
    const y1 = Math.min(1, Math.max(...ys) + 0.02)
    elements.push({
      id: newSceneId(),
      cls: 'STOPNICA',
      status: stair.confidence >= 0.4 ? 'VERJETNO' : 'NEJASNO',
      source: 'LOKALNO',
      confidence: stair.confidence,
      bbox: [x0, y0, Math.max(0.05, x1 - x0), Math.max(0.05, y1 - y0)],
      steps: stair.steps,
      ascent: stair.ascent,
      stepLines: stair.stepLines,
      stepGap: stair.stepGap,
      stepIrregular: stair.stepIrregular,
      landing: stair.landing,
      geomStatus: 'GEOMETRIJA_OCENJENA',
      at,
    })
  } else if (stairDetect.lines.length >= FENCE_MIN_LINES) {
    // R483 (F5): OGRAJA iz DEJANSKO ZAZNANIH dokazov — ≥ 2 vzporedni črti
    // (ročaj + vmesna letev / lamele), bbox iz dejanskega obsega črt. Brez
    // dokazov element NI ustvarjen (prej: ena črta + namišljen
    // polnoširinski bbox — senca/strešni rob je postal „ograja“).
    let minX = w; let minY = h; let maxX = -1; let maxY = -1
    for (const l of stairDetect.lines) {
      if (l.xFrom < minX) minX = l.xFrom
      if (l.xTo > maxX) maxX = l.xTo
      if (l.y < minY) minY = l.y
      if (l.y > maxY) maxY = l.y
    }
    const fx0 = Math.max(0, minX / w - 0.01)
    const fx1 = Math.min(1, (maxX + 1) / w + 0.01)
    const fy0 = Math.max(0, (minY - 1) / h - 0.02)
    const fy1 = Math.min(1, (maxY + 1) / h + 0.02)
    elements.push({
      id: newSceneId(),
      cls: 'OGRAJA',
      status: 'NEJASNO',
      source: 'LOKALNO',
      confidence: 0.25,
      bbox: [
        Math.max(0, Math.round(fx0 * 1000) / 1000),
        Math.max(0, Math.round(fy0 * 1000) / 1000),
        Math.max(0.02, Math.round((fx1 - fx0) * 1000) / 1000),
        Math.max(0.02, Math.round((fy1 - fy0) * 1000) / 1000),
      ],
      at,
    })
  }

  return elements
}

/** Barvne značilnosti pasu [yFrom..yTo) iz ImageData (vzorčenje vsak 2. piksel). */
function computeSurfaceFeatures (data: Uint8ClampedArray, w: number, yFrom: number, yTo: number): SurfaceFeatures {
  const step = 2
  let count = 0
  let grayness = 0
  let green = 0
  let sat = 0
  let warmth = 0
  let sum = 0
  let sumSq = 0
  for (let y = yFrom; y < yTo; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      sum += lum
      sumSq += lum * lum
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      if (mx - mn < 28) grayness++
      if (g > r + 12 && g > b + 12) green++
      sat += mx <= 0 ? 0 : (mx - mn) / mx
      if (r > b + 12) warmth++
      count++
    }
  }
  const n = Math.max(1, count)
  const mean = sum / n
  return {
    brightness: mean,
    grayness: grayness / n,
    greenRatio: green / n,
    saturation: sat / n,
    edgeDensity: 0, // dopolni withEdgeDensity (Sobel na istem pasu)
    textureVariance: Math.max(0, sumSq / n - mean * mean),
    warmth: warmth / n,
  }
}

/** Doda edgeDensity (delež močnih Sobel robov) obstoječim značilnicam pasu.
 * R483 (F5): doda še grainAnisotropy — ravnovesje smeri robov (Σ|gy|−Σ|gx|)
 * glede na skupno jakost: >0 pretežno vodoravne strukture (vlakna lesa),
 * <0 navpične, ~0 izotropno ali mreža obeh smeri (fuge ploščic). */
function withEdgeDensity (f: SurfaceFeatures, gray: Float32Array, w: number, yFrom: number, yTo: number): SurfaceFeatures {
  let strong = 0
  let total = 0
  let sumGx = 0
  let sumGy = 0
  const yMax = Math.min(yTo, Math.floor(gray.length / Math.max(1, w)) - 1)
  for (let y = Math.max(1, yFrom); y < yMax; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = Math.abs(-gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1])
      const gy = Math.abs(-gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1])
      if (Math.max(gx, gy) > SOBEL_THRESHOLD) strong++
      sumGx += gx
      sumGy += gy
      total++
    }
  }
  const denom = sumGx + sumGy
  return {
    ...f,
    edgeDensity: total > 0 ? strong / total : 0,
    grainAnisotropy: denom > 0 ? Math.max(-1, Math.min(1, (sumGy - sumGx) / denom)) : 0,
  }
}

// ── R483 (F5): GIBANJE = POVEZANE KOMPONENTE mreže zadetkov ──────────────
// Stara motionBox je ZDRAŽILA vse spremembe v EN okvir (oseba ob robu + majhna
// rastlina = en velik OSEBA/OVIRA). Novo: mreža 8-px celic se razcepi na
// povezane komponente (BFS po 4-sosednosti); komponenta < 2 % površine
// kadra je šum. Vrne 0..N okvirjev (normaliziranih 0..1) — vsak postane
// svoj element v analyzeFrame. ČISTA funkcija (testirljiva v bun).
export function detectMotionBoxes (
  gray: Float32Array, prev: Float32Array, w: number, h: number,
): Array<[number, number, number, number]> {
  const cell = 8 // groba mreža 8-px celic — ista kot pri segmentaciji tal
  const gw = Math.ceil(w / cell)
  const gh = Math.ceil(h / cell)
  const hit = new Uint8Array(gw * gh)
  let changed = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (Math.abs(gray[i] - prev[i]) > MOTION_PIXEL_THRESHOLD) {
        hit[Math.floor(y / cell) * gw + Math.floor(x / cell)] = 1
        changed++
      }
    }
  }
  if (changed / (w * h) < MOTION_RATIO_MIN) return []

  // povezane komponente (4-sosednost, BFS z izrecnim skladom)
  const seen = new Uint8Array(gw * gh)
  const stack: number[] = []
  const boxes: Array<{ cells: number; x0: number; y0: number; x1: number; y1: number }> = []
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const start = gy * gw + gx
      if (hit[start] === 0 || seen[start] === 1) continue
      seen[start] = 1
      stack.length = 0
      stack.push(start)
      let cells = 0
      let x0 = gx; let y0 = gy; let x1 = gx; let y1 = gy
      while (stack.length > 0) {
        const idx = stack.pop() as number
        const cx = idx % gw
        const cy = (idx - cx) / gw
        cells++
        if (cx < x0) x0 = cx
        if (cx > x1) x1 = cx
        if (cy < y0) y0 = cy
        if (cy > y1) y1 = cy
        const neighbours = [
          cy > 0 ? idx - gw : -1,
          cy < gh - 1 ? idx + gw : -1,
          cx > 0 ? idx - 1 : -1,
          cx < gw - 1 ? idx + 1 : -1,
        ]
        for (const nb of neighbours) {
          if (nb < 0 || seen[nb] === 1 || hit[nb] === 0) continue
          seen[nb] = 1
          stack.push(nb)
        }
      }
      boxes.push({ cells, x0, y0, x1, y1 })
    }
  }

  const totalCells = gw * gh
  return boxes
    .filter((b) => b.cells / totalCells >= MOTION_COMPONENT_MIN)
    .sort((a, b) => b.cells - a.cells)
    .slice(0, MOTION_MAX_COMPONENTS)
    .map((b) => [
      Math.min(1, (b.x0 * cell) / w),
      Math.min(1, (b.y0 * cell) / h),
      Math.min(1, ((b.x1 - b.x0 + 1) * cell) / w),
      Math.min(1, ((b.y1 - b.y0 + 1) * cell) / h),
    ] as [number, number, number, number])
}

// ── R483 (F5): bbox iz točk maske (PODLAGA sledi zaznani regiji) ───────────
function bboxFromMaskPoints (pts: ScenePoint[]): [number, number, number, number] | null {
  if (pts.length < 3) return null
  let minX = 1; let minY = 1; let maxX = 0; let maxY = 0
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const bw = maxX - minX
  const bh = maxY - minY
  if (!(bw > 0) || !(bh > 0)) return null
  return [minX, minY, bw, bh]
}

// ── R483 (F5): enakomeren niz vzporednih črt = lamelna stapnica ───────────
// ≥ 3 črte z razmaki znotraj ±25 % mediana in razponi znotraj ±12 % mediana
// so v enem 2D pogledu bolj verjetno lamele ograje / fasadna obloga kot
// stopnice (prave stopnice kažejo perspektivno zoženje razmakov in razponov).
// Konservativno: tak vzorec NE sproži STOPNICE (gre v OGRAJO po FENCE_MIN_LINES).
function isUniformLamellaStack (lines: StairLineInput[]): boolean {
  if (lines.length < 3) return false
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y)
  const median = (arr: number[]): number => {
    const s = [...arr].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  const g = median(gaps)
  const sp = median(lines.map((l) => l.xTo - l.xFrom))
  if (!(g > 0) || !(sp > 0)) return false
  const gapsOk = gaps.every((x) => Math.abs(x - g) <= LAMELLA_GAP_TOL * g)
  const spansOk = lines.every((l) => Math.abs((l.xTo - l.xFrom) - sp) <= LAMELLA_SPAN_TOL * sp)
  return gapsOk && spansOk
}

interface RowStrength { rows: number[]; overallRatio: number }

/** Delež močnih vodoravnih robov po vrsticah pasu [yFrom..yTo). */
function horizontalRowStrength (gray: Float32Array, w: number, h: number, yFrom: number, yTo: number): RowStrength {
  const rows: number[] = []
  let strong = 0
  for (let y = Math.max(1, yFrom); y < Math.min(h - 1, yTo); y++) {
    let rowStrong = 0
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      // čisti vodoravni gradient (robovi vodornih struktur: stopnice, robovi)
      const gy = Math.abs(gray[i - w] - gray[i + w]) + Math.abs(gray[i - 1] - gray[i + 1]) / 2
      if (gy > SOBEL_THRESHOLD) rowStrong++
    }
    const ratio = rowStrong / Math.max(1, w - 2)
    rows.push(ratio)
    if (ratio > HLINE_STRONG) strong++
  }
  return { rows, overallRatio: rows.length > 0 ? strong / rows.length : 0 }
}

/** Središča pasov z izrazito vodoravno črto (min razmak ≈ h/60). */
function rowPeaks (rs: RowStrength, h: number, yFrom: number): number[] {
  const peaks: number[] = []
  let runStart = -1
  let runLen = 0
  const stride = Math.max(2, Math.round(h / 60))
  const flush = (): void => {
    if (runStart < 0) return
    const center = runStart + Math.floor(runLen / 2) + yFrom
    if (peaks.length === 0 || center - peaks[peaks.length - 1] >= stride) peaks.push(center)
    runStart = -1
    runLen = 0
  }
  rs.rows.forEach((ratio, idx) => {
    if (ratio > HLINE_STRONG) {
      if (runStart < 0) runStart = idx
      runLen++
    } else {
      flush()
    }
  })
  flush()
  return peaks
}

// ── R469 (F3 §4): NASTOPNE ČRTE — vrhovi vrstic + najdaljši tek stolpcev ────
// Za vsak vrh vodoravne črte (rowPeaks) preišči pas [py−1 .. py+1] in najdi
// najdaljši ZAPOREDNI TEK močnih navpičnih gradientov (stolpci, kjer je
// |gray[y−1] − gray[y+1]| > prag). Tek ≥ 22 % širine = nastopna črta.
// Vrača tudi delež močnih vrstic (za staro OGRAJA hevristiko).

interface StairDetect { lines: StairLineInput[]; strongRowRatio: number }

function detectStairLines (gray: Float32Array, w: number, h: number): StairDetect {
  const yTop = Math.floor(h * STAIR_SEARCH_TOP)
  const yBot = Math.floor(h * STAIR_SEARCH_BOT)
  const rs = horizontalRowStrength(gray, w, h, yTop, yBot)
  const peaks = rowPeaks(rs, h, yTop)

  const lines: StairLineInput[] = []
  const minSpan = Math.floor(w * STAIR_LINE_MIN_SPAN)
  for (const py of peaks) {
    let bestFrom = -1
    let bestLen = 0
    let runFrom = -1
    for (let x = 1; x <= w; x++) {
      let strong = false
      if (x < w) {
        for (let yy = py - 1; yy <= py + 1; yy++) {
          if (yy < 1 || yy >= h - 1) continue
          const i = yy * w + x
          if (Math.abs(gray[i - w] - gray[i + w]) > SOBEL_THRESHOLD) { strong = true; break }
        }
      }
      if (strong) {
        if (runFrom < 0) runFrom = x
      } else if (runFrom >= 0) {
        if (x - runFrom > bestLen) { bestLen = x - runFrom; bestFrom = runFrom }
        runFrom = -1
      }
    }
    if (bestFrom >= 0 && bestLen >= minSpan) {
      lines.push({ y: py, xFrom: bestFrom, xTo: Math.min(w - 1, bestFrom + bestLen) })
    }
  }
  return { lines, strongRowRatio: rs.overallRatio }
}

// ── R468 (F2 §3): MASKA TAL — segmentacija z regijo rasti ──────────────────
// Klasika brez ML: mreža 8-px celic, povprečne barve celic, semena v spodnji
// sredini kadra (kjer so tla skoraj vedno), BFS 4-sosed z barvno toleranco
// glede na TEKAJOČE povprečje regije. Izhod: poligon konture (0..1) + pokritost.

interface FloorMask { maskPoints: ScenePoint[]; coverage: number }

function segmentFloor (data: Uint8ClampedArray, w: number, h: number): FloorMask | null {
  const gw = Math.ceil(w / FLOOR_CELL)
  const gh = Math.ceil(h / FLOOR_CELL)
  if (gw < 4 || gh < 4) return null

  // povprečja celic (r, g, b)
  const cellR = new Float32Array(gw * gh)
  const cellG = new Float32Array(gw * gh)
  const cellB = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let sr = 0; let sg = 0; let sb = 0; let cnt = 0
      const x0 = gx * FLOOR_CELL
      const y0 = gy * FLOOR_CELL
      const x1 = Math.min(w, x0 + FLOOR_CELL)
      const y1 = Math.min(h, y0 + FLOOR_CELL)
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4
          sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; cnt++
        }
      }
      const n = Math.max(1, cnt)
      cellR[gy * gw + gx] = sr / n
      cellG[gy * gw + gx] = sg / n
      cellB[gy * gw + gx] = sb / n
    }
  }

  // semena: zadnja vrstica celic, sredinska polovica širine (tla so spodaj)
  const seedRow = gh - 1
  const seedFrom = Math.floor(gw * 0.25)
  const seedTo = Math.ceil(gw * 0.75)
  const visited = new Uint8Array(gw * gh)
  let sumR = 0; let sumG = 0; let sumB = 0; let count = 0
  const queue: number[] = []
  for (let gx = seedFrom; gx < seedTo; gx++) {
    const idx = seedRow * gw + gx
    queue.push(idx)
    visited[idx] = 1
    sumR += cellR[idx]; sumG += cellG[idx]; sumB += cellB[idx]; count++
  }

  // BFS regija rasti — sprejemljive sosede glede na tekoče povprečje
  const accepted = new Uint8Array(gw * gh)
  for (const s of queue) accepted[s] = 1
  while (queue.length > 0) {
    const idx = queue.shift() as number
    const gx = idx % gw
    const gy = (idx - gx) / gw
    const neighbours = [
      gy > 0 ? idx - gw : -1,
      gy < gh - 1 ? idx + gw : -1,
      gx > 0 ? idx - 1 : -1,
      gx < gw - 1 ? idx + 1 : -1,
    ]
    for (const nb of neighbours) {
      if (nb < 0 || visited[nb] === 1) continue
      visited[nb] = 1
      const r = cellR[nb]; const g = cellG[nb]; const b = cellB[nb]
      const avgR = sumR / count; const avgG = sumG / count; const avgB = sumB / count
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const avgLum = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB
      const dChroma = Math.abs(r - avgR) + Math.abs(g - avgG) + Math.abs(b - avgB)
      if (Math.abs(lum - avgLum) > FLOOR_LUM_TOL || dChroma > FLOOR_CHROMA_TOL) continue
      accepted[nb] = 1
      sumR += r; sumG += g; sumB += b; count++
      queue.push(nb)
    }
  }

  const coverage = count / (gw * gh)
  if (coverage < FLOOR_MIN_COVERAGE) return null

  // kontura: po vrsticah celic leví in desni rob → zaprt poligon
  const rowLeft = new Int32Array(gh).fill(-1)
  const rowRight = new Int32Array(gh).fill(-1)
  let rowTop = -1
  let rowBot = -1
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (accepted[gy * gw + gx] !== 1) continue
      if (rowLeft[gy] < 0) rowLeft[gy] = gx
      rowRight[gy] = gx
      if (rowTop < 0) rowTop = gy
      rowBot = gy
    }
  }
  if (rowTop < 0 || rowBot < rowTop) return null

  const toX = (gx: number): number => Math.max(0, Math.min(1, ((gx + 0.5) * FLOOR_CELL) / w))
  const toY = (gy: number): number => Math.max(0, Math.min(1, ((gy + 0.5) * FLOOR_CELL) / h))

  const pts: ScenePoint[] = []
  // levi rob navzdol
  for (let gy = rowTop; gy <= rowBot; gy++) {
    if (rowLeft[gy] < 0) continue
    pts.push({ x: toX(rowLeft[gy]), y: toY(gy) })
  }
  // dno kadra (regija sega do dna → zapri po spodnji meji)
  if (rowBot >= gh - 1) {
    pts.push({ x: toX(rowRight[rowBot]), y: 1 })
  } else if (rowRight[rowBot] >= 0) {
    pts.push({ x: toX(rowRight[rowBot]), y: toY(rowBot) })
  }
  // desni rob navzgor
  for (let gy = rowBot; gy >= rowTop; gy--) {
    if (rowRight[gy] < 0) continue
    pts.push({ x: toX(rowRight[gy]), y: toY(gy) })
  }
  // zapri po zgornji meji
  if (rowLeft[rowTop] >= 0 && pts.length > 0) {
    pts.push({ x: toX(rowLeft[rowTop]), y: toY(rowTop) })
  }
  if (pts.length < 3) return null

  // decimacija na mejo (≤32 točk) — enakomerni korak
  const maxPts = 32
  let maskPoints = pts
  if (pts.length > maxPts) {
    const stepN = Math.ceil(pts.length / maxPts)
    maskPoints = pts.filter((_, i) => i % stepN === 0)
    if (maskPoints.length < 3) maskPoints = pts.slice(0, maxPts)
  }
  return { maskPoints, coverage }
}

// ── R468 (F2 §3): DOLGE ČRTE — sledenje verticalnega gradienta po stolpcih ──
// Za vsak stolpec najdi y z najmočnejšim vertikalnim Sobelom v pasu; poveži
// sosednje stolpce v črto (skok ≤ 3 px). Črta ≥ 35 % širine = ROB kandidat.
// Kot črte: linearizacija po najmanjših kvadratih; + pomeni desni konec višje
// (y os slike raste navzdol → kot = -atan(naklon y(x))).

interface EdgeLine {
  xFrom: number
  xTo: number
  yTop: number
  yBot: number
  yAvg: number
  span: number // px
  spanRatio: number // delež širine kadra
  angleDeg: number // + = desni konec višje
}

function detectEdgeLines (gray: Float32Array, w: number, h: number): EdgeLine[] {
  const yTop = Math.floor(h * EDGE_SEARCH_TOP)
  const yBot = Math.floor(h * EDGE_SEARCH_BOT)
  const yMax = Math.min(h - 2, yBot)
  const yMin = Math.max(1, yTop)

  // za vsak stolpec: y* z najmočnejšim vertikalnim gradientom (če je dovolj močan)
  const colY = new Int32Array(w).fill(-1)
  for (let x = 1; x < w - 1; x++) {
    let best = -1
    let bestG = SOBEL_THRESHOLD
    for (let y = yMin; y <= yMax; y++) {
      const i = y * w + x
      const gy = Math.abs(-gray[i - w] - 2 * gray[i] - gray[i + w] + 2 * gray[i]) +
        Math.abs(gray[i - w] - gray[i + w])
      if (gy > bestG) { bestG = gy; best = y }
    }
    colY[x] = best
  }

  // poveži stolpce v segmente
  const lines: EdgeLine[] = []
  let segStart = -1
  const flushSeg = (endX: number): void => {
    if (segStart < 0) return
    const span = endX - segStart + 1
    if (span >= Math.floor(w * EDGE_LINE_MIN_SPAN)) {
      let sy = 0; let minY = h; let maxY = 0; let n = 0
      for (let x = segStart; x <= endX; x++) {
        const y = colY[x]
        if (y < 0) continue
        sy += y; n++
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      if (n >= 8) {
        // preprosta regresija y = meanY + b·(x − meanX) → kot črte v kadru
        const meanX = (segStart + endX) / 2
        const meanY = sy / n
        let num = 0; let den = 0
        for (let x = segStart; x <= endX; x++) {
          const y = colY[x]
          if (y < 0) continue
          num += (x - meanX) * (y - meanY)
          den += (x - meanX) * (x - meanX)
        }
        const b = den > 0 ? num / den : 0
        const angleRad = -Math.atan(b) // + = desni višje (y raste dol)
        const deg = Math.round((angleRad * 180 / Math.PI) * 10) / 10
        lines.push({
          xFrom: segStart, xTo: endX,
          yTop: Math.max(0, minY - 2), yBot: Math.min(h - 1, maxY + 2),
          yAvg: meanY, span, spanRatio: span / w,
          angleDeg: Math.max(-90, Math.min(90, deg)),
        })
      }
    }
    segStart = -1
  }
  for (let x = 1; x < w - 1; x++) {
    const y = colY[x]
    if (y < 0) { flushSeg(x - 1); continue }
    if (segStart < 0) { segStart = x; continue }
    const prev = colY[x - 1]
    if (prev < 0 || Math.abs(y - prev) > EDGE_LINE_MAX_STEP) {
      flushSeg(x - 1)
      segStart = x
    }
  }
  flushSeg(w - 2)

  // najdaljše prve; izloči črte, ki se močno prekrivajo (isti rob, dva kandidata)
  lines.sort((a, b) => b.span - a.span)
  const out: EdgeLine[] = []
  for (const l of lines) {
    const dup = out.some((o) => {
      const xOverlap = Math.min(o.xTo, l.xTo) - Math.max(o.xFrom, l.xFrom)
      const yOverlap = Math.min(o.yBot, l.yBot) - Math.max(o.yTop, l.yTop)
      return xOverlap > 0 && yOverlap > 0 && xOverlap > 0.5 * Math.min(o.span, l.span)
    })
    if (!dup) out.push(l)
    if (out.length >= EDGE_LINE_MAX_COUNT + 2) break
  }
  return out
}

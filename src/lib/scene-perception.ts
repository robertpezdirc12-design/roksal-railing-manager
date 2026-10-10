// R467 (issue #8 — SMART VISION, Faza 1): ŽIVA PERCEPCIJA PRIZORA (odjemalec).
// DOM/canvas plast nad scene-understanding-core (čista logika): poganja
// nizkofrekvenčno analizo kadrov iz <video> in vrača SceneElement[].
//
// FAZA 1 BREZ ML: vse hevristike so klasične računalniškovidezne osnove
// (svetlost, Laplace, Sobel robovi, razlika sličic za gibanje, barvne
// značilnosti podlage). NISO merilne — rezultat je PREDLOG, ki ga monter
// potrdi ali popravi (core načelo: avtomatika ni avtoriteta).
//
// Zmogljivost: canvas ≤ 320 px, interval privzeto 250 ms (~4 Hz), izklop ob
// document.hidden — namenjeno telefonom brez pregrevanja (issue §10).

import {
  classifySurface, newSceneId, stabilizeElements,
  type SceneElement, type SurfaceFeatures,
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
  onFrame: (frame: PerceptionFrame) => void
}

const SOBEL_THRESHOLD = 52 // jakost roba na 0..255 sivinah
const MOTION_PIXEL_THRESHOLD = 26 // |Δsivina| za "piksel se je spremenil"
const MOTION_RATIO_MIN = 0.008 // ≥ 0,8 % spremenjenih pikslov = gibanje
const HLINE_STRONG = 0.16 // delež močnih vodoravnih robov v vrstici = "črta"
const MIN_ROW_PEAKS_FOR_STAIRS = 3

/**
 * Zažene živo percepcijo nad <video>. Vrne stop(). Varno: ob napaki zanka
 * utihne, kamera ostane pri uporabniku — zajem nikoli ni odvisen od percepcije.
 */
export function startSceneLoop (video: HTMLVideoElement, opts: SceneLoopOptions): () => void {
  const intervalMs = Math.max(120, opts.intervalMs ?? 250)
  const workWidth = Math.min(640, Math.max(160, opts.workWidth ?? 320))
  const onFrame = opts.onFrame

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let prevGray: Float32Array | null = null
  let prevW = 0
  let prevElements: SceneElement[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let running = true

  function tick (): void {
    if (!running) return
    if (document.hidden || !ctx || video.videoWidth === 0) return
    try {
      const w = workWidth
      const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w)) || 1
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      ctx.drawImage(video, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data

      // sivine + kakovost (isti vzorec kot meritve-kamera — advisory)
      const gray = new Float32Array(w * h)
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

      const hasPrev = prevGray != null && prevW === w
      const raw = analyzeFrame(data, gray, w, h, hasPrev ? prevGray : null)
      prevGray = gray
      prevW = w

      // stabilizacija: isti element obdrži ID med sličicami (oznake ne skačejo)
      const elements = stabilizeElements(prevElements, raw, { iouMin: 0.25, maxMisses: 1 })
      prevElements = elements
      onFrame({ elements, quality })
    } catch {
      // tiho — percepcija je dodatek; zajem mora vedno delovati (issue §7)
    }
  }

  timer = setInterval(tick, intervalMs)
  tick()

  return () => {
    running = false
    if (timer != null) clearInterval(timer)
    prevGray = null
  }
}

/** Analiza ene sličice → novi elementi (brez stabilizacije). */
function analyzeFrame (data: Uint8ClampedArray, gray: Float32Array, w: number, h: number, prevGray: Float32Array | null): SceneElement[] {
  const at = Date.now()
  const elements: SceneElement[] = []

  // ── PODLAGA: barvne/teksturne značilnice spodnje tretjine ──────────────────
  const y0 = Math.floor(h * 2 / 3)
  let surface = computeSurfaceFeatures(data, w, y0, h)
  surface = withEdgeDensity(surface, gray, w, y0, h)
  const verdict = classifySurface(surface)
  elements.push({
    id: newSceneId(),
    cls: 'PODLAGA',
    status: verdict.confidence >= 0.55 ? 'PREPOZNANO' : verdict.confidence >= 0.4 ? 'VERJETNO' : 'NEJASNO',
    source: 'LOKALNO',
    confidence: verdict.confidence,
    bbox: [0, 2 / 3, 1, 1 / 3],
    kind: verdict.kind,
    at,
  })

  // ── GIBANJE: razlika sličic → OVIRA (hevristika NE razlikuje osebe od
  //    predmeta — ne trdi "oseba", če tega ne zmore; issue §5) ────────────────
  if (prevGray) {
    const motion = motionBox(gray, prevGray, w, h)
    if (motion) {
      elements.push({
        id: newSceneId(),
        cls: 'OVIRA',
        status: 'VERJETNO',
        source: 'LOKALNO',
        confidence: 0.35,
        bbox: motion,
        at,
      })
    }
  }

  // ── STRUKTURA v srednjem pasu: vodoravni robovi → stopnice/ograja ──────────
  const yTop = Math.floor(h * 0.28)
  const yBot = Math.floor(h * 0.68)
  const rs = horizontalRowStrength(gray, w, h, yTop, yBot)
  const peaks = rowPeaks(rs, h, yTop)
  if (peaks.length >= MIN_ROW_PEAKS_FOR_STAIRS) {
    const first = peaks[0]; const last = peaks[peaks.length - 1]
    elements.push({
      id: newSceneId(),
      cls: 'STOPNICA',
      status: 'NEJASNO',
      source: 'LOKALNO',
      confidence: 0.3,
      bbox: [0.05, first / h, 0.9, Math.max(0.06, (last - first) / h + 0.06)],
      at,
    })
  } else if (peaks.length >= 1 && rs.overallRatio > HLINE_STRONG) {
    const p = peaks[0]
    elements.push({
      id: newSceneId(),
      cls: 'OGRAJA',
      status: 'NEJASNO',
      source: 'LOKALNO',
      confidence: 0.25,
      bbox: [0.05, Math.max(0, p / h - 0.06), 0.9, 0.14],
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

/** Doda edgeDensity (delež močnih Sobel robov) obstoječim značilnicam pasu. */
function withEdgeDensity (f: SurfaceFeatures, gray: Float32Array, w: number, yFrom: number, yTo: number): SurfaceFeatures {
  let strong = 0
  let total = 0
  const yMax = Math.min(yTo, Math.floor(gray.length / Math.max(1, w)) - 1)
  for (let y = Math.max(1, yFrom); y < yMax; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = Math.abs(-gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1])
      const gy = Math.abs(-gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1])
      if (Math.max(gx, gy) > SOBEL_THRESHOLD) strong++
      total++
    }
  }
  return { ...f, edgeDensity: total > 0 ? strong / total : 0 }
}

/** Box največjega območja sprememb med sličicami (0..1) ali null. */
function motionBox (gray: Float32Array, prev: Float32Array, w: number, h: number): [number, number, number, number] | null {
  const cell = 8 // groba mreža 8-px celic — dovolj za bbox ovire
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
  if (changed / (w * h) < MOTION_RATIO_MIN) return null
  let minX = gw; let minY = gh; let maxX = -1; let maxY = -1
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!hit[gy * gw + gx]) continue
      if (gx < minX) minX = gx
      if (gy < minY) minY = gy
      if (gx > maxX) maxX = gx
      if (gy > maxY) maxY = gy
    }
  }
  if (maxX < 0) return null
  return [
    (minX * cell) / w,
    (minY * cell) / h,
    Math.min(1, ((maxX - minX + 1) * cell) / w),
    Math.min(1, ((maxY - minY + 1) * cell) / h),
  ]
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

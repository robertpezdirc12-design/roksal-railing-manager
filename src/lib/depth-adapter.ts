// R471 (issue #8 — Faza 4 „Senzorji“, §11): ARCORE DEPTH / WEBXR ADAPTER.
//
// Spletna pot do senzorja globine na Androidu je WebXR depth-sensing
// (immersive-ar + funkcija 'depth-sensing'; Chrome jo poganja prek ARCore).
// iOS Safari WebXR-AR NE podpira → tam adapter NI PODPRT in monter pade
// nazaj na obstoječi poti (referenčna skala / ročni vnos) — to je izrecna
// odločitev issue §0: „napredne zmožnosti se smejo prikazati samo, kadar
// jih naprava dejansko podpira“. Native iOS adapter NI dodan („po potrebi“
// iz §11 — potrebe zaenkrat ni, ker ima ROKSAL za iOS celo pot mer z
// referenco).
//
// Arhitektura (poštenost §5/§6):
//   • ČISTA matematika (unproject, razdalje, manifest) je v
//     scene-understanding-core.ts — enako testirljiva kot ostalo jedro.
//   • TA datoteka je TANKA DOM/WebXR plast: zaznava podpore, vodi sejo in
//     vzorči globino na dveh tapov (select dogodki). Vsak korak ima
//     razložljivo napako; ob naporu seje merjenje vrne {ok:false, reason}
//     in živi zajem ostane pri monterju (issue §7: zajem nikoli ne odvisen
//     od percepcije/senzorjev).
//
// POTEK MERE (dva tapa v AR seji — vsak pri SVOJI pozi kamere):
//   1. select dogodek da žarek tapa (targetRaySpace) → poza v prostoru
//      reference; pretvorimo v PROSTOR KAMERE (view.transform.inverse),
//      iz smeri žarka izračunamo slikovno točko (u, v).
//   2. frame.getDepthInformation(view) → getDepthInMeters(u, v) → globina.
//      Neveljavna globina (0 / > 8 m / izven meja) → tap SE NE ŠTEJE
//      (monter usmerja naprej; ni tihih ugibanj).
//   3. Točko unprojectamo v prostor kamere in pretvorimo v SKUPNI prostor
//      (view.transform.matrix) — tako je razdalja čez dve pozi PRAVILNA.
//   4. Po drugem tapu: razdalja med svetovnima točkama → cm; manifest
//      (ponudnik, format, ločljivost, skala, fokus, čas) gre z mero.
//
// Zmogljivost: seja teče samo med aktivno mero (max 60 s), brez stalnega
// vzorčenja; globina se bere ob tapu (cpu-optimized), ne na vsakem kadru.

import {
  isDepthManifest, pointsDistanceCm, unprojectDepthSample,
  type DepthManifest, type DepthPoint3, type DepthSample,
} from '@/lib/scene-understanding-core'

// ── Minimalni WebXR vmesti (brez @types/webxr odvisnosti) ────────────────────
// TypeScript DOM knjižnica ne vsebuje WebXR tipov; mi deklariramo samo
// površino, ki jo uporabljamo, in jo dosežemo prek varnih pretvorb `unknown`.

interface XRDepthInformationLike {
  readonly width: number
  readonly height: number
  readonly dataFormat: string
  readonly rawValueToMeters: number
  getDepthInMeters (x: number, y: number): number
}

interface XRViewLike {
  readonly transform: { readonly matrix: Float32Array; readonly inverse: { readonly matrix: Float32Array } }
  readonly projectionMatrix: Float32Array
}

interface XRViewerPoseLike { readonly views: ReadonlyArray<XRViewLike> }

interface XRFrameLike {
  getViewerPose (space: unknown): XRViewerPoseLike | undefined
  getDepthInformation (view: XRViewLike): XRDepthInformationLike | undefined
  getPose (space: unknown, baseSpace: unknown): { readonly transform: { readonly position: { x: number; y: number; z: number }; readonly orientation: { x: number; y: number; z: number; w: number } } } | undefined
}

interface XRRayPoseLike {
  readonly position: { x: number; y: number; z: number }
  readonly orientation: { x: number; y: number; z: number; w: number }
}

interface XRSessionLike {
  readonly renderState: { readonly baseLayer: unknown }
  requestReferenceSpace (type: string): Promise<unknown>
  updateRenderState (state: Record<string, unknown>): void
  requestAnimationFrame (cb: (time: number, frame: XRFrameLike) => void): number
  end (): Promise<void>
  addEventListener (type: 'select', listener: (ev: { readonly frame: XRFrameLike; readonly inputSource: { readonly targetRaySpace: unknown } }) => void): void
  addEventListener (type: 'end', listener: () => void): void
  addEventListener (type: string, listener: () => void): void
}

interface XRNavigatorLike { xr?: { isSessionSupported (mode: string): Promise<boolean>; requestSession (mode: string, opts?: Record<string, unknown>): Promise<XRSessionLike> } }

// ── Zaznavanje podpore ───────────────────────────────────────────────────────

export interface DepthSupportInfo {
  supported: boolean
  /** 'WEBXR_DEPTH' ali null, če globina ni podprta. */
  provider: 'WEBXR_DEPTH' | null
  /** Slovenski razlog — izpiše se v UI (poštenost: zakaj ne). */
  reason: string
}

/**
 * Preveri, ali naprava/brskalnik podpira WebXR immersive-ar (predpogoj
 * za depth-sensing; dejansko globino potrdi še seja). Ne meče — vedno vrne
 * razlago. PURE ASNK brez stranskih učinkov (samo poizvedba).
 */
export async function detectDepthSupport (): Promise<DepthSupportInfo> {
  try {
    const nav = navigator as unknown as XRNavigatorLike
    if (!nav.xr) {
      return { supported: false, provider: null, reason: 'WebXR ni na voljo v tem brskalniku — merite z referenco ali ročno.' }
    }
    const ok = await nav.xr.isSessionSupported('immersive-ar')
    if (!ok) {
      return { supported: false, provider: null, reason: 'Naprava ne podpira AR seje (WebXR immersive-ar) — iOS Safari: uporabite referenco.' }
    }
    // Podpora globine se dokončno potrdi šele ob zahtevi seje (funkcija
    // 'depth-sensing' je optional-feature) — tu je naša najboljša ocena.
    return { supported: true, provider: 'WEBXR_DEPTH', reason: 'AR globina prek WebXR/ARCore — izmerite z dvema tapoma v AR pogledu.' }
  } catch {
    return { supported: false, provider: null, reason: 'Podpore za AR globino ni bilo mogoče preveriti — merite z referenco.' }
  }
}

// ── Seja z dvema tapoma ─────────────────────────────────────────────────────

/** Točka mere v skupnem (referenčnem) prostoru + zapis izvora. */
export interface DepthTapPoint {
  world: DepthPoint3
  sample: DepthSample
  manifest: DepthManifest
}

export type DepthMeasureResult =
  | { ok: true; distanceCm: number; taps: [DepthTapPoint, DepthTapPoint]; manifest: DepthManifest }
  | { ok: false; reason: string }

export interface DepthMeasureOptions {
  /** Najdaljši čas seje v ms (privzeto 60 000). */
  timeoutMs?: number
  /** Klic ob vsakem uspešnem tapu (odziv UI: „1/2“ …). */
  onTap?: (count: number) => void
}

/**
 * Zažene AR sejo z globino in čaka DVA select (tap) dogodka. Vrne
 * nadzorno funkcijo stop() (obljubi se takoj; seja teče v ozadju). Ko je
 * mera končana (ali spodleti), se pokliče onResult ENKRAT in seja se konča.
 *
 * POŠTENOST: tap se šteje SAMO z veljavno globino v sliki; ob napaki se
 * vrne {ok:false, reason} — nikoli ne ugibamo mere.
 */
export function startDepthMeasurement (
  onResult: (result: DepthMeasureResult) => void,
  opts?: DepthMeasureOptions,
): Promise<() => void> {
  const timeoutMs = Math.max(10000, Math.min(120000, opts?.timeoutMs ?? 60000))
  const onTap = typeof opts?.onTap === 'function' ? opts.onTap : null

  return (async () => {
    const nav = navigator as unknown as XRNavigatorLike
    if (!nav.xr) {
      onResult({ ok: false, reason: 'WebXR ni na voljo v tem brskalniku.' })
      return () => {}
    }

    let session: XRSessionLike
    try {
      // depth-sensing je optional feature: seja se odpre tudi brez njega,
      // getDepthInformation pa vrne undefined → tap se ne bo štel →
      // po timeoutu iskrena napaka (enako sporočilo kot zavrnitev).
      session = await nav.xr.requestSession('immersive-ar', {
        optionalFeatures: ['depth-sensing', 'local-floor'],
        depthSensing: { usagePreference: 'cpu-optimized', dataFormatPreference: 'luminance-alpha' },
      })
    } catch {
      onResult({ ok: false, reason: 'AR seja ni bila odobrena ali globina ni podprta — merite z referenco ali ročno.' })
      return () => {}
    }

    let finished = false
    let rafId = 0
    const taps: DepthTapPoint[] = []
    let latestFrame: XRFrameLike | null = null
    let latestView: XRViewLike | null = null

    const finish = (result: DepthMeasureResult): void => {
      if (finished) return
      finished = true
      try { void session.end().catch(() => {}) } catch { /* že končana */ }
      onResult(result)
    }

    // Glavni rAF: ohranja sejo živo (WebXR zahteva prikazovalno zanko).
    // Brez XRWebGLLayer bi lahko bile slike prazne — naredimo tanko plast,
    // ki samo čisti zaslon (prehod kamere skrbi sestavljavnik Chrome-a).
    try {
      const canvas = document.createElement('canvas')
      const gl = (canvas.getContext('webgl2', { alpha: true, xrCompatible: true }) ??
        canvas.getContext('webgl', { alpha: true, xrCompatible: true })) as WebGLRenderingContext | null
      if (gl) {
        const LayerCtor = (window as unknown as { XRWebGLLayer?: new (s: XRSessionLike, c: WebGLRenderingContext) => unknown }).XRWebGLLayer
        if (LayerCtor) {
          session.updateRenderState({ baseLayer: new LayerCtor(session, gl) })
        }
      }
    } catch { /* brez plasti se poskus nadaljuje; če slika ne bo, bo uporabnik prekinil */ }

    let refSpace: unknown
    try {
      refSpace = await session.requestReferenceSpace('local')
    } catch {
      finish({ ok: false, reason: 'Prostora reference ni bilo mogoče vzpostaviti.' })
      return () => { try { void session.end() } catch { /* n/a */ } }
    }

    const timeout = setTimeout(() => {
      finish({ ok: false, reason: 'Čas za meritev je potekel (1 min) — poskusite znova ali merite z referenco.' })
    }, timeoutMs)

    session.addEventListener('end', () => {
      clearTimeout(timeout)
      if (!finished) {
        finish({ ok: false, reason: 'AR seja je bila prekinjena pred končano mero — poskusite znova ali merite z referenco.' })
      }
    })

    session.addEventListener('select', (ev) => {
      if (finished || latestFrame == null || latestView == null || refSpace == null) return
      const frame = ev.frame
      const pose = frame.getPose(ev.inputSource.targetRaySpace, refSpace)
      if (!pose) return

      // 1) žarek tapa → prostor kamere (view.transform.inverse)
      const viewInv = latestView.transform.inverse.matrix
      const ray = transformRay(viewInv, pose.transform.position, pose.transform.orientation)
      if (ray == null) return

      // 2) smer žarka → slikovna točka (u, v) — kamera gleda −z
      if (!(ray.dir.z < -1e-6)) return
      const depthInfo = frame.getDepthInformation(latestView)
      if (!depthInfo) return
      const fx = focalPxFromProjection(latestView.projectionMatrix, depthInfo.width)
      if (!(fx > 0)) return
      const cx = depthInfo.width / 2
      const cy = depthInfo.height / 2
      const px = cx + (fx * ray.dir.x) / -ray.dir.z
      const py = cy + (fx * ray.dir.y) / -ray.dir.z
      const u = px / depthInfo.width
      const v = py / depthInfo.height
      if (u < 0 || u > 1 || v < 0 || v > 1) return

      // 3) globina na točki — neveljavna → tap se NE šteje (brez ugibanj)
      const depthM = depthInfo.getDepthInMeters(u, v)
      if (typeof depthM !== 'number' || !Number.isFinite(depthM) || depthM <= 0) return

      const manifest = isDepthManifest({
        provider: 'WEBXR_DEPTH',
        depthFormat: String(depthInfo.dataFormat || 'luminance-alpha').slice(0, 32),
        rawValueToMeters: depthInfo.rawValueToMeters > 0 ? depthInfo.rawValueToMeters : 1,
        width: depthInfo.width,
        height: depthInfo.height,
        focalPx: fx,
        timestamp: Date.now(),
      })
      if (!manifest) return

      // 4) unproject v prostor kamere → svetovna toča (skupni prostor)
      const viewPoint = unprojectDepthSample({ u, v, depthM }, manifest)
      if (!viewPoint) return
      const world = multiplyPoint(latestView.transform.matrix, viewPoint)
      if (!world) return

      taps.push({ world, sample: { u, v, depthM }, manifest })
      if (onTap) onTap(taps.length)

      if (taps.length >= 2) {
        const distanceCm = pointsDistanceCm(taps[0].world, taps[1].world)
        clearTimeout(timeout)
        if (distanceCm == null) {
          finish({ ok: false, reason: 'Globina na izbranih točkah ni bila uporabna (preblizu/preveč odročno) — poskusite znova.' })
        } else {
          finish({ ok: true, distanceCm, taps: [taps[0], taps[1]], manifest: taps[1].manifest })
        }
      }
    })

    const loop = (time: number, frame: XRFrameLike): void => {
      if (finished) return
      const pose = frame.getViewerPose(refSpace)
      if (pose && pose.views.length > 0) {
        latestFrame = frame
        latestView = pose.views[0]
      }
      // čist prikaz (brez vsebine) — prehod kamere riše sestavljavnik
      try {
        const gl = sessionRenderContext(session)
        if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
      } catch { /* prikaz ni merilen — ignoriramo */ }
      rafId = session.requestAnimationFrame(loop)
    }
    rafId = session.requestAnimationFrame(loop)

    return () => {
      clearTimeout(timeout)
      finished = true
      try { void session.end().catch(() => {}) } catch { /* n/a */ }
    }
  })()
}

// ── Pomožne (čiste) funkcije ────────────────────────────────────────────────

/** Goriščna razdalja (px) iz projekcijske matrike pogleda: fx = p[0]·w/2. */
export function focalPxFromProjection (proj: Float32Array | number[], depthWidth: number): number {
  if (!proj || proj.length < 1) return 0
  const fx = Math.abs(proj[0]) * (depthWidth / 2)
  return Number.isFinite(fx) && fx > 0 ? fx : 0
}

/** Pretvorba točke z matriko 4×4 (stolpčni red, homogena delitev). */
export function multiplyPoint (m: Float32Array | number[], p: DepthPoint3): DepthPoint3 | null {
  if (!m || m.length < 16) return null
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]
  const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15]
  if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null
  return { x: x / w, y: y / w, z: z / w }
}

/**
 * Žarek (izvor + smer iz kvaterniona) v novem prostoru po matriki 4×4.
 * Smer iz kvaterniona: rotacija vektorja (0,0,−1) — WebXR kamere gledajo −z.
 */
export function transformRay (
  m: Float32Array | number[], position: { x: number; y: number; z: number }, orientation: { x: number; y: number; z: number; w: number },
): { origin: DepthPoint3; dir: { x: number; y: number; z: number } } | null {
  if (!m || m.length < 16) return null
  const { x: qx, y: qy, z: qz, w: qw } = orientation
  if (![qx, qy, qz, qw].every((n) => Number.isFinite(n))) return null
  // rotacija (0,0,−1) s kvaternionom (q*v*q^-1, v kot vektor)
  const vx = 0, vy = 0, vz = -1
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  const dir = {
    x: vx + qw * tx + (qy * tz - qz * ty),
    y: vy + qw * ty + (qz * tx - qx * tz),
    z: vz + qw * tz + (qx * ty - qy * tx),
  }
  const origin = multiplyPoint(m, position)
  if (origin == null) return null
  // smer rotiramo z zgornjim levim 3×3 delom matrike
  const d = {
    x: m[0] * dir.x + m[4] * dir.y + m[8] * dir.z,
    y: m[1] * dir.x + m[5] * dir.y + m[9] * dir.z,
    z: m[2] * dir.x + m[6] * dir.y + m[10] * dir.z,
  }
  return { origin, dir: d }
}

function sessionRenderContext (session: XRSessionLike): WebGLRenderingContext | null {
  try {
    const layer = session.renderState.baseLayer as { context?: WebGLRenderingContext } | null | undefined
    return layer?.context ?? null
  } catch {
    return null
  }
}

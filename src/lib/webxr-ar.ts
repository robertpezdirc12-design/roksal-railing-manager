// webxr-ar — WebXR Device API za AR na Androidu (Chrome)
// Safari na iOS NE podpira WebXR AR (od septembra 2026).
// Fallback: kamera + ročna kalibracija (deluje povsod).
//
// Uporaba:
//   if (isWebXRSupported()) { await startARSession() } else { fallbackToCamera() }

export type ARState = 'unsupported' | 'checking' | 'ready' | 'active' | 'error'

export interface ARCapabilities {
  hitTest: boolean
  depthSensing: boolean
  planeDetection: boolean
  lightingEstimation: boolean
  anchors: boolean
}

export function isWebXRSupported(): boolean {
  return typeof navigator !== 'undefined' && 'xr' in navigator
}

export async function checkARSupport(): Promise<boolean> {
  if (!isWebXRSupported()) return false
  try {
    return await (navigator as any).xr.isSessionSupported('immersive-ar')
  } catch {
    return false
  }
}

export async function getARCapabilities(): Promise<ARCapabilities> {
  const supported = await checkARSupport()
  if (!supported) {
    return { hitTest: false, depthSensing: false, planeDetection: false, lightingEstimation: false, anchors: false }
  }
  // WebXR feature detection
  return {
    hitTest: true, // shipped in Chrome
    depthSensing: true, // shipped in Chrome
    planeDetection: false, // developer trial
    lightingEstimation: true, // shipped
    anchors: true, // shipped
  }
}

export async function startARSession(
  onFrame: (frame: XRFrame, session: XRSession) => void,
  onError: (error: string) => void
): Promise<XRSession | null> {
  if (!await checkARSupport()) {
    onError('WebXR AR ni podprt na tej napravi/brskalniku.')
    return null
  }
  try {
    const session = await (navigator as any).xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['depth-sensing', 'light-estimation', 'anchors'],
    })
    const gl = (session as any).gl || null
    const onXRFrame = (time: number, frame: XRFrame) => {
      onFrame(frame, session)
      session.requestAnimationFrame(onXRFrame)
    }
    session.requestAnimationFrame(onXRFrame)
    return session
  } catch (err) {
    onError(`AR seja ni uspela: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

export function getPlatform(): 'android' | 'ios' | 'desktop' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent.toLowerCase()
  if (/android/.test(ua)) return 'android'
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/windows|macintosh|linux/.test(ua)) return 'desktop'
  return 'unknown'
}

export function getAREnhancementLevel(): 'full' | 'partial' | 'none' {
  const platform = getPlatform()
  if (platform === 'android') return 'full' // WebXR AR v Chrome
  if (platform === 'ios') return 'none' // Safari ne podpira WebXR AR
  return 'none'
}

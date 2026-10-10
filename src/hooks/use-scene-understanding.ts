'use client'

// useSceneUnderstanding — R467 (issue #8 Faza 1): poveže <video> z živo
// percepcijo (scene-perception) in stanje izpostavi komponenti. Izklop ob
// !enabled (npr. demo ozadje) in ob unmountu. Zanka je dodatek — če
// percepcija kdaj utihne, kamera in zajem delujeta naprej (issue §7).

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { startSceneLoop, type PerceptionQuality } from '@/lib/scene-perception'
import type { SceneElement } from '@/lib/scene-understanding-core'

export interface SceneUnderstandingState {
  elements: SceneElement[]
  quality: PerceptionQuality | null
  /** števec zaznanih sličic — za indikator živosti. */
  frames: number
}

export function useSceneUnderstanding (
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  intervalMs = 250,
): SceneUnderstandingState {
  const [state, setState] = useState<SceneUnderstandingState>({ elements: [], quality: null, frames: 0 })
  const framesRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const video = videoRef.current
    if (!video) return

    let lastPush = 0
    const stop = startSceneLoop(video, {
      intervalMs,
      onFrame: ({ elements, quality }) => {
        framesRef.current += 1
        // potisni v React največ 2× na sekundo (HUD se ne trese s 4 Hz)
        const now = Date.now()
        if (now - lastPush < 500) return
        lastPush = now
        setState({ elements, quality, frames: framesRef.current })
      },
    })
    return () => {
      stop()
      setState({ elements: [], quality: null, frames: 0 })
    }
  }, [enabled, intervalMs, videoRef])

  return state
}

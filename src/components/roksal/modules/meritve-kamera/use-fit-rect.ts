'use client'

// use-fit-rect — R570: pravokotnik PRIKAZANE vsebine videa znotraj njegovega
// elementa (object-fit matematika: contain → Letterbox, cover → obrez).
// Nosilci overlayjev (SceneOverlay, točka ostrenja) postavijo svoj koordinatni
// prostor na ta pravokutnik, da zaznave in ostrenje stojijo na realnih mestih
// tudi, kadar element ni istega razmerja kot kader (širok zaslon + max višina
// pri contain; celozaslonski cover z obrezom — vzorec nativnih kamer).
//
// Čista funkcija (izvožena za teste) + hook, ki sledi spremembam:
// ResizeObserver na vsebniku (sprememba postavitve / celozaslonski preklop),
// dogodku `resize` na <video> (sprememba videoWidth/videoHeight, npr. preklop
// objektiva), loadedmetadata ter pre orientacijo naprave.

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface FitRect { x: number; y: number; w: number; h: number }

/**
 * R570: kje se kader (cw×ch) dejansko prikaže znotraj elementa (bw×bh) pri
 * danem object-fit. Enaka skala kot CSS: contain = min, cover = max.
 * Vrača null, kadar katerekoli dimenzije še niso znane (kadar/element še ni
 * zagnan) — nosilec tedaj pade na sedanje obnašanje (cel element).
 */
export function izracunajFitRect (
  bw: number, bh: number, cw: number, ch: number, fit: 'contain' | 'cover',
): FitRect | null {
  if (bw <= 0 || bh <= 0 || cw <= 0 || ch <= 0) return null
  const s = fit === 'cover' ? Math.max(bw / cw, bh / ch) : Math.min(bw / cw, bh / ch)
  const w = cw * s
  const h = ch * s
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h }
}

/** R570: živi pravokutnik prikazane vsebine (px znotraj vsebnika). */
export function useFitRect (
  videoRef: RefObject<HTMLVideoElement | null>,
  containerRef: RefObject<HTMLElement | null>,
  fit: 'contain' | 'cover',
): FitRect | null {
  const [rect, setRect] = useState<FitRect | null>(null)

  useEffect(() => {
    const video = videoRef.current
    const container = containerRef.current
    if (!video || !container) return

    const compute = () => {
      const naslednji = izracunajFitRect(container.clientWidth, container.clientHeight, video.videoWidth, video.videoHeight, fit)
      setRect((prejsnji) => {
        if (naslednji === null) return prejsnji === null ? null : naslednji
        if (prejsnji === null) return naslednji
        // R570: brez odvečnih rerenderjev — številske spremembe pod 0,5 px
        // (zaokrožitve ResizeObserverja) niso sprememba.
        const blizu = (a: number, b: number) => Math.abs(a - b) < 0.5
        if (blizu(prejsnji.x, naslednji.x) && blizu(prejsnji.y, naslednji.y) && blizu(prejsnji.w, naslednji.w) && blizu(prejsnji.h, naslednji.h)) return prejsnji
        return naslednji
      })
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(container)
    video.addEventListener('loadedmetadata', compute)
    video.addEventListener('resize', compute)
    window.addEventListener('orientationchange', compute)
    return () => {
      ro.disconnect()
      video.removeEventListener('loadedmetadata', compute)
      video.removeEventListener('resize', compute)
      window.removeEventListener('orientationchange', compute)
    }
  }, [videoRef, containerRef, fit])

  return rect
}

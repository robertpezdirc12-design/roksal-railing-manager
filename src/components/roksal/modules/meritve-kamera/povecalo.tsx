'use client'

// MERITVE S KAMERO — povečevalno steklo med vlečenjem točk (R455 §4).
// R537-a: selitev iz meritve-kamera.tsx (faza MERITEV); `lens`/`view`/
// `imgBoxRef` prejme prek propsov (lastnik stanja je vstopna komponenta).

import type { RefObject } from 'react'
import type { LensState, View } from './tipi'

/** R455: povečevalno steklo med vlečenjem (§4). */
export function Povecalo ({ lens, view, imgBoxRef }: {
  lens: LensState | null
  view: View
  imgBoxRef: RefObject<HTMLDivElement | null>
}) {
  if (!lens || !view) return null
  return (
    <div
      className="pointer-events-none fixed z-50 size-28 rounded-full border-2 border-amber-500 bg-cover shadow-xl"
      aria-hidden
      style={{
        left: `${Math.min(window.innerWidth - 120, lens.x + 24)}px`,
        top: `${Math.max(8, lens.y - 130)}px`,
        backgroundImage: `url(${view.dataUrl})`,
        // R537-ac-verify: branje imgBox MED RENDERJEM je dobesedna selitev R455
        // (§4) iz meritve-kamera.tsx:2486–2487 — povečalo se riše samo ob aktivnem
        // vlečenju (lens != null), zato so geometrijska branja sveža ob vsakem
        // premiku kazalca. Prestavitev v efekt bi spremenilo obnašanje (zastarela
        // geometrija za en frame) — zavestno ohranjeno (tehnični dolg R497).
        // eslint-disable-next-line react-hooks/refs
        backgroundSize: `${(imgBoxRef.current?.clientWidth ?? 300) * 3}px auto`,
        // eslint-disable-next-line react-hooks/refs
        backgroundPosition: `${lens.x - (imgBoxRef.current?.getBoundingClientRect().left ?? 0) - 48}px ${lens.y - (imgBoxRef.current?.getBoundingClientRect().top ?? 0) - 48}px`,
      }}
    >
      <span className="absolute inset-0 m-auto size-5 rounded-full border border-amber-600/70" />
    </div>
  )
}

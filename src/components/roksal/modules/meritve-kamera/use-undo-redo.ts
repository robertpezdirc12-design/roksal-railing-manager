'use client'

// MERITVE S KAMERO — undo/redo celotnega urejanja (R455 §4). Sklad
// (past/future + histTick rerender) je izključna last tega hooka;
// `views`/`activeView` in njuna setterja prejme kot argumente, ker sta
// lastništvo vstopne komponente (stanje, ki si ga delijo faze).
// R537-a: selitev iz meritve-kamera.tsx (izhodiščne glave ostajajo ob kodi).

import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { View, ZgodovinaVnos } from './tipi'

export function useUndoRedo ({ views, setViews, activeView, setActiveView }: {
  views: View[]
  setViews: Dispatch<SetStateAction<View[]>>
  activeView: number
  setActiveView: Dispatch<SetStateAction<number>>
}) {
  // R455: undo/redo (§4) — posnetki {views, activeView}
  const past = useRef<ZgodovinaVnos[]>([])
  const future = useRef<ZgodovinaVnos[]>([])
  const [histTick, setHistTick] = useState(0) // rerender za omogočanje gumbov

  // ── R455: undo/redo pomočniki ──
  function snapshot (): void {
    past.current.push({ views: structuredClone(views), activeView })
    if (past.current.length > 50) past.current.shift()
    future.current = []
    setHistTick((t) => t + 1)
  }
  function undo (): void {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push({ views: structuredClone(views), activeView })
    setViews(prev.views); setActiveView(Math.min(prev.activeView, prev.views.length - 1))
    setHistTick((t) => t + 1)
  }
  function redo (): void {
    const next = future.current.pop()
    if (!next) return
    past.current.push({ views: structuredClone(views), activeView })
    setViews(next.views); setActiveView(next.activeView)
    setHistTick((t) => t + 1)
  }
  void histTick

  return { past, future, snapshot, undo, redo, setHistTick }
}

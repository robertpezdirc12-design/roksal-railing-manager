'use client'

// stabilizacija.ts — R465 (issue #4 §1): vlečenje overlayja z nizkofrekvenčnim
// glajenjem (rAF low-pass) + zaklep položaja (R537-b: dobesedna selitev iz
// ar.tsx). Zaklep prihaja kot argument — stanje ostaja v vstopni komponenti,
// ker ga berejo tudi kartice (povlek je izklopljen, dokler je zaklenjen).
// Guverner percepcije (R471 core) ŽIVI v use-scene-understanding (izven
// tega modula) — tukaj je samo stabilizacija povleka overlayja.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export function useArStabilizacija ({ locked }: { locked: boolean }): {
  pos: { x: number; y: number }
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: () => void
} {
  const [pos, setPos] = useState({ x: 0, y: 20 })
  const posRef = useRef({ x: 0, y: 20 })
  const targetRef = useRef({ x: 0, y: 20 })
  const rafRef = useRef<number | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  // POČIŠČENJE: ob odklopu prekliči morebitni rAF glajenja (R537-b: vrstica
  // iz skupnega efekta v starem ar.tsx; steze kamere čisti vstopna datoteka,
  // AR sejo globine pa globina.ts)
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // ── vlečenje overlayja (R465: glajenje low-pass + zaklep) ──
  function onPointerDown (e: ReactPointerEvent<HTMLDivElement>): void {
    if (locked) return // zaklenjen položaj — zajem brez nerodnega pomika
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: posRef.current.x, baseY: posRef.current.y }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* nekateri brskalniki */ }
  }
  function onPointerMove (e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || locked) return
    // ciljna točka iz povleka; dejanski položaj ji sledi z glajenjem (stabilizacija)
    targetRef.current = { x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) }
    if (rafRef.current == null) {
      const tick = () => {
        const t = targetRef.current
        const p = posRef.current
        const nx = p.x + (t.x - p.x) * 0.3
        const ny = p.y + (t.y - p.y) * 0.3
        posRef.current = { x: nx, y: ny }
        setPos({ x: nx, y: ny })
        if (Math.abs(t.x - nx) > 0.25 || Math.abs(t.y - ny) > 0.25) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          posRef.current = { ...t }
          setPos({ ...t })
          rafRef.current = null
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
  }
  function onPointerUp (): void { dragRef.current = null }

  return { pos, onPointerDown, onPointerMove, onPointerUp }
}

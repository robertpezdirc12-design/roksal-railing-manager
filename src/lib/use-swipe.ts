// use-swipe — swipe gesture z haptic feedback
// Uporaba: const { onTouchStart, onTouchEnd } = useSwipe({ onSwipeLeft, onSwipeRight })

'use client'

import { useRef, useCallback } from 'react'
import { haptic } from '@/lib/haptics'

interface SwipeOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
  threshold?: number
}

export function useSwipe (options: SwipeOptions) {
  const startX = useRef(0)
  const startY = useRef(0)
  const threshold = options.threshold ?? 50

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - startX.current
    const dy = e.changedTouches[0].clientY - startY.current

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
      haptic('light')
      if (dx > 0) options.onSwipeRight?.()
      else options.onSwipeLeft?.()
    } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > threshold) {
      haptic('light')
      if (dy > 0) options.onSwipeDown?.()
      else options.onSwipeUp?.()
    }
  }, [options, threshold])

  return { onTouchStart, onTouchEnd }
}

// useLongPress — long-press z haptic feedback
export function useLongPress (callback: () => void, ms: number = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const start = useCallback(() => {
    timer.current = setTimeout(() => {
      haptic('medium')
      callback()
    }, ms)
  }, [callback, ms])

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
  }
}

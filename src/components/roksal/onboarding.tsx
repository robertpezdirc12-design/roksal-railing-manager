// onboarding — interaktivni guided tour (Shepherd.js)
// Prikazuje se ob prvem obisku (localStorage flag).

'use client'

import { useEffect, useRef } from 'react'
import Shepherd from 'shepherd.js'
import 'shepherd.js/dist/css/shepherd.css'

const STORAGE_KEY = 'roksal_onboarding_done'

export function useOnboarding (steps: { element: string; title: string; text: string }[]) {
  const tourRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(STORAGE_KEY)) return
    if (steps.length === 0) return

    const tour = new (Shepherd as any).Tour({
      useModalOverlay: true,
      defaultStepOptions: {
        classes: 'roksal-tour',
        scrollTo: { behavior: 'smooth', block: 'center' },
        cancelIcon: { enabled: true },
        modalOverlayOpeningPadding: 8,
        modalOverlayOpeningRadius: 8,
      },
    })

    steps.forEach((s, i) => {
      tour.addStep({
        id: `step-${i}`,
        title: s.title,
        text: s.text,
        attachTo: { element: s.element, on: 'bottom' },
        buttons: [
          ...(i > 0 ? [{ text: 'Nazaj', action: tour.back, classes: 'shepherd-button-secondary' }] : []),
          {
            text: i === steps.length - 1 ? 'Zaključi' : 'Naprej',
            action: i === steps.length - 1 ? tour.complete : tour.next,
          },
        ],
      })
    })

    tour.on('complete', () => {
      localStorage.setItem(STORAGE_KEY, '1')
    })
    tour.on('cancel', () => {
      localStorage.setItem(STORAGE_KEY, '1')
    })

    // Delay to let DOM render
    const timer = setTimeout(() => tour.start(), 1000)
    tourRef.current = tour

    return () => {
      clearTimeout(timer)
      tour.cancel()
    }
  }, [steps])

  return tourRef
}

export function resetOnboarding (): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}

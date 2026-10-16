'use client'

// globina.ts — R471 (issue #8 Faza 4): WebXR immersive-ar seja za mero z
// globino + zaznava podpore senzorja (R537-b: dobesedna selitev iz ar.tsx).
// Seja in manifest senzorja prihajata iz @/lib/depth-adapter (izven tega
// modula); ta hook drži stanje UI (podpora, tapi, zaposlenost) in izvede
// mero — rezultat se zapiše kot sceneEdit z manifestom (applyEdits v vstopu
// izpelje metodo DEPTH_AR).

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { useToast } from '@/hooks/use-toast'
import { detectDepthSupport, startDepthMeasurement, type DepthSupportInfo } from '@/lib/depth-adapter'
import type { SceneEdit } from '@/lib/scene-understanding-core'
import type { SessionUser } from '@/lib/store'

import type { Mode } from './tipi'

export function useArGlobina ({ mode, stopCamera, startCamera, sceneSelectedId, setSceneEdits, user }: {
  mode: Mode
  stopCamera: () => void
  startCamera: () => Promise<void>
  sceneSelectedId: string | null
  setSceneEdits: Dispatch<SetStateAction<SceneEdit[]>>
  user: SessionUser | null
}): {
  depthSupport: DepthSupportInfo | null
  depthTaps: number
  depthBusy: boolean
  runDepthMeasure: (label: string) => Promise<void>
} {
  const { toast } = useToast()

  /** R471 (F4): zaznana podpora AR globine (WebXR/ARCore) — null = še preverjam. */
  const [depthSupport, setDepthSupport] = useState<DepthSupportInfo | null>(null)
  /** R471 (F4): koliko tapov je že zabeleženih v tekoči AR meri (0..2). */
  const [depthTaps, setDepthTaps] = useState(0)
  /** R471 (F4): AR seja za mero z globino je v teku. */
  const [depthBusy, setDepthBusy] = useState(false)
  /** R471 (F4): stop-funkcija tekoče AR seje globine (čiščenje ob odklopu). */
  const depthStopRef = useRef<(() => void) | null>(null)

  // R471 (F4): ENKRATNA zaznava podpore AR globine (WebXR immersive-ar) —
  // neblokirajoče: odgovor pride, ko pride; medtem UI ne obljublja nič.
  useEffect(() => {
    let alive = true
    void detectDepthSupport()
      .then((info) => { if (alive) setDepthSupport(info) })
      .catch(() => { if (alive) setDepthSupport({ supported: false, provider: null, reason: 'Podpore za AR globino ni bilo mogoče preveriti — merite z referenco.' }) })
    return () => { alive = false }
  }, [])

  // POČIŠČENJE: ob odklopu zapri morebitno AR sejo globine (R537-b: vrstica
  // iz skupnega efekta v starem ar.tsx)
  useEffect(() => {
    return () => {
      if (depthStopRef.current != null) { try { depthStopRef.current() } catch { /* n/a */ } depthStopRef.current = null }
    }
  }, [])

  /**
   * R471 (F4): MERA Z AR GLOBINO — odpre WebXR AR sejo (depth-sensing),
   * monter tapne dve točki, adapter izračuna metrično razdaljo in vrne
   * manifest senzorja. Rezultat se zapiše kot sceneEdit z manifestom →
   * applyEdits izpelje metodo DEPTH_AR. Napake so poštene (razlog + padec
   * na obstoječi tok) — merjenje nikoli ne ostane „obviseno“.
   */
  async function runDepthMeasure (label: string): Promise<void> {
    if (depthBusy) return
    setDepthBusy(true)
    setDepthTaps(0)
    const cameraWasOn = mode === 'on'
    if (cameraWasOn) stopCamera() // WebXR seja prevzame kamero
    try {
      await new Promise<void>((resolve) => {
        void startDepthMeasurement((result) => {
          if (result.ok) {
            setSceneEdits((prev) => [...prev, {
              elementId: sceneSelectedId ?? '',
              measure: { label, valueCm: result.distanceCm, depth: result.manifest },
              by: user?.name ?? 'monter',
              at: Date.now(),
            }])
            toast({
              title: 'Mera iz AR globine zabeležena.',
              description: `${label}: ${result.distanceCm.toFixed(1).replace('.', ',')} cm (AR globina, ${result.manifest.depthFormat}) — shrani se z zajemom AR posnetka.`,
            })
          } else {
            toast({
              title: 'Mera z globino ni uspela.',
              description: `${result.reason} Podatki ostajajo — merite z referenco ali ročno.`,
            })
          }
          resolve()
        }, {
          onTap: (count) => { setDepthTaps(count) },
        }).then((stop) => {
          // če se komponenta odklopi med sejo, jo zapri (memory leak varnost)
          depthStopRef.current = stop
        }).catch(() => {
          toast({ title: 'Mera z globino ni uspela.', description: 'AR seje ni bilo mogoče odpreti na tej napravi — merite z referenco ali ročno.' })
          resolve()
        })
      })
    } finally {
      setDepthBusy(false)
      setDepthTaps(0)
      depthStopRef.current = null
      if (cameraWasOn) await startCamera()
    }
  }

  return { depthSupport, depthTaps, depthBusy, runDepthMeasure }
}

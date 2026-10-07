'use client'

// pwa-register — R439 (GitLab issue #6): registracija Service Workerja.
//
// Registrira se SAMO v produkciji (NODE_ENV=production): v razvoju Next.js HMR
// nenehno nalaga sveže module, predpomnjenje pa bi povzročilo zastarele vire.
// V produkciji SW omogoči, da se aplikacija (app shell) odpre tudi brez signala —
// poslovni podatki in vrsta sprememb ostajajo v IndexedDB (lib/offline.ts).
//
// KO je SW aktiven, ob vsaki uspešni navigaciji izrecno osveži predpomnjen
// shell (sporočilo PRECACHE_URL), da monter na telefonu vedno nosi svežo
// različico aplikacije za naslednji offline odhod na teren.

import { useEffect } from 'react'

export function PwaRegister () {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    let cancelled = false

    async function register () {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        // uspešna navigacija → izrecna predpomnitev shella (sveža različica)
        await navigator.serviceWorker.ready
        if (!cancelled && reg.active) {
          reg.active.postMessage({ type: 'PRECACHE_URL', url: window.location.origin + '/' })
        }
      } catch {
        // SW ni kritičen — aplikacija deluje tudi brez njega (samo online nalaganje)
      }
    }

    void register()
    return () => { cancelled = true }
  }, [])

  return null
}

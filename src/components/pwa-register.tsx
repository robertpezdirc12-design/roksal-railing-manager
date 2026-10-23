'use client'

// pwa-register — R439 (GitLab issue #6) + R552: registracija Service Workerja.
//
// Registrira se SAMO v produkciji (NODE_ENV=production): v razvoju Next.js HMR
// nenehno nalaga sveže module, predpomnjenje pa bi povzročilo zastarele vire.
// V produkciji SW omogoči, da se aplikacija (app shell) odpre tudi brez signala —
// poslovni podatki in vrsta sprememb ostajajo v IndexedDB (lib/offline.ts).
//
// KO je SW aktiven, ob vsaki uspešni navigaciji izrecno osveži predpomnjen
// shell (sporočilo PRECACHE_URL), da monter na telefonu vedno nosi svežo
// različico aplikacije za naslednji offline odhod na teren.
//
// R552 (dve vrzeli po spletni raziskavi, vzorec R550):
//   • UPDATE FLOW (web.dev "Update" / Workbox "Handling service worker
//     updates"): ob `updatefound` se nova različica namesti, a NE prevzeme
//     (sw.js od R552 ne kliče skipWaiting ob namestitvi). Ko je stanje
//     'installed' in stari SW še nadzoruje (controller !== null → ni prva
//     namestitev), pokažemo toast "Nova različica aplikacije". Uporabnik
//     potrdi [Osveži] → SKIP_WAITING pošljemo NOVEMU (čakajočemu) delavcu —
//     stari kontroler bi bil no-op — ob controllerchange naložimo stran znova.
//     Zastavica refreshing (ref, ne state — vrednost iz namestitve učinka
//     mora biti VIDNA poslušalcu) ščiti pred zanko in pred lažnim reloadom
//     ob prvi namestitvi (controllerchange takrat NI potrditev uporabnika).
//   • navigator.storage.persist() (web.dev "Persistent storage"): terenski
//     podatki (vrsta, fotografije, osnutki) v IndexedDB so življenjsko
//     pomembni — brez persist() jih brskalnik pod pritiskom prostora lahko
//     tiho izvrže. Poskus je najboljše-prizadevanje; ne blokira ničesar.

import { useCallback, useEffect, useRef, useState } from 'react'

export function PwaRegister () {
  const [updateReady, setUpdateReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const newWorkerRef = useRef<ServiceWorker | null>(null)
  const refreshingRef = useRef(false)

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

        // R552: storage.persist — zaščita IndexedDB pred izvrženjem pod pritiskom
        // prostora (najboljše-prizadevanje, tiho; odgovor ne blokira ničesar).
        try { void navigator.storage?.persist?.() } catch { /* neobvezno */ }

        // R552: updatefound → sledi NOVEMU delavcu (čakajoči prejme SKIP_WAITING;
        // stari kontroler bi bil no-op).
        reg.addEventListener('updatefound', () => {
          const w = reg.installing
          if (!w) return
          newWorkerRef.current = w
          w.addEventListener('statechange', () => {
            if (cancelled) return
            // 'installed' + star kontroler → POSODOBITEV (prva namestitev ima
            // controller === null in zato ne pokaže toast-a).
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateReady(true)
            }
          })
        })

        // R552: prevzem po potrditvi → enkraten reload. Dogodka ob prvi
        // namestitvi (claim) NE smemo šteti za potrditev — refreshingRef
        // je takrat še false, poslušalec se umakne.
        const onControllerChange = () => {
          if (refreshingRef.current) window.location.reload()
        }
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
      } catch {
        // SW ni kritičen — aplikacija deluje tudi brez njega (samo online nalaganje)
      }
    }

    void register()
    return () => { cancelled = true }
  }, [])

  const applyUpdate = useCallback(() => {
    refreshingRef.current = true
    // SKIP_WAITING gre NOVEMU (čakajočemu) delavcu — sw.js ga sprejme in
    // prevzame; controllerchange nato znova naloži stran.
    newWorkerRef.current?.postMessage({ type: 'SKIP_WAITING' })
  }, [])

  if (!updateReady || dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-osvezej"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-roksal-amber/40 bg-roksal-amber/10 backdrop-blur supports-[backdrop-filter]:bg-roksal-amber/15"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-bold">Nova različica aplikacije je pripravljena.</span>{' '}
          <span className="text-muted-foreground">Osveži, da velja tudi brez signala.</span>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={applyUpdate}
            className="h-9 rounded-full bg-roksal-amber px-4 text-sm font-bold text-roksal-amber-ink transition-transform active:scale-95 hover:brightness-95"
          >
            Osveži
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="h-9 rounded-full border border-border px-4 text-sm font-semibold text-muted-foreground transition-colors hover:border-roksal-amber/50 hover:text-foreground"
          >
            Kasneje
          </button>
        </div>
      </div>
    </div>
  )
}

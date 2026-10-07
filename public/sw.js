// sw.js — R439 (GitLab issue #6): Service Worker za MOBILNI TEREN & OFFLINE.
//
// NAMEN: aplikacija se odpre TUDI brez signala (PWA) — predpomni APP SHELL
// (HTML navigacije + statične vire), POSLOVNIH podatkov NE predpomni.
// Podatki in vrsta sprememb živijo v IndexedDB (lib/offline.ts), sinhronizacija
// pa teče prek /api/sync, ko se signal vrne.
//
// Strategije:
//   • navigacija (HTML)  → network-first, ob izpadu predpomnjeni shell
//   • /_next/static, ikone, manifest → cache-first ( immutable viri)
//   • /api/*              → SAMO omrežje (SRANDI NE predpomnimo — končnost
//                            podatkov je vedno strežnik; ob offline fetch pade,
//                            kar sproži vrsto v lib/offline.ts)
//
// Registracija: samo v PRODUKCIJI (src/components/pwa-register.tsx) — v razvoju
// (Next.js HMR) se SW ne registrira, da ne moti ponovnega nalaganja.

const VERSION = 'roksal-v1'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`

// viri app shella, ki jih predpomnimo ob namestitvi
const SHELL_URLS = ['/', '/offline.html']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    await Promise.allSettled(SHELL_URLS.map((u) => cache.add(new Request(u, { cache: 'reload' }))))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // počisti stare verzije predpomnilnika
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // mutacije NIKOLI iz predpomnilnika

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // tujih virov ne obravnavamo

  // API — vedno omrežje (poslovni podatki niso predpomnjeni)
  if (url.pathname.startsWith('/api/')) return

  // statični viri Next.js in PWA ikone — cache-first (immutabilni, hashek)
  const isAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/logo.svg' ||
    url.pathname === '/robots.txt' ||
    url.pathname === '/offline.html'
  if (isAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      try {
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      } catch {
        return hit ?? Response.error()
      }
    })())
    return
  }

  // navigacija (HTML) — network-first, offline → predpomnjeni shell
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      try {
        const res = await fetch(req, { cache: 'no-store' })
        if (res.ok) cache.put('/', res.clone())
        return res
      } catch {
        const shell = (await cache.match('/')) ?? (await cache.match('/offline.html'))
        return shell ?? Response.error()
      }
    })())
  }
})

// sporočilo iz aplikacije: izrecna zahteva po predpomnitvi trenutne strani
// (npr. ko monter odpre nalog, da ga lahko ponovno odpre brez signala)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'PRECACHE_URL' && typeof event.data.url === 'string') {
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(SHELL_CACHE)
        const res = await fetch(event.data.url, { cache: 'no-store' })
        if (res.ok) await cache.put('/', res.clone())
      } catch { /* brez signala — ne moremo predpomniti */ }
    })())
  }
})

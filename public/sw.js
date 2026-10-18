// sw.js — R439 (GitLab issue #6) + R552: Service Worker za MOBILNI TEREN.
//
// NAMEN: aplikacija se odpre TUDI brez signala (PWA) — predpomni APP SHELL
// (HTML navigacije + statične vire), poslovni podatki in vrsta sprememb živijo
// v IndexedDB (lib/offline.ts), sinhronizacija pa teče prek POST /api/sync,
// ko se signal vrne.
//
// Strategije:
//   • navigacija (HTML)  → network-first, ob izpadu predpomnjeni shell
//   • /_next/static, ikone, manifest → cache-first (immutable viri)
//   • GET /api/*          → network-first, ob izpadu omrežja ZADNJI ZNANI
//                           odgovor iz predpomnilnika (R552 — web.dev
//                           "network falling back to cache": strežnik ostaja
//                           edini vir končnosti; predpomnilnik je samo
//                           rezerva za branje brez signala)
//   • mutacije (non-GET)  → SAMO omrežje, NIKOLI predpomnjene
//
// R552 (tri vrzeli po spletni raziskavi, vzorec R550):
//   1. BACKGROUND SYNC (tag 'roksal-sync'): če monter zapre aplikacijo, še
//      preden se signal vrne, vrsto izprazne SAM SW, takoj ko brskalnik
//      spet vidi omrežje — tudi z zaprtim zavihkom (MDN "Offline and
//      background operation"). Če je aplikacija ODPRTA, se SW umakne
//      (vrsto poganja stran: online poslušalci + 30 s timer v lib/offline.ts)
//      — dva pisalca po istih ops se ne stepeta. iOS Safari Background
//      Sync ne podpira: tam ta dogodek preprosto ne nastane in velja
//      staro obnašanje (sinhronizacija ob odprtju aplikacije).
//   2. UPDATE FLOW (web.dev "Update" / Workbox "Handling service worker
//      updates"): namestitev NOVEGA SW ne zmore več takoj (brez
//      skipWaiting v install) — stran pokaže toast "Nova različica",
//      uporabnik potrdi, šele takrat SKIP_WAITING aktivira in stran se
//      osveži (pwa-register.tsx). Prva namestitev (brez starega
//      kontrolerja) se aktivira takoj, kot prej.
//   3. GET /api ZAČASNA REZERVA (zgoraj) — ob izpadu brskalnik pokaže
//      zadnje znane podatke namesto praznine; svežina pri povezavi
//      ostaja nespremenjena (network-first).
//
// Sinhronizacija v SW (swSync): seja je od R538 v httpOnly piškotku
// `roksal_session` — fetch iz SW na isti izvor piškotek samodejno priloži
// (nobeno prenašanje žetona v IndexedDB ni potrebno; localStorage iz SW
// sploh ni dosegljiv). 401: SW se tiho umakne (brez throw → brskalnik
// ne ponavlja; brez seje je poskus brez pomena, znova se poskus ob
// prijavi v odprti aplikaciji). Varstvo več uporabnikov na napravi
// ostaja v strani (bindOfflineUser v lib/offline.ts) — brez signala
// zamenjava uporabnika ni mogoča (prijava zahteva strežnik), strežnik
// pa vsak op preveri fail-closed (OBSEG v /api/sync).

const VERSION = 'roksal-v1'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
const API_CACHE = `${VERSION}-api` // R552: rezerva GET /api branja ob izpadu
const SYNC_TAG = 'roksal-sync'
const MAX_API_CACHE_BYTES = 512 * 1024 // R552: varovalka proti napihnjenim odgovorom

// viri app shella, ki jih predpomnimo ob namestitvi
const SHELL_URLS = ['/', '/offline.html']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    await Promise.allSettled(SHELL_URLS.map((u) => cache.add(new Request(u, { cache: 'reload' }))))
    // R552: NO skipWaiting — nova različica čaka na potrditev uporabnika
    // (toast v pwa-register.tsx pošlje SKIP_WAITING šele ob tapu "Osveži").
    // Prva namestitev (brez starega kontrolerja) se aktivira takoj, kot prej.
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // počisti stare verzije predpomnilnika (vključno z API_CACHE prejšnjih
    // verzij — predpona VERSION jih pokriva enako kot ostale)
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

  // GET /api — R552: network-first, ob izpadu omrežja zadnji znani odgovor.
  // Strežnikov odgovor (tudi 401/4xx) se vrne tak, kot je — predpomnilnik
  // ZAMENJA samo omrežjo, ki je NEDOSEGLJIVO, ne pa napaki strežnika.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE)
      try {
        const res = await fetch(req)
        if (res.ok) {
          const len = Number(res.headers.get('content-length') ?? '0')
          if (!len || len < MAX_API_CACHE_BYTES) await cache.put(req, res.clone())
        }
        return res
      } catch {
        const hit = await cache.match(req)
        return hit ?? Response.error()
      }
    })())
    return
  }

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

// ─── R552: Background Sync — vrsta se izprazni, tudi če je zavihek zaprt ─────
// Brskalnik sproži 'sync', takoj ko spet vidi omrežje (Chrome/Edge/Android;
// iOS Safari dogodka ne podpira — tam velja staro obnašanje). Zavrnitev
// obljube (throw) pomeni "poskusi znova" in brskalnik sam ponovi.
self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return
  event.waitUntil(swSync())
})

async function swSync () {
  // Aplikacija odprta (tudi v ozadju)? Vrsto poganja stran sama (online
  // poslušalci + 30 s timer) — SW se umakne, da ne nastaneta dva pisalca.
  const wins = await self.clients.matchAll({ type: 'window' })
  if (wins.length > 0) return

  const db = await openDb()
  try {
    const ops = (await getAll(db, 'queue'))
      .filter((o) => o && o.status !== 'synced' && o.opId)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    if (ops.length === 0) {
      await cachePutVal(db, 'lastSync', new Date().toISOString())
      return
    }

    // foto opom priloži dataUrl iz photos shrambe (zrcalo syncNow)
    const out = []
    for (const op of ops) {
      const payload = { ...op.payload }
      if (op.kind === 'foto' && typeof payload.photoId === 'string' && !payload.dataUrl) {
        const photo = await getOne(db, 'photos', payload.photoId)
        if (photo) payload.dataUrl = photo.dataUrl
      }
      out.push({ opId: op.opId, kind: op.kind, payload, clientTs: op.clientTs })
    }

    let deviceId = await cacheGetVal(db, 'deviceId')
    if (!deviceId) {
      deviceId = crypto.randomUUID()
      await cachePutVal(db, 'deviceId', deviceId)
    }

    // httpOnly piškotek roksal_session se priloži sam (isti izvor, R538)
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, ops: out }),
    })
    if (res.status === 401) return // seja potekla — tiho, brez ponavljanja
    if (!res.ok) throw new Error(`sync ${res.status}`) // throw → brskalnik ponovi

    const body = await res.json().catch(() => ({}))
    const results = (body && body.data && body.data.results) || []
    for (const r of results) {
      const op = ops.find((o) => o.opId === r.opId)
      if (!op) continue
      if (r.status === 'OK') {
        await putOne(db, 'queue', { ...op, status: 'synced', syncedAt: new Date().toISOString(), error: undefined })
        if (op.kind === 'foto' && typeof op.payload.photoId === 'string') {
          const photo = await getOne(db, 'photos', op.payload.photoId)
          if (photo && photo.status === 'lokalno') {
            await putOne(db, 'photos', { ...photo, status: 'potrjeno' })
          }
        }
      } else if (r.status === 'CONFLICT') {
        await putOne(db, 'queue', { ...op, status: 'conflict', error: r.error })
      } else {
        await putOne(db, 'queue', { ...op, status: 'error', error: r.error })
      }
    }
    await cachePutVal(db, 'lastSync', new Date().toISOString())
  } finally {
    db.close()
  }
}

// ─── IndexedDB (roksal-offline v2 — ista shema kot lib/offline.ts) ───────────
// Samostojne obljubne ovojnice: SW ne sme uvažati iz src/ (ločena skripta).

const DB_NAME = 'roksal-offline'
const DB_VERSION = 2

function openDb () {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'opId' })
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'photoId' })
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'userId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB ni dosegljiva.'))
  })
}

function getAll (db, store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror = () => reject(req.error)
  })
}

function getOne (db, store, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function putOne (db, store, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(value)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function cacheGetVal (db, key) {
  return getOne(db, 'cache', key).then((r) => (r ? r.value : null)).catch(() => null)
}

function cachePutVal (db, key, value) {
  return putOne(db, 'cache', { key, value }).then(() => undefined).catch(() => undefined)
}

// ─── sporočila iz aplikacije ─────────────────────────────────────────────────

// PRECACHE_URL (R439): izrecna zahteva po predpomnitvi trenutne strani
// (npr. ko monter odpre nalog, da ga lahko ponovno odpre brez signala).
// SKIP_WAITING (R552): potrditev uporabnika na toastu "Nova različica" —
// šele takrat nova različica SW prevzame (web.dev update recept).
self.addEventListener('message', (event) => {
  const data = event.data
  if (data?.type === 'PRECACHE_URL' && typeof data.url === 'string') {
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(SHELL_CACHE)
        const res = await fetch(data.url, { cache: 'no-store' })
        if (res.ok) await cache.put('/', res.clone())
      } catch { /* brez signala — ne moremo predpomniti */ }
    })())
    return
  }
  if (data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  }
})

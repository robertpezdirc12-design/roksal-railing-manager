'use client'

// offline — R439 (GitLab issue #6): MOBILNI TEREN & OFFLINE.
// Čist IndexedDB (BREZ odvisnosti) — vrsta operacij, fotografije in predpomnilnik.
// Monter dela brez signala: dejanja grejo v vrsto, ob vrnitvi signala se
// SAMODEJNO in IDEMPOTENTNO sinhronizirajo prek POST /api/sync
// (opId UUID generira ODJEMALEC → podvajanje na strežniku ni mogoče).
//
// Shrambe (baza 'roksal-offline'):
//   • queue  (keyPath opId)    — vrsta operacij { opId, kind, payload, clientTs, status }
//   • photos (keyPath photoId) — fotografije { photoId, dataUrl (kompresiran), status }
//   • cache  (key-value)       — zadnji seznam nalogov, lastSync, deviceId, števec seq

import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/lib/store'

const DB_NAME = 'roksal-offline'
const DB_VERSION = 1
const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB dataURL-a — enako strežniški meji

export type OfflineOpKind = 'meritev' | 'foto' | 'nalog-opomba' | 'nalog-status' | 'nalog-zakljucek'

export interface QueueOp {
  opId: string
  kind: OfflineOpKind
  payload: Record<string, unknown>
  clientTs: string
  status: 'pending' | 'synced' | 'conflict' | 'error'
  error?: string
  syncedAt?: string
  createdAt: string
  seq: number // vrstni red dodajanja (IDB nima autoincrement na UUID ključu)
}

export interface PhotoRecord {
  photoId: string
  dataUrl: string
  status: 'lokalno' | 'potrjeno'
  createdAt: string
}

interface CacheRecord { key: string; value: unknown }

export interface OfflineState {
  online: boolean
  pending: number
  conflicts: number
  errors: number
  photos: number
  lastSync: string | null
}

export interface SyncSummary {
  synced?: number
  conflicts?: number
  errors?: number
  skipped?: 'offline'
  error?: string
}

// ─── UUID (fallback, če crypto.randomUUID ni na voljo — secure context) ──────

function uuid (): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// ─── IndexedDB ovojnica ──────────────────────────────────────────────────────

function openDb (): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'opId' })
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'photoId' })
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB ni dosegljiva.'))
  })
}

function tx<T> (store: 'queue' | 'photos' | 'cache', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error ?? new Error('Napaka IndexedDB.'))
    t.oncomplete = () => db.close()
  }))
}

function cacheGet<T> (key: string): Promise<T | null> {
  return tx<CacheRecord | undefined>('cache', 'readonly', (s) => s.get(key))
    .then((r) => (r ? (r.value as T) : null))
    .catch(() => null)
}

function cachePut (key: string, value: unknown): Promise<void> {
  return tx('cache', 'readwrite', (s) => s.put({ key, value } as CacheRecord)).then(() => {})
    .catch(() => {})
}

// ─── Kompresija (skladna z mobilnim workflowom — canvas → JPEG) ──────────────

/** Zmanjša sliko na maxDim najdaljše strani in vrne JPEG dataUrl. */
export async function compressImage (input: File | string, maxDim = 1600, quality = 0.7): Promise<string> {
  let src: string
  if (typeof input === 'string') {
    src = input
  } else {
    src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Branje datoteke ni uspelo.'))
      reader.readAsDataURL(input)
    })
  }
  return await new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      } catch {
        resolve(src) // če gre kaj narobe, pošljemo izvirnik
      }
    }
    img.onerror = () => resolve(src)
    img.src = src
  })
}

// ─── Vrsta operacij ──────────────────────────────────────────────────────────

/** Doda operacijo v vrsto (opId generira ODJEMALEC — idempotenca na strežniku). */
export async function queueOp (kind: OfflineOpKind, payload: Record<string, unknown>): Promise<QueueOp> {
  const seq = ((await cacheGet<number>('opSeq')) ?? 0) + 1
  await cachePut('opSeq', seq)
  const op: QueueOp = {
    opId: uuid(),
    kind,
    payload,
    clientTs: new Date().toISOString(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    seq,
  }
  await tx('queue', 'readwrite', (s) => s.put(op))
  return op
}

export interface QueuePhotoInput {
  dataUrl: string
  projectId?: string | null
  workOrderId?: string | null
  note?: string | null
  location?: string | null
  type?: string | null
  lengthCm?: number | null
  heightCm?: number | null
  posts?: number | null
  segments?: number | null
  slopeDeg?: number | null
}

/**
 * Fotografija v shrambo 'photos' (KOMPRESIRAN dataUrl) + hkrati op 'foto' z
 * merilnimi podatki v payloadu — dataUrl se syncNow priloži iz photos shrambe.
 * Če je po kompresiji še vedno prevelika (> 8 MB) → napaka.
 */
export async function queuePhoto (input: QueuePhotoInput): Promise<{ photoId: string; opId: string }> {
  const compressed = await compressImage(input.dataUrl)
  if (compressed.length > MAX_PHOTO_BYTES) {
    throw new Error('Fotografija je po kompresiji še vedno prevelika (max 8 MB).')
  }
  const photoId = uuid()
  const photo: PhotoRecord = { photoId, dataUrl: compressed, status: 'lokalno', createdAt: new Date().toISOString() }
  await tx('photos', 'readwrite', (s) => s.put(photo))

  const payload: Record<string, unknown> = { photoId }
  for (const k of ['projectId', 'workOrderId', 'note', 'location', 'type'] as const) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) payload[k] = v.trim()
  }
  for (const k of ['lengthCm', 'heightCm', 'posts', 'segments', 'slopeDeg'] as const) {
    const v = input[k]
    if (typeof v === 'number' && Number.isFinite(v)) payload[k] = v
  }
  const op = await queueOp('foto', payload)
  return { photoId, opId: op.opId }
}

/** Vse operacije v vrstnem redu dodajanja. */
export async function listOps (): Promise<QueueOp[]> {
  const all = await tx<QueueOp[]>('queue', 'readonly', (s) => s.getAll()).catch(() => [] as QueueOp[])
  return all.sort((a, b) => a.seq - b.seq)
}

// ─── Sinhronizacija ──────────────────────────────────────────────────────────

let syncing = false

/**
 * Pošlje VSE neusklajene operacije (pending/conflict/error — v vrstnem redu
 * dodajanja) na POST /api/sync in zapiše rezultate nazaj:
 *   OK → 'synced' (+ foto → 'potrjeno') · CONFLICT → 'conflict' (ostane v vrsti,
 *   prikazan uporabniku) · ERROR → 'error'.
 * Brez signala → { skipped: 'offline' }.
 */
export async function syncNow (): Promise<SyncSummary> {
  if (!navigator.onLine) return { skipped: 'offline' }
  if (syncing) return { synced: 0, conflicts: 0, errors: 0 }
  syncing = true
  try {
    // R439 VARNOST: pred vsakim pošiljanjem potrdi vezavo vrste na trenutnega
    // uporabnika — drug uporabnik na isti napravi (preklic/potek seje) pobriše
    // lokalne podatke PREJ, kot se karkoli pošlje na strežnik.
    const currentUserId = useAppStore.getState().user?.id
    if (currentUserId) await bindOfflineUser(currentUserId).catch(() => {})

    const ops = (await listOps()).filter((o) => o.status !== 'synced')
    if (ops.length === 0) {
      await cachePut('lastSync', new Date().toISOString())
      return { synced: 0, conflicts: 0, errors: 0 }
    }

    // foto dataUrle priloži opom iz photos shrambe
    const out: { opId: string; kind: string; payload: Record<string, unknown>; clientTs: string }[] = []
    for (const op of ops) {
      const payload = { ...op.payload }
      if (op.kind === 'foto' && typeof payload.photoId === 'string' && !payload.dataUrl) {
        const photo = await tx<PhotoRecord | undefined>('photos', 'readonly', (s) => s.get(payload.photoId as string)).catch(() => undefined)
        if (photo) payload.dataUrl = photo.dataUrl
      }
      out.push({ opId: op.opId, kind: op.kind, payload, clientTs: op.clientTs })
    }

    // deviceId — stabilna identifikacija naprave (vrsta/cache)
    let deviceId = await cacheGet<string>('deviceId')
    if (!deviceId) {
      deviceId = uuid()
      await cachePut('deviceId', deviceId)
    }

    const token = useAppStore.getState().token
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ deviceId, ops: out }),
    })
    if (res.status === 401) {
      useAppStore.getState().clearAuth()
      return { error: 'Seja je potekla — znova se prijavite.' }
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { error: (body as { error?: string }).error ?? `Sinhronizacija ni uspela (${res.status}).` }
    }

    const results = ((body as { data?: { results?: { opId: string; status: string; error?: string }[] } }).data?.results ?? [])
    let ok = 0; let conflict = 0; let err = 0
    for (const r of results) {
      const op = ops.find((o) => o.opId === r.opId)
      if (!op) continue
      if (r.status === 'OK') {
        await tx('queue', 'readwrite', (s) => s.put({ ...op, status: 'synced', syncedAt: new Date().toISOString(), error: undefined }))
        if (op.kind === 'foto' && typeof op.payload.photoId === 'string') {
          const photo = await tx<PhotoRecord | undefined>('photos', 'readonly', (sp) => sp.get(op.payload.photoId as string)).catch(() => undefined)
          if (photo && photo.status === 'lokalno') {
            await tx('photos', 'readwrite', (sp) => sp.put({ ...photo, status: 'potrjeno' }))
          }
        }
        ok++
      } else if (r.status === 'CONFLICT') {
        await tx('queue', 'readwrite', (s) => s.put({ ...op, status: 'conflict', error: r.error }))
        conflict++
      } else {
        await tx('queue', 'readwrite', (s) => s.put({ ...op, status: 'error', error: r.error }))
        err++
      }
    }
    await cachePut('lastSync', new Date().toISOString())
    // R439: počišči zaključene zapise, starejše od 24 h (zasebnost + prostor)
    await purgeDone().catch(() => {})
    return { synced: ok, conflicts: conflict, errors: err }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Sinhronizacija ni uspela.' }
  } finally {
    syncing = false
  }
}

/**
 * Samodejna sinhronizacija: 'online' dogodek → syncNow; interval 30 s, če je
 * online && pending > 0. Vrne cleanup funkcijo (odjavi poslušalce).
 */
export function initOfflineSync (): () => void {
  const onOnline = () => { void syncNow() }
  window.addEventListener('online', onOnline)
  // ob pripravi aplikacije dohiti zaostalo vrsto (če smo online)
  if (navigator.onLine) void syncNow()
  const timer = window.setInterval(() => {
    if (!navigator.onLine) return
    void listOps().then((ops) => {
      if (ops.some((o) => o.status === 'pending')) void syncNow()
    })
  }, 30_000)
  return () => {
    window.removeEventListener('online', onOnline)
    window.clearInterval(timer)
  }
}

// ─── Stanje (za UI badge) ────────────────────────────────────────────────────

/** React hook: trenutno stanje navigator.onLine (posluša online/offline dogodke). */
export function useOnline (): boolean {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener('online', callback)
      window.addEventListener('offline', callback)
      return () => {
        window.removeEventListener('online', callback)
        window.removeEventListener('offline', callback)
      }
    },
    () => navigator.onLine,
    () => true
  )
}

/** { online, pending, photos, conflicts, lastSync } — za OfflineBadge v glavi. */
export async function getOfflineState (): Promise<OfflineState> {
  const [ops, photos, lastSync] = await Promise.all([
    listOps(),
    tx<PhotoRecord[]>('photos', 'readonly', (s) => s.getAll()).catch(() => [] as PhotoRecord[]),
    cacheGet<string>('lastSync'),
  ])
  return {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pending: ops.filter((o) => o.status === 'pending').length,
    conflicts: ops.filter((o) => o.status === 'conflict').length,
    errors: ops.filter((o) => o.status === 'error').length,
    photos: photos.filter((p) => p.status === 'lokalno').length,
    lastSync: lastSync ?? null,
  }
}

/** Izpiše nesinhronizirane operacije (za popover s podrobnostmi). */
export async function listUnsynced (): Promise<QueueOp[]> {
  return (await listOps()).filter((o) => o.status !== 'synced')
}

/**
 * R439 (issue #6 — »konflikti so rešljivo prikazani«): uporabnik odstrani
 * posamezen konflikt/napako iz vrste (sprejme stanje strežnika). Pripadajoča
 * fotografija (če gre za foto op) se izbriše tudi iz photos shrambe.
 */
export async function dismissOp (opId: string): Promise<void> {
  const op = await tx<QueueOp | undefined>('queue', 'readonly', (s) => s.get(opId)).catch(() => undefined)
  await tx('queue', 'readwrite', (s) => s.delete(opId)).catch(() => {})
  if (op?.kind === 'foto' && typeof op.payload.photoId === 'string') {
    await tx('photos', 'readwrite', (s) => s.delete(op.payload.photoId as string)).catch(() => {})
  }
}

/**
 * R439 (issue #6, varnost + prostor): izbriše ZAKLJUČENE zapise, starejše od
 * maxAge (privzeto 24 h) — sinhronizirane operacije (strežnik jih ima po opId)
 * in potrjene fotografije. IndexedDB tako vsebuje SAMO nerešene podatke.
 */
export async function purgeDone (maxAgeMs = 24 * 3600 * 1000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs
  const ops = await listOps()
  for (const o of ops) {
    if (o.status === 'synced' && new Date(o.syncedAt ?? o.createdAt).getTime() < cutoff) {
      await tx('queue', 'readwrite', (s) => s.delete(o.opId)).catch(() => {})
    }
  }
  const photos = await tx<PhotoRecord[]>('photos', 'readonly', (s) => s.getAll()).catch(() => [] as PhotoRecord[])
  for (const p of photos) {
    if (p.status === 'potrjeno' && new Date(p.createdAt).getTime() < cutoff) {
      await tx('photos', 'readwrite', (s) => s.delete(p.photoId)).catch(() => {})
    }
  }
}

// ─── Predpomnjenje nalogov (offline seznam) ─────────────────────────────────

export interface CachedNalogi<T> { savedAt: string; list: T[] }

export async function cacheNalogi<T> (list: T[]): Promise<void> {
  await cachePut('nalogi', { savedAt: new Date().toISOString(), list })
}

export async function getCachedNalogi<T> (): Promise<CachedNalogi<T> | null> {
  return await cacheGet<CachedNalogi<T>>('nalogi')
}

// ─── Varnost: izbris VSEH shramb ob odjavi (zahteva issue #6) ────────────────

export async function clearOfflineData (): Promise<void> {
  for (const store of ['queue', 'photos', 'cache'] as const) {
    await tx(store, 'readwrite', (s) => s.clear()).catch(() => {})
  }
}

/**
 * Varnost (issue #6, točka 6): offline shrambe so vezane na PRIJAVLJENEGA
 * uporabnika. Če se na isti napravi prijavi DRUG uporabnik (npr. po poteku
 * ali preklicu seje), se VSE lokalne shrambe (vrsta, fotografije, predpomnilnik)
 * izbrišejo — čakajoče terenske spremembe prvega uporabnika ne smejo biti
 * nevidno pripisane drugemu niti dostopne brez prijave.
 *
 *   'kept'    — isti uporabnik (vrsta ostane, tudi če je seja medtem potekla)
 *   'bound'   — prva vezava na tej napravi
 *   'cleared' — DRUG uporabnik → prejšnje lokalne podatke smo izbrisali
 */
export async function bindOfflineUser (userId: string): Promise<'kept' | 'bound' | 'cleared'> {
  const prev = await cacheGet<string>('userId')
  if (prev === userId) {
    // isti uporabnik — ob zagonu počisti stare zaključene zapise (higiena)
    await purgeDone().catch(() => {})
    return 'kept'
  }
  if (prev !== null) await clearOfflineData() // drug uporabnik → izbris vsega
  await cachePut('userId', userId)
  return prev === null ? 'bound' : 'cleared'
}

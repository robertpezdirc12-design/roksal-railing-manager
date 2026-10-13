'use client'

// measure-draft — R486 (issue #7 §3/§6): OSNUTEK MERITVE S KAMERO.
// Monter sred merjenja osveži/zapre stran/klic → točke, kalibracija in pogledi
// NE SMEJO biti izgubljeni (»po prekinitvi aplikacije NADALJUJE na zadnjem
// nedokončanem koraku«). En osnutek na PRIJAVLJENEGA uporabnika, shranjen v
// IndexedDB (baza 'roksal-offline', shramba 'drafts' — isti vzorec kot vrsta
// iz R439, BREZ novih odvisnosti).
//
// Varnost (vzorec bindOfflineUser, R439): osnutek je VEZAN na userId —
// drug uporabnik na isti napravi ga NE more prebrati niti nadaljevati;
// clearOfflineData (ob odjavi/zamenjavi uporabnika) pobriše tudi osnutke.
// Osnutek NI vrsta: sinhronizacija ga NE pobriše — samo confirm/Zavrži.

import { DB_NAME, DB_VERSION } from './offline'

/** Točke/pogledi so identični View/Pt iz meritve-kamera (serializabilni). */
export interface DraftPoint { x: number; y: number; label?: string; src?: 'ROCNO' | 'PREDLOG' }
export interface DraftQuality { brightness: number; blurScore: number; dark: boolean; bright: boolean; blurry: boolean; ok: boolean }
export interface DraftView {
  key: number
  photoId: string | null
  dataUrl: string
  imgW: number
  imgH: number
  quality: DraftQuality | null
  points: DraftPoint[]
  calib: { px: number; cm: number; pxY?: number; cmY?: number } | null
  calibLocked: boolean
}

/** Kar se shrani iz stanja dialoga (vse, kar snapshot() hrani za undo). */
export interface MeasureDraftSnapshot {
  projectId: string | null
  workOrderId: string | null
  mode: string
  phase: number
  views: DraftView[]
  activeView: number
  location: string
  calibMethod?: string
  type?: string
  heightS?: string
  note?: string
  maxTilt?: number | null
}

export interface MeasureDraft extends MeasureDraftSnapshot {
  userId: string
  savedAt: string
}

/** Skupna meja (enako vrsti R439): 4 pogledi × JPEG ≤ 1600 px. */
const MAX_DRAFT_BYTES = 8 * 1024 * 1024

// ─── IndexedDB ovojnica (vzorec offline.ts — odprta na ISTI bazi/verziji) ─────

function openDb (): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'userId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB ni dosegljiva.'))
  })
}

function tx<T> (mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction('drafts', mode)
    const req = fn(t.objectStore('drafts'))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error ?? new Error('Napaka IndexedDB.'))
    t.oncomplete = () => db.close()
  }))
}

// ─── API (1 osnutek na uporabnika — keyPath userId) ──────────────────────────

/** Shrani/prepiše osnutek meritve PRIJAVLJENEGA uporabnika. */
export async function saveDraft (userId: string, snapshot: MeasureDraftSnapshot): Promise<void> {
  if (!userId) throw new Error('Osnutek zahteva prijavo.')
  const draft: MeasureDraft = { userId, savedAt: new Date().toISOString(), ...snapshot }
  if (JSON.stringify(draft).length > MAX_DRAFT_BYTES) {
    throw new Error('Osnutek je prevelik (max 8 MB).')
  }
  await tx('readwrite', (s) => s.put(draft))
}

/** Osnutek uporabnika (null, če ne obstaja) — VEZAN na userId (IDOR varnost). */
export async function loadDraft (userId: string): Promise<MeasureDraft | null> {
  if (!userId) return null
  return await tx<MeasureDraft | undefined>('readonly', (s) => s.get(userId))
    .then((r) => r ?? null)
    .catch(() => null)
}

/** Izbriše SAMO osnutek tega uporabnika (confirm / Zavrži / ZAČNI NOVO). */
export async function clearDraft (userId: string): Promise<void> {
  if (!userId) return
  await tx('readwrite', (s) => s.delete(userId)).catch(() => {})
}

// opomba: izbris VSEH shramb ob odjavi (tudi 'drafts') opravi clearOfflineData
// v offline.ts — skupna baza, isti vzorec R439 (brez krožnega uvoza).

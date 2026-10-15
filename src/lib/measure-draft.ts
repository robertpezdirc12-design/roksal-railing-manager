'use client'

// measure-draft — R486 (issue #7 §3/§6): OSNUTEK MERITVE S KAMERO.
// Monter sred merjenja osveži/zapre stran/klic → točke, kalibracija in pogledi
// NE SMEJO biti izgubljeni (»po prekinitvi aplikacije NADALJUJE na zadnjem
// nedokončanem koraku«). Osnutki so shranjeni v IndexedDB (baza
// 'roksal-offline', shramba 'drafts' — isti vzorec kot vrsta iz R439, BREZ novih
// odvisnosti).
//
// R508 (issue #7 §6): osnutek je vezan na PRIJAVLJENEGA uporabnika IN na
// projekt/nalog. Prejšnja oblika (1 osnutek na uporabnika) je pomenila, da
// začetek druge meritve TIHO prepíše prvo — to je izguba podatkov, ki jo issue
// izrecno prepoveduje. Zapiše se zato seznam sej po ključu
// `projekt/nalog`; najnovejša je vedno prva, za katere `loadDraft` vrne
// sploščeno obliko (navadna klica obstoječega UI-ja se ne spremeni).
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
  /** R522 (issue #7 §4B): dokumentacijske slike detajlov — NEODVISNE od
   *  pogledov (rekonstrukcija). Neobvezno: starejši zapisi brez njih so
   *  veljavni (normalizacija spodaj jih bere kot []). */
  dokSlike?: DokSlikaVDraftu[]
}

/** Dokumentacijska slika v osnutku (DokSlika brez key, ki ga UI dodeli znova). */
export interface DokSlikaVDraftu {
  dataUrl: string
  tag: string
  note: string
  segmentIdx: number | null
}

export interface MeasureDraft extends MeasureDraftSnapshot {
  userId: string
  savedAt: string
}

/** Skupna meja na SEJO (enako vrsti R439): 4 pogledi × JPEG ≤ 1600 px. */
const MAX_DRAFT_BYTES = 8 * 1024 * 1024
/**
 * Največ hkratnih sej na napravi. Omejitev je namenoma majhna: seje nosijo
 * fotografije, naprava (in IndexedDB kvota brskalnika) pa je omejena. Kadar
 * seje izpadnejo, `saveDraft` to VRNE, da UI monterju pove, ne da bi tiho
 * izbrisal nedokončano meritev.
 */
export const MAX_SEJE = 6

export interface DraftSeja {
  /** `projekt/nalog` — identiteta nedokončane meritve, ne ID zapisa. */
  key: string
  savedAt: string
  snapshot: MeasureDraftSnapshot
}

/** Nov zapis v shrambi 'drafts' (keyPath userId ostane — brez migracije shrambe). */
export interface MeasureDraftRecord {
  userId: string
  savedAt: string
  seje: DraftSeja[]
}

/** Ključ nedokončane meritve: isti projekt+nalog = ista seja (nadgradnja). */
export function sejaKljuc (snap: Pick<MeasureDraftSnapshot, 'projectId' | 'workOrderId'>): string {
  return `${snap.projectId ?? 'brez-projekta'}/${snap.workOrderId ?? 'brez-naloga'}`
}

/**
 * Normalizira zapis: nova oblika (`seje: []`) ali R486 oblika (snimek je
 * razprostrt čez zapis). Zapisi R486 na že nameščenih napravah morajo ostati
 * brani — sicer bi posodobitev pobrisala monterjevo nedokončano meritev.
 */
export function normalizirajZapis (raw: unknown): DraftSeja[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as Record<string, unknown>
  if (Array.isArray(r.seje)) {
    // R522: dokSlike so neobvezne — normaliziraj POŠTENO (samo veljavne
    // slike, da pokvarjen zapis ne obori obnove seje).
    return (r.seje as DraftSeja[]).filter((s) => s && typeof s.key === 'string' && s.snapshot)
      .map((s) => ({ ...s, snapshot: { ...s.snapshot, dokSlike: Array.isArray(s.snapshot?.dokSlike) ? s.snapshot.dokSlike : [] } }))
  }
  if (Array.isArray(r.views)) {
    const snapshot: Record<string, unknown> = {}
    for (const k of Object.keys(r)) if (k !== 'userId' && k !== 'savedAt') snapshot[k] = r[k]
    const snap = snapshot as unknown as MeasureDraftSnapshot
    snap.dokSlike = Array.isArray(snap.dokSlike) ? snap.dokSlike : []
    return [{ key: sejaKljuc(snap), savedAt: typeof r.savedAt === 'string' ? r.savedAt : new Date(0).toISOString(), snapshot: snap }]
  }
  return []
}

/** Najnovejše seje prve (po `savedAt`). */
export function razvrstiSeje (seje: DraftSeja[]): DraftSeja[] {
  return [...seje].sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0))
}

/** Splošči sejo nazaj v obliko, jo UI (meritve-kamera) že pozna. */
export function splosciSejo (userId: string, seja: DraftSeja): MeasureDraft {
  return { userId, savedAt: seja.savedAt, ...seja.snapshot }
}

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

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Shrani osnutek meritve PRIJAVLJENEGA uporabnika. Obstoječe SEJE
 * drugih projektov/nalogov ostanejo — začetek nove meritve ne sme pobrisati
 * nedokončane stare. Vrne ključe sej, ki so zaradi meje izpadle.
 */
export async function saveDraft (userId: string, snapshot: MeasureDraftSnapshot): Promise<{ izpadle: string[] }> {
  if (!userId) throw new Error('Osnutek zahteva prijavo.')
  const key = sejaKljuc(snapshot)
  const savedAt = new Date().toISOString()
  const nova: DraftSeja = { key, savedAt, snapshot }
  if (JSON.stringify({ userId, savedAt, snapshot }).length > MAX_DRAFT_BYTES) {
    throw new Error(`Osnutek te meritve je prevelik (meja ${Math.round(MAX_DRAFT_BYTES / 1024 / 1024)} MB). Odstrani najmanj uporaben pogled ali potrdi meritev, nato poskusi znova.`)
  }
  const obstojeca = await tx<unknown>('readonly', (s) => s.get(userId)).catch(() => null)
  const seje = normalizirajZapis(obstojeca).filter((s) => s.key !== key)
  const vse = [nova, ...seje]
  const izpadle = vse.length > MAX_SEJE ? vse.slice(MAX_SEJE).map((s) => s.key) : []
  const hrani = vse.length > MAX_SEJE ? vse.slice(0, MAX_SEJE) : vse
  const zapis: MeasureDraftRecord = { userId, savedAt, seje: hrani }
  await tx('readwrite', (s) => s.put(zapis))
  return { izpadle }
}

/**
 * Osnutek uporabnika (null, če ne obstaja) — VEZAN na userId (IDOR varnost).
 * Brez `key` vrne NAJNOVEJŠO sejo (pasika »Nadaljuj nedokončano«); z `key`
 * vrne točno določeno meritev (npr. iz seznama sej).
 */
export async function loadDraft (userId: string, key?: string): Promise<MeasureDraft | null> {
  if (!userId) return null
  return await tx<unknown | undefined>('readonly', (s) => s.get(userId))
    .then((r) => {
      const seje = razvrstiSeje(normalizirajZapis(r))
      if (seje.length === 0) return null
      const seja = key ? seje.find((s) => s.key === key) : seje[0]
      return seja ? splosciSejo(userId, seja) : null
    })
    .catch(() => null)
}

/** Vse nedokončane seje uporabnika, najnovejša prva. */
export async function loadSeje (userId: string): Promise<DraftSeja[]> {
  if (!userId) return []
  return await tx<unknown | undefined>('readonly', (s) => s.get(userId))
    .then((r) => razvrstiSeje(normalizirajZapis(r)))
    .catch(() => [])
}

/**
 * Izbriše osnutek: samo ENO sejo (z `key`) ali VSE seje uporabnika (brez
 * `key`). Uporablja se ob confirm (seja) in ob »Zavrži« (seja) — izbris
 * vseh shramb ob odjavi opravi clearOfflineData.
 */
export async function clearDraft (userId: string, key?: string): Promise<void> {
  if (!userId) return
  if (!key) {
    await tx('readwrite', (s) => s.delete(userId)).catch(() => {})
    return
  }
  const obstojeca = await tx<unknown>('readonly', (s) => s.get(userId)).catch(() => null)
  const seje = normalizirajZapis(obstojeca).filter((s) => s.key !== key)
  if (seje.length === 0) {
    await tx('readwrite', (s) => s.delete(userId)).catch(() => {})
    return
  }
  await tx('readwrite', (s) => s.put({ userId, savedAt: new Date().toISOString(), seje } as MeasureDraftRecord)).catch(() => {})
}

// opomba: izbris VSEH shramb ob odjavi (tudi 'drafts') opravi clearOfflineData
// v offline.ts — skupna baza, isti vzorec R439 (brez krožnega uvoza).

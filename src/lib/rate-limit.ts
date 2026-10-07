// rate-limit — R437: skupni tempomat (rate limiter) za javne poti
// Izvorno je bil tempomat zasebni znotraj /api/public/portal; zdaj je skupen,
// da ga lahko varnostni modul (security.read) pregleduje in počišča.
// Zasnovano za lokalni pomnilnik enega procesa (isti vzorec kot izvirnik).

// okno 60 s, največ 60 zadetkov na bucket (enako public/portal izvirnika)
export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX = 60

// bucket key → časovni žigi zadetkov v oknu
const hits = new Map<string, number[]>()

/** Zabeleži zadetek; vrne true, če je bucket presegel omejitev (zahteva zavrnjena). */
export function rateLimited (key: string, max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS): boolean {
  const now = Date.now()
  const window = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (window.length >= max) {
    hits.set(key, window)
    return true
  }
  window.push(now)
  hits.set(key, window)
  if (hits.size > 1000) hits.clear() // preprosto čiščenje (kot izvirnik)
  return false
}

/**
 * Prikrije ključ bucketa — BREZ vrednosti žetonov (varnostni pregled ne sme razkriti povezav).
 * 'portal:pt-1a2b3c4d-…' → 'portal:pt-1a2…' (predpona poti + prvih 6 znakov žetona).
 */
export function maskKey (key: string): string {
  const sep = key.indexOf(':')
  const prefix = sep >= 0 ? key.slice(0, sep + 1) : ''
  const token = sep >= 0 ? key.slice(sep + 1) : key
  if (token.length <= 8) return prefix + '•'.repeat(token.length)
  return prefix + token.slice(0, 6) + '…'
}

export interface RateLimitBucketInfo {
  /** prikrit ključ (brez žetona) */
  bucket: string
  /** št. zadetkov v trenutnem oknu */
  hits: number
  /** zadnji dostop (epoch ms) */
  lastAt: number
}

/** Stanje tempomata za varnostni pregled — samo prikriti ključi in števci. */
export function rateLimitList (): { total: number; items: RateLimitBucketInfo[] } {
  const now = Date.now()
  const items: RateLimitBucketInfo[] = []
  for (const [key, stamps] of hits) {
    const window = stamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    if (window.length === 0) { hits.delete(key); continue }
    items.push({ bucket: maskKey(key), hits: window.length, lastAt: window[window.length - 1] })
  }
  items.sort((a, b) => b.hits - a.hits || a.bucket.localeCompare(b.bucket))
  return { total: items.length, items }
}

/**
 * Počisti bucket(e). Vrne št. odstranjenih.
 * @param key prikrit ključ iz liste ALI točen ključ (neodvisno od velikosti črk)
 */
export function rateLimitClear (key?: string): number {
  if (!key) {
    const n = hits.size
    hits.clear()
    return n
  }
  const needle = key.toLowerCase()
  let removed = 0
  for (const k of hits.keys()) {
    if (k.toLowerCase() === needle || maskKey(k).toLowerCase() === needle) {
      hits.delete(k)
      removed++
    }
  }
  return removed
}

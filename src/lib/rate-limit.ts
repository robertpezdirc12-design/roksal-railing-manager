// rate-limit — R437: skupni tempomat (rate limiter) za javne poti
// R536: PORAZDELJEN — stanje živi v bazi (RateLimitEntry), ne v pomnilniku
// procesa. Prej je bila Map `hits` vezana na posamezno instanco: na serverless
// (Vercel funkcije) vsaka instanca štela ZASE, zato tempomat ni zavoril
// porazdeljenega napada (ugotovita varnostne revizije 2-b/3). Sedaj vsi
// strežniki delijo eno tabelo — števec je globalen.
//
// SEMANTIKA: fiksno okno (windowStart = floor(now/windowMs)*windowMs) namesto
// prejšnjega drsečega. Standardni kompromis: na meji okna je možen izbruh do
// 2× max v eni minuti (konec enega okna + začetek naslednjega) — sprejemljivo,
// ker so meje (60/min, 30/min prijava) postavljene z veliko rezervo nad
// normalno rabo; v zameno dobimo atomarno štetje v bazi brez pomnilniškega
// stanja. zavrnitev = hits > max (enak prag kot prej: 61. zahteva v oknu).

import { createHash } from 'crypto'
import { db } from '@/lib/db'

// okno 60 s, največ 60 zadetkov na bucket (enako public/portal izvirnika)
export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX = 60

/** Začetek fiksenga okna, v katerega pade trenutek `now` (zaokrožen na windowMs). */
function windowStartFor (windowMs: number): Date {
  return new Date(Math.floor(Date.now() / windowMs) * windowMs)
}

/**
 * Zabeleži zadetek; vrne true, če je bucket presegel omejitev (zahteva zavrnjena).
 *
 * NAPAKA BAZE → console.error + false (FAIL-OPEN, namensko): če baza ne deluje,
 * itak ne deluje prijava/portal/cel API — tempomat ne sme biti plast, ki bi
 * ob izpadu baze POKOPALA aplikacijo še enkrat. Fail-closed bi pomenil: izpad
 * baze = vsi odjemalci vidijo 429 namesto prave napake. Log je sled za ops.
 */
export async function rateLimited (
  key: string,
  max = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS
): Promise<boolean> {
  const windowStart = windowStartFor(windowMs)
  try {
    const res = await db.rateLimitEntry.upsert({
      where: { bucket_windowStart: { bucket: key, windowStart } },
      create: { bucket: key, windowStart, hits: 1 },
      update: { hits: { increment: 1 } },
    })
    return res.hits > max
  } catch (err) {
    console.error('[rate-limit] napaka baze — dovoljeno (fail-open, saj brez baze itak nič ne deluje):',
      err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Ključ bucketa za žeton (portal/measure/viz/review …). ŽETONI NIKOLI SUROVI V
 * BAZI (disciplina R534, razširjena na tempomat R536): bucket nosi SAMO prvih
 * 16 hex znakov sha256(token) — dovolj za stabilen ključ, premalo za
 * kakršnokoli rekonstrukcijo žetona. 'portal' + 'pt-abc…' → 'portal:9f86d081…'.
 */
export function tokenBucketKey (prefix: string, token: string): string {
  return `${prefix}:${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
}

/**
 * Prikrije ključ bucketa — BREZ vrednosti žetonov (varnostni pregled ne sme razkriti povezav).
 * 'portal:1a2b3c4d5e6f7788' → 'portal:1a2b3c…' (predpona poti + prvih 6 znakov).
 * Od R536 je vrednost pod predpono že zgoščeni odsek žetona (tokenBucketKey),
 * prikrite pa ostane tudi IP (login:ip:203.0.…).
 */
export function maskKey (key: string): string {
  const sep = key.indexOf(':')
  const prefix = sep >= 0 ? key.slice(0, sep + 1) : ''
  const token = sep >= 0 ? key.slice(sep + 1) : key
  if (token.length <= 8) return prefix + '•'.repeat(token.length)
  return prefix + token.slice(0, 6) + '…'
}

// ─── Prijava / začetna namestitev (R496: brute-force vrata) ─────────────────

/**
 * Največ poskusov prijave na IP v oknu RATE_LIMIT_WINDOW_MS (60 s). Privzetih
 * 30/min je močna zavora proti napadu z gesli (sicer 1800 poskusov uro).
 *
 * R497, IZMERJENO: ista meja zadavi lastni regresijski pas — 22 skupin se
 * zaporedoma prijavlja z 127.0.0.1 in tretjina skupin je od 429 naprej padala na
 * `AssertionError: prijava admin@roksal.si: 429`. Zato je meja okoljsko
 * nastavljiva: v produkciji `AUTH_RATE_MAX` pusti prazen (30), lokalni pas in CI
 * ga dvigneta (tests/ci-local.sh ga nastavi sam).
 *
 * R536: števec je zdaj v bazi — meja velja VSEM instancam (prej: pomnilnik
 * posamezne funkcije).
 */
const AUTH_RATE_MAX_ENV = Number(process.env.AUTH_RATE_MAX)
export const AUTH_RATE_MAX =
  Number.isInteger(AUTH_RATE_MAX_ENV) && AUTH_RATE_MAX_ENV > 0 ? AUTH_RATE_MAX_ENV : 30

/** IP naslov odjemalca (Vercel in Caddy nastavita x-forwarded-for). */
export function requestIp (req: { headers: { get (name: string): string | null } }): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'neznano'
  return req.headers.get('x-real-ip')?.trim() || 'neznano'
}

/**
 * Vrata za prijavo in začetno namestitev (ključ login:ip:{ip} — IP ostane
 * navadna vrednost, saj ni skrivnost v smislu žetona). Od R536 asinhrona
 * (števec v bazi). Druga plast zavor je zaklep računa (AUTH_LOCKOUT_* v
 * auth.ts) — ta šteje POSAMEZEN račun, tempomat POSAMEZEN IP.
 */
export async function authRateLimited (req: { headers: { get (name: string): string | null } }): Promise<boolean> {
  return rateLimited(`login:ip:${requestIp(req)}`, AUTH_RATE_MAX)
}

export interface RateLimitBucketInfo {
  /** prikrit ključ (brez žetona/IP) */
  bucket: string
  /** št. zadetkov v oknu */
  hits: number
  /** zadnji dostop (epoch ms — začetek okna, v katerem so zadetki) */
  lastAt: number
}

/** Stanje tempomata za varnostni pregled — samo prikriti ključi in števci.
 * Bere AKTIVNO + PREJŠNJE okno (windowStart >= floor(now/60s)*60s − 60s):
 * meja fiksenga okna pomeni, da je bila zadnja minuta lahko razdeljena čez dve
 * okni — za pregled hočemo videti oboje. Starejše vrstice počisti janitor
 * (jobs.ts seje-gc, 5 min). */
export async function rateLimitList (): Promise<{ total: number; items: RateLimitBucketInfo[] }> {
  const cutoff = new Date(Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS - RATE_LIMIT_WINDOW_MS)
  const rows = await db.rateLimitEntry.findMany({ where: { windowStart: { gte: cutoff } } })
  const items: RateLimitBucketInfo[] = rows.map((r) => ({
    bucket: maskKey(r.bucket),
    hits: r.hits,
    lastAt: r.windowStart.getTime(),
  }))
  items.sort((a, b) => b.hits - a.hits || a.bucket.localeCompare(b.bucket))
  return { total: items.length, items }
}

/**
 * Počisti bucket(e). Vrne št. odstranjenih vrstic (en bucket ima lahko več
 * okenskih vrstic — aktivno + prejšnje).
 * @param key prikrit ključ iz liste ALI točen ključ (neodvisno od velikosti črk)
 */
export async function rateLimitClear (key?: string): Promise<number> {
  if (!key) {
    const r = await db.rateLimitEntry.deleteMany({})
    return r.count
  }
  // maskKey je JS funkcija — ujemanje po prikriti obliki izračunamo na strani
  // aplikacije (bucketov je malo, pošteno in pregledno).
  const needle = key.toLowerCase()
  const rows = await db.rateLimitEntry.findMany({ select: { bucket: true }, distinct: ['bucket'] })
  const targets = rows.map((r) => r.bucket).filter((b) => b.toLowerCase() === needle || maskKey(b).toLowerCase() === needle)
  if (targets.length === 0) return 0
  const r = await db.rateLimitEntry.deleteMany({ where: { bucket: { in: targets } } })
  return r.count
}

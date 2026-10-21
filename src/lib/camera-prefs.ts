// /src/lib/camera-prefs.ts — R509 (issue #7 §9): SPOMIN NA MONTERJEVE NASTAVITVE
// Kamere.
//
// Doslej je vsak zagon kamere začel znova (zadnja kamera, svetilka izklopljena),
// kar je na terenu pomenilo dva odvečna klika in — pri starejših monterjih —
// izgubljen preklop na prednjo kamerko. Nastavitve so shranjene LOCALNO, ker so
// to lastnosti naprave, ne poslovni podatek: gre v `localStorage`, ne v bazo.
//
// R573: istemu spominu je dodana še izbira VODIL (mreža tretjin + vodoravnica
// + središče). Vzorec najboljših kamer: iPhone Settings > Camera > Grid in
// Samsung Camera > Grid lines si izbiro ZAPOMNITA — monter, ki je črte enkrat
// izklopil, jih noče videti vsakič znova. Privzeto ostajajo VKLOPLJENA (R455
// §4 — poravnava ograje ob vodoravnici je del naloge, ne okras).
//
// Dve poštenosti, ki ju narekuje §7:
//   • shranjeno stanje je NIKOLI ukaz napravi. Svetilka se ob ponovnem obisku
//     SAMODEJNO NE prižge — shrani se samo to, da je monter jo nazadnje imel
//     prižgano, da se mu to omeni;
//   • neveljaven/zastarel zapis pade na PRIVZETO, ne na »nazadnje znano«.
//     Bralnik brez shrambe (SSR, privatni način, poln disk) dobi privzeto in
//     noben del aplikacije ne trdi, da si je monter kaj izvolil.

import { napisSmeri, type SmerKamere } from '@/lib/camera-capabilities'

export const PREFS_KLJUC = 'roksal:kamera:nastavitve:v1'

/** Minimalen vmesnik localStorage — DOM-free testni mock je en objekt. */
export interface Shramba {
  getItem (k: string): string | null
  setItem (k: string, v: string): void
}

export interface KameraNastavitve {
  smer: SmerKamere
  /** Ali je imel monter svetilko nazadnje prižgano. NE pomeni, da je prižgana. */
  svetilkaNazadnje: boolean
  /** R573: ali ima monter radi vodila (mreža) v živem predogledu. */
  vodila: boolean
}

export const PRIVZETE_NASTAVITVE: KameraNastavitve = { smer: 'environment', svetilkaNazadnje: false, vodila: true }

/**
 * Brskalnikova shramba ali `null` (SSR, privatni način, zaprt dostop).
 * Shramba, ki dovoli branje a zavrne pisanje, je še vedno veljavna — zato
 * `zapisiNastavitve` klice ovija in try/catch.
 */
export function shramba (): Shramba | null {
  if (typeof window === 'undefined') return null
  try {
    const s = window.localStorage
    if (!s) return null
    return {
      getItem: (k: string) => { try { return s.getItem(k) } catch { return null } },
      setItem: (k: string, v: string) => s.setItem(k, v),
    }
  } catch { return null }
}

/** Prebere nastavitve. Karkoli ni prepoznavno → privzeto (nikoli izmišljeno stanje). */
export function preberiNastavitve (s: Shramba | null): KameraNastavitve {
  if (!s) return PRIVZETE_NASTAVITVE
  let surovo: Record<string, unknown> | null = null
  try {
    const v = s.getItem(PREFS_KLJUC)
    surovo = v ? JSON.parse(v) as Record<string, unknown> : null
  } catch { surovo = null }
  if (!surovo) return PRIVZETE_NASTAVITVE
  const smer = surovo.smer === 'user' || surovo.smer === 'environment' ? surovo.smer : PRIVZETE_NASTAVITVE.smer
  // R573: vodila — samo IZRIČEN `false` pomeni izklop; starejši zapisi (brez
  // polja) in smeti padejo na privzeti VKLOP (R455), nikoli na »ugasnjeno«.
  const vodila = surovo.vodila === false ? false : PRIVZETE_NASTAVITVE.vodila
  return { smer, svetilkaNazadnje: surovo.svetilkaNazadnje === true, vodila }
}

/** Zapiše nastavitve. Vrne `false`, ko pisanje ni mogoče (poln disk / privatni način). */
export function zapisiNastavitve (s: Shramba | null, n: KameraNastavitve): boolean {
  if (!s) return false
  try {
    s.setItem(PREFS_KLJUC, JSON.stringify({ smer: n.smer, svetilkaNazadnje: n.svetilkaNazadnje === true, vodila: n.vodila === true }))
    return true
  } catch { return false }
}

/** Merge čez obstoječe nastavitve — smer (zadnja izbrana kamera). */
export function nastaviSmer (s: Shramba | null, smer: SmerKamere): boolean {
  return zapisiNastavitve(s, { ...preberiNastavitve(s), smer })
}

/** Merge čez obstoječe nastavitve — svetilka: shrani SAMO nameravano stanje. */
export function nastaviSvetilko (s: Shramba | null, na: boolean): boolean {
  return zapisiNastavitve(s, { ...preberiNastavitve(s), svetilkaNazadnje: na === true })
}

/** R573: merge čez obstoječe nastavitve — vodila (mreža v predogledu). */
export function nastaviVodila (s: Shramba | null, na: boolean): boolean {
  return zapisiNastavitve(s, { ...preberiNastavitve(s), vodila: na === true })
}

/**
 * Vrstica o spominu. `svetilkaNazadnje` se izpiše SAMO, kadar je bila prižgana
 * in svetilke trenutno nimamo prižgane — sicer je prazen niz, da UI ne šumi.
 */
export function napisNastavitev (n: KameraNastavitve, torchNa = false): string {
  const smer = `Zadnja smer: ${napisSmeri(n.smer)}`
  if (n.svetilkaNazadnje && !torchNa) return `${smer} · nazadnje ste imeli prižgano svetilko`
  return smer
}

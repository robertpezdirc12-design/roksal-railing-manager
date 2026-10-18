// nagib-core — R558 (raziskava R557, V1.1): NAKLONOMER za stopniške ograje.
//
// NAJDENA VRZEL: stopniške ograje so po raziskavi (muzatarailing 2023,
// sandiegocablerailings 2021) največji vir napak v ponudbah — kot stopnice
// določa vSEG geometrijo (višine stebrov, dolžine panojev, rezovi). Apple
// Measure ima »level« način; mi nismo imeli NIČESAR.
//
// ARHITEKTURA (ista disciplina kot kamera-referenca, R508):
//   RELATIVNA GRAVITACIJSKA METODA — dvojna izmera, BREZ absolute formule.
//   Prejšnja seja je žiroskopsko vodoravnico ZAVESTNO odlašala (r553:
//   »neoverjena formula za roll iz beta/gamma bi bila laž«). To drži —
//   zato NE izračunavamo kota iz absolutnih beta/gamma (konvencija se
//   razlikuje med platformami in je ne moremo obljubiti). Namesto tega:
//
//     1. Korak 1: monter položi telefon na znano VODORAVNO površino
//        (tread stopnice / podest / tla — vodoravnost zagotovi gradnja)
//        in zajame NIČLO → zapis pospeška vključno z gravitacijo g0.
//     2. Korak 2: monter položi telefon NA DESKO/ploščo, ki leži čez
//        več zobcev stopnice → živi pospešek g1.
//     3. Kot naklona površine = arccos(g0·g1 / (|g0|·|g1|)).
//
//   Kot med dvema vektorjema IZ ISTEGA senzorja v isti seji je neodvisen
//   od znaka konvencij platforme (Chrome y+ pokončno vs Safari y− —
//   pri relativni metodi se razlika pokrajša, saj množimo isti sistem
//   s seboj). Enak princip kot kamera-referenca: NAPRAVA izmeri, mi
//   ne predpostavimo.
//
// POŠTENOST (issue §7, enako kot kamera-capabilities):
//   • pospešek veljaven SAMO kadar telefon miruje (|g| ≈ g): če monter
//     telefona premika, vrednost NI zaupanja vredna → opozorilo, ne številka;
//   • kot > 90° pomeni, da je bil telefon med merami OBRAČAN (ekran dol) →
//     poročamo 180°−kot + opozorilo (nikoli ne prikažemo napačne številke);
//   • brez podatka o senzorjih (iOS dovoljenje, http kontekst) → NI_DOKAZA
//     z razlogom; monter vedno ostane pri ročnem vnosu (padec, ne izguba).

export interface Pospesek {
  x: number
  y: number
  z: number
}

/**
 * Veljavnost pospeška vključno z gravitacijo (accelerationIncludingGravity).
 * Mirovanje: |g| ≈ 9,81 m/s². Okno ±20 % (7,81–11,77) pokrije kalibracijo
 * senzorja (cenični pospeškomerji odstopajo ±5 %) in ZAVRNE merjenje med
 * gibanjem (hoja z telefonom da |g| 5–15 z veliko smerjo naključja).
 */
export function veljavnostPospeska (g: Pospesek | null | undefined): { veljavno: boolean; velikost: number; razlog: string | null } {
  if (g == null) return { veljavno: false, velikost: 0, razlog: 'Senzor ne poroča pospeška.' }
  const xs = [g.x, g.y, g.z]
  if (!xs.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return { veljavno: false, velikost: 0, razlog: 'Senzor je poročal neveljavno vrednost.' }
  }
  const velikost = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z)
  if (velikost < 7.81 || velikost > 11.77) {
    return {
      veljavno: false,
      velikost: Math.round(velikost * 100) / 100,
      razlog: 'Telefon se premika — držite ga mirno vsako sekundo, da izmeri gravitacijo.',
    }
  }
  return { veljavno: true, velikost: Math.round(velikost * 100) / 100, razlog: null }
}

/**
 * Povprečje 1–8 vzorcev (glajenje šuma ceničnega senzorja). Prazno ali
 * z neveljavnimi vzorci → null (brez ugibanja).
 */
export function povprecjePospeskov (vzroci: Pospesek[] | null | undefined): Pospesek | null {
  if (!Array.isArray(vzroci) || vzroci.length === 0 || vzroci.length > 8) return null
  let sx = 0, sy = 0, sz = 0, n = 0
  for (const v of vzroci) {
    if (v == null) continue
    if (![v.x, v.y, v.z].every((c) => typeof c === 'number' && Number.isFinite(c))) continue
    sx += v.x; sy += v.y; sz += v.z; n++
  }
  if (n === 0) return null
  return { x: sx / n, y: sy / n, z: sz / n }
}

/**
 * Kot med dvema pospeškoma (stopinje, [0, 180], zaokroženo na 0,1°).
 * Relativna metoda: g0 = ničla na vodoravni referenci, g1 = trenutna
 * lega. Vrne null, kadar katerikoli vektor ni uporaben (dolžina ~0 ali
 * neveljavni vnosi) — nikoli ne vrnemo izmišljene številke.
 */
export function kotMedPospeskoma (g0: Pospesek | null | undefined, g1: Pospesek | null | undefined): number | null {
  if (g0 == null || g1 == null) return null
  const n0 = Math.sqrt(g0.x * g0.x + g0.y * g0.y + g0.z * g0.z)
  const n1 = Math.sqrt(g1.x * g1.x + g1.y * g1.y + g1.z * g1.z)
  if (!Number.isFinite(n0) || !Number.isFinite(n1) || n0 < 1e-6 || n1 < 1e-6) return null
  const dot = g0.x * g1.x + g0.y * g1.y + g0.z * g1.z
  const cos = Math.min(1, Math.max(-1, dot / (n0 * n1)))
  const deg = Math.acos(cos) * 180 / Math.PI
  if (!Number.isFinite(deg)) return null
  return Math.round(deg * 10) / 10
}

/**
 * Normalizacija kota površine: kot med ekranom-gor legami je [0, 90].
 * > 90° pomeni, da je bil telefon med merami obrnjen (ekran dol) —
 * geometrija plošče je enaka (180°−kot), zato poročamo to, a z OPOZORILOM
 * (razlog mora biti viden, ne skrit).
 */
export function normalizirajKotPovrsine (deg: number | null): { deg: number | null; obrnjeno: boolean } {
  if (deg == null || !Number.isFinite(deg)) return { deg: null, obrnjeno: false }
  if (deg <= 90) return { deg: Math.round(deg * 10) / 10, obrnjeno: false }
  return { deg: Math.round((180 - deg) * 10) / 10, obrnjeno: true }
}

/** Format kota za prikaz: 35,5° (slovenska decimalna vejica). */
export function formatKota (deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return '—'
  return `${deg.toFixed(1).replace('.', ',')}°`
}

/** Domenska kategorija naklona (ograje/stopnice, po literaturi 30–38°). */
export function kategorijaNaklona (deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return 'brez podatka'
  if (deg < 1) return 'vodoravno'
  if (deg < 10) return 'blago nagnjeno'
  if (deg < 25) return 'zmerno nagnjeno'
  if (deg < 45) return 'strmo (typično stopnišče)'
  return 'zelo strmo — preverite izmero'
}

/**
 * Predlog vrednosti za vnos naklona (slopeInput): 1 decimala, decimalna
 * PIKA (vhodi sprejemajo vejico, pretvorba je na strani vnosa).
 */
export function vrednostZaVnos (deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return ''
  return (Math.round(deg * 10) / 10).toFixed(1)
}

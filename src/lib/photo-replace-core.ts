// photo-replace-core — R459 (issue #14: REALISTIC PHOTO REPLACEMENT)
// Deterministični PERSPEKTIVNI PROJEKCIJSKI engine za fotorealistično zamenjavo
// obstoječe ograje na ORIGINALNI fotografiji:
//   ORIGINAL → IDENTIFIKACIJA (quad) → ODSTRANITEV (mehko prekrivanje) → NOVA
//   ROKSAL OGRAJA (perspektivna projekcija iz konfiguracije) → PREJ/POTEM.
//
// Načela (issue #14):
//  - §1  originalna fotografija ostane vir slike — hiša/tla/okolica se NE risajo;
//  - §2  videz izdelka IZKLJUČNO iz ROKSAL konfiguracije (izdelek/varianta/RAL,
//         lamele/razmiki iz produktnih podatkov) — nikoli generični model;
//  - §6  geometrija sledi konfiguraciji/meritvi; vizualizacija NI vir proizvodnih
//         mer (žig VIZUALIZACIJA ZA PREDSTAVITEV, §15);
//  - §10 BREZ runtime AI — čista deterministična perspektivna projekcija
//         (fallback, ki deluje na vsaki napravi: fotografija + ročna označitev
//         + referenčna mera + perspektivna projekcija).
//
// Čist client-safe TS (brez 'use client', brez strežniških uvozov) — enaka
// logika na odjemalcu (živi predogled) in v testih.

import {
  PRAG_ROCNEGA_POSEG, maskaIzQuada, ploscina, ploscinaSkupine,
  type Maska, type Oblika,
} from './photo-replace-mask'
import {
  celiceZaElement, projekcijaIzRavnine, vzorciTeksturo, type Pravokotnik, type VirTeksture,
} from './photo-replace-texture'

// ─── Verzija engine-a (§13 revizija: katera verzija je izrisala sliko) ──────
// R523 (1.2.0): DETAJL pred FOTO_IZDELEK v izbiri gradiva + množica izrezov
// (vsaka letvica fasade dobi svojo desko) + čipi uradne lestvice KUBO.
// R524 (1.3.0): čipi uradnih lestvic za OGRAJE (POLNA 57/100/128 + ROMB 67;
// 24 DETAJL gradiv po varianti) — mreža celic kot doslej (izoliran poskus:
// 9/10 proti 6/10 za podizrez+zrcalo), UI pa vir rotira po izmeri smeri
// vlaken (izmeriSmerVlaken), da vlakna tečejo VZDOLŽ palice/deskе.
// R532 (1.4.0): HARMONIZACIJA BARV PRIZORA (raziskava 16. 10. 2026 — issue #14
// §4 »umerjanje … svetlosti in senc, ki temelji na fotografiji«, razširjeno na
// barvni ton): vezani barvni namig iz pasov neba/tal okoli označenega območja —
// nevtralen prizor pusti barvo izdelka NEDOTIKNJENO, topel/hladen prizor pa
// zamakne osnovni ton za največ HARMONIZACIJA_MEJE.zamik po kanalu (jakost 35 %).
// Deterministično, brez AI; meje spodaj.
// R536 (ostaja 1.4.0): seme izrisa se zapiše V renderParams (params.seme) —
// izrisna funkcija za dane vhode (vključno s seme) je NESPREMENJENA, stari
// zapisi brez semena se izrišejo bajtno identično (izpeljava iz savedId na
// odjemalcu ostane kot vzporedna združljivost). Struktura zapisa se spremeni
// (novo neobvezno polje), raster pa ne — zato verzija motorja ostaja 1.4.0.
export const ENGINE_VERSION = '1.4.0'

/** §15: obvezni žig na vsaki POTEM sliki in zaslonu. */
export const VIZ_ZIG = 'VIZUALIZACIJA ZA PREDSTAVITEV'

// ─── Barve RAL (§3: dejanski vizualni izgled, ne samo hex) ───────────────────

/** Pogosti RAL kodi → hex (približek standarda RAL classic). */
export const RAL_HEX: Record<string, string> = {
  'RAL 7016': '#383e42', 'RAL 7024': '#474a50', 'RAL 7005': '#646b6f',
  'RAL 7035': '#d5d8d5', 'RAL 7040': '#9da3a6', 'RAL 9005': '#0e0e10',
  'RAL 9007': '#878581', 'RAL 9010': '#f1f0ea', 'RAL 9016': '#f1f0ea',
  'RAL 9003': '#f4f4f4', 'RAL 1015': '#e6d690', 'RAL 1018': '#f8f32b',
  'RAL 3005': '#59191f', 'RAL 3013': '#781f19', 'RAL 5010': '#0e518d',
  'RAL 6005': '#114232', 'RAL 6018': '#57a639', 'RAL 6009': '#26392f',
  'RAL 8017': '#38251c', 'RAL 8004': '#8d4931', 'RAL 9006': '#a5a8a6',
}

/** RAL kodi (npr. „RAL 7016") → hex; neznani → fallback. */
export function ralHex (ral: string | null | undefined, fallback = '#383e42'): string {
  if (!ral) return fallback
  return RAL_HEX[ral.trim().toUpperCase()] ?? fallback
}

// ─── R517 (issue #14 §3): WPC odtenki IZ URADNIH ROKSALOVIH BARVNIH LESTVIC ──
//
// Zakaj: WPC ograje (OGRAJA_PRECNA/OGRAJA_POKOCNA) nimajo RAL kode — varianta
// nosi samo IME odtenka (npr. »Golden teak«). Doslej je izris zato vzel RAL
// fallback #383e42 (temno siva), ne glede na izbrano barvo — uporabnik je
// izbral »Golden teak« in videl sivo ograjo.
//
// Hex vrednosti niso izmišljene: izračunane so kot MEDIANA vzorcev vseh
// preverjenih uradnih lestvic v repozitoriju
// (public/assets/roksal/src/roksal-barvna-lestvica-*.png — ProductAsset kind
// BARVNA_LESTVICA, status VERIFIED), poimenovanje pa je enako `colorName` na
// preverjenih variantnih gradivih. Kot pri RAL_HEX gre za približek
// (zaslonska vzorca niso kolorimetrična), vendar iz KATALOGA, ne po občutku.

export const ODTENKI_HEX: Record<string, string> = {
  'Amazon wood': '#5e5e61',
  'Ash wood': '#8f8f91',
  'Burma teak': '#8d756d',
  'Golden teak': '#a27e76',
  'Oak wood': '#b0917c',
  'Rustic oak': '#9c8061',
  'Rustic walnut': '#71675c',
  'White': '#c4c3c2',
}

/** Ime odtenka iz kataloga (varianta.color) → hex; neznano → fallback. */
export function odtenekHex (color: string | null | undefined, fallback = '#383e42'): string {
  if (!color) return fallback
  return ODTENKI_HEX[color.trim()] ?? fallback
}

/** Barva variante: RAL ima prednost, sicer odtenek iz uradne lestvice. */
export function barvaVariante (variant: { ral?: string | null; color?: string | null } | null | undefined, fallback = '#383e42'): string {
  if (!variant) return fallback
  if (variant.ral) return ralHex(variant.ral, fallback)
  return odtenekHex(variant.color, fallback)
}

// ─── Materiali izdelka (§3: ALU/INOX/les + mat/sijaj/struktura) ──────────────

export type MaterialVrsta = 'ALU' | 'INOX' | 'WPC' | 'LES' | 'KOVO'

export interface MaterialInfo {
  vrsta: MaterialVrsta
  /** sijaj površine 0 (mat) … 1 (visok sijaj) — vpliva na odsev */
  sijaj: number
  /** moč struktur (črtkanje / lesna tekstura) 0 … 1 */
  struktura: number
}

const MATERIALI: Record<MaterialVrsta, MaterialInfo> = {
  ALU: { vrsta: 'ALU', sijaj: 0.45, struktura: 0.15 },
  INOX: { vrsta: 'INOX', sijaj: 0.8, struktura: 0.35 },
  WPC: { vrsta: 'WPC', sijaj: 0.15, struktura: 0.8 },
  LES: { vrsta: 'LES', sijaj: 0.12, struktura: 0.9 },
  KOVO: { vrsta: 'KOVO', sijaj: 0.35, struktura: 0.1 },
}

/** Prebere material iz tech JSON izdelka (npr. {"material":"Aluminij", …}). */
export function materialIzTecha (tech: string | null | undefined): MaterialInfo {
  let raw: Record<string, unknown> = {}
  try {
    if (tech) raw = JSON.parse(tech) as Record<string, unknown>
  } catch { /* neveljaven JSON → privzeto ALU */ }
  const m = typeof raw.material === 'string' ? raw.material.toLowerCase() : ''
  if (m.includes('inox') || m.includes('v2a') || m.includes('1.43')) return MATERIALI.INOX
  if (m.includes('wpc')) return MATERIALI.WPC
  if (m.includes('les') || m.includes('wood')) return MATERIALI.LES
  if (m.includes('kovano') || m.includes('železo')) return MATERIALI.KOVO
  return MATERIALI.ALU
}

/**
 * Širina lamel/desk v mm iz tech JSON izdelka. R517: poleg eksplicitnih ključev
 * (lameleMm / lamele) se širina prebere IZ IMENA PROFILA — Roksalovi profili
 * nosijo širino v imenu (»ROMB 67« = 67 mm, »POLNA DESKA 128« = 128 mm,
 * »POLNA DESKA 57/32« = 57 mm širine / 32 mm debeline, »KLASIK 150×25« =
 * 150 mm × 25 mm). Doslej je izris za vse te izdelke vzel privzeti 70 mm —
 * POLNA 128 bi tako dobila skoraj dvakrat preveč desk (napačna razmerja).
 */
export function lameleIzTecha (tech: string | null | undefined): number | null {
  let raw: Record<string, unknown> = {}
  try {
    if (tech) raw = JSON.parse(tech) as Record<string, unknown>
  } catch { return null }
  if (typeof raw.lameleMm === 'number' && Number.isFinite(raw.lameleMm)) return raw.lameleMm
  if (typeof raw.lamele === 'string') {
    const m = /(\d{2,3})/.exec(raw.lamele)
    if (m) return Number(m[1])
  }
  // R517: širina iz imena profila — PRVA številka je širina v mm.
  // »ROMB 67« → 67; »POLNA DESKA 128« → 128; »57/32« → 57 (širina/debelina);
  // »KLASIK 150×25« → 150. Vrača SAMO smiselne širine 40..300 mm.
  if (typeof raw.profil === 'string') {
    const m = /(\d{2,3})\s*(?:[×x/]\s*\d{1,3})?/.exec(raw.profil)
    if (m) {
      const w = Number(m[1])
      if (Number.isFinite(w) && w >= 40 && w <= 300) return w
    }
  }
  return null
}

/**
 * R520 (issue #14): širina deske v mm iz IMENA izdelka. Roksalova terasna
 * deska nosi mero v imenu: »WoodCore WPC terasna deska KLASIK 150×25« →
 * 150 mm širine × 25 mm debeline (uradno tudi na roksal.com: »Dimenzije:
 * 150 x 25 x 4000 ali 2200 mm«). Vrača SAMO smiselne širine 40..300 mm.
 */
export function sirinaIzImena (ime: string | null | undefined): number | null {
  if (typeof ime !== 'string') return null
  const m = /(\d{2,3})\s*[×x]\s*\d{1,3}/.exec(ime)
  if (m) {
    const w = Number(m[1])
    if (Number.isFinite(w) && w >= 40 && w <= 300) return w
  }
  return null
}

/**
 * R518 (issue #14): razmik (reža) med deskami/palicami v mm iz tech JSON.
 * Roksalovi tech podatki nosijo »razmakDeskMm« kot število ali kot obseg —
 * npr. POLNA DESKA 128/100: »5–30 (priporočeno)«. Pri obsegu vzamemo
 * SREDINO (zaokroženo), ker je to edina vrednost, ki jo katalog zagovarja za
 * celoten priporočen obseg. Vrača SAMO smiselne razmike 0..80 mm; drugače
 * null (UI ohrani svojo privzeto vrednost, ki jo uporabnik lahko spremeni).
 */
export function rezaIzTecha (tech: string | null | undefined): number | null {
  let raw: Record<string, unknown> = {}
  try {
    if (tech) raw = JSON.parse(tech) as Record<string, unknown>
  } catch { return null }
  const v = raw.razmakDeskMm
  if (typeof v === 'number' && Number.isFinite(v)) {
    const r = Math.round(v)
    return r >= 0 && r <= 80 ? r : null
  }
  if (typeof v === 'string') {
    // obseg »5–30« / »5-30« MORA biti prej kot enojno število (drugače bi
    // enojni regex vzel prvo številko obsega)
    const ms = /(\d{1,2})\s*[–—-]\s*(\d{1,2})/.exec(v)
    if (ms) {
      const a = Number(ms[1]), b = Number(ms[2])
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a && a >= 0 && b <= 80) {
        return Math.round((a + b) / 2)
      }
    }
    const m = /(\d{1,2})/.exec(v)
    if (m) {
      const r = Number(m[1])
      return r >= 0 && r <= 80 ? r : null
    }
  }
  return null
}

/** Višina ograje v mm iz tech JSON (npr. {"visina":"1000 mm"}). */
export function visinaIzTecha (tech: string | null | undefined): number | null {
  let raw: Record<string, unknown> = {}
  try {
    if (tech) raw = JSON.parse(tech) as Record<string, unknown>
  } catch { return null }
  if (typeof raw.visinaMm === 'number' && Number.isFinite(raw.visinaMm)) return raw.visinaMm
  if (typeof raw.visina === 'string') {
    const m = /(\d{3,4})/.exec(raw.visina)
    if (m) return Number(m[1])
  }
  return null
}

// ─── Vhodni model (renderParams — isto ime kot v bazi) ───────────────────────

export interface Tocka { x: number; y: number }

export type TipPolnila = 'POKOCNA' | 'PRECNA' | 'STEKLO' | 'FASADA' | 'TERASA'
export type NacinPritrditve = 'TALNA' | 'STEBRI_V_BETON' | 'BOCNA_NA_STENO'

// ── R520 (issue #14): FASADE in TERASE — uradni ROKSAL podatki (roksal.com) ──
//
// Viri (prebrani 2026-10-15 z branjem spleta, enak vir ki ga navaja tech.vir):
//  • KUBO fasadna deska: »80 x 42 x 5800 mm ali 80 x 42 x 5000 mm (samo
//    Amazon Wood in Rustic Walnut)« — https://roksal.com/en/woodcore-wpc-boards/wpc-facade-boards
//  • KUBO se na fasadi montira SAMO NAVPIČNO: »The kubo profile can only be
//    mounted vertically« — isti vir. Pritrditev je ZADAJ (skrita), ne vidna.
//  • Razmik KUBO letvic je PO LJUBNEM: »Letvice se pritrjujejo na horizontalno
//    nameščene, prašno barvane alu cevi, razmak med letvicami je poljuben« —
//    https://roksal.com/woodcore-wpc-deske/montaza-wpc-deske. Privzeti 20 mm
//    je IZMERJEN z dveh VERIFIED namestitvenih fotografij (b6cd18418118 ≈ 21 mm,
//    3a7bccebb297 ≈ 15 mm — ops/r520-izmeri.mjs); uporabnik ga lahko spremeni.
//  • Terasna reža: »Med deskami je razmak 5-6mm« — uradni FAQ
//    https://roksal.com/woodcore-wpc-deske/wpc-deske-za-teraso/ → privzeto 6 mm
//    (zgornja meja uradnega obsega). Programska izmera s fotografij pri KLASIK
//    ni zanesljiva (rebrasta površina dela lažne prehode — dokumentirano v
//    ops/r520-izmeri.mjs), zato je vir URADNI podatek, ne piksli.
/** širina KUBO fasadne deske v mm (uradno 80 × 42). */
export const FASADA_SIRINA_MM = 80
/** privzeti razmik KUBO letvic v mm (uradno: poljuben; izmerjeno 15–21 mm). */
export const FASADA_REZA_MM = 20
/** privzeta terasna reža v mm (uradni FAQ: 5–6 mm → zgornja meja). */
export const TERASA_REZA_MM = 6

export interface VizConfig {
  tip: TipPolnila
  /** prikazna dolžina ograje v cm (lahko ≠ potrjena mera → opozorilo §6/§15) */
  lengthCm: number
  heightCm: number
  posts: number
  handrail: boolean
  /** širina pokončne palice/lamele v mm (POKOCNA) */
  lamelaMm: number
  /** razmik med palicami v mm (POKOCNA) ali med deskami (PRECNA) */
  rezaMm: number
  /** višina horizontalne deske v mm (PRECNA) */
  deskaMm: number
  pritrditev: NacinPritrditve
  /** ali so vijaki vidni (§5) */
  vijaki: boolean
}

export interface VizReference {
  tip: 'MERITEV' | 'ROCNO'
  /** dolžina SPODNJEGA roba označenega območja v cm */
  cm: number
  opis?: string
}

export interface RenderParams {
  /** 4 vogalne točke obstoječe ograje, normalizirane 0..1 na fotografiji:
   *  [spodaj-levo, spodaj-desno, zgoraj-desno, zgoraj-levo] */
  quad: [Tocka, Tocka, Tocka, Tocka]
  reference: VizReference
  config: VizConfig
  /**
   * R507 (issue #14 §1): ročno popravljiva maska — območja STARE ograje,
   * izpusti in PREDNJI plan. Odsotna = samo quad (stare vizualizacije ostanejo
   * veljavne in se izrišejo enako kot prej).
   */
  maska?: Maska
  /**
   * R536: seme izrisa (zrno za mulberry32 `prng`) — celo število 0..2³²−1.
   * Ob nastanku variante ga generira odjemalec (crypto naključje) in se
   * SHRANI s parametri, da ponovni izris istega zapisa reproducira ISTI izris
   * NEODVISNO od id-ja zapisa (prej je bilo seme izpeljano iz savedId: isti
   * renderParams pod novim id-jem = drugačen izris).
   * Odsotno (zapisi pred R536) = izpeljava na odjemalcu iz savedId kot doslej
   * (bajtno identičen izris starih zapisov). Strežnik ga validira
   * (preveriRenderParams); neveljavna vrednost se tiho izpusti (fail-closed).
   */
  seme?: number
}

/** Maska za izris: ročna, ali pa kvad kot doslej (en vir resnice za UI in test). */
export function maskaZaIzris (params: RenderParams): Maska {
  return params.maska ?? maskaIzQuada(params.quad)
}

// ─── Homografija: enotski kvadrat → quad (perspektivna projekcija) ───────────

/** Reši 8×8 linearni sistem (Gaussova eliminacija). */
function resisiSistem (A: number[][], b: number[]): number[] | null {
  const n = 8
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-10) return null
    ;[M[col], M[piv]] = [M[piv], M[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / M[col][col]
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map((row, i) => row[n] / M[i][i])
}

export interface Homografija {
  /** (u, v) ∈ [0,1]² → točka v slikovnih pikslih */
  toPx (u: number, v: number): Tocka
}

/** Izračuna preslikavo enotskega kvadrata na 4-točkovni quad. */
export function homografijaIzQuada (q: [Tocka, Tocka, Tocka, Tocka]): Homografija | null {
  // (0,0)→q0 (1,0)→q1 (1,1)→q2 (0,1)→q3
  const A: number[][] = []
  const b: number[] = []
  const rows: [number, number, Tocka][] = [[0, 0, q[0]], [1, 0, q[1]], [1, 1, q[2]], [0, 1, q[3]]]
  for (const [u, v, p] of rows) {
    A.push([u, v, 1, 0, 0, 0, -u * p.x, -v * p.x]); b.push(p.x)
    A.push([0, 0, 0, u, v, 1, -u * p.y, -v * p.y]); b.push(p.y)
  }
  const h = resisiSistem(A, b)
  if (!h) return null
  return {
    toPx (u: number, v: number): Tocka {
      const d = h[6] * u + h[7] * v + 1
      if (Math.abs(d) < 1e-9) return { x: q[0].x, y: q[0].y }
      return { x: (h[0] * u + h[1] * v + h[2]) / d, y: (h[3] * u + h[4] * v + h[5]) / d }
    },
  }
}

/** Razdalja med dvema točkama. */
export function razdalja (a: Tocka, b: Tocka): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// ─── Validacija (ista pravila na odjemalcu in strežniku) ─────────────────────

export interface ValidacijskaNapaka { polje: string; sporocilo: string }

export function preveriQuad (quad: unknown): { napake: ValidacijskaNapaka[]; quad: [Tocka, Tocka, Tocka, Tocka] | null } {
  const napake: ValidacijskaNapaka[] = []
  if (!Array.isArray(quad) || quad.length !== 4) {
    return { napake: [{ polje: 'quad', sporocilo: 'Območje ograje zahteva natanko 4 točke.' }], quad: null }
  }
  const pts: Tocka[] = []
  quad.forEach((p, i) => {
    if (typeof p !== 'object' || p === null || typeof (p as Tocka).x !== 'number' || typeof (p as Tocka).y !== 'number' ||
      !Number.isFinite((p as Tocka).x) || !Number.isFinite((p as Tocka).y)) {
      napake.push({ polje: `quad[${i}]`, sporocilo: `Točka ${i + 1} ni veljavna.` })
      return
    }
    const t = p as Tocka
    if (t.x < 0 || t.x > 1 || t.y < 0 || t.y > 1) {
      napake.push({ polje: `quad[${i}]`, sporocilo: `Točka ${i + 1} je izven fotografije.` })
    }
    pts.push({ x: t.x, y: t.y })
  })
  if (napake.length > 0 || pts.length !== 4) return { napake, quad: null }
  const q = pts as [Tocka, Tocka, Tocka, Tocka]
  // degeneriran quad: spodnji rob ali stranski rob dolžine 0
  if (razdalja(q[0], q[1]) < 1e-4 || razdalja(q[3], q[2]) < 1e-4) {
    napake.push({ polje: 'quad', sporocilo: 'Spodnji ali zgornji rob območja je degeneriran (ničelna dolžina).' })
  }
  return { napake, quad: napake.length > 0 ? null : q }
}

export function preveriConfig (cfg: unknown): { napake: ValidacijskaNapaka[]; config: VizConfig | null } {
  const napake: ValidacijskaNapaka[] = []
  if (typeof cfg !== 'object' || cfg === null) {
    return { napake: [{ polje: 'config', sporocilo: 'Manjka konfiguracija vizualizacije.' }], config: null }
  }
  const c = cfg as Record<string, unknown>
  const tip: TipPolnila =
    c.tip === 'PRECNA' || c.tip === 'STEKLO' ? c.tip
      : c.tip === 'FASADA' || c.tip === 'TERASA' ? c.tip : 'POKOCNA'
  const pritrditev: NacinPritrditve =
    c.pritrditev === 'STEBRI_V_BETON' || c.pritrditev === 'BOCNA_NA_STENO' ? c.pritrditev : 'TALNA'
  const stevilo = (v: unknown, min: number, max: number, fb: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fb
    return Math.min(max, Math.max(min, n))
  }
  // R520: višina FASADE (odsek stene) in globina TERASE (razpon čez tla) smejeta
  // biti precej večja od višine ograje — terasa je lahko globoka tudi 15 m.
  const maxVisina = tip === 'FASADA' || tip === 'TERASA' ? 2000 : 400
  const config: VizConfig = {
    tip,
    lengthCm: stevilo(c.lengthCm, 20, 6000, 400),
    heightCm: stevilo(c.heightCm, 20, maxVisina, 110),
    posts: Math.round(stevilo(c.posts, 1, 40, 5)),
    handrail: typeof c.handrail === 'boolean' ? c.handrail : true,
    lamelaMm: Math.round(stevilo(c.lamelaMm, 10, 300, 70)),
    rezaMm: Math.round(stevilo(c.rezaMm, 0, 300, 20)),
    deskaMm: Math.round(stevilo(c.deskaMm, 40, 400, 120)),
    pritrditev,
    vijaki: typeof c.vijaki === 'boolean' ? c.vijaki : true,
  }
  if (typeof c.lengthCm !== 'number' || !Number.isFinite(c.lengthCm) || c.lengthCm < 20 || c.lengthCm > 6000) {
    napake.push({ polje: 'config.lengthCm', sporocilo: 'Dolžina mora biti med 20 in 6000 cm.' })
  }
  if (typeof c.heightCm !== 'number' || !Number.isFinite(c.heightCm) || c.heightCm < 20 || c.heightCm > maxVisina) {
    napake.push({ polje: 'config.heightCm', sporocilo: `Višina/globina mora biti med 20 in ${maxVisina} cm.` })
  }
  // R520: stebri so za FASADO/TERASO brezpredmetni — ne zahtevamo jih.
  if (tip !== 'FASADA' && tip !== 'TERASA' &&
      (typeof c.posts !== 'number' || !Number.isFinite(c.posts) || c.posts < 1 || c.posts > 40)) {
    napake.push({ polje: 'config.posts', sporocilo: 'Število stebrov mora biti med 1 in 40.' })
  }
  return { napake, config: napake.length > 0 ? null : config }
}

// ─── Opozorila kakovosti (§1: kjer algoritem ne more zanesljivo oceniti) ─────

export interface Opozorilo { koda: string; sporocilo: string }

/**
 * Ocene kakovosti označbe + perspektive — iz normaliziranega quada in dimenzij
 * fotografije. Klient prikaže opozorila, strežnik jih shrani v verzijo (meta).
 */
export function oceniKakovost (params: RenderParams, sirinaPx: number, visinaPx: number, potrjenaMeraCm: number | null): Opozorilo[] {
  const op: Opozorilo[] = []
  const q = params.quad.map((t) => ({ x: t.x * sirinaPx, y: t.y * visinaPx })) as [Tocka, Tocka, Tocka, Tocka]
  const spodaj = razdalja(q[0], q[1])
  const zgoraj = razdalja(q[3], q[2])
  const levo = razdalja(q[0], q[3])
  const desno = razdalja(q[1], q[2])
  if (spodaj <= 0) return op
  // močna perspektiva: zgornji rob precej krajši od spodnjega (globina)
  const razmerjeRobov = zgoraj / spodaj
  if (razmerjeRobov < 0.55) {
    op.push({ koda: 'PERSPEKTIVA_GLOBOKA', sporocilo: 'Močna perspektiva (zgornji rob je precej krajši od spodnjega) — preverite razmerja na sliko ali dodajte referenco.' })
  }
  // neskladnih stranskih robov → poševna ravnina
  const razmerjeStrani = Math.min(levo, desno) / Math.max(levo, desno)
  if (razmerjeStrani < 0.6) {
    op.push({ koda: 'Ravnina_POSEVNA', sporocilo: 'Stranski robovi območja so zelo različno dolgi — ograja je verjetno pod kotom kamere; projekcija je približek.' })
  }
  // samopresečišče (metulj) — preprosta kontrola usmerjenosti
  const cross = (a: Tocka, b: Tocka, c: Tocka): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const s1 = Math.sign(cross(q[0], q[1], q[2]))
  const s2 = Math.sign(cross(q[1], q[2], q[3]))
  const s3 = Math.sign(cross(q[2], q[3], q[0]))
  const s4 = Math.sign(cross(q[3], q[0], q[1]))
  if (s1 * s2 < 0 || s1 * s3 < 0 || s1 * s4 < 0) {
    op.push({ koda: 'QUAD_SE_PRESECICE', sporocilo: 'Označeno območje se samo-seka — točke niso v pravem redu (spodaj-levo → spodaj-desno → zgoraj-desno → zgoraj-levo).' })
  }
  // merilo: premalo px na cm → slika preveč oddaljena
  const pxNaCm = spodaj / Math.max(1, params.reference.cm)
  if (pxNaCm < 0.8) {
    op.push({ koda: 'MERILO_MAJHNO', sporocilo: 'Fotografija je relativno oddaljena (manj kot 1 px na cm) — natančnost prikaza je omejena; približajte zajem.' })
  }
  // §6/§15: prikazna dolžina ≠ potrjena mera
  if (potrjenaMeraCm != null && potrjenaMeraCm > 0) {
    const odstopanje = Math.abs(params.config.lengthCm - potrjenaMeraCm) / potrjenaMeraCm
    if (odstopanje > 0.1) {
      op.push({
        koda: 'MERA_ODSTOPA',
        sporocilo: `Prikazna dolžina ${Math.round(params.config.lengthCm)} cm odstopa od potrjene mere ${Math.round(potrjenaMeraCm)} cm — vizualizacija NE spremeni potrjene proizvodne mere.`,
      })
    }
  }
  if (params.reference.tip === 'ROCNO' && !params.reference.opis) {
    op.push({ koda: 'REFERENCA_BREZ_OPISA', sporocilo: 'Ročna referenca brez opisa — zapišite, kateri znani objekt določa merilo (npr. „vrata 200 cm").' })
  }
  // ── R507 §1: ročna maska mora KRITI označeno območje, sicer deli ostanejo ──
  const maska = params.maska
  if (maska && maska.ograja.length > 0) {
    const aMaska = ploscinaSkupine(maska.ograja) - ploscinaSkupine(maska.izpusti)
    const aQuad = ploscina(params.quad as unknown as Oblika)
    if (aQuad > 0 && aMaska < aQuad * 0.55) {
      op.push({
        koda: 'MASKA_NEKRITA',
        sporocilo: `Ročno označena maska pokriva samo ${Math.round(Math.max(0, aMaska / aQuad) * 100)} % označenega območja — deli stare ograje morda ostanejo na sliki. Dodaj oblike za preostale deske, letve in pritrdila.`,
      })
    }
    if (aMaska <= 0) {
      op.push({ koda: 'MASKA_IZPUST', sporocilo: 'Izpusti so razveljavili celotno masko stare ograje — ni območja za obnovo ozadja. Preveri izpuste ali dodaj območja ograje.' })
    }
    if (maska.prednji.length === 0 && aQuad > 0.02) {
      op.push({ koda: 'PREDNJI_BREZ', sporocilo: 'Prednji plan ni označen — če pred ograjo stoji rob balkona, rastlina ali steno, ga nova ograja prekriva. Označi ga z obliko prednjega plana.' })
    }
  }
  return op
}

// ─── Ocena svetlobe iz fotografije (senčenje v smeri resnične svetlobe) ──────

export interface Svetloba {
  /** -1 = svetloba z leve, +1 = z desne (po jakosti stranskih pasov) */
  smer: -1 | 1
  /** povprečna svetlost prizora 0..1 → eksponent senčenja */
  svetlost: number
  /** barva neba (vzorci nad zgornjim robom) */
  zgoraj: string
  /** barva tal (vzorci pod spodnjim robom) */
  spodaj: string
}

function vzorciBarvo (data: Uint8ClampedArray, W: number, H: number, x0: number, x1: number, y0: number, y1: number): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0, n = 0
  const xa = Math.max(0, Math.floor(Math.min(x0, x1)))
  const xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1)))
  const ya = Math.max(0, Math.floor(Math.min(y0, y1)))
  const yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1)))
  for (let y = ya; y <= yb; y += 2) {
    for (let x = xa; x <= xb; x += 2) {
      const i = (y * W + x) * 4
      if (i + 2 >= data.length) continue
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
    }
  }
  if (n === 0) return { r: 128, g: 128, b: 128 }
  return { r: r / n, g: g / n, b: b / n }
}

const hexBarva = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`

/**
 * Ocení svetlobo prizora iz pikslov FOTOGRAFIJE (kontekst okoli quada):
 * pas nad zgornjim robom (nebo) in pod spodnjim (tla), leva/desna polovica
 * spodnjega pasu za smer senc. Deterministično — brez AI.
 */
export function oceniSvetlobo (ctx: CanvasRenderingContext2D, W: number, H: number, quadPx: [Tocka, Tocka, Tocka, Tocka]): Svetloba {
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, W, H).data
  } catch {
    return { smer: 1, svetlost: 0.55, zgoraj: '#cdd6de', spodaj: '#8d8579' }
  }
  const pas = Math.max(8, Math.round(H * 0.04))
  const zgoraj = vzorciBarvo(data, W, H, quadPx[3].x, quadPx[2].x, quadPx[3].y - pas, quadPx[3].y - 2)
  const spodajCela = vzorciBarvo(data, W, H, quadPx[0].x, quadPx[1].x, quadPx[0].y + 2, quadPx[0].y + pas)
  const sredinaX = (quadPx[0].x + quadPx[1].x) / 2
  const levo = vzorciBarvo(data, W, H, quadPx[0].x, sredinaX, quadPx[0].y + 2, quadPx[0].y + pas)
  const desno = vzorciBarvo(data, W, H, sredinaX, quadPx[1].x, quadPx[0].y + 2, quadPx[0].y + pas)
  const lum = (c: { r: number; g: number; b: number }): number => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
  const smer: -1 | 1 = (lum(levo) + 0.02) >= (lum(desno) - 0.02) ? -1 : 1
  const svetlost = Math.max(0.15, Math.min(0.95, (lum(zgoraj) + lum(spodajCela)) / 2))
  return { smer, svetlost, zgoraj: hexBarva(zgoraj), spodaj: hexBarva(spodajCela) }
}

// ─── R532: harmonizacija barv prizora (1.4.0, issue #14 §4) ──────────────────

/**
 * Statistika barv vzorca po kanalih: sredina (r/g/b) in standardni odklon
 * (dr/dg/db), vse v 0..255. `dr` NI kvadrat — imensko ločeno od sredine.
 */
export interface StatBarv {
  r: number; g: number; b: number
  dr: number; dg: number; db: number
}

/**
 * Vezane meje harmonizacije (R532) — vsaka vrednost je namerno konservativna:
 * - zamik: največji zamik sredine kanala (0..255);
 * - jakost: delež izračunanega barvnega namiga, ki se dejansko uporabi;
 * - minVzorcev: manj vzorčenih pikslov → statistika NI ZANESLJIVA (null).
 *
 * R536: člena raztegMin/raztegMax (in varnostni prag minStd) sta ODSTRANJENA
 * kot dokazljivo mrtva koda. Dokaz: razteg `s` se je izračunal v
 * harmonizacijskaMapa, a ga NOBEN porabnik ni prebral — edini bralec preslikave
 * je harmonizirajHex, ki bere SAMO zamik `d` (v′ = v + d); parameter `vir`, ki
 * bi s poganjal, pa v edinem produkcijskem klicu (izrisiOgrajo →
 * harmonizacijskaMapa(statPrizora)) nikoli ni bil podan, torej je bil izračun
 * vedno konstanta 1. Izris se s tem ne spremeni niti za en bajt (mrtvi izračun
 * nikoli ni vplival na izhod). Odstranitev raztega NE odnaša odmikov StatBarv
 * (dr/dg/db) — ostajajo poštena statistika prizora (izvožena diagnosticna
 * vrednost oceniBarvoPrizora), le več ne segajo v mrtvo vejo.
 */
export const HARMONIZACIJA_MEJE = {
  zamik: 22,
  jakost: 0.35,
  minVzorcev: 8,
} as const

/** Vezana preslikava po kanalih: v′ = v + d (zamik sredine kanala). */
export interface HarmonizacijskaMapa {
  d: [number, number, number]
}

/**
 * Ocení barvno statistiko PRIZORA iz pasov OKOLI označenega območja:
 * pas nad zgornjim robom (nebo) in pod spodnjim (tla) — isti vzorčni pasovi
 * kot `oceniSvetlobo`, a zbiramo sredino IN odmikan po kanalih. Vzorčenje je
 * deterministično (vsak 2. piksel, kot `vzorciBarvo`). Vrne `null`, če
 * `getImageData` ni na voljo ali je vzorcev premalo (< MEJE.minVzorcev).
 */
export function oceniBarvoPrizora (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  quadPx: [Tocka, Tocka, Tocka, Tocka]
): StatBarv | null {
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, W, H).data
  } catch {
    return null
  }
  const pas = Math.max(8, Math.round(H * 0.04))
  const pasNeba: [number, number, number, number] = [quadPx[3].x, quadPx[2].x, quadPx[3].y - pas, quadPx[3].y - 2]
  const pasTal: [number, number, number, number] = [quadPx[0].x, quadPx[1].x, quadPx[0].y + 2, quadPx[0].y + pas]
  let sr = 0, sg = 0, sb = 0, sr2 = 0, sg2 = 0, sb2 = 0, n = 0
  for (const [x0, x1, y0, y1] of [pasNeba, pasTal]) {
    const xa = Math.max(0, Math.floor(Math.min(x0, x1)))
    const xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1)))
    const ya = Math.max(0, Math.floor(Math.min(y0, y1)))
    const yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1)))
    for (let y = ya; y <= yb; y += 2) {
      for (let x = xa; x <= xb; x += 2) {
        const i = (y * W + x) * 4
        if (i + 2 >= data.length) continue
        const r = data[i], g = data[i + 1], b = data[i + 2]
        sr += r; sg += g; sb += b
        sr2 += r * r; sg2 += g * g; sb2 += b * b
        n++
      }
    }
  }
  if (n < HARMONIZACIJA_MEJE.minVzorcev) return null
  const m = [sr / n, sg / n, sb / n]
  const m2 = [sr2 / n, sg2 / n, sb2 / n]
  const sd = m2.map((v, k) => Math.sqrt(Math.max(0, v - m[k] * m[k])))
  return { r: m[0], g: m[1], b: m[2], dr: sd[0], dg: sd[1], db: sd[2] }
}

/** Svetlost barvne sredine (0..255, enaka utež kot `lum` v oceniSvetlobo). */
function lumSredine (s: { r: number; g: number; b: number }): number {
  return 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b
}

/**
 * Izračunaj VEZANO harmonizacijsko preslikavo (R532): zamik `d` po kanalu =
 * delež (jakost) barvnega odklona PRIZORA od njegove lastne svetlosti
 * (kromatičnost osvetlitve) — zamik nebeškega/talnega pasu, NE primerjava z
 * barvo izdelka: nevtralen prizor pusti izdelek pri miru, topel prizor zamakne
 * vse kanale proti toplemu, cap ±MEJE.zamik.
 * Vrne `null`, če statistika manjka.
 *
 * R536: parameter `vir` in razteg `s` odstranjena (mrtev izračun — nikoli
 * prebran; dokaz v HARMONIZACIJA_MEJE zgoraj).
 */
export function harmonizacijskaMapa (prizor: StatBarv | null): HarmonizacijskaMapa | null {
  if (!prizor) return null
  const mp = [prizor.r, prizor.g, prizor.b]
  const lp = lumSredine(prizor)
  const d = [0, 1, 2].map((k) => {
    const kroma = (mp[k] - lp) * HARMONIZACIJA_MEJE.jakost
    return Math.max(-HARMONIZACIJA_MEJE.zamik, Math.min(HARMONIZACIJA_MEJE.zamik, kroma))
  }) as [number, number, number]
  return { d }
}

/** Uporabi preslikavo na eni barvi (hex → hex). Brez preslikave → nespremenjeno. */
export function harmonizirajHex (hex: string, m: HarmonizacijskaMapa | null): string {
  if (!m) return hex
  const { r, g, b } = hexToRgb(hex)
  const v = [r, g, b]
  const izh = v.map((x, k) => Math.max(0, Math.min(255, Math.round(x + m.d[k]))))
  return '#' + izh.map((x) => x.toString(16).padStart(2, '0')).join('')
}

// ─── Barvni pomočniki ────────────────────────────────────────────────────────
export function hexToRgb (hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return { r: parseInt(v.slice(0, 2), 16) || 0, g: parseInt(v.slice(2, 4), 16) || 0, b: parseInt(v.slice(4, 6), 16) || 0 }
}

export function rgba (hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`
}

/** Zameša dve hex barvi (t = 0 → a, 1 → b). */
export function zamesaj (a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b)
  const f = (p: number, q: number): number => Math.round(p + (q - p) * Math.max(0, Math.min(1, t)))
  return `#${[f(x.r, y.r), f(x.g, y.g), f(x.b, y.b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Deterministični PRNG (mulberry32) — reproducibilno zrno/variacije. */
export function prng (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Razporeditev elementov (§2/§4/§5/§6: iz KONFIGURACIJE, ne po občutku) ──

export interface ElementPost { xCm: number; sirinaCm: number }
export interface ElementPalica { xCm: number; sirinaCm: number }
export interface ElementDeska { yCm: number; visinaCm: number }
export interface ElementVijak { xCm: number; yCm: number; rCm: number }

export interface Razpored {
  posts: ElementPost[]
  palice: ElementPalica[] // POKOCNA
  deske: ElementDeska[] // PRECNA
  vijaki: ElementVijak[] // §5 vidni vijaki
  rocnikVisinaCm: number
}

/**
 * Zgenerira razporeditev iz konfiguracije: stebri ENAKOMERNO po dolžini,
 * palice/deske z DEJANSKIMI razmiki iz konfiguracije (lamelaMm/rezaMm/deskaMm),
 * vijaki na stebrih ob ročniku in ob polnilu (§5).
 */
export function generirajRazpored (cfg: VizConfig): Razpored {
  const posts: ElementPost[] = []
  const n = Math.max(2, Math.min(40, Math.round(cfg.posts)))
  const postSirinaCm = 9 // 90 mm ALU steber (standard ROKSAL profila)

  // R520: FASADA in TERASA nimata stebrov, ročnika niti vidnih vijakov —
  // KUBO letvica se pritrjuje ZADAJ na horizontalne alu cevi (uradno),
  // terasna deska pa leži na podkonstrukciji. Razpored je čisto raster
  // desk/palic čez CELO označeno območje (brez robov za stebre/ročnik).
  if (cfg.tip === 'FASADA') {
    const palice: ElementPalica[] = []
    const lamelaCm = Math.max(1, cfg.lamelaMm / 10)
    const rezaCm = Math.max(0, cfg.rezaMm / 10)
    const korak = lamelaCm + rezaCm
    if (korak > 0) {
      for (let x = 0; x + lamelaCm <= cfg.lengthCm + 0.01; x += korak) {
        palice.push({ xCm: x, sirinaCm: lamelaCm })
      }
    }
    return { posts, palice, deske: [], vijaki: [], rocnikVisinaCm: cfg.heightCm }
  }
  if (cfg.tip === 'TERASA') {
    const deske: ElementDeska[] = []
    const deskaCm = Math.max(4, cfg.deskaMm / 10)
    const rezaCm = Math.max(0, cfg.rezaMm / 10)
    const korak = deskaCm + rezaCm
    if (korak > 0) {
      for (let y = 0; y + deskaCm <= cfg.heightCm + 0.01; y += korak) {
        deske.push({ yCm: y, visinaCm: deskaCm })
      }
    }
    return { posts, palice: [], deske, vijaki: [], rocnikVisinaCm: cfg.heightCm }
  }

  for (let i = 0; i < n; i++) {
    posts.push({ xCm: (cfg.lengthCm * i) / (n - 1), sirinaCm: postSirinaCm })
  }
  const rocnikVisinaCm = cfg.handrail ? cfg.heightCm : cfg.heightCm

  // POKOCNA: pokončne palice/lamele med stebri — širina in reza iz konfiguracije
  const palice: ElementPalica[] = []
  const deske: ElementDeska[] = []
  if (cfg.tip === 'POKOCNA') {
    const lamelaCm = Math.max(1, cfg.lamelaMm / 10)
    const rezaCm = Math.max(0, cfg.rezaMm / 10)
    const korak = lamelaCm + rezaCm
    if (korak > 0) {
      for (let i = 0; i < n - 1; i++) {
        const od = posts[i].xCm + posts[i].sirinaCm / 2
        const doCm = posts[i + 1].xCm - posts[i + 1].sirinaCm / 2
        for (let x = od; x + lamelaCm <= doCm + 0.01; x += korak) {
          palice.push({ xCm: x, sirinaCm: lamelaCm })
        }
      }
    }
  } else if (cfg.tip === 'PRECNA') {
    // horizontalne deske od tal do ročnika — višina in reza iz konfiguracije
    const deskaCm = Math.max(4, cfg.deskaMm / 10)
    const rezaCm = Math.max(0, cfg.rezaMm / 10)
    const korak = deskaCm + rezaCm
    for (let y = 6; y + deskaCm <= rocnikVisinaCm - 4 + 0.01; y += korak) {
      deske.push({ yCm: y, visinaCm: deskaCm })
    }
  }

  // §5: vijaki — na vsakem stebru ob ročniku (2 vijaka) + ob polnilu (1 na zunanji tretjini)
  const vijaki: ElementVijak[] = []
  if (cfg.vijaki) {
    for (const p of posts) {
      vijaki.push({ xCm: p.xCm - postSirinaCm / 2 + 1.8, yCm: rocnikVisinaCm - 3.5, rCm: 0.8 })
      vijaki.push({ xCm: p.xCm + postSirinaCm / 2 - 1.8, yCm: rocnikVisinaCm - 3.5, rCm: 0.8 })
      vijaki.push({ xCm: p.xCm, yCm: rocnikVisinaCm * 0.42, rCm: 0.8 })
    }
  }
  return { posts, palice, deske, vijaki, rocnikVisinaCm }
}

// ─── Izris (canvas 2D — perspektivna projekcija z materialnim senčenjem) ─────

/**
 * R507 (issue #14 §2): rezultat KLASIČNE obnove ozadja (photo-replace-mask),
 * že zložen v RGBA sloj z mehkim robom. `sloj` se nariše namesto barvnega
 * preliva; `nedokončano` pove, kolikšen delež območja nima dokazanega vira.
 */
export interface OzadjeSloj {
  sloj: CanvasImageSource
  /** delež pikslov maske brez verodostojne obnove (0..1) */
  nedokončano: number
  /** imena pasov, kjer manjka dokaz (npr. »sredina 34 %«) */
  pasovi: string[]
  /** pošteno besedilo, ki ga UI pokaže monterju */
  sporocilo: string
}

export interface IzrisOpcije {
  /** prosojnost nove ograje 0..1 (ghost pogled, §7) */
  ghost?: number
  /** moč kontaktne sence 0..1 (privzeto iz svetlobe) */
  senca?: number
  /** ali prekrijem staro ograjo (ODSTRANITEV) */
  prekrijStaro?: boolean
  /** za izvoz: dodaj žig VIZUALIZACIJA ZA PREDSTAVITEV (§15) */
  zig?: boolean
  /** seme za deterministično zrno (npr. hash id-ja) */
  seme?: number
  /** R507 §3: preverjeno originalno gradivo za strukturo površine */
  gradivo?: VirTeksture | null
  /** R507 §2: obnovljeno ozadje namesto barvnega preliva */
  ozadje?: OzadjeSloj | null
  /** R507 §1: sloj PREDNJEGA plana iz originala — riše se zadnji */
  prednji?: { sloj: CanvasImageSource } | null
  /** R532 (1.4.0): harmonizacija barv prizora (privzeto VKLJUČENA) — vezani
   *  barvni namig iz pasov neba/tal; `false` = izris kot pred 1.4.0 (A/B). */
  harmonizacija?: boolean
}

/** Kvadrilateralna pot za 4 točke. */
function potQuad (ctx: CanvasRenderingContext2D, a: Tocka, b: Tocka, c: Tocka, d: Tocka): void {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.lineTo(d.x, d.y)
  ctx.closePath()
}

/**
 * OSNOVNI IZRIS POTEM na že narisano fotografijo (ctx vsebuje ORIGINAL).
 * Vrne opozorila kakovosti izrisa. Deterministično (seme).
 */
export function izrisiOgrajo (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  params: RenderParams,
  barvaHex: string,
  material: MaterialInfo,
  svetloba: Svetloba,
  opcije: IzrisOpcije = {}
): Opozorilo[] {
  const opozorila: Opozorilo[] = []
  const quadPx = params.quad.map((t) => ({ x: t.x * W, y: t.y * H })) as [Tocka, Tocka, Tocka, Tocka]
  const hom = homografijaIzQuada(quadPx)
  if (!hom) {
    return [{ koda: 'QUAD_NEDOLOCLJIV', sporocilo: 'Območja ni mogoče preslikati (degenerirana perspektiva).' }]
  }
  const cfg = params.config
  const razpored = generirajRazpored(cfg)
  // R520: FASADA (stena) in TERASA (tla) nista ograji — nimata ne vržene sence
  // ne kontaktne sence ob tleh. Obnova ozadja (§1/§2) ostane enaka.
  const jePovrsina = cfg.tip === 'FASADA' || cfg.tip === 'TERASA'

  // preslikava ravnine (cm) → slika: u = x/len, v = 1 - y/height (y navzgor)
  const P = (xCm: number, yCm: number): Tocka =>
    hom.toPx(Math.max(0, Math.min(1, xCm / cfg.lengthCm)), Math.max(0, Math.min(1, 1 - yCm / cfg.heightCm)))

  const ghost = Math.max(0.05, Math.min(1, opcije.ghost ?? 1))
  const rnd = prng(opcije.seme ?? 1234)

  // R532 §4: harmonizacija barv — statistiko prizora izluščimo PRED risanjem
  // (pasovi neba/tal OKOLI območja so zunaj quada, a krok 1 (kadrovanje
  // preliva) riše tudi pasova nad in pod — vzorčenje mora videti ORIGINAL).
  const statPrizora = opcije.harmonizacija === false ? null : oceniBarvoPrizora(ctx, W, H, quadPx)
  const mapaBarv = harmonizacijskaMapa(statPrizora)

  ctx.save()
  ctx.globalAlpha = ghost

  // ── 1. ODSTRANITEV stare ograje (§1: samo območje ograje se spremeni) ──────
  if (opcije.prekrijStaro !== false) {
    if (opcije.ozadje?.sloj) {
      // R507 §2: klasična obnova iz robov fotografije (photo-replace-mask) —
      // vsak piksel ima dokazan sosednji izvir ali pa je označen kot nedokončan.
      ctx.drawImage(opcije.ozadje.sloj, 0, 0, W, H)
      if (opcije.ozadje.nedokončano > PRAG_ROCNEGA_POSEG) {
        opozorila.push({
          koda: 'OZADJE_NEDOKONCANO',
          sporocilo: opcije.ozadje.sporocilo + (opcije.ozadje.pasovi.length ? ` Manjka dokaz: ${opcije.ozadje.pasovi.join(', ')}.` : ''),
        })
      } else {
        opozorila.push({ koda: 'OZADJE_IZ_ROBOV', sporocilo: opcije.ozadje.sporocilo })
      }
    } else {
      const pasZg = Math.max(6, Math.round(H * 0.03))
      const pasSp = Math.max(6, Math.round(H * 0.03))
      // zgornji podaljšek (nebo) in spodnji (tla) — preliv čez staro ograjo
      const qTop = quadPx.map((t) => ({ ...t })) as [Tocka, Tocka, Tocka, Tocka]
      const qBot = quadPx.map((t) => ({ ...t })) as [Tocka, Tocka, Tocka, Tocka]
      qTop[0] = { x: quadPx[3].x, y: quadPx[3].y - pasZg * 0.4 }
      qTop[1] = { x: quadPx[2].x, y: quadPx[2].y - pasZg * 0.4 }
      qTop[2] = { x: quadPx[2].x + (quadPx[2].x - quadPx[1].x) * 0.06, y: quadPx[2].y - pasZg }
      qTop[3] = { x: quadPx[3].x + (quadPx[3].x - quadPx[0].x) * 0.06, y: quadPx[3].y - pasZg }
      qBot[2] = { x: quadPx[1].x, y: quadPx[1].y + pasSp * 0.4 }
      qBot[3] = { x: quadPx[0].x, y: quadPx[0].y + pasSp * 0.4 }
      qBot[0] = { x: quadPx[0].x + (quadPx[0].x - quadPx[3].x) * 0.06, y: quadPx[0].y + pasSp }
      qBot[1] = { x: quadPx[1].x + (quadPx[1].x - quadPx[2].x) * 0.06, y: quadPx[1].y + pasSp }
      ctx.save()
      try { ctx.filter = 'blur(7px)' } catch { /* starejši brskalniki */ }
      const g1 = ctx.createLinearGradient(0, quadPx[3].y, 0, quadPx[0].y)
      g1.addColorStop(0, svetloba.zgoraj)
      g1.addColorStop(0.5, zamesaj(svetloba.zgoraj, svetloba.spodaj, 0.45))
      g1.addColorStop(1, svetloba.spodaj)
      ctx.fillStyle = g1
      potQuad(ctx, quadPx[0], quadPx[1], quadPx[2], quadPx[3])
      ctx.fill()
      // pas neba nad in tal pod — mehak prehod nazaj v okolico
      const gz = ctx.createLinearGradient(0, qTop[3].y, 0, quadPx[3].y)
      gz.addColorStop(0, rgba(svetloba.zgoraj, 0.95))
      gz.addColorStop(1, rgba(svetloba.zgoraj, 0))
      ctx.fillStyle = gz
      potQuad(ctx, qTop[3], qTop[2], qTop[1], qTop[0])
      ctx.fill()
      const gs = ctx.createLinearGradient(0, quadPx[0].y, 0, qBot[0].y)
      gs.addColorStop(0, rgba(svetloba.spodaj, 0))
      gs.addColorStop(1, rgba(svetloba.spodaj, 0.95))
      ctx.fillStyle = gs
      potQuad(ctx, qBot[3], qBot[2], qBot[1], qBot[0])
      ctx.fill()
      ctx.restore()
      // §2: preliva NE sme trditi, da je ograja odstranjena — to pove in pokaže pot
      opozorila.push({
        koda: 'PREKRIVANJE_NI_ODSTRANITEV',
        sporocilo: 'Ozadje za staro ograjo je samo preliv barv iz okolice — to NI verodostojno odstranjeno ograjo. Označi masko in obnovi ozadje (ali popravi ročno), sicer rezultat predstavlja približek.',
      })
    }
  }

  // ── 2. SENCA (kontakt s tlemi + vržeča senca v smeri svetlobe) ─────────────
  if (!jePovrsina) {
  const sencaMoc = opcije.senca ?? 0.35 + (1 - svetloba.svetlost) * 0.35
  const dY = Math.max(3, H * 0.012) // odmik vržene sence
  const dX = -svetloba.smer * dY * 0.8 // leva svetloba → senca desno
  ctx.save()
  ctx.fillStyle = `rgba(20, 22, 26, ${0.28 * sencaMoc})`
  // vržeča senca celotne ograje (poševni dvojnina za glavnimi stebri)
  potQuad(
    ctx,
    { x: quadPx[0].x + dX * 0.4, y: quadPx[0].y },
    { x: quadPx[1].x + dX * 0.4, y: quadPx[1].y },
    { x: quadPx[1].x + dX, y: quadPx[1].y + dY },
    { x: quadPx[0].x + dX, y: quadPx[0].y + dY }
  )
  ctx.fill()
  // kontaktna senca ob tleh (temnejša, ozka)
  const gk = ctx.createLinearGradient(0, quadPx[0].y - dY * 1.4, 0, quadPx[0].y + dY * 0.8)
  gk.addColorStop(0, `rgba(15, 16, 20, 0)`)
  gk.addColorStop(0.55, `rgba(15, 16, 20, ${0.4 * sencaMoc})`)
  gk.addColorStop(1, `rgba(15, 16, 20, 0)`)
  ctx.fillStyle = gk
  potQuad(
    ctx,
    { x: quadPx[0].x - 4, y: quadPx[0].y - dY * 1.4 },
    { x: quadPx[1].x + 4, y: quadPx[1].y - dY * 1.4 },
    { x: quadPx[1].x + 6, y: quadPx[1].y + dY * 0.8 },
    { x: quadPx[0].x - 6, y: quadPx[0].y + dY * 0.8 }
  )
  ctx.fill()
  ctx.restore()
  } // konec if (!jePovrsina)

  // ── materialni odtenki (svetloba prizora prilagodi barvo) ──────────────────
  const exposure = 0.82 + svetloba.svetlost * 0.36 // temen prizor → temnejša ograja
  // R532 §4: osnovni ton izdelka dobi VEZANI barvni namig prizora (nevtralen
  // prizor → nedotaknjena barva; opcije.harmonizacija=false = izris pred 1.4.0)
  const barvaH = harmonizirajHex(barvaHex, mapaBarv)
  const osnovna = prilagodiSvetlosti(barvaH, exposure)
  const svetla = zamesaj(osnovna, svetloba.zgoraj, 0.28 + material.sijaj * 0.22)
  const temna = zamesaj(osnovna, '#0b0d10', 0.32 - material.sijaj * 0.1)

  /** vertikalni preliv palice/stebra (valjasti videz) */
  const prelivVert = (x0: number, y0: number, x1: number, y1: number): CanvasGradient => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    g.addColorStop(0, temna)
    g.addColorStop(0.3, svetla)
    g.addColorStop(0.55, osnovna)
    g.addColorStop(1, temna)
    return g
  }

  /**
   * R507 §3: originalna površina PREVERJENEGA gradiva čez element (cm pravokotnik
   * v ravnini ograje). Moč strukture je odvisna od materiala — WPC/les imata izrazito
   * letnico, ALU/INOX samo brušenje. Brez gradiva se ne riše NICAČ (obarvni preliv
   * ostane, a izrisiOgrajo to sporoči prek opozorila UI-ja).
   */
  const gradivoMoc = 0.28 + material.struktura * 0.42
  // R523: `enaCelica` — vir ENOJNE površine (DETAJL čip) se preslika z ENO
  // afino transformacijo čez cel element: mreža celic je namenjena perspektivni
  // aproksimaciji velikih elementov, pri tanki letvici pa pušča šibke šive
  // (anti-alias črte med sosednjimi celicami), ki pri naključni enakomerni
  // površini postanejo najvidnejša napaka.
  const struktura = (x0: number, y0: number, x1: number, y1: number, izrez?: Pravokotnik, enaCelica = false, zrcali = false): void => {
    const vir = opcije.gradivo
    if (!vir) return
    const dolzinaPx = razdalja(P(x0, y0), P(x1, y0))
    const visinaPx = razdalja(P(x0, y0), P(x0, y1))
    const gostota = celiceZaElement(dolzinaPx, visinaPx)
    vzorciTeksturo(ctx, projekcijaIzRavnine(P, x0, y0, x1, y1), izrez ? { ...vir, izrez } : vir, {
      ...(enaCelica ? { celiceU: 1, celiceV: 1 } : gostota), moc: gradivoMoc, ...(zrcali ? { zrcali } : {}),
    })
  }

  // ── 3. STEBRI (§6: število/pozicije iz konfiguracije) ──────────────────────
  for (const [i, post] of (jePovrsina ? [] : razpored.posts.entries())) {
    const xLevo = post.xCm - post.sirinaCm / 2
    const xDesno = post.xCm + post.sirinaCm / 2
    const a = P(xLevo, 0)
    const b = P(xDesno, 0)
    const c = P(xDesno, cfg.heightCm)
    const d = P(xLevo, cfg.heightCm)
    const variation = 1 + (rnd() - 0.5) * 0.06
    ctx.fillStyle = prelivVert(a.x, a.y, d.x, d.y)
    potQuad(ctx, a, b, c, d)
    ctx.fill()
    // svetli rob (odsev svetlobe na robu profila)
    ctx.strokeStyle = rgba(svetla, 0.5 * variation)
    ctx.lineWidth = Math.max(0.6, Math.abs(b.x - a.x) * 0.12)
    ctx.beginPath()
    ctx.moveTo((a.x + d.x) / 2 + (b.x - a.x) * 0.18, (a.y + d.y) / 2)
    ctx.lineTo((b.x + c.x) / 2 - (b.x - a.x) * 0.1, (b.y + c.y) / 2)
    ctx.stroke()
    // senčni rob
    ctx.strokeStyle = rgba(temna, 0.55)
    ctx.lineWidth = Math.max(0.5, Math.abs(b.x - a.x) * 0.1)
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()
    // INOX/WPC: struktura (črtkanje / letnice)
    if (material.struktura > 0.3) {
      ctx.strokeStyle = rgba(material.vrsta === 'WPC' || material.vrsta === 'LES' ? temna : svetla, 0.16 * material.struktura)
      ctx.lineWidth = 0.6
      const crt = material.vrsta === 'WPC' || material.vrsta === 'LES' ? 7 : 4
      for (let s = 1; s < crt; s++) {
        const t = s / crt
        ctx.beginPath()
        ctx.moveTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
        ctx.lineTo(d.x + (c.x - d.x) * t, d.y + (c.y - d.y) * t)
        ctx.stroke()
      }
    }
    // R507 §3: dejanska površina izdelka čez steber
    struktura(xLevo, 0, xDesno, cfg.heightCm)
    // kapa stebra (zgornji zaključek)
    if (cfg.handrail) {
      ctx.fillStyle = rgba(svetla, 0.85)
      potQuad(ctx, d, c, P(xDesno, cfg.heightCm - 1.2), P(xLevo, cfg.heightCm - 1.2))
      ctx.fill()
    }
    // TALNA pritrditev: podnožje (malce širše)
    if (cfg.pritrditev === 'TALNA' || cfg.pritrditev === 'STEBRI_V_BETON') {
      ctx.fillStyle = rgba(temna, 0.8)
      potQuad(ctx, P(xLevo - 0.8, 0), P(xDesno + 0.8, 0), P(xDesno + 0.8, 4), P(xLevo - 0.8, 4))
      ctx.fill()
    }
    if (i === razpored.posts.length - 1 && razpored.posts.length > 40) break // varnost
  }

  // ── 4. POLNILO (§4: dejanski vzorec — širine/razmiki/orientacija) ──────────
  if (cfg.tip === 'FASADA') {
    // R520: KUBO letvice čez CELO označeno območje stene — navpične, brez
    // stebrov in ročnika (uradno: »kubo profile can only be mounted
    // vertically«, pritrditev zadaj). Tekstura gre po celotni letvici.
    // R523: če vir nosi MNOŽICO izrezov (scenična namestitvena fotografija),
    // vsaka letvica dobi DRUGO desko (deterministični rnd iz semena) — konec
    // identičnih klonov. DETAJL posnetek (čip površine) se uporabi cel.
    const izreziPalic = opcije.gradivo?.izrezi?.filter((p) => p.w > 0 && p.h > 0) ?? []
    for (const palica of razpored.palice) {
      const a = P(palica.xCm, 0)
      const b = P(palica.xCm + palica.sirinaCm, 0)
      const c = P(palica.xCm + palica.sirinaCm, cfg.heightCm)
      const d = P(palica.xCm, cfg.heightCm)
      const v = 1 + (rnd() - 0.5) * 0.05
      ctx.fillStyle = prelivVert(a.x, a.y, d.x, d.y)
      potQuad(ctx, a, b, c, d)
      ctx.fill()
      // svetla kantica ob robu profila (odsev svetlobe)
      if (Math.abs(b.x - a.x) > 2.2) {
        ctx.strokeStyle = rgba(svetla, 0.4 * v)
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.moveTo(a.x + (b.x - a.x) * 0.32, a.y)
        ctx.lineTo(d.x + (c.x - d.x) * 0.32, d.y)
        ctx.stroke()
      }
      // R523: vir z množico izrezov (scenična) → mreža + izrez te letvice;
      // vir ENOJNE površine (DETAJL čip) → ena celica brez šivov + določena
      // VARIACIJA po letvici (podizrez 62–100 % in izmenično zrcalo, seme),
      // sicer bi vse letvice bile identičen klon istega čipa.
      const imaMnozico = izreziPalic.length > 0
      let izrezLetvice: Pravokotnik | undefined
      let zrcali = false
      if (!imaMnozico) {
        const vir = opcije.gradivo
        if (vir) {
          const dw = Math.max(8, Math.round(Math.min(vir.sirinaPx, vir.visinaPx) * (0.62 + rnd() * 0.38)))
          const dx = Math.round(rnd() * (vir.sirinaPx - dw))
          const dy = Math.round(rnd() * (vir.visinaPx - dw))
          izrezLetvice = { x: dx, y: dy, w: dw, h: dw }
          zrcali = rnd() < 0.5
        }
      }
      struktura(palica.xCm, 0, palica.xCm + palica.sirinaCm, cfg.heightCm,
        imaMnozico ? izreziPalic[Math.floor(rnd() * izreziPalic.length)] : izrezLetvice,
        !imaMnozico, zrcali)
    }
  } else if (cfg.tip === 'TERASA') {
    // R520: terasne deske ležijo po CELI globini označenega območja — vsaka
    // je pas čez celo širino; perspektivo tal ponese homografija (enotski
    // kvadrat čez 4 vogale). Referenca umerja SPODNJI rob (vzdolž desk).
    for (const deska of razpored.deske) {
      const a = P(0, deska.yCm)
      const b = P(cfg.lengthCm, deska.yCm)
      const c = P(cfg.lengthCm, deska.yCm + deska.visinaCm)
      const d = P(0, deska.yCm + deska.visinaCm)
      const g = ctx.createLinearGradient(0, Math.min(a.y, d.y), 0, Math.max(a.y, d.y))
      g.addColorStop(0, svetla)
      g.addColorStop(0.45, osnovna)
      g.addColorStop(1, temna)
      ctx.fillStyle = g
      potQuad(ctx, a, b, c, d)
      ctx.fill()
      // sprednja (bližja) kantica deske ulovi svetlobo
      ctx.strokeStyle = rgba(svetla, 0.45)
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      struktura(0, deska.yCm, cfg.lengthCm, deska.yCm + deska.visinaCm)
    }
  } else if (cfg.tip === 'POKOCNA') {
    // R524: DETAJL čipi uradnih lestvic se preslikajo z NAVADNO mrežo celic
    // (enako kot scenični viri — dokazano z izoliranim poskusom: cela slika v
    // mreži 9/10 proti podizrezu+zrcalu 6/10 pri ozkih palicah; perspektiva
    // posamezne palice + svetloba že dasta naravno variacijo). UI vir po
    // potrebi ZAROTIRA (izmera smeri vlaken), da vlakna tečejo vzdolž palice.
    for (const palica of razpored.palice) {
      const a = P(palica.xCm, 0)
      const b = P(palica.xCm + palica.sirinaCm, 0)
      const c = P(palica.xCm + palica.sirinaCm, cfg.heightCm - 4)
      const d = P(palica.xCm, cfg.heightCm - 4)
      // rahla variacija med palicami (proizvodna toleranca — deterministično)
      const v = 1 + (rnd() - 0.5) * 0.05
      ctx.fillStyle = prelivVert(a.x, a.y, d.x, d.y)
      potQuad(ctx, a, b, c, d)
      ctx.fill()
      if (Math.abs(b.x - a.x) > 2.2) {
        ctx.strokeStyle = rgba(svetla, 0.4 * v)
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.moveTo(a.x + (b.x - a.x) * 0.32, a.y)
        ctx.lineTo(d.x + (c.x - d.x) * 0.32, d.y)
        ctx.stroke()
      }
      struktura(palica.xCm, 0, palica.xCm + palica.sirinaCm, cfg.heightCm - 4)
    }
  } else if (cfg.tip === 'PRECNA') {
    // R524: enaka mreža celic kot POKOCNA (zgoraj) — DETAJL čip uradne lestvice
    // se preslika cel, UI pa ga rotira, da vlakna tečejo VZDOLŽ deskе.
    for (const deska of razpored.deske) {
      const a = P(0.6, deska.yCm)
      const b = P(cfg.lengthCm - 0.6, deska.yCm)
      const c = P(cfg.lengthCm - 0.6, deska.yCm + deska.visinaCm)
      const d = P(0.6, deska.yCm + deska.visinaCm)
      const g = ctx.createLinearGradient(0, Math.min(a.y, d.y), 0, Math.max(a.y, d.y))
      g.addColorStop(0, svetla)
      g.addColorStop(0.45, osnovna)
      g.addColorStop(1, temna)
      ctx.fillStyle = g
      potQuad(ctx, a, b, c, d)
      ctx.fill()
      // zgornja svetla kantica vsake deske
      ctx.strokeStyle = rgba(svetla, 0.45)
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(c.x, c.y)
      ctx.stroke()
      // R507 §3: deska je vedno iz DEJANSKEGA posnetka površine
      struktura(0.6, deska.yCm, cfg.lengthCm - 0.6, deska.yCm + deska.visinaCm)
    }
  } else if (cfg.tip === 'STEKLO') {
    // stekleno polnilo: prosojna plošča z odbojem
    const a = P(1, 1)
    const b = P(cfg.lengthCm - 1, 1)
    const c = P(cfg.lengthCm - 1, cfg.heightCm - 4)
    const d = P(1, cfg.heightCm - 4)
    ctx.fillStyle = 'rgba(170, 196, 214, 0.30)'
    potQuad(ctx, a, b, c, d)
    ctx.fill()
    ctx.strokeStyle = 'rgba(120, 140, 160, 0.75)'
    ctx.lineWidth = 1.4
    ctx.stroke()
    // diagonalen odsev
    ctx.save()
    potQuad(ctx, a, b, c, d)
    ctx.clip()
    const gr = ctx.createLinearGradient(a.x, c.y, b.x, a.y)
    gr.addColorStop(0.3, 'rgba(255, 255, 255, 0)')
    gr.addColorStop(0.5, 'rgba(255, 255, 255, 0.22)')
    gr.addColorStop(0.7, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = gr
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

  // ── 5. ROČNIK (zgoraj, zaokrožen profil z odsevom) ─────────────────────────
  if (cfg.handrail && !jePovrsina) {
    const rh = 5 // višina ročnika v cm
    const a = P(0, cfg.heightCm)
    const b = P(cfg.lengthCm, cfg.heightCm)
    const c = P(cfg.lengthCm, cfg.heightCm - rh)
    const d = P(0, cfg.heightCm - rh)
    const g = ctx.createLinearGradient(0, Math.min(a.y, d.y), 0, Math.max(a.y, d.y))
    g.addColorStop(0, zamesaj(svetla, '#ffffff', material.sijaj * 0.4))
    g.addColorStop(0.35, osnovna)
    g.addColorStop(1, temna)
    ctx.fillStyle = g
    potQuad(ctx, a, b, c, d)
    ctx.fill()
    // R507 §3: ročnik nosi isto preverjeno površino kot polnilo
    struktura(0, cfg.heightCm - rh, cfg.lengthCm, cfg.heightCm)
    ctx.strokeStyle = rgba(zamesaj(svetla, '#ffffff', 0.3), 0.65)
    ctx.lineWidth = 1
    const t = d.y + (a.y - d.y) * 0.22
    ctx.beginPath()
    ctx.moveTo(a.x + (b.x - a.x) * 0.01, t)
    ctx.lineTo(b.x - (b.x - a.x) * 0.01, t + (c.y - d.y) * 0.22)
    ctx.stroke()
    // končni zaključki robov (§2 zaključki robov)
    ctx.fillStyle = rgba(temna, 0.9)
    potQuad(ctx, a, P(1.6, cfg.heightCm), P(1.6, cfg.heightCm - rh), d)
    ctx.fill()
    potQuad(ctx, b, P(cfg.lengthCm - 1.6, cfg.heightCm), P(cfg.lengthCm - 1.6, cfg.heightCm - rh), c)
    ctx.fill()
  }

  // ── 6. VIJAKI (§5: položaj/velikost/barva iz konfiguracije) ───────────────
  for (const v of razpored.vijaki) {
    const p = P(v.xCm, v.yCm)
    const r = Math.max(0.7, (v.rCm * (razdalja(quadPx[0], quadPx[1]) / Math.max(1, params.reference.cm))) * 1.15)
    ctx.fillStyle = `rgba(30, 33, 38, ${0.75 * ghost})`
    ctx.beginPath()
    ctx.ellipse(p.x, p.y, r, r * 0.92, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = `rgba(215, 220, 226, ${0.5 * ghost})`
    ctx.beginPath()
    ctx.ellipse(p.x - r * 0.22, p.y - r * 0.25, r * 0.42, r * 0.3, -0.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // ── 7. ZRNO (posnemi fotografijo — determinističen šum po celotnem območju) ─
  const zrno = 0.05 + material.struktura * 0.04
  ctx.save()
  potQuad(ctx, quadPx[0], quadPx[1], quadPx[2], quadPx[3])
  ctx.clip()
  // korak zrna prilagodi ločljivosti (majhne slike → finnejše zrno)
  const korakZ = Math.max(1, Math.round(W / 800))
  for (let x = quadPx[3].x; x < quadPx[2].x; x += korakZ) {
    for (let y = quadPx[3].y; y < quadPx[0].y; y += korakZ) {
      const n = rnd()
      if (n < 0.34) {
        ctx.fillStyle = n < 0.17 ? `rgba(255,255,255,${zrno * 0.5})` : `rgba(0,0,0,${zrno * 0.5})`
        ctx.fillRect(x, y, korakZ, korakZ)
      }
    }
  }
  ctx.restore()

  ctx.restore() // globalAlpha

  // ── 7b. PREDNJI PLAN (§1: nova ograja NE prekrije robov balkona, rastlin, sten)
  // Nariše se ZADNJI iz slikovnih plasti in samo iz originalnih pikslov,
  // zato okolica zunaj označenih območij ostane nespremenjena (§4).
  if (opcije.prednji?.sloj) {
    ctx.save()
    ctx.drawImage(opcije.prednji.sloj, 0, 0, W, H)
    ctx.restore()
  }

  // ── 8. ŽIG §15 (na izvozu; na zaslonu ga nosi UI pasika) ──────────────────
  if (opcije.zig) dodajZig(ctx, W, H)

  return opozorila
}

/** Prilagodi hex barvo svetlosti prizora (0.5 = brez spremembe). */
function prilagodiSvetlosti (hex: string, exposure: number): string {
  const { r, g, b } = hexToRgb(hex)
  const f = (c: number): number => {
    const x = exposure >= 1 ? c + (255 - c) * (exposure - 1) : c * (0.5 + exposure)
    return Math.round(Math.max(0, Math.min(255, x)))
  }
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Žig VIZUALIZACIJA ZA PREDSTAVITEV v desnem spodnjem kotu (§15). */
export function dodajZig (ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const text = VIZ_ZIG
  ctx.save()
  ctx.font = `600 ${Math.max(11, Math.round(W * 0.014))}px system-ui, sans-serif`
  const tw = ctx.measureText(text).width
  const padX = Math.round(W * 0.008)
  const w = tw + padX * 2
  const h = Math.max(20, Math.round(W * 0.024))
  const x = W - w - Math.round(W * 0.015)
  const y = H - h - Math.round(H * 0.02)
  ctx.fillStyle = 'rgba(15, 17, 21, 0.62)'
  ctx.beginPath()
  const r = 6
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + padX, y + h / 2 + 1)
  ctx.restore()
}

/**
 * PREJ/POTEM primerjava (§7): celega kanvasa — levo ORIGINAL do meje x,
 * desno POTEM. Meja v ulomku širine (0..1).
 */
export function izrisiPrimerjavo (
  ctx: CanvasRenderingContext2D,
  original: CanvasImageSource,
  W: number,
  H: number,
  params: RenderParams,
  barvaHex: string,
  material: MaterialInfo,
  svetloba: Svetloba,
  meja: number,
  opcije: IzrisOpcije = {}
): Opozorilo[] {
  // POTEM čez celo sliko
  ctx.drawImage(original, 0, 0, W, H)
  const opozorila = izrisiOgrajo(ctx, W, H, params, barvaHex, material, svetloba, opcije)
  // PREJ čez levi del
  const mx = Math.round(W * Math.max(0, Math.min(1, meja)))
  if (mx > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, mx, H)
    ctx.clip()
    ctx.drawImage(original, 0, 0, W, H)
    ctx.restore()
    // ločilna črta z ročaji
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillRect(mx - 1, 0, 2, H)
    ctx.fillStyle = 'rgba(15,17,21,0.55)'
    ctx.fillRect(mx - 6, 0, 12, 26)
    ctx.fillRect(mx - 6, H - 26, 12, 26)
  }
  return opozorila
}

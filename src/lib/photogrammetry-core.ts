/**
 * Fotogrametrija brez AI — determinističen dokazni protokol (issue #15, faza 3).
 *
 * KAJ JE: klasična (ne-naučena) večpogledovna geometrija po učbeniku
 * Hartley & Zisserman: Shi-Tomasi kornje → ujemanje koščic (NCC + razmerje +
 * obojestranska preverba) → normalizirana linearna DLT za osnovno matriko →
 * RANSAC geometrijska verifikacija → esencialna matrika → razcep na [R|t] s
 * preverbo, da so točke pred obema kamerama → linearna triangulacija → absolutno
 * merilo iz PREVERJENE fizične reference → protokol sprejema/zavrnitve.
 *
 * KAJ NI: to ni COLMAP, ne MVS in ne gost model. Ni vgrajeno v mobilni
 * odjemalec in nič v aplikaciji ne trdi, da 3D-rekonstrukcija že dela —
 * `measure-engine.recommendMethod` to prav zaradi tega pove izrecno.
 * Ta datoteka je OFFLINE dokaz, da veriga obstaja, da je numerično pravilna
 * (istina je znana: `photogrammetry-proof.ts`) in da znamo ZAVRNITI lažen
 * model. Pogodbe, licence in pogoji: `docs/PHOTOGRAMMETRY-3D.md`.
 *
 * LICENCA: datoteka nima NIČ odvisnosti (niti enega uvoza), zato tu ni kaj
 * licencirati. Nova odvisnost sme priti samo z zapisom licence v
 * `docs/PHOTOGRAMMETRY-3D.md` §3.
 *
 * DETERMINIZEM: vsa naključja gredo skozi `ustvariNakljucje` (xorshift, fiksen
 * seed); brez `Math.random`, brez `Date`, brez odvisnosti od vrstnega reda
 * slovarja. Isti vhodi → isto poročilo, v vsakem zagonu.
 */

// ── tipi ─────────────────────────────────────────────────────────────────────

/** 3x3 matrika v vrstičnem zaporedju: [m00,m01,m02,m10,m11,m12,m20,m21,m22]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]
export type Vec3 = [number, number, number]
/** 3x4 projekcijska matrika: tri vrste po štirih stolpcih. */
export type Matrika3x4 = number[][]
/** Točka v pikslih (x, y); y raste navzdol. */
export interface Tocka2 { x: number; y: number }
export type Tocke2 = Tocka2[]

export interface SivaSlika {
  /** sivina dolžine sirina*visina, vrednosti 0..255 */
  siva: Float64Array
  sirina: number
  visina: number
}

export interface Intrinsics {
  fx: number
  fy: number
  cx: number
  cy: number
}

export interface Ujemanje {
  i: number
  j: number
  /** NCC podobost koščic [-1..1] */
  podobost: number
  /** razmerje 2./1. zadetka (manjše = enoznačnejše ujemanje) */
  razmerje: number
  /** podpikselna lega ujemanega vogla v sliki B (če je dodelava uspela) */
  x?: number
  y?: number
}

export interface Kornj extends Tocka2 {
  odziv: number
}

// ── linearna algebra ─────────────────────────────────────────────────────────

export function mnozi3 (a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
    }
  }
  return o
}

export function transponiraj3 (m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

export function mnoziMatVec3 (m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

/** i-ti stolpec matrike (vrstični zapis). */
export function stolpec3 (m: Mat3, i: number): Vec3 {
  return [m[i], m[3 + i], m[6 + i]]
}

/** Matrika z zamenjanim i-tim stolpcem. */
export function zamenjajStolpec3 (m: Mat3, i: number, v: Vec3): Mat3 {
  const o = [...m] as Mat3
  o[i] = v[0]; o[3 + i] = v[1]; o[6 + i] = v[2]
  return o
}

export function determinanta3 (m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6])
}

export function obrni3 (m: Mat3): Mat3 | null {
  const d = determinanta3(m)
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null
  const k = 1 / d
  // inv(M)[i][j] = cofaktor(M)[j][i] / det(M), vrstično glavni red
  return [
    (m[4] * m[8] - m[5] * m[7]) * k, (m[2] * m[7] - m[1] * m[8]) * k, (m[1] * m[5] - m[2] * m[4]) * k,
    (m[5] * m[6] - m[3] * m[8]) * k, (m[0] * m[8] - m[2] * m[6]) * k, (m[2] * m[3] - m[0] * m[5]) * k,
    (m[3] * m[7] - m[4] * m[6]) * k, (m[1] * m[6] - m[0] * m[7]) * k, (m[0] * m[4] - m[1] * m[3]) * k,
  ]
}

export function normiraj3 (v: Vec3): Vec3 | null {
  const n = Math.hypot(v[0], v[1], v[2])
  if (!(n > 1e-12)) return null
  return [v[0] / n, v[1] / n, v[2] / n]
}

/**
 * Gausova eliminacija s parcialnim pivotom. `nic` je m x n, `desna` n.
 * Sistem mora biti enoznačno rešljiv; sicer null (nikoli domnevna rešitev).
 */
export function resisiSistem (nic: number[][], desna: number[]): number[] | null {
  const m = nic.length
  const n = desna.length
  if (m < n || n === 0) return null
  const a = nic.map((vrstica, r) => [...vrstica, desna[r]])
  for (let stolpec = 0; stolpec < n; stolpec++) {
    let pivot = -1
    let vrednostPivota = -1
    for (let r = stolpec; r < m; r++) {
      const vrednost = Math.abs(a[r][stolpec])
      if (vrednost > vrednostPivota) { vrednostPivota = vrednost; pivot = r }
    }
    if (pivot < 0 || !(vrednostPivota > 1e-12)) return null
    if (pivot !== stolpec) { const zamenjava = a[stolpec]; a[stolpec] = a[pivot]; a[pivot] = zamenjava }
    const norma = a[stolpec][stolpec]
    for (let c = stolpec; c <= n; c++) a[stolpec][c] /= norma
    for (let r = 0; r < m; r++) {
      if (r === stolpec) continue
      const faktor = a[r][stolpec]
      if (faktor === 0) continue
      for (let c = stolpec; c <= n; c++) a[r][c] -= faktor * a[stolpec][c]
    }
  }
  return a.slice(0, n).map((vrstica) => vrstica[n])
}

/**
 * Ciklični Jacobi-ev razcep SIMETRIČNE n x n matrike. Lastne vrednosti so
 * razvrščene PADAJOČE, `stolpci[j]` pa je lastni vektor za `vrednosti[j]`.
 * Fiksen vrstni red rotacij → determinističen rezultat.
 */
export function simLastneN (vhod: number[][], n: number): { vrednosti: number[]; stolpci: number[][] } {
  const a = vhod.map((vrstica) => [...vrstica])
  const v: number[][] = Array.from({ length: n }, (_vrsta, i) => Array.from({ length: n }, (_v, j) => (i === j ? 1 : 0)))
  for (let cikel = 0; cikel < 60; cikel++) {
    let izven = 0
    let diagonala = 0
    for (let i = 0; i < n; i++) {
      diagonala += a[i][i] * a[i][i]
      for (let j = i + 1; j < n; j++) izven += a[i][j] * a[i][j]
    }
    if (izven < 1e-22 * Math.max(diagonala, 1)) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q]
        if (Math.abs(apq) < 1e-18) continue
        const theta = 0.5 * Math.atan2(2 * apq, a[p][p] - a[q][q])
        const kos = Math.cos(theta)
        const sin = Math.sin(theta)
        for (let k = 0; k < n; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = kos * akp + sin * akq
          a[k][q] = -sin * akp + kos * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = kos * apk + sin * aqk
          a[q][k] = -sin * apk + kos * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = kos * vkp + sin * vkq
          v[k][q] = -sin * vkp + kos * vkq
        }
      }
    }
  }
  const vrednosti: number[] = []
  for (let i = 0; i < n; i++) vrednosti.push(a[i][i])
  const vrstniRed = vrednosti.map((_x, i) => i).sort((x, y) => vrednosti[y] - vrednosti[x])
  const stolpci: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const razvrscene: number[] = []
  for (let j = 0; j < n; j++) {
    const izvorni = vrstniRed[j]
    razvrscene.push(vrednosti[izvorni])
    for (let k = 0; k < n; k++) stolpci[j][k] = v[k][izvorni]
  }
  return { vrednosti: razvrscene, stolpci }
}

/** `simLastneN` za 3x3: `vektorji` je Mat3, katerega STOLPCI so lastni vektorji. */
export function simLastne (m: Mat3): { vrednosti: Vec3; vektorji: Mat3 } {
  const e = simLastneN([[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]], 3)
  const vektorji: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) vektorji[r * 3 + c] = e.stolpci[c][r]
  }
  return { vrednosti: [e.vrednosti[0], e.vrednosti[1], e.vrednosti[2]], vektorji }
}

/**
 * SVD 3x3 (A = U S Vᵀ), singularne vrednosti padajoče in nenegativne.
 * Stolpci U so iz A·vᵢ/σᵢ; manjkajoči stolpec (σᵢ ≈ 0) je svoboden — dopolnjen
 * je z vektorskim produktom, razcep esencialne matrike pa vse štiri kandidate
 * preveri sam. Te funkcija NE popravlja orientacije; za to je
 * `svd3Rotacijski`.
 */
export function svd3 (a: Mat3): { u: Mat3; s: Vec3; v: Mat3 } {
  const e = simLastne(mnozi3(transponiraj3(a), a))
  const s: Vec3 = [
    Math.sqrt(Math.max(0, e.vrednosti[0])),
    Math.sqrt(Math.max(0, e.vrednosti[1])),
    Math.sqrt(Math.max(0, e.vrednosti[2])),
  ]
  const v = e.vektorji
  let u: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  // relativni prag: singularna vrednost pod 1e-7 najvecje je stevilski nicel
  // stolpec (pri esencialne matriki je sigma3 = 0 po konstrukciji)
  const meje = 1e-7 * Math.max(s[0], 1e-30)
  const poznani: number[] = []
  for (let i = 0; i < 3; i++) {
    if (s[i] > meje) {
      const avi = mnoziMatVec3(a, stolpec3(v, i))
      u = zamenjajStolpec3(u, i, [avi[0] / s[i], avi[1] / s[i], avi[2] / s[i]])
      poznani.push(i)
    }
  }
  if (poznani.length === 3) return { u, s, v }
  if (poznani.length === 0) return { u: [1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3, s, v }
  if (poznani.length === 2) {
    const prvi = stolpec3(u, poznani[0])
    const drugi = stolpec3(u, poznani[1])
    const manjka = [0, 1, 2].find((i) => i !== poznani[0] && i !== poznani[1]) ?? 2
    const pravokoten = normiraj3([
      prvi[1] * drugi[2] - prvi[2] * drugi[1],
      prvi[2] * drugi[0] - prvi[0] * drugi[2],
      prvi[0] * drugi[1] - prvi[1] * drugi[0],
    ]) ?? [0, 0, 1]
    const poskus = zamenjajStolpec3(u, manjka, pravokoten)
    const obrnjen = determinanta3(poskus) < 0
    const izbira: Vec3 = obrnjen ? [-pravokoten[0], -pravokoten[1], -pravokoten[2]] : pravokoten
    return { u: zamenjajStolpec3(u, manjka, izbira), s, v }
  }
  // en stolpec znan (rang 1): dopolni po fiksnem vrstnem redu baznih vektorjev
  const smer = normiraj3(stolpec3(u, poznani[0])) ?? [1, 0, 0]
  const zacetna: Vec3 = Math.abs(smer[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const projekcija = zacetna[0] * smer[0] + zacetna[1] * smer[1] + zacetna[2] * smer[2]
  const b1 = normiraj3([zacetna[0] - projekcija * smer[0], zacetna[1] - projekcija * smer[1], zacetna[2] - projekcija * smer[2]]) ?? [0, 1, 0]
  const b2 = normiraj3([smer[1] * b1[2] - smer[2] * b1[1], smer[2] * b1[0] - smer[0] * b1[2], smer[0] * b1[1] - smer[1] * b1[0]]) ?? [0, 0, 1]
  const p = poznani[0]
  const q = (p + 1) % 3
  const r = (p + 2) % 3
  let dopolnjena = zamenjajStolpec3(u, q, b1)
  dopolnjena = zamenjajStolpec3(dopolnjena, r, b2)
  if (determinanta3(dopolnjena) < 0) dopolnjena = zamenjajStolpec3(dopolnjena, r, [-b2[0], -b2[1], -b2[2]])
  return { u: dopolnjena, s, v }
}

/**
 * SVD za RANG-2 matriko (osnovna/esencialna): stolpec z najmanjšo singularno
 * vrednostjo je svoboden (σ ≈ 0), zato z njim popravimo orientacijo na
 * det U = det V = +1. Brez tega razcep vrne zrcaljeno rotacijo.
 */
export function svd3Rotacijski (a: Mat3): { u: Mat3; s: Vec3; v: Mat3 } {
  const razcep = svd3(a)
  let u = razcep.u
  let v = razcep.v
  if (determinanta3(v) < 0) {
    const z = stolpec3(v, 2)
    v = zamenjajStolpec3(v, 2, [-z[0], -z[1], -z[2]])
  }
  if (determinanta3(u) < 0) {
    const z = stolpec3(u, 2)
    u = zamenjajStolpec3(u, 2, [-z[0], -z[1], -z[2]])
  }
  return { u, s: razcep.s, v }
}

// ── determinističen naključni generator ──────────────────────────────────────

/** xorshift32, premešan z LCG: isti seed → isto zaporedje povsod. */
export function ustvariNakljucje (seed = 20261013): () => number {
  let stanje = (seed >>> 0) || 1
  let mešanica = (Math.imul(seed, 2654435761) >>> 0) || 1
  return () => {
    stanje ^= (stanje << 13) >>> 0
    stanje >>>= 0
    stanje ^= stanje >>> 17
    stanje ^= (stanje << 5) >>> 0
    stanje >>>= 0
    mešanica = (Math.imul(mešanica, 1103515245) + 12345) >>> 0
    return ((stanje ^ mešanica) >>> 0) / 4294967296
  }
}

// ── kornje (Shi-Tomasi) ──────────────────────────────────────────────────────

function gladko5 (siva: Float64Array, sirina: number, visina: number): Float64Array {
  const utezi = [1, 4, 6, 4, 1]
  const vodoravno = new Float64Array(siva.length)
  for (let y = 0; y < visina; y++) {
    for (let x = 0; x < sirina; x++) {
      let vsota = 0
      for (let k = -2; k <= 2; k++) {
        vsota += utezi[k + 2] * siva[y * sirina + Math.min(sirina - 1, Math.max(0, x + k))]
      }
      vodoravno[y * sirina + x] = vsota / 16
    }
  }
  const out = new Float64Array(siva.length)
  for (let y = 0; y < visina; y++) {
    for (let x = 0; x < sirina; x++) {
      let vsota = 0
      for (let k = -2; k <= 2; k++) {
        vsota += utezi[k + 2] * vodoravno[Math.min(visina - 1, Math.max(0, y + k)) * sirina + x]
      }
      out[y * sirina + x] = vsota / 16
    }
  }
  return out
}

/**
 * Shi-Tomasi: najmanjša lastna vrednost strukturne matrike v 3x3 oknu na
 * 5-tapno gladki sivini, netrsko izbijanje (lokalni maksimum + minRazmik).
 * Klasično, brez naučenih detektorjev. `pragAbs` je spodnja meja (0 = samo
 * relativni prag); rezultat je padajoč po odzivu.
 */
export function detektirajKornje (slika: SivaSlika, stevilo = 80, pragAbs = 0, minRazmik = 8): Kornj[] {
  const { sirina, visina } = slika
  if (sirina < 9 || visina < 9 || slika.siva.length < sirina * visina) return []
  const g = gladko5(slika.siva, sirina, visina)
  const rob = (x: number, y: number) => g[Math.min(visina - 1, Math.max(0, y)) * sirina + Math.min(sirina - 1, Math.max(0, x))]
  const gx = new Float64Array(sirina * visina)
  const gy = new Float64Array(sirina * visina)
  for (let y = 1; y < visina - 1; y++) {
    for (let x = 1; x < sirina - 1; x++) {
      const k = y * sirina + x
      gx[k] = (rob(x + 1, y - 1) - rob(x - 1, y - 1)) + 2 * (rob(x + 1, y) - rob(x - 1, y)) + (rob(x + 1, y + 1) - rob(x - 1, y + 1))
      gy[k] = (rob(x - 1, y + 1) - rob(x - 1, y - 1)) + 2 * (rob(x, y + 1) - rob(x, y - 1)) + (rob(x + 1, y + 1) - rob(x + 1, y - 1))
    }
  }
  const odzivi = new Float64Array(sirina * visina)
  let najvecji = 0
  for (let y = 2; y < visina - 2; y++) {
    for (let x = 2; x < sirina - 2; x++) {
      let ixx = 0
      let iyy = 0
      let ixy = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = (y + dy) * sirina + (x + dx)
          ixx += gx[k] * gx[k]
          iyy += gy[k] * gy[k]
          ixy += gx[k] * gy[k]
        }
      }
      const sled = ixx + iyy
      const determinanta = ixx * iyy - ixy * ixy
      const koren = Math.sqrt(Math.max(0, (sled / 2) * (sled / 2) - determinanta))
      const najmanjsa = sled / 2 - koren
      odzivi[y * sirina + x] = najmanjsa
      if (najmanjsa > najvecji) najvecji = najmanjsa
    }
  }
  // Absolutni prag na 8-bitni sliki ne pove ničesar o razmerju kontrastov,
  // zato je odločilen relativni prag (1 % najmočnejšega odziva).
  const prag = Math.max(pragAbs, 0.01 * najvecji)
  if (!(prag > 0)) return []
  const kandidati: Kornj[] = []
  for (let y = 2; y < visina - 2; y++) {
    for (let x = 2; x < sirina - 2; x++) {
      const odziv = odzivi[y * sirina + x]
      if (odziv < prag) continue
      let lokalniMaksimum = true
      for (let dy = -1; dy <= 1 && lokalniMaksimum; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (odzivi[(y + dy) * sirina + (x + dx)] > odziv) { lokalniMaksimum = false; break }
        }
      }
      if (!lokalniMaksimum) continue
      kandidati.push({ x, y, odziv })
    }
  }
  kandidati.sort((a, b) => (b.odziv - a.odziv) || (b.y - a.y) || (b.x - a.x))
  const izbrani: Kornj[] = []
  for (const k of kandidati) {
    if (izbrani.every((i) => Math.hypot(i.x - k.x, i.y - k.y) >= minRazmik)) {
      izbrani.push(k)
      if (izbrani.length >= stevilo) break
    }
  }
  // Podpikselna dodelava: parabola skozi tri sosednje odzive ima teme pri
  // x* = (R(-1)-R(1)) / (2·(R(-1)-2R(0)+R(1))). Dodelava je zadnji korak,
  // ker mora netrsko izbijanje ostati na celoštevilske mreži; oba premika se
  // računata iz PRVOTNE celoštevilske lege.
  for (const k of izbrani) {
    const dx = parabola(odzivi, sirina, k.x, k.y, 1)
    const dy = parabola(odzivi, sirina, k.x, k.y, 0)
    k.x += dx
    k.y += dy
  }
  return izbrani
}

/** Premik temena parabole skozi tri enakomerno razmaknjene vrednosti (±0,5 koraka). */
function parabolaTeme (a: number, b: number, c: number): number {
  const imenovalec = a - 2 * b + c
  if (!Number.isFinite(imenovalec) || Math.abs(imenovalec) < 1e-9) return 0
  return Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / imenovalec))
}

/** Premik temena odzivne ploskve na celoštevilski mreži (največ ±0,5 px). */
function parabola (odzivi: Float64Array, sirina: number, x: number, y: number, vodoravno: number): number {
  const za = vodoravno === 1 ? -1 : 0
  const nav = vodoravno === 1 ? 0 : -1
  return parabolaTeme(
    odzivi[(y + nav) * sirina + (x + za)],
    odzivi[y * sirina + x],
    odzivi[(y - nav) * sirina + (x - za)],
  )
}

// ── ujemanje koščic (NCC + razmerje + obojestranska preverba) ─────────────────

function koscica (g: Float64Array, sirina: number, visina: number, x: number, y: number, r: number): Float64Array | null {
  // +1: bilinearni vzorec potrebuje tudi desnega/spodnjega soseda
  if (x - r < 0 || y - r < 0 || x + r + 1 >= sirina || y + r + 1 >= visina) return null
  const out = new Float64Array((2 * r + 1) * (2 * r + 1))
  let i = 0
  // bilinearna vzorčenje okrog plavajoče sredine: podpikselna lega kornja
  // sicer ne bi vplivala na vsebino koščice in ujemanje bi ostalo na mreži.
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = x + dx
      const py = y + dy
      const x0 = Math.floor(px)
      const y0 = Math.floor(py)
      const wx = px - x0
      const wy = py - y0
      const a = g[y0 * sirina + x0]
      const b = g[y0 * sirina + x0 + 1]
      const c = g[(y0 + 1) * sirina + x0]
      const d = g[(y0 + 1) * sirina + x0 + 1]
      out[i++] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy
    }
  }
  return out
}

function ncc (a: Float64Array, b: Float64Array): number {
  const n = a.length
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i] }
  const ma = sa / n
  const mb = sb / n
  let sab = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    sab += da * db
    va += da * da
    vb += db * db
  }
  if (va < 1e-9 || vb < 1e-9) return -1
  return sab / Math.sqrt(va * vb)
}

/** Koščici se prekrivata, če sta sredini v obeh osih bliž kot 2r+1 pikslov. */
function sePrekrivata (a: Tocka2, b: Tocka2, r: number): boolean {
  return Math.abs(a.x - b.x) <= 2 * r && Math.abs(a.y - b.y) <= 2 * r
}

export interface MoznostiUjemanja { r?: number; iskanje?: number; pragRazmerja?: number; pragPodobosti?: number }

/**
 * Ujemanje po koščicah: najboljši NCC, Lowe-jevo razmerje (2./1.) in
 * obojestranska preverba. `iskanje` = polmer iskanja v pikslih (0 = brez
 * omejitve). Vrne pari indeksov podanih seznamov kornjev, deterministično.
 *
 * Koščice se vzorčijo z bilinearno interpolacijo na podpikselnih legah
 * kornjev. Pri razmerju se kot konkurenčna hipoteza šteje samo kornj, katerega
 * koščica se NE prekriva z najboljšo: dva kornja na istem robu/pegi sta
 * isti značilnost, ne dvoumnost, sicer bi vsaka gosta tekstura padla.
 */
export function ujemiKornje (
  a: SivaSlika,
  b: SivaSlika,
  kornjiA: Tocke2,
  kornjiB: Tocke2,
  moznosti: MoznostiUjemanja = {},
): Ujemanje[] {
  // 25x25 pikslov: pri premajhni koščici so prehodi in pegice med seboj dvoumni,
  // prevelika koščica pa že sega čez rob predmeta in čez okluzijo.
  const r = moznosti.r ?? 12
  const iskanje = moznosti.iskanje ?? 0
  const pragRazmerja = moznosti.pragRazmerja ?? 0.8
  const pragPodobosti = moznosti.pragPodobosti ?? 0.5
  if (kornjiA.length === 0 || kornjiB.length === 0) return []
  const gA = gladko5(a.siva, a.sirina, a.visina)
  const gB = gladko5(b.siva, b.sirina, b.visina)
  const vNoter = new Map<number, { j: number; podobost: number; razmerje: number }>()
  for (let i = 0; i < kornjiA.length; i++) {
    const pa = koscica(gA, a.sirina, a.visina, kornjiA[i].x, kornjiA[i].y, r)
    if (!pa) continue
    let best = -1
    let bestJ = -1
    let drugi = -1
    for (let j = 0; j < kornjiB.length; j++) {
      if (iskanje > 0 && (Math.abs(kornjiB[j].x - kornjiA[i].x) > iskanje || Math.abs(kornjiB[j].y - kornjiA[i].y) > iskanje)) continue
      const pb = koscica(gB, b.sirina, b.visina, kornjiB[j].x, kornjiB[j].y, r)
      if (!pb) continue
      const podobnost = ncc(pa, pb)
      if (podobnost > best) {
        // dosedanji najboljši ostane konkurenčna hipoteza samo, če se njegova
        // koščica ne prekriva z novo najboljšo (prekrivanje = ista značilnost)
        if (bestJ >= 0 && !sePrekrivata(kornjiB[bestJ], kornjiB[j], r)) drugi = Math.max(drugi, best)
        best = podobnost
        bestJ = j
      } else if (podobnost > drugi && bestJ >= 0 && !sePrekrivata(kornjiB[bestJ], kornjiB[j], r)) {
        drugi = podobnost
      }
    }
    if (bestJ < 0 || best < pragPodobosti) continue
    // če je drugi najdeni slab ali nasproten, je ujemanje enozno (razmerje 0)
    const razmerje = drugi > 0 ? drugi / best : 0
    if (razmerje > pragRazmerja) continue
    vNoter.set(i, { j: bestJ, podobost: best, razmerje })
  }
  const pari: Ujemanje[] = []
  for (const [i, kandidat] of vNoter) {
    const pb = koscica(gB, b.sirina, b.visina, kornjiB[kandidat.j].x, kornjiB[kandidat.j].y, r)
    if (!pb) continue
    let best = -1
    let bestI = -1
    for (let i2 = 0; i2 < kornjiA.length; i2++) {
      if (iskanje > 0 && (Math.abs(kornjiA[i2].x - kornjiB[kandidat.j].x) > iskanje || Math.abs(kornjiA[i2].y - kornjiB[kandidat.j].y) > iskanje)) continue
      const pa = koscica(gA, a.sirina, a.visina, kornjiA[i2].x, kornjiA[i2].y, r)
      if (!pa) continue
      const podobnost = ncc(pb, pa)
      if (podobnost > best) { best = podobnost; bestI = i2 }
    }
    if (bestI !== i) continue
    // Podpikselna dodelava para: maksimum NCC površine je navadno MED mrežo.
    // Parabola skozi tri vrednosti po vsaki osi (iste oblike kot pri kornjih)
    // da ujemanje na ~0,1 px; brez tega DLT ne loči prave geometrije od
    // bližnje napačne, ker je epipolarna napaka ~1 px enaka koraku mreže.
    const paI = koscica(gA, a.sirina, a.visina, kornjiA[i].x, kornjiA[i].y, r)
    let x = kornjiB[kandidat.j].x
    let y = kornjiB[kandidat.j].y
    let podobost = kandidat.podobost
    if (paI) {
      const kos = (dx: number, dy: number): number => {
        const p = koscica(gB, b.sirina, b.visina, x + dx, y + dy, r)
        return p ? ncc(paI, p) : Number.NEGATIVE_INFINITY
      }
      const osrednja = kos(0, 0)
      const dzx = parabolaTeme(kos(-1, 0), osrednja, kos(1, 0))
      const dzy = parabolaTeme(kos(0, -1), osrednja, kos(0, 1))
      x += dzx
      y += dzy
      const prenovljena = koscica(gB, b.sirina, b.visina, x, y, r)
      if (prenovljena) podobost = Math.max(podobost, ncc(paI, prenovljena))
    }
    pari.push({ i, j: kandidat.j, podobost, razmerje: kandidat.razmerje, x, y })
  }
  pari.sort((x, y) => (y.podobost - x.podobost) || (x.i - y.i) || (x.j - y.j))
  return pari
}

// ── epipolarna geometrija ────────────────────────────────────────────────────

export interface Normalizacija { T: Mat3; Tinv: Mat3 }

/** Hartleyjeva normalizacija: težišče v izhodišče, povprečna razdalja √2. */
export function normaliziraj (tocke: Tocke2): Normalizacija | null {
  const n = tocke.length
  if (n < 2) return null
  let sx = 0
  let sy = 0
  for (const t of tocke) { sx += t.x; sy += t.y }
  const cx = sx / n
  const cy = sy / n
  let sd = 0
  for (const t of tocke) sd += Math.hypot(t.x - cx, t.y - cy)
  const povprecje = sd / n
  if (!(povprecje > 1e-9)) return null
  const s = Math.SQRT2 / povprecje
  return {
    T: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1] as Mat3,
    Tinv: [1 / s, 0, cx, 0, 1 / s, cy, 0, 0, 1] as Mat3,
  }
}

function apliciraj (m: Mat3, t: Tocka2): Tocka2 {
  const x = m[0] * t.x + m[1] * t.y + m[2]
  const y = m[3] * t.x + m[4] * t.y + m[5]
  const w = m[6] * t.x + m[7] * t.y + m[8]
  if (Math.abs(w) < 1e-12) return { x: Number.NaN, y: Number.NaN }
  return { x: x / w, y: y / w }
}

/**
 * Normalizirana linearna DLT za osnovno matriko F iz ≥ 8 parov (H&Z 11.1):
 * rešitev je lastni vektor NAJMANJŠE lastne vrednosti AᵗA. Vrne null, če je
 * sistem degeneričen (točke v premici, premalo parov, enoznačna rešitev nemogoča).
 */
export function osnovnaMatrikaIzParov (p1: Tocke2, p2: Tocke2): Mat3 | null {
  const n = Math.min(p1.length, p2.length)
  if (n < 8) return null
  const normA = normaliziraj(p1.slice(0, n))
  const normB = normaliziraj(p2.slice(0, n))
  if (!normA || !normB) return null
  const q1 = p1.slice(0, n).map((t) => apliciraj(normA.T, t))
  const q2 = p2.slice(0, n).map((t) => apliciraj(normB.T, t))
  const ata: number[][] = Array.from({ length: 9 }, () => new Array(9).fill(0))
  for (let i = 0; i < n; i++) {
    const u = q1[i].x
    const v = q1[i].y
    const uc = q2[i].x
    const vc = q2[i].y
    if (![u, v, uc, vc].every((x) => Number.isFinite(x))) return null
    // stolpci ustrezajo f = [F00,F01,F02,F10,F11,F12,F20,F21,F22] v enačbi
    // x2^T F x1 = 0 (H&Z 11.1): [u*uc, v*uc, uc, u*vc, v*vc, vc, u, v, 1]
    const vrstica = [u * uc, v * uc, uc, u * vc, v * vc, vc, u, v, 1]
    for (let r = 0; r < 9; r++) {
      if (vrstica[r] === 0) continue
      for (let c = r; c < 9; c++) {
        ata[r][c] += vrstica[r] * vrstica[c]
        if (c !== r) ata[c][r] += vrstica[r] * vrstica[c]
      }
    }
  }
  const e = simLastneN(ata, 9)
  const najvecja = Math.abs(e.vrednosti[0])
  const najmanjsa = Math.abs(e.vrednosti[8])
  // enoznačna rešitev obstaja samo, če je najmanjša smer bistveno plitvejša
  if (!(najvecja > 1e-12) || najmanjsa > 1e-6 * najvecja) return null
  const f = e.stolpci[8]
  const fNormalizirana: Mat3 = [f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8]] as Mat3
  // F = T_bᵀ · F_norm · T_a
  return mnozi3(mnozi3(transponiraj3(normB.T), fNormalizirana), normA.T)
}

/** Vsili rang 2: odvzemi komponento najmanjše singularne vrednosti, normiraj. */
export function vsiliRang2 (F: Mat3): Mat3 {
  const { u, s, v } = svd3(F)
  let k = 0
  for (let i = 1; i < 3; i++) if (s[i] < s[k]) k = i
  const uk = stolpec3(u, k)
  const vk = stolpec3(v, k)
  const o = [...F] as Mat3
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 3 + c] = F[r * 3 + c] - uk[r] * s[k] * vk[c]
  }
  const norma = Math.sqrt(o.reduce((acc, x) => acc + x * x, 0))
  return norma > 1e-12 ? (o.map((x) => x / norma) as Mat3) : o
}

/** Simetrična epipolarna napaka (razdalje točka-črta v obeh slikah), px². */
export function epipolarnaNapaka (F: Mat3, p: Tocka2, q: Tocka2): number {
  const crta2 = mnoziMatVec3(F, [p.x, p.y, 1])
  const crta1 = mnoziMatVec3(transponiraj3(F), [q.x, q.y, 1])
  const n2 = Math.hypot(crta2[0], crta2[1])
  const n1 = Math.hypot(crta1[0], crta1[1])
  if (!(n2 > 1e-12) || !(n1 > 1e-12)) return Number.POSITIVE_INFINITY
  const a = (crta2[0] * q.x + crta2[1] * q.y + crta2[2]) / n2
  const b = (crta1[0] * p.x + crta1[1] * p.y + crta1[2]) / n1
  return 0.5 * (a * a + b * b)
}

export interface RansacF {
  F: Mat3 | null
  veliki: number[]
  delez: number
  pragPik: number
  poskusi: number
  uspesni: number
}

/**
 * RANSAC verifikacija ujemanj: minimalni vzorec 8 parov, simetrična napaka,
 * vsiljen rang 2. Fiksen seed → enak rezultat v vsakem zagonu.
 *
 * Po izbiri consensusa sledi lokalna optimizacija (H&Z 9.4.4): F se ponovno
 * izračuna na vseh veliki in konsensus se proti tej novi F ponovno izbere.
 * Minimalni vzorec iz 8 parov nosi šum ujemanj; brez tega koraka model
 * obdrži pare, ki so bili sprejeti le zato, ker je vzorec bil napačen.
 */
export function ransacOsnovnaMatrika (
  p1: Tocke2,
  p2: Tocke2,
  moznosti: { pragPik?: number; poskusi?: number; seed?: number } = {},
): RansacF {
  const pragPik = moznosti.pragPik ?? 1.0
  const poskusi = moznosti.poskusi ?? 120
  const nakljucje = ustvariNakljucje(moznosti.seed ?? 20261013)
  const n = Math.min(p1.length, p2.length)
  if (n < 8) return { F: null, veliki: [], delez: 0, pragPik, poskusi: 0, uspesni: 0 }
  let najboljsi: number[] = []
  let najboljsaF: Mat3 | null = null
  let uspesni = 0
  for (let poskus = 0; poskus < poskusi; poskus++) {
    const vzorec = new Set<number>()
    let varovanje = 0
    while (vzorec.size < 8 && varovanje < 64) { vzorec.add(Math.floor(nakljucje() * n)); varovanje++ }
    if (vzorec.size < 8) break
    const indeks = [...vzorec]
    const F = osnovnaMatrikaIzParov(indeks.map((i) => p1[i]), indeks.map((i) => p2[i]))
    if (!F) continue
    const F2 = vsiliRang2(F)
    uspesni++
    const veliki: number[] = []
    for (let i = 0; i < n; i++) {
      if (epipolarnaNapaka(F2, p1[i], p2[i]) <= pragPik * pragPik) veliki.push(i)
    }
    if (veliki.length > najboljsi.length) { najboljsi = veliki; najboljsaF = F2 }
  }
  if (!najboljsaF || najboljsi.length < 8) return { F: null, veliki: [], delez: 0, pragPik, poskusi, uspesni }
  let veliki = najboljsi
  let F = najboljsaF
  for (let ponovitev = 0; ponovitev < 2; ponovitev++) {
    const preciscena = osnovnaMatrikaIzParov(veliki.map((i) => p1[i]), veliki.map((i) => p2[i]))
    const kandidat = preciscena ? vsiliRang2(preciscena) : null
    if (!kandidat) break
    const ponovno: number[] = []
    for (let i = 0; i < n; i++) {
      if (epipolarnaNapaka(kandidat, p1[i], p2[i]) <= pragPik * pragPik) ponovno.push(i)
    }
    if (ponovno.length < 8) break
    F = kandidat
    veliki = ponovno
  }
  return { F, veliki, delez: veliki.length / n, pragPik, poskusi, uspesni }
}

export function matrikaIntrinsics (k: Intrinsics): Mat3 {
  return [k.fx, 0, k.cx, 0, k.fy, k.cy, 0, 0, 1] as Mat3
}

/**
 * E = K₂ᵀ · F · K₁ (obrat H&Z en. 9.1: F = K₂⁻ᵀ E K₁⁻¹). Intrinseka morata
 * biti kalibrirana — sicer epipolarna geometrija ni primerljiva s slikovnimi
 * piksli. K ni simetrična matrika, zato je transponiranka obvezna.
 */
export function esencialnaIzF (F: Mat3, k1: Intrinsics, k2: Intrinsics): Mat3 | null {
  return vsiliRang2(mnozi3(mnozi3(transponiraj3(matrikaIntrinsics(k2)), F), matrikaIntrinsics(k1)))
}

// ── razcep esencialne matrike in triangulacija ────────────────────────────────

export interface KandidatPogled {
  R: Mat3
  t: Vec3
  /** mediana projekcijska napaka preizkušenih točk, px */
  napakaPx: number
  /** število točk PRED obema kamera (chevraliteta) */
  naprej: number
  /** `indeks` = mesto para v vhodnih seznamih (vez back na ujemanja) */
  tocke: { x: number; y: number; z: number; napakaPx: number; indeks: number }[]
}

/** P = K [R | t] (3x4). */
export function matrikaProjekcije (k: Intrinsics, r: Mat3, t: Vec3): Matrika3x4 {
  const rt = [
    [r[0], r[1], r[2], t[0]],
    [r[3], r[4], r[5], t[1]],
    [r[6], r[7], r[8], t[2]],
  ]
  const kv = [[k.fx, 0, k.cx], [0, k.fy, k.cy], [0, 0, 1]]
  const out: number[][] = []
  for (let i = 0; i < 3; i++) {
    const vrstica: number[] = []
    for (let j = 0; j < 4; j++) {
      let vsota = 0
      for (let m = 0; m < 3; m++) vsota += kv[i][m] * rt[m][j]
      vrstica.push(vsota)
    }
    out.push(vrstica)
  }
  return out
}

export const IDENTITETNA_PROJEKCIJA: Matrika3x4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]

/** Linearna triangulacija iz dveh projekcijskih matrik v pikslih. */
export function trianguliraj (P1: Matrika3x4, P2: Matrika3x4, x1: Tocka2, x2: Tocka2): { x: number; y: number; z: number } | null {
  const enacbe: number[][] = []
  for (const [P, tocka] of [[P1, x1], [P2, x2]] as [Matrika3x4, Tocka2][]) {
    const u = tocka.x
    const v = tocka.y
    const ru: number[] = []
    const rv: number[] = []
    for (let c = 0; c < 4; c++) {
      ru.push(u * P[2][c] - P[0][c])
      rv.push(v * P[2][c] - P[1][c])
    }
    enacbe.push(ru, rv)
  }
  // afini gauge: X = (x, y, z, 1) → A₃·(x,y,z) = −a₄, rešeno po normalnih enačbah
  const n: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const y: number[] = [0, 0, 0]
  for (const enacba of enacbe) {
    const desna = -enacba[3]
    for (let r = 0; r < 3; r++) {
      y[r] += enacba[r] * desna
      for (let c = 0; c < 3; c++) n[r][c] += enacba[r] * enacba[c]
    }
  }
  const resitev = resisiSistem(n, y)
  if (!resitev || !resitev.every((vrednost) => Number.isFinite(vrednost))) return null
  return { x: resitev[0], y: resitev[1], z: resitev[2] }
}

function projekcijskaNapaka (P: Matrika3x4, X: { x: number; y: number; z: number }, x: Tocka2): number {
  const wx = P[0][0] * X.x + P[0][1] * X.y + P[0][2] * X.z + P[0][3]
  const wy = P[1][0] * X.x + P[1][1] * X.y + P[1][2] * X.z + P[1][3]
  const ww = P[2][0] * X.x + P[2][1] * X.y + P[2][2] * X.z + P[2][3]
  if (Math.abs(ww) < 1e-12) return Number.POSITIVE_INFINITY
  return Math.hypot(wx / ww - x.x, wy / ww - x.y)
}

/**
 * Razcep E na štiri kandidate [R|t] (H&Z en. 9.16) in izbira po chevraliteti:
 * več točk PRED obema kamera, nato manjša mediana projekcijska napaka.
 * Klasično, brez naučenega ničesar.
 */
export function razcepEsencialne (
  E: Mat3,
  p1: Tocke2,
  p2: Tocke2,
  k1: Intrinsics,
  k2: Intrinsics,
): { izbrani: KandidatPogled | null; kandidati: KandidatPogled[] } {
  const W = [0, -1, 0, 1, 0, 0, 0, 0, 1] as Mat3
  const { u, v } = svd3Rotacijski(E)
  const R1 = mnozi3(mnozi3(u, W), transponiraj3(v))
  const R2 = mnozi3(mnozi3(u, transponiraj3(W)), transponiraj3(v))
  const t = stolpec3(u, 2)
  const P1 = matrikaProjekcije(k1, [1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3, [0, 0, 0])
  const n = Math.min(p1.length, p2.length)
  const kandidati: KandidatPogled[] = []
  const pare: [Mat3, Vec3][] = [
    [R1, t],
    [R1, [-t[0], -t[1], -t[2]]],
    [R2, t],
    [R2, [-t[0], -t[1], -t[2]]],
  ]
  for (const [R, premik] of pare) {
    const P2 = matrikaProjekcije(k2, R, premik)
    const tocke: { x: number; y: number; z: number; napakaPx: number; indeks: number }[] = []
    const napake: number[] = []
    let naprejStevilo = 0
    for (let i = 0; i < n; i++) {
      const X = trianguliraj(P1, P2, p1[i], p2[i])
      if (!X) continue
      const globina1 = X.z
      const globina2 = R[6] * X.x + R[7] * X.y + R[8] * X.z + premik[2]
      const napaka = Math.hypot(projekcijskaNapaka(P1, X, p1[i]), projekcijskaNapaka(P2, X, p2[i]))
      if (Number.isFinite(napaka)) napake.push(napaka)
      if (globina1 > 0 && globina2 > 0) { naprejStevilo++; tocke.push({ ...X, napakaPx: napaka, indeks: i }) }
    }
    kandidati.push({ R, t: premik, napakaPx: median(napake) ?? Number.POSITIVE_INFINITY, naprej: naprejStevilo, tocke })
  }
  kandidati.sort((a, b) => (b.naprej - a.naprej) || (a.napakaPx - b.napakaPx) || (a.t[0] - b.t[0]))
  const izbrani = kandidati.length > 0 && kandidati[0].naprej > 0 ? kandidati[0] : null
  return { izbrani, kandidati }
}

/** Medianna projekcijska napaka (px) rekonstrukcije na podanih matrikah. */
export function napakaRekonstrukcije (
  P1: Matrika3x4,
  P2: Matrika3x4,
  p1: Tocke2,
  p2: Tocke2,
): number | null {
  const napake: number[] = []
  for (let i = 0; i < Math.min(p1.length, p2.length); i++) {
    const X = trianguliraj(P1, P2, p1[i], p2[i])
    if (!X) continue
    const e = Math.hypot(projekcijskaNapaka(P1, X, p1[i]), projekcijskaNapaka(P2, X, p2[i]))
    if (Number.isFinite(e)) napake.push(e)
  }
  return median(napake)
}

// ── absolutno merilo iz fizične reference ────────────────────────────────────

export interface Merilo { znan: boolean; cmNaEnoto: number | null; razlogi: string[] }

/**
 * Absolutno merilo: rekonstrukcija je določena samo do skale, zato mora priti
 * iz PREVERJENE fizične razdalje med dvema rekonstruiranima točkama. Brez
 * veljavne reference rezultat ni metričen — vrnemo `znan: false`, ne domneve.
 */
export function meriloIzReference (vhodi: {
  tockaA: { x: number; y: number; z: number }
  tockaB: { x: number; y: number; z: number }
  razdaljaCm: number | null | undefined
}): Merilo {
  const razdalja = vhodi.razdaljaCm
  if (razdalja === null || razdalja === undefined || !Number.isFinite(razdalja) || razdalja <= 0) {
    return { znan: false, cmNaEnoto: null, razlogi: ['fizična referenčna razdalja manjka ali ni veljavna — model je določen samo do skale'] }
  }
  if (razdalja > 10000) {
    return { znan: false, cmNaEnoto: null, razlogi: [`referenčna razdalja ${razdalja} cm je izven okvirja (≤ 100 m) — merilo se zavrne`] }
  }
  const enote = Math.hypot(
    vhodi.tockaB.x - vhodi.tockaA.x,
    vhodi.tockaB.y - vhodi.tockaA.y,
    vhodi.tockaB.z - vhodi.tockaA.z,
  )
  if (!(enote > 1e-9)) {
    return { znan: false, cmNaEnoto: null, razlogi: ['referenčni točki v rekonstrukciji sovpadata — iz njiju ni mogoče izračunati merila'] }
  }
  return { znan: true, cmNaEnoto: razdalja / enote, razlogi: [] }
}

// ── kakovost in protokol sprejema/zavrnitve ──────────────────────────────────

export interface KakovostModela {
  steviloSlik: number
  kornjiA: number
  kornjiB: number
  steviloUjemanj: number
  steviloVelikih: number
  delezVelikih: number
  medianaEpipolarneNapakePx: number
  medianaProjekcijskeNapakePx: number
  /** medianni parallaktični kot med žarkoma obeh kamer, stopinje */
  paralaksaDeg: number
  rekonstruiraneTocke: number
  /** pogledi brez dovolj gradiva (tekstura, prekrivanje) — imenovani, ne tiho */
  slabiPogledi: string[]
}

export type Odlozitev = 'SPREJET' | 'ZAVRNJEN' | 'DODATNI_POSNETKI'

export interface Pragi {
  minKornjev: number
  minUjemanj: number
  minVelikih: number
  minDelezVelikih: number
  maxMedianaProjekcijskePx: number
  minParaktikaDeg: number
}

export interface Protokol {
  odlozitev: Odlozitev
  razlogi: string[]
  pragi: Pragi
}

/** Pragovi so odprt zapis, ne skrita števila v kodi. */
export const FOTOGRAMMETRIJA_PRAGI: Pragi = {
  minKornjev: 12,
  minUjemanj: 12,
  minVelikih: 8,
  minDelezVelikih: 0.5,
  maxMedianaProjekcijskePx: 1.0,
  minParaktikaDeg: 1.0,
}

export function median (stevila: number[]): number | null {
  if (stevila.length === 0) return null
  const s = [...stevila].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Protokol zavrnitve (issue #15 faza 3): ni gradiva → DODATNI_POSNETKI,
 * geometrija ne drži → ZAVRNJEN, merilo brez reference → ni metrično.
 * Vsaka zavrnitev IMENUJE razlog; lažno sprejetega modela nikoli ne vrne.
 */
export function presodi (kakovost: KakovostModela, merilo: Merilo, pragi: Pragi = FOTOGRAMMETRIJA_PRAGI): Protokol {
  const razlogi: string[] = []
  let manjkaGradivo = false
  for (const p of kakovost.slabiPogledi) { razlogi.push(p); manjkaGradivo = true }
  if (kakovost.kornjiA < pragi.minKornjev || kakovost.kornjiB < pragi.minKornjev) {
    razlogi.push(`premalo kornjev (A: ${kakovost.kornjiA}, B: ${kakovost.kornjiB} < ${pragi.minKornjev}) — prizor je lahko brez teksture, steklen ali odseiven`)
    manjkaGradivo = true
  }
  if (kakovost.steviloUjemanj < pragi.minUjemanj) {
    razlogi.push(`premalo enoznačnih ujemanj (${kakovost.steviloUjemanj} < ${pragi.minUjemanj}) — premajhno prekrivanje ali ponavljajoč se vzorec`)
    manjkaGradivo = true
  }
  if (kakovost.steviloVelikih < pragi.minVelikih) {
    razlogi.push(`geometrijska verifikacija ni našla dovolj konsistentnih parov (${kakovost.steviloVelikih} < ${pragi.minVelikih})`)
  }
  if (!(kakovost.delezVelikih >= pragi.minDelezVelikih)) {
    razlogi.push(`delež preverjenih ujemanj ${Math.round(kakovost.delezVelikih * 100)} % < ${Math.round(pragi.minDelezVelikih * 100)} % — epipolarna geometrija ne drži`)
  }
  if (!(kakovost.paralaksaDeg >= pragi.minParaktikaDeg)) {
    razlogi.push(`premajhen paralaktični kot (${kakovost.paralaksaDeg.toFixed(2)}° < ${pragi.minParaktikaDeg}°) — gibanje med pogledoma je premalo za 3D`)
    manjkaGradivo = true
  }
  if (!(kakovost.medianaProjekcijskeNapakePx <= pragi.maxMedianaProjekcijskePx)) {
    const prikaz = Number.isFinite(kakovost.medianaProjekcijskeNapakePx) ? kakovost.medianaProjekcijskeNapakePx.toFixed(2) : 'neznana'
    razlogi.push(`mediana projekcijska napaka ${prikaz} px > ${pragi.maxMedianaProjekcijskePx} px`)
  }
  if (kakovost.rekonstruiraneTocke < pragi.minVelikih) {
    razlogi.push(`premalo rekonstruiranih točk pred obema kamerama (${kakovost.rekonstruiraneTocke})`)
  }
  if (!merilo.znan) {
    for (const r of merilo.razlogi) razlogi.push(r)
    razlogi.push('brez validiranega merila rekonstrukcija NI metrična — številke v cm ne obstajajo')
  }
  const odlozitev: Odlozitev = razlogi.length === 0 ? 'SPREJET' : manjkaGradivo ? 'DODATNI_POSNETKI' : 'ZAVRNJEN'
  return { odlozitev, razlogi, pragi }
}

// ── orkestracija dveh pogledov (offline, deterministično) ────────────────────

export interface RezultatDvehPogledov {
  kakovost: KakovostModela
  protokol: Protokol
  merilo: Merilo
  F: Mat3 | null
  E: Mat3 | null
  kameraDruga: { R: Mat3; t: Vec3 } | null
  tocke: { x: number; y: number; z: number; napakaPx: number; indeks: number }[]
  tockeA: Tocke2
  tockeB: Tocke2
  veliki: number[]
}

/**
 * Celotna veriga na dveh pogledih: kornje → ujemanje → F (RANSAC) → E →
 * [R|t] (chevraliteta) → triangulacija → merilo iz reference → protokol.
 *
 * `referenca` je FIZIČNO izmerjena razdalja med dvema rekonstruiranima točkama
 * (`indexA`/`indexB` se nanašata na rezultat `tocke`). `intrinseki` morata biti
 * kalibrirana, ne procenjena iz istih slik — sicer merilo ni verodostojno.
 */
export function fotogrametrijaDvehPogledov (vhodi: {
  slikaA: SivaSlika
  slikaB: SivaSlika
  intrinseki: { a: Intrinsics; b: Intrinsics }
  referenca?: { indexA: number; indexB: number; razdaljaCm: number | null } | null
  kornjevMax?: number
  iskanjeUjemanj?: number
  pragi?: Pragi
}): RezultatDvehPogledov {
  const pragi = vhodi.pragi ?? FOTOGRAMMETRIJA_PRAGI
  const najdbe = vhodi.kornjevMax ?? 80
  const kornjiA = detektirajKornje(vhodi.slikaA, najdbe)
  const kornjiB = detektirajKornje(vhodi.slikaB, najdbe)
  const ujemanja = ujemiKornje(vhodi.slikaA, vhodi.slikaB, kornjiA, kornjiB, { iskanje: vhodi.iskanjeUjemanj ?? 0 })
  const tockeA: Tocke2 = ujemanja.map((u) => ({ x: kornjiA[u.i].x, y: kornjiA[u.i].y }))
  const tockeB: Tocke2 = ujemanja.map((u) => ({ x: u.x ?? kornjiB[u.j].x, y: u.y ?? kornjiB[u.j].y }))
  const rs = ransacOsnovnaMatrika(tockeA, tockeB, { pragPik: 1.0, poskusi: 120 })
  const E = rs.F ? esencialnaIzF(rs.F, vhodi.intrinseki.a, vhodi.intrinseki.b) : null
  const velikiA = rs.veliki.map((i) => tockeA[i])
  const velikiB = rs.veliki.map((i) => tockeB[i])
  const razcep = E
    ? razcepEsencialne(E, velikiA, velikiB, vhodi.intrinseki.a, vhodi.intrinseki.b)
    : { izbrani: null, kandidati: [] as KandidatPogled[] }
  const tocke = razcep.izbrani ? razcep.izbrani.tocke : []
  const epipolarne = velikiA
    .map((p, i) => (rs.F ? Math.sqrt(Math.max(0, epipolarnaNapaka(rs.F, p, velikiB[i]))) : Number.NaN))
    .filter((x) => Number.isFinite(x))
  const slabiPogledi: string[] = []
  if (vhodi.slikaA.sirina < 9 || vhodi.slikaA.visina < 9) slabiPogledi.push('pogled A je premajhen za geometrijo (najmanj 9x9 px)')
  if (vhodi.slikaB.sirina < 9 || vhodi.slikaB.visina < 9) slabiPogledi.push('pogled B je premajhen za geometrijo (najmanj 9x9 px)')
  const kakovost: KakovostModela = {
    steviloSlik: 2,
    kornjiA: kornjiA.length,
    kornjiB: kornjiB.length,
    steviloUjemanj: ujemanja.length,
    steviloVelikih: rs.veliki.length,
    delezVelikih: ujemanja.length > 0 ? rs.veliki.length / ujemanja.length : 0,
    medianaEpipolarneNapakePx: median(epipolarne) ?? Number.NaN,
    medianaProjekcijskeNapakePx: median(tocke.map((t) => t.napakaPx)) ?? Number.POSITIVE_INFINITY,
    paralaksaDeg: paralaksa(razcep.izbrani, tocke),
    rekonstruiraneTocke: tocke.length,
    slabiPogledi,
  }
  let merilo: Merilo = { znan: false, cmNaEnoto: null, razlogi: ['referenčna fizična razdalja ni bila podana'] }
  const ref = vhodi.referenca
  if (ref && tocke.length > Math.max(ref.indexA, ref.indexB)) {
    merilo = meriloIzReference({ tockaA: tocke[ref.indexA], tockaB: tocke[ref.indexB], razdaljaCm: ref.razdaljaCm })
  }
  return {
    kakovost,
    protokol: presodi(kakovost, merilo, pragi),
    merilo,
    F: rs.F,
    E,
    kameraDruga: razcep.izbrani ? { R: razcep.izbrani.R, t: razcep.izbrani.t } : null,
    tocke,
    tockeA,
    tockeB,
    veliki: rs.veliki,
  }
}

/** Medianni parallaktični kot med žarkoma obeh kamer (°); 0 brez modela. */
export function paralaksa (izbrani: KandidatPogled | null, tocke: { x: number; y: number; z: number }[]): number {
  if (!izbrani || tocke.length === 0) return 0
  const Rt = transponiraj3(izbrani.R)
  const center2: Vec3 = [
    -(Rt[0] * izbrani.t[0] + Rt[1] * izbrani.t[1] + Rt[2] * izbrani.t[2]),
    -(Rt[3] * izbrani.t[0] + Rt[4] * izbrani.t[1] + Rt[5] * izbrani.t[2]),
    -(Rt[6] * izbrani.t[0] + Rt[7] * izbrani.t[1] + Rt[8] * izbrani.t[2]),
  ]
  const koti: number[] = []
  for (const X of tocke) {
    const dolzina1 = Math.hypot(X.x, X.y, X.z)
    const dx = X.x - center2[0]
    const dy = X.y - center2[1]
    const dz = X.z - center2[2]
    const dolzina2 = Math.hypot(dx, dy, dz)
    if (!(dolzina1 > 1e-9) || !(dolzina2 > 1e-9)) continue
    const kos = (X.x * dx + X.y * dy + X.z * dz) / (dolzina1 * dolzina2)
    koti.push(Math.acos(Math.min(1, Math.max(-1, kos))) * 180 / Math.PI)
  }
  return median(koti) ?? 0
}

/** Kot med rotacijskima matrikama (°) — za primerjavo z znano istino. */
export function kotR (a: Mat3, b: Mat3): number {
  const produkt = mnozi3(a, transponiraj3(b))
  const sled = produkt[0] + produkt[4] + produkt[8]
  return Math.acos(Math.min(1, Math.max(-1, (sled - 1) / 2))) * 180 / Math.PI
}

/** Kot med smernima vektorjema (°). */
export function kotV (a: Vec3, b: Vec3): number {
  const na = Math.hypot(a[0], a[1], a[2])
  const nb = Math.hypot(b[0], b[1], b[2])
  if (!(na > 1e-12) || !(nb > 1e-12)) return Number.NaN
  const kos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb)
  return Math.acos(Math.min(1, Math.max(-1, kos))) * 180 / Math.PI
}

/**
 * Dokazni protokol fotogrametrije (issue #15, faza 3) — KONTROLIRAN IZPIT.
 *
 * Naredi to, kar od faze 3 zahteva issue: ne ime funkcije in ne napis v
 * UI-ju, ampak **pravo rekonstrukcijo na testnem objektu z ZNANO ISTINO**.
 * Scena je merilna plošča s tremi letvami pred njo (dve globini, spekel
 * tekstura), izrisana skozi dve pinhole kameri z znanim [R|t] in znano
 * notranjo kalibracijo. Podatki pridejo iz determinističnega generatorja
 * (xorshift, fiksen seed) — brez fotoaparata, brez AI, brez plačljivih
 * API-jev, brez novih odvisnosti.
 *
 * Veriga, ki jo izpit pregleda KORAK ZA KORAKOM:
 *   1. linearna algebra (simetrični lastni razcep, SVD, triangulacija) —
 *      ostanki proti ročno izračunani istini,
 *   2. epipolarna geometrija na čistih (brezšumnih) projektih — F, E, [R|t],
 *   3. zajem: detekcija kornjev na izrisani sliki,
 *   4. ujemanje koščic → RANSAC → razcep → triangulacija na REALNIH (kvantiziranih,
 *      interpoliranih) slikah,
 *   5. merilo iz fizične reference in protokol zavrnitve na šestih pokvarjenih
 *      primerih (brez teksture, čista rotacija, ponavljajoč vzorec, premaknjena
 *      kamera, nič reference, referenca izmerjena za 1 % narobe).
 *
 * Izvoz tega poročila je artefakt `docs/artefacts/fotogrametrija-dokaz.json`;
 * licenčni pregled in pogoji izvajanja: `docs/PHOTOGRAMMETRY-3D.md`.
 */

import {
  FOTOGRAMMETRIJA_PRAGI, esencialnaIzF, epipolarnaNapaka, fotogrametrijaDvehPogledov,
  kotR, kotV, matrikaProjekcije, median, meriloIzReference, mnozi3, osnovnaMatrikaIzParov,
  presodi, ransacOsnovnaMatrika, razcepEsencialne, simLastneN, svd3, transponiraj3, trianguliraj,
  ustvariNakljucje, vsiliRang2,
  type Intrinsics, type Mat3, type Matrika3x4, type SivaSlika, type Tocka2, type Tocke2, type Vec3,
} from './photogrammetry-core'

const JEDRO = 1e-9

// ── scena: merilna plošča z letvjo pred njo (več globin) ─────────────────────

/** Ena ravnina s svojo teksturo — panel, steber, ročica. */
export interface Sloj {
  /** poljubna točka ravnine (cm) */
  T: Vec3
  /** enotska normala ravnine */
  N: Vec3
  /** ortonormirana bazna vektorja ravnine */
  E1: Vec3
  E2: Vec3
  /** polovica merila vzdolž E1 in E2 (cm) */
  robE1: number
  robE2: number
  tekstura: Float64Array
  teksturaSirina: number
  teksturaVisina: number
}

export interface Scena {
  sirina: number
  visina: number
  intrinseki: Intrinsics
  /** vrstni red je nepomemben: izris in istina izbereta NAJBLIŽJI vidni sloj */
  sloji: Sloj[]
  /** lega druge kamere: x_slika = K (R x_svet + t) */
  R: Mat3
  t: Vec3
  /** ozadje izven vseh slojev (sivina) */
  ozadje: number
}

function enotski (v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2])
  if (!(n > JEDRO)) throw new Error('scena: normala ni smiselna')
  return [v[0] / n, v[1] / n, v[2] / n]
}

function produktSkalarni (a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function kriz (a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Rotacija po fiksnem vrstnem redu Rx · Ry · Rz ( koti v stopinjah). */
export function rotacijaMatrika (xDeg: number, yDeg: number, zDeg: number): Mat3 {
  const a = xDeg * Math.PI / 180
  const b = yDeg * Math.PI / 180
  const c = zDeg * Math.PI / 180
  const rx: Mat3 = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)]
  const ry: Mat3 = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)]
  const rz: Mat3 = [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1]
  return mnozi3(mnozi3(rx, ry), rz)
}

/**
 * Tekstura ploščine: spekel (lise različnih velikosti in kontrasta na rahlo
 * zrnatem osnovnem sloju). To je v praksi standardni prijem za objekte brez
 * lastne teksture. `ponovitev > 0` naredi PERIODIČEN vzorec — primer, ki ga
 * mora protokol zavrniti, ker so ujemanja dvoumna; `enotna` vrne enakno sivo
 * ploščo brez kornjev.
 */
export function ustvariTeksturo (seed: number, sirina: number, visina: number, moznosti: { ponovitev?: number; enotna?: boolean; lise?: number; sigmaMin?: number; sigmaMax?: number } = {}): Float64Array {
  if (moznosti.enotna) return new Float64Array(sirina * visina).fill(128)
  const ponovitev = moznosti.ponovitev ?? 0
  if (ponovitev > 0) {
    const izhod = new Float64Array(sirina * visina)
    for (let y = 0; y < visina; y++) {
      for (let x = 0; x < sirina; x++) {
        const px = x % ponovitev
        const py = y % ponovitev
        // periodičen element: vsak ploščični kot in rob je identičen
        const rob = px < 2 || py < 2 || px > ponovitev - 3 || py > ponovitev - 3
        izhod[y * sirina + x] = rob ? 225 : 45 + ((px * 3 + py * 5) % 7)
      }
    }
    return izhod
  }
  const nakljucje = ustvariNakljucje(seed)
  const siva = new Float64Array(sirina * visina).fill(140)
  const steviloLis = moznosti.lise ?? Math.round(sirina * visina / 240)
  for (let i = 0; i < steviloLis; i++) {
    const sx = nakljucje() * sirina
    const sy = nakljucje() * visina
    const sigmaMin = moznosti.sigmaMin ?? 1.1
    const sigma = sigmaMin + nakljucje() * ((moznosti.sigmaMax ?? 4.1) - sigmaMin)
    const amplituda = (nakljucje() < 0.5 ? -1 : 1) * (45 + nakljucje() * 105)
    const doseg = Math.ceil(sigma * 2.6)
    for (let dy = -doseg; dy <= doseg; dy++) {
      const yy = Math.floor(sy) + dy
      if (yy < 0 || yy >= visina) continue
      for (let dx = -doseg; dx <= doseg; dx++) {
        const xx = Math.floor(sx) + dx
        if (xx < 0 || xx >= sirina) continue
        const d2 = (xx + 0.5 - sx) * (xx + 0.5 - sx) + (yy + 0.5 - sy) * (yy + 0.5 - sy)
        siva[yy * sirina + xx] += amplituda * Math.exp(-d2 / (2 * sigma * sigma))
      }
    }
  }
  // rahel zrnat robovnik: površina je vedno malo hrupna, nikoli popolnoma gladka
  for (let i = 0; i < siva.length; i++) siva[i] += (nakljucje() - 0.5) * 10
  return siva
}

/** Letev/stebel pred panelom: ravnina, vzporedna panelu, zamaknjena proti kameri. */
interface LetvDefinicija {
  /** zamik pred panelom (cm) */
  globina: number
  /** položaj na panelu (cm vzdolz E1/E2) */
  e1: number
  e2: number
  robE1: number
  robE2: number
  seed: number
}

export function ustvariSceno (mozni: {
  seed?: number
  rotacija?: { x?: number; y?: number; z?: number }
  premik?: Vec3
  globina?: number
  naklon?: Vec3
  ponovitev?: number
  /** enakna siva plošča (steklo / ravna barva) — brez kornjev */
  enotna?: boolean
  /** samo ravna plošča brez letvi — degeneriran primer, ki ga izpit meri ločeno */
  brezLetvi?: boolean
  /**
   * Gladko ozadje (steni brez teksture) in teksturo nosi samo ograja — kot v
   * praksi, kjer monter na profil prilepi referčne oznake. Gosta tekstura na
   * ravni ravnini je za dvopogledno geometrijo najslabši možni motiv: vsi točke
   * ležijo v eni ravnini, zato napaka ujemanja pretlači smer baseline.
   */
  panelGladak?: boolean
  sirina?: number
  visina?: number
  zark?: number
  lise?: number
  /** teksturnih pikslov na cm (2,56 = 256 px na 100 cm panel) */
  gostota?: number
  /** razpon Gausove pike v teksturnih pikslih */
  sigmaMin?: number
  sigmaMax?: number
} = {}): Scena {
  // Realen zajem telefona: 600x450 px, goriščna razdalja 520 px, delovna razdalja
  // 1,2 m. Na 200x150/50 cm je pogojenost slaba (0,9 px ujemanja = 6° rotacije
  // in 44 premika), na teh parametrih isti algoritem da 0,05° / 0,8°.
  const sirina = mozni.sirina ?? 600
  const visina = mozni.visina ?? 450
  const zark = mozni.zark ?? 520
  const intrinseki: Intrinsics = { fx: zark, fy: zark, cx: (sirina - 1) / 2, cy: (visina - 1) / 2 }
  const globina = mozni.globina ?? 120
  const n = enotski(mozni.naklon ?? [0.12, -0.07, 1])
  const e1 = enotski(kriz(n, [0, 1, 0]))
  const e2 = kriz(n, e1)
  const rot = mozni.rotacija ?? {}
  const R = rotacijaMatrika(rot.x ?? 0.4, rot.y ?? 0.8, rot.z ?? 0)
  const premik: Vec3 = mozni.premik ?? [25, 1.5, 2]
  const gostota = mozni.gostota ?? 6
  const teksturaMoznosti = { ponovitev: mozni.ponovitev ?? 0, enotna: mozni.enotna ?? false, lise: mozni.lise, sigmaMin: mozni.sigmaMin, sigmaMax: mozni.sigmaMax }
  // Enotna gostota teksture (teksturnih pikslov na cm) za VSE sloje: sicer bi
  // bila letva teksturirana s pikselnimi pegami, panel pa z metrskimi.
  const teksturaZa = (robE1: number, robE2: number, seed: number, prepis: Record<string, unknown> = {}): Pick<Sloj, 'tekstura' | 'teksturaSirina' | 'teksturaVisina'> => {
    const teksturaSirina = Math.max(16, Math.round(2 * robE1 * gostota))
    const teksturaVisina = Math.max(16, Math.round(2 * robE2 * gostota))
    return {
      tekstura: ustvariTeksturo(seed, teksturaSirina, teksturaVisina, { ...teksturaMoznosti, ...prepis } as Parameters<typeof ustvariTeksturo>[3]),
      teksturaSirina,
      teksturaVisina,
    }
  }
  const panel: Sloj = {
    T: [0, 0, globina],
    N: n,
    E1: e1,
    E2: e2,
    robE1: 50,
    robE2: 50,
    ...teksturaZa(50, 50, mozni.seed ?? 20261013, mozni.panelGladak ? { enotna: true } : {}),
  }
  const sloji: Sloj[] = [panel]
  if (!mozni.brezLetvi && !mozni.enotna && !mozni.ponovitev) {
    // Ograja: dva navpična stebra in prečna ročica pred ploščijo. Dvopogledna
    // geometrija je na RAVNI sceni slabo pogojena (5–9° napaka rotacije), zato
    // mora dokazni izpit vsebovati vsaj dve globini — tako kot dejanski izbor, ki
    // ga monter fotografira.
    const letvi: LetvDefinicija[] = [
      { globina: 4, e1: -28, e2: -4, robE1: 3.2, robE2: 34, seed: 20261014 },
      { globina: 8, e1: 17, e2: -2, robE1: 3.2, robE2: 30, seed: 20261015 },
      { globina: 12, e1: -2, e2: 33, robE1: 44, robE2: 3.4, seed: 20261016 },
      { globina: 6, e1: 0, e2: -22, robE1: 42, robE2: 2.6, seed: 20261017 },
      { globina: 10, e1: 4, e2: -12, robE1: 44, robE2: 2.6, seed: 20261018 },
      { globina: 14, e1: -2, e2: 0, robE1: 40, robE2: 2.6, seed: 20261019 },
      { globina: 16, e1: 2, e2: 14, robE1: 44, robE2: 2.6, seed: 20261020 },
    ]
    for (const l of letvi) {
      const sredisce: Vec3 = [
        panel.T[0] - l.globina * n[0] + l.e1 * e1[0] + l.e2 * e2[0],
        panel.T[1] - l.globina * n[1] + l.e1 * e1[1] + l.e2 * e2[1],
        panel.T[2] - l.globina * n[2] + l.e1 * e1[2] + l.e2 * e2[2],
      ]
      sloji.push({
        T: sredisce,
        N: n,
        E1: e1,
        E2: e2,
        robE1: l.robE1,
        robE2: l.robE2,
        ...teksturaZa(l.robE1, l.robE2, l.seed, { sigmaMin: 1.4 }),
      })
    }
  }
  return {
    sirina,
    visina,
    intrinseki,
    sloji,
    R,
    t: premik,
    // enakna plošča: ozadje je ista sivina, sicer bi rob panela sam ustvaril kornje
    ozadje: mozni.enotna ? 128 : 8,
  }
}

/** Bilinearna vzorčna funkcija teksture sloja (zunaj obsega -> NaN). */
function vzorecTeksture (sloj: Sloj, u: number, v: number): number {
  const tx = ((u + sloj.robE1) / (2 * sloj.robE1)) * (sloj.teksturaSirina - 1)
  const ty = ((v + sloj.robE2) / (2 * sloj.robE2)) * (sloj.teksturaVisina - 1)
  if (tx < 0 || ty < 0 || tx > sloj.teksturaSirina - 1 || ty > sloj.teksturaVisina - 1) return Number.NaN
  const x0 = Math.floor(tx)
  const y0 = Math.floor(ty)
  const x1 = Math.min(sloj.teksturaSirina - 1, x0 + 1)
  const y1 = Math.min(sloj.teksturaVisina - 1, y0 + 1)
  const dx = tx - x0
  const dy = ty - y0
  const a = sloj.tekstura[y0 * sloj.teksturaSirina + x0]
  const b = sloj.tekstura[y0 * sloj.teksturaSirina + x1]
  const c = sloj.tekstura[y1 * sloj.teksturaSirina + x0]
  const d = sloj.tekstura[y1 * sloj.teksturaSirina + x1]
  return (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy
}

interface VidniHit { sloj: Sloj; razdalja: number; u: number; v: number }

/** Presek žarka z ravnino sloja, če pade v njegove meje in je pred kamero. */
function hitSloja (sloj: Sloj, center: Vec3, smer: Vec3): { razdalja: number; u: number; v: number } | null {
  const imenovalec = produktSkalarni(sloj.N, smer)
  if (Math.abs(imenovalec) < 1e-9) return null
  const stevec = produktSkalarni(sloj.N, [sloj.T[0] - center[0], sloj.T[1] - center[1], sloj.T[2] - center[2]])
  const razdalja = stevec / imenovalec
  if (!(razdalja > 0)) return null
  const rel: Vec3 = [
    center[0] + razdalja * smer[0] - sloj.T[0],
    center[1] + razdalja * smer[1] - sloj.T[1],
    center[2] + razdalja * smer[2] - sloj.T[2],
  ]
  const u = produktSkalarni(rel, sloj.E1)
  const v = produktSkalarni(rel, sloj.E2)
  if (Math.abs(u) > sloj.robE1 || Math.abs(v) > sloj.robE2) return null
  return { razdalja, u, v }
}

/** Najbližji vidni presek (okluzija med sloji). */
function vidniHit (scena: Scena, center: Vec3, smer: Vec3): VidniHit | null {
  let najboljsi: VidniHit | null = null
  for (const sloj of scena.sloji) {
    const h = hitSloja(sloj, center, smer)
    if (!h) continue
    if (!najboljsi || h.razdalja < najboljsi.razdalja) najboljsi = { sloj, razdalja: h.razdalja, u: h.u, v: h.v }
  }
  return najboljsi
}

function stolpec (m: Mat3, i: number): Vec3 {
  return [m[i], m[3 + i], m[6 + i]]
}

/** Izris pogleda kamere (R, t) skozi notranjo kalibracijo — povratno preslikavo. */
export function izrisPogled (scena: Scena, R: Mat3, t: Vec3, k: Intrinsics): SivaSlika {
  const Rt = transponiraj3(R)
  const center: Vec3 = [-produktSkalarni(stolpec(Rt, 0), t), -produktSkalarni(stolpec(Rt, 1), t), -produktSkalarni(stolpec(Rt, 2), t)]
  const siva = new Float64Array(scena.sirina * scena.visina)
  for (let y = 0; y < scena.visina; y++) {
    for (let x = 0; x < scena.sirina; x++) {
      const localna: Vec3 = [(x - k.cx) / k.fx, (y - k.cy) / k.fy, 1]
      const smer: Vec3 = [
        Rt[0] * localna[0] + Rt[1] * localna[1] + Rt[2] * localna[2],
        Rt[3] * localna[0] + Rt[4] * localna[1] + Rt[5] * localna[2],
        Rt[6] * localna[0] + Rt[7] * localna[1] + Rt[8] * localna[2],
      ]
      const h = vidniHit(scena, center, smer)
      if (!h) { siva[y * scena.sirina + x] = scena.ozadje; continue }
      const barva = vzorecTeksture(h.sloj, h.u, h.v)
      siva[y * scena.sirina + x] = Number.isFinite(barva) ? barva : scena.ozadje
    }
  }
  return { siva, sirina: scena.sirina, visina: scena.visina }
}

/** Svetovna točka piksla pogleda A (R=I, t=0) — ZNANA ISTINA globine. */
export function istinaTocka (scena: Scena, p: Tocka2): Vec3 | null {
  const smer: Vec3 = [(p.x - scena.intrinseki.cx) / scena.intrinseki.fx, (p.y - scena.intrinseki.cy) / scena.intrinseki.fy, 1]
  const h = vidniHit(scena, [0, 0, 0], smer)
  if (!h) return null
  return [smer[0] * h.razdalja, smer[1] * h.razdalja, smer[2] * h.razdalja]
}

function projekcija (P: Matrika3x4, X: Vec3): Tocka2 | null {
  const w = P[2][0] * X[0] + P[2][1] * X[1] + P[2][2] * X[2] + P[2][3]
  if (Math.abs(w) < 1e-12) return null
  return { x: (P[0][0] * X[0] + P[0][1] * X[1] + P[0][2] * X[2] + P[0][3]) / w, y: (P[1][0] * X[0] + P[1][1] * X[1] + P[1][2] * X[2] + P[1][3]) / w }
}

// ── 1) linearna algebra: ostanki proti istini ────────────────────────────────

export function preveriAlgebro (): Record<string, number | boolean> {
  const izpisi: Record<string, number | boolean> = {}
  const nakljucje = ustvariNakljucje(4242)
  // (a) simetrični lastni razcep: A v = λ v in ortogonalnost stolpcev
  const m: number[][] = Array.from({ length: 9 }, () => new Array(9).fill(0))
  const polna: number[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => nakljucje() * 2 - 1))
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      let vsota = 0
      for (let k = 0; k < 9; k++) vsota += polna[k][r] * polna[k][c]
      m[r][c] = vsota
    }
  }
  const lastni = simLastneN(m, 9)
  let ostanki = 0
  for (let j = 0; j < 9; j++) {
    const v = lastni.stolpci[j]
    for (let r = 0; r < 9; r++) {
      let vsota = 0
      for (let c = 0; c < 9; c++) vsota += m[r][c] * v[c]
      ostanki = Math.max(ostanki, Math.abs(vsota - lastni.vrednosti[j] * v[r]))
    }
  }
  let skalarnaNapaka = 0
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) skalarnaNapaka = Math.max(skalarnaNapaka, Math.abs(produktSkalarniV(lastni.stolpci[a], lastni.stolpci[b]) - (a === b ? 1 : 0)))
  }
  izpisi.a_lastni_ostanek = ostanki
  izpisi.a_lastni_ortonormiranost = skalarnaNapaka
  // (b) SVD: U S Vᵀ = A (polna in rang-2 matrika)
  const preizkusni: Mat3[] = [
    [0.6, 0.2, -0.4, 0.1, -0.7, 0.3, 0.5, 0.4, 0.2],
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  ]
  let svdNapaka = 0
  for (const mat of preizkusni) {
    const { u, s, v } = svd3(mat)
    const rekon = mnozi3(mnozi3(u, [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2]] as Mat3), transponiraj3(v))
    for (let i = 0; i < 9; i++) svdNapaka = Math.max(svdNapaka, Math.abs(rekon[i] - mat[i]))
  }
  const rang2 = vsiliRang2([1, 2, 3, 4, 5, 6, 7, 8, 9] as Mat3)
  izpisi.a_svd_ostanek = svdNapaka
  izpisi.a_rang2_determinanta = Math.abs(determinanta(rang2))
  // (c) triangulacija: znana točka → piksli → rekonstrukcija
  const k: Intrinsics = { fx: 200, fy: 200, cx: 100, cy: 75 }
  const R = rotacijaMatrika(1, 4, 0)
  const t: Vec3 = [7, 0.4, 0.9]
  const P1 = matrikaProjekcije(k, [1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3, [0, 0, 0])
  const P2 = matrikaProjekcije(k, R, t)
  let triangNajvecji = 0
  for (const tocka of [[-6, -4, 45], [5, 3, 62], [-2, 6, 38], [9, -7, 70]] as Vec3[]) {
    const a = projekcija(P1, tocka as Vec3)
    const b = projekcija(P2, tocka as Vec3)
    if (!a || !b) { triangNajvecji = Number.NaN; continue }
    const rekon = trianguliraj(P1, P2, a, b)
    if (!rekon) { triangNajvecji = Number.NaN; continue }
    triangNajvecji = Math.max(triangNajvecji, Math.hypot(rekon.x - tocka[0], rekon.y - tocka[1], rekon.z - tocka[2]))
  }
  izpisi.a_triangulacija_ostanek_cm = triangNajvecji
  // (d) 8-točkovna DLT + E + razcep na ČISTIH projektih (brez šuma)
  const nakljucje2 = ustvariNakljucje(777)
  const p1: Tocke2 = []
  const p2: Tocke2 = []
  for (let i = 0; i < 24; i++) {
    const X: Vec3 = [(nakljucje2() * 2 - 1) * 12, (nakljucje2() * 2 - 1) * 9, 40 + nakljucje2() * 35]
    const a = projekcija(P1, X)
    const b = projekcija(P2, X)
    if (a && b) { p1.push(a); p2.push(b) }
  }
  const F = osnovnaMatrikaIzParov(p1, p2)
  let epipolarnaCista = 0
  if (F) {
    for (let i = 0; i < p1.length; i++) epipolarnaCista = Math.max(epipolarnaCista, Math.sqrt(Math.max(0, epipolarnaNapaka(vsiliRang2(F), p1[i], p2[i]))))
  }
  const E = F ? esencialnaIzF(vsiliRang2(F), k, k) : null
  const razcep = E ? razcepEsencialne(E, p1, p2, k, k) : { izbrani: null, kandidati: [] }
  const rotacijskaNapaka = razcep.izbrani ? kotR(razcep.izbrani.R, R) : Number.NaN
  const translatorskaNapaka = razcep.izbrani ? kotV(razcep.izbrani.t, t) : Number.NaN
  izpisi.d_F_znajden = F !== null
  izpisi.d_epipolarna_ostanek_px = epipolarnaCista
  izpisi.d_rotacija_ostanek_deg = rotacijskaNapaka
  izpisi.d_translacija_ostanek_deg = translatorskaNapaka
  izpisi.d_chevraliteta_vsi = razcep.izbrani ? razcep.izbrani.naprej === p1.length : false
  izpisi.d_triangulacija_cista_px = razcep.izbrani
    ? Math.max(...razcep.izbrani.tocke.map((x) => x.napakaPx))
    : Number.NaN
  return izpisi
}

function produktSkalarniV (a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function determinanta (m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
}

// ── 2) zajem → ujemanje → verifikacija → rekonstrukcija na IZRISANIH slikah ──

export interface RezultatIzpita {
  scenarij: string
  pogoj: string
  cakovanje: string
  kornjiA: number
  kornjiB: number
  ujemanja: number
  ujemanjaPravilna: number
  delezPravilnih: number
  veliki: number
  delezVelikih: number
  medianaEpipolarnePx: number
  medianaProjekcijskePx: number
  paralaksaDeg: number
  rekonstruiraneTocke: number
  rotacijaNapakaDeg: number
  translacijaNapakaDeg: number
  referencnaRazdaljaCm: number | null
  meriloZnan: boolean
  cmNaEnoto: number | null
  skalnaNapakaPct: number | null
  globinskaNapakaPct: number | null
  odlozitev: string
  razlogi: string[]
}

export interface DefinicijaScenarija {
  ime: string
  pogoj: string
  scena: Parameters<typeof ustvariSceno>[0]
  /** ali je fizična referenca podana (in kako močno natankana) */
  referenca: { namnozek: number } | null
  cakovanje: 'SPREJET' | 'ZAVRNJEN' | 'DODATNI_POSNETKI'
}

export function definicijeScenarijev (): DefinicijaScenarija[] {
  return [
    {
      ime: 'panel_dva_pogleda',
      pogoj: 'raven merilni panel, 600x450 pri 1,2 m in baseline 25 cm — MODEL MORA BITI SPREJET',
      scena: {},
      referenca: { namnozek: 1 },
      cakovanje: 'SPREJET',
    },
    {
      ime: 'enotna_plosca_brez_teksture',
      pogoj: 'enakna siva plošč (steklo, ravna barva) — ni kornjev',
      scena: { enotna: true },
      referenca: { namnozek: 1 },
      cakovanje: 'DODATNI_POSNETKI',
    },
    {
      ime: 'cista_rotacija_brez_baseline',
      pogoj: 'kamera se zavrti, a ne premakne — parallaksa ni mogoča',
      scena: { rotacija: { x: 0, y: 6, z: 0 }, premik: [0, 0, 0] },
      referenca: { namnozek: 1 },
      cakovanje: 'DODATNI_POSNETKI',
    },
    {
      ime: 'ponavljajoc_se_vzorec',
      pogoj: 'periodična tekstura (enaka ploščica povsod) — ujemanja so dvoumna',
      scena: { ponovitev: 16 },
      referenca: { namnozek: 1 },
      cakovanje: 'DODATNI_POSNETKI',
    },
    {
      ime: 'premajhen_premik',
      pogoj: 'baseline 2 mm — geometrija se zdi gladka, globine ni mogoče verjeti',
      scena: { premik: [0.2, 0.02, 0.03] },
      referenca: { namnozek: 1 },
      cakovanje: 'DODATNI_POSNETKI',
    },
    {
      ime: 'ni_fizicne_reference',
      pogoj: 'render je dober, a nihče ni izmeril reference — rekonstrukcija NI metrična',
      scena: {},
      referenca: null,
      cakovanje: 'ZAVRNJEN',
    },
    {
      ime: 'referenca_nihka_1_proc',
      pogoj: 'referenca je izmerjena za 1 % narobe — merilo podeduje napako reference',
      scena: {},
      referenca: { namnozek: 1.01 },
      cakovanje: 'SPREJET',
    },
  ]
}

function izrisaniPogleda (scena: Scena): { a: SivaSlika; b: SivaSlika } {
  return {
    a: izrisPogled(scena, [1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3, [0, 0, 0], scena.intrinseki),
    b: izrisPogled(scena, scena.R, scena.t, scena.intrinseki),
  }
}

/** ISTINA: resnična projekcija piksla pogleda A v pogled B ( znana homografija). */
function resnicniPiksel (scena: Scena, p: Tocka2): Tocka2 | null {
  const X = istinaTocka(scena, p)
  if (!X) return null
  return projekcija(matrikaProjekcije(scena.intrinseki, scena.R, scena.t), X)
}

function izberiReferenco (scena: Scena, tocke: { x: number; y: number; z: number; indeks: number }[], tockeA: Tocke2, veliki: number[]): { indexA: number; indexB: number; razdaljaCm: number } | null {
  // Fizično merjena razdalja na panelu: par, ki je najbližje 20 cm (realna
  // referenca monterja — marker, profil, raztegnjen meter).
  let najboljsi: { indexA: number; indexB: number; razdaljaCm: number } | null = null
  for (let i = 0; i < tocke.length; i++) {
    const gtA = istinaTocka(scena, tockeA[veliki[tocke[i].indeks]])
    if (!gtA) continue
    for (let j = i + 1; j < tocke.length; j++) {
      const gtB = istinaTocka(scena, tockeA[veliki[tocke[j].indeks]])
      if (!gtB) continue
      const razdalja = Math.hypot(gtB[0] - gtA[0], gtB[1] - gtA[1], gtB[2] - gtA[2])
      if (!(razdalja > 1)) continue
      if (najboljsi === null || Math.abs(razdalja - 20) < Math.abs(najboljsi.razdaljaCm - 20)) {
        najboljsi = { indexA: i, indexB: j, razdaljaCm: razdalja }
      }
    }
  }
  return najboljsi
}

export function zazeniScenarij (definicija: DefinicijaScenarija): RezultatIzpita {
  const scena = ustvariSceno(definicija.scena)
  const pogleda = izrisaniPogleda(scena)
  const rezultat = fotogrametrijaDvehPogledov({
    slikaA: pogleda.a,
    slikaB: pogleda.b,
    intrinseki: { a: scena.intrinseki, b: scena.intrinseki },
    kornjevMax: 90,
  })
  // 1) KAJ: koliko ujemanj je dejansko pravilnih (proti znani homografiji)?
  let pravilna = 0
  for (let i = 0; i < rezultat.tockeA.length; i++) {
    const expected = resnicniPiksel(scena, rezultat.tockeA[i])
    if (expected && Math.hypot(expected.x - rezultat.tockeB[i].x, expected.y - rezultat.tockeB[i].y) <= 1.5) pravilna++
  }
  // 2) MERILO: referenčna razdalja pride iz ISTINE (v realnosti jo izmeri
  //    monter), izračun pa iz JEDRA — `meriloIzReference` + `presodi`.
  const izbira = definicija.referenca ? izberiReferenco(scena, rezultat.tocke, rezultat.tockeA, rezultat.veliki) : null
  const razdaljaCm = izbira ? izbira.razdaljaCm * (definicija.referenca?.namnozek ?? 1) : null
  const merilo = izbira
    ? meriloIzReference({ tockaA: rezultat.tocke[izbira.indexA], tockaB: rezultat.tocke[izbira.indexB], razdaljaCm })
    : rezultat.merilo
  const protokol = izbira ? presodi(rezultat.kakovost, merilo) : rezultat.protokol
  // 3) KAMERA + GLOBINA: rekonstrukcija proti znani [R|t] in znani ravnini
  const rotacijaNapakaDeg = rezultat.kameraDruga ? kotR(rezultat.kameraDruga.R, scena.R) : Number.NaN
  const translacijaNapakaDeg = rezultat.kameraDruga ? kotV(rezultat.kameraDruga.t, scena.t) : Number.NaN
  let globinskaNapaka: number | null = null
  let skalnaNapaka: number | null = null
  if (merilo.znan && merilo.cmNaEnoto !== null) {
    const relativne: number[] = []
    const razmerja: number[] = []
    for (const tocka of rezultat.tocke) {
      const gt = istinaTocka(scena, rezultat.tockeA[rezultat.veliki[tocka.indeks]])
      if (!gt) continue
      const dolzina = Math.hypot(gt[0], gt[1], gt[2])
      const enote = Math.hypot(tocka.x, tocka.y, tocka.z)
      if (!(dolzina > 1e-6) || !(enote > 1e-6)) continue
      relativne.push(Math.hypot(
        tocka.x * merilo.cmNaEnoto - gt[0],
        tocka.y * merilo.cmNaEnoto - gt[1],
        tocka.z * merilo.cmNaEnoto - gt[2],
      ) / dolzina * 100)
      // merilo, ki ga narekuje ISTINA celotnega oblaka točk (ne samo reference)
      razmerja.push(dolzina / enote)
    }
    globinskaNapaka = median(relativne)
    const meriloIzistine = median(razmerja)
    if (meriloIzistine !== null) {
      skalnaNapaka = Math.abs(merilo.cmNaEnoto / meriloIzistine - 1) * 100
    }
  }
  return {
    scenarij: definicija.ime,
    pogoj: definicija.pogoj,
    cakovanje: definicija.cakovanje,
    kornjiA: rezultat.kakovost.kornjiA,
    kornjiB: rezultat.kakovost.kornjiB,
    ujemanja: rezultat.kakovost.steviloUjemanj,
    ujemanjaPravilna: pravilna,
    delezPravilnih: decimal(rezultat.tockeA.length > 0 ? pravilna / rezultat.tockeA.length : 0, 4),
    veliki: rezultat.kakovost.steviloVelikih,
    delezVelikih: decimal(rezultat.kakovost.delezVelikih, 4),
    medianaEpipolarnePx: decimal(rezultat.kakovost.medianaEpipolarneNapakePx, 4),
    medianaProjekcijskePx: decimal(rezultat.kakovost.medianaProjekcijskeNapakePx, 4),
    paralaksaDeg: decimal(rezultat.kakovost.paralaksaDeg, 4),
    rekonstruiraneTocke: rezultat.kakovost.rekonstruiraneTocke,
    rotacijaNapakaDeg: decimal(rotacijaNapakaDeg, 4),
    translacijaNapakaDeg: decimal(translacijaNapakaDeg, 4),
    referencnaRazdaljaCm: razdaljaCm === null ? null : decimal(razdaljaCm, 6),
    meriloZnan: merilo.znan,
    cmNaEnoto: merilo.cmNaEnoto === null ? null : decimal(merilo.cmNaEnoto, 6),
    skalnaNapakaPct: skalnaNapaka === null ? null : decimal(skalnaNapaka, 3),
    globinskaNapakaPct: globinskaNapaka === null ? null : decimal(globinskaNapaka, 3),
    odlozitev: protokol.odlozitev,
    razlogi: protokol.razlogi,
  }
}

function decimal (v: number, m: number): number {
  if (!Number.isFinite(v)) return Number.NaN
  return Number(v.toFixed(m))
}

// ── 3) RANSAC proti napačnimi ujemanji (geometrijska verifikacija) ────────────

export interface IzpitOutlierjev {
  /** resnična ujemanja v naboru */
  dobri: number
  /** vsi pari, vključno z vgrajenimi izstopki */
  vsi: number
  /** izstopki, ki jih je geometrijska verifikacija ZAVRNL (so bili prepoznani) */
  izstopekVgrajenih: number
  /** pari, ki jih je RANSAC razglasil za velike */
  veliki: number
  /** med veliki: resnična ujemanja */
  velikiDobri: number
  /** med veliki: vgrajeni napačni pari, ki so ušli */
  velikiNapacni: number
  /** ali je RANSAC obdržal VSA resnična ujemanja (poklicnost) */
  vsiDobriOhranjeni: boolean
  /** delež zavrnjenih izstopkov */
  delezZavrnjenihIzstopkov: number
  delezVelikih: number
  medianaNapakePx: number
  pragIzstopkaPx: number
}

/**
 * Vzemimo dober par pogledov, 1/3 ujemanj zamenjajmo z NAPAČNIMI in preverimo,
 * kaj geometrijska verifikacija stori. Par šteje za izstopek samo, če ga ISTINA
 * (znana homografija panela) dokaže kot kršitev geometrije za vsaj
 * `pragIzstopkaPx` — sicer ne trdimo ničesar.
 *
 * Dva iskana izida, ne eden:
 *  - POKLICNOST: nobeno resnično ujemanje ne sme biti zavrnjeno;
 *  - POZORNOST: večina izstopkov mora biti zavrnjenih.
 * Ujemanja, ki zdrsnejo skozi epipolarni preizkus, so pričakovani in pošteno
 * zapisani: panel je raven, zato premik VZDOLŽ epipolarne črte ne stane nič.
 */
export function preveriRansac (definicija: DefinicijaScenarija): IzpitOutlierjev {
  const scena = ustvariSceno(definicija.scena)
  const pogleda = izrisaniPogleda(scena)
  const cist = fotogrametrijaDvehPogledov({
    slikaA: pogleda.a,
    slikaB: pogleda.b,
    intrinseki: { a: scena.intrinseki, b: scena.intrinseki },
    kornjevMax: 90,
  })
  const tockeA = cist.tockeA
  const tockeB = cist.tockeB
  const pragIzstopkaPx = 20
  const zamenaZa = (i: number): Tocka2 | null => {
    // poišči piksel A, ki glede na ISTINO ne sme ustrezati pikslu B tega para
    for (let j = 0; j < tockeA.length; j++) {
      const praviB = resnicniPiksel(scena, tockeA[j])
      if (!praviB) continue
      if (Math.hypot(praviB.x - tockeB[i].x, praviB.y - tockeB[i].y) >= pragIzstopkaPx) return tockeA[j]
    }
    return null
  }
  const vsiA: Tocke2 = []
  const vsiB: Tocke2 = []
  const dobriIndeksi = new Set<number>()
  const izstopkiIndeksi = new Set<number>()
  for (let i = 0; i < tockeA.length; i++) {
    if (i % 3 === 0) {
      const nadomestniA = zamenaZa(i)
      if (!nadomestniA) continue
      vsiA.push(nadomestniA)
      vsiB.push(tockeB[i])
      izstopkiIndeksi.add(vsiA.length - 1)
    } else {
      vsiA.push(tockeA[i])
      vsiB.push(tockeB[i])
      dobriIndeksi.add(vsiA.length - 1)
    }
  }
  const rs = ransacOsnovnaMatrika(vsiA, vsiB, { pragPik: 1.0, poskusi: 300 })
  const nicF: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const napake = rs.veliki.map((i) => Math.sqrt(Math.max(0, epipolarnaNapaka(rs.F ?? nicF, vsiA[i], vsiB[i]))))
  const velikiDobri = rs.veliki.filter((i) => dobriIndeksi.has(i)).length
  const velikiNapacni = rs.veliki.filter((i) => izstopkiIndeksi.has(i)).length
  return {
    dobri: dobriIndeksi.size,
    vsi: vsiA.length,
    izstopekVgrajenih: izstopkiIndeksi.size,
    veliki: rs.veliki.length,
    velikiDobri,
    velikiNapacni,
    vsiDobriOhranjeni: dobriIndeksi.size >= 8 && velikiDobri === dobriIndeksi.size,
    delezZavrnjenihIzstopkov: decimal(izstopkiIndeksi.size > 0 ? (izstopkiIndeksi.size - velikiNapacni) / izstopkiIndeksi.size : 0, 4),
    delezVelikih: decimal(rs.delez, 4),
    medianaNapakePx: decimal(median(napake) ?? Number.NaN, 4),
    pragIzstopkaPx,
  }
}

// ── 4) merilo: jedro zavrne neveljavno referenco ─────────────────────────────

export function preveriMerilo (): Record<string, boolean> {
  const a = { x: 0, y: 0, z: 0 }
  const b = { x: 10, y: 0, z: 0 }
  return {
    manjka: !meriloIzReference({ tockaA: a, tockaB: b, razdaljaCm: null }).znan,
    negativen: !meriloIzReference({ tockaA: a, tockaB: b, razdaljaCm: -5 }).znan,
    nic: !meriloIzReference({ tockaA: a, tockaB: b, razdaljaCm: 0 }).znan,
    prevelik: !meriloIzReference({ tockaA: a, tockaB: b, razdaljaCm: 250000 }).znan,
    sovpadajtoc: !meriloIzReference({ tockaA: a, tockaB: a, razdaljaCm: 20 }).znan,
    veljaven: meriloIzReference({ tockaA: a, tockaB: b, razdaljaCm: 25 }).znan === true,
    natancen: Math.abs((meriloIzReference({ tockaA: a, tockaB: b, razdaljaCm: 25 }).cmNaEnoto ?? 0) - 2.5) < 1e-12,
  }
}

// ── 5) celotno poročilo (artefakt) ───────────────────────────────────────────

export interface PoročiloDokaz {
  pogodba: string
  jedro: { pragi: unknown; veriga: string[] }
  matematicna: Record<string, number | boolean>
  meriloPreizkusi: Record<string, boolean>
  ransacZOutlierji: IzpitOutlierjev
  scenariji: RezultatIzpita[]
  determinizem: boolean
  opomba: string[]
}

export function porociloDokaz (): PoročiloDokaz {
  const definicije = definicijeScenarijev()
  const prvi = definicije.map((d) => zazeniScenarij(d))
  const drugi = definicije.map((d) => zazeniScenarij(d))
  return {
    pogodba: 'fotogrametrija-dokaz/1.0',
    jedro: {
      pragi: FOTOGRAMMETRIJA_PRAGI,
      veriga: [
        'Shi-Tomasi kornje',
        'ujemanje koščic (NCC + razmerje + obojestranska preverba)',
        'normalizirana linearna DLT (8+ točk) za F',
        'RANSAC geometrijska verifikacija',
        'E = K·F·K⁻¹, razcep na [R|t] s chevraliteto',
        'linearna triangulacija',
        'merilo iz fizične reference (meriloIzReference)',
        'protokol presodi → SPREJET / ZAVRNJEN / DODATNI_POSNETKI',
      ],
    },
    matematicna: preveriAlgebro(),
    meriloPreizkusi: preveriMerilo(),
    ransacZOutlierji: preveriRansac(definicije[0]),
    scenariji: prvi,
    determinizem: JSON.stringify(prvi) === JSON.stringify(drugi),
    opomba: [
      'Scena je IZRISANA iz znane istine (raven panel, znana K in [R|t]); pravi fotoaparat pri tem NI sodeloval.',
      'Referenčna razdalja je v izpitu znana razdalja na panelu — v uporabi jo izmeri monter; izpit ' + '"referenca_nihka_1_proc" pokaže, da merilo podeduje napako reference.',
      'Ta protokol NI priklopljen na UI in ne trdi, da aplikacija zna 3D-rekonstruirati; recommendMethod to pove izrecno.',
      'Brez AI, brez naučenih modelov, brez plačljivih API-jev, brez novih odvisnosti.',
    ],
  }
}

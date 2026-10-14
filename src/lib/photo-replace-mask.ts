// photo-replace-mask — R507 (issue #14 §1 in §2): ročno popravljiva MASKA stare
// ograje in KLASIČNA (brez AI) OBNOVA OZADJA.
//
// Zakaj obstaja (kaj je bil problem):
//  - dotlej je bil edini vhod 4-točkovni quad — monter ni mogel niti dodati
//    pritrdil niti izrezati dela, ki NI ograja (§1 zahteva ročni popravek maske);
//  - odstranitev je bil en barvni preliv čez celoten quad — issue #14 to
//    IZRECNO prepoveduje kot trditev, da je ograja odstranjena (§2);
//  - ni ločenega prednjega plana, zato je nova ograja prekrila rob balkona,
//    rastlino ali steno (§1: loči prednji/za po ločenih maskah).
//
// Načela:
//  - maska samo POVE, kateri piksli spadajo k stari ograji, kaj je izrez in kaj
//    je prednji plan; noben piksel se ne izmišljuje z modelom;
//  - obnova ozadja je deterministična ŠIRITEV Z ROBU (boundary propagation):
//    piksel dobi tehtano povprečje že znanih sosedov, ring širitve pa je
//    DOKAZ zanesljivosti — kjer je predolg (ni vira v razumni bližini), se
//    piksel označi kot NEDOKONČAN in pove se, kateri del zahteva ročni poseg;
//  - čist modul: brez DOM-a, brez canvasa, brez Math.random — isti piksli in
//    ista maska → bit-enak izhod (test: tests/r504.py).

export interface Tocka { x: number; y: number }

/** Zaprta mnogokotna oblika v normaliziranih koordinatah fotografije (0..1). */
export type Oblika = Tocka[]

/**
 * Največ oblik na skupino in točk na obliko. Omejujeta `renderParams` JSON
 * (strežniški limit 12 KB): 3 skupine × 4 oblike × 20 točk ≈ 6 KB.
 */
export const MAX_OBLIK = 4
export const MAX_TOCK = 20

/**
 * Širina mehkega roba v ringih obnove. `globina` prav tolikih robnih pikslov
 * dobi alfa < 255, da se obnovljen pas zlije z originalom brez vidne meje.
 */
export const MEHKA_ROB = 3

/** Delež nedokončanih pikslov, od katerega dalje je rezultat NEDOKONČAN. */
export const PRAG_ROCNEGA_POSEG = 0.02

export interface Maska {
  /** območja STARE ograje — deske, letve, stebri in pritrdila */
  ograja: Oblika[]
  /** izrezi znotraj ograje — kar NI ograje in se NE sme prekriti */
  izpusti: Oblika[]
  /** PREDNJI plan (rob balkona, rastlina, steno) — riše se NA VRH nove ograje */
  prednji: Oblika[]
}

export const praznaMaska = (): Maska => ({ ograja: [], izpusti: [], prednji: [] })

/** Iz starega vhoda (samo 4 vogali) — maska brez dodatkov in brez prednjega plana. */
export function maskaIzQuada (quad: readonly Tocka[]): Maska {
  return { ograja: [quad.map((t) => ({ x: t.x, y: t.y }))], izpusti: [], prednji: [] }
}

export function jePraznaMaska (m: Maska | null | undefined): boolean {
  return !m || (m.ograja.length === 0 && m.izpusti.length === 0 && m.prednji.length === 0)
}

// ─── Validacija (enaka pravila na odjemalcu in na strežniku) ────────────────

export interface Napaka { polje: string; sporocilo: string }

const jeTocka = (v: unknown): v is Tocka => {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return typeof t.x === 'number' && typeof t.y === 'number' && Number.isFinite(t.x) && Number.isFinite(t.y)
}

/** Preveri eno obliko: ≥3 točke, vse na fotografiji, omejeno število. */
export function preveriObliko (v: unknown, polje: string): { napake: Napaka[]; oblika: Oblika | null } {
  if (!Array.isArray(v) || v.length < 3) {
    return { napake: [{ polje, sporocilo: `${polje}: oblika zahteva vsaj 3 točke.` }], oblika: null }
  }
  if (v.length > MAX_TOCK) {
    return { napake: [{ polje, sporocilo: `${polje}: preveč točk (največ ${MAX_TOCK}).` }], oblika: null }
  }
  const oblika: Oblika = []
  const napake: Napaka[] = []
  v.forEach((p, i) => {
    if (!jeTocka(p)) {
      napake.push({ polje: `${polje}[${i}]`, sporocilo: `${polje}[${i}]: točka ni veljavna.` })
      return
    }
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
      napake.push({ polje: `${polje}[${i}]`, sporocilo: `${polje}[${i}]: točka je izven fotografije.` })
    }
    oblika.push({ x: p.x, y: p.y })
  })
  return napake.length > 0 ? { napake, oblika: null } : { napake: [], oblika }
}

function preveriSkupino (v: unknown, polje: string): { napake: Napaka[]; oblike: Oblika[] } {
  if (v == null) return { napake: [], oblike: [] }
  if (!Array.isArray(v)) return { napake: [{ polje, sporocilo: `${polje}: seznam oblik je obvezen (lahko prazen).` }], oblike: [] }
  if (v.length > MAX_OBLIK) {
    return { napake: [{ polje, sporocilo: `${polje}: preveč oblik (največ ${MAX_OBLIK}).` }], oblike: [] }
  }
  const oblike: Oblika[] = []
  const napake: Napaka[] = []
  v.forEach((o, i) => {
    const r = preveriObliko(o, `${polje}[${i}]`)
    napake.push(...r.napake)
    if (r.oblika) oblike.push(r.oblika)
  })
  return { napake, oblike }
}

/**
 * Preveri celotno masko. `null`/`undefined` je VELJAVNO (stare vizualizacije
 * imajo samo quad) in vrne prazno masko — obstoječ vhod se NE spremeni.
 */
export function preveriMasko (v: unknown): { napake: Napaka[]; maska: Maska } {
  if (v == null) return { napake: [], maska: praznaMaska() }
  if (typeof v !== 'object') return { napake: [{ polje: 'maska', sporocilo: 'Maska je neveljavna.' }], maska: praznaMaska() }
  const o = v as Record<string, unknown>
  const a = preveriSkupino(o.ograja, 'maska.ograja')
  const b = preveriSkupino(o.izpusti, 'maska.izpusti')
  const c = preveriSkupino(o.prednji, 'maska.prednji')
  const napake = [...a.napake, ...b.napake, ...c.napake]
  return { napake, maska: { ograja: a.oblike, izpusti: b.oblike, prednji: c.oblike } }
}

// ─── Geometrija maske: katera točka spada kam ──────────────────────────────

/** Even-odd preizkus točke v mnogokotniku — dela tudi s samosreznimi oblikami. */
export function vPoligonu (x: number, y: number, oblika: Oblika): boolean {
  let notri = false
  for (let i = 0, j = oblika.length - 1; i < oblika.length; j = i++) {
    const xi = oblika[i].x; const yi = oblika[i].y
    const xj = oblika[j].x; const yj = oblika[j].y
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) notri = !notri
  }
  return notri
}

/** Omejitveni okvir oblike v pikslih (ostri na robovih slike). */
function okvir (oblika: Oblika, W: number, H: number): { x0: number; x1: number; y0: number; y1: number } {
  let xs0 = 1; let xs1 = 0; let ys0 = 1; let ys1 = 0
  for (const t of oblika) {
    if (t.x < xs0) xs0 = t.x
    if (t.x > xs1) xs1 = t.x
    if (t.y < ys0) ys0 = t.y
    if (t.y > ys1) ys1 = t.y
  }
  return {
    x0: Math.max(0, Math.floor(xs0 * W)),
    x1: Math.min(W - 1, Math.ceil(xs1 * W)),
    y0: Math.max(0, Math.floor(ys0 * H)),
    y1: Math.min(H - 1, Math.ceil(ys1 * H)),
  }
}

function izrisi (cilj: Uint8Array, W: number, H: number, oblika: Oblika, vrednost: number): void {
  const { x0, x1, y0, y1 } = okvir(oblika, W, H)
  for (let y = y0; y <= y1; y++) {
    const v = (y + 0.5) / H
    for (let x = x0; x <= x1; x++) {
      if (vPoligonu((x + 0.5) / W, v, oblika)) cilj[y * W + x] = vrednost
    }
  }
}

export interface Pokritje {
  W: number
  H: number
  /** 1 = piksel spada k STARI ograji (za odstranitev/obnovo). */
  ograja: Uint8Array
  /** 1 = piksel je PREDNJI plan in sme prekriti novo ograjo. */
  prednji: Uint8Array
}

/**
 * Rasterizira masko v piksle (vzorečenje na središčih pikslov — deterministično,
 * neodvisno od ločljivosti zaslona). Izpusti RAZVELJAVIJO pokritost ograje,
 * ne glede na vrstni red oblik.
 */
export function pokrij (m: Maska, W: number, H: number): Pokritje {
  const ograja = new Uint8Array(W * H)
  const prednji = new Uint8Array(W * H)
  for (const oblika of m.ograja) izrisi(ograja, W, H, oblika, 1)
  for (const oblika of m.izpusti) izrisi(ograja, W, H, oblika, 0)
  for (const oblika of m.prednji) izrisi(prednji, W, H, oblika, 1)
  return { ograja, prednji, W, H }
}

/** Kolikšen delež slikovnih pikslov je pokritih — pošten podatek za UI. */
export function deležPokritja (m: Uint8Array): number {
  let n = 0
  for (let i = 0; i < m.length; i++) n += m[i] ? 1 : 0
  return m.length === 0 ? 0 : n / m.length
}

/**
 * Ploščina mnogokotnika v normaliziranih enotah slike (0..1) — shoelace z
 * absolutno vrednostjo, zato vrstni red točk (urini ali obratni) ni pomemben.
 */
export function ploscina (oblika: Oblika): number {
  if (oblika.length < 3) return 0
  let s = 0
  for (let i = 0, j = oblika.length - 1; i < oblika.length; j = i++) {
    s += (oblika[j].x + oblika[i].x) * (oblika[j].y - oblika[i].y)
  }
  return Math.abs(s) / 2
}

/** vsota ploščin skupine oblik */
export function ploscinaSkupine (oblike: readonly Oblika[]): number {
  return oblike.reduce((a, o) => a + ploscina(o), 0)
}

// ─── Obnova ozadja: klasična širitev z roba (brez generativnega AI) ──────────

export interface ObnovaOpts {
  /** Največja še sprejemljiva globina širitve v ringih (privzeto iz slike). */
  maksGlobina?: number
}

export interface Pas {
  /** ime pasu, ki ga razume monter (ne koordinata) */
  ime: string
  pokritihPikslov: number
  nedokončanihPikslov: number
  razmerje: number
}

export interface Obnova {
  /** RGB obnovljenega ozadja (α = 255); zunaj maske = nedotaknjen original. */
  piksli: Uint8ClampedArray
  /** -1 = piksel je znan (original), sicer ring, v katerem je bil obnovljen. */
  globina: Int32Array
  /** 1 = obnovljen predolgo od roba → NI verodostojen, zahteva ročni poseg. */
  nedokončano: Uint8Array
  /** Delež nedokončanih pikslov med pokritimi. */
  razmerjeNedokončanega: number
  /** Kje točno manjka dokaz — pasovi po širini označenega območja. */
  pasovi: Pas[]
  /** Ali je rezultat nedokončan (§2: ne predstavlja ga kot obnovljenega). */
  zahtevaRočniPoseg: boolean
  /** Besedilo, ki ga vidi monter — resnica, ne obljuba. */
  sporocilo: string
  /** Uporabljena mejna globina v ringih (za pojasnilo v poročilu). */
  mejnaGlobina: number
}

const IMENA_PASOV = ['levi del', 'sredina', 'desni del'] as const

/** 8 sosedov: odmik in teža (pravokotno 1, po diagonali 1/√2). */
const SOSEDI: { dx: number; dy: number; w: number }[] = [
  { dx: -1, dy: 0, w: 1 }, { dx: 1, dy: 0, w: 1 }, { dx: 0, dy: -1, w: 1 }, { dx: 0, dy: 1, w: 1 },
  { dx: -1, dy: -1, w: 0.7 }, { dx: 1, dy: -1, w: 0.7 }, { dx: -1, dy: 1, w: 0.7 }, { dx: 1, dy: 1, w: 0.7 },
]

/**
 * OBNOVA OZADJA brez AI: iz neoznačenih (originalnih) pikslov se po vsakem
 * ringu v označeno območje širi povprečje že znanih sosedov. Kjer se širitev
 * ustavi (ni znanega soseda) ali je predolga od roba, piksel NI verodostojen —
 * označi se in poročilo pove, v katerem pasu manjka dokaz.
 *
 * Determinizem: ringi se obdelujejo po naraščajočem indeksu, vrednosti pa
 * nastanejo IZKLUČNO iz sosedov prejšnjih ringov (snapshot), zato vrstni red
 * znotraj ringa ne more vplivati na rezultat.
 */
export function obnoviOzadje (
  izvirnik: Uint8ClampedArray,
  W: number,
  H: number,
  pokrit: Uint8Array,
  opts: ObnovaOpts = {}
): Obnova {
  const n = W * H
  const piksli = new Uint8ClampedArray(izvirnik.length)
  piksli.set(izvirnik.subarray(0, piksli.length))
  const globina = new Int32Array(n).fill(-1)
  const razresen = new Uint8Array(n)
  const mejnaGlobina = Math.max(4, Math.round(opts.maksGlobina ?? Math.max(24, Math.min(W, H) * 0.06)))

  for (let i = 0; i < n; i++) {
    if (pokrit[i] === 0) {
      razresen[i] = 1
      globina[i] = -1
    } else {
      globina[i] = 0
    }
  }

  let ring = 1
  for (;;) {
    // kandidati = pokriti, še nezaključeni, z vsaj enim rešenim sosedom
    const kandidati: number[] = []
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (pokrit[i] === 0 || razresen[i] === 1) continue
        for (const s of SOSEDI) {
          const nx = x + s.dx; const ny = y + s.dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          if (razresen[ny * W + nx] === 1) { kandidati.push(i); break }
        }
      }
    }
    if (kandidati.length === 0) break

    // vrednosti samo iz sosedov prejšnjih ringov (snapshot)
    const zapis = kandidati.map((i) => {
      const x = i % W; const y = (i - x) / W
      let sr = 0; let sg = 0; let sb = 0; let ws = 0
      for (const s of SOSEDI) {
        const nx = x + s.dx; const ny = y + s.dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (razresen[j] === 0) continue
        sr += piksli[j * 4] * s.w
        sg += piksli[j * 4 + 1] * s.w
        sb += piksli[j * 4 + 2] * s.w
        ws += s.w
      }
      return { i, r: sr / ws, g: sg / ws, b: sb / ws }
    })
    for (const z of zapis) {
      piksli[z.i * 4] = z.r
      piksli[z.i * 4 + 1] = z.g
      piksli[z.i * 4 + 2] = z.b
      piksli[z.i * 4 + 3] = 255
      razresen[z.i] = 1
      globina[z.i] = ring
    }
    ring++
    if (ring > mejnaGlobina * 4 + 2) break // zaščita pred neskončno zanko
  }

  // ── poročilo o nedokončanosti ──
  const nedokončano = new Uint8Array(n)
  let pokritih = 0
  let nedokončanih = 0
  let x0 = W; let x1 = -1; let y0 = H; let y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (pokrit[i] === 0) continue
      pokritih++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      // globina 0 = piksel NI nikoli razrešen (brez dostopnega znanega soseda) —
      // na originalnih vrednostih bi bila stara ograja še vedno vidna.
      if (globina[i] === 0 || globina[i] > mejnaGlobina) { nedokončano[i] = 1; nedokončanih++ }
    }
  }
  const razmerjeNedokončanega = pokritih > 0 ? nedokončanih / pokritih : 0

  const sirina = Math.max(1, x1 - x0 + 1)
  const pasovi: Pas[] = IMENA_PASOV.map((ime) => ({ ime, pokritihPikslov: 0, nedokončanihPikslov: 0, razmerje: 0 }))
  if (pokritih > 0) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (pokrit[i] === 0) continue
        const k = Math.min(2, Math.floor(((x - x0) / sirina) * 3))
        const p = pasovi[k]
        p.pokritihPikslov++
        if (nedokončano[i] === 1) p.nedokončanihPikslov++
      }
    }
    for (const p of pasovi) p.razmerje = p.pokritihPikslov > 0 ? p.nedokončanihPikslov / p.pokritihPikslov : 0
  }

  const zahtevaRočniPoseg = pokritih > 0 && razmerjeNedokončanega > PRAG_ROCNEGA_POSEG
  const delezi = pasovi.filter((p) => p.pokritihPikslov > 0 && p.razmerje > PRAG_ROCNEGA_POSEG).map((p) => `${p.ime} ${Math.round(p.razmerje * 100)} %`)
  const sporocilo = pokritih === 0
    ? 'Ni označenega območja — ozadje se ni obnovljalo, originalna fotografija je nespremenjena.'
    : zahtevaRočniPoseg
      ? `Ozadje za staro ograje je NEDOKONČANO: ${Math.round(razmerjeNedokončanega * 100)} % območja je predaleč od pravih pikslov fotografije (širitev > ${mejnaGlobina} px) — manjka dokaz v pasovih: ${delezi.join(', ')}. Rezultat NI odstranjena ograja; zahteva ročni popravek.`
      : `Ozadje je obnovljeno iz robov fotografije (širitev ≤ ${mejnaGlobina} px) — vsak obnovljen piksel ima dokazane izvirne piksle v bližini. Skrito strukturo za ograjo (npr. okno) s tem NI rekonstruirana.`

  return {
    piksli, globina, nedokončano, razmerjeNedokončanega, pasovi,
    zahtevaRočniPoseg, sporocilo, mejnaGlobina,
  }
}

// ─── Sestava (kompozit) brez canvasa ────────────────────────────────────────

export interface SlojOpts {
  /** ringi robnega prehoda; 0 = brez mehčanja (ostri rob) */
  mehkaRob?: number
  /** riši šrafuro čez nedokončane piksle (§2: rezultat jasno označi) */
  označiNedokončano?: boolean
}

/**
 * Zloži v RGBA sloj (za `putImageData`/`drawImage` na odjemalcu):
 *  - RGB = obnovljeno ozadje,
 *  - A = 0 zunaj maske, v robnih ringih postopen prehod, v notranjosti 255,
 *  - nedokončani pikseli so deterministično šrafirano označjeni.
 * Zunaj maske je sloj PROSOJEN — originalna fotografija ostane nespremenjena.
 */
export function slojObnove (
  obnova: Obnova,
  pokrit: Uint8Array,
  W: number,
  H: number,
  opts: SlojOpts = {}
): Uint8ClampedArray {
  const mehk = Math.max(0, Math.round(opts.mehkaRob ?? MEHKA_ROB))
  const oznaka = opts.označiNedokončano !== false
  const sloj = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const o = i * 4
      if (pokrit[i] === 0) continue
      const g = obnova.globina[i]
      if (g < 0) continue
      let a = 255
      if (mehk > 0 && g < mehk) a = Math.round((255 * g) / mehk)
      let r = obnova.piksli[o]; let gg = obnova.piksli[o + 1]; let b = obnova.piksli[o + 2]
      if (oznaka && obnova.nedokončano[i] === 1) {
        // deterministična šrafura (odvisna samo od položaja, ne od naključja)
        if (((x + y) % 8) < 3) { r = 244; gg = 180; b = 60; a = Math.max(a, 200) }
      }
      sloj[o] = r; sloj[o + 1] = gg; sloj[o + 2] = b; sloj[o + 3] = a
    }
  }
  return sloj
}

/**
 * PREDNJI plan: kjer je maska prednjega plana, vrne ORIGINALNE piksle —
 * izvirnik ima prednost pred novo ograjo. Zunaj maske ostane trenutni kompozit.
 */
export function zložiPrednjiPlan (
  trenutni: Uint8ClampedArray,
  izvirnik: Uint8ClampedArray,
  prednji: Uint8Array
): Uint8ClampedArray {
  const izhod = new Uint8ClampedArray(trenutni.length)
  izhod.set(trenutni.subarray(0, izhod.length))
  for (let i = 0; i < prednji.length; i++) {
    if (prednji[i] === 0) continue
    const o = i * 4
    if (o + 3 >= izvirnik.length) continue
    izhod[o] = izvirnik[o]
    izhod[o + 1] = izvirnik[o + 1]
    izhod[o + 2] = izvirnik[o + 2]
    izhod[o + 3] = 255
  }
  return izhod
}

/** Mehki rob prednjega plana (α glede na lego ob robu) — deterministično. */
export function mehkiPrednji (prednji: Uint8Array, W: number, H: number, ringi = 2): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H)
  if (ringi <= 0) {
    for (let i = 0; i < prednji.length; i++) a[i] = prednji[i] ? 255 : 0
    return a
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (prednji[i] === 0) continue
      let rob = 0
      for (const s of SOSEDI) {
        const nx = x + s.dx; const ny = y + s.dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { rob++; continue }
        if (prednji[ny * W + nx] === 0) rob++
      }
      a[i] = rob === 0 ? 255 : Math.max(90, Math.round((255 * ringi) / (ringi + rob)))
    }
  }
  return a
}

/**
 * Prednji plan kot prosojen SLOJ za izris čez novo ograjo (§1): zunaj označenih
 * oblik je piksel popolnoma prosojen (izris ne prekriti ničesar), znotraj so
 * ORIGINALNI piksli fotografije. Rob je mehki po `mehkiPrednji`.
 */
export function slojPrednjega (
  izvirnik: Uint8ClampedArray,
  W: number,
  H: number,
  prednji: Uint8Array,
  ringi = 2
): Uint8ClampedArray {
  const alfa = mehkiPrednji(prednji, W, H, ringi)
  const sloj = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const a = alfa[i]
    if (a === 0) continue
    const o = i * 4
    if (o + 3 >= izvirnik.length) continue
    sloj[o] = izvirnik[o]
    sloj[o + 1] = izvirnik[o + 1]
    sloj[o + 2] = izvirnik[o + 2]
    sloj[o + 3] = a
  }
  return sloj
}

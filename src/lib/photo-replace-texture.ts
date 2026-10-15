// photo-replace-texture — R507 (issue #14 §3 in §4): nova ograja iz DEJANSKIH,
// PREVERJENIH ROKSALOVIH gradiv — ne iz generične barvne ploskve.
//
// Zakaj obstaja:
//  - fotomontažni modul je doslej risal ograje SAMO iz hex barve (RAL približek)
//    in gradientov; 85 preverjenih originalnih ROKSALOVIH gradiv iz kataloga
//    (issue #6) se v izris ni uporabilo niti eno;
//  - issue #14 §3: »Preprosta enobarvna ploskev ali samo narisan pravokotnik ne
//    šteje kot realističen prikaz materiala« in »Če originalne teksture/fotografije
//    ni, pokaži, kaj manjka, in ne trdi, da je prikaz originalen«.
//
// Načela:
//  - KATALOG ostane edini vir identitete izdelka — nič novega cenika, nič nove
//    variante, nič izmišljenega SKU-ja (tehnična načela issue #14);
//  - uporabi se IZKLJUČNO gradivo s statusom VERIFIED in z dejansko datoteko;
//    NEEDS_REVIEW / MISSING / NOT_AUTHORIZED se ne predstavlja kot original;
//  - barva pride iz kataloga (RAL/odtenek), originalna fotografija prispeva samo
//    STRUKTURO površine — slika druge barve ne more potrditi barve;
//  - perspektiva: enotski kvadrat elementa se preslika skozi homografijo po mreži
//    celic (klasična projektivna aproksimacija), brez AI in zunanjih storitev;
//  - čist modul: brez DOM tipov razen `CanvasRenderingContext2D`, brez naključja.

import type { Tocka } from './photo-replace-core'

// ─── Katalogov presek (client-safe, brez Prisma uvoza) ──────────────────────

/** Minimalen presek `ProductAsset`, ki ga rabita izris in doklad o viru. */
export interface GradivoDTO {
  id: string
  kind: string
  orientation: string | null
  view: string | null
  colorName: string | null
  variantSku: string | null
  productId: string | null
  filePath: string | null
  sha256: string | null
  status: string
  permission: string
  sourceName: string
}

export type GradivoStanje =
  | 'UPORABLJENO'
  | 'SAMO_DRUZINA'
  | 'NI_PREVERJENO'
  | 'NI_DATOTEKE'
  | 'NI_DOVOLJENJA'
  | 'BREZ_IZDELKA'

export interface ZahtevekGradiva {
  productId: string
  /** SKU izbrane variante (odtenek); prazen = samo izdelek */
  variantSku: string | null
  orientation: 'POKOCNA' | 'PRECNA' | 'SPLOSNO'
}

export interface IzbiraGradiva {
  gradivo: GradivoDTO | null
  stanje: GradivoStanje
  /** napis, ki ga vidi monter — ne trdi več, kot je preverjeno */
  napis: string
  /** kaj točno manjka (§3: pokaži, kaj manjka) */
  manjkajo: string[]
  /** doklad o viru za metapodatke različice (§4: sredstva/teksture) */
  doklad: string | null
  /** ali sme sploh risati originalno površino */
  smeUporabiti: boolean
}

/** Prednostni red vrst gradiva za površino deske/profila. */
const VRSTE_POVRSINE = ['FOTO_IZDELEK', 'DETAJL', 'PROFIL_PRESEK']

const primerjId = (a: GradivoDTO, b: GradivoDTO): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Uporabljivo samo, kadar je zapis PREVERJEN in datoteka dejansko obstaja. */
function jeUporabljivo (g: GradivoDTO): boolean {
  return g.status === 'VERIFIED' && typeof g.filePath === 'string' && g.filePath.length > 0
}

function napisZaStanje (stanje: GradivoStanje, req: ZahtevekGradiva): string {
  const or = req.orientation === 'PRECNA' ? 'prečna' : req.orientation === 'POKOCNA' ? 'pokončna' : 'splošna'
  switch (stanje) {
    case 'UPORABLJENO': return `Originalna ROKSALOVA površina je uporabljena (varianta ${req.variantSku ?? '—'}, ${or} orientacija).`
    case 'SAMO_DRUZINA': return 'Uporabljeno je preverjeno gradivo IZDELKA, ne te barve — odtenek pride iz kataloga, površina samo iz strukture.'
    case 'NI_PREVERJENO': return 'Za to varianto ni preverjenega originalnega gradiva — prikaz je barvni približek, NE originalna površina.'
    case 'NI_DATOTEKE': return 'Preverjen zapis obstaja, datoteka pa še ni pridobljena — originalne teksture ni mogoče prikazati.'
    case 'NI_DOVOLJENJA': return 'Gradivo za ta izdelek nima dovoljenja za uporabo v aplikaciji — prikaz je barvni približek.'
    default: return 'Izdelek ni izbran — originalnega gradiva ni mogoče poiskati.'
  }
}

const dokladO = (g: GradivoDTO): string =>
  `${g.sourceName} · ${g.filePath ?? 'brez datoteke'} · sha256 ${g.sha256 ?? 'neznan'}`

/**
 * Izbere gradivo za izris. Deterministično (sortira po id) in fail-closed:
 * kadar ni preverjene datoteke za to varianto, vrne `gradivo: null` in pojasni,
 * kaj manjka — generičnega nadomestka nikoli ne predstavi kot originala.
 */
export function izberiGradivo (assets: readonly GradivoDTO[], req: ZahtevekGradiva): IzbiraGradiva {
  const osno = ['originalna površina variante', 'preverjena barvna lestvica', 'profilni presek']
  if (!req.productId) {
    return { gradivo: null, stanje: 'BREZ_IZDELKA', napis: napisZaStanje('BREZ_IZDELKA', req), manjkajo: osno, doklad: null, smeUporabiti: false }
  }
  const zaIzdelek = assets.filter((a) => a.productId === req.productId).slice().sort(primerjId)
  if (zaIzdelek.length === 0) {
    return { gradivo: null, stanje: 'NI_PREVERJENO', napis: napisZaStanje('NI_PREVERJENO', req), manjkajo: osno, doklad: null, smeUporabiti: false }
  }
  const vrste = (k: string) => zaIzdelek.filter((a) => a.kind === k)
  const manjkajo: string[] = []
  if (!vrste('BARVNA_LESTVICA').some((a) => a.status === 'VERIFIED')) manjkajo.push('preverjena barvna lestvica')
  if (!vrste('PROFIL_PRESEK').some(jeUporabljivo)) manjkajo.push('profilni presek')

  const preverjeno = zaIzdelek.filter((a) => a.status === 'VERIFIED')
  if (preverjeno.length === 0) {
    const stanje: GradivoStanje = zaIzdelek.every((a) => a.status === 'NOT_AUTHORIZED') ? 'NI_DOVOLJENJA' : 'NI_PREVERJENO'
    return {
      gradivo: null, stanje, napis: napisZaStanje(stanje, req),
      manjkajo: [...manjkajo, 'originalna površina variante'], doklad: null, smeUporabiti: false,
    }
  }

  // 1) točna varianta, prednostna vrsta, usklajena orientacija
  for (const kind of VRSTE_POVRSINE) {
    const zaVarianto = preverjeno.filter((a) => jeUporabljivo(a) && a.kind === kind && Boolean(req.variantSku) && a.variantSku === req.variantSku)
    if (zaVarianto.length === 0) continue
    const zOrientacijo = zaVarianto.filter((a) => a.orientation === req.orientation || a.orientation === 'SPLOSNO' || a.orientation == null)
    const choice = zOrientacijo[0] ?? zaVarianto[0]
    const usklajena = zOrientacijo.length > 0
    if (!usklajena) manjkajo.push(`preverjena površina za orientacijo ${req.orientation}`)
    const stanje: GradivoStanje = usklajena ? 'UPORABLJENO' : 'SAMO_DRUZINA'
    return {
      gradivo: choice, stanje, napis: napisZaStanje(stanje, req), manjkajo,
      doklad: dokladO(choice), smeUporabiti: true,
    }
  }

  // 2) ni točne variante — preverjeno gradivo izdelka sme samo v strukturo
  //    (prednostni red vrst velja tudi tu: tehnični presek je zadnja izbira)
  let druzina: GradivoDTO | null = null
  for (const kind of VRSTE_POVRSINE) {
    const kandidate = preverjeno.filter((a) => jeUporabljivo(a) && a.kind === kind)
    if (kandidate.length > 0) { druzina = kandidate[0]; break }
  }
  if (druzina) {
    const choice = druzina
    manjkajo.push('originalna površina te barve/odtenka')
    return {
      gradivo: choice, stanje: 'SAMO_DRUZINA', napis: napisZaStanje('SAMO_DRUZINA', req),
      manjkajo, doklad: dokladO(choice), smeUporabiti: true,
    }
  }

  // 3) preverjeni zapisi obstajajo, a brez datotek
  const stanje: GradivoStanje = preverjeno.some((a) => !a.filePath) ? 'NI_DATOTEKE' : 'NI_PREVERJENO'
  return {
    gradivo: null, stanje, napis: napisZaStanje(stanje, req),
    manjkajo: [...manjkajo, 'originalna površina variante'], doklad: null, smeUporabiti: false,
  }
}

// ─── Perspektivno preslikavanje teksture ─────────────────────────────────────

/** Preslikava enotskega kvadrata elementa (u, v ∈ [0,1]) v slikovne piksle. */
export type Projekcija = (u: number, v: number) => Tocka

export interface Pravokotnik { x: number; y: number; w: number; h: number }

export interface Celica {
  /** koti v slikovnih pikslih: zgoraj-levo, zgoraj-desno, spodaj-desno, spodaj-levo */
  koti: [Tocka, Tocka, Tocka, Tocka]
  /** ustrezen izrez izvorne slike (v pikslih) */
  vir: Pravokotnik
}

/**
 * Iz pravokotnika elementa v ravnini ograje (cm) naredi enotsko preslikavo.
 * `v` teče od ZGORAJ navzdol, da je tekstura poravnana z zaslonom.
 */
export function projekcijaIzRavnine (
  Pcm: (xCm: number, yCm: number) => Tocka,
  x0: number, y0: number, x1: number, y1: number
): Projekcija {
  return (u: number, v: number) => Pcm(x0 + u * (x1 - x0), y1 - v * (y1 - y0))
}

/**
 * Razreže projektirano ploskev na mrežo celic. Koti RAČUNANI IZ PRESLIKAVE
 * (ne interpolirani), zato si sosednje celice delijo iste točne točke — brez
 * rež in brez podvajanja pikslov.
 */
export function razdeliMrežo (P: Projekcija, vir: Pravokotnik, celiceU: number, celiceV: number): Celica[] {
  const nU = Math.max(1, Math.min(64, Math.round(celiceU)))
  const nV = Math.max(1, Math.min(64, Math.round(celiceV)))
  const celice: Celica[] = []
  for (let j = 0; j < nV; j++) {
    const v0 = j / nV
    const v1 = (j + 1) / nV
    for (let i = 0; i < nU; i++) {
      const u0 = i / nU
      const u1 = (i + 1) / nU
      celice.push({
        koti: [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)],
        vir: { x: vir.x + u0 * vir.w, y: vir.y + v0 * vir.h, w: vir.w / nU, h: vir.h / nV },
      })
    }
  }
  return celice
}

/** Izrez vira — produktne fotografije imajo robno ozadje, ki ne sme na desko. */
export function izrezVira (sirinaPx: number, visinaPx: number, pas?: [number, number]): Pravokotnik {
  const a = Math.max(0, Math.min(1, pas?.[0] ?? 0))
  const b = Math.max(a, Math.min(1, pas?.[1] ?? 1))
  return { x: 0, y: a * visinaPx, w: sirinaPx, h: Math.max(0, (b - a) * visinaPx) }
}

export interface VirTeksture {
  /** naložena originalna ROKSALOVA slika (HTMLImageElement na odjemalcu) */
  slika: CanvasImageSource
  sirinaPx: number
  visinaPx: number
  /** doklad o preverjenem gradivu (§4: sredstva v metapodatkih različice) */
  doklad: string
  /** kratka oznaka za zaslon (npr. SKU variante) */
  oznaka: string
  /**
   * R520: izrez vira v PX (cela slika privzeto). Za scenične namestitvene
   * fotografije KUBO fasade ga postavi izmeriIzrezNavpicnePalice — vrstica
   * IZREZ ENE deske, da se na letvico ne stiska cela hiša.
   */
  izrez?: Pravokotnik
}

export interface TeksturaOpcije {
  celiceU?: number
  celiceV?: number
  /** 0..1 — kolikšno moč ima struktura površine nad barvo izdelka */
  moc?: number
  /** navpični izrez posnetka (0..1) */
  pas?: [number, number]
}

function potMnogokotnik (ctx: CanvasRenderingContext2D, k: [Tocka, Tocka, Tocka, Tocka]): void {
  ctx.beginPath()
  ctx.moveTo(k[0].x, k[0].y)
  ctx.lineTo(k[1].x, k[1].y)
  ctx.lineTo(k[2].x, k[2].y)
  ctx.lineTo(k[3].x, k[3].y)
  ctx.closePath()
}

/**
 * Nariše originalno teksturo čez en element (desko, palico, steber).
 *
 * Vsaka celica mreže se izriše z AFINO transformacijo svojih štirih točno
 * projektiranih kotov in se omeji (clip) na svoj štirikotnik, zato perspektiva
 * drži z napako velikosti celice (pri priporočeni gostoti < 4 % širine elementa).
 * `multiply` pomeni, da površina prispeva samo STRUKTURO (letnice, brušenje,
 * mat/sijaj); barvo določa katalog.
 */
export function vzorciTeksturo (
  ctx: CanvasRenderingContext2D,
  P: Projekcija,
  vir: VirTeksture,
  opcije: TeksturaOpcije = {}
): void {
  const moc = Math.max(0, Math.min(1, opcije.moc ?? 0.5))
  if (moc <= 0) return
  // R520: če je vir izrezan na eno desko, je izrez vir (celotna višina —
  // letnica teče vzdolž profila); sicer vertikalni pas kot doslej.
  const izvor = vir.izrez && vir.izrez.w > 0 && vir.izrez.h > 0
    ? vir.izrez
    : izrezVira(vir.sirinaPx, vir.visinaPx, opcije.pas)
  if (izvor.w <= 0 || izvor.h <= 0) return
  const celice = razdeliMrežo(P, izvor, opcije.celiceU ?? 12, opcije.celiceV ?? 3)
  ctx.save()
  ctx.globalAlpha = moc
  ctx.globalCompositeOperation = 'multiply'
  for (const c of celice) {
    const [a, b, , d] = c.koti
    if (c.vir.w <= 0 || c.vir.h <= 0) continue
    ctx.save()
    potMnogokotnik(ctx, c.koti)
    ctx.clip()
    ctx.setTransform(
      (b.x - a.x) / c.vir.w, (b.y - a.y) / c.vir.w,
      (d.x - a.x) / c.vir.h, (d.y - a.y) / c.vir.h,
      a.x, a.y,
    )
    ctx.drawImage(vir.slika, c.vir.x, c.vir.y, c.vir.w, c.vir.h, 0, 0, c.vir.w, c.vir.h)
    ctx.restore()
  }
  ctx.restore()
}

/** Gostota mreže celic — samo iz mer elementa in ločljivosti slike. */
export function celiceZaElement (dolzinaPx: number, visinaPx: number): { celiceU: number; celiceV: number } {
  return {
    celiceU: Math.max(1, Math.min(64, Math.round(Math.max(1, dolzinaPx) / 26))),
    celiceV: Math.max(1, Math.min(24, Math.round(Math.max(1, visinaPx) / 26))),
  }
}

// ── R520: izrez ENE navpične palice iz scenične fotografije (KUBO fasada) ────

/**
 * Iz slike z NAVPIČNIMI deskami (namestitvena fotografija KUBO fasade) izmeri
 * korak med deskami in vrne izrez ene deske: celotna višina slike × širina
 * enega profila. Deterministično (mediana gladilo + pragovi, enaka metoda kot
 * ops/r520-izmeri.mjs, samo po eni prerezu).
 *
 * `beriPiksel(x, y)` vrne svetlost 0..1 (odjemalec poda getImageData bralca).
 * Vrne null, kadar ni vsaj 4 zaporednih desk z doslednim korakom — takrat je
 * slika verjetno posnetek ENE deske (DETAJL) in se uporabi cela (fail-closed
 * na obstoječe obnašanje, brez naključnega rezanja).
 */
export function izmeriIzrezNavpicnePalice (
  beriPiksel: (x: number, y: number) => number,
  sirinaPx: number,
  visinaPx: number
): Pravokotnik | null {
  if (sirinaPx < 40 || visinaPx < 40) return null
  // več prereznih črt (0.35 … 0.8) — scena ima pogosto nebo/okna čez sredino;
  // vzamemo NAJBOLJŠO izmero (najširša mediana desk ≥ 4 desk z režami)
  let najboljsa: Pravokotnik | null = null
  let najboljsaMediana = 0
  for (const yd of [0.35, 0.5, 0.65, 0.8]) {
    const izrez = izmeriPoPrerezu(beriPiksel, sirinaPx, visinaPx, Math.round(visinaPx * yd))
    if (!izrez) continue
    if (izrez.w > najboljsaMediana) { najboljsaMediana = izrez.w; najboljsa = izrez }
  }
  return najboljsa
}

/** Ena prerezna črta — vrne izrez ene deske ali null (premalo dokazov). */
function izmeriPoPrerezu (
  beriPiksel: (x: number, y: number) => number,
  sirinaPx: number,
  visinaPx: number,
  y: number
): Pravokotnik | null {
  const pas: number[] = []
  for (let x = 0; x < sirinaPx; x++) pas.push(beriPiksel(x, y))
  // gladilo (mediana 5)
  const g = pas.map((_, i) => {
    const okno = pas.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b)
    return okno[Math.floor(okno.length / 2)]
  })
  // svetlo = deska, temno = reža/rob — prag relativno na sredino pasu
  const sred = g.reduce((a, b) => a + b, 0) / g.length
  const svetlo = g.map((v) => v > sred * 1.06)
  const odseki: { tek: boolean; od: number; dol: number }[] = []
  let tek = svetlo[0], od = 0
  for (let i = 1; i < svetlo.length; i++) {
    if (svetlo[i] === tek) continue
    odseki.push({ tek, od, dol: i - od }); tek = svetlo[i]; od = i
  }
  odseki.push({ tek, od, dol: svetlo.length - od })
  // počisti šum (< 3 px se pripiše sosedu)
  const cisti: { tek: boolean; od: number; dol: number }[] = []
  for (const o of odseki) {
    if (o.dol < 3 && cisti.length > 0) cisti[cisti.length - 1].dol += o.dol
    else cisti.push({ ...o })
  }
  const deske = cisti.filter((o) => o.tek && o.dol >= 8).map((o) => ({ od: o.od, dol: o.dol }))
  const reze = cisti.filter((o) => !o.tek).map((o) => ({ od: o.od, dol: o.dol }))
  if (deske.length < 4 || reze.length < 3) return null
  const sortirane = [...deske.map((d) => d.dol)].sort((a, b) => a - b)
  const medianaD = sortirane[Math.floor(sortirane.length / 2)]
  if (medianaD < 6) return null // preozki »deski« — verjetno rebrasta površina
  // doslednost: vsaj 60 % desk znotraj ±35 % mediane
  const skladne = deske.filter((d) => Math.abs(d.dol - medianaD) <= medianaD * 0.35).length
  if (skladne < Math.max(4, Math.ceil(deske.length * 0.6))) return null
  // reže so lahko ozke (sencen rob) ali široke (namestitev z razmakom) —
  // vendar mora vsaka veljavna reža biti ožja od deske
  const veljavneReze = reze.filter((r) => r.dol > 0 && r.dol < medianaD)
  if (veljavneReze.length < 3) return null
  // izberi DESKO najbliže sredini slike, ki ima na obeh straneh veljavno režo
  const sredina = sirinaPx / 2
  const kandidati = deske.filter((d) => {
    const levo = veljavneReze.some((r) => r.od + r.dol <= d.od + 1 && r.od + r.dol > d.od - medianaD)
    const desno = veljavneReze.some((r) => r.od >= d.od + d.dol - 1 && r.od < d.od + d.dol + medianaD)
    return levo && desno
  })
  const izbrana = kandidati.length
    ? kandidati.reduce((a, b) => (Math.abs(a.od + a.dol / 2 - sredina) < Math.abs(b.od + b.dol / 2 - sredina) ? a : b))
    : null
  if (!izbrana) return null
  // rahlo odštej notranji rob (svetla kantica profila na robu posnetka)
  const rez = Math.max(0, Math.round(izbrana.dol * 0.06))
  const w = izbrana.dol - rez * 2
  if (w < 4) return null
  return { x: izbrana.od + rez, y: 0, w, h: visinaPx }
}

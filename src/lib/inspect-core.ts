// inspect-core.ts — R559: ČISTA LOGIKA VLM PREPOZNAVANJA OBSTOJEČE OGRAJE
// (vprašanje lastnika: »ali kamera sama zazna, kaj je ograja, kakšno okovje,
// keramika ali les«). Parser VLM JSON odgovora + varne preslikave — brez
// DOM/React/strežnika, enako testirljivo kot nagib-core/measure-engine.
// POŠTENOSTNA PRAVILA (disciplina NI_DOKAZA): kadar komponente ni mogoče
// videti, vrne NEZNANO z zaupanjem 0 — nikoli ne ugiba; jeOgraja=false
// počisti VSE materiale/ocene (brez ostankov).
//
// R560 (zahteva lastnika: »mora prepoznat vijak les wpc zelezo rostfrai
// keramiko tla vogale vse kaj je možno v gradbeništvu, dolžina višina
// širina — čisto vse«): SPLOŠNO GRADBENO PREPOZNAVANJE kot NEODVISNI
// razdelki (materiali/vijaki/tla/vogali/mere) — prizor BREZ ograje ima
// lahko tla, vogale, materiale in mere; vsak del s svojim zaupanjem;
// NEZNANO 0, kadar ni vidno — nikoli ne ugibamo.
//
// R561 (vprašanje lastnika: »kako TI zaznavaš, kaj je na fotografiji — če ti
// dam sliko, veš VSE, kar je na njej; naj program tudi razume VSE, kar je
// na sliki«): ODPRTA INVENTURA — program je do zdaj spraševal VLM po FIXNEM
// seznamu (ograja R559 + gradbene kategorije R560); zdaj ga sprašuje
// ENAKO ODPRTO kot človek: prizor (tip/svetloba/vreme/delo v teku), VSI
// vidni predmeti s PROSTIM imenom (orodja, lestve, kabli, pohištvo,
// rastlinje, vozila, živali …) in varnostna opažanja za monterja.
// OSEBA brez imen/obrazov (zasebnost); NEZNANO/prazno, kadar ni vidno —
// nikoli ne ugibamo.

export type InspectMaterial = 'LES' | 'KERAMIKA' | 'INOX' | 'ALUMINIJ' | 'JEKLO' | 'PLASTIKA' | 'DRUGO' | 'NEZNANO'
export type InspectPolnilo = 'STEKLO' | 'NAVPICNE_CEVI' | 'VODORAVNE_CEVI' | 'NAVPICNI_PROFILI' | 'BREZ' | 'DRUGO' | 'NEZNANO'
export type TipOgraje = 'BALKONSKA' | 'STOPNISKA' | 'TERASNA' | 'VRTNA' | 'DRUGO' | 'NEZNANO'
export type StanjeOgraje = 'NOVO' | 'DOBRO' | 'RABLJENO' | 'POSKODOVANO' | 'NEZNANO'

// ── R560: splošni gradbeni tipi (NEODVISNI od jeOgraja) ──
export type GradbeniMaterial = 'LES' | 'WPC' | 'ZELEZO' | 'INOX' | 'KERAMIKA' | 'ALUMINIJ' | 'STEKLO' | 'KAMEN' | 'BETON' | 'PLASTIKA' | 'DRUGO' | 'NEZNANO'
export type TipVijaka = 'TORX' | 'INBUS' | 'KRIZNI' | 'SESTROBI' | 'DRUGO' | 'NEZNANO'
export type MaterialVijaka = 'INOX' | 'POCINKANO' | 'CRNO' | 'JEKLO' | 'DRUGO' | 'NEZNANO'
export type VrstaTal = 'KERAMICNE_PLOSCICE' | 'PORCELANAT' | 'LAMINAT' | 'PARKET' | 'KAMEN' | 'BETON' | 'TLAK' | 'TRAVA' | 'ZEMLJA' | 'ASFALT' | 'GRAMOZ' | 'DRUGO' | 'NEZNANO'
export type TipVogala = 'NOTRANJI' | 'ZUNANJI' | 'DRUGO' | 'NEZNANO'
export type OsaMere = 'DOLZINA' | 'VISINA' | 'SIRINA'

// ── R561: odprta inventura (»razume VSE, kar je na sliki«) ──
export type ObjektKategorija = 'ORODJE' | 'MATERIAL' | 'OPREMA' | 'STAVBNI_ELEMENT' | 'INSTALACIJA' | 'POHISTVO' | 'RASTLINJE' | 'VOZILO' | 'OSEBA' | 'ZIVAL' | 'DRUGO' | 'NEZNANO'
export type PrizorTip = 'TERASA' | 'BALKON' | 'STOPNISCE' | 'VRT' | 'DVORISCE' | 'NOTRANJOST' | 'GRADBISCE' | 'STREHA' | 'CESTA' | 'DRUGO' | 'NEZNANO'

/** R560: posamezen viden gradbeni material (kje + zaupanje). */
export interface InspectMaterialViden { vrsta: GradbeniMaterial; kje: string; opis: string; zaupanje: number }
/** R560: vijaki na sliki (vidni tri-state; tip/material/ocena števila). */
export interface InspectVijaki { vidni: boolean | null; tip: TipVijaka; material: MaterialVijaka; steviloOcena: number | null; kje: string; zaupanje: number }
/** R560: tla (vrsta + dimenzije ploščice SAMO iz referenc na sliki). */
export interface InspectTla { vrsta: VrstaTal; opis: string; ploscicaDolzinaCm: number | null; ploscicaSirinaCm: number | null; zaupanje: number }
/** R560: vogali (stičišča sten/ogradb, zavoji ograje; notranji/zunanji). */
export interface InspectVogali { steviloOcena: number | null; tipGlavni: TipVogala; kot: number | null; opis: string; zaupanje: number }
/** R560: ocena mere predmeta z referenco (brez reference → ocenaCm null). */
export interface InspectMera { predmet: string; osa: OsaMere; ocenaCm: number | null; referenca: string; zaupanje: number }
/** R561: kontekst celotnega prizora (tip, svetloba, vreme zunaj, znaki dela). */
export interface InspectPrizor { tip: PrizorTip; opis: string; svetloba: string; vreme: string | null; deloVTeku: boolean | null; zaupanje: number }
/** R561: vidni predmet s PROSTIM imenom (odprt seznam — ne le gradbeni materiali). */
export interface InspectObjekt { ime: string; kategorija: ObjektKategorija; steviloOcena: number | null; kje: string; opis: string; zaupanje: number }

export interface InspectOgraja {
  jeOgraja: boolean
  scene: string
  tipOgraje: TipOgraje
  rocnik: { material: InspectMaterial; opis: string; barva: string | null; zaupanje: number }
  polnilo: { vrsta: InspectPolnilo; opis: string; zaupanje: number }
  stebri: { material: InspectMaterial; steviloOcena: number | null; opis: string; zaupanje: number }
  okovje: { kljuka: boolean | null; tecaji: boolean | null; kljucavnica: boolean | null; opis: string | null }
  stanje: StanjeOgraje
  stanjeOpis: string
  ocenaVisineCm: number | null
  ocenaDolzineCm: number | null
  opombe: string[]
  // ── R560: splošni gradbeni razdelki — NEODVISNI od jeOgraja ──
  materiali: InspectMaterialViden[]
  vijaki: InspectVijaki
  tla: InspectTla
  vogali: InspectVogali
  mere: InspectMera[]
  // ── R561: odprta inventura — NEODVISNA od jeOgraja (prizor obstaja vedno) ──
  prizor: InspectPrizor
  objekti: InspectObjekt[]
  varnost: string[]
}

/** R559: prompt za VLM (glm-4.6v) — slovenščina, izrecna poštenostna pravila:
 * keramika ročnika ≠ ploščice na tleh; NEZNANO + 0 kadar ne vidi; brez ugibanj. */
export const INSPECT_PROMPT = `Si inšpektor ograj pri proizvajalcu balkonskih in stopniških ograj (ROKSAL). Dobil si fotografijo, na kateri je LAHKO obstoječa ograja.
Naloga: PREPOZNAJ, kaj je na sliki — ali je ograja, njen tip, material ročnika, polnilo, stebri, okovje in stanje.
Vrni SAMO veljaven JSON (brez kode, brez markdown) točno te oblike:
{
  "jeOgraja": true,
  "scene": "kratek opis prizora v slovenščini",
  "tipOgraje": "BALKONSKA | STOPNISKA | TERASNA | VRTNA | DRUGO | NEZNANO",
  "rocnik": { "material": "LES | KERAMIKA | INOX | ALUMINIJ | JEKLO | PLASTIKA | DRUGO | NEZNANO", "opis": "kratek opis (npr. toplotno obdelan hrast, poliran inox, keramični ročnik)", "barva": "barva ročnika ali null", "zaupanje": 0.8 },
  "polnilo": { "vrsta": "STEKLO | NAVPICNE_CEVI | VODORAVNE_CEVI | NAVPICNI_PROFILI | BREZ | DRUGO | NEZNANO", "opis": "kratek opis polnila", "zaupanje": 0.7 },
  "stebri": { "material": "LES | KERAMIKA | INOX | ALUMINIJ | JEKLO | PLASTIKA | DRUGO | NEZNANO", "steviloOcena": 7, "opis": "kratek opis stebrov", "zaupanje": 0.6 },
  "okovje": { "kljuka": true, "tecaji": true, "kljucavnica": false, "opis": "kratek opis okovja ali null" },
  "stanje": "NOVO | DOBRO | RABLJENO | POSKODOVANO | NEZNANO",
  "stanjeOpis": "kratek opis stanja (npr. manjka vijak na srednjem steboru, rja na spodnjem robu)",
  "ocenaVisineCm": 105,
  "ocenaDolzineCm": 320,
  "opombe": ["opombe za monterja — samo dejansko videno"],
  "materiali": [{ "vrsta": "LES | WPC | ZELEZO | INOX | KERAMIKA | ALUMINIJ | STEKLO | KAMEN | BETON | PLASTIKA | DRUGO | NEZNANO", "kje": "kje je viden (ročnik, stebri, tla, stena, okvir, podboj …)", "opis": "kratek opis (npr. hrast z vzdolžnimi vlakni; pocinkana ploščevina)", "zaupanje": 0.7 }],
  "vijaki": { "vidni": true, "tip": "TORX | INBUS | KRIZNI | SESTROBI | DRUGO | NEZNANO", "material": "INOX | POCINKANO | CRNO | JEKLO | DRUGO | NEZNANO", "steviloOcena": 12, "kje": "npr. stebri, ročnik, talna obloga", "zaupanje": 0.5 },
  "tla": { "vrsta": "KERAMICNE_PLOSCICE | PORCELANAT | LAMINAT | PARKET | KAMEN | BETON | TLAK | TRAVA | ZEMLJA | ASFALT | GRAMOZ | DRUGO | NEZNANO", "opis": "kratek opis tal", "ploscicaDolzinaCm": 60, "ploscicaSirinaCm": 60, "zaupanje": 0.7 },
  "vogali": { "steviloOcena": 2, "tipGlavni": "NOTRANJI | ZUNANJI | DRUGO | NEZNANO", "kot": 90, "opis": "kratek opis vogalov (stičišča sten, zavoji ograje)", "zaupanje": 0.6 },
  "mere": [{ "predmet": "npr. hodnik/tla, odprtina, ograja", "osa": "DOLZINA | VISINA | SIRINA", "ocenaCm": 110, "referenca": "npr. ploščica 60 cm; vrata ≈ 200 cm", "zaupanje": 0.6 }],
  "prizor": { "tip": "TERASA | BALKON | STOPNISCE | VRT | DVORISCE | NOTRANJOST | GRADBISCE | STREHA | CESTA | DRUGO | NEZNANO", "opis": "kratek opis celotnega prizora (kaj je to za prostor)", "svetloba": "npr. dnevna polna svetloba; senca; oblačno; umetna razsvetljava", "vreme": "npr. sončno; deževno; sneži — SAMO zunaj, sicer null", "deloVTeku": true, "zaupanje": 0.8 },
  "objekti": [{ "ime": "PROSTO ime predmeta v slovenščini (npr. aluminijasta lestev, akumulatorski vijačnik, vedro z malto, kabelska doza, smreka, oseba s čelado)", "kategorija": "ORODJE | MATERIAL | OPREMA | STAVBNI_ELEMENT | INSTALACIJA | POHISTVO | RASTLINJE | VOZILO | OSEBA | ZIVAL | DRUGO", "steviloOcena": 2, "kje": "levo / desno / sredina / ozadje / na tleh …", "opis": "kratek opis (barva, stanje, posebnost)", "zaupanje": 0.8 }],
  "varnost": ["varnostno opažanje za monterja — samo dejansko videno; če ga ni, prazen seznam"]
}
Pravila:
- jeOgraja: true SAMO, če je na sliki dejansko ograja z ročnikom; sicer false in VSE ostalo NEZNANO/null;
- zaupanje: število 0.0–1.0; kadar komponente ne vidiš jasno, vrni NEZNANO in zaupanje 0 — NIKOLI NE UGIBAJ;
- KERAMIKA ni isto kot ploščice na tleh: keramika velja SAMO za keramični ročnik ali keramične elemente ograje; ploščice na tleh niso material ograje;
- LES: topel ton z vzdolžnimi vlakni; WPC/tehnološki les zapiši kot LES z opisom »tehnološki les«;
- okovje: true = jasno vidno, false = jasno ni, null = iz tega kota ni vidno;
- ocenaVisineCm/ocenaDolzineCm: OCENA iz referenc na sliki (vhodna vrata ≈ 200 cm, stopnica ≈ 17 cm, ploščica ≈ 40 cm) ali null, če reference ni;
- opombe: največ 5, samo dejansko videno; če ni ograje, prazen seznam.
- SPLOŠNI RAZDELKI (materiali, vijaki, tla, vogali, mere) izpolni TUDI, kadar jeOgraja=false — prizor brez ograje ima lahko tla, vogale, materiale in mere;
- materiali (največ 6): vsi gradbeni materiali, ki so dejansko VIDNI; WPC je lastna kategorija v materiali[] (ne LES) — homogen profil brez lesne strukture v prerezu (za rocnik.material pa ostaja pravilo LES z opisom); železo = pocinkano/jeklo (mat, sivkasto), inox/rostfraj = nerjaveče (sijaj); kadar ni jasno, NEZNANO in zaupanje 0 — nikoli ne ugibaj zlitine (A2/A4 vizualno ni ločljivo);
- vijaki: vidni=true SAMO, če so glave res vidne (makro/kôta); tip po glavi (zvezdasta = TORX, šesterojni utor = INBUS, križna = KRIZNI, šestrobna glava = SESTROBI); material: svetleč se = INOX, mat rumenkasto = POCINKANO, črno = CRNO; sicer NEZNANO in zaupanje 0;
- tla: vrsta + dimenzije ploščice SAMO, če so ploščice vidne (ploscicaDolzinaCm/ploscicaSirinaCm 5..300, sicer null); laminat/parket/gramoz → dimenzije null;
- vogali: stičišča sten/ogradb ali zavoji ograje; notranji (kot < 180°), zunanji (> 180°); kot 15..180 (tipično 90/135); število 0..20;
- mere (največ 8): dolžina/višina/širina predmetov na sliki — mero oceni SAMO iz referenc (vrata ≈ 200 cm, stopnica ≈ 17 cm, ploščica 40/60 cm, oseba ≈ 170 cm); brez reference → ocenaCm null in referenca »ni reference«.
- prizor: tip celotnega prizora; svetloba kratek opis; vreme SAMO zunaj (notri null); deloVTeku: true = vidni znaki dela (razloženo orodje, delno vgrajena/konstrukcija, odprta gradbiščna jama), false = urejen/lasen prizor brez znakov dela, null = iz slike ni razvidno;
- objekti (največ 20): NAŠTEJ VSE vidne predmete na sliki — ODPRT seznam, ne le gradbeni materiali: orodja, posode, kabli, lestve, odri, pohištvo, okna, vrata, svetila, rastlinje, vozila, oprema, živali …; ime je PROSTO besedilo v slovenščini; enake predmete ZDRUŽI z oceno števila (npr. lesena deska ×6); OSEBA: zapiši SAMO prisotnost in obleko/zaščito — BREZ imen, obrazov ali identifikacije (zasebnost); kadar predmeta ne vidiš jasno, ga NE naštej;
- varnost (največ 5): samo DEJANSKO VIDNE nevarnosti za monterja (neovargan rob višine, kabel čez hodnik, orodje na robu, poškodovano steklo, žival pod nogami); če nevarnosti ni videti → prazen seznam — NIKOLI NE UGIBAJ.`

const ROCNIK_MATERIJALI: readonly InspectMaterial[] = ['LES', 'KERAMIKA', 'INOX', 'ALUMINIJ', 'JEKLO', 'PLASTIKA', 'DRUGO', 'NEZNANO']
const POLNILA: readonly InspectPolnilo[] = ['STEKLO', 'NAVPICNE_CEVI', 'VODORAVNE_CEVI', 'NAVPICNI_PROFILI', 'BREZ', 'DRUGO', 'NEZNANO']
const TIPI: readonly TipOgraje[] = ['BALKONSKA', 'STOPNISKA', 'TERASNA', 'VRTNA', 'DRUGO', 'NEZNANO']
const STANJA: readonly StanjeOgraje[] = ['NOVO', 'DOBRO', 'RABLJENO', 'POSKODOVANO', 'NEZNANO']

// ── R560: splošni gradbeni seznami (NEODVISNI od jeOgraja) ──
const GRADBENI_MATERIALI: readonly GradbeniMaterial[] = ['LES', 'WPC', 'ZELEZO', 'INOX', 'KERAMIKA', 'ALUMINIJ', 'STEKLO', 'KAMEN', 'BETON', 'PLASTIKA', 'DRUGO', 'NEZNANO']
const TIPI_VIJAKOV: readonly TipVijaka[] = ['TORX', 'INBUS', 'KRIZNI', 'SESTROBI', 'DRUGO', 'NEZNANO']
const MATERIALI_VIJAKOV: readonly MaterialVijaka[] = ['INOX', 'POCINKANO', 'CRNO', 'JEKLO', 'DRUGO', 'NEZNANO']
const VRSTE_TAL: readonly VrstaTal[] = ['KERAMICNE_PLOSCICE', 'PORCELANAT', 'LAMINAT', 'PARKET', 'KAMEN', 'BETON', 'TLAK', 'TRAVA', 'ZEMLJA', 'ASFALT', 'GRAMOZ', 'DRUGO', 'NEZNANO']
const TIPI_VOGALOV: readonly TipVogala[] = ['NOTRANJI', 'ZUNANJI', 'DRUGO', 'NEZNANO']
const OSE_MER: readonly OsaMere[] = ['DOLZINA', 'VISINA', 'SIRINA']

// ── R561: odprta inventura seznami ──
const KATEGORIJE: readonly ObjektKategorija[] = ['ORODJE', 'MATERIAL', 'OPREMA', 'STAVBNI_ELEMENT', 'INSTALACIJA', 'POHISTVO', 'RASTLINJE', 'VOZILO', 'OSEBA', 'ZIVAL', 'DRUGO', 'NEZNANO']
const PRIZOR_TIPI: readonly PrizorTip[] = ['TERASA', 'BALKON', 'STOPNISCE', 'VRT', 'DVORISCE', 'NOTRANJOST', 'GRADBISCE', 'STREHA', 'CESTA', 'DRUGO', 'NEZNANO']

/** varna enum vrednost — neznano, če VLM ni odgovoril s predvideno vrednostjo. */
function enumVal<T extends string> (v: unknown, dovoljene: readonly T[], pad: T): T {
  return typeof v === 'string' && (dovoljene as readonly string[]).includes(v) ? v as T : pad
}

/** varno zaupanje 0..1 (zaokroženo na 2 decimalki; neveljavno → 0). */
export function varnoZaupanje (v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 100) / 100)) : 0
}

/** varen kratek niz (neveljavno → ''). */
export function varnoBesedilo (v: unknown, max: number): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : ''
}

/** varen true/false/null (okovje: null = iz tega kota ni vidno). */
export function varnoTri (v: unknown): boolean | null {
  return v === true ? true : v === false ? false : null
}

/** varna ocena mere v cm (10..20000) ali null — izven meje NI mere. */
export function varnaOcenaCm (v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n >= 10 && n <= 20_000 ? Math.round(n) : null
}

/** R560: varna dimenzija ploščice v cm (5..300) ali null. */
export function varnaPloscicaCm (v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n >= 5 && n <= 300 ? Math.round(n) : null
}

/** R560: varno število (min..max) ali null (vogali, vijaki) —
 * Number(null)=0 in Number('')=0 v JS sta PASTI pri min=0: izrecno
 * zavrnemo null/undefined/prazen niz, sicer bi 0 lažno veljal. */
export function varnoStevilo (v: unknown, min: number, max: number): number | null {
  if (v == null || (typeof v === 'string' && !v.trim())) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null
}

/** R560: seznam vidnih materialov (cap 6; NEZNANO vrsta = šum → ven). */
function parseMateriali (v: unknown): InspectMaterialViden[] {
  if (!Array.isArray(v)) return []
  const out: InspectMaterialViden[] = []
  for (const m of v) {
    if (out.length >= 6) break
    if (m == null || typeof m !== 'object') continue
    const o = m as Record<string, unknown>
    const vrsta = enumVal(o.vrsta, GRADBENI_MATERIALI, 'NEZNANO')
    if (vrsta === 'NEZNANO') continue
    out.push({ vrsta, kje: varnoBesedilo(o.kje, 60), opis: varnoBesedilo(o.opis, 200), zaupanje: varnoZaupanje(o.zaupanje) })
  }
  return out
}

/** R560: mere (cap 8; veljavna osa + neprazen predmet; ocenaCm null = brez reference). */
function parseMere (v: unknown): InspectMera[] {
  if (!Array.isArray(v)) return []
  const out: InspectMera[] = []
  for (const m of v) {
    if (out.length >= 8) break
    if (m == null || typeof m !== 'object') continue
    const o = m as Record<string, unknown>
    const predmet = varnoBesedilo(o.predmet, 100)
    if (!predmet) continue
    const osa = typeof o.osa === 'string' && (OSE_MER as readonly string[]).includes(o.osa) ? o.osa as OsaMere : null
    if (!osa) continue
    out.push({ predmet, osa, ocenaCm: varnaOcenaCm(o.ocenaCm), referenca: varnoBesedilo(o.referenca, 100) || 'ni reference', zaupanje: varnoZaupanje(o.zaupanje) })
  }
  return out
}

/** R561: kontekst prizora (neodvisno od jeOgraja — prizor obstaja vedno). */
function parsePrizor (v: unknown): InspectPrizor {
  const p = (v != null && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    tip: enumVal(p.tip, PRIZOR_TIPI, 'NEZNANO'),
    opis: varnoBesedilo(p.opis, 300),
    svetloba: varnoBesedilo(p.svetloba, 60),
    vreme: varnoBesedilo(p.vreme, 60) || null,
    deloVTeku: varnoTri(p.deloVTeku),
    zaupanje: varnoZaupanje(p.zaupanje),
  }
}

/** R561: odprta inventura predmetov (cap 20; PROSTO ime obvezno;
 * neveljavna kategorija → DRUGO, ne izgubimo predmeta). */
function parseObjekti (v: unknown): InspectObjekt[] {
  if (!Array.isArray(v)) return []
  const out: InspectObjekt[] = []
  for (const x of v) {
    if (out.length >= 20) break
    if (x == null || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const ime = varnoBesedilo(o.ime, 60)
    if (!ime) continue
    out.push({
      ime,
      kategorija: enumVal(o.kategorija, KATEGORIJE, 'DRUGO'),
      steviloOcena: varnoStevilo(o.steviloOcena, 1, 500),
      kje: varnoBesedilo(o.kje, 60),
      opis: varnoBesedilo(o.opis, 200),
      zaupanje: varnoZaupanje(o.zaupanje),
    })
  }
  return out
}

/** R561: varnostna opažanja (cap 5 × 200; samo nizi). */
function parseVarnost (v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, 5)
    .map((x) => x.trim().slice(0, 200))
}

/** R561: POPRAVEK znanih VLM tipkarskih napak v JSON — SAMO ob padcu
 * JSON.parse (veljavnih odgovorov nikoli ne dotaknemo). Živ primer
 * (glm-4.6v, 45 s / 4,7 kB): `"tla": { …, "ploscicaDolzinaCm: 60,
 * ploscicaSirinaCm: 60, "zaupanje": 0.8 }` — DVE napaki v eni vrstici:
 * (a) izpuščen zaklepajoči narekovaj imena ključa ("key: 60),
 * (b) ključ brez obeh narekovajev (key: 60);
 * (c) podpijaj pred } ali ] (trailing comma).
 * Hodnik po znakih z vestjo o nizih (v nizu se NE popravlja) + STRUKTURNA
 * straža: narekovaj/ključ se popravi SAMO, ko gre za položaj ključa
 * (predhodni ne-presleden znak je `{` ali `,`) — vrednost, ki se začne z
 * »TORX: zvezdasta« (predhodnik `:`), ostane nedotaknjena. */
export function popraviVlmJson (s: string): string {
  let out = ''
  let vNizu = false
  let prej = '' // zadnji izpisani ne-presleden znak ZUNAJ niza
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (vNizu) {
      out += c
      if (c === '\\') { out += s[i + 1] ?? ''; i += 2; continue }
      if (c === '"') vNizu = false
      i += 1
      continue
    }
    if (c === '"') {
      // (a) `"key: vrednost…` — manjka zaklepajoči narekovaj ključa:
      // veljaven SAMO v položaju ključa (za `{` ali `,`)
      const m = /^([A-Za-z0-9_]+):(\s)/.exec(s.slice(i + 1))
      if (m && (prej === '{' || prej === ',')) {
        out += `"`
        out += m[1]
        out += `":`
        i += 1 + m[0].length
        prej = ':'
        continue
      }
      vNizu = true
      out += c
      i += 1
      continue
    }
    if (c === ',') {
      // (c) podpijaj pred } ali ] — pobriši
      const naprej = /^[ \t\r\n]*[}\]]/.exec(s.slice(i + 1))
      if (naprej) { i += 1; continue }
      out += c
      prej = ','
      i += 1
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      // (b) goli ključ `key:` brez narekovajev — veljaven SAMO v položaju
      // ključa (za `{` ali `,`) in SAMO, če sledi dvopičje
      const m = /^([A-Za-z0-9_]+)([ \t\r\n]*):/.exec(s.slice(i))
      if (m && (prej === '{' || prej === ',')) {
        out += `"`
        out += m[1]
        out += `":`
        i += m[0].length
        prej = ':'
        continue
      }
    }
    if (!/\s/.test(c)) prej = c
    out += c
    i += 1
  }
  return out
}

/** Parser VLM odgovora: izlušči prvi veljavni JSON objekt in ga SANITIZIRAJ
 * (vsako polje neodvisno — polomljen VLM odgovor ne sesuje celotnega rezultata).
 * R561: če JSON.parse pade, poskusimo DETERMINISTIČEN popravek znanih napak
 * (popraviVlmJson) — brez njega bi celo 4,7 kB odgovor z eno tipkarsko
 * napako propadel kot 422. */
export function parseInspectJson (raw: string): InspectOgraja | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    let p: Record<string, unknown>
    try {
      p = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      p = JSON.parse(popraviVlmJson(raw.slice(start, end + 1))) as Record<string, unknown>
    }
    const r = (p.rocnik ?? {}) as Record<string, unknown>
    const po = (p.polnilo ?? {}) as Record<string, unknown>
    const st = (p.stebri ?? {}) as Record<string, unknown>
    const ok = (p.okovje ?? {}) as Record<string, unknown>
    const vj = (p.vijaki ?? {}) as Record<string, unknown>
    const tl = (p.tla ?? {}) as Record<string, unknown>
    const vg = (p.vogali ?? {}) as Record<string, unknown>
    const jeOgraja = p.jeOgraja === true
    const stevilo = Number(st.steviloOcena)
    // R560: vijaki — dokaz o vidnosti (vidni !== true → brez trditev o tipu/materialu)
    const vijaki: InspectVijaki = vj.vidni === true
      ? {
          vidni: true,
          tip: enumVal(vj.tip, TIPI_VIJAKOV, 'NEZNANO'),
          material: enumVal(vj.material, MATERIALI_VIJAKOV, 'NEZNANO'),
          steviloOcena: varnoStevilo(vj.steviloOcena, 1, 60),
          kje: varnoBesedilo(vj.kje, 60),
          zaupanje: varnoZaupanje(vj.zaupanje),
        }
      : { vidni: varnoTri(vj.vidni), tip: 'NEZNANO', material: 'NEZNANO', steviloOcena: null, kje: '', zaupanje: 0 }
    // R560: tla — vrsta in dimenzije ploščice neodvisno (NEZNANO + 60×60 je pošteno)
    const tla: InspectTla = {
      vrsta: enumVal(tl.vrsta, VRSTE_TAL, 'NEZNANO'),
      opis: varnoBesedilo(tl.opis, 200),
      ploscicaDolzinaCm: varnaPloscicaCm(tl.ploscicaDolzinaCm),
      ploscicaSirinaCm: varnaPloscicaCm(tl.ploscicaSirinaCm),
      zaupanje: varnoZaupanje(tl.zaupanje),
    }
    // R560: vogali — brez števila ni trditev o tipu/kotu
    const vogali: InspectVogali = vg.steviloOcena == null || varnoStevilo(vg.steviloOcena, 0, 20) == null
      ? { steviloOcena: null, tipGlavni: 'NEZNANO', kot: null, opis: '', zaupanje: 0 }
      : {
          steviloOcena: varnoStevilo(vg.steviloOcena, 0, 20),
          tipGlavni: enumVal(vg.tipGlavni, TIPI_VOGALOV, 'NEZNANO'),
          kot: varnoStevilo(vg.kot, 15, 180),
          opis: varnoBesedilo(vg.opis, 200),
          zaupanje: varnoZaupanje(vg.zaupanje),
        }
    return {
      jeOgraja,
      scene: varnoBesedilo(p.scene, 300),
      tipOgraje: jeOgraja ? enumVal(p.tipOgraje, TIPI, 'DRUGO') : 'NEZNANO',
      rocnik: jeOgraja
        ? {
            material: enumVal(r.material, ROCNIK_MATERIJALI, 'NEZNANO'),
            opis: varnoBesedilo(r.opis, 200),
            barva: varnoBesedilo(r.barva, 60) || null,
            zaupanje: varnoZaupanje(r.zaupanje),
          }
        : { material: 'NEZNANO', opis: '', barva: null, zaupanje: 0 },
      polnilo: jeOgraja
        ? { vrsta: enumVal(po.vrsta, POLNILA, 'NEZNANO'), opis: varnoBesedilo(po.opis, 200), zaupanje: varnoZaupanje(po.zaupanje) }
        : { vrsta: 'NEZNANO', opis: '', zaupanje: 0 },
      stebri: jeOgraja
        ? {
            material: enumVal(st.material, ROCNIK_MATERIJALI, 'NEZNANO'),
            steviloOcena: Number.isFinite(stevilo) && stevilo >= 1 && stevilo <= 60 ? Math.round(stevilo) : null,
            opis: varnoBesedilo(st.opis, 200),
            zaupanje: varnoZaupanje(st.zaupanje),
          }
        : { material: 'NEZNANO', steviloOcena: null, opis: '', zaupanje: 0 },
      okovje: jeOgraja
        ? { kljuka: varnoTri(ok.kljuka), tecaji: varnoTri(ok.tecaji), kljucavnica: varnoTri(ok.kljucavnica), opis: varnoBesedilo(ok.opis, 200) || null }
        : { kljuka: null, tecaji: null, kljucavnica: null, opis: null },
      stanje: jeOgraja ? enumVal(p.stanje, STANJA, 'NEZNANO') : 'NEZNANO',
      stanjeOpis: jeOgraja ? varnoBesedilo(p.stanjeOpis, 300) : '',
      ocenaVisineCm: jeOgraja ? varnaOcenaCm(p.ocenaVisineCm) : null,
      ocenaDolzineCm: jeOgraja ? varnaOcenaCm(p.ocenaDolzineCm) : null,
      opombe: jeOgraja && Array.isArray(p.opombe)
        ? p.opombe.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 5).map((x) => x.trim().slice(0, 200))
        : [],
      // ── R560: splošni razdelki — NEODVISNI od jeOgraja (tla obstajajo tudi brez ograje) ──
      materiali: parseMateriali(p.materiali),
      vijaki,
      tla,
      vogali,
      mere: parseMere(p.mere),
      // ── R561: odprta inventura — NEODVISNA od jeOgraja (prizor obstaja vedno) ──
      prizor: parsePrizor(p.prizor),
      objekti: parseObjekti(p.objekti),
      varnost: parseVarnost(p.varnost),
    }
  } catch {
    return null
  }
}

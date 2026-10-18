// inspect-core.ts — R559: ČISTA LOGIKA VLM PREPOZNAVANJA OBSTOJEČE OGRAJE
// (vprašanje lastnika: »ali kamera sama zazna, kaj je ograja, kakšno okovje,
// keramika ali les«). Parser VLM JSON odgovora + varne preslikave — brez
// DOM/React/strežnika, enako testirljivo kot nagib-core/measure-engine.
// POŠTENOSTNA PRAVILA (disciplina NI_DOKAZA): kadar komponente ni mogoče
// videti, vrne NEZNANO z zaupanjem 0 — nikoli ne ugiba; jeOgraja=false
// počisti VSE materiale/ocene (brez ostankov).

export type InspectMaterial = 'LES' | 'KERAMIKA' | 'INOX' | 'ALUMINIJ' | 'JEKLO' | 'PLASTIKA' | 'DRUGO' | 'NEZNANO'
export type InspectPolnilo = 'STEKLO' | 'NAVPICNE_CEVI' | 'VODORAVNE_CEVI' | 'NAVPICNI_PROFILI' | 'BREZ' | 'DRUGO' | 'NEZNANO'
export type TipOgraje = 'BALKONSKA' | 'STOPNISKA' | 'TERASNA' | 'VRTNA' | 'DRUGO' | 'NEZNANO'
export type StanjeOgraje = 'NOVO' | 'DOBRO' | 'RABLJENO' | 'POSKODOVANO' | 'NEZNANO'

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
  "opombe": ["opombe za monterja — samo dejansko videno"]
}
Pravila:
- jeOgraja: true SAMO, če je na sliki dejansko ograja z ročnikom; sicer false in VSE ostalo NEZNANO/null;
- zaupanje: število 0.0–1.0; kadar komponente ne vidiš jasno, vrni NEZNANO in zaupanje 0 — NIKOLI NE UGIBAJ;
- KERAMIKA ni isto kot ploščice na tleh: keramika velja SAMO za keramični ročnik ali keramične elemente ograje; ploščice na tleh niso material ograje;
- LES: topel ton z vzdolžnimi vlakni; WPC/tehnološki les zapiši kot LES z opisom »tehnološki les«;
- okovje: true = jasno vidno, false = jasno ni, null = iz tega kota ni vidno;
- ocenaVisineCm/ocenaDolzineCm: OCENA iz referenc na sliki (vhodna vrata ≈ 200 cm, stopnica ≈ 17 cm, ploščica ≈ 40 cm) ali null, če reference ni;
- opombe: največ 5, samo dejansko videno; če ni ograje, prazen seznam.`

const ROCNIK_MATERIJALI: readonly InspectMaterial[] = ['LES', 'KERAMIKA', 'INOX', 'ALUMINIJ', 'JEKLO', 'PLASTIKA', 'DRUGO', 'NEZNANO']
const POLNILA: readonly InspectPolnilo[] = ['STEKLO', 'NAVPICNE_CEVI', 'VODORAVNE_CEVI', 'NAVPICNI_PROFILI', 'BREZ', 'DRUGO', 'NEZNANO']
const TIPI: readonly TipOgraje[] = ['BALKONSKA', 'STOPNISKA', 'TERASNA', 'VRTNA', 'DRUGO', 'NEZNANO']
const STANJA: readonly StanjeOgraje[] = ['NOVO', 'DOBRO', 'RABLJENO', 'POSKODOVANO', 'NEZNANO']

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

/** Parser VLM odgovora: izlušči prvi veljavni JSON objekt in ga SANITIZIRAJ
 * (vsako polje neodvisno — polomljen VLM odgovor ne sesuje celotnega rezultata). */
export function parseInspectJson (raw: string): InspectOgraja | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const p = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    const r = (p.rocnik ?? {}) as Record<string, unknown>
    const po = (p.polnilo ?? {}) as Record<string, unknown>
    const st = (p.stebri ?? {}) as Record<string, unknown>
    const ok = (p.okovje ?? {}) as Record<string, unknown>
    const jeOgraja = p.jeOgraja === true
    const stevilo = Number(st.steviloOcena)
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
    }
  } catch {
    return null
  }
}

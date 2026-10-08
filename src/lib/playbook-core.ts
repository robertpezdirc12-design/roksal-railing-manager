// playbook-core — R458 (GitLab issue #13: SCRIPT-FIRST FIELD WORKFLOW)
//
// DETERMINISTIČNI PLAYBOOK ENGINE — čist client-safe lib (NIČ strežniških uvozov).
// PLAYBOOK → STEP → ACTION → VALIDATION → NEXT STEP (§1), brez runtime LLM/AI.
//
// Načela:
//  • workflow je PODATKOVNO definiran (JSON) in verzioniran (§14) — ne razpršen
//    po UI komponentah;
//  • naslednji korak izračuna ENGINE iz pravil (§2) glede na stanje korakov,
//    odgovore na pogojna vprašanja (§5) in kontekst naprave (§9);
//  • vsak korak ima obvezna/neobvezna dokazila (§10) in validacijo — kritične
//    mere ne morejo biti tiho preskočene (§6: izjema le z razlogom);
//  • kamera je samo eden od vodenih korakov (§7) — tehnike zajema so
//    deterministične (camera API, žiroskop, AR ravnine, referenca, geometrija;
//    §8 — BREZ runtime AI modela);
//  • offline zmožnost koraka je del definicije (§13) — stanje se sinhronizira
//    prek obstoječega ROKSAL sync mehanizma (ne ustvarja se drugi sistem).

// ─── Tipi ────────────────────────────────────────────────────────────────────

export type StepKategorija =
  | 'PRIHOD' | 'FOTO' | 'MERITEV' | 'ODLOCITEV' | 'KONTROLA' | 'AKCIJA' | 'PREDAJA'

export type EvidenceVrsta =
  | 'FOTO' | 'MERITEV' | 'PODPIS' | 'CHECKLIST' | 'OPOMBA' | 'LOKACIJA' | 'ODGOVOR'

/** §10: zahtevano dokazilo koraka. */
export interface EvidenceZahteva {
  vrsta: EvidenceVrsta
  obvezno: boolean
  opis: string
}

/** Deterministična validacijska pravila (§1 VALIDATION) — brez AI. */
export type ValidacijskoPravilo =
  | { vrsta: 'MIN_STEVILO'; polje: string; vrednost: number; sporocilo: string }
  | { vrsta: 'MIN_VREDNOST'; polje: string; vrednost: number; sporocilo: string }
  | { vrsta: 'NAJVECNJA_VREDNOST'; polje: string; vrednost: number; sporocilo: string }
  | { vrsta: 'MOZNOSTI'; polje: string; vrednost: string[]; sporocilo: string }

/** §5: pogojna veja — korak je v verigi, ko odgovor na polje ni dan ali se ujema. */
export interface StepPogoj {
  polje: string // ključ v context.odgovori, npr. 'jeStopnisce'
  vrednost: boolean | string // vključi korak, če je odgovor === vrednost
}

/** §3: en zaslon = en glavni cilj — korak nosi vsa navodila zase. */
export interface PlaybookStep {
  id: string
  naziv: string
  navodilo: string // kaj narediš ZDAJ
  kje: string // kam usmeriš kamero / kje postaviš točko
  rezultat: string // kakšen rezultat se pričakuje
  kategorija: StepKategorija
  offline: boolean // §13: izvedljivo brez povezave
  evidence: EvidenceZahteva[] // §10
  optionalInputs?: string[]
  validacija?: ValidacijskoPravilo[]
  /** §5: korak je del verige le ob ujemajočem odgovoru (neznan odgovor → v verigi). */
  pogoj?: StepPogoj
  /** ODLOCITEV: možnosti odgovora (privzeto DA/NE). */
  moznosti?: string[]
  /** KONTROLA: točke kontrolnega seznama (vse morajo biti odkljukane). */
  checklist?: string[]
  /** namig po odgovoru (npr. čelna/bočna pritrditev). */
  namigOdgovorov?: Record<string, string>
  /** §1: pravica za izvedbo koraka (privzetek nalog.write — izvajalec naloga). */
  gate?: string
  /** §11: kam engine izroči po zaključku celotnega playbooka. */
  handoff?: { do: HandoffCilj; opis: string }
  /** retry podpora (§1 retry/failure) — privzeto da. */
  ponovi?: boolean
}

export type HandoffCilj = 'KONFIGURATOR' | 'BOM' | 'PONUDBA' | 'NALOG_ZAKLJUCEK' | 'DOKUMENT'

export interface PlaybookDefinition {
  key: string // OGRAJA | KERAMIKA | STREHA | FASADA | MONTAZA
  naziv: string
  opis: string
  scenarij: string // opis poslovnega scenarija (§4)
  version: number
  steps: PlaybookStep[]
}

/** Stanje koraka v zagonu (preslikava PlaybookStepRun iz baze). */
export type KorakStatus =
  | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
  | 'NI_PRIMERNO' | 'BLOKIRANO' | 'NEUSPESNO'

export interface KorakStanje {
  stepId: string
  status: KorakStatus
  attempts: number
  evidence?: Evidence | null
  exceptionReason?: string | null
  startedAt?: string | null
  completedAt?: string | null
}

/** §10: dokazila, ki jih pošlje odjemalec ob zaključku koraka. */
export interface Evidence {
  fotoId?: string
  measurementId?: string
  podpisId?: string
  tocke?: { id: string; odkljukano: boolean }[]
  besedilo?: string
  lokacija?: { lat?: number; lng?: number; naslov?: string }
  odgovor?: boolean | string
  vrednosti?: Record<string, number | string>
}

/** Kontekst zagona: odgovori (§5) + zmogljivosti naprave (§9). */
export interface RunContext {
  odgovori: Record<string, boolean | string>
  naprava?: { tier: NapravaTier; opis?: string }
}

/** §9: raven zmogljivosti naprave — tehnika zajema se prilagodi, playbook ostane enak. */
export type NapravaTier = 'LIDAR' | 'AR' | 'KAMERA' | 'OGRANICENO'

export const NAPRAVA_TEHNIKA: Record<NapravaTier, { naziv: string; meritev: string; foto: string }> = {
  LIDAR: {
    naziv: 'LiDAR / depth naprava',
    meritev: '3D/depth zajem + kamera (ARXito/Polycam pristop)',
    foto: 'foto z depth podatki',
  },
  AR: {
    naziv: 'AR podprta naprava',
    meritev: 'AR ravnina + žarek (raycast/hit-test)',
    foto: 'foto s stabilizacijo (žiroskop)',
  },
  KAMERA: {
    naziv: 'Kamera brez AR',
    meritev: 'foto + referenčni objekt + ročna meritev (po možnosti fotogrametrija)',
    foto: 'foto + kontrola kakovosti',
  },
  OGRANICENO: {
    naziv: 'Omejena naprava',
    meritev: 'foto + referenčni objekt + ročna meritev',
    foto: 'foto (preveri kakovost)',
  },
}

// ─── Čisti engine (deterministične funkcije stanja) ──────────────────────────

export function korakById (def: PlaybookDefinition, stepId: string): PlaybookStep | undefined {
  return def.steps.find((s) => s.id === stepId)
}

/**
 * §5/§2: ali je korak v AKTIVNI VERIGI?
 * - korak brez pogoja je vedno v verigi;
 * - korak s pogojem je v verigi, dokler odgovor ni znan (vključno — pokrajša
 *   se po odgovoru, ki ga izključi) ali ko se odgovor ujema s pogojem.
 * To je deterministično in odvisno IZKLJUČNO od (definicija, odgovori).
 */
export function jeVVerigi (step: PlaybookStep, odgovori: Record<string, boolean | string>): boolean {
  if (!step.pogoj) return true
  const odg = odgovori[step.pogoj.polje]
  if (odg === undefined) return true // odgovor še ni znan → korak ostaja videti
  return odg === step.pogoj.vrednost
}

/** Urejena aktivna veriga korakov za dane odgovore (§5 conditional branching). */
export function aktivnaVeriga (
  def: PlaybookDefinition,
  odgovori: Record<string, boolean | string>
): PlaybookStep[] {
  return def.steps.filter((s) => jeVVerigi(s, odgovori))
}

/**
 * §2 DETERMINISTIČNI NEXT-STEP: prvi korak v verigi, ki še ni zaključen
 * (PENDING/IN_PROGRESS/NEUSPESNO). Ko je vsem korakom dana končna oblika
 * (COMPLETED/NI_PRIMERNO/BLOKIRANO), je zagon zaključen → null.
 * Primer iz §2: izmera 92 % končana, manjka pritrditev → engine vrne PRITRDITEV.
 */
export function naslednjiKorak (
  def: PlaybookDefinition,
  stanja: KorakStanje[],
  odgovori: Record<string, boolean | string>
): PlaybookStep | null {
  const stanjeById = new Map(stanja.map((s) => [s.stepId, s]))
  for (const step of aktivnaVeriga(def, odgovori)) {
    const st = stanjeById.get(step.id)
    const status = st?.status ?? 'PENDING'
    if (status === 'PENDING' || status === 'IN_PROGRESS' || status === 'NEUSPESNO') {
      return step
    }
  }
  return null
}

/** Ali je zagon zaključen (vsi koraki verige v končnem stanju)? */
export function jeZakljucen (
  def: PlaybookDefinition,
  stanja: KorakStanje[],
  odgovori: Record<string, boolean | string>
): boolean {
  return naslednjiKorak(def, stanja, odgovori) === null
}

/**
 * §3/§12: napredek zagona — KORAK X/N, končani, izjeme.
 * Šteje samo korake aktivne verige (pogoji krajšajo področje — honest napredek).
 */
export function napredek (
  def: PlaybookDefinition,
  stanja: KorakStanje[],
  odgovori: Record<string, boolean | string>
): { trenutni: number; skupaj: number; koncanih: number; izjem: number; odstotek: number } {
  const veriga = aktivnaVeriga(def, odgovori)
  const stanjeById = new Map(stanja.map((s) => [s.stepId, s]))
  let koncanih = 0
  let izjem = 0
  let trenutni = 0
  for (let i = 0; i < veriga.length; i++) {
    const st = stanjeById.get(veriga[i].id)
    const status = st?.status ?? 'PENDING'
    if (status === 'COMPLETED') koncanih++
    else if (status === 'NI_PRIMERNO' || status === 'BLOKIRANO') { izjem++; koncanih++ }
    else if (trenutni === 0) trenutni = i + 1
  }
  const skupaj = veriga.length
  return {
    trenutni: trenutni || skupaj,
    skupaj,
    koncanih,
    izjem,
    odstotek: skupaj === 0 ? 100 : Math.round((koncanih / skupaj) * 100),
  }
}

/** Ali je korak končan (vključno z izjemama §6)? */
export function jeKoncan (st: KorakStanje | undefined): boolean {
  return !!st && ['COMPLETED', 'NI_PRIMERNO', 'BLOKIRANO'].includes(st.status)
}

// ─── Validacija dokazil (§10 + §1 VALIDATION) ───────────────────────────────

/** Preveri obvezna dokazila koraka → seznam napak (prazno = veljavno). */
export function preveriEvidence (step: PlaybookStep, ev: Evidence | null | undefined): string[] {
  const napake: string[] = []
  const e = ev ?? {}
  for (const zahteva of step.evidence) {
    if (!zahteva.obvezno) continue
    switch (zahteva.vrsta) {
      case 'FOTO':
        if (!e.fotoId || !String(e.fotoId).trim()) napake.push(`Manjka fotografija — ${zahteva.opis}.`)
        break
      case 'MERITEV':
        if (!e.measurementId && !e.vrednosti) {
          napake.push(`Manjka meritev — ${zahteva.opis}.`)
        } else if (!e.measurementId && e.vrednosti && Object.keys(e.vrednosti).length === 0) {
          napake.push(`Meritev je prazna — ${zahteva.opis}.`)
        }
        break
      case 'PODPIS':
        if (!e.podpisId || !String(e.podpisId).trim()) napake.push(`Manjka podpis — ${zahteva.opis}.`)
        break
      case 'CHECKLIST':
        if (!Array.isArray(e.tocke) || e.tocke.length === 0) {
          napake.push(`Kontrolni seznam ni izpolnjen — ${zahteva.opis}.`)
        } else {
          const odkljukanih = e.tocke.filter((t) => t.odkljukano).length
          if (step.checklist && step.checklist.length > 0 && odkljukanih < step.checklist.length) {
            napake.push(`Kontrolni seznam ni popoln (${odkljukanih}/${step.checklist.length}) — ${zahteva.opis}.`)
          } else if (!step.checklist && odkljukanih === 0) {
            napake.push(`Ni odkljukane nobene točke — ${zahteva.opis}.`)
          }
        }
        break
      case 'OPOMBA':
        if (!e.besedilo || !String(e.besedilo).trim()) napake.push(`Manjka opomba — ${zahteva.opis}.`)
        break
      case 'LOKACIJA':
        if (!e.lokacija || (!e.lokacija.naslov && e.lokacija.lat === undefined)) {
          napake.push(`Manjka lokacija — ${zahteva.opis}.`)
        }
        break
      case 'ODGOVOR':
        if (e.odgovor === undefined || e.odgovor === null) {
          napake.push(`Manjka odgovor — ${zahteva.opis}.`)
        } else if (step.moznosti && step.moznosti.length > 0) {
          if (typeof e.odgovor !== 'string' || !step.moznosti.includes(e.odgovor)) {
            napake.push(`Odgovor mora biti eden izmed: ${step.moznosti.join(', ')}.`)
          }
        }
        break
    }
  }
  // validacijska pravila nad vrednostmi (npr. MIN_STEVILO segmentov)
  for (const pravilo of step.validacija ?? []) {
    const v = e.vrednosti?.[pravilo.polje]
    const n = typeof v === 'number' ? v : Number(v)
    switch (pravilo.vrsta) {
      case 'MIN_STEVILO':
      case 'MIN_VREDNOST':
        if (!Number.isFinite(n) || n < pravilo.vrednost) napake.push(pravilo.sporocilo)
        break
      case 'NAJVECNJA_VREDNOST':
        if (Number.isFinite(n) && n > pravilo.vrednost) napake.push(pravilo.sporocilo)
        break
      case 'MOZNOSTI':
        if (typeof v !== 'string' || !pravilo.vrednost.includes(v)) napake.push(pravilo.sporocilo)
        break
    }
  }
  return napake
}

/** §6: ali korak dovoljuje izjemo (NI_PRIMERNO/BLOKIRANO) — vsi koraki jo
 * dovoljujejo, vendar SAMO z razlogom (strežnik vsili niz ≠ prazen). */
export const IZJEME_DOVOLJENE = true

// ─── Vgrajene definicije (v1) — vir za seed strežniškega jedra ──────────────
// §4 PLAYBOOKI PO SCENARIJIH. Vsak korak: navodilo/kje/rezultat (§3),
// dokazila (§10), offline (§13), validacija, pogoji (§5).

const POCETNA_POMOC = { gate: 'nalog.write' }

export const PLAYBOOK_OGRAJA: PlaybookDefinition = {
  key: 'OGRAJA',
  naziv: 'Ograja — izmera po vodnem postopku',
  opis: 'Voden postopek izmere ograje: prihod → pregled → foto → referenca → segmenti → višine → stebri → pritrditev → preverjanje → potrditev → konfigurator.',
  scenarij: 'Terenska izmera ograje/balustrade z zaključnim prehodom v konfigurator.',
  version: 1,
  steps: [
    {
      id: 'prihod', naziv: 'Prihod na lokacijo', kategorija: 'PRIHOD', offline: true,
      navodilo: 'Pridi na lokacijo objekta in potrdi prihod. Preveri naslov in dostop do terena.',
      kje: 'Stojimo pred objektom, z dovidom na celotno ograjo.',
      rezultat: 'Zabeležen prihod s časom in lokacijo (dogodek ZACETEK na nalogu).',
      evidence: [{ vrsta: 'LOKACIJA', obvezno: true, opis: 'GPS ali naslov objekta' }],
    },
    {
      id: 'pregled', naziv: 'Pregled objekta', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Obhodi objekt in zapiši opažanja: stanje terena, ovire, posebnosti (stopnišče, kosi, naklon).',
      kje: 'Vzdolž celotne linije ograje.',
      rezultat: 'Zapisana opomba z opažanji za pisarno.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'opažanja s terena' }],
    },
    {
      id: 'foto-objekt', naziv: 'Posnemi celoten objekt', kategorija: 'FOTO', offline: true,
      navodilo: 'Posnemi fotografijo CELOTEGA objekta (§7 korak 1) — naj bo vidna vsa ograja.',
      kje: 'Kamera pokriva celoten objekt od zunaj, pravokotno na ograjo.',
      rezultat: 'Fotografija celotnega objekta povezana na nalog.',
      evidence: [{ vrsta: 'FOTO', obvezno: true, opis: 'fotografija celote' }],
    },
    {
      id: 'foto-kakovost', naziv: 'Preveri kakovost zajema', kategorija: 'KONTROLA', offline: true,
      navodilo: 'Preveri ostrost, svetlobo in pokritost fotografije (§7 korak 2). Slabo sliko PONOVI.',
      kje: 'Poglej zajeto fotografijo na zaslonu.',
      rezultat: 'Potrjena kakovost zajema pred nadaljevanjem.',
      checklist: ['Ostrost v redu', 'Svetlost v redu', 'Celi objekt v kadru'],
      evidence: [{ vrsta: 'CHECKLIST', obvezno: true, opis: 'kontrola kakovosti' }],
    },
    {
      id: 'foto-levi', naziv: 'Posnemi levi konec', kategorija: 'FOTO', offline: true,
      navodilo: 'Posnemi podroben posnetek LEVEGA koncev ograje z vidnim pritrditvenim mestom (§7 korak 3).',
      kje: 'Kamera blizu levega koncev, vzporedno z ograjo.',
      rezultat: 'Fotografija levega koncev povezana na nalog.',
      evidence: [{ vrsta: 'FOTO', obvezno: true, opis: 'levi konec' }],
    },
    {
      id: 'foto-desni', naziv: 'Posnemi desni konec', kategorija: 'FOTO', offline: true,
      navodilo: 'Posnemi podroben posnetek DESNEGA koncev ograje z vidnim pritrditvenim mestom (§7 korak 4).',
      kje: 'Kamera blizu desnega koncev, vzporedno z ograjo.',
      rezultat: 'Fotografija desnega koncev povezana na nalog.',
      evidence: [{ vrsta: 'FOTO', obvezno: true, opis: 'desni konec' }],
    },
    {
      id: 'referenca', naziv: 'Postavi referenco', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Postavi referenčni objekt znane dolžine (merilni trak, vrata, ploščica) v ravnini ograje in ga zapiši (§7 korak 5).',
      kje: 'Referenca v isti ravnini kot izmera — vidna na fotografiji.',
      rezultat: 'Zabeležen referenčni objekt in njegova dolžina v cm.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'referenčni objekt + dolžina' }],
      validacija: [{ vrsta: 'MIN_VREDNOST', polje: 'referencaCm', vrednost: 20, sporocilo: 'Referenca naj bo vsaj 20 cm dolga.' }],
    },
    {
      id: 'je-stopnisce', naziv: 'Je stopnišče?', kategorija: 'ODLOCITEV', offline: true,
      navodilo: 'Ali ograja poteka po stopnišču (§5 pogojna veja)?',
      kje: '—',
      rezultat: 'Odločitev: DA pomeni korak izmere stopnišča, NE ga izpusti iz verige.',
      evidence: [{ vrsta: 'ODGOVOR', obvezno: true, opis: 'DA/NE' }],
    },
    {
      id: 'stopnisce', naziv: 'Izmeri stopnišče', kategorija: 'MERITEV', offline: true, pogoj: { polje: 'je-stopnisce', vrednost: true },
      navodilo: 'Izmeri stopnišče: število stopnic, vzpon in čežnost (nagib).',
      kje: 'Merilni trak vzdolž stopnic, od roba do roba.',
      rezultat: 'Veljavna meritev stopnišča z vsaj 2 stopnicama.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'meritev stopnišča' }],
      validacija: [{ vrsta: 'MIN_VREDNOST', polje: 'steviloStopnic', vrednost: 2, sporocilo: 'Stopnišče ima vsaj 2 stopnici.' }],
    },
    {
      id: 'segmenti', naziv: 'Izmeri prvi segment', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri dolžino prvega segmenta med stebri (§7 korak 6). Nadaljuj z ostalimi segmenti v isti merilni seji.',
      kje: 'Točka na sredini prvega stebra → točka na sredini naslednjega stebra.',
      rezultat: 'Meritev z vsaj 1 segmentom; vsak segment ≥ 20 cm.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'segmenti ograje' }],
      validacija: [{ vrsta: 'MIN_STEVILO', polje: 'segmentov', vrednost: 1, sporocilo: 'Zabeležen vsaj 1 segment.' }],
    },
    {
      id: 'visine', naziv: 'Višine ograje', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri višino ograje na več mestih (začetek, sredina, konec) — preveri enakomernost.',
      kje: 'Merilni trak navpično od tal do vrha ročnika.',
      rezultat: 'Višine zapisane; višina ≥ 40 cm.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'višine' }],
      validacija: [{ vrsta: 'MIN_VREDNOST', polje: 'visinaCm', vrednost: 40, sporocilo: 'Višina ograje je vsaj 40 cm.' }],
    },
    {
      id: 'je-kot', naziv: 'Je kot?', kategorija: 'ODLOCITEV', offline: true,
      navodilo: 'Ali ograja ima kote (lomene točke pod kotom ≠ 180°)?',
      kje: '—',
      rezultat: 'Odločitev: DA doda korak izmere kotov.',
      evidence: [{ vrsta: 'ODGOVOR', obvezno: true, opis: 'DA/NE' }],
    },
    {
      id: 'koti', naziv: 'Izmeri kote', kategorija: 'MERITEV', offline: true, pogoj: { polje: 'je-kot', vrednost: true },
      navodilo: 'Izmeri kote na lomnih točkah (koten kos / poligon).',
      kje: 'Kotomer na lomni točki, med sosednjima segmentoma.',
      rezultat: 'Koti zapisani v merilni seji.',
      evidence: [{ vrsta: 'MERITEV', obvezno: false, opis: 'koti' }],
    },
    {
      id: 'stebri', naziv: 'Stebri in razmaki', kategorija: 'MERITEV', offline: true,
      navodilo: 'Preveri položaje stebrov in razmake med njimi.',
      kje: 'Vzdolž linije ograje — označene točke stebrov.',
      rezultat: 'Število stebrov in razmaki zapisani.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'stebri' }],
      validacija: [{ vrsta: 'MIN_STEVILO', polje: 'stebrov', vrednost: 2, sporocilo: 'Ograja ima vsaj 2 stebra.' }],
    },
    {
      id: 'pritrditev-odlocba', naziv: 'Je pritrditev čelna?', kategorija: 'ODLOCITEV', offline: true,
      navodilo: 'Je pritrditev ograje ČELNA (na čelo tal/baze) ali BOČNA (na stran)?',
      kje: '—',
      rezultat: 'Odločitev določa tehniko izmere pritrditve.',
      moznosti: ['CELNA', 'BOCNA'],
      evidence: [{ vrsta: 'ODGOVOR', obvezno: true, opis: 'CELNA/BOCNA' }],
    },
    {
      id: 'pritrditev', naziv: 'Izmeri pritrditev', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri pritrditvena mesta glede na odločitev (čelna/bočna).',
      kje: 'Merilni trak od roba pritrditvene površine do osi ograje.',
      rezultat: 'Pritrditev izmerjena in zapisana.',
      namigOdgovorov: {
        CELNA: 'ČELNA: izmeri odmik od čela tal do osi stebra.',
        BOCNA: 'BOČNA: izmeri odmik od stene/baze do ravnine ograje.',
      },
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'pritrditev' }],
    },
    {
      id: 'preverjanje', naziv: 'Preveri rezultate', kategorija: 'KONTROLA', offline: true,
      navodilo: 'Preveri izmere pred potrditvijo (§7 korak 7): segmenti, višine, pritrditev, referenca.',
      kje: 'Pregled vseh zajetih mer na zaslonu.',
      rezultat: 'Vse kontrole odkljukane — izmera pripravljena na potrditev.',
      checklist: ['Vsi segmenti izmerjeni', 'Višine usklajene', 'Pritrditev izmerjena', 'Referenca zabeležena'],
      evidence: [{ vrsta: 'CHECKLIST', obvezno: true, opis: 'preverjanje izmere' }],
    },
    {
      id: 'potrditev', naziv: 'Potrdi izmero', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Potrdi izmero (§7 korak 8) — poveži jo s potrjeno merilno verzijo (§10).',
      kje: '—',
      rezultat: 'Meritev potrjena (MeasurementVersion) → prehod v KONFIGURATOR (§11).',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'potrjena meritev (id ali vrednosti)' }],
      handoff: { do: 'KONFIGURATOR', opis: 'Izmera zaključena — odpri konfigurator za izdelavo ponudbe.' },
    },
  ],
}

export const PLAYBOOK_KERAMIKA: PlaybookDefinition = {
  key: 'KERAMIKA',
  naziv: 'Keramika — izmera in takeoff',
  opis: 'Prostor → obod → odprtine → stopnice → višine → ploščica → vzorec → fuge → rezi → odpad → takeoff → BOM → ponudba.',
  scenarij: 'Polaganje keramike: izmera prostora, izbira ploščice in izračun materiala.',
  version: 1,
  steps: [
    {
      id: 'prostor', naziv: 'Premeri prostor', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri tloris prostora (dolžina × širina) ali zajemi obod s točkami.',
      kje: 'Merilni trak ob stenah prostora.',
      rezultat: 'Površina prostora zapisana (vsaj 1 m²).',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'tloris prostora' }],
      validacija: [{ vrsta: 'MIN_VREDNOST', polje: 'povrsinaM2', vrednost: 1, sporocilo: 'Površina prostora je vsaj 1 m².' }],
    },
    {
      id: 'obod', naziv: 'Izmeri obod', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri obod prostora po stenah (za podnožja in rezi).',
      kje: 'Merilni trak vzdolž vseh sten.',
      rezultat: 'Dolžina oboda v cm zapisana.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'obod' }],
      validacija: [{ vrsta: 'MIN_VREDNOST', polje: 'obodCm', vrednost: 100, sporocilo: 'Obod je vsaj 100 cm.' }],
    },
    {
      id: 'odprtine', naziv: 'Odprtine', kategorija: 'MERITEV', offline: true,
      navodilo: 'Zapiši odprtine (vrata, niše, stebri) — odštejejo se od površine.',
      kje: 'Vsaka odprtina v tlorisu.',
      rezultat: 'Seznam odprtin z dimenzijami.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'odprtine' }],
    },
    {
      id: 'je-stopnisce', naziv: 'Je stopnišče?', kategorija: 'ODLOCITEV', offline: true,
      navodilo: 'Ali v prostoru je stopnišče, ki se obloži s keramiko?',
      kje: '—',
      rezultat: 'Odločitev o koraku stopnic.',
      evidence: [{ vrsta: 'ODGOVOR', obvezno: true, opis: 'DA/NE' }],
    },
    {
      id: 'stopnisce', naziv: 'Izmeri stopnice', kategorija: 'MERITEV', offline: true, pogoj: { polje: 'je-stopnisce', vrednost: true },
      navodilo: 'Izmeri stopnice: število, vzpon, čežnost in širina.',
      kje: 'Merilni trak vzdolž in čez stopnice.',
      rezultat: 'Meritev stopnišča zapisana.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'stopnice' }],
    },
    {
      id: 'visine', naziv: 'Višine prostora', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri višino prostora (za oblogo sten, če je v obsegu).',
      kje: 'Merilni trak od tal do stropa.',
      rezultat: 'Višina zapisana.',
      evidence: [{ vrsta: 'MERITEV', obvezno: false, opis: 'višina prostora' }],
    },
    {
      id: 'ploscica', naziv: 'Izberi ploščico', kategorija: 'MERITEV', offline: true,
      navodilo: 'Zapiši izbrano ploščico: širina, višina (cm) in proizvajalca.',
      kje: '—',
      rezultat: 'Dimenzije ploščice zapisane (vsaj 5×5 cm).',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'dimenzije ploščice' }],
      validacija: [
        { vrsta: 'MIN_VREDNOST', polje: 'sirinaPlosciceCm', vrednost: 5, sporocilo: 'Širina ploščice je vsaj 5 cm.' },
        { vrsta: 'MIN_VREDNOST', polje: 'visinaPlosciceCm', vrednost: 5, sporocilo: 'Višina ploščice je vsaj 5 cm.' },
      ],
    },
    {
      id: 'vzorec', naziv: 'Vzorec polaganja', kategorija: 'ODLOCITEV', offline: true,
      navodilo: 'Izberi vzorec polaganja: PRAVOKOTNO ali DIAGONALNO.',
      kje: '—',
      rezultat: 'Vzorec določen za razporeditev in reze.',
      moznosti: ['PRAVOKOTNO', 'DIAGONALNO'],
      evidence: [{ vrsta: 'ODGOVOR', obvezno: true, opis: 'vzorec' }],
    },
    {
      id: 'fuge', naziv: 'Fuge', kategorija: 'MERITEV', offline: true,
      navodilo: 'Določi širino fuge (mm) in barvo.',
      kje: '—',
      rezultat: 'Širina fuge med 0 in 30 mm.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'fuga' }],
      validacija: [{ vrsta: 'MIN_VREDNOST', polje: 'fugaMm', vrednost: 0, sporocilo: 'Širina fuge je med 0 in 30 mm.' }],
    },
    {
      id: 'rezi', naziv: 'Rezi', kategorija: 'KONTROLA', offline: true,
      navodilo: 'Oceni reze ob robnih površinah (količina, zahtevnost).',
      kje: 'Vzdolž robov in v vogalih.',
      rezultat: 'Ocena rezov zapisana.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'ocena rezov' }],
    },
    {
      id: 'odpad', naziv: 'Oceni odpad', kategorija: 'KONTROLA', offline: true,
      navodilo: 'Oceni odpad glede na vzorec (diagonalno več) in odprtine.',
      kje: '—',
      rezultat: 'Odpad v % zapisan.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'ocena odpada' }],
    },
    {
      id: 'takeoff', naziv: 'Takeoff — količine', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Izračunaj količine: ploščice (m² + kos), lepila, fuge, podnožja.',
      kje: '—',
      rezultat: 'Količine za BOM pripravljene.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'povzetek količin' }],
    },
    {
      id: 'bom', naziv: 'BOM pregled', kategorija: 'AKCIJA', offline: false,
      navodilo: 'Preglej kosovnico (BOM) iz takeoff-a in jo potrdi.',
      kje: '—',
      rezultat: 'BOM pregledan → prehod v pripravo ponudbe.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'potrditev BOM' }],
      handoff: { do: 'BOM', opis: 'Takeoff zaključen — odpri kosovnico za naročilo materiala.' },
    },
    {
      id: 'ponudba', naziv: 'Pripravi ponudbo', kategorija: 'AKCIJA', offline: false,
      navodilo: 'Pripravi ponudbo stranki iz izmere in količin.',
      kje: '—',
      rezultat: 'Osnutek ponudbe pripravljen.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'opomba k ponudbi' }],
      handoff: { do: 'PONUDBA', opis: 'Odpir ponudbe za zaključek posla.' },
    },
  ],
}

export const PLAYBOOK_STREHA: PlaybookDefinition = {
  key: 'STREHA',
  naziv: 'Streha — izmera in takeoff',
  opis: 'Lokacija → aerial/remote podatki → foto → ploskve → pitch → slemen/robovi/doline → odprtine/obrobe → ročna kontrola → potrditev → takeoff.',
  scenarij: 'Prenova/kritje strehe: izmera ploskev in izračun kritine.',
  version: 1,
  steps: [
    {
      id: 'lokacija', naziv: 'Lokacija objekta', kategorija: 'PRIHOD', offline: true,
      navodilo: 'Potrdi lokacijo objekta in varnost pristopa (višina, dostop).',
      kje: 'Pred objektom, z dovidom na streho.',
      rezultat: 'Lokacija zabeležena.',
      evidence: [{ vrsta: 'LOKACIJA', obvezno: true, opis: 'lokacija objekta' }],
    },
    {
      id: 'aerial', naziv: 'Aerial/remote podatki', kategorija: 'KONTROLA', offline: true,
      navodilo: 'Preveri obstoječe aerofoto/ortofoto podatke. Če niso dovolj kakovostni, označi in nadaljuj s foto zajemom.',
      kje: '—',
      rezultat: 'Odločitev o uporabi remote podatkov zapisana.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'ocena remote podatkov' }],
    },
    {
      id: 'foto', naziv: 'Foto zajem strehe', kategorija: 'FOTO', offline: true,
      navodilo: 'Posnemi vse ploskve strehe iz več zornih kotov (po možnosti z drona ali višje točke).',
      kje: 'Kamera proti strehi iz vsaj 4 strani.',
      rezultat: 'Fotografije ploskev povezane na nalog.',
      evidence: [{ vrsta: 'FOTO', obvezno: true, opis: 'foto strehe' }],
    },
    {
      id: 'ploskve', naziv: 'Izmeri ploskve', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri tlorisne dimenzije ploskev strehe.',
      kje: 'Točke vogalov strehe (foto/AR/točke).',
      rezultat: 'Ploskve izmerjene (vsaj 1 m²).',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'ploskve strehe' }],
      validacija: [{ vrsta: 'MIN_VREDNOST', polje: 'povrsinaM2', vrednost: 1, sporocilo: 'Površina strehe je vsaj 1 m².' }],
    },
    {
      id: 'pitch', naziv: 'Naklon (pitch)', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri naklon strehe (0–84°).',
      kje: 'Kotomer/nivo na ploskvi strehe.',
      rezultat: 'Naklon zapisan.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'naklon' }],
    },
    {
      id: 'slemen', naziv: 'Slemen, robovi, doline', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri dolžine slemena, robov in dolin.',
      kje: 'Vzdolž slemena in robov strehe.',
      rezultat: 'Dolžine obrob zapisane.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'obrobe' }],
    },
    {
      id: 'odprtine', naziv: 'Odprtine in obrobe', kategorija: 'MERITEV', offline: true,
      navodilo: 'Zapiši odprtine (dimniki, okna) in obrobe.',
      kje: 'Vsaka odprtina na strehi.',
      rezultat: 'Seznam odprtin z dimenzijami.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'odprtine na strehi' }],
    },
    {
      id: 'kontrola', naziv: 'Ročna kontrola', kategorija: 'KONTROLA', offline: true,
      navodilo: 'Ročno preveri izmere proti fotografijam (§4 ročna kontrola).',
      kje: 'Pregled vseh mer na zaslonu.',
      rezultat: 'Kontrole odkljukane.',
      checklist: ['Ploskve usklajene', 'Nakloni usklajeni', 'Odprtine zapisane'],
      evidence: [{ vrsta: 'CHECKLIST', obvezno: true, opis: 'ročna kontrola' }],
    },
    {
      id: 'potrditev', naziv: 'Potrdi izmero', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Potrdi izmero strehe s povezano merilno verzijo.',
      kje: '—',
      rezultat: 'Meritev potrjena → prehod v takeoff.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'potrjena meritev' }],
    },
    {
      id: 'takeoff', naziv: 'Takeoff kritine', kategorija: 'AKCIJA', offline: false,
      navodilo: 'Izračunaj količine kritine (material, odpad po tipu).',
      kje: '—',
      rezultat: 'Takeoff pripravljen → BOM.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'takeoff povzetek' }],
      handoff: { do: 'BOM', opis: 'Izmera strehe zaključena — odpri kosovnico.' },
    },
  ],
}

export const PLAYBOOK_FASADA: PlaybookDefinition = {
  key: 'FASADA',
  naziv: 'Hiša/fasada — izmera',
  opis: 'Objekt → stranice → vogali → odprtine → višine → material → preverjanje → potrditev.',
  scenarij: 'Obloga fasade: izmera stranice in priprava materiala.',
  version: 1,
  steps: [
    {
      id: 'objekt', naziv: 'Pregled objekta', kategorija: 'PRIHOD', offline: true,
      navodilo: 'Preglej objekt z vseh strani in zapiši stanje podlage.',
      kje: 'Okolica objekta.',
      rezultat: 'Lokacija in opažanja zapisana.',
      evidence: [{ vrsta: 'LOKACIJA', obvezno: true, opis: 'lokacija' }, { vrsta: 'OPOMBA', obvezno: true, opis: 'stanje podlage' }],
    },
    {
      id: 'stranice', naziv: 'Izmeri stranice', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri vse stranice objekta (širina, višina).',
      kje: 'Merilni tram/laser ob vsaki stranici.',
      rezultat: 'Stranice zapisane.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'stranice' }],
    },
    {
      id: 'vogali', naziv: 'Vogali', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri vogale objekta (notranji/zunanji).',
      kje: 'Kotomer v vsakem vogalu.',
      rezultat: 'Koti zapisani.',
      evidence: [{ vrsta: 'MERITEV', obvezno: false, opis: 'vogali' }],
    },
    {
      id: 'odprtine', naziv: 'Odprtine', kategorija: 'MERITEV', offline: true,
      navodilo: 'Zapiši odprtine (okna, vrata) z dimenzijami.',
      kje: 'Vsaka odprtina na fasadi.',
      rezultat: 'Seznam odprtin.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'odprtine' }],
    },
    {
      id: 'visine', naziv: 'Višine', kategorija: 'MERITEV', offline: true,
      navodilo: 'Izmeri višine (etaže, venčni zid, socla).',
      kje: 'Merilni tram navpično ob fasadi.',
      rezultat: 'Višine zapisane.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'višine' }],
    },
    {
      id: 'material', naziv: 'Material obloge', kategorija: 'ODLOCITEV', offline: true,
      navodilo: 'Izberi material obloge za ponudbo.',
      kje: '—',
      rezultat: 'Material določen.',
      moznosti: ['KLINKER', 'TERAKOTA', 'KOMPAKT', 'DRUGO'],
      evidence: [{ vrsta: 'ODGOVOR', obvezno: true, opis: 'material' }],
    },
    {
      id: 'preverjanje', naziv: 'Preverjanje', kategorija: 'KONTROLA', offline: true,
      navodilo: 'Preveri vse izmere fasade.',
      kje: 'Pregled mer na zaslonu.',
      rezultat: 'Kontrole odkljukane.',
      checklist: ['Stranice izmerjene', 'Odprtine zapisane', 'Višine usklajene'],
      evidence: [{ vrsta: 'CHECKLIST', obvezno: true, opis: 'preverjanje' }],
    },
    {
      id: 'potrditev', naziv: 'Potrditev izmere', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Potrdi izmero s povezano merilno verzijo.',
      kje: '—',
      rezultat: 'Meritev potrjena → konfigurator.',
      evidence: [{ vrsta: 'MERITEV', obvezno: true, opis: 'potrjena meritev' }],
      handoff: { do: 'KONFIGURATOR', opis: 'Izmera fasade zaključena — odpri konfigurator.' },
    },
  ],
}

export const PLAYBOOK_MONTAZA: PlaybookDefinition = {
  key: 'MONTAZA',
  naziv: 'Montaža — vodena izvedba',
  opis: 'Prihod → pregled naloga → foto pred → varnost → material → montaža → kontrola → foto po → poraba → podpis → predaja (§10: vsa dokazila).',
  scenarij: 'Namestitev ograje/keramike/fasade po nalogu pisarne.',
  version: 1,
  steps: [
    {
      id: 'prihod', naziv: 'Prihod na lokacijo', kategorija: 'PRIHOD', offline: true,
      navodilo: 'Pridi na lokacijo in potrdi prihod (dogodek ZACETEK).',
      kje: 'Pred objektom.',
      rezultat: 'Prihod zabeležen s časom in lokacijo.',
      evidence: [{ vrsta: 'LOKACIJA', obvezno: true, opis: 'lokacija' }],
    },
    {
      id: 'pregled-naloga', naziv: 'Pregled naloga', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Preberi navodila pisarne in potrdi, da razumeš obseg del.',
      kje: '—',
      rezultat: 'Navodila prebrana in potrjena.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'potrditev razumevanja naloga' }],
    },
    {
      id: 'foto-pred', naziv: 'Fotografija pred', kategorija: 'FOTO', offline: true,
      navodilo: 'Posnemi stanje PRED začetkom del (§10 before/after).',
      kje: 'Vsa montažna mesta.',
      rezultat: 'Fotografija stanja pred delom.',
      evidence: [{ vrsta: 'FOTO', obvezno: true, opis: 'foto pred' }],
    },
    {
      id: 'varnost', naziv: 'Varnost', kategorija: 'KONTROLA', offline: true,
      navodilo: 'Odkljukaj varnostne točke pred delom.',
      kje: '—',
      rezultat: 'Varnostne kontrole odkljukane.',
      checklist: ['Zaščitna oprema', 'Delovno mesto zavarovano', 'Orođje pregledano'],
      evidence: [{ vrsta: 'CHECKLIST', obvezno: true, opis: 'varnost' }],
    },
    {
      id: 'material', naziv: 'Material na lokaciji', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Preveri dobavljen material proti nalogu in zapiši morebitne pomankljivosti.',
      kje: 'Skladišče/mesto dostave.',
      rezultat: 'Material preverjen.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'preverba materiala' }],
    },
    {
      id: 'montaza', naziv: 'Montaža', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Izvedi montažo po tehničnih navodilih. Zapiši posebnosti med delom.',
      kje: 'Vzdolž mesta montaže.',
      rezultat: 'Montaža izvedena, zapisi dodani.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'zapis montaže' }],
    },
    {
      id: 'kontrola', naziv: 'Kontrola kvalitete', kategorija: 'KONTROLA', offline: true,
      navodilo: 'Preveri kakovost montaže (vodenje, pritrditev, videz).',
      kje: 'Vsa montažna mesta.',
      rezultat: 'Kontrole odkljukane.',
      checklist: ['Vodenje in višine pravilni', 'Pritrditve trdne', 'Videz brez napak'],
      evidence: [{ vrsta: 'CHECKLIST', obvezno: true, opis: 'kontrola kvalitete' }],
    },
    {
      id: 'foto-po', naziv: 'Fotografija po', kategorija: 'FOTO', offline: true,
      navodilo: 'Posnemi stanje PO zaključku del (§10 before/after).',
      kje: 'Vsa montažna mesta.',
      rezultat: 'Fotografija stanja po delu.',
      evidence: [{ vrsta: 'FOTO', obvezno: true, opis: 'foto po' }],
    },
    {
      id: 'poraba', naziv: 'Poraba materiala', kategorija: 'AKCIJA', offline: true,
      navodilo: 'Zapiši porabljeni material (kosi, dolžine) za zalogo (§10).',
      kje: '—',
      rezultat: 'Poraba zapisana.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'poraba materiala' }],
    },
    {
      id: 'podpis', naziv: 'Podpis stranke', kategorija: 'PREDAJA', offline: true,
      navodilo: 'Zajemi podpis stranke o prevzemu dela (§10).',
      kje: 'Predaj stranki napravo za podpis.',
      rezultat: 'Podpis zajet in povezan.',
      evidence: [{ vrsta: 'PODPIS', obvezno: true, opis: 'podpis stranke' }],
    },
    {
      id: 'predaja', naziv: 'Predaja', kategorija: 'PREDAJA', offline: true,
      navodilo: 'Predaj delo stranki in zaključi teren (nalog → ZAKLJUCEN).',
      kje: '—',
      rezultat: 'Nalog zaključen, delo predano.',
      evidence: [{ vrsta: 'OPOMBA', obvezno: true, opis: 'potrditev predaje' }],
      handoff: { do: 'NALOG_ZAKLJUCEK', opis: 'Postopek zaključen — zaključi nalog v Danes.' },
    },
  ],
}

/** Vse vgrajene definicije (v1) — vir seed-a v playbook-engine (strežnik). */
export const VGRADNJENI_PLAYBOOKI: PlaybookDefinition[] = [
  PLAYBOOK_OGRAJA, PLAYBOOK_KERAMIKA, PLAYBOOK_STREHA, PLAYBOOK_FASADA, PLAYBOOK_MONTAZA,
]

/** Privzeti playbook za tip meritve/projekta (§2 pravila izbire). */
export function playbookZaKljuc (key: string): PlaybookDefinition | undefined {
  return VGRADNJENI_PLAYBOOKI.find((p) => p.key === key)
}

/** Serializacija definicije v JSON za PlaybookDef.definition (baza). */
export function serializiraj (def: PlaybookDefinition): string {
  return JSON.stringify({
    key: def.key, naziv: def.naziv, opis: def.opis, scenarij: def.scenarij,
    version: def.version, steps: def.steps,
  })
}

/** Deserializacija iz PlaybookDef.definition (neveljaven JSON → null). */
export function deserializiraj (json: string): PlaybookDefinition | null {
  try {
    const raw = JSON.parse(json) as PlaybookDefinition
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps) || !raw.key) return null
    return raw
  } catch {
    return null
  }
}

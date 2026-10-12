// smart-guide-registry — R490 (GitHub issue #11): ROKSAL SMART GUIDE
// EN vir vsebin pomoči — podatkovno vodena struktura navodil po modulih.
// Čist client-safe lib (NIČ strežniških uvozov, NIČ 'use client') — uporabijo
// ga SmartGuide komponenta (odjemalec) in /api/guide (strežniška validacija).
//
// Struktura (issue #11 §5): stabilen ID, modul (tabId iz nav-registry), naslov,
// besedilo SL/HR (tuple [sl, hr]), koraki, pričakovani rezultat, pogoste napake,
// skica (SKETCH_KEYS) + alt, glasovni skript SL/HR, različica.
//
// NAČELA:
//  - BREZ AI-modelov in plačljivih storitev (glas = Web Speech API v UI).
//  - Skice so lastne, shematske, uporabljajo aplikacijske barve (roksal-amber).
//  - Vsaka skica ima vidno oznako »Shematski prikaz — ni merilo« (guide-sketches).
//  - Besedila se navezujejo na DEJANSKE UI oznake (gumbi/rute) — brez izmišljenih.

import { ALL_TABS } from './nav-registry'

export type GuideLang = 'sl' | 'hr'

/** Dvojezični par — [slovenščina, hrvatščina] */
export type Bi = readonly [string, string]

/** Veljavni ključi skic (render v guide-sketches.tsx; validacija prek /api/guide) */
export const SKETCH_KEYS = [
  'danes', 'zajem', 'meritev', 'ogradnja', 'teren', 'konfigurator',
  'bom', 'nalog', 'projekt', 'stopnica', 'foto'
] as const
export type SketchKey = typeof SKETCH_KEYS[number]

export interface GuideEntry {
  /** Stabilen ID — npr. 'zajem.osnove' (testi in reference se vežejo nanj) */
  id: string
  /** Modul — tabId iz nav-registry (viri konteksta gumba Pomoč) */
  tabId: string
  title: Bi
  desc: Bi
  /** Kratek, operativen korak (≥2) */
  steps: readonly Bi[]
  /** Pričakovani rezultat po opravljenih korakih */
  expected: Bi
  /** Pogoste napake (≥1) */
  mistakes: readonly Bi[]
  /** Skica (Pokaži primer) — null = modul brez lastne skice (samo besedilo) */
  sketchKey: SketchKey | null
  /** Alt-opis skice za bralnike zaslona (obvezen, če je sketchKey) */
  sketchAlt: Bi | null
  /** Glasovni skript — kratek, operativen, varen (ne trdi potrjene mere) */
  voice: Bi
  /** Verzija vsebine (povečaj ob spremembi besedila) */
  version: number
  /** Vodena prva uporaba: monterju se ob prvem obisku modula plošča samodejno odpre (preskok možen) */
  firstUse: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// VSEBINE — prednostni moduli (issue #11 §4) imajo polne korake + skico;
// preostali moduli imajo strnjene korake (razširjeno po reviziji R490).
// ─────────────────────────────────────────────────────────────────────────────

export const GUIDE: readonly GuideEntry[] = [
  {
    id: 'danes.osnove', tabId: 'danes', version: 1, firstUse: true,
    title: ['Danes — operativni pregled', 'Danas — operativni pregled'],
    desc: ['Kaj vidite na zaslonu Danes in kako začnete terensko delo.', 'Što vidite na zaslonu Danas i kako započinjete terenski rad.'],
    steps: [
      ['Preglej naloge za danes — status V teku pomeni aktivno delo.', 'Pregledajte naloge za danas — status U tijeku znači aktivan rad.'],
      ['Dotakni nalog za podrobnosti: navodila, meritve, fotografije.', 'Dodirnite nalog za detalje: uputstva, mjerenja, fotografije.'],
      ['Iz naloga začni zajem ali meritve (gumb Začni delo).', 'Iz naloga započnite snimanje ili mjerenja (gumb Začni rad).'],
      ['Ob koncu izpolni kontrolne točke in zaključi nalog.', 'Na kraju ispunite kontrolne točke i završite nalog.']
    ],
    expected: ['Nalog ima fotografije pred/med/po, izpolnjene kontrole in zaključen status.', 'Nalog ima fotografije prije/tijekom/poslije, ispunjene kontrole i završen status.'],
    mistakes: [
      ['Delo se začne brez pričetka statusa na nalogu.', 'Rad se započinje bez promjene statusa na nalogu.'],
      ['Zaključek brez izpolnjenega kontrolnega seznama.', 'Završetak bez ispunjenog kontrolnog popisa.']
    ],
    sketchKey: 'danes',
    sketchAlt: ['Shema dnevnega toka: nalog → zajem/meritve → kontrole → zaključek.', 'Shema dnevnog toka: nalog → snimanje/mjerenja → kontrole → završetak.'],
    voice: ['Preglej naloge za danes. Dotakni nalog za podrobnosti. Iz naloga začni zajem ali meritve. Ob koncu izpolni kontrole in zaključi nalog.', 'Pregledajte naloge za danas. Dodirnite nalog za detalje. Iz naloga započnite snimanje ili mjerenja. Na kraju ispunite kontrole i završite nalog.']
  },
  {
    id: 'zajem.osnove', tabId: 'zajem', version: 1, firstUse: true,
    title: ['Zajem s kamero — kako zajeti ograjo', 'Snimanje kamerom — kako snimiti ogradu'],
    desc: ['Kako počasi premikati telefon, pokriti vse strani in preprečiti zameglitev.', 'Kako polagano pomicati telefon, pokriti sve strane i spriječiti zamućenje.'],
    steps: [
      ['Postavi se 2 do 3 metre od ograje, da vidiš celoten segment.', 'Stanite 2 do 3 metra od ograde da vidite cijeli segment.'],
      ['Premikaj telefon počasi in enakomerno vzdolž ograje — brez naglih zasukov.', 'Pomičite telefon polagano i jednoliko uz ogradu — bez naglih okreta.'],
      ['Sledi vodilu na zaslonu in pokrij vse strani: levo, desno, zgoraj, spodaj.', 'Slijedite vodilje na zaslonu i pokrijte sve strane: lijevo, desno, gore, dolje.'],
      ['Izogibaj se svetlobi od zadaj in počisti objektiv pred začetkom.', 'Izbjegavajte svjetlost otpozadi i očistite objektiv prije početka.'],
      ['Zaključi zajem šele, ko pokritost kaže brez opozoril.', 'Završite snimanje tek kad pokrivenost pokazuje bez upozorenja.']
    ],
    expected: ['Zajem ima visoko pokritost segmentov brez opozoril o zameglitvi ali driftu.', 'Snimanje ima visoku pokrivenost segmenata bez upozorenja o zamućenju ili otklonu.'],
    mistakes: [
      ['Prehitro premikanje — sledenje postane nestabilno.', 'Prebrzo pomicanje — praćenje postaje nestabilno.'],
      ['Zajet je le del ograje — pokritost je pomanjkljiva.', 'Snimljen je samo dio ograde — pokrivenost je nepotpuna.'],
      ['Zaključek zajema kljub opozorilom o svetlobi.', 'Završetak snimanja unatoč upozorenjima o svjetlosti.']
    ],
    sketchKey: 'zajem',
    sketchAlt: ['Shema: telefon se premika vzdolž ograje, puščice kažejo smer in pokritost.', 'Shema: telefon se pomiče uz ogradu, strelice pokazuju smjer i pokrivenost.'],
    voice: ['Počasi obrni telefon proti celotni ograji. Počakaj, da se prikaz umiri. Premikaj se vzdolž ograje in pokrij vse strani. Pred zaključkom preveri pokritost.', 'Polagano okrenite telefon prema cijeloj ogradi. Pričekajte da se prikaz smiri. Pomičite se uz ogradu i pokrijte sve strane. Prije završetka provjerite pokrivenost.']
  },
  {
    id: 'meritve.osnove', tabId: 'meritve', version: 1, firstUse: true,
    title: ['Meritve — točke, višina, naklon', 'Mjerenja — točke, visina, nagib'],
    desc: ['Kako določiti začetno in končno točko, višino, širino in kot; razlika med izmerjeno, ročno vneseno in ocenjeno vrednostjo.', 'Kako odrediti početnu i završnu točku, visinu, širinu i kut; razlika između izmjerene, ručno unesene i procijenjene vrijednosti.'],
    steps: [
      ['Določi začetno točko ob tleh ob robu ograje (točka A).', 'Odredite početnu točku uz tlo na rubu ograde (točka A).'],
      ['Določi končno točko v smeri tekača (točka B).', 'Odredite završnu točku u smjeru mjerenja (točka B).'],
      ['Višino meri od podlage do zgornjega roba ročnika.', 'Visinu mjerite od podloge do gornjeg ruba rukohvata.'],
      ['Kot ali naklon vpiši v merilnem načinu — slika sama ni dovolj.', 'Kut ili nagib unesite u mjernom načinu — slika sama nije dovoljna.'],
      ['Loči izvor vrednosti: izmerjeno (kamera), ročno vneseno, ocenjeno.', 'Razlikujte izvor vrijednosti: izmjereno (kamera), ručno uneseno, procijenjeno.']
    ],
    expected: ['Meritev ima izmerjeno dolžino in višino; ročno vnesene vrednosti so vidno označene.', 'Mjerenje ima izmjerenu dužinu i visinu; ručno unesene vrijednosti su vidno označene.'],
    mistakes: [
      ['Zamenjava višine in vodoravne dolžine.', 'Zamjena visine i vodoravne dužine.'],
      ['Merjenje po ukrivljeni podlagi brez opombe.', 'Mjerenje po zakrivljenoj podlozi bez napomene.'],
      ['Ocena se uporabi, kot da bi bila izmerjena.', 'Procjena se koristi kao da je izmjerena.']
    ],
    sketchKey: 'meritev',
    sketchAlt: ['Shema: segment ograje z točkama A in B, puščici višine in dolžine.', 'Shema: segment ograde s točkama A i B, strelice visine i dužine.'],
    voice: ['Določi začetno točko ob tleh. Določi končno točko v smeri merjenja. Višino meri od podlage do ročnika. Preveri, ali je vrednost izmerjena ali ročno vnesena.', 'Odredite početnu točku uz tlo. Odredite završnu točku u smjeru mjerenja. Visinu mjerite od podloge do rukohvata. Provjerite je li vrijednost izmjerena ili ručno unesena.']
  },
  {
    id: 'ogradnja.osnove', tabId: 'ogradnja', version: 1, firstUse: true,
    title: ['Ogradnja — vodena izmera tekača', 'Ogradnja — vođeno mjerenje'],
    desc: ['Tok ZAČETEK → STEBER → SEGMENT → KONEC in preverjanje z zunanjim merilnikom.', 'Tok POČETAK → STUB → SEGMENT → KRAJ i provjera s vanjskim mjeriteljem.'],
    steps: [
      ['Začni točko ZAČETEK na tleh, kjer ograja pričenja.', 'Započnite točku POČETAK na tlu gdje ograda počinje.'],
      ['Vsak STEBER zabeleži posebej — tudi na vogalih in vratih.', 'Svaki STUB zabilježite posebno — također na kutovima i vratima.'],
      ['SEGMENT oceni med dvema stebroma; višino preveri ročno, če je kaj sumljivo.', 'SEGMENT procijenite između dva stupa; visinu provjerite ručno ako je nešto sumnjivo.'],
      ['Zaključi s točko KONEC in poženi preverjanje (VERIFIED).', 'Završite točkom KRAJ i pokrenite provjeru (VERIFIED).']
    ],
    expected: ['Tekač ima vse stebre in segmente; VERIFIED preverba je zelena.', 'Traka ima sve stubove i segmente; VERIFIED provjera je zelena.'],
    mistakes: [
      ['Vogal ni zabeležen kot steber — dolžina se izgubi.', 'Kut nije zabilježen kao stub — dužina se izgubi.'],
      ['KONEC brez preverjanja.', 'KRAJ bez provjere.']
    ],
    sketchKey: 'ogradnja',
    sketchAlt: ['Shema tekača: točke začetek, stebri, segmenti, konec po tlorisu.', 'Shema trake: točke početak, stubovi, segmenti, kraj po tlocrtu.'],
    voice: ['Začni točko na tleh kjer ograja pričenja. Vsak steber zabeleži posebej. Segment oceni med stebroma. Zaključi s končno točko in preveri.', 'Započnite točku na tlu gdje ograda počinje. Svaki stub zabilježite posebno. Segment procijenite između stubova. Završite završnom točkom i provjerite.']
  },
  {
    id: 'teren.osnove', tabId: 'teren', version: 1, firstUse: false,
    title: ['Teren — podlaga, naklon, ovire', 'Teren — podloga, nagib, prepreke'],
    desc: ['Ravna tla, stopnice, vogali, zid, balkon in spremembe višine; omejitve zaznave iz ene slike.', 'Ravno tlo, stube, kutovi, zid, balkon i promjene visine; ograničenja prepoznavanja iz jedne slike.'],
    steps: [
      ['Oceni podlago: ravna tla, naklon, stopnice ali vogal.', 'Ocijenite podlogu: ravno tlo, nagib, stube ili kut.'],
      ['Pri stopnicah izmeri višino in vodoravno dolžino posebej (modul Nagib).', 'Pri stubama izmjerite visinu i vodoravnu dužinu posebno (modul Nagib).'],
      ['Vogal zabeleži kot steber posebnega tipa v tekaču.', 'Kut zabilježite kao stub posebne vrste u traci.'],
      ['Ovire (kanali, kabli) zabeleži kot opombo na segmentu.', 'Prepreke (kanali, kablovi) zabilježite kao napomenu na segmentu.']
    ],
    expected: ['Podlaga in ovire so zabeležene na ustreznih segmentih tekača.', 'Podloga i prepreke su zabilježene na odgovarajućim segmentima trake.'],
    mistakes: [
      ['Zanašanje na eno samo sliko za višino na naklonu.', 'Oslanjanje na jednu sliku za visinu na nagibu.'],
      ['Vogal brez posebnega zapisa.', 'Kut bez posebnog zapisa.']
    ],
    sketchKey: 'teren',
    sketchAlt: ['Shema terena: naklon, stopnice, zid in ovira z oznakami.', 'Shema terena: nagib, stube, zid i prepreka s oznakama.'],
    voice: ['Oceni podlago: naklon, stopnice, vogal. Pri stopnicah izmeri višino in dolžino posebej. Ovire zabeleži kot opombo.', 'Ocijenite podlogu: nagib, stube, kut. Pri stubama izmjerite visinu i dužinu posebno. Prepreke zabilježite kao napomenu.']
  },
  {
    id: 'konfigurator.osnove', tabId: 'konfigurator', version: 1, firstUse: true,
    title: ['Konfigurator — od mere do ponudbe', 'Konfigurator — od mjerenja do ponude'],
    desc: ['Stebri, odseki, polnila, vrata in razmiki iz potrjene izmere; vpliv spremembe mere na kosovnico.', 'Stubovi, odsjeci, ispune, vrata i razmaci iz potvrđenog mjerenja; utjecaj promjene mjere na specifikaciju.'],
    steps: [
      ['Izberi družino izdelka, npr. terasna ograja.', 'Odaberite obitelj proizvoda, npr. terasna ograda.'],
      ['Prevzemi segmente iz POTRJENE izmere tekača (gumb Prevzemi iz izmere).', 'Preuzmite segmente iz POTVRĐENOG mjerenja trake (gumb Preuzmi iz mjerenja).'],
      ['Nastavi višino, razmik stebrov, polnilo in vrata po izbiri iz kataloga.', 'Postavite visinu, razmak stubova, ispunu i vrata po izboru iz kataloga.'],
      ['Pregledaj izračun: kosovnica in cena iz veljavnega cenika.', 'Pregledajte izračun: specifikacija i cijena iz važećeg cjenika.'],
      ['Shrani paket ali ponudbo — sprememba mere se prenaša v kosovnico.', 'Spremite paket ili ponudu — promjena mjere se prenosi u specifikaciju.']
    ],
    expected: ['Konfiguracija ima segmente iz izmere, kosovnico in ceno iz veljavnega cenika.', 'Konfiguracija ima segmente iz mjerenja, specifikaciju i cijenu iz važećeg cjenika.'],
    mistakes: [
      ['Uporaba osnutka namesto potrjene izmere.', 'Korištenje nacrta umjesto potvrđenog mjerenja.'],
      ['Pozabljen zaključek na vogalu (vogalni steber).', 'Zaboravljen završetak na kutu (kutni stub).'],
      ['Napačen RAL — barve ni v ceniku.', 'Pogrešan RAL — boja nije u cjeniku.']
    ],
    sketchKey: 'konfigurator',
    sketchAlt: ['Shema: stebri, segmenti, polnilo in vrata z razmikom.', 'Shema: stubovi, segmenti, ispuna i vrata s razmakom.'],
    voice: ['Izberi družino izdelka. Prevzemi segmente iz potrjene izmere. Nastavi višino in razmik stebrov. Pregledaj kosovnico in ceno pred shranjevanjem.', 'Odaberite obitelj proizvoda. Preuzmite segmente iz potvrđenog mjerenja. Postavite visinu i razmak stubova. Pregledajte specifikaciju i cijenu prije spremanja.']
  },
  {
    id: 'ponudbe.osnove', tabId: 'ponudbe', version: 1, firstUse: false,
    title: ['Ponudbe — od kod pridejo količine', 'Ponude — odakle dolaze količine'],
    desc: ['Povezava izmera → kosovnica → ponudba; kaj je še nepotrjeno in kako sprememba mere vpliva na ponudbo.', 'Veza mjerenje → specifikacija → ponuda; što još nije potvrđeno i kako promjena mjere utječe na ponudu.'],
    steps: [
      ['Pozicije ponudbe izhajajo iz POTRJENE kosovnice projekta.', 'Stavke ponude proizlaze iz POTVRĐENE specifikacije projekta.'],
      ['Nepotrjene vrednosti (ocena, osnutek) so vidno označene.', 'Nepotvrđene vrijednosti (procjena, nacrt) su vidno označene.'],
      ['Sprememba mere v konfiguratorju posodobi kosovnico in ponudbo po potrditvi.', 'Promjena mjere u konfiguratoru ažurira specifikaciju i ponudu po potvrdi.'],
      ['Verzije ponudbe primerjaj pred izvozom ali pošiljanjem.', 'Verzije ponude usporedite prije izvoza ili slanja.']
    ],
    expected: ['Ponudba se ujema s kosovnico; izvoz ima revizijsko sled.', 'Ponuda se podudara sa specifikacijom; izvoz ima revizijski trag.'],
    mistakes: [
      ['Izvoz ponudbe z nepotrjenimi pozicijami.', 'Izvoz ponude s nepotvrđenim stavkama.'],
      ['Stara verzija ponudbe po spremembi mere.', 'Stara verzija ponude nakon promjene mjere.']
    ],
    sketchKey: 'bom',
    sketchAlt: ['Shema toka: izmera → kosovnica → ponudba s puščicami.', 'Shema toka: mjerenje → specifikacija → ponuda sa strelicama.'],
    voice: ['Pozicije ponudbe izhajajo iz potrjene kosovnice. Nepotrjene vrednosti so označene. Pred izvozom primerjaj verzije ponudbe.', 'Stavke ponude proizlaze iz potvrđene specifikacije. Nepotvrđene vrijednosti su označene. Prije izvoza usporedite verzije ponude.']
  },
  {
    id: 'bom.osnove', tabId: 'material-v5', version: 1, firstUse: false,
    title: ['Kosovnice — kaj je potrjeno', 'Specifikacije — što je potvrđeno'],
    desc: ['Kosovnica po segmentih z viri; kaj pomeni potrjeno, osnutek in ocena.', 'Specifikacija po segmentima s izvorima; što znači potvrđeno, nacrt i procjena.'],
    steps: [
      ['Odpri kosovnico projekta in preglej vrstice po segmentih.', 'Otvorite specifikaciju projekta i pregledajte retke po segmentima.'],
      ['Preveri vir vsake vrstice: izmera, konfigurator ali ročni vnos.', 'Provjerite izvor svakog retka: mjerenje, konfigurator ili ručni unos.'],
      ['Potrdi kosovnico, preden se uporabi v ponudbi ali proizvodnji.', 'Potvrdite specifikaciju prije korištenja u ponudi ili proizvodnji.']
    ],
    expected: ['Kosovnica ima vidne vire po vrsticah in potrjen status.', 'Specifikacija ima vidljive izvore po retcima i potvrđen status.'],
    mistakes: [
      ['Proizvodnja iz nepotrjene kosovnice.', 'Proizvodnja iz nepotvrđene specifikacije.']
    ],
    sketchKey: 'bom',
    sketchAlt: ['Shema toka: izmera → kosovnica → ponudba/proizvodnja.', 'Shema toka: mjerenje → specifikacija → ponuda/proizvodnja.'],
    voice: ['Preveri vir vsake vrstice kosovnice. Potrdi kosovnico, preden se uporabi v ponudbi ali proizvodnji.', 'Provjerite izvor svakog retka specifikacije. Potvrdite specifikaciju prije korištenja u ponudi ili proizvodnji.']
  },
  {
    id: 'nalog.osnove', tabId: 'nalogi', version: 1, firstUse: true,
    title: ['Nalog — terenski tok monterja', 'Nalog — terenski tok montera'],
    desc: ['Dodelitev, fotografije pred/med/po, kontrolni seznam, opombe in zaključek.', 'Dodjela, fotografije prije/tijekom/poslije, kontrolni popis, napomene i završetak.'],
    steps: [
      ['Odpri svoj nalog — dodeljeni nalogi so vidni v Danes.', 'Otvorite svoj nalog — dodijeljeni nalozi su vidljivi u Danas.'],
      ['Fotografiraj stanje PRED delom ob prihodu na teren.', 'Fotografirajte stanje PRIJE rada po dolasku na teren.'],
      ['MED delom dodaj dokazilne fotografije in opombe.', 'TIJEKOM rada dodajte dokazne fotografije i napomene.'],
      ['Izpolni kontrolne točke — vsaka zahteva status in razlog.', 'Ispunite kontrolne točke — svaka zahtijeva status i razlog.'],
      ['PO delu fotografiraj zaključeno stanje in predaj s podpisom.', 'PO radu fotografirajte završeno stanje i predajte s potpisom.']
    ],
    expected: ['Nalog ima fotografije pred/med/po, izpolnjene kontrole in primopredajo s podpisom.', 'Nalog ima fotografije prije/tijekom/poslije, ispunjene kontrole i primopredaju s potpisom.'],
    mistakes: [
      ['Manjkajoče fotografije pred delom.', 'Nedostajuće fotografije prije rada.'],
      ['Zaključek kljub odprti napaki na kritični točki — sistem blokira.', 'Završetak unatoč otvorenoj grešci na kritičnoj točki — sustav blokira.'],
      ['Predaja brez zabeležene potrditve stranke.', 'Predaja bez zabilježene potvrde kupca.']
    ],
    sketchKey: 'nalog',
    sketchAlt: ['Shema časovnice nalog: pred, med, po s fotografijami in kontrolami.', 'Shema vremenske crte naloga: prije, tijekom, poslije s fotografijama i kontrolama.'],
    voice: ['Odpri svoj nalog. Fotografiraj stanje pred delom. Med delom dodaj dokazila. Izpolni kontrolne točke. Po delu fotografiraj zaključeno stanje in predaj s podpisom.', 'Otvorite svoj nalog. Fotografirajte stanje prije rada. Tijekom rada dodajte dokaze. Ispunite kontrolne točke. Po radu fotografirajte završeno stanje i predajte s potpisom.']
  },
  {
    id: 'projekti.osnove', tabId: 'projekti', version: 1, firstUse: false,
    title: ['Projekti — statusi in sledenje', 'Projekti — statusi i praćenje'],
    desc: ['Kako projekt nastane iz ponudbe, kaj pomenijo statusi in kje je revizijska sled.', 'Kako projekt nastaje iz ponude, što znače statusi i gdje je revizijski trag.'],
    steps: [
      ['Projekt nastane iz sprejete ponudbe (ali ga odpre pisarna ročno).', 'Projekt nastaje iz prihvaćene ponude (ili ga otvori ured ručno).'],
      ['Status opisuje fazo: načrt, aktivni, teren, zaključen, arhiv.', 'Status opisuje fazu: nacrt, aktivni, teren, završen, arhiv.'],
      ['Vse spremembe se zapisujejo v revizijski dnevnik (Varnost).', 'Sve promjene se upisuju u revizijski dnevnik (Sigurnost).']
    ],
    expected: ['Projekt ima veljaven status in vidno zgodovino sprememb.', 'Projekt ima važeći status i vidljivu povijest promjena.'],
    mistakes: [
      ['Zaključen projekt brez zaključka naloga.', 'Završen projekt bez završetka naloga.']
    ],
    sketchKey: 'projekt',
    sketchAlt: ['Shema toka: priložnost → ponudba → projekt → nalog → zaključek.', 'Shema toka: prilika → ponuda → projekt → nalog → završetak.'],
    voice: ['Projekt nastane iz sprejete ponudbe. Status pomeni fazo projekta. Spremembe so v revizijskem dnevniku.', 'Projekt nastaje iz prihvaćene ponude. Status znači fazu projekta. Promjene su u revizijskom dnevniku.']
  },
  {
    id: 'crm.osnove', tabId: 'crm', version: 1, firstUse: false,
    title: ['CRM — vodi in priložnosti', 'CRM — tragovi i prilike'],
    desc: ['Kako nastane vod iz povpraševanja in kdaj postane priložnost s ponudbo.', 'Kako nastaje trag iz upita i kada postane prilika s ponudom.'],
    steps: [
      ['Nov vod ustvariš iz povpraševanja (klic, obrazec, e-pošta).', 'Novi trag stvarate iz upita (poziv, obrazac, e-pošta).'],
      ['Vod se pretvori v priložnost, ko je povpraševanje konkretno.', 'Trag se pretvara u priliku kad je upit konkretan.'],
      ['Iz priložnosti ustvari ponudbo in sledi status.', 'Iz prilike stvorite ponudu i pratite status.']
    ],
    expected: ['Vsak vod ima naslednji korak: priložnost, ponudba ali zavrnitev.', 'Svaki trag ima sljedeći korak: prilika, ponuda ili odbijanje.'],
    mistakes: [
      ['Vodi brez slednjega koraka ostanejo pozabljeni.', 'Tragovi bez sljedećeg koraka ostaju zaboravljeni.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Nov vod ustvari iz povpraševanja. Ko je povpraševanje konkretno, ga pretvori v priložnost in ponudbo.', 'Novi trag stvorite iz upita. Kad je upit konkretan, pretvorite ga u priliku i ponudu.']
  },
  {
    id: 'stranke.osnove', tabId: 'stranke', version: 1, firstUse: false,
    title: ['Stranke — kontakti in projekti', 'Kupci — kontakti i projekti'],
    desc: ['Kartica stranke: kontakti, projekti, dokumenti in soglasja.', 'Kartica kupca: kontakti, projekti, dokumenti i suglasnosti.'],
    steps: [
      ['Odpreš stranko in pregledaš njene projekte in dokumente.', 'Otvorite kupca i pregledate njegove projekte i dokumente.'],
      ['Soglasje za objavo fotografij se beleži na projektu (GDPR).', 'Suglasnost za objavu fotografija bilježi se na projektu (GDPR).']
    ],
    expected: ['Podatki stranke so popolni; soglasja so veljavna.', 'Podaci kupca su potpuni; suglasnosti su važeće.'],
    mistakes: [
      ['Objava fotografij brez veljavnega soglasja.', 'Objava fotografija bez važeće suglasnosti.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Odpreš stranko in pregledaš projekte. Soglasje za fotografije se beleži na projektu.', 'Otvorite kupca i pregledate projekte. Suglasnost za fotografije bilježi se na projektu.']
  },
  {
    id: 'playbook.osnove', tabId: 'playbook', version: 1, firstUse: false,
    title: ['Vodeni postopek — playbook', 'Vođeni postupak — playbook'],
    desc: ['Deterministični playbook vodi monterja skozi korake z dokazili (SCRIPT → GUIDE → CAPTURE → VALIDATE → CONFIRM).', 'Deterministični playbook vodi montera kroz korake s dokazima (SCRIPT → GUIDE → CAPTURE → VALIDATE → CONFIRM).'],
    steps: [
      ['Izberi nalog in playbook, ki ustreza delu.', 'Odaberite nalog i playbook koji odgovara radu.'],
      ['Hodi po korakih — vsak korak ima navodilo in pričakovani rezultat.', 'Idite po koracima — svaki korak ima uputstvo i očekivani rezultat.'],
      ['Dokazila (fotografija, meritev, podpis) pripni koraku.', 'Dokaze (fotografiju, mjerenje, potpis) priložite koraku.'],
      ['Izjeme zapiši z razlogom (NI PRIMERNO ali BLOKIRANO).', 'Iznimke zapišite s razlogom (NIJE PRIKLADNO ili BLOKIRANO).']
    ],
    expected: ['Zagon playbooka je zaključen z dokazi na vsakem koraku.', 'Pokretanje playbooka je završeno s dokazima na svakom koraku.'],
    mistakes: [
      ['Preskok koraka brez razloga.', 'Preskakanje koraka bez razloga.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Izberi nalog in playbook. Hodi po korakih in pripni dokazila. Izjeme zapiši z razlogom.', 'Odaberite nalog i playbook. Idite po koracima i priložite dokaze. Iznimke zapišite s razlogom.']
  },
  {
    id: 'foto.osnove', tabId: 'foto', version: 1, firstUse: true,
    title: ['Foto — dokazilne fotografije na terenu', 'Foto — dokazne fotografije na terenu'],
    desc: ['Kako zajeti dokazilno fotografijo in kdaj je potrebno soglasje za objavo.', 'Kako snimiti dokaznu fotografiju i kada je potrebna suglasnost za objavu.'],
    steps: [
      ['Fotografiraj v dnevni svetlobi, cel objekt v okvirju.', 'Fotografirajte po dnevnom svjetlu, cijeli objekt u okviru.'],
      ['Fotografija se veže na projekt in nalog kot dokazilo.', 'Fotografija se veže na projekt i nalog kao dokaz.'],
      ['Za javno objavo (galerija) potrebuješ veljavno soglasje stranke.', 'Za javnu objavu (galerija) trebate važeću suglasnost kupca.']
    ],
    expected: ['Fotografija je ostre, povezana z nalogom in ima zabeleženo lokacijo.', 'Fotografija je oštra, povezana s nalogom i ima zabilježenu lokaciju.'],
    mistakes: [
      ['Zamegljena ali temna fotografija kot dokazilo.', 'Zamućena ili tamna fotografija kao dokaz.'],
      ['Objava v galeriji brez soglasja.', 'Objava u galeriji bez suglasnosti.']
    ],
    sketchKey: 'foto',
    sketchAlt: ['Shema: kamera usmerjena na ograjo, ikone dokazilnih fotografij.', 'Shema: kamera usmjerena na ogradu, ikone dokaznih fotografija.'],
    voice: ['Fotografiraj v dnevni svetlobi. Cel objekt v okvirju. Za javno objavo preveri soglasje stranke.', 'Fotografirajte po dnevnom svjetlu. Cijeli objekt u okviru. Za javnu objavu provjerite suglasnost kupca.']
  },
  {
    id: 'nagib.osnove', tabId: 'nagib', version: 1, firstUse: false,
    title: ['Nagib — stopniščna ograja', 'Nagib — stubišna ograda'],
    desc: ['Kako izmeriti višino in vodoravno dolžino stopnišča in kaj pomeni kot.', 'Kako izmjeriti visinu i vodoravnu dužinu stubišta i što znači kut.'],
    steps: [
      ['Izmeri skupno višino (v) in vodoravno dolžino (d) stopnišča.', 'Izmjerite ukupnu visinu (v) i vodoravnu dužinu (d) stubišta.'],
      ['Kalkulator izračuna kot in dolžino ograje (hipotenuza).', 'Kalkulator izračuna kut i dužinu ograde (hipotenuza).'],
      ['Dolžino ograje preveri z merilnim trakom na mestu.', 'Dužinu ograde provjerite mjernim trakom na mjestu.']
    ],
    expected: ['Kot in dolžina ograje sta izračunana iz izmerjenih vrednosti.', 'Kut i dužina ograde su izračunati iz izmjerenih vrijednosti.'],
    mistakes: [
      ['Merjenje po stopnicah namesto skupne višine.', 'Mjerenje po stubama umjesto ukupne visine.']
    ],
    sketchKey: 'stopnica',
    sketchAlt: ['Shema trikotnika stopnišča: višina, dolžina, kot in ograja po hipotenuzi.', 'Shema trokuta stubišta: visina, dužina, kut i ograda po hipotenuzi.'],
    voice: ['Izmeri skupno višino in vodoravno dolžino stopnišča. Kalkulator izračuna kot in dolžino ograje.', 'Izmjerite ukupnu visinu i vodoravnu dužinu stubišta. Kalkulator izračuna kut i dužinu ograde.']
  },
  {
    id: 'viz.osnove', tabId: 'viz', version: 1, firstUse: false,
    title: ['Vizualizacija — 3D pregled ograje', 'Vizualizacija — 3D pregled ograde'],
    desc: ['Kako nastane 3D prikaz iz meritev in kaj lahko iz njega prebereš.', 'Kako nastaje 3D prikaz iz mjerenja i što iz njega možeš pročitati.'],
    steps: [
      ['Izberi projekt in meritev s tekačem.', 'Odaberite projekt i mjerenje s trakom.'],
      ['3D prikaz se zgradi iz segmentov in višin.', '3D prikaz se gradi iz segmenata i visina.'],
      ['Prikaz je ponazoritev, ne proizvodni risbi — mere vedno preveri na izmeri.', 'Prikaz je prikaz, ne proizvodna nacrt — mjere uvijek provjerite na mjerenju.']
    ],
    expected: ['Vizualizacija odraža segmente izmere in izbrane profile.', 'Vizualizacija odražava segmente mjerenja i odabrane profile.'],
    mistakes: [
      ['Odločanje samo po vizualizaciji brez izmere.', 'Odlučivanje samo po vizualizaciji bez mjerenja.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Izberi projekt in meritev. Trije prikaz se zgradi iz segmentov. Mere vedno preveri na izmeri.', 'Odaberite projekt i mjerenje. 3D prikaz se gradi iz segmenata. Mjere uvijek provjerite na mjerenju.']
  },
  {
    id: 'fotoreplace.osnove', tabId: 'foto-replace', version: 1, firstUse: false,
    title: ['Foto vizualizacija — menjava ograje na fotografiji', 'Foto vizualizacija — zamjena ograde na fotografiji'],
    desc: ['PREJ/POTEM primerjava na originalni fotografiji; kaj je dovoljeno sklepati.', 'PRIJE/POSLIJE usporedba na originalnoj fotografiji; što je dopušteno zaključiti.'],
    steps: [
      ['Naloži originalno fotografijo terena.', 'Učitajte originalnu fotografiju terena.'],
      ['Ograja se vstavi po izmeri — nastavljive so barva in tip.', 'Ograda se ubacuje po mjerenju — podesive su boja i tip.'],
      ['Rezultat je ponazoritev za stranko, ne dokaz izvedljivosti.', 'Rezultat je prikaz za kupca, ne dokaz izvedivosti.']
    ],
    expected: ['Vizualizacija ima izvirno in novo verzijo na isti fotografiji.', 'Vizualizacija ima originalnu i novu verziju na istoj fotografiji.'],
    mistakes: [
      ['Fotomontaža se predstavi kot dokaz mere.', 'Fotomontaža se predstavlja kao dokaz mjere.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Naloži originalno fotografijo. Ograja se vstavi po izmeri. Rezultat je ponazoritev, ne dokaz.', 'Učitajte originalnu fotografiju. Ograda se ubacuje po mjerenju. Rezultat je prikaz, ne dokaz.']
  },
  {
    id: 'dvojcek.osnove', tabId: 'dvojcek', version: 1, firstUse: false,
    title: ['Digitalni dvojček — AS-BUILT stanja', 'Digitalni blizanac — AS-BUILT stanja'],
    desc: ['Zaporedje AS-MEASURED → AS-DESIGNED → AS-PRODUCED → AS-INSTALLED in primerjava.', 'Niz AS-MEASURED → AS-DESIGNED → AS-PRODUCED → AS-INSTALLED i usporedba.'],
    steps: [
      ['Vsako stanje ima svoj vir: zajem, konfigurator, proizvodnja, montaža.', 'Svako stanje ima svoj izvor: snimanje, konfigurator, proizvodnja, montaža.'],
      ['Diff pokaže razlike med stanji po segmentih.', 'Diff pokazuje razlike između stanja po segmentima.']
    ],
    expected: ['Dvojček ima vsa stanja z viri in diff po segmentih.', 'Blizanac ima sva stanja s izvorima i diff po segmentima.'],
    mistakes: [
      ['Zmeda med načrtovano in izvedeno vrednostjo.', 'Zbrka između planirane i izvedene vrijednosti.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Vsako stanje dvojčka ima svoj vir. Diff pokaže razlike po segmentih.', 'Svako stanje blizanca ima svoj izvor. Diff pokazuje razlike po segmentima.']
  },
  {
    id: 'model.osnove', tabId: 'model', version: 1, firstUse: false,
    title: ['Merilni model — tloris, profil, 3D', 'Mjerni model — tlocrt, profil, 3D'],
    desc: ['Geometrija iz tekača s svetovnimi koordinatami, verzijo in nedoločenostjo.', 'Geometrija iz trake s svjetskim koordinatama, verzijom i neodređenošču.'],
    steps: [
      ['Model izbereš iz meritev tekača projekta.', 'Model odaberete iz mjerenja trake projekta.'],
      ['Tloris, profil in 3D prikazujejo iste segmente.', 'Tlocrt, profil i 3D prikazuju iste segmente.'],
      ['Vsak segment pokaže vire svojih mer.', 'Svaki segment pokazuje izvore svojih mjera.']
    ],
    expected: ['Model ima verzijo in vire mer po segmentih.', 'Model ima verziju i izvore mjera po segmentima.'],
    mistakes: [
      ['Zanemarjanje nedoločenosti pri sprejemanju odločitev.', 'Zanemarivanje neodređenosti pri odlučivanju.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Model izbereš iz meritev tekača. Vsak segment pokaže vire svojih mer.', 'Model odaberete iz mjerenja trake. Svaki segment pokazuje izvore svojih mjera.']
  },
  {
    id: 'pregled.osnove', tabId: 'pregled', version: 1, firstUse: false,
    title: ['Pregledovalnik — vse na enem mestu', 'Preglednik — sve na jednom mjestu'],
    desc: ['Model, fotografije, meritve in pripeti komentarji (pini) na enem mestu; deljenje z žetonom.', 'Model, fotografije, mjerenja i prikvačeni komentari (pinovi) na jednom mjestu; dijeljenje tokenom.'],
    steps: [
      ['Odpreš projekt v pregledovalniku in preklapljaš med pogledi.', 'Otvorite projekt u pregledniku i prebacujete između pregleda.'],
      ['Pini se pripnejo na točko modela ali fotografije.', 'Pinovi se prikvače na točku modela ili fotografije.'],
      ['Javna delitev uporablja žeton in spoštuje soglasje (GDPR).', 'Javno dijeljenje koristi token i poštuje suglasnost (GDPR).']
    ],
    expected: ['Pini in delitve delujejo brez razkritja podatkov brez soglasja.', 'Pinovi i dijeljenja rade bez otkrivanja podataka bez suglasnosti.'],
    mistakes: [
      ['Delitev povezave brez preverjenega soglasja za fotografije.', 'Dijeljenje poveznice bez provjerenog suglasnosti za fotografije.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Preklapljaj med pogledi projekta. Pini se pripnejo na točke. Delitev uporablja žeton in spoštuje soglasje.', 'Prebacujte između pregleda projekta. Pinovi se prikvače na točke. Dijeljenje koristi token i poštuje suglasnost.']
  },
  {
    id: 'ar.osnove', tabId: 'ar', version: 1, firstUse: false,
    title: ['AR — dopolnjena resničnost na terenu', 'AR — proširena stvarnost na terenu'],
    desc: ['Kako postaviti telefon za prikaz ograje na terenu in kdaj podatkov ni dovolj.', 'Kako postaviti telefon za prikaz ograde na terenu i kada podataka nema dovolj.'],
    steps: [
      ['Drži telefon vzporedno s terenom in počasi premikaj.', 'Držite telefon paralelno s terenom i polagano pomičite.'],
      ['Prikaz se umiri, ko je sledenje stabilno.', 'Prikaz se smiri kad je praćenje stabilno.'],
      ['Če podatkov ni dovolj, sledi navodila ploščice — ročna izmera ostaja resnica.', 'Ako podataka nema dovolj, slijedite upute pločice — ručno mjerenje ostaje stvarnost.']
    ],
    expected: ['AR prikaz je reden na mestu; manjkajoči podatki so vidno označeni.', 'AR prikaz je stvaran na mjestu; nedostajući podaci su vidno označeni.'],
    mistakes: [
      ['Hitro premikanje — sledenje izgubi tla.', 'Brzo pomicanje — praćenje izgubi tlo.'],
      ['Odločanje samo po AR brez izmere.', 'Odlučivanje samo po AR bez mjerenja.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Drži telefon vzporedno s terenom. Počasi premikaj. Če podatkov ni dovolj, uporabi ročno izmero.', 'Držite telefon paralelno s terenom. Polagano pomičite. Ako podataka nema dovolj, koristite ručno mjerenje.']
  },
  {
    id: 'signatura.osnove', tabId: 'signatura', version: 1, firstUse: false,
    title: ['Signatura — podpis stranke', 'Signatura — potpis kupca'],
    desc: ['Zajem podpisa na zaslonu; kaj podpis pomeni in česa ne.', 'Snimanje potpisa na zaslonu; što potpis znači i što ne.'],
    steps: [
      ['Podrži napravo stranki in počisti zaslon.', 'Pružite uređaj kupcu i očistite zaslon.'],
      ['Podpis se shrani kot zapis dogodka — ni kvalificiran e-podpis.', 'Potpis se sprema kao zapis događaja — nije kvalificirani e-potpis.']
    ],
    expected: ['Podpis je shranjen skupaj z datumom in ponudbo.', 'Potpis je spremljen zajedno s datumom i ponudom.'],
    mistakes: [
      ['Pričakovanje pravne veljave kvalificiranega podpisa.', 'Očekivanje pravne snage kvalificiranog potpisa.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Podrži napravo stranki za podpis. Podpis je zapis dogodka, ne kvalificiran e-podpis.', 'Pružite uređaj kupcu za potpis. Potpis je zapis događaja, ne kvalificirani e-potpis.']
  },
  {
    id: 'dokumenti.osnove', tabId: 'dokumenti', version: 1, firstUse: false,
    title: ['Dokumenti — arhiv', 'Dokumenti — arhiv'],
    desc: ['Arhiv dokumentov projekta z verzijami.', 'Arhiv dokumenata projekta s verzijama.'],
    steps: [
      ['Dokumente naložiš na projekt; vsak nosi verzijo.', 'Dokumente učitate na projekt; svaki nosi verziju.'],
      ['Starejše verzije ostanejo dostopne za pregled.', 'Starije verzije ostaju dostupne za pregled.']
    ],
    expected: ['Dokumenti so povezani s projektom in imajo sled verzij.', 'Dokumenti su povezani s projektom i imaju trag verzija.'],
    mistakes: [
      ['Izbris namesto nove verzije.', 'Brisanje umjesto nove verzije.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Dokumente naložiš na projekt. Vsak nosi verzijo. Starejše ostanejo dostopne.', 'Dokumente učitate na projekt. Svaki nosi verziju. Starije ostaju dostupne.']
  },
  {
    id: 'pdf.osnove', tabId: 'pdf', version: 1, firstUse: false,
    title: ['PDF — izvoz dokumentov', 'PDF — izvoz dokumenata'],
    desc: ['Izvoz ponudb, kosovnic in poročil v PDF.', 'Izvoz ponuda, specifikacija i izvješća u PDF.'],
    steps: [
      ['Izberi dokument in vrsto izvoza.', 'Odaberite dokument i vrstu izvoza.'],
      ['Izvoz se zabeleži v revizijski dnevnik.', 'Izvoz se bilježi u revizijski dnevnik.']
    ],
    expected: ['PDF ustreza trenutni verziji dokumenta.', 'PDF odgovara trenutnoj verziji dokumenta.'],
    mistakes: [
      ['Izvoz stare verzije po spremembi.', 'Izvoz stare verzije nakon promjene.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Izberi dokument in vrsto izvoza. Izvoz se zabeleži v dnevnik.', 'Odaberite dokument i vrstu izvoza. Izvoz se bilježi u dnevnik.']
  },
  {
    id: 'postsig.osnove', tabId: 'postsig', version: 1, firstUse: false,
    title: ['PostSig — zaklepanje posla', 'PostSig — zaključavanje posla'],
    desc: ['Po podpisu stranke se posel zaklene pred spremembami.', 'Nakon potpisa kupca posao se zaključava prije promjena.'],
    steps: [
      ['Preveri, da so vsi pogoji izpolnjeni pred zaklepom.', 'Provjerite da su svi uvjeti ispunjeni prije zaključavanja.'],
      ['Zaklep preprečuje tihe spremembe ponudbe.', 'Zaključavanje sprječava tihe promjene ponude.']
    ],
    expected: ['Posel je zaklenjen; spremembe zahtevajo razloge.', 'Posao je zaključan; promjene zahtijevaju razloge.'],
    mistakes: [
      ['Zaklep pred popolnim podpisom.', 'Zaključavanje prije potpunog potpisa.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Preveri pogoje pred zaklepom posla. Zaklep preprečuje tihe spremembe.', 'Provjerite uvjete prije zaključavanja posla. Zaključavanje sprječava tihe promjene.']
  },
  {
    id: 'dostave.osnove', tabId: 'dostave', version: 1, firstUse: false,
    title: ['Dostave — vozila in ekipe', 'Dostave — vozila i ekipe'],
    desc: ['Plan dostav z vozili in ekipami.', 'Plan dostava s vozilima i ekipama.'],
    steps: [
      ['Dostave razporediš po vozilih in dnevih.', 'Dostave rasporedite po vozilima i danima.'],
      ['Status spremljaš od načrtovanega do dostavljenega.', 'Status pratite od planiranog do dostavljenog.']
    ],
    expected: ['Dostava ima vozilo, termin in status.', 'Dostava ima vozilo, termin i status.'],
    mistakes: [
      ['Dostava brez dodeljenega vozila.', 'Dostava bez dodijeljenog vozila.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Dostave razporediš po vozilih in dnevih. Spremljaj status do dostavljenega.', 'Dostave rasporedite po vozilima i danima. Pratite status do dostavljenog.']
  },
  {
    id: 'logistika.osnove', tabId: 'logistika', version: 1, firstUse: false,
    title: ['Plan — razpored in termini', 'Plan — raspored i termini'],
    desc: ['Razpored montaž po terminih in ekipah.', 'Raspored montaža po terminima i ekipama.'],
    steps: [
      ['Termin nastaviš na nalogu ali v planu.', 'Termin postavite na nalogu ili u planu.'],
      ['Sovpadanja terminov so vidno označena.', 'Sukobi termina su vidno označeni.']
    ],
    expected: ['Vsaka montaža ima termin in odgovorno osebo.', 'Svaka montaža ima termin i odgovornu osobu.'],
    mistakes: [
      ['Termin brez preverjene razpoložljivosti.', 'Termin bez provjerene dostupnosti.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Termin nastaviš v planu. Sovpadanja so označena.', 'Termin postavite u planu. Sukobi su označeni.']
  },
  {
    id: 'proizvodnja.osnove', tabId: 'proizvodnja', version: 1, firstUse: false,
    title: ['Proizvodnja — proizvodni nalogi', 'Proizvodnja — proizvodni nalozi'],
    desc: ['Od potrjene kosovnice do proizvodnega naloga in QC.', 'Od potvrđene specifikacije do proizvodnog naloga i QC.'],
    steps: [
      ['Proizvodni nalog nastane iz POTRJENE kosovnice.', 'Proizvodni nalog nastaje iz POTVRĐENE specifikacije.'],
      ['Kontrola kvalitete (OK/NOK) se zapiše na pozicije.', 'Kontrola kvalitete (OK/NOK) zapisuje se na pozicije.'],
      ['Odstopanja dokumentiraj s fotografijo.', 'Odstupanja dokumentirajte s fotografijom.']
    ],
    expected: ['Proizvodni nalog ima QC status po pozicijah.', 'Proizvodni nalog ima QC status po pozicijama.'],
    mistakes: [
      ['Proizvodnja brez potrjene kosovnice.', 'Proizvodnja bez potvrđene specifikacije.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Proizvodni nalog nastane iz potrjene kosovnice. Kontrola kvalitete se zapiše na pozicije.', 'Proizvodni nalog nastaje iz potvrđene specifikacije. Kontrola kvalitete zapisuje se na pozicije.']
  },
  {
    id: 'galerija.osnove', tabId: 'galerija', version: 1, firstUse: false,
    title: ['Galerija — zaključena dela', 'Galerija — završeni radovi'],
    desc: ['Fotografije zaključenih del; javna objava zahteva soglasje.', 'Fotografije završenih radova; javna objava zahtijeva suglasnost.'],
    steps: [
      ['Galerija prikaže fotografije zaključenih in arhiviranih projektov.', 'Galerija prikazuje fotografije završenih i arhiviranih projekata.'],
      ['Projekt brez soglasja nosi opozorilo — interne fotografije ostanejo interne.', 'Projekt bez suglasnosti nosi upozorenje — interne fotografije ostaju interne.']
    ],
    expected: ['Javno prikazane fotografije imajo veljavno soglasje.', 'Javno prikazane fotografije imaju važeću suglasnost.'],
    mistakes: [
      ['Objava brez preverjanja soglasja.', 'Objava bez provjere suglasnosti.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Galerija prikaže zaključena dela. Objava zahteva veljavno soglasje stranke.', 'Galerija prikazuje završene radove. Objava zahtijeva važeću suglasnost kupca.']
  },
  {
    id: 'orodjarina.osnove', tabId: 'orodjarina', version: 1, firstUse: false,
    title: ['Orodjarina — merilna oprema', 'Alatnica — mjerna oprema'],
    desc: ['Izdaja in vračilo merilne opreme z stanjem.', 'Izdavanje i vraćanje mjerne opreme s stanjem.'],
    steps: [
      ['Opremo izdaš z zapisom stanja ob izdaji.', 'Opremu izdate sa zapisom stanja pri izdaji.'],
      ['Vrnitev preveriš in zabeležiš morebitne poškodbe.', 'Povratak provjerite i zabilježite moguće štete.']
    ],
    expected: ['Vsaka izdaja ima zapis stanja ob izdaji in vrnitvi.', 'Svaka izdaja ima zapis stanja pri izdaji i povratku.'],
    mistakes: [
      ['Izdaja brez zapisa stanja.', 'Izdaja bez zapisa stanja.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Opremo izdaš z zapisom stanja. Ob vrnitvi preveriš stanje.', 'Opremu izdate sa zapisom stanja. Pri povratku provjerite stanje.']
  },
  {
    id: 'zaloga.osnove', tabId: 'zaloga', version: 1, firstUse: false,
    title: ['Zaloga — stanje in gibanja', 'Zaliha — stanje i kretanja'],
    desc: ['Stanje zaloge, gibanja, picking in dobavitelji.', 'Stanje zalihe, kretanja, picking i dobavljači.'],
    steps: [
      ['Gibanja se zapisujejo kot sprejem ali izdaja z virom.', 'Kretanja se zapisuju kao prijem ili izdaja s izvorom.'],
      ['Nizka zaloga se dopolni iz predloga naročila.', 'Niska zaliha se dopuni iz prijedloga narudžbe.']
    ],
    expected: ['Vsako gibanje ima vir in količino.', 'Svako kretanje ima izvor i količinu.'],
    mistakes: [
      ['Ročni popravek stanja brez zapisa gibanja.', 'Ručna ispravka stanja bez zapisa kretanja.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Gibanja zaloge se zapisujejo z virom. Nizko zalogo dopolniš iz predloga.', 'Kretanja zalihe zapisuju se s izvorom. Nisku zalihu dopunite iz prijedloga.']
  },
  {
    id: 'predlogi.osnove', tabId: 'predlogi', version: 1, firstUse: false,
    title: ['Predlogi naročila — avtomatski predlog materiala', 'Prijedlozi narudžbe — automatski prijedlog materijala'],
    desc: ['Predlog iz odprtih kosovnic minus razpoložljiva zaloga.', 'Prijedlog iz otvorenih specifikacija minus raspoloživa zaliha.'],
    steps: [
      ['Predlog izračun aš povpraševanje odprtih kosovnic in zalogo.', 'Prijedlog izračunava potražnju otvorenih specifikacija i zalihe.'],
      ['Naročilo ustvariš iz predloga po pregledu.', 'Narudžbu stvorite iz prijedloga nakon pregleda.']
    ],
    expected: ['Predlog pokaže manjkajoči material po artiklih.', 'Prijedlog pokazuje nedostajući materijal po artiklima.'],
    mistakes: [
      ['Naročanje brez pregleda predloga.', 'Naručivanje bez pregleda prijedloga.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Predlog izračuna manjkajoči material. Naročilo ustvariš po pregledu.', 'Prijedlog izračuna nedostajući materijal. Narudžbu stvorite nakon pregleda.']
  },
  {
    id: 'katalog.osnove', tabId: 'katalog', version: 1, firstUse: false,
    title: ['Katalog — izdelki in ceniki', 'Katalog — proizvodi i cjenici'],
    desc: ['Izdelki po družinah in veljavni ceniki.', 'Proizvodi po obiteljima i važeći cjenici.'],
    steps: [
      ['Izdelke filtriraš po družini (terase, ograje, fasade …).', 'Proizvode filtrirate po obitelji (terase, ograde, fasade …).'],
      ['Cena izhaja iz veljavnega cenika — nikoli ročno.', 'Cijena proizlazi iz važećeg cjenika — nikad ručno.']
    ],
    expected: ['Konfigurator uporablja samo kataloške izdelke in cene.', 'Konfigurator koristi samo kataloške proizvode i cijene.'],
    mistakes: [
      ['Izmišljeni izdelki ali ročne cene izven cenika.', 'Izmišljeni proizvodi ili ručne cijene izvan cjenika.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Izdelke filtriraš po družini. Cena izhaja iz veljavnega cenika.', 'Proizvode filtrirate po obitelji. Cijena proizlazi iz važećeg cjenika.']
  },
  {
    id: 'racuni.osnove', tabId: 'racuni', version: 1, firstUse: false,
    title: ['Računi — izdaja in plačila', 'Računi — izdavanje i plaćanja'],
    desc: ['Računi iz projektov, beleženje plačil in terjatve.', 'Računi iz projekata, bilježenje plaćanja i potraživanja.'],
    steps: [
      ['Račun izdaš iz zaključenega projekta ali ponudbe.', 'Račun izdate iz završenog projekta ili ponude.'],
      ['Plačila se beležijo z zneskom in datumom.', 'Plaćanja se bilježe s iznosom i datumom.']
    ],
    expected: ['Terjatve se ujemajo z izdanimi računi in plačili.', 'Potraživanja se podudaraju s izdanim računima i plaćanjima.'],
    mistakes: [
      ['Ročno popravljanje zneskov brez sledi.', 'Ručno ispravljanje iznosa bez traga.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Račun izdaš iz projekta. Plačila se beležijo z zneskom in datumom.', 'Račun izdate iz projekta. Plaćanja se bilježe s iznosom i datumom.']
  },
  {
    id: 'servis.osnove', tabId: 'servis', version: 1, firstUse: false,
    title: ['Servis — garancije in reklamacije', 'Servis — garancije i reklamacije'],
    desc: ['Garancije, reklamacije in servisni primeri z roki.', 'Garancije, reklamacije i servisni slučajevi s rokovima.'],
    steps: [
      ['Reklamacijo odpreš s fotografijo in opisom.', 'Reklamaciju otvorite s fotografijom i opisom.'],
      ['Garancijski rok se preveri iz datuma montaže.', 'Garancijski rok se provjerava iz datuma montaže.']
    ],
    expected: ['Vsak servisni primer ima stanje, rok in odgovorno osebo.', 'Svaki servisni slučaj ima stanje, rok i odgovornu osobu.'],
    mistakes: [
      ['Reklamacija brez dokazilne fotografije.', 'Reklamacija bez dokazne fotografije.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Reklamacijo odpreš s fotografijo. Garancijski rok preveriš iz datuma montaže.', 'Reklamaciju otvorite s fotografijom. Garancijski rok provjeravate iz datuma montaže.']
  },
  {
    id: 'dashboard.osnove', tabId: 'dashboard', version: 1, firstUse: false,
    title: ['Preglednica — KPI', 'Preglednica — KPI'],
    desc: ['Kazalniki stanja portfelja.', 'Pokazatelji stanja portfelja.'],
    steps: [
      ['KPI se izračunajo iz dejanskih podatkov (ne ročno).', 'KPI se izračunavaju iz stvarnih podataka (ne ručno).'],
      ['Podatki se osvežijo ob vsakem obisku.', 'Podaci se osvježavaju pri svakom posjetu.']
    ],
    expected: ['Številke se ujemajo z viri (ponudbe, nalogi, računi).', 'Brojke se podudaraju s izvorima (ponude, nalozi, računi).'],
    mistakes: [
      ['Pričakovanje realnega časa priprave.', 'Očekivanje pripreme u stvarnom vremenu.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['KPI se izračunajo iz dejanskih podatkov. Osvežijo se ob obisku.', 'KPI se izračunavaju iz stvarnih podataka. Osvježavaju se pri posjeti.']
  },
  {
    id: 'reports.osnove', tabId: 'reports', version: 1, firstUse: false,
    title: ['Napredna poročila — trendi', 'Napredna izvješća — trendovi'],
    desc: ['Mesečni trendi po prodaji, servisu, zalogi in projektih.', 'Mjesečni trendovi po prodaji, servisu, zalihi i projektima.'],
    steps: [
      ['Poročilo izbereš po področju in obdobju.', 'Izvješće odaberete po području i razdoblju.'],
      ['Sklopi se pokažejo samo po tvojih pravicah.', 'Sklopovi se pokazuju samo po vašim pravicama.']
    ],
    expected: ['Trendi temeljijo na zaključenih zapisih.', 'Trendovi temelje na završenim zapisima.'],
    mistakes: [
      ['Primerjava nezaključenih obdobij.', 'Usporedba nezavršenih razdoblja.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Poročilo izbereš po obdobju. Trendi temeljijo na zaključenih zapisih.', 'Izvješće odaberete po razdoblju. Trendovi temelje na završenim zapisima.']
  },
  {
    id: 'varnost.osnove', tabId: 'varnost', version: 1, firstUse: false,
    title: ['Revizija — revizijski dnevnik', 'Revizija — revizijski dnevnik'],
    desc: ['Neizbrisen dnevnik sprememb z osebo in časom.', 'Neizbrisan dnevnik promjena s osobom i vremenom.'],
    steps: [
      ['Dnevnik filtriraš po osebi, entiteti ali obdobju.', 'Dnevnik filtrirate po osobi, entitetu ili razdoblju.'],
      ['Vsak zapis ima podrobnost spremembe.', 'Svaki zapis ima detalj promjene.']
    ],
    expected: ['Spremembe so sledljive do osebe in časa.', 'Promjene su sledljive do osobe i vremena.'],
    mistakes: [
      ['Pričakovanje brisanja zapisa.', 'Očekivanje brisanja zapisa.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Dnevnik filtriraš po osebi in obdobju. Zapisi se ne brišejo.', 'Dnevnik filtrirate po osobi i razdoblju. Zapisi se ne brišu.']
  },
  {
    id: 'uporabniki.osnove', tabId: 'vodja-ekipa', version: 1, firstUse: false,
    title: ['Uporabniki in vloge', 'Korisnici i uloge'],
    desc: ['Upravljanje uporabnikov, vlog in pravic.', 'Upravljanje korisnika, uloga i prava.'],
    steps: [
      ['Vsak uporabnik ima eno vlogo s pravicami.', 'Svaki korisnik ima jednu ulogu s pravima.'],
      ['Neaktiviran uporabnik se ne more prijaviti.', 'Deaktiviran korisnik se ne može prijaviti.']
    ],
    expected: ['Dostop uporabnikov ustreza njihovim vlogam.', 'Pristup korisnika odgovara njihovim ulogama.'],
    mistakes: [
      ['Skupna raba prijave med osebami.', 'Zajednička prijava među osobama.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Vsak uporabnik ima eno vlogo. Neaktiviran uporabnik se ne more prijaviti.', 'Svaki korisnik ima jednu ulogu. Deaktiviran korisnik se ne može prijaviti.']
  },
  {
    id: 'integracije.osnove', tabId: 'integracije', version: 1, firstUse: false,
    title: ['Integracije — webhook naročnine', 'Integracije — webhook pretplate'],
    desc: ['Obvestila partnerjem prek webhookov z dnevnikom.', 'Obavijesti partnerima putem webhooka s dnevnikom.'],
    steps: [
      ['Naročnino se doda z dogodki in ciljnim naslovom.', 'Pretplata se dodaje s događajima i ciljnom adresom.'],
      ['Poskusi dostave so vidni v dnevniku.', 'Pokušaji dostave su vidljivi u dnevniku.']
    ],
    expected: ['Webhook dostavi dogodke z novim poskusom ob napaki.', 'Webhook dostavlja događaje s novim pokušajem pri greški.'],
    mistakes: [
      ['Naslov brez HTTPS.', 'Adresa bez HTTPS.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Naročnino dodaš z dogodki in naslovom. Poskusi dostave so v dnevniku.', 'Pretplatu dodate s događajima i adresom. Pokušaji dostave su u dnevniku.']
  },
  {
    id: 'profil.osnove', tabId: 'profil', version: 1, firstUse: false,
    title: ['Profil — nastavitve', 'Profil — postavke'],
    desc: ['Tvoj profil, tema in odjava.', 'Tvoj profil, tema i odjava.'],
    steps: [
      ['Temo preklopiš med svetlo in temno.', 'Temu prebacite između svjetle i tamne.'],
      ['Odjava te vrne na prijavni zaslon.', 'Odjava vas vraća na prijavni zaslon.']
    ],
    expected: ['Nastavitve profila se shranijo za naslednji obisk.', 'Postavke profila se spremaju za sljedeći posjet.'],
    mistakes: [
      ['Zapuščena prijava na skupni napravi.', 'Napuštena prijava na zajedničkom uređaju.']
    ],
    sketchKey: null, sketchAlt: null,
    voice: ['Temo preklopiš v profilu. Ob odhodu se odjavi.', 'Temu prebacite u profilu. Pri odlasku se odjavite.']
  }
]

// ── pomočniki ────────────────────────────────────────────────────────────────

export function guideByTab (tabId: string): GuideEntry | undefined {
  return GUIDE.find((g) => g.tabId === tabId)
}

export function guideById (id: string): GuideEntry | undefined {
  return GUIDE.find((g) => g.id === id)
}

/**
 * INTEGRITETA registra (issue #11 §6: avtomatski testi za manjkajoče prevode,
 * neveljavne reference ilustracij in ID-je navodil). Čista funkcija — uporabi
 * jo /api/guide (strežnik) in eventualno CI. Vrne seznam opisov napak.
 */
export function validateGuide (): string[] {
  const issues: string[] = []
  const ids = new Set<string>()
  const tabIds = new Set(ALL_TABS.map((t) => t.id))

  for (const g of GUIDE) {
    const tag = `${g.id} (${g.tabId})`
    if (!g.id || ids.has(g.id)) issues.push(`dupliciten ali prazen ID: ${tag}`)
    ids.add(g.id)

    if (!tabIds.has(g.tabId)) issues.push(`neznan tabId: ${tag}`)
    if (g.version < 1) issues.push(`neveljavna verzija: ${tag}`)

    const fields: Array<[keyof GuideEntry, string]> = [
      ['title', 'naslov'], ['desc', 'opis'], ['expected', 'pričakovani rezultat'], ['voice', 'glasovni skript']
    ]
    for (const [f, label] of fields) {
      const v = g[f] as Bi
      if (!v || !v[0]?.trim() || !v[1]?.trim()) issues.push(`${label} brez SL ali HR: ${tag}`)
    }
    if (!g.steps || g.steps.length < 2) issues.push(`manj kot 2 koraka: ${tag}`)
    for (const [i, s] of (g.steps ?? []).entries()) {
      if (!s?.[0]?.trim() || !s?.[1]?.trim()) issues.push(`korak ${i + 1} brez SL ali HR: ${tag}`)
    }
    if (!g.mistakes || g.mistakes.length < 1) issues.push(`brez pogostih napak: ${tag}`)
    for (const [i, m] of (g.mistakes ?? []).entries()) {
      if (!m?.[0]?.trim() || !m?.[1]?.trim()) issues.push(`napaka ${i + 1} brez SL ali HR: ${tag}`)
    }
    if (g.sketchKey !== null && !SKETCH_KEYS.includes(g.sketchKey)) {
      issues.push(`neveljaven sketchKey: ${tag}`)
    }
    if (g.sketchKey !== null && (!g.sketchAlt?.[0]?.trim() || !g.sketchAlt?.[1]?.trim())) {
      issues.push(`skica brez alt-opisa SL/HR: ${tag}`)
    }
  }
  return issues
}

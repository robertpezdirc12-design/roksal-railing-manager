# SMART VISION #8 — Kamera razume prizor: implementacija, omejitve, terenski protokol (R483, issue #8)

**Datum:** R483 · **Revizija kode:** main = R483 (lokalni commit e222374 nad 84a608f, tag v1.37.1)
· **Verzija:** package.json 1.38.0 (minor — zaključek Faze 5)
**Metoda:** dobesedno branje §11/§12/§8/§10 (GitHub issue #8, 214 vrstic) + vseh 6 komentarjev
(F0 6096763027 · R467 6096990018 · R468 6097827368 · R469 6098702062 · R470 6099223617 ·
R471 6099754892) + pregled kode z dokazi `file:line` po fazah R466–R483.
**Izhodišče:** SMART VISION = klasična CV hevristika **v brskalniku** (Sobel/histogram/gibanje —
BREZ ML knjižnic, BREZ novih odvisnosti); vsaka avtomatika je **PREDLOG**, človek potrjuje.

> **POŠTENOST (velja za ves ta dokument):** razvoj teče v peskovniku BREZ fizičnih naprav.
> Terenska validacija (resnični objekti, ARCore depth na telefonu, izmerjeni FPS/baterija/toplota)
> **ČAKA na uporabnika** — protokol v §3. Nikjer v dokumentu ali kodi ne trdimo, da je prepoznavanje
> terensko potrjeno; kar ni izmerjeno, je vidno označeno (razred NEZNANO, status NEJASNO,
> geometrija NEZADOSTNI_PODATKI).

---

## 1. Kaj je implementirano (F0–F5)

| Faza | Revizija | Kaj dejansko počne |
|---|---|---|
| **F0 — audit** | R466 (komentar 6096763027) | Audit na main: AR modul R454/R465 je obstjal (predogled ograje, zajem, zgodovina, VLM analiza `POST /api/ar/analyze`), razumevanje prizora NI obstajalo. Sklep: klasična CV hevristika lokalno v brskalniku, NEZNANO prvorazredno, brez ML knjižnic, lažna gotovost prepovedana. |
| **F1 — žive oznake** | R467 (95f2666) | Zanka percepcije `scene-perception.ts` (DOM/canvas ~4 Hz, slika ≤320 px, izklop ob `document.hidden`) + čisto jedro `scene-understanding-core.ts` (razredi `:38`, statusi `:46`, kaskada podlag `:226`) + `SceneOverlay` (SVG maska/rob/stopnice + največ 4 DOM oznake z izbiro/pripinjanjem + guidance vrstica `scene-overlay.tsx:314-321`) + popravek zaznave `PATCH /api/ar-snapshots/[id]/scene-element` (OZNAČEN podatek — izvirni zajem ostane). |
| **F2 — tla/ravnine/naklon** | R468 (db94521) | Maska tal (`segmentFloor`), črta ROB, ocena naklona `estimateSlope` (vizualna geometrija; telefonski nagib >15° = zavrnitev — ločitev »teren je nagnjen« od »telefon držim poševno«); ročni vnos naklona ROCNO → IZMERJENO v kartici elementa. |
| **F3 — stopnice/gradbeni elementi** | R469 (c7be3ca) | `analyzeStairPattern`: števec nastopov, smer vzpenjanja, neenakomernost razmikov (toleranca 0,35), drift središč (perspektiva), podest (večja vrzel). Detekcija nastopnih črt v kadru `detectStairLines` (≥3 črte, vsaka ≥22 % širine). |
| **§5 — mere predmetov/osebe** | R470 (0f0a159) | `proposeAxes` — dimenzijske osi iz okvirja BREZ cm vrednosti; referenčna skala (znana dolžina v kadru → izpeljava cm); ročni vnos mere; `consolidateMeasures` s konfliktom >15 % (več mer iste osi se NE povpreči tiho); zasebnost: OSEBA živi samo v živem prizoru — izpuščena iz AR posnetkov (`ar-snapshots` sanitizacija), brez identifikacije. |
| **F4 — senzorji/optimizacija/integracija** | R471 (82e705d) | `depth-adapter.ts`: WebXR immersive-ar dvotapna razdalja (globina 0 < d ≤ 8 m, seja ≤60 s, samo ob dejanski podpori — iOS Safari POŠTENO »ni podprto« `:5-10,:107`); `DepthManifest` (vir senzorja zapisan ob meri, metoda DEPTH_AR); guverner `nextPerfPlan` (ob preobremenitvi: interval ×1,4 → 750 ms, širina ÷1,3 → 160 px, enosmerno — samo degradacija) — toplotna stabilnost brez prekinitev. |
| **F5 — popravki + docs + navodila** | R483 (e222374) | 5 konservativnih popravkov (vsak zmanjša lažne pozitive ali izpelje podatek iz dejanske detekcije): OGRAJA zahteva ≥2 vzporedni črti in bbox iz detekcije (`FENCE_MIN_LINES` `scene-perception.ts:161,:437`); gibanje = povezane komponente ≥2 % kadra, max 4/kader (`detectMotionBoxes` `:546`); PLOŠČICE/LES samo z izmerjeno anizotropijo vlaken (`grainAnisotropy`, `scene-perception.ts:515-538` → `classifySurface` `core:226-259`, zaupanje ≤0,5); STOPNICA monotonost smeri (`STAIR_MONO_*` `core:375-433`) + lamelna stapnica → OGRAJA (`isUniformLamellaStack` `perception:637`); PODLAGA bbox iz meja maske. + ta dokument + kratka navodila v AR modulu (§B spodaj) + `tests/r483.py` (61 kontrol) + CI skupina r483. |

**Testna pokritost scene suite:** r467 41 + r468 40 + r469 47 + r470 59 + r471 39 + r483 61 =
**287 kontrol** (CI skupini `r465-r474` in `r483`); vsi zeleni na R483.

## 2. Znane omejitve prepoznavanja (po razredih)

Vse hevristike so namenoma KONSERVATIVNE: lažji negativ (NEZNANO) je vedno boljši od lažnega
pozitiva, ker mere gredo v proizvodnjo.

### OGRAJA
- Zahteva **≥2 vzporedni črti** v kadru (ročaj + lef, seznam lamel — `FENCE_MIN_LINES=2`,
  `scene-perception.ts:161`). Ena sama črta (senca, strešni rob) NE sproži ograje.
- **NE detektira ograd iz navpičnih stebrov** — ni detektorja navpičnih črt/periodičnosti
  stebrov (prihodnja izboljšava, §5). Ograja, ki jo v kadru »dokazujejo« samo stebri brez
  vodoravnih črt, ostaja NEZNANO.
- **Lamelna ograja z detekcijo obeh robov vsake lamele** (pari črt z majhnimi razmiki) ni zajeta —
  `isUniformLamellaStack` (`scene-perception.ts:637`) prepozna enolični niz lamel kot OGRAJO,
  a ne izmeri širine posamezne lamele iz para robov. Ročno se da popraviti razred prek kartice.
- Zaupanje ostaja **NEJASNO / 0,25** — nikoli se ne dvigne v »prepoznano«, ker je dokaz
  (dve črti) šibek. Izjema: popravek človeka (vir ROCNO) ima višjo težo.

### PODLAGA (9 vrst)
- Klasifikacija je kaskada (trava → les → zemlja → asfalt → ploščice → tlak → gramoz → beton;
  `scene-understanding-core.ts:226-259`) iz barvnih/teksturnih značilnic — zgornja meja zaupanja
  0,62.
- **PLOŠČICE in LES se trdita SAMO z izmerjeno anizotropijo vlaken** (`grainAnisotropy`,
  izračun v `withEdgeDensity` `scene-perception.ts:515-538`): LES = izrazita enosmerna
  vlakna + toplejši ton (0,42); PLOŠČICE = gostota fuge v obeh smereh, brez izrazite smeri
  (0,45). Obe meji ≤0,5 — sta OCENI, monter ju vedno lahko popravi.
- **Brez dokaza → NEZNANA** (poštenost): če anizotropija ni izračunana ali je nevpadljiva,
  razreda NE trdimo. Znanje kataloga tal ne obstaja — podlaga je vedno predlog za potrditev.

### STOPNICE
- **Monotonost**: nastopne črte se morajo vzpenjati z vsaj 0,5 % višine med sosednjimi
  (`STAIR_MONO_MIN_GAP` `core:380`) in središča se premikajo dosledno v eno smer ali mirujejo
  (`STAIR_MONO_TOL_W` `core:381`); cik-cak ali podvojena detekcija vrhov → zavrnjeno (null).
- **Konstantna središča = čelni pogled** — VELJAVEN pogled na stopnice (ravne stopnice od spredaj);
  ni lažni pozitiv. V tem pogledu števec nastopov velja, smeri pa NE (ni ocenljiva).
- **Lamelna stapnica** (enolični vodoravni niz brez perspektivnega zoženja) → OGRAJA, ne STOPNICA
  (`isUniformLamellaStack` `perception:637`); prave stopnice kažejo perspektivno zoženje.
- **Višine čel in globine nastopov NISO izmerljive iz enega 2D pogleda** — izrecno zapisano v
  kartici (`ar.tsx:933`); potreben je drugoten pogled, referenca ali AR globina.

### GIBANJE (OSEBA/OVIRA)
- Zaznava gibanja = **povezane komponente** na 8-px celični mreži; komponenta <2 % kadra = šum,
  največ **4 komponente na kader** (`detectMotionBoxes` `perception:546-614`).
- Stabilni ID-ji čez sličice prek IoU 0,25 (`stabilizeElements`) — isti predmet ostane izbirljiv.
- **Mirujoča oseba NI zaznana** (brez ML segmentacije zaznavamo SPREMEMBE kadra). Oseba, ki
  stoji pri ograji, ne bo razreda OSEBA — je pošteno vidna kot del prizora/nevidna.
- `looksLikePerson` (`core:843`) je raven razmerja stranic okvirja (1,6–5,5 in ≥25 % višine
  kadra) — zgornja meja, ne identifikacija; OSEBA služi samo razumevanju zakritosti.

### MERE (merilna resnica §6)
- **RGB brez globine/reference = NIKOLI potrjena fizična dimenzija.** Predlagane osi so BREZ cm
  (`ar.tsx:1051-1058`); cm pride SAMO z zapisano metodo: ročni vnos, izpeljava iz referenčne
  skale (znana dolžina v kadru) ali AR globina z manifestom senzorja.
- Več mer iste osi → konsolidacija; odstopanje >15 % = izrecen KONFLIKT, ne tiho povprečje
  (`consolidateMeasures` `core:785`).
- Kritična mera brez dokaza ne gre v kosovnico (izdaja kosovnic teče iz tekača/merilnega
  engine-a — prepoznava jih NE piše).

### DEPTH (AR globina)
- WebXR **immersive-ar samo** (Chrome/Android, ARCore depth-sensing); **iOS Safari pošteno NI
  podprto** (`depth-adapter.ts:5-10`, razlog vrnjen sondo `:107`) — gumb se ne prikaže, če
  naprava ne podpira seje (brez lažnega obljubljanja).
- Točnost je **odvisna od naprave** (ARCore na procesorju/kameri posameznega telefona); v
  peskovniku NI izmerjena — veljavnost 0 < d ≤ 8 m je strukturna, metrološka natančnost čaka
  teren (§3).

### Splošno
- Zanka teče ~4 Hz na sliki ≤320 px — zaznava je pomoč, ne merilni inštrument; NEZNANO in
  NEJASNO sta prvorazredna stanja in se dejansko uporabljata.
- Opozorila o kakovosti kadra (temno/mehko/presočeno) iz `nextStepGuidance` (`core:978`)
  vplivajo na prikazana priporočila (»posnemite znova«).

## 3. Testni protokol za terensko validacijo (kar čaka uporabnika)

Namen: pošteno zapolniti §12 točki 9–10 (rezultati po razredih/napravah; mobilna odzivnost).
Izvaja ga monter/vodja na resničnem objektu; trajanje ~2–3 ure na lokacijo. **Brez tega
protokola izdaje ne smemo razglasiti za terensko potrjene.**

### 3.1 Naprave (najmanjši nabor)
1. **1× Android s podporo ARCore depth** (npr. novejši Pixel/Samsung mid+; preveri
   `g.co/ardevices`) → s tem telefonom preveri gumb »AR globina« v AR modulu.
2. **1× običajen telefon BREZ depth** (katerikoli Android) → potrdi, da gumba »AR globina« NI
   in da je razlog izrisan pošteno.
3. **iOS (iPhone, Safari) — če je na voljo**: pričakovano nič globine; preveri, da aplikacija
   deluje in da je sporočilo »ni podprto« vidno, ne pa sesutje.

### 3.2 Nabor scen (vsaj 1 poskus na vrsto; kombiniraj z vejami)
- **Podlage ×9 vrst**: beton, asfalt, tlak, zemlja, trava, gramoz, ploščice, les, + 1
  atipična (npr. epoksi). Po 3 sličice iz razdalje 2–4 m.
- **Tla**: ravna in očitno nagnjena (naklon prej izmeri z nivelirjem/digitalnim merilom).
- **Stopnice**: ravne; z podestom; neenakomerne; čelni pogled; poševen pogled; lamelna
  ograja poleg (kontrola lažnega pozitiva).
- **Ograje**: stebri+lamele; ročaj+spodnji lef; lamelna stapnica; ograja samo iz stebrov
  (pričakovano NEZNANO — potrdi, da se NI izmislila).
- **Ovire/zakritja**: oseba v gibanju pred ograjo; majajoča rastlina; predmet na tleh.
- **Svetloba**: sonce z ostro senco; megla/oblačno; mokro (odsev); umetna svetloba v večer.

### 3.3 Referenčne mere (pred testom na vsaki lokaciji)
Vsak testni objekt ročno izmeri in zapiši: dolžino/širino/višino (metrska letva ali laserski
daljnomer ±2 mm), naklon tal (digitalni nivelir ±0,5°), število nastopov stopnic in njihove
višine (merilni trak). Te vrednosti so **referenca**, s katero primerjaš izpise aplikacije.

### 3.4 Postopek na objektu (korak-po-korak)
1. Prijavi se v aplikacijo (monter), odpri **OPERATIVA → AR**, izberi projekt.
2. Vklopi kamero; usmeri na testni objekt; počakaj 5 s (stabilizacija oznak).
3. Zapiši v obrazec §3.6: razrede, ki so prikazani (max 4 oznake), stanje zaupanja, guidance
   vrstico spodaj, ali je razred PRAVILEN glede na referenco.
4. Tapni vsak zaznani element → preveri obris/vrsto; popraviti, če je napačno (shrani popravek).
5. Za mere: poskusi vse tri metode (ročni vnos / referenčna skala / AR globina) in zapiši
   razliko vsake proti referenci v cm (%).
6. Za naklon: primerjaj oceno aplikacije z nivelirjem (v °); preizkusi tudi vnos z ročnim
   nagibom telefona >15° (aplikacija mora zavrniti oceno).
7. Sledi protokolu o nezadostnih podatkih (ploščica »Nezadostni podatki — kaj zdaj?« pod
   predogledom): dodaten pogled z drugega kota, referenčna mera, ročna označba roba — zapiši,
   ali je po korakih razred/mera postala uporabna.
8. Ponovi v drugi svetlobi/mokrem tiru (isti objekt, druga veja obrazca).

### 3.5 Tehnična opazovanja (vsak telefon, 10-min seja)
- **Odzivnost**: čas od tapa do odprtega elementa (občutek: takoj/sprejemljivo/počasno);
  zatikanje oznak med gibanjem kamere.
- **Guverner**: ali se po ~5 min zveznega delovanja slika očitno umiri (daljša osvežitev,
  manjša slika) — to je NAČRTOVANA degradacija; zapiši, kdaj se je začela.
- **Segrevanje/baterija**: hrbet telefona na dotik (hladno/toplo/vroče); približen % baterije
  na 10 min (nastavitve → baterija).
- **Offline**: letalski način — AR modul odprt, zaznava teče? (Zaznava je lokalna in mora
  teči brez povezave; shranjevanje zajema čaka povezavo.)

### 3.6 Obrazec za zapis rezultatov (vodi VODJA; po razredu, NE povprečje)
```
Datum/lokacija: …  Naprava: … (ARCore depth: DA/NE)  Temperatura/svetloba: …
Razred (TLA/PODLAGA/OGRAJA/STOPNICA/ROB/OSEBA/OVIRA): …
  Pogoj (suho/mokro/sonce/senca): …
  Prikazan razred … / pravilen razred …  → zadetek DA/NE
  Zaupanje prikazano: …  Guidance vrstica: …
  Mera (metoda …): aplikacija … cm / referenca … cm → odstopanje … % 
  Naklon: ocena …° / nivelir …°
  Tehnika: odzivnost …, guverner …, toplota …, baterija …/10min, offline DA/NE
  Opombe (kaj je zamudila / kaj si izmislila): …
```
Zapis se shrani ob projekt (opomba na zajemu ali interni dokument) — rezultati se vnesejo v
issue #8 kot povzetek PO razredih in napravah.

### 3.7 Sprejemni pragovi (usmeritev, ne avtomatika)
- Razred pravilen v ≥80 % poskusov po razredu in napravi → hevristika ostane.
- Sistematičen lažni pozitiv (isti vzorec v ≥3 poskusih) → kandidat za popravek v naslednji
  reviziji (vzorec + sličica v issue).
- Odstopanje mere z referenčno skalo ≤5 % → sprejemljivo; >5 % vedno → ročna izmera.
- AR globina: odstopanje od laserske reference v cm zapiši po razdalji (1/2/5 m); ARCore
  točnost je odvisna od naprave — ne sklepaj o drugih telefonih iz enega.

## 4. Presoja §12 Definition of Done

| # | Zahteva (skrajšano) | Ocena | Utemeljitev |
|---|---|---|---|
| 1 | Audit na main pove, kaj deluje/kaj novo | ✅ | F0 komentar (6096763027) + ta dokument §1 po fazah z `file:line`. |
| 2 | Kamera realnočasovno označi dogovorjene razrede; NEZNANO se uporablja | ✅ | `scene-perception.ts` ~4 Hz + `SceneOverlay`; NEZNANO prvorazredno (§2 »brez dokaza → NEZNANA«). Resnični objekti: glej §3. |
| 3 | Monter tapne, preveri, popravi, sproži izmero | ✅ | Kartica elementa `ar.tsx:871-1308`: vir (ROCNO/VLM/hevristika), popravek razreda/vrste, mere z 3 metodami. |
| 4 | Tla/ravnine/stopnice/nagib/mere ločeni izhodi z lastno metodo in stanjem | ✅ | Vsak razred lastna hevristika (maska/črte/monotonost/osi); GEOM_STATUSES (`IZMERJENO` samo z metodo) `core:71`. |
| 5 | Fizične dimenzije niso potrjene brez globine/reference/kalibracije | ✅ | Osi brez cm (`ar.tsx:1057-1058`); cm samo z referenco/ročno/DEPTH_AR z manifestom; konflikti >15 % izrecni. |
| 6 | Oseba samo za sceno/zakritost; brez identifikacije | ✅ | OSEBA živi v živem prizoru, izpuščena iz AR posnetkov (sanitizacija r470/G), brez obraza/ID; `personHeightNote` samo opomba. |
| 7 | Deluje brez oblačnega AI/LLM; slab model ne ustavi ročne izmere | ✅ | Celotna zaznava lokalna (Sobel/histogram); VLM je NEOBAVEZEN dodatek (`POST /api/ar/analyze`, ob napakah 502/429 monter nadaljuje ročno). |
| 8 | Licence knjižnic/uteži primernе | ✅ | Odvisnosti: samo obstoječe (MIT/Apache-2.0/ISC, 0 copyleft); ML uteži NI dodanih (prihodnja opcija §5). |
| 9 | Rezultati natančnosti po razredih/okoljih/napravah | ⛔ **ČAKA** | V peskovniku ni fizičnih naprav. Protokol §3 (nabor scen, reference, obrazec) je pripravljen in čaka izvedbo na terenu. |
| 10 | Mobilni test: odzivnost, FPS, viri, toplota, offline | 🟡 delno | Guverner degradacije enotsko testiran (`r481` vzorec `nextPerfPlan` v r471) + offline zajem obstaja; IZMERJENE vrednosti (FPS/toplota/baterija) čakajo teren (§3.5). |
| 11 | Testi z dejanskimi izidi/omejitvami; ne trdimo, da kamera vidi vse | ✅ | 287 kontrol scene suite z zelenimi/temno opisanimi mejami; §2 tega dokumenta izrecno našteva, česa kamera NE vidi. |
| 12 | Integrirano v obstoječi tok, brez podvajanja | ✅ | Živi v AR modulu (OPERATIVA → AR); hrani se v obstoječih AR posnetkih + tekač/merilni engine/katalog/AR sistem NISO podvojeni. |

**Sklep:** 10/12 točk pošteno zelenih, točki 9–10 terenski (⛔/🟡). Issue #8 ostaja odprt
dokler terenska validacija ne potrdi ali popravi omejitev iz §2.

## 5. Prihodnje izboljšave (brez obljub)

1. **Navpični detektor stebrov** — periodičnost navpičnih črt → OGRAJA iz stebrov brez
   vodoravnih črt (danes NEZNANO, §2).
2. **Detekcija obeh robov vsake lamele** — pari črt z majhnim razmakom → širina lamele iz
   kadra (danes enolični niz → OGRAJA brez mere).
3. **WebXR depth na več naprav** — ARCore depth-api točkovni oblaki (zasnova v
   `docs/PROSTOR-9.md` §3); iOS ostaja izven (platforma ne ponuja WebXR-AR).
4. **ML segmentacija on-device** (MediaPipe/ONNX, Apache-2.0) kot LOČENA faza z lastno izdajo —
   uteži bi zahtevale lastno licenčno preveritev (F0/F1 komentarji #8).
5. **Ekspliciten preklop ŽIVO/PREPOZNANO/MERE/PREGLED** — danes so to sloji (živi overlay
   vedno + mere v kartici izbranega elementa), ne preklop; §9 ga omenja, DoD ga ne zahteva.
6. **Vodena navodila širom programa** — issue #11 SMART GUIDE (onboarding tok); ploščica
   »Nezadostni podatki« v AR (R483) je NAMENOMA samo kontekstna pomoč tega modula, ne začetek
   splošnega sistema pomoči.

---

*Dokumenti: `docs/SMART-VISION-8.md` (ta) · sorodni: `docs/AUDIT-9.md` (F0 issue #9),
`docs/PROSTOR-9.md` §3 (senzorji). Testi: `tests/r467–r471.py`, `tests/r483.py`
(CI skupini `r465-r474`, `r483`).*

# Merilni baseline — issue #15 faza 0

**Datum:** 13. 10. 2026 · **Nalog:** R500 (issue #15, faze 0–8)
**Veja ob začetku:** `varnostni-popravki-2026-10` · **HEAD:** `ff56f07`
**Oddaljena veja:** `origin/varnostni-popravki-2026-10` = `ff56f07` (usklajeno)
**`origin/main`:** `b8882a5`. Lokalna veja `main` je ostala na `f90af46` po promociji R499
in se je ne uporablja za delo; ne prepisuje se.
**Delovno drevo ob začetku:** `M public/assets/roksal/src/MANIFEST.json` —
`git diff --numstat` pokaže 0 dodanih in 0 odstranjenih vrstic, torej gre izključno za
CRLF/LF šum; vsebina je identična. Drugih nedokončanih sprememb (tujenega dela) v drevesu
ni bilo.

## Pravila dokaza, ki veljajo za ta dokument

Naveden je samo izraz, ki je bil **prebran v kodi** (poklicana funkcija — komentar ali ime
modula ni dokaz) in ki ga vsaj en test **dejansko izvede**. Kjer test veje ne doseže,
piše NEPREVERJENO. Kjer koda trdi več, kot zmore, piše približek in je v §5 zapisano, kaj
to pomeni za rezultat monterja.

---

## 2. Prekrivanje z obstoječimi issueji (da se kaj ne podvoji)

| Issue | Stanje | Konkretno prekrivanje z #15 |
|---|---|---|
| #3 Field Capture 2.0 | zaprt | Kalibracijske metode so že v `measure-engine.ts:30–38` (`CALIB_METHODS`), statistika strinjanja pogledov v `:244` (`multiViewStats`), konfliktna vrata v `api/measurement/confirm/route.ts:275`. #15 §7 (KPI natančnosti) je torej **delno** pokrit: metodni del obstaja, meritve napake proti fizični referenci ni. |
| #4 Field AR + replay | zaprt | `src/lib/depth-adapter.ts` je tanka WebXR plast (`getDepthInformation` :62), `ar.tsx:399–421` jo pozove. Faza 4 #15 sme to samo **povezati** v vodeni zajem, ne pisati znova. |
| #6 Originalna gradiva | zaprt | `ProductAsset` (`prisma/schema.prisma:906–939`, status `VERIFIED/NEEDS_REVIEW/MISSING/NOT_AUTHORIZED`) + matrika pokritosti (`api/product-assets/route.ts:14–49`) + `public/assets/roksal/src/` (~77 dejanskih ROKSAL datotek s `sha256`). #14 in faza 6 #15 uporabita **ta** vir; novega sistema sredstev ne bo. |
| #7 Monterjev potek | odprt | R486 je dokazal celoten tok na telefonu (komentar na issueju, `tests/r486.py`). Faza 4 #15 ne sme zgraditi druge kamere — nadgrajuje se `meritve-kamera.tsx`. |
| #8 Smart Vision | zaprt | `scene-understanding-core.ts` in `ar.tsx` (ročne oznake, razredi prizora). #15 se dotakne samo determinističnih QA meril, ne prepoznavanja scene. |
| #9 HOVER parity | zaprt | `digital-twin`, `model.tsx`, izvozi. Faza 3 #15 (pravi 3D) je eden od pogojev, ki jih #9 predpostavlja — zato H4 spodaj. |
| #10 CI temelj | zaprt | Vrata so lokalno izvedljiva (`tests/ci-local.sh`, `tests/toolshim.sh`); faza 8 se zanaša nanje in ne zmanjšuje nobenega pravila. |
| #14 Fotovizualizacija | odprt | `photo-replace-core.ts:174–192` (`homografijaIzQuada`) že vsebuje **pravo perspektivno homografijo** (DLT sistem 8×8, Gausova eliminacija `resisiSistem` :151–166). Faza 1 #15 to uporabi kot dokaz, da umeritev planarne ravnine v kodi že obstaja, in je ne piše dvakrat. |

---

## 3. Tok ene meritve — dejanska izvedba po korakih

| # | Korak | Datoteka : vrstica | Poklicano | Test, ki to izvede | Status |
|---|---|---|---|---|---|
| 1 | Zajem (kamera ali naložena slika) | `meritve-kamera.tsx:112–136`, `:581–620` | normalizacija na `MAX_IMG_W` → canvas; pikselni prostor = `img.naturalWidth/Height` | `r486.py` (E2E brskalnik 390×844) | IMPLEMENTIRANO + PREIZKUŠENO (headless; pravi fotoaparat NE) |
| 2 | QA kadra (svetlost, ostrina) | `meritve-kamera.tsx:150–164` | Laplaceova variacija → `blurScore`, `dark`, `bright` | `r457`, `r461` | IMPLEMENTIRANO + PREIZKUŠENO |
| 3 | Kalibracija | `measure-engine.ts:41–48` (`EngineCalib`), UI `:913` | `{px, cm, imgW, imgH, method, refObject}` | `r455`, `r457`, `r487` | IMPLEMENTIRANO, a z enim globalnim merilom → H1 |
| 4 | Geometrija | `measure-engine.ts:131` / `:179` / `:218` | `computeGeometry`, `polygonMetrics`, `diagonalMetrics` | `r457` (HTTP), `r487` odsek D (čiste funkcije prek `bun -e`) | IMPLEMENTIRANO + PREIZKUŠENO, a planarno → H1, H7 |
| 5 | Validacija | `measure-engine.ts:254` | `validateGeometry` (npr. `MANJKA_KALIBRACIJA`, `POVSRSINA_NICLA`, `ZUNAJ_OBMOCJA`, `ROCA_AUTO_ODSTOPANJE`) | `r457` B/I | IMPLEMENTIRANO + PREIZKUŠENO |
| 6 | Vodilo zajema | `measure-engine.ts:566` | `captureGuide` (BLUR / LIGHT / TILT / REF / COVERAGE) | `r457` | IMPLEMENTIRANO + PREIZKUŠENO |
| 7 | Zaupanje | `measure-engine.ts:536` | `computeConfidence` | `r457` | IMPLEMENTIRANO, a ni napaka meritve → H5 |
| 8 | Analiza na strežniku | `api/measure-engine/analyze/route.ts:107–137` | `runAnalysis`; kalibracija je **obvezna** (`:108` → 400) | `r457`, `r460:358`, `r461:518` | IMPLEMENTIRANO + PREIZKUŠENO |
| 9 | Potrditev → baza | `api/measurement/confirm/route.ts:138–146`, `:250–279` | `db.measurement.create` + `computeGeometry`/`multiViewStats` za poglede (409 ob konfliktu) | `r455`, `r487` B1–B7 | IMPLEMENTIRANO + PREIZKUŠENO, a vrata ne preverjajo kalibracije → H2 |
| 10 | Provenanca meritve | `schema.prisma:300–327` (`Measurement`) | `params` JSON: `points`, `calibration`, `confidence`, `multiView`, `engine` | `r487` C (verzije, revizija, CSV/JSON izvoz) | DELNO — `status` stolpca ni → H3 |
| 11 | Kosovnica | `lib/product-core.ts:379` → `lib/segment-bom.ts:148` | `planBom` / `segmentLinesForComponent` | `r462`, `r464-pricing`, `r495` | IMPLEMENTIRANO + PREIZKUŠENO, a brez pogoja po statusu → H2 |
| 12 | Ponudba / PDF | `api/quotes/route.ts:82–102`, `api/pdf/[type]/[id]/route.ts:577` | `plan` vrstice; `unverified` je samo besedilo v PDF-ju | `r488` (merilni paket), `r464-pricing` | DELNO → H2 |
| 13 | Fotovizualizacija | `photo-replace-core.ts:174` (`homografijaIzQuada`), `:536–574` (odstranitev) | perspektivna preslikava + `blur(7px)` preliv, ne obnova slike | `r459` (91 trditev), `r480`, `r484` | IMPLEMENTIRANO za perspektivo, približek za ozadje in teksturo → H9, #14 |

Potrditev (korak 9) ni edina vstopna točka v bazo: `api/sync/route.ts:156` in `:288` imata
paralelno pot za offline zajem, zato mora vsako pravilo iz faz 1–2 veljati na **obeh**
mestih (sinhronizacijo pokriva `r439`).

---

## 4. Izmerjeno stanje pred spremembami (faza 0)

Pogoji: lokalni PG `:54329`, `AUTH_RATE_MAX=100000`, dev strežnik na `:3000`,
`bash tests/ci-matrix.sh <skupina>`:

| Skupina | Rezultat |
|---|---|
| `r454-r458` | 5/5 ✓ (vključno r457: 82 trditev ✓) |
| `r459-r462` | 4/4 ✓ (91 trditev ✓) |
| `r465-r474` | 8/8 ✓ (37 trditev ✓ v povzetku skupine) |
| `r487` | 1/1 ✓ (71 trditev ✓) |

Merilni del je bil torej **zelen pred katerokoli spremembo engine-a**; brez te referenčne
točke spremembe faz 1–7 ne bi bile merljive. Podrobni izpisi so v `worklog.md` (R500).

---

## 5. Dokazani približki in nevarnosti (vhod za fazi 1 in 2)

**H1 — eno globalno merilo za celotno fotografijo.** `measure-engine.ts:133`, `:181`,
`:221`: `cmPerPx = calib.px > 0 ? calib.cm / calib.px : 1`. (a) Pri nagnjeni sliki je
merilo odvisno od globine in lege v kadru; eno samo razmerje se uporabi za vse točke,
tudi za tiste zunaj ravnine reference. (b) Privzeta `1` pomeni, da iz nezveljavljenega
vhoda nastane številka v centimetrih, ki je videti kot mera. `computeGeometry` neposredno
klicata še `api/measurement/confirm/route.ts:110` in `api/railing-layout/route.ts:95`;
oba pazita na `px/cm > 0`, ne pa na to, **kateri ravnini** referenca pripada.

**H2 — proizvodna vrata ne preverjajo kalibracije.** `api/measurement/confirm/route.ts:144`
zahteva samo `lengthCm > 0`; `params.calibration` je opcija (`:289–300`). `planBom`
(`product-core.ts:390`) filtrira izključno `lengthCm > 0`, `RawSegmentRow`
(`segment-bom.ts:235–239`) sploh nima polja `status`. `criticalGate`
(`capture-qa-engine.ts:487–541`, vključno `hasCalibration` :519 in `proizvodnja` :529) se
kliče samo za prikaz (`capture-qa-service.ts:200`, `:625`) in ničesar ne zadrži. Edina trda
vrata so `api/fence-run/[id]/confirm/route.ts:48–61` (409 pod `MANUAL`) in veljajo samo za
tekač. **Fotomeritev brez referenčne mere lahko danes pride do kosovnice in ponudbe.**

**H3 — fotomeritev nima statusa.** `Measurement` (`schema.prisma:300–327`) hrani `source`
(`ROCNO|KAMERA`) in `confidence` v `params`, nima pa `statusa`. Pogodba
`ESTIMATED…CONFIRMED` obstaja samo za segmente tekača (`fence-run-engine.ts:146–155`);
`model.tsx:49–54` že barvno predpostavlja isto lestvico za vizualizacijo. Kalibracijski
besednjak je podvojen (`measure-engine.ts:30` in `fence-run-engine.ts:83`) — ID-ji se
ujemajo, metapodatki ne (`desc` proti `base`).

**H4 — koda trdi fotogrametrijo, ki je ni.** `recommendMethod` (`measure-engine.ts:653–661`)
vrne `FOTOGRAMETRIJA` in besedilo »iz več fotografij istega objekta **rekonstruiramo
geometrijo**«, če naprava javlja `orientation && webgl` (`:657`). Iskanje po vsej kodi in
testih (`fotogrametrija|photogrammetry|structure-from-motion|COLMAP`) ne vrne nobenega
izsledka: **SfM veriga ne obstaja**. Več fotografij se zdaj združi samo s povprečjem
dolžin (`multiViewStats:244`) — to je statistika strinjanja, ne rekonstrukcija. To krši
#15 §3 in #7 §7 (nobeno lažno »3D izmerjeno«).

**H5 — zaupanje ni napaka.** `computeConfidence` (`:536–562`) sešteva točke za metodo,
kakovost in strinjanje; rezultat se v UI in izvozu piše kot »zaupanje X %«
(`meritve-kamera.tsx:948`, `measure-engine.ts:789`). 80 % je heuristika, ne verjetnost, da
je mera znotraj 1 %. #15 §2 in §7 zahtevata tri ločene količine: kakovost fotografije,
heuristiko zaupanja in **empirično napako** — te tretje ni.

**H6 — naklon strehe je privzet in prikazan kot izmerjen.** `analyzeDomain` STREHA
(`:481`): če `pitchDeg` manjka, je `35`; nato `faceAreaM2 = footprint / cos(pitch)`
(`:483`), izvoz pa to zapiše kot »Naklon 35°« (`:827`) brez vira. #15 §5 (strehe) to
izrecno prepoveduje.

**H7 — višinske razlike iz navpičnice slike.** `heightDiffCm = dy * cmPerPx` (`:145`; enako
`api/railing-layout/route.ts:37` in `meritve-kamera.tsx:198`). To drži **samo**, če merjena
črta leži v navpični ravnini, vzporedni s slikovno ravnino; pri perspektivi je
sistematično napačno. Posledično so napačno utemeljeni `STOPNICE` (`:503–516`, vzpon in
čežnost iz `dy`/`dx` prvega segmenta) in `slopeDeg` (`:902`).

**H8 — orientacija (EXIF) se ne preverja.** Pikselni prostor je
`img.naturalWidth/Height` (`meritve-kamera.tsx:587`, `:620`), prikazana slika pa nastane z
`drawImage` na canvasu (`:112–136`). Če brskalnik uporabi EXIF orientacijo za piksle, ne pa
za `natural*` dimenzije (ali obratno), se koordinatni prostor in slika zavrtita za 90°.
Preverjanja tega para ni in orientacija se ne shrani v `params` — zaznano kot
NEPREVERJENO, ne kot delujoče.

**H9 — originalne ROKSAL teksture niso povezane s fotomontažo (#14).** Homografija
obstaja, risba pa je vektorska s trdo kodiranimi barvami (`photo-replace-core.ts:30–38`
RAL→hex, prelivi `:614–621`, steklo `rgba(170,196,214,.30)` :725). V
`photo-replace-core.ts`, `photo-replace-engine.ts`, `foto-replace.tsx` in
`api/photo-visualization/**` ni nobenega klika na `ProductAsset` ali
`public/assets/roksal`. Maskiranje so 4 klikane točke; odstranitev stare ograje je
`ctx.filter='blur(7px)'` in preliv (`:536–574`).

### 5.1 Napredek — kaj je Faza 1 zaprla (mera: `tests/r500.py`, 70 trditev ✓)

Ta pododdelek je dodan PO fazi 1; zgornji H seznam ostaja kot izmerjena
baseline iz faze 0 in se ne prepisuje.

| Nevarnost | Stanje po fazi 1 | Dokaz |
|---|---|---|
| H1 (b) tiha rezerva `1` | **ZAPRTO** | `resolveScale` vrne `known:false`/`NEZNANO`, geometrija vrne 0 in `cmPerPx null`; `r500` A, J |
| H1 (a) eno merilo za vse smeri | **DELNO** | anizotropno `pxY/cmY` je podprto v jedru, `/analyze` in `/confirm`; `railing-layout/route.ts` ima še svoj izračun, `View.calib` v UI-ju Y reference še ne zna vnesti → fazi 2 |
| H5 zaupanje ≠ točnost | **DELNO** | `validity` (status + `businessMeasureAllowed` + stanja po količinah) je ločen od `confidence`; `criticalGate` še vedno ničesar ne zadrži |
| H6 35° privzet naklon | **ZAPRTO** (prikaz) | `STREHA.pitchSource = VNOS/PRIVZET`; `r500` F — številka 14,65 m² ostane enaka |
| H7 višina iz Δy | **ZAPRTO** (trditev) | `VISINA` je vedno `NEZADOSTNI_PODATKI` («projekcija, ne izmerjena višina»), `STOPNICE.heightBasis = PROJEKCIJA_SLIKE`; `r500` E |
| H2/H3 vrata in `status` | **ODPRTO** | `validity` se izračuna in shrani v `params.engine`, a ga noben ustvarjalni endpoint (BOM/ponudba) še ne preverja; stolpca `status` v `Measurement` ni → fazi 2 |
| H8 EXIF orientacija | **ODPRTO** | faza 4–5 |
| H9 teksture ↮ fotomontaža | **ODPRTO** | #14 |

Regresija, izmerjena ob zaključku faze 1 (lokalna baza :54329): `r454-r458`
5/5 ✓, `r459-r462` 4/4 ✓ (91 trditev), `r486` ✓ 70, `r487` ✓ 71,
`r500` ✓ 70 / ✗ 0 — nobena številka obstoječih kontraktov se ni premaknila.

### 5.2 Napredek — kaj je Faza 2 zaprla (mera: `tests/r501.py`, 131 trditev ✓)

Pododdelek dodan PO fazi 2; §5 in §5.1 ostaneta kot izmerjena baseline.

**Enotna kalibracijska pogodba (`kalibracija/2.0`).** `parseCalibration`,
`parseEnginePoints`, `pointsForStorage`, `viewForStorage`, `viewLengthCm`,
`consolidateViews`, `deriveProvenance` in `deriveMeasurementStatus` so edni parse-i;
`/analyze`, `/confirm`, `/sync`, `/measurements`, `railing-layout`, `fence-run-engine`,
`meritve-kamera.tsx` in `meritve.tsx` jih samo kličejo. Veljavnost te trditve ni
prepuščena pregledu: `r501` K odsek z regexom dokaže, da v naštetih plasteh ni več
lastnega `cm/px` izračuna, `r500` J pa, da `/analyze` nima več svojega `parseCalib`.
Ločena Y referenca je dokazana **čez HTTP** (`POST /api/measure-engine/analyze` →
`scale.basis = ANIZOTROPNO`, X 0,25 in Y 0,125 cm/px).

**Strežniško izračunani statusi.** `Measurement.status` + `statusNote`
(`prisma/schema.prisma:322–323`, migracija
`prisma/migrations/20261019000000_r501_measurement_status`), lestvica in oznaki v jedru,
odjemalčeva trditev (`body.engine`) za stanje NI vir. Vrata poslovne mere so na eni točki
(`measurementStatusAllowsBusiness`): `project-packages/[id]/bom` → 409 za ESTIMATED,
200 po pisarniški potrditvi, spet 409 po razveljavitvi; odvisni paketi se ponovno
ovrednoteno (`r501` G, I). Stanje je vidljivo v CSV izvozu, na javni povezavi (samo
`statusLabel`, ne interne obrazložitve) in v plošči provenience.

**Ustvarjalne poti morajo zapisati stanje (regresija, ki jo je ujel relejni pas).**
Prvi celotni zagon po fazi 2 je bil rdeč (`r488`): štiri poti
(`fence-run/[id]/confirm`, `measure/photo`, `sync` fotozapis, `measurements`
FOTO-brez-geometrije) so zapisale meritvo brez `status`, prazno polje pa je prevzelo
privzetek stolpca `ESTIMATED`. Nova poslovna vrata so nato — pravilno — zavrgla
kosovnico iz potrjenega tekača, kar se je v r488 pokazalo kot veriga
`segmentsApplied None` → `kosovnica POTRJEN 404` → `BOM_ID None`. Jedro zato zdaj
izračuna stanje tudi tam, kjer slikovnih točk ni: `segmentLadderProvenance`
(odloča najšibkejši člen tekača; stanje izven lestvice pade na ESTIMATED) in
`photoRecordProvenance` (fotografski zapis je ocena, ne mera). `SEGMENT_STATUSES.order`
v `fence-run-engine.ts` bere `MEASUREMENT_STATUS_ORDER` iz istega jedra — dve lestvici
z istimi imeni bi bila dva vira resnice. Pravilo je zajeto strojno: `r501` K pobriše
vse `db.measurement.create` v `src/` in zahteva, da vsak nastavi `status`.

| Nevarnost | Stanje po fazi 2 | Dokaz / omejitev |
|---|---|---|
| H2 proizvodna vrata brez kalibracije | **ZAPRTO** | BOM 409 za oceno/predlog/razveljavljeno; fail-closed tudi za neznano/prazno stanje (`r501` C, G) |
| H3 fotomeritev nima statusa | **ZAPRTO** | `status`/`statusNote` v bazi, izpeljavo računa strežnik, zgodovina verzij ga nosi (`r501` B, E, I) |
| H1 (a) eno merilo za vse smeri | **DELNO** | pogodba in HTTP ga podpirata; **kamera UI še nima vnosnega polja za pxY/cmY** → fazi 4–5 |
| H5 zaupanje ≠ točnost | **DELNO** | `validity` in `status` sta ločena in vidna; `criticalGate` (`capture-qa-engine.ts`) še vedno ničesar ne zadrži |
| H4 trjena fotogrametrija | **ODPRTO** | faza 3 |
| H7/H8 (EXIF, višine) | **ODPRTO** | fazi 4–5 |
| H9 teksture ↮ fotomontaža | **ODPRTO** | #14 |

**Trije resnični defekti, ki jih je našla faza 2 (ne napak v testih):**
1. `measurementStatusAllowsBusiness` je bil fail-**open** za stanje, ki ga lestvica ne
   pozna — nov stolpec v bazi bi tiho odprl vrata poslovne mere. Zdaj fail-closed v obe
   smeri.
2. `consolidateViews` je imel en izraz za dve različni stvari: *viden podatek*
   (razpršenost > 15 %) in *vrata*. Posledica: offline (`/sync`) je zavračal tudi
   konflikte, rešene z ročnim popravkom z razlogom, torej je bil teren strožji od
   pisarne in monter ni mogel oddati zares izmerjene dolžine. Jedro zdaj vrača
   `conflict` (vedno resničen) in `blocked` (vrata), oba endpointa uporabita `blocked`.
3. Pisarniški klik »Potrdi« je bil nedelujoč: `PATCH /api/measurements/[id]` je prazen
   patch (samo prehod stanja, brez polj) zavrnil z 400, preden je sploh izpeljal
   statusni prehod. Prehod je zdaj veljavna zahteva; 400 ostane samo, kadar ni početi
   ne polj ne prehoda.

**Residualne omejitve, ki jih faza 2 NI odpravila (pošteno):**
- **Produkcija še nima migracije.** `20261019000000_r501_measurement_status` je izvedena
  samo proti lokalnemu PG (`:54329`). Dokler je ne potrdi lastnik (Neon — po dogovoru
  ne sme ga poganjati agent), koda te veje v produkciji NE SME biti deployana;
  brez stolpca bi bile vse merilne route-e 500.
- Statusna lestvica je **enonsčna**: prehod, ki ga je izračunal strežnik, lahko ročno
  popravi samo pisarna (`quotes.approve`), Monterjeva ročna pot pa je zapisati
  `manualOverride` z razlogom (r455) — ta ostane VELJAVNA rešitev, ne zaobhod vrata.
- `consolidateViews` meri razpršenost pogledov, ne geometrijske drži: dva napačna
  pogleda se lahko strinjata (H4 ostaja).
- Javna povezava (`/api/public/measure`) prikaže samo `statusLabel`; interne
  obrazložitve (`statusNote`, ki lahko imenuje ljudi) se ne razkrijejo — preverjeno v
  `r501` J.
- Odstotki natančnosti proti fizični referenci še vedno **ne obstajajo** (§6.1);
  dokazani so samo odnosi med zapisi, ne točnost.

Regresija po fazi 2 (lokalna baza :54329, `bash tests/ci-matrix.sh <skupina>`):
`r486` ✓ 70, `r487` ✓ 73, `r488` ✓ 65, `r489` ✓ 128, `r500` ✓ 76 / ✗ 0,
`r501` ✓ 131 / ✗ 0.

CELI RELEJNI PAS (`bash tests/ci-local.sh`, lastni strežnik, 13. 10. 2026):
**✓ zeleno — 8 statičnih korakov, 24 skupin, `GATE EXIT 0`**. Preskočenih zaradi
manjkajočih orodij je 6 testov (`r437.sh`, `r438.sh`, `r439.sh`, `r440.sh`,
`r441.sh` — jq/imagick/sqlite3; `r477.py`). Preskočen test ni dokaz o kodi; z
`STRICT_TOOLS=1` bi bili rdeči namesto preskočeni.

---

## 6. Kaj manjka za dokončanje (pošteno)

1. **Referenčni nabor (faza 7).** Pod `tests/fixtures` ni nič za merjenje natančnosti —
   manjkajo pooblaščene fotografije z **neodvisno fizično izmerjenimi** dimenzijami. Brez
   njih je vsaka trditev o odstotkih napake izmišljena.
2. **Fizična oprema:** Android telefon z LiDAR/depth, laserski merilnik, merilni trak.
   Lokalno okolje nima kamere; E2E je uporabil nalaganje datotek (`r486` je to pošteno
   zapisal).
3. **Odločitev o 3D poti:** COLMAP (BSD-3-Clause) je native binarni paket in ne more teči
   v Vercel serverless okolici. #15 to dovoljuje samo kot lokalni/offline dokazni
   protokol; odločitev mora biti zapisana, ne tiho predpostavljena.
4. **Inženirska tolerančna pravila:** `reality-r2p-engine.ts:304–334` (`TOLERANCE_RULE_KEYS`,
   `NO_TOLERANCE_MSG`) in `dvojcek.tsx:312` priznavajo, da pravila za toleranco
   dolžine/višine **ni**. Faza 7 potrebuje tolerance, ki jih potrdi odgovorna oseba.

## 7. Obveznost za faze 1–8

Faze smejo spremeniti **obseg** `measure-engine.ts` (veljavnost in nove obvezne
lastnosti), ne pa napisati novega merilnega ali cenovnega jedra. Vsaka sprememba
številk mora biti pokrita z numeričnim testom znane dimenzije (vzor: `tests/r487.py`
odsek D — čiste funkcije pod `bun -e`) in mora obdržati obstoječe izvoze
(`buildExportRows`, `exportCsv`) ter obstoječe HTTP kontrakte, razen kadar kontrakt sam
širi varnostna vrata (potem to utemelji in testiraj).

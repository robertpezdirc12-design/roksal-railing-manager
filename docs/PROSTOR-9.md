# PROSTOR #9 — Notranji prostori: AUDIT in ZASNOVA (R481, issue #9 §8)

**Datum:** R481 · **Revizija kode:** main = R481 (lokalni commit nad 0d4fc79, tag v1.36.0) · **Produkcija:** v1.34.0 (fbfa578)
**Metoda:** dobesedno branje §8 (GitHub issue #9) + read-only pregled kode z dokazi `file:line`
(dovirja: `src/lib/measure-engine.ts`, `src/lib/capture-qa-engine.ts`, `src/components/roksal/modules/zajem.tsx`,
`src/lib/depth-adapter.ts`, `src/lib/model-core.ts`, AUDIT-9.md §4, docs/E2E-RESULTS.json).
**Izhodišče:** AUDIT-9.md (R472 Faza 0) §4 vrstica »§8 ❌ PROSTOR = foto-poligon — odkrito«; stanje od R472
NI spremenilo notranjih prostorov (R473–R481 so dostavili §3, §5–§7, §9, §10).

> **Sklep vodil (pred dokumentom):** §8 zahteva »izvedi audit« in »ZASNUJ« — ne implementacije.
> Ta dokument je audit + zasnova + odkrite odločitve. Nobena koda za notranje prostore ni bila dodana;
> obstoječa pokritost (izvozi, model, zajem) je dokumentirana s točnimi potmi.

---

## 1. AUDIT — kaj način PROSTOR danes JE

**PROSTOR je eden od 7 foto-merilnih načinov** (`MeasureMode` v `measure-engine.ts:27`:
OGRAJA | KERAMIKA | STREHA | FASADA | STOPNICE | PROSTOR | SPLOSNO) — merjenje **točk na FOTOGRAFIJI**:

| Vidik | Stanje (dokaz) |
|---|---|
| Konfiguracija načina | `measure-engine.ts:99-101` — PROSTOR: »Površina, obseg, diagonale, kontrola pravokotnosti« |
| Domena izračuna | `ProstorDomain` (`measure-engine.ts:395-402`): `areaM2`, `perimeterCm`, `diagonals[]`, `rectangleOk`, `closureCm` — ČISTO 2D poligon |
| Jedro analize | `analyzeDomain` case `'PROSTOR'` (`measure-engine.ts:493-499`): `polygonMetrics` (površina/obseg/zaprtje iz točk na SLIKI + kalibracija) + `diagonalMetrics` + `rectangleOk` (diagonali se ujemata ≤ 1 % → pravokotnost DA/NE) |
| UI | `meritve-kamera.tsx:254-261` izpiše Površina/Obseg/Diagonale/Pravokotnost |
| Svetovna geometrija | ❌ NE — slikovne točke → kalibracija → cm; ni XY/XYZ koordinat prostora |
| Tloris | ❌ NE iz PROSTOR-a (zunanji tloris obstaja v model-core R473 — iz tekača, glej §4) |
| 3D / 360° ogled | ❌ NE |
| Povezane fotografije prostora | 🟡 delno — cone zajema (§2), a BREZ prostorske povezave med posnetki |
| Zajem med hojo (samodejno zbiranje) | ❌ NE — ročna hoja ob tekaču, ročno pripenjanje fotografij |
| SLAM / sledenje poz kamere | ❌ NE |
| Prepoznava sten/vrat/oken/omar/tal | ❌ NE (in §5 sklep: NE DODAJATI) |

**Potrjeno pošteno:** AUDIT-9 §4 (R472) je že zapisal ❌; današnje branje kode potrjuje, da se stanje
ni spremenilo. PROSTOR je **merilno orodje na posamezni fotografiji**, ne skeniranje prostora.

## 2. ZASNOVA — zajem med hojo (§8 točka 2: »zasnuj«, ne izvedi)

Besedilo §8 zahteva: *vodene pogledi, povezava fotografij, prostorska konsistenca, tloris, ročno
popravljiva geometrija*. Kaj ŽE obstaja in kaj bi bilo treba dodati:

| Zahteva §8 | Stanje danes | Zasnova (brez implementacije) |
|---|---|---|
| Vodeni pogledi iz tekača | ✅ OBSTOJA: capture plan gradi postanke IZ FenceRun vozlišč (`capture-qa-engine.ts:151-200`): start, vogal-i, vrata-i, stopnišče, ref-i, teren, podlaga, coverage, kalibracija, konec (KAMERA mode: objekt levi/sredina/desni) | Uporabiti obstoječi plan kot vodilo — NI novega planerja |
| Povezava fotografij | 🟡 ROČNA: monter pripne posnetek na cono (`addPhoto(zone)` — `zajem.tsx:756`); `CapturePhoto.zone` = logični id postanka (schema `:1738`) | Zasnova: ob zajemu zabeležiti TUDI zaporedje (korak hoje) → tabela povezav cona↔posnetek↔sosede; brez svetovnih koordinat |
| Prostorska konsistenca | 🟡 posredno: drift v cm po tekaču (CaptureReference/registration R462), referenčna mreža | **Omejitev (pošteno):** zvezne poz kamere NI na voljo brez ARCore/WebXR zvezne seje; IMU/Kalman pot pomikanja v brskalniku ni zanesljiva → konsistenca OSTANE na referencah + driftu; NE obljubljati »SLAM« |
| Tloris | ✅ za ZUNANJE ograje: `model-core.ts` (R473 §3) — svetovne XY iz tekača, projekcije tloris/profil/3D | Notranji tloris bi izhajal iz istega modela SAMO ob zvezni poz — za zdaj NI |
| Ročno popravljiva geometrija | ✅ OBSTOJA: izbire LEVO/DESNO po vogalih + gumb Zrcali (`model.tsx:290-305`, `model-core.ts:38,440-449`); odkrito opozorilo, da tekač ne beleži smeri zavojev (`model-core.ts:247`) | Nič dodati — vzorec ostaja referenca za prihodnje popravke |

**Zakaj NE izvajati v R481:** brez zveznega sledenja poz (WebXR immersive-ar na Chrome/Android omogoča
LE enkratne dvotapne meritve — `depth-adapter.ts`, R471) bi bil »zajem med hojo« LAGANJE. Odločitev #8/#9:
nikoli ne izmišljaj podatkov; nezajeto je vidno označeno.

## 3. LOČITEV NAČINOV — brez LiDAR/depth vs s senzorjem (§8 točka 3)

| Način | Stanje | Pot naprej (zasnova) |
|---|---|---|
| **BREZ senzorja** (sedanji privzeti tok) | ✅ izmera po tekaču + referenčne točke (miknik/laser/znana mera) + PROSTOR/KERAMIKA foto-merjenje z kalibracijo | Ostaja vir resnice; nič ne manjka za obstoječe produkte |
| **WebXR depth (ARCore, Chrome/Android)** | ✅ dvotapna razdalja (R471: `depth-adapter.ts` — optionalFeature `depth-sensing`, cpu-optimized; globina veljavna 0 < d ≤ 8 m; seja SAMO med aktivno mero ≤ 60 s) | Za notranjost: zvezna poz-seja bi zahtevala novo platformno odločitev + testiranje na referenčnih napravah (issue #8 §11 Faza 4 ostaja okvir) |
| **iOS Safari** | ❌ NE podpira WebXR-AR (izrecna odločitev issue #8 §0: napredne zmožnosti SAMO ob dejanski podpori naprave) | Native iOS adapter NI načrtovan (potrebe ni) |
| **LiDAR točkovni oblaki (ARCore Depth API)** | 🟡 ARCore depth lahko ponuja depth-sensing tokove; adapter danes porabi SAMO dvotapno razdaljo | Zasnova adapterja: razširiti `depth-adapter.ts` o `depth-api` (float/point-cloud vrste) → izvoz globinske slike na posnetek; ŠE VEDNO brez zvezne SLAM gradnje |

## 4. Notranja geometrija (§8 točka 4) — SKLEP: NE

Besedilo §8: dodaj stene/vrata/okna/tla/omare **SAMO, če obstaja potrjena metoda prepoznave in merjenja.**

- **Potrjene metode NI.** `scene-perception.ts` / `scene-understanding-core.ts` pokrivata tla/naklon
  na PROSTEM (AR razredi prizora), NE prepoznave notranjih elementov. Brez ML modela v brskalniku
  (odločitev: brez npm knjižnic za zajem) in brez zvezne poz je »prepoznava« ugibanje.
- **Lažna prepoznava je NEVARNA** — mere iz PROSTOR/KERAMIKA gredo v proizvodnjo (odrezni seznami,
  naročila materiala). Napačna širina vrat = napačen izdelek. To ni prikazovalna funkcija.
- **SKLEP:** notranje geometrije NE dodajamo. Če bo kdaj potrjena metoda (npr. partnerjev ARCore
  depth-cloud + človekova potrditev vsake stene), jo dodamo kot LOČENO fazo z lastnimi preverjanji —
  vzorec: človek POTRDI vsak element (kot verifiedCm v tekaču), nikoli samodejno.

## 5. Izvoz meritev/skice za keramiko in povezano delo (§8 točka 5) — ŽE POKRITO

§8: »omogoči izvoz … kadar projekt potrebuje keramiko, notranje obloge ali drugo povezano delo.«
**Nič novega ni treba graditi — točne obstoječe poti:**

| Pot | Vsebina |
|---|---|
| Način KERAMIKA (`measure-engine.ts` :27, konfiguracija :79-80) | »Prostor, površina, ploščice, rezi, odpad« — položaj plošč (širina/višina/fuga/vzorec/odprtine, `:321-325`), izračun materiala |
| `GET /api/measure-engine/export?id=<measurementId>&format=csv\|json` | CSV (podpično, UTF-8 BOM za Excel) / JSON izvoz meritve — vključno PROSTOR in KERAMIKA (`measure-engine.ts:732,825`) |
| `GET /api/pdf/measure/[fenceRunId]` (R477, tip `measure` v `/api/pdf/[type]/[id]`) | merilni paket PDF `measure-package-pdf/1.0`: tloris z dimenzijami + montažna skica + tabele + odrezni seznam + fotografije + list preverjanj |
| `GET /api/export/[bom\|quote]/[id]?format=csv\|xlsx\|json` (R477) | kosovnice/ponudbe z vidnimi inženirskimi preverjanji (CSV `# OPOZORILO`, XLSX list Preverjanja, JSON `checks[]`) |
| `POST /api/import/[bom\|quote]` (R478) | round-trip uvoz z diff in varovalkami |

## 6. Xactimate / zavarovalniška poravnava (§8 točka 6) — SKLEP: NE

§8 izrecno: *»Ne razširjaj na notranje zavarovalniško poravnavo/Xactimate samo zaradi funkcionalnega
pariteta, dokler ni potrjena poslovna potreba ROKSAL-a.«* **Poslovne potrebe NI** (ROKSAL = ograje /
terase / fasade / keramika; odškodninski tok ni poslovni model). **Zavrnjeno** — dokler stranka
izrecno ne zahteva in pogodbeno potrdi.

## 7. Priporočila za prihodnost (čista zasnova, BREZ obljub)

1. Če bo potreba po notranjem zajemu: začeti z **zaporedjem posnetkov po planu** (brez poz) +
   ročno vezavo na cono (že obstaja) — minimalna, poštena razširitev.
2. WebXR zvezna poz-seja SAMO kot ločena faza z lastno izdajo, testirana na referenčnih Android
   napravah (precedens depth-adapter R471); iOS ostaja izrecno izven.
3. Vsak nov vir mere nosi `verifiedCm` + metodo + vir (vzorec tekača); nezajeto je vidno označeno.
4. Notranja geometrija SAMO kot potrjevalni tok (človek potrdi vsak element) — nikoli samodejno.
5. Pred vsako implementacijo posodobiti ta audit (vzorec AUDIT-9 → PROSTOR-9 posodobitveni cikel).

---

*Dokazi: file:line reference zbrane z neposrednim branjem kode R481 (main). Sorodni dokumenti:
`docs/AUDIT-9.md` (Faza 0, §4 vrstica §8), `docs/INTEGRATIONS-9.md` (§9), `docs/webhooks.md` (R481).*

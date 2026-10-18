# Roksal Railing Manager

Poslovno-operativni sistem za Roksal — od prvega voda do zaključene montaže ograj,
fasad in teras: CRM, ponudbe s podpisom, proizvodnja, teren (tudi brez signala),
računi in **fotomontaža PREJ/POTEM** iz uradnih Roksalovih gradiv.

> **Stanje:** rekonstrukcija zaključena in presežena · izdaja **v1.69.0** ·
> **56 testnih skupin + E2E skozi pravo aplikacijo** · GitHub je kanonični vir
> (zadeve + release vrata), GitLab zrcalo, sinhronizacija po SHA (`ops/sync-check.sh`) ·
> [docs/](docs/) vsebuje poročila za vsako fazo.

---

## Zgodovina v desetih stavkih

1. **Izvirnik** (~430 iteracij, R120–R430) je bil razvit v Z.ai kontejnerjih in
   sinhroniziran na GitHub; račun/repo je bil izbrisan 6. 10. 2026.
2. **Recovery** (isti večer): iz Vercel deploymentov so bili rešeni vsi rešljivi
   artefakti — popolna karta rut, RBAC katalog, IA register, build logi, statika
   (glej `docs/RECOVERY-REPORT.md`, `docs/ROUTE-MAP.md`).
3. **Rekonstrukcija** (R431–R439): funkcionalna izgradnja iz blueprinta —
   vsi moduli, RBAC, terenski tok, offline PWA, portal stranke (dogodbeno
   `README-REKONSTRUKCIJA.md` iz tega obdobja).
4. **Nadaljnji razvoj** (R440–R534): kakovost, varnost, fotomontaža (GitLab
   issue #14), harmonizacija barv (R532), enoten vir kode po SHA (GitHub #20,
   R533), varnostna utrditev pred produkcijo (GitHub #21, R534: seed-varovalo,
   atomska namestitev, SHA-256 seje, izklop query-dnevnika).
5. **Utrditev po reviziji v1.58.0** (R535–R540, šest sklopov): ErrorBoundary +
   MONTER obseg + 29 FK indeksov (R535); tempomat v bazi + zaklepanje računa +
   scrypt N=2¹⁷ + zod validacija + CSP Report-Only (R536); transakcijski outbox
   in razbitje velikih modulov (R537); sejni piškotek httpOnly (R538);
   transakcijska celovitost preostalih družin (R539); zadnji ostanki — dvojček,
   kodne dirke PR-/SRV-/OR- (R540). Belt 8 statičnih + 47 skupin.
6. **Podatkovna celovitost statusnih polj (R541, izdaja v1.60.0):** 36 CHECK
   omejitev v bazi (množice = shemski komentarji ∪ pisni kraji ∪ dejanske
   vrednosti, inventura R541-a) + zod enumeracija statusa projekta
   (`PROJECT_STATUSES` — edina 2 surovi pass-through kraja zaprta, neveljaven
   status → 400) + testna skupina r541 (48. skupina). Belt 8 statičnih + 48
   skupin.
7. **JSON stolpci postanejo pravi jsonb (R542, izdaja v1.61.0):** 42
   JSON-v-TEXT stolpcev pretvorjenih v pravi `jsonb` v eni migraciji (NULLIF
   varovalka; izključitvi `WebhookDelivery.payload` za HMAC in
   `Setting.value` za skalarni KV), zod zaprtje 3 surovih prehodov (niz →
   400 s slovenskim sporočilom), API pogodba niz→objekt atomarno s frontendom
   (pisanja, branja, rute, seedi). Testna skupina r542 (49. skupina).
   Belt 8 statičnih + 49 skupin.
8. **CSP enforce način + poročila v bazo (R543, izdaja v1.62.0):** politiko
   gradi en vir `src/lib/csp.ts` — privzeto Report-Only (nespremenjeno),
   izvršilni način je env stikalo `CSP_MODE=enforce`; popravek `frame-src
   'self' blob:` (PDF predogled), `frame-ancestors` samo izrecno
   (`CSP_FRAME_ANCESTORS`), `unsafe-eval` samo v razvoju; poročila se
   zapisujejo v tabelo `CspReport` (raw kot jsonb objekt, job `csp-gc` briše
   > 7 dni) — opazovalno obdobje je izmerljivo; `src/instrumentation.ts`
   opozori na `DEMO_ACCESS=on` v produkciji. Testna skupina r543
   (50. skupina). Belt 8 statičnih + 50 skupin.
9. **PWA deep-linking + zgodovina (R544, izdaja v1.63.0):** URL odraz
   zavihka `/?m=<id>` (nov čist lib `src/lib/deep-link.ts`; sekcijo izpelje
   `sectionForTab` iz ENEGA vira `nav-registry`) — mobilne bližznice iz
   manifesta (Danes/Nalogi/Meritve/Projekti) zdaj odprejo PRIPADNI modul,
   ne golo "/"; URL zmaga nad persistom ob zagonu (globoka povezava deluje
   tudi po prijavi — LoginScreen ne navigira, `?m` preživi); vsak klik
   navigacije naredi `pushState` → BACK gumb odvija preklope (prej 0
   zgodovine); neveljaven/nedovoljen `?m` → fail-closed `clearTabState`
   (modulska vrata ostajajo glavna obramba). Testna skupina r544
   (51. skupina). Belt 8 statičnih + 51 skupin.
10. **CSP poročila — ADMIN pregled (R545, izdaja v1.64.0):** zanka
   R536→R543→R545 je zaključena — poročila brskalnikov o kršitvah politike
   so zdaj vidna V aplikaciji: `GET /api/csp-reports` (vrata
   `security.read` = ADMIN) vrača povzetek (skupno/24h/7d, razčlenbo po
   direktivah in straneh, trenutni način `report`/`enforce`) + zadnja
   poročila BREZ `raw` telesa; `DELETE` pobriše vso diagnostiko
   atomarno z revizijo `CSP_REPORTS_CLEAR`; novi zavihek **CSP poročila**
   v sekciji Varnost (42. zavihek) s praznim stanjem, ki pove pomen
   („0 kršitev — opazovalno obdobje je čisto“ = znak za preklop v
   Enforce) in opombo o 7-dnevnem TTL (job `csp-gc`). Testna skupina
   r545 (52. skupina). Belt 8 statičnih + 52 skupin.
11. **Razbitje velikanov (R546, izdaja v1.65.0):** trije največji moduli —
   konfigurator (1752 vrstic), pregled (1728) in projekti (1642) — so
   kirurško razbiti v 12 poddatotek BREZ spremembe obnašanja (refactoring:
   0 novih odvisnosti, 0 DB sprememb): `konfigurator-{shared,steps,meritve}`
   (glavni 643), `pregled-{shared,views,cards,share}` (glavni 507),
   `projekti-{shared,sections,packages,portal,bom}` (glavni 232).
   Enosmerno-uvozni graf (shared = list, 0 krožnih), nalagalnik modulov
   NEDOTAKNJEN (poddatoteke so gradniki, ne zavihki), sidra sosednjih
   skupin (r488 segmenti tekača, r511 vir obsega, r464 cenovne konstante)
   so sledila novi strukturi pošteno. Testna skupina r546
   (53. skupina). Belt 8 statičnih + 53 skupin.
12. **Razbitje srednjih modulov (R547, izdaja v1.66.0):** naslednja trojka —
   zajem (1372), servis (1283) in ogradnja (1211) — po istem receptu razbita v
   14 poddatotek (zajem 161, servis 53, ogradnja 157): `zajem-{shared,new,qa,geo,
   replay,detail}` (detail je podkoren, ki sestavlja geo/qa/replay),
   `servis-{shared,garancije,reklamacije,primeri}`, `ogradnja-{shared,carovnik,
   verify,detail}` (3-nivojski aciklični graf: carovnik nad verify, verify nad
   shared). Sidro r486 (shrinkThumb/„Dodaj posnetek") je sledilo premiku v
   zajem-detail pošteno. Testna skupina r547 (54. skupina).
   Belt 8 statičnih + 54 skupin.
13. **Razbitje naslednje vrste (R548, izdaja v1.67.0):** katalog (1099), danes
   (1096), viz (1061) in nalogi (1057) po istem receptu razbiti v 14 poddatotek
   (katalog 43, danes 207, viz 731, nalogi 304): `katalog-{shared,izdelki,ceniki,
   gradiva}`, `danes-{shared,detail,sekcije,vreme}` (detail je podkoren — sestavlja
   sekcije + kamera dialog; PlaybookStrip v detail, sicer krog kartice→detail),
   `viz-{shared,risanje}` (viz main ostane ~731 — koheziven stanjski del, prag
   <760; kirurško izrezano risalno jedro computeGeometry/RailingSvg),
   `nalogi-{shared,detail,offline,create}`. Sidra r486 (danes blok), r493/r494/
   r516 (katalog družina — negativna »samodejn« na vseh 5 datotekah) so sledila
   premikom pošteno; r464-pricing OSTAJA na viz.tsx in JE preživel razbitje
   (strežniški klic cenika ni bil odnesen). Testna skupina r548 (55. skupina).
   Belt 8 statičnih + 55 skupin.
14. **Razbitje zadnje vrste (R549, izdaja v1.68.0):** playbook (971), dostave
   (931) in montaza-qa (850) po istem receptu razbiti v 15 poddatotek
   (playbook 59, dostave 46, montaza-qa 22): `playbook-{shared,home,run,korak,
   admin}` (main = izbira pogleda; run sestavi korak), `dostave-{shared,tab,
   detail,nova,vozila,ekipe}` (main = zavihki; tab sestavi detail + nova),
   `montaza-qa-{shared,kontrola,odstopanja,primopredaja}` (main = BAREL —
   javni API `MontazaQaSection`/`HandoverSection` za danes-detail ostaja na
   isti poti). **meritve-kamera (902) je zavedna izjema** (kot viz 731): R537
   je že izvlekla 15 poddatotek, preostali main je EN komponent s ~13 closures
   nad skupnim stanjem — hook-ekstrakcija ni bajtno-identična; 39 sidr v 9
   testih ostaja nedotaknjenih. 0 testnih sidr se je premaknilo (noben test
   ni sidril teh treh modulov — preverjeno pred rezom). Testna skupina r549
   (56. skupina). Belt 8 statičnih + 56 skupin.
15. **Kamera nad gravom (R550, izdaja v1.69.0):** primerjava z najboljšimi
   implementacijami na spletu (web.dev PTZ, Chrome Image Capture samples,
   Dynamsoft, webrtchacks, MDN) je odkrila ŠEST VRZELI — vse zaprte po
   disciplini poštenja (PODPRTO/NI_PODPRE/NI_DOKAZA): **zoom** (drsnik z
   razponom IZKLJUČNO iz `getCapabilities().zoom`, prikaz mnogokratnika
   najmanjšega približanja, tihi uspeh/napaka se pove), **resolucija toka**
   (`width/height {ideal: 1920/1080}` — brez tega brskalnik pogosto ponudi
   640×480, kar je za merilne točke preslabo; zajem sedaj pade na 1600 namesto
   640), **zrcaljenje predogleda** sprednje kamere (`-scale-x-100`; zajem
   ostaja ne-zrcaljen — točke/meritve fizično pravilne), **shutter odziv**
   (beli blisk 180 ms + `navigator.vibrate(25)` po najboljši zmožnosti),
   **napake po imenu** (NotAllowed/NotFound/NotReadable/Overconstrained/
   Security — vsak s svojim UKREPOM iz MDN, ne generična »kamera ni
   dosegljiva«) in **tap-to-focus** (focusMode/pointsOfInterest, Chrome
   Android — POSKUS ne dokaz; obroč 700 ms). `ImageCapture.takePhoto()` se
   NAMERNO ne uporabi: polna ločljivost senzorja ni preview-pariteta (druga
   izrez), za merilne fotografije je pariteta pomembnejša od megapikselov.
   Lib razširjen (`zoomRazpon`, `nastaviZoom`, `poskusiOstrenje`,
   `razloziNapakoKamere`); sidra 9 kamer skupin (r486/r487/r500/r501/r503/
   r508/r509/r513/r522) nedotaknjena. Testna skupina r550 (57. skupina).
   Belt 8 statičnih + 57 skupin.

## Kaj aplikacija počne

Informacijska arhitektura (IA R448) — **11 sekcij, 42 zavihkov**, vsak z vrati
(`src/lib/nav-registry.ts`):

| Sekcija | Vsebina |
|---|---|
| **DANES** | operativni vhod: današnji nalogi, terenski tok (ZAČNI DELO → ZAJEM → PREVERI → ZAKLJUČI TEREN), vreme za teren |
| **PROJEKTI** | preglednica KPI, projekti (+ garancija, portal stranke), stranke, ponudbe (sprejem, podpis → zaklep posla), računi + plačila (eSLOG XML izvoz), nalogi (+ globalna zgodovina dogodkov), teren |
| **ZAJEM** | nalogi center s časovnico, meritve (večtočkovne s kamero), foto zajem, nagib kalkulator, kalkulator ponudbe, signatura, vizualizacija (parametrična SVG), AR, **fotomontaža** |
| **PISARNA** | CRM (vodi + pipeline), dokumenti, zaloga (losi, sprejem), katalog, proizvodnja (+ kontrola kakovosti), logistika, Material V5 (BOM), orodjarina, galerija, varnost (revizija, seje, vzdrževanje, licenca), PDF, PostSig |
| **PROFIL** | profil (sprememba gesla), dovoljenja po vlogi, tema, odjava |

Poslovni tok: **vod → priložnost → ponudba → podpis stranke → račun → plačila →
proizvodni nalog → teren → garancija** — vse z revizijo in RBAC obsegom
(monter vidi samo svoje, fail-closed).

### Fotomontaža PREJ/POTEM (issue #14)

Uporabnik naloži fotografijo, označi 4 vogale obstoječe ograje/fasade, prednji
plan in referenco (220 cm) → izbere Roksalov izdelek in odtenek → **PREJ/POTEM**.

- **Gradiva samo preverjena:** tekstura iz `ProductAsset.filePath` (izvirniki v
  `public/assets/roksal/src/`, vsak z SHA-256 v `MANIFEST.json` — 116 vnosov);
  DETAJL čipi površine so izrezani iz **uradnih barvnih lestvic** v izvirni
  ločljivosti (KUBO ×4, ograje ×24 — R523/R524), vlakna usmerjena po izmeri
  anizotropije. Brez preverjenega gradiva → barvni preliv z izrecnim opozorilom
  `PREKRIVANJE_NI_ODSTRANITEV`, nikoli tiha izmišljotina.
- **Mere iz kataloga, ne »lepe« številke:** širina iz imena izdelka, reža iz
  `tech.razmakDeskMm`, terasna reža iz uradnega FAQ, KUBO 80×42 iz uradnega lista.
- **Perspektiva iz označenih kotov:** homografija na mrežo celic, svetlost
  ocenjena iz fotografije, determinizem (mulberry32 seme) — enaki vhodi → enak
  izris.
- **Prednji plan riše zadnji iz originalnih pikslov** — rastlinje, stebri,
  ležalniki nikoli niso prekriti.
- **Poštena meja:** pikslov, ki jih obnova ozadja ne doseže, se šrafira;
  `zahtevaRočniPoseg` pove, kdaj masko zožati. Izris nosi žig
  »VIZUALIZACIJA ZA PREDSTAVITEV«.
- Pogonik ENGINE **1.4.0** (`src/lib/photo-replace-*.ts`) — od R532 tudi
  **harmonizacija barv prizora**: vezani barvni namig iz pasov neba/tal
  (nevtralen prizor pusti barvo izdelka nedotaknjeno, meja ±22/kanal,
  deterministično, brez AI; raziskava
  [`docs/RAZISKAVA-IZBOLJSAVE-2026-10.md`](docs/RAZISKAVA-IZBOLJSAVE-2026-10.md));
  celotno odkritenje
  poročilo: [`docs/FOTOZAMENJAVA-POROCILO-14.md`](docs/FOTOZAMENJAVA-POROCILO-14.md).

## Varnost

- **RBAC:** 38 pravic, 5 vlog (ADMIN, VODJA, MONTER 15, SKLADIŠČE 9,
  PROIZVODNJA 10) — `src/lib/permissions-core.ts`; plačila ločena od računov
  (R425), revizija sistemsko/per-projekt z `readsAllProjects` (R428).
- **Zaščiten `main`:** direktni push onemogočen, merge samo skozi MR z zelenim
  CI; tagi `v*` zavarovani + GitLab Releases.
- **CI vratarji:** lint → `tsc --noEmit` → `prisma validate` + db push na prazno
  bazo → **skrivnostni pregled delovne kopije in celotne zgodovine**
  (`ops/secret-audit.sh`) → sintaksa ops skript.
- **Varnostne glave** (HSTS, X-Frame-Options, Referrer-Policy, …), omejitev
  prijav na IP, seje kot nosilni žetoni `Authorization: Bearer` **ali httpOnly
  piškotek `roksal_session`** (R538 — XSS iz shrambe ne more izluščiti žetona;
  programska Bearer pot nespremenjena) — v bazi je
  shranjena SAMO SHA-256 zgoščena oblika, veljavnost **7 dni**, preklic z
  odjavo/spremembo gesla/pregledom sej; stara (nezgoščena) zapisa se ob
  prvem branju samodejno nadgradijo (R534, issue #21).

### Zaščita produkcijskih podatkov (R534, issue #21)

- **Destruktivni demo-seed ima večplastno varovalo** (`prisma/seed-guard.cjs`):
  zavrne (1) `NODE_ENV=production`, (2) ne-lokalnega gostitelja iz
  `DATABASE_URL` (Neon/Supabase/RDS …; prehod zavednega interne testne baze:
  `SEED_ALLOW_REMOTE=YES_I_ACCEPT_REMOTE_SEED`), (3) manjkajočo izrecno
  potrditev `SEED_CONFIRM=YES_DEMO_DATA`, (4) **oznako produkcije v sami
  bazi** — vrstica `Setting 'system.production'`, ki jo lastnik postavi z
  `PRODUCTION_MARK=YES DATABASE_URL=<produkcija> bun run db:mark-production`;
  napačno okolje je ne more odstraniti. Varnost velja za `db:seed`,
  `db:seed:test` in `db:reset`.
- **Prva namestitev je atomarna:** `POST /api/setup` prevzame administracijo v
  eni transakciji — `Setting` vrstica s primarnim ključem je zahteva
  lastništva; dve hkratni zahtevi ne moreta ustvariti dveh adminov (zmagovalka
  commita, druga prejme 403). Demo-seed zapiše isto vrstico — delno pobrisana
  baza ne more ponovno odpreti javnih vrat.
- **Query-dnevnik Prisma je privzeto IZKLOPLJEN** (samo `error`+`warn`);
  diagnostika je opt-in (`PRISMA_LOG_QUERIES=1`), časovno omejena (privzeto
  15 min, `PRISMA_LOG_QUERIES_MS`) in izpisuje SAMO SQL-besedilo in trajanje —
  nikoli vrednosti parametrov.

### Transakcijska in podatkovna celovitost, utrditev prijav (R535–R542)

Po temeljiti reviziji v1.58.0 je sledilo osem sklopov popravkov po prioriteti
tveganja:

- **Vse poslovne verige z več pisanji so ATOMARNE (~140 rut, R537–R540):**
  mutacija + revizija + dogodek-outbox v ENI `$transaction`; obvestila
  (IN_APP/EMAIL/SMS/WHATSAPP) in webhook dostava tečejo PO commitu
  (ognjevareno — padec dostave ne razveljavi posla). `retryOnUnique` SAMO
  okoli cele transakcije (P2002 znotraj PG transakcije je neobnovljiv);
  generirane kode (N-, PR-, SRV-, REK-, DEL-, PAK- …) se berejo znotraj tx.
  Zavestno izpuščene (dokumentirano v testih): logout, administrativna
  orodja, SAGA/kompenzacijske poti.
- **Avtentikacija (R536):** porazdeljeni tempomat v bazi (prijave na IP,
  odporen na restart), zaklepanje računa po zaporednih neuspelih prijavah,
  scrypt N=2¹⁷ s transparentno nadgradnjo starejših hashov ob prijavi.
- **Vhodna validacija (R536/R538/R541/R542):** zod sheme po API-ju — napačen vnos
  nikoli ne pride do baze (R541: status projekta enumeriran prek
  `PROJECT_STATUSES`, neveljaven → 400; R542: `params`/`analysis` sprejemata
  SAMO JSON objekt — niz → 400).
- **CSP (R536 → R545):** politiko gradi en vir `src/lib/csp.ts`; privzeto
  teče **Report-Only** glava (opazovalno obdobje nadaljuje), preklop v
  izvršilno `Content-Security-Policy` je env stikalo `CSP_MODE=enforce`
  (dokumentirano v `config/ENV-VARS.md`). R543: `frame-src 'self' blob:`
  popravi PDF predogled (blob: v iframe bi podedoval `default-src 'self'`
  in bil blokiran), `frame-ancestors` je privzeto IZPUŠČEN (vgrajeni
  predogled bi ga prelomil; clickjacking zaščita teče prek
  `X-Frame-Options: SAMEORIGIN`, izrecna vrednost prek
  `CSP_FRAME_ANCESTORS`), `unsafe-eval` samo v razvoju. Poročila se
  **zapisujejo v bazo** (tabela `CspReport`, `raw` kot jsonb objekt —
  konvencija R542; job `csp-gc` briše > 7 dni) — opazovalno obdobje je
  končno izmerljivo, odločitev o preklopu pa je na pregledu zbranih
  poročil, ne na ugibanju. R545: ADMIN zavihek **CSP poročila** (Varnost,
  `security.read`) pokaže povzetek + zadnja poročila (`GET
  /api/csp-reports`, brez `raw` telesa), ročni izbris vse diagnostike je
  reviziran (`CSP_REPORTS_CLEAR`); prazna tabela je znak za varan preklop
  v Enforce.
- **ErrorBoundary + 29 manjkajočih FK indeksov** (R535) — padec modula ne
  zruši celotne aplikacije; poizvedbe po tujih ključih ne delajo tabelnih
  pregledov.
- **CHECK omejitve statusnih polj (R541):** vsa statusna polja (36 modelov)
  imajo v bazi CHECK constraint z dovoljeno množico vrednosti (množice iz
  inventure R541-a: shemski komentarji ∪ pisni kraji v kodi ∪ dejanske
  vrednosti v bazi) — tudi če bi plast API-ja kdaj prespala, baza zavrne
  nedovoljeno vrednost. Prisma DSL ne pozna CHECK constraintov — ročno
  dopolnjena migracija je dokumentirana pot (`prisma migrate dev`
  ne-modeliranih objektov ne odstrani).
- **JSON stolpci kot pravi `jsonb` (R542):** 42 stolpcev, ki so de facto
  hranili JSON v TEXT tipu, je pretvorjenih v pravi `jsonb` v ENI migraciji
  (inventura R542-a: 100 % veljavnih vrednosti v živi bazi, `NULLIF`
  varovalka, NOT NULL ohranjen). API pogodba se je atomarno s frontendom
  prenesla z nizov na objekte (pisanja, branja, rute, seedi); zadnji 3 surovi
  prehodi (meritve `params` ×2, AR `analysis`/`params`) so zaprti z zod.
  Izključenitvi sta ostali TEXT po utemeljitvi: `WebhookDelivery.payload`
  (HMAC podpis nad dobesednimi bajti — niz je pogodba podpisa) in
  `Setting.value` (skalarni ključ-vrednost, ne JSON dokument).
- **Razbitje velikih modulov (R537):** meritve-kamera 3021 → 16 datotek,
  AR 2215 → 12, foto-replace 1953 → 7 (dobesedne selitve z dokazi).

## Zagon

```bash
bun install
bun run db:up                # lokalni PostgreSQL (embedded-postgres, :54329)
source env.sh                # DATABASE_URL (brez njega: privzeta zgoraj)
bunx prisma migrate deploy   # SHEMA samo prek migracij
SEED_CONFIRM=YES_DEMO_DATA bun run db:seed   # demo podatki (izrecna potrditev — varovalo R534)
bun run dev                  # http://localhost:3000
```

Začetna namestitev se pokaže sama, če v bazi ni uporabnikov (atomarna —
razdelek Varnost zgoraj). Demo računi (gesla NISO v README — glej
`prisma/seed.cjs`; namenjeni SAMO razvojnemu/testnemu okolju — na produkciji
lastnik prevzame prvo administracijo z lastnim močnim geslom, demo prijava pa
je onemogočena brez `DEMO_ACCESS=on`): `admin@roksal.si`, `vodja@roksal.si`,
`monter@roksal.si`, `skladisce@roksal.si`, `proizvodnja@roksal.si`. Gumbi za
hitro demo prijavo se izrišejo samo z `DEMO_ACCESS=on`.

## Testi in relejni pas

```bash
bash tests/ci-local.sh        # ENO VSTOPNO MESTO: typecheck + lint + migracije + seed
                              # + živa aplikacija + VSE skupine (50); logi v .ci-local-logs/
bash tests/ci-matrix.sh --list    # seznam skupin — edini vir resnice
bash tests/ci-matrix.sh r524       # ena skupina (točno tako jih poganja CI)
```

Disciplina dokazov: **E2E vedno skozi pravo aplikacijo** (prijava → nalaganje →
maska → izdelek → PREJ/POTEM → SHRANI → preverba zapisa v bazi → čiščenje) —
`ops/r5{17,18,20,22,23,24}-e2e.py`; izrisi in poročila v `ops/`. Baza za pas mora
biti lokalna (produkcija/Neon zavrnjena). Pogoji po OS (Windows: `python`,
ImageMagick, poppler) — podrobno v `tests/ci-local.sh` glavi.

## CI/CD

- **GitHub je kanonični vir** (`robertpezdirc12-design/roksal-railing-manager`,
  `origin`): tam živijo zadeve (issue tracker) in release vrata. GitLab
  (`markec-group1`) je **drugo zrcalo** — issuejev NE upravljamo tam (issue #20).
- **Sinhronizacija se dokazuje po SHA, ne po uspehu pusha:**
  `bash ops/sync-check.sh` primerja lokalni main + oznako izdaje proti OBEMA
  repozitorijema in izpiše OK/DRIFT/FAILED (izhod 0/1/2). Strojni test
  odkrivanja razhajanja: skupina `r533` namerno zastarelo zrcalo dokazuje brez
  omrežja (začasni repozitoriji). Po vsakem pushu na en sistem preveri še
  drugega — »sinhrono« brez preverjene SHA ni resnica.
- Po izčrpani mesečni kvoti skupnih runnerjev (R525) teče GitLab CI na
  **zasebnem shell runnerju** v peskovniku (R533: id 57490060; klon prek
  uradne možnosti `clone_url` iz lokalnega golega zrcala —
  `.zscripts/ci-mirror.sh sync|verify|ensure` — ker Cloudflare blokira git
  smart-HTTP z job-tokenom). Zasebni runner kvote **ne** porablja.
- **Release vrata (obvezna pred vsako izdajo):** relejni pas
  `bash tests/ci-local.sh` na TOČNO tistem commitu, ki se izdaja (8 statičnih
  korakov + vseh 52 skupin, EXIT 0), nato `bash ops/sync-check.sh` = OK na
  obeh sistemih, šele nato oznaka + push. GitLab pipeline (`verify`) je
  drugotna potrditev istega SHA — ne nadomestilo pasu.
- **Vercel (produkcija) — pošteno:** dostop je MOGOČ, a le z lastnikovim
  žetonom (dodeljen ob produkcjski sinhronizaciji 17. 10. 2026: push GitHub
  je sprožil samodejni deploy main → Vercel build poganja `prisma migrate
  deploy` v produkciji; tedaj so bili preverjeni Neon (17/17 migracij, 43
  jsonb stolpcev), odprt cron `CRON_SECRET` (6 jobov end-to-end) in
  odstranjena zastarela `ROKSAL_BUILD` oznaka). Brez žetona v peskovniku
  velja prejšnje pravilo: preverjanje po izdaji opravi lastnik — alias →
  `READY` na izdajnem SHA + `GET /api/public/health` na produkciji;
  enostavna preverba: `bash ops/deploy-status.sh` (USKLAJENO/ZASTARELO).
  Pri
  izdaji v1.56.0 je lastnik (issue #20) potrdil alias na d9bf4cf; stanje
  vsake izdaje se zapiše v worklog ob izdaji. GitHub Actions minute so
  izčrpane do 1. 11. 2026 — do takrat je relejni pas lokalni (dokaz v
  `ops/r5xx-pas.out`).
- Vzdrževalni cron: `vercel.json` → `GET /api/jobs/run` 03:30 UTC — odprl ga
  je `CRON_SECRET` na produkciji (17. 10. 2026, 6 jobov preverjenih
  end-to-end); brez njega vrata ostanejo zaprta (401, fail-closed).

## Varnostne kopije in obnovitvena pripravljenost

- `ops/backup.sh` → šifrirana `.rkb` (AES-256-CBC, PBKDF2 200k): cel repozitorij
  (`git bundle --all`) + posnetek baze + strojno berljiv JSON export + manifest s
  SHA-256 (za PostgreSQL v peskovniku pg_dump ni na voljo — kopija vsebuje zapiske;
  geslo ni v repozitoriju, glej `docs/SECRETS.md`).
- Off-site hramba: GitLab generic package registry (`roksal-backup`, zadnjih 10
  verzij). Obnova: `ops/restore.sh --verify` (kontrolne vsote, `git fsck`, prstni
  odtip sheme).
- **Recovery drill** (`ops/drill.sh`): obnova IZKLJUČNO iz off-site kopije → zagon
  → poslovni test; izmerjeno **RTO 65 s** (cilj ≤ 30 min), **RPO ~3,5 min**
  (cilj ≤ 24 h) — `docs/RECOVERY-DRILL-*.md`, `docs/RECOVERY.md` (runbook).

## Struktura repozitorija

| Pot | Vsebina |
|---|---|
| `src/app/api/` | 195 API rut (App Router) |
| `src/components/roksal/` | 50 modulov + ogrodje (app-shell, module-view) + 55 gradnikov razbitij (12 velikanov R546 + 14 srednjih R547 + 14 naslednje vrste R548 + 15 zadnje vrste `playbook/dostave/montaza-qa-*` R549) |
| `src/lib/` | 78 knjižnic: photo-replace-{mask,texture,core,engine}, permissions-core, nav-registry, audit, notify (outbox), json (jsonb pomožniki), csp (en vir CSP politike), deep-link (URL odraz zavihka), … |
| `prisma/` | shema (94 modelov) + 17 migracij + semenske skripte (`db:seed` veriga) |
| `public/assets/roksal/src/` | uradni Roksalovi viri, `MANIFEST.json` s SHA-256 |
| `tests/` | 57 skupin + `ci-local.sh` / `ci-matrix.sh` + fixtures |
| `ops/` | E2E skripte, izrisi-dokazi, backup/restore/drill, secret-audit |
| `docs/` | poročila po fazah (RECOVERY, FOTOZAMENJAVA, E2E, …) |
| `.zscripts/` | vzdrževanje peskovnika: dev-detach, git-retry, ci-mirror |

## Odprte točke

- **Vse GitHub zadeve so ZAPRTE po odločitvi lastnika (16. 10. 2026)** —
  zaključni komentarji vsake zadeve pošteno navajajo, kaj je dokazano in kaj
  ostaja zapisano. Oskrbne postavke (dejstva o uradnih virih, ne delovne
  naloge) ostajajo: scenski posnetek RWA 57/32 in `PROFIL_PRESEK` za
  POLNA/DESKA v uradnih virih **ne obstajata** (preverjeno R524); generični
  demo izdelki so **izrecno označeni** (R527 — »generični izdelek, ni
  ROKSALOV original« v izbiri, opozorilu, rezultatu POTEM, seznamu
  shranjenih in javnem pregledu stranke); ozadje rež KUBO je lastnikova
  odločitev; benchmark fizičnih meritev (faza 7) zahteva pravo napravo.
  Seznam v
  [`docs/FOTOZAMENJAVA-POROCILO-14.md`](docs/FOTOZAMENJAVA-POROCILO-14.md) §5.
- **Tehnični dolg — VSE ŠTIRI VRSTE razbite (R546–R549), kampanja zaključena.**
  Velikani (konfigurator/pregled/projekti), srednji (zajem/servis/ogradnja),
  naslednja vrsta (katalog/danes/viz/nalogi) in zadnja vrsta (playbook/dostave/
  montaza-qa) so razbiti — 55 gradnikov, vsi moduli pod 760. Dve ZAVEDNI
  izjemi ostajata dokumentirani: viz main ~731 in meritve-kamera ~902 (EN
  komponent s closures nad skupnim stanjem — hook-ekstrakcija ni
  bajtno-identična; disciplina recepta). Nadaljnje razbijanje po potrebi.
- **Revizija v1.58.0 (7,9/10) — Top-10 popravki izvedeni (R535–R543).** Še
  odprto za naslednje kroge (po prioriteti): CSP Enforce — zmožnost je
  pripravljena (`CSP_MODE=enforce`, `config/ENV-VARS.md`) in odločitev je
  opira na podatke: zavihek CSP poročila (R545) pokaže, kdaj je opazovalno
  obdobje na produkciji čisto (poročila se od R543 zbirajo v tabeli
  `CspReport`), `DEMO_ACCESS=on` v produkcjskem okolju (lastnikova
  odločitev ob namestitvi; ob zagonu strežnika ga zdaj glasno opozori
  `src/instrumentation.ts`).

## Tehnologija

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 + shadcn/ui · Prisma 6
PostgreSQL (lokalno embedded-postgres :54329, produkcija Neon) · zustand ·
lucide-react · PWA (manifest + sw.js, registracija samo v produkciji)

---

*Dokumentacija po fazah v [`docs/`](docs/) · delovni dnevnik v
[`worklog.md`](worklog.md) · zgodovinska readme rekonstrukcije:
[`README-REKONSTRUKCIJA.md`](README-REKONSTRUKCIJA.md)*

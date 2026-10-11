# RECOVERY-STATUS — dokazljiv popis reševanja izvirnega Roksala (issue #2)

> Revizija: R484 · 11. 10. 2026 · temelji: `main` = bf58a50 (tag v1.38.0, CI 14/14)
> Namen: **statusna revizija** — kaj je izgubljeno, kaj je rekonstruirano, kaj je
> rešeno kot artefakt, kaj je dokazljivo preverjeno in kaj čaka lastnika.
> NE nadomešča `docs/RECOVERY.md` (DR runbook, R441) ali `docs/RECOVERY-REPORT.md`
> (rekonstrukcija na nivoju API poti, R437) — ta dokument je POPIS STANJA virov.

**Ključna ugotovitev (pošteno):** izvirna koda revizij R120–R430 **ni dosegljiva in ni
bila obnovljena** (GitHub 404, GitLab račun blokiran, Vercel API nedosegljiv, ni forkov
ali PR-ov). Vsa živeča koda v `main` je **rekonstrukcija R431+** (165 commitov,
79e14f6 → bf58a50), ki se je razvila iz rešenih produkcijskih artefaktov in build loga.
Izvirnik ni več primerljiv — »OHRANJENO« v tej matriki pomeni **ohranjena funkcionalnost
v rekonstrukciji z dokazi**, ne identičnost z izvirnikom.

---

## 1. Povzetek dejansko preverjenega

Kaj je bilo preverjeno, kdaj (UTC, 11. 10. 2026) in s kakšnim rezultatom. Poizvedbe po
nedostopnih virih NISO bile ponavljane (omejitev iz issueja).

| # | Preverjanje | Kdaj (UTC) | Rezultat |
|---|---|---|---|
| 1 | GitHub API `GET /users/markec12345678` | 11. 10. 17:36 | **404** — izvirni račun izbrisan |
| 2 | GitHub API `GET /repos/markec12345678/Roksal-Railing-Manager` | 11. 10. 17:36 | **404** — izvirni repozitorij ne obstaja |
| 3 | GitHub iskanje repojev »Roksal-Railing-Manager« | 11. 10. 17:36 | 1 zadetek: `robertpezdirc12-design/roksal-railing-manager` (`fork: false`) — **0 forkov**, **0 PR-ov** (state=all) → izvirnih PR-jev ni mogoče rešiti |
| 4 | `git ls-remote` (GitHub PAT, token ni izpisan) | 11. 10. 17:36 | veje `main`=bf58a50, `r462-worklog`, `rekonstrukcija`; 41 tagov (v1.0.0–v1.38.0) — vsi iz dobe rekonstrukcije |
| 5 | GitLab `GET /api/v4/projects/markec-group%2Froksal-railing-manager` (anonimno, brskalniški UA) | 11. 10. 17:36 | **HTTP 403** »Blocked - GitLab« (Cloudflare blokada IP peskovnice) |
| 6 | GitLab `GET /api/v4/groups/markec-group` (anonimno) | 11. 10. 17:36 | **HTTP 403** — enako; račun `robert.pezdirc12` je GitLab blokiral 8. 10. ~20:35 (R462) |
| 7 | Vercel `HEAD https://roksal-railing-manager.vercel.app` | 11. 10. 17:36 | **200** — produkcija živa |
| 8 | Vercel `GET /api/health` (produkcija) | 11. 10. 17:36 | **200** `{"status":"ok","db":{"ok":true,…,"latencyMs":787}}` — baza povezana in zdrava; `app.version 0.2.1` je HARDCODED (health/route.ts:32) in NI indikator različice |
| 9 | Vercel izvirni R430-era chunk `_next/static/chunks/18cfb49e30bc37db.js` | 11. 10. 17:36 | **404** (novejši build ga je nadomestil); font woff2 → 200 |
| 10 | Lokalni pregled: `.env.recovery` v peskovnici | 11. 10. 17:36 | **NE OBSTAJA** → ni GITLAB_TOKEN niti ROKSAL_BACKUP_PASSPHRASE → overjene GitLab poizvedbe in odpiranje .rkb kopij iz peskovnice niso mogoče |
| 11 | Lokalni pregled: `prisma/migrations/`, `assets/`, `pages-samples/`, `.pgdata/`, git reflog | 11. 10. 17:36–17:42 | 9 migracij (od r464_init — izvirnih NI); artefakti v repu (5b141f7); .pgdata 72 MB živa dev baza; reflog: klon 10. 10. 21:14 |
| 12 | GitHub API — stanje issuejev #1–#12 | 11. 10. 17:53 | #1 ZAPRT, #4 ZAPRT, #10 ZAPRT; odprti: #2, #3, #5, #6, #7, #8, #9, #11, #12 |
| 13 | Lokalni dev `GET /api/public/health` (:3000) | 11. 10. 17:52 | **200** `{"ok":true,"db":"ok"}` (razvojna instanca, embedded PG :54329) |
| 14 | Varna kopija (Faza 0) — glej §5 | 11. 10. 17:55 | izvedena + preverjena (bundle verify, tar -tzf, JSON validnost, SHA-256) |

Vsi časi so UTC 11. 10. 2026. Preverjanja 1–9 in 11 je izvedel raziskovalni agent 1-a-R484
(read-only, brez sprememb); 12–14 izvajalni agent 2-a-R484 (ta revizija).

## 2. Viri in dostopnost

| Vir | Dostopnost | Vsebina | Datum / commit | Klasifikacija |
|---|---|---|---|---|
| **GitHub izvirnik** `markec12345678/Roksal-Railing-Manager` | ❌ NEDOSTOPEN (404 račun + repo; 0 forkov/PR) | izvirna koda R120–R430 (nikoli klonirana v peskovnico) | izbrisano (GitHub Support zahteva poslana, odgovor neznan) | **IZVIRNIK — IZGUBLJEN** |
| **GitLab** `markec-group/roksal-railing-manager` + off-site `.rkb` | ❌ NEDOSTOPEN (Cloudflare 403; račun blokiran od 8. 10.) | zgodovinsko zrcalo izvirnika + off-site šifrirane kopije (zadnja čista f771042e: 14 kosov, 39 tabel, 1879 vrstic, 2,75 MB) | naloženo PRED blokado (≈7. 10.) | ZRCALO IZVIRNIKA + OFF-SITE KOPIJE — **NEPREVERLJIVO** |
| **Vercel produkcija** `roksal-railing-manager.vercel.app` | ✅ DOSTOPEN (200; health ok, baza Neon povezana) | **stara verzija** (main-fbfa578, v1.34-era) + R470 demo seed; v1.35.0–v1.38.0 čakajo redeploy (billing blokada) | zadnji deploy iz R430/470 dobe | PRODUKCIJSKI NALOG (zgrajena koda, NE izvornik) |
| **Vercel izvirni chunki** `_next/static/chunks/*` | ❌ 404 (nadomeščeni z novejšim buildom) | minificirani JS iz R430-era — na produkciji več ne obstajajo | — | rešeno SAMO lokalno (spodaj) |
| **Lokalni artefakti v repu**: `assets/` + `pages-samples/` + `chunks.txt` | ✅ V REPU | 19 datotek v `assets/_next/static/chunks/` (17 JS + 2 CSS) + 2 fonta (skupaj 1,1 MB) + 6 vzorčnih strani izvirnika (login, setup, aktivacija, m, portal, p) | commit 5b141f7 »Recovery snapshot« | **PRODUKCIJSKI ARTEFAKTI** (minificirana koda — referenca, NE izvorna koda) |
| **`.pgdata/`** (peskovnica) | ⚠️ dosegljivo samo lokalno | živa embedded PostgreSQL dev baza (port 54329): 87 tabel, 2.608 vrstic — **DEMO podatki** (seed) | 11. 10. 14:02 | RAZVOJNA BAZA — do R484 brez varne kopije (zdaj: §5) |
| **`/home/z/my-project/db/custom.db`** | ⚠️ obstaja, a NI vir | PREDLOGA peskovnika (samo tabeli `Post` + `User`, 6 demo uporabnikov) — **NI poslovna baza Roksal** | 10. 10. 01:46 | PREDLOGA (izrecno: ne uporabljaj kot vir reševanja) |
| **GitHub sedanji repo** `robertpezdirc12-design/roksal-railing-manager` | ✅ DOSTOPEN (kanonični vir od R463) | `main`=bf58a50 (165 commitov, 348 TS/TSX datotek v src/), 3 veje, 41 tagov, CI 14/14 | bf58a50 (v1.38.0, 11. 10.) | **REKONSTRUKCIJA** (R431+; edina živeča koda) |
| **Dokumentacija/zgodovina**: `docs/` (20 datotek), `README-REKONSTRUKCIJA.md`, worklog (izven repa) | ✅ v repu / peskovnici | ROUTE-MAP (130+ rut iz build loga), DEPLOYMENTS* (15 deploymentov + forenza), E2E-REPORT, worklog R431–R483 | stalno | DOKUMENTACIJA + ZGODOVINSKI DOKAZI |

## 3. Matrika funkcionalnosti A–E

Legenda statusov (pošteno — izvirnik ni primerljiv, zato »OHRANJENO« vedno pomeni
*ohranjeno v rekonstrukciji z dokazi*):

- **OHRANJENO** — funkcionalnost živi v rekonstrukciji z datotekami + testi;
- **DELNO** — jedro deluje, znatne vrzeli glede na pričakovani rezultat;
- **DEMO/PLACEHOLDER** — mehanizem deluje, vsebina je nadomestek (ne izvirna);
- **MANJKA** — ni je (niti v rekonstrukciji niti kot artefakt);
- **NEPREVERLJIVO** — iz peskovnice ni mogoče preveriti (blokada/dostop).

| # | Funkcija | Datoteke (dokazi) | Testi | Status | Vrzel | Naslednji korak |
|---|---|---|---|---|---|---|
| **A** | Kamera in meritve | `src/components/roksal/modules/meritve-kamera.tsx` (1.955 vrstic), `ar.tsx`, `zajem.tsx`, `scene-overlay.tsx`; `src/lib/measure-engine.ts` (830 vrstic; `MEASURE_MODES` — 7 načinov: OGRAJA/KERAMIKA/STREHA/FASADA/STOPNICE/PROSTOR/SPLOSNO, measure-engine.ts:28), `scene-perception.ts`, `scene-understanding-core.ts`, `depth-adapter.ts`, `capture-qa-{access,engine,service}.ts`, `fence-run-{access,engine,service}.ts`; API `measurement/*`, `measurements/*` (+verzije/share), `capture-session`, `fence-run`, `ar-snapshots`; modeli `Measurement(+Version)`, `CaptureSession/Reference/Photo`, `FenceRun/Segment/Version`, `ArSnapshot` | r437 (foto/detekcija/potrditev/postavitev), r440 (E2E 154 kontrol), r457 (merilni engine po benchmarkih Hover/Polycam), r462/r465 (capture/fence-run), r467–r471 (scene suite 226 kontrol), r473, r479, r483 (61) | **OHRANJENO (kot rekonstrukcija)** | mere brez reference NIKOLI potrjene; DEPTH_AR le WebXR/Android (iOS pošteno ne); OGRAJA zahteva ≥2 vzporedni črti; čelne višine stopnic neizmerljive; **terenska validacija na fizičnih napravah nepotrjena** (meje: docs/SMART-VISION-8.md §2) | #8 terenska validacija (protokol SMART-VISION-8 §3); #3 Field Capture 2.0 |
| **B** | Realistična zamenjava na fotografiji | `src/components/roksal/modules/foto-replace.tsx` (1.318 vrstic), `foto-replace-links.tsx`; `src/lib/photo-replace-core.ts` (888 vrstic — homografija 8×8 Gauss), `photo-replace-engine.ts`; API `photo-visualization`; modeli `PhotoVisualization(+Version)` | r459, r461, r462 (RBAC, verzije, IDOR, izvozi) | **DELNO** | **deterministična perspektivna projekcija ≠ fotomontažni sistem Hover**: ročno postavljanje quad-točk, canvas 2D homografija; zakrivanje = ghost + prekrivanje, brez vsebinske odstranitve (inpainting NE); svetloba ocenjena iz pikslov | #9 HOVER PARITY (pravi merilni 3D model, model-first konfiguracija; sorazmernost delov že izvedena R473–R478) |
| **C** | Izračuni in ponudba | `src/lib/product-core.ts` (508 vrstic — `calcKonfigCena` + `PriceRule` KONFIG:*), `quote-core.ts`, `segment-bom.ts`, `prefab-core.ts`, `viz-core.ts`, `viz-3d.tsx` (čista geometrija, 0 cen od R464), moduli `konfigurator.tsx`, `ponudbe.tsx`, `material-v5.tsx`, `pdf-mini.ts`/`measure-package-pdf.ts`; API `products`, `product-families`, `price-lists` (+calculate), `bom`, `project-packages`, `quotes` (+sign/pdf), `import`/`export` (round-trip R478); modeli `Quote/QuoteLine`, `Product/ProductVariant/ProductComponent/ProductFamily`, `Bom/BomLine`, `PriceList/PriceRule`, `ProjectPackage` | r464-pricing (93/93 — sprememba cenika se pozna v izračunu, brez hardcoded cen), r474 (invalidacija ponudb), r475 (segmentne količine), r476 (tierji/odbitki), r477, r478 (uvoz round-trip) | **OHRANJENO** — enoten vir cen od R464; **⚠️ cene = DEMO seed** (izvirni cenik nedosegljiv; DDV 22 %, odpad/priprava/montaža v cenikih/pravilih) | pravi cenik ne obstaja (demo vrednosti v `prisma/seed.cjs`) | lastnik vnese pravi cenik skozi UI (`price-lists`) — operativno, ni nova zmožnost |
| **D** | Katalogi in gradiva | moduli `katalog.tsx`, `model.tsx`, `predlogi.tsx`; API `catalog` (+[id]), `product-families`, `products` (+[id]/bom); modeli `Profile` (SKU/material/type/pricePerM — brez slikovnih polj), `CatalogVersion` (verzioniranje R449), `ProductFamily/Product/ProductVariant/ProductComponent`; RAL paleta kodirana (`RAL_HEX` 21 kod, photo-replace-core.ts:30 + palete v viz-3d/konfigurator) | r449 (CatalogVersion zgodovina), r446–r449 (produkti/družine/BOM) | **DEMO/PLACEHOLDER** | **PRAVIH Roksal fotografij/tekstur/3D modelov NI** — seed slike so sintetični SVG data URL-ji (`fotoSvg()` v `prisma/seed.cjs`); `public/` vsebuje samo ikone/logo/manifest/SW; izvirna Blob knjižnica nedosegljiva | #6 ASSET LIBRARY — **uporabnik mora predati prave fotografije/katalog** |
| **E** | Poslovni sistem | 45 modulov v `src/components/roksal/modules/` (crm, stranke, projekti, ponudbe, računi/plačila, delovni nalogi, teren, dostave, servis, proizvodnja, logistika, zaloga, material, orodjarina, galerija, reports, playbook, integracije, varnost, dokumenti, signatura, dashboard, dvojček …); `src/lib/permissions-core.ts` (38 pravic, 5 vlog, fail-closed RBAC), `audit.ts`, `offline.ts`, `webhook-*`; 71 API map v `src/app/api/`; 87 Prisma modelov; PWA (`public/sw.js` + manifest, offline R439); skladišče/nabava/proizvodnja/logistika R447+, servis, revizija | r437–r483 celoten suite: E2E 154/154 poslovni tok (14 faz), RBAC 285/285, offline r439 (74), zaloga/picking r443, servis r447, konkurenca r464-concurrency (56), webhooks r481 (126), r483 (61); CI 14/14 zelenih na bf58a50 | **OHRANJENO** (rekonstrukcija, demo podatki) | **vsi poslovni podatki = DEMO seed** (admin@roksal.si itd.; demo gesla so javno dokumentirana izjema — docs/SECRETS.md §4); izvirni poslovni podatki (Neon/Blob) NEPREVERLJIVO — R470 je povezano Neon bazo našel PRAZNO in sejal demo | dostop do Neon/Blob preveri lastnik (§6) |

Podatkovna podlaga (kaj od izvirnih podatkov sploh obstaja):

| Podatek | Status | Dokaz |
|---|---|---|
| Izvirni poslovni podatki (Neon) | **NEPREVERLJIVO** | R470: baza povezana a PRAZNA pred demo seedom; sedaj nosi demo seed (trditev »Neon z realnimi podatki« v README-REKONSTRUKCIJA.md:14 je ZASTARELA) |
| Izvirne fotografije meritev (Vercel Blob) | **NEPREVERLJIVO** | Blob knjižnica dosegljiva samo prek Vercel računa (blokada) |
| Izvirne Prisma migracije | **MANJKA** | mapa izvirnika ni bila del rešenih artefaktov (RECOVERY-REPORT.md §6.3); shema zgrajena iz blueprinta, migracije rekonstrukcije od `20261009000000_r464_init` (9 migracij) |
| Izvirni cenik / katalog vsebine | **MANJKA** (demo seed nadomestek) | prisma/seed.cjs; enoten vir cen sicer deluje (r464-pricing) |
| Izvirni RAL/materiali | **MANJKA** kot vir (kodirane konstante) | RAL_HEX photo-replace-core.ts:30 |

## 4. Ločitev: izvirnik / rekonstrukcija / artefakt / dokumentacija

| Kategorija | Kaj to je v sedanjem repu | Kje |
|---|---|---|
| **IZVIRNIK** (R120–R430) | **NI dosegljiv.** Nobena datoteka v sedanjem repu ni izvirna koda. Ostanki izvirnika so IZKLJUČNO minificirani produkcijski izseki (spodaj) in zapisani opisi (dokumentacija). | — (GitHub 404, GitLab blokiran) |
| **REKONSTRUKCIJA** (R431+) | VSA izvajalna koda: `src/` (348 TS/TSX), `prisma/` (shema 87 modelov + 9 rekonstrukcijskih migracij + seed), `tests/` (45 datotek r437–r484), `ops/`, `public/`, `.github/`, `config/`. Prvi commit 79e14f6 (6. 10. 19:07), sedaj bf58a50 (165 commitov). | ves `main` |
| **PRODUKCIJSKI ARTEFAKTI** (izvirnik, minificirano) | `assets/_next/static/chunks/` (19 datotek: 17 JS + 2 CSS; + 2 fonta — skupaj 1,1 MB), `pages-samples/` (6 HTML strani: login, setup, aktivacija, m, portal, p), `chunks.txt` (seznam). **Referenca za primerjavo, NE obnovljena koda.** | commit 5b141f7 |
| **DOKUMENTACIJA** | `docs/` (20 datotek: RECOVERY.md, RECOVERY-REPORT.md, ROUTE-MAP.md — 130+ rut iz build loga, BUILD-LOG.txt, DEPLOYMENTS.md/FULL — 15 deploymentov + forenza incidenta, E2E-*, SECRETS.md, SMART-VISION-8.md, …), `README-REKONSTRUKCIJA.md`, `README.md`, ta dokument. Worklog rekonstrukcije (R431–R483) živi izven repa (peskovnica). | `docs/` + root |

**Zastareli trditvi v starih dokumentih (popravljeno SAMO s to opombo — starih vsebin NE
prepisujemo, ker so zgodovinski dokazi):**

1. `docs/RECOVERY.md` §2 trdi, da je **GitLab** kanonični vir resnice — **zastarelo**: GitLab
   je blokiran od 8. 10.; kanonični vir je od R463 **GitHub**
   (`robertpezdirc12-design/roksal-railing-manager`). Na vrhu RECOVERY.md je dodana
   usmerjevalna opomba.
2. `README-REKONSTRUKCIJA.md` trdi »Baza Neon z realnimi poslovnimi podatki je
   nepoškodovana« — **zastarelo/nepreverjeno**: R470 je povezano Neon bazo našel PRAZNO
   (0 uporabnikov) in jo sejal z demo podatki; izvirni poslovni podatki so NEPREVERLJIVO.

## 5. Spremembe v tej reviziji (R484) in varna kopija (Faza 0)

**Izvorna kode NI bilo mogoče obnoviti** (vsi viri iz §1/§2 preverjeni; Faza 3 issueja —
»obnovi samo dokazano obnovljivo« — za izvirnik NI IZVEDLJIVA: ni jedra, iz katerega bi
se obnovilo). Izvedeno je bilo varovanje trenutnega stanja:

**Varna kopija stanja bf58a50 (Faza 0), 11. 10. 2026 17:55 UTC — mapa IZVEN repa
`/home/z/roksal-backups/R484-20261011-1755/`:**

| Artefakt | Pot | SHA-256 |
|---|---|---|
| git bundle (VSA zgodovina + 3 veje + 41 tagov) | `roksal-main.bundle` | `e3d827c16c6c58a2e750984a75e3822eeef4b53745f56c53c84f88be2c0ee531` |
| delovno drevo (samo sledene datoteke; brez node_modules/.next/.pgdata/.git/.env) | `roksal-src-20261011-1755.tar.gz` | `c798051bec7161a94f774a222e3681cba72c51bbe96c3167d12dd197a059a593` |
| cel paket ops/backup.sh (bundle + PG-NOTES + shema + JSON izvoz + manifest) | `roksal-backup-20261011-175542-bf58a50c.tar.gz.local` | `07f02ec0d5280e0fd0df2707514ba45080ebcce5d31a9d477272ff0ebe774ba5` |
| logični izvoz baze (87 tabel, 2.608 vrstic, PrismaClient JSON) | `export/` (88 datotek; `_meta.json`) | `_meta.json`: `caed228087a7123876d6a00bcaf5eff41961d03a9ff48f728080c23ef3a626c5` · prstni odtis sheme: `56a2a00634d1cc6b40c46e92f9fa826a1adf6184fb4d3966b54438fa9aa81d16` |
| manifest vseh 92 datotek | `SHA256SUMS.txt` | (v mapi kopije) |

Integriranost preverjena: `git bundle verify` → »The bundle records a complete history.«;
`tar -tzf` obeh arhivov OK; JSON veljavnost `_meta.json` + vzorčnih tabel OK. Kopija je
NEŠIFRIRANA (v peskovnici ni ROKSAL_BACKUP_PASSPHRASE — .env.recovery ne obstaja) —
pošteno: to je OMEJITEV; peskovnica je minljiva, **GitHub ostaja pravi off-site vir
kode**. Baza `.pgdata` je bila do te revizije brez kakršne koli kopije — zdaj je njen
logični izvoz del paketa.

Spremembe repa v tej reviziji (vse v enem commitu na vrhu bf58a50, `git log --grep=R484`;
izdaja/push prek 3-x):

1. NOV `docs/RECOVERY-STATUS.md` (ta dokument — obvezen izdelek issueja #2);
2. `docs/RECOVERY.md`: ENA usmerjevalna opomba o zastarelosti (vrstica 5, nič drugih
   sprememb vsebine);
3. NOV `tests/r484.py` (kontrole tega dokumenta + API sanity) + CI skupina `r484`
   (tests/ci-matrix.sh + .github/workflows/ci.yml, 14 → 15 jobov);
4. `package.json`: 1.38.0 → 1.39.0.

Izvajalne kode `src/` ta revizija NE spreminja (samo dokumentacija + testi + CI + verzija).

## 6. Blokade, ki zahtevajo lastnika (jasni naslednji koraki)

| # | Blokada | Naslednji korak (lastnik) | Zakaj |
|---|---|---|---|
| 1 | **GitLab račun blokiran** (8. 10.; Cloudflare 403 tudi za anonimne poizvedbe iz peskovnice) | odda **appeal** na GitLab; po odblokadi preveri off-site `.rkb` kopije (zadnja čista f771042e: 39 tabel, 1.879 vrstic) | off-site kopije so bile naložene PRED blokado — domnevno še obstajajo, a so NEPREVERLJIVE; OPOMBA: tudi ob odblokadi iz peskovnice ostanejo neuporabne brez gesla (`ROKSAL_BACKUP_PASSPHRASE` iz `.env.recovery`, ki ga hrani lastnik) |
| 2 | **Vercel billing blokada** (spending limit — user action required) | odpravi blokado + **redeploy** produkcije z `main` | produkcija služi staro verzijo (main-fbfa578, v1.34-era); v1.35.0–v1.38.0 (in prihodnje v1.39.0) čakajo |
| 3 | **GitHub Support ticket** (izbrisan račun markec12345678) | preveri status zahteve | odgovor NI znan → edina pot do morebitne obnove izvirnika na GitHubu |
| 4 | **Produkcijska baza Neon** | preveri stanje baze prek Vercel/Neon konzole (R470 jo je našel PRAZNO pred demo seedom) | izvirni poslovni podatki (stranke/ponudbe/meritve/fotografije v Blob) so NEPREVERLJIVO — če so bili izbrisani/izgubljeni, to potrdi ali ovrže izključno lastnik |
| 5 | **Rotacija poverilnic po exfil incidentu** (17. 9.–6. 10., forenza: DEPLOYMENTS-FULL.md; VERCEL_DEPLOY_HOOK je bila rotirana 6. 10.) | preveri/rotiraj: Neon geslo, SESSION_SECRET, API_KEY_PEPPER, BLOB_READ_WRITE_TOKEN, ROKSAL_SETUP_TOKEN (glej docs/SECRETS.md za vrstni red najmanjših pravic) | stanje rotacije NI preverljivo iz peskovnice — brez slepih sprememb produkcije |
| 6 | **Pravi produktni gradiva** (#6) | predati prave Roksal fotografije/katalog/teksture/3D modele | matrika D = DEMO/PLACEHOLDER; sintetični SVG nadomestki niso uporabni za produkcijo |

## 7. Prednostni načrt nadaljnjih issuejev

Ne podvajamo ZAPRTIH issuejev: **#1** (Production Hardening — izveden v R464–R470),
**#4** (Field AR/Prefab — izveden R471–R478), **#10** (CI regresije — odpravljene).
Odprt **#5** (GitLab backlog #19–#30) čaka odblokado sledilnika — ne more se izvesti do
appeala (enaka blokada kot §6/1).

Predlog vrstnega reda za odprte (končna odločitev lastnika; povezava na vrzeli iz §3):

1. **#6 ASSET LIBRARY** — največja dokazana vrzel (matrika D: pravih gradiv NI) in
   predpogoj za realistične vizualizacije (B) in katalog (D);
2. **#3 FIELD CAPTURE 2.0** + **#7 MONTER CAMERA-FIRST** — kamera/meritve (A) so
   funkcionalno ohranjene, a terenska natančnost nepotrjena;
3. **#12 MONTAŽA QA & PRIMOPREDAJA** — nadaljevanje poslovnega toku (E);
4. **#11 SMART GUIDE** — vodena navodila (gradi na #7);
5. **#8 SMART VISION** — vseh 6 faz §11 IZVEDENIH (F0 R466 → F5 R483, v1.38.0, CI 14/14);
   čaka IZKLJUČNO terensko validacijo po protokolu docs/SMART-VISION-8.md §3 →
   odločitev o zaprtju;
6. **#9 HOVER PARITY** — sorazmernost delov izvedena (R473–R478), fotomontažna pariteta
   (pravi 3D model) ČAKA → odločitev o zaprtju ali nadaljevanju.

**#2 (ta issue):** Fazi 0–2 sta izvedeni dokazljivo (ta dokument + varna kopija §5);
Faza 3 (obnova izvirnika) NI izvedljiva (izvirnik neobstoječ, §1/§2). Predlog: po
pregledu tega dokumenta issue zapreti ali reduciranega pripeti na #6 — odločitev
uporabnika (P0 — ne zapiramo samodejno).

## 8. Testi — dejanski rezultati

**Izvedeno v tej reviziji (2-a-R484, dejansko pognano; izpisi skrajšani):**

| Ukaz | Rezultat |
|---|---|
| `python3 tests/r484.py` | **37/37 ✓** (2× zapored — idempotentno) |
| `bash tests/ci-matrix.sh r484` | **1 ✓ / 0 ✗** |
| `python3 tests/r483.py` (regresija — zadnji dotik istih območij) | **61/61 ✓** |
| `curl -s localhost:3000/api/public/health` | `200` `{"ok":true,"db":"ok"}` (tudi `/api/health` 200) |
| anonimni RBAC (znotraj r484.py, fail-closed) | `GET /api/users` → **401**, `GET /api/measurements` → **401**, `POST /api/photo-visualization` → **401**, `GET /api/quotes` → **401** |
| `git bundle verify roksal-main.bundle` | »The bundle records a complete history.« (HEAD bf58a50) |
| `tar -tzf` (src + backup arhiv) | 762 sledenih datotek / bundle+shema+87 JSON+manifest — OK |
| JSON veljavnost izvoza | `_meta.json` 87 tabel/2.608 vrstic; User/Measurement/Quote veljavni |
| `bun run lint` | **čisto** (0 napak) |
| `bunx tsc --noEmit` | **0 napak** |
| `git status --porcelain` pred commitom | **čisto** (noben stranski ostanek v commitu) |

**Prej izvedeno (referenca — v tej reviziji NI ponovno pognano, ker R484 ne spreminja
izvajalne kode):** polni regresijski suite r437–r483 teče v CI ob vsakem pushu (GitHub
Actions, matrika 15 jobov s to revizijo: kvaliteta, build, migracije + 12 regresijskih
skupin); zadnji zeleni celotni zagon: **CI 14/14 na bf58a50** (3-R483, v1.38.0).
Sekret-sken (`ops/secret-audit.sh`) je del CI; vzorčni sken tega dokumenta na žetonske
vzorce (glpat-/ghp_/sk-) = 0 zadetkov.

**NEizvedeno (pošteno):** brskalniška/E2E verifikacija produkcije (Vercel API/CLI iz
peskovnice nedosegljiv), terenska validacija scene (#8), ponovitev GitLab poizvedb
(blokada — namerno NE).

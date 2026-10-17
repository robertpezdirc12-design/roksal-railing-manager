# Roksal Railing Manager

Poslovno-operativni sistem za Roksal — od prvega voda do zaključene montaže ograj,
fasad in teras: CRM, ponudbe s podpisom, proizvodnja, teren (tudi brez signala),
računi in **fotomontaža PREJ/POTEM** iz uradnih Roksalovih gradiv.

> **Stanje:** rekonstrukcija zaključena in presežena · izdaja **v1.60.0** ·
> **48 testnih skupin + E2E skozi pravo aplikacijo** · GitHub je kanonični vir
> (zadeve + release vrata), GitLab zrcalo, sinhronizacija po SHA (`ops/sync-check.sh`) ·
> [docs/](docs/) vsebuje poročila za vsako fazo.

---

## Zgodovina v šestih stavkih

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

## Kaj aplikacija počne

Informacijska arhitektura po R429 — **5 sekcij, 29 zavihkov**, vsak z vrati
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

### Transakcijska in podatkovna celovitost, utrditev prijav (R535–R541)

Po temeljiti reviziji v1.58.0 je sledilo sedem sklopov popravkov po prioriteti
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
- **Vhodna validacija (R536/R538/R541):** zod sheme po API-ju — napačen vnos
  nikoli ne pride do baze (R541: status projekta enumeriran prek
  `PROJECT_STATUSES`, neveljaven → 400).
- **CSP Report-Only** glava (R536) — opazovalno obdobje pred izvrševanjem;
  poročila se pregledajo pred preklopom v `Content-Security-Policy`.
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
                              # + živa aplikacija + VSE skupine (48); logi v .ci-local-logs/
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
  korakov + vseh 48 skupin, EXIT 0), nato `bash ops/sync-check.sh` = OK na
  obeh sistemih, šele nato oznaka + push. GitLab pipeline (`verify`) je
  drugotna potrditev istega SHA — ne nadomestilo pasu.
- **Vercel (produkcija) — pošteno:** iz peskovnika NI dostopa do Vercel API-ja
  (noben žeton; lastnikovo dejanje). Preverjanje po izdaji opravi lastnik:
  alias → `READY` na izdajnem SHA + `GET /api/health` na produkciji. Pri
  izdaji v1.56.0 je lastnik (issue #20) potrdil alias na d9bf4cf; stanje
  vsake izdaje se zapiše v worklog ob izdaji. GitHub Actions minute so
  izčrpane do 1. 11. 2026 — do takrat je relejni pas lokalni (dokaz v
  `ops/r5xx-pas.out`).
- Vzdrževalni cron: `vercel.json` → `GET /api/jobs/run` 03:30 UTC (zaželen samo
  s `CRON_SECRET`; brez njega 401 — opravila se poganjajo ročno).

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
| `src/components/roksal/` | 49 modulov + ogrodje (app-shell, module-view) |
| `src/lib/` | 75 knjižnic: photo-replace-{mask,texture,core,engine}, permissions-core, nav-registry, audit, notify (outbox), … |
| `prisma/` | shema (93 modelov) + 15 migracij + semenske skripte (`db:seed` veriga) |
| `public/assets/roksal/src/` | uradni Roksalovi viri, `MANIFEST.json` s SHA-256 |
| `tests/` | 48 skupin + `ci-local.sh` / `ci-matrix.sh` + fixtures |
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
- **Revizija v1.58.0 (7,9/10) — Top-10 popravki izvedeni (R535–R541).** Še
  odprto za naslednje kroge (po prioriteti): pretvorba JSON stolpcev iz TEXT
  v pravi JSONB tip (statusna polja so zdaj CHECK-omejena — R541), CSP preklop
  iz Report-Only v Enforce (čaka poročila z opazovalnega obdobja na
  produkciji), `DEMO_ACCESS=on` v produkcjskem okolju (lastnikova odločitev ob
  namestitvi).

## Tehnologija

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 + shadcn/ui · Prisma 6
PostgreSQL (lokalno embedded-postgres :54329, produkcija Neon) · zustand ·
lucide-react · PWA (manifest + sw.js, registracija samo v produkciji)

---

*Dokumentacija po fazah v [`docs/`](docs/) · delovni dnevnik v
[`worklog.md`](worklog.md) · zgodovinska readme rekonstrukcije:
[`README-REKONSTRUKCIJA.md`](README-REKONSTRUKCIJA.md)*

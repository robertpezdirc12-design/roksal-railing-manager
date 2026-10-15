# Roksal Railing Manager

Poslovno-operativni sistem za Roksal — od prvega voda do zaključene montaže ograj,
fasad in teras: CRM, ponudbe s podpisom, proizvodnja, teren (tudi brez signala),
računi in **fotomontaža PREJ/POTEM** iz uradnih Roksalovih gradiv.

> **Stanje:** rekonstrukcija zaključena in presežena · izdaja **v1.55.1** ·
> GitLab CI **zelen** (zasebni runner) · **39 testnih skupin + E2E skozi pravo
> aplikacijo** · GitLab je kanonični vir, GitHub zrcalo sinhrono ·
> [docs/](docs/) vsebuje poročila za vsako fazo.

---

## Zgodovina v štirih stavkih

1. **Izvirnik** (~430 iteracij, R120–R430) je bil razvit v Z.ai kontejnerjih in
   sinhroniziran na GitHub; račun/repo je bil izbrisan 6. 10. 2026.
2. **Recovery** (isti večer): iz Vercel deploymentov so bili rešeni vsi rešljivi
   artefakti — popolna karta rut, RBAC katalog, IA register, build logi, statika
   (glej `docs/RECOVERY-REPORT.md`, `docs/ROUTE-MAP.md`).
3. **Rekonstrukcija** (R431–R439): funkcionalna izgradnja iz blueprinta —
   vsi moduli, RBAC, terenski tok, offline PWA, portal stranke (dogodbeno
   `README-REKONSTRUKCIJA.md` iz tega obdobja).
4. **Nadaljnji razvoj** (R440–R525): kakovost, varnost, fotomontaža (GitLab
   issue #14), relejni pas 39 skupin, obnovitev CI po izčrpani kvoti (R525).

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
- Pogonik ENGINE **1.3.0** (`src/lib/photo-replace-*.ts`); celotno odkritenje
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
  prijav na IP, žetoni seje pepper + prstni odtis naprave.

## Zagon

```bash
bun install
bun run db:up                # lokalni PostgreSQL (embedded-postgres, :54329)
source env.sh                # DATABASE_URL (brez njega: privzeta zgoraj)
bunx prisma migrate deploy   # SHEMA samo prek migracij
bun run db:seed              # demo podatki (uporabniki, stranke, katalog, gradiva)
bun run dev                  # http://localhost:3000
```

Začetna namestitev se pokaže sama, če v bazi ni uporabnikov. Demo računi (gesla
NISO v README — glej `prisma/seed.cjs`): `admin@roksal.si`, `vodja@roksal.si`,
`monter@roksal.si`, `skladisce@roksal.si`, `proizvodnja@roksal.si`. Gumbi za
hitro demo prijavo se izrišejo samo z `DEMO_ACCESS=on`.

## Testi in relejni pas

```bash
bash tests/ci-local.sh        # ENO VSTOPNO MESTO: typecheck + lint + migracije + seed
                              # + živa aplikacija + VSE skupine (39); logi v .ci-local-logs/
bash tests/ci-matrix.sh --list    # seznam skupin — edini vir resnice
bash tests/ci-matrix.sh r524       # ena skupina (točno tako jih poganja CI)
```

Disciplina dokazov: **E2E vedno skozi pravo aplikacijo** (prijava → nalaganje →
maska → izdelek → PREJ/POTEM → SHRANI → preverba zapisa v bazi → čiščenje) —
`ops/r5{17,18,20,22,23,24}-e2e.py`; izrisi in poročila v `ops/`. Baza za pas mora
biti lokalna (produkcija/Neon zavrnjena). Pogoji po OS (Windows: `python`,
ImageMagick, poppler) — podrobno v `tests/ci-local.sh` glavi.

## CI/CD

- **GitLab je kanonični vir** (`markec-group1/roksal-railing-manager`); GitHub
  zrcalo (`origin`) sinhrono ob vsakem pushu.
- Po izčrpani mesečni kvoti skupnih runnerjev (R525) teče CI na **zasebnem
  shell runnerju** v peskovniku (klon prek uradne možnosti `clone_url` iz
  lokalnega golega zrcala — `.zscripts/ci-mirror.sh sync|verify|ensure` — ker
  Cloudflare blokira git smart-HTTP z job-tokenom). Zasebni runner kvote
  **ne** porablja.
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
| `src/components/roksal/` | 45 modulov + ogrodje (app-shell, module-view) |
| `src/lib/` | 72 knjižnic: photo-replace-{mask,texture,core,engine}, permissions-core, nav-registry, audit, … |
| `prisma/` | shema + 12 migracij + semenske skripte (`db:seed` veriga) |
| `public/assets/roksal/src/` | uradni Roksalovi viri, `MANIFEST.json` s SHA-256 |
| `tests/` | 39 skupin + `ci-local.sh` / `ci-matrix.sh` + fixtures |
| `ops/` | E2E skripte, izrisi-dokazi, backup/restore/drill, secret-audit |
| `docs/` | poročila po fazah (RECOVERY, FOTOZAMENJAVA, E2E, …) |
| `.zscripts/` | vzdrževanje peskovnika: dev-detach, git-retry, ci-mirror |

## Odprte točke

- **Issue #14 (fotomontaža)** — aplikacijska stran zaključena; odprto ostaja
  **oskrba** (težava #6 — lastnikova stran): scenski posnetek RWA 57/32 in
  `PROFIL_PRESEK` za POLNA/DESKA v uradnih virih **ne obstajata** (preverjeno
  R524); generični demo izdelki so **izrecno označeni** (R527 — »generični
  izdelek, ni ROKSALOV original« v izbiri, opozorilu, rezultatu POTEM, seznamu
  shranjenih in javnem pregledu stranke); ozadje rež KUBO je lastnikova
  odločitev. Seznam v
  [`docs/FOTOZAMENJAVA-POROCILO-14.md`](docs/FOTOZAMENJAVA-POROCILO-14.md) §5.

## Tehnologija

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 + shadcn/ui · Prisma 6
PostgreSQL (lokalno embedded-postgres :54329, produkcija Neon) · zustand ·
lucide-react · PWA (manifest + sw.js, registracija samo v produkciji)

---

*Dokumentacija po fazah v [`docs/`](docs/) · delovni dnevnik v
[`worklog.md`](worklog.md) · zgodovinska readme rekonstrukcije:
[`README-REKONSTRUKCIJA.md`](README-REKONSTRUKCIJA.md)*

# RECOVERY — Roksal Manager (runbook za obnovo)

> Faza: R441 · Issue: GitLab #3 (DISASTER RECOVERY & SECURITY)
> Datum vzpostavitve: 7. 10. 2026
> ⚠️ Zastarelo glede vira resnice — glej docs/RECOVERY-STATUS.md (R484).

## 1. Cilji

| Merilo | Cilj | Dejansko (zadnji drill) |
|---|---|---|
| **RTO** — čas do delujoče obnove | ≤ 30 min | glej najnovejše `docs/RECOVERY-DRILL-*.md` |
| **RPO** — max izguba podatkov | ≤ 24 h (dnevna kopija 04:00) | starost zadnje off-site kopije ob drill-u |
| Odvisnost od starega GitHub računa | **NIČ** (nobena obnova ga ne zahteva) | ✓ |

## 2. Kaj je kanonični vir resnice

| Podatek | Kje živi | Varnostna kopija |
|---|---|---|
| Izvorna koda + zgodovina + tagi + CI + Prisma migrations | **GitLab** `markec-group/roksal-railing-manager`, veja `main` | `git bundle --all` v vsaki kopiji + GitLab sam (zrcaljen org. repozitorij) |
| Poslovni podatki (SQLite, 39 tabel) | `db/custom.db` | šifrirana kopija `.rkb` (lokalno + off-site) + strojno berljiv JSON export vseh tabel |
| Fotografije meritev | ZNOTRAJ baze (`Measurement.params` dataURL) | pokrite s kopijo baze (v izvirniku Vercel Blob — glej §8) |
| Javna sredstva (ikone, manifest, SW) | `public/` (v gitu) | pokrita z git bundle |

## 3. Varnostne kopije — kako delujejo

**Ena kopija = ena šifrirana datoteka `.rkb`** (AES-256-CBC, PBKDF2 200 000 iteracij), ki vsebuje:

- `git/git.bundle` — CEL repozitorij (zgodovina, vse veje, tagi, migrations, CI);
- `db/custom.db` — dosleden posnetek baze (SQLite online backup API — varen tudi med delovanjem aplikacije) — **samo SQLite kopije** (glej §9: R464);
- `db/schema.prisma` — natančna Prisma shema, iz katere je bil izvoz (R464);
- `export/<tabela>.json` — strojno berljiv export vsake tabule posebej (+ `_meta.json` s števci);
- `manifest.json` — SHA-256 kontrolne vsote vseh komponent, prstni odtis sheme, števci vrstic, git SHA.

Geslo za dešifriranje **ni nikjer v repozitoriju** — hrani se v upravitelju gesel
lastnika (glej `docs/SECRETS.md`). Brez gesla je kopija neuporabna, tudi če jo
nekdo pridobi z GitLaba.

**Hramba:**

- lokalno: `db/backups/` (gitignored) — zadnjih 5;
- **off-site: GitLab generic package registry** (`roksal-backup`) — zadnjih 10
  verzij; nalaganje v kosih po 128 KiB (obvoz ovire velikosti zahteve), vsak kos
  do 6 poskusov (Cloudflare občasno blokira IP glede na obseg).

**Upravljanje:**

```bash
bash ops/backup.sh                 # kopija + šifriranje + off-site
bash ops/backup.sh --local-only    # brez off-site (npr. pred risky spremembo)
bash ops/restore.sh --list-remote  # seznam off-site kopij
bash ops/restore.sh --verify       # obnova v izolacijo + preverba (ne dotika produkcije)
bash ops/restore.sh --target-dir D # dejanska obnova baze + kode v mapo D
bash ops/drill.sh                  # CEL recovery drill z meritvijo RTO/RPO
```

V aplikaciji: **Varnost → Vzdrževanje → varnostna-kopija** (job z dnevnikom
JobRun + revizijo; enaka skripta kot ukazna vrstica — en sam vir resnice).

**Razpored:** dnevno ob 04:00 (cilj RPO 24 h); pred vsako večjo spremembo
sheme ročno. V peskovnici job poganja upravitelj oz. cron vnosi (glej §7).

## 4. CI/CD — GitLab kot kanonični vir

1. **Zaščita `main`:** direktni push ONEMOGOČEN (push_access_level = 0), brez
   force-push, brez brisanja; spremembe SAMO skozi merge request.
2. **Zelen CI je pogoj za merge:** `only_allow_merge_if_pipeline_succeeds`.
   Cevo `.gitlab-ci.yml`: `bun install --frozen-lockfile` → `lint` →
   `tsc --noEmit` → `prisma validate` + `db push` (prazna baza) →
   `ops/secret-audit.sh` (skrivnosti v delovni kopiji IN zgodovini) →
   `bash -n ops/*.sh`.
3. **Tagi/izdaje:** produkcijske verzije označene z zavarovanimi tagi `v*` +
   GitLab Release z opombami.
4. **Deploy:** Vercel (izvirna produkcija) vleče SAMO `main` — torej izključno
   kodo, ki je prešla CI. V peskovnici je ekvivalent dev strežnik na vratih 3000.
5. **Health check po deployu:** `GET /api/health` → pričakovano
   `200 {"status":"ok","db":{"ok":true},…}`. `503` = degraded → rollback.
6. **Rollback:** Vercel → Instant Rollback na prejšnjo namestitev (ali redeploy
   prejšnjega taga `v*`). Po rollbacku ponovno preveriti `/api/health` in
   dnevnik napak. Baza ostaja (SQLite v peskovnici / Neon v produkciji) —
   migracije so aditivne, zato stara koda + nova shema ostajata združljivi.

### Sprožitev deployja ročno iz GitLaba (rezervni mehanizem)

```text
GitLab (main, zelen CI) → tag v* → Release → Vercel: deploy iz taga
                       → GET https://<domena>/api/health → 200 = OK
                       → 503/napaka → Vercel Instant Rollback + prijava incidenta
```

## 5. Postopek obnovitve (celoten)

Predpostavka: izgubili smo peskovniški strežnik in/ali Git delovno kopijo.
Na voljo sta samo: **GitLab račun** (žeton) + **šifrirno geslo** (upravitelj gesel).

1. `git clone` repozitorij s GitLaba (ali iz `git.bundle` znotraj kopije).
2. `bash ops/restore.sh --verify` — preveri zadnjo off-site kopijo (prenese,
   dešifrira, preveri kontrolne vsote, git fsck, števce baze).
3. `bash ops/restore.sh --target-dir <mapa>` — obnovi bazo + izvorno kodo.
4. `bun install` v obnovljeni mapi.
5. Zagon: `DATABASE_URL=file:<mapa>/db/custom.db bun run dev` (ali produkcijska
   gradnja) → `GET /api/health` mora vrniti 200.
6. Prijava + vzorčni poslovni test (projekti/nalogi).
7. Rotacija žetonov, če je prišlo do kompromitacije (glej `docs/SECRETS.md`).

Avtomatizirana obnova vseh korakov z merjenjem časa: **`bash ops/drill.sh`**
(sestavljeno `docs/RECOVERY-DRILL-<ts>.md`). Poročila prejšnjih drillov so
dokaz, da je postopek dejansko izvedljiv.

## 6. Incident checklist (ob kompromitaciji)

1. Ugotovi obseg: kateri žetoni/gesla so bili izpostavljeni.
2. Rotiraj po vrstnem redu iz `docs/SECRETS.md` (razdelek »Rotacija«).
3. Preveri `ops/secret-audit.sh` (delovna kopija + zgodovina) po čiščenju.
4. Preveri zadnjo kopijo: `bash ops/restore.sh --verify`.
5. Če je bil kód spremenjen: povrni iz zadnje znane dobre kopije (drill postopek).
6. Dokumentiraj incident + izvedi drill po odpravi.

## 7. Redni vzdrževalni rituale

| Dejanje | Pogostost | Dokaz |
|---|---|---|
| Varnostna kopija (`ops/backup.sh` / job) | dnevno 04:00 | `db/backups/last-backup.json`, JobRun dnevnik |
| `ops/restore.sh --verify` | tedensko | izpis skripte (rokopisno zabeleži datum) |
| Cel recovery drill (`ops/drill.sh`) | vsaj na četrtletje / po vsaki večji spremembi | `docs/RECOVERY-DRILL-*.md` |
| `ops/secret-audit.sh` | vsak merge (CI) + ob incidentu | zelen CI |
| Rotacija žetonov | ob incidentu; sicer na 90 dni | `docs/SECRETS.md` (zadnja rotacija) |

## 8. Preslikava na produkcijo (Vercel + Neon + Blob)

Peskovnica uporablja SQLite v datoteki; izvirna produkcija teče na Vercelu z
Neon PostgreSQL in Vercel Blob. Preslikava je namensko ena-na-ena, da
postopek ostane enak:

| Peskovnica (to) | Produkcija (izvirnik) |
|---|---|
| `db/custom.db` + JSON export | Neon: avtomatski backup + PITR (zmogljivosti ponudnika) + `pg_dump` v strojno berljivi obliki |
| fotografije v bazi | Vercel Blob (versioning + redni export pomembnih datotek — seznam v `docs/BLOB-INVENTORY.md`) |
| `ops/backup.sh` (SQLite backup API) | enaka skripta z `pg_dump` namesto SQLite snapshot (ista šifriranja + manifest) |
| dev strežnik :3000 | Vercel deploy iz `main` |
| `/api/health` 200 | `/api/health` 200 na produkcijski domeni |

Vsaka sprememba sheme (Prisma) v produkciji: `prisma migrate` (aditivno) po
potrjenem backupu; kontrola: `schemaPrismaSha256` v manifestu kopije se mora
ujemati s `sha256(prisma/schema.prisma)` obnovljene kode.

## 9. R464: PostgreSQL — backup/DR brez pg_dump

Aplikacija je prešla s SQLite na **PostgreSQL** (Prisma provider `postgresql`,
denarna polja `Decimal(12,2)`). Backup/DR je zdaj **provider-agnostičen**:

**Kaj se je spremenilo**

- `ops/backup.sh` se po providerju odloči prek `ROKSAL_DATABASE_URL` /
  `DATABASE_URL` (nazadnje zgodovinska pot `db/custom.db`):
  - **PostgreSQL:** `pg_dump` v peskovnici NI na voljo, zato kopija NE vsebuje
    RAW posnetka baze. Namesto `db/custom.db` je v tar-u `db/PG-NOTES.txt`
    (razlaga) — **nosilec podatkov je `export/<Model>.json`** (vsi modeli po
    Prisma shemi, izvoženi z `ops/export-db.mjs` prek PrismaClient).
  - **SQLite:** pot do zdaj (python online backup) ostane za nujne primere.
- `ops/export-db.mjs` (novo, bun + PrismaClient) nadomešča `ops/export-db.py`
  kot primarni export — deluje za PG IN SQLite; Decimal → number (lastni
  inline patch), modeli se odkrijejo iz `prisma/schema.prisma`.
- Pri obeh providerjih se v kopijo shrani še `db/schema.prisma` — git bundle
  vsebuje le commite, delovna kopija sheme ob kopiranju pa je lahko pred
  commitom.
- `manifest.json`: novo polje `db.provider` (+ `db.databaseUrl` sanitiziran,
  brez gesla — pri PG); `bytes`/`sha256` samo še za SQLite posnetek.
  `schemaFingerprint` = **SHA-256 vsebine `prisma/schema.prisma`** (iz
  `export/_meta.json`) — ne odvisen od sqlite_master več.
- `ops/restore.sh --verify` (PG kopije): kontrolne vsote git.bundle +
  **agregat export/*.json** + `db/schema.prisma`; prstni odtis primerja z
  arhivirano shemo, števce vrstic pa **dejansko prešteje v vsakem
  `export/<Model>.json`** (ne odpira več `db/custom.db`). Zgodovinske SQLite
  kopije se še vedno preverijo po stari poti. Če je živa baza dosegljiva, se
  izvede še informativna navzkrižna preverba (`export-db.mjs` v temp):
  prstni odtis + odmik številcev (živa baza se po zaključku kopiranja
  zakonito spreminja — JobRun/revizija se zapišeta po koncu backupa).
- `src/lib/backup.ts`: job posreduje `DATABASE_URL` izrecno procesu
  `ops/backup.sh`.
- `ops/lib.sh`: žeton se iz remote URL izpogoni LE, če je remote gitlab.com
  (origin je zdaj GitHub — njegov PAT nikoli ne sme iti kot PRIVATE-TOKEN na
  gitlab.com).
- Off-site nalaganje na GitLab ostaja — žeton `GITLAB_TOKEN` (okolje /
  `.env.recovery`); če manjka, kopija ostane lokalno z zapisanim razlogom
  (`last-backup.json` → `offsite.note`).

**Kako obnoviti PostgreSQL iz `.rkb`**

```bash
# 1. dešifriraj + preveri (geslo: okolje / .env.recovery — glej SECRETS.md)
ROKSAL_BACKUP_PASSPHRASE=… bash ops/restore.sh --verify --file kopija.rkb
# 2. izvorna koda + migracije iz bundle
bash ops/restore.sh --target-dir ~/obnova   # export/*.json + schema.prisma + repo
cd ~/obnova/repo && bun install
# 3. ciljna baza: migracije na ciljni PG (DATABASE_URL!)
DATABASE_URL=postgresql://… bunx prisma migrate deploy
#    (rezerva: bunx prisma db push --schema ~/obnova/schema.prisma)
# 4. uvoz podatkov: export/<Model>.json prek Prisma (createMany po modelih,
#    vrstni red brez odvisnosti; po vsakem modelu kontroliraj števce proti
#    manifest.json → db.rowCounts)
# 5. zagon + health: DATABASE_URL=… bun run dev → GET /api/health == 200
```

V produkciji (Vercel + Neon) je primarni DB backup `pg_dump`/PITR ponudnika;
ta kopija je neodvisen, šifriran drugi vir (glej §8).

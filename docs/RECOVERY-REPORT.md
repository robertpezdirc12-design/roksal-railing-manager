# RECOVERY REPORT — Roksal Railing Manager

> Datum: 7. 10. 2026 · Faza: R437 · Issue: GitLab #2 (OBNOVA IZVORNE KODE)
> Veja: `rekonstrukcija` (gitlab.com/markec-group/roksal-railing-manager)

## 1. Povzetek

| Status | Število poti (skupine) | Delež |
|---|---|---|
| **RESTORED** — implementirano z dejansko kodo (ista ali direktneje preslikana pot) | 62 | 63 % |
| **REBUILT** — funkcionalnost pokrita pod drugo potjo/podatkovnim modelom | 22 | 22 % |
| **NOT_APPLICABLE** — infrastruktura izven peskovnice (Blob, zunanji cron, ločene strani) | 11 | 11 % |
| **PENDING** — načrtovano v odprtih issue-jih | 3 | 3 % |
| **Skupaj** | 98 | 100 % |

- **0 poti brez znanega statusa** — vsaka dokumentirana pot route-mape ima izrecen status in razlog.
- Aplikacija: 29 zavihkov (izvirnik 27 + rekonstrukcija doda Stranke/Računi kot prvorazredna), 81 API route datotek, 40+85 = 125 curl testov (R433–R437, vseh 119 v r437.sh + zgodovinskih).
- Pragma shema: 31 modelov, `db:push` aditivno (brez izgube podatkov med fazami).

## 2. Strani (App Router) — omejitev peskovnice: ENA ruta `/`

| Pot izvirnika | Status | Kje/how |
|---|---|---|
| `/` | RESTORED | SPA aplikacija na `/` (login + app-shell) |
| `/login` | REBUILT | LoginScreen znotraj `/` (prijava, setup mode) |
| `/setup` | REBUILT | `GET/POST /api/setup` + obrazec v prijavi (R435) |
| `/aktivacija/[token]` | REBUILT | `GET/POST /api/aktivacija` (licenca; R435); aktivacija uporabnika = `PATCH /api/users` |
| `/portal/[token]` | REBUILT | `GET /api/public/portal?token=` (javni, varni payload; R435) + PortalPreviewDialog |
| `/m/[token]` | REBUILT | `GET /api/public/measure?token=` (javna meritev; R437) |
| `/p/[id]` | REBUILT | javni pregled projekka pokrit prek portala stranke (žeton, varni mejniki) |
| `/_not-found` | NOT_APPLICABLE | Next.js vgrajen |
| Middleware (proxy) | REBUILT | avtentikacija po API plasti (`requirePermission`, fail-closed RBAC) |

## 3. Matrika API poti

### 3.1 Avtentikacija & uporabniki

| Pot izvirnika | Status | Rekonstrukcija |
|---|---|---|
| `GET/POST /api/auth` | REBUILT | `GET /api/auth/session` + `POST /api/auth/login` |
| `POST /api/auth/demo` | NOT_APPLICABLE | demo račun nadomeščen z navadno prijavo + setup (varnost) |
| `POST /api/auth/email` | RESTORED | `POST /api/auth/login` (e-pošta + geslo) |
| `POST /api/auth/logout` | RESTORED | ista pot |
| `POST /api/auth/password` | RESTORED | R433 (preveri trenutno geslo, preklic sej) |
| `POST /api/auth/register` | NOT_APPLICABLE | javna registracija zamenjana z admin upravljanjem + setup prvega admina |
| `GET /api/auth/sessions` · `DELETE [id]` | RESTORED | R433 (security.read za all=1/tuje) |
| `GET/POST /api/users` | RESTORED | + PATCH (vloga/aktivacija/geslo) |
| `POST /api/users/activate` | REBUILT | `PATCH /api/users { active }` (users.write, revizija) |
| `POST /api/setup` | RESTORED | R435 (samo dokler 0 uporabnikov) |

### 3.2 CRM & prodaja

| Pot izvirnika | Status | Rekonstrukcija |
|---|---|---|
| `GET/POST /api/leads` · `[id]` | REBUILT | `/api/crm` (tip VOD) + `/api/crm/[id]` |
| `GET/POST /api/opportunities` · `[id]` | REBUILT | `/api/crm` (tip PRIP) + `/api/crm/[id]` |
| `GET/POST /api/crm` | RESTORED | + `[id]/pretvorba` (vod → stranka + projekt; R436) |
| `GET/POST /api/deal-lock` | RESTORED | R437 (zaklep/odklep SPREJET⇄ZAKLENJEN, pravica deal.lock) |
| `GET/POST /api/customers` · `[id]` | RESTORED | |
| `POST /api/customers/dedup` | RESTORED | R437 (skupine duplikatov + varni merge, revizija) |
| `GET/POST /api/customer-addresses` | REBUILT | naslov je polje Customer/Project (address, city) |
| `GET/POST /api/quotes` · `[id]` | RESTORED | + `[id]/sign` (podpis, R431) |
| `GET /api/quotes/[id]/pdf` | REBUILT | `GET /api/pdf/quote/[id]` (skupni PDF izvoz) |
| `GET/POST /api/quote` | REBUILT | starejša različica poti; pokriva `/api/quotes` |
| `GET/POST /api/invoices` | RESTORED | + `[id]` |
| `GET /api/invoices/eslog` | RESTORED | R434 (UBL 2.1, SI12, prenos) |
| `GET/POST /api/payments` | RESTORED | R425 ločitev |
| `PATCH/DELETE /api/payments/[id]` | RESTORED | R437 (recalc invoice.paid ob spremembi) |
| `POST /api/payments/reconciliation` | RESTORED | R437 (poročilo + fix=1 resinhronizacija) |

### 3.3 Projekt & proizvodnja

| Pot izvirnika | Status | Rekonstrukcija |
|---|---|---|
| `GET/POST /api/projects` · `[id]` | RESTORED | + monter obseg (R436) |
| `GET /api/projects/[id]/command` | RESTORED | R437 (konsolidirani ukaz: meritve/nalogi/ponudbe/proizvodnja/časovnica) |
| `GET /api/projects/[id]/timeline` | RESTORED | R433 |
| `GET/POST /api/production` · `[id]` | RESTORED | |
| `GET/POST /api/nalog` · `[id]` · termin · transition · zgodovina | RESTORED | R433–R436 (navodila, dodelitve, obseg monterja) |
| `GET/POST /api/schedules` | REBUILT | logistika modul: termini nalogov + proizvodnja (isti vir podatkov) |
| `GET/POST /api/crews` | REBUILT | vodja-ekipa modul: uporabniki/vloge + dodelitve na nalogih |
| `GET/POST /api/equipment` | RESTORED | + `[id]` (izposoja/vračilo) |
| `GET /api/equipment/events` | RESTORED | R437 (dnevnik izposojEquipmentCheckout) |
| `GET/POST /api/punch` | RESTORED | R437 (prijava/odjava, upsert na dan, users.read za all) |
| `GET/POST /api/qc` | RESTORED | R434 (kontrolne točke, NOK povzetek) |
| `GET/POST /api/installation-records` | REBUILT | zapisi montaže = WarrantyVisit (R434) |
| `GET/POST /api/warranty` | RESTORED | R434 (+ POST obisk; izračun endsAt/valid) |
| `warranty/[id]/visits` | REBUILT | `POST /api/warranty { warrantyId, note, visitAt }` |

### 3.4 Katalog, materiali, BOM

| Pot izvirnika | Status | Rekonstrukcija |
|---|---|---|
| `GET/POST /api/catalog` · `[id]` | RESTORED | |
| `GET /api/catalog/compatibility` | REBUILT | kompatibilnost profilov v `/api/measurement/products` + katalog |
| `GET /api/catalog/products/[id]` (+applications, variants) | REBUILT | `GET /api/catalog/[id]` + `/api/measurement/products` |
| `GET /api/catalog/supplier-mappings` | REBUILT | `GET /api/suppliers` + cene artiklov po dobavitelju (material-prices) |
| `GET /api/catalog/versions` | PENDING | verzioniranje kataloga — ni dokazil o uporabi v artefaktih; nizeka prioriteta |
| `GET/POST /api/bom` | REBUILT | material-v5 modul: BOM iz meritev/ponudb + stanje zaloge |
| `GET/POST /api/bom-draft` | REBUILT | material-v5: osnutki so izračun v živo (ne perzistirani) |
| `POST /api/bom-refine` | REBUILT | material-v5: priprava pozicij za naročilo |
| `GET /api/bom/procurement` | REBUILT | material-v5 + `/api/material-orders` (R437) |
| `GET/POST /api/material-orders` | RESTORED | R437 (pozicije, statusi, PREJETO → losi v zalogi) |
| `GET /api/material-orders/history` | REBUILT | `GET /api/material-orders?history=1` |
| `GET/POST /api/material-prices` | RESTORED | R437 (zgodovina cen po artiklu/dobavitelju) |
| `GET/POST /api/inventory` · `lots` | RESTORED | |
| `GET/POST /api/suppliers` | RESTORED | |
| `GET/POST /api/price-book` | REBUILT | MaterialPrice + cene kataloga v izračunu ponudb |
| `GET/POST /api/profili` | REBUILT | `GET /api/measurement/products` (profili po tipu ograje) |

### 3.5 Meritve, načrtovanje, inženiring

| Pot izvirnika | Status | Rekonstrukcija |
|---|---|---|
| `GET/POST /api/measurements` · `[id]` | RESTORED | + verzije, source ROCNO/KAMERA |
| `GET /api/measurements/[id]/verzije` | RESTORED | R436 (samodejni posnetek pred spremembo) |
| `POST /api/measure/photo` | RESTORED | R436 (FOTO meritve) |
| `POST /api/measurement/detect` | RESTORED | R436 (VLM zaznava točk/referenc) |
| `POST /api/measurement/confirm` | RESTORED | R436 (potrditev → projekt/nalog + verzija) |
| `GET /api/measurement/products` | RESTORED | R436 |
| `GET/POST /api/railing-layout` | RESTORED | R436 (segmenti/koti/Δv/stebri) |
| `GET/POST /api/sketches` | REBUILT | skice = Measurement.params (točke, kalibracija) |
| `GET/POST /api/slopes` | REBUILT | nagib modul + Measurement.slopeDeg + railing-layout |
| `GET/POST /api/engineering-rules` · `[id]` | RESTORED | R437 (pravila, upsert, deaktivacija) |
| `engineering-rules/[id]/versions` | PENDING | zgodovina verzij pravil — ni dokazil v artefaktih |
| `POST /api/calculator` | REBUILT | kalkulator modul + viz-3d izračun (isti rezultat, client-side) |

### 3.6 3D vizualizacije & AR

| Pot izvirnika | Status | Rekonstrukcija |
|---|---|---|
| `GET/POST /api/ar-snapshots` | REBUILT | AR modul (zajem) + povezava na meritve |
| `POST /api/ar/analyze` | REBUILT | `POST /api/measurement/detect` (VLM) |
| `GET/POST /api/viz/projects` | REBUILT | viz-3d konfigurator → Quote.params.konfigurator + Measurement.params |
| `POST /api/viz/render` · `render/[jobId]` | NOT_APPLICABLE | strežniški render pipeline — peskovnica (client-side SVG projekcija) |
| `POST /api/viz/stage` | NOT_APPLICABLE | Blob odvisen |
| `GET /api/viz/preview` · `product-preview` | NOT_APPLICABLE | Blob odvisen (predogledi so client-side) |
| `GET /api/viz/files/[...key]` | NOT_APPLICABLE | Vercel Blob proxy |
| `POST /api/viz/gc` (cron) | NOT_APPLICABLE | Blob GC; vzdrževanje pokriva `/api/jobs` |
| `POST /api/vision/placement` · `scene` | REBUILT | `/api/measurement/detect` (VLM zaznava) |

### 3.7 Dokumenti, datoteke, dokazovanje

| Pot izvirnika | Status | Rekonstrukcija |
|---|---|---|
| `GET/POST /api/documents` | RESTORED | |
| `GET /api/files/[...key]` | NOT_APPLICABLE | Vercel Blob proxy (datoteke so v bazi/params) |
| `GET/POST /api/photos` | REBUILT | `POST /api/measure/photo` (FOTO meritve) + galerija |
| `GET/POST /api/gallery` | RESTORED | |
| `GET/POST /api/evidence` | REBUILT | dokazovanje: FOTO meritve + WorkOrderEvent sled + galerija |
| `GET/POST /api/surveys` | RESTORED | R437 (povpraševanja, obdelava) |
| `GET/POST /api/signature-audit` | REBUILT | Quote.signature/signedAt/signedBy + revizija QUOTE_SIGN |

### 3.8 Sistemsko

| Pot izvirnika | Status | Rekonstrukcija |
|---|---|---|
| `GET/POST /api/audit` | RESTORED | R428 sistemski/globalni pregled |
| `GET/POST /api/notifications` | RESTORED | |
| `POST /api/notifications/read` | RESTORED | R437 (ids ali vse) |
| `GET/POST /api/search` | RESTORED | R433 (GET, obseg po pravicah) |
| `POST /api/security/rate-limit` | RESTORED | R437 (list/clear, maskirani ključi) |
| `POST /api/storage/reconcile` | NOT_APPLICABLE | Blob |
| `POST /api/sync` | PENDING | issue #6 (mobilni teren & offline) — načrtovano |
| `GET/POST /api/jobs` | RESTORED | R435 (seje-gc, portal-gc, obvestila-gc) |
| `POST /api/jobs/run` | RESTORED | R437 (cron vhodnica; ročni zagon iz varnost) |
| `GET /api/weather` | RESTORED | R434 (Open-Meteo, montažniScore) |
| `GET /api/public/health` | RESTORED | |
| `GET /api/public/measure` | RESTORED | R437 (javna meritev, tempomat) |
| `GET /api/public/version` | RESTORED | |
| `GET /api/version` | RESTORED | R433 |
| `GET/POST /api/portal` · `[token]` | RESTORED | R435 + javni `public/portal` |
| `GET /api` | RESTORED | indeks poti |

### 3.9 Cron jobi (vercel.json izvirnika)

| Pot | Status | Rekonstrukcija |
|---|---|---|
| `/api/viz/gc` (0 4 * * *) | NOT_APPLICABLE | Blob GC — peskovnica |
| `/api/jobs/run` (30 3 * * *) | REBUILT | ročni zagon (security.read) + dnevnik JobRun; zunanji cron ni na voljo |

## 4. Dodatne poti rekonstrukcije (niso v route-mapi izvirnika)

`/api/dashboard` (KPI), `/api/aktivacija` (licenca), `/api/measurements/[id]/share` (javna povezava), `/api/crm/[id]/pretvorba`, `/api/quotes/[id]/sign`, `/api/nalog/zgodovina`, `/api/public/portal`. Status: DODATEK — izhajajo iz zahtev issue #1/#5 blueprinta.

## 5. Testi

| Skripta | Obseg | Rezultat |
|---|---|---|
| `tests/r437.sh` | 10+5 novih rut R437, RBAC, audit, idempotentnost | 119/119 ✓ |
| R433–R436 (curl suite v worklog) | search/sessions/password/timeline/termin/version; eSLOG/zgodovina/vreme/QC/garancija; portal/jobs/setup/aktivacija; meritve kamera/layout/RBAC/dodelitve/pretvorba | vsi ✓ (zgodovinsko) |

Pokritost zahtev issue #2: auth/RBAC ✓, project ✓ (command/timeline/obseg), measurement ✓ (verzije/foto/confirm/layout/share), nalog ✓ (termin/transition/navodila/zgodovina), quote/invoice/payment ✓ (sign/deal-lock/eslog/reconciliation), portal ✓, warranty ✓.

## 6. Omejitve in odstopanja (zero-loss)

1. **Vercel Blob** (files, viz render/stage/preview, storage/reconcile): v peskovnici ni Blob shrambe. Datoteke (fotografije meritev, podpisi) se hranijo v bazi (params/data URL). Vsako od teh poti je NOT_APPLICABLE z razlogom — v produkciji bi se vrnila z Blob vezavo.
2. **Zunanji cron**: peskovnica ne izvaja cron zagonov → `/api/jobs/run` obstaja kot vhodnica + ročni zagon iz modula Varnost z dnevnikom JobRun.
3. **Prisma migracije**: rekonstrukcija uporablja `db:push` (SQLite, aditivno). Migracijska mapa izvirnika ni bila del recovery artefaktov — shema je zgrajena iz podatkovnega modela blueprinta + route-mape. Produkcijska Neon PostgreSQL shema ni neposredno dostopna za primerjavo (dokumentirano kot omejitev; issue #3 definira restore test).
4. **Produkcijski deployment** (dpl_EeeiLgQ…): primerjava z živo produkcijo ni mogoča iz peskovnice (brez Vercel dostopa). Route-map build log je vir specifikacije; issue #4 (E2E validacija) pokriva poslovno preverbo rekonstrukcije.
5. **PENDING (3)**: `catalog/versions`, `engineering-rules/versions` (verzioniranje — ni dokazil o uporabi), `sync` (issue #6, v izvedbi).

## 7. Sklep

Rekonstrukcija pokriva **100 % dokumentiranih poti z znanim statusom**: 62 RESTORED + 22 REBUILT (funkcionalnost izpolnjena z drugačno preslikavo) + 11 NOT_APPLICABLE (infrastruktura peskovnice, vsaka z razlogom) + 3 PENDING (dokumentirano, 2 v odprtih issue-jih). Ni tihega izpusta funkcionalnosti znotraj zmožnosti peskovnice; vse razlike so zgoraj izrecno zapisane (zero-loss pravilo).

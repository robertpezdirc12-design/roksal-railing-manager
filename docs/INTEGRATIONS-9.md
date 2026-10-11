# INTEGRACIJE #9 — Povezave, webhooki in dobavitelji (R481, issue #9 §9)

**Datum:** R481 · **Revizija kode:** main = R481 (lokalni commit nad 0d4fc79, tag v1.36.0)
**Metoda:** dobesedno branje §9 (GitHub issue #9) + read-only pregled kode z dokazi `file:line`.
**Vsebina:** kaj je STABILNO in dokumentirano (izvozi/uvozi/eSLOG/javne poti), webhook plast R481
(povzetek + link), RBAC/IDOR odločitve, in SKLEPI za dobavitelje, nabavo ter uvoz načrtov
(PDF/DWG/DXF). Spremljajoči dokument: **`docs/webhooks.md`** (289 vrstic — polna referenca).

---

## 1. Stabilen, verzioniran API — kaj JE stabilno danes

§9 točka 1: *»Opiši in po potrebi izpostavi varno, verzionirano integracijsko plast za projekte,
meritve, modele, kosovnice, ponudbe in dogodke.«* **Opis obstoječega stanja (vse deluje, testirano):**

| Integracijska pot | Ruta | Pravica / varnost | Od izdaje |
|---|---|---|---|
| Izvoz kosovnice | `GET /api/export/bom/[id]?format=csv\|xlsx\|json` | Bearer + scope projekta; revizija EXPORT_GENERATE; inženirska preverjanja VIDNA (CSV `# OPOZORILO`, XLSX list »Preverjanja«, JSON `checks[]`) | R477 |
| Izvoz ponudbe | `GET /api/export/quote/[id]?format=csv\|xlsx\|json` | enako zgoraj | R477 |
| Uvoz (round-trip) | `POST /api/import/[bom\|quote]` (multipart CSV/XLSX/JSON) | Bearer + scope; diff, varovalke regeneracije, invalidacija ponudb (R474); zneski se ob uvozu PONOVNO izračunajo | R478 |
| Izvoz meritve (vsak način, tudi PROSTOR/KERAMIKA) | `GET /api/measure-engine/export?id=<measurementId>&format=csv\|json` | measurements.read + scope | issue #12 §19 |
| Merilni paket PDF | `GET /api/pdf/measure/[fenceRunId]` (tip `measure` v `/api/pdf/[type]/[id]`) | documents.generate + scope; `measure-package-pdf/1.0` | R477 |
| eSLOG račun | `GET /api/invoices/eslog?id=` | invoices.read; UBL 2.1 Invoice XML, sklic SI12 (mod 97); revizija ESLOG_EXPORT | R434 |
| **Webhook dogodki (NOVO R481)** | `POST/GET/PATCH/DELETE /api/webhooks*` | integrations.manage (ADMIN/VODJA); podpis X-ROKSAL-Signature; outbox + retry | **R481** |
| Javne žetonske poti | `/api/public/health` · `/version` · `/measure` · `/portal` · `/review` · `/viz` · `/viz-choice` | žetoni po entiteti (`pt-`/`rv-`/`pv-`), tempomat 60/min, consent vrata, prikriti žetoni | R435–R480 |

**Pristop verzioniranja (dokumentirana odločitev):**

- URL-i **brez verzije** (`/api/...`) — en sam živ nabor; vsaka ruta nosi stabilne oblike odgovorov
  in semantično verzijo v VSEBINI, kjer je to merilno relevantno (`MODEL_ENGINE_VERSION`
  `model-core/1.0`, `measure-package-pdf/1.0`, `ENGINE_VERSION` tekača, verzije meritev/tekačev
  v bazi). Ni »v1« v poti — zgodovinske rekonstrukcije ne verzioniramo po URL.
- **Nedestruktivna pravila:** polja se NE odstranjujejo (dodajanje je dovoljeno); spremembe
  oblike odgovorov gredo skozi changelog (worklog po revizijah + `docs/` dokumenti).
- **Če** bo kdaj prebojna sprememba: nova pot `/api/v2/...` vzporedno obstoječi (izrecna zaveza —
  nikoli ne zlomimo obstoječega partnerja).

## 2. Webhook plast (R481) — POVZETEK

Poslovno-dogodkovni **izhod** za partnerje (LOČENO od obvestilnega `NOTIFY_WEBHOOK_URL` providerja):

- **Naročnine** `WebhookSubscription` (url https, secretHash = SHA-256 has skrivnosti — skrivnost
  se nikoli ne shrani/vrne, izbira dogodkov, active/revoked) + **outbox** `WebhookDelivery`
  (unique `[subscriptionId, eventKey]` → idempotenca; status PENDING/SENT/FAILED/DEAD; backoff
  1/5/30/30 min → mrtvo pismo po 5 poskusih).
- **Podpis**: `X-ROKSAL-Signature: sha256=HMAC-SHA256(sha256_hex(secret), "${X-ROKSAL-Timestamp}.${rawBody}")`
  + `X-ROKSAL-Event`; replay okno 5 min (priporočeno partnerju).
- **16 dogodkov** (12 obstoječih + 4 novi: `CAPTURE_PROCESSED`, `MODEL_CHANGED`,
  `PRODUCTION_READY`, `ORDER_CONFIRMED`) — §9 jih izrecno našteva; en vir resnice z IN_APP
  obvestili (emitEvent poganja OBE dostavi).
- **UI**: zavihek »Integracije« (sekcija Varnost, `integrations.manage`) — seznam naročnin,
  števci dostav, testni ping, pavza/ponovni zagon, preklic, zgodovina dostav, ročna ponovitev.
- **Retry**: job `webhook-retry` (cron dnevno 03:30 — dokumentirana zamuda) + ročni
  `POST /api/webhooks/retry`.

➡ **Polna referenca (oblike, glave, primeri verificiranja v Node/Python, katalog, varnost):
`docs/webhooks.md`.**

## 3. RBAC/IDOR — ključi ne obidejo obsega projekta

§9: *»Ohraniti notranjo zaščito RBAC/IDOR; integracijski ključi ne smejo obiti obsega projekta.«*

| Mehanizem | Kako drži obseg |
|---|---|
| Bearer žetoni (seje) | RBAC po pravicah (katalog 39; `permissions-core.ts`) + IDOR preverjanja po vseh rutah (3 access plasti — vzorec iz AUDIT-9 §2) |
| Javni žetoni (`pt-`/`rv-`/`pv-`) | **per-entiteta** — portal povezuje EN projekt/meritev/vizualizacijo; preklic takoj; tempomat; consent vrata |
| Webhook naročnina | **globalna za pisarno — ZAVESTNA ODLOČITEV (dokumentirana):** posluša dogodke VSEH projektov, a: (a) upravljajo jo SAMO ADMIN/VODJA (`integrations.manage`); (b) telo dostave je VARNI PODSKUP (`publicWebhookPayload` — `projectId` + naslov/opis; BREZ internih cen, marž, zalog, e-pošt strank, internih ID-jev uporabnikov — `webhook-core.ts:157-204`); (c) vse mutacije so v revizijskem dnevniku (`WEBHOOK_CREATE/UPDATE/REVOKE/TEST/RETRY` — brez skrivnosti) |
| Skrivnost naročnine | samo SHA-256 has v bazi; nikoli v odgovorih/reviziji/dostavah; izgubljene ni mogoče povrniti |

**Priporočilo za prihodnost:** če pride večstrankarska (multi-tenant) potreba, dodati
`projectScope` na naročnino (filter dogodkov po `projectId` pred vpisom v outbox) — zasnova
obstaja (payload že nosi `projectId`); do takrat je pisarna ena in odločitev varna.

## 4. Dobavitelji (§9 točka 5) — SKLEP: brez scrapanja/simulacij

§9: *katalog SKU, zaloga, dobavni roki, dejanske cene in naročanje se lahko povežejo SAMO prek
pooblaščenih API-jev/pogodb ali odobrenih datotek; ne scrapaj ali simuliraj dobaviteljevega sistema.*

- **SKLEP (zavrnitev aktivnega povezovanja):** NE scrapamo, NE simuliramo, NE ugibamo.
  Danes NE obstaja pooblaščen API/pogodba z nobenim evropskim/slovenskim distributorjem →
  **NIč zunanjega povezovanja**.
- **Dovoljena pot danes** (= »odobrena datoteka« iz besedila): ročni vnos cen v
  `MaterialPrice` (`/api/material-prices`, revizija MATERIAL_PRICE_CREATE — uporabnik prinese
  cenik dobavitelja in ga vnese). `Supplier` (ime/kontakt/opomba) ostaja kontaktni imenik.
- **MaterialOrder tok ostaja notranji** (statusi PRIPRAVA → POSLANO → PREJETO → PREKINJENO,
  `MaterialOrderLine` z denormaliziranimi vrsticami) — brez lažnih integracij (AUDIT-9 §4: pravilno).

## 5. Nabava (§9 točka 6) — obstoječa, BREZ vzporednega upravljanja

§9: *»Uporabi obstoječe zaloge/nabavo/dostave; ne ustvarjaj vzporednega upravljanja naročil.«*

**POTRJITEV stanja:** nabava ŽIVI v obstoječih tokovih in NIč vzporednega ni bilo dodanega:

| Tok | Pot |
|---|---|
| Predlogi naročila | `/api/material-suggestions` (povpraševanje odprtih kosovnic − zaloga; R452) |
| Cene dobaviteljev | `/api/material-prices` (+ `?zgodovina=1`) |
| Nabavna naročila | `/api/material-orders` (+ `/history`), sprejem → loti `/api/inventory/lots` |
| Preslikave kataloga | `/api/catalog/supplier-mappings` |
| Zaloga | `/api/inventory` + picking |

R481 tukaj **NIČ** ni dodal — potrjena skladnost z zahtevo.

## 6. Uvoz načrtov PDF/DWG/DXF (§9 točka 7) — SKLEP: zavrniti za zdaj

§9: *uvozi načrte in izpelji projekt LE, kadar so enote/merilo in zahtevani pogledi jasno določeni
ter rezultat ne potrebuje lažnega avtomatskega vektoriziranja.*

- **Trenutno stanje:** uvoz načrtov NE obstaja (0 zadetkov `dwg|dxf` v src/; `import-core` =
  CSV/XLSX/JSON). PDF je ŽE porabljen le kot IZHOD (pdf-mini) — ne kot vhod.
- **SKLEP (zavrnitev):** avtomatski uvoz PDF/DWG/DXF **NE**, ker: (a) brez izrecnih enot/merila
  v datoteki je vsak izračun ugibanje; (b) »samodejna vektorizacija« risb brez garancije
  pomena entitet (kaj je stena, kaj dimenzija, kaj tekst) lažje ŠKODI kot pomaga — mere gredo v
  proizvodnjo (enak argument kot PROSTOR-9 §4: prepoznava brez potrjene metode = nevarna).
- **Če bo potreba (zasnova za prihodnost, brez obljub):** ROČNI potrditveni tok —
  1. nalaganje datoteke (PDF sličica / DWG/DXF izvoz v PDF ali slike),
  2. prikaz nad grafom z izbiro merilne točke (kalibracija: znana razdalja na načrtu),
  3. človek izbere poligon/dimenzije in POTRDI enote + pogled (tloris/kot),
  4. šele nato nastane meritev (status OCENA, vir »načrt+človek« — nikoli samodejno).
  Dokumentirati bi bilo treba: kaj je prepoznano SAMODEJNO (nič) in kaj ročno potrjeno (vse).

## 7. Kaj R481 NI dodal (meje — pošteno)

- **Vhodni (machine-to-machine) API ključi** — issue #9 jih ne zahteva; `API_KEY_PEPPER` ostaja
  neuporabljen (AUDIT-9 §5 dolg). Integracije so: webhook izhod + izvozi + javne žetonske poti.
- Tempomat v pomnilniku enega procesa (Vercel lambda) — dokumentirana meja (webhook test 10/min,
  retry 30/min, javne poti 60/min).
- Cron webhook-retry 1× dnevno (03:30) — prvi poskus vsake dostave je vedno takojšen (inline).

---

*Dokazi: file:line reference zbrane z neposrednim branjem kode R481 (main). Sorodni dokumenti:
`docs/webhooks.md` (referenca webhook plasti), `docs/PROSTOR-9.md` (§8), `docs/AUDIT-9.md` (Faza 0).*

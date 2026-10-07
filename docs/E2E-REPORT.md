# E2E REPORT — Roksal Railing Manager

> Datum: 7. 10. 2026 · Faza: **R440** · Issue: GitLab **#4** (END-TO-END VALIDACIJA)
> Sledi RECOVERY-REPORT.md (R437). Spremljajoči artefakti:
> `docs/E2E-MATRIX.json` (strojno berljiva matrika), `docs/E2E-RESULTS.json` (rezultati po endpointih),
> `tests/r440.sh` (poslovni tok + varnost — 154 preverjanj), `tests/r440-smoke.py` (smoke + RBAC),
> `tests/build-e2e-matrix.py` (generator matrike iz izvorne kode).

## 1. Povzetek

| Sklop | Obseg | Rezultat |
|---|---|---|
| **Celoten poslovni tok** (povezani scenarij) | 14 faz: vod → stranka → projekt → dodelitev → nalog → termin → teren (foto/meritve/layout/confirm) → preverjanje → QC → proizvodnja → BOM/nabava → zaloga → zaključek → ponudba → podpis/zaklep → račun → plačilo → portal → garancija/servis → zgodovina/audit/obvestila | **154 / 154 ✓** |
| **API smoke** (vseh 127 endpointov v 84 datotekah) | 84 PASS + 34 PASS_VALIDATION + 8 SKIPPED_SAFE + 1 PASS_EXTERNAL | **127 / 127 znan rezultat, 0 BROKEN** |
| **RBAC matrika** (GET × 5 vlog) | 285 preverjanj dovoljen/zavrnjen | **285 / 285 ✓** |
| **Varnost** (IDOR, žetoni, DTO, seje, gesla) | vključeno v 154 (razdelek B) | **vse ✓** |
| **UI moduli** (brskalnik, agent-browser) | 29 / 29 zavihkov ADMIN + monter + skladišče | **29 / 29 PASS, 0 konzolnih napak** |
| **Mobile 390 px** | nalogi / meritve / projekti / pdf | **brez preliva (390/390)** |
| **Sticky footer** | kratka/dolga stran, desktop + mobile | **POPRAVLJENO v R440** (Sidebar `max-h` 6rem → 9.375rem) |

**Zaključek:** celoten poslovni tok uspe brez ročnega prepisovanja podatkov; RBAC je potrjen na backendu in UI; DTO minimizacija in revizijske sledi so preverjene; vsi javni žetoni (portal, meritev) delujejo in se prekličejo. Preostale dejanske vrzeli so spodaj in pretvorjene v ločene GitLab issueje.

## 2. Viri resnice in metoda

- **Matrika** se generira iz izvorne kode (`tests/build-e2e-matrix.py`): za vsak `export async function METHOD` v `src/app/api/**/route.ts` izlušči zahtevano pravico (`requirePermission`) ali vrsto avtorizacije (seja/javno), potem preslika v vloge iz `ROLE_PERMISSIONS` (permissions-core.ts).
- **Smoke** (`tests/r440-smoke.py`) pokliče vsak endpoint z dovoljeno vlogo in primerja status; neveljavna/polu-prazna telesa, ki jih strežnik pravilno zavrne s 400/404/409/422, se štejejo kot `PASS_VALIDATION` (endpoint odgovarja, ne 500).
- **RBAC sweep** za vse GET endpointe preveri vseh 5 vlog: 200 (dovoljeno) ali 401/403 (zavrnjeno) točno po matriki; 403 za monterja na tujem zapisu se prizna kot PRAVILNA zaščita obsega (fail-closed).
- **Poslovni tok** (`tests/r440.sh`) teče kot EN povezani scenarij z R440-predponskimi podatki (vsi počiščeni na koncu) in preverja tudi revizije (AuditLog), dogodke nalogov in dostave obvestil ob vsakem koraku.

## 3. Celoten poslovni tok (razdelek A — 154 / 154)

| Faza | Poti | Ključna preverjanja |
|---|---|---|
| 1. CRM | `POST /api/crm` → `PATCH /api/crm/[id]` → `POST /api/crm/[id]/pretvorba` | vod NOV→KONTAKTIRAN→PRETVORJEN (409 ob ponovitvi), stranka + projekt (P-2026-00x), revizija LEAD_CONVERT |
| 2. Nalog | `POST /api/nalog` | dodelitev monterju + navodila, dogodek DODELJEN, obvestilo WO_ASSIGNED (IN_APP monter) |
| 3. Termin | `POST /api/nalog/[id]/termin` ×2 | dogodka PREURČITEV (KOMENTAR), revizija WO_RESCHEDULE, monter preuredi SAMO svoj termin |
| 4. Teren | transition → `POST /api/measure/photo` → `POST /api/measurements` → `POST /api/railing-layout` (save) → `POST /api/measurement/confirm` | NAPROGRAMIRAN→V_TEKU→V_ZAJEMU→V_PREVERI, foto vezana na nalog, ročna meritev, layout (segmenti/koti/totalCm) shranjen kot KAMERA, potrditev s foto (vir KAMERA), verzija +1 ob dopolnitvi |
| 5. Ponudba | `POST /api/quotes` → `PATCH status POSLAN` → `POST /api/quotes/[id]/sign` | monter podpis 403 (brez deal.lock), vodja podpis → ZAKLENJEN, revizija DEAL_LOCK, obvestilo QUOTE_SIGNED (pisarna), PDF (application/pdf) |
| 6. Proizvodnja + QC | `POST /api/production` → `POST /api/qc` ×2 (OK + NOK) | proizvodni nalog (PROIZVODNJA vloga), 2 kontroli, obvestilo QC_NOK, status V_IZDELAVI |
| 7. Nabava → zaloga | `POST /api/material-orders` → POSLANO → PREJETO | točno 1 nov lot (samo vrstice s `itemId`), artikel z loti + avgPrice v inventarju |
| 8. Zaključek | `transition ZAKLJUCEN` + `PATCH /api/projects/[id] status ZAKLJUCEN` | obvestili WO_COMPLETED (pisarna+stranka) in PROJECT_STATUS (stranka) |
| 9. Račun + plačilo | `POST /api/invoices` → `GET eslog?id` → `POST /api/payments` ×2 → `POST /api/payments/reconciliation` | račun iz ZAKLENJENE ponudbe, eSLOG XML s kodo, 2 plačili → DELNO_PLACAN, uskladitev, obvestilo PAYMENT_RECEIVED |
| 10. Portal | `POST /api/portal` → `GET /api/public/portal?token` | javni payload vsebuje projekt, BREZ internih id-jev, obvestilo PORTAL_PUBLISHED (stranka, žetona NI v telesu) |
| 11. Garancija | `POST /api/warranty` + obisk | garancija na ZAKLJUČEN projekt, servisni obisk zabeležen |
| 12. Javna meritev | `POST /api/measurements/[id]/share` → `GET /api/public/measure?token` | varne mere (lengthCm), BREZ authorId |
| 13. Pregled | `command` + `timeline` + `zgodovina` + `audit?projectId` | meritve ≥ 3, nalogi/ponudbe/proizvodnja ≥ 1, PODPIS v časovnici, 6+ ključnih dogodkov naloga, 28 revizij (LEAD_CONVERT, DEAL_LOCK, …) |
| 14. Dashboard + iskanje | `GET /api/dashboard`, `GET /api/search?q=R440` | iskanje najde projekt/nalog po predponi |

## 4. Matrika API poti (127 endpointov)

Statusi: **PASS** 84 · **PASS_VALIDATION** 34 · **SKIPPED_SAFE** 8 · **PASS_EXTERNAL** 1 · **BROKEN** 0.

- `PASS_VALIDATION` — endpoint pravilno zavrne nepopolno telo (400/404/409/422) brez 500; polni tok je preverjen v poslovnem toku (razdelek 3).
- `SKIPPED_SAFE` (8) — destruktivni/administrativni klici, katerih izvedba bi spreminjala stanje: `POST /api/setup`, `POST /api/auth/logout`, `POST /api/aktivacija`, `DELETE sessions/[id]`, `DELETE payments/[id]`, `DELETE portal/[id]`, `DELETE engineering-rules/[id]`, `DELETE measurements/[id]/share` — **vsak je preverjen v r440.sh** (logout/preklic seje B6, preklic portala/share B7, DELETE plačila v r437 …).
- `PASS_EXTERNAL` — `GET /api/weather` (open-meteo; v peskovnici 429/502, UI obravnava gracefully).

### Zajemanje dokumentirane route-mape
ROUTE-MAP dokumentira 98 skupin poti (RECOVERY-REPORT): 62 RESTORED + 22 REBUILT + 11 NOT_APPLICABLE + 3 PENDING. Dejanskih endpointov po rekonstrukciji: **127** (več kot izvirnik zaradi razcepljenih virov — npr. `/api/notifications/prefs|deliveries|read`). PENDING (catalog/versions, engineering-rules/versions, sync→izveden v R439) ostajata 2 verzioniranji — nizka prioriteta, issue #8.

## 5. RBAC (285 preverjanj — 0 odstopanj)

Vsak GET endpoint × {ADMIN, VODJA, MONTER, SKLADISCE, PROIZVODNJA}: status točno po matriki pravic. Poudarki:

- monter: 200 kjer ima pravico (nalog/meritve/projekti-svoji/katalog/…), 403 na računih/plačilih/eSLOG/uporabnikih/reviziji/rate-limit/katalog-pisanju/deal-lock;
- vodja: brez `security.read` → 403 na `POST /api/security/rate-limit`;
- skladišče: `audit.read` → 200 na reviziji; `catalog.write` → lahko piše katalog;
- fail-closed obseg: monter na tujem nalogu/projektu/meritvi → 403 (tudi prek `/api/sync` → CONFLICT »Nalog ni v vašem obsegu«).

## 6. Varnost (razdelek B — vse ✓)

| Test | Rezultat |
|---|---|
| Neavtenticiran dostop (11 poti + transition) | 401 ✓ |
| Neveljaven/prazen žeton | 401 ✓ |
| IDOR: monter → tuji nalog (detail/transition/termin), tuja meritev (nalog brez njega), tuji projekt | 403 ✓ |
| IDOR prek sync (meritev na tuj nalog) | CONFLICT z razlogom ✓ |
| DTO: `/api/users` brez `passwordHash`; seje brez žetonov; javni portal brez internih e-pošt; javna meritev brez `authorId` | ✓ |
| Odjava → žeton neveljaven; admin preklic tuje seje → žeton neveljaven | ✓ |
| Javni žetoni: preklican share/portal → 404; neveljaven → 404 | ✓ |
| Napačno trenutno geslo | 400 ✓ |
| Rate-limit endpoint: admin 200, vodja/monter 403 | ✓ |

## 7. UI moduli (29 / 29 PASS — agent-browser)

- Vseh 29 zavihkov ADMIN se izriše z dejanskimi podatki (P-2026-001…009, N-2026-001…008, PON/RA, EV/OR oprema, 38 meritev …) — **0 konzolnih napak/opozoril**.
- Interaktivni vzorci ✓: podrobnost naloga (vodnik terena + časovnica dogodkov), zgodovina verzij meritve + javna povezava, 3D predogled projekta (yaw/pitch), CRM pipeline, revizijski dnevnik, Obveščanje (preklop EMAIL se shrani).
- RBAC navigacija ✓: monter 19/29 zavihkov (samo svoje pravice), skladišče 12/29 (Zaloga/Katalog/Varnost vidna, CRM/Proizvodnja ne); injekcija `tab=varnost` v store → »Dostop zavrnjen — zahteva pravico audit.read« (fail-closed tudi na UI ravni); monterjevi seznami omejeni na lastne naloge.
- Offline zaščita (R439) se je sprožila v živo ob prijavi drugega uporabnika (izbris IndexedDB + toast).

## 8. Mobile + footer

- 390 × 844: brez horizontalnega preliva na vseh testiranih zavihkih; navigacija uporabna.
- **Sticky footer (desktop)**: ugotovljena vrzel → sidebar `max-h calc(100vh−6rem)` ni všteval glave+noge → stalnih ~47 px drsenja. **Popravljeno**: `calc(100vh−9.375rem)`; kratka stran (pdf) = točno 800/800 z nogo na dnu, dolge strani naravno porinejo nogo.

## 9. Preostale vrzeli → GitLab issueji

| # | Vrzel | Resnost | Issue |
|---|---|---|---|
| 1 | Ročna meritev (`POST /api/measurements`) ne ustvari verzije v1 — nedosledno s sync/confirm/layout potmi, ki jo ustvarijo | nizka | #9 |
| 2 | Naročilnica: vrstica brez `itemId` ob PREJETO tiho NE ustvari lota (brez povratne informacije uporabniku) | nizka | #9 |
| 3 | Verzioniranje kataloga (`catalog/versions`) in inženirskih pravil (`engineering-rules/versions`) — PENDING iz R437 | nizka | #8 |
| 4 | Weather odvisen od open-meteo (429 v peskovnici) — UI graceful, ni aplikacijska napaka | info | — |

**Prej odprte vrzeli, zaprte v tej fazi:** desktop sticky footer (popravev v app-shell.tsx); higiena testnih podatkov (smoke čiščenje dopolnjeno za proizvodnjo/QC/plačila/KAMERA-potrditve brez projekta; 178 odvečnih sej pobrisanih).

## 10. Navodila za ponovitev

```bash
python3 tests/build-e2e-matrix.py   # regenerira docs/E2E-MATRIX.json iz kode
bash tests/r440.sh                  # poslovni tok + varnost (počisti samega sebe)
python3 tests/r440-smoke.py         # smoke + RBAC sweep → docs/E2E-RESULTS.json
```

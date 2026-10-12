# WALKMYPLAN — raziskava integracije za GitHub issue #13 (GO/NO-GO)

**Repo:** robertpezdirc12-design/roksal-railing-manager · **Issue:** #13 — »Roksal: preveri integracijo WalkMyPlan za 3D-objekte in vizualizacijo ograj«
**Datum preverbe:** 12. 10. 2026 (09:45–10:00 UTC, vse strani odgovorile žive ob preverbi)
**Metoda:** spletna raziskava v živo (iskalnik + neposredno branje strani + protokolne sonde `curl`) — BREZ ugibanj o obstoju API-ja; vsaka trditev ima URL in čas preverbe.
**Revizija konteksta:** main = 132323a (v1.43.0) · obstoječa 3D vizualizacija: `src/components/roksal/modules/viz-3d.tsx` (lastna perspektivna projekcija v čistem TypeScriptu, SVG, brez three.js) + `viz.tsx` (konfigurator, 2D tehnična risba) · `docs/SMART-VISION-8.md` (AR/CV kontekst) · `docs/ROUTE-MAP.md` (130+ API rut).

---

## §1 Kaj je WalkMyPlan (z dokazi)

**WalkMyPlan obstaja in je dostopen.** Domena `walkmyplan.com` je živa (HTTP 200, Cloudflare, IP 104.21.20.56; preverjeno 12. 10. 2026). Izdelek je **beta SaaS za tlorise stanovanj z 3D-sprehodom po notranjosti**, z MCP-konektorjem za AI-klepetalnike (Claude, ChatGPT, Cursor).

Izjava iz naslovne strani (https://www.walkmyplan.com/, preverjeno 12. 10. 2026):

> »WalkMyPlan - Design your home and walk through it in 3D … Sketch it with a pencil, drop your architect's file, or just describe it to Claude or ChatGPT. Rooms, doors, furniture, garden and all. … ✓ Free viewing and sharing ✓ No download ✓ Reads DWG & PDF«

Izjava iz **uradne dokumentacije konektorja** (https://www.walkmyplan.com/docs, »Connector Documentation · July 2026«, preverjeno 12. 10. 2026):

> »WalkMyPlan builds **interiors — floor plans and room-by-room walkthroughs, not outside elevations**. And not only homes: if it has rooms — an office, a clinic, a factory floor — you can design it. You get a real 3D model you can orbit and walk through, an editor for walls, windows, doors, furniture and pools, and live links to share by email or chat.«

Izjava iz uradnega GitHub repozitorija (https://github.com/yaniv-fink/walkmyplan-mcp, preverjeno 12. 10. 2026):

> »Floor plans to walkable 3D — MCP server for Claude, ChatGPT & Cursor. Describe a house and it designs and builds the model, or upload a DWG / vector PDF. **45 tools**, keyless OAuth. com.walkmyplan/walkmyplan«

Ključni deli ponudbe (vsa poti preverjena 12. 10. 2026):

| Del ponudbe | Vir |
|---|---|
| Skiciranje tlorisa / risanje v brskalniku | https://www.walkmyplan.com/ |
| Nalaganje arhitektove datoteke (DWG, DXF, PDF, DWFX, IFC; do 100 MB) | https://www.walkmyplan.com/docs |
| Opis hiše v klepetu z AI (konektor MCP) | https://www.walkmyplan.com/connect-claude.html |
| 3D-sprehod po notranjosti v brskalniku + deljene povezave | https://www.walkmyplan.com/docs |
| Fotorealistični posnetki/video iz modela (»One credit« po posnetku) | https://www.walkmyplan.com/ + /upgrade |
| Podpora: support@walkmyplan.com · © 2026 WalkMyPlan (brez navedbe pravne osebe) | noga vseh strani |

V uradnem registru MCP strežnikov je vpisan kot `com.walkmyplan/walkmyplan` (https://registry.modelcontextprotocol.io/v0.1/servers?search=walkmyplan, preverjeno 12. 10. 2026): v0.2.0 objavljena 13. 7. 2026, najnovejša **v3.0.0** objavljena 12. 8. 2026, status ACTIVE, remote `https://mcp.walkmyplan.com/mcp` (Streamable HTTP), repozitorij `github.com/yaniv-fink/walkmyplan-mcp`. To je **mlad, mali izdelek** (GitHub repozitorij: 4 zvezdice, 2 commita, 0 forkov; v iskanju nisem našel nobene tretje-ocene/pregleda v tisku).

**Za Roksal relevantno dejstvo iz §1:** WalkMyPlan deluje na **notranjih tlorisih stavb** (sobe, vrata, pohištvo, stopnice kot element tlorisa, bazeni, parkirišča). Nima **nobenega** objekta za ograje — glej §2.4.

---

## §2 Tehnična preverba integracije

### 2.1 Ali obstaja JAVNI API? — NE ( obstaja le MCP-konektor z OAuth)

Preverjeno z dejanskimi sondami 12. 10. 2026:

| Sonda | Rezultat |
|---|---|
| `GET https://www.walkmyplan.com/docs` | 200 — **uradna dokumentacija pokriva IZKLJUČNO MCP-konektor** (»Connector Documentation«). Nobene REST/API dokumentacije. |
| `POST https://mcp.walkmyplan.com/mcp` (initialize) | **401** + glava `WWW-Authenticate: Bearer resource_metadata="https://mcp.walkmyplan.com/.well-known/oauth-protected-resource"` + telo `{"error":"unauthorized","error_description":"A valid wmp_ bearer key is required. Connect via OAuth."}` |
| `GET https://mcp.walkmyplan.com/.well-known/oauth-protected-resource` | 200 — `{"resource":"https://mcp.walkmyplan.com/mcp","authorization_servers":["https://www.walkmyplan.com"],"bearer_methods_supported":["header"]}` |
| `GET https://www.walkmyplan.com/.well-known/oauth-authorization-server` | 200 — issuer `https://www.walkmyplan.com`; `/oauth/authorize`, `/oauth/token`, `/oauth/register` (dinamična registracija odjemalcev), `/oauth/revoke`; `grant_types_supported: ["authorization_code"]`, `code_challenge_methods_supported: ["S256"]` (PKCE), `token_endpoint_auth_methods_supported: ["none"]`, `scopes_supported: []` |
| `https://api.walkmyplan.com` | **HTTP 525** (SSL napaka — gostitelj ne streže javnega API-ja) |
| `developer.walkmyplan.com`, `docs.walkmyplan.com` | **ne obstajata** (napaka DNS) |
| Iskanje »WalkMyPlan API« / »developer API« | ni zadetkov o javni REST dokumentaciji |

**Interpretacija (dokumentirano, ne ugibano):**

- Javnega REST API-ja **NI**. Edina uradno dokumentirana programska pot je **oddaljeni MCP-strežnik** `https://mcp.walkmyplan.com/mcp` (Streamable HTTP, OAuth 2.1 z dinamično registracijo + PKCE, »keyless«). Namenjen je **AI-klepetalnikom ob prijavljenem uporabniku** (Claude/ChatGPT/Cursor), ne strežnik-strežnik integraciji.
- `grant_types_supported` vsebuje **samo `authorization_code`** — **ni `client_credentials`**, torej strežniška (service-to-service) integracija, kakršna bi jo potreboval Roksal, **ni mogoča** brez interaktivne prijave uporabnika v brskalniku in OAuth-soglasja.
- Spletna aplikacija interno uporablja lastne rute `/api/*` (npr. `/api/my/projects`, `/api/projects/{id}/model.glb` — ugotovljeno iz javno dostopnega JS-paketa aplikacije, ~4,7 MB); te so **nedokumentirane, vezane na sejo uporabnika** in jih Pogoji uporabe izrecno prepovedujejo (»scrape the service in bulk«, »reverse engineer«). Anonimni dostop do `model.glb` demo-projekta vrne **404** (preverjeno 12. 10. 2026).

### 2.2 Orodja MCP-konektorja (45) — dobesedno iz uradnega README

Kategorije in orodja (https://github.com/yaniv-fink/walkmyplan-mcp, preverjeno 12. 10. 2026):

- **Create:** `build_house`, `create_new_plan`, `create_upload_link`, `create_plan_from_url`
- **Understand:** `get_plan_structure`, `ask_plan_question`, `get_plan_status`, `get_plan_link`, `list_my_plans`, `download_plan_pdf`
- **Furnish:** `furnish_room`, `place_furniture_in_room`, `add_fixture_at_point`, `move_or_rotate_fixture`, `resize_fixture`, `remove_fixture`, `clear_room_furniture`
- **Structure:** `add_wall`, `move_wall`, `remove_wall`, `set_wall_height`, `set_ceiling_height`, `add_door_or_window`, `move_door_or_window`, `resize_door_or_window`, `flip_door_hinge`, `remove_door_or_window`, `add_stairs`, `move_or_resize_stairs`
- **Annotate:** `name_room`, `write_text_on_floor`, `add_marker`, `remove_marker_or_text`
- **Outdoors:** `add_pool`, `move_or_resize_pool`, `add_parking`, `move_or_resize_parking`
- **History & sharing:** `undo_last_edit`, `list_revisions`, `restore_revision`, `rename_plan`, `get_sharing`, `set_sharing`, `delete_plan`, `report_plan_problem`

**V 45 orodjih ni nobenega za izvoz 3D-modela (glTF/OBJ/IFC) in nobenega za ograje.** Edino orodje za prenos je `download_plan_pdf` (PDF-tloris, ne 3D).

### 2.3 Vhodni/izhodni formati

Iz uradne dokumentacije (https://www.walkmyplan.com/docs, »Supported files & limits«):

| | Podprto |
|---|---|
| **Vhod** | DWG, DXF, PDF, DWFX, IFC (+ PNG, JPG, WebP po domači strani); max **100 MB** |
| **Izhod** | »2D plan + walkable 3D model, **viewable in any browser** — no install«; deljene povezave; PDF-tloris (»Download the real PDF blueprint«, plačljivi paketi); fotorealistični posnetki/video (krediti) |
| **Urejanje** | stene, vrata, okna, pohištvo, bazeni; revizijska zgodovina z undo/rollback |
| **3D izvoz** | **NE obstaja** (nič ne omenja glTF/OBJ/IFC izvoza; notranji `.glb` strežnik lastnega pregledovalnika ni javen) |

### 2.4 Ali podpira ograje? — NE (odločilno za #13)

- Dokumentacija: »WalkMyPlan builds **interiors … not outside elevations**« (https://www.walkmyplan.com/docs).
- Uradni seznam 45 orodij (§2.2): stene, vrata, okna, stopnice, bazen, parkirišče — **ni ograje, balkonov, ograjnih polnil, stebrov, ročnikov**.
- Analiza javno dostopnega JS-paketa aplikacije (`main-B6M7MBRY.js`, prenesen 12. 10. 2026 z www.walkmyplan.com): iskanje `railing` **0**, `guardrail` **0**, `balustrade` **0**, `handrail` **0**, `banister` **0**; edini zadetek »fence« je WebGL klic `fenceSync` (nedevezen z ograjami). Editor torej sploh nima entitete za ograjo, kamor bi Roksal vstavil svoje 3D-objekte.
- Nadalje: »**Edits are for visualization and planning — WalkMyPlan does not check structural safety or building codes**« in mere »taken from the converted model's geometry. Verify critical dimensions against the original drawing.« — za Roksalove izmere/tehnologijo (tekač, segmenti, kosovnica) neuporabno kot vir resnice.

### 2.5 Avtentikacija, omejitve, SLA

- Avtentikacija: izključno **OAuth 2.1 (authorization_code + PKCE + dinamična registracija odjemalcev)** ob prijavi uporabnika (Google/Facebook/e-pošta). Ni API-ključev, ni service tokenov, **ni strežnik-strežnik poti**.
- Omejitve uporabe: niso dokumentirane (nobenih rate limitov v dokumentaciji); edina objavljena meja je 100 MB na datoteko.
- Razpoložljivost: »WalkMyPlan is **beta software**. Features may change, break, or be removed, and availability is not guaranteed.« (Pogoji uporabe, https://www.walkmyplan.com/terms, posodobljeno 2. 9. 2026). **Ni SLA, ni garancij.**
- Odvisnost od enega ponudnika brez navedene pravne osebe (© 2026 WalkMyPlan; podpora le po e-pošti).

---

## §3 Licenciranje in stroški

### 3.1 Cenik (https://www.walkmyplan.com/upgrade, preverjeno 12. 10. 2026)

| Paket | Cena | Obseg |
|---|---|---|
| Free | 0 € | »Viewing, walking in 3D, and sharing are free forever«; časovno omejeno okno urejanja (»free editing allowance«); deljene povezave vsebujejo osnutkov pasico |
| Project Pass | **29 $ enkratno / načrt** | 1 načrt, 30 dni urejanja, čista deljena povezava, PDF-tloris, 2 slikovna kredita |
| Pro | **39 $/mes** | 10 hkrati urejanih načrtov, 3 krediti/mes, PDF-tlorisi, white-label povezave |
| Studio | **129 $/mes** | 50 načrtov, vse iz Pro, prednostna podpora |
| Dodatni krediti (slike/video) | 15 za 20 $ · 60 za 50 $ · 140 za 100 $ | delujejo na vseh paketih |

### 3.2 Pogoji uporabe — tveganja za B2B integracijo (https://www.walkmyplan.com/terms, 2. 9. 2026)

- **Naložene datoteke:** »By uploading a plan file (DWG, PDF, PNG, JPG, WebP, or IFC), you grant WalkMyPlan a license to store, open, render, convert, analyze, and otherwise process the file … to … **test, evaluate, train, and improve** WalkMyPlan's plan-reading technology, **including its artificial-intelligence and machine-learning models** …« — za Roksal bi to pomenilo nalaganje risb **strank** v tretjo beta storitev z odjavo (opt-out) le po e-pošti.
- **Prepovedi:** ne sme se »scrape the service in bulk«, ne sme se »reverse engineer … for the purpose of reproducing WalkMyPlan's extraction technology«, in — odločilno — »**you may not use generated models, plans, or data exports to build, train, or improve a competing product or service**«. Roksal je izdelek za načrtovanje/izvedbo ograj; gradnja tekoča integracija na izvozih WalkMyPlan bi padala v ta sivi pas.
- »Plans and 3D models generated by WalkMyPlan are automated interpretations for **visualization only**. They are not certified drawings, engineering documents, construction instructions, measurements for purchasing, or legal records.«
- Odgovornost je omejena na znesek, plačan v 12 mesecih pred zahte vkom.
- Zasebnost (https://www.walkmyplan.com/privacy, 1. 10. 2026): SCC + UK IDTA za prenose izven EEA; analitika PostHog (izklopna); podpora teče prek Gmail/Anthropic; račun se briše po e-pošti. **Ni podpisanega DPA, ni navedene pravne osebe.**
- GitHub repozitorij `yaniv-fink/walkmyplan-mcp` je **MIT** — vendar vsebuje le metapodatke/dokumentacijo MCP strežnika (»This repository hosts the MCP server's public metadata and documentation; the server itself runs at mcp.walkmyplan.com«). SAM STORITEV ni odprtokoden in ni na voljo za samostojen zagon.

---

## §4 Odločitev: **NO-GO**

**Ne integriraj WalkMyPlan v Roksal.** Utemeljitev po dokazih iz §1–§3:

1. **Domenska neustreznost (odločilno):** izdelek pokriva notranje tlorise in sprehod po notranjosti, uradno »**not outside elevations**« (docs). Ograje, balustrade, stebri, ročniki, ograjna polnila — tehnično **ne obstajajo** v modelu (0 omemb v celotnem JS-paketu aplikacije; nobenega od 45 MCP-orodij). Integracija ne more prikazati niti enega Roksalovega 3D-objekta ograje.
2. **Ni javnega API-ja:** edina programska pot je MCP-konektor z interaktivnim OAuth 2.1 (samo `authorization_code` + PKCE) — brez `client_credentials`, torej brez strežniške integracije; Roksalova zasnova (Next.js API, cron, AR zajem na terenu) take poti ne more uporabiti.
3. **Ni izvoza 3D-modela:** izhod je zaklenjen v njihov brskalniški pregledovalnik in deljene povezave (+ PDF-tloris in plačljive fotorendere). Ni orodja `export glTF/OBJ/IFC`; notranji `.glb` je nedokumentiran, za sejo vezan in po Pogojih prepovedan za programsko zajemanje. V Roksalovo lastno vizualizacijo ali kosovnico ničesar ne more priteči.
4. **Pravno/tveganjsko:** beta brez garancij; pravice do učenja modelov na naloženih risbah strank; izrecna prepoved gradnje konkurenčnega izdelka na izvozih; neznana pravna oseba, brez SLA/DPA. To je nesprejemljivo za produktivno orodje monterske in proizvodne verige.
5. **Stroški brez vrednosti:** Pro 39 $/mes oz. Studio 129 $/mes bi pomenilo trajno naročnino za zmožnost, ki za vizualizacijo ograj ne da ničesar.

Edina mišljiva (vendar neintegracijska) uporaba: Roksalov prodajalec bi **ročno** naložil DWG tloris stavbe stranke in stranki poslal brezplačno povezavo do sprehoda po notranjosti — kot tržni dodatek. Tudi to vsebuje tveganje glede risb strank (§3.2) in ne prikaže ograj.

---

## §5 Priporočena alternativa (NO-GO)

### 5.1 Primarna: obstoječa LASTNA 3D vizualizacija (viz-3d.tsx)

- `src/components/roksal/modules/viz-3d.tsx` že ima: lastno perspektivno projekcijo (yaw/pitch, f≈700), slikarski algoritem razvrščanja primitiv, senčenje ploskev (Newellove normale), stebre/palice/steklo/ročnik/nagib, barve RAL, hover segmentov, avtorotacijo, dostopnost (aria) — **brez zunanjih odvisnosti, brez stroškov, brez tveganj tretjih oseb**. To je točno domenski jezik ograj (OGRAJA/BALUSTRADA/NAGIB), ki ga WalkMyPlan sploh ne pozna.
- Povezava na merilno verigo (tekač → segmenti seg-N → BOM → dvojček) je dokazana v R488; vizualizacija črpa iste vhode.
- **Priporočilo:** nadaljnje izboljšave delati v lastnem prikazu (npr. več segmentov v eni sceni, vrata v tlorisu 3D, izvoz SVG/PDF risbe). Nobena sprememba kode ni bila narejena v tej raziskavi.

### 5.2 Če kdaj potrebujemo IFC (uvoz arhitektovega modela) — odprtokodne poti, BREZ obveznih plačljivih storitev

| Pristop | Licenca (preverjeno 12. 10. 2026) | Opomba |
|---|---|---|
| **three.js** (knjižnica za WebGL prikaz) | **MIT** (https://github.com/mrdoob/three.js, LICENSE) | skladno s politiko projekta (MIT/Apache-2.0/ISC, 0 copyleft — SMART-VISION-8.md §4 točka 8) |
| **web-ifc** (ThatOpen/engine_web-ifc — branje/pisanje IFC v JS/WASM) | **MPL-2.0** (https://github.com/ThatOpen/engine_web-ifc, LICENSE.md) | šibki copyleft na ravni datotek — **nova licenčna kategorija za ta repozitorij**, zahteva izrecno odločitev lastnika pred sprejetjem |
| ThatOpen Engine (ostale komponente) | po komponentah — **ni bilo preverjeno v tej seji** | pred vsako uporabo obvezna lastna licenčna preverba |
| xeokit-sdk | **ni bilo mogoče preveriti** (raw LICENSE ni dosegljiv) | znano kot odprtokodna + komercialna različica — preveriti pred uporabo |

**Priporočilo za #13:** vzdrževati lastno vizualizacijo; če se v prihodnosti odpre potreba po uvozu IFC modelov arhitektov, je minimalna odprtokodna pot `web-ifc` (MPL-2.0) za razvozljavanje + lastni prikaz (ali three.js, MIT) — brez SaaS odvisnosti. Vsako novo knjižnico sprejeti le po licenčni preverbi po enakem postopku kot v SMART-VISION-8.md.

---

## §6 Merila sprejema iz issueja #13 in izpolnjenost

Issue #13 zahteva **dokumentirano odločitev GO/NO-GO z dokazi iz uradne dokumentacije** (ne ugibanja). Izpolnjenost:

| Merilo (iz issue #13) | Status | Dokaz |
|---|---|---|
| Preveriti, kaj WalkMyPlan dejansko je | ✅ | §1 — citati iz naslovne strani, uradne dokumentacije konektorja in GitHub README (12. 10. 2026) |
| Preveriti obstoj javnega API-ja z dejansko raziskavo | ✅ | §2.1 — sonde v živo: MCP 401 + OAuth metapodatki, register MCP, 525 na api.*, DNS neobstoječa poddomena; dokumentacija pokriva le MCP |
| Preveriti formate (vhod/izhod) | ✅ | §2.3 — vhod DWG/DXF/PDF/DWFX/IFC ≤100 MB; izhod brskalniški 3D + PDF + plačljive fotorendere; **izvoz 3D-modela ne obstaja** |
| Preveriti avtentikacijo/omejitve | ✅ | §2.1, §2.5 — OAuth 2.1 samo za interaktivnega uporabnika; brez rate-limit dokumentacije; beta brez SLA |
| Preveriti licenciranje/stroške | ✅ | §3 — cenik (Free/29 $/39 $/129 $/krediti), pogoji uporabe in zasebnost z citati |
| Odločitev GO/NO-GO z utemeljitvijo | ✅ | §4 — **NO-GO** s 5 dokazanimi razlogi |
| Priporočena alternativa brez obveznih plačljivih storitev | ✅ | §5 — lastna vizualizacija viz-3d.tsx; odprtokodne IFC poti z licencami (three.js MIT, web-ifc MPL-2.0) |
| Ne spreminjati aplikacijske kode | ✅ | ta raziskava ni spreminjala nobene datoteke aplikacije; ustvarjen je le ta dokument |

## §7 Česar NI bilo mogoče preveriti (pošteno)

- **Dejanskega klica MCP-orodij** — zahteval bi ustvarjanje uporabniškega računa pri tretji osebi in OAuth-soglasje v brskalniku; v tej raziskavi namenoma nisem ustvaril računa. Seznam orodij je vzet iz uradnega README/dokumentacije (ne iz lastnega klica `tools/list`).
- **Strani vtičnika ChatGPT** (`https://chatgpt.com/plugins/plugin_asdk_app_6a5563300db881918aa0eff31d9a6679`) — brskalnik/CDN je vrnil **403** (prijava ChatGPT); obstoj vtičnika je potrjen posredno (uradna dokumentacija + register MCP).
- **Notranjih API-jev aplikacije** (`/api/*`) — niso dokumentirani,vezani na sejo; njihovo dejansko obnašanje nisem preverjal (in ne sme se, glej §2.1).
- **Besedila GitHub issue #13** — repozitorij je zaseben, v tem peskovniku ni žetona; merila sprejema so prevzeta iz naloge naročnika (glavni agent ima dostop). Če issue vsebuje dodatna merila, jih dopolniti v §6.
- **Licence xeokit-sdk in ThatOpen Engine (ostale komponente)** — datoteke LICENSE niso bile dosegljive ob preverbi; označeno v §5.2.
- **Zrelosti izdelka iz tretjih virov** — nisem našel neodvisnih recenzij/člankov; edine ocene so lastne strani ponudnika (4 zvezdice na GitHub repozitoriju metapodatkov).
- **Kvalitete pretvorbe DWG/IFC** — zahtevala bi nalaganje realnega načrta v storitev; ni bilo testirano (in po §3.2 tudi ni priporočljivo z risbami strank).

---

*Dokument: `docs/WALKMYPLAN-13.md` · Avtor: raziskovalni podagent (1-b-R489) · Vsa preverjanja izvedena 12. 10. 2026 med 09:45–10:00 UTC. Sorodni dokumenti: `docs/SMART-VISION-8.md` (zaznavanje/AR), `docs/AUDIT-9.md` (veriga meritev).*

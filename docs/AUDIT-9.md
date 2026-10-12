# AUDIT #9 — HOVER PARITY: Faza 0 (obvezen pred implementacijo)

**Datum:** R472 · **Revizija kode:** main = R471 (`81481c0`, tag v1.27.0) · **Produkcija:** R470
**Metoda:** 4 vzporedna read-only pregleda (vizualizacija/3D, poslovni tok, zajem→geometrija, podatki/izvozi/testi) z dokazi `file:line`; trditve preverjene v dejanski kodi, ne po komentarjih. Testni dokazi = obstoječe regresijske suite (tests/*.py, ~1900+ kontrol).

**Lestvica:** ✅ DELUJE + preizkušeno · 🟡 DELUJE DELNO · 🔵 SAMO KODA/UI (brez preizkusa/dokaza) · ❌ MANJKA · ⛔ BLOKIRANO

---

## 1. Tehnična resnica №1 — renderer

**Ni three.js/WebGL/babylon** (package.json, node_modules — 0 zadetkov). Vsi »3D« prikazi so lastna koda:
- `viz-3d.tsx` → parametrična SVG perspektivna projekcija (cm → zaslon, painterjev algoritem, Newellove normale)
- `viz.tsx` → 2D SVG tehnična risba (tloris + stranski pogled + dimenzije)
- `foto-replace.tsx` → Canvas 2D + homografija 4 točke
- `dvojcek.tsx` → tabele/kartice, brez geometrijskega renderinga

## 2. Pregled po modulih (ciljni popis iz issue §2)

| Modul | Status | Dejansko stanje (dokaz) |
|---|---|---|
| `viz-3d.tsx` (527) | ✅ deluje (kar je) + 🟡 | SVG perspektivna risba konfiguracije, yaw/pitch, hover segmenta s tooltip dolžine (`:380-396, 511`). **Ni merilno registriran 3D model** — parametrična risba iz konfiguratorja; ni izvora/verzije/kakovosti/napake koordinat. |
| `viz.tsx` (1061) | ✅ + 🟡 | Konfigurator + 2D risba (tloris `:824-826`, stran `:831-889`, dimenzije, merilni trak, naslovni blok s SKU), izvoz SVG `:224-242`, strežniška cena z viri. Ni A/B/C variant, ni vezave na prostor. |
| `ar.tsx` (1619) | ✅ | SMART VISION F1–F4 (razredi prizora, tla/naklon, mere osi, oseba-zasebnost, AR globina R471). Overlay na živi kameri; tekača le bere. |
| `foto-replace.tsx` (1313) | ✅ | 5-stopenjski čarovnik, homografija na originalni fotografiji, PREJ/POTEM, A/B/C variante z verzioniranjem, opozorila kakovosti, žig »vizualizacija za predstavitev«, PDF izvoz; povezan s katalogom #6 (`photo-replace-core.ts`). 🟡 `sourcePhotoId` se vedno pošlje null (`:635`) — sledljivost oslabljena. |
| `dvojcek.tsx` (791) | ✅ | Digitalni dvojček AS-MEASURED→DESIGNED→PRODUCED→INSTALLED, vrata §7, 4D timeline, diff v cm, cross-check virov, AS-BUILT QA s tolerancami IZKLJUČNO iz EngineeringRule, provenance elementov. **Izključno tabularno — nobenega geometrijskega prikaza.** |
| `zajem.tsx` (1305) | ✅ + 🟡 | Capture konzola (FENCE_RUN/KAMERA), ruta, reference, drift, zaključek z vrati, replay. 🟡 quality zastavice posnetka so ročni checkboxi (`:743-761`). |
| `measure-engine.ts` (830) | ✅ | Deterministični foto-merilni engine: 7 načinov, 5 kalibracij, validacije §14, confidence §13, CSV/JSON izvoz (vejica+BOM). 2D točke na sliki — brez svetovnih koordinat; brez verzije engine v rezultatu. |
| `fence-run-engine.ts` (676) | ✅ | 1D veriga vozlišč (atCm) + višine + 1D teren → segmenti 2.5D (hypot), statusi ESTIMATED→CONFIRMED, verifiedCm+metoda, quality gate, reconcile z verzijami. **Ni 2D tlorisa (X/Y), ne 3D.** |
| `capture-qa-engine.ts` (941) | ✅ | Pokritost con, vodena ruta, drift, referenčna mreža z konflikti, kritična vrata (blokirajo zaključek 409), TwinSnapshot builderji, diff, crossCheckSources. |
| `product-core.ts` (421) | ✅ + 🟡 | 10 družin, ceniki NABAVNA/PRODAJNA/MONTAZA z veljavnostjo, popusti, minPrice; planBom = predloga × količina. 🟡 **Ni pravil odpada/reza**; višina/razmik stebrov/pritrditev se shranijo v calcJson, a jih plan ne uporabi. |
| `konfigurator.tsx` (1558) | ✅ + 🟡 | 6-korakovni čarovnik, prevzem izmere R455, prefill iz foto-viz R459, dry-run plan, ročni popravek količine z značko. 🟡 brez A/B/C, brez delne obnove, brez inženirskih validacij. |
| `ponudbe.tsx` (264) | ✅ + ❌ | Seznam, statusi, DDV 22 %, podpis → ZAKLENJEN. ❌ ENA pozicija z vgrajeno montažo; **brez skupin (material/montaža/dodatki), popustov na ponudbo, primerjalnih paketov**. |
| `pdf.tsx`/`pdf-mini.ts` | ✅ | Lasten generator PDF 1.4, WinAnsi+Differences za čšž, quote/račun/photoviz z IDOR varovali. |
| `reports.tsx` (557) | ✅ | 4 tipa poročil (prodaja/servis/zaloga/projekti) z RBAC fail-closed. |
| `nalogi.tsx` (990) | ✅ | Terenski tok, offline vrsta IndexedDB + sync, termini, ekipe. ❌ v nalogu ni SKU-jev/odrezov/kosovnice (živi v BOM/prefab). |
| API-ji | ✅ | 168 route.ts, vzorčna RBAC/IDOR (3 access plasti), AuditLog na vseh mutacijah. |
| Prisma (75 modelov) | ✅ | Verzioniranje povsod (MeasurementVersion, FenceRunVersion, twin parent-veriga, RuleVersion, CatalogVersion); Decimal(12,2) za denar. |

## 3. Štiri razlikovalne presoje iz issue §2

1. **Parametrična/SVG risba vs merilno skaliran 3D model:** ❌ model (kot koordinatna geometrija z izvorom/enotami/verzijo/napako) **NE OBSTOJA**. obstaja: parametrične risbe (viz/viz-3d) + 1D tekač (cm po loku) + 2D točke na fotografiji.
2. **Prekrivna AR risba vs prostorsko registrirana geometrija:** 🟡 AR overlay + depth razdalje (R471) so skalarni; registracija je 2D similariteta na načrt (r2p) — ni svetovne geometrije.
3. **Zapis v API-ju vs dokazano delujoč postopek:** 🟡 večina zapisov IMA delujoč postopek in teste (tekač, dvojček, BOM, ponudbe); brez dokaza: viz-3d hover (samo persistenca VizProject r454), UI interakcije nasploh (testi so API-nivo).
4. **Kosovnica iz ročno potrjenih podatkov vs količine iz segmentov:** ❌ BOM = predloga × skupna količina; vrstica NI vezana na segment; razmik stebrov/vrata/pritrditev ne vplivajo na vrstice.

## 4. Presoja po razdelkih issue #9

| § | Področje | Presoja |
|---|---|---|
| §3 | Pravi geometrijski model | ❌ glavna vrzel: ni XY/XYZ geometrije z izvorom; projekcije obstajajo samo iz konfiguratorja (parametrično); izbira segmenta z viri obstaja tabularno (dvojcek ElementDialog), ne na geometriji; fotografije nimajo položaja (conа = logična zona, GeoReference = na seji); AS-* primerjava je numerična (dvojcek diff), ne prostorska; σ napake ni per-dimenzija (tolerance iz EngineeringRule ali odkrito NO_VERIFIED_TOLERANCE_RULE) |
| §4 | 2D predlog → isti izdelek na 3D | 🟡 foto-viz PREJ/POTEM z A/B/C obstaja in se ročno prenese v konfigurator (prefill); ❌ ni preslikave istega SKU na segmente 3D modela (modela ni); ni označevanja »preverjeno sredstvo / približek / koncept« pri 3D |
| §5 | Model → količine → BOM → ocena → ponudba | ❌ količine ne izhajajo iz segmentov; ❌ Quote nima FK na paket/BOM → **ni invalidacije** (potrjena ponudba z zastarelo kosovnico je realno tveganje); ❌ odpad/rez; ❌ primerjalni paketi; ❌ skupine pozicij |
| §6 | Poročila in izvozi | ❌ merilni paket PDF (risba+segmenti+dimenzije+statusi+fotografije) manjka; ❌ montažna skica za monterja; ❌ proizvodni odrezni seznam kot dokument (prefab lističi so, a ne v PDF toku); 🟡 CSV/JSON samo za meritev (vejica+BOM pravilno), eSLOG XML (pika, standard); ❌ XLSX ne obstaja; ❌ round-trip uvoz ne obstaja; ❌ inženirska pravila se NE preverjajo pred izvozom (samo v R2P as-built) |
| §7 | Interaktivni pregled in virtualni sprehod | 🟡 capture replay obstaja (R464); ❌ enoten pregledovalnik (3D/tloris/elevacija/mreža fotografij) ne obstaja; ❌ skice/komentarji pripeti na segment/točko; 🟡 javno deljenje (portal/measure) je varno (žetoni, rok, preklic, tempomat, varni podskupini) — a **portal javno objavi fotografije stranke brez soglasja (GDPR lukna)** |
| §8 | Notranji prostori | ❌ PROSTOR = foto-poligon (površina/diagonale) na sliki; zajema med hojo ni (brez SLAM/pose) — odkrito |
| §9 | Povezave, webhooki, dobavitelji | 🟡 izhodni webhook provider obstaja (NOTIFY_WEBHOOK_URL, timeout, maskirani prejemniki); ❌ vhodnih API ključev/podpisov/idempotence partnerjev ni; ❌ CSV/JSON izvoz BOM/ponudb ne obstaja; dobavitelji = MaterialOrder tok interno (pravilno, brez fake integracij) |
| §10 | Predpridobivanje in spletni vizualizator | ❌ javni vizualizator ne obstaja (foto-replace zahteva prijavo); 🟡 CRM/portal/galerija obstajajo (lead→pretvorba, PortalLink, galerija zaključenih del); ❌ soglasje za fotografije |
| §11 | Lokalizacija | ✅ vsa besedila slovensko; DDV 22 %, eSLOG SI12, format EUR z vejico; zunanje integracije niso obvezne |
| §12 | Testna merila | ✅ audit (ta dokument); 🟡 testni projekt z zaznavo manjkajočih con delno pokrit z r460-r462; ❌ UI testi ne obstajajo (samo API) |

## 5. Tehnični dolgovi odkriti ob auditu (izven #9, za ločene naloge)

- Mrtvi cron `viz/gc` (404) v vercel.json
- Neuporabljena ENV spremenljivka `BLOB_READ_WRITE_TOKEN`, `API_KEY_PEPPER`, `SESSION_SECRET` (dokumentacijska nedoslednost)
- Soglasje za objavo fotografij na portalu (zasebnost) — predlog: zastavica `photoConsent` na Customer/Project + upoštevanje v public/portal in galeriji

## 6. Presoja poti implementacije (načrt faz — po vzorcu #8)

Trden temelj za gradnjo: **fence-run** (persistenten, verifikiran, cm) + **dvojček** (AS-* veriga, provenance) + **foto-viz** (2D predlogi, A/B/C) + **konfigurator/BOM/ponudbe** (poslovna jedro).

- **Faza 1 (§3):** `model-core` — izpeljava merilno skalirane geometrije IZ tekača: vozlišča dobijo svetovne XY (zagon iz atCm + interiorDeg pri vogalih), Z iz višin/terena; model {izvor, enote, verzija, kakovost/σ po segmentu, meje}; projekcije tloris/elevacija/3D; izbira segmenta → mere/vir/status/foto/izdelek; preslikava ključev seg-N v dvojček za prostorsko AS-* primerjavo; pošteno označevanje nezajetih/ocenjenih delov. Tekač ostaja vir resnice — model je izpeljava z ENGINE_VERSION.
- **Faza 2 (§5):** količine iz segmentov (stebri/ročnik/polnilo po odseku, pravila odpada iz EngineeringRule), vrstica BOM ← segment (sledljivost), Quote ↔ paket/BOM FK + invalidacija ob spremembi (status nazaj na OSNUTEK z revizijo), skupine pozicij.
- **Faza 3 (§4):** preslikava istega SKU iz foto-viz predloga na segmente modela; oznake preverjeno/približek/koncept.
- **Faza 4 (§6):** ~~merilni paket PDF, montažna skica, odrezni seznam; CSV/XLSX izvozi; preverjanje pravil~~ **IZVEDENO (R477)**: `/api/pdf/measure/[runId]` (tloris z dimenzijami + montažna skica + tabele + odrezni seznam + fotografije + preverjanja; `measure-package-pdf/1.0`), `/api/export/[bom|quote]/[id]?format=csv|xlsx|json` (lasten `xlsx-mini` ZIP/OOXML pisalnik brez paketov; CSV podpično+vejica+BOM usklajeno z measure-engine), round-trip parser v `export-core` (parseCsv = dokaz okroglosti), inženirska pravila pred izvozom so VIDNA (CSV `# OPOZORILO`, XLSX list »Preverjanja«, JSON `checks[]`); round-trip uvoz (import) IZVEDEN (R478): `POST /api/import/[bom|quote]` (multipart, preveri/uvozi) — `import-core` (CSV/XLSX/JSON parserji + diff), `xlsx-read` (STORE+DEFLATE+sharedStrings), varovalke regeneracije, invalidacija ponudb R474 se sproži, zneski ponudbe se ob uvozu PONOVNO izračunajo.
- **Faza 5 (§7–§10):** enoten pregledovalnik, pripeti komentarji, javni vizualizator s soglasjem, integracijska plast (po poslovni potrebi).

**Odločitve poštenosti (iz #8 prenesene):** nikoli ne lažemo o merilu (SVG/parametrični prikaz nikoli označen kot registriran model); nezajeti deli so vidno označeni; tolerance izključno iz EngineeringRule ali odkrito MANJKA; zasebnost (osebe se ne persistirajo) se ohranja.

---

## 7. End-to-end veriga (R488 — issue #9)

**Datum:** R488 · **Revizija kode:** main = R487 (`72cb6aa`, tag v1.42.0) + popravki P1/P2/P5 istega dne
**Metoda:** raziskovalni audit 1-a-R488 (veriga POTRJEN TEKAČ → … → PROIZVODNJA) → implementacija treh vrzeli → dokaz `tests/r488.py` (65 kontrol, 8 faz).

### 7.1 Tabela skokov (osvežena po popravkih R488)

| # | Skok | Kje | Status po R488 | Dokaz |
|---|---|---|---|---|
| 1 | Vozlišča+teren → segmenti | `fence-run-engine.computeSegments` + `syncSegments` | ✅ 1-D veriga (2.5D dolžine po padini), statusi §9 | r460, r488-B |
| 2 | TEKAČ → POTRDITEV | `POST /api/fence-run/[id]/confirm` | ✅ quality gate + kanonična meritev (params.fenceRunId + params.segments) + verzija v1 | r460, r488-C |
| 3 | POTRDITEV → PAKET (handoff) | isto, `handoff:true` | ✅ **P1 (R488)**: calcJson.inputs.segments v m-formi ({kljuc:'seg-N', dolzina, visina}) + razmikStebrovM iz pravila max_razdalja_stebrov; brez plan (suhi handoff) | r488-C |
| 4 | PAKET → BOM | `POST /api/project-packages/[id]/bom` → `planBom` | ✅ **P1 (R488)**: handoff paket zdaj izpelje vrstice PO SEGMENTU (segmentsApplied = N, BomLine.segmentKey) — prej 0 (predloga × qty) | r488-F |
| 5 | BOM → CENE | `resolveItemCost/resolveSalePrice/resolveMontaza` (ceniki) | ✅ en vir resnice za cene (R464) | r488-F/G |
| 6 | CENE → PONUDBA | `POST /api/quotes` (R474/R476) | ✅ popust + DDV 22 % iz osnove po popustu; invalidacija ob regeneraciji BOM (staleAt/staleReason → OSNUTEK) | r488-G |
| 7 | TEKAČ → MERILNI MODEL | `GET /api/fence-run/[id]/model` (R473) | ✅ seg-N 1:1, totalLengthCm == summary, turns L/D | r488-D |
| 8 | MODEL → DOKUMENT | `GET /api/pdf/measure/[runId]` (R477) | ✅ merilni paket (risba+skica+odrezni seznam) | r488-E |
| 9 | PAKET → AS-DESIGNED | `buildDesignedSnapshot` → `segmentsZaProjekt` | ✅ **P5 (R488)**: preferira POTRJENEGA tekača; osnutek samo kot fallback z vidnim opozorilom (runDraftWarning/runStatusAtSnapshot v meta) | r488-H |
| 10 | BOM POTRJEN → AS-PRODUCED | `buildProducedSnapshot` | ✅ + **R488**: parseTwinData ohrani produkt/RAL (prefab lističi nosijo RAL variante) | r488-H |
| 11 | AS-PRODUCED → PROIZVODNJA | `POST /api/production/from-twin` (R465) | ✅ PR nalog + elementi seg-N z merami/RAL/NAVRTEN; idempotenca 409 | r465, r488-H |
| 12 | MERITEV → KONFIGURATOR (prefill) | `konfigurator.prefillFromMeasurements` | ✅ **P2 (R488)**: meritev iz tekača prenese PRAVE segmente (seg-1…seg-N, dolžine/višine) namesto flat dolžine; ročno urejanje ostaja | r488-J (source) |

**Jedro dokaza — EN VIR RESNICE:** ključi `seg-N` so USKLAJENI čez celo verigo (tekač ↔ meritev ↔ model ↔ calcJson.inputs ↔ BomLine ↔ dvojček ↔ prefab) in skupna dolžina se prenese nespremenjena (tekač == meritev == model == dvojček == Σ lističev). To preverja `tests/r488.py` faza I na deterministični geometriji (4×250 cm).

### 7.2 Popravki R488 (implementirano)

1. **P1 — handoff paket brez segmentov:** `confirm` zapiše `calcJson.inputs.segments` (m-forma) + `razmikStebrovM` iz aktivnega `EngineeringRule max_razdalja_stebrov`; `calcJson.plan` se NE shranjuje. Meritvi smo dodali še `heightCm` v `params.segments` (vir za P2). Učinek: `POST /bom` na handoff paketu vrne `segmentsApplied = N` (ne 0) in BomLine s `segmentKey`.
2. **P2 — konfiguratorjev prefill splošči segmente:** `prefillFromMeasurements()` prenaša PRAVE segmente tekača, kadar meritev ima `params.fenceRunId` + neprazne `params.segments`; sicer stara flat pot. Ob tem popravljen 10× zaokrožitveni hrošč flat pretvorbe cm → m (`round(cm/10)/100` → `round(cm)/100`; komentar v kodi je že zahteval »cm → m«).
3. **P5 — segmentsZaProjekt brez statusnega filtra:** nova opcija `{ confirmedFirst: true }` (SAMO AS-DESIGNED pot); če obstaja POTRJEN tekač projekta, se uporabi najnovejši POTRJENI, sicer najnovejši katerikoli + `runDraftWarning: true`/`runStatusAtSnapshot` v meta snapshot-a (vidno, nikoli tiho — §19). `twinOverview` in ostali klicatelji obnašanja nespremenjeni.
4. **Najdena ob implementaciji — parseTwinData je puščal `produkt` za sabo:** `latestSnapshot` (AS-DESN → AS-PRODUCED → from-twin) je iz belega seznama izpustil `produkt`, zato prefab lističi NISO dobili RAL-ja variante. Whitelist razširjen za `produkt` (productId/variantId/ime/varianta/ral) — R488-H preverja `ral == 'RAL 7016'` na vseh lističih.

### 7.3 Znane meje (zavestno IZVEN obsega R488)

| # | Meja | Zakaj je OK / utemeljitev |
|---|---|---|
| P3 | **Ponudba NE gradi vrstic strežniško iz BOM** — danes odjemalec sestavi pozicije iz plan dry-run (`planBom`) in jih pošlje eksplicitno. | Ponudba je POSLOVNI dokument (popusti, ročne pozicije, teksti), ne tehnični BOM; avtomatsko pretakanje vrstic bi odjemu stranki onemogočilo prilagoditve. Kvantitativna povezanost OSTANE: ponudba je vezana na `packageId` (R474) → invalidacija ob spremembi obsega deluje, r488-G. Strežniška pretvorba je smiselna šele z zahtevo po »ponudba iz kosovnice v enem kliku« (nov issue). |
| P4 | **Quote NIMA direktne FK na ProductionOrder** — proizvodnja teče iz dvojčka/BOM (AS-PRODUCED iz POTRJENE kosovnice paketa, ki je vezan na ponudbo posredno prek paketa). | Zasnovno pravilo »tekač = BOM = dvojček = viri; ponudba/proizvodnja sta POGLEDA na njih« (R461/R465). Direktna vez bi ustvarila drugi vir resnice za obseg proizvodnje; sledljivost ponudba → paket → BOM → AS-PRODUCED → PR nalog že obstaja (r488 dokazuje konce verige). |
| P6 | **Kamera multiView meritev NE postane tekač** — flat potrditev ostaja eno-segmentna. | Transformacija 2D foto-izmere v 1-D verigo z vozlišči je izmišljanje podatkov (§19): foto točke nimajo atCm pozicij ob teku niti stebrov/vrat. Prava pot obstaja in je dokumentirana: ročni tekač (r460) ali zajem FENCE_RUN (r461). Ko bo zahtevek »iz kamere v tekač« konkreten, gre skozi zajem (capture-session FENCE_RUN mode). |
| — | Prefill P2 je UI-nivo (brez API dokaza) | Kontrole r488-J so source-grep (isti vzorec kot r487-E za UI nize); funkcija je čista pretvorba prebranih podatkov (brez strežniške logike). |

*Dokaz R488: `tests/r488.py` — 65 kontrol, faze A–K (priprava, tekač, potrditev+handoff, model, PDF, BOM, ponudba, dvojček+proizvodnja, konsistenca+RBAC, P2 source, čiščenje ×2). Regresija ob objavi: r462 91/91, r465 90/90, r475 49/49, r476 51/51, r474 37/37, r486 70/70, r487 71/71, tsc 0 napak, lint čisto, dev.log brez 5xx.*

---

*Dokazi: file:line reference v tem dokumentu so bile zbrane z neposrednim branjem kode R471 (main). Testna pokritost: tests/r437–r471 (33 datotek, ~1900+ kontrol), CI matrika r465–r471.*

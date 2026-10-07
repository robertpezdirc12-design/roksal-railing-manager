# Roksal Railing Manager — REKONSTRUKCIJA (R431–R439)

> **Datum:** 6.–7. 10. 2026 · **Veja:** `rekonstrukcija`
> Ta veja vsebuje **funkcionalno rekonstrukcijo** aplikacije, zgrajeno iz blueprinta na veji `main`
> (rešeni artefakti z Vercela po izbrisu GitHub vira).

## Zakaj rekonstrukcija

- GitHub račun `markec12345678` (repo `Roksal-Railing-Manager`, ~430 iteracij R120–R430) je bil izbrisan 6. 10. 2026.
- Vercel ne hrani izvorne kode git-povezanih projektov (datotečna drevesa potekla) — glej `README.md` na `main`.
- Obnovitev prek GitHub Support je bila zahtevana; ta rekonstrukcija je vzporedna rezerva.

## Kaj je rekonstruirano (vir: blueprint na main)

| Sklop | Status |
|---|---|
| **Tema** | originalna Roksal paleta (navy `#1d2b3e` + amber `#f59e0b`) — izluščena iz produkcjskega CSS |
| **RBAC** | `permissions-core` — 38 pravic, 5 vlog (ADMIN, VODJA, MONTER 15, SKLADISCE 9, PROIZVODNJA 10) — po R425–R428 |
| **IA** | `nav-registry` — 5 sekcij (DANES, PROJEKTI, ZAJEM, PISARNA, PROFIL), 29 zavihkov z vrati — po R429 |
| **Terenski tok** | NAPROGRAMIRAN → V_TEKU (ZAČNI DELO) → V_ZAJEMU (ZAJEM) → V_PREVERI (PREVERI) → ZAKLJUCEN (ZAKLJUČI TEREN) — VERBATIM R429 §7 |
| **Revizija** | sistemski (globalni) + per-projekt pregled, `readsAllProjects` obseg — po R428 |
| **Plačila** | ločena od računov (`payments.read`/`payments.manage`) — po R425 |
| **Orodjarina** | modela `Equipment`/`EquipmentCheckout` — izposoja/vrnitev/servis, rok umeritve — R432 |
| **PDF izvoz** | lasten mini generator (`pdf-mini.ts`, PDF 1.4 + Helvetica/WinAnsi, šumniki) — R432 |
| **Globalno iskanje** | `/api/search` + Ctrl/Cmd+K dialog z navigacijo na zadetek — R433 |
| **Seje & geslo** | upravljanje sej (security.read), sprememba gesla s preklicom sej — R433 |
| **Timeline & termin** | kronološka zgodovina projekta, preurčitev termina naloga — R433 |
| **eSLOG XML** | izvoz računa v UBL 2.1 e-račun s sklicem SI12 — R434 |
| **Zgodovina nalogov** | globalni dnevnik dogodkov (MONTER vidi samo svoje) — R434 |
| **Vreme** | napoved Open-Meteo (brez ključa) z oceno primernosti za montažo — R434 |
| **Kontrola kakovosti** | model `QcCheck` — kontrolne točke proizvodnih nalogov — R434 |
| **Garancija** | modela `Warranty`/`WarrantyVisit` — veljavnost, obiski, oddaja po zaključku — R434 |
| **Portal stranke** | model `PortalLink` — javni varni pogled statusa (`/api/public/portal?token=`), predogled v aplikaciji, preklic, štetje ogledov — R435 |
| **Vzdrževanje** | model `JobRun` — cron opravila izvirnika (seje-gc, portal-gc, obvestila-gc) z ročnim zagonom in dnevnikom — R435 |
| **Namestitev & licenca** | prvi admin, ko ni uporabnikov (`/api/setup`) + aktivacija ključa z kontrolno vsoto mod 97 (`/api/aktivacija`) — R435 |
| **Meritve s kamero** | večtočkovni zajem na fotografiji (klik → polyline, kalibracija, koti/Δv, stopnice), VLM zaznava točk (`glm-4.6v`), zgodovina verzij meritev — R436 (issue #1) |
| **Celoten monter workflow** | vodi → projekt → nalog z navodili → dodelitev → teren → zaključek; RBAC obseg fail-closed (monter samo svoji) — R436 (issue #1) |
| **3D konfigurator** | lastna perspektivna projekcija (brez three.js): stebri/steklo/nagib, RAL barve, izračun cene → ponudba — R436 (issue #1) |
| **Obnova 15 rut** | material-prices/orders, punch, equipment/events, customers/dedup, deal-lock, payments/[id]+reconciliation, share meritev, surveys, engineering-rules, jobs/run, security/rate-limit — R437 (issue #2), glej `docs/RECOVERY-REPORT.md` |
| **Obvestila** | event → delivery model (11 tipov × 4 kanali), prefs po uporabniku, retry z varnostjo pred podvajanjem, maskirani naslovi — R438 (issue #5) |
| **Mobilni teren & offline** | IndexedDB vrsta + fotografije + predpomnilnik, idempotentna sinhronizacija prek `/api/sync` (opId), konflikti rešljivi v UI, PWA (manifest + sw.js) — R439 (issue #6) |

## Delujoči moduli

- **DANES** — operativni vhod, današnji nalogi, terenski tok z akcijami, **vreme za teren** (4-dnevna napoved z oceno primernosti — R434)
- **PROJEKTI** — preglednica (KPI), projekti (+ustvari/detail, **garancija z obiski** — R434, **portal stranke s predogledom** — R435), stranke, ponudbe (sprejem), računi + plačila (**eSLOG XML izvoz** — R434), nalogi (**globalna zgodovina dogodkov** — R434), teren
- **ZAJEM** — nalogi center (časovnica dogodkov), meritve, foto zajem (canvas), nagib kalkulator, kalkulator ponudbe, signatura (podpis → zaklep posla), **vizualizacija** (parametrična SVG risba: tloris + stranski pogled, izvoz SVG), **AR** (kamera + vlečni overlay ograje, zajem → FOTO meritev; pošten demo brez kamere)
- **PISARNA** — CRM (vodi + pipeline), **dokumenti** (poenoten arhiv ponudb + računov), zaloga (losi, sprejem), katalog profilov, proizvodnja (**kontrola kakovosti** — R434), logistika (razpored), Material V5 (BOM), **orodjarina** (izposoja, umeritve), **galerija** zaključenih del (FOTO na ZAKLJUCEN/ARHIV projektih), varnost (revizija R428 + aktivne seje R433 + **vzdrževanje in licenca** — R435), **PDF** (predogled/prenos ponudb in računov), **PostSig** (kokpit zaklenjenih poslov: račun + proizvodnja po podpisu)
- **PROFIL** — profil (sprememba gesla — R433), dovoljenja po vlogi, tema, odjava
- **Prijava** — običajna prijava + **začetna namestitev**, če v sistemu ni uporabnikov (R435)

Vseh 29 zavihkov IA je implementiranih (R432) — ni več placeholder šolsjk.

## Zagon

```bash
bun install
bun run db:push        # ustvari SQLite bazo (prisma/schema.prisma)
bunx node prisma/seed.cjs   # demo podatki (uporabniki, stranke, projekti, zaloga, profili, orodjarina, galerija)
bun run dev            # http://localhost:3000
bash tests/r437.sh && bash tests/r438.sh && bash tests/r439.sh   # regresija (dev strežnik mora teči)
```

### Demo prijava

| Vloga | E-pošta | Geslo |
|---|---|---|
| Administrator | `admin@roksal.si` | `Admin123!` |
| Vodja | `vodja@roksal.si` | `Vodja123!` |
| Monter | `monter@roksal.si` | `Monter123!` |
| Skladišče | `skladisce@roksal.si` | `Skladisce123!` |
| Proizvodnja | `proizvodnja@roksal.si` | `Proizvodnja123!` |

### Demo dodatki (R435)

- **Portal stranke:** projekti → P-2026-004 (Kovač) → podrobnost → sklop *Portal stranke* → **Predogled** (javni pogled, ki ga vidi stranka).
- **Vzdrževanje:** Pisarna → Varnost → *Vzdrževanje* (ADMIN) — zagon seje-gc / portal-gc / obvestila-gc.
- **Licenca:** Pisarna → Varnost → *Licenca* — demo aktivacijski ključ: `RS-YZKZ2-MNUPY-Y0D84`.
- **Začetna namestitev:** prikaže se le, če v bazi ni nobenega uporabnika (izprazni tabelo `User` ali počisti bazo).

## Mobilni teren & offline (R439 — GitLab issue #6)

Monter dela na objektu brez signala: vsako dejanje se shrani **lokalno v IndexedDB** (vrsta operacij + kompresirane fotografije + predpomnjeni seznam nalogov) in se ob vrnitvi signala **samodejno in idempotentno** sinhronizira prek `POST /api/sync` (enotni mehanizem iz route-mape izvirnika).

- **Offline dejanja** (zavihek Nalogi → podrobnost): hitra meritev, opomba, sprememba statusa, zaključek terena — tudi v kameri gumb *Shrani (offline)*.
- **Idempotenca:** vsak op nosi `opId` (UUID, generira odjemalec); strežnik shrani zadetek v `SyncOp` — ponovno pošiljanje istega opa VEDNO vrne shranjen rezultat brez podvajanja.
- **Konflikti** (npr. nalog je medtem že prešel v nov status) ostanejo v vrsti, vidni so v OfflineBadge (oblak v glavi) z razlogom in gumbom za rešitev (sprejem stanja strežnika).
- **Varnost:** ob **odjavi** se VSE lokalne shrambe izbrišejo; če se na isti napravi prijavi **drug uporabnik** (preklic/potek seje), se vrsta prejšnjega uporabnika pobriše ŠELEJ pred prvim pošiljanjem; zaključeni zapisi (starejši od 24 h) se samodejno počistijo.
- **PWA:** `manifest.webmanifest` + `sw.js` (app-shell predpomnilnik; API in poslovni podatki NIKOLI iz predpomnilnika) — registracija SAMO v produkciji (`NODE_ENV=production`), razvoj (HMR) nedotaknjen.

### Dejanska podpora naprav/brskalnikov (preverjeno)

| Zmogljivost | Chrome/Edge (desktop) | Chrome/Samsung Internet (Android) | Safari (iOS 16.4+) |
|---|---|---|---|
| IndexedDB vrsta + fotografije | ✓ | ✓ | ✓ (kvota ~60 % prostora; preverjeno omejitev 8 MB na fotografijo) |
| `navigator.onLine` + online/offline dogodki | ✓ | ✓ | ✓ (samo spremembe Wi-Fi/mobilnih podatkov; letalski način v Safari včasih zamudi) |
| Kompresija fotografij (canvas → JPEG) | ✓ | ✓ | ✓ |
| Samodejna sinhronizacija ob vrnitvi signala | ✓ | ✓ | ✓ (ob vrnitvi v pregrado/ospredju; v ozadju iOS zmrzne časovnike — ob odprtju aplikacije dohiti) |
| PWA namestitev + offline odpiranje (sw.js) | ✓ | ✓ (namestitev doma) | ✓ prek »Dodaj na domači zaslon« (iOS 16.4+ podpira SW; starejši iOS samo ikono) |
| Background Sync API (ni v uporabi) | ✓ | ✓ | ✗ — nadomeščeno z dogodkom `online` + intervalom 30 s |

Preverjeno z brskalniško avtomatizacijo (Chromium): izguba signala med meritvijo ✓, izguba signala med zajemom fotografije ✓, samodejna sinhronizacija obeh vrst po vrnitvi ✓, konflikt dvojnega prehoda prikazan in rešljiv ✓, odjava počisti IndexedDB ✓.

## Tehnologija

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 + shadcn/ui · Prisma (SQLite; original: PostgreSQL/Neon) · zustand · lucide-react

## Povezava na produkcijo

Živa (originalna) aplikacija še teče na `roksal-railing-manager.vercel.app` — uporabna kot referenca za nadaljnje usklajevanje. Baza Neon PostgreSQL z realnimi poslovnimi podatki je nepoškodovana.

> ⚠️ Če GitHub Support obnovi originalni repo, ga spojita nazaj kot primarni vir; ta veja ostane kot dokumentirana rezerva.

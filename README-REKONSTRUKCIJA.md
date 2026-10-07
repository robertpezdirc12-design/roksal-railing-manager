# Roksal Railing Manager — REKONSTRUKCIJA (R431–R434)

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

## Delujoči moduli

- **DANES** — operativni vhod, današnji nalogi, terenski tok z akcijami, **vreme za teren** (4-dnevna napoved z oceno primernosti — R434)
- **PROJEKTI** — preglednica (KPI), projekti (+ustvari/detail, **garancija z obiski** — R434), stranke, ponudbe (sprejem), računi + plačila (**eSLOG XML izvoz** — R434), nalogi (**globalna zgodovina dogodkov** — R434), teren
- **ZAJEM** — nalogi center (časovnica dogodkov), meritve, foto zajem (canvas), nagib kalkulator, kalkulator ponudbe, signatura (podpis → zaklep posla), **vizualizacija** (parametrična SVG risba: tloris + stranski pogled, izvoz SVG), **AR** (kamera + vlečni overlay ograje, zajem → FOTO meritev; pošten demo brez kamere)
- **PISARNA** — CRM (vodi + pipeline), **dokumenti** (poenoten arhiv ponudb + računov), zaloga (losi, sprejem), katalog profilov, proizvodnja (**kontrola kakovosti** — R434), logistika (razpored), Material V5 (BOM), **orodjarina** (izposoja, umeritve), **galerija** zaključenih del (FOTO na ZAKLJUCEN/ARHIV projektih), varnost (revizija R428 + aktivne seje), **PDF** (predogled/prenos ponudb in računov), **PostSig** (kokpit zaklenjenih poslov: račun + proizvodnja po podpisu)
- **PROFIL** — profil (sprememba gesla — R433), dovoljenja po vlogi, tema, odjava
- **Varnost** — revizijski dnevnik (R428)

Vseh 29 zavihkov IA je implementiranih (R432) — ni več placeholder šolsjk.

## Zagon

```bash
bun install
bun run db:push        # ustvari SQLite bazo (prisma/schema.prisma)
bunx node prisma/seed.cjs   # demo podatki (uporabniki, stranke, projekti, zaloga, profili, orodjarina, galerija)
bun run dev            # http://localhost:3000
```

### Demo prijava

| Vloga | E-pošta | Geslo |
|---|---|---|
| Administrator | `admin@roksal.si` | `Admin123!` |
| Vodja | `vodja@roksal.si` | `Vodja123!` |
| Monter | `monter@roksal.si` | `Monter123!` |
| Skladišče | `skladisce@roksal.si` | `Skladisce123!` |
| Proizvodnja | `proizvodnja@roksal.si` | `Proizvodnja123!` |

## Tehnologija

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 + shadcn/ui · Prisma (SQLite; original: PostgreSQL/Neon) · zustand · lucide-react

## Povezava na produkcijo

Živa (originalna) aplikacija še teče na `roksal-railing-manager.vercel.app` — uporabna kot referenca za nadaljnje usklajevanje. Baza Neon PostgreSQL z realnimi poslovnimi podatki je nepoškodovana.

> ⚠️ Če GitHub Support obnovi originalni repo, ga spojita nazaj kot primarni vir; ta veja ostane kot dokumentirana rezerva.

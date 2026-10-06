# Roksal Railing Manager — REKONSTRUKCIJA (R431)

> **Datum:** 6. 10. 2026 · **Veja:** `rekonstrukcija`
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

## Delujoči moduli

- **DANES** — operativni vhod, današnji nalogi, terenski tok z akcijami
- **PROJEKTI** — preglednica (KPI), projekti (+ustvari/detail), stranke, ponudbe (sprejem), računi + plačila, teren
- **ZAJEM** — nalogi center (časovnica dogodkov), meritve, foto zajem (canvas), nagib kalkulator, kalkulator ponudbe, signatura (podpis → zaklep posla)
- **PISARNA** — CRM (vodi + pipeline), zaloga (losi, sprejem), katalog profilov, proizvodnja, logistika (razpored), Material V5 (BOM)
- **PROFIL** — profil, dovoljenja po vlogi, tema, odjava
- **Varnost** — revizijski dnevnik (R428)

**Poštene šolsjke** (načrtovane, še ne implementirane): orodjarina, vizualizacija, AR, dokumenti, galerija, PDF, PostSig.

## Zagon

```bash
bun install
bun run db:push        # ustvari SQLite bazo (prisma/schema.prisma)
node prisma/seed.cjs   # demo podatki (uporabniki, stranke, projekti, zaloga, profili)
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

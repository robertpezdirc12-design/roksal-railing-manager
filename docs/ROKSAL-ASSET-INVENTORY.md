# ROKSAL inventar gradiv — stanje in naslednji krog (issue #16)

**Datum:** 16. 10. 2026 · **Revizija:** R533 · **Status:** ZAGETOVANO (ne
zaključeno) — to je izhodiščno stanje Faze 0 (inventura) + orodje Faze 4 +
pošten zapis blokad; polna izvedba Faz 1–3 je naslednja naloga.

## Faza 0 — inventura obstoječega (dokazano, ne ugibanj)

`public/assets/roksal/src/MANIFEST.json`: **116 vnosov, VSI s SHA-256**:

| kategorija | št. | kategorija | št. |
|---|---|---|---|
| galerija-foto | 42 | barvna-lestvica | 11 |
| detajl-barva (čipi R523/R524) | 33 | ograja-pokoncna | 9 |
| ograja-precna | 5 | fasada | 4 |
| terasa | 3 | profil-presek | 2 |
| komponenta | 2 | napušč / pregrada / vrtno pohištvo / produkt | 4 |

- Katalog (baza): 17 izdelkov fotomontažnih družin, 67 variant, 91 preverjenih
  sredstev (poročilo #14); matrika profil×barva za FOTO_IZDELEK: 0 manjkajočih
  (R493–R495); DETAJL čipi po varianti: POLNA-57 (3), POLNA-128 (6),
  POLNA-100 (8), ROMB-67 (7), KUBO (4) — R523/R524.
- Deduplikacija: MANIFEST je po SHA-256 (ista datoteka = en vnos; več URL-jev
  se zapiše v en vnos).

## Faza 4 — orodje (izvedeno)

`ops/roksal-fetch.mjs` — ponovljiv, idempotenten pregled/prenos javnih
uradnih gradiv: suha vožnja privzeto (--write zapiše), hitrostna omejitev
(R533_PAUSE_MS), SHA-256 dedup proti MANIFEST, izvirniki se NE prepišejo,
blokirane zahteve se zabeležijo z razlogom (nikoli obide zaščite), vezen vnos
v MANIFEST/SKU je NAMENOMO ročno (avtomatika ne ugiba semantike).

## Faza 1 — prvi poskus (pošten zapis blokade)

Zagon 16. 10. 2026 (suha vožnja): 6 strani → VSE odgovorile **200, a z
izziv-lupino** (~12 KB HTML, 0 povezav do wp-content) — strežnik roksal.com
za plain HTTP odjemalce streže ShellSquare izziv (isti vzorec kot v R524).
`robots.txt` prav tako vrača izziv-lupino (ni možno prebrati dovoljen).

**Utemeljena pot naprej (dokazano v R524):** branje strani prek prave
brskalniške seje (agent-browser; R524 je tako prenesel 4 lestvice v izvirnikih
2560 px). To je naslednji korak (delo + ~30 min na celoten krog strani);
skripta `roksal-fetch.mjs` prevzame nato izluščene URL-je prek `R533_URLS`.

## Kaj manjka (iskreno, po fazah iz #16)

- Faza 1: brskalniški obhod strani → zbiranje URL-jev izvirnikov (2560 px)
  vseh 6+ sekcij + notranje povezave; tehnični PDF (navodila za montažo).
- Faza 2: novi vnosi v MANIFEST + vezava na SKU/varianto + seed.
- Faza 3: parametrični modeli prereza (GLB) — odvisni od PROFIL_PRESEK
  gradiv (za POLNA/DESKA ne obstajajo v uradnih virih — dokazano R524).
- 3D/CAD datoteke: v uradni knjižnici DOSLEJ niso bile najdene — če jih
  ROKSAL ima, jih mora posredovati lastnik (enako kot #6 oskrba).

**Zavrnjene metode (meje):** brez obvajanja zaščite, brez scraping API-jev,
brez AI; javna dostopnost slike ≠ dovoljenje za redistribucijo — za nove
vnose se licence zapišejo pred --write.

---

## R567 — poskus brskalniškega obhoda (iskren zapis)

**Datum:** 18. 10. 2026 · **Cilj:** Faza 1 iz #16 — brskalniška seja (pot, ki
je uspela v R524 za 4 lestvice v izvirnikih 2560 px) za izluščenje URL-jev
izvirnikov z vseh 6 sekcij.

**Izid: BLOKIRANO (izziv-lupina) — z dokazi:**

1. **agent-browser (prava brskalniška seja, 2 seji):** stran
   `roksal.com/woodcore-wpc-deske/pregradne-stene/pokoncne-deske/` se ustavi
   na ShellSquare izzivu »One moment, please… / Please wait while your
   request is being verified…« — opaženo 5+ minut (vključno z reloadom in
   brskalnikovo UA glavo); izziv se V PESKOVNIKU (headless) ne reši.
   Varovanje je očitno strožje kot v oknu R524 (takrat je izziv padel v
   agent-browser seji).
2. **node fetch z brskalniško UA:** 200 + 11,9 kB izziv-lupina, 0 povezav
   do `wp-content` (enako kot suha vožnja R533 — `porocilo.strani[*].kandidati = 0`).
3. **neobideno:** skripta NE obide izziva (prepovedano po #16) — status je
   zabeležen kot BLOKIRANO z razlogom »zziv-lupina ShellSquare; headless
   peskovnik ne more rešiti JS izziva«.

**Poti naprej (po prioritetah):**
1. **Lastnik v PRAVEM brskalniku** (izziv za človeka pade v sekundah):
   odpri 6 sekcij + strani odtenkov, shrani slike v izvirni ločljivosti
   (desni klik → shrani sliko; NE sličice), položi v mapo ali pošlji —
   `ops/roksal-fetch.mjs --write` z `R533_URLS` jih nato poveže v MANIFEST
   (SHA-256 dedup, brez podvajanj).
2. **ROKSAL neposredno** (najboljše): prosba za medijsko knjižnico
   (izvirne fotografije izdelkov po profilu/odtenku, tehnični prerezi,
   montažna navodila PDF) — enak postopek kot pri oskrbi #6.
3. Ko bodo datoteke na voljo, vezava na SKU/varianto ostane NAMENOMO ročna
   (avtomatika NE ugiba semantike — pravilo #16 Faza 2).

**Stanje knjižnice OB ZAKLJUČKU R567:** 116 datotek v MANIFEST (čipi lestvic
R523/R524 v izvirnikih, fotografije izdelkov, barvne lestvice, tehnični PDF);
infrastruktura (idempotenten fetch, SHA-256 dedup, ProductAsset vezave,
seed) preverjena z r461. Brez novih datotek iz tega poskusa — nič ni
izmišljeno ali tiho nadomeščeno.

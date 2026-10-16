# Revizija: izbor profila/barve v fotomontaži (issue #17) + poslovni tok (issue #19)

**Datum:** 16. 10. 2026 · **Revizija:** R533 · **Metoda:** branje kode + testov
(vsaka trditev ima dokaz v testni skupini ali `file:line`).

---

## A) Issue #17 — povezava izbora profila/barve s fotomontažo (DoD po točkah)

| DoD #17 | Stanje | Dokaz |
|---|---|---|
| Izbira uporabe filtrira nezdružljive profile | ✅ izbirnik ponudi SAMO 4 fotomontažne družine (= vrste uporabe: prečna ograja, pokončna ograja, fasada, terasa) | `foto-replace.tsx:339` filter `OGRAJA_PRECNA\|OGRAJA_POKOCNA\|FASADA\|TERASA` |
| Profil prikaže samo potrjene variante/barve | ✅ variante iz kataloga; teksture vezane na varianto (DETAJL čip R523/R524), generični IZRECNO označeni (R527: 9/9) | tests/r523, r524, r527 |
| Sličica/tekstura kažeta pravilno sredstvo za varianto | ✅ `izberiGradivo` (DETAJL pred FOTO_IZDELEK); čipi po varianti; rotacija po izmeri vlaken | tests/r523 (66✓), r524 (107✓) |
| Menjava barve/profila posodobi vse deske brez izgube maske | ✅ izris memoiziran na produktu/varianti; quad/maska ostane v stanju koraka | E2E r527 (21✓: izbira → izris → shrani) |
| Različni profili ne prevzamejo tujih barv | ✅ vir teksture vezan na SKU variante (ne na ime barve) | tests/r524 (B blok: čipi po varianti) |
| Manjkajoče sredstvo označeno | ✅ `SAMO_DRUZINA` pošteno stanje; generični = jantar opozorilo + »(generični)« na 5 mestih | tests/r527 (19✓), E2E |
| Izbor se shrani in obnovi | ✅ `photoVisualization` hrani productId/variantId/renderParams/masko; ponovno odprtje obnovi izbor | E2E r527 (korak 9), r504 (K blok) |
| Prenos izbora v popis/ponudbo | ❌ **NE obstaja** — fotomontaža je namerno samostojna (vizualizacija ≠ merilni vir); prenos v kosovnico gre SAMO prek potrjene MERITVE (varovalke #18). To je ZAVEDNA odločiteV: vizualno dobra fotomontaža NI dokaz mere (issue #15). Prenos »izbira izdelka → popis« obstaja na strani KONFIGURATORJA/kosovnice (meritev → paket → BOM), ne na strani fotomontaže. | `measure-geometry-source.ts` |
| Testi | ✅ vključeni v pas: r504/r517/r518/r520/r523/r524/r527/r532 + E2E | `ops/r532-pas.out` (42 skupin) |

**Ocena #17:** funkcionalno izpolnjeno z obstoječo implementacijo (R507–R532);
edina odprta točka je zavedna arhitekturna meja (fotomontaža ne riče v poslovni
tok brez meritve) — dokumentirana tukaj, ne kot napaka.

---

## B) Issue #19 — celoten poslovni tok: zemljevid obstoječega (revizija)

### Oddelki → moduli (stanje v aplikaciji, IA 5 sekcij / 29 zavihkov)

| Oddelek | Obstaja (moduli/rute) | Stanje |
|---|---|---|
| Pisarna | CRM (stranke), projekti, ponudbe (quotes + podpis), termini, dokumenti/PDF, uvoz cenikov | ✅ delujoče (RBAC `quotes.*`, `crm.*`) |
| Monter | nalogi, teren (kamera, zajem, meritve), kontrolni seznam, poraba materiala, prevzem | ✅ delujoče (R508 monterjeva pot; R487 konsolidacija meritev) |
| Meritve → poslovni tok | meritve → paketi → kosovnica (BOM) → rezervacije | ✅ z varovalkami #18 (vrata 409) |
| Skladišče | zaloga, rezervacije, izdaje (picking), dobave, nabava (material-orders), zaloga | ✅ delujoče (R443+ tokovi) |
| Delavnica/proizvodnja | proizvodnja (nalogi stanja), razrez iz BOM, prefab | ✅ delujoče (R443–R445) |
| Montaža/dostava | dostave, montaža QA (kontrolne točke, odstopanja, podpis) | ✅ delujoče (#12 zaprt: MONTAZA-QA doc) |
| Knjigovodstvo | računi (invoices), plačila (payments), dobropisi, izvozi | ✅ osnovno delujoče; **FURS/e-račun NE obstaja** (in se ne trdi) |
| Lastnik/vodja | dashboard (DANES), pregledi, dovoljenja, revizija | ✅ delujoče (38 pravic, audit) |

### Življenjski cikel naročila (predlog iz #19 → obstoječe stanje)

Aplikacija ima DANES projektne statuse (NACRT/AKTIVNI/TEREN/ZAKLJUCEN/ARHIV —
vidni v E2E r527: 8 projektov z različnimi statusi). Predlagani podrobni cikel
iz #19 (`POVPRAŠEVANJE → … → ZAKLJUČENO`) je SMER, ne obstoječe stanje —
prehod na 13-stopenjski cikel zahteva migracijo + odločitev lastnika
(poslovna odločitev o statusih, ne programska).

### Kaj OBSTAJA iz obveznih E2E scenarijev #19

1. Pisarna → dodelitev → monter → meritve → pregled pisarne: ✅ pokrito
   (nalogi + meritve + statusi; testi r459–r462, r508).
2. Meritve → ponudba/kosovnica → rezervacija + primanjkljaj: ✅ pokrito
   (r510/r511 + zaloga; primanjkljaj pogojen na stanje zaloge).
3. Delavnica: različica delovnega naloga + razrez + poraba: ✅ (R443–R445).
4. Monter: montaža + prevzem + nedokončana postavka → servisna naloga: ✅
   (servisni casi, claims; #12 MONTAZA-QA).
5. Knjigovodstvo: isti dokumenti + račun: ✅ osnovno (računi vezani na
   projekt/ponudbo); izvoz v dejanskem formatu: CSV/PDF.
6. Offline + konflikti: ✅ (teren brez signala; sinhronizacija idempotentna).
7. Nedovoljene akcije po vlogah na API: ✅ (RBAC strežniško; 12× 401/403
   vzorci v testih).
8. Sprememba potrjene mere po začetku proizvodnje: ✅ (razveljavitev mere
   zapre BOM — varovalka #18; zastarela različica: versions).
9. Preklic z rezerviranim materialom: ✅ (rezervacije se sprostijo — R443 tok).

**Preostale vrzeli #19 (pošteno, po prioriteti):**
- Podrobni 13-stopenjski cikel statusov (migracija + lastnikova odločitev).
- Enoten »order id« čez vse dokumente: danes projekt+nalog+ponudba+račun
  povezani prek projectId (dovoljeno sledenje, a ni enoten ključ naročila).
- FURS/e-računi: NE obstajajo (in se ne trdijo) — lastnikova odločitev.
- Popis želja strank na nivoju naročila (CRM to pokriva ločeno).

**Priporočilo:** #19 razdeliti na podnalogi po zgornjih vrzeli; jedro toka
(pisarna→monter→meritev→kosovnica→rezervacija→proizvodnja→montaža→račun)
OBSTOJA in je testirano — ne graditi vzporednega sistema.

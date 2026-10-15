# Poročilo fotozamenjave (issue #14) — kaj je dejansko fotorealistično, kje je potreben ročni poseg in katera originalna gradiva manjkajo

Izdaja: R527, 2026-10-15 (posodobitev izdaje R523: kakovost teksture KUBO iz uradne
lestvice v izvirni ločljivosti, manjkajoči uradni materiali, ureditev variant po
namenski lestvici POLNA 57/32; R524: DETAJL čipi za ograje; R527: izrecna oznaka
generičnih demo izdelkov po alternativi (b) iz §5).
Viri teh trditev: koda (`src/lib/photo-replace-{mask,texture,core,engine}.ts`,
`sirinaIzTecha`/`rezaIzTecha`/`sirinaIzImena` v jedru), suite `tests/r504.py` (216 trditev),
`tests/r517.py` (66), `tests/r518.py` (69), `tests/r520.py` (83), `tests/r523.py` (66)
ter nabor `tests/fixtures/foto-montaza/manifest.json` (resnične ROKSALOVE fotografije z
ROČNO označenimi maskami). Pokritost gradiv je IZMERJENA iz istega kataloga, ki ga zagna
`bun run db:seed` (17 izdelkov v 4 fotomontažnih družinah, 67 variant; 91 preverjenih
sredstev skupaj).

## 1. Kaj je DEJANSKO fotorealistično

| Del | Kako je narejeno | Zakaj je to original in ne približek |
|---|---|---|
| Videz deske/profila | tekstura se vzame iz `ProductAsset.filePath` (nespremenjen izvirnik v `public/assets/roksal/src/`), nariše se po celicah mreže vsakega elementa | izbira gre samo po `status = VERIFIED` + obstoječa datoteka + zapisano dovoljenje (`izberiGradivo`, fail-closed); enobarvni približek se nariše samo, kadar preverjenega gradiva NI — in takrat rezultat to tudi pove |
| Mere (širina/reža) | širina profila IZ IMENA izdelka (`»POLNA DESKA 128« → 128 mm`, `»KLASIK 150×25« → 150 mm`, varnostni obseg 40–300 mm), razmak desk IZ `tech.razmakDeskMm` (`»5–30« → sredina 18 mm`, fail-closed 0–80 mm), terasna reža IZ uradnega FAQ (5–6 mm), KUBO 80×42 IZ uradnega lista | nobena mera ni izmišljena ali »lepa«; katalog/uradni vir sta edina avtoriteta (R517 popravek širine, R518 `rezaIzTecha`, R520 fasade/terase) |
| Barva WPC | `ODTENKI_HEX` — heksi so IZRAČUNANI iz preverjenih barvnih lestvic v repozitoriju (`roksal-barvna-lestvica-*.png`, mediana vzorcev), RAL ima prednost kjer obstaja | R517: prej je izbor »Golden teak« narisal sivo ograjo (RAL fallback) — popravljeno, 8 odtenkov iz uradnih lestvic |
| Perspektiva | homografija iz 4 označenih kotov kvada; vsaka celica dobi svojo afino preslikavo iz vira | mreža celic si deli TOČNE kote (brez rež in podvajanja), gostota se računa iz mere slike |
| Svetlost in robovi | svetlost se OCENI IZ FOTOGRAFIJE (`oceniSvetlobo` na kvadu), robovi in mehki prehodi so deterministični (mulberry32 `seme`) | enaki vhodi → enak izris; determinizem dokazan v r504 D/E |
| Red prekrivanja | prednji plan (rastlinje, stebri, rob balkona, celo ležalniki na terasi) se riše ZADNJI iz ORIGINALNIH pikslov | nova ograja/površina nikoli ne prekrije tega, kar je pred njo; zunaj maske izvirni piksel nespremenjen |
| Tekstura iz scenične fotografije | kadar katalog nima posnetka površine, a ima namestitveno fotografijo, se z deterministično izmero koraka desk (≥ 4 prereze, robustna mediana) izreze VSE letvice — izris vsako letvico fasade obleče z DRUGO desko po determinističnem semeanu (R523; R520 je vzel le eno — vse letvice so bile identičen klon) | brez te metode bi se na 80 mm letvico stisnila cela hiša; izmera je poštena: rebrasta površina ali premalo desk → `null` → fail-closed |
| **Tekstura KUBO iz uradne lestvice (R523)** | uradna barvna lestvica KUBO v IZVIRNIKU (2217×675, `wp-content/uploads`) vsebuje 4 FOTOGRAFSKE čipe površine po odtenku — vsak čip je deterministično izrezan (največji neprosojni kvadrat 184–210 px znotraj čipa, vlakna rotirana NAVPIČNO po izmeri anizotropije — skladno z realno KUBO fasado), registriran kot `DETAJL` variante in izbran PRED scenično FOTO_IZDELEK; vsaka letvica dobi svoj podizrez (62–100 %) in izmenično zrcalo po semean | 8–35× več ločljivosti na površino kot izrez iz namestitvene fotografije (17–21 px); nevtralna VLM primerjava stare/nove teksture na deskah: 4/10 → 8/10; revizija izreza: `ops/r523-cipi.json` |

Bistvo: fotorealističen je **površinski videz izbranega ROKSALOVEGA izdelka v perspektivi
fotografije**. Ni fotorealistična rekonstrukcija skrite 3D-scene — iz ene fotografije tega
ne obljubljamo.

## 2. Kje je potreben ROČNI poseg (in kako to vemo)

Obnova ozadja za staro ograjo je `obnoviOzadje`: vrednost piksla se izpelje SAMO iz znanih
sosedov (po robovih) z omejeno globino (`mejnaGlobina`). Posledica:

- Piksli, do katerih obnova ne doseže, so označeni `nedokončano` in se v izrisu **šrafirajo**
  (rumeno-oranžni pasovi `(244, 180, 60)`).
- `zahtevaRočniPoseg` je res samo kadar je nedokončanega nad pragom; takrat modul na zaslonu
  izrecno reče, naj monter masko zoži ali rezultat pusti označen kot nedokončan.
- Kadar preverjenega gradiva ni in se riše barvni preliv, izris nosi opozorilo
  `PREKRIVANJE_NI_ODSTRANITEV` — preliv NI odstranitev stare ograje in se tako tudi imenuje.
- Maske se urejajo s točkami (MAX_TOCK = 20 na obliko, MAX_OBLIK = 4 na vrsto) in
  razveljavitvijo zadnje točke.

Ročen korak ostaja **maska** (ograža / izpusti / prednji plan). Algoritem ograje SAM ne najde
in trditve, da bi jo, ni.

## 3. Pokritost originalnih ROKSALOVIH gradiv (izmerjeno 2026-10-15)

Družine v fotomontaži: `OGRAJA_PRECNA`, `OGRAJA_POKOCNA`, `FASADA`, `TERASA` —
17 izdelkov, 67 variant; 91 preverjenih sredstev skupaj.

| Izdelek | družina | gradiva (nivo izdelka) |
|---|---|---|
| ROK-OG-ROMB-67 | OGRAJA_PRECNA | BARVNA_LESTVICA, FOTO_IZDELEK, PROFIL_PRESEK, KOMPONENTA |
| ROK-OG-POLNA-128 | OGRAJA_PRECNA | BARVNA_LESTVICA, FOTO_IZDELEK |
| ROK-OG-DESKA-150 | OGRAJA_PRECNA | BARVNA_LESTVICA, FOTO_IZDELEK |
| ROK-OGP-POLNA-100 | OGRAJA_POKOCNA | BARVNA_LESTVICA (uradni izvirnik prenesen — R523 preveril identiteto), FOTO_IZDELEK |
| ROK-OGP-POLNA-57 | OGRAJA_POKOCNA | BARVNA_LESTVICA (**NAMENJENA lestvica 57/32** iz uradne medijske knjižnice — R523; prej zrcalo lestvice KUBO s strani Barvni odtenki), FOTO_IZDELEK (novi uradni produktni posnetek — R523) |
| ROK-FAS-KUBO | FASADA | BARVNA_LESTVICA (**IZVORNIK 2217×675** — R523), FOTO_IZDELEK, **DETAJL ×4 (čipi po odtenku)**, **PROFIL_PRESEK** (uradni tehnični posnetek profilov z alu cevmi — R523) |
| ROK-TER-KLASIK | TERASA | BARVNA_LESTVICA, FOTO_IZDELEK, DETAJL, GALERIJA |
| ROK-TER-RUSTIC | TERASA | BARVNA_LESTVICA, DETAJL |
| OGR-K-001/002, OGR-P-001/002, TER-WPC-001/002, TER-ALU-001, FAS-L-001, FAS-K-002 | vse 4 | — (generični demo izdelki, brez preverjenih gradiv) |

Po variantah (67): **34 ima lastni `FOTO_IZDELEK`** z datoteko; **67/67 ima zapisano barvo**
(`color`, RAL kjer obstaja); **9 variant ima lastni `DETAJL`** (terasni KLASIK ASH/BUT/OKW,
RUSTIC ROAK/RWA + vsi 4 odtenki KUBO — čipi uradne lestvice, R523).

Ureditev po uradnih lestvicah (R523): POLNA 57/32 ima namensko uradno lestvico s 3 čipi
(Amazon wood, Oak wood, Rustic walnut) — odvečna varianta Rustic oak je ODSTRANJENA
(zrcalni KUBO prikaz s strani Barvni odtenki je dokumentirano neskladje vira; namenska
lestvica iz februarja 2026 je odločilen dokaz). POLNA 128: lestvica ima 6 čipov in točno
ujema z aplikacijo (uradno besedilo »petimi barvami« je zastarelo — zabeleženo).

## 4. Dokazani primeri fotomontaže (R517–R523, vsak z izrisom + E2E skozi aplikacijo)

| Primer | Izdelek · varianta | Stanje gradiva | Dokaz |
|---|---|---|---|
| R517 | ROMB 67 · Golden teak | **UPORABLJENO** (VERIFIED tekstura, sha256 v dokazu) | `ops/r517-1..5-*` (original … zoom), `ops/r517-ui-2..6.png` |
| R518-A | POLNA 128 · Burma teak | **UPORABLJENO** | `ops/r518-A-{potem,primerjava,zoom}.png` |
| R518-B | POLNA 57 · Oak wood | **UPORABLJENO** | `ops/r518-B-*.png` |
| R518-B2 | POLNA 57 · Rustic walnut | SAMO_DRUZINA (variantni odtenek manjka — izrecno povedano; R523: ROAK zamenjan z uradno RWA po namenski lestvici) | `ops/r518-B2-*.png` |
| R518-C | DESKA 150 · Rustic oak | **UPORABLJENO** (reža 30 mm iz izmere produktne fotografije) | `ops/r518-C-*.png` |
| R518-D | POLNA 100 · White | **UPORABLJENO** | `ops/r518-D-*.png` |
| R518-E | ALU · antracit | NI_PREVERJENO (0 gradiv — pošteni barvni približek RAL 7016) | `ops/r518-E-*.png` |
| R520-F | KUBO fasada · Rustic oak | **UPORABLJENO** — R523: DETAJL čip uradne lestvice (ne več izrez iz namestitvene fotografije) | `ops/r520-F-*.png` |
| R520-F2 | KUBO fasada · Oak wood | UPORABLJENO — R523: čip (prej izrez 8–16 px/desko — mehkejša tekstura) | `ops/r520-F2-*.png` |
| R520-T | RUSTIC terasa · Rustic oak | **UPORABLJENO** (DETAJL zel-detajl, deska 150 iz imena + reža 6 iz FAQ) | `ops/r520-T-*.png` |
| R520-T2 | KLASIK terasa · Burma teak | **UPORABLJENO** | `ops/r520-T2-*.png` |
| R520-T3 | ALU terasa · Antracit | NI_PREVERJENO (0 gradiv — barvni približek) | `ops/r520-T3-*.png` |
| **R523-K** | KUBO fasada · Rustic oak | **UPORABLJENO — čip uradne lestvice** (204×204 px, vlakna navpično, variacija med letvicami) | `ops/r523-K-*.png` + `ops/r523-primerjava-kakovosti.png` (R520 ⊣⊢ R523 na istem primeru: 4/10 → 8/10 po nevtralni VLM) |
| R523-K2 | KUBO fasada · Oak wood | **UPORABLJENO — čip** (194×194) | `ops/r523-K2-*.png` |
| R523-K3 | KUBO fasada · Amazon wood | **UPORABLJENO — čip** (210×210) | `ops/r523-K3-*.png` |
| R523-KM | KUBO fasada brez variante | SAMO_DRUZINA — množica izrezov iz scenične fotografije: vsaka letvica svoja deska (dokaz poti) | `ops/r523-KM-*.png` |

E2E skozi pravo aplikacijo (prijava → nalaganje → maska → referenca → izdelek →
PREJ/POTEM → SHRANI → preverba zapisa v bazi → čiščenje): `ops/r517-ui-*`,
`ops/r518-e2e.py` (14 ✓ / 0 ✗), `ops/r520-e2e.py` (14 ✓ / 0 ✗), **`ops/r523-e2e.py`
(13 ✓ / 0 ✗ — FASADA: tip FASADA · letvica 80 mm · razmik 20 mm · gradivo
roksal-kubo-cip-roak.png (DETAJL) · engine 1.3.0), **`ops/r524-e2e.py` (15 ✓ /
0 ✗ — OGRAJA: tip POKOCNA · lamela 57 mm · razmik 20 mm · gradivo
roksal-polna57-cip-rwa.png (DETAJL — varianta, ki je v R518 padla v
SAMO_DRUZINA) · engine 1.3.0)**.

## 5. Kaj je treba še pridobiti (težava #6 — oskrba, ne aplikacija)

1. ~~`DETAJL` (makro posnetek površine) za **ograje**~~ — **REŠENO v R524**: 24 čipov
   površine iz uradnih barvnih lestvic v izvirni ločljivosti (POLNA-57: 3, POLNA-128: 6,
   POLNA-100: 8, ROMB-67: 7; izrezi 164–222 px, vlakna navpična po izmeri anizotropije,
   barvna bližina d=1–6/255). DESKA-150 NAMENOMERNO brez čipov: njena lestvica (terasa,
   »BARVE IN PROFILI«) kaže žlebičasto stran terasne deskе, ograja DESKA 150 pa gladko
   (VLM dokaz) — vir površine zanjo ostajajo scenične fotografije (dokazano R518).
2. ~~`DETAJL` za KUBO fasado~~ — **REŠENO v R523**: čipi uradne lestvice v izvirni
   ločljivosti (4 odtenki, 184–210 px na površino, vlakna navpično).
3. `FOTO_IZDELEK` za manjkajoče variante: `ROK-OGP-POLNA-57-RWA` — R524 je preveril
   uradno galerijo Pokončne ograje (za 57-32 obstajata samo OAK WOOD in AMAZON WOOD
   zapisa; salon: OKW) in salonske fotografije — scenski posnetek RWA 57/32 NE obstaja;
   varianta ima zdaj DETAJL čip uradne lestvice (UPORABLJENO), scenska slika pa ostaja
   odprta oskrbovalna težava. Terasne variante brez lastne slike delujejo prek
   DETAJL/GALERIJA na nivoju izdelka — pošteno stanje `SAMO_DRUZINA`.
4. `PROFIL_PRESEK` za POLNA 128/100/57 in DESKA 150 — R524 je preveril uradno medijsko
   knjižnica (iskanje »presek«: 0 zadetkov; »profil«: samo votli ročaj, ne polna deska) in
   obe produktni strani (prečna + pokončna): tehnični posnetek preseka NE obstaja
   (trenutno ROMB 67 in KUBO).
5. ~~Gradiva (ali izrecna oznaka »generični izdelek, ni ROKSALOV original«) za
   OGR-K-001/002, OGR-P-001/002, TER-WPC-001/002, TER-ALU-001, FAS-L-001, FAS-K-002.~~ —
   **REŠENO v R527 po alternativi (b) — izrecna oznaka** (gradiva ostajajo odprta
   oskrbovalna točka, težava #6): pravilo identitete v `src/lib/katalog-original.ts`
   (ROK- predpona — točen klasifikator: 9 generičnih IMA 0 preverjenih gradiv,
   8 originalov ≥ 1), oznaka na PETIH mestih: dopolnilo »— generični« v izbiri izdelka
   (+ razlaga pod njo), jantar opozorilo po izbiri, oznaka ob samem rezultatu POTEM
   (data-testid), »(generični)« v seznamu shranjenih vizualizacij in v javnem
   pregledu povezav (vidi ga stranka). Dokaz: `tests/r527.py` (19✓/0✗) +
   `ops/r527-e2e.py` (21✓/0✗ skozi pravo aplikacijo — OGR-K-001: brez gradiva v
   dokazni verigi, engine 1.3.0, pošten napis barvnega približka).
6. Ozadje za KUBO fasado: reže med letvicami prikazujejo pošteno šrafuro nedokončane
   obnove (R507 §2). Realna KUBO namestitev ima v režah temno podkonstrukcijo — barvo
   bi bilo mogoče izpeljati iz lastnih pikslov rež na izvirni fotografiji (dokazljiv vir);
   odločitev o tem je lastnikova, aplikacija ne izmišljuje ozadja.

## 6. Meje dokaza (pošten zapis)

- Suite dokazujejo geometrijo, masko, obnovo, izbiro gradiva, mere iz kataloga/uradnih
  virov, determinizem in fail-closed stanja; NE dokazujejo, da je končna slika »lepa« —
  o videzu odloča preverjen `filePath` + ročna maska.
- Opozorila v UI so tista, ki jih je poganjalnik **vrnil ob dejanskem izrisu**, ne napoved
  iz parametrov.
- Piksli se berejo z `willReadFrequently`; če brskalnik sliko označi za cross-origin
  (tainted canvas), se obnova IZKLOPI in modul ostane pri barvnem približku s poštenim
  opozorilom — ne pade.
- Dokumentacijske trditve o maskah veljajo za nabor v `manifest.json`; za nove fotografije
  mora masko ponovno označiti človek.
- Vse izrise nosi žig §15 »VIZUALIZACIJA ZA PREDSTAVITEV« — ni proizvodni načrt in ne
  dokaz popolne barvne identičnosti na zaslonu.

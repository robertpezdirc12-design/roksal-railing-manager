# Poročilo fotozamenjave (issue #14) — kaj je dejansko fotorealistično, kje je potreben ročni poseg in katera originalna gradiva manjkajo

Izdaja: R521, 2026-10-15 (posodobitev izdaje R507 z dejanskim stanjem po R517/R518/R520).
Viri teh trditev: koda (`src/lib/photo-replace-{mask,texture,core,engine}.ts`,
`sirinaIzTecha`/`rezaIzTecha`/`sirinaIzImena` v jedru), suite `tests/r504.py` (216 trditev),
`tests/r517.py` (66), `tests/r518.py` (69), `tests/r520.py` (83) ter nabor
`tests/fixtures/foto-montaza/manifest.json` (resnične ROKSALOVE fotografije z ROČNO
označenimi maskami). Pokritost gradiv je IZMERJENA iz istega kataloga, ki ga zagna
`bun run db:seed` (17 izdelkov v 4 fotomontažnih družinah, 68 variant; 85 preverjenih
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
| Tekstura iz scenične fotografije | kadar katalog nima posnetka površine, a ima namestitveno fotografijo, se z deterministično izmero koraka desk (≥ 4 prereze, robustna mediana) izreže ENE letvice tekstura — cela slika se NIKOLI ne stisne na eno letvico (R520) | brez te metode bi se na 80 mm letvico stisnila cela hiša; izmera je poštena: rebrasta površina ali premalo desk → `null` → fail-closed |

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
17 izdelkov, 68 variant; 85 preverjenih sredstev skupaj.

| Izdelek | družina | gradiva (nivo izdelka) |
|---|---|---|
| ROK-OG-ROMB-67 | OGRAJA_PRECNA | BARVNA_LESTVICA, FOTO_IZDELEK, **PROFIL_PRESEK, KOMPONENTA** (edini s presekom) |
| ROK-OG-POLNA-128 | OGRAJA_PRECNA | BARVNA_LESTVICA, FOTO_IZDELEK |
| ROK-OG-DESKA-150 | OGRAJA_PRECNA | BARVNA_LESTVICA, FOTO_IZDELEK |
| ROK-OGP-POLNA-100 | OGRAJA_POKOCNA | BARVNA_LESTVICA, FOTO_IZDELEK |
| ROK-OGP-POLNA-57 | OGRAJA_POKOCNA | BARVNA_LESTVICA, FOTO_IZDELEK |
| ROK-FAS-KUBO | FASADA | BARVNA_LESTVICA, FOTO_IZDELEK (namestitvene/scenične fotografije) |
| ROK-TER-KLASIK | TERASA | BARVNA_LESTVICA, FOTO_IZDELEK, DETAJL, GALERIJA |
| ROK-TER-RUSTIC | TERASA | BARVNA_LESTVICA, DETAJL |
| OGR-K-001/002, OGR-P-001/002, TER-WPC-001/002, TER-ALU-001, FAS-L-001, FAS-K-002 | vse 4 | — (generični demo izdelki, brez preverjenih gradiv) |

Po variantah (68): **34 ima lastni `FOTO_IZDELEK`** z datoteko; **68/68 ima zapisano barvo**
(`color`, RAL kjer obstaja); **5 variant ima lastni `DETAJL`** (vse terasne:
RUSTIC ROAK/RWA, KLASIK ASH/BUT/OKW — makro posnetki 1920×1080 ene deske).

Sprememba proti izdaji R507: `DETAJL` takrat ni obstajal za NITI EN izdelek; zdaj obstaja
za 5 terasnih variant in 2 terasna izdelka. Katalog se je razširil tudi na FASADO (KUBO)
in TERASE (KLASIK/RUSTIC) — te družine R507 poročilo še ni pokrivalo.

## 4. Dokazani primeri fotomontaže (R517–R520, vsak z izrisom + E2E skozi aplikacijo)

| Primer | Izdelek · varianta | Stanje gradiva | Dokaz |
|---|---|---|---|
| R517 | ROMB 67 · Golden teak | **UPORABLJENO** (VERIFIED tekstura, sha256 v dokazu) | `ops/r517-1..5-*` (original … zoom), `ops/r517-ui-2..6.png` |
| R518-A | POLNA 128 · Burma teak | **UPORABLJENO** | `ops/r518-A-{potem,primerjava,zoom}.png` |
| R518-B | POLNA 57 · Oak wood | **UPORABLJENO** | `ops/r518-B-*.png` |
| R518-B2 | POLNA 57 · Rustic oak | SAMO_DRUZINA (variantni odtenek manjka — izrecno povedano) | `ops/r518-B2-*.png` |
| R518-C | DESKA 150 · Rustic oak | **UPORABLJENO** (reža 30 mm iz izmere produktne fotografije) | `ops/r518-C-*.png` |
| R518-D | POLNA 100 · White | **UPORABLJENO** | `ops/r518-D-*.png` |
| R518-E | ALU · antracit | NI_PREVERJENO (0 gradiv — pošteni barvni približek RAL 7016) | `ops/r518-E-*.png` |
| R520-F | KUBO fasada · Rustic oak | **UPORABLJENO** (izrez ene letvice iz namestitvene fotografije) | `ops/r520-F-*.png` |
| R520-F2 | KUBO fasada · Oak wood | UPORABLJENO (izrez; vir 8–16 px/desko — mehkejša tekstura, izrecno) | `ops/r520-F2-*.png` |
| R520-T | RUSTIC terasa · Rustic oak | **UPORABLJENO** (DETAJL zel-detajl, deska 150 iz imena + reža 6 iz FAQ) | `ops/r520-T-*.png` |
| R520-T2 | KLASIK terasa · Burma teak | **UPORABLJENO** | `ops/r520-T2-*.png` |
| R520-T3 | ALU terasa · Antracit | NI_PREVERJENO (0 gradiv — barvni približek) | `ops/r520-T3-*.png` |

E2E skozi pravo aplikacijo (prijava → nalaganje → maska → referenca → izdelek →
PREJ/POTEM → SHRANI → preverba zapisa v bazi → čiščenje): `ops/r517-ui-*`,
`ops/r518-e2e.py` (14 ✓ / 0 ✗), `ops/r520-e2e.py` (14 ✓ / 0 ✗).

## 5. Kaj je treba še pridobiti (težava #6 — oskrba, ne aplikacija)

1. `DETAJL` (makro posnetek površine) za **ograje** (POLNA 128/100/57, DESKA 150, ROMB 67) —
   trenutno se uporabljajo produktne fotografije FOTO_IZDELEK, kar je dokazano dovolj za
   razmerja/barvo, makro pa bi dvignil verodostojnost površine.
2. `DETAJL` za **KUBO fasado** — namestitvene fotografije so scenične (cela hiša, 8–16 px na
   desko); izrez ene letvice deluje, a je na povečavi mehak.
3. `FOTO_IZDELEK` za manjkajoče variante: `ROK-OGP-POLNA-57-ROAK` in `-RWA` (ograji),
   terasne variante brez lastne slike (KLASIK in RUSTIC imata slike/DETAJL le za del
   variant; preostale delujejo prek DETAJL/GALERIJA na nivoju izdelka — pošteno stanje
   `SAMO_DRUZINA`).
4. `PROFIL_PRESEK` za POLNA 128/100/57 in DESKA 150 (trenutno samo ROMB 67).
5. Gradiva (ali izrecna oznaka »generični izdelek, ni ROKSALOV original«) za
   OGR-K-001/002, OGR-P-001/002, TER-WPC-001/002, TER-ALU-001, FAS-L-001, FAS-K-002.

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

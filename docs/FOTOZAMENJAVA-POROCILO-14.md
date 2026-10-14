# Poročilo fotozamenjave (issue #14) — kaj je dejansko fotorealistično, kje je potreben ročni poseg in katera originalna gradiva manjkajo

Izdaja: R507, 2026-10-14. Vir teh trditev: koda (`src/lib/photo-replace-{mask,texture,core,engine}.ts`),
suite `tests/r504.py` (196 trditev) in nabor `tests/fixtures/foto-montaza/manifest.json`
(4 resnične ROKSALOVE fotografije). Podatki o pokritosti gradiv so brani iz ISTEGA kataloga,
ki ga zagna `bun run db:seed` (9 ograjnih izdelkov, 39 variant).

## 1. Kaj je DEJANSKO fotorealistično

| Del | Kako je narejeno | Zakaj je to original in ne približek |
|---|---|---|
| Videz deske/profila | tekstura se vzame iz `ProductAsset.filePath` (nespremenjen izvirnik v `public/assets/roksal/src/`), nariše se po celicah mreže vsakega elementa | izbira gre samo po `status = VERIFIED` + obstoječa datoteka + zapisano dovoljenje (`izberiGradivo`, fail-closed); enobarvni približek se nariše samo, kadar preverjenega gradiva NI — in takrat result to tudi pove |
| Perspektiva | homografija iz 4 označenih kotov kvada; vsaka celica dobi svoj afini preslikava iz vira (`projekcijaIzRavnine`, `celiceZaElement`) | mreža celic si deli TOČNE kote (brez rež in brez podvajanja), gostota se računa iz metre slike, ne iz lepote |
| Rozne barve in dimenzije | iz kataloga (SKU, varianta, višina, lamele, razmiki, RAL → hex) | nobena cena ali materialna definicija ni postavljena na novo |
| Svetlost in robovi | svetlost se OCENI IZ FOTOGRAFIJE (`oceniSvetlobo` na kvadu), robovi in mehki prehodi so deterministični (mulberry32 `seme`) | enaki vhodi → enak izris; determinizem je dokazan s trditvami D/E v `r504.py` |
| Reda prekrivanja | prednji plan (raslinje, stebri, rob balkona) se riše ZADNJI iz ORIGINALNIH pikslov (`slojPrednjega`, `zložiPrednjiPlan`) | nova ograja nikoli ne prekrije tega, kar je pred njo; zunaj maske ostane izvirni piksel nespremenjen |

Bistvo: fotorealističen je **površinski videz izbranega ROKSALOVEGA izdelka v perspektivi fotografije**.
Ni fotorealistična rekonstrukcija skrite 3D-scene — iz ene fotografije to ne obljubljamo.

## 2. Kje je potreben ROČNI poseg (in kako to vemo)

Obnova ozadja za staro ograjo je `obnoviOzadje`: vrednost piksla se izpelje SAMO iz znanih sosedov
(po robovih) z omejeno globino (`mejnaGlobina`). Posledica:

- Piksli, do katerih obnova ne doseže, so označeni `nedokončano` in se v izrisu **šrafirajo**
  (rumeno-oranžni pasovi `(244, 180, 60)`), v poročilu pa so poimenovani po pasovih (`pasovi`, npr.
  `sredina 100 %`).
- `zahtevaRočniPoseg` je res samo kadar je nedokončanega nad pragom; takrat modul na zaslonu
  izrecno reče, naj monter masko zoži (natančneje označi območje) ali pa rezultat pusti označenega kot nedokončanega.
- Kadar preverjenega gradiva ni in se riše barvni preliv, izris nosi opozorilo
  `PREKRIVANJE_NI_ODSTRANITEV` — preliv NIE odstranitev stare ograje in se tako tudi imenuje.
- Robovi, ki jih je treba popraviti ročno: meje mask (ograža / izpusti / prednji plan) se urejajo
  z točkami (MAX_TOCK = 20 na obliko, MAX_OBLIK = 4 na vrsto) in razveljavitvijo zadnje točke.

Kateri korak je ročen: **maske**. V naboru `manifest.json` so maske označil človek (agent,
2026-10-14) iz pregleda fotografije v naravni velikosti; algoritem ograje SAM ne najde in trditev,
da bi jo, v tem orodju ne obstaja.

## 3. Pokritost originalnih ROKSALOVIH gradiv (kaj še manjka)

Stanje v katalogu (izdelki družin `OGRAJA_PRECNA` / `OGRAJA_POKOCNA`):

- 9 izdelkov, 39 variant; **30 variant ima preverjen `FOTO_IZDELEK` z datoteko**, 9 ga nima.
- `PROFIL_PRESEK` (pravi presek profila) obstaja samo za **ROK-OG-ROMB-67**.
- `KOMPONENTA` (pritrdila/vodilni profili) obstaja samo za **ROK-OG-ROMB-67**.
- `DETAJL` (hrapavost površine, rob deske, spoj) **ne obstaja za NITI EN izdelek**.
- `BARVNA_LESTVICA` je pri 5 ROKSALOVIH izdelkih shranjena na nivoju družine (`SPLOSNO`),
  ne kot potrjen odtenek na varianto → barva se upošteva iz kataloga (RAL), ne iz slike.

| Izdelek | variante | FOTO_IZDELEK po variantah | družinska gradiva |
|---|---|---|---|
| OGR-K-001 (ALU vertikalne palice) | 2 | 0 | — (brez vseh gradiv) |
| OGR-K-002 (lamelna) | 2 | 0 | — |
| OGR-P-001 (ALU horizontalne palice) | 3 | 0 | — |
| OGR-P-002 (INOX prečna) | 0 | 0 | — |
| ROK-OG-DESKA-150 | 7 | 7 | BARVNA_LESTVICA, FOTO_IZDELEK (PRECNA) |
| ROK-OG-POLNA-128 | 6 | 6 | BARVNA_LESTVICA, FOTO_IZDELEK (PRECNA) |
| ROK-OG-ROMB-67 | 7 | 7 | BARVNA_LESTVICA, FOTO_IZDELEK (POKOCNA), PROFIL_PRESEK, KOMPONENTA |
| ROK-OGP-POLNA-100 | 8 | 8 | BARVNA_LESTVICA, FOTO_IZDELEK (POKOCNA) |
| ROK-OGP-POLNA-57 | 4 | 2 | BARVNA_LESTVICA, FOTO_IZDELEK (POKOCNA) — **ROAK in RWA brez slike** |

Za izdelke brez kakršnegakoli preverjenega gradiva (OGR-K-001/002, OGR-P-001/002) modul
**ne more** trditi, da prikazuje original: izris je barvni približek, uporabnik pa dobi stanje
`BREZ_IZDELKA` / `NI_PREVERJENO` in jasno napisano, kaj manjka.

## 4. Kaj je treba pridobiti, da bo DoD dosežen brez zmanjševanja resnice

1. `PROFIL_PRESEK` za POLNA 128, POLNA 100, POLNA 57/30 in DESKA 150 (trenutno samo ROMB 67).
2. `DETAJL` za vseh 5 ROKSALOVIH profilov (makro posnetek površine — ključno do "videti je deska,
   ne barva").
3. `BARVNA_LESTVICA` na nivoju variante s potrjenim imenom odtenka (`colorName`), ne samo družinska.
4. Manjkajoči `FOTO_IZDELEK` za `ROK-OGP-POLNA-57-ROAK` in `ROK-OGP-POLNA-57-RWA`.
5. Gradiva (ali izrecna oznaka "generični izdelek, ni ROKSALOV original") za OGR-K-001/002 in
   OGR-P-001/002.

## 5. Meje dokaza (pošten zapis)

- `r504.py` dokazuje geometrijo, masko, obnovo, izbiro gradiva, determinizem in fail-closed stanja;
  NE dokazuje, da je končna slika "lepa" — o videzu odloča preverjen `filePath` + ročna maska.
- Opozorila v UI so zdaj tista, ki jih je poganjalnik **vrnil ob izrisu** (`izrisiOgrajo` /
  `izrisiPrimerjavo` vrneta seznam), ne napoved iz parametrov; `oceniKakovost` ostane kot ocena
  iz vhodov.
- Piksli iz `piksliIzSlike` se berejo z `willReadFrequently`; če brskalnik sliko označi za
  cross-origin (tainted canvas), se obnova IZKLOPI in modul ostane pri barvnem približku s
  poštenim opozorilom — ne pade.
- Dokumentacijske trditve o "4 resničnih fotografijah" veljajo za nabor v `manifest.json`;
  za nove fotografije mora masko ponovno označiti človek.

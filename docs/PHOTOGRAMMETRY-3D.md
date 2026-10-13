# Fotogrametrija 3D — licencia, sistemi in merilna resnica (issue #15, faza 3)

**Datum:** 13. 10. 2026 · **Naloga:** R502 (issue #15, faza 3)
**Veja:** `varnostni-popravki-2026-10` · **HEAD pred tem commitom:** `9ec84fd`
**Koda:** `src/lib/photogrammetry-core.ts` (1163 vrstic, 0 uvozov) · `src/lib/photogrammetry-proof.ts` (815 vrstic, uvozi samo jedro)
**Test:** `tests/r502.py` (76 preizkusov; skupina `r502` v `tests/ci-matrix.sh:18` in `.github/workflows/ci.yml`)
**Artefakt:** `docs/artefacts/fotogrametrija-dokaz.json` — zapiše ga vsak zagon skupine, zato ne more ostati star.

## 0. Pravila dokaza

Številka je lahko v tem dokumentu samo, če jo izpiše **izveden** preizkus. Označba:
- **IZMERJENO (skupina)** — ponovljivo z `python3 tests/r502.py`.
- **IZMERJENO (razvojni sondi)** — ponovljivo z ukazom v §6; ni v pasu, ker ni dokaz o obljubi, ampak raziskava meja.
- **NEIZMERJENO** — ocena iz literature ali razreda težavnosti; nikoli se ne predstavlja kot rezultat.

---

## 1. Licenčni pregled (pred kakršnokoli odvisnostjo)

Faza 3 **ne doda nobene odvisnosti**. To preverja `tests/r502.py` blok J z branjem
`package.json` (vzorec `opencv|colmap|pycolmap|openmvg|meshroom|three|@tensorflow|onnx|glslang`)
in z branjem obeh izvornih datotek: `photogrammetry-core.ts` nima nobenega `import`/`require`.
Posledično je edina licenca, ki jo faza 3 uvede, licenca repozitorija.

Kljub temu je seznam spodaj narejen **zdaj**, ne šele ob morebitni prihodnji implementaciji — da
odločitev ni nikoli sprejeta pod pritiskom časa:

| Kandidat | Licenca | Prehodne odvisnosti | Sprejemljivost za ROKSAL |
|---|---|---|---|
| COLMAP | BSD-3-Clause | Eigen MPL2, FLANN BSD, Ceres Apache-2.0, glog BSD, gflags BSD, SuiteSparse LGPL-2.1, libzip BSD, SQLite javna domena | **Licenčno** sprejemljivo (BSD-3 je združljiv z lastniško rabo; zavezuje le obvestilo o avtorstvu). **Težaven** pogoj: SuiteSparse LGPL je v produkcijski poti, zato bi zahteval dinamično povezavo in objavo pogojev. |
| OpenMVG | MPL-2.0 (po datotekah) | OpenCV (izbirno) BSD-3, Ceres Apache-2.0, Eigen MPL2, lemon BSD, FLANN BSD | Sprejemljivo; MPL-2.0 pomeni, da morajo ostati spremembe **v isti datoteki** odprtokodne — obveznosti, ki je za majhno ekipo ne želimo prevzeti. |
| OpenCV (contrib) 4.x | Apache-2.0 | protobuf BSD, ITT API BSD; **brez GPL konfiguracije samo z `OPENCV_ENABLE_NONFREE=0`** | Sprejemljivo, če je nonfree del (SIFT/SURF) izklopljen. |
| Meshroom / AliceVision | Apache-2.0 | OpenCV, OpenEXR BSD, CUDA orodna_veriga (NVIDIA EULA, **ni za predelavo**) | Zavrnjeno zaradi CUDA EULA-ja v produkcijski verigi. |
| WebXR depth / LiDAR API | del brskalnika, brez licenčne obveznosti | — | Uporabno samo kot **dodatek**, ne kot podlaga meritev (že opisano v fazi 0). |

**Opozorilo o GPL:** noben kandidat ne sme biti statično povezan z GPL komponento; niz `gpl`
se v `package.json` ne sme pojaviti (del bloka J).

**Kakovost tabele zgoraj:** glavne licence (BSD-3-Clause, MPL-2.0, Apache-2.0) so preverjene
pri viru (COLMAP: `colmap.github.io/license.html` — uradno besedilo izrecno pravi, da
licenca velja **samo za COLMAP sam, ne za njegove thirdparty komponente**, kar je razlog za
zadnji odstavek). Seznam **prehodnih** odvisnosti v tej fazi NI bil preverjen proti njihovim
`LICENSE` datotekam; preden se katerikoli kandidat sprejme, je to obvezno ponovno preveriti,
ker se licence med različicami spreminjajo. Ker faza 3 ni uvedla nobene odvisnosti, tabela
zaenkrat služi samo kot pogoj odločanja, ne kot dokovljiv pravni status.

## 2. Sistem, vzdrževanje in zakaj ne nativni pogon v mobilnem odjemalcu

Tabela je izpolnjena **pred** implementacijo, zato so številke stuba »native engine« ocene
(NEIZMERJENO), naša pot pa je izmerjena.

| Postavka | Nativni SfM (COLMAP/OpenMVG) | **Faza 3: čisti TypeScript, brez odvisnosti** |
|---|---|---|
| CPU (par slik, ~40 ujemanj) | 10²–10³ s na namizju (NEIZMERJENO) | **10,2 s za vseh 7 scenarijev + preverjanje determinizma** (IZMERJENO (skupina), razvojni računalnik, brez GPU) |
| RAM | 2–8 GB (NEIZMERJENO) | **NEIZMERJENO** — postopek teče v Node-ju, vršne porabe nismo merili |
| GPU / CUDA | za uporaben ritem skoraj obvezen → NVIDIA EULA + diskretna kartica | **brez** |
| Disk / namestitev | 1–3 GB binarnih odvisnosti + gradbena orodja | **0 B** (datoteki v `src/lib`) |
| Varnostno vzdrževanje | vsaka C/C++ odvisnost je napadna površina za CVE posodobitve | nič, kar bi bilo treba oskrbovati |
| Gradbeni čas | poseben cross-compile za vsako platformo | nič |
| Mobilni spletni odjemalec | **nemogoč** — monterjev telefon ne more pognati COLMAP; edina pot je pošiljanje slik na strežnik, kar pomeni nove GDPR obveznosti, skladiščenje in stroške | **da**, deterministično in brez omrežja |
| Vzdrževalec | potreben C++ build in znanje kalibracijske verige | obstoječa ekipa TypeScripta |

**Odločitev:** v mobilnem spletnem odjemalcu (telefon na gradbišču, slab signal, ROKSAL
monter) nativni težki pogon **ne pride v poštev**. Faza 3 zato klasično verigo
(Hartley & Zisserman, 2. izdaja, poglavja 4, 9 in 11) izpelje ročno v TypeScriptu. To ni
poskus prehiteti COLMAP na benchmarkih — je dokaz, da je **matematika pravilna in da pozna
svoje meje**.

## 3. Absolutno merilo: koda ne ve, koliko je centimeter

Dvopogledna rekonstrukcija je določena samo do skale. `meriloIzReference`
(`photogrammetry-core.ts:924`) zato merilo vzame **izključno** iz fizično izmerjene razdalje
med dvema rekonstruiranima točkama in zavrne: manjkajočo/negativno/ničelno vrednost,
razdaljo > 10 m in par, ki v rekonstrukciji sovpadata. `tests/r502.py` blok B preveri vseh
sedem vej (IZMERJENO (skupina): `merilo/manjka … merilo/natancen` — 7/7 ✓).

Posledica, ki jo je treba povedati monterju: **napaka reference se podeduje linearno.**
Scenarij `referenca_nihka_1_proc` (referenca izmerjena za 1 % narobe) da merilno napako
**1,259 %** in globinsko **1,261 %** (IZMERJENO (skupina)) — geometrija (rotacija 0,0459°)
je pri tem nespremenjena, saj 1 % napake ni mogoče ločiti od 1 % pravilnega merila.
Zato aplikacija sme prikazati centimetre samo, ko je referenčna razdalja **vnesena in
podpisana**, in mora ob njej pokazati, kako je bila izmerjena.

## 4. Protokol zavrnitve (`presodi`)

Pragi (`FOTOGRAMMETRIJA_PRAGI`, `photogrammetry-core.ts:983`): ≥ 12 kornjev, ≥ 12 ujemanj,
≥ 8 velikih, delež velikih > 0,5, mediana projekcijske napake ≤ 1,0 px, parallaksa ≥ 1,0°.
Tri odločitve: `SPREJET`, `ZAVRNJEN` (ni merila / ni modela), `DODATNI_POSNETKI`
(geometrijsko premalo gradiva). Vsaka zavrnitev nosi **poimenovane razloge** — ne tihe.

Rezultati sedmih scenarijev (IZMERJENO (skupina)):

| Scenarij | Odločitev | Merljivo |
|---|---|---|
| `panel_dva_pogleda` | SPREJET | rot **0,0459°**, smer premika **0,7624°**, ep **0,2069 px**, pj **0,4049 px**, parallaksa **11,00°**, 37 točk, skala **0,257 %**, globina **0,284 %**, referenca 19,931 cm → 25,2478 cm/enoto |
| `enotna_plosca_brez_teksture` | DODATNI_POSNETKI | 0 kornjev — detektor ne izmišljuje točk na gladki površini |
| `cista_rotacija_brez_baseline` | DODATNI_POSNETKI | parallaksa 0,0305°; skala 34,11 %, globina 46,86 % — brez baseline-a merila ni, čeprav je rotacija dobra (0,0238°) |
| `ponavljajoc_se_vzorec` | DODATNI_POSNETKI | 90 kornjev, a samo **1** enoznačno ujemanje — dvoumnost je razkrita, ne rešena z ugibanjem |
| `premajhen_premik` (B = 2 mm) | DODATNI_POSNETKI | parallaksa 0,111°, smer premika zgrešena za 94,65° |
| `ni_fizicne_reference` | ZAVRNJEN | geometrija enaka kot pri SPREJET (0,0459°), a `cmNaEnoto = null` — nič se ne izmišlja |
| `referenca_nihka_1_proc` | SPREJET | skala 1,259 % — napaka se podeduje in prikaže, ne prikriva |

## 5. RANSAC, izstopki in poštena meja

`ransacOsnovnaMatrika` (`:718`) ima lokalno optimizacijo (H&Z 9.4.4): po izbiri konsenzusa
se model ponovno prilagodi na notranjih točkah in spet izbere konsenzus (največ 2 ponovitvi).
Brez tega koraka model obdrži pare, ki so bili sprejeti samo zato, ker je bil vzorec napačen.

Izpit (`tests/r502.py` blok C, IZMERJENO (skupina)): 13 parov je **z istino dokazano
napačnih** (zamik ≥ 20 px glede na znano homografijo), 25 parov je resničnih.
- poklicnost 100 % — nobeno resnično ujemanje ni bilo zavrnjeno;
- pozornost 92,31 % — 12 od 13 izstopkov je zavrnjenih;
- mediana epipolarne napake notranjih točk **0,0911 px**.

**Meja, zapisana namesto zamolčana:** eden od 13 izstopkov **zdrsne skozi**. Na ravni ravnini
je premik točke **vzdolž epipolarne črte** brezplačen (epipolarna napaka se ne spremeni),
zato epipolarni preizkus sam ne more zavrniti takšnega izstopka. To je razlog, da slika z
enim samim ravnim motivom (panel, steklo, ravna barva) **ne more** biti samodostatna:
potrebnih je več globin — kar ustreza dejanskemu ROKSAL motivu (profil + letve + okolica),
ne pa slikanju ene stene.

## 6. Kje so meje verige — numerična občutljivost

Obe sondi sta v repozitoriju (`tests/probe/`) in sta ponovljivi iz korena:

```bash
node --import=./tests/ts-resolve-register.mjs tests/probe/fotogrametrija-obcutljivost.mjs   # σ-poras na čistih korespondencah
node --import=./tests/ts-resolve-register.mjs tests/probe/fotogrametrija-zajem.mjs          # različni zajemski parametri
```

**a) Šum ujemanja je edina resna napaka** (panel scena, analitične korespondence + Gausov
šum σ px na **obeh** pogledih, 88 parov; IZMERJENO (razvojni sondi)):

| σ (px) | notranji pari | mediana ep. | napaka rotacije | napaka **smeri** premika |
|---|---|---|---|---|
| 0 | 88/88 | 0,00005 px | 0,0000162° | 0,0000080° |
| 0,25 | 81/88 | 0,407 px | 0,050° | 1,60° |
| 0,5 | 64/88 | 0,386 px | 1,64° | 14,97° |
| 1,0 | 38/88 | 0,422 px | 8,78° | 65,35° |

Veriga je torej **matematično točna** (σ = 0 → 10⁻⁵°) in jo v praksi omejuje samo kakovost
ujemanja. Smer premika (**baseline**) je približno desetkrat občutljivejša od rotacije
(σ = 0,5 px: 1,64° proti 14,97°) — napaka v korespondencah se v translacijo pretlači
skoraj linearno.

**b) Zajemski parametri odločajo** (isti algoritem, različen zajem; IZMERJENO (razvojni sondi)):

| Zajem | Odločitev | rot | premik | pj | parallaksa | skala |
|---|---|---|---|---|---|---|
| 200×150, f=50 px, Z=50 cm, B=8 cm | **ZAVRNJEN** (pj 1,018 px > 1 px) | 0,99° | **24,98°** | 1,018 px | 7,02° | **59,9 %** |
| 400×300, f=260 px, Z=90 cm, B=15 cm | SPREJET | 0,227° | 2,81° | 0,367 px | 8,58° | 0,197 % |
| 600×450, f=520 px, Z=120 cm, B=25 cm | SPREJET | 0,0459° | 0,76° | 0,405 px | 11,00° | 0,257 % |
| 1200×900, f=1040 px, Z=120 cm, B=25 cm | SPREJET | 0,0351° | 1,71° | 0,092 px | 10,96° | 0,180 % |

Iz tega je razvidno, zakaj mora biti faza 4 **vodeni zajem**: pri nizki ločljivosti in kratkem
baseline-u algoritem zavrne ali pa da 60-odstotno merilno napako. Edini način, da se to
prepreči vnaprej, je zahtevati dovolj dolgo goriščno razdaljo (oz. dovolj velik kot) in
dovolj dolg baseline.

**c) Več pikslov ≠ več resnice.** Pri 1200×900 je delež **pravilnih** ujemanj padel na
**30,2 %** (proti 86,8 % pri 600×450), medtem ko so vsi metrični pokazatelji boljši.
Razlog je v teksturi: pri gostoti 12 teksturnih pikslov/cm se ponavljajoč motiv v povečanem
zajemu lažje zamenja. Sporočilo za fazo 5: kakovost je treba meriti z **deležem pravilnih
ujemanj** glede na istino, ne samo z epipolarno napako — slednja lahko skrije napačna
ujemanja, ki zdrsnejo skozi ravno ravnino.

**d) Tiskane referenčne tarče — odstranjeno, ne zamolčano.** Med fazo 3 je bil narejen
poskus s krožnimi tarčami: centroidna epipolarna natančnost je bila 0,003–0,27 px, a
**ujemanje** tarč po središču mase je dalo samo ~25 % pravilnih parov, sistematičen pregled
razmikov tarč pa je naletel na časovno mejo 600 s brez zaključka. Koda je zato **izbrisana**
iz `photogrammetry-core.ts` in `photogrammetry-proof.ts` (preizkusi, ki so odvisni od nje,
prav tako). Tarče se vrnejo v fazi 4–5 samo še kot **kodirane** (npr. ArUco podoben vzorec z
razpoznavnim identifikatorjem), ker potem ujemanje ne išče več podobnosti po središču mase.

## 7. Determinizem, AI in stroški

- **Determinizem:** vsak zagon sestavi raport dvakrat in ga primerja (`determinizem: true`,
  IZMERJENO (skupina)); naključja prihajajo iz lastnega xorshift generatorja s fiksnim semenom
  20261013 (`ustvariNakljucje`, `:306`). V kodi ni `Math.random` in ni `Date`.
- **Brez AI:** nič naučenih modelov, nič sklepanja, nič plačljivih API-jev, nič novih
  odvisnosti (blok J + polje `opomba` v artefaktu, ki ga test bere).
- **Strošek na meritev:** nič — proces teče na obstoječem CPU-ju. To velja za fazo 3 kot
  **offline dokaz**. Integracija v monterjev tok (faza 6) bo morala pokazati čas in porabo na
  **dejanski telefon**, ki ga v tem delovnem okolju **ni na voljo** → NEIZMERJENO, in prav
  zato fotogrametrija v aplikaciji **še ni vklopljena**.

## 8. Kaj faza 3 NE trdi

1. Scena je **izrisana iz znane istine**; pravi fotoaparat pri tem ni sodeloval. Zato dokaz
   velja za geometrijo in protokol, ne za ostrino, šum senzorja, vinjeto ali samodejni beli
   ravnovesje.
2. Protokol **ni priklopljen na UI** (`tests/r502.py` blok J dokaže, da nobena komponenta ne
   uvaža fotogrametrije). `measure-engine.ts` izrecno pravi, da prava 3D-rekonstrukcija (SfM)
   v aplikaciji **NI izvedena**; priporočilo metodi se je zato preimenovalo iz
   `FOTOGRAMETRIJA` v `VEC_POGLEDOV` (statistično združevanje pogledov, vsak pogled nosi svojo
   referenčno mero) — da besedilo ne obljublja tistega, kar je danes le dokaz.
3. Intrinzična kalibracija se šteje kot **podana**, ne ocenjena iz istih slik; kalibracijska
   pogodba je predmet faze 2.
4. Ni benchmarkov na pravih fotografijah, ni primerjav s COLMAP, ni meritev na telefonu. To je
   vsebina faze 7.

## 9. Ponovitev

```bash
source tests/toolshim.sh
python3 tests/r502.py          # 76 preizkusov; zapiše docs/artefacts/fotogrametrija-dokaz.json
bash tests/ci-local.sh         # celoten relejni pas (skupina r502 je vključena)
```

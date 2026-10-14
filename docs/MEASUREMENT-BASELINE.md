# MEASUREMENT-BASELINE — stanje merilne verige ROKSAL (R501, issue #15)

> Izroček Faze 0 (issue #15): kaj je dokazano implementirano, kaj je približek,
> kateri testi pokrivajo kateri korak in kateri podatki manjkajo.
> Posodobljeno ob R501 (2026-10-15). Naslednja revizija: po Fazi 3 (fotogrametrija).

## Tok vsake mere (zajem → potrditev → proizvodnja)

| Faza | Datoteka | Funkcija | Dokaz (test) |
|---|---|---|---|
| Zajem (kamera/TV) | `src/components/roksal/modules/meritve-kamera.tsx` | `onImageClick`, `analyzeQuality` (Laplace), faze 1–5 | r485/r486 E2E + UI-grep v r487/r501 |
| Kalibracija — UNIFORM | isto | 2 točki znane razdalje → `{px, cm}` | r485 B, r487 B6 (400,0 cm preračun) |
| Kalibracija — PERSPEKTIVNA RAVNINA (R501) | isto + `src/lib/measure-engine.ts` | 4 vogali znanega pravokotnika + `{widthCm, heightCm}` → homografija | **r501 B: napaka 0,00 % na sintetični poševni sliki** |
| Razreševanje merila | `src/lib/measure-engine.ts` | `resolveScale` → `{valid, mode: UNIFORM\|PLANE, cmPerPx, assumedFrontal, reason}` | r501 G (čiste funkcije) |
| Geometrija | `src/lib/measure-engine.ts` | `computeGeometry` / `polygonMetrics` / `diagonalMetrics` (rectificirane koordinate pri PLANE) | r501 B/C + r457 C (1100/1400, 12 m²) |
| Validacija | `src/lib/measure-engine.ts` | `validateGeometry` — NEZADOSTNI_PODATKI, PREDPOSTAVKA_FRONTALNOST, MERITEV_NA_RAVNINI | r501 C/D |
| Analiza (kanonična) | `src/app/api/measure-engine/analyze/route.ts` | `runAnalysis` → geometrija+validacija+confidence+guide+domain+**scale** | r501 B–D, r457 celotna matrika |
| Potrditev | `src/app/api/measurement/confirm/route.ts` | **strežniški preračun je avtoriteta** (2 % tolerance) + multiView vrata (15 %) + measureStatus | r501 E, r487 B (78 preverjb) |
| Baza | `prisma/schema.prisma` `Measurement` | `params` = točke + kalibracija (vključno `plane`) + `multiView` + `measureStatus` + `engine` | r487 C, r501 E (persistiranje) |
| Kosovnica/ponudba | `src/lib/measure-engine.ts` `analyzeDomain` + BOM rute | domenski paket OGRAJA/KERAMIKA/… iz istih točk | r457 C/D/E |
| Izvoz | `src/app/api/measure-engine/export` + `buildExportRows` | CSV/JSON z Reference: Ravnina/Referenčna mera, Status mere, Vrsta merila, Predpostavka | r501 F |

## Kaj je DOKAZANO (z izmero ali testom)

1. **Perspektivna rectifikacija (R501, Faza 1 jedro):** DLT homografija iz 4
   oglišč znanega pravokotnika na merjeni ravnini. Sintetična projektivna
   kamera (očitno poševen pogled): prava dolžina 111,80 cm → izmerjeno
   111,80 cm (**0,00 % napake**, r501 B). Ista slika z UNIFORM merilom bi
   dala 137,1 cm (**22,6 % napake**) — točno nevarnost, ki jo issue opisuje.
2. **Ni več tihega privzetka 1 cm/px:** `resolveScale` je edini vir merila;
   neveljavna kalibracija → `valid=false`, vse cm vrednosti 0,
   `calibrated=false` + razlog v monterjevem jeziku (r501 C, G).
3. **Strežniški preračun je avtoriteta (confirm):** poslana `lengthCm` se
   primerja s preračunom iz točk+kalibracije (toleranca 2 %); odstopanje →
   409 z razlogom. Točke brez kalibracije → 400. Ročni popravek z razlogom
   (manualOverride) ostaja veljavna pot → `measureStatus=MANUAL_OVERRIDE`
   (r501 E, r487 B6).
4. **Multi-view konsolidacija (R487):** per-view dolžine se preračunajo
   strežniško; razpršenost > 15 % brez rešitve → 409 (r487 B2).
5. **Status mere (začetek Faze 2):** `MANUAL` (ročni vnos brez reference) /
   `CALIBRATED` (točke + veljavna referenca + usklajeno) /
   `MANUAL_OVERRIDE` (ročno rešeno z razlogom) — zapisan v `params`,
   verzijo v1, revizijo MEASUREMENT_CONFIRM in CSV izvoz (r501 E/F).
6. **Izrecna predpostavka frontalnosti:** UNIFORM merilo vedno nosi
   `scale.assumedFrontal=true`, ko kota kamere ni znana (analiza + izvoz);
   pri znanem nagibu > 15° OPOZORILO, > 30° NAPAKA (r501 D).
7. **LIDAR ni več izbirljiv** (ni dokazano delujočega senzorja) — ostaja v
   tipu zaradi starih zapisov, UI ga ne ponuja (r501 H).

## Kaj je Približek / predpostavka (izrecno označeno)

- **UNIFORM (2-točkna) kalibracija** = predpostavka pravokotnega (frontalnega)
  posnetka. Pri poševni sliki NAPAČNO po smerih (zgornja meja napake na
  testni projekciji: 22,6 %). Označena v `scale.assumedFrontal` + izvozu;
  opozorilo ob znanem nagibu > 15°.
- **Koti v pogledu (vogali)**: pri PLANE na rectificiranih koordinatah
  (pravi koti na ravnini); pri UNIFORM na slikovnih (enako kot prej).
- **Višinske razlike (`heightDiffCm`)**: interpretacija osi y glede na ravnino
  posnetka — pri STOPNICE (profilna ravnina) smiselna, pri tlorisnih oznakah
  OGRAJA pomeni "razlika v smeri y slike". Issue Faza 1: homografija se ne
  uporablja za 3D (globina/volumen) — tega engine ne izračunava.
- **EXIF/orientacija:** brskalnik sam aplicira EXIF orientacijo pri
  prikazu/canvasu; engine deluje na prikazanih koordinatah. Ločena EXIF
  validacija NI implementirana (omejitev, ne trditev).
- **Objektivna popačenja (lens distortion):** NI popravljena (ni kalibracijskih
  podatkov objektiva) in NI prikazana kot popravljena.

## Kaj manjka (odprto — issue #15 nadaljnje faze)

- **Faza 3 — fotogrametrija iz več fotografij (SfM):** NI implementirana.
  Multi-view danes pomeni KONSOLIDACIJO dolžin med pogledi (povprečje +
  razpršenost), NE 3D-rekonstrukcije. `recommendMethod` omenja
  "fotogrametrijo" kot priporočilo zmogljivosti — to je vodilo izbire
  načina, ne izjava o rekonstrukciji.
- **Faza 4 — vodeni zajem po tipu objekta** (ravna ograja/vogali/fasada/
  prostor/streha): delno (hinti v MODE_RULES + capture guide); ločenih
  vodenih postopkov še ni.
- **Faza 5 — specifična geometrija:** STREHA naklon je privzeto 35°
  (predpostavka, izrecno v UI napisu); neizmerjen naklon ne more ustvariti
  VERIFIED mere (nadaljnje delo: status na domenski ravni).
- **Faza 7 — referenčni nabor z neodvisnimi fizičnimi meritvami:** manjka
  (potrebuje odobrene terenske posnetke + laserske reference). Numerični
  dokaz r501 je SINTETIČEN (znana projekcija) — dokazuje pravilnost
  algoritma, ne napake na realnih objektih.
- **Faza 2 — polna ločitev statusov** (ESTIMATED/AUTO_SUGGESTED/VERIFIED/
  CONFIRMED in razveljavljanje ob spremembi reference): uvedena triječna
  osnova (`MANUAL`/`CALIBRATED`/`MANUAL_OVERRIDE`); preostanek odprt.

## Licence odvisnosti (R501)

- **Ni novih odvisnosti.** Homografija (DLT) in Gaussova eliminacija sta
  implementirani čisto v TypeScript znotraj `src/lib/measure-engine.ts`
  (klasična linearna algebra, enaka matematika kot OpenCV
  `findHomography` — brez kopiranja lastniške kode).
- Obstereče knjižnice v uporabi so nespremenjene (glej `package.json`).

## Kako ponoviti dokaze

```bash
# celoten merilni pas (lokalni relejni pas):
bash tests/ci-matrix.sh --all
# samo merilna jedra (issue #15):
python3 tests/r501.py   # perspektiva + eksplicitno merilo (51 preverjb)
python3 tests/r487.py   # multi-view konsolidacija (78 preverjb)
python3 tests/r457.py   # engine matrika (105 preverjb)
```

Sintetični dokaz homografije (brez strežnika):
`bun -e "…resolveScale/planeHomography…"` — vzorec v tests/r501.py sekcija G.

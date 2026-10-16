# Raziskava izboljšav po spletu — kamera, fotomontaža, meritve (16. 10. 2026)

**Naročilo lastnika:** »nadaljuj z raziskavo, razvojem po spletu, išči izboljšave
kamere, fotomontaže, meritev itd.«

**Metoda:** spletna izkanja (6+2 poizvedb, 52 zadetkov) po treh področjih;
vsaka najdba je presojana proti nespremenljivim omejitvam projekta: **brez
AI-modelov, brez generativnega AI, brez plačljivih API-jev, brez vezave na enega
komercialnega ponudnika; samo deterministične skripte in klasične metode.**
Izvedeno in preizkušeno v isti seji: R532 (engine 1.4.0, tests/r532.py).

---

## 1. Fotomontaža — kompozicija in obnova ozadja

### Kaj je bilo stanje (engine 1.3.0)
- obnova ozadja: deterministična širitev z roba (boundary propagation) z mehkim
  robom in globinsko mejo — vsak obnovljen piksel ima dokazane sosede;
- svetloba: smer + svetlost prizora iz pasov neba/tal (oceniSvetlobo),
  eksponent senčenja + kontakt/vržeča senca;
- **vrzel: barvni ton izdelka ni bil vezan na fotografijo** — katalog/studio
  ton na topli ali hladni fotografiji je izpadel kot »prilepljen«.

### Najdbe in presoja

| Najdba (vir) | Metoda | Primernost | Odločitev |
|---|---|---|---|
| **Reinhard color transfer** (klasični članek 2001; pregled bcmi/Color-Transfer-for-Image-Harmonization) | statistika kanalov (sredina/odmik) vira → cilja, afina preslikava | ✅ čista, brez AI, deterministična, izvedljiva v eni seji | **IZVEDENO v R532** — poenostavljeno na VEZANI barvni namig osvetlitve (spodaj) |
| **Poisson seamless cloning** (takuti/poisson-image-blending — Canvas/JS implementacija; erkatan članek) | reševanje Poissonove enačbe na meji — brezšivno zlivanje gradientov | 🟡 izvedljivo, a zahteva reševalnik mreže v JS; tveganje artefaktov na velikih regijah | zabeleženo kot prihodnja možnost za mehkejši rob maske |
| **PatchMatch** (Barnes 2009 — randomizirano ujemanje patchev; 4300+ citatov) | sinteza teksture iz podobnih mest ISTOJE slike | 🟡 klasično (ni AI), a sintetizira »verjetno« vsebino — napetost s pogodbo poštenosti (#14 §2: skrite strukture NE smemo trditi kot obnovljene) | zabeleženo; uporabno le z izrecno oznako sinteze |
| **Seam carving** (Shamir/Avidan) | vsebinsko rezanje raztezka | ❌ namen retargetingu, ne kompoziciji | zavrnjeno |
| OpenCV inpainting Telea/NS/FSR (primerjalna študija computerresearch.org) | FMM širitev, NS tokovnine, FSR extrapolacija | 🟡 naša širitev z roba je sorodna Teleai; NS/FSR zahtevata OpenCV strežniško | obstoječa metoda ostaja (dokazljiva, fail-closed) |

### Kaj je izvedeno (R532, engine 1.4.0)
**Vezani barvni namig prizora** (issue #14 §4: »umerjanje … svetlosti in senc,
ki temelji na fotografiji«, dosledno razširjeno na ton):

- `oceniBarvoPrizora` — sredina + odmik po kanalih iz pasov neba/tal OKOLI
  označenega območja (isti pasovi kot `oceniSvetlobo`; vzorčenje vsak 2. piksel,
  deterministično; < 8 vzorcev → `null` fail-closed);
- `harmonizacijskaMapa` — zamik po kanalu = **35 % kromatičnosti osvetlitve
  prizora** (odmik pasov od lastne svetlosti), vezan na **±22/255 po kanalu**;
  razteg kontrasta (za teksture, prihodnost) vezan na [0.85, 1.18], z varnostjo
  (odmik < 4 → kanal se ne razteguje);
- `harmonizirajHex` — osnovni ton izdelka gre skozi preslikavo PRED obstoječo
  adaptacijo svetlosti; **nevtralen prizor pusti barvo izdelka NEDOTIKNJENO**
  (identiteta — barva izdelka je njegov dokaz, ne navada prizora);
- statistika se izračuna **PRED risanjem** (kadrovanje preliva v koraku 1
  riše tudi pasova nad/pod — vzorčenje mora videti original);
- opcija `harmonizacija: false` = bajtno identičen izris PRED 1.4.0 (A/B).
- Dokazi: `tests/r532.py` **32 ✓ / 0 ✗** (čiste funkcije: smer/meje/varnosti/
  determinizem; žičenje: topla slika toploti izdelek r↑ b↓ [140,131,119]→
  [169,139,103], bajtni determinizem, izklop = pred-1.4.0; živi API: zapisan
  engineVersion 1.4.0; matrika+ci.yml sinhrono 41 = 41).

**Zakaj ne polni Reinhard (sredina+odmik vira→cilja):** polni prenos bi na
nevtralni fotografiji RAZVODIL barvo izdelka (produkt izgubi identiteto) —
spec #14 §3 izrecno prepoveduje »spremeni izdelek v generično ograjo«. Zato
preslikava nosi SAMO kromatičnost osvetlitve, nikoli primerjavo z barvo
izdelka: nevtralna scena = nič spremembe.

## 2. Meritve — perspektiva in kalibracija

| Najdba (vir) | Metoda | Primernost | Odločitev |
|---|---|---|---|
| Utežena 1D homografija z globalno oceno (Duan 2024, sciencedirect; Lv 2018, Optica) | uteži referenc po zanesljivosti, globalna ocena homografije | ✅ blizu naši referenčni verigi (R487: konflikt > 5 % → vrata) | zabeleženo: uteži po kakovosti reference (LASER 0,5 / MIČNIK 1 / ZNANA 2) kot izboljšava konsolidacije |
| Perspektivna korektura planarnih mer po homografiji (Wang 2025, PMC) | preslikava merilne ravnine | ✅ že implementirano (R501/R513 homografija) | potrjeno stanje |
| EXIF: goriščna razdalja + SubjectDistance → ocena mere (scantips; phototour.cs.washington.edu) | Effective Focal Length v EXIF → kot/perspektiva; SubjectDistance → merilo | 🟲 koristen NAMIG za predvidbo, a pametni telefoni SubjectDistance večinoma NE zapisujejo; nikoli nadomesti človekove reference | kandidat za naslednji korak (označena predvidba, ne potrjena mera) |
| Hover (help.hover.to): 8 fotografij okrog objekta → 3D model | množični vgled | ❌ meja: Hover uporablja AI/model — pri nas izrecno prepovedano | zavrnjeno za kopiranje; naša pot: več pogledov do 4 + konsolidacija + konfliktna vrata (R487) |

## 3. Kamera — zajem na terenu

| Najdba (vir) | Metoda | Primernost | Odločitev |
|---|---|---|---|
| Nadzor ostrenja prek getUserMedia (focusMode/focusDistance, applyConstraints advanced — dynamsoft 7/2026) | kontinuirno/ročno ostrenje | ✅ tehnično čisto | kandidat: `camera-capabilities.ts` že ima vzorec (torch prek applyConstraints) — dodati focusMode |
| ImageCapture API (takePhoto + PhotoSettings — MDN 8/2026) | posamezni posnetki višje ločljivosti kot video okvir | 🟡 podpora na Androidu dobra, iOS delno | zabeleženo |
| Ločljivost prek constraints (webrtchacks) | ideal/exact width/height | ✅ že uporabljeno (zmogljivostiKamere) | potrjeno stanje |
| Torch za temne notranjosti | applyConstraints torch | ✅ že implementirano (VKLOPLJEN/IZKLOPLJEN/NI_PODPRTO) | potrjeno stanje |

**Iskrena ovira za kamero:** peskovnik NIMA fizične kamere — vsaka vgradnja
nadzora ostrenja je NEPREVERLJIVA do terenskega testa (enaka ovira kot faza 7
#15). Zato kamera v tej seji ni bila spreminjana; fokus je kandidat zabelečen
tukaj z natančnim načrtom (vzorec torch).

## 4. Zmogljivost — WebGL/WebGPU

WebGPU filtri (joanleon.dev 4/2026; webgpu-image-benchmark) so za velike slike
10×+ hitrejši od Canvas 2D — a naša ozka grla niso filtri (izris je enkraten,
< 1 s). Migracija celotnega izrisa na WebGL bi bila prepis jedra za
nepotrjeno korist. **Zavrnjeno (zapisano utemeljeno).**

---

## 5. Kaj je naslednji najboljš korak (po presoji)

1. **EXIF goriščna/SubjectDistance** kot PREDVIDBA mere (meritve) — majhen,
   preverljiv korak; oznaka »predvidba«, človek potrdi (pogodba #15).
2. **Poisson mehčanje roba maske** (fotomontaža) — vezano na obstoječo mehko
   mejo obnove; potrebna evalvacija na manifestu štirih fotografij.
3. **focusMode nadzor** (kamera) — po vzorcu torch; PREVERLJIVO šele na
   pravi napravi (terenski test).
4. **utežena konsolidacija** po kakovosti reference (meritve) — Duan 2024
   na naši verigi.

Viri (izbrani): docs.opencv.org inpainting; computerresearch.org primerjalna
študija; github.com/takuti/poisson-image-blending; erkaman.github.io;
PatchMatch (Barnes 2009); bcmi/Color-Transfer-for-Image-Harmonization;
Duan 2024 (1D homografija); Wang 2025 (PMC); scantips.com/lights/subjectdistance;
phototour.cs.washington.edu/focal; MDN Taking still photos; dynamsoft.com
focus control; help.hover.to exterior scans; joanleon.dev WebGPU.

*Vsa izvedena dela ostajajo znotraj pogodbe: brez AI, brez plačljivih API-jev,
deterministično, dokazljivo z testi.*

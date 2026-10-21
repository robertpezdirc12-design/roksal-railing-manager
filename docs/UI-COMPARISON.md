# UI Primerjava — Roksal vs Profesionalne Aplikacije

## Primerjane aplikacije
- Hover (hover.to) — fotogrametrija, meritve, 3D modeli
- Polycam (poly.cam) — LiDAR + foto, 3D skeniranje, meritve
- magicplan (magicplan.app) — tlorisi, meritve, AR
- SiteScape (sitescape.ai) — LiDAR skeniranje, meritve
- Roksal (trenutna implementacija)

## 1. Navigacija / Informacijska arhitektura

| Element | Hover/Polycam | magicplan | Roksal | Ocene |
|---|---|---|---|---|
| Glavni meni | 3-4 zavihki | 4 zavihki | 11 sekcij (DANES, PRODAJA, PROJEKTI, OPERATIVA, SKLADISCE, KATALOG, FINANCE, SERVIS, POROCILA, VARNOST, PROFIL) | PREVEC sekcij |
| Mobilna navigacija | Spodnja vrstica 4-5 ikon | Spodnja vrstica 5 ikon | Spodnja vrstica 4 + Vec Sheet | OK, a Vec je preobremenjen |
| Iskanje | Globalno (Ctrl+K) | Globalno | Globalno (Ctrl+K) | Dobro |
| Breadcrumbs | Da | Da | Delno (deep-link) | Manjkajo vizualni |
| Kontekstna navigacija | Tab-i znotraj projekta | Tab-i znotraj projekta | Tab-i znotraj sekcije | Prevec ravni |

Zaostanek: Roksal ima 11 sekcij v glavnem meniju. Profesionalne aplikacije imajo 4-5. To je preobremenjujoce za uporabnika, se posebej na mobilnem.

Priporocilo: Zdruzi sekcije v 5 glavnih: Domov, Projekti, Teren, Skladisce, Vec. Ostalo (finance, servis, porocila) v Vec ali pod Projekti.

## 2. Merilni tok (Camera Measurement)

| Element | Hover | Polycam | magicplan | Roksal | Ocene |
|---|---|---|---|---|---|
| Stevilo korakov | 3 (Zajem, Meritve, Rezultat) | 2 (Skeniranje, Rezultat) | 3 (Zajem, Meritve, Tloris) | 5 (ZAJEM, KALIBRACIJA, MERITEV, PREVERJANJE, POTRDITEV) | PREVEC korakov |
| Vodila v kameri | Mreza + sredisce + vodoravnica | LiDAR overlay (real-time) | AR vodila | Mreza + vodoravnica + sredisce | Dobro |
| Kalibracija | Avtomatska (AI) | Avtomatska (LiDAR) | Avtomatska (AR) | Rocna (6 metod) | Prevec rocna |
| VLM/AI zaznava | Avtomatska (AI) | Avtomatska (AI) | Avtomatska (AI) | VLM predlogi (vizualno loceni) | Dobro, a pocasno |
| Undo/Redo | Da | Da | Da | Da | Dobro |
| Povecevalno steklo | Da | Da | Ne | Da | Dobro |
| Kakovost zajema | Avtomatska analiza | Avtomatska analiza | Avtomatska analiza | Smart Capture Guide (ostrost/svetloba/nagib) | Dobro |
| Vec pogledov | Da (8+ fotografij) | Da | Da | Do 4 fotografije | Manj kot Hover |
| Izvoz | PDF, DXF, OBJ, GLTF, CSV, SVG, PNG | DXF, OBJ, GLTF, CSV, PDF | PDF, DXF, CSV | CSV, JSON | Manj formatov |

Zaostanek: Roksal ima 5-fazni tok, ki je prevec kompleksen. Profesionalne aplikacije imajo 2-3 korake. Kalibracija je rocna (6 metod), medtem ko konkurenti uporabljajo avtomatsko kalibracijo (AI/LiDAR/AR). Izvoz je omejen na CSV/JSON, medtem ko konkurenti podpirajo DXF, OBJ, GLTF, PDF, SVG.

Priporocilo:
1. Poenostavi tok na 3 korake: ZAJEM, MERITEV, REZULTAT
2. Dodaj avtomatsko kalibracijo (AI/LiDAR kjer je na voljo)
3. Dodaj DXF/PDF/SVG izvoz (DXF ze obstaja v src/lib/dxf.ts)
4. Dodaj vec fotografij (do 8+, kot Hover)

## 3. Fotomontaza (Photo Replacement)

| Element | Hover | Polycam | magicplan | Roksal | Ocene |
|---|---|---|---|---|---|
| Postopek | 3 koraki (Foto, Oznaci, Rezultat) | 2 koraki (Foto, Rezultat) | 3 koraki | 3 koraki (Oznacevanje, Izbor, Primerjava) | OK |
| Oznacevanje quada | 4 tocke (drag) | 4 tocke (drag) | 4 tocke (drag) | 4 tocke (drag + povecevalno steklo) | Dobro |
| Izbor ograje | Katalog (slike) | N/A | N/A | Katalog (slike + barve) | Dobro |
| Rezultat | Fotorealističen (AI) | Fotorealističen (AI) | Fotorealističen (AI) | Perspektivna projekcija (deterministicna) | Drugacen pristop |
| Sence | AI-generirane | AI-generirane | AI-generirane | Multi-layer (3 sloji + kontaktna) | Dobro |
| Barvno usklajevanje | AI | AI | AI | Vzorcenje barv iz fotografije | Dobro |
| Robno prelivanje | Avtomatsko | Avtomatsko | Avtomatsko | Feathering (8px) | Dobro |
| Primerjava (before/after) | Slider | Slider | Slider | Slider | Dobro |
| Izvoz rezultata | PNG, PDF, JPEG | PNG, JPEG | PDF, PNG | PNG (canvas) | Manjka PDF |
| Deljenje s stranko | Link, QR koda | Link | Link, PDF | Link, QR? | Preveri |

Zaostanek: Roksal uporablja deterministično perspektivno projekcijo namesto AI-generirane fotomontaže. To je dejansko boljše za realna ne animirana zahtevo, a manj wow za stranko. Profesionalne aplikacije imajo bolj poliran rezultat (AI sence, osvetlitev, refleksije).

Priporocilo:
1. Dodaj PDF izvoz fotomontaže (z logotipom Roksal, podatki projekta)
2. Dodaj QR kodo za deljenje s stranko
3. Dodaj watermark z Roksal logotipom (ze obstaja VIZUALIZACIJA ZA PREDSTAVITEV)
4. Izboljsaj osvetlitev (ambient occlusion, refleksije)

## 4. Vizualni dizajn (Visual Design)

| Element | Hover/Polycam | magicplan | Roksal | Ocene |
|---|---|---|---|---|
| Barvna paleta | Cista, minimalisticna (bela/siva + accent) | Cista, minimalisticna | Navy/amber tema (roksal-navy, roksal-amber) | Specificna, a mogoce prevec corporate |
| Tipografija | Sans-serif, cista hierarhija | Sans-serif, cista hierarhija | Tailwind default | OK, a ni distinctivna |
| Ikone | Custom ikone (consistent) | Custom ikone | Lucide icons (genericne) | Genericne |
| Animacije | Subtle (fade, slide) | Subtle (fade, slide) | Minimalne | Manjkajo micro-animacije |
| Prazna stanja | Ilustracije + CTA | Ilustracije + CTA | Tekst + ikona | Manjkajo ilustracije |
| Nalaganje | Skeleton + progress | Skeleton + progress | Skeleton | OK |
| Napake | Prijazne (retry, help) | Prijazne (retry, help) | ErrorBox (rdeca skatla) | Premalo prijazno |
| Onboarding | Interaktivni tour | Interaktivni tour | Setup obrazec | Manjka guided tour |
| Dark mode | Da | Da | Da | Dobro |

Zaostanek: Roksal uporablja genericne Lucide ikone in shadcn/ui komponente, ki izgledajo standardno. Profesionalne aplikacije imajo custom ikone, ilustracije za prazna stanja, micro-animacije in interaktivni onboarding.

Priporocilo:
1. Custom ikone za glavne akcije (kamera, meritev, fotomontaza)
2. Ilustracije za prazna stanja (SVG)
3. Micro-animacije (Framer Motion) za prehode
4. Interaktivni onboarding (Shepherd.js ali podobno)
5. Brandirana barvna paleta (ne samo navy/amber)

## 5. Mobilna izkusnja (Mobile UX)

| Element | Hover | Polycam | magicplan | Roksal | Ocene |
|---|---|---|---|---|---|
| Touch targets | 44px+ (Apple HIG) | 44px+ | 44px+ | Button size sm (32px) | Premajhni |
| Gestures | Pinch zoom, swipe | Pinch zoom, swipe | Pinch zoom, swipe | Osnovni | Manjkajo gesture |
| Offline | Da (PWA) | Da (PWA) | Da (PWA) | Da (PWA + IndexedDB) | Dobro |
| Kamera | Native camera API | Native camera + LiDAR | Native camera + AR | Web camera (getUserMedia) | Omejeno na web |
| Haptics | Da | Da | Da | Ne | Manjka |
| Orientation | Portrait + Landscape | Portrait + Landscape | Portrait + Landscape | Portrait (responsive) | Landscape manjka |

Zaostanek: Roksal je web-aplikacija (PWA), ne native. To pomeni omejen dostop do kamere, LiDAR, haptics in native gesture-ov. Profesionalne aplikacije so native (iOS/Android) ali imajo native wrapper (Capacitor/React Native).

Priporocilo:
1. Povecaj touch targets na 44px+ (Apple HIG)
2. Dodaj haptics (navigator.vibrate)
3. Razmisli o Capacitor wrapper-ju za native dostop (kamera, LiDAR, haptics)
4. Dodaj landscape support

## 6. Deljenje in izvoz (Sharing and Export)

| Element | Hover | Polycam | magicplan | Roksal | Ocene |
|---|---|---|---|---|---|
| PDF izvoz | Da (branded) | Da | Da (branded) | Ne | Manjka |
| DXF izvoz | Da | Da | Da | Da (src/lib/dxf.ts) | Dobro |
| OBJ/GLTF izvoz | Da | Da | Ne | Ne | Manjka (za 3D) |
| CSV/JSON izvoz | Da | Da | Da | Da | Dobro |
| QR koda | Da | Da | Da | Ne | Manjka |
| Deljenje linka | Da | Da | Da | Da (pregled-share?) | Preveri |
| Email posiljanje | Da | Da | Da | Ne | Manjka |
| Branded izvoz | Da (logo + podatki) | Da | Da | Ne | Manjka |

Zaostanek: Roksal nima PDF izvoza, QR kode za deljenje in branded izvoza. Profesionalne aplikacije imajo vse to.

Priporocilo:
1. Dodaj PDF izvoz (jsPDF ali react-pdf) z Roksal logotipom
2. Dodaj QR kodo (qrcode library) za deljenje fotomontaže s stranko
3. Dodaj email posiljanje

## 7. Povzetek — kje zaostajamo

### Kriticne vrzeli (naredi najprej)
1. Prevec sekcij v navigaciji (11 na 5)
2. Prevec korakov v meritvah (5 na 3)
3. Ni PDF izvoza (branded)
4. Ni QR kode za deljenje
5. Ni interaktivnega onboardinga

### Srednje pomembne vrzeli
6. Genericne ikone (Lucide na custom)
7. Ni ilustracij za prazna stanja
8. Ni micro-animacij
9. Premajhni touch targets (32px na 44px)
10. Ni haptics

### Manj pomembne vrzeli
11. Ni landscape support
12. Ni native wrapper (Capacitor)
13. Ni email posiljanja
14. Ni OBJ/GLTF izvoza

### Kaj je ze dobro (ne spreminjaj)
- PWA + offline (IndexedDB)
- Dark mode
- Globalno iskanje (Ctrl+K)
- Smart Capture Guide
- Undo/Redo
- Povecevalno steklo
- Web Bluetooth laser meter
- WebXR AR (Android)
- DXF izvoz
- CSV/JSON izvoz
- Deterministična fotomontaža (bolj realistična od AI)
UIEOF
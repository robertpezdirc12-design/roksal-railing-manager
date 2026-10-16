# Protokol fizične validacije merjenja (issue #18) — terenski dokument

**Status: NI IZVEDENO.** Fizična validacija zahteva prave objekte, referenčna
merilna orodja in fizično napravo s kamero — v razvojnem peskovniku teh NI.
Ta dokument je PRIPRAVLJEN PROTOKOL (ne poročilo o izvedbi): ko lastnik izvede
preizkus po njem, se rezultati zapišejo v `docs/MEASUREMENT-VALIDATION-RESULTS.md`
in ta datoteka posodobi status. **Do takrat velja: sistem NI fizično validiran
— vse mere so ocene z dokazano provenienco, ne potrjene proizvodne mere.**

## 1. Obseg preizkusa (najmanj 5 objektov)

| # | Kategorija objekta (predlog) | Zakaj |
|---|---|---|
| 1 | Ravna terasna ograja (prečna, 2–6 m) | osnovni primer najpogostejše uporabe |
| 2 | Pokončna ograja / pregradna stena z vogalom | vogal = največja napaka perspektive |
| 3 | Stopniščna ograja (naklon) | nagib + višinske razlike |
| 4 | Fasada (pokončne letvice) | velika površina, merilo na višini |
| 5 | Poševni teren / vrtna ureditev | nepravilna geometrija, ovire |

Za vsak objekt zapiši: dejansko kategorijo, pogoje (svetloba, vreme, zakritja),
napravo (model, kamera, razdaljo, orientacijo) in ali je bil zajem ponovljen.

## 2. Referenčno merjenje (izvaja človek z orodjem)

- Orodje: laser (npr. ±1,5 mm) ali merilni trak (±1 mm na 2 m) — zapiši tip,
  ločljivost in status kalibracije; brez znanega orodja preizkus NI veljaven.
- Izmeri VSE ključne dolžine in višine, ki jih zajame aplikacija; zapiši
  referenčno vrednost v cm.
- Ponovljivost: vsak zajem izvedi 2× (ponoven zajem + ponoven izračun);
  zapiši oba rezultata aplikacije.

## 3. Tabela rezultatov (predloga — izpolni ob izvedbi)

| Objekt | Mera | Referenca (cm) | Aplikacija 1 (cm) | Aplikacija 2 (cm) | Abs. napaka | Rel. napaka % | Stanje meritve | Opombe (ovire/svetloba) |
|---|---|---|---|---|---|---|---|---|
| … | … | … | … | … | … | … | … | … |

**Vključi tudi neuspele meritve** (sistem ni mogel določiti merila/geometrije) —
neuspeh je rezultat, ne sramota. Poročaj ločeno: sistemska odstopanja,
ponovljivost, nepopolni zajemi.

## 4. Tolerance po namenu uporabe (raziskovalne, NE potrjene)

| Namena | Predlagana toleranca | Vir utemeljitve | Status |
|---|---|---|---|
| Predračun/okvirna ponudba | ±5 % | poslovna praksa (prostorski reserve) | RAZISKOVALNO — potrdi lastnik/produkcija |
| Končna ponudba | ±2 % | montažni robustni profil (razmiki/pretoki) | RAZISKOVALNO — potrdi lastnik/produkcija |
| Razrez (proizvodnja) | ±0,5 % ali ≤ 5 mm | rezanje profila brez odpada | RAZISKOVALNO — potrdi lastnik/produkcija |

**Pošteno:** toleranca za razrez MORA potrditi odgovorna oseba (proizvodnja),
saj je odvisna od tehnologije rezanja. Ena univerzalna toleranca za vse objekte
NE obstaja in se ne sme izmisliti.

## 5. Varovalke — kaj ŽE velja (presojeno 16. 10. 2026, issue #18 §3)

Pregled vseh poti meritev → poslovni izidi (dokazi v testih):

| Pot | Varovalka | Dokaz (test) |
|---|---|---|
| Meritev → kosovnica (BOM) | `measurementStatusAllowsBusiness` — vrata 409 »ni poslovno uporabna« za ESTIMATED/AUTO_SUGGESTED/INVALIDATED | r501 (I blok), r510 (A blok) |
| Segment tekača → geometrija kosovnice | ISTA vrata po segmentu (najšibkejši člen odloča) | r511, `measure-geometry-source.ts` |
| Meritev → fotomontaža | `smeVizualizacijo` — ločeno od poslovnega bloka (razveljavljena = 409) | r510 (F blok) |
| Status meritev | izračuna STREŽNIK; odjemalec sme le stopnjevati v CONFIRMED (pisarna, `measurements.write`) ali razveljaviti z razlogom ≥ 3 znaki | r501 (C/D bloka) |
| Fail-closed | neznan/prazen/prihodnji status NI poslovna mera (noben nov stolpec ne odpre vrat) | r501 (C blok) |
| PDF izvoz mere | vrstica »Poslovna mera dovoljena: DA/NE« + obrazložitev | r501 (H blok) |
| Sprememba parametrov po potrditvi | geometrijska podlaga spremenjena → ponovna izpeljava statusa (potrditev ne preživi tiho) | r501 (merilno jedro) |

**Znane meje varovalk (pošteno):**
- Ponudbe (Quote) se gradijo ROČNO (pozicije vnese pisarna) — ne morejo tiho
  povleči mere; prenos mere → ponudba NE obstaja kot avtomatika (pravilno:
  odločitev pisarne).
- Sinhronizacija brez povezave prenese zajete podatke z dokazano provenienco
  (EXIF, kalibracija); status izračuna strežnik ob prenosu — odjemalec ga ne
  ponaredi (testirano v skupinah capture/sync).

## 6. Navodilo monterju (kratko)

1. Zajemi objekt po vodenem poteku (aplikacija pove poglede/referenca).
2. Če aplikacija piše »stanje: ocena/ESTIMATED ali MANUAL« — mero POKAŽI
   pisarni; ne uporabljaj je za kosovnico.
3. Ponovi zajem, če: slaba svetloba, zakritje, spremenjeni pogoji ali
   opozorilo kakovosti na zaslonu.
4. Zahtevaj ročno potrditev (pisarna) pred proizvodnjo — vrata so namerno
   zaprta.

## 7. Kaj je blokirano in pri kom (issue #18 §1)

- Fizični preizkus (5 objektov): **lastnik** (objekti, orodja, naprava).
- Potrditev tolerance za razrez: **lastnik/proizvodnja**.
- Do izvedbe: `docs/MEASUREMENT-BASELINE.md` in UI ostajajo pri poštenem
  »ocena s provenienco« — nobena meritev ni označena kot fizično validirana.

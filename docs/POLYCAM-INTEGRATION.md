# Polycam API — brezplačna alternativa cloud procesiranju

## Kaj je Polycam
Polycam je fotogrametrična aplikacija (iOS/Android), ki iz fotografij/LiDAR-ja ustvari 3D modele.
API omogoča programatičen dostop do 3D modelov in meritev.

## Brezplačni nivo
- Polycam ponuja brezplačni nivo z omejenim številom modelov/mesec
- Brez bančne kartice za osnovno uporabo
- API ključ: https://poly.cam/api

## Integracija v Roksal
Namesto gradnje lastnega fotogrametričnega engine-a (Hover-style):

1. **Upload fotografij** → Polycam API
2. **Prejmi 3D model** → OBJ/GLTF
3. **Merjenje** → Polycam merilni API (±½ inch)
4. **Fotomontaža** → Roksal že ima (realne fotografije + perspektivna projekcija)

## Prednosti
- Brezplačno (brezplačni nivo)
- Profesionalna točnost (±½ inch)
- LiDAR podpora (iPhone/iPad Pro)
- DXF/OBJ/GLTF/PNG/SVG/CSV export

## Pomanjkljivosti
- Odvisnost od zunanjega API-ja
- Omejitve brezplačnega nivoja
- Potrebuje internet

## Trenutno stanje Roksal
- Fotomontaža: ✅ že deluje (realne fotografije, perspektivna projekcija, sence, barvno usklajevanje)
- Merjenje: ✅ 7 načinov, 6 kalibracijskih metod, Web Bluetooth laser, WebXR AR
- Cloud procesiranje: ❌ opcijsko — Polycam API ali lasten backend (GPU, ~$10-50/mesec)

# Merilna točnost — Roksal Railing Manager

## Metode kalibracije in njihova točnost

| Metoda | Točnost | Pogoji |
|---|---|---|
| LIDAR (iOS Pro) | ±½ inch (1.3 cm) | iPhone 12 Pro+, iPad Pro 2020+ |
| ZUNANJA_NAPRAVA (laser meter) | ±1 mm | Leica DISTO, Bosch GLM, Hilti |
| MARKER (fizični marker) | ±2-5 cm | Vidna referenčna točka |
| ZNANA_MERA (znana mera objekta) | ±3-8 cm | Znana dimenzija na sliki |
| RAVNINA (ravninska kalibracija) | ±5-15 cm | Ravna površina, znana razdalja |
| ROCNO (ročna referenca) | ±10-30 cm | Brez referenčne mere |
| Brez kalibracije | Nezanesljivo | Ni priporočeno |

## Primerjava z vodilnimi aplikacijami

| Aplikacija | Točnost | Metoda | Objavljeno? |
|---|---|---|---|
| Polycam | ±½ inch | LiDAR vs laser distometer | Da (objavljeno) |
| magicplan | <1% (~1.4 in na 12 ft) | LiDAR Auto-Scan | Delno (brez metode) |
| Hover | ± nekaj cm | Fotogrametrija (8+ fotografij) | Ne |
| Roksal | ±1 mm (z laser metrom) | Ročna kalibracija + laser | Ta dokument |

## Priporočila za uporabnike
1. **Najboljša točnost:** Uporabi laser meter (Leica/Bosch) z Web Bluetooth.
2. **Brez laser metra:** Uporabi fizični marker ali znano mero.
3. **Nikoli brez kalibracije:** Ročna referenca brez kalibracije daje ±10-30 cm napako.
4. **Preveri:** Vedno preveri meritve z ročnim merjenjem pred naročilom materiala.

# BLOB-INVENTORY — seznam vseh trajnih podatkov

> Faza: R441 · Issue: GitLab #3, točka 4
> Namen: vsak trajen podatek ima znano lokacijo, kopijo in postopek obnove.

## 1. Tabela trajnih podatkov (peskovnica)

| Podatek | Lokacija | Velikost (pribl.) | Varnostna kopija | Obnova |
|---|---|---|---|---|
| Poslovna baza (39 tabel: projekti, nalogi, meritve, ponudbe, računi, zaloga, CRM, seje, obvestila, …) | `db/custom.db` (SQLite, gitignored) | ~1,2 MB | `.rkb` kopija (SQLite online backup + JSON export vseh tabel) | `ops/restore.sh --target-dir` |
| **Fotografije meritev** | `Measurement.params` — dataURL znotraj baze | večina prostora baze | pokrite s kopijo baze | enaka kot baza |
| Izvorna koda, Prisma migrations, CI konfiguracija | GitLab `main` (git) | ~1,0 MB bundle | `git bundle --all` v `.rkb` + GitLab | `git clone` (GitLab ali bundle) |
| PWA ikone + manifest + service worker + offline.html | `public/` (v gitu) | ~100 KB | pokrite z git bundle | `git clone` |
| Zgodovina verzij meritev | baza (`MeasurementVersion`) | v bazi | pokrite s kopijo baze | enaka kot baza |
| PDF dokumenti (ponudbe/računi) | generirani ON-DEMAND iz podatkov baze (`lib/pdf-mini.ts`) | 0 (ne shranjujejo se) | ni potrebna — regeneracija | regeneracija po obnovi baze |
| Off-site kopije | GitLab generic package registry `roksal-backup` | ~1,7 MB / kopija, zadnjih 10 | (to JE kopija) | `ops/restore.sh --remote` |
| Lokalne kopije | `db/backups/*.rkb` (gitignored) | ~1,7 MB / kopija, zadnjih 5 | — | `ops/restore.sh --file` |

## 2. Versioning kritičnih dokumentov

- **Izvorna koda:** git zgodovina (vsa bindanja v bundle) — vsak commit je
  točka obnove; tagi `v*` označujejo produkcijske verzije.
- **Meritve:** `MeasurementVersion` (v1, v2, …) z avtorjem in časom — zgodovina
  sprememb ostane tudi po obnovi (je del baze).
- **Fotografije:** vezane na meritev (`photoId` vezava v sync/op), vsaka v svoji
  vrstici `Measurement` s `params.photo` — obnova baze vrne tudi vse fotografije.

## 3. Postopek ponovne vezave na produkcijo (izvirnik: Vercel Blob)

V peskovnici so fotografije v bazi (enostavnejša atomicnost obnove). V
produkciji izvirnika so v Vercel Blob:

1. Izvoziti pomembne datoteke (redni export): `vercel blob list` + prenos v
   šifrirani arhiv (enak postopek kot `ops/backup.sh` — dodati datoteke v
   `tar` pred šifriranjem).
2. Obnova: prenos arhiva → dešifriranje → `vercel blob put` nazaj z ISTIMI
   URL-ji (ali posodobiti `params.photo` reference v bazi po novih URL-jih).
3. Preverba: vzorčne meritve s fotografijami se odprejo v UI (jezik: JPEG
   dekodiranje + velikost > 0).

## 4. Redni export (priporočilo za produkcijo)

| Kaj | Pogostost |
|---|---|
| Export Blob fotografij (novo/nadomeščeno od zadnjega exporta) | tedensko |
| Celoten export baze (strojno berljivo) | dnevno (že v `.rkb`) |
| Preverba obnovljivosti (vzorec datotek) | ob vsakem drill-u |

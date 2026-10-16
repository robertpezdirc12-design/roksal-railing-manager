# SECRETS — inventar poverilnic (BREZ vrednosti)

> Faza: R441 · Issue: GitLab #3, točka 5
> Pravilo: **noben žeton/geslo/PAT/deploy hook v git repozitoriju.**
> Tu je SAMO inventar (ime, lokacija, obseg, postopek rotacije) — nikoli vrednosti.

## 1. Inventar

| # | Poverilnica | Kje živi (edino dovoljeno) | Obseg | Zadnja rotacija |
|---|---|---|---|---|
| 1 | `ROKSAL_BACKUP_PASSPHRASE` | upravitelj gesel lastnika (izven peskovnice) + `.env.recovery` (gitignored) | dešifriranje varnostnih kopij | 7. 10. 2026 (ustvarjena, R441) |
| 2 | `GITLAB_TOKEN` (PAT) | `.env.recovery` (gitignored) + `.git/config` remote URL (lokalno, ni v repu) | `api` + `write_repository` (GitLab) | 7. 10. 2026 (ustvarjen pred R441) |
| 3 | `DATABASE_URL` | okolje procesa (peskovnica/CI; `.env` lokalno, gitignored) | PostgreSQL — peskovnik: lokalni vsebnik :54329 (roksal/roksal); produkcija: Neon (Vercel env) | ob incidentu 10/2026 (Neon rotirano) |
| 4 | Gesla uporabnikov (admin/monter/…) | baza — `User.passwordHash` (scrypt + sol) | prijava v aplikacijo | glej aplikacijo (Profil → geslo) |
| 5 | Žetoni sej | baza — `Session.token` hrani SAMO SHA-256 zgoščeno obliko (R534); API preverja `Authorization: Bearer` | prijavljene seje (**7 dni** od prijave — R534 uskladitev s kodo) | samodejno (potek/odjava/preklic ob spremembi gesla) |
| 6 | Žetoni portala strank | baza — `PortalLink.token` (javne povezave, časovno omejene) | javni dostop do projekta | samodejno (potek 7–30 dni / preklic) |
| 7 | Vercel/Neon/Blob (produkcija) | Vercel dashboard (env var) + upravitelj gesel | deploy + baza + datoteke | ob incidentu 10/2026 rotirano (deploy hook) |
| 8 | Žetoni deljenih meritev (`jm-`) | baza — `Measurement.shareToken` (javna povezava) | javni dostop do meritve | R535: nove povezave potečejo po **30 dneh** (`shareExpiresAt`); stare (brez roka) veljajo do preklica |
| 9 | Zaklep računa (R536) | baza — `User.failedLoginCount` / `User.lockedUntil` | zavora brute-force: **5 zaporednih neuspešnih prijav → 15 min zaklepa** (423); uspešna prijava števec resetira | R536 (uvedeno) |
| 10 | Gesla — scrypt v2 (R536) | baza — `User.passwordHash` format `scrypt:131072:8:1:{sol}:{hash}` (N=2^17 po OWASP, sol brez pik) | prijava v aplikacijo | R536: stari format `sol:hash` (N=16384) ostane berljiv — **transparentna nadgradnja ob prvi uspešni prijavi** (brez prisilnega resetiranja gesel) |
| 11 | Stanje tempomata (R536) | baza — `RateLimitEntry` (bucket + fiksno okno 60 s + števec; žetoni samo kot sha256 odseki, IP naslovi v celoti) | deljeno omejevanje hitrosti vseh instanc (prej pomnilnik enega procesa) | R536 (uvedeno); stare vrstice (> 5 min) briše janitor `seje-gc` |
| 12 | CSP Report-Only (R536) | glava `Content-Security-Policy-Report-Only` (next.config.ts) + poročila na `/api/csp-report` | opazovanje kršitev politike BREZ blokiranja (prvi korak k izvršilni CSP) | R536 (uvedeno) |

`.env.recovery` je namensko prezrt v `.gitignore` (vzorec `.env*`); preverja
ga `ops/secret-audit.sh` (korak 1 — higiena) ob vsakem CI zagonu.

## 2. Rotacija (ob incidentu — vrstni red)

1. **`ROKSAL_BACKUP_PASSPHRASE`** — takoj, če sum na izpostavitev:
   ustvari novo geslo → `bash ops/backup.sh` (nova kopija šifrirana z novim
   geslom) → preveri `--verify` → staro geslo uniči. Kopije, šifrirane s
   starim geslom, postanejo neberljive (to je želeno).
2. **`GITLAB_TOKEN`** — GitLab → Preferences → Access Tokens: prekliči
   starega, ustvari novega (obseg `api`, rok 90 dni) → posodobi
   `.env.recovery` + `git remote set-url origin https://oauth2:<nov>@gitlab.com/…`
   (ostane le v `.git/config`, lokalno) → preveri `git fetch` +
   `ops/restore.sh --list-remote`.
3. **Vercel deploy hook / env** (produkcija): Vercel → Settings → rotirati
   vse integracijske žetone, ki se nanašajo na GitLab.
4. **Neon/Blob poverilnice** (produkcija): novo povezovalno geslo baze +
   Blob read/write token → posodobiti Vercel env → redeploy → `/api/health`.
5. **Gesla uporabnikov**: sum na specifični račun → prisilna sprememba v
   aplikaciji + preklic sej (`Varnost → Seje`). Sum na širši obseg → vsi
   uporabniki (aplikacija) + preklic vseh sej.

## 3. Najmanjše pravice

- GitLab PAT: samo `api` + `write_repository` (brez `sudo`, brez `admin_mode`).
- Monter/skladišče/proizvodnja: RBAC pravice v `src/lib/permissions-core.ts`
  (fail-closed; brez `security.read` ni dostopa do dnevnikov).
- Javni žetoni (portal/share): vezani na projekt, časovno omejeni, preklicani
  s `DELETE` in izbrisani s portal-gc po 30 dneh.

## 4. Znane demo poverilnice (izrecna izjema)

`prisma/seed*.cjs` vsebuje DEMO gesla (admin@roksal.si itd.) za peskovniške
podatke — namenso vidna za razvoj in dokumentirana. To NISO produkcijska
gesla; produkcijski seed mora gesla prebrati iz okolja (opomba v skripti).
Skrivnostni pregled jih NAMERNO ne išče po vzorcu gesel (preveč lažnih
zadetkov); išče samo žetone in zasebne ključe.

## 5. Periodični pregled

- `ops/secret-audit.sh` teče v vsakem CI (vsak merge).
- Ročni pregled dostopov: četrtletno (GitLab člani projekta, Vercel ekipa,
  aktiven PAT seznam na `GET /api/v4/personal_access_tokens`).
- Datum zadnjega ročnega pregleda: 7. 10. 2026 (R441).

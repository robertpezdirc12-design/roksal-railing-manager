# Roksal Railing Manager — Recovery repozitorij

> **Replicirano:** 6. 10. 2026 iz Vercel deploymenta `dpl_EeeiLgQAbetKS3CzeRNYiPK7BTNb`
> (zadnji znani produkciji build, GitHub commit `8189ec16` — "R430-zakljucek — INCIDENT RECOVERY + DEPLOY")

## Kaj se je zgodilo

1. Aplikacija **Roksal Railing Manager** (Next.js, App Router, Turbopack) je bila razvita v Z.ai kontejnerju in sinhronizirana na GitHub repozitorij `markec12345678/Roksal-Railing-Manager` (GitHub repo ID `1261499323`).
2. Repozitorij/račun na GitHubu je bil **izbrisan** (potrjeno: API vrne 404; račun `markec12345678` ne obstaja več; ni forkov, ni Wayback/SWH arhivov).
3. **Produkcijska aplikacija še vedno teče na Vercel** (projekt `roksal-railing-manager`, domena `roksal-railing-manager.vercel.app`) — baza (Neon PostgreSQL) je povezana in zdrava (`/api/public/health` → `{"ok":true,"db":"ok"}`).

## Kaj ta repozitorij vsebuje

| Pot | Vsebina |
|---|---|
| `docs/ROUTE-MAP.md` | **Popolna struktura vseh strani in API rut** (iz build loga produkcijskega deploymenta) |
| `docs/BUILD-LOG.txt` | Surov build log (Next.js build output) |
| `docs/DEPLOYMENTS.md` | Zgodovina vseh 15 ohranjenih deploymentov s commit sporočili (okrnjena) |
| `docs/DEPLOYMENTS-FULL.md` | **POLNA (neokrnjena) commit sporočila** vseh 15 deploymentov + forenzična časovnica izgube vira |
| `config/vercel.json` | Rekonstruirana Vercel konfiguracija (crons, git nastavitve) |
| `config/ENV-VARS.md` | Seznam okoljskih spremenljivk projekta (imena, ne vrednosti) |
| `assets/` | Vsi javno dostopni statični viri žive aplikacije (JS chunki, CSS, fonti) |
| `pages-samples/` | HTML vzorci javnih strani (login, setup, aktivacija, portal, /p) |

## Kaj ŽAL NI bilo mogoče rešiti

- **Izvorna koda (TS/TSX)** — Vercel za git-povezane deploymente **ne hrani izvornih datotek** prek API-ja (`/v13/deployments/{id}/files` → "File tree not found"; preverjeno na vseh 15 deploymentih + kontrolni projekti). Source mape (.map): zaščita je bila začasno izklopljena za preverbo — edina javno dostopna mapa je bila `polyfill-nomodule.js` (framework, ne aplikacijska koda); aplikacijski chunki map nimajo. Zaščita je bila vrnjena na `protectedSourcemaps: true`.
- Avtentificirani del frontend bundle-a (chunki se naložijo šele po prijavi) in strežniška koda (lambda funkcije) niso dostopni prek javnega API-ja.

## Poti do popolne obnovitve

1. **Z.ai kontejner** — commiti imajo avtorja `Z User <z@container>`: aplikacija je bila razvijana v Z.ai Code okolju. **Če je projekt še vedno odprt v Z.ai računu, je tam CELA koda.**
2. **Lokalna kopija** — morebitna kopija na razvojnem računalniku.
3. **Rebuild po specifikaciji** — `docs/ROUTE-MAP.md` vsebuje popolno funkcionalno specifikacijo (130+ API rut + strani); baza s podatki je nedotaknjena v Neon. Aplikacijo je mogoče znova zgraditi proti obstoječi bazi.
4. **Prijava v živo aplikacijo** — če so na voljo administratorski podatki, se da iz žive aplikacije pridobiti še preostanek frontend bundle-a. (Opomba: demo prijava `/api/auth/demo` je na produkciji onemogočena — zahteva `DEMO_ACCESS=on`, ki ga ni mogoče spremeniti brez novega deploymenta.)
5. **Obnova GitHub računa** — če je račun izbrisal lastnik, GitHub omogoča obnovo (restore) v omejenem obdobju prek podpore (github.support). Po obnovi bi bil repo `markec12345678/Roksal-Railing-Manager` spet dostopen.

## Dejanski status aplikacije (6. 10. 2026, 20:30 UTC)

- `https://roksal-railing-manager.vercel.app` → živa, preusmerja na `/login`
- `/api/public/health` → `{"ok":true,"db":"ok","build":"2026-10-06T17:32:23.070Z"}`
- Naslov strani: **"Roksal Railing Manager"** / "Portal stranke — Roksal d.o.o."

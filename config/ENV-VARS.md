# Okoljske spremenljivke (Vercel projekt `roksal-railing-manager`)

> Vrednosti so šifrirane in v tem dokumentu NAMENOMO niso zapisane.
> Dejanske vrednosti so dostopne v Vercel dashboardu: Project → Settings → Environment Variables.

| Ključ | Namen | Okolje |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL (Prisma) — glavna baza | production, preview |
| `DATABASE_URL_UNPOOLED` | Neon nepoolana povezava | production, preview |
| `POSTGRES_URL` / `POSTGRES_URL_NO_SSL` / `POSTGRES_URL_NON_POOLING` | Neon povezovalni URL-ji | production, preview |
| `POSTGRES_PRISMA_URL` | Prisma endpoint | production, preview |
| `POSTGRES_HOST` / `PGHOST` / `PGHOST_UNPOOLED` | Neon gostitelji | production, preview |
| `POSTGRES_USER` / `PGUSER` | DB uporabnik | production, preview |
| `POSTGRES_PASSWORD` / `PGPASSWORD` | DB geslo | production, preview |
| `POSTGRES_DATABASE` / `PGDATABASE` | ime baze | production, preview |
| `NEON_PROJECT_ID` | Neon projekt | production, preview |
| `NEON_AUTH_BASE_URL` / `VITE_NEON_AUTH_URL` | Neon Auth | production, preview |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob shramba (datoteke, viz renderji) | production, preview |
| `SESSION_SECRET` | Podpis sej (auth) | production, preview |
| `API_KEY_PEPPER` | Pepper za API ključe | production, preview |
| `ROKSAL_SETUP_TOKEN` | Setup žeton (prva namestitev) | production |
| `ROKSAL_SETUP_EMAIL` | Setup e-pošta | production |
| `CRON_SECRET` | Skupna skrivnost Vercel crona — brez nje GET `/api/jobs/run` vrne 401 (cron je onemogočen). Nastavi naključni long secret. | production, preview |
| `DEMO_ACCESS` | `on` vklopi demo račune in gumbe na prijavnem ekranu (`/api/auth/demo`). V produkciji mora biti **prazno ali karkoli drugega kot `on`** — demo gesla so javno znana. `src/instrumentation.ts` (R543) ob zagonu strežnika z `DEMO_ACCESS=on` + `NODE_ENV=production` izpiše GLASNO varnostno opozorilo v dnevnik. | preview (razvoj) |
| `CSP_MODE` | Način Content-Security-Policy glave (R543): `report` (privzeto — glava `Content-Security-Policy-Report-Only`, opazovalno obdobje) ali `enforce` (izvršilna glava `Content-Security-Policy`). Prazno/neznano = `report` — tekoče namestitve se obnasajo nespremenjeno. Preklopi v `enforce` ŠELE po pregledu zbranih poročil (tabela `CspReport`). | production, preview |
| `CSP_FRAME_ANCESTORS` | Vrednost direktive `frame-ancestors` (R543), npr. `none`. Neobvezna — privzeto je direktiva IZPUŠČENA (vgrajeni PDF predogled iframe bi jo prelomil; zaščita pred clickjackingom teče prek `X-Frame-Options: SAMEORIGIN`). | production, preview |
| `AUTH_RATE_MAX` | Meja poskusov prijave na IP/min (privzeto **30**, veljavna samo celo število >0). Lokalni pas in CI nastavita 100000, ker se 22 skupin zaporedoma prijavlja z 127.0.0.1; v produkciji pusti PRAZNO — sicer so brute-force vrata odprta. | razvoj, CI |

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

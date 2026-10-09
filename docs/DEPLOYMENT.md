# NAMESTITEV IN DEPLOYMENT — Roksal Manager (R464)

> Posodobljeno ob R464 (issue #1 PRODUCTION HARDENING). Za vsak slučaj obnove glej `docs/RECOVERY.md`.

## Lokalni razvoj (PostgreSQL — embedded)

```bash
bun install
bun run db:up            # embedded PostgreSQL na :54329 (prvič inicializira .pgdata)
bun run db:migrate:deploy  # veriga migracij (prisma/migrations/)
bun run db:seed          # demo podatki (seed.cjs + seed-r442.cjs)
bun run dev              # http://localhost:3000
bun run db:down          # ustavi embedded PostgreSQL
```

`DATABASE_URL` za razvoj: `postgresql://roksal:roksal@localhost:54329/roksal`

## Migracijski workflow (issue #1 §2)

- **Produkcija uporablja IZKLJUČNO `prisma migrate deploy`** (veriga v `prisma/migrations/`, trenutno: `20261009000000_r464_init`).
- `db:push` je RAZVOJNO/RECOVERY orodje — skripta zavrne z opozorilom; eksplicitni izhod je `db:push:force`.
- Sveža PostgreSQL baza se postavi izključno iz repozitorija + migracij (CI job `migrations` to dokaže na vsakem pushu).
- Spremembe sheme: uredi `prisma/schema.prisma` → `bun run db:migrate` (ustvari migracijo) → commit migracije SKUPAJ s spremembo sheme.

## Prehod SQLite → PostgreSQL (R464)

Zgodovina: rekonstrukcija (R431) je bila zgrajena na SQLite (sandbox omejitve). R464 je prehod zaključil:

1. `datasource.provider` preklopljen na `postgresql` (celotna shema preverjena — brez SQLite-specifičnih tipov; JSON podaljaški so `String`, količine `Float`, denar `Decimal(12,2)`).
2. Veriga migracij začeta s `20261009000000_r464_init` (from-empty → celotna trenutna shema; 80 tabel).
3. Denarna polja (21) so `Decimal @db.Decimal(12,2)` — baza jamči 2 decimalki; JSON meja serializira kot number (`src/lib/db.ts`).
4. Testni suite je provider-agnostičen: vsi neposredni vpogledi v bazo tečejo prek Prisma (`TEST_DB_URL`).
5. Backup/DR je provider-agnostičen (`ops/backup.sh` + `ops/export-db.mjs` — nosilec PG podatkov so `export/*.json`).
6. CI (`.github/workflows/ci.yml`) poganja celoten regresijski suite na PostgreSQL service containerju (5 grup, obvezen gate).

### Preklop produkcije (Neon) — izvedeno ob R464

Produkcijska Neon baza je vsebovala IZVIRNO shemo (75 tabel, R120–R430 era) z demo podatki (3 stranke, 3 projekti, 1 testni račun). Preklop:

```sql
ALTER SCHEMA public RENAME TO legacy_r430;   -- izvorna shema + podatki OHRANJENI
CREATE SCHEMA public;
```
nato `prisma migrate deploy` (ustvari novo shemo) in deploy aplikacije. Stari podatki ostanejo dosegljivi v shemi `legacy_r430` za vpogled/migracijo po potrebi.

## Produkcija (Vercel + Neon)

- Deploy: CLI (`vercel deploy --prod`) ali git-integracija (Vercel GitHub App nameščen na račun `robertpezdirc12-design` → `vercel git connect`).
- Okoljske spremenljivke projekta (Vercel): `DATABASE_URL` (Neon pooler), `SESSION_SECRET`, `API_KEY_PEPPER`, `ROKSAL_SETUP_TOKEN`/`ROKSAL_SETUP_EMAIL` (prvi admin prek `/api/setup`), `BLOB_READ_WRITE_TOKEN`.
- Prvi zagon po preklopu: ni uporabnikov → odpre se začetna namestitev (`/api/setup` z ROKSAL_SETUP_TOKEN).
- Migracije ob deployu: `bun run db:migrate:deploy` (Vercel build command: `prisma migrate deploy && next build` — glej Vercel nastavitve).

## Build

- `next build` z ODKRITIM `ignoreBuildErrors` — TypeScript napaka pade build (issue #1 §6).
- Output: `standalone` (samostojen strežnik za self-host; na Vercelu neuporabljen, a ohranjen).

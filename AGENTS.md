# AGENTS.md — peskovnik Base44 (Roksal Railing Manager)

Ta datoteka opisuje samo NEOČITNA dejstva okolja; kar je razvidno iz
`package.json` / `prisma/schema.prisma`, tu ni ponovljeno.

## Zagon

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

Vrstni red storitev (`depends_on`): `postgres` (healthy) → `deps` (namestitev
odvisnosti iz `bun.lock` + `prisma generate`, nato se konča) → `seed`
(`prisma migrate deploy` + demo podatki, nato se konča) → `web` (`next dev`) na
**host portu 3000**.

## Dejstva, ki jih ni mogoče uganiti iz repozitorija

1. **Next mora teči pod Node, namestitev pa pod Bun-om.** `next dev` v16
   privzeto uporablja Turbopack, ki pod Bun RUNTIME-om ne razreši zunanjih
   modulov (`Failed to load external module @prisma/client-<hash>` — znana
   napaka vercel/next.js#86866, velja tudi za bun 1.4). Zato `Dockerfile.base44`
   vzame sliko `node:22` in vanjo preseli SAMO binarko `bun`; `bun install
   --frozen-lockfile` uporablja `bun.lock` (repo nima `package-lock.json`),
   strežnik pa poganja Node. Zamenjava `oven/bun:1` za katero koli app
   storitev to napako povrne.
2. **Demo podatki se naselijo SAMO v prazno bazo.** Ponovni `up` ne pobriše
   podatkov iz predogleda. Prisilno ponovno naseljevanje (DESTRUKTIVNO — briše
   vse):
   ```bash
   docker compose -f docker-compose.base44.yml exec -T web sh -c 'SEED_CONFIRM=YES_DEMO_DATA bun run db:seed'
   ```
3. **`DATABASE_URL` mora kazati na gostitelja `postgres`.** `prisma/seed-guard.cjs`
   (R534) dovoli seed samo na lokalnih gostiteljih (`localhost`, `127.0.0.1`,
   `::1`, `postgres`); druga vrednost pomeni tiho preskočen seed.
4. **Baza je v imenovanem volumnu `roksal-pgdata`**, odvisnosti v
   `roksal-node-modules`. `docker compose ... down -v` izbriše OBOJE.
5. **Demo prijava zahteva `DEMO_ACCESS=on`** (nastavljeno v compose za `web`).
   V razvoju to zadošča (`NODE_ENV != production`); v produkciji bi bila
   potrebna še druga vrata `DEMO_PROD_KEY` (`src/lib/demo-access.ts`). Demo
   računi in gesla so v `prisma/seed.cjs` (npr. `admin@roksal.si` / `Admin123!`).
6. **Zunanje poverilnice niso potrebne za zagon.** Edina obvezna spremenljivka
   je `DATABASE_URL` (lokalna baza). Neobvezne integracije, ki brez vrednosti
   samo ne delujejo (nikoli ne blokirajo zagona): `NOTIFY_WEBHOOK_URL`
   (webhook obvestila), `CRON_SECRET` (brez njega `GET /api/jobs/run` vrne 401),
   `.z-ai-config` (VLM/AR analiza — brez nje 503).
7. **Peskovniška prilagoditev (edina v kodi):** `next.config.ts` ob
   `BASE44_PREVIEW_MODE=1` doda `allowedDevOrigins` za izvor predogleda
   (`3000-$BASE44_PUBLIC_HOST_SUFFIX`) — Next 16 sicer zavrne razvojne vire
   (chunk-i, HMR) iz izvora predogleda. Brez zastavice (produkcija, CI, lokalni
   razvoj) je konfiguracija nespremenjena.
8. **Pomnilnik:** `NODE_OPTIONS=--max-old-space-size=1536` v compose je namerna
   varovalka (izvirni peskovnik je dvakrat OOM-ubil `next dev`); enako počne
   `ops/dev-serve.sh`.

## Preverjanje

```bash
curl -s http://localhost:3000/api/health     # {"status":"ok","db":{"ok":true}}
docker compose -f docker-compose.base44.yml ps
docker compose -f docker-compose.base44.yml logs -f web
```

`/api/health` resnično preveri aplikacijo IN bazo (uporabljen je tudi kot
compose healthcheck). Prva kompilacija poti traja — healthcheck ima zato
180 s milosti.

## Testi in preverjanje tipov (tečejo V vsebniku, na gostitelju ni runtime-ov)

```bash
docker compose -f docker-compose.base44.yml exec -T web bun run typecheck
docker compose -f docker-compose.base44.yml exec -T web bun run lint
docker compose -f docker-compose.base44.yml exec -T web bun run test      # vitest
```

Celotni relejni pas `bash tests/ci-local.sh` zahteva Python 3, ImageMagick in
poppler — teh slika NE vsebuje; posamezne skupine iz `tests/ci-matrix.sh` pa
tečejo prek `curl` + node znotraj vsebnika.

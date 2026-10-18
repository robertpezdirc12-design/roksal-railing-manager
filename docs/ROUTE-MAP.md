# ROUTE MAP — Roksal Railing Manager

> Vir: Next.js build log produkcijskega deploymenta `dpl_EeeiLgQAbetKS3CzeRNYiPK7BTNb` (6. 10. 2026)
> Build commit: `8189ec16e92e77bd5bee977b3a79bc7a04aed41e` (main)

## Strani (App Router)

| Ruta | Tip | Opis |
|---|---|---|
| `/` | ○ statična | Domača stran (preusmeri na login) |
| `/login` | ○ statična | Prijava |
| `/setup` | ƒ dinamična | Inicialna nastavitev |
| `/aktivacija/[token]` | ƒ dinamična | Aktivacija uporabnika |
| `/portal/[token]` | ƒ dinamična | Portal stranke ("Portal stranke — Roksal d.o.o.") |
| `/m/[token]` | ƒ dinamična | Javna meritev (share link) |
| `/p/[id]` | ƒ dinamična | Javni projekt |
| `/_not-found` | ○ statična | 404 |
| **Middleware (Proxy)** | ƒ | Globalni middleware (avtentikacija) |

## API rute (130+)

### Avtentikacija & uporabniki
- `GET/POST /api/auth` — seja
- `POST /api/auth/demo` — demo prijava
- `POST /api/auth/email` — prijava z e-pošto
- `POST /api/auth/logout` — odjava
- `POST /api/auth/password` — sprememba gesla
- `POST /api/auth/register` — registracija
- `GET /api/auth/sessions` · `DELETE /api/auth/sessions/[id]` — seje
- `GET/POST /api/users` · `POST /api/users/activate`
- `POST /api/setup` — inicialni setup

### CRM & prodaja
- `GET/POST /api/leads` · `GET/PATCH/DELETE /api/leads/[id]`
- `GET/POST /api/opportunities` · `GET/PATCH/DELETE /api/opportunities/[id]`
- `GET/POST /api/crm`
- `GET/POST /api/deal-lock`
- `GET/POST /api/customers` · `GET/PATCH/DELETE /api/customers/[id]` · `POST /api/customers/dedup`
- `GET/POST /api/customer-addresses` · `GET/PATCH/DELETE /api/customer-addresses/[id]`
- `GET/POST /api/quotes` · `GET/PATCH/DELETE /api/quotes/[id]` · `GET /api/quotes/[id]/pdf`
- `GET/POST /api/quote`
- `GET/POST /api/invoices` · `GET /api/invoices/eslog` (eSLOG XML format)
- `GET/POST /api/payments` · `GET/PATCH/DELETE /api/payments/[id]` · `POST /api/payments/reconciliation`

### Projekt & proizvodnja
- `GET/POST /api/projects` · `GET /api/projects/[id]/command` · `GET /api/projects/[id]/timeline`
- `GET/POST /api/production` · `GET/PATCH/DELETE /api/production/[id]`
- `GET/POST /api/nalog` (delovni nalogi) · `GET/PATCH/DELETE /api/nalog/[id]` · `POST /api/nalog/[id]/termin` · `POST /api/nalog/[id]/transition` · `GET /api/nalog/zgodovina`
- `GET/POST/PATCH /api/nalog/[id]/checklist` (R444 preprosti seznam) · `GET/POST /api/nalog/[id]/material` · `GET/POST /api/nalog/[id]/events`
- R489 MONTAŽA QA: `GET/POST /api/nalog/[id]/qa` (kontrolne točke iz virov) · `PATCH /api/nalog/[id]/qa/check` (statusni stroj) · `POST/PATCH /api/nalog/[id]/qa/deviation` (odstopanja) · `POST/PATCH /api/nalog/[id]/qa/action` (korektivni ukrepi) · `GET/POST/PATCH /api/nalog/[id]/handover` (verzionirana primopredaja) · `GET /api/pdf/handover/[id]` (PDF zapis)
- `GET/POST /api/schedules`
- `GET/POST /api/crews` (ekipe)
- `GET/POST /api/equipment` · `GET /api/equipment/events`
- `GET/POST /api/punch` ( prisotnost)
- `GET/POST /api/qc` (kontrola kakovosti)
- `GET/POST /api/installation-records` · `GET/PATCH/DELETE /api/installation-records/[id]`
- `GET/POST /api/warranty` · `GET/PATCH/DELETE /api/warranty/[id]` · `GET/POST /api/warranty/[id]/visits` · `DELETE /api/warranty/[id]/visits/[visitId]`

### Katalog, materiali, BOM
- `GET/POST /api/catalog` · `GET /api/catalog/compatibility` · `GET /api/catalog/products/[id]` (+ `/applications`, `/variants`) · `GET /api/catalog/supplier-mappings` · `GET /api/catalog/versions` (+ `/[id]`)
- `GET/POST /api/bom` · `GET/POST /api/bom-draft` · `POST /api/bom-refine` · `GET/PATCH/DELETE /api/bom/[id]` · `GET /api/bom/procurement`
- `GET/POST /api/material-orders` · `GET /api/material-orders/history`
- `GET/POST /api/material-prices` · `GET /api/material-prices/zgodovina`
- `GET/POST /api/inventory` · `GET/POST /api/inventory/lots`
- `GET/POST /api/suppliers`
- `GET/POST /api/price-book`
- `GET/POST /api/profili` (profili ograj)

### Meritve, načrtovanje, inženiring
- `GET/POST /api/measurements` · `GET/PATCH/DELETE /api/measurements/[id]` · `GET /api/measurements/[id]/verzije`
- `POST /api/measure/photo` · `POST /api/measurement/detect` · `POST /api/measurement/confirm` · `GET /api/measurement/products`
- `GET/POST /api/railing-layout`
- `GET/POST /api/sketches`
- `GET/POST /api/slopes` (nakloni)
- `GET/POST /api/engineering-rules` · `GET/PATCH/DELETE /api/engineering-rules/[id]` · `GET /api/engineering-rules/[id]/versions` · `GET /api/engineering-rules/versions/[id]`
- `POST /api/calculator`

### 3D vizualizacije & AR
- `GET/POST /api/ar-snapshots` · `POST /api/ar/analyze` · `POST /api/ar/analyze-multi` (R558: VLM prečka 2–8 fotografij)
- `GET/POST /api/viz/projects` · `GET/PATCH/DELETE /api/viz/projects/[id]` · `POST /api/viz/projects/[id]/duplicate`
- `POST /api/viz/render` · `GET /api/viz/render/[jobId]` · `POST /api/viz/stage` · `GET /api/viz/preview` · `GET /api/viz/product-preview`
- `GET /api/viz/files/[...key]` · `POST /api/viz/gc` (cron)
- `POST /api/vision/placement` · `POST /api/vision/scene`

### Dokumenti, datoteke, dokazovanje
- `GET/POST /api/documents`
- `GET /api/files/[...key]` (Vercel Blob proxy)
- `GET/POST /api/photos` · `GET/POST /api/gallery`
- `GET/POST /api/evidence`
- `GET/POST /api/surveys`
- `GET/POST /api/signature-audit`

### Sistemsko
- `GET/POST /api/audit`
- `GET/POST /api/notifications` · `POST /api/notifications/read`
- `GET/POST /api/search`
- `POST /api/security/rate-limit`
- `POST /api/storage/reconcile`
- `POST /api/sync`
- `GET/POST /api/jobs` · `POST /api/jobs/run` (cron, 3:30)
- `GET /api/weather`
- `GET /api/public/health` · `GET /api/public/measure` · `GET /api/public/version`
- `GET /api/version`
- `GET/POST /api/portal` · `GET /api/portal/[token]`
- `GET /api` (root)

## Cron jobi (iz vercel.json)

| Pot | Urnik |
|---|---|
| `/api/viz/gc` | `0 4 * * *` (vsak dan ob 4:00) |
| `/api/jobs/run` | `30 3 * * *` (vsak dan ob 3:30) |

## Infrastruktura

- **Framework:** Next.js (App Router), Turbopack build
- **Node:** 24.x
- **Baza:** Neon PostgreSQL (Prisma)
- **Shramba datotek:** Vercel Blob
- **Strežniške funkcije:** Node.js lambda, 2048 MB RAM, timeout 300 s
- **Middleware:** globalni proxy (avtentikacija)

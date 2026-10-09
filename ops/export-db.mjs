#!/usr/bin/env bun
// ops/export-db.mjs — strojno berljiv JSON export VSEH modelov (R464 / issue #1).
//
// Nadomešča ops/export-db.py kot primarni export v backup/DR verigi:
//   • deluje za PostgreSQL IN SQLite (isti PrismaClient, DATABASE_URL odloča),
//   • modeli se odkrijejo IZ prisma/schema.prisma (nobenega ročnega seznama),
//   • _meta.json: { generatedAt, tableCount, rowCounts, schemaFingerprint },
//     kjer je schemaFingerprint = SHA-256 vsebine prisma/schema.prisma
//     (isti vir kot manifest.schemaPrismaSha256 v backup.sh — provider-agnostično),
//   • Decimal polja se serializirajo kot number (lastni inline patch — skripta
//     teče IZVEN Next.js, zato se ne zanaša na src/lib/db.ts).
//
// Datum (Date) → ISO niz, kot prej v .py različici (default=str).
//
// Uporaba:  DATABASE_URL=… bun ops/export-db.mjs <ciljna-mapa>
// Izhod (stdout): JSON povzetek { ok, generatedAt, tableCount, rowCounts, … }

import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Prisma, PrismaClient } from '@prisma/client'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SCHEMA_PATH = resolve(ROOT, 'prisma/schema.prisma')

// Decimal → number (enaka politika kot src/lib/db.ts — JSON ostane številski)
Prisma.Decimal.prototype.toJSON = function () { return this.toNumber() }

function die (msg) {
  console.error(`NAPAKA: ${msg}`)
  process.exit(1)
}

const outDir = process.argv[2]
if (!outDir) die('uporaba: DATABASE_URL=… bun ops/export-db.mjs <ciljna-mapa>')

const dbUrl = process.env.ROKSAL_DATABASE_URL || process.env.DATABASE_URL
if (!dbUrl) die('manjka DATABASE_URL v okolju (ali ROKSAL_DATABASE_URL)')
const provider = dbUrl.startsWith('postgres') ? 'postgresql' : dbUrl.startsWith('file:') ? 'sqlite' : 'unknown'

// ── odkrivanje modelov iz sheme (izključimo @@ignore) ───────────────────────
const schema = readFileSync(SCHEMA_PATH, 'utf8')
const models = []
for (const block of schema.split(/^model\s+/m).slice(1)) {
  const name = block.match(/^(\w+)\s*\{/)?.[1]
  if (!name) continue
  if (/^@@ignore/m.test(block.slice(block.indexOf('{')))) continue // ne obstaja v DB
  models.push(name)
}
if (models.length === 0) die('v prisma/schema.prisma ni bilo mogoče najti modelov')

const schemaFingerprint = createHash('sha256').update(schema, 'utf8').digest('hex')

// ── export vseh modelov ─────────────────────────────────────────────────────
mkdirSync(outDir, { recursive: true })
const prisma = new PrismaClient({ log: ['error'] })
const rowCounts = {}
try {
  for (const model of models) {
    const delegate = model[0].toLowerCase() + model.slice(1) // User → user
    const api = prisma[delegate]
    if (!api || typeof api.findMany !== 'function') {
      die(`Prisma nima delegata za model ${model} (preveri shemo/ponovno generiraj klienta)`)
    }
    const rows = await api.findMany()
    rowCounts[model] = rows.length
    // namensko brez sortiranja: števci/velikost so pomembni, vrstni red ni del pogodbe
    // (JSON.stringify uveljavi toJSON patch: Decimal → number, Date → ISO niz)
    writeFileSync(resolve(outDir, `${model}.json`), JSON.stringify(rows, null, 1), 'utf8')
  }
} finally {
  await prisma.$disconnect()
}

const meta = {
  generatedAt: new Date().toISOString(),
  provider,
  tableCount: models.length,
  rowCounts,
  schemaFingerprint,
}
writeFileSync(resolve(outDir, '_meta.json'), JSON.stringify(meta, null, 1), 'utf8')
console.log(JSON.stringify({ ok: true, ...meta }))

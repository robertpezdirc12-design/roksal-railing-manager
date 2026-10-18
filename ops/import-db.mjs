#!/usr/bin/env bun
// ops/import-db.mjs — R565 (issue #22): UVOZ export/*.json V SVEŽO PostgreSQL
// bazo, v VRSTNEM REDU ODVISNOSTI (tuji ključi).
//
// Zakaj: backup za PostgreSQL (R464) nosi podatke kot export/*.json (vsak
// model posebej + _meta.json s števci). restore.sh --target-dir jih samo
// razpakira — do zdaj je bilo treba PG obnoviti ROČNO (docs/RECOVERY.md).
// Ta skripta avtomatizira obnovo podatkov:
//   1. prebere prisma/schema.prisma → graf odvisnosti (model → modeli, na
//      katere kažejo NJEGOVI tuji ključi) + topološka ureditev (Kahn);
//   2. cikel, ki NI samopovezava, je TRDA NAPAKA (nikoli tiho izpuščanje);
//      samopovezave (npr. DigitalTwinSnapshot.parentSnapshotId) uvozimo v
//      DVE fazah: createMany brez samega FK → UPDATE nazaj (vrstni red v isti
//      tabeli je lahko poljuben);
//   3. createMany po modelih v odvisnostnem vrstnem redu (starš pred otrokom);
//   4. preverba: števci vrstic VSAKE tabele proti export/_meta.json —
//      neskladje = NAPAKA (izhod 1), ne opozorilo;
//   5. fail-closed: če ciljna tabela ŽE ima vrstice, uvoz zavrnemo (razen
//      --force, ki najprej pobriše vse vrstice v OBRATNEM odvisnostnem redu).
//
// Decimal polja: export jih je zapisal kot number (export-db.mjs patch) —
// PrismaClient sprejema number za Decimal. DateTime: ISO niz → Prisma
// sprejema. Json: objekt/seznam → neposredno.
//
// Uporaba:
//   DATABASE_URL=postgres://…sveža-baza… bun ops/import-db.mjs <mapa-export> [--force]
// Izhod (stdout): JSON { ok, imported: {Model: n}, verified, selfRefsFixed }

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SCHEMA_PATH = resolve(ROOT, 'prisma/schema.prisma')

const FORCE = process.argv.includes('--force')
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const EXPORT_DIR = args[0]
if (!EXPORT_DIR) {
  console.error('Uporaba: bun ops/import-db.mjs <mapa-export> [--force]')
  process.exit(2)
}
if (!existsSync(resolve(EXPORT_DIR, '_meta.json'))) {
  console.error(`Napaka: ${EXPORT_DIR}/_meta.json ne obstaja (ni veljaven export).`)
  process.exit(2)
}

// ── 1. parse sheme: modeli + relacije s tujimi ključi ────────────────────────
const schema = readFileSync(SCHEMA_PATH, 'utf-8')
const models = new Map() // ime → { fks: Map<kolumna, ciljniModel>, selfFks: Set<kolumna> }
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const name = m[1]; const body = m[2]
  const fks = new Map()
  for (const rel of body.matchAll(/(\w+)\s+(\w+)\??\s+@relation\(([^)]*)\)/g)) {
    const target = rel[2]
    const args = rel[3]
    const fkMatch = args.match(/fields:\s*\[(\w+)\]/)
    if (!fkMatch) continue
    if (target === name) continue // samopovezava — spodaj
    fks.set(fkMatch[1], target)
  }
  const selfFks = new Set()
  for (const rel of body.matchAll(new RegExp(`(\\w+)\\s+${name}\\??\\s+@relation\\(([^)]*)\\)`, 'g'))) {
    const fkMatch = rel[2].match(/fields:\s*\[(\w+)\]/)
    if (fkMatch) selfFks.add(fkMatch[1])
  }
  models.set(name, { fks, selfFks })
}

// ── 2. topološka ureditev (Kahn) — samopovezave ne štejejo v graf ───────────
const deps = new Map() // model → Set<modelov, ki MORAJO biti uvoženi prej
for (const [name, { fks }] of models) {
  deps.set(name, new Set([...fks.values()].filter((t) => t !== name)))
}
const order = []
const remaining = new Set(deps.keys())
let napredek = true
while (remaining.size > 0 && napredek) {
  napredek = false
  for (const m of [...remaining]) {
    const d = deps.get(m)
    if ([...d].every((x) => !remaining.has(x))) { order.push(m); remaining.delete(m); napredek = true }
  }
}
if (remaining.size > 0) {
  console.error(`Napaka: cikel tujih ključev med modeli (ni samopovezava): ${[...remaining].join(', ')} — ročna odločitev potrebna.`)
  process.exit(1)
}

// ── 3. uvoz ──────────────────────────────────────────────────────────────────
const meta = JSON.parse(readFileSync(resolve(EXPORT_DIR, '_meta.json'), 'utf-8'))
const prisma = new PrismaClient()
const imported = {}
const selfRefsFixed = {}
try {
  // fail-closed: ciljne tabele morajo biti prazne (razen --force)
  const zePodvojene = []
  for (const m of order) {
    const table = m.charAt(0).toLowerCase() + m.slice(1)
    const n = await prisma[table].count()
    if (n > 0) zePodvojene.push(`${m}=${n}`)
  }
  if (zePodvojene.length > 0) {
    if (!FORCE) {
      console.error(`Napaka: ciljna baza NI prazna (${zePodvojene.join(', ')}). Uporabite --force za brisanje najprej.`)
      process.exit(1)
    }
    for (const m of [...order].reverse()) {
      const table = m.charAt(0).toLowerCase() + m.slice(1)
      await prisma[table].deleteMany()
    }
  }

  for (const m of order) {
    const file = resolve(EXPORT_DIR, `${m}.json`)
    if (!existsSync(file)) { imported[m] = null; continue } // model brez datoteke = ni bil exportiran
    const rows = JSON.parse(readFileSync(file, 'utf-8'))
    const info = models.get(m)
    const hasSelf = info.selfFks.size > 0
    // samopovezave: ustvari BREZ self-FK stolpcev, potem UPDATE nazaj
    const payload = hasSelf
      ? rows.map((r) => { const c = { ...r }; for (const k of info.selfFks) delete c[k]; return c })
      : rows
    if (rows.length > 0) {
      await prisma[m.charAt(0).toLowerCase() + m.slice(1)].createMany({ data: payload })
    }
    if (hasSelf && rows.length > 0) {
      let fixed = 0
      for (const r of rows) {
        const set = {}
        let ima = false
        for (const k of info.selfFks) { if (r[k] !== undefined && r[k] !== null) { set[k] = r[k]; ima = true } }
        if (ima) {
          await prisma[m.charAt(0).toLowerCase() + m.slice(1)].update({ where: { id: r.id }, data: set })
          fixed++
        }
      }
      selfRefsFixed[m] = fixed
    }
    imported[m] = rows.length
  }

  // ── 4. preverba števcev proti _meta.json ──────────────────────────────────
  const napake = []
  const verified = {}
  for (const [m, expected] of Object.entries(meta.rowCounts ?? {})) {
    const table = m.charAt(0).toLowerCase() + m.slice(1)
    const n = await prisma[table].count()
    verified[m] = n
    if (n !== expected) napake.push(`${m}: uvoženo ${n}, export ${expected}`)
  }
  if (napake.length > 0) {
    console.error(`Napaka pri preverbi števcev: ${napake.join('; ')}`)
    process.exit(1)
  }

  console.log(JSON.stringify({ ok: true, imported, selfRefsFixed, verified, models: order.length }))
} finally {
  await prisma.$disconnect()
}

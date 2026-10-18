#!/usr/bin/env bun
// ops/fk-check.mjs — R565 (issue #22): preverba TUIH KLJUČEV obnovljene baze.
//
// Po uvozu (import-db.mjs) preveri, da v obnovljeni bazi NI sirot: vrstica z
// tujim ključem, ki kaže na neobstoječega starša. Enako število vrstic v
// exportu NI dokaz veljavne obnove (issue #22 točka 3) — to je.
//
// Preverjene relacije (ključne poslovne verige):
//   QuoteLine→Quote, PriceRule→PriceList, Quote→Customer/Project,
//   Measurement→Project, AuditLog→User, WorkOrder→Project,
//   ProductVariant→Product, ProductAsset→Product, StockReservation→StockLot.
//
// Izhod (stdout): JSON { ok, sirote: {relacija: n}, total }
// Izhodna koda: 0 = veljavna obnova (0 sirot); 1 = sirote obstajajo.

import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) { console.error('Manjka DATABASE_URL'); process.exit(2) }

const c = new pg.Client({ connectionString: url })
await c.connect()

const RELACIJE = [
  ['QuoteLine→Quote', 'SELECT COUNT(*) n FROM "QuoteLine" l LEFT JOIN "Quote" q ON l."quoteId"=q.id WHERE q.id IS NULL'],
  ['PriceRule→PriceList', 'SELECT COUNT(*) r FROM "PriceRule" r LEFT JOIN "PriceList" l ON r."priceListId"=l.id WHERE l.id IS NULL'],
  ['Quote→Customer', 'SELECT COUNT(*) n FROM "Quote" q LEFT JOIN "Customer" c ON q."customerId"=c.id WHERE q."customerId" IS NOT NULL AND c.id IS NULL'],
  ['Quote→Project', 'SELECT COUNT(*) n FROM "Quote" q LEFT JOIN "Project" p ON q."projectId"=p.id WHERE q."projectId" IS NOT NULL AND p.id IS NULL'],
  ['Measurement→Project', 'SELECT COUNT(*) n FROM "Measurement" m LEFT JOIN "Project" p ON m."projectId"=p.id WHERE m."projectId" IS NOT NULL AND p.id IS NULL'],
  ['AuditLog→User', 'SELECT COUNT(*) n FROM "AuditLog" a LEFT JOIN "User" u ON a."userId"=u.id WHERE a."userId" IS NOT NULL AND u.id IS NULL'],
  ['WorkOrder→Project', 'SELECT COUNT(*) n FROM "WorkOrder" w LEFT JOIN "Project" p ON w."projectId"=p.id WHERE w."projectId" IS NOT NULL AND p.id IS NULL'],
  ['ProductVariant→Product', 'SELECT COUNT(*) n FROM "ProductVariant" v LEFT JOIN "Product" p ON v."productId"=p.id WHERE p.id IS NULL'],
  ['ProductAsset→Product', 'SELECT COUNT(*) n FROM "ProductAsset" a LEFT JOIN "Product" p ON a."productId"=p.id WHERE a."productId" IS NOT NULL AND p.id IS NULL'],
  ['StockReservation→StockLot', 'SELECT COUNT(*) n FROM "StockReservation" r LEFT JOIN "StockLot" l ON r."stockLotId"=l.id WHERE l.id IS NULL'],
]

const sirote = {}
let total = 0
for (const [ime, sql] of RELACIJE) {
  const r = await c.query(sql)
  const n = Number(r.rows[0].n)
  sirote[ime] = n
  total += n
}
await c.end()

console.log(JSON.stringify({ ok: total === 0, sirote, total }))
process.exit(total === 0 ? 0 : 1)

// seed-r447.cjs — issue #7 §5 P2 KONFIGURATORJI: dopolnilne variante za konfigurator
// (v OBSTOJEČO demo bazo, idempotentno — po vzoru seed-r446.cjs).
// Katalog 16 izdelkov v 10 družinah že zadostuje za konfigurator; dodamo samo
// 2 smiselni varianti za FAS-K-002 (kasetna fasada — edina fasada brez barv),
// da je družinski obrazec FASADA (barva/RAL + odbitki) polno demonstriran.
// Ne briše ničesar; vsaka varianta se doda samo, če SKU še ne obstaja.
// Uporaba: node prisma/seed-r447.cjs
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main () {
  const fasK = await db.product.findUnique({
    where: { sku: 'FAS-K-002' },
    select: { id: true, sku: true, salePrice: true },
  })
  if (!fasK) {
    console.log('[seed-r447] FAS-K-002 manjka — preskočeno (katalog naj se najprej sejema z seed.cjs)')
    return
  }

  const wanted = [
    { sku: 'FAS-K-002-ANT', name: 'Antracit', color: 'Antracit', ral: 'RAL 7016', salePrice: fasK.salePrice, sortOrder: 1 },
    { sku: 'FAS-K-002-BEL', name: 'Bela', color: 'Bela', ral: 'RAL 9016', salePrice: Math.round((fasK.salePrice + 3) * 100) / 100, sortOrder: 2 },
  ]

  let added = 0
  for (const v of wanted) {
    const dupe = await db.productVariant.findUnique({ where: { sku: v.sku }, select: { id: true } })
    if (dupe) { console.log('[seed-r447]', v.sku, 'že obstaja — preskočeno'); continue }
    await db.productVariant.create({
      data: {
        productId: fasK.id, sku: v.sku, name: v.name,
        color: v.color, ral: v.ral, salePrice: v.salePrice, sortOrder: v.sortOrder,
      },
    })
    added++
    console.log(`[seed-r447] dodana varianta ${v.sku} (${v.name}, ${v.ral}, ${v.salePrice} €/m²)`)
  }
  console.log(`[seed-r447] skupaj dodanih variant: ${added}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())

import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const p = await db.product.findFirst({ where: { sku: 'OGR-K-002' }, include: { variants: true } })
for (const v of p.variants) console.log(v.sku, '|', v.name, '| RAL:', v.ral, '| color:', v.color)
await db.$disconnect()

// R518: polni tech (razmaki) za POLNA 128, ROMB 67, POLNA 100, POLNA 57, DESKA 150
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
for (const sku of ['ROK-OG-ROMB-67', 'ROK-OG-POLNA-128', 'ROK-OGP-POLNA-100', 'ROK-OGP-POLNA-57', 'ROK-OG-DESKA-150']) {
  const p = await db.product.findFirst({ where: { sku } })
  const t = JSON.parse(p.tech ?? '{}')
  const kljuci = Object.keys(t).filter(k => /razm|reza|spoj|standard/i.test(k))
  console.log(sku, '→', JSON.stringify(Object.fromEntries(kljuci.map(k => [k, t[k]]))))
}
await db.$disconnect()

// R518: tech JSON vseh ciljnih izdelkov + ALU ograji
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
for (const sku of ['ROK-OG-POLNA-128', 'ROK-OGP-POLNA-57', 'ROK-OGP-POLNA-100', 'ROK-OG-DESKA-150', 'OGR-K-002', 'OGR-P-001']) {
  const p = await db.product.findFirst({ where: { sku }, include: { family: true } })
  if (!p) { console.log(sku, 'NE OBSTOJA'); continue }
  console.log('═'.repeat(70))
  console.log(`${sku} · ${p.name} · family=${p.family.code}`)
  console.log('tech:', JSON.stringify(p.tech ?? {}, null, 1).slice(0, 700))  // R542: jsonb objekt
}
await db.$disconnect()

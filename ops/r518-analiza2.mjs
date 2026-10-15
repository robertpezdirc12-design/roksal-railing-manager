// R518: preslikava variantSku → VERIFIED gradiva za POLNA-100 in DESKA-150
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
for (const sku of ['ROK-OGP-POLNA-100', 'ROK-OG-DESKA-150', 'ROK-OG-POLNA-128', 'ROK-OGP-POLNA-57']) {
  const p = await db.product.findFirst({ where: { sku }, include: { assets: true, variants: true } })
  if (!p) { console.log(sku, 'NE OBSTOJA'); continue }
  console.log('═'.repeat(80))
  console.log(`${sku} — ${p.name}`)
  for (const v of p.variants) {
    const vs = await db.productAsset.findMany({ where: { variantSku: v.sku, status: 'VERIFIED' } })
    console.log(`  ${v.sku} (${v.color}${v.ral ? ' RAL ' + v.ral : ''}): ${vs.map(a => a.filePath.split('/').pop()).join(', ') || 'BREZ gradiva za ta odtenek'}`)
  }
  // splošna (brez variantSku) — struktura/samo družina
  const splosna = p.assets.filter(a => !a.variantSku && a.status === 'VERIFIED')
  if (splosna.length) console.log(`  [brez variantSku — struktura/družina]: ${splosna.map(a => `${a.filePath.split('/').pop()} (${a.kind})`).join(', ')}`)
}
await db.$disconnect()

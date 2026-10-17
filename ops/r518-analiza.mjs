// R518: analiza kataloga — kateri ograjni izdelki imajo VERIFIED gradiva
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const ps = await db.product.findMany({
  where: { family: { code: { in: ['OGRAJA_PRECNA','OGRAJA_POKOCNA'] } } },
  include: { family: true, variants: true, assets: true },
  orderBy: { sku: 'asc' },
})
for (const p of ps) {
  const tech = p.tech ?? {}  // R542: jsonb objekt
  const verified = p.assets.filter(a => a.status === 'VERIFIED')
  console.log('─'.repeat(90))
  console.log(`${p.sku} | ${p.name} | ${p.family.code} | profil=${tech.profil} | visina=${tech.visinaMm}`)
  console.log(`  gradiva: ${p.assets.length} (VERIFIED: ${verified.length})`)
  for (const a of p.assets.slice(0, 6)) console.log(`    [${a.status}] ${a.kind} ${a.filePath.split('/').pop()}`)
  console.log(`  variante (${p.variants.length}): ${p.variants.map(v => `${v.name}${v.ral ? '/RAL ' + v.ral : ''}${v.color ? '/' + v.color : ''}${v.sku ? '' : ''}`).join(' · ')}`)
}
await db.$disconnect()

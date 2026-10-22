// catalog-export — izvoz kataloga iz razvojne baze v JSON, ki ga aplikacija
// uporabi za dopolnitev produkcijskega kataloga (glej src/lib/katalog-dopolnitev.ts
// in /api/catalog/dopolnitev).
//
// ZAKAJ: produkcijska baza je bila osnovana z zgodnejšim seedom (16 generičnih
// izdelkov). Pravi ROKSAL izdelki (variante + gradiva) so v repozitoriju, ne pa
// v produkcijski bazi. Ročno vpisovanje 18 izdelkov in 100+ gradiv je
// nezanesljivo — zato izvoz iz znanega stanja in IDEMPOTENTNA dopolnitev
// (samo manjkajoče, nikoli prepis obstoječega).
//
// Uporaba: DATABASE_URL=... node scripts/catalog-export.cjs
// Rezultat: prisma/katalog-roksal.json (commitan, brez skrivnosti).

const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main () {
  const families = await prisma.productFamily.findMany({ orderBy: { code: 'asc' } })
  const products = await prisma.product.findMany({
    orderBy: { sku: 'asc' },
    include: {
      family: { select: { code: true } },
      variants: { orderBy: { sortOrder: 'asc' } },
      assets: { orderBy: { createdAt: 'asc' } },
    },
  })

  const out = {
    _namen: 'Izvoz kataloga za idempotentno dopolnitev produkcijske baze (samo manjkajoče).',
    _izvozeno: new Date().toISOString(),
    _vir: 'razvojna baza (bun run db:seed)',
    families: families.map((f) => ({
      code: f.code, name: f.name, desc: f.desc, unit: f.unit, sortOrder: f.sortOrder, active: f.active,
    })),
    products: products.map((p) => ({
      familyCode: p.family.code,
      sku: p.sku,
      name: p.name,
      desc: p.desc,
      unit: p.unit,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
      depthMm: p.depthMm,
      tech: p.tech,
      costPrice: String(p.costPrice),
      salePrice: String(p.salePrice),
      warrantyMonths: p.warrantyMonths,
      active: p.active,
      validFrom: p.validFrom.toISOString(),
      validTo: p.validTo ? p.validTo.toISOString() : null,
      variants: p.variants.map((v) => ({
        sku: v.sku,
        name: v.name,
        color: v.color,
        ral: v.ral,
        widthMm: v.widthMm,
        heightMm: v.heightMm,
        costPrice: v.costPrice == null ? null : String(v.costPrice),
        salePrice: v.salePrice == null ? null : String(v.salePrice),
        tech: v.tech,
        active: v.active,
        sortOrder: v.sortOrder,
      })),
      assets: p.assets.map((a) => ({
        variantSku: a.variantSku,
        kind: a.kind,
        orientation: a.orientation,
        view: a.view,
        colorName: a.colorName,
        colorApprox: a.colorApprox,
        filePath: a.filePath,
        cdnUrl: a.cdnUrl,
        sourceUrl: a.sourceUrl,
        sha256: a.sha256,
        bytes: a.bytes,
        sourceName: a.sourceName,
        capturedAt: a.capturedAt.toISOString(),
        permission: a.permission,
        status: a.status,
        note: a.note,
      })),
    })),
  }

  const target = path.join(__dirname, '..', 'prisma', 'katalog-roksal.json')
  fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf8')
  const variants = out.products.reduce((s, p) => s + p.variants.length, 0)
  const assets = out.products.reduce((s, p) => s + p.assets.length, 0)
  console.log(`Zapisano ${target}`)
  console.log(`Družine: ${out.families.length}, izdelki: ${out.products.length}, variante: ${variants}, gradiva: ${assets}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

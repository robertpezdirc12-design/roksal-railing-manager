import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'

// GET /api/product-assets?productId=…&kind=…&status=… — originalna produktna gradiva (issue #6)
// GET /api/product-assets?matrix=1 — matrika pokritosti Produkt × Profil × Barva × Orientacija
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.read')
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams

  // ── matrika pokritosti (issue #6 §3) ──
  if (sp.get('matrix')) {
    const products = await db.product.findMany({
      where: { sku: { startsWith: 'ROK-' } },
      orderBy: { sku: 'asc' },
      select: {
        id: true, sku: true, name: true,
        variants: { where: { active: true }, select: { sku: true, name: true, color: true, ral: true } },
        assets: { select: { kind: true, orientation: true, status: true } },
      },
    })
    const rows = products.map((p) => {
      const kind = (k: string) => p.assets.filter((a) => a.kind === k)
      const barvneLestvice = kind('BARVNA_LESTVICA')
      const potrdeneBarve = p.variants.filter((v) => v.color && !v.ral).length
      return {
        sku: p.sku, name: p.name,
        profil: p.sku.replace(/^ROK-[A-Z]+-/, ''),
        orientacija: p.sku.includes('OGP') ? 'POKOCNA'
          : p.sku.includes('OG-') ? 'POKOCNA_PRECNA'
            : p.sku.includes('FAS') ? 'FASADA' : 'SPLOSNO',
        barve: { potrjenihImen: potrdeneBarve, ralPribliskov: p.variants.filter((v) => v.ral).length },
        fotografije: kind('FOTO_IZDELEK').length,
        profilPresek: kind('PROFIL_PRESEK').length,
        barvnaLestvica: barvneLestvice.length > 0 ? { status: barvneLestvice[0].status } : null,
        status: p.assets.some((a) => a.status === 'VERIFIED')
          ? (barvneLestvice.some((a) => a.status === 'MISSING') ? 'DELECNO' : 'PREVERJENO')
          : 'MANJKA',
      }
    })
    return NextResponse.json({
      data: rows,
      legenda: {
        status: 'PREVERJENO = vsa gradiva preverjena; DELECNO = gradiva obstajajo, a barvna lestvica manjka (datoteka); MANJKA = ni preverjenih gradiv',
        barve: 'potrjenihImen = imena potrjena z besedilom vira (Rustic Oak/Walnut); ralPribliskov = demo RAL približki (neuradno za WPC)',
      },
    })
  }

  const productId = sp.get('productId')
  const kind = sp.get('kind')
  const status = sp.get('status')

  const assets = await db.productAsset.findMany({
    where: {
      ...(productId ? { productId } : {}),
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: 'asc' }, { kind: 'asc' }, { createdAt: 'asc' }],
    include: { product: { select: { sku: true, name: true } } },
  })
  return NextResponse.json({ data: assets })
}

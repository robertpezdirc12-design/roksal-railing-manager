// /api/catalog/dopolnitev — R579: enkratna (a idempotentna) dopolnitev
// produkcijskega kataloga iz prisma/katalog-roksal.json.
//
// ZAKAJ: produkcijska baza ima samo generične izdelke; pravi ROKSAL izdelki z
// variantami in gradivi so v repozitoriju. Route SAMO DODAJA manjkajoče in
// NIKOLI ne prepiše obstoječih cen/opisov (glej src/lib/katalog-dopolnitev.ts).
//
// Dostop: catalog.write (admin). Revizija: CATALOG_DOPOLNITEV.

import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { dopolniKatalog, type KatalogPodatki } from '@/lib/katalog-dopolnitev'
import katalogJson from '../../../../../prisma/katalog-roksal.json'

export const runtime = 'nodejs'

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.write')
  if (auth instanceof NextResponse) return auth

  const porocilo = await dopolniKatalog(katalogJson as unknown as KatalogPodatki)

  await writeAudit({
    userId: auth.user.id,
    action: 'CATALOG_DOPOLNITEV',
    entity: 'catalog',
    detail: porocilo as unknown as Record<string, unknown>,
  })

  return NextResponse.json({ data: porocilo })
}

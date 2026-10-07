import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { stockOverview } from '@/lib/stock-core'

// GET /api/stock? q=&lowOnly= — pregled zaloge z LOČENIMI stolpci
// FIZIČNA ≠ REZERVIRANA ≠ RAZPOLOŽLJIVA (issue #7 §7; vrata inventory.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const rows = await stockOverview({
    q: sp.get('q')?.trim() || undefined,
    lowOnly: sp.get('lowOnly') === '1',
  })
  return NextResponse.json({ data: rows })
}

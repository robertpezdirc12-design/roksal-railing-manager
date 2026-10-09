import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { releaseBom } from '@/lib/stock-core'

type Params = { params: Promise<{ id: string }> }

// POST /api/bom/[id]/release — sprosti rezervacije kosovnice (inventory.write)
// R464: revizija BOM_RELEASE se zapiše V transakciji (stock-core) — atomarna
// s sprostitvijo, odporna na sočasne zahteve.
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const res = await releaseBom(id, auth.user.id)
  if (!res.ok) return jsonError(409, res.error)

  return NextResponse.json({ data: { released: res.released } })
}

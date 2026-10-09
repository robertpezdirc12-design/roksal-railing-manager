import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { reserveBom } from '@/lib/stock-core'

type Params = { params: Promise<{ id: string }> }

// POST /api/bom/[id]/reserve — rezerviraj VSE vrstice kosovnice (inventory.write)
// Atomicno: bodisi vse rezervacije, bodisi nič. Preverja RAZPOLOŽLJIVO zalogo.
// R464: revizija BOM_RESERVE se zapiše V transakciji (stock-core) — atomarna
// z rezervacijo, odporna na sočasne zahteve.
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const res = await reserveBom(id, auth.user.id)
  if (!res.ok) return jsonError(409, res.error)

  return NextResponse.json({ data: { reserved: res.lines } }, { status: 201 })
}

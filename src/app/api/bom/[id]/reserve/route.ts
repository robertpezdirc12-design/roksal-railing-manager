import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { reserveBom } from '@/lib/stock-core'

type Params = { params: Promise<{ id: string }> }

// POST /api/bom/[id]/reserve — rezerviraj VSE vrstice kosovnice (inventory.write)
// Atomicno: bodisi vse rezervacije, bodisi nič. Preverja RAZPOLOŽLJIVO zalogo.
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const res = await reserveBom(id, auth.user.id)
  if (!res.ok) return jsonError(409, res.error)

  const bom = await db.bom.findUnique({
    where: { id },
    select: { code: true, package: { select: { projectId: true } } },
  })
  await writeAudit({
    userId: auth.user.id, action: 'BOM_RESERVE', entity: 'bom', entityId: id,
    projectId: bom?.package?.projectId ?? null,
    detail: { code: bom?.code ?? id, lines: res.lines },
  })
  return NextResponse.json({ data: { reserved: res.lines } }, { status: 201 })
}

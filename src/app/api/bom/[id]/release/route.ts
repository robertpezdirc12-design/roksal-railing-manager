import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { releaseBom } from '@/lib/stock-core'
import { db } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

// POST /api/bom/[id]/release — sprosti rezervacije kosovnice (inventory.write)
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'inventory.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const res = await releaseBom(id, auth.user.id)
  if (!res.ok) return jsonError(409, res.error)

  const bom = await db.bom.findUnique({ where: { id }, select: { code: true, packageId: true } })
  let projectId: string | null = null
  if (bom?.packageId) {
    const pkg = await db.projectPackage.findUnique({ where: { id: bom.packageId }, select: { projectId: true } })
    projectId = pkg?.projectId ?? null
  }
  await writeAudit({
    userId: auth.user.id, action: 'BOM_RELEASE', entity: 'bom', entityId: id,
    projectId,
    detail: { code: bom?.code ?? id, released: res.released },
  })
  return NextResponse.json({ data: { released: res.released } })
}

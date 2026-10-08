// API /api/engineering-rules/[id]/versions — R449 (GitLab issue #8):
// VERZIONIRANJE INŽENIRSKIH PRAVIL.
// GET zgodovina vrednosti enega pravila (projects.read — enaka vrata kot
// GET /api/engineering-rules/[id]) — staro→novo po vrstnem redu nastanka.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const rule = await db.engineeringRule.findUnique({ where: { id }, select: { id: true } })
  if (!rule) return jsonError(404, 'Pravilo ne obstaja.')

  const versions = await db.ruleVersion.findMany({
    where: { ruleId: id },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })
  return NextResponse.json({ data: versions })
}

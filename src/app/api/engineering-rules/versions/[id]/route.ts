// API /api/engineering-rules/versions/[id] — R449 (GitLab issue #8):
// VERZIONIRANJE INŽENIRSKIH PRAVIL.
// GET podrobnost verzije pravila (projects.read — enaka vrata kot branje
// pravil) — staro→novo (oldValue/newValue JSON), kdo/kdaj.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const version = await db.ruleVersion.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, role: true } },
      rule: { select: { id: true, key: true, label: true, unit: true, active: true } },
    },
  })
  if (!version) return jsonError(404, 'Verzija pravila ne obstaja.')
  return NextResponse.json({ data: version })
}

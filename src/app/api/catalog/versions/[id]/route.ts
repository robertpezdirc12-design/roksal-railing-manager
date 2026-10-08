// API /api/catalog/versions/[id] — R449 (GitLab issue #8): VERZIONIRANJE KATALOGA.
// GET podrobnost verzije (catalog.read) — celoten posnetek (data: before/after/
// profile), kdo/kdaj + osnovni podatki profila.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'catalog.read')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const version = await db.catalogVersion.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, role: true } },
      profile: { select: { id: true, sku: true, name: true, material: true, type: true, active: true } },
    },
  })
  if (!version) return jsonError(404, 'Verzija kataloga ne obstaja.')
  return NextResponse.json({ data: version })
}

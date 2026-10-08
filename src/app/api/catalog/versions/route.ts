// API /api/catalog/versions — R449 (GitLab issue #8): VERZIONIRANJE KATALOGA.
// GET seznam verzij profilov (catalog.read) — ?limit= (privzeto 50, max 200),
// ?profileId= filter, najnovejše najprej; vsaka vrstica nosi kdo/kdaj +
// osnovne podatke profila (podroben posnetek staro→novo je na podrobnosti).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'catalog.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200)
  const profileId = url.searchParams.get('profileId')

  const versions = await db.catalogVersion.findMany({
    where: profileId ? { profileId } : {},
    include: {
      user: { select: { name: true } },
      profile: { select: { id: true, sku: true, name: true, material: true, type: true, active: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const total = await db.catalogVersion.count({ where: profileId ? { profileId } : {} })
  return NextResponse.json({ data: versions, meta: { total, limit } })
}

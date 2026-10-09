// /api/production/[id]/elements — seznam prefab elementov naloga (R465 — issue #4 §3)
// GET (production.read) → elementi (proizvodni lističi iz AS-PRODUCED dvojčka)
//   + povzetek napredka + vir (snapshot verzija). Read-only pogled tekmice.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { prefabProgress, PREFAB_VERSION } from '@/lib/prefab-core'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'production.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const order = await db.productionOrder.findUnique({
    where: { id },
    select: { id: true, code: true, title: true, status: true, projectId: true },
  })
  if (!order) return jsonError(404, 'Proizvodni nalog ne obstaja.')

  const rows = await db.productionElement.findMany({
    where: { productionOrderId: id },
    orderBy: [{ key: 'asc' }],
    include: { user: { select: { name: true } } },
  })

  // vir: verzija AS-PRODUCED snapshot-a (vsi lističi delijo isti vir)
  const sourceSnapshotId = rows[0]?.sourceSnapshotId ?? null
  let snapshotVersion: number | null = null
  if (sourceSnapshotId) {
    const snap = await db.digitalTwinSnapshot.findUnique({
      where: { id: sourceSnapshotId },
      select: { version: true, kind: true },
    })
    snapshotVersion = snap?.version ?? null
  }

  return NextResponse.json({
    data: {
      order: { id: order.id, code: order.code, title: order.title, status: order.status, projectId: order.projectId },
      sourceSnapshotId,
      snapshotVersion,
      progress: prefabProgress(rows.map((r) => r.status)),
      elements: rows.map((r) => ({
        id: r.id, key: r.key, label: r.label, lengthCm: r.lengthCm, heightCm: r.heightCm,
        posts: r.posts, ral: r.ral, produkt: r.produkt, status: r.status, note: r.note,
        updatedAt: r.updatedAt, user: r.user?.name ?? null,
      })),
      engineVersion: PREFAB_VERSION,
    },
  })
}

// /api/measurements/[id]/verzije — zgodovina verzij meritve (issue #1)
// GET (measurements.read) → posnetki po verzijah (kdo/kdaj/kaj) naraščajoče.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const measurement = await db.measurement.findUnique({ where: { id }, select: { id: true } })
  if (!measurement) return jsonError(404, 'Meritev ne obstaja.')

  const versions = await db.measurementVersion.findMany({
    where: { measurementId: id },
    include: { user: { select: { name: true } } },
    orderBy: { version: 'asc' },
  })
  return NextResponse.json({ data: versions })
}

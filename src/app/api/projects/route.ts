import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const q = url.searchParams.get('q')

  const projects = await db.project.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { code: { contains: q } }, { customer: { name: { contains: q } } }] } : {}),
    },
    include: {
      customer: { select: { name: true, city: true } },
      _count: { select: { workOrders: true, quotes: true, measurements: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ data: projects })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) return jsonError(400, 'Naslov projekta je obvezen.')

  const year = new Date().getFullYear()
  const count = await db.project.count()
  const code = `P-${year}-${String(count + 1).padStart(3, '0')}`

  const project = await db.project.create({
    data: {
      code,
      title,
      status: typeof body?.status === 'string' ? body.status : 'NACRT',
      customerId: typeof body?.customerId === 'string' && body.customerId ? body.customerId : null,
      address: typeof body?.address === 'string' ? body.address : null,
      note: typeof body?.note === 'string' ? body.note : null,
    },
    include: { customer: { select: { name: true, city: true } } },
  })
  return NextResponse.json({ data: project }, { status: 201 })
}

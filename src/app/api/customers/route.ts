// API /api/customers — seznam (customers.read) + ustvarjanje (customers.write)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'customers.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500)

  const customers = await db.customer.findMany({
    where: q ? {
      OR: [
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { city: { contains: q } },
        { taxId: { contains: q } },
      ],
    } : {},
    include: { _count: { select: { projects: true, quotes: true } } },
    orderBy: { name: 'asc' },
    take: limit,
  })
  return NextResponse.json({ data: customers })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'customers.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return jsonError(400, 'Ime stranke je obvezno.')

  const customer = await db.customer.create({
    data: {
      name,
      email: typeof body?.email === 'string' && body.email.trim() ? body.email.trim() : null,
      phone: typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
      address: typeof body?.address === 'string' && body.address.trim() ? body.address.trim() : null,
      city: typeof body?.city === 'string' && body.city.trim() ? body.city.trim() : null,
      taxId: typeof body?.taxId === 'string' && body.taxId.trim() ? body.taxId.trim() : null,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
    },
    include: { _count: { select: { projects: true, quotes: true } } },
  })

  await writeAudit({
    userId: auth.user.id, action: 'CUSTOMER_CREATE', entity: 'customer', entityId: customer.id,
    detail: { name: customer.name },
  })
  return NextResponse.json({ data: customer }, { status: 201 })
}

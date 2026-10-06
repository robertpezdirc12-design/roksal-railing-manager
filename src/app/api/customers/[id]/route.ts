// API /api/customers/[id] — podrobnost s projekti/ponudbami + urejanje (customers.write)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'customers.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      projects: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, code: true, title: true, status: true, address: true, createdAt: true },
      },
      quotes: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, code: true, status: true, total: true, createdAt: true },
      },
      _count: { select: { projects: true, quotes: true, leads: true } },
    },
  })
  if (!customer) return jsonError(404, 'Stranka ne obstaja.')
  return NextResponse.json({ data: customer })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'customers.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const existing = await db.customer.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Stranka ne obstaja.')

  const patch: Record<string, unknown> = {}
  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name) return jsonError(400, 'Ime stranke ne sme biti prazno.')
    patch.name = name
  }
  for (const key of ['email', 'phone', 'address', 'city', 'taxId', 'note'] as const) {
    if (typeof body?.[key] === 'string') patch[key] = body[key].trim() || null
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  const updated = await db.customer.update({
    where: { id },
    data: patch,
    include: { _count: { select: { projects: true, quotes: true } } },
  })
  await writeAudit({
    userId: auth.user.id, action: 'CUSTOMER_UPDATE', entity: 'customer', entityId: id,
    detail: patch as Record<string, unknown>,
  })
  return NextResponse.json({ data: updated })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// GET /api/suppliers — seznam dobaviteljev (inventory.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'inventory.read')
  if (auth instanceof NextResponse) return auth

  const suppliers = await db.supplier.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json({ data: suppliers })
}

// POST /api/suppliers — nov dobavitelj (procurement.receive)
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'procurement.receive')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return jsonError(400, 'Ime dobavitelja je obvezno.')

  const supplier = await db.supplier.create({
    data: {
      name,
      email: typeof body?.email === 'string' && body.email.trim() ? body.email.trim() : null,
      phone: typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'SUPPLIER_CREATE', entity: 'supplier', entityId: supplier.id,
    detail: { name },
  })
  return NextResponse.json({ data: supplier }, { status: 201 })
}

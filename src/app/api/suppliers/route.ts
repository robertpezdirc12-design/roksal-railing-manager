import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// ime obvezno po trim; kontakti neobvezni (prazno ⇒ null, kot prej).
const SupplierCreateSchema = z.object({
  name: z.string().trim().min(1, 'Ime dobavitelja je obvezno.'),
  email: z.string().trim().nullish().transform((v) => v || null),
  phone: z.string().trim().nullish().transform((v) => v || null),
  note: z.string().trim().nullish().transform((v) => v || null),
})

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

  const parsed = await parseBody(req, SupplierCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  const supplier = await db.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        note: data.note,
      },
    })

    await writeAudit({
      userId: auth.user.id, action: 'SUPPLIER_CREATE', entity: 'supplier', entityId: supplier.id,
      detail: { name: data.name },
    }, tx)
    return supplier
  })
  return NextResponse.json({ data: supplier }, { status: 201 })
}

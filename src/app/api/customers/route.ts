// API /api/customers — seznam (customers.read) + ustvarjanje (customers.write)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

// R536: zod shema za ustvarjanje stranke — zrcali prejšnjo ročno validacijo:
// ime obvezno (neprazno po trim), ostali kontakti neobvezni (prazno ⇒ null).
const optionalContact = z.string().trim().nullish().transform((v) => v || null)
const CustomerCreateSchema = z.object({
  name: z.string().trim().min(1, 'Ime stranke je obvezen.'),
  email: optionalContact,
  phone: optionalContact,
  address: optionalContact,
  city: optionalContact,
  taxId: optionalContact,
  note: optionalContact,
})

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'customers.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500)

  const customers = await db.customer.findMany({
    where: q ? {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { taxId: { contains: q, mode: 'insensitive' } },
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

  const parsed = await parseBody(req, CustomerCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const customer = await db.customer.create({
    data: {
      name: data.name,
      email: data.email,
      phone: data.phone,
      address: data.address,
      city: data.city,
      taxId: data.taxId,
      note: data.note,
    },
    include: { _count: { select: { projects: true, quotes: true } } },
  })

  await writeAudit({
    userId: auth.user.id, action: 'CUSTOMER_CREATE', entity: 'customer', entityId: customer.id,
    detail: { name: customer.name },
  })
  return NextResponse.json({ data: customer }, { status: 201 })
}

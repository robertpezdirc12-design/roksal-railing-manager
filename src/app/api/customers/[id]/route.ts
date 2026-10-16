// API /api/customers/[id] — podrobnost s projekti/ponudbami + urejanje (customers.write)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

type Params = { params: Promise<{ id: string }> }

// R536: zod shema za urejanje stranke — vsa polja neobvezna (delni PATCH):
// ime (če je podano) neprazno po trim; kontakti se prazni ⇒ null.
const CustomerPatchSchema = z.object({
  name: z.string().trim().min(1, 'Ime stranke ne sme biti prazno.').optional(),
  email: z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null)),
  phone: z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null)),
  address: z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null)),
  city: z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null)),
  taxId: z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null)),
  note: z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null)),
})

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

  const parsed = await parseBody(req, CustomerPatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data
  const existing = await db.customer.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Stranka ne obstaja.')

  const patch: Record<string, unknown> = {}
  if (data.name !== undefined) patch.name = data.name
  for (const key of ['email', 'phone', 'address', 'city', 'taxId', 'note'] as const) {
    if (data[key] !== undefined) patch[key] = data[key]
  }
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  // R537 (transakcijska celovitost): posodobitev + revizija v ENI transakciji.
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.customer.update({
      where: { id },
      data: patch,
      include: { _count: { select: { projects: true, quotes: true } } },
    })
    await writeAudit({
      userId: auth.user.id, action: 'CUSTOMER_UPDATE', entity: 'customer', entityId: id,
      detail: patch as Record<string, unknown>,
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

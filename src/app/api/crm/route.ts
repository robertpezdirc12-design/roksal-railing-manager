import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

const SOURCES = ['SPLET', 'TELEFON', 'PRIPOROČILO', 'SEJEM']

// GET /api/crm — vodi in priložnosti skupaj (crm.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'crm.read')
  if (auth instanceof NextResponse) return auth

  const [leads, opportunities] = await Promise.all([
    db.lead.findMany({
      include: { opportunities: { select: { id: true, title: true, stage: true, value: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.opportunity.findMany({
      include: { lead: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  return NextResponse.json({ data: { leads, opportunities } })
}

// POST /api/crm — nov lead {name, email, phone, source, note} (crm.write)
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'crm.write')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return jsonError(400, 'Ime kontakta je obvezno.')

  const source = typeof body?.source === 'string' && SOURCES.includes(body.source) ? body.source : 'SPLET'

  const lead = await db.lead.create({
    data: {
      name,
      email: typeof body?.email === 'string' && body.email.trim() ? body.email.trim() : null,
      phone: typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
      source,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null,
    },
  })

  await writeAudit({
    userId: auth.user.id, action: 'LEAD_CREATE', entity: 'lead', entityId: lead.id,
    detail: { name, source },
  })
  return NextResponse.json({ data: lead }, { status: 201 })
}

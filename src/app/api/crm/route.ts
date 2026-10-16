import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

const SOURCES = ['SPLET', 'TELEFON', 'PRIPOROČILO', 'SEJEM', 'VIZUALIZATOR']

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// ime obvezno po trim; kontakti neobvezni (prazno ⇒ null, kot prej); vir neveljaven
// ali manjkajoč ⇒ privzet SPLET (kot prej — brez novega enuma).
const LeadCreateSchema = z.object({
  name: z.string().trim().min(1, 'Ime kontakta je obvezno.'),
  email: z.string().trim().nullish().transform((v) => v || null),
  phone: z.string().trim().nullish().transform((v) => v || null),
  source: z.string().nullish().transform((v) => (v && SOURCES.includes(v) ? v : 'SPLET')),
  note: z.string().trim().nullish().transform((v) => v || null),
})

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

  const parsed = await parseBody(req, LeadCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  const lead = await db.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        source: data.source,
        note: data.note,
      },
    })

    await writeAudit({
      userId: auth.user.id, action: 'LEAD_CREATE', entity: 'lead', entityId: lead.id,
      detail: { name: data.name, source: data.source },
    }, tx)
    return lead
  })
  return NextResponse.json({ data: lead }, { status: 201 })
}

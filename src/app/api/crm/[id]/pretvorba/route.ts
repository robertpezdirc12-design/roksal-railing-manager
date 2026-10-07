// /api/crm/[id]/pretvorba — PRETVORBA VODA V PROJEKT (issue #1: celoten workflow
// pisarna → monter → teren; korak 1–2: nova strankina zahteva → odprtje projekta)
// POST { title?, address? } (crm.write) → ustvari stranko (če je ni) + projekt,
// vod dobi status PRETVORJEN; revizija LEAD_CONVERT + PROJECT_CREATE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'crm.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const body = await req.json().catch(() => null)

  const lead = await db.lead.findUnique({ where: { id }, include: { customer: true } })
  if (!lead) return jsonError(404, 'Vod ne obstaja.')
  if (lead.status === 'PRETVORJEN') {
    return jsonError(409, 'Vod je že pretvorjen v projekt.', 'Vsak vod se pretvori samo enkrat.')
  }
  if (lead.status === 'IZGUBLJEN') {
    return jsonError(409, 'Izgubljenega voda ni mogoče pretvoriti.')
  }

  // stranka: obstoječa ali nova iz podatkov voda (issue #1: nova strankina zahteva)
  let customerId = lead.customerId
  if (!customerId) {
    const customer = await db.customer.create({
      data: {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        note: `Iz voda (vir: ${lead.source})${lead.note ? ` — ${lead.note}` : ''}`,
      },
    })
    customerId = customer.id
  }

  const year = new Date().getFullYear()
  const count = await db.project.count()
  const code = `P-${year}-${String(count + 1).padStart(3, '0')}`

  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : `Ograja — ${lead.name}`
  const address = typeof body?.address === 'string' && body.address.trim() ? body.address.trim() : null

  const project = await db.project.create({
    data: {
      code,
      title,
      customerId,
      address,
      status: 'NACRT',
      note: `Projekt odprt iz voda (${lead.source})${lead.note ? `: ${lead.note}` : ''}`,
    },
    include: { customer: { select: { name: true } } },
  })

  await db.lead.update({ where: { id }, data: { status: 'PRETVORJEN', customerId } })

  await writeAudit({
    userId: user.id,
    action: 'LEAD_CONVERT',
    entity: 'lead',
    entityId: id,
    projectId: project.id,
    detail: { leadName: lead.name, projectCode: code, customerId, title },
  })

  return NextResponse.json(
    { data: { project, leadStatus: 'PRETVORJEN' } },
    { status: 201 }
  )
}

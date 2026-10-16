// /api/crm/[id]/pretvorba — PRETVORBA VODA V PROJEKT (issue #1: celoten workflow
// pisarna → monter → teren; korak 1–2: nova strankina zahteva → odprtje projekta)
// POST { title?, address? } (crm.write) → ustvari stranko (če je ni) + projekt,
// vod dobi status PRETVORJEN; revizija LEAD_CONVERT + PROJECT_CREATE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { nextCodeFromList } from '@/lib/codes'
import { writeAudit } from '@/lib/audit'
import { retryOnUnique } from '@/lib/versioning'

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

  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : `Ograja — ${lead.name}`
  const address = typeof body?.address === 'string' && body.address.trim() ? body.address.trim() : null

  // R538: transakcijska celovitost — stranka + projekt + vod + revizija atomarno
  // (vzorec R537-d). Koda P- se računa ZNOTRAJ transakcije na tx klientu
  // (vzorec R535); ob sočasnem P2002 (dve pretvobi izračunata isto kodo)
  // retryOnUnique okoli CELE transakcije ponovi z novo kodo.
  const project = await retryOnUnique(() => db.$transaction(async (tx) => {
    // stranka: obstoječa ali nova iz podatkov voda (issue #1: nova strankina zahteva)
    let customerId = lead.customerId
    if (!customerId) {
      const customer = await tx.customer.create({
        data: {
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          note: `Iz voda (vir: ${lead.source})${lead.note ? ` — ${lead.note}` : ''}`,
        },
      })
      customerId = customer.id
    }

    // R439: koda glede na zasedene (count pade ob brisanju → unikatnost ni zagotovljena)
    const existingCodes = await tx.project.findMany({ where: { code: { startsWith: 'P-' } }, select: { code: true } })
    const code = nextCodeFromList(existingCodes.map((p) => p.code), 'P-')

    const project = await tx.project.create({
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

    await tx.lead.update({ where: { id }, data: { status: 'PRETVORJEN', customerId } })

    await writeAudit({
      userId: user.id,
      action: 'LEAD_CONVERT',
      entity: 'lead',
      entityId: id,
      projectId: project.id,
      detail: { leadName: lead.name, projectCode: code, customerId, title },
    }, tx)

    return project
  }), 3)

  return NextResponse.json(
    { data: { project, leadStatus: 'PRETVORJEN' } },
    { status: 201 }
  )
}

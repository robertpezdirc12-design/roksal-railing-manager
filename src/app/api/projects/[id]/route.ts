import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { deliverEvent, recordEvent, type RecordedEvent } from '@/lib/notify'
import { parseBody } from '@/lib/validate'

type Params = { params: Promise<{ id: string }> }

// R536: zod shema za urejanje projekta — delni PATCH: vsa polja neobvezna;
// nizi se (kot prej) ne stiskajo; customerId sprejme tudi null (počisti).
const ProjectPatchSchema = z.object({
  title: z.string().optional(),
  status: z.string().optional(),
  address: z.string().optional(),
  note: z.string().optional(),
  customerId: z.string().nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
})

/** Obseg (issue #1): monter dostopa samo do projektov svojih nalogov. */
async function projectInScope (userId: string, id: string): Promise<'missing' | boolean> {
  const p = await db.project.findUnique({
    where: { id },
    select: { id: true, workOrders: { select: { assigneeId: true } } },
  })
  if (!p) return 'missing'
  return p.workOrders.some((w) => w.assigneeId === userId)
}

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  if (!readsAllData(user)) {
    const inScope = await projectInScope(user.id, id)
    if (inScope === 'missing') return jsonError(404, 'Projekt ne obstaja.')
    if (!inScope) return jsonError(403, 'Projekt ni v vašem obsegu.', 'Monter vidi samo projekte svojih nalogov.')
  }

  const project = await db.project.findUnique({
    where: { id },
    include: {
      customer: true,
      quotes: { include: { _count: { select: { lines: true } } }, orderBy: { createdAt: 'desc' } },
      workOrders: { include: { assignee: { select: { name: true } } }, orderBy: { scheduledFor: 'asc' } },
      measurements: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      invoices: { orderBy: { createdAt: 'desc' } },
      productionOrders: { orderBy: { dueAt: 'asc' } },
    },
  })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')
  return NextResponse.json({ data: project })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const parsed = await parseBody(req, ProjectPatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data
  const existing = await db.project.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Projekt ne obstaja.')

  // obseg (issue #1): monter popravlja samo projekte svojih nalogov
  if (!readsAllData(auth.user)) {
    const inScope = await projectInScope(auth.user.id, id)
    if (!inScope) return jsonError(403, 'Projekt ni v vašem obsegu.', 'Monter popravlja samo projekte svojih nalogov.')
  }

  const patch: Record<string, unknown> = {}
  for (const key of ['title', 'status', 'address', 'note'] as const) {
    if (data[key] !== undefined) patch[key] = data[key]
  }
  if (data.customerId !== undefined) patch.customerId = data.customerId
  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  // R537 (transakcijska celovitost): posodobitev + revizija + zapis statusnega
  // obvestila (outbox) v ENI transakciji — padec srednjega koraka NE pusti
  // spremembe statusa brez revizije/dogodka. Dostava (stranka EMAIL + webhook
  // HTTP) teče PO commitu (deliverEvent, ognjevarna).
  const { updated, recorded } = await db.$transaction(async (tx) => {
    const updated = await tx.project.update({ where: { id }, data: patch, include: { customer: { select: { name: true } } } })
    await writeAudit({
      userId: auth.user.id, action: 'PROJECT_UPDATE', entity: 'project', entityId: id, projectId: id,
      detail: patch as Record<string, unknown>,
    }, tx)

    // R438 (issue #5): sprememba statusa → statusno obvestilo stranki (zunanji kanal EMAIL)
    let recorded: RecordedEvent | null = null
    if (typeof patch.status === 'string' && patch.status !== existing.status) {
      const customer = updated.customerId
        ? await tx.customer.findUnique({ where: { id: updated.customerId }, select: { name: true, email: true } })
        : null
      recorded = await recordEvent({
        type: 'PROJECT_STATUS',
        key: `project-status:${id}:${existing.status}:${patch.status}:${Date.now()}`,
        title: `Status projekta ${existing.code}`,
        body: `Status projekta ${existing.code} je spremenjen: ${existing.status} → ${patch.status}`,
        projectId: id,
        customerEmail: customer?.email ?? null,
        customerName: customer?.name ?? null,
      }, tx)
    }
    return { updated, recorded }
  })

  // dostava obvestila PO uspešnem commitu (ognjevarna — nikoli ne vrže napake)
  if (recorded) await deliverEvent(recorded)
  return NextResponse.json({ data: updated })
}

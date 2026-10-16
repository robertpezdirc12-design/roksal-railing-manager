import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, managesAssignments, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent, fmtTermin } from '@/lib/notify'
import { nextCodeFromList } from '@/lib/codes'
import { parseBody } from '@/lib/validate'

// R536: zod shema za nov nalog — naslov obvezen; dodelitev/projekt/termin/navodila
// neobvezni (null ⇒ brez, kot prej); termin sprejme karkoli resničnega in prevzame
// v Date (neveljaven datum ⇒ 400 namesto strežniške napake prej).
const WorkOrderCreateSchema = z.object({
  title: z.string().trim().min(1, 'Naslov naloga je obvezen.'),
  assigneeId: z.string().nullish().transform((v) => v || null),
  projectId: z.string().nullish().transform((v) => v || null),
  scheduledFor: z.preprocess((v) => (v ? v : undefined), z.coerce.date().optional()),
  instructions: z.string().trim().nullish().transform((v) => v || null),
})

// GET /api/nalog?scope=today|open|mine|all — MONTER vedno vidi SAMO svoje naloge (issue #1)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') ?? 'all'
  const status = url.searchParams.get('status')
  const projectId = url.searchParams.get('projectId')

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 86400000)

  const where: Record<string, unknown> = {
    ...(status ? { status } : {}),
    ...(projectId ? { projectId } : {}),
  }
  // obseg (issue #1): monter vidi SAMO svoje naloge — neodvisno od scope (fail-closed)
  if (!readsAllData(user)) where.assigneeId = user.id
  if (scope === 'today') where.scheduledFor = { gte: today, lt: tomorrow }
  if (scope === 'mine') where.assigneeId = user.id
  if (scope === 'open') where.status = { not: 'ZAKLJUCEN' }

  const orders = await db.workOrder.findMany({
    where,
    include: {
      project: { select: { code: true, title: true, address: true, customer: { select: { name: true } } } },
      assignee: { select: { name: true } },
      crew: { select: { name: true, type: true } }, // R445: ekipa/podizvajalec na nalogu
      _count: { select: { measurements: true, events: true } },
    },
    orderBy: [{ scheduledFor: 'asc' }, { code: 'asc' }],
  })
  return NextResponse.json({ data: orders })
}

// POST /api/nalog — nov nalog (nalog.write); dodelitev (assigneeId) samo ADMIN/VODJA
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const parsed = await parseBody(req, WorkOrderCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data
  const assigneeId = data.assigneeId
  const wantsAssignee = assigneeId !== null
  if (wantsAssignee && !managesAssignments(user)) {
    return jsonError(403, 'Dodelitve upravlja samo pisarna.', 'Spreminjanje assigneeId je dovoljeno roli ADMIN in VODJA.')
  }
  if (wantsAssignee) {
    const assignee = await db.user.findUnique({ where: { id: assigneeId }, select: { id: true, active: true } })
    if (!assignee || !assignee.active) return jsonError(400, 'Izbrani monter ne obstaja ali ni aktiven.')
  }

  let projectId: string | null = null
  if (data.projectId) {
    const project = await db.project.findUnique({ where: { id: data.projectId }, select: { id: true } })
    if (!project) return jsonError(400, 'Projekt ne obstaja.')
    projectId = project.id
  }

  const instructions = data.instructions

  // R439: koda glede na zasedene (count pade ob brisanju → unikatnost ni zagotovljena)
  const existingCodes = await db.workOrder.findMany({ where: { code: { startsWith: 'N-' } }, select: { code: true } })
  const code = nextCodeFromList(existingCodes.map((w) => w.code), 'N-')

  const order = await db.workOrder.create({
    data: {
      code,
      title: data.title,
      projectId,
      assigneeId: wantsAssignee ? assigneeId : null,
      scheduledFor: data.scheduledFor ?? null,
      instructions,
    },
    include: { project: { select: { code: true, title: true } }, assignee: { select: { name: true } } },
  })

  // dogodek DODELJEN (kdo/kdaj/kaj) + revizija — občutljive spremembe ostanejo v auditu (issue #1)
  if (wantsAssignee) {
    await db.workOrderEvent.create({
      data: {
        workOrderId: order.id,
        userId: user.id,
        type: 'DODELJEN',
        note: `Dodelitev: ${order.assignee?.name ?? assigneeId}${instructions ? ` — navodila: ${instructions.slice(0, 120)}` : ''}`,
      },
    })
  }
  await writeAudit({
    userId: user.id,
    action: 'WO_CREATE',
    entity: 'workOrder',
    entityId: order.id,
    projectId,
    detail: { code, title: data.title, assigneeId: wantsAssignee ? assigneeId : null, hasInstructions: !!instructions },
  })

  // R438 (issue #5): monter dobi obvestilo o dodelitvi BREZ ročnega posredovanja —
  // emitEvent je ognjevaren (try/catch znotraj), poslovni tok se nadaljuje neodvisno.
  if (wantsAssignee) {
    await emitEvent({
      type: 'WO_ASSIGNED',
      key: `wo-assign:${order.id}:${assigneeId}:${Date.now()}`,
      title: 'Nov nalog dodeljen',
      body: [
        `${code} — ${data.title}`,
        projectId ? `projekt ${order.project?.code ?? ''}` : null,
        order.scheduledFor ? `termin: ${fmtTermin(order.scheduledFor)}` : null,
        instructions ? `navodila: ${instructions.slice(0, 160)}` : null,
      ].filter(Boolean).join(' · '),
      projectId,
      userIds: [assigneeId as string],
    })
  }
  return NextResponse.json({ data: order }, { status: 201 })
}

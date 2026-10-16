import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, managesAssignments, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { deliverEvent, recordEvent, fmtTermin, type RecordedEvent } from '@/lib/notify'
import { parseBody } from '@/lib/validate'

type Params = { params: Promise<{ id: string }> }

// R536: zod shema za urejanje naloga — delni PATCH (status gre IZKLJUČNO prek
// /transition, termin prek /termin): prazen naslov se tiho preskoči (kot prej),
// instructions/summary sprejemata null (počisti), projectId/assigneeId/crewId
// neobvezni (null ⇒ odvzem vezave) — poslovna vrata ostajajo v handlerju.
const WorkOrderPatchSchema = z.object({
  title: z.string().trim().optional().transform((v) => v || undefined),
  instructions: z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null)),
  summary: z.string().trim().nullish().transform((v) => (v === undefined ? undefined : v || null)),
  projectId: z.string().nullish().transform((v) => v || null),
  assigneeId: z.string().nullable().optional(),
  crewId: z.string().nullable().optional(),
})

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params
  const order = await db.workOrder.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, code: true, title: true, address: true, customer: { select: { name: true } } } },
      assignee: { select: { id: true, name: true } },
      crew: { select: { id: true, name: true, type: true } }, // R445: ekipa na nalogu
      events: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      measurements: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!order) return jsonError(404, 'Nalog ne obstaja.')
  // obseg (issue #1): monter vidi podrobnosti SAMO svojih nalogov
  if (!readsAllData(user) && order.assigneeId !== user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Monter vidi samo svoje naloge; dodelitve upravlja pisarna.')
  }
  return NextResponse.json({ data: order })
}

// PATCH /api/nalog/[id] — urejanje naloga (R438, route-map izvirnika):
// title, instructions, projectId, summary; assigneeId (samo ADMIN/VODJA);
// crewId (R445: ekipa/podizvajalec — issue #7 §9; null počisti, sicer mora obstajati).
// Status gre IZKLJUČNO prek /transition, termin prek /termin (časovnica + revizija).
// Ob spremembi dodelitve → obvestilo WO_ASSIGNED (monter, brez ročnega posredovanja);
// ob spremembi navodil → WO_INSTRUCTIONS (monter). Oba emitEvent klica sta ognjevarna.
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const parsed = await parseBody(req, WorkOrderPatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const order = await db.workOrder.findUnique({
    where: { id },
    include: { project: { select: { id: true, code: true } } },
  })
  if (!order) return jsonError(404, 'Nalog ne obstaja.')
  // obseg (issue #1): monter ureja samo svoj nalog
  if (!readsAllData(user) && order.assigneeId !== user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Monter ureja samo svoje naloge.')
  }

  const patch: Record<string, unknown> = {}
  if (data.title !== undefined) patch.title = data.title
  if (data.instructions !== undefined) patch.instructions = data.instructions
  if (data.summary !== undefined) patch.summary = data.summary
  if (data.projectId) {
    const project = await db.project.findUnique({ where: { id: data.projectId }, select: { id: true } })
    if (!project) return jsonError(400, 'Projekt ne obstaja.')
    patch.projectId = project.id
  }

  // dodelitev (assigneeId): samo ADMIN/VODJA — enaka vrata kot POST (issue #1)
  let assigneeChanged = false
  if (data.assigneeId !== undefined) {
    if (!managesAssignments(user)) {
      return jsonError(403, 'Dodelitve upravlja samo pisarna.', 'Spreminjanje assigneeId je dovoljeno roli ADMIN in VODJA.')
    }
    const newId = data.assigneeId || null
    if (newId) {
      const assignee = await db.user.findUnique({ where: { id: newId }, select: { id: true, active: true, name: true } })
      if (!assignee || !assignee.active) return jsonError(400, 'Izbrani monter ne obstaja ali ni aktiven.')
      assigneeChanged = newId !== order.assigneeId
      if (assigneeChanged) patch.assigneeId = newId
    } else if (order.assigneeId !== null) {
      assigneeChanged = true
      patch.assigneeId = null // odvzem dodelitve
    }
  }

  // ekipa/podizvajalec (R445, issue #7 §9): null počisti, sicer mora ekipa obstajati in biti aktivna.
  // VRATA: managesAssignments (ADMIN/VODJA) — enako kot assigneeId; monter sicer ima
  // nalog.write za svoj nalog, a dodeljevanje ekip/podizvajalcev je delo pisarne (fail-closed).
  let crewChanged = false
  if (data.crewId !== undefined) {
    if (!managesAssignments(user)) {
      return jsonError(403, 'Dodelitve ekip upravlja samo pisarna.', 'Spreminjanje crewId je dovoljeno roli ADMIN in VODJA.')
    }
    const newCrewId = data.crewId || null
    if (newCrewId) {
      const crew = await db.crew.findUnique({ where: { id: newCrewId }, select: { id: true, active: true, name: true } })
      if (!crew || !crew.active) return jsonError(400, 'Izbrana ekipa ne obstaja ali ni aktivna.')
    }
    if (newCrewId !== order.crewId) {
      crewChanged = true
      patch.crewId = newCrewId
    }
  }

  if (Object.keys(patch).length === 0) return jsonError(400, 'Ni sprememb za izvedbo.')

  const instructionsChanged = 'instructions' in patch && patch.instructions !== order.instructions
  // R537 (transakcijska celovitost): posodobitev + dogodek DODELJEN + reviziji
  // (WO_UPDATE, morebiti WO_CREW_ASSIGN) + zapis obvestil (outbox) v ENI
  // transakciji — padec srednjega koraka NE pusti spremembe brez revizije/dogodka.
  // Dostava obvestil (IN_APP/EMAIL/webhook HTTP) teče PO commitu (deliverEvent).
  const { updated, dogodki } = await db.$transaction(async (tx) => {
    const updated = await tx.workOrder.update({
      where: { id },
      data: patch,
      include: { project: { select: { code: true } }, assignee: { select: { name: true } }, crew: { select: { name: true, type: true } } },
    })

    if (assigneeChanged && patch.assigneeId) {
      await tx.workOrderEvent.create({
        data: {
          workOrderId: id, userId: user.id, type: 'DODELJEN',
          note: `Dodelitev: ${updated.assignee?.name ?? String(patch.assigneeId)}`,
        },
      })
    }
    await writeAudit({
      userId: user.id, action: 'WO_UPDATE', entity: 'workOrder', entityId: id, projectId: updated.projectId ?? order.projectId,
      detail: { code: order.code, polja: Object.keys(patch) },
    }, tx)

    // R445 (issue #7 §9): sprememba ekipe na nalogu — lastna revizija WO_CREW_ASSIGN
    if (crewChanged) {
      await writeAudit({
        userId: user.id, action: 'WO_CREW_ASSIGN', entity: 'workOrder', entityId: id, projectId: updated.projectId ?? order.projectId,
        detail: { code: order.code, crewId: patch.crewId ?? null, prej: order.crewId ?? null, ekipa: updated.crew?.name ?? null },
      }, tx)
    }

    // R438 (issue #5): obvestili — ZAPIS dogodkov v isti tx (outbox, ognjevarena
    // dostava PO commitu), ki ne motita odgovora ruta
    const dogodki: RecordedEvent[] = []
    if (assigneeChanged && patch.assigneeId) {
      const rec = await recordEvent({
        type: 'WO_ASSIGNED',
        key: `wo-assign:${id}:${String(patch.assigneeId)}:${Date.now()}`,
        title: 'Nov nalog dodeljen',
        body: [
          `${updated.code} — ${updated.title}`,
          updated.project ? `projekt ${updated.project.code}` : null,
          updated.scheduledFor ? `termin: ${fmtTermin(updated.scheduledFor)}` : null,
          updated.instructions ? `navodila: ${updated.instructions.slice(0, 160)}` : null,
        ].filter(Boolean).join(' · '),
        projectId: updated.projectId ?? null,
        userIds: [String(patch.assigneeId)],
      }, tx)
      if (rec) dogodki.push(rec)
    }
    if (instructionsChanged && updated.assigneeId) {
      const rec = await recordEvent({
        type: 'WO_INSTRUCTIONS',
        key: `wo-instructions:${id}:${Date.now()}`,
        title: 'Nova navodila za nalog',
        body: `${updated.code} — ${updated.title}: ${updated.instructions ?? ''}`.slice(0, 300),
        projectId: updated.projectId ?? null,
        userIds: [updated.assigneeId],
      }, tx)
      if (rec) dogodki.push(rec)
    }
    return { updated, dogodki }
  })

  // dostava obvestil PO uspešnem commitu (ognjevarna — nikoli ne vrže napake)
  for (const dogodek of dogodki) await deliverEvent(dogodek)

  return NextResponse.json({ data: updated })
}

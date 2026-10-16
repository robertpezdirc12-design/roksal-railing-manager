// /api/nalog/[id]/transition — TERENSKI TOK (R429 §7, VERBATIM):
//   NAPROGRAMIRAN → V_TEKU   (ZAČNI DELO)
//   V_TEKU        → V_ZAJEMU (ZAJEM)
//   V_ZAJEMU      → V_PREVERI (PREVERI)
//   V_PREVERI     → ZAKLJUCEN (ZAKLJUČI TEREN)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, managesAssignments, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { deliverEvent, recordEvent } from '@/lib/notify'
import { preveriBlokadoZakljucka } from '@/lib/montaza-qa-core'

type Params = { params: Promise<{ id: string }> }

const FLOW: Record<string, { next: string; event: string; label: string }[]> = {
  NAPROGRAMIRAN: [{ next: 'V_TEKU', event: 'ZACETEK', label: 'ZAČNI DELO' }],
  V_TEKU: [
    { next: 'V_ZAJEMU', event: 'ZAJEM', label: 'ZAJEM' },
    { next: 'V_PREVERI', event: 'PREVERITEV', label: 'PREVERI' },
  ],
  V_ZAJEMU: [
    { next: 'V_PREVERI', event: 'PREVERITEV', label: 'PREVERI' },
  ],
  V_PREVERI: [
    { next: 'ZAKLJUCEN', event: 'ZAKLJUCEK', label: 'ZAKLJUČI TEREN' },
  ],
}

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.transition')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await req.json().catch(() => null)
  const to = typeof body?.to === 'string' ? body.to : ''
  const note = typeof body?.note === 'string' ? body.note : null
  const force = body?.force === true
  const forceReason = typeof body?.forceReason === 'string' && body.forceReason.trim() ? body.forceReason.trim().slice(0, 300) : null

  const order = await db.workOrder.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, code: true, customer: { select: { name: true, email: true } } } },
      assignee: { select: { id: true } },
    },
  })
  if (!order) return jsonError(404, 'Nalog ne obstaja.')
  // obseg (issue #1): monter lahko prestavlja SAMO svoj nalog
  if (!readsAllData(auth.user) && order.assignee?.id !== auth.user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Terenski tok izvajate na svojih nalogih.')
  }

  const allowed = FLOW[order.status] ?? []
  const step = allowed.find((s) => s.next === to)
  if (!step) {
    return jsonError(
      400,
      `Prehod ${order.status} → ${to || '?'} ni dovoljen.`,
      `Dovoljeni prehodi: ${allowed.map((s) => `${order.status} → ${s.next} (${s.label})`).join('; ') || '—'}`
    )
  }

  // R489 (issue #12 §2C): kritična nerešena napaka BLOKIRA zaključek terena —
  // izvzem samo z izrecnim odobrenjem vodstva (force + razlog, revizija).
  // R537: izvzemna revizija se zapiše V transakciji (skupaj s prehodom) —
  // prej bi ob padcu prehoda ostal samoten override zapis.
  let overrideZapis = false
  let blokadaRazlogi: string[] = []
  if (to === 'ZAKLJUCEN') {
    const blokada = await preveriBlokadoZakljucka(id)
    if (blokada.blokira) {
      if (!force || !managesAssignments(auth.user)) {
        return jsonError(
          409,
          'Zaključek terena je blokiran: nerešene kritične zadeve.',
          blokada.razlogi.join(' ') + (managesAssignments(auth.user) ? ' Izvzem je možen samo z force + razlogom (vodstvo).' : '')
        )
      }
      if (!forceReason) {
        return jsonError(400, 'Izvzem blokade zahteva razlog (forceReason).', 'Razlog se zapiše v revizijsko sled.')
      }
      overrideZapis = true
      blokadaRazlogi = blokada.razlogi
    }
  }

  const now = new Date()
  // R537 (transakcijska celovitost): prehod statusa + dogodek + revizija
  // (+ morebitna izvzemna revizija WO_ZAKLJUCEK_OVERRIDE) + zapis obvestila
  // (outbox) v ENI transakciji — padec srednjega koraka NE pusti prehoda brez
  // revizije/dogodka. Dostava (OFFICE IN_APP + stranka EMAIL + webhook HTTP)
  // teče PO commitu (deliverEvent, ognjevarna).
  const { updated, recorded } = await db.$transaction(async (tx) => {
    if (overrideZapis) {
      await writeAudit({
        userId: auth.user.id,
        action: 'WO_ZAKLJUCEK_OVERRIDE',
        entity: 'workOrder',
        entityId: id,
        projectId: order.project?.id ?? null,
        detail: { code: order.code, razlog: forceReason, blokirajoce: blokadaRazlogi },
      }, tx)
    }

    const updated = await tx.workOrder.update({
      where: { id },
      data: {
        status: step.next,
        startedAt: step.event === 'ZACETEK' ? now : order.startedAt,
        completedAt: step.event === 'ZAKLJUCEK' ? now : order.completedAt,
        summary: step.event === 'ZAKLJUCEK' && note ? note : order.summary,
      },
    })
    await tx.workOrderEvent.create({
      data: { workOrderId: id, userId: auth.user.id, type: step.event, note: note ?? step.label },
    })
    await writeAudit({
      userId: auth.user.id,
      action: 'WO_TRANSITION',
      entity: 'workOrder',
      entityId: id,
      projectId: order.project?.id ?? null,
      detail: { from: order.status, to: step.next, label: step.label, code: order.code },
    }, tx)

    // R438 (issue #5): zaključek terena → pisarna (OFFICE) + stranka (EMAIL) —
    // dedup po ključu wo-completed:<id> (ponovni zaključek istega naloga ni mogoč).
    const recorded = step.next === 'ZAKLJUCEN'
      ? await recordEvent({
        type: 'WO_COMPLETED',
        key: `wo-completed:${id}`,
        title: 'Zaključek terena',
        body: `Nalog ${order.code} je zaključen${order.project ? ` (projekt ${order.project.code})` : ''}${note ? ` — ${note.slice(0, 160)}` : ''}`,
        projectId: order.project?.id ?? null,
        audience: 'OFFICE',
        customerEmail: order.project?.customer?.email ?? null,
        customerName: order.project?.customer?.name ?? null,
      }, tx)
      : null
    return { updated, recorded }
  })

  // dostava obvestila PO uspešnem commitu (ognjevarna — nikoli ne vrže napake)
  if (recorded) await deliverEvent(recorded)
  return NextResponse.json({ data: updated })
}

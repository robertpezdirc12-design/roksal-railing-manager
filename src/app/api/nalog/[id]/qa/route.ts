// /api/nalog/[id]/qa — R489 (GitHub issue #12 §2B/§3): MONTAŽA QA.
// GET  (nalog.read)  — kontrolne točke + odstopanja + ukrepi + povzetek (obseg: monter svoji)
// POST (nalog.write) — pripravi kontrolne točke IZ VIROV (playbook MONTAZA +
//                      segmenti POTRJENEGA tekača + aktivna inženirska pravila),
//                      snapshot templateVersion; ponovni POST → 409 (ali force,
//                      če je NOBENA točka še neobdelana — brez izgube podatkov).
// Revizija: MONTAZA_TEMPLATE_APPLY.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { obsegNaloga, sestaviPredlogo } from '@/lib/montaza-qa-core'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const scoped = await obsegNaloga(auth.user, id)
  if (scoped.error || !scoped.wo) return jsonError(scoped.conflict ? 403 : 404, scoped.error ?? 'Nalog ne obstaja.')

  const [checks, deviations, handover] = await Promise.all([
    db.montazaCheck.findMany({
      where: { workOrderId: id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        checkedBy: { select: { name: true } },
        deviations: { orderBy: { createdAt: 'desc' }, include: { actions: { include: { assignee: { select: { name: true } } } } } },
      },
    }),
    db.montazaDeviation.findMany({
      where: { workOrderId: id, checkId: null },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { name: true } },
        resolvedBy: { select: { name: true } },
        actions: { include: { assignee: { select: { name: true } } } },
      },
    }),
    db.handoverReport.findFirst({ where: { workOrderId: id }, orderBy: { version: 'desc' } }),
  ])

  const povzetek = {
    skupaj: checks.length,
    vRedu: checks.filter((c) => c.status === 'V_REDU').length,
    napake: checks.filter((c) => c.status === 'NAPAKA').length,
    caka: checks.filter((c) => c.status === 'CAKA_PREVERJANJE').length,
    niRelevantno: checks.filter((c) => c.status === 'NI_RELEVANTNO').length,
    odstopanj: checks.reduce((a, c) => a + c.deviations.length, 0) + deviations.length,
  }

  return NextResponse.json({
    data: {
      checks,
      deviations,
      handover,
      povzetek,
    },
  })
}

// POST — pripravi kontrolne točke iz virov (podatkovno vodene, §3)
export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const scoped = await obsegNaloga(auth.user, id)
  if (scoped.error || !scoped.wo) return jsonError(scoped.conflict ? 403 : 404, scoped.error ?? 'Nalog ne obstaja.')

  const body = await req.json().catch(() => null)
  const force = body?.force === true

  const obstojeco = await db.montazaCheck.findMany({
    where: { workOrderId: id },
    select: { status: true },
  })
  if (obstojeco.length > 0) {
    const nedotaknjene = obstojeco.every((c) => c.status === 'NI_ZACETO')
    if (!force || !nedotaknjene) {
      return jsonError(
        409,
        'Kontrolne točke za ta nalog že obstajajo.',
        force
          ? 'Prisilna priprava je možna samo, če nobena točka še ni bila obdelana (brez izgube podatkov).'
          : 'Obstoječega seznama ne prepišemo — zgodovina montaže ostane (issue #12 §3).'
      )
    }
    await db.montazaCheck.deleteMany({ where: { workOrderId: id } }) // vse NI_ZACETO — nič ne izgubimo
  }

  const { drafts, viri } = await sestaviPredlogo(scoped.wo.projectId)
  if (drafts.length === 0) {
    return jsonError(409, 'Ni virov za kontrolni seznam.', 'Niso na voljo nobene playbook definicije niti pravila.')
  }

  const rows = await db.montazaCheck.createMany({
    data: drafts.map((d) => ({ ...d, workOrderId: id })),
  })

  await writeAudit({
    userId: auth.user.id,
    action: 'MONTAZA_TEMPLATE_APPLY',
    entity: 'workOrder',
    entityId: id,
    projectId: scoped.wo.projectId,
    detail: {
      workOrder: scoped.wo.code, stevilo: rows.count, viri,
      force: obstojeco.length > 0,
    },
  })

  const checks = await db.montazaCheck.findMany({
    where: { workOrderId: id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { checkedBy: { select: { name: true } }, deviations: { include: { actions: { include: { assignee: { select: { name: true } } } } } } },
  })
  return NextResponse.json({ data: { checks, viri, stevilo: rows.count } }, { status: 201 })
}

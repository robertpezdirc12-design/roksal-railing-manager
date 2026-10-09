// /api/production/from-twin — PREFAB ENGINE (R465 — issue #4 §3)
// POST (production.manage) — ustvari proizvodne elemente iz ZADNJEGA
// AS-PRODUCED snapshot-a digitalnega dvojčka projekta:
//   { productionOrderId?, projectId?, title?, dueAt?, reason? }
// • projectId: iz obstoječega naloga ALI iz telesa (ustvari nov nalog PR-xxxx)
// • brez AS-PRODUCED → 409 (proizvodnja izhaja iz dvojčka, ne iz ugibanj)
// • idempotenca: če nalog že ima elemente → 409 z eksplicitnim vzrokom;
//   regeneracija iz novejšega snapshot-a je dovoljena SAMO dokler so VSI
//   elementi še NAVRTEN (nič se ni pričelo — brez tihih sprememb, §22)
// • vsaka mutacija → revizija (PREFAB_GENERATE / PREFAB_REGENERATE)

import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextCodeFromList } from '@/lib/codes'
import { latestSnapshot } from '@/lib/capture-qa-service'
import { draftsFromSnapshot, PREFAB_VERSION, prefabProgress } from '@/lib/prefab-core'

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'production.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const reason = typeof body.reason === 'string' && body.reason.trim().length >= 3
    ? body.reason.trim().slice(0, 500)
    : null

  type OrderWithElements = Prisma.ProductionOrderGetPayload<{
    include: { elements: true, project: { select: { id: true, code: true, title: true } } }
  }>

  // ── razrešitev naloga ──
  let order: OrderWithElements | null = null
  if (typeof body.productionOrderId === 'string' && body.productionOrderId) {
    order = await db.productionOrder.findUnique({
      where: { id: body.productionOrderId },
      include: { elements: true, project: { select: { id: true, code: true, title: true } } },
    })
    if (!order) return jsonError(404, 'Proizvodni nalog ne obstaja.')
  }

  // projektni obseg: iz naloga, sicer iz telesa (za nov nalog)
  let projectId: string | null = order?.projectId ?? null
  if (typeof body.projectId === 'string' && body.projectId) {
    if (projectId && projectId !== body.projectId) {
      return jsonError(400, 'Nalog je vezan na drug projekt.', 'Podan projectId se ne ujema z nalogom.')
    }
    projectId = body.projectId
  }
  if (!projectId) {
    return jsonError(400, 'Manjka projectId.', 'Prefab izhaja iz AS-PRODUCED dvojčka projekta — projekt je obvezen.')
  }

  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, title: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  // ── vir: ZADNJI AS-PRODUCED dvojček ──
  const snap = await latestSnapshot(projectId, 'AS_PRODUCED')
  if (!snap || !snap.data) {
    return jsonError(409, 'Manjka AS-PRODUCED snapshot.', 'Proizvodnja izhaja iz digitalnega dvojčka — najprej ustvarite AS-PRODUCED (Dvojček → iz potrdljive kosovnice).')
  }

  const drafts = draftsFromSnapshot(snap.data)
  if (drafts.length === 0) {
    return jsonError(409, 'AS-PRODUCED snapshot nima segmentov.', 'Brez segmentov ni proizvodnih lističev.')
  }

  // ── nov nalog (če ni podan) ──
  let regenerated = false
  if (!order) {
    const existingCodes = await db.productionOrder.findMany({ where: { code: { startsWith: 'PR-' } }, select: { code: true } })
    const code = nextCodeFromList(existingCodes.map((o) => o.code), 'PR-')
    const title = typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 160)
      : `Prefab — ${project.code}`
    let dueAt: Date | null = null
    if (typeof body.dueAt === 'string' && body.dueAt) {
      dueAt = new Date(body.dueAt)
      if (Number.isNaN(dueAt.getTime())) return jsonError(400, 'Neveljaven rok izdelave.')
    }
    order = await db.productionOrder.create({
      data: { code, title, projectId, dueAt },
      include: { elements: true, project: { select: { id: true, code: true, title: true } } },
    })
    await writeAudit({
      userId: user.id, action: 'PRODUCTION_CREATE', entity: 'productionOrder', entityId: order.id,
      projectId,
      detail: { code, title, dueAt, via: 'prefab-engine' },
    })
  } else {
    // obstoječi nalog: idempotenca / pogoji za regeneracijo
    if (order.elements.length > 0) {
      const allFresh = order.elements.every((el) => el.status === 'NAVRTEN')
      const sameSource = order.elements.every((el) => el.sourceSnapshotId === snap.id)
      if (!allFresh) {
        return jsonError(409, 'Nalog že ima začeto proizvodnjo.', `Elementov (${order.elements.length}) ni mogoče prepisati — proizvodnja je v teku. Ustvarite nov nalog iz novega snapshot-a.`)
      }
      if (sameSource) {
        return jsonError(409, 'Nalog že ima elemente iz tega snapshot-a.', 'Idempotentno: uporabite obstoječe elemente ali nov nalog.')
      }
      await db.productionElement.deleteMany({ where: { productionOrderId: order.id } })
      regenerated = true
    }
  }

  // ── ustvarjanje lističev ──
  const created = await db.$transaction(
    drafts.map((d) => db.productionElement.create({
      data: {
        productionOrderId: order.id,
        sourceSnapshotId: snap.id,
        key: d.key,
        label: d.label,
        lengthCm: d.lengthCm,
        heightCm: d.heightCm,
        posts: d.posts,
        ral: d.ral,
        produkt: d.produkt,
        userId: user.id,
      },
    })),
  )

  await writeAudit({
    userId: user.id,
    action: regenerated ? 'PREFAB_REGENERATE' : 'PREFAB_GENERATE',
    entity: 'productionOrder',
    entityId: order.id,
    projectId,
    detail: {
      code: order.code,
      snapshotId: snap.id,
      snapshotVersion: snap.version,
      elements: created.length,
      keys: drafts.map((d) => d.key),
      engineVersion: PREFAB_VERSION,
      reason: reason ?? `Prefab iz AS-PRODUCED v${snap.version}`,
    },
  })

  return NextResponse.json({
    data: {
      productionOrderId: order.id,
      code: order.code,
      snapshotId: snap.id,
      snapshotVersion: snap.version,
      regenerated,
      elements: created.map((el) => ({
        id: el.id, key: el.key, label: el.label, lengthCm: el.lengthCm,
        heightCm: el.heightCm, posts: el.posts, ral: el.ral, produkt: el.produkt,
        status: el.status,
      })),
      progress: prefabProgress(created.map((el) => el.status)),
      engineVersion: PREFAB_VERSION,
    },
  }, { status: 201 })
}

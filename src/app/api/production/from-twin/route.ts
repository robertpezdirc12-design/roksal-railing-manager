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
// • R540: VSA pisanja v ENI interaktivni $transaction (nalog oz. regeneracija
//   + elementi + revizija), koda PR- znotraj tx + retryOnUnique okoli cele tx

import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextCodeFromList } from '@/lib/codes'
import { retryOnUnique } from '@/lib/versioning'
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

  // ── vrata PRED tx (disciplina predbranj R537-d): veljavnost roka za NOV
  // nalog (čisti izračun iz telesa — enako mesto v vrstnem redu kot prej) in
  // idempotenca / pogoji za regeneracijo obstoječega naloga (predbranje
  // `order.elements`) ──
  let regenerated = false
  if (!order) {
    if (typeof body.dueAt === 'string' && body.dueAt && Number.isNaN(new Date(body.dueAt).getTime())) {
      return jsonError(400, 'Neveljaven rok izdelave.')
    }
  } else if (order.elements.length > 0) {
    const allFresh = order.elements.every((el) => el.status === 'NAVRTEN')
    const sameSource = order.elements.every((el) => el.sourceSnapshotId === snap.id)
    if (!allFresh) {
      return jsonError(409, 'Nalog že ima začeto proizvodnjo.', `Elementov (${order.elements.length}) ni mogoče prepisati — proizvodnja je v teku. Ustvarite nov nalog iz novega snapshot-a.`)
    }
    if (sameSource) {
      return jsonError(409, 'Nalog že ima elemente iz tega snapshot-a.', 'Idempotentno: uporabite obstoječe elemente ali nov nalog.')
    }
    regenerated = true // stari (še sveži) elementi se zbrišejo ZNOTRAJ tx
  }

  // ── R540 (transakcijska celovitost + dirka kod PR-): VSA pisanja v ENI
  // interaktivni $transaction — (nov nalog + revizija PRODUCTION_CREATE) ALI
  // (regeneracijsko brisanje starih elementov), nato VSI lističi in zaključna
  // revizija. Prej so bili koraki ločeni (create + revizija kot gola await-a
  // izven katerekoli tx, elementi v array-form $transaction, za njo še ena
  // revizija) — padec srednjega koraka je pustil NALOG BREZ ELEMENTOV. Koda
  // PR- se bere ZNOTRAJ tx na tx klientu (izjema med predbranj); sočasen P2002
  // na ProductionOrder.code (@unique) ali @@unique([productionOrderId, key])
  // → do 3 poskusi (retryOnUnique OKOLI CELE tx — ob ponovnem poskusu se
  // celotno telo izvede znova, stranski učinki (deleteMany) pa se izvedejo
  // šele v uspešno potrjeni transakciji; vzorec REK-/DEL- R538-c). ──
  const { orderId, orderCode, created } = await retryOnUnique(() => db.$transaction(async (tx) => {
    let orderId: string
    let orderCode: string
    if (!order) {
      // ── nova-nalog veja: koda PR-{leto}-NNN (odporna na vrzeli — R439 vzorec)
      //    ZNOTRAJ tx (read-then-create dirka) ──
      const existingCodes = await tx.productionOrder.findMany({ where: { code: { startsWith: 'PR-' } }, select: { code: true } })
      const code = nextCodeFromList(existingCodes.map((o) => o.code), 'PR-')
      // naslov/rok sta čista izračuna iz telesa (veljavnost roka že preverjena pred tx)
      const title = typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 160)
        : `Prefab — ${project.code}`
      const dueAt = typeof body.dueAt === 'string' && body.dueAt ? new Date(body.dueAt) : null
      const nov = await tx.productionOrder.create({
        data: { code, title, projectId, dueAt },
        include: { elements: true, project: { select: { id: true, code: true, title: true } } },
      })
      await writeAudit({
        userId: user.id, action: 'PRODUCTION_CREATE', entity: 'productionOrder', entityId: nov.id,
        projectId,
        detail: { code, title, dueAt, via: 'prefab-engine' },
      }, tx)
      orderId = nov.id
      orderCode = code
    } else {
      // ── regeneracijska veja: stari (še sveži) elementi umaknjeni v ISTI tx
      //    kot novi (vrata so se preverila nad tx) ──
      if (regenerated) {
        await tx.productionElement.deleteMany({ where: { productionOrderId: order.id } })
      }
      orderId = order.id
      orderCode = order.code
    }

    // ── ustvarjanje lističev — zaporedno na tx klientu (interaktivna tx ne
    // dopušča vzporednih klicev; prej array-form $transaction, ki je zdaj del
    // te transakcije) ──
    const created: Prisma.ProductionElementGetPayload<Prisma.ProductionElementDefaultArgs>[] = []
    for (const d of drafts) {
      created.push(await tx.productionElement.create({
        data: {
          productionOrderId: orderId,
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
      }))
    }

    await writeAudit({
      userId: user.id,
      action: regenerated ? 'PREFAB_REGENERATE' : 'PREFAB_GENERATE',
      entity: 'productionOrder',
      entityId: orderId,
      projectId,
      detail: {
        code: orderCode,
        snapshotId: snap.id,
        snapshotVersion: snap.version,
        elements: created.length,
        keys: drafts.map((d) => d.key),
        engineVersion: PREFAB_VERSION,
        reason: reason ?? `Prefab iz AS-PRODUCED v${snap.version}`,
      },
    }, tx)
    return { orderId, orderCode, created }
  }), 3)

  return NextResponse.json({
    data: {
      productionOrderId: orderId,
      code: orderCode,
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

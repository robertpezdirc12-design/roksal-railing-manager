// /api/deliveries — DOSTAVA (R445, issue #7 §9).
// GET  (projects.read) — seznam z relacijami; filter ?status=&projectId=.
//      OBSEG: uporabnik z omejenim branjem (MONTER) vidi SAMO dostave, kjer je
//      voznik ALI ki so vezane na njegove naloge (workOrder.assigneeId); ostali vidijo vse.
// POST (projects.write + pisarna) — nova dostava {projectId?, pickingListId?, workOrderId?,
//      plannedAt?, address?, note?}; status NACRTOVANO, koda DEL-{leto}-NNN.
//      Če je podan pickingListId, mora biti lista ZAKLJUCENA (sicer 409) — vrstice se
//      kopirajo IZ pickinga z EKSPlicitnimi itemId povezavami (description = SKU + ime).
//      Revizija DELIVERY_CREATE s projectId.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextCodeFromList } from '@/lib/codes'
import { retryOnUnique } from '@/lib/versioning'
import { parseBody } from '@/lib/validate'
import { DELIVERY_INCLUDE } from '@/lib/delivery-core'

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// vezave (projekt/nalog/picking) neobvezne (prazno ⇒ null, kot prej — obstoj
// preverja handler s 404); plannedAt se pretvori v Date V HANDLERJU (prej
// `new Date(String(…))` s specifičnim 400 — ohranjen, ne z.coerce.date, da
// sporočilo ostane enako); naslov/opomba neobvezna (prazno ⇒ null, z rezino).
const DeliveryCreateSchema = z.object({
  projectId: z.string().nullish().transform((v) => v || null),
  workOrderId: z.string().nullish().transform((v) => v || null),
  pickingListId: z.string().nullish().transform((v) => v || null),
  plannedAt: z.unknown(),
  address: z.string().trim().nullish().transform((v) => (v ? v.slice(0, 300) : null)),
  note: z.string().trim().nullish().transform((v) => (v ? v.slice(0, 1000) : null)),
})

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const sp = new URL(req.url).searchParams
  const status = sp.get('status')
  const projectId = sp.get('projectId')
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 200), 1), 500)

  const where: Record<string, unknown> = {
    ...(status ? { status } : {}),
    ...(projectId ? { projectId } : {}),
  }
  // obseg (fail-closed): monter vidi SAMO dostave, kjer je voznik ali so vezane na njegove naloge
  if (!readsAllData(user)) {
    where.OR = [{ driverId: user.id }, { workOrder: { assigneeId: user.id } }]
  }

  const rows = await db.delivery.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: DELIVERY_INCLUDE,
  })
  return NextResponse.json({ data: rows })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // Dostave NAČRTUJE PISARNA: monterjev projects.write pokriva terenske projekte,
  // ne logistiko (verifikacija: monter ne sme ustvarjati dostav → 403).
  if (!readsAllData(user)) {
    return jsonError(403, 'Dostave načrtuje pisarna.', 'Ustvarjanje dostav je namenjeno pisarni, ne terenu.')
  }

  const parsed = await parseBody(req, DeliveryCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // ── vezave (vse opcione, a če so podane, morajo obstajati) ──────────────────
  let projectId: string | null = null
  if (data.projectId) {
    const project = await db.project.findUnique({ where: { id: data.projectId }, select: { id: true } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
    projectId = project.id
  }

  let workOrderId: string | null = null
  if (data.workOrderId) {
    const wo = await db.workOrder.findUnique({ where: { id: data.workOrderId }, select: { id: true } })
    if (!wo) return jsonError(404, 'Nalog ne obstaja.')
    workOrderId = wo.id
  }

  let pickingListId: string | null = null
  let pickingLines: { itemId: string; sku: string; name: string; unit: string; qty: number; note: string | null }[] = []
  if (data.pickingListId) {
    const picking = await db.pickingList.findUnique({
      where: { id: data.pickingListId },
      include: { lines: { orderBy: { sortOrder: 'asc' }, include: { item: true } } },
    })
    if (!picking) return jsonError(404, 'Picking lista ne obstaja.')
    if (picking.status !== 'ZAKLJUCENA') {
      return jsonError(409, `Najprej zaključite picking (${picking.code} je ${picking.status}).`, 'Dostava se gradi na pobranem materialu.')
    }
    pickingListId = picking.id
    // kopiraj POBRANE količine z EKSPlicitnimi itemId povezavami (ni fuzzy matchinga)
    pickingLines = picking.lines
      .filter((l) => l.qtyPicked > 0)
      .map((l) => ({ itemId: l.itemId, sku: l.item.sku, name: l.item.name, unit: l.item.unit, qty: l.qtyPicked, note: l.note }))
  }

  // ── preprosta polja ─────────────────────────────────────────────────────────
  // plannedAt: neprazna vrednost ⇒ new Date(String(v)) — neveljaven datum ⇒ 400
  // (enako kot prej; prazno/null/undefined ⇒ brez termina)
  let plannedAt: Date | null = null
  if (data.plannedAt !== undefined && data.plannedAt !== null && data.plannedAt !== '') {
    const t = new Date(String(data.plannedAt))
    if (Number.isNaN(t.getTime())) return jsonError(400, 'Neveljaven načrtovani čas dostave.')
    plannedAt = t
  }
  const address = data.address
  const note = data.note

  // R538: transakcijska celovitost — koda + zapis (+ vrstice) + revizija
  // atomarno (vzorec R537-d); koda DEL- se bere ZNOTRAJ tx, sočasen P2002 na
  // Delivery.code (@unique) → do 3 poskusi (retryOnUnique).
  const delivery = await retryOnUnique(() => db.$transaction(async (tx) => {
    // ── koda DEL-{leto}-NNN (odpor na vrzeli — R439 vzorec) ─────────────────
    const existing = await tx.delivery.findMany({ where: { code: { startsWith: 'DEL-' } }, select: { code: true } })
    const code = nextCodeFromList(existing.map((d) => d.code), 'DEL-')

    const delivery = await tx.delivery.create({
      data: {
        code,
        status: 'NACRTOVANO',
        projectId,
        pickingListId,
        workOrderId,
        plannedAt,
        address,
        note,
        createdBy: user.id,
        items: {
          create: pickingLines.map((l) => ({
            itemId: l.itemId,
            description: `${l.sku} — ${l.name}`,
            qty: l.qty,
            unit: l.unit,
            note: l.note,
          })),
        },
      },
      include: DELIVERY_INCLUDE,
    })

    await writeAudit({
      userId: user.id, action: 'DELIVERY_CREATE', entity: 'delivery', entityId: delivery.id,
      projectId,
      detail: { code, pickingListId, workOrderId, projectId, vrstic: pickingLines.length },
    }, tx)
    return delivery
  }), 3)
  return NextResponse.json({ data: delivery }, { status: 201 })
}

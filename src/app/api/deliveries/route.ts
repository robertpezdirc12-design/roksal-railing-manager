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
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextCodeFromList } from '@/lib/codes'
import { DELIVERY_INCLUDE } from '@/lib/delivery-core'

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

  const body = await req.json().catch(() => null)

  // ── vezave (vse opcione, a če so podane, morajo obstajati) ──────────────────
  let projectId: string | null = null
  if (typeof body?.projectId === 'string' && body.projectId) {
    const project = await db.project.findUnique({ where: { id: body.projectId }, select: { id: true } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
    projectId = project.id
  }

  let workOrderId: string | null = null
  if (typeof body?.workOrderId === 'string' && body.workOrderId) {
    const wo = await db.workOrder.findUnique({ where: { id: body.workOrderId }, select: { id: true } })
    if (!wo) return jsonError(404, 'Nalog ne obstaja.')
    workOrderId = wo.id
  }

  let pickingListId: string | null = null
  let pickingLines: { itemId: string; sku: string; name: string; unit: string; qty: number; note: string | null }[] = []
  if (typeof body?.pickingListId === 'string' && body.pickingListId) {
    const picking = await db.pickingList.findUnique({
      where: { id: body.pickingListId },
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
  let plannedAt: Date | null = null
  if (body?.plannedAt !== undefined && body?.plannedAt !== null && body.plannedAt !== '') {
    const t = new Date(String(body.plannedAt))
    if (Number.isNaN(t.getTime())) return jsonError(400, 'Neveljaven načrtovani čas dostave.')
    plannedAt = t
  }
  const address = typeof body?.address === 'string' && body.address.trim() ? body.address.trim().slice(0, 300) : null
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null

  // ── koda DEL-{leto}-NNN (odpor na vrzeli — R439 vzorec) ─────────────────────
  const existing = await db.delivery.findMany({ where: { code: { startsWith: 'DEL-' } }, select: { code: true } })
  const code = nextCodeFromList(existing.map((d) => d.code), 'DEL-')

  const delivery = await db.delivery.create({
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
  })
  return NextResponse.json({ data: delivery }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextCodeFromList } from '@/lib/codes'
import { retryOnUnique } from '@/lib/versioning'

// GET /api/production — proizvodni nalogi s projektom, sortiranje po roku (production.read)
export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'production.read')
  if (auth instanceof NextResponse) return auth

  const orders = await db.productionOrder.findMany({
    // R444: projectId je potreben za prikaz kosovnic projekta (Priprava materiala)
    include: { project: { select: { id: true, code: true, title: true } } },
    orderBy: [{ dueAt: 'asc' }, { code: 'asc' }],
  })
  // SQLite: NULL roki se pri ASC zvrstijo na začetek → na konec
  const data = [...orders].sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime()
    if (a.dueAt) return -1
    if (b.dueAt) return 1
    return 0
  })
  return NextResponse.json({ data })
}

// POST /api/production — nov proizvodni nalog {title, projectId?, dueAt?} (production.manage)
export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'production.manage')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) return jsonError(400, 'Naslov proizvodnega naloga je obvezen.')

  const projectId = typeof body?.projectId === 'string' && body.projectId ? body.projectId : null
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
  }

  let dueAt: Date | null = null
  if (typeof body?.dueAt === 'string' && body.dueAt) {
    dueAt = new Date(body.dueAt)
    if (Number.isNaN(dueAt.getTime())) return jsonError(400, 'Neveljaven rok izdelave.')
  }

  // R540 (transakcijska celovitost + dirka kod PR-): nalog + revizija atomarno
  // (vzorec R537-d); koda PR- se bere ZNOTRAJ tx na tx klientu — sočasen POST,
  // ki izračuna isto kodo, sproži P2002 na ProductionOrder.code (@unique),
  // kar retryOnUnique okoli CELE transakcije reši z do 3 poskusi (koda se v
  // ponovljenem fn izračuna znova; vzorec REK-/DEL- R538-c, nalog R537).
  const order = await retryOnUnique(() => db.$transaction(async (tx) => {
    // R439: koda glede na zasedene (count pade ob brisanju → unikatnost ni zagotovljena)
    const existingCodes = await tx.productionOrder.findMany({ where: { code: { startsWith: 'PR-' } }, select: { code: true } })
    const code = nextCodeFromList(existingCodes.map((w) => w.code), 'PR-')

    const order = await tx.productionOrder.create({
      data: { code, title, projectId, dueAt },
      include: { project: { select: { code: true, title: true } } },
    })
    await writeAudit({
      userId: auth.user.id, action: 'PRODUCTION_CREATE', entity: 'productionOrder', entityId: order.id,
      projectId,
      detail: { code, title, dueAt },
    }, tx)
    return order
  }), 3)
  return NextResponse.json({ data: order }, { status: 201 })
}

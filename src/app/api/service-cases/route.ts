// /api/service-cases — SERVISNI PRIMERI (R446, issue #7 §10, P2 SERVIS).
// GET  (projects.read) — seznam z relacijami; ?status=&projectId=.
//      OBSEG: uporabnik z omejenim branjem (MONTER) vidi SAMO primere, na katerih
//      ima servisni obisk (visits.some.userId = uporabnik); ostali vidijo vse.
// POST (projects.write + pisarna) — nov primer {claimId?, projectId, warrantyId?, title, desc};
//      koda SRV-{leto}-NNN. Če je podan claimId: claim mora pripadati ISTEMU projektu
//      (409), claim ne sme že imeti primera (1:1, 409) in se v isti transakciji
//      premakne v V_OBRAVNAVI. Revizija SERVICE_CASE_CREATE s projectId.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextCodeFromList } from '@/lib/codes'
import { retryOnUnique } from '@/lib/versioning'
import { SERVICE_CASE_INCLUDE } from '@/lib/service-core'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const sp = new URL(req.url).searchParams
  const status = sp.get('status')
  const projectId = sp.get('projectId')

  const where: Record<string, unknown> = {
    ...(status ? { status } : {}),
    ...(projectId ? { projectId } : {}),
  }
  // obseg (fail-closed): monter vidi SAMO primere s SVOJIMI obiski
  if (!readsAllData(user)) {
    where.visits = { some: { userId: user.id } }
  }

  const rows = await db.serviceCase.findMany({
    where,
    include: SERVICE_CASE_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
  return NextResponse.json({ data: rows })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // servisne primere ODPIRA pisarna (vzorec /api/deliveries POST)
  if (!readsAllData(user)) {
    return jsonError(403, 'Servisne primere odpira pisarna.', 'Monter izvaja obiske na obstoječih primerih.')
  }

  const body = await req.json().catch(() => null) as {
    claimId?: string; projectId?: string; warrantyId?: string; title?: string; desc?: string
  } | null

  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) return jsonError(400, 'Manjka projekt.')

  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, title: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const desc = typeof body?.desc === 'string' ? body.desc.trim() : ''
  if (!title) return jsonError(400, 'Naslov servisnega primera je obvezen.')
  if (!desc) return jsonError(400, 'Opis servisnega primera je obvezen.')

  // ── opcijska garancija (mora pripadati istemu projektu) ─────────────────────
  let warrantyId: string | null = null
  if (typeof body?.warrantyId === 'string' && body.warrantyId) {
    const warranty = await db.warranty.findUnique({ where: { id: body.warrantyId }, select: { id: true, projectId: true } })
    if (!warranty) return jsonError(404, 'Garancija ne obstaja.')
    if (warranty.projectId !== projectId) return jsonError(409, 'Garancija pripada drugemu projektu.')
    warrantyId = warranty.id
  }

  // ── opcijski claim (1:1, isti projekt, še brez primera) ─────────────────────
  let claimId: string | null = null
  let claimCode: string | null = null
  if (typeof body?.claimId === 'string' && body.claimId) {
    const claim = await db.claim.findUnique({ where: { id: body.claimId }, select: { id: true, code: true, projectId: true, status: true, serviceCase: { select: { id: true } } } })
    if (!claim) return jsonError(404, 'Reklamacija ne obstaja.')
    if (claim.projectId !== projectId) return jsonError(409, 'Reklamacija pripada drugemu projektu.', 'Servisni primer se odpira na projektu reklamacije.')
    if (claim.serviceCase) return jsonError(409, `Reklamacija ${claim.code} ima že servisni primer.`, 'Zveza reklamacija → servisni primer je 1:1.')
    if (claim.status !== 'NOVA' && claim.status !== 'V_OBRAVNAVI') {
      return jsonError(409, `Reklamacija ${claim.code} je ${claim.status} — servisnega primera ni mogoče odpreti.`, 'Primer se odpira samo iz nove ali v obdelavi vezane reklamacije.')
    }
    claimId = claim.id
    claimCode = claim.code
  }

  // R540 (dirka kod SRV-): ustvarjanje + premik claima v V_OBRAVNAVI + revizija
  // v ENI transakciji (vzorec R537+); koda SRV- se bere ZNOTRAJ tx na tx
  // klientu — sočasen POST, ki izračuna isto kodo, sproži P2002 na
  // ServiceCase.code (@unique), kar retryOnUnique okoli CELE transakcije reši
  // z do 3 poskusi (koda se v ponovljenem fn izračuna znova; vzorec REK-/DEL-
  // R538-c). Revizija SPRINJA v isti tx — padec ne more pustiti servisni
  // primer brez revizijskega zapisa (sinteza R540).
  const serviceCase = await retryOnUnique(() => db.$transaction(async (tx) => {
    // ── koda SRV-{leto}-NNN (odporna na vrzeli — R439 vzorec) ───────────────
    const existing = await tx.serviceCase.findMany({ where: { code: { startsWith: 'SRV-' } }, select: { code: true } })
    const code = nextCodeFromList(existing.map((c) => c.code), 'SRV-')

    const serviceCase = await tx.serviceCase.create({
      data: {
        code,
        claimId,
        projectId,
        warrantyId,
        title: title.slice(0, 200),
        desc: desc.slice(0, 4000),
        status: 'PREVERITEV',
      },
      include: SERVICE_CASE_INCLUDE,
    })
    if (claimId) {
      await tx.claim.update({ where: { id: claimId }, data: { status: 'V_OBRAVNAVI' } })
    }
    await writeAudit({
      userId: user.id, action: 'SERVICE_CASE_CREATE', entity: 'serviceCase', entityId: serviceCase.id, projectId,
      detail: { code, project: project.code, claim: claimCode, garancija: !!warrantyId },
    }, tx)
    return serviceCase
  }), 3)

  return NextResponse.json({ data: serviceCase }, { status: 201 })
}

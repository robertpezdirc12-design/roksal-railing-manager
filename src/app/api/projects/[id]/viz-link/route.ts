import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import { VIZ_LINK_DEFAULT_DAYS, VIZ_LINK_MAX_DAYS } from '@/lib/viz-core'

// /api/projects/[id]/viz-link — JAVNA POVEZAVA VIZUALIZATORJA (R480 — issue #9 §10)
// GET    (portal.manage): obstoječe povezave projekta (+ stanje veljavnosti)
// POST   (portal.manage): { days? (privzeto 14, max 90), note? } → nova
//        povezava { token 'pv-…', url: '/v/<token>', expiresAt } — javna HTML
//        stran vizualizatorja je /v/[token] (frontend R480); JSON API pa
//        /api/public/viz?token=…
// DELETE (portal.manage): ?id=… (ali telo { id }) → preklic (revokedAt) —
//        javni dostop TAKOJ preneha (idempotentno).
// Objava na javni poti je dejanje PISARNE (portal.manage = ADMIN/VODJA —
// isti vzorec kot review-link iz R479; monter 403).
// Reviziji: VIZLINK_CREATE / VIZLINK_REVOKE (žeton v reviziji prikrit).

type Params = { params: Promise<{ id: string }> }

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// days: kot prej Number(v) — število ALI številski niz, 1..90 po trunc, sicer
// privzetek 14 (niz/boolean/undefined grejo skozi isto logiko kot prej),
// opomba: neprazen niz po trim ⇒ vrednost, sicer null (kot prej).
const VizLinkCreateSchema = z.object({
  days: z.unknown().transform((v) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 1 && n <= VIZ_LINK_MAX_DAYS ? Math.trunc(n) : VIZ_LINK_DEFAULT_DAYS
  }),
  note: z.string({ error: 'Opomba mora biti besedilo.' }).nullish().transform((v) => v?.trim() || null),
})

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'portal.manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const project = await db.project.findUnique({ where: { id }, select: { id: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const links = await db.vizLink.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
  })
  const now = new Date()
  return NextResponse.json({
    data: links.map((l) => ({
      id: l.id,
      token: l.token,
      url: `/v/${l.token}`,
      projectId: l.projectId,
      note: l.note,
      viewCount: l.viewCount,
      lastViewAt: l.lastViewAt?.toISOString() ?? null,
      revokedAt: l.revokedAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      expiresAt: l.expiresAt.toISOString(),
      active: !l.revokedAt && l.expiresAt >= now,
    })),
  })
}

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'portal.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const project = await db.project.findUnique({ where: { id }, select: { id: true, code: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, VizLinkCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // objava povezave + revizija VIZLINK_CREATE v ENI transakciji.
  const link = await db.$transaction(async (tx) => {
    const link = await tx.vizLink.create({
      data: {
        token: 'pv-' + randomUUID().replace(/-/g, ''),
        projectId: id,
        createdById: user.id,
        note: data.note,
        expiresAt: new Date(Date.now() + data.days * 86400000),
      },
    })
    await writeAudit({
      userId: user.id, action: 'VIZLINK_CREATE', entity: 'vizLink', entityId: link.id, projectId: id,
      detail: { project: project.code, days: data.days, expiresAt: link.expiresAt.toISOString() },
    }, tx)
    return link
  })

  return NextResponse.json({
    data: {
      id: link.id,
      token: link.token,
      url: `/v/${link.token}`,
      expiresAt: link.expiresAt.toISOString(),
      note: link.note,
    },
  }, { status: 201 })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'portal.manage')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const project = await db.project.findUnique({ where: { id }, select: { id: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const url = new URL(req.url)
  // R538: hibridno branje (query ?id= ALI telo { id }) ostaja ročno — telo je
  // pri DELETE neobvezno (brez telesa se uporabi query); parseBody bi breztelesno
  // zahtevo zavrnil s 400, kar bi bila vedenjska sprememba.
  const body = await req.json().catch(() => null) as { id?: string } | null
  const linkId = url.searchParams.get('id') ?? (typeof body?.id === 'string' ? body.id : '')
  if (!linkId) return jsonError(400, 'Manjka id povezave.', 'Podajte ?id=… povezave, ki jo preklicujete.')

  const link = await db.vizLink.findUnique({ where: { id: linkId } })
  if (!link || link.projectId !== id) return jsonError(404, 'Povezava ne obstaja.')
  if (link.revokedAt) return NextResponse.json({ data: { revoked: true, id: linkId } }) // idempotentno

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // preklic + revizija VIZLINK_REVOKE v ENI transakciji.
  await db.$transaction(async (tx) => {
    await tx.vizLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } })
    await writeAudit({
      userId: user.id, action: 'VIZLINK_REVOKE', entity: 'vizLink', entityId: linkId, projectId: id,
      detail: { token: link.token.slice(0, 8) + '…' }, // prikrit žeton (varnost)
    }, tx)
  })

  return NextResponse.json({ data: { revoked: true, id: linkId } })
}

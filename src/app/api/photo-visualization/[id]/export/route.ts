// /api/photo-visualization/[id]/export — R459 (issue #14 §14 izvoz)
// POST (projects.read + obseg §13) — zabeleži izvoz (PNG POTEM ali PREJ/POTEM
// primerjava) v revizijo; neobvezno posodobi izrisano sličico (rendered), da
// je PDF/portal vedno current. PNG bajti nastanejo v odjemalcu (canvas) —
// tukaj je sledljivost + persistenca.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { MAX_RENDERED_BYTES, preveriFoto, vizZaUporabnika } from '@/lib/photo-replace-engine'

type Params = { params: Promise<{ id: string }> }

const FORMATS = ['png', 'primerjava'] as const

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const res = await vizZaUporabnika(user, id)
  if (res instanceof NextResponse) return res
  const viz = res.viz

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const format = typeof body.format === 'string' ? body.format : ''
  if (!(FORMATS as readonly string[]).includes(format)) {
    return jsonError(400, 'Neveljaven format izvoza.', `Veljavni formati: ${FORMATS.join(', ')}.`)
  }

  // neobvezno: posodobi izrisano sličico ob izvozu (kar je uporabnik dejansko
  // izvozil — za PDF in portal)
  let renderedPosodobljen = false
  if (body.rendered !== undefined && body.rendered !== null) {
    const r = preveriFoto(body.rendered, MAX_RENDERED_BYTES, 'Izrisana sličica')
    if ('napaka' in r) return jsonError(400, r.napaka)
    await db.photoVisualization.update({ where: { id }, data: { rendered: r.dataUrl } })
    renderedPosodobljen = true
  }

  await writeAudit({
    userId: user.id,
    action: 'PHOTO_VIZ_EXPORT',
    entity: 'photoVisualization',
    entityId: id,
    projectId: viz.projectId,
    detail: { format, variantLabel: viz.variantLabel, renderedPosodobljen },
  })

  return NextResponse.json({ data: { ok: true, format, renderedPosodobljen } })
}

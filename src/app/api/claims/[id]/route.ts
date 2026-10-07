// /api/claims/[id] — REKLAMACIJA: podrobnost + prehodi statusov (R446, issue #7 §10).
// GET   (projects.read + pisarna) — podrobnost z relacijami.
// PATCH (projects.write + pisarna) — { status?, resolutionNote? };
//       prehodi: NOVA → V_OBRAVNAVI | ZAVRNJENA; V_OBRAVNAVI → ZAKLJUCENA | ZAVRNJENA;
//       nedovoljeni prehodi → 409 (veljavni Claim.statusi so končna stanja).
//       Revizija CLAIM_UPDATE s projectId.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { CLAIM_INCLUDE, CLAIM_STATUSES, CLAIM_TRANSITIONS } from '@/lib/service-core'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  if (!readsAllData(user)) {
    return jsonError(403, 'Reklamacije vodi pisarna.', 'Monter dobi svoje servisne obiske prek modula Servis.')
  }

  const { id } = await params
  const claim = await db.claim.findUnique({ where: { id }, include: CLAIM_INCLUDE })
  if (!claim) return jsonError(404, 'Reklamacija ne obstaja.')
  return NextResponse.json({ data: claim })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  if (!readsAllData(user)) {
    return jsonError(403, 'Reklamacije ureja pisarna.', 'Terenski uporabniki nimajo dostopa do reklamacij strank.')
  }

  const { id } = await params
  const claim = await db.claim.findUnique({ where: { id }, select: { id: true, code: true, status: true, projectId: true } })
  if (!claim) return jsonError(404, 'Reklamacija ne obstaja.')

  const body = await req.json().catch(() => null) as { status?: string; resolutionNote?: string } | null

  const patch: { status?: string; resolutionNote?: string | null } = {}
  if (typeof body?.status === 'string') {
    if (!(CLAIM_STATUSES as readonly string[]).includes(body.status)) {
      return jsonError(400, 'Neveljaven status reklamacije.', 'Veljavni statusi: NOVA, V_OBRAVNAVI, ZAKLJUCENA, ZAVRNJENA.')
    }
    const allowed = CLAIM_TRANSITIONS[claim.status] ?? []
    if (!allowed.includes(body.status)) {
      return jsonError(409, `Prehod ${claim.status} → ${body.status} ni dovoljen.`, `Dovoljeni prehodi iz ${claim.status}: ${allowed.join(', ') || '—'}.`)
    }
    patch.status = body.status
  }
  if (typeof body?.resolutionNote === 'string') {
    patch.resolutionNote = body.resolutionNote.trim().slice(0, 2000)
  }
  if (Object.keys(patch).length === 0) {
    return jsonError(400, 'Ni sprememb za izvedbo.', 'Podprite polja: status, resolutionNote.')
  }

  const updated = await db.claim.update({
    where: { id: claim.id },
    data: patch,
    include: CLAIM_INCLUDE,
  })

  await writeAudit({
    userId: user.id, action: 'CLAIM_UPDATE', entity: 'claim', entityId: claim.id, projectId: claim.projectId,
    detail: { code: claim.code, iz: claim.status, na: updated.status },
  })
  return NextResponse.json({ data: updated })
}

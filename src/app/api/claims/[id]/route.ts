// /api/claims/[id] — REKLAMACIJA: podrobnost + prehodi statusov (R446, issue #7 §10).
// GET   (projects.read + pisarna) — podrobnost z relacijami.
// PATCH (projects.write + pisarna) — { status?, resolutionNote? };
//       prehodi: NOVA → V_OBRAVNAVI | ZAVRNJENA; V_OBRAVNAVI → ZAKLJUCENA | ZAVRNJENA;
//       nedovoljeni prehodi → 409 (veljavni Claim.statusi so končna stanja).
//       Revizija CLAIM_UPDATE s projectId.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'
import { CLAIM_INCLUDE, CLAIM_STATUSES, CLAIM_TRANSITIONS } from '@/lib/service-core'

type Params = { params: Promise<{ id: string }> }

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// status neobvezen niz (null ⇒ brez, kot prej — ne-string se je tiho preskočil);
// resolutionNote neobvezen niz (prazen niz se ZAPIŠE kot '', kot prej); prehodi
// statusov in veljavni statusi ostajajo poslovna logika handlerja (409/400).
const ClaimPatchSchema = z.object({
  status: z.string().nullish().transform((v) => v ?? undefined),
  resolutionNote: z.string().trim().nullish().transform((v) => (v == null ? undefined : v.slice(0, 2000))),
})

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

  const parsed = await parseBody(req, ClaimPatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const patch: { status?: string; resolutionNote?: string | null } = {}
  if (typeof data.status === 'string') {
    if (!(CLAIM_STATUSES as readonly string[]).includes(data.status)) {
      return jsonError(400, 'Neveljaven status reklamacije.', 'Veljavni statusi: NOVA, V_OBRAVNAVI, ZAKLJUCENA, ZAVRNJENA.')
    }
    const allowed = CLAIM_TRANSITIONS[claim.status] ?? []
    if (!allowed.includes(data.status)) {
      return jsonError(409, `Prehod ${claim.status} → ${data.status} ni dovoljen.`, `Dovoljeni prehodi iz ${claim.status}: ${allowed.join(', ') || '—'}.`)
    }
    patch.status = data.status
  }
  if (typeof data.resolutionNote === 'string') {
    patch.resolutionNote = data.resolutionNote
  }
  if (Object.keys(patch).length === 0) {
    return jsonError(400, 'Ni sprememb za izvedbo.', 'Podprite polja: status, resolutionNote.')
  }

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d)
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.claim.update({
      where: { id: claim.id },
      data: patch,
      include: CLAIM_INCLUDE,
    })

    await writeAudit({
      userId: user.id, action: 'CLAIM_UPDATE', entity: 'claim', entityId: claim.id, projectId: claim.projectId,
      detail: { code: claim.code, iz: claim.status, na: updated.status },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

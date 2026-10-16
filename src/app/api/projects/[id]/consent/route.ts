import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { consentStatus } from '@/lib/pin-core'

// /api/projects/[id]/consent — GDPR SOGLASJE ZA FOTOGRAFIJE (R479 — issue #9 §10)
// POST (customers.write — pisarna: ADMIN/VODJA): { action: 'SET' | 'CLEAR',
//      validDays?: 1..1825 } → zapis soglasja na PROJEKTU.
//   SET   → photoConsentAt = zdaj, photoConsentById = uporabnik,
//           photoConsentExpiresAt = zdaj + validDays (ali null = brez roka)
//   CLEAR → vsa tri polja NULL (soglasje umaknjeno)
// Varnost: v revizijo NE zapisujemo prostega teksta soglasja — samo kdo/kdaj/
// rok (CONSENT_SET / CONSENT_CLEAR). Javne poti od zdaj fotografije izpišejo
// SAMO ob statusu VELJAVNO (pin-core.consentStatus); interno ostanejo vidne
// z opozorilom (gallery nosi consentStatus za UI).

type Params = { params: Promise<{ id: string }> }

const MAX_VALID_DAYS = 1825 // 5 let — zgornja meja roka hrambe

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'customers.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const project = await db.project.findUnique({ where: { id }, select: { id: true, code: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  const body = await req.json().catch(() => null) as { action?: string; validDays?: number } | null
  if (body?.action !== 'SET' && body?.action !== 'CLEAR') {
    return jsonError(400, 'Neveljavno dejanje.', 'Podprta dejanja: SET (zapis soglasja), CLEAR (umik soglasja).')
  }

  const now = new Date()
  if (body.action === 'SET') {
    const d = Number(body?.validDays)
    const hasDays = body?.validDays != null
    if (hasDays && (!Number.isFinite(d) || d < 1 || d > MAX_VALID_DAYS)) {
      return jsonError(400, 'Neveljaven rok veljavnosti.', `validDays mora biti število 1–${MAX_VALID_DAYS} (ali izpuščen = brez roka).`)
    }
    const expiresAt = hasDays ? new Date(Date.now() + Math.trunc(d) * 86400000) : null
    // R538: transakcijska celovitost — soglasje + revizija atomarno (vzorec R537-d)
    await db.$transaction(async (tx) => {
      await tx.project.update({
        where: { id },
        data: {
          photoConsentAt: now,
          photoConsentById: user.id,
          photoConsentExpiresAt: expiresAt,
        },
      })
      await writeAudit({
        userId: user.id, action: 'CONSENT_SET', entity: 'project', entityId: id, projectId: id,
        detail: { project: project.code, expiresAt: expiresAt ? expiresAt.toISOString() : null }, // BREZ prostega teksta soglasja
      }, tx)
    })
    return NextResponse.json({
      data: { projectId: id, consent: consentStatus({ photoConsentAt: now, photoConsentExpiresAt: expiresAt }), photoConsentAt: now.toISOString(), photoConsentExpiresAt: expiresAt ? expiresAt.toISOString() : null },
    })
  }

  // CLEAR
  // R538: transakcijska celovitost — umik soglasja + revizija atomarno (vzorec R537-d)
  await db.$transaction(async (tx) => {
    await tx.project.update({
      where: { id },
      data: { photoConsentAt: null, photoConsentById: null, photoConsentExpiresAt: null },
    })
    await writeAudit({
      userId: user.id, action: 'CONSENT_CLEAR', entity: 'project', entityId: id, projectId: id,
      detail: { project: project.code }, // BREZ prostega teksta soglasja
    }, tx)
  })
  return NextResponse.json({
    data: { projectId: id, consent: 'MANJKA', photoConsentAt: null, photoConsentExpiresAt: null },
  })
}

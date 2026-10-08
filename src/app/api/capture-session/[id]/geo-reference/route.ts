// /api/capture-session/[id]/geo-reference — georeferenčna mreža (R462 — issue #17 §1/§2/§4)
// GET  seznam georeferenc + registracije + loopi (measurements.read)
// POST nova georeferenca: { tier, lat, lon, altM?, atCm?, coordinateSystem?,
//       datum?, geoid?, hAccM?, vAccM?, source, rtkStatus?, correctionAgeSec?,
//       device?, note? } (measurements.write) → koda GEO-00n, učinkovita
//       natančnost OMEJENA na vir (§1 brez lažne natančnosti), RTK kvaliteta
//       (§2), revizija GEO_REF_CREATE. RTK koordinata NI proizvodna mera.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { GEO_SOURCES, RTK_NOT_PRODUCTION, effectiveAccuracy, parseGeoInput, rtkQuality, geoSourceDef } from '@/lib/reality-r2p-engine'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { geoContext } from '@/lib/reality-r2p-service'

export async function GET (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access

  const ctx = await geoContext(id)
  return NextResponse.json({ data: ctx, rtkNotProduction: RTK_NOT_PRODUCTION })
}

export async function POST (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access
  if (access.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je zaključen.', 'Georeferenc ni mogoče dodajati zaključenemu zajemu (§22).')
  }

  const body = await req.json().catch(() => null)
  const input = parseGeoInput(body)
  if (!input) {
    return jsonError(400, 'Neveljavna georeferenca.', `tier: BASIC|PROFESSIONAL|SURVEY · lat/lon · source: ${GEO_SOURCES.map((s) => s.id).join(' | ')} · (hAccM/vAccM ne moreta preseči zmožnosti vira)`)
  }

  // GNSS viri zahtevajo rtkStatus
  const def = geoSourceDef(input.source)
  if (def?.rtk && !input.rtkStatus) {
    return jsonError(400, 'GNSS vir zahteva rtkStatus.', 'rtkStatus: FIX | FLOAT | NONE (§2).')
  }
  // RTK kvaliteta (§2): FLOAT/NONE nista uporabna — izrecno opozorilo (ne zavrnemo: referenca je lahko zapisana z opozorilom)
  const rtk = rtkQuality(input.rtkStatus, input.correctionAgeSec)

  // učinkovita natančnost — OMEJENA na vir (§1)
  const acc = effectiveAccuracy(input.source, input.hAccM, input.vAccM)

  const count = await db.geoReference.count({ where: { sessionId: id } })
  const code = `GEO-${String(count + 1).padStart(3, '0')}`

  const ref = await db.geoReference.create({
    data: {
      sessionId: id, code,
      tier: input.tier, lat: input.lat, lon: input.lon,
      altM: input.altM ?? null,
      atCm: input.atCm ?? null,
      coordinateSystem: input.coordinateSystem,
      datum: input.datum ?? null, geoid: input.geoid ?? null,
      hAccM: acc.hAccM, vAccM: acc.vAccM, // učinkovita (capana)
      source: input.source,
      rtkStatus: input.rtkStatus ?? null,
      correctionAgeSec: input.correctionAgeSec ?? null,
      device: input.device ?? null,
      operatorId: user.id,
      note: input.note ?? null,
    },
  })

  await writeAudit({
    userId: user.id,
    action: 'GEO_REF_CREATE',
    entity: 'geoReference',
    entityId: ref.id,
    projectId: access.session.projectId,
    detail: {
      sessionId: id, code, tier: input.tier, source: input.source,
      hAccM: acc.hAccM, vAccM: acc.vAccM,
      ...(acc.capped ? { capped: true } : {}),
      ...(input.rtkStatus ? { rtkStatus: input.rtkStatus } : {}),
    },
  })

  const ctx = await geoContext(id)
  return NextResponse.json({
    data: {
      id: ref.id, code,
      hAccM: acc.hAccM, vAccM: acc.vAccM,
      capped: acc.capped, accuracyReason: acc.reason,
      rtkUsable: rtk.usable, rtkReason: rtk.reason,
      rtkNotProduction: RTK_NOT_PRODUCTION,
      context: ctx,
    },
  }, { status: 201 })
}

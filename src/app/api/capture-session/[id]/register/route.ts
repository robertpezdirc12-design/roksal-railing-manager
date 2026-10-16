// /api/capture-session/[id]/register — 3-točkovna registracija (R462 — issue #17 §3)
// POST { points: [{ code, source:{x,y}, target:{x,y} } ×3 ], note? }
//      (measurements.write) → podobnostna transformacija (translacija/rotacija/
//      merilo/orientacija) + RMS + REGISTRATION QUALITY GOOD/WARNING/INVALID.
//      VERZIONIRANO: nova vrstica, nikoli prepis (§3) + revizija REGISTRATION_CREATE.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseRegPairs, register3Points } from '@/lib/reality-r2p-engine'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { geoContext } from '@/lib/reality-r2p-service'
import { retryOnUnique } from '@/lib/versioning'

export async function POST (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access
  if (access.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je zaključen.', 'Registracij ni mogoče dodajati zaključenemu zajemu (§22).')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const pairs = parseRegPairs(body.points)
  if (!pairs) {
    return jsonError(400, 'Pričakovane točno 3 točke.', 'points: [{ code, source: {x,y}, target: {x,y} }] ×3 — vir (tek) → cilj (geo/načrt).')
  }

  const result = register3Points(pairs)

  // R536: dirka verzij — branje zadnje registracije + izračun naslednje verzije
  // sta ZNOTRAJ retried fn (versioning.ts): ob sočasnem P2002 na
  // @@unique([sessionId, version]) se številka izračuna znova in poskus ponovi.
  // Verzioniranje ostane „nova vrstica, nikoli prepis“ (§3) — revizija in
  // odgovor nosita ZMAGOVITO (končno) številko verzije.
  // R539 (transakcijska celovitost): verzija + create + revizija
  // REGISTRATION_CREATE zdaj V ENI $transaction na tx klientu — retryOnUnique
  // je OKOLI CELE transakcije (P2002 v PG transakciji aborta celo tx,
  // ponovni poskus verzijo izračuna znova).
  const { reg, version } = await retryOnUnique(() => db.$transaction(async (tx) => {
    const last = await tx.registration.findFirst({
      where: { sessionId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const version = (last?.version ?? 0) + 1
    const reg = await tx.registration.create({
      data: {
        sessionId: id, version,
        points: JSON.stringify(pairs),
        transform: JSON.stringify(result.transform),
        rmsCm: Number.isFinite(result.rmsCm) ? result.rmsCm : 999999,
        quality: result.quality,
        userId: user.id,
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null,
      },
    })

    await writeAudit({
      userId: user.id,
      action: 'REGISTRATION_CREATE',
      entity: 'registration',
      entityId: reg.id,
      projectId: access.session.projectId,
      detail: {
        sessionId: id, version,
        quality: result.quality, rmsCm: Number.isFinite(result.rmsCm) ? result.rmsCm : 999999,
        codes: pairs.map((p) => p.code),
      },
    }, tx)

    return { reg, version }
  }))

  const ctx = await geoContext(id)
  return NextResponse.json({
    data: {
      id: reg.id, version,
      quality: result.quality,
      rmsCm: Number.isFinite(result.rmsCm) ? result.rmsCm : null,
      transform: result.transform,
      residuals: result.residuals,
      reasons: result.reasons,
      context: ctx,
    },
  }, { status: 201 })
}

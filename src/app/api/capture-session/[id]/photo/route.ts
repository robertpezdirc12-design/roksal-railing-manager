// /api/capture-session/[id]/photo — dodaj posnetek zajema (R461 — issue #16 §1/§3/§17/§18)
// POST { zone, quality?, offsetCm?, clientKey, thumb? } (measurements.write)
// → idempotentno (clientKey — brez podvojenih posnetkov pri offline sync),
//   pokritost + drift se sveže izračunata, revizija CAPTURE_PHOTO.
// Brez blob-ov: quality metapodatki + neobvezna sličica ≤ 120 KB (§24).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseQuality, parsePlan } from '@/lib/capture-qa-engine'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { analyzeSession, loadCaptureContext } from '@/lib/capture-qa-service'
import { Prisma } from '@prisma/client'

const THUMB_MAX = 120 * 1024 // 120 KB (§24)

export async function POST (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access
  if (access.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je zaključen.', 'Posnetkov ni mogoče dodajati zaključenemu zajemu.')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const clientKey = typeof body.clientKey === 'string' && body.clientKey.trim() ? body.clientKey.trim().slice(0, 100) : null
  if (!clientKey) return jsonError(400, 'Manjka clientKey.', 'Idempotenten ključ posnetka (offline vrsta, §17).')

  const zone = typeof body.zone === 'string' && body.zone ? body.zone : null
  if (!zone) return jsonError(400, 'Manjka zona.', 'zone = id postanka iz plan-a (§1).')

  // idempotentnost: ponovni POST z istim clientKey ne podvoji
  const existing = await db.capturePhoto.findUnique({
    where: { sessionId_clientKey: { sessionId: id, clientKey } },
  })
  if (existing) {
    const ctx = await loadCaptureContext(id)
    const analysis = ctx ? await analyzeSession(ctx) : null
    return NextResponse.json({ data: { id: existing.id, duplicate: true, analysis } })
  }

  const ctx = await loadCaptureContext(id)
  if (!ctx) return jsonError(404, 'Zajem ne obstaja.')

  // R542: plan je jsonb objekt — parsePlan neposredno
  const plan = ctx.plan.length > 0 ? ctx.plan : parsePlan(access.session.plan)
  if (!plan) return jsonError(500, 'Plan zajema ni berljiv.')
  const stop = plan.find((p) => p.id === zone)
  if (!stop) return jsonError(400, `Neznana zona »${zone}«.`, 'Zona mora biti postanek iz plan-a (§1).')

  const quality = body.quality !== undefined && body.quality !== null
    ? parseQuality(body.quality)
    : {}
  if (body.quality !== undefined && body.quality !== null && !quality) {
    return jsonError(400, 'Neveljavna kakovost.', 'quality: { dark?, bright?, blurry?, blurScore? }')
  }

  let offsetCm: number | null = null
  if (body.offsetCm !== undefined && body.offsetCm !== null) {
    if (typeof body.offsetCm !== 'number' || !Number.isFinite(body.offsetCm) || Math.abs(body.offsetCm) > 1000) {
      return jsonError(400, 'Neveljaven odmik registra.', 'offsetCm: število −1000..1000 (drift vzorec, §3).')
    }
    offsetCm = body.offsetCm
  }

  let thumb: string | null = null
  if (typeof body.thumb === 'string' && body.thumb) {
    if (!body.thumb.startsWith('data:image/')) return jsonError(400, 'Sličica mora biti data URL slike.')
    if (body.thumb.length > THUMB_MAX) return jsonError(400, 'Sličica prevelika.', `thumb ≤ ${THUMB_MAX / 1024} KB (§24).`)
    thumb = body.thumb
  }

  // R539 (transakcijska celovitost): posnetek + revizija CAPTURE_PHOTO v ENI
  // transakciji; sveža analiza (pokritost/drift — pisanje prek globalnega db)
  // ostane PO commitu, ker potrebuje VIDEN nov posnetek.
  const photo = await db.$transaction(async (tx) => {
    const photo = await tx.capturePhoto.create({
      data: {
        sessionId: id, clientKey, zone,
        // R542: jsonb — objekt direktno (ne JSON.stringify)
        quality: quality as unknown as Prisma.InputJsonValue,
        offsetCm,
        thumb,
      },
    })

    await writeAudit({
      userId: user.id,
      action: 'CAPTURE_PHOTO',
      entity: 'captureSession',
      entityId: id,
      projectId: access.session.projectId,
      detail: { photoId: photo.id, zone: stop.label, ...(offsetCm != null ? { offsetCm } : {}) },
    }, tx)

    return photo
  })

  const fresh = await loadCaptureContext(id)
  const analysis = fresh ? await analyzeSession(fresh) : null

  return NextResponse.json({ data: { id: photo.id, analysis } }, { status: 201 })
}

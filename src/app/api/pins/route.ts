import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { fenceRunZaUporabnika } from '@/lib/fence-run-access'
import { loadRunContext } from '@/lib/fence-run-service'
import {
  PIN_STATUSES, isPinStatus, parsePinTarget, validPinCoord, validPinInternalNote, validPinNote,
} from '@/lib/pin-core'

// /api/pins — PRIPETI KOMENTARJI (pini) tekača (R479 — issue #9 §7)
// GET  (measurements.read; isti obseg dostopa kot /api/fence-run/[id]/model):
//      ?fenceRunId=… (obvezno) [&status=ODPRTO|RESENO|ZAPRT] → seznam pinov
//      tekača (interno: z internalNote, avtorjem in reševalcem).
// POST (measurements.write): { fenceRunId, targetType, targetKey, x?, y?,
//      note, internalNote? } → nov pin. Validacija cilja je fail-closed:
//      seg-N mora OB NASTANKU obstajati (po njem velja snapshot — past #6:
//      ključi so izpeljava in se lahko premaknejo). Pripomba NE spreminja
//      mer (za to je obstoječi verify/confirm tok z revizijo).
// Reviziji: PIN_CREATE.

function pinRow (p: {
  id: string; fenceRunId: string; targetType: string; targetKey: string
  x: unknown; y: unknown; note: string; internalNote: string | null
  status: string; resolvedAt: Date | null
  author?: { id: string; name: string } | null; authorId?: string | null
  resolvedBy?: { id: string; name: string } | null; resolvedById?: string | null
  snapshot: string | null; createdAt: Date; updatedAt: Date
}) {
  return {
    id: p.id, fenceRunId: p.fenceRunId, targetType: p.targetType, targetKey: p.targetKey,
    x: p.x == null ? null : Number(p.x), y: p.y == null ? null : Number(p.y),
    note: p.note, internalNote: p.internalNote, status: p.status,
    resolvedAt: p.resolvedAt ? p.resolvedAt.toISOString() : null,
    author: p.author ? { id: p.author.id, name: p.author.name } : (p.authorId ? { id: p.authorId, name: null } : null),
    resolvedBy: p.resolvedBy ? { id: p.resolvedBy.id, name: p.resolvedBy.name } : (p.resolvedById ? { id: p.resolvedById, name: null } : null),
    snapshot: p.snapshot,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  }
}

const PIN_INCLUDE = {
  author: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
} as const

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const fenceRunId = url.searchParams.get('fenceRunId') ?? ''
  if (!fenceRunId) return jsonError(400, 'Manjka fenceRunId.')

  // IDOR — isti obseg dostopa kot tekač (monter: svoje naloge/svoje izmere)
  const scope = await fenceRunZaUporabnika(auth.user, fenceRunId)
  if (scope instanceof NextResponse) return scope

  const status = url.searchParams.get('status')
  if (status != null && status !== '' && !isPinStatus(status)) {
    return jsonError(400, 'Neveljaven status.', `Veljavni statusi: ${PIN_STATUSES.join(', ')}.`)
  }

  const pins = await db.reviewPin.findMany({
    where: { fenceRunId, ...(status ? { status } : {}) },
    include: PIN_INCLUDE,
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ data: pins.map(pinRow) })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null) as {
    fenceRunId?: string; targetType?: string; targetKey?: string
    x?: number; y?: number; note?: string; internalNote?: string
  } | null

  const fenceRunId = typeof body?.fenceRunId === 'string' ? body.fenceRunId : ''
  if (!fenceRunId) return jsonError(400, 'Manjka fenceRunId.')

  // IDOR — isti obseg dostopa kot tekač
  const scope = await fenceRunZaUporabnika(user, fenceRunId)
  if (scope instanceof NextResponse) return scope

  // ── validacija (pin-core — čist lib) ──
  if (!isPinTargetTypeSafe(body?.targetType)) {
    return jsonError(400, 'Neveljaven targetType.', 'Veljavni cilji: SEGMENT, VOZLISCE, FOTOGRAFIJA.')
  }
  const targetType = body.targetType
  const parsed = parsePinTarget(targetType, typeof body?.targetKey === 'string' ? body.targetKey : '')
  if (!parsed) {
    return jsonError(400, 'Neveljaven targetKey za cilj.', 'Pričakovano: seg-N (N ≥ 1), node-N (N ≥ 0) ali capturePhotoId (cuid).')
  }
  if (!validPinNote(body?.note)) {
    return jsonError(400, 'Manjka ali predolga opomba.', `Opomba je obvezna (1–2000 znakov).`)
  }
  if (!validPinInternalNote(body?.internalNote)) {
    return jsonError(400, 'Predolga interna opomba.', 'Interna opomba je omejena na 2000 znakov.')
  }
  if (!validPinCoord(body?.x) || !validPinCoord(body?.y)) {
    return jsonError(400, 'Neveljavna pozicija pina.', 'x/y morata biti števili v svetovnih cm modela (ali izpuščeni).')
  }

  // ── cilj mora OB NASTANKU obstajati (fail-closed; kasnejši premik odkrije snapshot) ──
  // R539: buildSnapshot je BRANJE pred verigo (segment/vozlišče/fotografija na
  // globalnem db) — ostaja izven tx po pravilu predbranj.
  const snapshot = await buildSnapshot(fenceRunId, targetType, parsed.targetKey, parsed.index)
  if (typeof snapshot === 'string' && snapshot.startsWith('ERR:')) {
    return jsonError(400, snapshot.slice(4))
  }

  // R539 (transakcijska celovitost): pin + revizija PIN_CREATE v ENI
  // transakciji — prej bi padec med njima pustil pin brez revizije
  // (zgodovina pregleda bi izgubila sled).
  const pin = await db.$transaction(async (tx) => {
    const created = await tx.reviewPin.create({
      data: {
        fenceRunId,
        authorId: user.id,
        targetType,
        targetKey: parsed.targetKey,
        x: body?.x ?? null,
        y: body?.y ?? null,
        note: (body?.note as string).trim(),
        internalNote: body?.internalNote?.trim() ? (body?.internalNote as string).trim() : null,
        snapshot: snapshot as string | null,
      },
      include: PIN_INCLUDE,
    })

    await writeAudit({
      userId: user.id, action: 'PIN_CREATE', entity: 'reviewPin', entityId: created.id,
      projectId: scope.run.projectId,
      detail: { fenceRunId, targetType, targetKey: parsed.targetKey, run: scope.run.name },
    }, tx)
    return created
  })

  return NextResponse.json({ data: pinRow(pin) }, { status: 201 })
}

function isPinTargetTypeSafe (v: unknown): v is 'SEGMENT' | 'VOZLISCE' | 'FOTOGRAFIJA' {
  return v === 'SEGMENT' || v === 'VOZLISCE' || v === 'FOTOGRAFIJA'
}

/**
 * Snapshot cilja ob nastanku pina (past #6): seg-N ključi so izpeljava
 * (order+1) — če se tekač spremeni, se lahko premaknejo na drugo geometrijo.
 * Pin zato hrani dokaz o takratnem stanju. Vrne 'ERR:<sporočilo>' ob napaki.
 */
async function buildSnapshot (
  fenceRunId: string,
  targetType: 'SEGMENT' | 'VOZLISCE' | 'FOTOGRAFIJA',
  targetKey: string,
  index: number | null
): Promise<string | null | `ERR:${string}`> {
  if (targetType === 'SEGMENT') {
    // seg-N → tekačev order je 0-based (N−1)
    const seg = await db.fenceSegment.findFirst({ where: { fenceRunId, order: (index as number) - 1 } })
    if (!seg) return `ERR:Segment ${targetKey} na tem tekaču ne obstaja.`
    return JSON.stringify({
      segmentLabel: targetKey, lengthCm: seg.lengthCm, angleDeg: seg.angleDeg,
      heightCm: seg.heightCm, status: seg.status, version: seg.version,
    })
  }
  if (targetType === 'VOZLISCE') {
    // node-N → indeks v vrsti vozlišč (sortirano po atCm, 0-based)
    const ctx = await loadRunContext(fenceRunId)
    const nodes = [...(ctx?.nodes ?? [])].sort((a, b) => a.atCm - b.atCm)
    const n = nodes[index as number]
    if (!n) return `ERR:Vozlišče ${targetKey} na tem tekaču ne obstaja.`
    return JSON.stringify({ label: targetKey, kind: n.kind, atCm: n.atCm, heightCm: n.heightCm ?? null })
  }
  // FOTOGRAFIJA — posnetek zajema, ki pripada TEMU tekaču
  const photo = await db.capturePhoto.findUnique({
    where: { id: targetKey },
    include: { session: { select: { fenceRunId: true, name: true } } },
  })
  if (!photo || photo.session.fenceRunId !== fenceRunId) {
    return 'ERR:Fotografija ne pripada temu tekaču.'
  }
  return JSON.stringify({
    sessionId: photo.sessionId, sessionName: photo.session.name,
    zone: photo.zone, capturedAt: photo.capturedAt.toISOString(),
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, managesAssignments, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { fenceRunZaUporabnika } from '@/lib/fence-run-access'
import {
  PIN_STATUSES, canTransitionPin, isPinStatus, validPinInternalNote, validPinNote,
} from '@/lib/pin-core'

// /api/pins/[id] — UREJANJE/BRISANJE pina (R479 — issue #9 §7)
// PATCH  (measurements.write): { status?, note?, internalNote? }
//   • prehodi statusov so ENSMERNI (pin-core): ODPRTO→RESENO|ZAPRT, RESENO→ZAPRT;
//     prehod nazaj ali iz zaprtega = 400 (revizija sledi zgodovini)
//   • ob rešitvi/zaprtju se zapiše resolvedAt/resolvedById
//   • ureja SAMO avtor ali pisarna (ADMIN/VODJA) — monter tuje pince ne ureja
// DELETE (measurements.write): SAMO ODPRTO pin avtorja ali ADMIN/VODJA
//   (rešen/zaprt pin je zgodovina — se ne briše, ostane v reviziji).
// IDOR: enak obseg dostopa kot tekač (fenceRunZaUporabnika).
// Reviziji: PIN_UPDATE (fromStatus→toStatus), PIN_DELETE.

type Params = { params: Promise<{ id: string }> }

const PIN_INCLUDE = {
  author: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
} as const

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

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const existing = await db.reviewPin.findUnique({ where: { id }, include: PIN_INCLUDE })
  if (!existing) return jsonError(404, 'Pin ne obstaja.')

  // IDOR — isti obseg dostopa kot tekač pina
  const scope = await fenceRunZaUporabnika(user, existing.fenceRunId)
  if (scope instanceof NextResponse) return scope

  // samo avtor ali pisarna (ADMIN/VODJA)
  if (existing.authorId !== user.id && !managesAssignments(user)) {
    return jsonError(403, 'Pin lahko ureja samo avtor ali pisarna.', 'Monter vidi pince, tuje pa ne ureja.')
  }

  const body = await req.json().catch(() => null) as {
    status?: string; note?: string; internalNote?: string | null
  } | null

  const patch: {
    status?: string; note?: string; internalNote?: string | null
    resolvedAt?: Date | null; resolvedById?: string | null
  } = {}

  // ── prehod statusa (ENSMEREN — pin-core) ──
  let fromStatus: string | null = null
  let toStatus: string | null = null
  if (body?.status != null) {
    if (!isPinStatus(body.status)) {
      return jsonError(400, 'Neveljaven status.', `Veljavni statusi: ${PIN_STATUSES.join(', ')}.`)
    }
    if (body.status !== existing.status) {
      if (!isPinStatus(existing.status) || !canTransitionPin(existing.status, body.status)) {
        return jsonError(400, 'Prehod statusa ni dovoljen.',
          `Dovoljeni prehodi: ODPRTO→RESENO/ZAPRT, RESENO→ZAPRT — nazaj se ne vrača (zgodovina se vidi v reviziji). Prejet: ${existing.status}→${body.status}.`)
      }
      fromStatus = existing.status
      toStatus = body.status
      patch.status = body.status
      // rešitev/odprtje: zapiši reševalca (OBDRŽI prvotnega ob RESENO→ZAPRT)
      if (existing.resolvedAt == null) {
        patch.resolvedAt = new Date()
        patch.resolvedById = user.id
      }
    }
  }

  // ── opombe ──
  if (body?.note !== undefined) {
    if (!validPinNote(body.note)) {
      return jsonError(400, 'Manjka ali predolga opomba.', 'Opomba je obvezna (1–2000 znakov).')
    }
    patch.note = body.note.trim()
  }
  if (body?.internalNote !== undefined) {
    if (!validPinInternalNote(body.internalNote)) {
      return jsonError(400, 'Predolga interna opomba.', 'Interna opomba je omejena na 2000 znakov.')
    }
    patch.internalNote = body.internalNote == null ? null : (body.internalNote.trim() ? body.internalNote.trim() : null)
  }

  if (Object.keys(patch).length === 0) {
    return jsonError(400, 'Nič za spremembo.', 'Podprta polja: status, note, internalNote.')
  }

  const pin = await db.reviewPin.update({
    where: { id },
    data: patch,
    include: PIN_INCLUDE,
  })

  await writeAudit({
    userId: user.id, action: 'PIN_UPDATE', entity: 'reviewPin', entityId: id,
    projectId: scope.run.projectId,
    detail: {
      fenceRunId: existing.fenceRunId,
      ...(fromStatus && toStatus ? { fromStatus, toStatus } : {}),
      fields: Object.keys(patch).filter((k) => k !== 'resolvedAt' && k !== 'resolvedById'),
    },
  })

  return NextResponse.json({ data: pinRow(pin) })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const existing = await db.reviewPin.findUnique({ where: { id }, include: PIN_INCLUDE })
  if (!existing) return jsonError(404, 'Pin ne obstaja.')

  // IDOR — isti obseg dostopa kot tekač pina
  const scope = await fenceRunZaUporabnika(user, existing.fenceRunId)
  if (scope instanceof NextResponse) return scope

  if (existing.authorId !== user.id && !managesAssignments(user)) {
    return jsonError(403, 'Pin lahko briše samo avtor ali pisarna.')
  }
  if (existing.status !== 'ODPRTO') {
    return jsonError(409, 'Zaključenega pina ni mogoče brisati.',
      'Rešen/zaprt pin je del zgodovine pregleda — ostane zapisan (sledljivost).')
  }

  await db.reviewPin.delete({ where: { id } })
  await writeAudit({
    userId: user.id, action: 'PIN_DELETE', entity: 'reviewPin', entityId: id,
    projectId: scope.run.projectId,
    detail: { fenceRunId: existing.fenceRunId, targetType: existing.targetType, targetKey: existing.targetKey },
  })

  return NextResponse.json({ data: { deleted: true, id } })
}

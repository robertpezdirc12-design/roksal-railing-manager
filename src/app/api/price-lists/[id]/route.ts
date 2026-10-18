import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { jePriceListStatus } from '@/lib/price-approval-core'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/price-lists/[id] — R564 (issue #24): življenjski cikel cenika.
// Telo: { status: DEMO | DRAFT | PENDING_APPROVAL | APPROVED, source?, reason? }
//
// Pravila:
//  • prehod V APPROVED zahteva izrecen `source` (vir uradnih podatkov, npr.
//    „roksal-uradni-cenik-2026.xlsx“) — brez vira ne odobrimo (NI_DOKAZA);
//  • odobritev zapiše kdo (approvedById) in kdaj (approvedAt) + revizijo
//    PRICE_LIST_APPROVE; umik (katerikoli prehod IZ APPROVED) zahteva reason
//    in zapiše PRICE_LIST_REVOKE — odobritev NI tiha;
//  • sprememba cenika po odobritvi (nova pravila prek /rules ali uvoza) V
//    praksi pomeni novo različico — zato vsak prehod V APPROVED poveča
//    version (sledljivost snapshotov ponudb po različici).
export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'price.override')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const list = await db.priceList.findUnique({ where: { id } })
  if (!list) return jsonError(404, 'Cenik ne obstaja.')

  const body = await req.json().catch(() => null)
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!jePriceListStatus(status)) {
    return jsonError(400, 'Neveljaven status cenika.', 'Dovoljeni: DEMO, DRAFT, PENDING_APPROVAL, APPROVED.')
  }
  if (status === list.status) return jsonError(400, `Cenik je že v statusu ${status}.`)

  const source = typeof body?.source === 'string' && body.source.trim() ? body.source.trim().slice(0, 200) : null
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : null

  // V APPROVED: vir je obvezen (dokaz, od kod cene) — issue #24 točka 2.
  if (status === 'APPROVED' && !source) {
    return jsonError(400, 'Odobritev zahteva vir podatkov.', 'Podajte source (npr. ime uradne datoteke cenika ali „roksal-uradni-cenik“).')
  }
  // Umik odobritve: razlog je obvezen (sledljivost).
  if (list.status === 'APPROVED' && status !== 'APPROVED' && !reason) {
    return jsonError(400, 'Umik odobritve zahteva razlog.', 'Podajte reason (zapisan v revizijo PRICE_LIST_REVOKE).')
  }

  const bilOdobren = list.status === 'APPROVED'
  const updated = await db.priceList.update({
    where: { id },
    data: {
      status,
      // odobritev vedno zapiše kdo/kdaj/vir; umik izprazni odobritev, a ohrani source za sled
      approvedById: status === 'APPROVED' ? user.id : null,
      approvedAt: status === 'APPROVED' ? new Date() : null,
      source: source ?? list.source,
      // vsak prehod V APPROVED = nova odobrena različica (snapshoti vežejo po njej)
      version: status === 'APPROVED' ? list.version + 1 : list.version,
    },
  })

  await writeAudit({
    userId: user.id,
    action: status === 'APPROVED' ? 'PRICE_LIST_APPROVE' : bilOdobren ? 'PRICE_LIST_REVOKE' : 'PRICE_LIST_STATUS',
    entity: 'priceList',
    entityId: id,
    detail: {
      status: updated.status,
      version: updated.version,
      source: updated.source,
      reason,
      approvedAt: updated.approvedAt,
    },
  })

  return NextResponse.json({
    data: {
      id: updated.id,
      status: updated.status,
      version: updated.version,
      source: updated.source,
      approvedAt: updated.approvedAt,
      approvedById: updated.approvedById,
    },
  })
}

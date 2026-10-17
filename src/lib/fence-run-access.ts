// fence-run-access — obseg dostopa do ograjnih tekačev (R460 — issue #15 §20/§22)
// IDOR-varnost (vzorec photo-replace-engine): pisarna (ADMIN/VODJA/SKLADIŠČE/
// PROIZVODNJA) vidi vse tekače; monter SAMO tekače svojih nalog ALI svoje
// (avtor). Fail-closed: brez ustreznega obsega → 403.

import type { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/auth'
import type { SessionUser } from '@/lib/auth'

export function bereVseTekače (user: { role: string }): boolean {
  return ['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA'].includes(user.role)
}

/** Tekač + obseg dostopa (avtor ali nalog projekta; pisarna vidi vse). */
export async function fenceRunZaUporabnika (
  user: SessionUser,
  id: string
): Promise<
  | {
    run: {
      id: string; projectId: string; authorId: string | null; status: string
      name: string; note: string | null; productId: string | null; variantId: string | null
      measurementId: string | null; workOrderId: string | null
      calibration: Prisma.JsonValue; terrain: Prisma.JsonValue; nodes: Prisma.JsonValue; quality: Prisma.JsonValue
      createdAt: Date; updatedAt: Date
    }
    projectCode: string
  }
  | NextResponse
> {
  const run = await db.fenceRun.findUnique({ where: { id } })
  if (!run) return jsonError(404, 'Tekač ne obstaja.')
  if (!bereVseTekače(user) && run.authorId !== user.id) {
    const wo = await db.workOrder.findFirst({
      where: { projectId: run.projectId, assigneeId: user.id },
      select: { id: true },
    })
    if (!wo) {
      return jsonError(403, 'Tekač ni na voljo vašim nalogom.', 'Monter vidi samo tekače svojih projektov ali svoje izmere.')
    }
  }
  const project = await db.project.findUnique({ where: { id: run.projectId }, select: { code: true } })
  return {
    run: {
      id: run.id, projectId: run.projectId, authorId: run.authorId, status: run.status,
      name: run.name, note: run.note, productId: run.productId, variantId: run.variantId,
      measurementId: run.measurementId, workOrderId: run.workOrderId,
      calibration: run.calibration, terrain: run.terrain, nodes: run.nodes, quality: run.quality,
      createdAt: run.createdAt, updatedAt: run.updatedAt,
    },
    projectCode: project?.code ?? '',
  }
}

/** Projektni filter za seznam: monter → samo projekti svojih nalog. */
export async function projectIdsZaUporabnika (user: SessionUser): Promise<string[] | null> {
  if (bereVseTekače(user)) return null // null = brez filtra (vidi vse)
  const wos = await db.workOrder.findMany({ where: { assigneeId: user.id }, select: { projectId: true } })
  const ids = [...new Set(wos.map((w) => w.projectId).filter((p): p is string => p !== null))]
  return ids
}

// capture-qa-access — obseg dostopa do zajemov in digitalnega dvojčka
// (R461 — issue #16 §23). IDOR-varnost (vzorec fence-run-access): pisarna
// (ADMIN/VODJA/SKLADIŠČE/PROIZVODNJA) vidi vse; monter SAMO svoje zajeme
// ALI zajeme projektov svojih nalog. Fail-closed: brez ustreznega obsega → 403.

import type { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/auth'
import type { SessionUser } from '@/lib/auth'
import { projectIdsZaUporabnika } from '@/lib/fence-run-access'

export interface CaptureSessionRow {
  id: string
  projectId: string
  workOrderId: string | null
  fenceRunId: string | null
  authorId: string | null
  name: string
  status: string
  mode: string
  device: string | null
  outdoor: string | null
  plan: string | null
  state: string | null
  coverage: string | null
  drift: string | null
  snapshotId: string | null
  note: string | null
  createdAt: Date
  updatedAt: Date
}

/** Zajem + obseg dostopa (avtor ali nalog projekta; pisarna vidi vse). */
export async function captureSessionZaUporabnika (
  user: SessionUser,
  id: string
): Promise<{ session: CaptureSessionRow; projectCode: string } | NextResponse> {
  const s = await db.captureSession.findUnique({ where: { id } })
  if (!s) return jsonError(404, 'Zajem ne obstaja.')
  const bereVse = ['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA'].includes(user.role)
  if (!bereVse && s.authorId !== user.id) {
    const wo = await db.workOrder.findFirst({
      where: { projectId: s.projectId, assigneeId: user.id },
      select: { id: true },
    })
    if (!wo) {
      return jsonError(403, 'Zajem ni na voljo vašim nalogom.', 'Monter vidi samo svoje zajeme ali zajeme projektov svojih delovnih nalogov.')
    }
  }
  const project = await db.project.findUnique({ where: { id: s.projectId }, select: { code: true } })
  return {
    session: {
      id: s.id, projectId: s.projectId, workOrderId: s.workOrderId, fenceRunId: s.fenceRunId,
      authorId: s.authorId, name: s.name, status: s.status, mode: s.mode,
      device: s.device, outdoor: s.outdoor, plan: s.plan, state: s.state,
      coverage: s.coverage, drift: s.drift, snapshotId: s.snapshotId, note: s.note,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    },
    projectCode: project?.code ?? '',
  }
}

/** Projektni filter za sezname: monter → samo projekti svojih nalog. */
export async function captureProjectIds (user: SessionUser): Promise<string[] | null> {
  return projectIdsZaUporabnika(user)
}

/** Preveri obseg dostopa do PROJEKTA (za twin): monter potrebuje nalog. */
export async function projektDostopen (user: SessionUser, projectId: string): Promise<boolean> {
  if (['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA'].includes(user.role)) return true
  const wo = await db.workOrder.findFirst({
    where: { projectId, assigneeId: user.id },
    select: { id: true },
  })
  return wo != null
}

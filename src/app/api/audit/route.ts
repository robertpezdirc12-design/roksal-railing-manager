// /api/audit — REKONSTRUKCIJA R428 semantike:
//   ?projectId=x  → per-projekt pregled (vrata: audit.read)
//   brez projectId → SISTEMSKI (globalni) pregled (vrata: audit.read + obseg vodenja readsAllProjects)
//   projectId=''  → 400 fail-closed

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { readAudit, readAuditGlobal } from '@/lib/audit'
import { READS_ALL_PROJECTS } from '@/lib/permissions-core'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'audit.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const limit = Number(url.searchParams.get('limit') ?? 100)
  const action = url.searchParams.get('action') ?? undefined
  const userIdFilter = url.searchParams.get('userId') ?? undefined

  if (projectId === '') {
    // fail-closed (R428): prazen niz ni niti per-projekt niti sistemski pogled
    return jsonError(400, 'Neveljaven obseg.', 'projectId mora biti podan ali izpuščen (sistemski pogled).')
  }

  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
    const entries = await readAudit(projectId, { limit })
    return NextResponse.json({ scope: 'projekt', projectId, data: entries })
  }

  // sistemski pogled — vrata 2/2: obseg vodenja (R428: MONTER ima audit.read? ne — vstopi tu)
  if (!READS_ALL_PROJECTS.includes(user.role as never)) {
    return jsonError(403, 'Sistemski dnevnik zahteva obseg vodenja.', 'Za sled projekta uporabi projectId parameter.')
  }
  const entries = await readAuditGlobal({ limit, action, userId: userIdFilter })
  return NextResponse.json({ scope: 'sistemski', data: entries })
}

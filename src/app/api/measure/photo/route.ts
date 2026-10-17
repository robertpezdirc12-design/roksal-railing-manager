// /api/measure/photo — nalaganje fotografije s terena (issue #1: napredne meritve s kamero)
// POST { dataUrl, projectId?, workOrderId?, location? } (measurements.write)
// Ustvari meritev tipa FOTO (fotografski zapis) → id služi kot photoId za
// nadaljnje večtočkovne meritve (detect/confirm). Več meritev na isti fotografiji.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { photoRecordProvenance } from '@/lib/measure-engine'
import { writeAudit } from '@/lib/audit'

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB dataURL-a (~6 MB slike)

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : ''
  if (!dataUrl.startsWith('data:image/')) {
    return jsonError(400, 'Manjka fotografija.', 'Pričakovan je dataUrl (data:image/…;base64).')
  }
  if (dataUrl.length > MAX_BYTES) {
    return jsonError(413, 'Fotografija je prevelika.', 'Največja dovoljena velikost je 8 MB.')
  }

  const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
  const workOrderId = typeof body.workOrderId === 'string' && body.workOrderId ? body.workOrderId : null

  let project: { id: string } | null = null
  if (projectId) {
    project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return jsonError(400, 'Projekt ne obstaja.', 'Podan projectId ni veljaven.')
  }

  let workOrder: { id: string; projectId: string | null } | null = null
  if (workOrderId) {
    workOrder = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, projectId: true } })
    if (!workOrder) return jsonError(400, 'Nalog ne obstaja.', 'Podan workOrderId ni veljaven.')
  }

  const zapis = photoRecordProvenance()
  // R539 (transakcijska celovitost): fotografska meritev + revizija
  // PHOTO_UPLOAD v ENI transakciji — prej bi padec med njima pustil meritev
  // brez revizije (nalaganje bi izginilo iz sledi).
  const photo = await db.$transaction(async (tx) => {
    const created = await tx.measurement.create({
      data: {
        type: 'FOTO',
        source: 'KAMERA',
        status: zapis.status,
        statusNote: zapis.reason,
        projectId: projectId ?? workOrder?.projectId ?? null,
        workOrderId,
        authorId: user.id,
        location: typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null,
        // R542: jsonb — objekt direktno (ne JSON.stringify)
        params: { photo: dataUrl, stage: 'ZAJEM' },
      },
      include: {
        author: { select: { name: true } },
        project: { select: { id: true, code: true, title: true } },
        workOrder: { select: { id: true, code: true, title: true } },
      },
    })

    await writeAudit({
      userId: user.id,
      action: 'PHOTO_UPLOAD',
      entity: 'measurement',
      entityId: created.id,
      projectId: created.projectId,
      detail: { workOrderId: workOrderId ?? null, bytes: dataUrl.length, location: created.location },
    }, tx)
    return created
  })

  return NextResponse.json({ data: photo }, { status: 201 })
}

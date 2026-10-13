// /api/measure-engine/export — izvoz potrjene meritve (issue #12 §19)
// GET ?id=<measurementId>&format=csv|json (measurements.read)
// Izvozi celoten dokument meritve: projekt, objekt, datum, operater,
// reference (kalibracija), mere z enotami, confidence, fotografijo in
// verzijo (MeasurementVersion) — CSV (podpično, UTF-8 BOM) ali JSON.
// Vsak izvoz se zapiše v revizijo (MEASUREMENT_EXPORT).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { buildExportRows, exportCsv, MEASURE_MODES, type ExportSource } from '@/lib/measure-engine'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const format = url.searchParams.get('format') ?? 'json'
  if (!id) return jsonError(400, 'Manjka id meritve.')
  if (format !== 'csv' && format !== 'json') {
    return jsonError(400, 'Neveljaven format.', 'Podprite formata: csv, json.')
  }

  const m = await db.measurement.findUnique({
    where: { id },
    include: {
      author: { select: { name: true } },
      project: { select: { code: true, title: true } },
      workOrder: { select: { code: true, title: true } },
      versions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
    },
  })
  if (!m) return jsonError(404, 'Meritev ne obstaja.')

  let params: ExportSource['params'] = null
  try {
    params = m.params ? (JSON.parse(m.params) as ExportSource['params']) : null
  } catch { params = null }
  // način izmere: params.mode (R457) — sicer pade na legacy tip
  const mode = params?.mode != null && (MEASURE_MODES as string[]).includes(String(params.mode))
    ? String(params.mode)
    : undefined

  const src: ExportSource = {
    id: m.id,
    createdAt: m.createdAt.toISOString(),
    type: m.type,
    mode,
    location: m.location,
    lengthCm: m.lengthCm,
    heightCm: m.heightCm,
    slopeDeg: m.slopeDeg,
    posts: m.posts,
    segments: m.segments,
    note: m.note,
    source: m.source,
    status: m.status,
    statusNote: m.statusNote,
    authorName: m.author?.name ?? null,
    projectCode: m.project?.code ?? null,
    projectTitle: m.project?.title ?? null,
    workOrderCode: m.workOrder?.code ?? null,
    workOrderTitle: m.workOrder?.title ?? null,
    version: m.versions[0]?.version ?? 1,
    params,
  }

  await writeAudit({
    userId: user.id,
    action: 'MEASUREMENT_EXPORT',
    entity: 'measurement',
    entityId: m.id,
    projectId: m.projectId,
    detail: { format, mode: mode ?? m.type, lengthCm: m.lengthCm },
  })

  if (format === 'csv') {
    const csv = '\uFEFF' + exportCsv(src) // BOM za Excel
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="roksal-meritev-${m.id.slice(-8)}.csv"`,
      },
    })
  }
  return NextResponse.json({
    data: {
      id: src.id,
      projekt: src.projectCode ? { koda: src.projectCode, naslov: src.projectTitle } : null,
      nalog: src.workOrderCode ? { koda: src.workOrderCode, naslov: src.workOrderTitle } : null,
      lokacija: src.location ?? null,
      datum: src.createdAt,
      operater: src.authorName ?? null,
      tip: src.type,
      nacin: mode ?? null,
      vir: src.source ?? null,
      verzija: src.version ?? 1,
      mere: buildExportRows(src).map((r) => ({ skupina: r.skupina, polje: r.polje, vrednost: r.vrednost, enota: r.enota })),
      opomba: src.note ?? null,
    },
  }, {
    status: 200,
    headers: { 'Content-Disposition': `attachment; filename="roksal-meritev-${m.id.slice(-8)}.json"` },
  })
}

// /api/measure-engine/export — izvoz potrjene mere (issue #12 §19)
// GET ?id=<measurementId>&format=csv|json[&originals=1] (measurements.read)
// Izvozi celoten dokument meritve: projekt, objekt, datum, operater,
// reference (kalibracija), mere z enotami, confidence, fotografijo in
// verzijo (MeasurementVersion) — CSV (podpisno, UTF-8 BOM) ali JSON.
// R509 (issue #7 §8): JSON nosi DOKAZNO VERIGO — `originali` (SHA-256 +
// velikost vsake fotografije; z `originals=1` tudi binarno vsebino) in
// `zgodovina` (vse MeasurementVersion verzije z avtorjem, časom in opombo).
// Vsak izvoz se zapiše v revizijo (MEASUREMENT_EXPORT).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { fotografiIzParametrov, originalDokaz } from '@/lib/original-proof'
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
      // R509 (issue #7 §8): celotna zgodovina sprememb (ne samo zadnja) — pisarna
      // in izvoz vidita, KDO in KADAJ je meritev spremenil in s kakšno opombo.
      versions: { select: { version: true, note: true, createdAt: true, user: { select: { name: true } } }, orderBy: { version: 'desc' } },
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

  // ── R509 (issue #7 §8): ORIGINALI FOTOGRAFIJ + ZGODOVINA SPREMEMB ──────────
  // Doslej je izvoz vseboval samo mere in sklic na fotografijo — dokumentacijska
  // veriga (kater ORIGINAL je bil merjen, ali se je med tem spremenil) ni bila
  // izvozljiva. Iz originalov vedno izpostavimo vsaj SHA-256 in velikost
  // (dokaz o nespremenjenosti), binarno vsebino pa dodamo SAMO ob izrecni
  // zahtevi `originals=1`, da osnovni izvoz ostane majhen in branljiv.
  const ids = fotografiIzParametrov(m.params)
  const zelBytes = url.searchParams.get('originals') === '1'
  const originali = ids.length === 0 ? [] : await db.measurement
    .findMany({ where: { id: { in: ids } }, select: { id: true, createdAt: true, location: true, source: true, params: true } })
    .then((vrsti) => vrsti.map((vr) => {
      const d = originalDokaz(vr)
      return {
        id: d.id,
        zajeto: d.zajeto,
        lokacija: d.lokacija,
        vir: d.vir,
        format: d.format,
        bayti: d.bayti,
        sha256: d.sha256,
        ...(zelBytes ? { vsebina: d.dataUrl } : {}),
      }
    }))
  const zgodovina = m.versions.map((v) => ({
    verzija: v.version,
    kdaj: v.createdAt.toISOString(),
    avtor: v.user?.name ?? null,
    opomba: v.note ?? null,
  }))

  await writeAudit({
    userId: user.id,
    action: 'MEASUREMENT_EXPORT',
    entity: 'measurement',
    entityId: m.id,
    projectId: m.projectId,
    detail: {
      format, mode: mode ?? m.type, lengthCm: m.lengthCm,
      // R509: izvoz je dokazni dokument — v reviziji sta SHA-256 vsakega
      // originala in število verzij, da je kasneje mogoče utrditi, KAJ je bilo
      // izvozeno (brez binarnih vsebin v reviziji).
      originali: originali.map((o) => ({ id: o.id, sha256: o.sha256, bayti: o.bayti })),
      verzij: zgodovina.length,
      zVsebino: zelBytes,
    },
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
      // R509 (issue #7 §8): dokazna veriga — originali (SHA-256 + velikost,
      // ob `originals=1` tudi vsebina) in CELOTNA zgodovina sprememb z avtorji.
      originali,
      zgodovina,
    },
  }, {
    status: 200,
    headers: { 'Content-Disposition': `attachment; filename="roksal-meritev-${m.id.slice(-8)}.json"` },
  })
}

// /api/nalog/[id]/handover — R489 (issue #12 §2D): PRIMOPREDAJA.
// GET   (nalog.read)  — najnovejše poročilo + seznam verzij (zgodovina).
// POST  (nalog.write) — zgradi NOVO verzijo poročila iz istih podatkov:
//   primerjava načrtovano/potrjeno/izvedeno (seg-N, vir vsake mere), fotografije
//   pred/med/po, POTRJENA kosovnica; prejšnje verzije ostanejo — revizija
//   HANDOVER_CREATE.
// PATCH (nalog.write) — akcije nad obstoječo verzijo:
//   • monter-confirm — potrditev monterja (kdo/kdaj) — HANDOVER_MONTER_CONFIRM
//   • sign — podpis STRANKE na zaslonu: { signatureDataUrl (≤2 MB), signedBy }
//     — ZABELEŽENA potrditev, ne kvalificiran e-podpis — HANDOVER_SIGN
//   • remark — pripomba stranke (sledljiv zapis) — HANDOVER_REMARK
//   • summary — povzetek izvedbe — HANDOVER_SUMMARY
//   Po vsaki spremembi se status poročila ponovno izračuna
//   (ZAKLJUCENA | POGOJNA | NEPOPOLNA — nikoli navidezen popoln zaključek).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { MAX_SIGNATURE_BYTES, obsegNaloga, osveziStatusPorocila, zgradiPorocilo } from '@/lib/montaza-qa-core'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const scoped = await obsegNaloga(auth.user, id)
  if (scoped.error || !scoped.wo) return jsonError(scoped.conflict ? 403 : 404, scoped.error ?? 'Nalog ne obstaja.')

  const [latest, versions] = await Promise.all([
    db.handoverReport.findFirst({
      where: { workOrderId: id },
      orderBy: { version: 'desc' },
      include: { monterConfirmedBy: { select: { name: true } }, createdBy: { select: { name: true } } },
    }),
    db.handoverReport.findMany({
      where: { workOrderId: id },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, createdAt: true, customerSignedAt: true, monterConfirmedAt: true },
    }),
  ])
  return NextResponse.json({ data: { latest, versions } })
}

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  const summary = typeof body?.summary === 'string' ? body.summary : undefined

  const rez = await zgradiPorocilo(auth.user, id, summary)
  if (rez.error && !rez.data) return jsonError(rez.status ?? (rez.conflict ? 409 : 400), rez.error)

  const row = await db.handoverReport.findUnique({
    where: { id: (rez.data as { id: string }).id },
    include: { monterConfirmedBy: { select: { name: true } }, createdBy: { select: { name: true } } },
  })
  return NextResponse.json({ data: row }, { status: 201 })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'nalog.write')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')
  const action = typeof body.action === 'string' ? body.action : ''

  // poročilo: eksplicitno po id (verzija!) ali najnovejša
  let row = typeof body.reportId === 'string' && body.reportId
    ? await db.handoverReport.findUnique({ where: { id: body.reportId } })
    : await db.handoverReport.findFirst({ where: { workOrderId: id }, orderBy: { version: 'desc' } })
  if (!row || row.workOrderId !== id) return jsonError(404, 'Poročilo primopredaje ne obstaja za ta nalog.')

  const scoped = await obsegNaloga(auth.user, id)
  if (scoped.error || !scoped.wo) return jsonError(scoped.conflict ? 403 : 404, scoped.error ?? 'Nalog ne obstaja.')

  const now = new Date()

  if (action === 'monter-confirm') {
    if (row.monterConfirmedAt) return jsonError(409, 'Monter je to verzijo že potrdil.', 'Potrditev velja za verzijo poročila; za spremembo zgradite novo verzijo.')
    row = await db.handoverReport.update({
      where: { id: row.id },
      data: { monterConfirmedAt: now, monterConfirmedById: auth.user.id },
    })
    await writeAudit({
      userId: auth.user.id, action: 'HANDOVER_MONTER_CONFIRM', entity: 'handoverReport', entityId: row.id,
      projectId: row.projectId, detail: { workOrder: scoped.wo.code, version: row.version },
    })
  } else if (action === 'sign') {
    if (row.customerSignedAt) return jsonError(409, 'Stranka je to verzijo že podpisala.', 'Za spremembo zgradite novo verzijo poročila — ta podpis ostane v zgodovini.')
    const signatureDataUrl = typeof body.signatureDataUrl === 'string' ? body.signatureDataUrl : ''
    const signedBy = typeof body.signedBy === 'string' ? body.signedBy.trim() : ''
    if (!signedBy) return jsonError(400, 'Manjka ime/identiteta podpisnika (v obsegu dovoljenj).')
    if (signedBy.length > 120) return jsonError(400, 'Ime podpisnika je predolgo (največ 120 znakov).')
    if (!signatureDataUrl.startsWith('data:image/')) {
      return jsonError(400, 'Manjka podpis na zaslonu.', 'Pričakovan je dataUrl slike (data:image/…;base64).')
    }
    if (signatureDataUrl.length > MAX_SIGNATURE_BYTES) {
      return jsonError(400, 'Podpis je prevelik.', 'Največja dovoljena velikost je 2 MB.')
    }
    // opomba stranke iz podpisnega obrazca (neobvezna) — postane sledljiv zapis,
    // NE sme tihe izginiti (issue #12 §2D)
    const remark = typeof body.remark === 'string' ? body.remark.trim() : ''
    if (remark.length > 1000) return jsonError(400, 'Pripomba je predolga (največ 1000 znakov).')
    row = await db.handoverReport.update({
      where: { id: row.id },
      data: {
        customerSignature: signatureDataUrl,
        customerSignedAt: now,
        customerSignedBy: signedBy,
        ...(remark ? { customerRemark: remark } : {}),
      },
    })
    await writeAudit({
      userId: auth.user.id, action: 'HANDOVER_SIGN', entity: 'handoverReport', entityId: row.id,
      projectId: row.projectId,
      detail: {
        workOrder: scoped.wo.code, version: row.version, signedBy,
        ...(remark ? { remark: remark.slice(0, 200) } : {}),
        vrsta: 'ZABELEŽENA potrditev (ne kvalificiran e-podpis)',
      },
    })
  } else if (action === 'remark') {
    const remark = typeof body.remark === 'string' ? body.remark.trim() : ''
    // prazna pripomba = IZRECEN izbris (pisarna/monter rešuje odprto postavko);
    // zgodovina ostaja v reviziji in starih verzijah poročila
    if (remark.length > 1000) return jsonError(400, 'Pripomba je predolga (največ 1000 znakov).')
    if (!remark && !row.customerRemark) {
      return jsonError(400, 'Ni pripombe za izbris.')
    }
    const prej = row.customerRemark
    row = await db.handoverReport.update({ where: { id: row.id }, data: { customerRemark: remark || null } })
    await writeAudit({
      userId: auth.user.id, action: 'HANDOVER_REMARK', entity: 'handoverReport', entityId: row.id,
      projectId: row.projectId,
      detail: { workOrder: scoped.wo.code, version: row.version, remark: remark.slice(0, 200) || null, prej: prej?.slice(0, 200) ?? null, izbris: !remark },
    })
  } else if (action === 'summary') {
    const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
    if (!summary) return jsonError(400, 'Povzetek je obvezen.')
    if (summary.length > 2000) return jsonError(400, 'Povzetek je predolg (največ 2000 znakov).')
    row = await db.handoverReport.update({ where: { id: row.id }, data: { summary } })
    await writeAudit({
      userId: auth.user.id, action: 'HANDOVER_SUMMARY', entity: 'handoverReport', entityId: row.id,
      projectId: row.projectId, detail: { workOrder: scoped.wo.code, version: row.version },
    })
  } else {
    return jsonError(400, 'Neznana akcija.', 'Veljavne akcije: monter-confirm, sign, remark, summary.')
  }

  // status se po vsaki spremembi ponovno izračuna (iz stanja, ne iz UI-ja)
  const status = await osveziStatusPorocila(row.id)
  row = await db.handoverReport.findUnique({
    where: { id: row.id },
    include: { monterConfirmedBy: { select: { name: true } }, createdBy: { select: { name: true } } },
  }) ?? row
  return NextResponse.json({ data: { ...row, status } })
}

// /api/claims — REKLAMACIJE (R446, issue #7 §10, P2 SERVIS).
// GET  (projects.read + pisarna/readsAllData) — seznam z relacijami; ?status=&projectId=&customerId=.
//      Reklamacije vsebujejo opise težav strank → vodi jih PISARNA (ADMIN/VODJA/
//      SKLADISCE/PROIZVODNJA); monter ne vidi claims (fail-closed 403) — svoje
//      servisne obiske dobi prek /api/service-cases (obseg po obiskih).
// POST (projects.write + pisarna) — nova reklamacija {customerId, projectId, packageId?,
//      warrantyId?, title, desc, channel?, reportedBy?}; koda REK-{leto}-NNN.
//      Validacije: tuji ID-ji → 404; prazna title/desc → 400; warranty/paket iz
//      tujega projekta → 409. Revizija CLAIM_CREATE s projectId.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextCodeFromList } from '@/lib/codes'
import { CLAIM_CHANNELS, CLAIM_INCLUDE } from '@/lib/service-core'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // obseg (fail-closed): reklamacije vodi pisarna — monterju ni dostopno
  if (!readsAllData(user)) {
    return jsonError(403, 'Reklamacije vodi pisarna.', 'Opisi težav strank so interni; monter dobi svoje servisne obiske prek modula Servis.')
  }

  const sp = new URL(req.url).searchParams
  const status = sp.get('status')
  const projectId = sp.get('projectId')
  const customerId = sp.get('customerId')

  const rows = await db.claim.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(projectId ? { projectId } : {}),
      ...(customerId ? { customerId } : {}),
    },
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
  return NextResponse.json({ data: rows })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // pisarniška mutacija (vzorec /api/deliveries POST): monterjev terenski
  // projects.write tu NE zadostuje — reklamacije odpira pisarna
  if (!readsAllData(user)) {
    return jsonError(403, 'Reklamacije odpira pisarna.', 'Terenski uporabniki nimajo dostopa do reklamacij strank.')
  }

  const body = await req.json().catch(() => null) as {
    customerId?: string; projectId?: string; packageId?: string; warrantyId?: string
    title?: string; desc?: string; channel?: string; reportedBy?: string
  } | null

  // ── obvezna eksplicitna vezava: stranka + projekt ──────────────────────────
  const customerId = typeof body?.customerId === 'string' ? body.customerId : ''
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!customerId) return jsonError(400, 'Manjka stranka.')
  if (!projectId) return jsonError(400, 'Manjka projekt.')

  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } })
  if (!customer) return jsonError(404, 'Stranka ne obstaja.')

  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, title: true, customerId: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')
  if (project.customerId && project.customerId !== customerId) {
    return jsonError(409, 'Projekt pripada drugi stranki.', 'Reklamacija mora vezati stranko in njen projekt.')
  }

  // ── opcijski paket (del projekta) ──────────────────────────────────────────
  let packageId: string | null = null
  if (typeof body?.packageId === 'string' && body.packageId) {
    const pkg = await db.projectPackage.findUnique({ where: { id: body.packageId }, select: { id: true, projectId: true, name: true } })
    if (!pkg) return jsonError(404, 'Paket projekta ne obstaja.')
    if (pkg.projectId !== projectId) return jsonError(409, 'Paket pripada drugemu projektu.')
    packageId = pkg.id
  }

  // ── opcijska garancija (mora pripadati ISTEMU projektu) ─────────────────────
  let warrantyId: string | null = null
  if (typeof body?.warrantyId === 'string' && body.warrantyId) {
    const warranty = await db.warranty.findUnique({ where: { id: body.warrantyId }, select: { id: true, projectId: true } })
    if (!warranty) return jsonError(404, 'Garancija ne obstaja.')
    if (warranty.projectId !== projectId) return jsonError(409, 'Garancija pripada drugemu projektu.')
    warrantyId = warranty.id
  }

  // ── besedilo ────────────────────────────────────────────────────────────────
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const desc = typeof body?.desc === 'string' ? body.desc.trim() : ''
  if (!title) return jsonError(400, 'Naslov reklamacije je obvezen.')
  if (!desc) return jsonError(400, 'Opis težave je obvezen.')

  const channel = typeof body?.channel === 'string' && body.channel ? body.channel : 'TELEFON'
  if (!(CLAIM_CHANNELS as readonly string[]).includes(channel)) {
    return jsonError(400, 'Neveljaven kanal prijave.', 'Veljavni kanali: TELEFON, EMAIL, PORTAL, OSEBNO.')
  }

  const reportedBy = typeof body?.reportedBy === 'string' && body.reportedBy.trim() ? body.reportedBy.trim().slice(0, 120) : null

  // ── koda REK-{leto}-NNN (odporna na vrzeli — R439 vzorec) ───────────────────
  const existing = await db.claim.findMany({ where: { code: { startsWith: 'REK-' } }, select: { code: true } })
  const code = nextCodeFromList(existing.map((c) => c.code), 'REK-')

  const claim = await db.claim.create({
    data: {
      code,
      customerId,
      projectId,
      packageId,
      warrantyId,
      title: title.slice(0, 200),
      desc: desc.slice(0, 4000),
      channel,
      reportedBy,
      status: 'NOVA',
    },
    include: CLAIM_INCLUDE,
  })

  await writeAudit({
    userId: user.id, action: 'CLAIM_CREATE', entity: 'claim', entityId: claim.id, projectId,
    detail: { code, project: project.code, stranka: customer.name, kanal: channel, garancija: !!warrantyId },
  })
  return NextResponse.json({ data: claim }, { status: 201 })
}

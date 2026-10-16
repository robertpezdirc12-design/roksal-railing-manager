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
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, readsAllData, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { nextCodeFromList } from '@/lib/codes'
import { retryOnUnique } from '@/lib/versioning'
import { parseBody } from '@/lib/validate'
import { CLAIM_CHANNELS, CLAIM_INCLUDE } from '@/lib/service-core'

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// stranka/projekt obvezna (neprazna niza, brez trim — kot prej), naslov in opis
// obvezna po trim; paket/garancija/prijavitelj neobvezna (prazno ⇒ null);
// kanal s privzetim TELEFON (prazen niz ⇒ privzet, kot prej) — dovoljene
// vrednosti kanala še vedno preverja handler s seznamom v detail.
const ClaimCreateSchema = z.object({
  customerId: z.string().min(1, 'Manjka stranka.'),
  projectId: z.string().min(1, 'Manjka projekt.'),
  packageId: z.string().nullish().transform((v) => v || null),
  warrantyId: z.string().nullish().transform((v) => v || null),
  title: z.string().trim().min(1, 'Naslov reklamacije je obvezen.'),
  desc: z.string().trim().min(1, 'Opis težave je obvezen.'),
  channel: z.string().nullish().transform((v) => v || 'TELEFON'),
  reportedBy: z.string().trim().nullish().transform((v) => (v ? v.slice(0, 120) : null)),
})

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

  const parsed = await parseBody(req, ClaimCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // ── obvezna eksplicitna vezava: stranka + projekt ──────────────────────────
  const customerId = data.customerId
  const projectId = data.projectId

  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } })
  if (!customer) return jsonError(404, 'Stranka ne obstaja.')

  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, title: true, customerId: true } })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')
  if (project.customerId && project.customerId !== customerId) {
    return jsonError(409, 'Projekt pripada drugi stranki.', 'Reklamacija mora vezati stranko in njen projekt.')
  }

  // ── opcijski paket (del projekta) ──────────────────────────────────────────
  let packageId: string | null = null
  if (data.packageId) {
    const pkg = await db.projectPackage.findUnique({ where: { id: data.packageId }, select: { id: true, projectId: true, name: true } })
    if (!pkg) return jsonError(404, 'Paket projekta ne obstaja.')
    if (pkg.projectId !== projectId) return jsonError(409, 'Paket pripada drugemu projektu.')
    packageId = pkg.id
  }

  // ── opcijska garancija (mora pripadati ISTEMU projektu) ─────────────────────
  let warrantyId: string | null = null
  if (data.warrantyId) {
    const warranty = await db.warranty.findUnique({ where: { id: data.warrantyId }, select: { id: true, projectId: true } })
    if (!warranty) return jsonError(404, 'Garancija ne obstaja.')
    if (warranty.projectId !== projectId) return jsonError(409, 'Garancija pripada drugemu projektu.')
    warrantyId = warranty.id
  }

  // ── besedilo (obvezno po trim — shema) + kanal ──────────────────────────────
  const title = data.title
  const desc = data.desc

  const channel = data.channel
  if (!(CLAIM_CHANNELS as readonly string[]).includes(channel)) {
    return jsonError(400, 'Neveljaven kanal prijave.', 'Veljavni kanali: TELEFON, EMAIL, PORTAL, OSEBNO.')
  }

  const reportedBy = data.reportedBy

  // R538: transakcijska celovitost — koda + zapis + revizija atomarno (vzorec
  // R537-d); koda REK- se bere ZNOTRAJ tx, sočasen P2002 na Claim.code
  // (@unique) → do 3 poskusi (retryOnUnique — koda izračunana v ponovljenem fn).
  const claim = await retryOnUnique(() => db.$transaction(async (tx) => {
    // ── koda REK-{leto}-NNN (odporna na vrzeli — R439 vzorec) ───────────────
    const existing = await tx.claim.findMany({ where: { code: { startsWith: 'REK-' } }, select: { code: true } })
    const code = nextCodeFromList(existing.map((c) => c.code), 'REK-')

    const claim = await tx.claim.create({
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
    }, tx)
    return claim
  }), 3)
  return NextResponse.json({ data: claim }, { status: 201 })
}

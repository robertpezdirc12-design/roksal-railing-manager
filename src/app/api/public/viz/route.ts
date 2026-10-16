import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimited, tokenBucketKey } from '@/lib/rate-limit'
import { consentStatus, photosBlockedReason } from '@/lib/pin-core'
import { choiceSummary, publicVizVisualization, VIZ_TOKEN_MAX, VIZ_TOKEN_MIN } from '@/lib/viz-core'

// /api/public/viz — JAVNI VIZUALIZATOR (R480 — issue #9 §10): stranka z žetonom
// vidi A/B/C variante svojega projekta (PREJ/POTEM). Brez avtentikacije —
// dostop ureja neuraden žeton povezave (VizLink: veljaven, ne preklican,
// ne pretekel — vzorec /api/public/review iz R479). Tempomat 60 zahtev/min na
// žeton (skupni rate-limit lib, ključ viz:<token>). Šteje ogled.
//
// VARNI PODSKUP (§10: „ne more urejati internih cen, zaloge, proizvodnih
// pravil ali drugih projektov"):
//  • project: SAMO { code, title, customerName } — brez internih opomb/statusa;
//  • variants: publicVizVisualization projekcija (viz-core) — BREZ note pisarne,
//    BREZ renderParams (samo javni configSummary), BREZ avtorja, BREZ statusa
//    (IZBRANA = interno), BREZ cen (cena je kanal ponudbe), BREZ verzij;
//    ARHIV variante so umaknjene iz javnega ponudnega seznama;
//  • fotografije (sourcePhoto PREJ + rendered POTEM — v obeh je hiša stranke):
//    SAMO ob GDPR soglasju VELJAVNO na projektu (pin-core.consentStatus — en
//    vir resnice za vsa vrata); sicer photosBlocked 'MANJKA_SOGLASJE' |
//    'SOGLASJE_POTEKLO' in sliki sta null (metapodatki variante OSTANEJO);
//  • chosen: javni povzetek zadnjega izbora (choiceSummary) ali null;
//  • NIČ: lead podatkov, internih opomb, e-pošte uporabnikov, drugih projektov.

export const dynamic = 'force-dynamic'

export async function GET (req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token || token.length < VIZ_TOKEN_MIN || token.length > VIZ_TOKEN_MAX) {
    return NextResponse.json({ error: 'Neveljavna povezava.' }, { status: 404 })
  }
  if (await rateLimited(tokenBucketKey('viz', token))) {
    return NextResponse.json({ error: 'Preveč zahtev — poskusite kasneje.' }, { status: 429 })
  }

  const link = await db.vizLink.findUnique({
    where: { token },
    include: {
      project: {
        select: {
          id: true, code: true, title: true,
          photoConsentAt: true, photoConsentExpiresAt: true,
          customer: { select: { name: true } },
        },
      },
    },
  })
  if (!link || link.revokedAt || link.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Povezava ne velja več (preklicana ali potekla).' }, { status: 404 })
  }

  // štetje ogleda (vzorec PortalLink/ReviewLink)
  await db.vizLink.update({
    where: { id: link.id },
    data: { viewCount: { increment: 1 }, lastViewAt: new Date() },
  })

  const project = link.project
  const consent = consentStatus(project)
  const photosBlocked = photosBlockedReason(consent)
  const photosAllowed = consent === 'VELJAVNO'

  // javni ponudni seznam: ARHIV (umaknjene) variante NE grejo ven
  const vizs = await db.photoVisualization.findMany({
    where: { projectId: project.id, status: { not: 'ARHIV' } },
    include: {
      product: { select: { sku: true, name: true } },
      variant: { select: { sku: true, name: true, ral: true } },
    },
    orderBy: { variantLabel: 'asc' },
  })
  const variants = vizs.map((v) => publicVizVisualization(v, photosAllowed))

  // zadnji strankin izbor (javni povzetek — za „Vaš izbor" na strani)
  const lastChoice = await db.visualizationChoice.findFirst({
    where: { projectId: project.id },
    orderBy: [{ chosenAt: 'desc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json({
    data: {
      project: {
        code: project.code,
        title: project.title,
        customerName: project.customer?.name ?? null,
      },
      consent,
      photosBlocked, // null = ni zamika; sicer 'MANJKA_SOGLASJE' | 'SOGLASJE_POTEKLO'
      variants,
      chosen: lastChoice ? choiceSummary(lastChoice) : null,
      link: { expiresAt: link.expiresAt.toISOString() },
    },
  })
}

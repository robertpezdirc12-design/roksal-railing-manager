import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { rateLimited, tokenBucketKey } from '@/lib/rate-limit'
import { deliverEvent, recordEvent } from '@/lib/notify'
import { choiceSummary, VIZ_REQUEST_TYPE_LABELS, validVizChoiceInput, VIZ_TOKEN_MAX, VIZ_TOKEN_MIN } from '@/lib/viz-core'

// /api/public/viz-choice — STRANKIN IZBOR VARIANTE (R480 — issue #9 §10)
// JAVNA pot (brez prijave) — dostop ureja žeton povezave vizualizatorja
// (VizLink: veljaven, ne preklican, ne pretekel). Tempomat 10 zahtev/min na
// žeton — LOČEN ključ viz-choice:<token> (javno pisanje = spam vektor: brez
// CAPTCHA, a omejeno + dolžinske meje + revizija brez kontakta).
//
// Telo: { visualizationId, variantLabel: A|B|C, requestType: PONUDBA|OGLED|
// IZMERA, note? ≤ 500, contactName?, contactPhone?, contactEmail?,
// consentAccepted: true (OBVEZNO — GDPR obvestilo o obdelavi, sicer 400) }
//
// Učinek (append-only — „pisarna ne prepisuje podatkov"):
//  1. VisualizationChoice vrstica (variantLabel = SNAPSHOT ob izbiri,
//     chosenVia 'VIZUALIZATOR', consentAcceptedAt) — NI PATCH/DELETE na izborih;
//  2. če je stranka pustila KATERIKOLI kontakt → nov LEAD (source
//     'VIZUALIZATOR', status NOV) + choice.leadId (izbor preživi pretvorbo);
//  3. revizija VIZ_CHOICE_CREATE — BREZ kontakta (samo variantLabel +
//     vrsta zahteve + leadId; žetona NE v revizijo);
//  4. emitEvent VIZ_CHOICE pisarni (OFFICE) — obvestilo o izboru, kontakt NE
//     gre v obvestilo (podrobnosti so v CRM vodu).

export const dynamic = 'force-dynamic'

export async function POST (req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token || token.length < VIZ_TOKEN_MIN || token.length > VIZ_TOKEN_MAX) {
    return NextResponse.json({ error: 'Neveljavna povezava.' }, { status: 404 })
  }
  if (await rateLimited(tokenBucketKey('viz-choice', token), 10)) {
    return NextResponse.json({ error: 'Preveč zahtev — poskusite kasneje.' }, { status: 429 })
  }

  const link = await db.vizLink.findUnique({
    where: { token },
    include: { project: { select: { id: true, code: true, title: true } } },
  })
  if (!link || link.revokedAt || link.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Povezava ne velja več (preklicana ali potekla).' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const input = validVizChoiceInput(body)
  if (!input.ok) return jsonError(400, input.napaka)
  const { value } = input

  // vizualizacija: obstaja + pripada projektu žetona + ni umaknjena (ARHIV)
  const viz = await db.photoVisualization.findUnique({
    where: { id: value.visualizationId },
    select: { id: true, projectId: true, variantLabel: true, status: true },
  })
  if (!viz) return jsonError(404, 'Varianta ne obstaja.')
  if (viz.projectId !== link.projectId) {
    return jsonError(400, 'Varianta ne pripada projektu te povezave.')
  }
  if (viz.variantLabel !== value.variantLabel) {
    return jsonError(400, 'Oznaka variante se ne ujema s to vizualizacijo.')
  }
  if (viz.status === 'ARHIV') {
    return jsonError(400, 'Varianta je umaknjena iz ponudbe.')
  }

  // R537 (transakcijska celovitost): vod (če je pustila kontakt) + izbor +
  // revizija + zapis obvestila (outbox) v ENI transakciji — prej sta bila LEAD
  // in IZBOR ločena await-a (padec srednjega koraka = izbor brez voda ali brez
  // revizije/dogodka). Dostava (OFFICE IN_APP + webhook HTTP) teče PO commitu
  // (deliverEvent, ognjevarna) — javna povezava ostane hitra.
  const hasContact = !!(value.contactName || value.contactPhone || value.contactEmail)
  const { choice, recorded } = await db.$transaction(async (tx) => {
    // LEAD — če je stranka pustila katerikoli kontakt (predprodaja §10)
    let leadId: string | null = null
    if (hasContact) {
      const lead = await tx.lead.create({
        data: {
          name: value.contactName ?? `Stranka prek vizualizatorja (${link.project.code})`,
          email: value.contactEmail,
          phone: value.contactPhone,
          source: 'VIZUALIZATOR', // R480: vir iz javnega vizualizatorja (§10)
          status: 'NOV',
          note: `Izbor variante ${viz.variantLabel} na projektu ${link.project.code} (${link.project.title}); zahteva: ${VIZ_REQUEST_TYPE_LABELS[value.requestType]}${value.note ? `; opomba stranke: ${value.note}` : ''}`,
        },
      })
      leadId = lead.id
    }

    const choice = await tx.visualizationChoice.create({
      data: {
        projectId: link.projectId,
        visualizationId: viz.id,
        variantLabel: viz.variantLabel, // SNAPSHOT ob izbiri (črka se lahko reciklira po ARHIV)
        chosenAt: new Date(),
        chosenVia: 'VIZUALIZATOR',
        requestType: value.requestType,
        leadId,
        linkId: link.id,
        note: value.note,
        contactName: value.contactName,
        contactPhone: value.contactPhone,
        contactEmail: value.contactEmail,
        consentAcceptedAt: new Date(),
      },
    })

    // revizija — BREZ kontakta in BREZ žetona (entityId = choice id, vzorec R479)
    await writeAudit({
      userId: null, // javni izbor — ni prijavljenega uporabnika
      action: 'VIZ_CHOICE_CREATE', entity: 'visualizationChoice', entityId: choice.id,
      projectId: link.projectId,
      detail: {
        variantLabel: viz.variantLabel,
        requestType: value.requestType,
        leadId, // samo kazalec na vod; kontakt ostaja v CRM
        chosenVia: 'VIZUALIZATOR',
      },
    }, tx)

    // obvestilo pisarni (ognjevarena dostava PO commitu — dedup po choice id)
    const recorded = await recordEvent({
      type: 'VIZ_CHOICE',
      key: `viz-choice:${choice.id}`,
      title: `Izbor variante ${viz.variantLabel} — ${link.project.code}`,
      body: `Stranka je izbrala varianto ${viz.variantLabel} na projektu ${link.project.code} in zahteva: ${VIZ_REQUEST_TYPE_LABELS[value.requestType]}.${leadId ? ' Kontakt je zabeležen — nov vod v CRM.' : ''}`,
      projectId: link.projectId,
      audience: 'OFFICE',
    }, tx)
    return { choice, recorded }
  })

  // dostava obvestila PO uspešnem commitu (ognjevarna — nikoli ne vrže napake)
  if (recorded) await deliverEvent(recorded)

  return NextResponse.json({ data: choiceSummary(choice) }, { status: 201 })
}

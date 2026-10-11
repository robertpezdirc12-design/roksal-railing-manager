import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { projektZaUporabnika } from '@/lib/photo-replace-engine'

// /api/projects/[id]/viz-choices — ZGODOVINA STRANKINIH IZBOROV (R480 — issue #9 §10)
// GET (projects.read): izbire projekta (novèjše najprej) z varianto, vodom in
// kontaktom — ZGODOVINA ZA PISARNO.
//
// APPEND-ONLY (§10: „pisarna ne prepisuje podatkov"): izbora NI mogoče
// spreminjati ali brisati — TA RUTA NIMA PATCH/DELETE; eventualna „urejanja"
// so NOVA vrstica (stranka ponovno izbere prek javne povezave). Zadnji zapis
// (chosenAt desc, [0]) = trenutni izbor. Izbor stranke NE spreminja
// PhotoVisualization.status IZBRANA (to je izbira pisarne, measurements.write).
//
// IDOR: monter vidi SAMO projekte svojih nalogov (projektZaUporabnika — isti
// obseg kot /api/photo-visualization; pisarna vidi vse).

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scope = await projektZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope

  const choices = await db.visualizationChoice.findMany({
    where: { projectId: id },
    orderBy: [{ chosenAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      visualization: {
        select: {
          id: true, variantLabel: true, status: true,
          product: { select: { sku: true, name: true } },
          variant: { select: { sku: true, name: true, ral: true } },
        },
      },
      lead: { select: { id: true, name: true, email: true, phone: true, status: true, source: true } },
      link: { select: { id: true, revokedAt: true, expiresAt: true } },
    },
  })

  return NextResponse.json({
    data: choices.map((c) => ({
      id: c.id,
      projectId: c.projectId,
      visualizationId: c.visualizationId, // null, če je bila vizualizacija izbrisana (izbor ostane)
      variantLabel: c.variantLabel, // SNAPSHOT ob izbiri
      chosenAt: c.chosenAt.toISOString(),
      chosenVia: c.chosenVia,
      requestType: c.requestType,
      note: c.note,
      contactName: c.contactName,
      contactPhone: c.contactPhone,
      contactEmail: c.contactEmail,
      consentAcceptedAt: c.consentAcceptedAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
      visualization: c.visualization
        ? {
            id: c.visualization.id,
            variantLabel: c.visualization.variantLabel,
            status: c.visualization.status,
            product: c.visualization.product,
            variant: c.visualization.variant,
          }
        : null,
      lead: c.lead,
      link: c.link
        ? {
            id: c.link.id,
            revokedAt: c.link.revokedAt?.toISOString() ?? null,
            expiresAt: c.link.expiresAt.toISOString(),
          }
        : null,
    })),
  })
}

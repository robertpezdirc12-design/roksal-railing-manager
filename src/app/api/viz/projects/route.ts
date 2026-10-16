// /api/viz/projects — R454 (issue #7 §16 P3: NAPREDNI 3D, route-map
// §„3D vizualizacije & AR": GET/POST /api/viz/projects).
// GET  (projects.read) — seznam shranjenih 3D konfiguracij (novejši first,
//      max 200) z avtorjem in poslovnim projektom; ?projectId= filter.
// POST (measurements.write) — shrani konfiguracijo { name, projectId?, tip,
//      params (JSON konfiguratorja), note? } → revizija VIZ_PROJECT_CREATE.
//      tip: OGRAJA | BALUSTRADA | NAGIB; params so JSON niz naše viz.tsx.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

const TIPS = ['OGRAJA', 'BALUSTRADA', 'NAGIB']

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// ime obvezno po trim + omejitev 120 znakov (kot prej), tip ima tihi privzetek
// OGRAJA ob neznani vrednosti (kot prej), params: obvezen neprazen niz, ki se
// razčleni kot JSON objekt (kot prej — niz, ki ni JSON, ⇒ 400), projectId
// neobvezen (obstoj preverja handler, kot prej), opomba: trim/500, prazna ⇒ null
// (kot prej).
const VizProjectCreateSchema = z.object({
  name: z.string({ error: 'Manjka ime projekta.' }).trim().min(1, 'Manjka ime projekta.').transform((v) => v.slice(0, 120)),
  tip: z.unknown().transform((v) => (typeof v === 'string' && TIPS.includes(v) ? v : 'OGRAJA')),
  params: z.string({ error: 'Manjkajo params konfiguratorja (JSON).' }).trim().min(1, 'Manjkajo params konfiguratorja (JSON).')
    .refine((v) => {
      try {
        const parsed = JSON.parse(v) as unknown
        return !!parsed && typeof parsed === 'object'
      } catch {
        return false
      }
    }, 'Params niso veljaven JSON.'),
  projectId: z.string({ error: 'projectId mora biti besedilo.' }).optional().transform((v) => v || undefined),
  note: z.string({ error: 'Opomba mora biti besedilo.' }).nullish().transform((v) => {
    const t = v?.trim().slice(0, 500)
    return t ? t : null
  }),
})

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')

  const projects = await db.vizProject.findMany({
    where: projectId ? { projectId } : {},
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: {
      author: { select: { name: true, role: true } },
      project: { select: { code: true, title: true } },
    },
  })
  return NextResponse.json({ data: projects })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, VizProjectCreateSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  // projectId (neobvezno, a če je → mora obstajati — eksplicitna ID povezava §15)
  let projectId: string | null = null
  if (data.projectId) {
    const project = await db.project.findUnique({ where: { id: data.projectId }, select: { id: true } })
    if (!project) return jsonError(404, 'Projekt ne obstaja.')
    projectId = project.id
  }

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // shranitev konfiguracije + revizija VIZ_PROJECT_CREATE v ENI transakciji.
  const created = await db.$transaction(async (tx) => {
    const created = await tx.vizProject.create({
      data: { name: data.name, projectId, authorId: user.id, tip: data.tip, params: data.params, note: data.note },
    })

    await writeAudit({
      userId: user.id,
      action: 'VIZ_PROJECT_CREATE',
      entity: 'vizProject',
      entityId: created.id,
      projectId,
      detail: { name: data.name, tip: data.tip, note: data.note },
    }, tx)
    return created
  })

  return NextResponse.json({ data: created }, { status: 201 })
}

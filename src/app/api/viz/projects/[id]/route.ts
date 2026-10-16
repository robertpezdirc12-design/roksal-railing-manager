// /api/viz/projects/[id] — R454 (NAPREDNI 3D): podrobnost, posodobitev, brisanje.
// GET    (projects.read) — podrobnost z avtorjem in projektom.
// PATCH  (measurements.write) — { name?, tip?, params?, note?, projectId? };
//        params morajo ostati veljaven JSON; projectId mora obstajati (§15).
//        Revizija VIZ_PROJECT_UPDATE (before → after).
// DELETE (measurements.write) — brisanje → revizija VIZ_PROJECT_DELETE.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

const TIPS = ['OGRAJA', 'BALUSTRADA', 'NAGIB']

type Params = { params: Promise<{ id: string }> }

// R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d):
// delni PATCH — vsa polja neobvezna; ime (če je podano) neprazno po trim +
// omejitev 120 (kot prej), tip iz seznama (neznani niz ⇒ 400, kot prej),
// params morajo biti veljaven JSON objekt (kot prej — shranijo se trimani),
// opomba: trim/500, prazna ⇒ null (kot prej), projectId: null/'' ⇒ očiščeno
// povezava, niz ⇒ obstoj preverja handler (kot prej).
const VizProjectPatchSchema = z.object({
  name: z.string({ error: 'Ime mora biti besedilo.' }).trim().min(1, 'Ime ne sme biti prazno.').transform((v) => v.slice(0, 120)).optional(),
  tip: z.enum(TIPS, { error: 'Neveljaven tip (OGRAJA | BALUSTRADA | NAGIB).' }).optional(),
  params: z.unknown()
    .superRefine((v, ctx) => {
      if (typeof v === 'string') {
        try {
          const parsed = JSON.parse(v) as unknown
          if (!parsed || typeof parsed !== 'object') ctx.addIssue({ code: 'custom', message: 'Params niso veljaven JSON.' })
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Params niso veljaven JSON.' })
        }
      }
    })
    .transform((v) => (typeof v === 'string' ? v.trim() : undefined)),
  note: z.string({ error: 'Opomba mora biti besedilo.' }).nullish().transform((v) => {
      if (v === undefined) return undefined
      const t = v?.trim().slice(0, 500)
      return t ? t : null
    }),
  projectId: z.string({ error: 'projectId mora biti besedilo.' }).nullable().optional(),
})

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await db.vizProject.findUnique({
    where: { id },
    include: {
      author: { select: { name: true, role: true } },
      project: { select: { id: true, code: true, title: true } },
    },
  })
  if (!project) return jsonError(404, 'Vizualizacijski projekt ne obstaja.')
  return NextResponse.json({ data: project })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const existing = await db.vizProject.findUnique({ where: { id } })
  if (!existing) return jsonError(404, 'Vizualizacijski projekt ne obstaja.')

  // R538: zod validacija (zrcali prejšnjo sprejemljivost — vzorec R536-d)
  const parsed = await parseBody(req, VizProjectPatchSchema)
  if (!parsed.ok) return parsed.response
  const data = parsed.data

  const upd: Record<string, string | null> = {}
  if (data.name !== undefined) upd.name = data.name
  if (data.tip !== undefined) upd.tip = data.tip
  if (data.params !== undefined) upd.params = data.params
  if (data.note !== undefined) upd.note = data.note
  if (data.projectId !== undefined) {
    if (data.projectId === null || data.projectId === '') {
      upd.projectId = null
    } else {
      const project = await db.project.findUnique({ where: { id: data.projectId }, select: { id: true } })
      if (!project) return jsonError(404, 'Projekt ne obstaja.')
      upd.projectId = project.id
    }
  }
  if (Object.keys(upd).length === 0) return jsonError(400, 'Ni polj za posodobitev.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // posodobitev + revizija VIZ_PROJECT_UPDATE (before → after) v ENI transakciji.
  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.vizProject.update({ where: { id }, data: upd })

    await writeAudit({
      userId: user.id,
      action: 'VIZ_PROJECT_UPDATE',
      entity: 'vizProject',
      entityId: id,
      projectId: updated.projectId,
      detail: {
        before: { name: existing.name, tip: existing.tip, note: existing.note },
        after: { name: updated.name, tip: updated.tip, note: updated.note },
      },
    }, tx)
    return updated
  })
  return NextResponse.json({ data: updated })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const existing = await db.vizProject.findUnique({ where: { id }, select: { id: true, name: true, projectId: true } })
  if (!existing) return jsonError(404, 'Vizualizacijski projekt ne obstaja.')

  // R538: transakcijska celovitost — mutate + revizija atomarno (vzorec R537-d):
  // brisanje + revizija VIZ_PROJECT_DELETE v ENI transakciji.
  await db.$transaction(async (tx) => {
    await tx.vizProject.delete({ where: { id } })

    await writeAudit({
      userId: user.id,
      action: 'VIZ_PROJECT_DELETE',
      entity: 'vizProject',
      entityId: id,
      projectId: existing.projectId,
      detail: { name: existing.name },
    }, tx)
  })
  return NextResponse.json({ data: { ok: true, id } })
}

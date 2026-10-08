// /api/photo-visualization/[id] — R459 (issue #14)
// GET   (projects.read) — polna vizualizacija: originalna fotografija +
//       izrisana sličica + verzije (meta) + opozorila. Obseg §13 (IDOR).
// PATCH (measurements.write) — sprememba: renderParams (→ NOVA VERZIJA §12,
//       nikoli tiho prepisano), rendered, note, status (IZBRANA pomeni, da
//       ostale variante projekta padejo nazaj na OSNUTEK — ena izbrana).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { ENGINE_VERSION, oceniKakovost } from '@/lib/photo-replace-core'
import {
  MAX_PARAMS_JSON, MAX_RENDERED_BYTES, STATUSES,
  preveriFoto, preveriIzdelek, preveriRenderParams, vizZaUporabnika,
} from '@/lib/photo-replace-engine'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const res = await vizZaUporabnika(auth.user, id)
  if (res instanceof NextResponse) return res

  const viz = await db.photoVisualization.findUnique({
    where: { id },
    include: {
      author: { select: { name: true, role: true } },
      product: {
        select: {
          id: true, sku: true, name: true, unit: true, tech: true,
          family: { select: { code: true, name: true } },
          variants: { select: { id: true, sku: true, name: true, ral: true, color: true }, orderBy: { sortOrder: 'asc' } },
        },
      },
      variant: { select: { id: true, sku: true, name: true, ral: true, color: true } },
      project: { select: { id: true, code: true, title: true } },
      versions: { orderBy: { version: 'desc' }, select: { id: true, version: true, note: true, createdAt: true, user: { select: { name: true } } } },
    },
  })
  if (!viz) return jsonError(404, 'Vizualizacija ne obstaja.')

  // opozorila iz zadnje verzije (meta) — za prikaz ob ponovnem odpiranju
  let opozorila: { koda: string; sporocilo: string }[] = []
  const lastVersion = await db.photoVisualizationVersion.findFirst({
    where: { visualizationId: id },
    orderBy: { version: 'desc' },
    select: { data: true },
  })
  if (lastVersion) {
    try {
      const parsed = JSON.parse(lastVersion.data) as { meta?: { opozorila?: { koda: string; sporocilo: string }[] } }
      if (Array.isArray(parsed.meta?.opozorila)) opozorila = parsed.meta.opozorila
    } catch { /* posnetek neberljiv → brez opozoril */ }
  }

  return NextResponse.json({ data: { ...viz, opozorila } })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const res = await vizZaUporabnika(user, id)
  if (res instanceof NextResponse) return res
  const viz = res.viz

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const update: Record<string, unknown> = {}

  // ── renderParams → NOVA VERZIJA (§12: vsaka sprememba = nova verzija) ──────
  let novaVerzija = 0
  let opozorilaKodi: string[] = []
  if (body.renderParams !== undefined) {
    const params2 = preveriRenderParams(body.renderParams)
    if ('napaka' in params2) return jsonError(400, params2.napaka)
    const json = JSON.stringify(params2.params)
    if (json.length > MAX_PARAMS_JSON) return jsonError(400, 'Parametri izrisa presežejo dovoljeno velikost.')

    // §6: če je vezana meritev, opozori na odstopanje prikazne dolžine
    let potrjenaMeraCm: number | null = null
    if (viz.measurementId) {
      const m = await db.measurement.findUnique({ where: { id: viz.measurementId }, select: { lengthCm: true } })
      potrjenaMeraCm = m?.lengthCm ?? null
    }
    const opozorila = oceniKakovost(params2.params, 1000, 750, potrjenaMeraCm)
    opozorilaKodi = opozorila.map((o) => o.koda)

    update.renderParams = json
    update.engineVersion = ENGINE_VERSION

    const last = await db.photoVisualizationVersion.findFirst({
      where: { visualizationId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    novaVerzija = (last?.version ?? 0) + 1
  }

  // ── rendered (izrisana sličica) ────────────────────────────────────────────
  if (body.rendered !== undefined) {
    if (body.rendered === null) {
      update.rendered = null
    } else {
      const r = preveriFoto(body.rendered, MAX_RENDERED_BYTES, 'Izrisana sličica')
      if ('napaka' in r) return jsonError(400, r.napaka)
      update.rendered = r.dataUrl
    }
  }

  // ── izdelek/varianta (sprememba izbora) ────────────────────────────────────
  if (body.productId !== undefined || body.variantId !== undefined) {
    const izdelek = await preveriIzdelek(
      body.productId !== undefined ? body.productId : viz.productId,
      body.variantId !== undefined ? body.variantId : viz.variantId
    )
    if ('napaka' in izdelek) return jsonError(izdelek.status, izdelek.napaka)
    update.productId = izdelek.produkt.id
    update.variantId = body.variantId !== undefined
      ? (typeof body.variantId === 'string' && body.variantId ? body.variantId : null)
      : viz.variantId
  }

  // ── opomba ─────────────────────────────────────────────────────────────────
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== 'string') return jsonError(400, 'Opomba mora biti niz.')
    update.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null
  }

  // ── status (IZBRANA — ena izbrana varianta na projekt, §7) ─────────────────
  let izbira = false
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !(STATUSES as readonly string[]).includes(body.status)) {
      return jsonError(400, 'Neveljaven status.', `Veljavni statusi: ${STATUSES.join(', ')}.`)
    }
    update.status = body.status
    izbira = body.status === 'IZBRANA'
  }

  if (Object.keys(update).length === 0) return jsonError(400, 'Nič za spremembo.')

  const updated = await db.photoVisualization.update({ where: { id }, data: update })

  // verzija posnetek
  if (novaVerzija > 0) {
    const renderParams = update.renderParams as string
    await db.photoVisualizationVersion.create({
      data: {
        visualizationId: id,
        version: novaVerzija,
        data: JSON.stringify({
          renderParams: JSON.parse(renderParams) as unknown,
          meta: { opozorila: opozorilaKodi, engineVersion: ENGINE_VERSION },
        }),
        userId: user.id,
        note: typeof body.versionNote === 'string' && body.versionNote.trim() ? body.versionNote.trim().slice(0, 200) : 'Sprememba konfiguracije',
      },
    })
  }

  // IZBRANA → ostale variante projekta nazaj na OSNUTEK (en meaning: izbrana)
  if (izbira) {
    await db.photoVisualization.updateMany({
      where: { projectId: viz.projectId, id: { not: id }, status: 'IZBRANA' },
      data: { status: 'OSNUTEK' },
    })
  }

  await writeAudit({
    userId: user.id,
    action: izbira ? 'PHOTO_VIZ_SELECT' : (novaVerzija > 0 ? 'PHOTO_VIZ_UPDATE' : 'PHOTO_VIZ_PATCH'),
    entity: 'photoVisualization',
    entityId: id,
    projectId: viz.projectId,
    detail: {
      spremembe: Object.keys(update),
      ...(novaVerzija > 0 ? { verzija: novaVerzija } : {}),
      ...(izbira ? { status: 'IZBRANA' } : {}),
      ...(opozorilaKodi.length > 0 ? { opozorila: opozorilaKodi } : {}),
    },
  })

  return NextResponse.json({
    data: {
      id: updated.id, status: updated.status, updatedAt: updated.updatedAt,
      ...(novaVerzija > 0 ? { verzija: novaVerzija } : {}),
    },
  })
}

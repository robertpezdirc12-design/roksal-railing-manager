// /api/fence-run/[id] — posamezen ograjni tekač (R460 — issue #15)
// GET    podrobnost: tekač + segmenti + produktni vir + ŽIVA analiza
//       (validacija §19, quality gate §3, povzetek, predlogi stebrov §11,
//        profil terena §12, verzije)
// PATCH  sprememba: { name?, note?, nodes?, terrain?, calibration?,
//                     productId?, variantId?, status? (OSNUTEK|PREGLED|ARHIV) }
//       → ponoven izračun segmentov (upsert z ohranitvijo preverjenih ±1 cm),
//         verzija+1, revizija. POTRJENega tekača ni mogoče spreminjati (§19).
// DELETE brisanje OSNUTEK/PREGLED tekača (avtor ali pisarna) + revizija.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseCalibration, parseNodes, parseTerrain } from '@/lib/fence-run-engine'
import { analyzeContext, loadRunContext, snapshotVersion, syncSegments } from '@/lib/fence-run-service'
import { fenceRunZaUporabnika } from '@/lib/fence-run-access'

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope

  const ctx = await loadRunContext(id)
  if (!ctx) return jsonError(404, 'Tekač ne obstaja.')
  const analysis = analyzeContext(ctx)

  const [product, variant, author, project, versions] = await Promise.all([
    ctx.run.productId
      ? db.product.findUnique({ where: { id: ctx.run.productId }, select: { id: true, sku: true, name: true, unit: true, tech: true } })
      : null,
    ctx.run.variantId
      ? db.productVariant.findUnique({ where: { id: ctx.run.variantId }, select: { id: true, sku: true, name: true, ral: true } })
      : null,
    ctx.run.authorId ? db.user.findUnique({ where: { id: ctx.run.authorId }, select: { name: true } }) : null,
    db.project.findUnique({ where: { id: ctx.run.projectId }, select: { code: true, title: true } }),
    db.fenceRunVersion.findMany({
      where: { fenceRunId: id },
      orderBy: { version: 'desc' },
      take: 20,
      select: { version: true, note: true, createdAt: true, user: { select: { name: true } } },
    }),
  ])

  return NextResponse.json({
    data: {
      run: {
        id: ctx.run.id, name: ctx.run.name, status: ctx.run.status, note: ctx.run.note,
        projectId: ctx.run.projectId, project, workOrderId: ctx.run.workOrderId,
        productId: ctx.run.productId, product, variantId: ctx.run.variantId, variant,
        author, measurementId: ctx.run.measurementId,
        nodes: ctx.nodes, terrain: ctx.terrain, calibration: ctx.calibration,
        rules: ctx.rules, engineVersion: 'fence-run/1.0',
        createdAt: ctx.run.createdAt, updatedAt: ctx.run.updatedAt,
      },
      segments: ctx.segments,
      analysis,
      versions,
    },
  })
}

export async function PATCH (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope
  if (scope.run.status === 'POTRJEN') {
    return jsonError(409, 'Potrjene izmere ni mogoče spreminjati.', 'Konfiguracija je geometrijsko pomembna — za spremembo ustvarite nov tekač ali arhivirajte tega (§19/§21).')
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const data: Record<string, unknown> = {}

  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120)
  if (body.note !== undefined) {
    data.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null
  }

  // vozlišča (§1) — ISTA pravila kot odjemalec
  if (body.nodes !== undefined) {
    if (body.nodes === null) return jsonError(400, 'Vozlišča ni mogoče odstraniti.', 'Tekač brez vozlišč nima pomena.')
    const nodes = parseNodes(body.nodes)
    if (!nodes) {
      return jsonError(400, 'Neveljavna vozlišča.', 'nodes: [{ kind, atCm, … }] — položaji strogo naraščajoči (min 5 cm med točkami).')
    }
    data.nodes = JSON.stringify(nodes)
  }

  // teren (§12)
  if (body.terrain !== undefined) {
    if (body.terrain === null) {
      data.terrain = null
    } else {
      const terrain = parseTerrain(body.terrain)
      if (!terrain) return jsonError(400, 'Neveljaven teren.', 'terrain: [{ distCm, elevCm }] — urejene višinske točke (max 33).')
      data.terrain = JSON.stringify(terrain)
    }
  }

  // kalibracija (§4)
  if (body.calibration !== undefined) {
    if (body.calibration === null) {
      data.calibration = null
    } else {
      const calibration = parseCalibration(body.calibration)
      if (!calibration) return jsonError(400, 'Neveljavna kalibracija.', 'calibration: { method, refValueCm, device?, … } (§4).')
      calibration.algorithmVersion = 'fence-run/1.0'
      data.calibration = JSON.stringify(calibration)
    }
  }

  // produkt/varianta (§8 — eksplicitni ID, brez fuzzy matchinga)
  if (body.productId !== undefined || body.variantId !== undefined) {
    let productId = typeof body.productId === 'string' && body.productId ? body.productId : null
    let variantId = typeof body.variantId === 'string' && body.variantId ? body.variantId : null
    if (body.productId === null) { productId = null; variantId = null }
    if (productId) {
      const product = await db.product.findUnique({ where: { id: productId }, select: { id: true } })
      if (!product) return jsonError(404, 'Izdelek ne obstaja.')
    }
    if (variantId) {
      if (!productId) return jsonError(400, 'Varianta zahteva productId.')
      const variant = await db.productVariant.findUnique({ where: { id: variantId }, select: { id: true, productId: true } })
      if (!variant) return jsonError(404, 'Varianta ne obstaja.')
      if (variant.productId !== productId) return jsonError(400, 'Varianta ne pripada izdelku.')
    }
    data.productId = productId
    data.variantId = variantId
  }

  // status (OSNUTEK ↔ PREGLED ↔ ARHIV — POTRJEN se nastavi samo s /confirm)
  if (body.status !== undefined) {
    const status = String(body.status)
    if (!['OSNUTEK', 'PREGLED', 'ARHIV'].includes(status)) {
      return jsonError(400, 'Neveljaven status.', 'Dovoljeni: OSNUTEK, PREGLED, ARHIV (POTRJEN samo prek potrditve).')
    }
    data.status = status
  }

  if (Object.keys(data).length === 0) return jsonError(400, 'Ni sprememb.', 'Podajte vsaj eno polje: name, note, nodes, terrain, calibration, productId, variantId, status.')

  await db.fenceRun.update({ where: { id }, data })

  // ponoven izračun segmentov + quality (zmanjšanje POŠTENO razveljavi preveritve)
  const ctx = await loadRunContext(id)
  if (ctx) await syncSegments(ctx)
  const version = await snapshotVersion(id, user.id, 'Sprememba tekača')

  await writeAudit({
    userId: user.id,
    action: 'FENCE_RUN_UPDATE',
    entity: 'fenceRun',
    entityId: id,
    projectId: scope.run.projectId,
    detail: { fields: Object.keys(data), version },
  })

  const fresh = await loadRunContext(id)
  return NextResponse.json({ data: { version, analysis: fresh ? analyzeContext(fresh) : null } })
}

export async function DELETE (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope
  if (scope.run.status === 'POTRJEN') {
    return jsonError(409, 'Potrjenega tekača ni mogoče izbrisati.', 'Potrjena izmera je vir proizvodnje — najprej jo arhivirajte.')
  }
  if (user.role === 'MONTER' && scope.run.authorId !== user.id) {
    return jsonError(403, 'Monter lahko briše samo svoje tekače.')
  }

  await db.fenceRun.delete({ where: { id } }) // kaskadno pobriše segmente + verzije
  await writeAudit({
    userId: user.id,
    action: 'FENCE_RUN_DELETE',
    entity: 'fenceRun',
    entityId: id,
    projectId: scope.run.projectId,
    detail: { name: scope.run.name },
  })
  return NextResponse.json({ data: { deleted: true } })
}

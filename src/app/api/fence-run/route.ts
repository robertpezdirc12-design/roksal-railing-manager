// /api/fence-run — ograjni tekači (R460 — issue #15 §1)
// GET  seznam tekačev (measurements.read; monter vidi svoje naloge/svoje)
// POST nov tekač: { projectId, name?, nodes, terrain?, calibration?,
//                   productId?, variantId?, workOrderId?, note? }
//      (measurements.write) → izračun segmentov + verzija v1 + revizija.
// Vozlišča veljajo ISTA pravila na odjemalcu in strežniku (fence-run-engine).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseCalibration, parseNodes, parseTerrain, round1 } from '@/lib/fence-run-engine'
import { loadRunContext, snapshotVersionOn, syncSegments } from '@/lib/fence-run-service'
import { projectIdsZaUporabnika } from '@/lib/fence-run-access'
import { asJsonObject } from '@/lib/json'
import { Prisma } from '@prisma/client'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const allowed = await projectIdsZaUporabnika(user)

  const runs = await db.fenceRun.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(allowed ? { projectId: { in: allowed } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      project: { select: { code: true, title: true } },
      product: { select: { sku: true, name: true } },
      variant: { select: { sku: true, name: true } },
      author: { select: { name: true } },
      segments: { select: { lengthCm: true, status: true } },
    },
  })

  const data = runs.map((r) => {
    const totalCm = r.segments.reduce((a, s) => a + s.lengthCm, 0)
    const verified = r.segments.filter((s) => s.status === 'VERIFIED' || s.status === 'CONFIRMED').length
    // R542: quality je jsonb objekt — branje brez JSON.parse
    const quality = asJsonObject(r.quality) ?? {}
    return {
      id: r.id, name: r.name, status: r.status, updatedAt: r.updatedAt,
      project: r.project, product: r.product, variant: r.variant, author: r.author,
      measurementId: r.measurementId,
      totalLengthCm: round1(totalCm),
      segmentCount: r.segments.length,
      verifiedCount: verified,
      qualityState: typeof quality.state === 'string' ? quality.state : null,
      qualityScore: typeof quality.score === 'number' ? quality.score : null,
    }
  })
  return NextResponse.json({ data })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
  if (!projectId) return jsonError(400, 'Manjka projectId.', 'Tekač je vedno vezan na projekt.')

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, workOrders: { select: { assigneeId: true } } },
  })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  // obseg: monter ustvarja samo v projektih svojih nalog
  if (!['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA'].includes(user.role)) {
    if (!project.workOrders.some((w) => w.assigneeId === user.id)) {
      return jsonError(403, 'Projekt ni na voljo vašim nalogom.', 'Monter ustvarja tekače samo v projektih svojih delovnih nalogov.')
    }
  }

  // vozlišča — ISTA pravila kot odjemalec (§1: ZAČETEK → STEBER → … → KONEC)
  const nodes = parseNodes(body.nodes)
  if (!nodes) {
    return jsonError(400, 'Neveljavna vozlišča.', 'nodes: [{ kind, atCm, … }] — vsaj 1 točka, položaji strogo naraščajoči (min 5 cm).')
  }

  const terrain = parseTerrain(body.terrain)
  if (body.terrain !== undefined && body.terrain !== null && !terrain) {
    return jsonError(400, 'Neveljaven teren.', 'terrain: [{ distCm, elevCm }] — urejene višinske točke (max 33).')
  }

  const calibration = parseCalibration(body.calibration)
  if (body.calibration !== undefined && body.calibration !== null && !calibration) {
    return jsonError(400, 'Neveljavna kalibracija.', 'calibration: { method, refValueCm, device?, … } (§4).')
  }
  if (calibration) calibration.algorithmVersion = 'fence-run/1.0'

  // produkt/varianta (§8: EKSPlicitni ID — isti vir kot konfigurator)
  let productId: string | null = null
  let variantId: string | null = null
  if (typeof body.productId === 'string' && body.productId) {
    const product = await db.product.findUnique({ where: { id: body.productId }, select: { id: true, active: true } })
    if (!product) return jsonError(404, 'Izdelek ne obstaja.')
    productId = product.id
  }
  if (typeof body.variantId === 'string' && body.variantId) {
    if (!productId) return jsonError(400, 'Varianta zahteva productId.', 'Podajte izdelek hkrati z varianto.')
    const variant = await db.productVariant.findUnique({ where: { id: body.variantId }, select: { id: true, productId: true } })
    if (!variant) return jsonError(404, 'Varianta ne obstaja.')
    if (variant.productId !== productId) return jsonError(400, 'Varianta ne pripada izdelku.')
    variantId = variant.id
  }

  let workOrderId: string | null = null
  if (typeof body.workOrderId === 'string' && body.workOrderId) {
    const wo = await db.workOrder.findUnique({ where: { id: body.workOrderId }, select: { id: true, projectId: true } })
    if (!wo) return jsonError(404, 'Nalog ne obstaja.')
    if (wo.projectId && wo.projectId !== projectId) return jsonError(400, 'Nalog pripada drugemu projektu.')
    workOrderId = wo.id
  }

  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 120)
    : `Ograjna izmera — ${project.code}`

  // R539 (transakcijska celovitost): tekač + izračun segmentov + verzija v1 +
  // revizija v ENI transakciji — padec srednjega koraka NE pusti praznega
  // tekača brez segmentov/verzije/revizije. Svež id tekača pomeni, da dirka
  // verzij (P2002) ni mogoča — retryOnUnique ni potreben.
  const { runId, version } = await db.$transaction(async (tx) => {
    const run = await tx.fenceRun.create({
      data: {
        projectId, workOrderId, authorId: user.id, name,
        productId, variantId,
        // R542: jsonb — objekti direktno; null = DB NULL (prej JSON niz/null)
        calibration: (calibration as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        terrain: (terrain as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        nodes: nodes as unknown as Prisma.InputJsonValue,
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null,
      },
    })

    // kanonični izračun segmentov + quality (§3) — na tx klientu (vidi svež tekač)
    const ctx = await loadRunContext(run.id, tx)
    if (ctx) await syncSegments(ctx, tx)
    const version = await snapshotVersionOn(tx, run.id, user.id, 'Ustvarjen tekač')

    await writeAudit({
      userId: user.id,
      action: 'FENCE_RUN_CREATE',
      entity: 'fenceRun',
      entityId: run.id,
      projectId,
      detail: {
        name, nodes: nodes.length,
        ...(productId ? { productId } : {}),
        ...(variantId ? { variantId } : {}),
        ...(calibration ? { calibrationMethod: calibration.method } : {}),
        ...(terrain ? { terrainPoints: terrain.length } : {}),
        version,
      },
    }, tx)
    return { runId: run.id, version }
  })

  const fresh = await loadRunContext(runId)
  return NextResponse.json({ data: { id: runId, version, run: fresh?.run ?? null } }, { status: 201 })
}

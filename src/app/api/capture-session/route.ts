// /api/capture-session — seznam + ustvarjanje zajemov (R461 — issue #16 §1/§2/§15)
// GET  seznam zajemov (measurements.read; monter vidi svoje/naloge)
// POST nov zajem: { projectId, mode, fenceRunId?, workOrderId?, device?, outdoor?, name?, note? }
//      (measurements.write) → vodena ruta (§2) iz tekača + tier naprave (§15)
//      + zunanji pogoji (§16) + revizija CAPTURE_START.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import {
  buildRoutePlan, deviceTier, parseDevice, parseOutdoor, CAPTURE_QA_VERSION,
} from '@/lib/capture-qa-engine'
import { parseNodes, parseTerrain } from '@/lib/fence-run-engine'
import { captureProjectIds } from '@/lib/capture-qa-access'
import { asJsonObject } from '@/lib/json'
import { Prisma } from '@prisma/client'

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const allowed = await captureProjectIds(user)

  const sessions = await db.captureSession.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(allowed ? { projectId: { in: allowed } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      project: { select: { code: true, title: true } },
      author: { select: { name: true } },
      references: { select: { status: true } },
      photos: { select: { id: true } },
    },
  })

  const data = sessions.map((s) => {
    // R542: coverage/drift sta jsonb objekta — branje brez JSON.parse
    const coverage = asJsonObject(s.coverage) ?? {}
    const drift = asJsonObject(s.drift) ?? {}
    const conflicts = s.references.filter((r) => r.status === 'KONFLIKT').length
    return {
      id: s.id, name: s.name, status: s.status, mode: s.mode, updatedAt: s.updatedAt,
      project: s.project, author: s.author, fenceRunId: s.fenceRunId, snapshotId: s.snapshotId,
      photoCount: s.photos.length,
      refCount: s.references.length,
      refConflicts: conflicts,
      coverageOk: coverage.gateOk === true,
      coverageZones: Array.isArray(coverage.zones) ? coverage.zones.length : 0,
      driftStatus: typeof drift.status === 'string' ? drift.status : null,
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
  if (!projectId) return jsonError(400, 'Manjka projectId.', 'Zajem je vedno vezan na projekt.')

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, workOrders: { select: { assigneeId: true } } },
  })
  if (!project) return jsonError(404, 'Projekt ne obstaja.')

  // obseg: monter ustvarja samo v projektih svojih nalog
  if (!['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA'].includes(user.role)) {
    if (!project.workOrders.some((w) => w.assigneeId === user.id)) {
      return jsonError(403, 'Projekt ni na voljo vašim nalogom.', 'Monter ustvarja zajeme samo v projektih svojih delovnih nalogov.')
    }
  }

  const mode = body.mode === 'KAMERA' ? 'KAMERA' : 'FENCE_RUN'

  // tekač (§21: geometrija IZ tekača — brez podvajanja engine-a)
  let fenceRunId: string | null = null
  let runNodes: { kind: string; atCm: number }[] = []
  let runTotalCm = 0
  let hasTerrain = false
  if (mode === 'FENCE_RUN') {
    const frId = typeof body.fenceRunId === 'string' && body.fenceRunId ? body.fenceRunId : null
    if (!frId) return jsonError(400, 'Manjka fenceRunId.', 'Zajem FENCE_RUN je vezan na ograjni tekač (R460).')
    const fr = await db.fenceRun.findUnique({ where: { id: frId } })
    if (!fr) return jsonError(404, 'Tekač ne obstaja.')
    if (fr.projectId !== projectId) return jsonError(400, 'Tekač pripada drugemu projektu.')
    fenceRunId = fr.id
    // R542: nodes/terrain sta jsonb — validator neposredno (JSON.parse odveč)
    runNodes = parseNodes(fr.nodes) ?? []
    if (runNodes.length === 0) return jsonError(400, 'Tekač nima veljavnih vozlišč.', 'Najprej dodajte vozlišča tekaču (Ogradnja).')
    runTotalCm = runNodes[runNodes.length - 1].atCm
    hasTerrain = (() => {
      const terrain = parseTerrain(fr.terrain)
      return terrain != null && terrain.length > 0
    })()
  } else {
    const totalCm = typeof body.totalCm === 'number' && Number.isFinite(body.totalCm) && body.totalCm > 0
      ? body.totalCm
      : 0
    runTotalCm = totalCm
  }

  // naprava (§15): tier izračuna STREŽNIK iz caps — ne zaupa trditvi odjemalca
  const deviceParsed = parseDevice(body.device)
  const device = deviceParsed
    ? { tier: deviceTier(deviceParsed.caps).tier, caps: deviceParsed.caps }
    : { tier: deviceTier({ camera: true }).tier, caps: { camera: true } }

  // zunanji pogoji (§16)
  const outdoor = parseOutdoor(body.outdoor) ?? { conditions: [] }

  // vodena ruta (§2)
  const plan = buildRoutePlan({
    mode,
    nodes: runNodes.map((n) => ({ kind: n.kind, atCm: n.atCm })),
    totalCm: runTotalCm,
    hasTerrain,
  })

  let workOrderId: string | null = null
  if (typeof body.workOrderId === 'string' && body.workOrderId) {
    const wo = await db.workOrder.findUnique({ where: { id: body.workOrderId }, select: { id: true, projectId: true } })
    if (!wo) return jsonError(404, 'Nalog ne obstaja.')
    if (wo.projectId && wo.projectId !== projectId) return jsonError(400, 'Nalog pripada drugemu projektu.')
    workOrderId = wo.id
  }

  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 120)
    : `Zajem — ${project.code}`

  // R539 (transakcijska celovitost): zajem + revizija CAPTURE_START v ENI
  // transakciji — padec srednjega koraka ne pusti zajema brez sledi.
  const session = await db.$transaction(async (tx) => {
    const session = await tx.captureSession.create({
      data: {
        projectId, workOrderId, fenceRunId, authorId: user.id, name, mode,
        // R542: jsonb — objekti direktno (ne JSON.stringify)
        device: device as unknown as Prisma.InputJsonValue,
        outdoor: outdoor as unknown as Prisma.InputJsonValue,
        plan: plan as unknown as Prisma.InputJsonValue,
        state: { currentStopId: plan[0]?.id ?? null, doneStops: [] },
        coverage: { zones: [], criticalMissing: [], gateOk: false },
        drift: { samples: [], status: 'DRIFT_OK', lastRefCode: null },
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null,
      },
    })

    await writeAudit({
      userId: user.id,
      action: 'CAPTURE_START',
      entity: 'captureSession',
      entityId: session.id,
      projectId,
      detail: {
        name, mode,
        stops: plan.length,
        tier: device.tier,
        ...(fenceRunId ? { fenceRunId } : {}),
        outdoor: outdoor.conditions,
        engineVersion: CAPTURE_QA_VERSION,
      },
    }, tx)

    return session
  })

  return NextResponse.json({
    data: {
      id: session.id,
      plan,
      device,
      outdoor,
      engineVersion: CAPTURE_QA_VERSION,
    },
  }, { status: 201 })
}

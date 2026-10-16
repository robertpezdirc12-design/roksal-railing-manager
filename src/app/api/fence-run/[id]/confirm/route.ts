// /api/fence-run/[id]/confirm — potrditev ograjnega tekača (R460 — issue #15 §20/§21/§25)
// POST { handoff?: boolean } (measurements.write)
// Quality gate (§3): 🔴 NEZADOSTNO → 409; validacija brez NAPAK (§19); vsi
// segmenti ≥ MANUAL (brez ocen/predlogov — §19 „ne dovoljuj tihega ustvarjanja
// navidezno natančnih meritev"). Uspeh:
//   • segmenti → CONFIRMED, tekač → POTRJEN (+quality posnetek)
//   • KANONIČNA meritev (type OGRAJA) + verzija v1 (§17 en vir resnice)
//   • neobvezen handoff: ProjectPackage (status IZMERA) z istim produktom,
//     varianto in meritev (§21: konfigurator/BOM/ponudba BREZ ponovnega vnosa)
// Revizija FENCE_RUN_CONFIRM.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { ENGINE_VERSION, SEGMENT_STATUSES } from '@/lib/fence-run-engine'
import { segmentLadderProvenance } from '@/lib/measure-engine'
import { analyzeContext, loadRunContext, snapshotVersionOn } from '@/lib/fence-run-service'
import { fenceRunZaUporabnika } from '@/lib/fence-run-access'
import { nextPackageCodeOn } from '@/lib/product-core'
import { POSTS_RULE_KEY } from '@/lib/segment-bom'
import { retryOnUnique } from '@/lib/versioning'

type Params = { params: Promise<{ id: string }> }

export async function POST (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const scope = await fenceRunZaUporabnika(user, id)
  if (scope instanceof NextResponse) return scope
  if (scope.run.status === 'POTRJEN') {
    return jsonError(409, 'Tekač je že potrjen.', 'Izmera je že prenesena v kanonično meritev.')
  }
  if (scope.run.status === 'ARHIV') {
    return jsonError(409, 'Arhiviranega tekača ni mogoče potrditi.', 'Obnovite status na PREGLED pred potrditvijo.')
  }

  const body = await req.json().catch(() => ({}))
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')
  const handoff = body.handoff === true

  const ctx = await loadRunContext(id)
  if (!ctx) return jsonError(404, 'Tekač ne obstaja.')
  const analysis = analyzeContext(ctx)

  // ── Quality gate (§3/§19): brez tihe potrditev ──
  if (analysis.quality.state === 'NEZADOSTNO') {
    return jsonError(409, 'Zajem ni zanesljiv — potrditev zavrnjena.', analysis.quality.reasons.join(' ') || 'Dopolnite zajem pred potrditvijo.')
  }
  const napake = analysis.validation.filter((v) => v.severity === 'NAPAKA')
  if (napake.length > 0) {
    return jsonError(409, 'Validacija je odkrila napake.', napake.map((n) => n.message).join(' '))
  }
  const slabi = ctx.segments.filter((s) => {
    const order = SEGMENT_STATUSES[s.status as keyof typeof SEGMENT_STATUSES]?.order ?? 0
    return order < SEGMENT_STATUSES.MANUAL.order
  })
  if (slabi.length > 0) {
    return jsonError(409, 'Segmenti brez človeške preveritve.', `Segmenti ${slabi.map((s) => s.order + 1).join(', ')} so ocena/predlog — vsaka kritična dimenzija zahteva ročni vnos, kalibracijo ali preveritev (§19).`)
  }

  // ── Kanonična meritev (§17: en vir resnice, brez ponovnega vnosa §21) ──
  const project = await db.project.findUnique({
    where: { id: ctx.run.projectId },
    select: { code: true, title: true, customer: { select: { name: true, email: true } } },
  })
  const heights = ctx.nodes.map((n) => n.heightCm).filter((h): h is number => h != null)
  const maxHeight = heights.length > 0 ? Math.max(...heights) : null

  // Stanje kanonične meritve izračuna jedro iz lestvice segmentov (R501):
  // brez tega privzame stolpec ESTIMATED, nova poslovna vrata pa tiho
  // zavrnejo kosovnico iz pravilno potrjenega tekača.
  const ladder = segmentLadderProvenance(ctx.segments.map((s) => s.status))

  // ── R539 (transakcijska celovitost): kanonična meritev + verzija v1 +
  // morebitni handoff paket + statusi segmentov/tekača + posnetek verzije +
  // revizija v ENI transakciji — padec srednjega koraka NE pusti »pol-potrjenega«
  // tekača (npr. meritev brez paketa, tekač brez revizije). ZUNANJA retryOnUnique
  // (R536) pokriva P2002 dirke (verzija tekača, koda paketa PAK-…) — ob ponovnem
  // poskusu se CELO telo (izračun kode + verzije vključno) izvede znova;
  // notranji poskusi v PG transakciji niso možni (abortirajo celo tx). ──
  const out = await retryOnUnique(() => db.$transaction(async (tx) => {
    const measurement = await tx.measurement.create({
      data: {
        type: 'OGRAJA',
        source: 'ROCNO',
        status: ladder.status,
        statusNote: ladder.reason,
        projectId: ctx.run.projectId,
        workOrderId: ctx.run.workOrderId,
        authorId: user.id,
        location: ctx.run.name,
        lengthCm: analysis.summary.totalLengthCm,
        heightCm: maxHeight,
        posts: analysis.summary.postCount,
        segments: analysis.summary.segmentCount,
        handrail: true,
        slopeDeg: analysis.summary.maxSlopeDeg,
        params: JSON.stringify({
          fenceRunId: id,
          engine: ENGINE_VERSION,
          source: 'FENCE_RUN',
          calibration: ctx.calibration,
          terrain: ctx.terrain,
          nodes: ctx.nodes,
          segments: ctx.segments.map((s) => ({
            order: s.order, fromAtCm: s.fromAtCm, toAtCm: s.toAtCm,
            lengthCm: s.lengthCm, heightCm: s.heightCm, slopeDeg: s.slopeDeg,
            status: s.status, verifiedCm: s.verifiedCm,
          })),
          summary: analysis.summary,
        }),
        note: ctx.run.note,
      },
    })
    // R536/R539: verzija v1 kanonične meritve — za SVEŽ id je vedno 1, BREZ
    // notranjega retryOnUnique (P2002 v PG transakciji aborta celo tx;
    // pokriva ga zunanja retryOnUnique okoli transakcije).
    const last = await tx.measurementVersion.findFirst({
      where: { measurementId: measurement.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    await tx.measurementVersion.create({
      data: {
        measurementId: measurement.id,
        version: (last?.version ?? 0) + 1,
        userId: user.id,
        data: JSON.stringify({
          type: 'OGRAJA', lengthCm: analysis.summary.totalLengthCm, heightCm: maxHeight,
          posts: analysis.summary.postCount, segments: analysis.summary.segmentCount,
          slopeDeg: analysis.summary.maxSlopeDeg, location: ctx.run.name, note: ctx.run.note,
        }),
        note: `Potrjeno iz ograjnega tekača (${ctx.segments.length} segmentov · ${analysis.summary.verifiedCount} preverjenih)`,
      },
    })

    // ── Handoff: paket projekta z istim produktom/varianto (§21) ──
    let pkg: { id: string; code: string } | null = null
    if (handoff && ctx.run.productId) {
      const product = await tx.product.findUnique({
        where: { id: ctx.run.productId },
        select: { id: true, name: true, unit: true, family: { select: { code: true } } },
      })
      if (product) {
        const variant = ctx.run.variantId
          ? await tx.productVariant.findUnique({ where: { id: ctx.run.variantId }, select: { id: true, name: true } })
          : null
        // R539: koda PAK-… se izračuna ZNOTRAJ transakcije na tx klientu — ob
        // sočasnem P2002 (dva handoffa si izračunata isto kodo) zunanja
        // retryOnUnique ponovi izračun znova (read-then-create dirka zaprta).
        const code = await nextPackageCodeOn(tx, project?.code ?? 'P')
        const qty = Math.round((analysis.summary.totalLengthCm / 100) * 100) / 100
        // R488 (P1 — end-to-end veriga): handoff paket nosi STRUCTURIRANE VHODE
        // iz POTRJENIH segmentov tekača (m-forma, ključi seg-N — isti vir kot
        // konfigurator). Tako POST /api/project-packages/[id]/bom izpelje
        // vrstice PO SEGMENTU (segmentsApplied = N) brez ponovnega vnosa (§21).
        // calcJson.plan se NE shranjuje — izračun ostane suh dry-run (enako
        // konfiguratorju: cene/marža se zapišejo šele z generacijo kosovnice).
        const gates = ctx.nodes.filter((n) => n.kind === 'VRATA').length
        const inputs: Record<string, unknown> = {
          familyCode: product.family.code,
          form: 'm',
          qty,
          qtySource: 'fence-run',
          segments: ctx.segments.map((s) => ({
            kljuc: `seg-${s.order + 1}`,
            dolzina: Math.round(s.lengthCm) / 100, // cm → m (na cel cm)
            visina: s.heightCm != null && s.heightCm > 0 ? Math.round(s.heightCm) / 100 : null,
          })),
          ...(gates > 0 ? { vrataKos: gates } : {}),
          fenceRunId: id,
          runName: ctx.run.name,
          engine: ENGINE_VERSION,
          source: 'FENCE_RUN',
        }
        // razmik stebrov iz AKTIVNEGA EngineeringRule max_razdalja_stebrov (cm → m);
        // brez pravila pusti izpeljavo planBom (opozorilo BREZ_RAZMIKA — pošteno)
        const postsRule = await tx.engineeringRule.findFirst({ where: { key: POSTS_RULE_KEY, active: true } })
        if (postsRule && Number(postsRule.value) > 0) {
          inputs.razmikStebrovM = Math.round(Number(postsRule.value)) / 100
        }
        const created = await tx.projectPackage.create({
          data: {
            code,
            projectId: ctx.run.projectId,
            productId: product.id,
            variantId: variant?.id ?? null,
            measurementId: measurement.id,
            name: variant ? `${product.name} — ${variant.name}` : product.name,
            qty,
            unit: product.unit === 'm' ? 'm' : 'm',
            status: 'IZMERA',
            calcJson: JSON.stringify({ inputs }),
            note: `Iz ograjnega tekača (${ctx.run.name})`,
          },
        })
        pkg = { id: created.id, code: created.code }
      }
    }

    // ── Statusi: segmenti → CONFIRMED, tekač → POTRJEN ──
    await tx.fenceSegment.updateMany({ where: { fenceRunId: id }, data: { status: 'CONFIRMED' } })
    await tx.fenceRun.update({
      where: { id },
      data: {
        status: 'POTRJEN',
        measurementId: measurement.id,
        quality: JSON.stringify(analysis.quality),
      },
    })
    // R539: posnetek verzije NA tx klientu, brez notranjega retrija (zunanja
    // retryOnUnique okoli cele transakcije ga pokriva) — posnetek vidi še
    // ne-commitano stanje POTRJEN (isti vrstni red kot prej).
    const version = await snapshotVersionOn(tx, id, user.id, 'Potrjena izmera')

    await writeAudit({
      userId: user.id,
      action: 'FENCE_RUN_CONFIRM',
      entity: 'fenceRun',
      entityId: id,
      projectId: ctx.run.projectId,
      detail: {
        name: ctx.run.name,
        measurementId: measurement.id,
        totalLengthCm: analysis.summary.totalLengthCm,
        posts: analysis.summary.postCount,
        segments: analysis.summary.segmentCount,
        verified: analysis.summary.verifiedCount,
        quality: analysis.quality,
        ...(pkg ? { package: pkg.code } : {}),
        version,
      },
    }, tx)
    return { measurementId: measurement.id, version, pkg }
  }))

  return NextResponse.json({
    data: {
      runId: id,
      status: 'POTRJEN',
      version: out.version,
      measurementId: out.measurementId,
      ...(out.pkg ? { package: out.pkg } : {}),
      summary: analysis.summary,
    },
  }, { status: 201 })
}

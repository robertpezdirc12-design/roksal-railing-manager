// /api/photo-visualization — R459 (issue #14: REALISTIC PHOTO REPLACEMENT)
// GET  (projects.read) — seznam vizualizacij projekta (?projectId=; BREZ blobov
//      fotografij — samo metapodatke; obseg: monter vidi svoje).
// POST (measurements.write) — shrani varianto (A/B/C) s povezavami projectId +
//      measurementId(verzija) + productId + variantId (§12 eksplicitni ID),
//      verzijo v1 in revizijo PHOTO_VIZ_CREATE (§13).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { ENGINE_VERSION, oceniKakovost } from '@/lib/photo-replace-core'
import {
  MAX_PARAMS_JSON, MAX_PHOTO_BYTES, MAX_RENDERED_BYTES, VARIANT_LABELS,
  bereVseProjekte, naslednjaOznaka, preveriFoto, preveriIzdelek, preveriMeritev,
  preveriRenderParams, preveriSourceFoto, preveriTrdnjenoGradivo, projektZaUporabnika,
} from '@/lib/photo-replace-engine'
import { dokazMere } from '@/lib/viz-provenance'
import { retryOnUnique } from '@/lib/versioning'

const LIST_SELECT = {
  id: true, projectId: true, variantLabel: true, status: true,
  sourcePhotoId: true, measurementId: true, measurementVersion: true,
  productId: true, variantId: true, engineVersion: true, note: true,
  createdAt: true, updatedAt: true,
  author: { select: { name: true, role: true } },
  product: { select: { sku: true, name: true } },
  variant: { select: { sku: true, name: true, ral: true } },
  project: { select: { code: true, title: true } },
  _count: { select: { versions: true } },
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const status = url.searchParams.get('status')

  const vizs = await db.photoVisualization.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
      // §13 obseg: monter vidi samo svoje vizualizacije (avtor) ali svojih projektov
      ...(bereVseProjekte(user) ? {} : {
        OR: [
          { authorId: user.id },
          { project: { workOrders: { some: { assigneeId: user.id } } } },
        ],
      }),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: LIST_SELECT,
  })
  return NextResponse.json({ data: vizs })
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  // projekt + obseg
  const projekt = typeof body.projectId === 'string' && body.projectId
    ? await projektZaUporabnika(user, body.projectId)
    : null
  if (projekt instanceof NextResponse) return projekt
  if (!projekt) return jsonError(400, 'Manjka projekt (projectId) — vizualizacija je vedno vezana na projekt.')

  // fotografija (ORIGINAL ostane vir slike, §1)
  const foto = preveriFoto(body.sourcePhoto, MAX_PHOTO_BYTES, 'Fotografija')
  if ('napaka' in foto) return jsonError(400, foto.napaka)

  // izrisana POTEM sličica (neobvezna — za PDF/portal)
  let rendered: string | null = null
  if (body.rendered != null) {
    const r = preveriFoto(body.rendered, MAX_RENDERED_BYTES, 'Izrisana sličica')
    if ('napaka' in r) return jsonError(400, r.napaka)
    rendered = r.dataUrl
  }

  // izdelek + varianta (§2: ROKSAL katalog je edini vir videza)
  const izdelek = await preveriIzdelek(body.productId, body.variantId)
  if ('napaka' in izdelek) return jsonError(izdelek.status, izdelek.napaka)

  // meritev + snapshot verzije (§6/§12/§13) + RAVEN mere (R510, Faza 6)
  let measurementId: string | null = null
  let measurementVersion: number | null = null
  let potrjenaMeraCm: number | null = null
  let meraDokaz: { status: string; verzija: number | null } | null = null
  if (body.measurementId != null) {
    const m = await preveriMeritev(body.measurementId, projekt.id)
    if ('napaka' in m) return jsonError(m.status, m.napaka)
    measurementId = m.meritev.id
    measurementVersion = m.verzija
    potrjenaMeraCm = m.meritev.lengthCm
    meraDokaz = dokazMere(m.meritev.status, m.verzija)
  }

  // izvorna fotografija (sledljivost §13)
  const srcFoto = await preveriSourceFoto(body.sourcePhotoId, projekt.id)
  if (srcFoto && typeof srcFoto === 'object' && 'napaka' in srcFoto) {
    return jsonError(srcFoto.status, srcFoto.napaka)
  }

  // renderParams (quad + referenca + konfiguracija)
  const params = preveriRenderParams(body.renderParams)
  if ('napaka' in params) return jsonError(400, params.napaka)

  // oznaka variante A/B/C (§7)
  let oznaka: string
  if (body.variantLabel != null) {
    if (typeof body.variantLabel !== 'string' || !(VARIANT_LABELS as readonly string[]).includes(body.variantLabel)) {
      return jsonError(400, 'Oznaka variante mora biti A, B ali C.')
    }
    const zasedena = await db.photoVisualization.findFirst({ where: { projectId: projekt.id, variantLabel: body.variantLabel } })
    if (zasedena) return jsonError(409, `Varianta ${body.variantLabel} na tem projektu že obstaja — posodobite jo (PATCH) ali izberite drugo črko.`)
    oznaka = body.variantLabel
  } else {
    const prost = await naslednjaOznaka(projekt.id)
    if (!prost) return jsonError(409, 'Vse tri variante (A/B/C) na tem projektu so že zasedene.', 'Obstoječo varianto posodobite s PATCH ali jo arhivirajte.')
    oznaka = prost
  }

  const renderParamsJson = JSON.stringify(params.params)
  if (renderParamsJson.length > MAX_PARAMS_JSON) {
    return jsonError(400, 'Parametri izrisa presežejo dovoljeno velikost.')
  }

  // opozorila kakovosti (§1) — shranijo se v verzijo (meta)
  const opozorila = oceniKakovost(params.params, 1000, 750, potrjenaMeraCm)

  // ── R510 (issue #15 Faza 6): dokazna veriga IZVEDENE slike ─────────────────
  // Odjemalec sme NATISNITI samo assetId; pot, SHA-256, status in pripadnost
  // izdelku prebere strežnik iz baze. Nepotrdljive trditve NE blokirajo
  // shranjevanja (vizualizacija je sicer pripravljena), a v dokumentu dobjo
  // razlog — bralec tako vidi, da dokaza ni, ne da bi se zapis izgubil.
  const gradivo = await preveriTrdnjenoGradivo(body.gradivo, izdelek.produkt.id)
  if ('napaka' in gradivo) return jsonError(400, gradivo.napaka)
  const dokaz = {
    meritev: meraDokaz,
    izvirnikFotografije: srcFoto ?? null,
    gradivo: gradivo.rezultat.dokaz,
    gradivoRazlog: gradivo.rezultat.razlog,
  }

  const viz = await db.photoVisualization.create({
    data: {
      projectId: projekt.id,
      authorId: user.id,
      variantLabel: oznaka,
      status: 'OSNUTEK',
      sourcePhoto: foto.dataUrl,
      sourcePhotoId: srcFoto ?? null,
      measurementId,
      measurementVersion,
      productId: izdelek.produkt.id,
      variantId: typeof body.variantId === 'string' && body.variantId ? body.variantId : null,
      engineVersion: ENGINE_VERSION,
      renderParams: renderParamsJson,
      rendered,
      note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null,
    },
  })

  // verzija v1 — posnetek nastanka (§12: brez tihega prepisovanja)
  // R536: dirka verzij — P2002 na @@unique([visualizationId, version]) → ponovni
  // poskus (versioning.ts). Številka se izračuna iz zadnje verzije ZNOTRAJ
  // retried fn; za sveže ustvarjeno vizualizacijo (nov id) je to vedno 1,
  // vzorec read-then-create pa je enoten z ostalimi verigami verzij.
  const v1 = await retryOnUnique(async () => {
    const zadnja = await db.photoVisualizationVersion.findFirst({
      where: { visualizationId: viz.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    return db.photoVisualizationVersion.create({
      data: {
        visualizationId: viz.id,
        version: (zadnja?.version ?? 0) + 1,
        data: JSON.stringify({
          renderParams: params.params,
          meta: {
            opozorila,
            engineVersion: ENGINE_VERSION,
            // R510: dokaz, NA KATERI MERI in KATEREM IZVIRNIKU gradiva slika stoji.
            dokaz,
          },
        }),
        userId: user.id,
        note: 'Ustvarjena varianta',
      },
    })
  })

  await writeAudit({
    userId: user.id,
    action: 'PHOTO_VIZ_CREATE',
    entity: 'photoVisualization',
    entityId: viz.id,
    projectId: projekt.id,
    detail: {
      variantLabel: oznaka, productId: izdelek.produkt.id, sku: izdelek.produkt.sku,
      measurementId, measurementVersion, sourcePhotoId: srcFoto ?? null,
      engineVersion: ENGINE_VERSION, opozorila: opozorila.map((o) => o.koda),
      // R510: dokaz je del revizijskega zapisa — kaj je bilo potrjeno in kaj ne
      meraStatus: dokaz.meritev?.status ?? null,
      gradivoDokaz: dokaz.gradivo?.assetId ?? null,
      gradivoRazlog: dokaz.gradivoRazlog,
    },
  })

  return NextResponse.json({
    data: {
      id: viz.id, variantLabel: oznaka, status: viz.status,
      version: v1.version, engineVersion: ENGINE_VERSION, opozorila, dokaz,
    },
  }, { status: 201 })
}

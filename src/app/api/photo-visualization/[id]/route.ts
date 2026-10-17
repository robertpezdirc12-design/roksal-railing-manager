// /api/photo-visualization/[id] — R459 (issue #14)
// GET   (projects.read) — polna vizualizacija: originalna fotografija +
//       izrisana sličica + verzije (meta) + opozorila + dokazna veriga (R510).
//       Obseg §13 (IDOR).
// PATCH (measurements.write) — sprememba: renderParams (→ NOVA VERZIJA §12,
//       nikoli tiho prepisano), rendered, note, status (IZBRANA pomeni, da
//       ostale variante projekta padejo nazaj na OSNUTEK — ena izbrana),
//       izvirnik fotografije in trditev o gradivu (R510, samo strežniško
//       potrjeno).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { ENGINE_VERSION, oceniKakovost } from '@/lib/photo-replace-core'
import {
  MAX_PARAMS_JSON, MAX_RENDERED_BYTES, STATUSES,
  preveriFoto, preveriIzdelek, preveriRenderParams, preveriSourceFoto,
  preveriTrdnjenoGradivo, stanjeMere, vizZaUporabnika,
} from '@/lib/photo-replace-engine'
import {
  dokazMere, preberiDokaz, smeVizualizacijo,
  type RezultatGradiva, type VizDokaz,
} from '@/lib/viz-provenance'
import { retryOnUnique } from '@/lib/versioning'
import { asJsonObject } from '@/lib/json'
import { Prisma } from '@prisma/client'

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

  // opozorila in dokaz iz zadnje verzije (meta) — za prikaz ob ponovnem
  // odpiranju (R510, issue #15 Faza 6)
  let opozorila: { koda: string; sporocilo: string }[] = []
  const zadnjaVerzija = await db.photoVisualizationVersion.findFirst({
    where: { visualizationId: id },
    orderBy: { version: 'desc' },
    select: { data: true },
  })
  if (zadnjaVerzija) {
    // R542: data je jsonb objekt — branje brez JSON.parse (obramba za ne-tabelo)
    const op = asJsonObject(asJsonObject(zadnjaVerzija.data)?.meta)?.opozorila
    if (Array.isArray(op)) opozorila = op as { koda: string; sporocilo: string }[]
  }
  const dokazVerzije = preberiDokaz(zadnjaVerzija?.data)

  // Meritev in izvirnik fotografije se pokažeta iz trenutnega stanja (raven mere
  // se lahko spremeni tudi po shranjevanju), dokaz o gradivu pa iz posnetka —
  // samo takrat ga je namreč potrdil strežnik.
  const mera = await stanjeMere(viz.measurementId)
  const meraRazveljavljena = viz.measurementId !== null && !smeVizualizacijo(mera?.status).sme
  const dokaz: VizDokaz = {
    meritev: viz.measurementId
      ? dokazMere(mera?.status ?? null, mera?.verzija ?? viz.measurementVersion)
      : null,
    izvirnikFotografije: viz.sourcePhotoId,
    gradivo: dokazVerzije?.gradivo ?? null,
    gradivoRazlog: dokazVerzije?.gradivoRazlog ?? null,
  }

  // Zapis pred R510 dokaza nima: iz praznega polja se ne dela laž — bralec dobi
  // samo tisto, kar je bilo zapisano ali je razvidno iz povezav danes.
  const odgovor = { ...viz, opozorila, dokaz, meraRazveljavljena, izvirnikFotografije: viz.sourcePhotoId }
  return NextResponse.json({ data: odgovor })
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

  // ── R510 (issue #15 Faza 6): podlaga mere — brana VEDNO, kadar mera obstaja ─
  // Raven mere in njena zadnja verzija gresta v dokazno verigo. Kadar je bila
  // mera MEDTEM razveljavljena, to zabeležimo kot opozorilo: urejanja
  // obstoječe vizualizacije NE blokiramo (monter jo mora lahko popraviti), a
  // bralec dokumenta mora videti, da podlaga ni več veljavna.
  let meraDokaz: { status: string; verzija: number | null } | null = null
  let meraRazveljavljena = false
  let dolzinaMereCm: number | null = null
  if (viz.measurementId) {
    const mera = await stanjeMere(viz.measurementId)
    meraDokaz = dokazMere(mera?.status ?? null, mera?.verzija ?? viz.measurementVersion)
    dolzinaMereCm = mera?.lengthCm ?? null
    meraRazveljavljena = !smeVizualizacijo(mera?.status).sme
  }

  // ── renderParams → NOVA VERZIJA (§12: vsaka sprememba = nova verzija) ──────
  let novaVerzija = 0
  let opozorilaKodi: string[] = []
  let dokazPrejsnje: VizDokaz | null = null
  if (body.renderParams !== undefined) {
    const params2 = preveriRenderParams(body.renderParams)
    if ('napaka' in params2) return jsonError(400, params2.napaka)
    // R542: velikostna varovalka ostaja (JSON.stringify samo za meritev dolžine);
    // renderParams se shrani kot jsonb OBJEKT
    if (JSON.stringify(params2.params).length > MAX_PARAMS_JSON) return jsonError(400, 'Parametri izrisa presežejo dovoljeno velikost.')

    // §6: ce je vezana meritev, opozori na odstopanje prikazne dolzine
    const opozorila = oceniKakovost(params2.params, 1000, 750, dolzinaMereCm)
    opozorilaKodi = meraRazveljavljena
      ? ['MERA_RAZVELJAVLJENA', ...opozorila.map((o) => o.koda)]
      : opozorila.map((o) => o.koda)

    // R542: renderParams je jsonb — objekt direktno
    update.renderParams = params2.params
    update.engineVersion = ENGINE_VERSION

    // dokaz PREJŠNJE verzije (R510: nova verzija ne sme tiho izgubiti potrjene
    // trditve o gradivu) — eno branje, stabilno znotraj te zahteve.
    // R536: ŠTEVILKA verzije se tu NE izračunava več — dirko (dva sočasna
    // PATCH-a bi izračunala isto številko) zapira retried fn spodaj.
    const zadnja = await db.photoVisualizationVersion.findFirst({
      where: { visualizationId: id },
      orderBy: { version: 'desc' },
      select: { data: true },
    })
    dokazPrejsnje = preberiDokaz(zadnja?.data)
    // oznaka „ustvarila se bo nova verzija“ — prava številka se zapiše po retried
    // create spodaj (odgovor in revizija nosita DEJANSKO ustvarjeno številko)
    novaVerzija = 1
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

  // ── R510 (issue #15 Faza 6): dokazna veriga IZVEDENE slike ─────────────────
  // 1) IZVIRNIK fotografije: stare vizualizacije so nastale brez povezave, ker
  //    jo je UI tiho pošiljal kot null. Tu jo je mogoče POPRAVITI — ali ob
  //    shranjevanju nove verzije ali samostojno.
  // 2) TRDITEV o gradivu: odjemalec natisne samo assetId, strežnik prebere
  //    pot/SHA-256/status/dovoljenje iz baze in zapiše samo to, kar potrdi.
  let izvirnikId: string | null = viz.sourcePhotoId
  if (body.sourcePhotoId !== undefined) {
    const srcFoto = await preveriSourceFoto(body.sourcePhotoId, viz.projectId)
    if (srcFoto && typeof srcFoto === 'object' && 'napaka' in srcFoto) {
      return jsonError(srcFoto.status, srcFoto.napaka)
    }
    izvirnikId = srcFoto ?? null
    update.sourcePhotoId = izvirnikId
  }

  const veljavniProduktId = typeof body.productId === 'string' && body.productId ? body.productId : viz.productId
  let rezultatGradiva: RezultatGradiva = { dokaz: null, razlog: null }
  if (body.gradivo !== undefined) {
    const g = await preveriTrdnjenoGradivo(body.gradivo, veljavniProduktId)
    if ('napaka' in g) return jsonError(400, g.napaka)
    rezultatGradiva = g.rezultat
  } else if (novaVerzija > 0 && dokazPrejsnje?.gradivo) {
    // Nova verzija (npr. zamaknjen kvad) NE sme izbrisati dokaza o gradivu, ki
    // ga je strežnik potrdil prej. Zato isto trditev POTRDIMO ZNOVA iz baze —
    // na sedanjem izdelku. Če potrditev tokrat spodleti, gre v dokument razlog,
    // ne tiha izguba in ne prejšnji dokaz.
    const g = await preveriTrdnjenoGradivo({ assetId: dokazPrejsnje.gradivo.assetId }, veljavniProduktId)
    if ('napaka' in g) return jsonError(400, g.napaka)
    rezultatGradiva = g.rezultat
  }

  const dokaz: VizDokaz = {
    meritev: meraDokaz,
    izvirnikFotografije: izvirnikId,
    gradivo: rezultatGradiva.dokaz,
    gradivoRazlog: rezultatGradiva.razlog,
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
    const renderParams = update.renderParams as Prisma.InputJsonValue
    // R536: dirka verzij — branje zadnje verzije in izračun naslednje sta
    // ZNOTRAJ retried fn (versioning.ts): ob sočasnem P2002 na
    // @@unique([visualizationId, version]) se številka izračuna znova in
    // poskus ponovi. `dokaz`/`opozorilaKodi` sta stabilna znotraj zahteve,
    // zato je ponovitev varna; create NI v transakciji — razveljaviti ni
    // treba ničesar (posnetek je dodaten zapis, vrstica pa je že posodobljena).
    const verzija = await retryOnUnique(async () => {
      const zadnja = await db.photoVisualizationVersion.findFirst({
        where: { visualizationId: id },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      return db.photoVisualizationVersion.create({
        data: {
          visualizationId: id,
          version: (zadnja?.version ?? 0) + 1,
          // R542: data je jsonb — posnetek kot objekt (ne JSON.stringify)
          data: {
            renderParams,
            meta: { opozorila: opozorilaKodi, engineVersion: ENGINE_VERSION, dokaz },
          } as unknown as Prisma.InputJsonValue,
          userId: user.id,
          note: typeof body.versionNote === 'string' && body.versionNote.trim() ? body.versionNote.trim().slice(0, 200) : 'Sprememba konfiguracije',
        },
      })
    })
    novaVerzija = verzija.version
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
      // R510: veriga sodi v revizijski zapis — kaj je bilo potrjeno in zakaj kaj ne
      meraStatus: dokaz.meritev?.status ?? null,
      izvirnikFotografije: dokaz.izvirnikFotografije,
      gradivoDokaz: dokaz.gradivo?.assetId ?? null,
      gradivoRazlog: dokaz.gradivoRazlog,
    },
  })

  return NextResponse.json({
    data: {
      id: updated.id, status: updated.status, updatedAt: updated.updatedAt,
      dokaz,
      ...(novaVerzija > 0 ? { verzija: novaVerzija } : {}),
    },
  })
}

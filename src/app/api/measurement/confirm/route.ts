// /api/measurement/confirm — potrditev izmerjene vrednosti s fotografije (issue #1)
// POST { photoId, type, location?, lengthCm, heightCm?, slopeDeg?, posts?, segments?,
//        handrail?, note?, projectId?, workOrderId?, points?, calibration? } (measurements.write)
// Shrani REZULTAT meritve v projekt/nalog: source=KAMERA, params nosijo photoId,
// točke in kalibracijo (ponovna izdelava/revizija). Ustvari tudi verzijo v1.
// Več klicev na isti photoId = več meritev na isti fotografiji.
//
// R455 (issue #10 — PROFESIONALNE KAMERNE MERITVE) — razširitve (vse opcijske,
// povratno združljive):
//   • views[] — dodatni pogledi (več fotografij istega objekta): vsak { photoId?,
//     points?, calibration? } — shranjeno v params.views za revizijo;
//   • quality — ocena kakovosti zajema { brightness?, blurScore?, dark?, bright?,
//     blurry? } (odjemalčeva analiza kadra — svetlost/ostrost);
//   • confidence — stopnja zaupanja 0..100 (izračun v UI iz kakovosti + kalibracije
//     + strinjanja pogledov; strežnik validira in zapiše);
//   • manualOverride — ročni popravek dolžine: { computedLengthCm, reason } —
//     razlog je OBVEZEN (sledljivost ročnih sprememb, §1 issue #10).
// Samodejni (VLM) predlogi NIKOLI niso potrjeni brez izrecnega dejanja uporabnika —
// točke s src=PREDLOG odjemalec sprejme pred potrditvijo (tu prispejo kot navadne).
//
// R457 (issue #12 — VRHUNSKI MERILNI ENGINE) — aditivno:
//   • mode — način izmere (OGRAJA | KERAMIKA | STREHA | FASADA | STOPNICE |
//     PROSTOR | SPLOSNO, §2) — zapiše se v params.mode + revizijo;
//   • engine — rezultat kanonične analize (POST /api/measure-engine/analyze):
//     { domain?, validation?, confidence?, captureGuide? } — omejeno na 8 KB,
//     zapisano v params.engine za revizijo/izvoz (§7 ena meritev — en vir resnice).
//
// R487 (issue #3 — MULTI-VIEW → KONSISTENTNA POTRDITEV) — aditivno:
//   • strežniška konsolidacija: per-view dolžine se PRERAČUNAJO iz točk +
//     kalibracij z obstoječim determinističnim computeGeometry (NE iz
//     odjemalčeve izjave — ponovljivost §6: isti vhodi → isti rezultat);
//   • params.multiView = { count, values, mean, spreadPct, conflict,
//     manualOverride? } + revizija zapisa (konflikt je VIDEN, ne tih);
//   • vrata: razpršenost > 15 % (prag AR konsolidatorja) BREZ ročnega popravka
//     z razlogom → 409 (§4C »ne popravljaj geometrije tiho«, KPI »0 potrjenih
//     mer z nerešenim kritičnim konfliktom«); manualOverride z razlogom (r455)
//     je VELJAVNA rešitev → 201;
//   • BREZ views ostane params BITNO enak staremu (r439/r455 legacy).
//
// R509 (issue #7 §8 — pisarniška veriga) — aditivno:
//   • handoffProductId (+ handoffVariantId) — IZREČNA zahteva po prenosu
//     potrjene meritve v paket projekta (status IZMERA). Brez njega se paket
//     NE ustvari (nobena tiha domišljija izdelka/cenovnega razreda);
//   • prenos potrebuje pravico `quotes.create` (ista kot /api/project-packages);
//   • količina je izpeljiva SAMO nedvoumno (m ← dolžina; m2 ← dolžina × višina;
//     'kos' in neznane enote → ZAVRNJENO z razlogom);
//   • cene/marže/kosovnice TU NE NASTAJEJO (calcJson je samo dokaz izvora) —
//     en vir cenovnega resnice ostaja `/api/project-packages/[id]/bom`;
//   • idempotentno: meritev s paketom → OBSTAJA (noben dvojni paket);
//   • odgovor: `{ data, paket? }` — obstoječi klicatelji berejo samo `data`.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { deliverEvent, recordEvent } from '@/lib/notify'
import {
  MEASURE_MODES, MODE_RULES, consolidateViews, viewLengthCm, polygonMetrics, parseEnginePoints,
  pointsForStorage, viewForStorage, calibrationForParams, parseCalibration,
  pickEngineExtras, deriveProvenance, provenanceForParams, type MeasureMode,
} from '@/lib/measure-engine'
import { MEASURE_CONFLICT_PCT } from '@/lib/scene-understanding-core'
import { odlociPaket, HANDOFF_VERSION } from '@/lib/measurement-handoff'
import { nextPackageCode } from '@/lib/product-core'
import { retryOnUnique } from '@/lib/versioning'

const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'OSTANEO']

const MAX_VIEWS = 4

/** R455: normalizira en pogled (točke + kalibracija) — enaka pravila kot glavni.
 *  R501 (issue #15 faza 2): celotna pogodba je v jedru (`viewForStorage`), da se
 *  pravila dodatnih pogledov ne morejo več razhajati od pravil glavne meritve
 *  ali offline sinhronizacije. */
function parseView (v: unknown): Record<string, unknown> | null {
  return viewForStorage(v)
}

function num (v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function int (v: unknown): number | null {
  const n = num(v)
  return n === null ? null : Math.round(n)
}

export async function POST (req: NextRequest) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user, perms } = auth

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError(400, 'Neveljavno telo zahteve.')

  const photoId = typeof body.photoId === 'string' && body.photoId ? body.photoId : null
  if (!photoId) return jsonError(400, 'Manjka photoId.', 'Podajte id fotografije, na kateri je bilo merjeno.')

  const photo = await db.measurement.findUnique({ where: { id: photoId }, select: { id: true, type: true, projectId: true, workOrderId: true, location: true } })
  if (!photo) return jsonError(404, 'Fotografija (meritev) ne obstaja.')

  const type = typeof body.type === 'string' && body.type ? body.type : 'OGRAJA'
  if (!TYPES.includes(type)) {
    return jsonError(400, 'Neznan tip meritve.', `Veljavni tipi: ${TYPES.join(', ')}.`)
  }

  const lengthCm = num(body.lengthCm)
  const heightCm = num(body.heightCm)
  const slopeDeg = num(body.slopeDeg)
  const posts = int(body.posts)
  const segments = int(body.segments)
  const handrail = typeof body.handrail === 'boolean' ? body.handrail : true
  if (lengthCm === null || lengthCm <= 0) {
    return jsonError(400, 'Potrditev zahteva dolžino.', 'lengthCm (cm) je obvezen in > 0.')
  }
  if ([lengthCm, heightCm, slopeDeg, posts, segments].some((n) => n !== null && n < 0)) {
    return jsonError(400, 'Številske vrednosti ne morejo biti negativne.')
  }
  if (lengthCm > 10000) return jsonError(400, 'Dolžina je nerealna (max 100 m).')

  const workOrderId = typeof body.workOrderId === 'string' && body.workOrderId ? body.workOrderId : photo.workOrderId
  let projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : photo.projectId

  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return jsonError(400, 'Projekt ne obstaja.', 'Podan projectId ni veljaven.')
  }

  // ── R455: ročni popravek dolžine — razlog je obvezen (sledljivost §1) ──
  let manualOverride: { computedLengthCm: number; reason: string } | null = null
  if (body.manualOverride && typeof body.manualOverride === 'object') {
    const mo = body.manualOverride as { computedLengthCm?: unknown; reason?: unknown }
    const computed = Number(mo.computedLengthCm)
    const reason = typeof mo.reason === 'string' ? mo.reason.trim() : ''
    if (!Number.isFinite(computed) || computed <= 0 || computed > 10000) {
      return jsonError(400, 'Ročni popravek: computedLengthCm je neveljaven.', 'Podajte izračunano dolžino (cm, > 0).')
    }
    if (reason.length < 3) {
      return jsonError(400, 'Ročni popravek zahteva razlog.', 'Obvezno navedite razlog ročne spremembe dolžine (sledljivost).')
    }
    manualOverride = { computedLengthCm: Math.round(computed * 10) / 10, reason: reason.slice(0, 200) }
  }

  // ── R455: stopnja zaupanja 0..100 ──
  let confidence: number | null = null
  if (body.confidence !== undefined && body.confidence !== null) {
    const c = Number(body.confidence)
    if (!Number.isFinite(c) || c < 0 || c > 100) {
      return jsonError(400, 'Neveljavna stopnja zaupanja.', 'confidence mora biti število 0..100.')
    }
    confidence = Math.round(c)
  }

  // ── R455: dodatni pogledi (max 4) ──
  let views: Record<string, unknown>[] | null = null
  if (body.views !== undefined && body.views !== null) {
    if (!Array.isArray(body.views)) {
      return jsonError(400, 'views mora biti seznam.', 'Podajte največ 4 dodatne poglede istega objekta.')
    }
    if (body.views.length > MAX_VIEWS) {
      return jsonError(400, `Preveč pogledov (max ${MAX_VIEWS}).`)
    }
    const parsed = body.views.map(parseView).filter((v): v is Record<string, unknown> => v !== null)
    if (parsed.length > 0) views = parsed
  }

  // ── R455: ocena kakovosti zajema (odjemalčeva analiza kadra) ──
  let quality: Record<string, unknown> | null = null
  if (body.quality && typeof body.quality === 'object') {
    const q = body.quality as { brightness?: unknown; blurScore?: unknown; dark?: unknown; bright?: unknown; blurry?: unknown }
    const out: Record<string, unknown> = {}
    const b = Number(q.brightness); const bl = Number(q.blurScore)
    if (Number.isFinite(b) && b >= 0 && b <= 255) out.brightness = Math.round(b)
    if (Number.isFinite(bl) && bl >= 0 && bl <= 10000) out.blurScore = Math.round(bl)
    if (typeof q.dark === 'boolean') out.dark = q.dark
    if (typeof q.bright === 'boolean') out.bright = q.bright
    if (typeof q.blurry === 'boolean') out.blurry = q.blurry
    if (Object.keys(out).length > 0) quality = out
  }
  if (workOrderId) {
    const workOrder = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, projectId: true } })
    if (!workOrder) return jsonError(400, 'Nalog ne obstaja.', 'Podan workOrderId ni veljaven.')
    projectId = workOrder.projectId ?? projectId // samodejna povezava vsega s projektom
  }

  // ── R457: način izmere (§2) + rezultat engine-a (§7) ──
  let mode: string | null = null
  if (body.mode !== undefined && body.mode !== null) {
    if (typeof body.mode !== 'string' || !(MEASURE_MODES as string[]).includes(body.mode)) {
      return jsonError(400, 'Neznan način izmere.', `Veljavni načini: ${MEASURE_MODES.join(', ')}.`)
    }
    mode = body.mode
  }
  let engine: Record<string, unknown> | null = null
  if (body.engine !== undefined && body.engine !== null) {
    if (typeof body.engine !== 'object' || Array.isArray(body.engine)) {
      return jsonError(400, 'engine mora biti objekt.', 'Rezultat analize /api/measure-engine/analyze.')
    }
    const e = body.engine as Record<string, unknown>
    // R501 (issue #15 faza 2): ENOTNI nabor dovoljenih ključev rezultata engine-a
    // (jedro `pickEngineExtras`) — isti seznam uporablja offline sinhronizacija,
    // zato se `scale`/`validity` tam več ne moreta tiho izgubiti.
    const picked = pickEngineExtras(e)
    if (!picked) {
      return Object.keys(e).length === 0
        ? jsonError(400, 'engine je prazen.', 'Podajte vsaj enega od: domain, validation, confidence, captureGuide.')
        : jsonError(400, 'engine nima nobene dovoljene vsebine ali je prevelik (max 8 KB).')
    }
    engine = picked
  }

  // ── R487 (issue #3): strežniška konsolidacija več pogledov (ADITIVNO) ──
  // Dolžine vseh pogledov (primarni iz body.points+calibration, dodatni iz
  // views[].points+calibration) se PRERAČUNAJO z determinističnim computeGeometry
  // v jedru (`consolidateViews`), NE iz odjemalčeve izjave. Isti izračun uporablja
  // offline sinhronizacija (R501) — razhajanja med mrežno in terensko potjo ni.
  const consolidation = views
    ? consolidateViews({
      primaryPoints: body.points,
      primaryCalibration: body.calibration,
      views,
      manualOverride: manualOverride !== null,
      conflictPct: MEASURE_CONFLICT_PCT,
    })
    : { multiView: null, conflict: false, blocked: false }
  const multiView = consolidation.multiView
  // R501: vrata (409) so zaprta samo za NEREŠEN konflikt. `conflict` je viden podatek
  // o razpršenosti, `blocked` pa odloča — ročni popravek z razlogom (r455) reši
  // konflikt, zato mrežna pot ni strožja od terenske (sync uporablja isti `blocked`).
  if (multiView && consolidation.blocked) {
    // §4C »konflikte prikaži uporabniku; ne popravljaj geometrije tiho« +
    // KPI »0 potrjenih proizvodnih mer z nerešenim kritičnim konfliktom«:
    // nerešeno razhajanje > 15 % BREZ ročnega popravka z razlogom →
    // potrditev ZAVRNJENA. Ročni popravek z razlogom (r455) je veljavna
    // rešitev — vrata ostanejo odprta (zavestna odločitev uporabnika).
    return jsonError(409, 'Pogledi se preveč razlikujejo.',
      `Razpršenost ${multiView.spreadPct.toString().replace('.', ',')} % med ${multiView.count} pogledi presega ${MEASURE_CONFLICT_PCT} % — popravite točke ali kalibracijo na pogledih, ali podajte ročni popravek dolžine z razlogom (manualOverride).`)
  }

  // ── R513 (issue #15 faza 1, prenos iz vzporedne linije main): STREŽNIŠKI
  // PRERAČUN JE AVTORITETA — in PO konfliktnih vratih (konflikt pogledov je
  // natančnejši vzrok). Kandidati, s katerimi se lahko dolžina ujema (2 %):
  // primarna geometrija (px/cm ALI ravnina) IN povprečje konsolidiranih pogledov
  // — več strinjajočih pogledov je pravi vir, če se primarni ne ujema.
  // Ročni popravek z razlogom ostaja veljavna pot (zavestna odločitev). ──
  {
    const primary = viewLengthCm(body.points, body.calibration)
    const kandidati: number[] = []
    if (primary !== null) kandidati.push(primary)
    if (multiView != null && multiView.mean > 0) kandidati.push(multiView.mean)
    // Poligonski načini (KERAMIKA, PROSTOR …): dolžina = OBSEG zaprtega
    // poligona (r457 pogodba: polyline 4 točk = 3 segmenti, obseg pa vključi
    // zaklepalko nazaj na prvo točko — odjemalec pošilja obseg).
    const modeRule = mode != null ? MODE_RULES[mode as MeasureMode] : null
    if (modeRule?.polygon) {
      const poly = polygonMetrics(parseEnginePoints(body.points), parseCalibration(body.calibration))
      if (poly.scale.known && poly.perimeterCm > 0) kandidati.push(poly.perimeterCm)
    }
    const usklajena = kandidati.some((k) => Math.abs(k - lengthCm) / k <= 0.02)
    if (kandidati.length > 0 && !usklajena && manualOverride === null) {
      const fmt = (n: number): string => (Math.round(n * 10) / 10).toString().replace('.', ',')
      const odst = (Math.round((Math.min(...kandidati.map((k) => Math.abs(k - lengthCm) / k))) * 1000) / 10).toString().replace('.', ',')
      return jsonError(409, 'Dolžina se ne ujema z izračunom.',
        `Iz točk in kalibracije izhaja ${kandidati.map(fmt).join(' cm / ')} cm, potrjujete ${fmt(lengthCm)} cm (najmanjše odstopanje ${odst} % > 2 %) — popravite točke/kalibracijo ali podajte manualOverride z razlogom.`)
    }
  }

  // ── R501 (issue #15 faza 2): PROVENIENCA ──────────────────────────────────
  // Stanje zaupanja izračuna STREŽNIK iz ponovno preračunane geometrije —
  // odjemalčeva trditev (body.engine) zanj NI vir. Brez dokazanega merila je
  // rezultat ocena (ESTIMATED) in kot taka ne sme v BOM (issue #15 H2).
  const provenance = deriveProvenance({
    points: body.points,
    calibration: body.calibration,
    mode: mode as MeasureMode | null,
    legacyType: type,
    manualOverride: manualOverride !== null,
    viewsAgreeing: multiView !== null && multiView.count >= 2 && !multiView.conflict,
  })

  // points + calibration shranimo v params (zapis postopka za revizijo/ponovno izdelavo)
  // points: normalizirane koordinate 0..1; calibration dodatno nosi imgW/imgH za
  // pretvorbo v piksle pri ponovnem izračunu (GET /api/railing-layout?measurementId)
  let params: string | null = null
  try {
    const extra: Record<string, unknown> = { photoId, source: 'KAMERA' }
    // R501 (issue #15 faza 2): točke grejo skozi ENOTNO normalizacijo (`pointsForStorage`)
    // kot offline sinhronizacija — neveljavna točka se ne more več vstaviti v zapis
    // in nato tiho spremeniti dolžine pri ponovnem izračunu.
    const pts = pointsForStorage(body.points)
    if (pts) extra.points = pts
    if (body.calibration && typeof body.calibration === 'object') {
      // R501 (issue #15 faza 2): ENOTNA kalibracijska pogodba — pravila so v
      // jedru (measure-engine), ne več v tej ruti. Dokumentarne vrednosti
      // (metoda, referenca, dimenzije slike) ostanejo, tudi če px/cm par
      // manjka; tak zapis je merilo NEZNANO in nikoli poslovna mera.
      const cal = calibrationForParams(body.calibration)
      if (cal) extra.calibration = cal
    }
    // R455: več pogledov, kakovost, zaupanje, ročni popravek — vse v params (revizija)
    if (views) extra.views = views
    // R487: strežniško izračunana konsolidacija pogledov (revizija/izvoz)
    if (multiView) extra.multiView = multiView
    if (quality) extra.quality = quality
    if (confidence !== null) extra.confidence = confidence
    if (manualOverride) extra.manualOverride = manualOverride
    // R457: način izmere + rezultat engine-a (§7 — ena meritev, en vir resnice)
    if (mode) extra.mode = mode
    if (engine) extra.engine = engine
    // R501 (issue #15 faza 2): KAKO je bila številka pridobljena (verzija
    // pogodbe, model merila/transformacija, metoda, referenca) — strežniški
    // izračun, ne trditev odjemalca.
    extra.provenance = provenanceForParams({
      status: provenance.status,
      reason: provenance.reason,
      scale: provenance.scale,
      calibration: parseCalibration(body.calibration),
    })
    params = JSON.stringify(extra)
  } catch { params = JSON.stringify({ photoId, source: 'KAMERA' }) }

  // R438 (issue #5): kontakt stranke za statusno obvestilo (EMAIL, maskiran
  // naslov) — branje PRED transakcijo (samo vsebina obvestila, ne odloča o zapisu).
  const customer = projectId
    ? await db.project.findUnique({
      where: { id: projectId },
      select: { customer: { select: { name: true, email: true } } },
    }).then((p) => p?.customer ?? null)
    : null

  // verzija v1 — začetni posnetek (zgodovina verzij)
  const versionBits: string[] = []
  if (views) versionBits.push(`${views.length + 1} pogledov`)
  if (confidence !== null) versionBits.push(`zaupanje ${confidence} %`)
  if (multiView) versionBits.push(`razpršenost ${multiView.spreadPct.toString().replace('.', ',')} %${multiView.conflict ? ' ⚠ konflikt' : ''}`)
  if (manualOverride) versionBits.push('ročni popravek dolžine')
  if (mode) versionBits.push(`način ${mode}`)

  // R537 (transakcijska celovitost): meritev + verzija v1 + revizija + zapis
  // obvestila (outbox) v ENI transakciji — padec srednjega koraka NE pusti
  // meritve brez verzije/revizije/dogodka. R536 retryOnUnique teče na tx klientu
  // (za SVEŽ id je verzija vedno 1 → P2002 praktično nedosegljiv; fn znova
  // prebere zadnjo verzijo ZNOTRAJ poskusa, vzorec ostaja enak). Dostava
  // obvestila (stranka EMAIL + webhook HTTP) teče PO commitu (deliverEvent).
  // Prenos v paket (R509 handoff) ostaja IZVEN transakcije — nextPackageCode ima
  // lastno $transaction (product-core, izven lastništva te naloge).
  const { measurement, recorded } = await db.$transaction(async (tx) => {
    const measurement = await tx.measurement.create({
      data: {
        type,
        source: 'KAMERA',
        status: provenance.status,
        statusNote: provenance.reason,
        projectId,
        workOrderId,
        authorId: user.id,
        location: typeof body.location === 'string' && body.location.trim() ? body.location.trim() : photo.location,
        lengthCm,
        heightCm,
        posts,
        segments,
        handrail,
        slopeDeg,
        params,
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
      },
      include: {
        author: { select: { name: true } },
        project: { select: { id: true, code: true, title: true } },
        workOrder: { select: { id: true, code: true, title: true } },
      },
    })

    // R536: dirka verzij — P2002 → ponovni poskus (versioning.ts). Številka se
    // izračuna iz zadnje verzije ZNOTRAJ retried fn; za svežo meritev (nov id)
    // je to vedno 1, vzorec pa je enoten z ostalimi mesti ustvarjanja verzij.
    await retryOnUnique(async () => {
      const last = await tx.measurementVersion.findFirst({
        where: { measurementId: measurement.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      return tx.measurementVersion.create({
        data: {
          measurementId: measurement.id,
          version: (last?.version ?? 0) + 1,
          userId: user.id,
          data: JSON.stringify({
            type, lengthCm, heightCm, posts, segments, handrail, slopeDeg,
            location: measurement.location, note: measurement.note, params,
            status: provenance.status, statusNote: provenance.reason,
          }),
          note: versionBits.length > 0 ? `${versionBits.join(' · ')} — potrjeno s kamero` : 'Potrjeno s kamero (iz fotografije)',
        },
      })
    })

    await writeAudit({
      userId: user.id,
      action: 'MEASUREMENT_CONFIRM',
      entity: 'measurement',
      entityId: measurement.id,
      projectId,
      detail: {
        photoId, type, lengthCm, heightCm, slopeDeg, workOrderId: workOrderId ?? null, location: measurement.location,
        // R501 (issue #15 faza 2): provenienca v reviziji — pisarna vidi, KAKO je
        // bila številka pridobljena, ne samo da je bila »potrjena«.
        status: provenance.status, statusReason: provenance.reason,
        // R455: razširjeni podatki o potrditvi (issue #10)
        ...(confidence !== null ? { confidence } : {}),
        ...(views ? { views: views.length } : {}),
        // R487: strežniško izračunana konsolidacija v reviziji (konflikt VIDEN)
        ...(multiView ? { multiView } : {}),
        ...(quality ? { qualityFlags: Object.keys(quality) } : {}),
        ...(manualOverride ? { manualOverride } : {}),
        // R457: način izmere + prisotnost engine rezultata (issue #12)
        ...(mode ? { mode } : {}),
        ...(engine ? { engine: Object.keys(engine) } : {}),
      },
    }, tx)

    // R438 (issue #5): potrjena meritev → statusno obvestilo stranki —
    // R537: ZAPIS dogodka v isti tx (outbox), dostava PO commitu (ognjevarna).
    const recorded = projectId && customer?.email
      ? await recordEvent({
        type: 'MEASUREMENT_CONFIRMED',
        key: `measurement-confirmed:${measurement.id}`,
        title: 'Meritev potrjena',
        body: `Meritev potrjena — ${measurement.location ?? customer.name ?? 'teren'} (${type.toLowerCase()}, ${Math.round(lengthCm)} cm)`,
        projectId,
        customerEmail: customer.email,
        customerName: customer.name,
      }, tx)
      : null
    return { measurement, recorded }
  })

  // dostava obvestila PO uspešnem commitu (ognjevarna — nikoli ne vrže napake)
  if (recorded) await deliverEvent(recorded)
  // ── R509 (issue #7 §8): prenos potrjene meritve V PAKET ────────────────────
  // Ročna odločitev, NE tiha domišljija: paket ustvarimo samo, če izvajalec
  // zahteve izrecno podaja izdelek (`handoffProductId`) in ima pravico `quotes.create`
  // (isto dovoljenje kot `/api/project-packages`). Količino izpeljemo samo tam,
  // kjer je aritmetika nedvoumna (`odlociPaket`); cene, marže in kosovnice tu
  // NE nastajajo — ostanejo obstoječi poti `/api/project-packages/[id]/bom`, da
  // ta issue ne ustvari drugega cenovnega jedra. Idempotentno: meritev, ki že
  // ima paket, DOBI obstoječi kode, drugega paketa ne.
  const handoffProductId = typeof body.handoffProductId === 'string' && body.handoffProductId ? body.handoffProductId : null
  const handoffVariantId = typeof body.handoffVariantId === 'string' && body.handoffVariantId ? body.handoffVariantId : null
  let paket: Record<string, unknown> | null = null
  if (handoffProductId !== null) {
    const postojeci = await db.projectPackage.findFirst({
      where: { measurementId: measurement.id },
      select: { id: true, code: true },
    })
    const produkt = await db.product.findUnique({
      where: { id: handoffProductId },
      select: { id: true, name: true, unit: true, active: true, family: { select: { code: true, name: true } } },
    })
    const varianta = handoffVariantId
      ? await db.productVariant.findUnique({ where: { id: handoffVariantId }, select: { id: true, productId: true, name: true } })
      : null
    let odlok = odlociPaket({
      projectId,
      productId: produkt?.active === true ? produkt.id : null,
      unit: produkt?.unit ?? null,
      lengthCm,
      heightCm,
      postojeciPaketId: postojeci?.id ?? null,
    })
    if (produkt === null) odlok = { odlok: 'ZAVRNJENO', razlog: 'Izbrani izdelek ne obstaja — paketa nismo ustvarili.', qty: null, unit: null }
    else if (!produkt.active) odlok = { odlok: 'ZAVRNJENO', razlog: `Izdelek ${produkt.name} ni aktiven — paketa ne ustvarjamo za arhiviran izdelek.`, qty: null, unit: produkt.unit }
    else if (!perms.includes('quotes.create')) odlok = { odlok: 'ZAVRNJENO', razlog: 'Meritev je potrjena; paketov monterjev profil ne ustvarja — prenos stori pisarna.', qty: null, unit: produkt.unit }
    else if (handoffVariantId !== null && varianta?.productId !== produkt.id) odlok = { odlok: 'ZAVRNJENO', razlog: 'Izbrana varianta ne spada k izbranemu izdelku — paketa nismo ustvarili.', qty: null, unit: produkt.unit }

    if (odlok.odlok === 'OBSTAJA' && postojeci) {
      paket = { id: postojeci.id, code: postojeci.code, odlok: odlok.odlok, qty: null, unit: null, status: null, razlog: odlok.razlog }
    } else if (odlok.odlok === 'USTVORI' && produkt && odlok.qty !== null) {
      const code = await nextPackageCode(measurement.project?.code ?? 'P')
      const ustvarjen = await db.projectPackage.create({
        data: {
          code,
          projectId: projectId as string,
          productId: produkt.id,
          variantId: varianta?.id ?? null,
          measurementId: measurement.id,
          name: `${produkt.name} — izmera${measurement.location ? ` (${measurement.location})` : ''}`,
          qty: odlok.qty,
          unit: odlok.unit as string,
          status: 'IZMERA',
          // NOBENA cena/marža/načrt tu ne nastane (R488 isti pogoj): calcJson je
          // samo dokaz izvora in prenosa, ki ga pisarna nadaljuje s kosovnico.
          calcJson: JSON.stringify({
            prenos: {
              verzia: HANDOFF_VERSION,
              izvor: 'KAMERA',
              meritevId: measurement.id,
              dolzinaCm: lengthCm,
              visinaCm: heightCm,
              enota: odlok.unit,
              razlog: odlok.razlog,
            },
          }),
          note: `§8 prenos iz meritve s kamero (${produkt.family.code})`,
        },
        select: { id: true, code: true },
      })
      paket = { id: ustvarjen.id, code: ustvarjen.code, odlok: odlok.odlok, qty: odlok.qty, unit: odlok.unit, status: 'IZMERA', razlog: odlok.razlog }
      await writeAudit({
        userId: user.id,
        action: 'MEASUREMENT_HANDOFF',
        entity: 'projectPackage',
        entityId: ustvarjen.id,
        projectId,
        detail: { measurementId: measurement.id, code: ustvarjen.code, qty: odlok.qty, unit: odlok.unit, verzia: HANDOFF_VERSION },
      })
    } else {
      paket = { id: null, code: null, odlok: odlok.odlok, qty: null, unit: odlok.unit, status: null, razlog: odlok.razlog }
    }
  }

  return NextResponse.json({ data: measurement, ...(paket !== null ? { paket } : {}) }, { status: 201 })
}

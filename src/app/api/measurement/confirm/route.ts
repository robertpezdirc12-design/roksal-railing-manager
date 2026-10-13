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

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'
import {
  MEASURE_MODES, consolidateViews,
  pointsForStorage, viewForStorage, calibrationForParams, parseCalibration,
  pickEngineExtras, deriveProvenance, provenanceForParams, type MeasureMode,
} from '@/lib/measure-engine'
import { MEASURE_CONFLICT_PCT } from '@/lib/scene-understanding-core'

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
  const { user } = auth

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

  const measurement = await db.measurement.create({
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

  // verzija v1 — začetni posnetek (zgodovina verzij)
  const versionBits: string[] = []
  if (views) versionBits.push(`${views.length + 1} pogledov`)
  if (confidence !== null) versionBits.push(`zaupanje ${confidence} %`)
  if (multiView) versionBits.push(`razpršenost ${multiView.spreadPct.toString().replace('.', ',')} %${multiView.conflict ? ' ⚠ konflikt' : ''}`)
  if (manualOverride) versionBits.push('ročni popravek dolžine')
  if (mode) versionBits.push(`način ${mode}`)
  await db.measurementVersion.create({
    data: {
      measurementId: measurement.id,
      version: 1,
      userId: user.id,
      data: JSON.stringify({
        type, lengthCm, heightCm, posts, segments, handrail, slopeDeg,
        location: measurement.location, note: measurement.note, params,
        status: provenance.status, statusNote: provenance.reason,
      }),
      note: versionBits.length > 0 ? `${versionBits.join(' · ')} — potrjeno s kamero` : 'Potrjeno s kamero (iz fotografije)',
    },
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
  })

  // R438 (issue #5): potrjena meritev → statusno obvestilo stranki (EMAIL, maskiran naslov)
  if (projectId) {
    const customer = await db.project.findUnique({
      where: { id: projectId },
      select: { customer: { select: { name: true, email: true } } },
    }).then((p) => p?.customer ?? null)
    if (customer?.email) {
      await emitEvent({
        type: 'MEASUREMENT_CONFIRMED',
        key: `measurement-confirmed:${measurement.id}`,
        title: 'Meritev potrjena',
        body: `Meritev potrjena — ${measurement.location ?? customer.name ?? 'teren'} (${type.toLowerCase()}, ${Math.round(lengthCm)} cm)`,
        projectId,
        customerEmail: customer.email,
        customerName: customer.name,
      })
    }
  }
  return NextResponse.json({ data: measurement }, { status: 201 })
}

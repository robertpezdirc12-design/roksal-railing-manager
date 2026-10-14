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

// R501 (issue #15 Faza 1) — STREŽNIŠKI PRERAČUN JE AVTORITETA:
//   • točke BREZ veljavne kalibracije (UNIFORM ali perspektivna ravnina) → 400;
//   • lengthCm se PRERAČUNA iz točk + kalibracije (computeGeometry/
//     polygonMetrics — isto jedro kot analiza in UI): odstopanje > 2 % brez
//     manualOverride → 409 (odjemalec ne more poslati poljubne številke);
//   • params.measureStatus: MANUAL (ročni vnos brez reference) |
//     CALIBRATED (točke + veljavna referenca, usklajeno) | MANUAL_OVERRIDE
//     (ročno rešeno z razlogom — npr. laserska izmera) — razločno v izvozu.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { emitEvent } from '@/lib/notify'
import { MEASURE_MODES, MODE_RULES, computeGeometry, multiViewStats, polygonMetrics, resolveScale, type EngineCalib, type EnginePoint, type MeasureMode } from '@/lib/measure-engine'
import { MEASURE_CONFLICT_PCT } from '@/lib/scene-understanding-core'

const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'OSTANEO']

const MAX_VIEWS = 4

/** R501: prikaz števila z decimalno vejico (slovensko). */
const r1 = (n: number) => Math.round(n * 10) / 10

/** R501: strukturno razčleni kalibracijo (UNIFORM px/cm ALI perspektivna
 *  ravnina plane) — globoka validacija (kolinearnost/homografija) je v
 *  resolveScale. Vrne null, če ni nobene uporabne reference. */
function parseEngineCalib (v: unknown): EngineCalib | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { px?: unknown; cm?: unknown; imgW?: unknown; imgH?: unknown; plane?: unknown }
  const out: EngineCalib = { px: 0, cm: 0 }
  const px = Number(o.px); const cm = Number(o.cm)
  if (Number.isFinite(px) && px > 0) out.px = px
  if (Number.isFinite(cm) && cm > 0) out.cm = cm
  const imgW = Number(o.imgW); const imgH = Number(o.imgH)
  if (Number.isFinite(imgW) && imgW > 0) out.imgW = Math.round(imgW)
  if (Number.isFinite(imgH) && imgH > 0) out.imgH = Math.round(imgH)
  if (o.plane && typeof o.plane === 'object') {
    const p = o.plane as { points?: unknown; widthCm?: unknown; heightCm?: unknown }
    const w = Number(p.widthCm); const h = Number(p.heightCm)
    if (Array.isArray(p.points) && p.points.length === 4 && Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
      const pts: EnginePoint[] = []
      for (const q of p.points) {
        if (!q || typeof q !== 'object') continue
        const x = Number((q as { x?: unknown }).x); const y = Number((q as { y?: unknown }).y)
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y })
      }
      if (pts.length === 4) out.plane = { points: pts, widthCm: w, heightCm: h }
    }
  }
  return out.px > 0 && out.cm > 0 ? out : out.plane ? out : null
}

/** R501: točke telesa/pogleda v EnginePoint[] (brez predlogov — ti ne štejejo). */
function parseEnginePoints (v: unknown): EnginePoint[] | null {
  if (!Array.isArray(v)) return null
  const pts: EnginePoint[] = []
  for (const p of v.slice(0, 64)) {
    if (!p || typeof p !== 'object') continue
    const q = p as { x?: unknown; y?: unknown; src?: unknown }
    const x = Number(q.x)
    const y = Number(q.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    pts.push({ x, y, ...(q.src === 'ROCNO' || q.src === 'PREDLOG' ? { src: q.src } : {}) })
  }
  return pts.length >= 2 ? pts : null
}

/** R455: normalizira en pogled (točke + kalibracija) — enaka pravila kot glavni.
 *  R501: kalibracija pogleda ohrani tudi perspektivno ravnino (plane). */
function parseView (v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { photoId?: unknown; points?: unknown; calibration?: unknown }
  const out: Record<string, unknown> = {}
  if (typeof o.photoId === 'string' && o.photoId) out.photoId = o.photoId
  if (Array.isArray(o.points)) {
    const pts = o.points.slice(0, 64).filter((p) => {
      if (!p || typeof p !== 'object') return false
      const q = p as { x?: unknown; y?: unknown }
      return Number.isFinite(Number(q.x)) && Number.isFinite(Number(q.y))
    })
    if (pts.length > 0) out.points = pts
  }
  if (o.calibration && typeof o.calibration === 'object') {
    const cal = o.calibration as Record<string, unknown>
    const keep: Record<string, unknown> = {}
    const px = Number(cal.px); const cm = Number(cal.cm)
    if (Number.isFinite(px) && px > 0) keep.px = px
    if (Number.isFinite(cm) && cm > 0) keep.cm = cm
    const imgW = Number(cal.imgW); const imgH = Number(cal.imgH)
    if (Number.isFinite(imgW) && imgW > 0) keep.imgW = Math.round(imgW)
    if (Number.isFinite(imgH) && imgH > 0) keep.imgH = Math.round(imgH)
    // R501: perspektivna ravnina pogleda (4 vogali + dimenziji)
    if (cal.plane && typeof cal.plane === 'object') {
      const p = cal.plane as { points?: unknown; widthCm?: unknown; heightCm?: unknown }
      const w = Number(p.widthCm); const h = Number(p.heightCm)
      if (Array.isArray(p.points) && p.points.length === 4 && Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
        keep.plane = { points: p.points, widthCm: w, heightCm: h }
      }
    }
    if (Object.keys(keep).length > 0) out.calibration = keep
  }
  return Object.keys(out).length > 0 ? out : null
}

function num (v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** R487: dolžina enega pogleda iz točk + kalibracije — čisto tanek sloj nad
 *  obstoječim determinističnim computeGeometry (merilno jedro NE podvajamo,
 *  issue §2). Točke so normalizirane 0..1 z imgW/imgH (kot v kameri) ali že v
 *  pikslih (kompatibilno z railing-layout). Predlogi (PREDLOG) ne štejejo.
 *  R501: kalibracija je lahko tudi perspektivna ravnina (plane) — razreši jo
 *  resolveScale; neveljavno merilo → null (ta pogled se ne more šteti). */
function viewLengthCm (points: unknown, calibration: unknown): number | null {
  const pts = parseEnginePoints(points)
  if (!pts) return null
  const calib = parseEngineCalib(calibration)
  if (!calib) return null
  if (!resolveScale(calib).valid) return null
  const total = computeGeometry(pts, calib).totalLengthCm
  return total > 0 ? total : null
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
    const picked: Record<string, unknown> = {}
    if (e.domain && typeof e.domain === 'object') picked.domain = e.domain
    if (Array.isArray(e.validation)) picked.validation = e.validation.slice(0, 40)
    if (e.confidence && typeof e.confidence === 'object') picked.confidence = e.confidence
    if (e.captureGuide && typeof e.captureGuide === 'object') picked.captureGuide = e.captureGuide
    // R501 (issue #15 Faza 1): razrešeno merilo (vrsta + predpostavke) v reviziji
    if (e.scale && typeof e.scale === 'object') {
      const sc = e.scale as { valid?: unknown; mode?: unknown; cmPerPx?: unknown; assumedFrontal?: unknown; reason?: unknown }
      const pickedScale: Record<string, unknown> = {}
      if (typeof sc.valid === 'boolean') pickedScale.valid = sc.valid
      if (sc.mode === 'UNIFORM' || sc.mode === 'PLANE') pickedScale.mode = sc.mode
      if (typeof sc.cmPerPx === 'number' && Number.isFinite(sc.cmPerPx)) pickedScale.cmPerPx = sc.cmPerPx
      if (typeof sc.assumedFrontal === 'boolean') pickedScale.assumedFrontal = sc.assumedFrontal
      if (typeof sc.reason === 'string' && sc.reason.trim()) pickedScale.reason = sc.reason.slice(0, 160)
      if (Object.keys(pickedScale).length > 0) picked.scale = pickedScale
    }
    if (Object.keys(picked).length === 0) {
      return jsonError(400, 'engine je prazen.', 'Podajte vsaj enega od: domain, validation, confidence, captureGuide.')
    }
    const size = JSON.stringify(picked).length
    if (size > 8000) return jsonError(400, 'Rezultat engine-a je prevelik (max 8 KB).')
    engine = picked
  }

  // ── R487 (issue #3): strežniška konsolidacija več pogledov (ADITIVNO) ──
  // Dolžine vseh pogledov (primarni iz body.points+calibration, dodatni iz
  // views[].points+calibration) se preračunajo z obstoječim computeGeometry,
  // statistika (povprečje/razpršenost) pa z multiViewStats (lib) — NE iz
  // odjemalčeve izjave. SAMO kadar so dodatni pogledi prisotni in je mogoče
  // izračunati ≥ 2 dolžini (§4C »samo kadar podatki to omogočajo«).
  let multiView: { count: number; values: number[]; mean: number; spreadPct: number; conflict: boolean; manualOverride?: boolean } | null = null
  if (views) {
    const lengths: number[] = []
    const primary = viewLengthCm(body.points, body.calibration)
    if (primary !== null) lengths.push(primary)
    for (const v of views) {
      const l = viewLengthCm(v.points, v.calibration)
      if (l !== null) lengths.push(l)
    }
    const stats = multiViewStats(lengths)
    if (stats) {
      const conflict = stats.spreadPct > MEASURE_CONFLICT_PCT
      multiView = {
        count: stats.count,
        values: stats.values,
        mean: stats.mean,
        spreadPct: stats.spreadPct,
        conflict,
        ...(manualOverride ? { manualOverride: true } : {}),
      }
      // §4C »konflikte prikaži uporabniku; ne popravljaj geometrije tiho« +
      // KPI »0 potrjenih proizvodnih mer z nerešenim kritičnim konfliktom«:
      // nerešeno razhajanje > 15 % BREZ ročnega popravka z razlogom →
      // potrditev ZAVRNJENA. Ročni popravek z razlogom (r455) je veljavna
      // rešitev — vrata ostanejo odprta (zavestna odločitev uporabnika).
      if (conflict && !manualOverride) {
        return jsonError(409, 'Pogledi se preveč razlikujejo.',
          `Razpršenost ${multiView.spreadPct.toString().replace('.', ',')} % med ${multiView.count} pogledi presega ${MEASURE_CONFLICT_PCT} % — popravite točke ali kalibracijo na pogledih, ali podajte ročni popravek dolžine z razlogom (manualOverride).`)
      }
    }
  }

  // ── R501 (issue #15 Faza 1): STREŽNIŠKI PRERAČUN JE AVTORITETA ──────────
  // Poslana lengthCm se PRERAČUNA iz istega jedra kot analiza/UI. Brez
  // veljavne reference (UNIFORM ali perspektivna ravnina) točkna meritev NE
  // more biti potrjena (400). Odstopanje > 2 % brez manualOverride → 409
  // (odjemalec ne more poslati poljubne številke kot poslovno mero).
  // RAZLOG v monterjevem jeziku + meriloStatus v params (revizija/izvoz).
  const RECOMPUTE_TOL_PCT = 2
  let measureStatus: 'MANUAL' | 'CALIBRATED' | 'MANUAL_OVERRIDE' = 'MANUAL'
  if (manualOverride) {
    measureStatus = 'MANUAL_OVERRIDE' // veljavna rešitev Z razlogom (r455)
  } else {
    const bodyPts = parseEnginePoints(body.points)
    const bodyCal = parseEngineCalib(body.calibration)
    // točke BREZ veljavne reference → EKSPlicitna napaka (ne tiha MANUEL)
    if (bodyPts && !bodyCal) {
      return jsonError(400, 'Manjka veljavna referenčna kalibracija.',
        'Točke so označene, a kalibracija manjka ali je neveljavna — označite 2 točki znane razdalje ali 4 vogale znanega pravokotnika na merjeni ravnini. Brez reference točka meritev ne more biti potrjena poslovna mera.')
    }
    const candidates: number[] = []
    if (bodyPts && bodyCal) {
      const scale = resolveScale(bodyCal)
      if (scale.valid) {
        const geo = computeGeometry(bodyPts, bodyCal)
        if (geo.calibrated && geo.totalLengthCm > 0) {
          candidates.push(geo.totalLengthCm)
          // poligonski načini: »skupna dolžina« = obseg zaprtega poligona je
          // enakovredna semantika (r457 KERAMIKA pošilja obseg) — sprejmemo oba
          if (mode && (MODE_RULES[mode as MeasureMode]?.polygon)) {
            const poly = polygonMetrics(bodyPts, bodyCal)
            if (poly.perimeterCm > 0) candidates.push(poly.perimeterCm)
          }
        }
      }
    }
    if (multiView && multiView.mean > 0 && !multiView.conflict) candidates.push(multiView.mean)
    if (candidates.length > 0) {
      const okMatch = candidates.some((c) => Math.abs(c - (lengthCm as number)) / c * 100 <= RECOMPUTE_TOL_PCT)
      if (!okMatch) {
        const prikaz = (n: number) => r1(n).toString().replace('.', ',')
        return jsonError(409, 'Poslana dolžina se ne ujema s preračunom.',
          `Strežnik iz točk in kalibracije izračuna ${candidates.length === 1 ? prikaz(candidates[0]) : candidates.map(prikaz).join(' / ')} cm, poslano pa je ${prikaz(lengthCm as number)} cm (toleranca ${RECOMPUTE_TOL_PCT} %). Popravite točke/kalibracijo ali vnesite ročni popravek dolžine z razlogom (manualOverride).`)
      }
      measureStatus = 'CALIBRATED'
    }
    // brez točk + brez views → legacy ročni vnos: measureStatus ostane MANUAL
    // (izrecno zabeležen v params — ni tiho »potrjena kalibrirana« mera)
  }

  // points + calibration shranimo v params (zapis postopka za revizijo/ponovno izdelavo)
  // points: normalizirane koordinate 0..1; calibration dodatno nosi imgW/imgH za
  // pretvorbo v piksle pri ponovnem izračunu (GET /api/railing-layout?measurementId)
  let params: string | null = null
  try {
    const extra: Record<string, unknown> = { photoId, source: 'KAMERA' }
    if (Array.isArray(body.points)) extra.points = body.points.slice(0, 64)
    if (body.calibration && typeof body.calibration === 'object') {
      const c = body.calibration as { px?: unknown; cm?: unknown; imgW?: unknown; imgH?: unknown; method?: unknown; refObject?: unknown; plane?: unknown }
      const cal: Record<string, unknown> = {}
      if (Number.isFinite(Number(c.px)) && Number(c.px) > 0) cal.px = Number(c.px)
      if (Number.isFinite(Number(c.cm)) && Number(c.cm) > 0) cal.cm = Number(c.cm)
      if (Number.isFinite(Number(c.imgW)) && Number(c.imgW) > 0) cal.imgW = Math.round(Number(c.imgW))
      if (Number.isFinite(Number(c.imgH)) && Number(c.imgH) > 0) cal.imgH = Math.round(Number(c.imgH))
      // R457 (§4): metoda kalibracije + referenčni objekt (sledljivost reference)
      if (typeof c.method === 'string' && ['MARKER', 'ZNANA_MERA', 'ZUNANJA_NAPRAVA', 'LIDAR', 'ROCNO', 'RAVNINA'].includes(c.method)) cal.method = c.method
      if (typeof c.refObject === 'string' && c.refObject.trim()) cal.refObject = c.refObject.trim().slice(0, 80)
      // R501 (issue #15 Faza 1): perspektivna ravnina — 4 vogali + dimenziji
      // (revizija/ponovna izdelava iz params potrebuje CELO referenco)
      const pl = parseEngineCalib(body.calibration)?.plane
      if (pl) cal.plane = { points: pl.points, widthCm: pl.widthCm, heightCm: pl.heightCm }
      if (Object.keys(cal).length > 0) extra.calibration = cal
    }
    // R455: več pogledov, kakovost, zaupanje, ročni popravek — vse v params (revizija)
    if (views) extra.views = views
    // R487: strežniško izračunana konsolidacija pogledov (revizija/izvoz)
    if (multiView) extra.multiView = multiView
    // R501 (issue #15 Faza 2): status mere — vedno zabeležen, nikoli tih
    extra.measureStatus = measureStatus
    if (quality) extra.quality = quality
    if (confidence !== null) extra.confidence = confidence
    if (manualOverride) extra.manualOverride = manualOverride
    // R457: način izmere + rezultat engine-a (§7 — ena meritev, en vir resnice)
    if (mode) extra.mode = mode
    if (engine) extra.engine = engine
    params = JSON.stringify(extra)
  } catch { params = JSON.stringify({ photoId, source: 'KAMERA' }) }

  const measurement = await db.measurement.create({
    data: {
      type,
      source: 'KAMERA',
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
  versionBits.push(`status mere ${measureStatus}`)
  await db.measurementVersion.create({
    data: {
      measurementId: measurement.id,
      version: 1,
      userId: user.id,
      data: JSON.stringify({
        type, lengthCm, heightCm, posts, segments, handrail, slopeDeg,
        location: measurement.location, note: measurement.note, params,
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
      // R501 (issue #15 Faza 2): status mere v reviziji (MANUAL/CALIBRATED/MANUAL_OVERRIDE)
      measureStatus,
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

'use client'

// AR — dopolnjena resničnost: predogled ograje čez kamero (vrata projects.read v nav)
// getUserMedia environment → <video>; če kamere ni → POŠTEN demo ozadje (gradient).
// SVG ograja kot vlečni overlay (pointer events, slider za velikost/prosojnost).
// R454 (issue #7 §16 P3 — NAPREDNI AR):
//   • AI ANALIZA PRIZORA — POST /api/ar/analyze (VLM, backend): opis prizora,
//     predlogi položaja ograje, ovire in reference za oceno mer. Brez overlayja
//     (čist prizor) — rezultat je pomoč, ne vir resnice.
//   • ZAJEM: poleg obstoječe meritive FOTO (POST /api/measurements) se posnetek
//     shrani TUDI kot AR posnetek (POST /api/ar-snapshots) s fotografijo,
//     nastavitvami in morebitno analizo.
//   • ZGODOVINA AR POSNETKOV — GET /api/ar-snapshots (metapodatki), ogled
//     podrobnosti s fotografijo (GET /api/ar-snapshots/[id]) in brisanje
//     (DELETE, measurements.write).
// R465 (issue #4 §1 — FIELD AR):
//   • VIR GEOMETRIJE: „ročno“ (stebri/višina) ALI „iz tekača projekta“ —
//     overlay se nariše IZ segmentov tekača (dolžine, višine, stebri, vrata,
//     vogali) → več segmentov v živo, po realni geometriji (R460 engine).
//   • STABILIZACIJA: povlek z nizkofrekvenčnim glajenjem (rAF low-pass) +
//     ZAKLEP položaja (prepreči nerodni pomik ob zajemu).
//   • IZVOZ ZAJEMA: prenos PNG (zadnji zajem + zgodovina) — data URL → a[download].
// R471 (issue #8 Faza 4 — SENZORJI + INTEGRACIJA):
//   • ZAZNAVA PODPORE AR GLOBINE (detectDepthSupport — WebXR/ARCore). Gumb
//     „Izmeri z globino“ se prikaže SAMO, ko naprava dejansko podpira immersive-ar
//     (issue §0: brez lažnega obljubljanja); sicer kartica pove razlog in ponudi
//     obstoječi poti (referenca / ročni vnos).
//   • MERA Z GLOBINO: AR seja z depth-sensing (dva tapa) → razdalja v cm →
//     sceneEdit z manifestom senzorja → metoda DEPTH_AR (izpelje applyEdits).
//     Ob napaki/izstopu iz seje monter ostane na obstoječem toku (brez izgube).
//   • GUVERNER PERCEPCIJE (R471 core): zanka se ob preobremenitvi sama
//     umiri (daljši interval, ožja slika) — toplotna stabilnost na telefonu.
// Monter (measurements.write) vidi vse; skladiščnik/proizvodnja samo zgodovino.
//
// R537-b (strukturno razbitje, BREZ sprememb obnašanja): ta datoteka ostaja
// VSTOP modula (default export; dinamični uvoz import('@/components/roksal/modules/ar')
// v module-view.tsx se NE spreminja). Logika je dobesedno seljena v ./ar/*:
//   tipi.ts (tipi + konstante) · zajem.ts (zajem kadra na canvas + PNG)
//   stabilizacija.ts (vlečenje low-pass + zaklep) · globina.ts (WebXR mera
//   z globino) · ograja-overlay.tsx (SVG ograji) · zaznave.tsx (vrstica
//   elementa + obrazec ročne oznake) · nastavitve.tsx (kartica Nastavitve)
//   predogled.tsx (predogled + pogledi + navodila) · scena-detail.tsx
//   (kartica izbranega elementa) · analiza-panel.tsx (VLM analiza)
//   zgodovina.tsx (zgodovina posnetkov + stanje podrobnosti).
// Vse skupno stanje ostaja TUKAJ; deli prejmejo vhode prek propsov/argumentov.

import { useCallback, useEffect, useRef, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/roksal/ui-bits'
import { useSceneUnderstanding } from '@/hooks/use-scene-understanding'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiPost, useApi } from '@/lib/api-client'
import { hasPerm } from '@/lib/permissions-core'
import {
  applyEdits, axisCmFromReference, consolidateMeasures, newSceneId, proposeAxes,
  type SceneEdit, type SceneElement,
} from '@/lib/scene-understanding-core'
import { useAppStore } from '@/lib/store'

import { AnalizaPanel } from './ar/analiza-panel'
import { PreckaPanel } from './ar/precka-panel'
import { PrepoznavaPanel } from './ar/prepoznava-panel'
import { useArGlobina } from './ar/globina'
import { Nastavitve } from './ar/nastavitve'
import { PredogledGlava, PredogledNavodila, PredogledPogledi, PredogledViewport } from './ar/predogled'
import { ScenaDetail } from './ar/scena-detail'
import { useArStabilizacija } from './ar/stabilizacija'
import { Zgodovina } from './ar/zgodovina'
import { zajemKadra } from './ar/zajem'
import type { ArAnalysis, ManualTagValues, Mode, ProjectRow, RunOption, RunSegmentRow, SceneView, SnapshotRow } from './ar/tipi'

export default function ArModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const canWrite = hasPerm(user?.perms, 'measurements.write')

  const viewportRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [mode, setMode] = useState<Mode>('off')

  // ── R467 (issue #8 F1): živo razumevanje prizora ──
  // R468 (F2 §3): nagib telefona (DeviceOrientation gamma) za ločitev od
  // naklona tal — ref, da se percepcijska zanka NE restarta ob vsakem dogodku.
  const phoneRollRef = useRef<number | null>(null)
  useEffect(() => {
    if (mode !== 'on') return
    phoneRollRef.current = null
    const h = (e: DeviceOrientationEvent): void => {
      const g = e.gamma
      phoneRollRef.current = typeof g === 'number' && Number.isFinite(g) ? g : null
    }
    window.addEventListener('deviceorientation', h)
    return () => {
      window.removeEventListener('deviceorientation', h)
      phoneRollRef.current = null
    }
  }, [mode])

  const sceneState = useSceneUnderstanding(videoRef, mode === 'on', {
    getPhoneRollDeg: () => phoneRollRef.current,
  })
  const [sceneSelectedId, setSceneSelectedId] = useState<string | null>(null)
  const [sceneEdits, setSceneEdits] = useState<SceneEdit[]>([])
  /** R468 (F2 §9): pripnjeni (zaklenjeni) elementi — vedno prikazani. */
  const [scenePinned, setScenePinned] = useState<Set<string>>(new Set())
  /** R468 (F2 §3): vnos ročno izmerjenega naklona v kartici elementa. */
  const [slopeInput, setSlopeInput] = useState('')
  /** R469 (F3 §4): vnos ročno potrjenega števila stopnic. */
  const [stepsInput, setStepsInput] = useState('')
  /** R485 (issue #8 §2): vnos ročno potrjenega kota ROBA (−90..360, normalizira se mod 180). */
  const [angleInput, setAngleInput] = useState('')
  /** R485 (issue #8 §9): izbrani pogled AR predogleda (ŽIVO privzeto). */
  const [sceneView, setSceneView] = useState<SceneView>('ZIVO')
  /** R485 (issue #8 §1): ročno dodane oznake v ŽIVI seji (vir ROCNO) —
   *  persistirajo se z zajemom (elementsToSave), ob izklopu kamere umrejo
   *  (enako kot žive zaznave). NE morejo biti OSEBA (beli seznam). */
  const [manualElements, setManualElements] = useState<SceneElement[]>([])
  const [manualOpen, setManualOpen] = useState(false)
  const [manualBBox, setManualBBox] = useState<[number, number, number, number] | null>(null)
  /** R470 (§5): vnosi mer po osi (index osi → vrednost v cm) + referenčna skala. */
  const [measureInputs, setMeasureInputs] = useState<Record<number, string>>({})
  const [refAxisIdx, setRefAxisIdx] = useState('')
  const [refCmInput, setRefCmInput] = useState('')
  /** R470 (§5): razmerje stranic žive slike — za izračun dolžin osi v px. */
  const [videoAspect, setVideoAspect] = useState(4 / 3)

  // R471 (F4): mera z AR globino (WebXR immersive-ar) — stanje in seja
  // živita v ./ar/globina.ts (R537-b); rezultat se zapiše kot sceneEdit.
  // R558: + runDepthPolygonMeasure (celotna linija v eni seji).
  const { depthSupport, depthTaps, depthBusy, runDepthMeasure, runDepthPolygonMeasure } = useArGlobina({
    mode, stopCamera, startCamera, sceneSelectedId, setSceneEdits, user,
  })

  /** elementi z apliciranimi popravki (za prikaz/detalj) — R485: žive zaznave
   *  + ročno dodane oznake (ISTI tok: ista applyEdits, isti zajem) */
  const sceneDisplayed = sceneState.elements.length > 0 || manualElements.length > 0
    ? applyEdits({ version: 1, at: Date.now(), elements: [...sceneState.elements, ...manualElements], edits: sceneEdits })
    : []
  // R485: v pogledu MERE overlay pokaže SAMO elemente z merami (+ izbrani za
  // osi) — ostale izpusti iz PRIKAZA (podatki ostanejo; to je samo pogled).
  const sceneOverlayElements = sceneView === 'MERE'
    ? sceneDisplayed.filter((e) => (e.measures?.length ?? 0) > 0 || e.id === sceneSelectedId)
    : sceneDisplayed
  const sceneSelected = sceneDisplayed.find((e) => e.id === sceneSelectedId) ?? null
  // R470 (§5): osi izbranega elementa (persistirane imajo prednost pred predlogom)
  const selectedAxes = sceneSelected
    ? (sceneSelected.axes && sceneSelected.axes.length >= 1 ? sceneSelected.axes : proposeAxes(sceneSelected))
    : []
  // R470 (§5): konsolidirane mere izbranega elementa (po nazivu, s konflikti)
  const selectedMeasures = sceneSelected ? consolidateMeasures(sceneSelected.measures ?? []) : []
  // R470 (§5): skala iz referenčne osi — cm na enoto višine kadra (KALIBRIRANA_FOTOGRAFIJA)
  const refIdx = refAxisIdx === '' ? -1 : Number(refAxisIdx)
  const refCm = Number(refCmInput.replace(',', '.'))
  const refAxis = refIdx >= 0 && refIdx < selectedAxes.length && Number.isFinite(refCm) && refCm > 0
    ? selectedAxes[refIdx]
    : null
  const computedForAxis = (i: number): number | null =>
    refAxis != null && selectedAxes[i] ? axisCmFromReference(refAxis, refCm, selectedAxes[i], videoAspect) : null

  const [starting, setStarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scale, setScale] = useState(1)
  const [opacity, setOpacity] = useState(0.95)
  const [postsS, setPostsS] = useState('5')
  const [heightS, setHeightS] = useState('110')
  const [projectId, setProjectId] = useState('none')
  const [note, setNote] = useState('')
  const [lastShot, setLastShot] = useState<string | null>(null)

  // R465: vir geometrije (ročno | tekač) + stabilizacija (zaklep + glajenje)
  const [vir, setVir] = useState<'rocno' | 'tekac'>('rocno')
  const [runId, setRunId] = useState('none')
  const [runSegs, setRunSegs] = useState<RunSegmentRow[] | null>(null)
  const [runLoading, setRunLoading] = useState(false)
  const [locked, setLocked] = useState(false)

  // R465: vlečenje overlayja — glajenje low-pass + zaklep živita v
  // ./ar/stabilizacija.ts (R537-b); položaj (pos) se tukaj uporablja za
  // predogled in zajem.
  const { pos, onPointerDown, onPointerMove, onPointerUp } = useArStabilizacija({ locked })

  // R454: AI analiza prizora
  const [analysis, setAnalysis] = useState<ArAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  // R454: zgodovina AR posnetkov (projects.read — tudi za skladišče/proizvodnjo)
  const snapshots = useApi<{ data: SnapshotRow[] }>('/api/ar-snapshots', [])

  const projects = useApi<{ data: ProjectRow[] }>('/api/projects', [])

  // R465: tekači projekta (samo ko je vir „iz tekača“ + projekt izbran)
  const runs = useApi<{ data: RunOption[] }>(
    vir === 'tekac' && projectId !== 'none' ? `/api/fence-run?projectId=${projectId}` : null,
    [vir, projectId],
  )

  // R465: segmenti izbranega tekača (geometrija overlayja)
  useEffect(() => {
    if (vir !== 'tekac' || runId === 'none') { setRunSegs(null); return }
    let alive = true
    setRunLoading(true)
    apiGet<{ data: { segments: RunSegmentRow[] } }>(`/api/fence-run/${runId}`)
      .then((res) => { if (alive) setRunSegs(Array.isArray(res.data?.segments) ? res.data.segments : []) })
      .catch(() => { if (alive) setRunSegs(null) })
      .finally(() => { if (alive) setRunLoading(false) })
    return () => { alive = false }
  }, [vir, runId])

  const posts = Math.min(20, Math.max(2, Math.round(Number(postsS) || 5)))
  const heightCm = Math.min(250, Math.max(40, Math.round(Number(heightS) || 110)))

  // R485: ročne oznake živijo v seji kamere — ob izklopu se počistijo
  // (persistirajo se SAMO z zajemom; enako pravilo kot žive zaznave).
  useEffect(() => {
    if (mode !== 'on') setManualElements([])
  }, [mode])

  /** R485 (§9): izbira elementa — SKUPNA pot za overlay oznake in PREGLED
   *  seznam (tap na vrstico odpre obstoječi tap-detail). */
  function selectSceneElement (el: SceneElement): void {
    setSceneSelectedId(el.id === sceneSelectedId ? null : el.id)
    setSlopeInput(''); setStepsInput(''); setAngleInput('')
    setMeasureInputs({}); setRefAxisIdx(''); setRefCmInput('')
  }

  /** R485: bbox predogleda ročne oznake (stabilen callback — brez render zank). */
  const handleManualBBox = useCallback((b: [number, number, number, number] | null): void => {
    setManualBBox(b)
  }, [])

  /** R485 (issue #8 §1): ROČNA OZNAKA v živi seji — lokalni element (vir ROCNO,
   *  confidence 1 — izjava monterja). Zaznavanje samo NE producira NEZNANO
   *  (poštenost); ta pot omogoči monterju označiti, kaj kamera ni prepoznala.
   *  Razred popravi v kartici; persistira se z zajemom (elementsToSave). */
  function addManualElementLive (v: ManualTagValues): void {
    const el: SceneElement = {
      id: newSceneId(),
      cls: v.cls,
      status: 'PREPOZNANO',
      source: 'ROCNO',
      confidence: 1,
      bbox: v.bbox,
      at: Date.now(),
      ...(v.label ? { label: v.label } : {}),
    }
    setManualElements((prev) => [...prev, el])
    setManualOpen(false)
    setManualBBox(null)
    selectSceneElement(el)
    toast({
      title: 'Oznaka dodana.',
      description: `${v.cls} na (${v.bbox.map((n) => n.toFixed(2).replace('.', ',')).join(' · ')}) — vir: ročno. Razred popravite v kartici; shrani se z zajemom AR posnetka.`,
    })
  }

  // POČIŠČENJE: ob odklopu ustavi vse steze kamere (rAF glajenja počisti
  // ./ar/stabilizacija.ts, AR sejo globine pa ./ar/globina.ts — R537-b)
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  function stopCamera (): void {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setMode('off')
  }

  async function startCamera (): Promise<void> {
    setStarting(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('MediaDevices API ni na voljo.')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setMode('on')
      toast({ title: 'Kamera vklopljena.', description: 'Ograjo premikajte z vlečenjem, velikost in prosojnost nastavite z drsnikoma.' })
    } catch {
      setMode('demo')
      toast({
        title: 'Kamera ni na voljo — predogled na demo ozadju.',
        description: 'Zajem deluje enako, brez žive slike (brskalnik je zavrnil dostop ali kontekst ni varen).',
      })
    } finally {
      setStarting(false)
    }
  }

  // ── R454: AI analiza prizora (VLM, backend) ──
  async function analyze (): Promise<void> {
    if (mode === 'off') return
    setAnalyzing(true)
    try {
      // R537-b: captureFrame(false) → zajemKadra(...) iz ./ar/zajem.ts
      const photo = await zajemKadra(viewportRef.current, videoRef.current, svgRef.current, mode, pos, scale, opacity, false)
      const res = await apiPost<{ data: ArAnalysis }>('/api/ar/analyze', {
        photo,
        hint: note.trim() || undefined,
      })
      setAnalysis(res.data)
      toast({
        title: 'Analiza prizora je pripravljena.',
        description: res.data.scene ? res.data.scene.slice(0, 120) : `${res.data.placement.length} predlogov položaja.`,
      })
    } catch (e) {
      toast({ title: 'Analiza ni uspela.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setAnalyzing(false)
    }
  }

  // ── zajem posnetka: meritev FOTO (obstoječe) + AR posnetek (R454) ──
  async function capture (): Promise<void> {
    setBusy(true)
    try {
      // R537-b: captureFrame(true) → zajemKadra(...) iz ./ar/zajem.ts
      const photo = await zajemKadra(viewportRef.current, videoRef.current, svgRef.current, mode, pos, scale, opacity, true)
      const sourceInfo = vir === 'tekac' && runSegs
        ? { source: { vir: 'tekac', runId, segments: runSegs.length, totalCm: Math.round(runSegs.reduce((a, s) => a + s.lengthCm, 0)) } }
        : {}
      const runLabel = vir === 'tekac' && runSegs
        ? ` — tekač: ${runSegs.length} segmentov, ${(runSegs.reduce((a, s) => a + s.lengthCm, 0) / 100).toFixed(1).replace('.', ',')} m`
        : ''
      await apiPost('/api/measurements', {
        type: 'FOTO',
        projectId: projectId !== 'none' ? projectId : null,
        location: 'AR predogled',
        params: { photo, ar: true },
        note: note.trim() || `AR predogled — ${vir === 'tekac' && runSegs ? `${runSegs.length} seg. tekača` : `${posts} stebrov, ${heightCm} cm`}`,
      })

      // R454: vztrajnost AR posnetka (fotografija + nastavitve + morebitna analiza)
      // R467: + razumevanje prizora (živi elementi + monterjevi popravki)
      // R470 (§5): elementi se ob shranjevanju obogatijo s predlogom dimenzijskih
      // osi (proposeAxes) — OSEBA se pri tem PRESKOČI (zasebnost §5: ne
      // persistiramo odsevkov o ljudeh; strip nato izvede sanitize na strežniku).
      let snapSaved = false
      try {
        const elementsToSave = sceneDisplayed
          .filter((e) => e.cls !== 'OSEBA')
          .map((e) => (e.axes && e.axes.length >= 1 ? e : { ...e, axes: proposeAxes(e) }))
        await apiPost('/api/ar-snapshots', {
          projectId: projectId !== 'none' ? projectId : null,
          scene: analysis?.scene ?? null,
          analysis: analysis ?? null,
          params: { photo, posts, heightCm, scale, opacity, mode, ...sourceInfo },
          note: (note.trim() || null) as string | null,
          ...(elementsToSave.length > 0
            ? { sceneUnderstanding: { version: 1, at: Date.now(), elements: elementsToSave, edits: sceneEdits } }
            : {}),
        })
        snapSaved = true
      } catch {
        // meritev FOTO je že shranjena — napaka posnetka ne sme pokvariti toka
      }
      void snapshots.reload()
      // popravljeni elementi so sedaj shranjeni v posnetku — lokalni popravki se počistijo
      setSceneEdits([])
      setSceneSelectedId(null)
      setScenePinned(new Set())
      setSlopeInput('')
      setAngleInput('')

      setLastShot(photo)
      toast({
        title: 'AR posnetek shranjen.',
        description: `Meritev FOTO${runLabel}${projectId !== 'none' ? ' · povezano s projektom' : ''}${snapSaved ? ' · shranjeno v zgodovino AR' : ''}`,
      })
    } catch (e) {
      toast({ title: 'Zajem ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="AR predogled"
        desc="Dopolnjena resničnost — ograjo položite čez kamero, prizor analizirajte z AI in zajemite posnetek"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* kontrole */}
        <Nastavitve
          vir={vir} setVir={setVir} runId={runId} setRunId={setRunId}
          postsS={postsS} setPostsS={setPostsS} heightS={heightS} setHeightS={setHeightS}
          runs={runs} runLoading={runLoading} runSegs={runSegs}
          projectId={projectId} setProjectId={setProjectId} projects={projects}
          scale={scale} setScale={setScale} opacity={opacity} setOpacity={setOpacity}
          locked={locked} setLocked={setLocked} canWrite={canWrite}
          note={note} setNote={setNote} mode={mode}
          analyzing={analyzing} analyze={analyze} busy={busy} capture={capture} lastShot={lastShot}
        />
        {/* predogled + analiza */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <PredogledGlava mode={mode} locked={locked} vir={vir} runSegs={runSegs} stopCamera={stopCamera} />
              <PredogledViewport
                viewportRef={viewportRef} videoRef={videoRef} svgRef={svgRef} setVideoAspect={setVideoAspect}
                mode={mode} sceneState={sceneState} sceneOverlayElements={sceneOverlayElements}
                sceneSelectedId={sceneSelectedId} scenePinned={scenePinned} sceneView={sceneView}
                selectSceneElement={selectSceneElement} manualOpen={manualOpen} manualBBox={manualBBox}
                starting={starting} startCamera={startCamera} setMode={setMode}
                locked={locked} pos={pos} scale={scale} opacity={opacity}
                vir={vir} runSegs={runSegs} runLoading={runLoading} posts={posts} heightCm={heightCm}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              />
              {/* R485 (issue #8 §9): PREKLOP POGLEDOV — ŽIVO | PREPOZNANO | MERE |
                  PREGLED. Pod predogledom (NE čez kamero); ŽIVO privzeto = sedanje
                  obnašanje. To je SAMO pogled na obstoječe elemente — brez novih
                  nastavitev (§9 „ne sili monterja v množico nastavitev“). */}
              {mode === 'on' ? (
                <PredogledPogledi
                  sceneView={sceneView} setSceneView={setSceneView} canWrite={canWrite}
                  manualOpen={manualOpen} setManualOpen={setManualOpen} setManualBBox={setManualBBox}
                  sceneDisplayed={sceneDisplayed} sceneSelectedId={sceneSelectedId}
                  selectSceneElement={selectSceneElement} addManualElementLive={addManualElementLive}
                  handleManualBBox={handleManualBBox}
                />
              ) : null}
              <p className="text-xs text-muted-foreground">
                {mode === 'demo'
                  ? 'Kamera ni na voljo — predogled na demo ozadju. Zajem shrani enak sestavek (demo ozadje + ograja).'
                  : 'Ograjo premikajte z vlečenjem po predogledu; velikost in prosojnost nastavite z drsnikoma levo.'}
              </p>
              {/* R483 (issue #8 F5 §11-3): KRATKA NAVODILA OB NEZADOSTNIH PODATKIH —
                  zložljiva ploščica POD AR predogledom (NE čez kamero; naslov
                  vedno viden, vsebina privzeto zložena; enoročni tap).
                  NAMENOMA samo ta ena ploščica — vodena navodila širom programa
                  so issue #11 SMART GUIDE (ne gradimo splošnega sistema pomoči). */}
              <PredogledNavodila />
              {/* R467 (issue #8 F1 §2): popravek zaznanega elementa — OZNAČEN PODATEK,
                  izvirni zajem ostaja; shrani se z naslednjim AR posnetkom.
                  R468 (F2 §3/§9): prikaz GEOMETRIJE (maska/naklon/vir/status),
                  ročna izmera naklona in pripinjanje oznake. */}
              {mode === 'on' && sceneSelected ? (
                <ScenaDetail
                  sceneSelected={sceneSelected} scenePinned={scenePinned} setScenePinned={setScenePinned}
                  slopeInput={slopeInput} setSlopeInput={setSlopeInput}
                  stepsInput={stepsInput} setStepsInput={setStepsInput}
                  angleInput={angleInput} setAngleInput={setAngleInput}
                  measureInputs={measureInputs} setMeasureInputs={setMeasureInputs}
                  refAxisIdx={refAxisIdx} setRefAxisIdx={setRefAxisIdx}
                  refCmInput={refCmInput} setRefCmInput={setRefCmInput}
                  selectedAxes={selectedAxes} selectedMeasures={selectedMeasures} refAxis={refAxis}
                  computedForAxis={computedForAxis} setSceneEdits={setSceneEdits}
                  setSceneSelectedId={setSceneSelectedId} user={user}
                  depthSupport={depthSupport} depthTaps={depthTaps} depthBusy={depthBusy} runDepthMeasure={runDepthMeasure} runDepthPolygonMeasure={runDepthPolygonMeasure}
                />
              ) : null}
            </CardContent>
          </Card>

          {/* R454: rezultat AI analize prizora */}
          {analysis ? (
            <AnalizaPanel analysis={analysis} setAnalysis={setAnalysis} />
          ) : null}

          {/* R558 (raziskava V1.4): VLM prečka z več fotografijami (HOVER-style) */}
          <PreckaPanel />

          {/* R559: VLM prepoznavanje obstoječe ograje (materiali, okovje, stanje) —
              zajem kadra na voljo SAMO ob živem predogledu (brez lažnega gumba) */}
          <PrepoznavaPanel
            zajemiKader={mode === 'on'
              ? () => zajemKadra(viewportRef.current, videoRef.current, svgRef.current, mode, pos, scale, opacity, false)
              : undefined}
          />
        </div>
      </div>

      {/* R454: zgodovina AR posnetkov */}
      <Zgodovina canWrite={canWrite} snapshots={snapshots} />
    </div>
  )
}

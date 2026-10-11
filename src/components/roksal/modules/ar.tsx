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

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import {
  Camera, CameraOff, ChevronDown, ChevronRight, Download, History, ImageIcon, Lightbulb, Loader2, Lock, LockOpen, MapPin, Move, Plus, Ruler, ScanLine,
  Save, Sparkles, Trash2, Video, Waypoints, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiGet, apiPost, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import SceneOverlay, { geomStatusText, slopeSourceText, SCENE_CLS_COLOR, SCENE_CLS_ICON, SCENE_CLS_LABEL, SCENE_STATUS_TEXT } from '@/components/roksal/scene-overlay'
import { useSceneUnderstanding } from '@/hooks/use-scene-understanding'
import {
  AXIS_KIND_TEXT, MEASURE_METHOD_TEXT, SCENE_CLASSES, SCENE_LIMITS, SURFACE_KINDS, applyEdits, ascentText,
  axisCmFromReference, consolidateMeasures, newSceneId, personHeightNote, proposeAxes,
  type SceneClass, type SceneEdit, type SceneElement, type SurfaceKind,
} from '@/lib/scene-understanding-core'
import { detectDepthSupport, startDepthMeasurement, type DepthSupportInfo } from '@/lib/depth-adapter'
import { hasPerm } from '@/lib/permissions-core'

const ANTHRACITE = '#2b2f36'
const OVERLAY_W = 320
const OVERLAY_H = 220
const DEMO_GRAD = 'linear-gradient(160deg, #e7e5e4 0%, #a8a29e 55%, #78716c 100%)'

type Mode = 'off' | 'on' | 'demo'

/** R485 (issue #8 §9): pogled AR predogleda — SAMO pogled na obstoječe
 * elemente (filter/prikaz, NE nov podatkovni model). ŽIVO je privzet in
 * enak sedanjemu obnašanju; PREGLED doda tapljivi seznam vseh elementov. */
type SceneView = 'ZIVO' | 'PREPOZNANO' | 'MERE' | 'PREGLED'

const SCENE_VIEWS: { id: SceneView; text: string; hint: string }[] = [
  { id: 'ZIVO', text: 'Živo', hint: 'Oznake, mere in osi čez sliko (sedanji prikaz).' },
  { id: 'PREPOZNANO', text: 'Prepoznano', hint: 'Samo razredi, statusi in zaupanje — mere skrite.' },
  { id: 'MERE', text: 'Mere', hint: 'Samo osi in zabeležene mere z metodo — razredi manj vidni.' },
  { id: 'PREGLED', text: 'Pregled', hint: 'Tapljivi seznam vseh zaznanih elementov (issue §9:137).' },
]

/** R485 (issue #8 §1, zasebnost §5): razredi za ROČNO dodajanje oznake —
 * beli seznam BREZ OSEBA (enak seznam kot na strežniku: POST scene-element). */
const MANUAL_CLASSES: SceneClass[] = SCENE_CLASSES.filter((c) => c !== 'OSEBA')

/** Privzeti bbox ročne oznake (sredina kadra) — števci so 0..1. */
const MANUAL_BBOX_DEFAULT: [number, number, number, number] = [0.35, 0.35, 0.3, 0.3]
const MANUAL_BBOX_DEFAULT_STR = { x: '0,35', y: '0,35', w: '0,30', h: '0,30' }

/** R485: dolžina opombe ročne oznake (ista meja kot strežnik — SCENE_LIMITS). */
const SCENE_LABEL_MAX = SCENE_LIMITS.elementLabelMaxLen

interface ProjectRow { id: string; code: string; title: string }

/** R465: tekač projekta za vir geometrije overlayja (GET /api/fence-run). */
interface RunOption { id: string; name: string; status: string; totalLengthCm: number; segmentCount: number }

/** R465: segment tekača (GET /api/fence-run/[id] → data.segments). */
interface RunSegmentRow {
  order: number
  fromKind: string
  toKind: string
  fromAtCm: number
  toAtCm: number
  lengthCm: number
  heightCm: number | null
  angleDeg: number | null
  posts: number
  status: string
}

/** R454: rezultat VLM analize prizora (POST /api/ar/analyze). */
interface ArAnalysis {
  scene: string
  placement: { label: string; where: string; estLenCm: number | null; note: string | null }[]
  obstacles: string[]
  references: string[]
}

/** R454: vrstica zgodovine AR posnetkov (GET /api/ar-snapshots — brez params). */
interface SnapshotRow {
  id: string
  projectId: string | null
  scene: string | null
  note: string | null
  createdAt: string
  author?: { name: string; role: string } | null
  project?: { code: string; title: string } | null
}

function loadImage (src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Slike ni bilo mogoče odpreti.'))
    img.src = src
  })
}

/** R465: prenos data URL kot PNG (a[download] — brez strežniškega kroga). */
function downloadPng (dataUrl: string, name: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function parseAnalysis (raw: string | null | undefined): ArAnalysis | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as ArAnalysis
    if (!p || typeof p !== 'object' || !Array.isArray(p.placement)) return null
    return p
  } catch {
    return null
  }
}

export default function ArModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const canWrite = hasPerm(user?.perms, 'measurements.write')

  const viewportRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

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
  /** R483 (issue #8 F5 §11-3): zložljiva navodila ob nezadostnih podatkih —
   *  privzeto ZAPRTO (naslov vedno viden pod AR predogledom). */
  const [helpOpen, setHelpOpen] = useState(false)
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
  /** R471 (F4): zaznana podpora AR globine (WebXR/ARCore) — null = še preverjam. */
  const [depthSupport, setDepthSupport] = useState<DepthSupportInfo | null>(null)
  /** R471 (F4): koliko tapov je že zabeleženih v tekoči AR meri (0..2). */
  const [depthTaps, setDepthTaps] = useState(0)
  /** R471 (F4): AR seja za mero z globino je v teku. */
  const [depthBusy, setDepthBusy] = useState(false)
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
  const [pos, setPos] = useState({ x: 0, y: 20 })
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

  const posRef = useRef({ x: 0, y: 20 })
  const targetRef = useRef({ x: 0, y: 20 })
  const rafRef = useRef<number | null>(null)
  /** R471 (F4): stop-funkcija tekoče AR seje globine (čiščenje ob odklopu). */
  const depthStopRef = useRef<(() => void) | null>(null)

  // R454: AI analiza prizora
  const [analysis, setAnalysis] = useState<ArAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  // R454: zgodovina AR posnetkov (projects.read — tudi za skladišče/proizvodnjo)
  const snapshots = useApi<{ data: SnapshotRow[] }>('/api/ar-snapshots', [])
  const [detail, setDetail] = useState<{ row: SnapshotRow; photo: string | null; analysis: ArAnalysis | null; elements: SceneElement[] | null } | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  /** R485 (§1): obrazec ročne oznake na PERSISTIRANEM posnetku (POST scene-element). */
  const [detailTagOpen, setDetailTagOpen] = useState(false)
  const [detailTagBusy, setDetailTagBusy] = useState(false)
  const [detailBBox, setDetailBBox] = useState<[number, number, number, number] | null>(null)

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
  const handleDetailBBox = useCallback((b: [number, number, number, number] | null): void => {
    setDetailBBox(b)
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

  /** R485 (issue #8 §1): ROČNA OZNAKA na PERSISTIRANEM posnetku — POST
   *  /api/ar-snapshots/[id]/scene-element (2-a ruta; OSEBA zavrnjena na
   *  strežniku) → osvežen prikaz (element se pojavi z virom ROCNO). */
  async function addManualElementToSnapshot (v: ManualTagValues): Promise<void> {
    if (!detail || detailTagBusy) return
    setDetailTagBusy(true)
    try {
      await apiPost(`/api/ar-snapshots/${detail.row.id}/scene-element`, {
        cls: v.cls,
        bbox: v.bbox,
        ...(v.label ? { label: v.label } : {}),
      })
      const se = await apiGet<{ data: { displayed: SceneElement[] } }>(`/api/ar-snapshots/${detail.row.id}/scene-element`)
      if (Array.isArray(se.data?.displayed)) {
        const displayed = se.data.displayed
        setDetail((prev) => (prev && prev.row.id === detail.row.id ? { ...prev, elements: displayed } : prev))
      }
      setDetailTagOpen(false)
      setDetailBBox(null)
      toast({ title: 'Oznaka dodana na posnetek.', description: `${v.cls} — vir: ročno (ROCNO). Element je takoj viden v seznamu zaznav.` })
    } catch (e) {
      toast({ title: 'Dodajanje oznake ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setDetailTagBusy(false)
    }
  }

  // POČIŠČENJE: ob odklopu ustavi vse steze kamere + morebitni rAF glajenja
  // + R471: morebitno AR sejo globine
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      if (depthStopRef.current != null) { try { depthStopRef.current() } catch { /* n/a */ } depthStopRef.current = null }
    }
  }, [])

  // R471 (F4): ENKRATNA zaznava podpore AR globine (WebXR immersive-ar) —
  // neblokirajoče: odgovor pride, ko pride; medtem UI ne obljublja nič.
  useEffect(() => {
    let alive = true
    void detectDepthSupport()
      .then((info) => { if (alive) setDepthSupport(info) })
      .catch(() => { if (alive) setDepthSupport({ supported: false, provider: null, reason: 'Podpore za AR globino ni bilo mogoče preveriti — merite z referenco.' }) })
    return () => { alive = false }
  }, [])

  /**
   * R471 (F4): MERA Z AR GLOBINO — odpre WebXR AR sejo (depth-sensing),
   * monter tapne dve točki, adapter izračuna metrično razdaljo in vrne
   * manifest senzorja. Rezultat se zapiše kot sceneEdit z manifestom →
   * applyEdits izpelje metodo DEPTH_AR. Napake so poštene (razlog + padec
   * na obstoječi tok) — merjenje nikoli ne ostane „obviseno“.
   */
  async function runDepthMeasure (label: string): Promise<void> {
    if (depthBusy) return
    setDepthBusy(true)
    setDepthTaps(0)
    const cameraWasOn = mode === 'on'
    if (cameraWasOn) stopCamera() // WebXR seja prevzame kamero
    try {
      await new Promise<void>((resolve) => {
        void startDepthMeasurement((result) => {
          if (result.ok) {
            setSceneEdits((prev) => [...prev, {
              elementId: sceneSelectedId ?? '',
              measure: { label, valueCm: result.distanceCm, depth: result.manifest },
              by: user?.name ?? 'monter',
              at: Date.now(),
            }])
            toast({
              title: 'Mera iz AR globine zabeležena.',
              description: `${label}: ${result.distanceCm.toFixed(1).replace('.', ',')} cm (AR globina, ${result.manifest.depthFormat}) — shrani se z zajemom AR posnetka.`,
            })
          } else {
            toast({
              title: 'Mera z globino ni uspela.',
              description: `${result.reason} Podatki ostajajo — merite z referenco ali ročno.`,
            })
          }
          resolve()
        }, {
          onTap: (count) => { setDepthTaps(count) },
        }).then((stop) => {
          // če se komponenta odklopi med sejo, jo zapri (memory leak varnost)
          depthStopRef.current = stop
        }).catch(() => {
          toast({ title: 'Mera z globino ni uspela.', description: 'AR seje ni bilo mogoče odpreti na tej napravi — merite z referenco ali ročno.' })
          resolve()
        })
      })
    } finally {
      setDepthBusy(false)
      setDepthTaps(0)
      depthStopRef.current = null
      if (cameraWasOn) await startCamera()
    }
  }

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

  // ── vlečenje overlayja (R465: glajenje low-pass + zaklep) ──
  function onPointerDown (e: ReactPointerEvent<HTMLDivElement>): void {
    if (locked) return // zaklenjen položaj — zajem brez nerodnega pomika
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: posRef.current.x, baseY: posRef.current.y }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* nekateri brskalniki */ }
  }
  function onPointerMove (e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d || locked) return
    // ciljna točka iz povleka; dejanski položaj ji sledi z glajenjem (stabilizacija)
    targetRef.current = { x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) }
    if (rafRef.current == null) {
      const tick = () => {
        const t = targetRef.current
        const p = posRef.current
        const nx = p.x + (t.x - p.x) * 0.3
        const ny = p.y + (t.y - p.y) * 0.3
        posRef.current = { x: nx, y: ny }
        setPos({ x: nx, y: ny })
        if (Math.abs(t.x - nx) > 0.25 || Math.abs(t.y - ny) > 0.25) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          posRef.current = { ...t }
          setPos({ ...t })
          rafRef.current = null
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
  }
  function onPointerUp (): void { dragRef.current = null }

  /** Zajem trenutnega kadra na canvas. withOverlay: true = s ograjo (posnetek),
   *  false = čist prizor (za VLM analizo — overlay bi motil prepoznavo). */
  async function captureFrame (withOverlay: boolean): Promise<string> {
    const container = viewportRef.current
    if (!container) throw new Error('Predogled ni na voljo.')
    const cw = container.clientWidth
    const ch = container.clientHeight
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas ni na voljo v tem brskalniku.')

    // ozadje: video (cover) ali demo gradient
    const video = videoRef.current
    if (mode === 'on' && video && video.videoWidth > 0) {
      const vr = video.videoWidth / video.videoHeight
      const cr = cw / ch
      let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight
      if (vr > cr) { sh = video.videoHeight; sw = sh * cr; sx = (video.videoWidth - sw) / 2 }
      else { sw = video.videoWidth; sh = sw / cr; sy = (video.videoHeight - sh) / 2 }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch)
    } else {
      const grad = ctx.createLinearGradient(0, 0, cw * 0.4, ch)
      grad.addColorStop(0, '#e7e5e4')
      grad.addColorStop(0.55, '#a8a29e')
      grad.addColorStop(1, '#78716c')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, cw, ch)
    }

    if (withOverlay) {
      const svg = svgRef.current
      if (svg) {
        // overlay SVG na položaj (počakaj nalaganje slike!)
        const xml = new XMLSerializer().serializeToString(svg)
        const overlayUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
        const img = await loadImage(overlayUrl)
        const destX = cw / 2 + pos.x - (OVERLAY_W * scale) / 2
        const destY = ch / 2 + pos.y - (OVERLAY_H * scale) / 2
        ctx.globalAlpha = opacity
        ctx.drawImage(img, destX, destY, OVERLAY_W * scale, OVERLAY_H * scale)
        ctx.globalAlpha = 1
      }
    }
    return canvas.toDataURL('image/jpeg', 0.7)
  }

  // ── R454: AI analiza prizora (VLM, backend) ──
  async function analyze (): Promise<void> {
    if (mode === 'off') return
    setAnalyzing(true)
    try {
      const photo = await captureFrame(false)
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
      const photo = await captureFrame(true)
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
        params: JSON.stringify({ photo, ar: true }),
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
          analysis: analysis ? JSON.stringify(analysis) : null,
          params: JSON.stringify({ photo, posts, heightCm, scale, opacity, mode, ...sourceInfo }),
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

  // ── R454: zgodovina — ogled podrobnosti s fotografijo ──
  // R485 (§1/§9): ob ogledu naloži tudi ZAZNAVE PRIZORA (GET scene-element →
  //  displayed) za seznam + ročno oznako (POST); brez razumevanja = brez bloka.
  async function viewSnapshot (row: SnapshotRow): Promise<void> {
    if (detail?.row.id === row.id) {
      setDetail(null)
      setDetailTagOpen(false)
      setDetailBBox(null)
      return
    }
    setDetailBusy(true)
    try {
      const res = await apiGet<{ data: { id: string; params: string | null; scene: string | null; analysis: string | null; note: string | null; createdAt: string } }>(`/api/ar-snapshots/${row.id}`)
      let photo: string | null = null
      if (res.data.params) {
        try {
          const p = JSON.parse(res.data.params) as { photo?: unknown }
          if (typeof p.photo === 'string' && p.photo.startsWith('data:image/')) photo = p.photo
        } catch { /* brez fotografije */ }
      }
      let elements: SceneElement[] | null = null
      try {
        const se = await apiGet<{ data: { displayed: SceneElement[] } }>(`/api/ar-snapshots/${row.id}/scene-element`)
        if (Array.isArray(se.data?.displayed)) elements = se.data.displayed
      } catch { /* posnetek brez razumevanja prizora — blok se ne prikaže */ }
      setDetailTagOpen(false)
      setDetailBBox(null)
      setDetail({ row, photo, analysis: parseAnalysis(res.data.analysis), elements })
    } catch (e) {
      toast({ title: 'Podrobnosti ni bilo mogoče naložiti.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setDetailBusy(false)
    }
  }

  async function deleteSnapshot (id: string): Promise<void> {
    setDeleting(id)
    try {
      await apiDelete(`/api/ar-snapshots/${id}`)
      if (detail?.row.id === id) setDetail(null)
      void snapshots.reload()
      toast({ title: 'AR posnetek izbrisan.' })
    } catch (e) {
      toast({ title: 'Brisanje ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setDeleting(null)
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
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <ScanLine className="size-4 text-roksal-amber" aria-hidden /> Nastavitve
            </h2>

            {/* R465: vir geometrije overlayja */}
            <div className="space-y-2">
              <Label htmlFor="ar-vir">Vir geometrije</Label>
              <Select value={vir} onValueChange={(v) => { setVir(v as 'rocno' | 'tekac'); setRunId('none') }}>
                <SelectTrigger id="ar-vir" aria-label="Vir geometrije ograje">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rocno">Ročno (stebri + višina)</SelectItem>
                  <SelectItem value="tekac">Iz tekača projekta (segmenti)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {vir === 'rocno' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ar-posts">Št. stebrov</Label>
                  <Input id="ar-posts" type="number" min="2" max="20" inputMode="numeric"
                    value={postsS} onChange={(e) => setPostsS(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ar-height">Višina (cm)</Label>
                  <Input id="ar-height" type="number" min="40" max="250" inputMode="numeric"
                    value={heightS} onChange={(e) => setHeightS(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="ar-run">Tekač projekta</Label>
                <Select value={runId} onValueChange={setRunId} disabled={projectId === 'none'}>
                  <SelectTrigger id="ar-run" aria-label="Izberi ograjnega tekača">
                    <SelectValue placeholder={projectId === 'none' ? 'Najprej izberite projekt' : runs.loading ? 'Nalagam …' : 'Izberite tekača'} />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    <SelectItem value="none">Brez tekača</SelectItem>
                    {(runs.data?.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} — {r.segmentCount} seg. · {(r.totalLengthCm / 100).toFixed(1).replace('.', ',')} m
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {projectId === 'none' ? (
                  <p className="text-xs text-muted-foreground">Izberite projekt zgoraj — tekači so vezani na projekt.</p>
                ) : runLoading ? (
                  <p className="text-xs text-muted-foreground">Nalagam segmente tekača …</p>
                ) : runSegs ? (
                  <p className="text-xs text-muted-foreground">
                    Vir: {runSegs.length} segmentov · {(runSegs.reduce((a, s) => a + s.lengthCm, 0) / 100).toFixed(1).replace('.', ',')} m ·
                    {' '}{runSegs.filter((s) => s.toKind === 'VRATA').length} vrat · stebrov {runSegs.reduce((a, s) => a + s.posts, 0) + runSegs.length + 1}
                  </p>
                ) : (
                  <ErrorBox error={runs.error} />
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ar-scale">Velikost ({scale.toFixed(2).replace('.', ',')}×)</Label>
              <Slider id="ar-scale" min={0.4} max={2} step={0.05} value={[scale]} onValueChange={(v) => setScale(v[0] ?? 1)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ar-opacity">Prosojnost ({Math.round(opacity * 100)} %)</Label>
              <Slider id="ar-opacity" min={0.3} max={1} step={0.05} value={[opacity]} onValueChange={(v) => setOpacity(v[0] ?? 1)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ar-project">Projekt (za zajem)</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="ar-project" aria-label="Poveži s projektom">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-48">
                  <SelectItem value="none">Brez projekta</SelectItem>
                  {(projects.data?.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ErrorBox error={projects.error} />
            </div>

            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="ar-lock">Zaklep položaja (stabilizacija)</Label>
                <Button
                  id="ar-lock"
                  size="sm"
                  variant={locked ? 'default' : 'outline'}
                  aria-pressed={locked}
                  onClick={() => setLocked((l) => !l)}
                >
                  {locked ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
                  {locked ? 'Zaklenjeno' : 'Odklenjeno'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {locked
                  ? 'Položaj ograje je zaklenjen — povlek je izklopljen (varno zajemanje).'
                  : 'Povlek je glajen (nizkofrekvenčno) — pred zajemom položaj zaklenite.'}
              </p>
            </div>

            {canWrite ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ar-note">Opomba</Label>
                  <Input id="ar-note" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="npr. predogled pred sprednjo teraso" />
                </div>

                {/* R454: AI analiza prizora */}
                <div className="space-y-2 border-t pt-4">
                  <Button variant="outline" className="h-11 w-full" onClick={() => void analyze()} disabled={analyzing || mode === 'off'}>
                    {analyzing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4 text-roksal-amber" aria-hidden />}
                    Analiziraj prizor (AI)
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Umetna inteligenca opisuje prizor in predlaga mesta za ograjo — rezultat je pomoč pri odločitvi, ne meritev.
                  </p>
                </div>

                <Button className="h-11 w-full" onClick={() => void capture()} disabled={busy || mode === 'off'}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                  Zajemi posnetek
                </Button>
              </>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                Za zajem AR posnetka je potrebna pravica measurements.write.
              </p>
            )}

            {lastShot ? (
              <figure className="space-y-1.5 border-t pt-3">
                <figcaption className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ImageIcon className="size-3.5 text-roksal-amber" aria-hidden /> Zadnji zajem
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 px-2 text-xs"
                    onClick={() => downloadPng(lastShot, `ar-zajem-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`)}
                  >
                    <Download className="size-3.5" aria-hidden /> PNG
                  </Button>
                </figcaption>
                <img src={lastShot} alt="Zadnji AR zajem z ograjo" className="w-full rounded-lg border" />
              </figure>
            ) : null}
          </CardContent>
        </Card>

        {/* predogled + analiza */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  <Video className="size-4 text-roksal-amber" aria-hidden /> Predogled
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {mode === 'on' ? <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Kamera aktivna</Badge> : null}
                  {mode === 'demo' ? <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Demo ozadje</Badge> : null}
                  {locked && mode !== 'off' ? <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">Zaklenjeno</Badge> : null}
                  {vir === 'tekac' && mode !== 'off' ? <Badge className="border-transparent bg-secondary text-secondary-foreground">Tekač: {runSegs?.length ?? 0} seg.</Badge> : null}
                  {mode !== 'off' ? (
                    <Button variant="outline" size="sm" onClick={stopCamera}>
                      <CameraOff className="size-4" aria-hidden /> Izklopi kamero
                    </Button>
                  ) : null}
                </div>
              </div>

              <div
                ref={viewportRef}
                className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-xl border bg-muted"
                aria-label="AR predogled ograje"
              >
                {/* video (samo ko je kamera aktivna) */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 size-full object-cover"
                  aria-label="Živa slika kamere"
                  onLoadedMetadata={(e) => {
                    // R470 (§5): razmerje stranic za izračun dolžin osi v px
                    const vw = e.currentTarget.videoWidth
                    const vh = e.currentTarget.videoHeight
                    if (vw > 0 && vh > 0) setVideoAspect(vw / vh)
                  }}
                />

                {/* R467 (issue #8 F1): žive zaznave prizora — samo z živo kamero;
                    POD ograjinim overlayjem (ograja ostane glavni interakcijski objekt).
                    R485 (§9): pogled (ŽIVO/PREPOZNANO/MERE) — SAMO prikaz istih elementov. */}
                {mode === 'on' && sceneOverlayElements.length > 0 ? (
                  <SceneOverlay
                    elements={sceneOverlayElements}
                    quality={sceneState.quality}
                    selectedId={sceneSelectedId}
                    pinnedIds={scenePinned}
                    view={sceneView === 'PREPOZNANO' ? 'PREPOZNANO' : sceneView === 'MERE' ? 'MERE' : 'ZIVO'}
                    onSelect={selectSceneElement}
                  />
                ) : null}

                {/* R485 (issue #8 §1): živi predogled bboxa ročne oznake — kam
                    bo oznaka postavljena (števci 0..1 → delež kadra). */}
                {mode === 'on' && manualOpen && manualBBox != null ? (
                  <div
                    className="pointer-events-none absolute rounded-md border-2 border-dashed border-roksal-amber bg-roksal-amber/10"
                    style={{
                      left: `${Math.round(manualBBox[0] * 100)}%`,
                      top: `${Math.round(manualBBox[1] * 100)}%`,
                      width: `${Math.round(manualBBox[2] * 100)}%`,
                      height: `${Math.round(manualBBox[3] * 100)}%`,
                    }}
                    aria-hidden
                  />
                ) : null}

                {/* demo ozadje */}
                {mode === 'demo' ? (
                  <div className="absolute inset-0" style={{ background: DEMO_GRAD }} aria-hidden />
                ) : null}

                {/* izklopljeno stanje */}
                {mode === 'off' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-secondary/60 p-6 text-center">
                    <Camera className="size-10 text-muted-foreground/60" aria-hidden />
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Vklopite kamero za predogled ograje na realni lokaciji — ali uporabite demo ozadje, če kamere ni.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button onClick={() => void startCamera()} disabled={starting}>
                        {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
                        Vklopi kamero
                      </Button>
                      <Button variant="outline" onClick={() => setMode('demo')} disabled={starting}>
                        Demo ozadje
                      </Button>
                    </div>
                  </div>
                ) : null}

                {/* overlay ograja — vlečna (samo ko predogled teče; v stanju "off" ne sme
                    prekrivati gumbov Zaženi kamero / Demo ozadje) */}
                {mode !== 'off' ? (
                  <div
                    className={`touch-none ${locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
                    style={{
                      opacity,
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: OVERLAY_W,
                      height: OVERLAY_H,
                      transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                    }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    role="img"
                    aria-label={vir === 'tekac'
                      ? `Predogled ograje iz tekača: ${runSegs?.length ?? 0} segmentov${locked ? ' — položaj zaklenjen' : ' — povlecite za premik'}`
                      : `Predogled ograje: ${posts} stebrov, višina ${heightCm} centimetrov${locked ? ' — položaj zaklenjen' : ' — povlecite za premik'}`}
                    tabIndex={0}
                  >
                    {vir === 'tekac' && runSegs && runSegs.length > 0 ? (
                      <ArRunRailingSvg ref={svgRef} segments={runSegs} fallbackHeightCm={heightCm} />
                    ) : vir === 'tekac' ? (
                      <div className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/70 bg-black/35 p-4 text-center text-[11px] font-medium text-white">
                        <Waypoints className="size-5" aria-hidden />
                        {runLoading ? 'Nalagam segmente tekača …' : 'Izberite tekača (levo) za predogled realne geometrije'}
                      </div>
                    ) : (
                      <ArRailingSvg ref={svgRef} posts={posts} heightCm={heightCm} />
                    )}
                    <span className="pointer-events-none absolute -top-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
                      {locked ? <Lock className="size-3" aria-hidden /> : <Move className="size-3" aria-hidden />}
                      {locked ? 'zaklenjeno' : 'povleci'}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* R485 (issue #8 §9): PREKLOP POGLEDOV — ŽIVO | PREPOZNANO | MERE |
                  PREGLED. Pod predogledom (NE čez kamero); ŽIVO privzeto = sedanje
                  obnašanje. To je SAMO pogled na obstoječe elemente — brez novih
                  nastavitev (§9 „ne sili monterja v množico nastavitev“). */}
              {mode === 'on' ? (
                <div className="space-y-2">
                  <div
                    role="group"
                    aria-label="Pogled zaznav v AR predogledu"
                    className="grid grid-cols-4 gap-1 rounded-lg border bg-secondary/40 p-1"
                  >
                    {SCENE_VIEWS.map((v) => {
                      const active = sceneView === v.id
                      return (
                        <button
                          key={v.id}
                          type="button"
                          title={v.hint}
                          aria-pressed={active}
                          className={`flex min-h-11 items-center justify-center rounded-md px-1 text-[11px] font-bold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-roksal-amber ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                          onClick={() => { setSceneView(v.id) }}
                        >
                          {v.text.toUpperCase()}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] leading-snug text-muted-foreground" role="note">
                    {SCENE_VIEWS.find((v) => v.id === sceneView)?.hint}
                  </p>

                  {/* R485 (issue #8 §1): ROČNA OZNAKA — »neprepoznano, tapni za
                      označitev« prej ni imela poti (zaznavanje NE producira
                      NEZNANO — poštenost). V ŽIVO/PREPOZNANO/PREGLED pogledu. */}
                  {canWrite && sceneView !== 'MERE' && !manualOpen ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setManualOpen(true); setManualBBox(MANUAL_BBOX_DEFAULT) }}
                    >
                      <Plus className="size-3.5" aria-hidden /> Dodaj oznako ročno
                    </Button>
                  ) : null}
                  {manualOpen && canWrite ? (
                    <ManualTagForm
                      onSubmit={addManualElementLive}
                      onCancel={() => { setManualOpen(false); setManualBBox(null) }}
                      onBBoxChange={handleManualBBox}
                    />
                  ) : null}

                  {/* PREGLED (§9 :137): tapljivi seznam VSEH elementov — vrstica
                      na element (ikona/razred, opomba, status, zaupanje, mere,
                      vir); tap odpre obstoječi tap-detail pod predogledom. */}
                  {sceneView === 'PREGLED' ? (
                    <div className="rounded-lg border">
                      <p className="flex items-center justify-between border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        <span>Pregled elementov</span>
                        <span className="font-semibold" aria-label={`${sceneDisplayed.length} elementov`}>{sceneDisplayed.length}</span>
                      </p>
                      {sceneDisplayed.length === 0 ? (
                        <div className="space-y-2 p-3">
                          <p className="text-sm text-muted-foreground">
                            V tem kadru ni zaznanih elementov — zaznavanje je namenoma konservativno
                            (brez dokaza ne trdi razreda; NEZNANO je poštena zadnja možnost).
                          </p>
                          {canWrite ? (
                            <Button variant="outline" size="sm" onClick={() => { setManualOpen(true); setManualBBox(MANUAL_BBOX_DEFAULT) }}>
                              <Plus className="size-3.5" aria-hidden /> Dodaj oznako ročno
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <ul className="max-h-96 divide-y overflow-y-auto pr-1" aria-label="Seznam zaznanih elementov prizora">
                          {sceneDisplayed.map((el) => (
                            <li key={el.id}>
                              <SceneElementRow el={el} selected={sceneSelectedId === el.id} onSelect={selectSceneElement} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}

                  {/* MERE brez mer — pošteno prazno stanje (osi so predlog brez cm) */}
                  {sceneView === 'MERE' && !sceneDisplayed.some((e) => (e.measures?.length ?? 0) > 0) ? (
                    <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground" role="note">
                      V tem kadru še ni zabeleženih mer — izberite element in zabeležite mero
                      (ročni vnos, referenčna skala ali AR globina). Osi brez metode ostanejo brez cm.
                    </p>
                  ) : null}
                </div>
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
              <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
                <div className="rounded-lg border border-dashed">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-roksal-amber"
                      aria-expanded={helpOpen}
                      aria-controls="ar-nezadostni-podatki"
                    >
                      {helpOpen ? <ChevronDown className="size-4 shrink-0 text-roksal-amber" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-roksal-amber" aria-hidden />}
                      <Lightbulb className="size-4 shrink-0 text-roksal-amber" aria-hidden />
                      <span className="text-xs font-bold uppercase tracking-wide">Nezadostni podatki — kaj zdaj?</span>
                      <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">{helpOpen ? 'skrči' : 'razpri'}</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ol id="ar-nezadostni-podatki" className="space-y-1.5 border-t px-3 py-2.5">
                      <li className="flex items-start gap-1.5 text-xs leading-snug">
                        <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">1.</span>
                        <span><strong>Posnemite dodatni pogled z drugega kota</strong> — zakriti rob ali konec se pogosto pokaže že z malo drugačnega stališča.</span>
                      </li>
                      <li className="flex items-start gap-1.5 text-xs leading-snug">
                        <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">2.</span>
                        <span><strong>Določite referenčno mero</strong> — znana dolžina v kadru (miknik, plošča, stopnica) omogoči izpeljavo centimetrov.</span>
                      </li>
                      <li className="flex items-start gap-1.5 text-xs leading-snug">
                        <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">3.</span>
                        <span><strong>Manjkajoči rob ali točko označite ročno</strong> — popravek razreda ali vrste se shrani kot označen podatek, izvirna zaznava ostane.</span>
                      </li>
                      <li className="flex items-start gap-1.5 text-xs leading-snug">
                        <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">4.</span>
                        <span><strong>Pri naklonu uporabite nivelir ali referenčno metodo</strong> — brez globinskih podatkov je naklon samo ocena (ročni vnos šteje kot izmera).</span>
                      </li>
                      <li className="flex items-start gap-1.5 text-xs leading-snug">
                        <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">5.</span>
                        <span><strong>Kritična mera brez dokaza NE gre v kosovnico</strong> — izmerite ročno ali iz tekača; prepoznava je samo predlog.</span>
                      </li>
                    </ol>
                    <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
                      Velja vsem zaznavam: to je predlog prepoznave, še ni proizvodna mera (issue #8 §8).
                    </p>
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* R467 (issue #8 F1 §2): popravek zaznanega elementa — OZNAČEN PODATEK,
                  izvirni zajem ostaja; shrani se z naslednjim AR posnetkom.
                  R468 (F2 §3/§9): prikaz GEOMETRIJE (maska/naklon/vir/status),
                  ročna izmera naklona in pripinjanje oznake. */}
              {mode === 'on' && sceneSelected ? (
                <div className="rounded-lg border bg-secondary/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      Zaznan element: {sceneSelected.cls}
                      {sceneSelected.kind ? ` · ${sceneSelected.kind}` : ''}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant={scenePinned.has(sceneSelected.id) ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        aria-pressed={scenePinned.has(sceneSelected.id)}
                        onClick={() => {
                          setScenePinned((prev) => {
                            const next = new Set(prev)
                            if (next.has(sceneSelected.id)) next.delete(sceneSelected.id)
                            else next.add(sceneSelected.id)
                            return next
                          })
                        }}
                      >
                        <MapPin className="size-3.5" aria-hidden />
                        {scenePinned.has(sceneSelected.id) ? 'Pripeto' : 'Pripni'}
                      </Button>
                      <Badge variant="outline" className="text-[10px]">
                        vir: {sceneSelected.source === 'ROCNO' ? 'ročno potrjeno' : sceneSelected.source === 'VLM' ? 'AI predlog' : 'lokalna hevristika'}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Popravek se shrani kot označen podatek ob zajemu AR posnetka — izvirna zaznava ostane nespremenjena.
                  </p>

                  {/* R469 (F3 §4): geometrija stopnic — števec, smer, pravilnost, podest;
                      POŠTENOST: višin čel in globin nastopov NI mogoče izmeriti
                      iz enega 2D pogleda (issue §4) — to je izrecno zapisano. */}
                  {sceneSelected.cls === 'STOPNICA' ? (
                    <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
                      <p className="font-semibold">Geometrija stopnic</p>
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        <li>
                          Vidni nastopi: {sceneSelected.steps != null
                            ? `${sceneSelected.steps} (${sceneSelected.source === 'ROCNO' ? 'ročno potrjeno' : 'ocena iz vizualne geometrije'})`
                            : 'nezaznani v tem kadru'}
                        </li>
                        <li>
                          Smer vzpenjanja: {sceneSelected.ascent != null
                            ? `${ascentText(sceneSelected.ascent)} (ocena — preverite na objektu)`
                            : 'ni ocenljiva iz tega kadra'}
                        </li>
                        <li>
                          Razmaki med nastopi: {sceneSelected.stepIrregular === true
                            ? 'NEENAKOMERNI — ročni pregled odstopajoče stopnice'
                            : sceneSelected.stepGap != null ? 'videti enakomerni (ocena)' : 'nezaznani'}
                        </li>
                        <li>
                          Podest: {sceneSelected.landing === true
                            ? 'morebiten (večja vrzel med nastopi) — potrdite'
                            : 'ni zaznan'}
                        </li>
                        <li className="text-foreground">
                          Višine čel in globine nastopov niso izmerljive iz enega pogleda — izmerite z referenco ali AR globino.
                        </li>
                        <li>
                          Status geometrije: <span className="font-medium text-foreground">{geomStatusText(sceneSelected) ?? 'ni podatka'}</span>
                          {sceneSelected.geomStatus === 'GEOMETRIJA_OCENJENA' ? ' — ocena, ne izmera.' : ''}
                        </li>
                      </ul>
                      <div className="mt-2 flex flex-wrap items-end gap-1.5">
                        <div className="space-y-0.5">
                          <Label htmlFor="scene-steps" className="text-[11px]">Potrjeno število stopnic (preštejte na objektu)</Label>
                          <Input
                            id="scene-steps"
                            inputMode="numeric"
                            className="h-8 w-28 text-xs"
                            placeholder="npr. 5"
                            value={stepsInput}
                            onChange={(e) => { setStepsInput(e.target.value) }}
                            aria-describedby="scene-steps-help"
                          />
                        </div>
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={Number.isNaN(Number(stepsInput.replace(',', '.'))) || stepsInput.trim() === '' ||
                            !(Number(stepsInput.replace(',', '.')) >= 1) || !(Number(stepsInput.replace(',', '.')) <= 20)}
                          onClick={() => {
                            const v = Math.round(Number(stepsInput.replace(',', '.')))
                            if (!Number.isFinite(v) || v < 1 || v > 20) return
                            setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                              elementId: sceneSelected.id,
                              steps: v,
                              by: user?.name ?? 'monter',
                              at: Date.now(),
                            }])
                            toast({ title: 'Potrjeno število stopnic zabeleženo.', description: `${v} stopnic (ročno potrjeno). Shrani se z zajemom AR posnetka.` })
                            setStepsInput('')
                          }}
                        >
                          <Save className="size-3.5" aria-hidden />
                          Potrdi
                        </Button>
                        <span id="scene-steps-help" className="sr-only">
                          Preštejte vidne stopnice na objektu in vnesite število od 1 do 20; potrditev se shrani z zajemom.
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {/* R485 (issue #8 §2/§9): OGRAJA — lastna sekcija: število stebrov
                      (postCount = OCENA iz periodike navpičnic, detectPostLines)
                      + pošteno o mejah enega kadra. Mere so v razdelku Mere. */}
                  {sceneSelected.cls === 'OGRAJA' ? (
                    <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
                      <p className="font-semibold">Geometrija ograje</p>
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        <li>
                          Zaznanih stebrov: {sceneSelected.postCount != null
                            ? `${sceneSelected.postCount} (ocena iz periodike navpičnih črt)`
                            : 'nezaznani v tem kadru (dokaz so vodoravne črte, ne stebri)'}
                        </li>
                        <li>
                          Status geometrije: <span className="font-medium text-foreground">{geomStatusText(sceneSelected) ?? 'ni podatka'}</span>
                          {sceneSelected.source === 'ROCNO'
                            ? ' — razred ročno potrjen.'
                            : ' — dokaz je šibek, zato hevristika ostaja NEJASNO (nikoli samodejno prepoznano).'}
                        </li>
                        <li className="text-foreground">
                          Odseki, vogali, vrata in pritrdilna mesta niso ločljivi iz enega kadra — več objektov iste vrste ostane en element (znana meja, SMART-VISION-8 §2).
                        </li>
                        <li>Mere segmenta so v razdelku Mere (osi brez cm, dokler ni veljavne metode).</li>
                      </ul>
                    </div>
                  ) : null}

                  {/* R468 (F2 §3): geometrija površine — ločena od prepoznave (§2/§6) */}
                  {(sceneSelected.cls === 'TLA' || sceneSelected.cls === 'PODLAGA' || sceneSelected.cls === 'ROB') ? (
                    <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
                      <p className="font-semibold">Geometrija površine</p>
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        <li>
                          Maska tal: {sceneSelected.maskPoints && sceneSelected.maskPoints.length >= 3
                            ? `zaznana (${sceneSelected.maskPoints.length} točk poligona)`
                            : 'ni zaznana v tem kadru'}
                        </li>
                        {sceneSelected.cls === 'ROB' ? (
                          <li>
                            Kot roba v kadru: {sceneSelected.angleDeg != null
                              ? `${sceneSelected.angleDeg.toFixed(1).replace('.', ',')}°${sceneSelected.source === 'ROCNO' ? ' (ročno potrjeno)' : ' (ocena iz vizualne geometrije)'}`
                              : 'neznan'}
                          </li>
                        ) : (
                          <li>
                            Naklon: {sceneSelected.slopeDeg != null
                              ? `${sceneSelected.slopeDeg === 0 ? '~0°' : `~${Math.abs(sceneSelected.slopeDeg).toFixed(1).replace('.', ',')}° (${sceneSelected.slopeDeg > 0 ? 'padec desno' : 'padec levo'})`} — vir: ${slopeSourceText(sceneSelected) ?? 'neznan'}`
                              : `ni ocenljiv iz tega kadra${geomStatusText(sceneSelected) ? ` (${geomStatusText(sceneSelected)})` : ''}`}
                          </li>
                        )}
                        <li>
                          Status geometrije: <span className="font-medium text-foreground">{geomStatusText(sceneSelected) ?? 'ni podatka'}</span>
                          {sceneSelected.geomStatus === 'GEOMETRIJA_OCENJENA' ? ' — ocena, ne izmera; potrdite z referenco.' : ''}
                        </li>
                      </ul>
                      {sceneSelected.cls === 'ROB' ? (
                        /* R485 (issue #8 §2): POPRAVEK KOTA ROBA — vnos −90..360;
                           črta roba je NEUSMERJENA: normalizacija mod 180 v
                           [−90, 90] (350° ≡ −10°) se izvede v applyEdits
                           (jedro, enako na strežniku); vir ROCNO + IZMERJENO. */
                        <div className="mt-2 flex flex-wrap items-end gap-1.5">
                          <div className="space-y-0.5">
                            <Label htmlFor="scene-angle" className="text-[11px]">Popravek kota roba (°, −90..360; npr. −8 ali 350)</Label>
                            <Input
                              id="scene-angle"
                              inputMode="decimal"
                              className="h-8 w-32 text-xs"
                              placeholder="Stopinje"
                              value={angleInput}
                              onChange={(e) => { setAngleInput(e.target.value) }}
                              aria-describedby="scene-angle-help"
                            />
                          </div>
                          <Button
                            size="sm"
                            className="h-8"
                            disabled={Number.isNaN(Number(angleInput.replace(',', '.'))) || angleInput.trim() === '' ||
                              !(Number(angleInput.replace(',', '.')) >= -90) || !(Number(angleInput.replace(',', '.')) <= 360)}
                            onClick={() => {
                              const v = Number(angleInput.replace(',', '.'))
                              if (!Number.isFinite(v) || v < -90 || v > 360) return
                              setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                                elementId: sceneSelected.id,
                                angleDeg: v,
                                by: user?.name ?? 'monter',
                                at: Date.now(),
                              }])
                              const norm = Math.round((((v + 90) % 180 + 180) % 180 - 90) * 10) / 10
                              toast({
                                title: 'Popravek kota roba zabeležen.',
                                description: `Kot ${v.toFixed(1).replace('.', ',')}° → shranjen kot ${norm.toFixed(1).replace('.', ',')}° (črta roba je neusmerjena — mod 180; ročno, IZMERJENO). Shrani se z zajemom AR posnetka.`,
                              })
                              setAngleInput('')
                            }}
                          >
                            <Save className="size-3.5" aria-hidden />
                            Zabeleži
                          </Button>
                          <span id="scene-angle-help" className="sr-only">
                            Vnesite preštani ali izmerjeni kot roba glede na vodoravnico kadra v stopinjah; veljavno od −90 do 360, normalizira se na −90 do 90.
                          </span>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-end gap-1.5">
                          <div className="space-y-0.5">
                            <Label htmlFor="scene-slope" className="text-[11px]">Izmerjeni naklon (°, npr. 3,5 ali −2)</Label>
                            <Input
                              id="scene-slope"
                              inputMode="decimal"
                              className="h-8 w-28 text-xs"
                              placeholder="Stopinje"
                              value={slopeInput}
                              onChange={(e) => { setSlopeInput(e.target.value) }}
                              aria-describedby="scene-slope-help"
                            />
                          </div>
                          <Button
                            size="sm"
                            className="h-8"
                            disabled={Number.isNaN(Number(slopeInput.replace(',', '.'))) || slopeInput.trim() === '' || Math.abs(Number(slopeInput.replace(',', '.'))) > 45}
                            onClick={() => {
                              const v = Number(slopeInput.replace(',', '.'))
                              if (!Number.isFinite(v) || Math.abs(v) > 45) return
                              setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                                elementId: sceneSelected.id,
                                slopeDeg: v,
                                by: user?.name ?? 'monter',
                                at: Date.now(),
                              }])
                              toast({ title: 'Izmerjeni naklon zabeležen.', description: `Naklon ${v.toFixed(1).replace('.', ',')}° (ročno, IZMERJENO). Shrani se z zajemom AR posnetka.` })
                              setSlopeInput('')
                            }}
                          >
                            <Save className="size-3.5" aria-hidden />
                            Zabeleži
                          </Button>
                          <span id="scene-slope-help" className="sr-only">
                            Vnesite z nivelirjem ali referenčno metodo izmerjen naklon tal v stopinjah; veljavno od −45 do 45.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* R470 (issue #8 §5): MERE PREDMETOV — predlog dimenzijskih osi
                      BREZ cm vrednosti; fizična mera pride SAMO z zapisano metodo
                      (ročni vnos ali kalibrirana fotografija prek reference). */}
                  {sceneSelected.cls !== 'OSEBA' && (selectedAxes.length > 0 || selectedMeasures.length > 0) ? (
                    <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
                      <p className="font-semibold">Mere</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Osi so predlog — vrednosti v cm se ne izračunavajo iz pikslov brez veljavne reference (poštenost §5).
                      </p>

                      {/* predlogane osi + vnos mere po osi */}
                      {selectedAxes.length > 0 ? (
                        <ul className="mt-1.5 space-y-1.5">
                          {selectedAxes.map((a, i) => {
                            const computed = computedForAxis(i)
                            const manual = measureInputs[i] ?? ''
                            const manualVal = Number(manual.replace(',', '.'))
                            return (
                              <li key={`${a.label}-${i}`} className="rounded border bg-secondary/30 px-2 py-1.5">
                                <div className="flex flex-wrap items-center justify-between gap-1">
                                  <span className="font-medium">{a.label}</span>
                                  <span className="text-[10px] text-muted-foreground">{AXIS_KIND_TEXT[a.kind]} · potrebna mera</span>
                                </div>
                                {computed != null ? (
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    Iz reference: <span className="font-semibold text-foreground">≈ {computed.toFixed(1).replace('.', ',')} cm</span>{' '}
                                    <span className="text-[10px]">(ocena iz kalibrirane fotografije — potrdite z izmero)</span>
                                  </p>
                                ) : null}
                                <div className="mt-1 flex flex-wrap items-end gap-1.5">
                                  <div className="space-y-0.5">
                                    <Label htmlFor={`scene-measure-${i}`} className="text-[10px]">Izmerjeno (cm, npr. 117,5)</Label>
                                    <Input
                                      id={`scene-measure-${i}`}
                                      inputMode="decimal"
                                      className="h-8 w-28 text-xs"
                                      placeholder="cm"
                                      value={manual}
                                      onChange={(e) => { setMeasureInputs((prev) => ({ ...prev, [i]: e.target.value })) }}
                                      aria-describedby={`scene-measure-${i}-help`}
                                    />
                                  </div>
                                  <Button
                                    size="sm"
                                    className="h-8"
                                    disabled={Number.isNaN(manualVal) || manual.trim() === '' || !(manualVal >= 0.1) || manualVal > 100000}
                                    onClick={() => {
                                      if (!Number.isFinite(manualVal) || manualVal < 0.1 || manualVal > 100000) return
                                      setSceneEdits((prev) => [...prev, {
                                        elementId: sceneSelected.id,
                                        measure: { label: a.label, valueCm: manualVal },
                                        by: user?.name ?? 'monter',
                                        at: Date.now(),
                                      }])
                                      toast({
                                        title: 'Mera zabeležena.',
                                        description: `${a.label}: ${manualVal.toFixed(1).replace('.', ',')} cm (ročni vnos). Shrani se z zajemom AR posnetka.`,
                                      })
                                      setMeasureInputs((prev) => ({ ...prev, [i]: '' }))
                                    }}
                                  >
                                    <Save className="size-3.5" aria-hidden />
                                    Zabeleži
                                  </Button>
                                  {computed != null ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8"
                                      onClick={() => {
                                        setSceneEdits((prev) => [...prev, {
                                          elementId: sceneSelected.id,
                                          measure: { label: a.label, valueCm: computed, method: 'KALIBRIRANA_FOTOGRAFIJA' },
                                          by: user?.name ?? 'monter',
                                          at: Date.now(),
                                        }])
                                        toast({
                                          title: 'Mera prevzeta iz reference.',
                                          description: `${a.label}: ≈ ${computed.toFixed(1).replace('.', ',')} cm (kalibrirana fotografija — ocena, potrdite z izmero).`,
                                        })
                                      }}
                                    >
                                      <Ruler className="size-3.5" aria-hidden />
                                      Prevzemi ≈ {computed.toFixed(1).replace('.', ',')} cm
                                    </Button>
                                  ) : null}
                                  {/* R471 (F4): MERA Z AR GLOBINO — samo, ko naprava DEJANSKO podpira
                                      immersive-ar (issue §0); drugače gumba preprosto ni. */}
                                  {depthSupport?.supported === true ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8"
                                      disabled={depthBusy}
                                      aria-label={`Izmeri ${a.label} z AR globino (dva tapa v AR pogledu)`}
                                      onClick={() => { void runDepthMeasure(a.label) }}
                                    >
                                      {depthBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ScanLine className="size-3.5" aria-hidden />}
                                      {depthBusy ? (depthTaps > 0 ? `Točka ${depthTaps}/2 …` : 'AR seja …') : 'AR globina'}
                                    </Button>
                                  ) : null}
                                  <span id={`scene-measure-${i}-help`} className="sr-only">
                                    Vnesite z merilnim trakom ali laserjem izmerjeno dolžino te osi v centimetrih.
                                  </span>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}

                      {/* R471 (F4): zmožnost AR globine — pošteno sporočilo o senzorju
                          (podprto / zakaj ne); mere ostanejo možne tudi brez njega. */}
                      <div className="mt-2 rounded border bg-secondary/30 px-2 py-1.5">
                        <p className="text-[11px] font-medium">AR globina (senzor)</p>
                        {depthSupport == null ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Preverjam podporo senzorja globine …</p>
                        ) : depthSupport.supported ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            Podprta prek WebXR/ARCore — gumb „AR globina“ pri osi odpre AR mero z dvema tapoma; rezultat se zapiše z metodo „AR globina“ in manifestom senzorja.
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">{depthSupport.reason}</p>
                        )}
                      </div>

                      {/* referenčna skala: ena znana dolžina → izračun ostalih osi */}
                      {selectedAxes.length >= 1 ? (
                        <div className="mt-2 rounded border bg-secondary/30 px-2 py-1.5">
                          <p className="text-[11px] font-medium">Referenca za oceno ostalih osi (neobvezno)</p>
                          <div className="mt-1 flex flex-wrap items-end gap-1.5">
                            <div className="space-y-0.5">
                              <Label htmlFor="scene-ref-axis" className="text-[10px]">Referenčna os</Label>
                              <Select value={refAxisIdx} onValueChange={setRefAxisIdx}>
                                <SelectTrigger id="scene-ref-axis" className="h-8 w-44 text-xs"><SelectValue placeholder="izberi os" /></SelectTrigger>
                                <SelectContent>
                                  {selectedAxes.map((a, i) => (
                                    <SelectItem key={`ref-${i}`} value={String(i)}>{a.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-0.5">
                              <Label htmlFor="scene-ref-cm" className="text-[10px]">Znana dolžina (cm)</Label>
                              <Input
                                id="scene-ref-cm"
                                inputMode="decimal"
                                className="h-8 w-24 text-xs"
                                placeholder="cm"
                                value={refCmInput}
                                onChange={(e) => { setRefCmInput(e.target.value) }}
                                aria-describedby="scene-ref-help"
                              />
                            </div>
                            <span id="scene-ref-help" className="sr-only">
                              Izberite os, katere dejansko dolžino poznate (npr. širina stopnice), in jo vnesite — ostale osi nato dobijo oceno iz kalibrirane fotografije.
                            </span>
                          </div>
                          {refAxis != null ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Skala aktivna — ocene so označene kot „kalibrirana fotografija“ in ostanejo OCENA, dokler jih ne potrdite z izmero.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {/* konsolidirane mere z metodo + konflikti (§5.6) */}
                      {selectedMeasures.length > 0 ? (
                        <div className="mt-2">
                          <p className="text-[11px] font-medium">Zabeležene mere</p>
                          <ul className="mt-1 space-y-1">
                            {selectedMeasures.map((m) => (
                              <li key={m.label} className={`rounded border px-2 py-1 ${m.conflict ? 'border-destructive/50 bg-destructive/5' : 'bg-secondary/30'}`}>
                                <div className="flex flex-wrap items-center justify-between gap-1">
                                  <span className="font-medium">{m.label}</span>
                                  <span className="font-semibold">{m.valueCm.toFixed(1).replace('.', ',')} cm</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                  metoda: {MEASURE_METHOD_TEXT[m.method]}
                                  {m.toleranceCm != null ? ` · ±${m.toleranceCm.toFixed(1).replace('.', ',')} cm` : ''}
                                  {m.count > 1 ? ` · ${m.count} mere (razpon ${m.spreadPct.toFixed(1).replace('.', ',')} %)` : ''}
                                </p>
                                {m.conflict ? (
                                  <p className="text-[10px] font-medium text-destructive">
                                    Konflikt: mere istega naziva odstopajo — preverite na objektu.
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* R470 (issue #8 §5 „Osebe“): figura SAMO za razumevanje zakritja —
                      brez identifikacije, brez mer na osebi, ne persistira se. */}
                  {sceneSelected.cls === 'OSEBA' ? (
                    <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
                      <p className="font-semibold">Morebitna oseba (ocena iz gibanja in oblike)</p>
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        <li>{personHeightNote(sceneSelected)}</li>
                        <li>Namen zaznave je samo razumevanje zakritja merilnih točk — brez identifikacije oseb.</li>
                        <li>Ta zaznava se ne shrani v posnetek (zasebnost).</li>
                        <li>Počakajte na prost kader ali označite merilne točke ročno.</li>
                      </ul>
                    </div>
                  ) : null}

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="scene-cls" className="text-xs">Razred</Label>
                      <Select
                        value={sceneSelected.cls}
                        onValueChange={(v) => {
                          const cls = v as SceneClass
                          setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                            elementId: sceneSelected.id,
                            cls,
                            by: user?.name ?? 'monter',
                            at: Date.now(),
                          }])
                          toast({ title: 'Popravek razreda zabeležen.', description: `Nov razred: ${cls}. Shrani se z zajemom AR posnetka.` })
                        }}
                      >
                        <SelectTrigger id="scene-cls" className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SCENE_CLASSES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="scene-kind" className="text-xs">Vrsta podlage {sceneSelected.cls !== 'PODLAGA' ? '(samo za podlago)' : ''}</Label>
                      <Select
                        value={sceneSelected.kind ?? undefined}
                        disabled={sceneSelected.cls !== 'PODLAGA' && sceneSelected.cls !== 'TLA'}
                        onValueChange={(v) => {
                          const kind = v as SurfaceKind
                          setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                            elementId: sceneSelected.id,
                            kind,
                            by: user?.name ?? 'monter',
                            at: Date.now(),
                          }])
                          toast({ title: 'Popravek podlage zabeležen.', description: `Vrsta: ${kind}.` })
                        }}
                      >
                        <SelectTrigger id="scene-kind" className="h-9"><SelectValue placeholder="neznana" /></SelectTrigger>
                        <SelectContent>
                          {SURFACE_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setSceneSelectedId(null)}>Zapri</Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* R454: rezultat AI analize prizora */}
          {analysis ? (
            <Card>
              <CardContent className="space-y-3 p-4 sm:p-6">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                    <Lightbulb className="size-4 text-roksal-amber" aria-hidden /> AI analiza prizora
                  </h2>
                  <Button variant="ghost" size="icon" className="size-8" aria-label="Zapri analizo" onClick={() => setAnalysis(null)}>
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
                {analysis.scene ? <p className="text-sm font-medium">{analysis.scene}</p> : null}
                {analysis.placement.length > 0 ? (
                  <ul className="space-y-2">
                    {analysis.placement.map((p, i) => (
                      <li key={i} className="rounded-lg border bg-secondary/40 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{p.label}</span>
                          {p.estLenCm != null ? (
                            <Badge variant="outline" className="border-roksal-amber/40 text-roksal-amber">
                              ≈ {(p.estLenCm / 100).toFixed(1).replace('.', ',')} m
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-muted-foreground">{p.where}</p>
                        {p.note ? <p className="mt-1 text-xs italic text-muted-foreground">{p.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {analysis.obstacles.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ovire</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                      {analysis.obstacles.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                  </div>
                ) : null}
                {analysis.references.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reference za oceno mer</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                      {analysis.references.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Predlogi so pomoč pri odločitvi — veljavne mere vedno preverite z izmero.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/* R454: zgodovina AR posnetkov */}
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <History className="size-4 text-roksal-amber" aria-hidden /> Zgodovina AR posnetkov
          </h2>

          {snapshots.loading ? (
            <LoadingRows rows={3} />
          ) : snapshots.error ? (
            <ErrorBox error={snapshots.error} />
          ) : (snapshots.data?.data ?? []).length === 0 ? (
            <EmptyState
              title="Ni AR posnetkov"
              desc="Zajemite prvi posnetek iz AR predogleda — shranili se bodo tukaj s fotografijo, nastavitvami in morebitno AI analizo."
            />
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {(snapshots.data?.data ?? []).map((row) => (
                <div key={row.id} className="rounded-lg border">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {row.scene || row.note || 'AR posnetek'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString('sl-SI')}
                        {row.author ? ` · ${row.author.name}` : ''}
                        {row.project ? ` · ${row.project.code}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-9" onClick={() => void viewSnapshot(row)} disabled={detailBusy && detail?.row.id !== row.id}>
                        {detailBusy && detail?.row.id !== row.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                        {detail?.row.id === row.id ? 'Skrij' : 'Ogled'}
                      </Button>
                      {canWrite ? (
                        <Button variant="ghost" size="icon" className="size-9 text-destructive hover:text-destructive"
                          aria-label="Izbriši AR posnetek" onClick={() => void deleteSnapshot(row.id)} disabled={deleting === row.id}>
                          {deleting === row.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {/* podrobnost: fotografija + analiza */}
                  {detail?.row.id === row.id ? (
                    <div className="grid gap-3 border-t p-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                      {detail.photo ? (
                        <div className="space-y-1.5">
                          {/* R485 (§1): relativni ovoj — živi predogled bboxa ročne
                              oznake čez fotografijo posnetka (isti števci 0..1). */}
                          <div className="relative">
                            <img src={detail.photo} alt={`AR posnetek — ${row.scene ?? 'brez opisa'}`} className="w-full rounded-lg border" />
                            {detailTagOpen && detailBBox != null ? (
                              <div
                                className="pointer-events-none absolute rounded-md border-2 border-dashed border-roksal-amber bg-roksal-amber/10"
                                style={{
                                  left: `${Math.round(detailBBox[0] * 100)}%`,
                                  top: `${Math.round(detailBBox[1] * 100)}%`,
                                  width: `${Math.round(detailBBox[2] * 100)}%`,
                                  height: `${Math.round(detailBBox[3] * 100)}%`,
                                }}
                                aria-hidden
                              />
                            ) : null}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-full text-xs"
                            onClick={() => downloadPng(detail.photo as string, `ar-posnetek-${row.id.slice(0, 8)}.png`)}
                          >
                            <Download className="size-3.5" aria-hidden /> Prenesi PNG
                          </Button>
                        </div>
                      ) : (
                        <p className="self-center text-xs text-muted-foreground">Posnetek ne vsebuje fotografije.</p>
                      )}
                      <div className="space-y-2 text-sm">
                        {row.note && row.note !== (row.scene ?? '') ? <p className="text-muted-foreground">{row.note}</p> : null}
                        {detail.analysis ? (
                          <>
                            <ul className="space-y-1.5">
                              {detail.analysis.placement.map((p, i) => (
                                <li key={i} className="rounded-md border bg-secondary/40 p-2">
                                  <span className="font-semibold">{p.label}</span>
                                  {p.estLenCm != null ? <span className="ml-2 text-xs text-roksal-amber">≈ {(p.estLenCm / 100).toFixed(1).replace('.', ',')} m</span> : null}
                                  <p className="text-xs text-muted-foreground">{p.where}</p>
                                </li>
                              ))}
                            </ul>
                            {detail.analysis.obstacles.length > 0 ? (
                              <p className="text-xs text-muted-foreground"><span className="font-semibold">Ovire:</span> {detail.analysis.obstacles.join(' · ')}</p>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">Posnetek je bil zajet brez AI analize prizora.</p>
                        )}
                      </div>

                      {/* R485 (issue #8 §1/§9): ZAZNAVE PRIZORA na posnetku —
                          seznam displayed elementov (GET scene-element) + ROČNA
                          OZNAKA prek POST scene-element (vir ROCNO; OSEBA na
                          strežniku zavrnjena — zasebnost §5). */}
                      {detail.elements != null ? (
                        <div className="border-t p-3 md:col-span-2">
                          <div className="rounded-lg border">
                            <p className="flex items-center justify-between border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                              <span>Zaznave prizora</span>
                              <span className="font-semibold" aria-label={`${detail.elements.length} elementov`}>{detail.elements.length}</span>
                            </p>
                            {detail.elements.length === 0 ? (
                              <p className="p-3 text-sm text-muted-foreground">
                                Posnetek ne vsebuje zaznav — zajet je bil, preden je razumevanje prizora našlo elemente.
                              </p>
                            ) : (
                              <ul className="max-h-72 divide-y overflow-y-auto pr-1" aria-label="Zaznave prizora na posnetku">
                                {detail.elements.map((el) => (
                                  <li key={el.id}><SceneElementRow el={el} /></li>
                                ))}
                              </ul>
                            )}
                            {canWrite ? (
                              <div className="border-t p-3">
                                {detailTagOpen ? (
                                  <ManualTagForm
                                    onSubmit={(v) => { void addManualElementToSnapshot(v) }}
                                    onCancel={() => { setDetailTagOpen(false); setDetailBBox(null) }}
                                    busy={detailTagBusy}
                                    onBBoxChange={handleDetailBBox}
                                    helpNote="Oznaka se takoj zapiše na posnetek (vir: ročno — ROCNO) in je takoj vidna v seznamu. OSEBA ni na voljo (zasebnost)."
                                  />
                                ) : (
                                  <Button variant="outline" size="sm" aria-expanded={detailTagOpen} onClick={() => { setDetailTagOpen(true); setDetailBBox(MANUAL_BBOX_DEFAULT) }}>
                                    <Plus className="size-3.5" aria-hidden /> Dodaj oznako ročno
                                  </Button>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── R485 (issue #8 §9 :137): VRSTICA ELEMENTA — tapljivi seznam (PREGLED) ──
// Ista vrstica za živi PREGLED in zaznave posnetka: ikona/razred, opomba,
// status chip, zaupanje, mere če so, vir. Tap → obstoječi tap-detail.

function SceneElementRow ({ el, selected, onSelect }: {
  el: SceneElement
  selected?: boolean
  onSelect?: (el: SceneElement) => void
}): React.ReactElement {
  const Icon = SCENE_CLS_ICON[el.cls]
  const color = SCENE_CLS_COLOR[el.cls]
  const measures = el.cls === 'OSEBA' ? [] : consolidateMeasures(el.measures ?? [])
  const name = el.cls === 'OSEBA' ? 'Morebitna oseba' : SCENE_CLS_LABEL[el.cls]
  return (
    <button
      type="button"
      className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-roksal-amber ${selected ? 'bg-secondary/60' : ''}`}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${name}${el.label ? `, opomba: ${el.label}` : ''} — ${SCENE_STATUS_TEXT[el.status]}, zaupanje ${Math.round(el.confidence * 100)} %, vir: ${el.source === 'ROCNO' ? 'ročno' : el.source === 'VLM' ? 'AI predlog' : 'lokalna hevristika'}`}
      onClick={onSelect != null ? () => { onSelect(el) } : undefined}
    >
      <Icon className="size-4 shrink-0" style={{ color }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {el.label ? <span className="truncate text-xs italic text-muted-foreground">„{el.label}“</span> : null}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] leading-snug text-muted-foreground">
          <span>{el.source === 'ROCNO' ? 'ročno potrjeno' : el.source === 'VLM' ? 'AI predlog' : 'lokalna hevristika'}</span>
          <span aria-hidden>·</span>
          <span>zaupanje {Math.round(el.confidence * 100)} %</span>
          {measures.length > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className="font-semibold text-foreground">
                ≈ {measures[0].valueCm.toFixed(1).replace('.', ',')} cm{measures.length > 1 ? ` (+${measures.length - 1})` : ''}
              </span>
            </>
          ) : null}
        </span>
      </span>
      <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">{SCENE_STATUS_TEXT[el.status]}</Badge>
    </button>
  )
}

// ─── R485 (issue #8 §1): OBRAZEC ROČNE OZNAKE — razred iz belenga seznama ────
// BREZ OSEBA (zasebnost §5 — enak seznam kot POST scene-element na strežniku),
// bbox kot 4 števci 0..1 (x, y, širina, višina — delež kadra) z živim
// predogledom pravokotnika (onBBoxChange) in neobvezno opombo (≤ 60 znakov).

interface ManualTagValues {
  cls: SceneClass
  bbox: [number, number, number, number]
  label: string
}

function parseBBoxPart (raw: string): number | null {
  const v = Number(raw.replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null
}

function ManualTagForm ({ onSubmit, onCancel, busy = false, onBBoxChange, helpNote }: {
  onSubmit: (v: ManualTagValues) => void
  onCancel: () => void
  busy?: boolean
  onBBoxChange?: (bbox: [number, number, number, number] | null) => void
  helpNote?: string
}): React.ReactElement {
  const [cls, setCls] = useState<SceneClass>('NEZNANO')
  const [bx, setBx] = useState(MANUAL_BBOX_DEFAULT_STR.x)
  const [by, setBy] = useState(MANUAL_BBOX_DEFAULT_STR.y)
  const [bw, setBw] = useState(MANUAL_BBOX_DEFAULT_STR.w)
  const [bh, setBh] = useState(MANUAL_BBOX_DEFAULT_STR.h)
  const [label, setLabel] = useState('')

  const x = parseBBoxPart(bx)
  const y = parseBBoxPart(by)
  const w = parseBBoxPart(bw)
  const h = parseBBoxPart(bh)
  const bbox: [number, number, number, number] | null =
    x != null && y != null && w != null && h != null && w > 0 && h > 0
      ? [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(w * 1000) / 1000, Math.round(h * 1000) / 1000]
      : null

  function updateBBox (next: Partial<Record<'x' | 'y' | 'w' | 'h', string>>): void {
    const vals = { x: bx, y: by, w: bw, h: bh, ...next }
    const nx = parseBBoxPart(vals.x); const ny = parseBBoxPart(vals.y)
    const nw = parseBBoxPart(vals.w); const nh = parseBBoxPart(vals.h)
    onBBoxChange?.(nx != null && ny != null && nw != null && nh != null && nw > 0 && nh > 0
      ? [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000, Math.round(nw * 1000) / 1000, Math.round(nh * 1000) / 1000]
      : null)
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-roksal-amber/50 bg-secondary/30 p-3">
      <p className="text-xs font-bold uppercase tracking-wide">Dodaj oznako ročno</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="manual-cls">Razred</Label>
          <Select value={cls} onValueChange={(v) => { setCls(v as SceneClass) }}>
            <SelectTrigger id="manual-cls" aria-label="Razred ročno dodane oznake">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {MANUAL_CLASSES.map((c) => (
                <SelectItem key={c} value={c}>{c === 'NEZNANO' ? 'NEZNANO (razred določite kasneje)' : c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="manual-label">Opomba (neobvezno, do 60 znakov)</Label>
          <Input
            id="manual-label"
            value={label}
            maxLength={SCENE_LABEL_MAX}
            onChange={(e) => { setLabel(e.target.value) }}
            placeholder="npr. vogal terase"
          />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-medium" id="manual-bbox-label">
          Položaj v kadru (0..1): levo X · zgoraj Y · širina W · višina H — delež kadra
        </p>
        <div className="grid grid-cols-4 gap-2" role="group" aria-labelledby="manual-bbox-label">
          <div className="space-y-1">
            <Label htmlFor="manual-bx" className="text-[10px]">X</Label>
            <Input id="manual-bx" inputMode="decimal" className="h-8 text-xs" value={bx}
              aria-label="Bbox X — levi rob (0..1)"
              onChange={(e) => { setBx(e.target.value); updateBBox({ x: e.target.value }) }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="manual-by" className="text-[10px]">Y</Label>
            <Input id="manual-by" inputMode="decimal" className="h-8 text-xs" value={by}
              aria-label="Bbox Y — zgornji rob (0..1)"
              onChange={(e) => { setBy(e.target.value); updateBBox({ y: e.target.value }) }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="manual-bw" className="text-[10px]">W</Label>
            <Input id="manual-bw" inputMode="decimal" className="h-8 text-xs" value={bw}
              aria-label="Bbox W — širina (0..1)"
              onChange={(e) => { setBw(e.target.value); updateBBox({ w: e.target.value }) }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="manual-bh" className="text-[10px]">H</Label>
            <Input id="manual-bh" inputMode="decimal" className="h-8 text-xs" value={bh}
              aria-label="Bbox H — višina (0..1)"
              onChange={(e) => { setBh(e.target.value); updateBBox({ h: e.target.value }) }} />
          </div>
        </div>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        {helpNote ?? 'Oznaka se zapiše z virom ROCNO in shrani z zajemom AR posnetka. OSEBA ni na voljo (zasebnost — živa zaznava oseb se ne persistira).'}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Prekliči</Button>
        <Button
          size="sm"
          disabled={busy || bbox == null}
          onClick={() => { if (bbox != null) onSubmit({ cls, bbox, label: label.trim().slice(0, SCENE_LABEL_MAX) }) }}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
          Dodaj oznako
        </Button>
      </div>
    </div>
  )
}

// ─── SVG ograja za AR overlay (eksplicitne barve — samostojen data URL) ──────

function ArRailingSvg ({ ref, posts, heightCm }: { ref?: Ref<SVGSVGElement>; posts: number; heightCm: number }) {
  const baseY = 200
  const hPx = Math.min(158, Math.max(48, heightCm * 0.72))
  const x0 = 18
  const x1 = OVERLAY_W - 18
  const postW = 9
  const xs = Array.from({ length: posts }, (_, i) => x0 + (i * (x1 - x0 - postW)) / Math.max(1, posts - 1))

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${OVERLAY_W} ${OVERLAY_H}`}
      width={OVERLAY_W}
      height={OVERLAY_H}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>AR ograja</title>
      {/* mehka senca */}
      <ellipse cx={OVERLAY_W / 2} cy={baseY + 5} rx={(x1 - x0) / 2 + 8} ry="7" fill="rgba(0,0,0,0.28)" />
      {/* polnilo — navpične palice */}
      {xs.slice(0, -1).map((px, i) => {
        const nx = xs[i + 1]
        const w = nx - px - postW - 3
        if (w <= 3) return null
        const count = Math.max(2, Math.round(w / 11))
        return (
          <g key={`p-${i}`}>
            {Array.from({ length: count }).map((_, j) => (
              <rect
                key={j}
                x={px + postW + 2 + (j * (w - 4)) / Math.max(1, count - 1)}
                y={baseY - hPx + 13}
                width="3.5"
                height={hPx - 21}
                fill={ANTHRACITE}
                opacity="0.92"
                rx="1"
              />
            ))}
          </g>
        )
      })}
      {/* srednja palica */}
      <rect x={x0 - 3} y={baseY - hPx * 0.55} width={x1 - x0 + 6} height="5" fill={ANTHRACITE} rx="2" />
      {/* stebri */}
      {xs.map((px, i) => (
        <rect key={`s-${i}`} x={px} y={baseY - hPx} width={postW} height={hPx} fill={ANTHRACITE} rx="2" />
      ))}
      {/* ročnik */}
      <rect x={x0 - 5} y={baseY - hPx - 8} width={x1 - x0 + 10} height="8" fill={ANTHRACITE} rx="3" />
    </svg>
  )
}

// ─── SVG ograja IZ TEKAČA (R465 — več segmentov po realni geometriji) ──────
// Segmenti (R460 engine) se narišejo sorazmerno dolžinam; višine, stebri,
// vrata (toKind=VRATA) in vogali (toKind=VOGAL) iz segmentnih podatkov.
// Eksplicitne barve — samostojen data URL za zajem na canvas.

function ArRunRailingSvg ({ ref, segments, fallbackHeightCm }: {
  ref?: Ref<SVGSVGElement>
  segments: RunSegmentRow[]
  fallbackHeightCm: number
}) {
  const baseY = 200
  const postW = 9
  const x0 = 14
  const x1 = OVERLAY_W - 14
  const usable = x1 - x0
  const totalCm = Math.max(1, segments.reduce((a, s) => a + Math.max(1, s.lengthCm), 0))
  const segWidth = (s: RunSegmentRow): number => Math.max(8, (Math.max(1, s.lengthCm) / totalCm) * usable)

  // razporeditev segmentov po dolžini (sorazmerno) — brez mutacij
  const drawn = segments.map((s, i) => ({
    s,
    x: x0 + segments.slice(0, i).reduce((a, p) => a + segWidth(p), 0),
    w: segWidth(s),
  }))

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${OVERLAY_W} ${OVERLAY_H}`}
      width={OVERLAY_W}
      height={OVERLAY_H}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>AR ograja — segmenti tekača</title>
      {/* mehka senca */}
      <ellipse cx={OVERLAY_W / 2} cy={baseY + 5} rx={usable / 2 + 6} ry="7" fill="rgba(0,0,0,0.28)" />
      {drawn.map(({ s, x: sx, w }, i) => {
        const hPx = Math.min(158, Math.max(48, (s.heightCm ?? fallbackHeightCm) * 0.72))
        const jeVrata = s.toKind === 'VRATA'
        const posts = Math.max(2, Math.max(0, s.posts) + 2) // robna stebra + vmesni
        const postXs = Array.from({ length: posts }, (_, j) => sx + (j * (w - postW)) / (posts - 1))
        return (
          <g key={`seg-${i}`}>
            {/* polnilo — navpične palice (ob vratah pusti odprtino na koncu) */}
            {postXs.slice(0, -1).map((px, j) => {
              const nx = postXs[j + 1]
              const gateGap = jeVrata && j >= postXs.length - 3
              const barW = nx - px - postW - 2
              if (gateGap || barW <= 3) return null
              const count = Math.max(2, Math.round(barW / 11))
              return (
                <g key={`b-${i}-${j}`}>
                  {Array.from({ length: count }).map((_, k) => (
                    <rect
                      key={k}
                      x={px + postW + 1 + (k * (barW - 3)) / Math.max(1, count - 1)}
                      y={baseY - hPx + 13}
                      width="3.5"
                      height={hPx - 21}
                      fill={ANTHRACITE}
                      opacity="0.92"
                      rx="1"
                    />
                  ))}
                </g>
              )
            })}
            {/* srednja palica + ročnik po višini segmenta */}
            <rect x={sx} y={baseY - hPx * 0.55} width={w} height="5" fill={ANTHRACITE} rx="2" />
            <rect x={sx - 1} y={baseY - hPx - 8} width={w + 2} height="8" fill={ANTHRACITE} rx="3" />
            {/* stebri */}
            {postXs.map((px, j) => (
              <rect key={`p-${i}-${j}`} x={px} y={baseY - hPx} width={postW} height={hPx} fill={ANTHRACITE} rx="2" />
            ))}
            {/* vrata: odprtina z lokom */}
            {jeVrata ? (
              <g>
                <path
                  d={`M ${sx + w - 26} ${baseY - hPx - 4} A 22 22 0 0 1 ${sx + w - 2} ${baseY - hPx - 4}`}
                  fill="none"
                  stroke="#f5f5f4"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <text x={sx + w - 14} y={baseY - hPx - 10} textAnchor="middle" fontSize="8" fontWeight="700" fill="#f5f5f4">VRATA</text>
              </g>
            ) : null}
            {/* vogal: oznaka kota */}
            {s.toKind === 'VOGAL' ? (
              <text x={sx + w - 3} y={baseY + 14} textAnchor="end" fontSize="7.5" fontWeight="700" fill="#f5f5f4">
                {s.angleDeg != null ? `${Math.round(s.angleDeg)}°` : 'vogal'}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

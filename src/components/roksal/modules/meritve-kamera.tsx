'use client'

// MERITVE S KAMERO (issue #1) — večtočkovne meritve na fotografiji:
// zajem/nalaganje fotografije → označevanje točk → kalibracija merila →
// izračun dolžin/kotov/višin v živo → VLM samodejna zaznava → potrditev in
// shranjevanje v projekt/nalog (POST /api/measurement/confirm).
// Več meritev na isti fotografiji; ročni obrazec v meritve.tsx ostane fallback.
// R439 (issue #6): brez signala — gumb 'Shrani (offline)' v fazi potrditve
// (compressImage → photos shramba + op 'foto' z merilnimi podatki; izbor
// nalogov pade na predpomnjene vrstice).
//
// R455 (issue #10 — PROFESIONALNE KAMERNE MERITVE):
//   • 5-fazni profesionalni tok: ZAJEM → KALIBRACIJA → MERITEV → PREVERJANJE →
//     POTRDITEV (jasen status na vsakem koraku, §4);
//   • kakovost zajema: analiza svetlosti/ostrosti kadra (canvas) + opozorila
//     DOBRO/OPOZORILO (§2, §4);
//   • vodila v živem predogledu kamere (mreža + vodoravnica + središče, §4);
//   • vlečenje točk (premik) + povečevalno steklo za natančno postavitev (§1, §4);
//   • undo/redo celotnega urejanja (§4);
//   • zaklep kalibracije (§4);
//   • VLM predlogi točk so VIZUALNO LOČENI (PREDLOG) in ne štejejo v izračun,
//     dokler jih monter ne sprejme — avtomatika je predlog, ne avtoriteta (§1, §2);
//   • več pogledov (do 4 fotografije istega objekta) s primerjavo ocen,
//     povprečjem, razpršenostjo in stopnjo zaupanja (§3);
//   • ročni popravek dolžine z obveznim razlogom — sledljivost (§1);
//   • potrditev pošlje views/quality/confidence/manualOverride na strežnik,
//     ki ji zapiše v params + verzijo + revizijo (issue #10 §5–§7).
//
// R457 (issue #12 — VRHUNSKI MERILNI ENGINE):
//   • adaptivni načini izmere (§2): OGRAJA | KERAMIKA | STREHA | FASADA |
//     STOPNICE | PROSTOR | SPLOSNO — vsak s svojim vodilom in pravili;
//   • Smart Capture Guide (§3): ostrost/svetloba/nagib/referenca/pokritost —
//     DOBRO / OPOZORILO / NEZADOSTNO (faza kalibracije);
//   • profesionalna kalibracija (§4): 5 metod + referenčni objekt (meta v params);
//   • zmogljivosti naprave (§16) + priporočena metoda (§18 provider-agnostic);
//   • kanonična analiza engine-a v fazi PREVERJANJE (POST
//     /api/measure-engine/analyze): geometrija + §14 validacija + §13 confidence
//     + §8–§11 domenski paket (ograje/keramika/streha/fasada/stopnice/prostor);
//   • potrditev nosi mode + engine rezultat (params.mode/params.engine);
//   • izvoz CSV/JSON potrjene meritve (GET /api/measure-engine/export, §19).

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Camera, Check, CloudUpload, Cpu, Crosshair, Eraser, FileJson, FileSpreadsheet, Grid3x3, Image as ImageIcon, Loader2, Lock, LockOpen,
  Redo2, Ruler, Sparkles, SquarePlus, Trash2, Undo2, WifiOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { apiPost, fmtDate, useApi } from '@/lib/api-client'
import { getCachedNalogi, queuePhoto, useOnline } from '@/lib/offline'
import { clearDraft, loadDraft, saveDraft, type MeasureDraft, type MeasureDraftSnapshot } from '@/lib/measure-draft'
import { useAppStore } from '@/lib/store'
import {
  CALIB_METHODS, MEASURE_MODES, MEASUREMENT_STATUS_LABELS, MODE_RULES, captureGuide, computeGeometry,
  detectDeviceCaps, measurementStatusAllowsBusiness, recommendMethod, resolveScale,
  type AnalyzeResult, type CalibrationMethod, type DeviceCaps, type DomainOptions, type MeasureMode,
  type MeasurementStatus, type ScaleModel,
} from '@/lib/measure-engine'
import { EmptyState, ErrorBox } from '@/components/roksal/ui-bits'
import SceneOverlay from '@/components/roksal/scene-overlay'
import { useSceneUnderstanding } from '@/hooks/use-scene-understanding'

interface Pt { x: number; y: number; label?: string; src?: 'ROCNO' | 'PREDLOG' }
interface PhotoRow {
  id: string; type: string; location: string | null; params: string | null; createdAt: string
  project: { code: string } | null
}
interface ProjectOption { id: string; code: string; title: string }
interface WorkOrderOption { id: string; code: string; title: string }
// R439: predpomnjena vrstica naloga (offline izbor v kameri)
interface CachedWoRow { id: string; code: string; title: string }

/** R455: kakovost zajema — izračun na odjemalcu (advisory, §2/§4). */
interface Quality {
  brightness: number // povprečna svetlost 0..255
  blurScore: number // variacija Laplace-ovega jedra (višje = ostreje)
  dark: boolean
  bright: boolean
  blurry: boolean
  ok: boolean
}

/** R455: en pogled (fotografija istega objekta) s svojimi točkami in kalibracijo. */
interface View {
  key: number
  photoId: string | null
  dataUrl: string
  imgW: number
  imgH: number
  quality: Quality | null
  points: Pt[]
  calib: { px: number; cm: number } | null
  calibLocked: boolean
}

const MAX_IMG_W = 1600
const MAX_VIEWS = 4
/** Prag variacije Laplacea pod katerim sliko ocenimo kot mehko (iz prakse, advisory). */
const BLUR_THRESHOLD = 45

const PHASES = ['Zajem', 'Kalibracija', 'Meritev', 'Preverjanje', 'Potrditev'] as const

/** Zmanjša sliko na max širino in vrne JPEG dataUrl. */
async function shrinkToDataUrl (dataUrl: string): Promise<string> {
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_IMG_W / img.naturalWidth)
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => resolve(dataUrl) // če gre kaj narobe, pošljemo izvirnik
    img.src = dataUrl
  })
}

/**
 * R455: analiza kakovosti kadra (§2/§4) — svetlost (povprečna luma) in ostrost
 * (variacija Laplace-ovega jedra na pomanjšani sliki). Čisto odjemalčeva,
 * advisory ocena: opozori na temo/presočje/mehkost, ne blokira toka.
 */
async function analyzeQuality (dataUrl: string): Promise<Quality | null> {
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const w = 240
        const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w)) || 1
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, w, h)
        const d = ctx.getImageData(0, 0, w, h).data
        const gray = new Float32Array(w * h)
        let sum = 0
        for (let i = 0; i < w * h; i++) {
          const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
          gray[i] = g; sum += g
        }
        const brightness = sum / (w * h)
        // Laplace (4-sosed) variacija — standardna hevristika za ostrost
        let lapSum = 0; let lapSq = 0; let n = 0
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x
            const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
            lapSum += lap; lapSq += lap * lap; n++
          }
        }
        const variance = n > 0 ? lapSq / n - (lapSum / n) ** 2 : 0
        const blurScore = Math.max(0, Math.min(10000, Math.round(variance)))
        const dark = brightness < 45
        const bright = brightness > 225
        const blurry = blurScore < BLUR_THRESHOLD
        resolve({ brightness: Math.round(brightness), blurScore, dark, bright, blurry, ok: !dark && !bright && !blurry })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

function parsePhoto (params: string | null): string | null {
  if (!params) return null
  try {
    const p = JSON.parse(params) as { photo?: unknown }
    return typeof p.photo === 'string' && p.photo.startsWith('data:image/') ? p.photo : null
  } catch { return null }
}

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',')

/** R500 (issue #15 faza 1): kako monterju poveljemo, katera količina meritve je
 *  dokazana in katera je predpostavka (veljavnost po količinah). */
const KOLICINA_LABEL: Record<'DOLZINA' | 'PLOSCEVINA' | 'KOT' | 'VISINA', string> = {
  DOLZINA: 'Dolžina', PLOSCEVINA: 'Površina', KOT: 'Koti', VISINA: 'Višina',
}
const KOLICINA_STATE_LABEL: Record<'VELJAVNA' | 'PREDPOSTAVKA' | 'NEZADOSTNI_PODATKI', string> = {
  VELJAVNA: 'dokazano', PREDPOSTAVKA: 'predpostavka', NEZADOSTNI_PODATKI: 'manjka podatek',
}

/** R455: izračun dolžin segmentov za en pogled (točke + kalibracija).
 *  R501 (issue #15 faza 2): cm-vrednosti niso več LASTNA delitev `cm / px` —
 *  merilo in geometrijo vrne ENOTNO jedro (`computeGeometry`/`resolveScale`),
 *  UI sam šteje samo piksle (prikaz, ko kalibracije še ni). S tem monter v
 *  živi predogledu vidi ISTO število kot strežnik ob potrditvi. */
interface CalcSeg { i: number; j: number; pxLen: number; cmLen: number | null; angleDeg: number; dVCm: number | null }
interface CalcResult { pts: Pt[]; segs: CalcSeg[]; totalPx: number; totalCm: number | null; cmPerPx: number | null; scale: ScaleModel }

function calcView (view: View): CalcResult {
  const pts = view.points.filter((p) => p.src !== 'PREDLOG') // predlogi ne štejejo (§2)
  const geo = computeGeometry(pts, view.calib ? { px: view.calib.px, cm: view.calib.cm, imgW: view.imgW, imgH: view.imgH } : null)
  const segs: CalcSeg[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]; const b = pts[i + 1]
    const dx = (b.x - a.x) * view.imgW; const dy = (b.y - a.y) * view.imgH
    const g = geo.segments[i] // jedro vrne segmente v istem vrstnem redu kot pts
    segs.push({
      i, j: i + 1,
      pxLen: Math.hypot(dx, dy),
      cmLen: g ? g.lengthCm : null,
      angleDeg: g ? g.angleDeg : Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10,
      dVCm: g ? g.heightDiffCm : null,
    })
  }
  const totalPx = segs.reduce((s, x) => s + x.pxLen, 0)
  return { pts, segs, totalPx, totalCm: geo.scale.known ? geo.totalLengthCm : null, cmPerPx: geo.cmPerPx, scale: geo.scale }
}

/** Rezultat brez pogleda — aktivne fotografije še ni (isti tip kot `calcView`). */
const CALC_PRAZEN: CalcResult = { pts: [], segs: [], totalPx: 0, totalCm: null, cmPerPx: null, scale: resolveScale(null) }

/** R501 (issue #15 faza 2): pošteno besedilo o merilu, zloženo iz ENOTNEGA
 *  modela merila (`ScaleModel`) — monter vidi, katera količina je dokazana in
 *  katera je predpostavka, že v živi predogledu (ne šele na strežniku). */
function merilaPasus (scale: ScaleModel): string {
  if (!scale.known) return 'Merilo ni znano — mere so v pikslih; cm-vrednost še NI izračunana.'
  if (scale.basis === 'ANIZOTROPNO') return `Merilo je dokazano ločeno za X in Y — ${scale.reasons[0] ?? ''}.`
  if (scale.isotropicProven) return `Merilo je dokazano v vseh smereh — ${scale.reasons[0] ?? ''}.`
  return `Merilo je za vse smeri PREDPOSTAVKA — ${scale.reasons[0] ?? ''}`
}

/** R457: domenski rezultat kot vrstice za prikaz/tabelo (§8–§11). */
function domainRows (d: AnalyzeResult['domain']): [string, string][] {
  switch (d.mode) {
    case 'OGRAJA':
      return [
        ['Skupna dolžina', `${fmt1(d.totalLengthCm)} cm`],
        ['Stebri', `${d.posts} kos (razmak ≤ ${d.spacingCm} cm)`],
        ['Ročnik', `${fmt1(d.handrailM)} m`],
        ['Površina polnila', `${fmt1(d.infillM2)} m²`],
        ['Segmentov', String(d.segments.length)],
      ]
    case 'KERAMIKA':
      return [
        ['Bruto površina', `${fmt1(d.areaM2)} m²`],
        ['Odprtine', `${fmt1(d.openingsM2)} m²`],
        ['Neto površina', `${fmt1(d.netAreaM2)} m²`],
        ['Ploščice', `${d.tileWcm}×${d.tileHcm} cm · ${d.pattern.toLowerCase()}`],
        ['Razporeditev', `${d.rows} vrst × ${d.cols} stolpcev`],
        ['Št. ploščic', `${d.tilesCount} kos (rezi ≈ ${d.cuts})`],
        ['Odpad', `${d.wastePct} %`],
        ['Lepak C2', `≈ ${d.adhesiveKg} kg`],
        ['Fuga', `≈ ${d.fugueKg} kg`],
      ]
    case 'STREHA':
      return [
        ['Tloris ploskve', `${fmt1(d.footprintM2)} m²`],
        ['Naklon', `${d.pitchDeg}°`],
        ['Površina ploskve', `${fmt1(d.faceAreaM2)} m²`],
        ['Slemen', `${fmt1(d.ridgeCm)} cm`],
        ['Ostali robovi', `${fmt1(d.eaveCm)} cm`],
        ['Material', `${d.material === 'KOVINSKA' ? 'kovinska' : 'betonska'} kritina · odpad ${d.wastePct} %`],
        ['Material skupaj', `${fmt1(d.materialM2)} m²`],
      ]
    case 'FASADA':
      return [
        ['Bruto površina', `${fmt1(d.grossM2)} m²`],
        ['Odprtine', `${fmt1(d.openingsM2)} m² (${d.openings.reduce((s, o) => s + o.count, 0)} kos)`],
        ['Neto površina', `${fmt1(d.netM2)} m²`],
        ['Obseg', `${fmt1(d.perimeterCm)} cm`],
      ]
    case 'STOPNICE':
      return [
        ['Nagibna dolžina', `${fmt1(d.slopeLengthCm)} cm`],
        ['Višinska razlika', `${fmt1(d.heightDiffCm)} cm`],
        ['Vodoravno', `${fmt1(d.horizontalCm)} cm`],
        ['Nagib', `${d.angleDeg}°`],
        ['Stopnic', String(d.steps)],
        ['Vzpon × čežnost', `${fmt1(d.riseCm)} × ${fmt1(d.runCm)} cm`],
      ]
    case 'PROSTOR':
      return [
        ['Površina', `${fmt1(d.areaM2)} m²`],
        ['Obseg', `${fmt1(d.perimeterCm)} cm`],
        ...d.diagonals.map((x) => [`Diagonala ${x.i + 1}↔${x.j + 1}`, `${fmt1(x.lengthCm)} cm`] as [string, string]),
        ...(d.rectangleOk != null ? ([[d.rectangleOk ? 'Pravokotnost' : 'Pravokotnost', d.rectangleOk ? 'DA — diagonali se ujemata' : 'NE — diagonali odstopata']] as [string, string][]) : []),
      ]
    default:
      return [
        ['Skupna dolžina', `${fmt1(d.totalLengthCm)} cm`],
        ['Segmentov', String(d.segments.length)],
      ]
  }
}

export function KameraMeritevDialog ({ open, onClose, onSaved, initialProjectId, initialWorkOrderId, autoResumeDraft }: {
  open: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
  /** R486 (issue #7 §3): predpolnjen kontekst iz naloga (ZAČNI MERITEV v DANES)
   *  — monter NE izbira projekta/naloga ročno (enostaven privzeti potek). */
  initialProjectId?: string
  initialWorkOrderId?: string
  /** R486: »Nadaljuj nedokončano« iz DANES — osnutek obnovi TAKOJ ob odprtju. */
  autoResumeDraft?: boolean
}) {
  const { toast } = useToast()

  // faza 1..5 (R455: ZAJEM → KALIBRACIJA → MERITEV → PREVERJANJE → POTRDITEV)
  const [phase, setPhase] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [busy, setBusy] = useState(false)
  const [projectId, setProjectId] = useState('none')
  const [workOrderId, setWorkOrderId] = useState('none')
  const [location, setLocation] = useState('')
  const [camActive, setCamActive] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // ── R467 (issue #8 F1): živo razumevanje prizora med zajemom ──
  // R468 (F2 §3): trenutni nagib telefona (roll) za ločitev naklona telefona
  // od naklona tal — ref, da se percepcijska zanka NE restarta ob dogodku.
  const phoneRollRef = useRef<number | null>(null)
  const sceneState = useSceneUnderstanding(videoRef, camActive, {
    getPhoneRollDeg: () => phoneRollRef.current,
  })
  const [guides, setGuides] = useState(true) // R455: vodila v živem predogledu (§4)

  // R455: pogledi (fotografije istega objekta) + aktivni zavihek
  const [views, setViews] = useState<View[]>([])
  const [activeView, setActiveView] = useState(0)
  const viewKey = useRef(1)

  // R455: undo/redo (§4) — posnetki {views, activeView}
  const past = useRef<{ views: View[]; activeView: number }[]>([])
  const future = useRef<{ views: View[]; activeView: number }[]>([])
  const [histTick, setHistTick] = useState(0) // rerender za omogočanje gumbov

  const [calibA, setCalibA] = useState<number | null>(null) // indeks prve točke kalibracije
  const [calibCm, setCalibCm] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [stairMode, setStairMode] = useState(false)
  const [serverLayout, setServerLayout] = useState<string | null>(null)

  // ── R457 (issue #12): način izmere, kalibracijska metoda, engine analiza ──
  const [mode, setMode] = useState<MeasureMode>('OGRAJA')
  const [calibMethod, setCalibMethod] = useState<CalibrationMethod>('MARKER')
  const [refObject, setRefObject] = useState('')
  const [caps, setCaps] = useState<DeviceCaps | null>(null)
  const [maxTilt, setMaxTilt] = useState<number | null>(null)
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  // domenske možnosti (§8–§11)
  const [maxSpanS, setMaxSpanS] = useState('120')
  const [tileW, setTileW] = useState('60')
  const [tileH, setTileH] = useState('60')
  const [jointMm, setJointMm] = useState('3')
  const [pattern, setPattern] = useState<'PRAVOKOTNO' | 'DIAGONALNO'>('PRAVOKOTNO')
  const [pitchDeg, setPitchDeg] = useState('35')
  const [roofMaterial, setRoofMaterial] = useState<'BETONNA' | 'KOVINSKA'>('BETONNA')
  const [stepsS, setStepsS] = useState('')
  const [opW, setOpW] = useState('100')
  const [opH, setOpH] = useState('120')
  const [opCount, setOpCount] = useState('0')

  // faza 5: potrditev + R455 ročni popravek
  const [type, setType] = useState('OGRAJA')
  const [heightS, setHeightS] = useState('100')
  const [note, setNote] = useState('')
  const [overrideOn, setOverrideOn] = useState(false)
  const [overrideLen, setOverrideLen] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  // R487 (issue #3): panel dodajanja pogleda — terenska pot (kamera/datoteka)
  // OSTANE, poleg nje pa izbira obstoječe FOTO projekta (kot za 1. pogled)
  const [addingView, setAddingView] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const fileViewRef = useRef<HTMLInputElement>(null)

  // R455: referenca na vlečenje — vključuje stanje pred vlečenjem (undo)
  const dragRef = useRef<{ view: number; point: number; startX: number; startY: number; moved: boolean; preViews: View[] } | null>(null)
  const [lens, setLens] = useState<{ x: number; y: number; view: number } | null>(null)
  const imgBoxRef = useRef<HTMLDivElement>(null)

  const projects = useApi<{ data: ProjectOption[] }>(open ? '/api/projects' : null, [open])
  const orders = useApi<{ data: WorkOrderOption[] }>(open ? '/api/nalog?scope=open' : null, [open])
  const photos = useApi<{ data: PhotoRow[] }>(open ? '/api/measurements?type=FOTO' : null, [open])

  // R439 (issue #6): stanje signala (useSyncExternalStore) + offline nabor nalogov
  const online = useOnline()
  const [cachedOrders, setCachedOrders] = useState<CachedWoRow[]>([])

  useEffect(() => {
    if (!open) return
    void getCachedNalogi<CachedWoRow>().then((c) => { if (c) setCachedOrders(c.list) }).catch(() => {})
  }, [open])

  // ── R486 (issue #7 §3): predpolnjen kontekst iz naloga (ZAČNI MERITEV v DANES) ──
  useEffect(() => {
    if (!open) return
    if (initialProjectId) setProjectId(initialProjectId)
    if (initialWorkOrderId) setWorkOrderId(initialWorkOrderId)
  }, [open, initialProjectId, initialWorkOrderId])

  // ── R486 (issue #7 §3/§6): nedokončana meritev — pasica NADALJUJ / ZAČNI NOVO ──
  // osvežitev/zaprtje/klic sred merjenja NE izgubi točk/kalibracije/pogledov
  const [pendingDraft, setPendingDraft] = useState<MeasureDraft | null>(null)
  useEffect(() => {
    if (!open) return
    setPendingDraft(null)
    const uid = useAppStore.getState().user?.id
    if (!uid) return
    void loadDraft(uid).then((d) => {
      if (!d) return
      if (!Array.isArray(d.views) || d.views.length === 0) { void clearDraft(uid); return }
      if (autoResumeDraft) { resumeDraft(d); return }
      setPendingDraft(d)
    }).catch(() => {})
  }, [open, autoResumeDraft])

  /** R486: obnovi stanje iz osnutka (točke, kalibracija, pogledi, faza, kakovost). */
  function resumeDraft (d: MeasureDraft): void {
    const modes = MEASURE_MODES as string[]
    const validMode = modes.includes(d.mode) ? (d.mode as MeasureMode) : 'OGRAJA'
    const types = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'OSTANEO']
    const validType = typeof d.type === 'string' && types.includes(d.type) ? d.type : null
    const restored: View[] = d.views.map((v, i) => ({ ...v, key: viewKey.current + i }))
    viewKey.current += d.views.length
    if (validMode !== mode) typeRestoreRef.current = true
    setMode(validMode)
    if (validType) setType(validType)
    setViews(restored)
    setActiveView(Math.max(0, Math.min(d.activeView ?? 0, restored.length - 1)))
    const ph = Math.min(5, Math.max(1, Math.round(d.phase ?? 1)))
    setPhase(ph as 1 | 2 | 3 | 4 | 5)
    if (d.projectId) setProjectId(d.projectId)
    if (d.workOrderId) setWorkOrderId(d.workOrderId)
    if (typeof d.location === 'string') setLocation(d.location)
    const cal = CALIB_METHODS.find((c) => c.id === d.calibMethod)
    if (cal) setCalibMethod(cal.id)
    if (typeof d.heightS === 'string' && d.heightS) setHeightS(d.heightS)
    if (typeof d.note === 'string' && d.note) setNote(d.note)
    if (typeof d.maxTilt === 'number' && Number.isFinite(d.maxTilt)) setMaxTilt(d.maxTilt)
    past.current = []; future.current = []
    setServerLayout(null)
    setPendingDraft(null)
    toast({ title: 'Nedokončana meritev obnovljena.', description: 'Točke, kalibracija in pogledi so nazaj — nadaljuj, kjer si končal.' })
  }

  /** R486: trenutno stanje dialoga → osnutek (IndexedDB, 1 na uporabnika). */
  function draftSnapshot (): MeasureDraftSnapshot {
    return {
      projectId: projectId !== 'none' ? projectId : null,
      workOrderId: workOrderId !== 'none' ? workOrderId : null,
      mode,
      phase,
      views,
      activeView,
      location,
      calibMethod,
      type,
      heightS,
      note,
      maxTilt,
    }
  }

  // R486 (issue #7 §6): samodejni osnutek — debounce 500 ms; nov dogodek (foto,
  // točke, kalibracija, faza) vedno prepíše starejši osnutek istega uporabnika.
  const draftTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!open) return
    const uid = useAppStore.getState().user?.id
    if (!uid || views.length === 0) return
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      void saveDraft(uid, draftSnapshot())
        .then(() => setPendingDraft(null))
        .catch(() => { /* osnutek ne sme blokirati merjenja */ })
    }, 500)
    return () => { if (draftTimer.current !== null) { window.clearTimeout(draftTimer.current); draftTimer.current = null } }
  }, [open, phase, views, activeView, projectId, workOrderId, mode, location, calibMethod, type, heightS, note, maxTilt])

  // R457 (§16): zmogljivosti naprave ob odprtju pogovornega okna
  useEffect(() => {
    if (!open) return
    void detectDeviceCaps().then(setCaps).catch(() => {})
  }, [open])

  // R457 (§2): način izmere določi priporočeni legacy tip + počisti analizo
  // R486: ob obnovitvi osnutka tip pusti, kot je bil shranjen (typeRestoreRef)
  const typeRestoreRef = useRef(false)
  useEffect(() => {
    if (typeRestoreRef.current) {
      typeRestoreRef.current = false
    } else {
      setType(MODE_RULES[mode].legacyType)
    }
    setStairMode(mode === 'STOPNICE')
    setAnalysis(null)
  }, [mode])

  // R457 (§3): nagib naprave med živim predogledom (DeviceOrientation)
  useEffect(() => {
    if (!camActive) return
    phoneRollRef.current = null
    const h = (e: DeviceOrientationEvent): void => {
      const t = Math.max(Math.abs(e.beta ?? 0), Math.abs(e.gamma ?? 0))
      setMaxTilt((prev) => (prev === null || t > prev ? t : prev))
      // R468 (F2): trenutni roll (gamma) za oceno naklona tal
      const g = e.gamma
      phoneRollRef.current = typeof g === 'number' && Number.isFinite(g) ? g : null
    }
    window.addEventListener('deviceorientation', h)
    return () => {
      window.removeEventListener('deviceorientation', h)
      phoneRollRef.current = null
    }
  }, [camActive])

  /** Nalogi za izbor: online API, offline predpomnjeni. */
  const orderOptions = useMemo(
    () => (orders.data?.data?.length ? orders.data.data : cachedOrders),
    [orders.data, cachedOrders]
  )

  const view = views[activeView] ?? null

  // ── R455: undo/redo pomočniki ──
  function snapshot (): void {
    past.current.push({ views: structuredClone(views), activeView })
    if (past.current.length > 50) past.current.shift()
    future.current = []
    setHistTick((t) => t + 1)
  }
  function undo (): void {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push({ views: structuredClone(views), activeView })
    setViews(prev.views); setActiveView(Math.min(prev.activeView, prev.views.length - 1))
    setHistTick((t) => t + 1)
  }
  function redo (): void {
    const next = future.current.pop()
    if (!next) return
    past.current.push({ views: structuredClone(views), activeView })
    setViews(next.views); setActiveView(next.activeView)
    setHistTick((t) => t + 1)
  }
  void histTick

  // priprava kamere
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      setCamActive(true)
      requestAnimationFrame(() => { if (videoRef.current) videoRef.current.srcObject = stream })
    } catch {
      toast({
        title: 'Kamera ni dosegljiva.',
        description: 'Uporabite nalaganje fotografije ali izberite obstoječo.',
      })
      fileRef.current?.click()
    }
  }, [toast])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamActive(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  function capture (): void {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, MAX_IMG_W / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/jpeg', 0.85)
    stopCamera()
    void acceptImage(url)
  }

  async function onFile (f: File | undefined): Promise<void> {
    if (!f) return
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(f)
    })
    await acceptImage(await shrinkToDataUrl(url))
  }

  /** Nastavi sliko kot PRVI pogled in ponastavi označevanje + R455 kakovost. */
  async function acceptImage (url: string): Promise<void> {
    const quality = await analyzeQuality(url)
    setSavedId(null) // R457: nov zajem — izvoz prejšnje meritve ni več aktualen
    const v: View = {
      key: viewKey.current++,
      photoId: null,
      dataUrl: url,
      imgW: 1, imgH: 1,
      quality,
      points: [], calib: null, calibLocked: false,
    }
    const img = new Image()
    img.onload = () => {
      setViews((vs) => vs.map((x) => (x.key === v.key ? { ...x, imgW: img.naturalWidth, imgH: img.naturalHeight } : x)))
    }
    img.src = url
    snapshot()
    setViews([v])
    setActiveView(0)
    setCalibA(null); setCalibCm(''); setServerLayout(null)
    setPhase(2)
    if (quality && !quality.ok) {
      toast({
        title: 'Opozorilo o kakovosti zajema.',
        description: `${quality.dark ? 'Slika je temna. ' : ''}${quality.bright ? 'Slika je presočena. ' : ''}${quality.blurry ? 'Slika je mehka — točke postavljajte previdno ali posnemite znova. ' : ''}Meritev lahko vseeno nadaljujete.`,
      })
    }
  }

  /** R455: doda DODATEN pogled (fotografija istega objekta, §3). */
  async function addView (url: string): Promise<void> {
    if (views.length >= MAX_VIEWS) {
      toast({ title: `Največ ${MAX_VIEWS} pogledov.`, variant: 'destructive' })
      return
    }
    const quality = await analyzeQuality(url)
    const v: View = {
      key: viewKey.current++,
      photoId: null,
      dataUrl: url,
      imgW: 1, imgH: 1,
      quality,
      points: [], calib: null, calibLocked: false,
    }
    const img = new Image()
    img.onload = () => {
      setViews((vs) => vs.map((x) => (x.key === v.key ? { ...x, imgW: img.naturalWidth, imgH: img.naturalHeight } : x)))
    }
    img.src = url
    snapshot()
    setViews((vs) => [...vs, v])
    setActiveView(views.length)
    setCalibA(null); setCalibCm('')
    toast({ title: `Dodan pogled ${views.length + 1}/${MAX_VIEWS}.`, description: 'Kalibrirajte merilo in označite iste točke kot na prvem pogledu.' })
  }

  async function onFileView (f: File | undefined): Promise<void> {
    if (!f) return
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(f)
    })
    await addView(await shrinkToDataUrl(url))
  }

  /** Izbere obstoječo FOTO meritev. */
  function pickExisting (p: PhotoRow): void {
    const url = parsePhoto(p.params)
    if (!url) return
    void acceptImage(url)
  }

  /** R487 (issue #3): izbere obstoječo FOTO kot DODATEN pogled — isti vzorec
   *  kot izbira 1. pogleda (pickExisting), le da gre v addView namesto
   *  acceptImage. Terenska pot (kamera/datoteka) ostaja neodvisno poleg. */
  function pickExistingView (p: PhotoRow): void {
    const url = parsePhoto(p.params)
    if (!url) return
    setAddingView(false)
    void addView(url)
  }

  /** Naloži fotografijo (POST /api/measure/photo) za AKTIVNI pogled. */
  async function uploadPhoto (): Promise<void> {
    if (!view) return
    setBusy(true)
    try {
      const res = await apiPost<{ data: { id: string } }>('/api/measure/photo', {
        dataUrl: view.dataUrl,
        location: location.trim() || null,
        projectId: projectId !== 'none' ? projectId : null,
        workOrderId: workOrderId !== 'none' ? workOrderId : null,
      })
      snapshot()
      setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, photoId: res.data.id } : v)))
      toast({ title: 'Fotografija shranjena.', description: 'Zdaj kalibrirajte merilo in označite točke.' })
    } catch (e) {
      toast({ title: 'Napaka pri nalaganju fotografije', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  // klik na sliko → točka (normalizirano 0..1) — R455: v fazi KALIBRACIJA (2)
  // označimo referenčni točki, v fazi MERITEV (3) merilne točke
  function onImageClick (e: React.MouseEvent<HTMLDivElement>): void {
    if (!view || (phase !== 2 && phase !== 3)) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    snapshot()
    setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, points: [...v.points, { x, y, src: 'ROCNO' }] } : v)))
    setServerLayout(null)
  }

  function removePoint (i: number): void {
    if (!view) return
    snapshot()
    setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, points: v.points.filter((_, k) => k !== i) } : v)))
    if (calibA === i) setCalibA(null)
    setServerLayout(null)
  }

  // ── R455: vlečenje točk (premik) + povečevalno steklo (§1/§4) ──
  function onPointDown (e: ReactPointerEvent<HTMLButtonElement>, i: number): void {
    if (!view) return
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* nekateri brskalniki */ }
    // stanje PRED morebitnim vlečenjem — za undo (posnetek ob koncu vlečenja)
    dragRef.current = {
      view: activeView, point: i, startX: e.clientX, startY: e.clientY, moved: false,
      preViews: structuredClone(views),
    }
    setLens({ x: e.clientX, y: e.clientY, view: activeView })
  }

  function onPointMove (e: ReactPointerEvent<HTMLButtonElement>): void {
    const d = dragRef.current
    if (!d) return
    const box = imgBoxRef.current?.getBoundingClientRect()
    if (!box) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) {
      setLens({ x: e.clientX, y: e.clientY, view: d.view })
      return
    }
    d.moved = true
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))
    setViews((vs) => vs.map((v, vi) => {
      if (vi !== d.view) return v
      return { ...v, points: v.points.map((p, pi) => (pi === d.point ? { ...p, x, y } : p)) }
    }))
    setServerLayout(null)
    setLens({ x: e.clientX, y: e.clientY, view: d.view })
  }

  function onPointUp (i: number): void {
    const d = dragRef.current
    setLens(null)
    dragRef.current = null
    if (!d) return
    if (!d.moved) {
      // premik pod pragom → tap = izbriši (ohranjeno vedenje iz prejšnjih verzij)
      removePoint(i)
      return
    }
    // posnetek stanja PRED vlečenjem — undo vrne točko na izhodišče (§4)
    past.current.push({ views: d.preViews, activeView })
    if (past.current.length > 50) past.current.shift()
    future.current = []
    setHistTick((t) => t + 1)
  }

  /** Pikselska razdalja med dvema točkama (po dejanski resoluciji slike). */
  const px = useCallback((a: Pt, b: Pt) => {
    if (!view) return 0
    return Math.hypot((b.x - a.x) * view.imgW, (b.y - a.y) * view.imgH)
  }, [view])

  /** R455: izračun v živo za AKTIVNI pogled. */
  const calc = useMemo(() => (view ? calcView(view) : CALC_PRAZEN), [view])

  /** R455: primerjava vseh pogledov + zaupanje (§3). */
  const multi = useMemo(() => {
    const per = views.map((v) => ({ v, c: calcView(v) }))
    const withCm = per.filter((x) => x.c.totalCm !== null && (x.c.totalCm ?? 0) > 0)
    const lengths = withCm.map((x) => x.c.totalCm as number)
    const mean = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : null
    const spreadPct = lengths.length > 1 && mean
      ? ((Math.max(...lengths) - Math.min(...lengths)) / mean) * 100
      : null
    // zaupanje: kakovost + kalibracija + strinjanje pogledov (advisory, §3)
    let conf = 85
    const q0 = views[0]?.quality ?? null
    if (q0?.blurry) conf -= 20
    if (q0?.dark || q0?.bright) conf -= 10
    if (!views[0]?.calib) conf -= 30
    if (lengths.length > 1) {
      if (spreadPct !== null && spreadPct <= 2) conf += 5
      else if (spreadPct !== null && spreadPct > 5) conf -= 20
    } else {
      conf -= 5 // en sam pogled — manj kontrole
    }
    conf = Math.max(5, Math.min(98, Math.round(conf)))
    const label = conf >= 85 ? 'DOBRO' : conf >= 60 ? 'OPOZORILO' : 'NEZADOSTNO'
    return { per, lengths, mean, spreadPct, conf, label }
  }, [views])

  const predlogi = useMemo(() => view?.points.filter((p) => p.src === 'PREDLOG') ?? [], [view])
  const rocnoCnt = calc.pts.length

  /** R455: sprejme VSE predloge (PREDLOG → ROCNO) na aktivnem pogledu. */
  function acceptPredloge (): void {
    if (!view) return
    snapshot()
    setViews((vs) => vs.map((v) => (v.key === view.key
      ? { ...v, points: v.points.map((p) => (p.src === 'PREDLOG' ? { ...p, src: 'ROCNO' as const } : p)) }
      : v)))
    toast({ title: 'Predlogi sprejeti.', description: 'Točke so sedaj ročno potrjene in štejejo v izračun.' })
  }

  /** R455: zavrže VSE predloge na aktivnem pogledu. */
  function rejectPredloge (): void {
    if (!view) return
    snapshot()
    setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, points: v.points.filter((p) => p.src !== 'PREDLOG') } : v)))
  }

  /** VLM zaznava (POST /api/measurement/detect) — R455: točke kot PREDLOG (§2). */
  async function detect (): Promise<void> {
    if (!view) return
    if (!view.photoId) {
      toast({ title: 'Najprej shranite fotografijo.', description: 'Pritisnite »Naloži fotografijo«.', variant: 'destructive' })
      return
    }
    setDetecting(true)
    try {
      const res = await apiPost<{ data: { scene: string; points: Pt[]; refObjects: { x1: number; y1: number; x2: number; y2: number; estCm: number; label: string }[] } }>(
        '/api/measurement/detect', { measurementId: view.photoId }
      )
      const d = res.data
      snapshot()
      setViews((vs) => vs.map((v) => (v.key === view.key
        ? { ...v, points: [...v.points, ...d.points.map((p) => ({ x: p.x, y: p.y, label: p.label, src: 'PREDLOG' as const }))] }
        : v)))
      // referenčni objekt → kalibracija (če še ni oz. ni zaklenjena)
      let calibMsg = ''
      if (d.refObjects.length > 0 && !view.calibLocked) {
        const r = d.refObjects[0]
        const pxLen = Math.hypot((r.x2 - r.x1) * view.imgW, (r.y2 - r.y1) * view.imgH)
        if (pxLen > 0 && !view.calib) {
          setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: { px: Math.round(pxLen), cm: r.estCm } } : v)))
          calibMsg = ` · kalibracija iz "${r.label}" (${r.estCm} cm)`
        }
      }
      toast({
        title: 'Zaznava končana.',
        description: `${d.points.length} predlogov točk${d.scene ? ` · ${d.scene}` : ''}${calibMsg} — predloge pregledajte, sprejmite ali popravite.`,
      })
    } catch (e) {
      toast({
        title: 'Samodejna zaznava ni uspela.',
        description: e instanceof Error ? `${e.message} Točke označite ročno — ročni vnos je popolnoma podprt.` : undefined,
        variant: 'destructive',
      })
    } finally { setDetecting(false) }
  }

  /** Preverjanje na strežniku (POST /api/railing-layout) — primarni pogled. */
  async function verifyServer (): Promise<void> {
    if (!view || !view.calib || calc.pts.length < 2) {
      toast({ title: 'Potrebna sta kalibracija in vsaj 2 točki.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: { totalLengthCm: number; posts: number; handrailM: number } }>('/api/railing-layout', {
        points: calc.pts.map((p) => ({ x: p.x * view.imgW, y: p.y * view.imgH })),
        calibration: view.calib,
      })
      setServerLayout(`Strežnik: ${fmt1(res.data.totalLengthCm / 100)} m · ${res.data.posts} stebrov · ročnik ${fmt1(res.data.handrailM)} m`)
    } catch (e) {
      toast({ title: 'Preverjanje ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  /** Končna dolžina: ročni popravek > povprečje pogledov > primarni pogled.
   *  R487 (issue #3 §4C): ob konfliktu pogledov (razpršenost > 5 %) BREZ
   *  ročnega popravka vrednost NI na voljo — NE tiho povprečje (vrata POTRDI). */
  const finalLengthCm = useMemo(() => {
    if (overrideOn) {
      const v = Number(overrideLen.replace(',', '.'))
      return Number.isFinite(v) && v > 0 ? v : null
    }
    if (multi.mean !== null && multi.lengths.length > 1) {
      if (multi.spreadPct !== null && multi.spreadPct > 5) return null // konflikt → rešitev ali popravek
      return Math.round(multi.mean * 10) / 10
    }
    return calc.totalCm
  }, [overrideOn, overrideLen, multi, calc])

  /** R487 (issue #3 §4C): konflikt pogledov (razpršenost > 5 %) brez rešitve —
   *  POTRDI (in offline shranjevanje) onemogočena, dokler uporabnik NE popravi
   *  točk/kalibracije na pogledih (→ razpršenost ≤ 5 %) ALI izrecno ne potrdi
   *  razhajanja z ročnim popravkom dolžine z razlogom (manualOverride —
   *  obstoječa r455 pot v tej fazi). 0 tihih povprečij ob konfliktu. */
  const conflictBlocked = multi.lengths.length > 1 && multi.spreadPct !== null && multi.spreadPct > 5 &&
    !(overrideOn && Number(overrideLen.replace(',', '.')) > 0 && overrideReason.trim().length >= 3)

  /** Potrditev in shranjevanje (POST /api/measurement/confirm) — R455 razširjeno. */
  async function confirm (again: boolean): Promise<void> {
    if (!view) return
    if (finalLengthCm === null || finalLengthCm <= 0) {
      toast({ title: 'Manjka kalibracija ali točke.', description: 'Kalibrirajte merilo in označite vsaj 2 točki.', variant: 'destructive' })
      return
    }
    if (overrideOn && overrideReason.trim().length < 3) {
      toast({ title: 'Ročni popravek zahteva razlog.', description: 'Navedite razlog spremembe izračunane dolžine (sledljivost).', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: { id: string; status?: MeasurementStatus; statusNote?: string | null } }>('/api/measurement/confirm', {
        photoId: views[0].photoId,
        type: stairMode ? 'NAGIB' : type,
        location: location.trim() || null,
        lengthCm: finalLengthCm,
        heightCm: Number(heightS.replace(',', '.')) > 0 ? Number(heightS.replace(',', '.')) : null,
        slopeDeg: calc.segs.length === 1 ? Math.round(calc.segs[0].angleDeg * 10) / 10 : null,
        posts: calc.cmPerPx !== null
          ? Math.max(calc.pts.length >= 2 ? 2 : 0, calc.segs.reduce((acc, s) => acc + Math.max(1, Math.ceil((s.cmLen ?? 0) / 120)) + 1, 0) - Math.max(0, calc.segs.length - 1))
          : null,
        segments: calc.segs.length,
        note: note.trim() || (stairMode && calc.segs.length > 0 && calc.segs.every((s) => Math.abs(s.angleDeg) >= 20 && Math.abs(s.angleDeg) <= 75)
          ? `${calc.segs.length} stopnic`
          : null),
        projectId: projectId !== 'none' ? projectId : null,
        workOrderId: workOrderId !== 'none' ? workOrderId : null,
        points: calc.pts.map((p) => ({ x: p.x, y: p.y })),
        calibration: view.calib ? { ...view.calib, method: calibMethod, refObject: refObject.trim() || undefined, imgW: Math.round(view.imgW), imgH: Math.round(view.imgH) } : null,
        // R455: več pogledov (brez primarnega), kakovost, zaupanje, ročni popravek
        views: views.length > 1
          ? views.slice(1).map((v) => ({
            photoId: v.photoId ?? undefined,
            points: v.points.filter((p) => p.src !== 'PREDLOG').map((p) => ({ x: p.x, y: p.y })),
            calibration: v.calib ? { ...v.calib, imgW: Math.round(v.imgW), imgH: Math.round(v.imgH) } : undefined,
          }))
          : undefined,
        quality: views[0].quality
          ? {
            brightness: views[0].quality.brightness,
            blurScore: views[0].quality.blurScore,
            dark: views[0].quality.dark,
            bright: views[0].quality.bright,
            blurry: views[0].quality.blurry,
          }
          : undefined,
        confidence: multi.conf,
        manualOverride: overrideOn
          ? { computedLengthCm: multi.mean !== null && multi.lengths.length > 1 ? Math.round(multi.mean * 10) / 10 : calc.totalCm ?? 0, reason: overrideReason.trim() }
          : undefined,
        // R457 (issue #12): način izmere + rezultat engine-a (§2, §7)
        mode,
        engine: analysis
          ? {
            domain: analysis.domain,
            validation: analysis.validation,
            confidence: analysis.confidence,
            // R500 (issue #15 faza 1): model merila + veljavnost po quantities
            // gresta v zapis, da revizija vidi, KAJ je bila dokazana mera.
            scale: analysis.scale,
            validity: analysis.validity,
          }
          : undefined,
      })
      setSavedId(res.data.id)
      // R501 (issue #15 faza 2): o poslovni meri odloči STREŽNIK — monterju
      // pokažemo njegovo stanje (in razlog), ne lastno trditev.
      const stanje = res.data.status ? MEASUREMENT_STATUS_LABELS[res.data.status] : null
      toast({
        title: 'Meritev potrjena in shranjena.',
        description: stanje
          ? `${fmt1(finalLengthCm / 100)} m · stanje: ${stanje}${measurementStatusAllowsBusiness(res.data.status) ? ' — uporabljena bo v konfiguratorju in BOM-u.' : ' — v BOM JE NE sme (korak: dokazano merilo ali pisarniška potrditev).'}`
          : `${fmt1(finalLengthCm / 100)} m · zaupanje ${multi.conf} % — uporabljena bo v konfiguratorju in BOM-u.`,
      })
      if (again) {
        setNote(''); setOverrideOn(false); setOverrideLen(''); setOverrideReason(''); setServerLayout(null)
        setViews((vs) => vs.map((v) => ({ ...v, points: [], calib: v.calibLocked ? v.calib : null })))
        setAnalysis(null) // R457: nova meritev na isti fotografiji → nova analiza
        past.current = []; future.current = []
        setPhase(2)
      } else {
        // R486 (issue #7 §6/§7): uspešno potrjena meritev → osnutek ni več potreben.
        // clearDraft ŠELEJ SEDAJ (meritev JE shranjena) a PRED onSaved()/resetAll() —
        // onSaved sproži reload podatkov, ob katerem se lahko dialog zapre in DANES
        // ponovno naloži osnutek; če izbris IndexedDB še ni rezultiran, bi se pokazala
        // LAŽNA pasika »Nadaljuj nedokončano« (issue #7 §7 brez lažnih stanj).
        const uid = useAppStore.getState().user?.id
        if (uid) await clearDraft(uid).catch(() => { /* osnutek ni kritičen */ })
        await onSaved()
        resetAll()
      }
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju meritve', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  /**
   * R439 (issue #6): offline shranjevanje — fotografija gre v IndexedDB photos
   * shrambo (kompresirana), op 'foto' pa nosi tudi merilne podatke
   * (tip/dolžina/višina/stebri/segmenti/nagib). Samodejna sinhronizacija prek
   * /api/sync ob vrnitvi signala (idempotentno — opId).
   */
  async function saveOffline (): Promise<void> {
    if (!view) return
    setBusy(true)
    try {
      await queuePhoto({
        dataUrl: view.dataUrl,
        projectId: projectId !== 'none' ? projectId : null,
        workOrderId: workOrderId !== 'none' ? workOrderId : null,
        note: note.trim() || null,
        location: location.trim() || null,
        type: stairMode ? 'NAGIB' : type,
        lengthCm: finalLengthCm !== null && finalLengthCm > 0 ? finalLengthCm : null,
        heightCm: Number(heightS.replace(',', '.')) > 0 ? Number(heightS.replace(',', '.')) : null,
        posts: null,
        segments: calc.segs.length,
        slopeDeg: calc.segs.length === 1 ? Math.round(calc.segs[0].angleDeg * 10) / 10 : null,
        // R486 (issue #7 §6 — dopolnitev offline poti): kalibracija/pogledi/kakovost/
        // zaupanje/ročni popravek/način/engine se izgubijo SAMO če jih NE pošljemo —
        // struktura je IDENTIČNA confirm (:771-819), /api/sync pa jih zapiše v params.
        points: calc.pts.map((p) => ({ x: p.x, y: p.y })),
        calibration: view.calib
          ? { ...view.calib, method: calibMethod, refObject: refObject.trim() || undefined, imgW: Math.round(view.imgW), imgH: Math.round(view.imgH) }
          : null,
        views: views.length > 1
          ? views.slice(1).map((v) => ({
            photoId: v.photoId ?? undefined,
            points: v.points.filter((p) => p.src !== 'PREDLOG').map((p) => ({ x: p.x, y: p.y })),
            calibration: v.calib ? { ...v.calib, imgW: Math.round(v.imgW), imgH: Math.round(v.imgH) } : undefined,
          }))
          : null,
        quality: views[0].quality
          ? {
            brightness: views[0].quality.brightness,
            blurScore: views[0].quality.blurScore,
            dark: views[0].quality.dark,
            bright: views[0].quality.bright,
            blurry: views[0].quality.blurry,
          }
          : null,
        confidence: multi.conf,
        manualOverride: overrideOn
          ? { computedLengthCm: multi.mean !== null && multi.lengths.length > 1 ? Math.round(multi.mean * 10) / 10 : calc.totalCm ?? 0, reason: overrideReason.trim() }
          : null,
        mode,
        engine: analysis
          ? { domain: analysis.domain, validation: analysis.validation, confidence: analysis.confidence, scale: analysis.scale, validity: analysis.validity }
          : null,
      })
      toast({
        title: 'Shranjeno lokalno — sinhroniziralo se bo samodejno',
        description: `${finalLengthCm ? `Meritev ${fmt1(finalLengthCm / 100)} m in fotografija` : 'Fotografija'} bosta poslani, ko se signal vrne. Ali bo številka poslovna mera ali ocena, na sinhronizaciji odloči strežnik (merilo px/cm).`,
      })
      resetAll()
      // R486 (issue #7 §6): offline shranjeno v vrsto → osnutek ni več potreben
      // (await — isti razlog kot v confirm: brez lažnega NADALJUJ gumba po shranjevanju)
      const uid = useAppStore.getState().user?.id
      if (uid) await clearDraft(uid).catch(() => { /* osnutek ni kritičen */ })
      onClose()
    } catch (e) {
      toast({
        title: 'Offline shranjevanje ni uspelo',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  function resetAll (): void {
    setPhase(1); setViews([]); setActiveView(0)
    setCalibA(null); setCalibCm(''); setNote('')
    setLocation(''); setServerLayout(null); setStairMode(mode === 'STOPNICE')
    setProjectId('none'); setWorkOrderId('none')
    setOverrideOn(false); setOverrideLen(''); setOverrideReason('')
    // R457: počisti analizo/nagib; savedId ostane (izvoz zadnje shranjene meritve)
    setAnalysis(null); setMaxTilt(null)
    past.current = []; future.current = []
  }

  /** R457: domenske možnosti za engine (§8–§11) iz UI stanja. */
  function buildOptions (): DomainOptions {
    const n = (s: string): number | null => {
      const v = Number(s.replace(',', '.'))
      return Number.isFinite(v) && v > 0 ? v : null
    }
    const openings = (): DomainOptions['openings'] => {
      const c = n(opCount)
      const w = n(opW); const h = n(opH)
      return c != null && c > 0 && w != null && h != null ? [{ wCm: w, hCm: h, count: Math.round(c) }] : undefined
    }
    switch (mode) {
      case 'OGRAJA': {
        const o: DomainOptions = {}
        const ms = n(maxSpanS); if (ms != null) o.maxSpanCm = ms
        const hh = n(heightS); if (hh != null) o.heightCm = hh
        return o
      }
      case 'KERAMIKA': {
        const o: DomainOptions = {}
        const w = n(tileW); const hh = n(tileH); const j = Number(jointMm)
        if (w != null) o.tileWcm = w
        if (hh != null) o.tileHcm = hh
        if (Number.isFinite(j) && j >= 0) o.jointMm = j
        o.pattern = pattern
        const op = openings(); if (op != null) o.openings = op
        return o
      }
      case 'STREHA': {
        const o: DomainOptions = {}
        const p = n(pitchDeg); if (p != null) o.pitchDeg = p
        o.roofMaterial = roofMaterial
        return o
      }
      case 'FASADA': {
        const o: DomainOptions = {}
        const op = openings(); if (op != null) o.openings = op
        return o
      }
      case 'STOPNICE': {
        const o: DomainOptions = {}
        const s = n(stepsS); if (s != null) o.steps = Math.round(s)
        return o
      }
      default:
        return {}
    }
  }

  /** R457: kanonična analiza engine-a (POST /api/measure-engine/analyze). */
  async function runEngine (): Promise<void> {
    if (!view || !view.calib || calc.pts.length < 2) {
      toast({ title: 'Potrebna sta kalibracija in vsaj 2 točki.', variant: 'destructive' })
      return
    }
    setAnalyzing(true)
    try {
      const res = await apiPost<{ data: AnalyzeResult }>('/api/measure-engine/analyze', {
        mode,
        points: calc.pts.map((p) => ({ x: p.x, y: p.y })),
        calibration: { ...view.calib, imgW: Math.round(view.imgW), imgH: Math.round(view.imgH), method: calibMethod, refObject: refObject.trim() || undefined },
        options: buildOptions(),
        quality: views[0].quality
          ? {
            brightness: views[0].quality.brightness,
            blurScore: views[0].quality.blurScore,
            dark: views[0].quality.dark,
            bright: views[0].quality.bright,
            blurry: views[0].quality.blurry,
          }
          : undefined,
        tiltDeg: maxTilt,
        viewAgreementPct: multi.lengths.length > 1 && multi.spreadPct !== null ? Math.max(0, 100 - multi.spreadPct) : null,
        manualLengthCm: overrideOn && Number(overrideLen.replace(',', '.')) > 0 ? Number(overrideLen.replace(',', '.')) * 100 : null,
      })
      setAnalysis(res.data)
      const errs = res.data.validation.filter((i) => i.severity === 'NAPAKA').length
      toast({
        title: errs > 0 ? `Analiza: ${errs} napak za popravilo.` : 'Analiza engine-a končana.',
        description: `Zaupanje ${res.data.confidence.confidence} % (${res.data.confidence.band}) · način ${MODE_RULES[mode].label}.`,
        variant: errs > 0 ? 'destructive' : undefined,
      })
    } catch (e) {
      toast({ title: 'Analiza engine-a ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setAnalyzing(false) }
  }

  /** R457 (§19): prenos izvoza CSV/JSON potrjene meritve. */
  async function downloadExport (fmt: 'csv' | 'json'): Promise<void> {
    if (!savedId) return
    try {
      const token = useAppStore.getState().token
      const res = await fetch(`/api/measure-engine/export?id=${savedId}&format=${fmt}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `roksal-meritev-${savedId.slice(-8)}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: `Izvoz ${fmt.toUpperCase()} prenešen.`, description: 'Dokument vsebuje projekt, reference, mere, zaupanje in verzijo.' })
    } catch (e) {
      toast({ title: 'Izvoz ni uspel', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const existingPhotos = useMemo(
    () => (photos.data?.data ?? []).filter((p) => parsePhoto(p.params) !== null).slice(0, 12),
    [photos.data]
  )

  /** R455: statusni korak (5-fazni tok, §4) — izpeljan iz stanja. */
  const stepDone = [
    views.length > 0, // ZAJEM
    Boolean(views[0]?.calib), // KALIBRACIJA
    rocnoCnt >= 2, // MERITEV
    phase > 4 || (phase === 4 && (serverLayout !== null || analysis !== null)), // PREVERJANJE
    false, // POTRDITEV (izvedeno ob shranitvi)
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Camera className="size-5 text-roksal-amber" aria-hidden /> Meritve s kamero
        </DialogTitle>
        <DialogDescription>
          Fotografirajte teren, kalibrirajte merilo, označite točke — dolžine, koti in višine se izračunajo samodejno.
        </DialogDescription>
      </DialogHeader>

      {/* R455: 5-fazni profesionalni status (§4) */}
      <ol className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Status zajema">
        {PHASES.map((t, i) => {
          const st = phase === i + 1 ? 'active' : stepDone[i] ? 'done' : 'todo'
          return (
            <li key={t} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${st === 'active' ? 'border-roksal-amber bg-amber-50 font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : st === 'done' ? 'border-emerald-300 text-emerald-800 dark:border-emerald-900 dark:text-emerald-300' : 'text-muted-foreground'}`}>
              <span className={`flex size-4 items-center justify-center rounded-full text-[10px] ${st === 'done' ? 'bg-emerald-500 text-white' : st === 'active' ? 'bg-roksal-amber text-white' : 'bg-muted'}`} aria-hidden>
                {st === 'done' ? '✓' : i + 1}
              </span>
              {t.toUpperCase()}
            </li>
          )
        })}
      </ol>

      {/* R486 (issue #7 §3/§6): nedokončana meritev — pasica nadaljevanja */}
      {pendingDraft && views.length === 0 ? (() => {
        const pts = pendingDraft.views.reduce((s, v) => s + (Array.isArray(v.points) ? v.points.length : 0), 0)
        const at = new Date(pendingDraft.savedAt)
        const hm = Number.isFinite(at.getTime())
          ? at.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })
          : ''
        return (
          <div
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40"
            role="status"
            aria-label="Nedokončana meritev shranjena v telefonu"
          >
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Imaš nedokončano meritev{hm ? ` (shranjeno ${hm})` : ''} — {pendingDraft.views.length} {pendingDraft.views.length === 1 ? 'pogled' : 'pogleda/pogledi'}, {pts} točk.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" className="h-9" onClick={() => resumeDraft(pendingDraft)}>
                <Redo2 className="size-4" aria-hidden /> NADALJUJ
              </Button>
              <Button
                size="sm" variant="outline" className="h-9"
                onClick={() => {
                  const uid = useAppStore.getState().user?.id
                  if (uid) void clearDraft(uid)
                  setPendingDraft(null)
                }}
              >
                <Trash2 className="size-4" aria-hidden /> ZAČNI NOVO
              </Button>
            </div>
          </div>
        )
      })() : null}

      {/* R457 (§19): izvoz zadnje shranjene meritve — viden v vseh fazah po potrditvi */}
      {savedId ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 dark:border-emerald-900 dark:bg-emerald-950/30" role="status">
          <span className="text-[11px] font-medium text-emerald-900 dark:text-emerald-200">Meritev shranjena ✓ — izvoz dokumenta:</span>
          <Button size="sm" variant="outline" className="h-8" onClick={() => void downloadExport('csv')}><FileSpreadsheet className="size-3.5" aria-hidden /> CSV</Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => void downloadExport('json')}><FileJson className="size-3.5" aria-hidden /> JSON</Button>
        </div>
      ) : null}

      {/* ══ FAZA 1: ZAJEM (fotografija + kakovost + vodila) ══ */}
      {phase === 1 ? (
        <div className="space-y-4">
          {/* R457 (§2): adaptivni način izmere — izbor PRED zajemom */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Ruler className="size-4 text-roksal-amber" aria-hidden /> Način izmere</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Način izmere">
              {MEASURE_MODES.map((m) => (
                <button
                  key={m} type="button" role="radio" aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-lg border p-2 text-left text-xs transition ${mode === m ? 'border-roksal-amber bg-amber-50 font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'text-muted-foreground hover:border-foreground/30'}`}
                >
                  <span className="block">{MODE_RULES[m].label}</span>
                  <span className="mt-0.5 block text-[10px] font-normal opacity-80">{MODE_RULES[m].desc}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">💡 {MODE_RULES[mode].hint}</p>
          </div>

          {/* R457 (§16/§18): zmogljivosti naprave + priporočena metoda */}
          {caps ? (
            <Card>
              <CardContent className="space-y-1.5 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Cpu className="size-4 text-roksal-amber" aria-hidden /> Naprava in priporočena metoda</p>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <Badge variant={caps.camera ? 'secondary' : 'destructive'}>kamera {caps.camera ? '✓' : '✗'}</Badge>
                  <Badge variant={caps.orientation ? 'secondary' : 'outline'}>žiroskop {caps.orientation ? '✓' : '—'}</Badge>
                  <Badge variant={caps.gps ? 'secondary' : 'outline'}>GPS {caps.gps ? '✓' : '—'}</Badge>
                  <Badge variant={caps.webgl ? 'secondary' : 'outline'}>WebGL {caps.webgl ? '✓' : '—'}</Badge>
                  <Badge variant={caps.network ? 'secondary' : 'outline'}>{caps.network ? 'povezava ✓' : 'brez povezave'}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Priporočena metoda: <strong className="text-foreground">{recommendMethod(caps).label}</strong> — {recommendMethod(caps).reason}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Button size="lg" className="h-12" onClick={() => void startCamera()} disabled={camActive}>
              <Camera className="size-5" aria-hidden /> Zajemi s kamero
            </Button>
            <Button size="lg" variant="outline" className="h-12" onClick={() => fileRef.current?.click()}>
              <ImageIcon className="size-5" aria-hidden /> Naloži iz telefona
            </Button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Izberi fotografijo" />
          </div>

          {camActive ? (
            <div className="space-y-2 overflow-hidden rounded-lg border bg-black">
              <div className="relative">
                <video ref={videoRef} autoPlay playsInline muted className="max-h-[360px] w-full object-contain" aria-label="Predogled kamere" />
                {/* R467 (issue #8 F1): žive zaznave prizora (tla, ovire, struktura) —
                    čist pogled, 2–4 oznake, tap za podatek; nikoli ne blokira zajema */}
                {sceneState.elements.length > 0 ? (
                  <SceneOverlay
                    elements={sceneState.elements}
                    quality={sceneState.quality}
                  />
                ) : null}
                {/* R455: vodila za vodenje zajema (§4) — mreža + vodoravnica + središče */}
                {guides ? (
                  <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                    <line x1="33.33" y1="0" x2="33.33" y2="100" stroke="#ffffff88" strokeWidth="0.3" />
                    <line x1="66.66" y1="0" x2="66.66" y2="100" stroke="#ffffff88" strokeWidth="0.3" />
                    <line x1="0" y1="33.33" x2="100" y2="33.33" stroke="#ffffff88" strokeWidth="0.3" />
                    <line x1="0" y1="66.66" x2="100" y2="66.66" stroke="#ffffff88" strokeWidth="0.3" />
                    <line x1="0" y1="50" x2="100" y2="50" stroke="#f59e0bcc" strokeWidth="0.5" strokeDasharray="2 1.5" />
                    <circle cx="50" cy="50" r="1.2" fill="none" stroke="#f59e0bcc" strokeWidth="0.4" />
                  </svg>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 p-2">
                <Button className="flex-1" onClick={capture}><Camera className="size-4" aria-hidden /> Zajemi</Button>
                <Button variant="outline" onClick={() => setGuides((g) => !g)} aria-pressed={guides}>
                  <Grid3x3 className="size-4" aria-hidden /> Vodila {guides ? 'vklop' : 'izklop'}
                </Button>
                <Button variant="outline" onClick={stopCamera}>Prekliči</Button>
              </div>
            </div>
          ) : null}

          {existingPhotos.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Ali izberite obstoječo fotografijo:</p>
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="list">
                {existingPhotos.map((p) => (
                  <button key={p.id} type="button" onClick={() => pickExisting(p)} className="group overflow-hidden rounded-lg border text-left transition hover:border-roksal-amber" role="listitem">
                    <img src={parsePhoto(p.params) ?? ''} alt={`Fotografija ${p.location ?? 'brez lokacije'}`} className="h-20 w-full object-cover" />
                    <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground group-hover:text-foreground">
                      {p.location ?? p.project?.code ?? fmtDate(p.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Projekt (za shranjevanje)</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger aria-label="Povezava na projekt"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  <SelectItem value="none">Brez projekta</SelectItem>
                  {(projects.data?.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>)}
                </SelectContent>
              </Select>
              <ErrorBox error={projects.error} />
            </div>
            <div className="space-y-2">
              <Label>Nalog</Label>
              <Select value={workOrderId} onValueChange={setWorkOrderId}>
                <SelectTrigger aria-label="Povezava na nalog"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  <SelectItem value="none">Brez naloga</SelectItem>
                  {/* R439: offline → predpomnjeni nalogi iz IndexedDB */}
                  {orderOptions.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.title}</SelectItem>)}
                </SelectContent>
              </Select>
              {!online && orderOptions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Brez povezave in brez predpomnjenih nalogov — nalog izberite, ko bo signal nazaj.</p>
              ) : null}
              <ErrorBox error={online ? orders.error : null} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="km-location">Lokacija merjenja</Label>
            <Input id="km-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="npr. Stopnišče — vhod" />
          </div>
        </div>
      ) : null}

      {/* ══ FAZA 2: KALIBRACIJA ══ */}
      {phase === 2 && view ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">
              {view.photoId ? 'Fotografija shranjena ✓' : busy ? 'Nalaganje …' : 'Ni še shranjena'}
            </Badge>
            {view.quality ? (
              <Badge className={view.quality.ok
                ? 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                : 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'}>
                Kakovost: {view.quality.ok ? 'DOBRO' : 'OPOZORILO'}
                {view.quality.blurry ? ' · mehka' : ''}{view.quality.dark ? ' · temna' : ''}{view.quality.bright ? ' · presočena' : ''}
              </Badge>
            ) : null}
            {!view.photoId ? (
              <Button size="sm" onClick={() => void uploadPhoto()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Naloži fotografijo
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void detect()} disabled={detecting || !view.photoId}>
              {detecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {detecting ? 'VLM analizira (do 60 s) …' : 'Zaznaj samodejno (VLM)'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { resetAll(); setPhase(1) }}>
              <Undo2 className="size-4" aria-hidden /> Druga fotografija
            </Button>
          </div>

          {!online ? (
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
              <WifiOff className="size-3.5 shrink-0" aria-hidden />
              Brez povezave — točke označite ročno, shranite z gumbom »Shrani (offline)« v koraku potrditve.
            </p>
          ) : null}

          {/* R457 (§3): Smart Capture Guide — DOBRO/OPOZORILO/NEZADOSTNO */}
          {(() => {
            const guide = captureGuide({
              quality: view.quality,
              tiltDeg: maxTilt,
              calibPresent: view.calib !== null,
              viewCount: views.length,
            })
            const tone = guide.status === 'DOBRO'
              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
              : guide.status === 'OPOZORILO'
                ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
                : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
            return (
              <div className={`rounded-lg border px-3 py-2 ${tone}`} role="status" aria-label="Vodnik kakovosti zajema">
                <p className="text-xs font-semibold">
                  Vodnik zajema: {guide.status === 'DOBRO' ? 'DOBRO — nadaljuj' : guide.status === 'OPOZORILO' ? 'OPOZORILO — dodaj posnetek' : 'NEZADOSTNO — meritev še ni pripravljena'}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {guide.checks.map((c) => (
                    <li key={c.code} className="flex items-start gap-1.5 text-[11px]">
                      <span aria-hidden>{c.state === 'DOBRO' ? '✓' : c.state === 'OPOZORILO' ? '⚠' : '✗'}</span>
                      <span><strong>{c.label}:</strong> {c.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}

          <div className="mx-auto inline-block max-w-full rounded-lg border bg-muted/40 p-1">
            <div className="relative inline-block cursor-crosshair" onClick={onImageClick} role="application" aria-label="Fotografija za kalibracijo — klik dodaja referenčni točki">
              <img src={view.dataUrl} alt="Teren za merjenje" className="block h-auto max-h-[380px] w-auto max-w-full select-none" draggable={false} />
              {view.points.length > 1 ? (
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
                  <polyline
                    points={view.points.filter((p) => p.src !== 'PREDLOG').map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="#d97706" strokeWidth={2} vectorEffect="non-scaling-stroke"
                  />
                </svg>
              ) : null}
              {view.points.map((p, i) => (
                <span
                  key={`${i}-${p.x.toFixed(4)}`}
                  title={p.label ?? `Točka ${i + 1}`}
                  className={`pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 text-[9px] font-bold leading-none ${p.src === 'PREDLOG' ? 'border-sky-600 border-dashed bg-sky-400/80 text-white' : calibA === i ? 'border-sky-500 bg-sky-500 text-white' : 'border-amber-600 bg-amber-500 text-white'}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                >
                  <span className="flex size-full items-center justify-center">{i + 1}</span>
                </span>
              ))}
            </div>
          </div>

          {/* kalibracija */}
          <Card>
            <CardContent className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Crosshair className="size-4 text-roksal-amber" aria-hidden /> Kalibracija merila
                  {/* R455: zaklep referenčne mere (§4) */}
                  {view.calib ? (
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2" aria-pressed={view.calibLocked}
                      onClick={() => { snapshot(); setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calibLocked: !v.calibLocked } : v))) }}
                    >
                      {view.calibLocked ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
                      {view.calibLocked ? 'zaklenjeno' : 'zakleni'}
                    </Button>
                  ) : null}
                </p>
                {calc.cmPerPx !== null ? (
                  <span className="text-xs text-muted-foreground">
                    1 px = {fmt1(calc.cmPerPx)} cm
                    {!view.calibLocked ? (
                      <Button size="sm" variant="ghost" className="ml-2 h-7 px-2" onClick={() => { snapshot(); setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: null } : v))) }}>
                        <Trash2 className="size-3.5" aria-hidden /> ponastavi
                      </Button>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{view.calib ? 'neveljavna referenca — px in cm morata biti večja od 0' : 'izberite 2 točki + vnesite realno razdaljo'}</span>
                )}
              </div>
              {/* R457 (§4): metoda kalibracije + referenčni objekt */}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="km-calib-method" className="text-xs">Metoda kalibracije (§4)</Label>
                  <Select value={calibMethod} onValueChange={(v) => setCalibMethod(v as CalibrationMethod)}>
                    <SelectTrigger id="km-calib-method" className="h-9" aria-label="Metoda kalibracije"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CALIB_METHODS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label} — {m.desc}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="km-calib-ref" className="text-xs">Referenčni objekt</Label>
                  <Input id="km-calib-ref" className="h-9" value={refObject} onChange={(e) => setRefObject(e.target.value)} placeholder="npr. vrata 110 cm / marker 20 cm" />
                </div>
              </div>
              {!view.calib ? (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    Najprej kliknite na sliko in označite 2 točki znane razdalje (npr. rob stopnice, širina vrat), nato ju izberite spodaj.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="km-calib-a" className="text-xs">1. točka</Label>
                      <Select value={calibA !== null ? String(calibA) : 'none'} onValueChange={(v) => setCalibA(v === 'none' ? null : Number(v))}>
                        <SelectTrigger id="km-calib-a" className="h-9 w-28" aria-label="Prva točka kalibracije"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {view.points.map((p, i) => <SelectItem key={i} value={String(i)}>Točka {i + 1}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="km-calib-cm" className="text-xs">Realna razdalja (cm)</Label>
                      <Input id="km-calib-cm" className="h-9 w-32" type="number" min="1" inputMode="decimal" value={calibCm} onChange={(e) => setCalibCm(e.target.value)} placeholder="npr. 110" />
                    </div>
                    <Button
                      size="sm" className="h-9"
                      disabled={calibA === null || !(Number(calibCm) > 0) || view.points.length < 2}
                      onClick={() => {
                        const a = view.points[calibA ?? 0]
                        const b = view.points[calibA === view.points.length - 1 ? calibA - 1 : (calibA ?? 0) + 1]
                        if (!a || !b) return
                        const d = px(a, b)
                        if (d > 0) {
                          snapshot()
                          setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: { px: Math.round(d), cm: Number(calibCm) } } : v)))
                        }
                      }}
                    >
                      <Ruler className="size-4" aria-hidden /> Kalibriraj
                    </Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={onClose}>Prekliči</Button>
            <Button onClick={() => setPhase(3)}>
              Naprej — meritev {view.calib ? '' : '(brez kalibracije — dolžine v px)'}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ══ FAZA 3: MERITEV (točke + pogoji + predlogi + več pogledov) ══ */}
      {phase === 3 && view ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* R455: undo/redo (§4) */}
            <Button size="sm" variant="outline" onClick={undo} disabled={past.current.length === 0} aria-label="Razveljavi">
              <Undo2 className="size-4" aria-hidden /> Razveljavi
            </Button>
            <Button size="sm" variant="outline" onClick={redo} disabled={future.current.length === 0} aria-label="Uveljavi">
              <Redo2 className="size-4" aria-hidden /> Uveljavi
            </Button>
            <Button size="sm" variant="outline" onClick={() => { snapshot(); setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, points: v.points.filter((p) => p.src !== 'PREDLOG') } : v))) }} disabled={rocnoCnt === 0}>
              <Eraser className="size-4" aria-hidden /> Počisti točke
            </Button>
            <Button size="sm" variant="outline" onClick={() => void detect()} disabled={detecting || !view.photoId}>
              {detecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {detecting ? 'VLM …' : 'Zaznaj samodejno'}
            </Button>
            {/* R455: dodatni pogled (§3) — R487 (issue #3): gumb odpre panel z
                DVEMA potema — terenska (kamera/datoteka) in izbira obstoječe
                FOTO projekta (isti vzorec kot 1. pogled) */}
            {views.length < MAX_VIEWS ? (
              <Button size="sm" variant="outline" onClick={() => setAddingView((a) => !a)} aria-expanded={addingView}>
                <SquarePlus className="size-4" aria-hidden /> Dodaj pogled ({views.length}/{MAX_VIEWS})
              </Button>
            ) : null}
          </div>

          {/* R487 (issue #3): panel dodajanja pogleda — terenska pot OSTANE
              (file/capture input) + alternativna izbira obstoječe FOTO */}
          {addingView && views.length < MAX_VIEWS ? (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-sm font-medium">Dodaj pogled istega objekta</p>
              <p className="text-[11px] text-muted-foreground">
                Vsak pogled ima svojo kalibracijo in točke — označite iste točke kot na prvem pogledu; pogledi se primerjajo v koraku Preverjanje.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => fileViewRef.current?.click()}>
                  <Camera className="size-4" aria-hidden /> Posnemi / naloži iz telefona
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingView(false)}>Prekliči</Button>
              </div>
              <input ref={fileViewRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { setAddingView(false); void onFileView(e.target.files?.[0]); e.target.value = '' }} aria-label="Dodaj fotografijo istega objekta" />
              {existingPhotos.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">Ali izberi obstoječo fotografijo:</p>
                  <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="list">
                    {existingPhotos.map((p) => (
                      <button key={p.id} type="button" onClick={() => pickExistingView(p)} className="group overflow-hidden rounded-lg border text-left transition hover:border-roksal-amber" role="listitem">
                        <img src={parsePhoto(p.params) ?? ''} alt={`Fotografija ${p.location ?? 'brez lokacije'}`} className="h-16 w-full object-cover" />
                        <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground group-hover:text-foreground">
                          {p.location ?? p.project?.code ?? fmtDate(p.createdAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* R457 (§2): vodilo načina za označevanje */}
          <p className="rounded-lg bg-muted/60 px-3 py-1.5 text-[11px] text-muted-foreground" role="note">
            <strong className="text-foreground">{MODE_RULES[mode].label}:</strong> {MODE_RULES[mode].hint}
          </p>

          {/* R455: zavihki pogledov */}
          {views.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Pogledi meritve">
              {views.map((v, i) => (
                <button
                  key={v.key} type="button" role="tab" aria-selected={i === activeView}
                  onClick={() => { setActiveView(i); setCalibA(null) }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${i === activeView ? 'border-roksal-amber bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'text-muted-foreground hover:border-foreground/30'}`}
                >
                  Pogled {i + 1}
                  {v.calib ? ' ✓' : ' ⚠'}
                  {i === 0 ? ' (glavni)' : ''}
                </button>
              ))}
            </div>
          ) : null}

          {/* R455: predlogi VLM — vizualno ločeni, zahtevajo potrditev (§2) */}
          {predlogi.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/40" role="status">
              <p className="text-xs font-medium text-sky-900 dark:text-sky-200">
                {predlogi.length} samodejnih predlogov točk — niso potrjeni in ne štejejo v izračun.
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="h-8" onClick={acceptPredloge}><Check className="size-3.5" aria-hidden /> Sprejmi vse</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={rejectPredloge}><Trash2 className="size-3.5" aria-hidden /> Zavrzi</Button>
              </div>
            </div>
          ) : null}

          <div className="mx-auto inline-block max-w-full rounded-lg border bg-muted/40 p-1">
            <div
              ref={imgBoxRef}
              className="relative inline-block cursor-crosshair" onClick={onImageClick}
              role="application" aria-label="Slika za označevanje merilnih točk — klik dodaja točko, vlečenje premika, klik na točko briše"
            >
              <img src={view.dataUrl} alt="Teren za merjenje" className="block h-auto max-h-[420px] w-auto max-w-full select-none" draggable={false} />
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
                {calc.pts.length > 1 ? (
                  <polyline
                    points={calc.pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="#d97706" strokeWidth={2} vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
              {view.points.map((p, i) => (
                <button
                  key={`${i}-${p.x.toFixed(4)}`}
                  type="button"
                  title={p.src === 'PREDLOG' ? `PREDLOG: ${p.label ?? 'samodejna točka'} — sprejmite ali zavrzi` : `${p.label ?? `Točka ${i + 1}`} — klik za brisanje, vleci za premik`}
                  aria-label={p.src === 'PREDLOG' ? `Predlog točke ${i + 1}${p.label ? ` ${p.label}` : ''}` : `Točka ${i + 1}${p.label ? ` ${p.label}` : ''} — klik za brisanje, vlečenje za premik`}
                  onPointerDown={(e) => onPointDown(e, i)}
                  onPointerMove={onPointMove}
                  onPointerUp={() => onPointUp(i)}
                  onPointerCancel={() => { dragRef.current = null; setLens(null) }}
                  className={`absolute size-7 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 text-[10px] font-bold leading-none ${p.src === 'PREDLOG'
                    ? 'border-dashed border-sky-700 bg-sky-400/80 text-white'
                    : calibA === i
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-amber-600 bg-amber-500 text-white'}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                >
                  <span className="flex size-full items-center justify-center">{i + 1}</span>
                </button>
              ))}
            </div>
          </div>

          {/* R455: povečevalno steklo med vlečenjem (§4) */}
          {lens && view ? (
            <div
              className="pointer-events-none fixed z-50 size-28 rounded-full border-2 border-amber-500 bg-cover shadow-xl"
              aria-hidden
              style={{
                left: `${Math.min(window.innerWidth - 120, lens.x + 24)}px`,
                top: `${Math.max(8, lens.y - 130)}px`,
                backgroundImage: `url(${view.dataUrl})`,
                backgroundSize: `${(imgBoxRef.current?.clientWidth ?? 300) * 3}px auto`,
                backgroundPosition: `${lens.x - (imgBoxRef.current?.getBoundingClientRect().left ?? 0) - 48}px ${lens.y - (imgBoxRef.current?.getBoundingClientRect().top ?? 0) - 48}px`,
              }}
            >
              <span className="absolute inset-0 m-auto size-5 rounded-full border border-amber-600/70" />
            </div>
          ) : null}

          {/* kalibracija pogleda (kompaktno — za dodatne poglede / popravke) */}
          <Card>
            <CardContent className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Crosshair className="size-4 text-roksal-amber" aria-hidden /> Kalibracija {views.length > 1 ? `— pogled ${activeView + 1}` : ''}
                  {view.calib ? (
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2" aria-pressed={view.calibLocked}
                      onClick={() => { snapshot(); setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calibLocked: !v.calibLocked } : v))) }}
                    >
                      {view.calibLocked ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
                      {view.calibLocked ? 'zaklenjeno' : 'zakleni'}
                    </Button>
                  ) : null}
                </p>
                {calc.cmPerPx !== null ? (
                  <span className="text-xs text-muted-foreground">1 px = {fmt1(calc.cmPerPx)} cm{!view.calibLocked ? (
                    <Button size="sm" variant="ghost" className="ml-2 h-7 px-2" onClick={() => { snapshot(); setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: null } : v))) }}>
                      <Trash2 className="size-3.5" aria-hidden /> ponastavi
                    </Button>
                  ) : null}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">{view.calib ? 'neveljavna referenca — px in cm morata biti večja od 0' : 'označite 2 točki znane razdalje na sliki, ju izberite in kalibrirajte'}</span>
                )}
              </div>
              {!view.calib ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="km-calib-a2" className="text-xs">1. točka</Label>
                    <Select value={calibA !== null ? String(calibA) : 'none'} onValueChange={(v) => setCalibA(v === 'none' ? null : Number(v))}>
                      <SelectTrigger id="km-calib-a2" className="h-9 w-28" aria-label="Prva točka kalibracije"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {view.points.map((p, i) => <SelectItem key={i} value={String(i)}>Točka {i + 1}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-calib-cm2" className="text-xs">Realna razdalja (cm)</Label>
                    <Input id="km-calib-cm2" className="h-9 w-32" type="number" min="1" inputMode="decimal" value={calibCm} onChange={(e) => setCalibCm(e.target.value)} placeholder="npr. 110" />
                  </div>
                  <Button
                    size="sm" className="h-9"
                    disabled={calibA === null || !(Number(calibCm) > 0) || view.points.length < 2}
                    onClick={() => {
                      const a = view.points[calibA ?? 0]
                      const b = view.points[calibA === view.points.length - 1 ? calibA - 1 : (calibA ?? 0) + 1]
                      if (!a || !b) return
                      const d = px(a, b)
                      if (d > 0) {
                        snapshot()
                        setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: { px: Math.round(d), cm: Number(calibCm) } } : v)))
                      }
                    }}
                  >
                    <Ruler className="size-4" aria-hidden /> Kalibriraj
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* izračun */}
          {calc.pts.length >= 2 ? (
            <Card>
              <CardContent className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Izračun {calc.cmPerPx ? '' : '(px — brez kalibracije)'}</p>
                  <Button size="sm" variant={stairMode ? 'default' : 'outline'} className="h-8" onClick={() => setStairMode((s) => !s)} aria-pressed={stairMode}>
                    Stopnišče {stairMode ? 'vklop' : 'izklop'}
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th scope="col" className="py-1.5 pr-3 font-medium">Točki</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Dolžina</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Kot</th>
                        <th scope="col" className="py-1.5 font-medium">Δ višine</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calc.segs.map((s) => (
                        <tr key={s.i} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 font-mono">{s.i + 1} → {s.j + 1}</td>
                          <td className="py-1.5 pr-3 font-semibold">{s.cmLen !== null ? `${fmt1(s.cmLen)} cm` : `${Math.round(s.pxLen)} px`}</td>
                          <td className="py-1.5 pr-3">{fmt1(Math.abs(s.angleDeg))}°</td>
                          <td className="py-1.5">{s.dVCm !== null ? `${s.dVCm > 0 ? '+' : ''}${fmt1(s.dVCm)} cm` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>Skupaj: <strong className="text-foreground">{calc.totalCm !== null ? `${fmt1(calc.totalCm / 100)} m` : `${Math.round(calc.totalPx)} px`}</strong></span>
                  {views.length > 1 && multi.mean !== null ? <span>Povprečje {views.length} pogledov: <strong className="text-foreground">{fmt1(multi.mean / 100)} m</strong></span> : null}
                </div>
                {/* R501 (issue #15 faza 2): enako pojasnilo merila kot na strežniku
                    — jedro (resolveScale) pove, KAJ je dokazano in kaj predpostavljeno. */}
                <p className={`text-[11px] ${calc.scale.known && calc.scale.isotropicProven ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {merilaPasus(calc.scale)}
                </p>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              title={predlogi.length > 0 ? 'Sprejmite ali zavrzite predloge, ali označite točke' : 'Označite točke'}
              desc="Kliknite na sliko: vogali ograje, robovi stopnic, tla ob stebrih … Klik na točko jo izbriše, vlečenje jo premika (s povečevalnim steklom)."
              icon={Crosshair}
            />
          )}

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setPhase(2)}><Undo2 className="size-4" aria-hidden /> Nazaj na kalibracijo</Button>
            <Button onClick={() => setPhase(4)} disabled={rocnoCnt < 2}>
              Naprej — preverjanje
            </Button>
          </div>
        </div>
      ) : null}

      {/* ══ FAZA 4: PREVERJANJE (primerjava pogledov + zaupanje + strežnik) ══ */}
      {phase === 4 && view ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Preverjanje meritve</p>
                {/* R455: stopnja zaupanja (§3) */}
                <Badge className={multi.label === 'DOBRO'
                  ? 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : multi.label === 'OPOZORILO'
                    ? 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                    : 'border-transparent bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-300'}>
                  Zaupanje: {multi.conf} % · {multi.label}
                </Badge>
              </div>

              {/* primerjava pogledov (§3) */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="py-1.5 pr-3 font-medium">Pogled</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">Dolžina</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">Točk</th>
                      <th scope="col" className="py-1.5 font-medium">Δ od povprečja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {multi.per.map((x, i) => {
                      const cm = x.c.totalCm
                      const delta = cm !== null && multi.mean ? ((cm - multi.mean) / multi.mean) * 100 : null
                      return (
                        <tr key={x.v.key} className="border-b last:border-0">
                          <td className="py-1.5 pr-3">{i + 1}{i === 0 ? ' (glavni)' : ''}</td>
                          <td className="py-1.5 pr-3 font-semibold">{cm !== null ? `${fmt1(cm / 100)} m` : '— px'}</td>
                          <td className="py-1.5 pr-3">{x.c.pts.length}</td>
                          <td className="py-1.5">{delta !== null ? `${delta > 0 ? '+' : ''}${fmt1(delta)} %` : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {multi.lengths.length > 1 ? (
                <p className="text-xs text-muted-foreground">
                  Povprečje {fmt1((multi.mean ?? 0) / 100)} m · razpršenost {multi.spreadPct !== null ? `${fmt1(multi.spreadPct)} %` : '—'}
                  {multi.spreadPct !== null && multi.spreadPct > 5
                    ? ' — ⚠ ocene se preveč razlikujejo: popravite točke ali kalibracijo na pogledih, ali vnesite lasersko meritev z razlogom v koraku Potrditev — potrditev je blokirana, dokler razhajanje ni rešeno'
                    : multi.spreadPct !== null && multi.spreadPct <= 2 ? ' — pogledi se odlično strinjajo' : ''}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">En sam pogled — za večjo zanesljivost dodajte še eno fotografijo istega objekta (v koraku Meritev).</p>
              )}

              {view.quality && !view.quality.ok ? (
                <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  ⚠ Kakovost zajema: {view.quality.blurry ? 'mehka slika ' : ''}{view.quality.dark ? 'temna ' : ''}{view.quality.bright ? 'presočena ' : ''}
                  — preverite točke na povečavi ali posnemite znova.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void verifyServer()} disabled={!view.calib || busy}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />} Preveri na strežniku
                </Button>
                {serverLayout ? <span className="text-xs text-muted-foreground">{serverLayout}</span> : null}
              </div>
            </CardContent>
          </Card>

          {/* R457: domenske možnosti + kanonična analiza engine-a (§8–§11, §13–§15) */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Merilni engine — {MODE_RULES[mode].label}</p>
                <Button size="sm" onClick={() => void runEngine()} disabled={analyzing || !view.calib || calc.pts.length < 2}>
                  {analyzing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
                  {analyzing ? 'Analiziram …' : 'Analiziraj (engine)'}
                </Button>
              </div>

              {/* domenske možnosti po načinu (§8–§11) */}
              {mode === 'OGRAJA' ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="km-maxspan" className="text-xs">Razmak stebrov (cm)</Label>
                    <Input id="km-maxspan" className="h-9" type="number" min="40" max="300" inputMode="numeric" value={maxSpanS} onChange={(e) => setMaxSpanS(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-height-eng" className="text-xs">Višina polnila (cm)</Label>
                    <Input id="km-height-eng" className="h-9" type="number" min="20" inputMode="numeric" value={heightS} onChange={(e) => setHeightS(e.target.value)} />
                  </div>
                </div>
              ) : null}
              {mode === 'KERAMIKA' ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="space-y-1">
                    <Label htmlFor="km-tilew" className="text-xs">Ploščica Š (cm)</Label>
                    <Input id="km-tilew" className="h-9" type="number" min="1" inputMode="numeric" value={tileW} onChange={(e) => setTileW(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-tileh" className="text-xs">Ploščica V (cm)</Label>
                    <Input id="km-tileh" className="h-9" type="number" min="1" inputMode="numeric" value={tileH} onChange={(e) => setTileH(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-joint" className="text-xs">Fuga (mm)</Label>
                    <Input id="km-joint" className="h-9" type="number" min="0" max="30" inputMode="numeric" value={jointMm} onChange={(e) => setJointMm(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-pattern" className="text-xs">Vzorec</Label>
                    <Select value={pattern} onValueChange={(v) => setPattern(v as 'PRAVOKOTNO' | 'DIAGONALNO')}>
                      <SelectTrigger id="km-pattern" className="h-9" aria-label="Vzorec polaganja"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PRAVOKOTNO">Pravokotno</SelectItem>
                        <SelectItem value="DIAGONALNO">Diagonalno</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-opcount" className="text-xs">Odprtine (Š×V, št.)</Label>
                    <div className="flex gap-1">
                      <Input id="km-opcount" className="h-9" type="number" min="0" inputMode="numeric" value={opCount} onChange={(e) => setOpCount(e.target.value)} />
                      <Input aria-label="Širina odprtine" className="h-9 w-14" type="number" min="1" inputMode="numeric" value={opW} onChange={(e) => setOpW(e.target.value)} />
                      <Input aria-label="Višina odprtine" className="h-9 w-14" type="number" min="1" inputMode="numeric" value={opH} onChange={(e) => setOpH(e.target.value)} />
                    </div>
                  </div>
                </div>
              ) : null}
              {mode === 'STREHA' ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="km-pitch" className="text-xs">Naklon strehe (°)</Label>
                    <Input id="km-pitch" className="h-9" type="number" min="0" max="84" inputMode="numeric" value={pitchDeg} onChange={(e) => setPitchDeg(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-roofmat" className="text-xs">Kritina</Label>
                    <Select value={roofMaterial} onValueChange={(v) => setRoofMaterial(v as 'BETONNA' | 'KOVINSKA')}>
                      <SelectTrigger id="km-roofmat" className="h-9" aria-label="Kritina"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BETONNA">Betonska (odpad 10 %)</SelectItem>
                        <SelectItem value="KOVINSKA">Kovinska (odpad 7 %)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
              {mode === 'FASADA' ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="km-opw-f" className="text-xs">Okna/vrata Š (cm)</Label>
                    <Input id="km-opw-f" className="h-9" type="number" min="1" inputMode="numeric" value={opW} onChange={(e) => setOpW(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-oph-f" className="text-xs">Okna/vrata V (cm)</Label>
                    <Input id="km-oph-f" className="h-9" type="number" min="1" inputMode="numeric" value={opH} onChange={(e) => setOpH(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-opcount-f" className="text-xs">Število odprtin</Label>
                    <Input id="km-opcount-f" className="h-9" type="number" min="0" inputMode="numeric" value={opCount} onChange={(e) => setOpCount(e.target.value)} />
                  </div>
                </div>
              ) : null}
              {mode === 'STOPNICE' ? (
                <div className="max-w-56 space-y-1">
                  <Label htmlFor="km-steps" className="text-xs">Število stopnic (neobvezno — sicer ocena po 17 cm)</Label>
                  <Input id="km-steps" className="h-9" type="number" min="1" inputMode="numeric" value={stepsS} onChange={(e) => setStepsS(e.target.value)} placeholder="npr. 14" />
                </div>
              ) : null}

              {analysis ? (
                <>
                  {/* §14 geometrijska kontrola */}
                  <div className="space-y-1">
                    <p className="text-xs font-semibold">Geometrijska kontrola (§14)</p>
                    {analysis.validation.length === 0 ? (
                      <p className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300"><Check className="size-3.5" aria-hidden /> Brez ugotovitev — geometrija v redu.</p>
                    ) : (
                      <ul className="space-y-1">
                        {analysis.validation.map((iss, k) => (
                          <li key={k} className={`flex items-start gap-1.5 text-[11px] ${iss.severity === 'NAPAKA' ? 'text-red-700 dark:text-red-300' : iss.severity === 'OPOZORILO' ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground'}`}>
                            <span aria-hidden>{iss.severity === 'NAPAKA' ? '✗' : iss.severity === 'OPOZORILO' ? '⚠' : 'ℹ'}</span>
                            <span>{iss.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {/* §13 confidence */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={analysis.confidence.band === 'VISOK'
                      ? 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : analysis.confidence.band === 'SREDNJI'
                        ? 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                        : 'border-transparent bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-300'}>
                      Engine zaupanje: {analysis.confidence.confidence} % · {analysis.confidence.band}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{analysis.confidence.reasons.join(' · ')}</span>
                  </div>
                  {/* §8–§11 domenski rezultat */}
                  <div>
                    <p className="mb-1 text-xs font-semibold">Domenski izračun — {MODE_RULES[analysis.domain.mode].label}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <tbody>
                          {domainRows(analysis.domain).map(([k, v]) => (
                            <tr key={k} className="border-b last:border-0">
                              <td className="py-1 pr-3 text-muted-foreground">{k}</td>
                              <td className="py-1 font-semibold">{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Pritisnite »Analiziraj (engine)« za kanonično preverjeno analizo: geometrija, §14 validacija, zaupanje in domenski izračun ({MODE_RULES[mode].label}).
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setPhase(3)}><Undo2 className="size-4" aria-hidden /> Nazaj na točke</Button>
            <Button onClick={() => setPhase(5)}>Naprej — potrditev</Button>
          </div>
        </div>
      ) : null}

      {/* ══ FAZA 5: POTRDITEV ══ */}
      {phase === 5 && view ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2 p-3 text-sm">
              <p className="font-semibold">Povzetek meritve</p>
              <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <span>Način: <strong className="text-foreground">{MODE_RULES[mode].label}</strong></span>
                <span>Dolžina: <strong className="text-foreground">{finalLengthCm !== null ? `${fmt1(finalLengthCm / 100)} m` : '—'}</strong></span>
                <span>Segmentov: <strong className="text-foreground">{calc.segs.length}</strong></span>
                <span>Zaupanje: <strong className="text-foreground">{multi.conf} % ({multi.label}){analysis ? ` · engine ${analysis.confidence.confidence} %` : ''}</strong></span>
                <span>Pogledov: <strong className="text-foreground">{views.length}</strong></span>
                <span>Analiza engine-a: <strong className="text-foreground">{analysis ? (analysis.validation.some((i) => i.severity === 'NAPAKA') ? '⚠ napake — preveri' : '✓ opravljena') : 'ni opravljena'}</strong></span>
                <span>Fotografija: <strong className="text-foreground">{views[0].photoId ? `✓ (${rocnoCnt} točk)` : online ? 'ni shranjena' : 'shranila se bo ob sinhronizaciji'}</strong></span>
                {multi.spreadPct !== null ? <span>Razpršenost: <strong className="text-foreground">{fmt1(multi.spreadPct)} %</strong></span> : null}
              </div>
              {/* R500 (issue #15 faza 1): KAJ je dokazano — po posamezni količini.
                  Brez te vrstice bi povzetek dajal vtis, da je vsaka številka na
                  zaslonu enako zanesljiva poslovna mera. */}
              {analysis ? (
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-[11px]">
                  <p className="font-semibold text-foreground">
                    {analysis.validity.status === 'VELJAVNA'
                      ? `Merilo ${(analysis.scale.cmPerPxX ?? 0).toFixed(2).replace('.', ',')} cm/px: dokazano za merjene količine`
                      : analysis.validity.status === 'NEZADOSTNI_PODATKI'
                        ? '⚠ Podatki ne zadoščajo — številke so okvirne, ne potrjena poslovna mera'
                        : '⚠ Geometrija v neskladju — popravite točke ali kalibracijo'}
                  </p>
                  <p className="text-muted-foreground">
                    {analysis.validity.quantities.map((q) => `${KOLICINA_LABEL[q.quantity]}: ${KOLICINA_STATE_LABEL[q.state]}`).join(' · ')}
                  </p>
                  {analysis.validity.reasons.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {analysis.validity.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {!views[0].photoId && online ? (
                <Button size="sm" variant="outline" onClick={() => void uploadPhoto()} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Najprej naloži fotografijo
                </Button>
              ) : null}
              {!views[0].photoId && !online ? (
                <p className="text-[11px] text-muted-foreground">
                  Brez povezave — fotografija in meritev se shranita lokalno ter pošljeta ob sinhronizaciji.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* R487 (issue #3 §4C): konflikt pogledov — VRATA potrditve. Razhajanje
              > 5 % je VIDNO in blokira POTRDI, dokler ni rešeno (popravek
              točk/kalibracije → strinjanje, ali ročna laserska mera z razlogom). */}
          {conflictBlocked ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/40" role="alert">
              <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                ⚠ Pogledi se razlikujejo za {fmt1(multi.spreadPct ?? 0)} % — potrditev je blokirana.
              </p>
              <p className="mt-1 text-xs text-red-800 dark:text-red-300">
                Popravite točke ali kalibracijo na pogledih (korak Meritev), ali izrecno potrdite razhajanje: vnesite lasersko meritev z razlogom prek »Ročno popravi dolžino« spodaj.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Tip</Label>
              <Select value={type} onValueChange={setType} disabled={stairMode}>
                <SelectTrigger aria-label="Tip meritve"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OGRAJA">Ograja</SelectItem>
                  <SelectItem value="BALUSTRADA">Balustrada</SelectItem>
                  <SelectItem value="NAGIB">Nagib</SelectItem>
                  <SelectItem value="OSTANEO">Ostalo</SelectItem>
                </SelectContent>
              </Select>
              {stairMode ? <p className="text-[11px] text-muted-foreground">Stopniški način → tip NAGIB</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="km-height">Višina (cm)</Label>
              <Input id="km-height" type="number" min="20" inputMode="numeric" value={heightS} onChange={(e) => setHeightS(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="km-note">Opomba</Label>
              <Input id="km-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opombe s terena …" />
            </div>
          </div>

          {/* R455: ročni popravek dolžine z obveznim razlogom (§1 — sledljivost) */}
          <Card>
            <CardContent className="space-y-2 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox" className="size-4 accent-amber-600" checked={overrideOn}
                  onChange={(e) => { setOverrideOn(e.target.checked); if (e.target.checked && !overrideLen && finalLengthCm !== null) setOverrideLen((finalLengthCm / 100).toFixed(2)) }}
                />
                Ročno popravi dolžino (npr. iz merilnega traku)
              </label>
              {overrideOn ? (
                <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                  <div className="space-y-1">
                    <Label htmlFor="km-override" className="text-xs">Dolžina (m)</Label>
                    <Input id="km-override" type="number" min="0.1" step="any" inputMode="decimal" value={overrideLen} onChange={(e) => setOverrideLen(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-override-reason" className="text-xs">Razlog (obvezen — sledljivost)</Label>
                    <Input id="km-override-reason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="npr. izmerjeno z laserjem na kraju samem" />
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => setPhase(4)}><Undo2 className="size-4" aria-hidden /> Nazaj na preverjanje</Button>
            <div className="flex flex-wrap gap-2">
              {/* R439 (issue #6): brez signala — shrani v vrsto (foto + meritev) */}
              {!online ? (
                <Button
                  variant="outline" className="border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950"
                  onClick={() => void saveOffline()} disabled={busy || !view.dataUrl || conflictBlocked}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CloudUpload className="size-4" aria-hidden />}
                  Shrani (offline)
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void confirm(true)} disabled={busy || !views[0].photoId || finalLengthCm === null || conflictBlocked}>
                Shrani in meri naprej na isti fotografiji
              </Button>
              <Button onClick={() => void confirm(false)} disabled={busy || !views[0].photoId || finalLengthCm === null || conflictBlocked}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                Potrdi in shrani meritev
              </Button>
            </div>
          </DialogFooter>
        </div>
      ) : null}

      {phase === 1 && !camActive ? (
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zapri</Button>
        </DialogFooter>
      ) : null}
      </DialogContent>
    </Dialog>
  )
}

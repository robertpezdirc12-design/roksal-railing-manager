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
// Monter (measurements.write) vidi vse; skladiščnik/proizvodnja samo zgodovino.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import {
  Camera, CameraOff, Download, History, ImageIcon, Lightbulb, Loader2, Lock, LockOpen, Move, ScanLine,
  Save, Sparkles, Trash2, Video, Waypoints, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiGet, apiPost, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import SceneOverlay from '@/components/roksal/scene-overlay'
import { useSceneUnderstanding } from '@/hooks/use-scene-understanding'
import {
  SCENE_CLASSES, SURFACE_KINDS, applyEdits,
  type SceneClass, type SceneEdit, type SceneElement, type SurfaceKind,
} from '@/lib/scene-understanding-core'
import { hasPerm } from '@/lib/permissions-core'

const ANTHRACITE = '#2b2f36'
const OVERLAY_W = 320
const OVERLAY_H = 220
const DEMO_GRAD = 'linear-gradient(160deg, #e7e5e4 0%, #a8a29e 55%, #78716c 100%)'

type Mode = 'off' | 'on' | 'demo'

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
  const sceneState = useSceneUnderstanding(videoRef, mode === 'on')
  const [sceneSelectedId, setSceneSelectedId] = useState<string | null>(null)
  const [sceneEdits, setSceneEdits] = useState<SceneEdit[]>([])
  /** elementi z apliciranimi popravki (za prikaz/detalj) */
  const sceneDisplayed = sceneState.elements.length > 0
    ? applyEdits({ version: 1, at: Date.now(), elements: sceneState.elements, edits: sceneEdits })
    : []
  const sceneSelected = sceneDisplayed.find((e) => e.id === sceneSelectedId) ?? null
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

  // R454: AI analiza prizora
  const [analysis, setAnalysis] = useState<ArAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  // R454: zgodovina AR posnetkov (projects.read — tudi za skladišče/proizvodnjo)
  const snapshots = useApi<{ data: SnapshotRow[] }>('/api/ar-snapshots', [])
  const [detail, setDetail] = useState<{ row: SnapshotRow; photo: string | null; analysis: ArAnalysis | null } | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

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

  // POČIŠČENJE: ob odklopu ustavi vse steze kamere + morebitni rAF glajenja
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
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
      let snapSaved = false
      try {
        await apiPost('/api/ar-snapshots', {
          projectId: projectId !== 'none' ? projectId : null,
          scene: analysis?.scene ?? null,
          analysis: analysis ? JSON.stringify(analysis) : null,
          params: JSON.stringify({ photo, posts, heightCm, scale, opacity, mode, ...sourceInfo }),
          note: (note.trim() || null) as string | null,
          ...(sceneDisplayed.length > 0
            ? { sceneUnderstanding: { version: 1, at: Date.now(), elements: sceneDisplayed, edits: sceneEdits } }
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
  async function viewSnapshot (row: SnapshotRow): Promise<void> {
    if (detail?.row.id === row.id) { setDetail(null); return }
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
      setDetail({ row, photo, analysis: parseAnalysis(res.data.analysis) })
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
                />

                {/* R467 (issue #8 F1): žive zaznave prizora — samo z živo kamero;
                    POD ograjinim overlayjem (ograja ostane glavni interakcijski objekt) */}
                {mode === 'on' && sceneDisplayed.length > 0 ? (
                  <SceneOverlay
                    elements={sceneDisplayed}
                    quality={sceneState.quality}
                    selectedId={sceneSelectedId}
                    onSelect={(el) => { setSceneSelectedId(el.id === sceneSelectedId ? null : el.id) }}
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

              <p className="text-xs text-muted-foreground">
                {mode === 'demo'
                  ? 'Kamera ni na voljo — predogled na demo ozadju. Zajem shrani enak sestavek (demo ozadje + ograja).'
                  : 'Ograjo premikajte z vlečenjem po predogledu; velikost in prosojnost nastavite z drsnikoma levo.'}
              </p>

              {/* R467 (issue #8 F1 §2): popravek zaznanega elementa — OZNAČEN PODATEK,
                  izvirni zajem ostaja; shrani se z naslednjim AR posnetkom */}
              {mode === 'on' && sceneSelected ? (
                <div className="rounded-lg border bg-secondary/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      Zaznan element: {sceneSelected.cls}
                      {sceneSelected.kind ? ` · ${sceneSelected.kind}` : ''}
                    </p>
                    <Badge variant="outline" className="text-[10px]">
                      vir: {sceneSelected.source === 'ROCNO' ? 'ročno potrjeno' : sceneSelected.source === 'VLM' ? 'AI predlog' : 'lokalna hevristika'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Popravek se shrani kot označen podatek ob zajemu AR posnetka — izvirna zaznava ostane nespremenjena.
                  </p>
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
                          <img src={detail.photo} alt={`AR posnetek — ${row.scene ?? 'brez opisa'}`} className="w-full rounded-lg border" />
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

'use client'

// MERITVE S KAMERO (issue #1) — večtočkovne meritve na fotografiji:
// zajem/nalaganje fotografije → označevanje točk → kalibracija merila →
// izračun dolžin/kotov/višin v živo → VLM samodejna zaznava → potrditev in
// shranjevanje v projekt/nalog (POST /api/measurement/confirm).
// Več meritev na isti fotografiji; ročni obrazec v meritve.tsx ostane fallback.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, Crosshair, Eraser, Image as ImageIcon, Loader2, Ruler, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { apiPost, fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox } from '@/components/roksal/ui-bits'

interface Pt { x: number; y: number; label?: string }
interface PhotoRow {
  id: string; type: string; location: string | null; params: string | null; createdAt: string
  project: { code: string } | null
}
interface ProjectOption { id: string; code: string; title: string }
interface WorkOrderOption { id: string; code: string; title: string }

const MAX_IMG_W = 1600

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

function parsePhoto (params: string | null): string | null {
  if (!params) return null
  try {
    const p = JSON.parse(params) as { photo?: unknown }
    return typeof p.photo === 'string' && p.photo.startsWith('data:image/') ? p.photo : null
  } catch { return null }
}

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',')

export function KameraMeritevDialog ({ open, onClose, onSaved }: {
  open: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { toast } = useToast()

  // faza 1: fotografija + povezave
  const [phase, setPhase] = useState<1 | 2 | 3>(1)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [photoId, setPhotoId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [projectId, setProjectId] = useState('none')
  const [workOrderId, setWorkOrderId] = useState('none')
  const [location, setLocation] = useState('')
  const [camActive, setCamActive] = useState(false)

  // faza 2: točke + kalibracija
  const [points, setPoints] = useState<Pt[]>([])
  const [imgW, setImgW] = useState(1)
  const [imgH, setImgH] = useState(1)
  const [calib, setCalib] = useState<{ px: number; cm: number } | null>(null)
  const [calibA, setCalibA] = useState<number | null>(null) // indeks prve točke kalibracije
  const [calibCm, setCalibCm] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [stairMode, setStairMode] = useState(false)
  const [serverLayout, setServerLayout] = useState<string | null>(null)

  // faza 3: potrditev
  const [type, setType] = useState('OGRAJA')
  const [heightS, setHeightS] = useState('100')
  const [note, setNote] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const projects = useApi<{ data: ProjectOption[] }>(open ? '/api/projects' : null, [open])
  const orders = useApi<{ data: WorkOrderOption[] }>(open ? '/api/nalog?scope=open' : null, [open])
  const photos = useApi<{ data: PhotoRow[] }>(open ? '/api/measurements?type=FOTO' : null, [open])

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
    acceptImage(url)
  }

  async function onFile (f: File | undefined): Promise<void> {
    if (!f) return
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(f)
    })
    acceptImage(await shrinkToDataUrl(url))
  }

  /** Nastavi sliko in ponastavi označevanje. */
  function acceptImage (url: string): void {
    setDataUrl(url)
    setPoints([]); setCalib(null); setCalibA(null); setCalibCm(''); setServerLayout(null)
    const img = new Image()
    img.onload = () => { setImgW(img.naturalWidth); setImgH(img.naturalHeight) }
    img.src = url
    setPhase(2)
  }

  /** Izbere obstoječo FOTO meritev. */
  function pickExisting (p: PhotoRow): void {
    const url = parsePhoto(p.params)
    if (!url) return
    setPhotoId(p.id)
    setLocation(p.location ?? '')
    acceptImage(url)
  }

  /** Naloži novo fotografijo (POST /api/measure/photo). */
  async function uploadPhoto (): Promise<void> {
    if (!dataUrl) return
    setBusy(true)
    try {
      const res = await apiPost<{ data: { id: string } }>('/api/measure/photo', {
        dataUrl,
        location: location.trim() || null,
        projectId: projectId !== 'none' ? projectId : null,
        workOrderId: workOrderId !== 'none' ? workOrderId : null,
      })
      setPhotoId(res.data.id)
      toast({ title: 'Fotografija shranjena.', description: 'Zdaj označite merilne točke.' })
    } catch (e) {
      toast({ title: 'Napaka pri nalaganju fotografije', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  // klik na sliko → točka (normalizirano 0..1)
  function onImageClick (e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    setPoints((ps) => [...ps, { x, y }])
    setServerLayout(null)
  }

  function removePoint (i: number): void {
    setPoints((ps) => ps.filter((_, k) => k !== i))
    if (calibA === i) setCalibA(null)
    setServerLayout(null)
  }

  /** Pikselska razdalja med dvema točkama (po dejanski resoluciji slike). */
  const px = useCallback((a: Pt, b: Pt) => Math.hypot((b.x - a.x) * imgW, (b.y - a.y) * imgH), [imgW, imgH])

  const cmPerPx = calib ? calib.cm / calib.px : null

  /** Izračun v živo: segmenti med zaporednimi točkami. */
  const calc = useMemo(() => {
    const segs = [] as { i: number; j: number; pxLen: number; cmLen: number | null; angleDeg: number; dVCm: number | null }[]
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]; const b = points[i + 1]
      const dx = (b.x - a.x) * imgW; const dy = (b.y - a.y) * imgH
      const pxLen = Math.hypot(dx, dy)
      const angleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10
      segs.push({
        i, j: i + 1, pxLen,
        cmLen: cmPerPx !== null ? Math.round(pxLen * cmPerPx * 10) / 10 : null,
        angleDeg,
        dVCm: cmPerPx !== null ? Math.round(dy * cmPerPx * 10) / 10 : null,
      })
    }
    const totalPx = segs.reduce((s, x) => s + x.pxLen, 0)
    const totalCm = cmPerPx !== null ? Math.round(totalPx * cmPerPx * 10) / 10 : null
    // stebri: razpon ≤ 120 cm (enako kot backend railing-layout)
    const posts = cmPerPx !== null
      ? Math.max(points.length >= 2 ? 2 : 0, segs.reduce((acc, s) => acc + Math.max(1, Math.ceil((s.cmLen ?? 0) / 120)) + 1, 0) - Math.max(0, segs.length - 1))
      : null
    // stopnice: približno horizontalni segmenti + povprečna višina stopnice
    let stairs = 0; let stairH: number | null = null
    if (stairMode && cmPerPx !== null) {
      const steps = segs.filter((s) => Math.abs(s.angleDeg) >= 20 && Math.abs(s.angleDeg) <= 75)
      stairs = Math.max(1, steps.length)
      const dvs = steps.map((s) => Math.abs(s.dVCm ?? 0)).filter((v) => v > 0)
      if (dvs.length > 0) stairH = Math.round((dvs.reduce((a, b) => a + b, 0) / dvs.length) * 10) / 10
    }
    const slope = segs.length === 1 ? Math.abs(segs[0].angleDeg) : null
    return { segs, totalPx, totalCm, posts, stairs, stairH, slope }
  }, [points, cmPerPx, imgW, imgH, stairMode])

  /** VLM zaznava (POST /api/measurement/detect). */
  async function detect (): Promise<void> {
    if (!photoId) {
      toast({ title: 'Najprej shranite fotografijo.', description: 'V koraku 1 pritisnite »Naloži fotografijo«.', variant: 'destructive' })
      return
    }
    setDetecting(true)
    try {
      const res = await apiPost<{ data: { scene: string; points: Pt[]; refObjects: { x1: number; y1: number; x2: number; y2: number; estCm: number; label: string }[] } }>(
        '/api/measurement/detect', { measurementId: photoId }
      )
      const d = res.data
      setPoints((ps) => [...ps, ...d.points.map((p) => ({ x: p.x, y: p.y, label: p.label }))])
      if (d.refObjects.length > 0) {
        const r = d.refObjects[0]
        const pxLen = Math.hypot((r.x2 - r.x1) * imgW, (r.y2 - r.y1) * imgH)
        setCalib({ px: Math.round(pxLen), cm: r.estCm })
      }
      toast({
        title: 'Zaznava končana.',
        description: `${d.points.length} točk${d.scene ? ` · ${d.scene}` : ''} — preglejte in po potrebi popravite.`,
      })
    } catch (e) {
      toast({
        title: 'Samodejna zaznava ni uspela.',
        description: e instanceof Error ? `${e.message} Točke označite ročno — ročni vnos je popolnoma podprt.` : undefined,
        variant: 'destructive',
      })
    } finally { setDetecting(false) }
  }

  /** Preverjanje na strežniku (POST /api/railing-layout). */
  async function verifyServer (): Promise<void> {
    if (!calib || points.length < 2) {
      toast({ title: 'Potrebna sta kalibracija in vsaj 2 točki.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: { totalLengthCm: number; posts: number; handrailM: number } }>('/api/railing-layout', {
        points: points.map((p) => ({ x: p.x * imgW, y: p.y * imgH })),
        calibration: calib,
      })
      setServerLayout(`Strežnik: ${fmt1(res.data.totalLengthCm / 100)} m · ${res.data.posts} stebrov · ročnik ${fmt1(res.data.handrailM)} m`)
    } catch (e) {
      toast({ title: 'Preverjanje ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  /** Potrditev in shranjevanje (POST /api/measurement/confirm). */
  async function confirm (again: boolean): Promise<void> {
    if (!photoId) return
    const lengthCm = calc.totalCm
    if (lengthCm === null || lengthCm <= 0) {
      toast({ title: 'Manjka kalibracija ali točke.', description: 'Kalibrirajte merilo in označite vsaj 2 točki.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost('/api/measurement/confirm', {
        photoId,
        type: stairMode ? 'NAGIB' : type,
        location: location.trim() || null,
        lengthCm,
        heightCm: Number(heightS.replace(',', '.')) > 0 ? Number(heightS.replace(',', '.')) : null,
        slopeDeg: calc.slope !== null ? Math.round(calc.slope * 10) / 10 : null,
        posts: calc.posts,
        segments: calc.segs.length,
        note: note.trim() || (stairMode && calc.stairs ? `${calc.stairs} stopnic × ${fmt1(calc.stairH ?? 0)} cm` : null),
        projectId: projectId !== 'none' ? projectId : null,
        workOrderId: workOrderId !== 'none' ? workOrderId : null,
        points: points.map((p) => ({ x: p.x, y: p.y })),
        calibration: calib ? { ...calib, imgW: Math.round(imgW), imgH: Math.round(imgH) } : null,
      })
      toast({
        title: 'Meritev potrjena in shranjena.',
        description: `${fmt1(lengthCm / 100)} m${calc.posts ? ` · ${calc.posts} stebrov` : ''} — povezano na ${projectId !== 'none' ? 'projekt' : 'fotografijo'}.`,
      })
      if (again) {
        setNote(''); setPoints([]); setCalibA(null); setServerLayout(null); setPhase(2)
      } else {
        await onSaved()
        resetAll()
      }
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju meritve', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  function resetAll (): void {
    setPhase(1); setDataUrl(null); setPhotoId(null); setPoints([])
    setCalib(null); setCalibA(null); setCalibCm(''); setNote('')
    setLocation(''); setServerLayout(null); setStairMode(false)
    setProjectId('none'); setWorkOrderId('none')
  }

  const existingPhotos = useMemo(
    () => (photos.data?.data ?? []).filter((p) => parsePhoto(p.params) !== null).slice(0, 12),
    [photos.data]
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Camera className="size-5 text-roksal-amber" aria-hidden /> Meritve s kamero
        </DialogTitle>
        <DialogDescription>
          Fotografirajte teren, označite točke, kalibrirajte merilo — dolžine, koti in višine se izračunajo samodejno.
        </DialogDescription>
      </DialogHeader>

      {/* indikator faz */}
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Koraki zajema">
        {['Fotografija', 'Točke in kalibracija', 'Potrditev'].map((t, i) => (
          <li key={t} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${phase === i + 1 ? 'border-roksal-amber bg-amber-50 font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'text-muted-foreground'}`}>
            <span className={`flex size-4 items-center justify-center rounded-full text-[10px] ${phase > i + 1 ? 'bg-roksal-amber text-white' : 'bg-muted'}`} aria-hidden>{phase > i + 1 ? '✓' : i + 1}</span>
            {t}
          </li>
        ))}
      </ol>

      {/* ── FAZA 1: fotografija ── */}
      {phase === 1 ? (
        <div className="space-y-4">
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
              <video ref={videoRef} autoPlay playsInline muted className="max-h-[360px] w-full object-contain" aria-label="Predogled kamere" />
              <div className="flex gap-2 p-2">
                <Button className="flex-1" onClick={capture}><Camera className="size-4" aria-hidden /> Zajemi</Button>
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
                  {(orders.data?.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.title}</SelectItem>)}
                </SelectContent>
              </Select>
              <ErrorBox error={orders.error} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="km-location">Lokacija merjenja</Label>
            <Input id="km-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="npr. Stopnišče — vhod" />
          </div>
        </div>
      ) : null}

      {/* ── FAZA 2: točke in kalibracija ── */}
      {phase === 2 && dataUrl ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">
              {photoId ? 'Fotografija shranjena ✓' : busy ? 'Nalaganje …' : 'Ni še shranjena'}
            </Badge>
            {!photoId ? (
              <Button size="sm" onClick={() => void uploadPhoto()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Naloži fotografijo
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void detect()} disabled={detecting || !photoId}>
              {detecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {detecting ? 'VLM analizira (do 60 s) …' : 'Zaznaj točke samodejno'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPoints([])} disabled={points.length === 0}>
              <Eraser className="size-4" aria-hidden /> Počisti točke
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setDataUrl(null); setPhotoId(null); setPhase(1) }}>
              <Undo2 className="size-4" aria-hidden /> Druga fotografija
            </Button>
          </div>

          <div className="mx-auto inline-block max-w-full rounded-lg border bg-muted/40 p-1">
            <div className="relative inline-block cursor-crosshair" onClick={onImageClick} role="application" aria-label="Slika za označevanje merilnih točk — klik dodaja točko">
              <img src={dataUrl} alt="Teren za merjenje" className="block h-auto max-h-[420px] w-auto max-w-full select-none" draggable={false} />
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
                {points.length > 1 ? (
                  <polyline
                    points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="#d97706" strokeWidth={2} vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
              {points.map((p, i) => (
                <button
                  key={`${i}-${p.x.toFixed(4)}`}
                  type="button"
                  title={p.label ?? `Točka ${i + 1} — klik za brisanje`}
                  aria-label={`Točka ${i + 1}${p.label ? ` ${p.label}` : ''} — klik za brisanje`}
                  onClick={(e) => { e.stopPropagation(); removePoint(i) }}
                  className={`absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 text-[10px] font-bold leading-none ${calibA === i ? 'border-sky-500 bg-sky-500 text-white' : 'border-amber-600 bg-amber-500 text-white'}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                >
                  <span className="flex size-full items-center justify-center">{i + 1}</span>
                </button>
              ))}
            </div>
          </div>

          {/* kalibracija */}
          <Card>
            <CardContent className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Crosshair className="size-4 text-roksal-amber" aria-hidden /> Kalibracija merila
                </p>
                {calib ? (
                  <span className="text-xs text-muted-foreground">
                    1 px = {fmt1(calib.cm / calib.px)} cm
                    <Button size="sm" variant="ghost" className="ml-2 h-7 px-2" onClick={() => { setCalib(null); setCalibA(null) }}>
                      <Trash2 className="size-3.5" aria-hidden /> ponastavi
                    </Button>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">izberite 2 točki + vnesite realno razdaljo</span>
                )}
              </div>
              {!calib ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="km-calib-a" className="text-xs">1. točka</Label>
                    <Select value={calibA !== null ? String(calibA) : 'none'} onValueChange={(v) => setCalibA(v === 'none' ? null : Number(v))}>
                      <SelectTrigger id="km-calib-a" className="h-9 w-28" aria-label="Prva točka kalibracije"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {points.map((p, i) => <SelectItem key={i} value={String(i)}>Točka {i + 1}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-calib-cm" className="text-xs">Realna razdalja (cm)</Label>
                    <Input id="km-calib-cm" className="h-9 w-32" type="number" min="1" inputMode="decimal" value={calibCm} onChange={(e) => setCalibCm(e.target.value)} placeholder="npr. 110" />
                  </div>
                  <Button
                    size="sm" className="h-9"
                    disabled={calibA === null || !(Number(calibCm) > 0) || points.length < 2}
                    onClick={() => {
                      const a = points[calibA ?? 0]
                      const b = points[calibA === points.length - 1 ? calibA - 1 : (calibA ?? 0) + 1]
                      if (!a || !b) return
                      const d = px(a, b)
                      if (d > 0) setCalib({ px: Math.round(d), cm: Number(calibCm) })
                    }}
                  >
                    <Ruler className="size-4" aria-hidden /> Kalibriraj (točka {calibA !== null ? calibA + 1 : '—'} ↔ {calibA !== null && calibA < points.length - 1 ? calibA + 2 : calibA !== null ? calibA : '—'})
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* izračun */}
          {points.length >= 2 ? (
            <Card>
              <CardContent className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Izračun {cmPerPx ? '' : '(px — brez kalibracije)'}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={stairMode ? 'default' : 'outline'} className="h-8" onClick={() => setStairMode((s) => !s)} aria-pressed={stairMode}>
                      Stopnišče {stairMode ? 'vklop' : 'izklop'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => void verifyServer()} disabled={!calib || busy}>
                      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />} Preveri na strežniku
                    </Button>
                  </div>
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
                  {calc.posts !== null ? <span>Stebrov (≤ 120 cm): <strong className="text-foreground">{calc.posts}</strong></span> : null}
                  {stairMode && calc.stairs > 0 ? <span>Stopnic: <strong className="text-foreground">{calc.stairs}{calc.stairH !== null ? ` × ${fmt1(calc.stairH)} cm` : ''}</strong></span> : null}
                  {serverLayout ? <span className="text-muted-foreground">{serverLayout}</span> : null}
                </div>
              </CardContent>
            </Card>
          ) : (
            <EmptyState title="Označite točke" desc="Kliknite na sliko: vogali ograje, robovi stopnic, tla ob stebrih … Klik na točko jo izbriše." icon={Crosshair} />
          )}

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={onClose}>Prekliči</Button>
            <Button onClick={() => setPhase(3)} disabled={points.length < 2}>
              Naprej — potrditev
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── FAZA 3: potrditev ── */}
      {phase === 3 && dataUrl ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2 p-3 text-sm">
              <p className="font-semibold">Povzetek meritve</p>
              <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <span>Dolžina: <strong className="text-foreground">{calc.totalCm !== null ? `${fmt1(calc.totalCm / 100)} m` : '—'}</strong></span>
                <span>Segmentov: <strong className="text-foreground">{calc.segs.length}</strong></span>
                <span>Stebrov: <strong className="text-foreground">{calc.posts ?? '—'}</strong></span>
                {stairMode && calc.stairs > 0 ? <span>Stopnic: <strong className="text-foreground">{calc.stairs} × {fmt1(calc.stairH ?? 0)} cm</strong></span> : null}
                {calc.slope !== null ? <span>Nagib: <strong className="text-foreground">{fmt1(calc.slope)}°</strong></span> : null}
                <span>Fotografija: <strong className="text-foreground">{photoId ? `✓ (${points.length} točk)` : 'ni shranjena'}</strong></span>
              </div>
              {!photoId ? (
                <Button size="sm" variant="outline" onClick={() => void uploadPhoto()} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Najprej naloži fotografijo
                </Button>
              ) : null}
            </CardContent>
          </Card>

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

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => setPhase(2)}><Undo2 className="size-4" aria-hidden /> Nazaj na točke</Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void confirm(true)} disabled={busy || !photoId || calc.totalCm === null}>
                Shrani in meri naprej na isti fotografiji
              </Button>
              <Button onClick={() => void confirm(false)} disabled={busy || !photoId || calc.totalCm === null}>
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

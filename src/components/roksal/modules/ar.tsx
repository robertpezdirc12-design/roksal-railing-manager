'use client'

// AR — dopolnjena resničnost: predogled ograje čez kamero (vrata projects.read)
// getUserMedia environment → <video>; če kamere ni → POŠTEN demo ozadje (gradient).
// SVG ograja kot vlečni overlay (pointer events, slider za velikost/prosojnost).
// Zajem: canvas (video ali demo ozadje + overlay) → JPEG 0.7 → POST /api/measurements
// tip FOTO s params {photo, ar:true} (measurements.write).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import { Camera, CameraOff, ImageIcon, Loader2, Move, ScanLine, Save, Video } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, useApi } from '@/lib/api-client'
import { ErrorBox, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

const ANTHRACITE = '#2b2f36'
const OVERLAY_W = 320
const OVERLAY_H = 220
const DEMO_GRAD = 'linear-gradient(160deg, #e7e5e4 0%, #a8a29e 55%, #78716c 100%)'

type Mode = 'off' | 'on' | 'demo'

interface ProjectRow { id: string; code: string; title: string }

function loadImage (src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Slike ni bilo mogoče odpreti.'))
    img.src = src
  })
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

  const projects = useApi<{ data: ProjectRow[] }>('/api/projects', [])

  const posts = Math.min(20, Math.max(2, Math.round(Number(postsS) || 5)))
  const heightCm = Math.min(250, Math.max(40, Math.round(Number(heightS) || 110)))

  // POČIŠČENJE: ob odklopu ustavi vse steze kamere
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

  // ── vlečenje overlayja ──
  function onPointerDown (e: ReactPointerEvent<HTMLDivElement>): void {
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* nekateri brskalniki */ }
  }
  function onPointerMove (e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d) return
    setPos({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) })
  }
  function onPointerUp (): void { dragRef.current = null }

  // ── zajem posnetka ──
  async function capture (): Promise<void> {
    const container = viewportRef.current
    const svg = svgRef.current
    if (!container || !svg) return
    setBusy(true)
    try {
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

      // overlay SVG na položaj (počakaj nalaganje slike!)
      const xml = new XMLSerializer().serializeToString(svg)
      const overlayUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
      const img = await loadImage(overlayUrl)
      const destX = cw / 2 + pos.x - (OVERLAY_W * scale) / 2
      const destY = ch / 2 + pos.y - (OVERLAY_H * scale) / 2
      ctx.globalAlpha = opacity
      ctx.drawImage(img, destX, destY, OVERLAY_W * scale, OVERLAY_H * scale)
      ctx.globalAlpha = 1

      const photo = canvas.toDataURL('image/jpeg', 0.7)
      await apiPost('/api/measurements', {
        type: 'FOTO',
        projectId: projectId !== 'none' ? projectId : null,
        location: 'AR predogled',
        params: JSON.stringify({ photo, ar: true }),
        note: note.trim() || `AR predogled — ${posts} stebrov, ${heightCm} cm`,
      })
      setLastShot(photo)
      toast({
        title: 'AR posnetek shranjen.',
        description: `Meritev FOTO · ${posts} stebrov × ${heightCm} cm${projectId !== 'none' ? ' · povezano s projektom' : ''}`,
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
        desc="Dopolnjena resničnost — ograjo položite čez kamero in zajemite posnetek"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* kontrole */}
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <ScanLine className="size-4 text-roksal-amber" aria-hidden /> Nastavitve
            </h2>

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

            {canWrite ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ar-note">Opomba</Label>
                  <Input id="ar-note" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="npr. predogled pred sprednjo teraso" />
                </div>
                <Button className="w-full" onClick={() => void capture()} disabled={busy || mode === 'off'}>
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
                </figcaption>
                <img src={lastShot} alt="Zadnji AR zajem z ograjo" className="w-full rounded-lg border" />
              </figure>
            ) : null}
          </CardContent>
        </Card>

        {/* predogled */}
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                <Video className="size-4 text-roksal-amber" aria-hidden /> Predogled
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {mode === 'on' ? <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Kamera aktivna</Badge> : null}
                {mode === 'demo' ? <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Demo ozadje</Badge> : null}
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
                  className="absolute left-1/2 top-1/2 cursor-grab touch-none active:cursor-grabbing"
                  style={{
                    opacity,
                    width: OVERLAY_W,
                    height: OVERLAY_H,
                    transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  role="img"
                  aria-label={`Predogled ograje: ${posts} stebrov, višina ${heightCm} centimetrov — povlecite za premik`}
                  tabIndex={0}
                >
                  <ArRailingSvg ref={svgRef} posts={posts} heightCm={heightCm} />
                  <span className="pointer-events-none absolute -top-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
                    <Move className="size-3" aria-hidden /> povleci
                  </span>
                </div>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">
              {mode === 'demo'
                ? 'Kamera ni na voljo — predogled na demo ozadju. Zajem shrani enak sestavek (demo ozadje + ograja).'
                : 'Ograjo premikajte z vlečenjem po predogledu; velikost in prosojnost nastavite z drsnikoma levo.'}
            </p>
          </CardContent>
        </Card>
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

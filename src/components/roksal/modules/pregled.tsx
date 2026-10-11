'use client'

// PREGLED — ENOTNI PREGLEDOVALNIK (R479 — issue #9 §7)
// Model + fotografije + meritve + PRIPETI KOMENTARJI (pini) na enem mestu,
// brez skakanja po modulih. Pogledi: tloris / profil / 3D (izpeljava
// model-core prek /api/fence-run/[id]/review — skupna z modulom Model) in
// mreža fotografij zajema (POŠTENO: posnetki niso prostorsko registrirani).
// Pini so SAMO pripombe — NE spreminjajo meritev (za to je obstoječi
// verify/confirm tok z revizijo). Javna delitev: žetonska povezava z omejenim
// rokom + GDPR soglasje za fotografije (§10 osnova).

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight, Box, Camera, CheckCircle2, Compass, Copy, Eye, Fence, FileWarning,
  Film, Info, Layers, Link2, Loader2, Lock, MapPin, Map as MapIcon, MessageSquare,
  Mountain, Pause, Play, Plus, RotateCcw, Ruler, ScanLine, ShieldCheck, Trash2,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatCard } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { SEGMENT_STATUSES } from '@/lib/fence-run-engine'
import { project3d, projectPlan, projectProfile, type PlanModel, type ModelNode, type ModelSegment } from '@/lib/model-core'

// ─── Tipi (API) ──────────────────────────────────────────────────────────────

interface ProjectOption { id: string; code: string; title: string }

interface RunOption {
  id: string; name: string; status: string; updatedAt: string
  totalLengthCm: number
  product: { sku: string; name: string } | null
}

interface ReviewPhoto {
  id: string
  sessionId: string
  sessionName: string
  zone: string
  zoneLabel: string
  atCm: number | null
  spatiallyRegistered: false
  thumb: string | null
  offsetCm: number | null
  capturedAt: string
}

interface ReviewPin {
  id: string
  fenceRunId: string
  targetType: string
  targetKey: string
  x: number | null
  y: number | null
  note: string
  internalNote: string | null
  status: string
  resolvedAt: string | null
  author: { id: string; name: string | null } | null
  resolvedBy: { id: string; name: string | null } | null
  snapshot: string | null
  createdAt: string
  updatedAt: string
}

interface ReviewCheck { code: string; severity: string; message: string }

interface ReviewLinkRow {
  id: string; token: string; url: string
  note: string | null; viewCount: number
  lastViewAt: string | null; revokedAt: string | null
  createdAt: string; expiresAt: string; active: boolean
}

interface ReviewPayload {
  run: { id: string; name: string; status: string; projectId: string; createdAt: string; updatedAt: string }
  project: { code: string; title: string; status: string; customerName: string | null } | null
  productId: string | null
  product: { id: string; sku: string; name: string; unit: string } | null
  variantId: string | null
  variant: { id: string; sku: string; name: string; ral: string | null } | null
  model: PlanModel
  photos: ReviewPhoto[]
  photosSpatiallyRegistered: false
  pins: ReviewPin[]
  replay: { id: string; name: string; status: string; photoCount: number; replayUrl: string }[]
  consent: { status: 'MANJKA' | 'VELJAVNO' | 'POTEKLO'; photosBlocked: string | null }
  checks: ReviewCheck[]
}

/** Pin v risbi (zadostuje za marker: interni in javni pin imata ta polja) */
interface PinMarker { id: string; targetType: string; targetKey: string; x: number | null; y: number | null; status: string; note: string }

// ─── Konstante ───────────────────────────────────────────────────────────────

// barve segmentov po statusu — USKLAJENO z modulom Model (R473)
const STROKE: Record<string, string> = {
  ESTIMATED: '#9ca3af',
  AUTO_SUGGESTED: '#8b5cf6',
  MANUAL: '#d97706',
  CALIBRATED: '#0d9488',
  VERIFIED: '#059669',
  CONFIRMED: '#475569',
}
const STROKE_SELECTED = '#dc2626'

const PIN_TONE: Record<string, { fill: string; label: string; cls: string }> = {
  ODPRTO: { fill: '#dc2626', label: 'Odprto', cls: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  RESENO: { fill: '#d97706', label: 'Rešeno', cls: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  ZAPRT: { fill: '#64748b', label: 'Zaprto', cls: 'border-transparent bg-muted text-muted-foreground' },
}

const TARGET_LABEL: Record<string, string> = { SEGMENT: 'segment', VOZLISCE: 'vozlišče', FOTOGRAFIJA: 'fotografija' }

const NODE_GLYPH: Record<string, { shape: 'circle' | 'rect' | 'diamond'; label: string }> = {
  ZACETEK: { shape: 'circle', label: 'Z' },
  STEBER: { shape: 'circle', label: 'S' },
  VOGAL: { shape: 'diamond', label: 'V' },
  VRATA: { shape: 'rect', label: 'Vr' },
  STOPNISCE: { shape: 'rect', label: 'St' },
  KONEC: { shape: 'circle', label: 'K' },
}

// kategorije izolacije (§7: odseki, vrata, stebri, mere, opozorila …)
const ISOLATION_CATS: { key: string; label: string }[] = [
  { key: 'odseki', label: 'Odseki' },
  { key: 'vrata', label: 'Vrata' },
  { key: 'stebri', label: 'Stebri' },
  { key: 'vogali', label: 'Vogali' },
  { key: 'nepreverjene', label: 'Nepreverjene mere' },
  { key: 'opozorila', label: 'Odpri pini' },
]

const fmtCm = (n: number | null | undefined, unit = 'cm'): string =>
  n == null ? '—' : `${(Math.round(n * 10) / 10).toLocaleString('sl-SI')} ${unit}`

const fmtM = (cm: number | null | undefined): string =>
  cm == null ? '—' : `${(cm / 100).toLocaleString('sl-SI', { maximumFractionDigits: 2 })} m`

/** Kratek povzetek snapshot-a cilja (dokaz o geometriji ob nastanku pina). */
function pinSnapshotSummary (p: ReviewPin): string | null {
  if (!p.snapshot) return null
  try {
    const s = JSON.parse(p.snapshot) as Record<string, unknown>
    if (p.targetType === 'SEGMENT') {
      const parts: string[] = []
      if (typeof s.lengthCm === 'number') parts.push(`dolžina ${fmtCm(s.lengthCm)}`)
      if (typeof s.status === 'string') parts.push(`status ${s.status}`)
      return parts.length ? `ob nastanku: ${parts.join(' · ')}` : null
    }
    if (p.targetType === 'VOZLISCE') {
      const parts: string[] = []
      if (typeof s.kind === 'string') parts.push(String(s.kind))
      if (typeof s.atCm === 'number') parts.push(fmtM(s.atCm))
      return parts.length ? `ob nastanku: ${parts.join(' · ')}` : null
    }
    if (typeof s.zone === 'string') return `ob nastanku: cona ${s.zone}`
  } catch { /* pokvarjen snapshot — preskoči */ }
  return null
}

// ─── Modul ──────────────────────────────────────────────────────────────────

export default function PregledModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [projectId, setProjectId] = useState<string>('')
  const [runId, setRunId] = useState<string>('')
  const [view, setView] = useState<'plan' | 'profile' | '3d' | 'photos'>('plan')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [turns, setTurns] = useState<string>('')
  const [yaw, setYaw] = useState(-30)
  const [pitch, setPitch] = useState(25)
  const [iso, setIso] = useState<string[]>([]) // izolacija komponent (kategorije)
  const [pinTarget, setPinTarget] = useState<{ targetType: string; targetKey: string; x?: number; y?: number } | null>(null)
  const [lightbox, setLightbox] = useState<ReviewPhoto | null>(null)
  const [replayId, setReplayId] = useState<string | null>(null)

  const canPin = hasPerm(user?.perms, 'measurements.write')

  const projects = useApi<{ data: ProjectOption[] }>(user ? '/api/projects?limit=500' : null)
  const runs = useApi<{ data: RunOption[] }>(projectId ? `/api/fence-run?projectId=${projectId}` : null)
  const review = useApi<{ data: ReviewPayload }>(
    runId ? `/api/fence-run/${runId}/review${turns ? `?turns=${encodeURIComponent(turns)}` : ''}` : null
  )

  function onProject (v: string): void {
    setProjectId(v); setRunId(''); setSelectedKey(null); setTurns(''); setIso([])
  }
  function onRun (v: string): void {
    setRunId(v); setSelectedKey(null); setTurns(''); setIso([])
  }

  const d = review.data?.data
  const m = d?.model
  const pins = d?.pins ?? []
  const photos = d?.photos ?? []

  const selected = m?.segments.find((s) => s.key === selectedKey) ?? null
  const corners = useMemo(
    () => m?.nodes.filter((n) => n.kind === 'VOGAL' && n.interiorDeg != null) ?? [],
    [m]
  )

  function setTurn (idx: number, v: 'L' | 'D'): void {
    const arr = (turns || 'L'.repeat(corners.length)).split('')
    arr[idx] = v
    setTurns(arr.join(''))
  }
  function mirrorTurns (): void {
    if (!corners.length) return
    const cur = turns || 'L'.repeat(corners.length)
    setTurns(cur.split('').map((c) => (c === 'D' ? 'L' : 'D')).join(''))
  }

  /** klik na segment v tlorisu → dialog za nov pin (x/y iz klika) */
  function openPinForSegment (key: string, world?: { x: number; y: number }): void {
    setSelectedKey(key)
    setPinTarget({
      targetType: 'SEGMENT', targetKey: key,
      ...(world ? { x: Math.round(world.x * 10) / 10, y: Math.round(world.y * 10) / 10 } : {}),
    })
  }

  // izolacija: kategorija → ali je segment/vozlišče v izbiri
  const isoActive = iso.length > 0
  const segInIso = (seg: ModelSegment): boolean => {
    if (!isoActive) return true
    const nodeA = m?.nodes.find((n) => n.key === seg.fromKey)
    const nodeB = m?.nodes.find((n) => n.key === seg.toKey)
    if (iso.includes('odseki')) return true
    if (iso.includes('vrata') && (nodeA?.kind === 'VRATA' || nodeB?.kind === 'VRATA')) return true
    if (iso.includes('opozorila') && pins.some((p) => p.status === 'ODPRTO' && p.targetKey === seg.key)) return true
    if (iso.includes('nepreverjene') && !['VERIFIED', 'CONFIRMED', 'CALIBRATED'].includes(seg.status)) return true
    return false
  }
  const nodeInIso = (n: ModelNode): boolean => {
    if (!isoActive) return true
    if (n.kind === 'VRATA') return iso.includes('vrata')
    if (n.kind === 'VOGAL') return iso.includes('vogali')
    if (iso.includes('stebri')) return true // ZACETEK/STEBER/KONEC/STOPNISCE
    return false
  }

  const projOpts = projects.data?.data ?? []
  const runOpts = runs.data?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Enotni pregled"
        desc="Model, fotografije, meritve in pripombe na enem mestu (issue #9 §7, R479)"
        actions={m ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 font-normal">
              <ScanLine className="size-3" aria-hidden /> {m.engineVersion}
            </Badge>
            <Badge variant="outline" className="gap-1 font-normal">
              <MessageSquare className="size-3" aria-hidden /> {pins.filter((p) => p.status === 'ODPRTO').length} odprtih pripomb
            </Badge>
          </div>
        ) : null}
      />

      {/* izbire */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pregled-proj">Projekt</Label>
          <Select value={projectId} onValueChange={onProject}>
            <SelectTrigger id="pregled-proj" aria-label="Projekt">
              <SelectValue placeholder="Izberite projekt" />
            </SelectTrigger>
            <SelectContent>
              <ScrollArea className="max-h-64">
                {projOpts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                ))}
              </ScrollArea>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pregled-run">Ograjni tekač</Label>
          <Select value={runId} onValueChange={onRun} disabled={!projectId}>
            <SelectTrigger id="pregled-run" aria-label="Ograjni tekač">
              <SelectValue placeholder={projectId ? 'Izberite tekač' : 'Najprej projekt'} />
            </SelectTrigger>
            <SelectContent>
              <ScrollArea className="max-h-64">
                {runOpts.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} · {fmtM(r.totalLengthCm)}
                  </SelectItem>
                ))}
              </ScrollArea>
            </SelectContent>
          </Select>
        </div>
      </div>

      <ErrorBox error={projects.error} />
      <ErrorBox error={runs.error} />
      {projects.loading && <LoadingRows />}

      {!projects.loading && !projectId && projOpts.length > 0 && (
        <EmptyState icon={MapIcon} title="Izberite projekt" desc="Enotni pregled združi model, fotografije zajema, meritve in pripombe tekača projekta." />
      )}
      {projectId && runs.loading && <LoadingRows />}
      {projectId && !runs.loading && runOpts.length === 0 && (
        <EmptyState icon={Fence} title="Projekt nima ograjnega tekača" desc="Ustvarite ga v modulu Ogradnja — pregled se izpelje samodejno." />
      )}

      <ErrorBox error={review.error} />
      {review.loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Nalagam enotni pregled…</div>
      )}

      {d && m && (
        <>
          {/* glavne številke */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Tekač"
              value={d.run.name}
              hint={`${d.project ? `${d.project.code} · ` : ''}status ${d.run.status} · posodobljeno ${fmtDate(d.run.updatedAt)}`}
              icon={Fence}
            />
            <StatCard
              label="Segmenti"
              value={`${m.segments.length}`}
              hint={`skupna dolžina ${fmtM(m.totalLengthCm)}${m.closureGapCm != null ? ` · odprtina ${fmtCm(m.closureGapCm)}` : ''}`}
              icon={Ruler}
            />
            <StatCard
              label="Pripombe (pini)"
              value={`${pins.length}`}
              hint={`${pins.filter((p) => p.status === 'ODPRTO').length} odprtih · ${pins.filter((p) => p.status === 'RESENO').length} rešenih · ${pins.filter((p) => p.status === 'ZAPRT').length} zaprtih`}
              icon={MessageSquare}
              tone={pins.some((p) => p.status === 'ODPRTO') ? 'amber' : 'green'}
            />
            <StatCard
              label="Fotografije zajema"
              value={`${photos.length}`}
              hint={`${d.replay.length} zajem${d.replay.length === 1 ? '' : 'i'} · slike niso prostorsko registrirane`}
              icon={Camera}
            />
          </div>

          {/* preverjanja (isto presojo kot izvozi R477) */}
          {d.checks.length > 0 && (
            <Card>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex items-center gap-1.5 font-medium"><FileWarning className="size-4 text-muted-foreground" aria-hidden /> Preverjanja</div>
                {d.checks.map((c) => (
                  <div key={c.code} className="flex items-start gap-2">
                    <Badge variant="outline" className={c.severity === 'OPOZORILO' ? 'border-amber-400 text-amber-700 dark:text-amber-300' : ''}>{c.severity}</Badge>
                    <span className="text-muted-foreground">{c.message}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* smeri zavojev */}
          {corners.length > 0 && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium"><Compass className="size-4 text-muted-foreground" aria-hidden /> Smeri zavojev ({corners.length})</div>
                  <Button size="sm" variant="outline" onClick={mirrorTurns}>
                    <RotateCcw className="size-4" aria-hidden /> Zrcali
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {corners.map((c, i) => (
                    <div key={c.key} className="flex items-center gap-1 rounded-lg border px-2 py-1">
                      <span className="text-xs text-muted-foreground">{c.key} · {fmtM(c.atCm)} · {c.interiorDeg}°</span>
                      <div className="flex">
                        <Button
                          size="sm" variant={(turns[i] ?? 'L') === 'L' ? 'default' : 'outline'} className="h-7 px-2 text-xs"
                          onClick={() => setTurn(i, 'L')} aria-label={`Zavoj ${i + 1} levo`}
                        >LEVO</Button>
                        <Button
                          size="sm" variant={turns[i] === 'D' ? 'default' : 'outline'} className="h-7 px-2 text-xs"
                          onClick={() => setTurn(i, 'D')} aria-label={`Zavoj ${i + 1} desno`}
                        >DESNO</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Tekač ne beleži smeri zavojev — izbira je predpostavka; mere segmentov so od nje neodvisne.</p>
              </CardContent>
            </Card>
          )}

          {/* preklop pogledov */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={view === 'plan' ? 'default' : 'outline'} onClick={() => setView('plan')}><MapIcon className="size-4" aria-hidden /> Tloris</Button>
            <Button size="sm" variant={view === 'profile' ? 'default' : 'outline'} onClick={() => setView('profile')}><Mountain className="size-4" aria-hidden /> Profil</Button>
            <Button size="sm" variant={view === '3d' ? 'default' : 'outline'} onClick={() => setView('3d')}><Box className="size-4" aria-hidden /> 3D</Button>
            <Button size="sm" variant={view === 'photos' ? 'default' : 'outline'} onClick={() => setView('photos')}><Camera className="size-4" aria-hidden /> Fotografije</Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {view === 'photos' ? 'Mreža fotografij zajema — po conah' : 'Kliknite segment za podrobnosti ali novo pripombo'}
            </span>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="min-w-0 space-y-4">
              {view !== 'photos' && (
                <Card>
                  <CardContent className="p-2 sm:p-4">
                    {view === 'plan' && (
                      <PlanViewP
                        m={m} selectedKey={selectedKey}
                        onSegmentClick={canPin ? openPinForSegment : setSelectedKey}
                        pins={pins}
                        segDim={(k) => {
                          const seg = m.segments.find((s) => s.key === k)
                          return seg ? !segInIso(seg) : false
                        }}
                        nodeDim={(k) => {
                          const n = m.nodes.find((x) => x.key === k)
                          return n ? !nodeInIso(n) : false
                        }}
                      />
                    )}
                    {view === 'profile' && <ProfileViewP m={m} selectedKey={selectedKey} onSelect={setSelectedKey} segDim={(k) => { const s = m.segments.find((x) => x.key === k); return s ? !segInIso(s) : false }} />}
                    {view === '3d' && (
                      <PerspectiveViewP
                        m={m} selectedKey={selectedKey} onSelect={setSelectedKey}
                        yaw={yaw} pitch={pitch} setYaw={setYaw} setPitch={setPitch}
                        segDim={(k) => { const s = m.segments.find((x) => x.key === k); return s ? !segInIso(s) : false }}
                      />
                    )}
                  </CardContent>
                </Card>
              )}

              {view === 'photos' && (
                <PhotosCard photos={photos} onOpen={setLightbox} onPin={canPin ? (photo) => setPinTarget({ targetType: 'FOTOGRAFIJA', targetKey: photo.id }) : undefined} />
              )}

              {/* izolacija komponent */}
              {view !== 'photos' && (
                <Card>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center gap-1.5 font-medium"><Layers className="size-4 text-muted-foreground" aria-hidden /> Izolacija komponent</div>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {ISOLATION_CATS.map((c) => (
                        <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                          <Checkbox
                            checked={iso.includes(c.key)}
                            onCheckedChange={(v) => {
                              setIso((cur) => v === true ? [...cur, c.key] : cur.filter((x) => x !== c.key))
                            }}
                            aria-label={c.label}
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isoActive ? 'Izbrani ostanejo poudarjeni, ostalo je zamaknjeno (izolacija ne spreminja podatkov).' : 'Izberite kategorije za izolacijo — brez izbire je vse vidno.'}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-3">
              {view !== 'photos' && (selected
                ? <SegmentPanelP seg={selected} m={m} onPin={canPin ? () => openPinForSegment(selected.key) : undefined} />
                : (
                  <Card><CardContent className="text-sm text-muted-foreground">
                    <div className="mb-1 font-medium text-foreground">Segment</div>
                    Izberite segment na risbi (ali spodaj na seznamu) za mere in vir.
                  </CardContent></Card>
                )
              )}

              {view !== 'photos' && (
                <Card>
                  <CardContent className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-sm font-medium"><Layers className="size-4 text-muted-foreground" aria-hidden /> Segmenti</div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.segments.map((s) => (
                        <button
                          key={s.key} type="button"
                          onClick={() => setSelectedKey(s.key)}
                          className={`rounded-md border px-2 py-1 text-xs ${s.key === selectedKey ? 'border-red-400 bg-red-50 dark:bg-red-950' : 'hover:bg-muted'}`}
                          aria-pressed={s.key === selectedKey}
                        >
                          <span className="inline-block size-2 rounded-full align-middle" style={{ background: STROKE[s.status] ?? STROKE.ESTIMATED }} aria-hidden /> {s.key}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <PinsCard
                pins={pins} user={user} canPin={canPin}
                onNew={() => setPinTarget({ targetType: 'SEGMENT', targetKey: m.segments[0]?.key ?? 'seg-1' })}
                onReload={() => { void review.reload() }}
              />

              <ReplayCard replay={d.replay} onOpen={setReplayId} />

              <ShareCard
                runId={runId}
                projectId={d.run.projectId}
                projectCode={d.project?.code ?? ''}
                consent={d.consent}
                onConsentChange={() => { void review.reload() }}
              />
            </div>
          </div>
        </>
      )}

      {/* dialog: nov pin */}
      <Dialog open={!!pinTarget} onOpenChange={(o) => { if (!o) setPinTarget(null) }}>
        {pinTarget && (
          <PinDialog
            target={pinTarget}
            runId={runId}
            onClose={() => setPinTarget(null)}
            onCreated={() => { setPinTarget(null); void review.reload() }}
          />
        )}
      </Dialog>

      {/* dialog: fotografija (povečava) */}
      <Dialog open={!!lightbox} onOpenChange={(o) => { if (!o) setLightbox(null) }}>
        {lightbox && (
          <DialogContent aria-describedby={undefined} className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Fotografija — {lightbox.zoneLabel}</DialogTitle>
              <DialogDescription>
                {lightbox.sessionName}
                {lightbox.atCm != null ? ` · cona pri ~${fmtM(lightbox.atCm)} ob teku` : ''}
                {` · ${fmtDateTime(lightbox.capturedAt)}`}
              </DialogDescription>
            </DialogHeader>
            {lightbox.thumb ? (
              <img
                src={lightbox.thumb}
                alt={`Posnetek zajema — cona ${lightbox.zoneLabel}`}
                className="w-full rounded-xl border object-contain"
              />
            ) : (
              <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">brez sličice</div>
            )}
            <p className="text-xs text-muted-foreground">
              Posnetek zajema ima samo cono pokritosti — NI prostorsko registriran (ni XY vezave na model).
              {lightbox.offsetCm != null ? ` Odmik registra: ${fmtCm(lightbox.offsetCm)}.` : ''}
            </p>
            {canPin && (
              <DialogFooter>
                <Button
                  size="sm"
                  onClick={() => {
                    const photo = lightbox
                    setLightbox(null)
                    setPinTarget({ targetType: 'FOTOGRAFIJA', targetKey: photo.id })
                  }}
                >
                  <MapPin className="size-4" aria-hidden /> Pripni pripombo na fotografijo
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        )}
      </Dialog>

      {/* dialog: replay zajema (obstoječi motor R465 — NE podvojen) */}
      <Dialog open={!!replayId} onOpenChange={(o) => { if (!o) setReplayId(null) }}>
        {replayId && <ReplayDialog sessionId={replayId} onClose={() => setReplayId(null)} />}
      </Dialog>
    </div>
  )
}

// ─── Tloris (z markerji pinov + izolacija + klik → x/y) ──────────────────────

function PlanViewP ({
  m, selectedKey, onSegmentClick, pins, segDim, nodeDim,
}: {
  m: PlanModel
  selectedKey: string | null
  onSegmentClick: (key: string, world?: { x: number; y: number }) => void
  pins: PinMarker[]
  segDim: (key: string) => boolean
  nodeDim: (key: string) => boolean
}) {
  const W = 900; const H = 560; const PAD = 60
  const bw = Math.max(1, m.bounds.maxX - m.bounds.minX); const bh = Math.max(1, m.bounds.maxY - m.bounds.minY)
  const scale = Math.min((W - 2 * PAD) / bw, (H - 2 * PAD) / bh)
  const offX = ((W - 2 * PAD) - bw * scale) / 2; const offY = ((H - 2 * PAD) - bh * scale) / 2
  const tx = (x: number): number => (x - m.bounds.minX) * scale + PAD + offX
  const ty = (y: number): number => (y - m.bounds.minY) * scale + PAD + offY
  const edges = projectPlan(m)
  const gridStep = niceStep(50 / scale)
  const [gMinX, gMaxX] = [Math.floor(m.bounds.minX / gridStep) * gridStep, Math.ceil(m.bounds.maxX / gridStep) * gridStep]
  const [gMinY, gMaxY] = [Math.floor(m.bounds.minY / gridStep) * gridStep, Math.ceil(m.bounds.maxY / gridStep) * gridStep]

  /** klik v SVG → svetovne koordinate modela (cm) — za x/y pina */
  function worldFromEvent (e: React.MouseEvent<SVGLineElement>): { x: number; y: number } | undefined {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return undefined
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0) return undefined
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const vy = ((e.clientY - rect.top) / rect.height) * H
    return {
      x: (vx - PAD - offX) / scale + m.bounds.minX,
      y: (vy - PAD - offY) / scale + m.bounds.minY,
    }
  }

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="Tloris merilnega modela s pripombami">
        {/* mreža */}
        {range(gMinX, gMaxX, gridStep).map((gx) => (
          <line key={`gx${gx}`} x1={tx(gx)} y1={0} x2={tx(gx)} y2={H} className="stroke-muted/30" strokeWidth={1} />
        ))}
        {range(gMinY, gMaxY, gridStep).map((gy) => (
          <line key={`gy${gy}`} x1={0} y1={ty(gy)} x2={W} y2={ty(gy)} className="stroke-muted/30" strokeWidth={1} />
        ))}
        {/* segmenti */}
        {edges.map((e) => {
          const sel = e.key === selectedKey
          const dim = segDim(e.key)
          const st = SEGMENT_STATUSES[e.status as keyof typeof SEGMENT_STATUSES] ?? SEGMENT_STATUSES.ESTIMATED
          return (
            <g key={e.key} opacity={dim ? 0.15 : 1}>
              <line
                x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
                stroke={sel ? STROKE_SELECTED : (STROKE[e.status] ?? STROKE.ESTIMATED)}
                strokeWidth={sel ? 6 : 4} strokeLinecap="round" className="cursor-pointer"
                onClick={(ev) => onSegmentClick(e.key, worldFromEvent(ev))}
              >
                <title>{`${e.key} — ${fmtCm(e.labelCm)} (${st.label})`}</title>
              </line>
              <text
                x={(tx(e.x1) + tx(e.x2)) / 2} y={(ty(e.y1) + ty(e.y2)) / 2 - 8}
                textAnchor="middle" className="fill-foreground pointer-events-none text-[11px]"
              >
                {`${e.key} · ${Math.round(e.labelCm)}`}
              </text>
            </g>
          )
        })}
        {/* vozlišča */}
        {m.nodes.map((n) => <NodeGlyphP key={n.key} n={n} cx={tx(n.p.x)} cy={ty(n.p.y)} dim={nodeDim(n.key)} />)}
        {/* markerji pinov (x/y v svetovnih cm) */}
        {pins.filter((p) => p.x != null && p.y != null).map((p) => {
          const tone = PIN_TONE[p.status] ?? PIN_TONE.ZAPRT
          return (
            <g key={`pin${p.id}`} className="pointer-events-none">
              <circle cx={tx(p.x as number)} cy={ty(p.y as number)} r={7} fill={tone.fill} stroke="#ffffff" strokeWidth={2} />
              <circle cx={tx(p.x as number)} cy={ty(p.y as number)} r={11} fill="none" stroke={tone.fill} strokeWidth={1.5} opacity={0.5} />
              <title>{`Pripomba [${tone.label}] · ${p.targetKey}: ${p.note}`}</title>
            </g>
          )
        })}
        {/* smer +X */}
        <g>
          <defs>
            <marker id="arrowX-pregled" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          <line x1={PAD - 30} y1={H - PAD + 20} x2={PAD + 10} y2={H - PAD + 20} className="stroke-muted-foreground" strokeWidth={1.5} markerEnd="url(#arrowX-pregled)" />
          <text x={PAD - 30} y={H - PAD + 36} className="fill-muted-foreground text-[10px]">+X (smer 1. segmenta)</text>
        </g>
        <ScaleBar scale={scale} y={H - 24} />
      </svg>
      <div className="text-xs text-muted-foreground">Tloris (cm) — {m.originNote}. Pripombe (pike) ne spreminjajo meritev.</div>
    </div>
  )
}

function NodeGlyphP ({ n, cx, cy, dim }: { n: ModelNode; cx: number; cy: number; dim: boolean }) {
  const g = NODE_GLYPH[n.kind] ?? NODE_GLYPH.STEBER
  const fill = n.kind === 'VOGAL' ? '#d97706' : n.kind === 'VRATA' ? '#8b5cf6' : n.kind === 'KONEC' ? '#475569' : '#059669'
  return (
    <g opacity={dim ? 0.15 : 1}>
      {g.shape === 'diamond'
        ? <rect x={cx - 5} y={cy - 5} width={10} height={10} transform={`rotate(45 ${cx} ${cy})`} fill={fill} />
        : g.shape === 'rect'
          ? <rect x={cx - 5} y={cy - 5} width={10} height={10} fill={fill} />
          : <circle cx={cx} cy={cy} r={5} fill={fill} />}
      <text x={cx + 8} y={cy - 6} className="fill-muted-foreground pointer-events-none text-[9px]">{g.label}</text>
      <title>{`${n.key} · ${n.kind}${n.heightCm != null ? ` · h=${n.heightCm} cm` : ''}${n.podlaga != null ? ` · ${n.podlaga}` : ''}`}</title>
    </g>
  )
}

// ─── Profil (elevacija) ─────────────────────────────────────────────────────

function ProfileViewP ({ m, selectedKey, onSelect, segDim }: {
  m: PlanModel; selectedKey: string | null; onSelect: (k: string) => void; segDim: (key: string) => boolean
}) {
  const W = 900; const H = 420; const PAD = 50
  const { points, segs } = projectProfile(m)
  const maxAt = Math.max(1, ...points.map((p) => p.atCm))
  const zMin = Math.min(0, ...points.map((p) => p.zGround)); const zMax = Math.max(1, ...points.map((p) => p.zTop ?? p.zGround))
  const sx = (at: number): number => PAD + (at / maxAt) * (W - 2 * PAD)
  const sy = (z: number): number => H - PAD - ((z - zMin) / (zMax - zMin)) * (H - 2 * PAD)
  const scale = (W - 2 * PAD) / maxAt

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="Višinski profil modela">
        <polyline
          points={points.map((p) => `${sx(p.atCm)},${sy(p.zGround)}`).join(' ')}
          className="fill-none stroke-muted-foreground/60" strokeWidth={2}
        />
        {segs.map((s) => {
          const sel = s.key === selectedKey
          return (
            <line
              key={s.key} x1={sx(s.x1)} y1={sy(s.z1)} x2={sx(s.x2)} y2={sy(s.z2)}
              stroke={sel ? STROKE_SELECTED : (STROKE[s.status] ?? STROKE.ESTIMATED)} strokeWidth={sel ? 6 : 4} strokeLinecap="round"
              className="cursor-pointer" onClick={() => onSelect(s.key)} opacity={segDim(s.key) ? 0.15 : 1}
            >
              <title>{`${s.key} — padina ${s.slopeDeg.toFixed(1)}°`}</title>
            </line>
          )
        })}
        {points.map((p) => (
          <g key={p.key}>
            <line x1={sx(p.atCm)} y1={sy(p.zGround)} x2={sx(p.atCm)} y2={p.zTop != null ? sy(p.zTop) : sy(p.zGround)} className="stroke-foreground/70" strokeWidth={2} />
            <circle cx={sx(p.atCm)} cy={sy(p.zGround)} r={3} className="fill-muted-foreground" />
            <title>{`${p.key} · teren ${Math.round(p.zGround)} cm${p.zTop != null ? ` · vrh ${Math.round(p.zTop)} cm` : ''}`}</title>
          </g>
        ))}
        <polyline
          points={points.filter((p) => p.zTop != null).map((p) => `${sx(p.atCm)},${sy(p.zTop as number)}`).join(' ')}
          className="fill-none stroke-foreground/50" strokeWidth={1.5} strokeDasharray="5 4"
        />
        <ScaleBar scale={scale} y={H - 16} />
      </svg>
      <div className="text-xs text-muted-foreground">Profil ob teku (x = oddaljenost, y = višina v cm) — črtkano = vrhovi stebrov, kjer so znani.</div>
    </div>
  )
}

// ─── 3D perspektiva ─────────────────────────────────────────────────────────

function PerspectiveViewP ({
  m, selectedKey, onSelect, yaw, pitch, setYaw, setPitch, segDim,
}: {
  m: PlanModel; selectedKey: string | null; onSelect: (k: string) => void
  yaw: number; pitch: number; setYaw: (n: number) => void; setPitch: (n: number) => void
  segDim: (key: string) => boolean
}) {
  const W = 900; const H = 560
  const cx = (m.bounds.minX + m.bounds.maxX) / 2; const cy = (m.bounds.minY + m.bounds.maxY) / 2
  const cz = (m.bounds.minZ + m.bounds.maxZ) / 2
  const span = Math.max(
    5, m.bounds.maxX - m.bounds.minX, m.bounds.maxY - m.bounds.minY,
    (m.bounds.maxZ - m.bounds.minZ) + 120,
  )
  const f = Math.max(500, 2.2 * span)
  const P = (x: number, y: number, z: number) => {
    const r = project3d({ x: x - cx, y: y - cy, z: z - cz }, yaw, pitch, f)
    return { sx: W / 2 + r.sx, sy: H / 2 + r.sy, depth: r.depth }
  }

  type Quad = { pts: { sx: number; sy: number; depth: number }[]; key: string; kind: 'seg' | 'terrain' }
  const quads: Quad[] = []
  for (const s of m.segments) {
    const ha = m.nodes.find((n) => n.key === s.fromKey); const hb = m.nodes.find((n) => n.key === s.toKey)
    const hA = ha?.heightCm ?? 110; const hB = hb?.heightCm ?? 110
    const a = { x: s.a.x, y: s.a.y, z: s.a.z }; const b = { x: s.b.x, y: s.b.y, z: s.b.z }
    quads.push({
      key: s.key, kind: 'seg',
      pts: [P(a.x, a.y, a.z), P(b.x, b.y, b.z), P(b.x, b.y, b.z + hB), P(a.x, a.y, a.z + hA)],
    })
    quads.push({ key: s.key, kind: 'terrain', pts: [P(a.x, a.y, a.z - 6), P(b.x, b.y, b.z - 6), P(b.x, b.y, b.z), P(a.x, a.y, a.z)] })
  }
  const terrainQuads = quads.filter((q) => q.kind === 'terrain')
  const segQuads = quads.filter((q) => q.kind === 'seg').sort((q1, q2) => avgDepth(q2) - avgDepth(q1))

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="3D perspektiva modela">
        {terrainQuads.map((q, i) => (
          <polygon
            key={`t${q.key}${i}`} points={q.pts.map((p) => `${p.sx},${p.sy}`).join(' ')}
            className="fill-muted/40 stroke-muted/60" strokeWidth={1}
          />
        ))}
        {segQuads.map((q, i) => {
          const s = m.segments.find((ss) => ss.key === q.key)
          const sel = q.key === selectedKey
          return (
            <polygon
              key={`s${q.key}${i}`} points={q.pts.map((p) => `${p.sx},${p.sy}`).join(' ')}
              fill={sel ? 'rgba(220,38,38,0.35)' : 'rgba(5,150,105,0.18)'}
              stroke={sel ? STROKE_SELECTED : (STROKE[s?.status ?? 'ESTIMATED'] ?? STROKE.ESTIMATED)}
              strokeWidth={sel ? 3 : 2} className="cursor-pointer" onClick={() => onSelect(q.key)}
              opacity={segDim(q.key) ? 0.15 : 1}
            >
              <title>{`${q.key} — ${s ? fmtCm(s.lengthCm) : ''}`}</title>
            </polygon>
          )
        })}
        <polyline
          points={m.nodes.map((n) => { const p = P(n.p.x, n.p.y, n.p.z); return `${p.sx},${p.sy}` }).join(' ')}
          className="fill-none stroke-foreground/50" strokeWidth={1.5}
        />
        <polyline
          points={m.nodes.map((n) => { const p = P(n.p.x, n.p.y, n.p.z + (n.heightCm ?? 110)); return `${p.sx},${p.sy}` }).join(' ')}
          className="fill-none stroke-foreground/80" strokeWidth={2.5} strokeLinejoin="round"
        />
        {m.nodes.map((n) => {
          const h = n.heightCm ?? 110
          const b = P(n.p.x, n.p.y, n.p.z); const t = P(n.p.x, n.p.y, n.p.z + h)
          return (
            <line key={`p${n.key}`} x1={b.sx} y1={b.sy} x2={t.sx} y2={t.sy} className="stroke-foreground/80" strokeWidth={2.5} strokeLinecap="round">
              <title>{`${n.key} · ${n.kind} · h=${h} cm`}</title>
            </line>
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-48 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground"><span>Obhod (yaw)</span><span>{yaw}°</span></div>
          <Slider value={[yaw]} min={-90} max={90} step={5} onValueChange={(v) => setYaw(v[0])} aria-label="Obhod pogleda" />
        </div>
        <div className="flex-1 min-w-48 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground"><span>Nagib (pitch)</span><span>{pitch}°</span></div>
          <Slider value={[pitch]} min={5} max={60} step={5} onValueChange={(v) => setPitch(v[0])} aria-label="Nagib pogleda" />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Perspektivni prikaz — mere (cm) iz tekača; višine stebrov prikazane tudi tam, kjer niso izmerjene (privzeto 110 cm).</div>
    </div>
  )
}

function avgDepth (q: { pts: { depth: number }[] }): number {
  return q.pts.reduce((a, p) => a + p.depth, 0) / q.pts.length
}

// ─── Podatki izbranega segmenta ─────────────────────────────────────────────

function SegmentPanelP ({ seg, m, onPin }: { seg: ModelSegment; m: PlanModel; onPin: (() => void) | undefined }) {
  const st = SEGMENT_STATUSES[seg.status] ?? SEGMENT_STATUSES.ESTIMATED
  const nodeA = m.nodes.find((n) => n.key === seg.fromKey)
  const nodeB = m.nodes.find((n) => n.key === seg.toKey)
  return (
    <Card>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">Segment {seg.key}</div>
          <Badge className={st.cls}>{st.label}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <RowP k="Dolžina (po padini)" v={fmtCm(seg.lengthCm)} />
          <RowP k="Tlorisna dolžina" v={fmtCm(seg.planCm)} />
          <RowP k="Višina polnila" v={seg.heightCm != null ? fmtCm(seg.heightCm) : 'ni izmerjena'} />
          <RowP k="Padina" v={`${seg.slopeDeg.toFixed(1)}°`} />
          <RowP k="Vmesni stebri" v={`${seg.posts}`} />
          <RowP k="σ položaja" v={seg.sigmaCm != null ? `± ${fmtCm(seg.sigmaCm)}` : 'ni podatka'} />
        </dl>
        <div className="space-y-1 border-t pt-2">
          <div className="text-xs text-muted-foreground">
            {seg.verifiedCm != null
              ? `Preverjeno z zunanjim merilnikom: ${fmtCm(seg.verifiedCm)}${seg.verifyMethod ? ` (${seg.verifyMethod})` : ''}`
              : 'Brez zunanje verifikacije — vir: tekač (vnos/kalibracija).'}
          </div>
          <div className="text-xs text-muted-foreground">
            Vozlišči: {nodeA?.key ?? '—'} ({nodeA?.kind ?? '—'}) → {nodeB?.key ?? '—'} ({nodeB?.kind ?? '—'})
          </div>
        </div>
        {onPin && (
          <Button size="sm" variant="outline" className="w-full" onClick={onPin}>
            <MapPin className="size-4" aria-hidden /> Dodaj pripombo na {seg.key}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function RowP ({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium tabular-nums">{v}</dd>
    </div>
  )
}

// ─── Mreža fotografij ────────────────────────────────────────────────────────

function PhotosCard ({
  photos, onOpen, onPin,
}: {
  photos: ReviewPhoto[]
  onOpen: (p: ReviewPhoto) => void
  onPin: ((p: ReviewPhoto) => void) | undefined
}) {
  if (photos.length === 0) {
    return (
      <EmptyState
        icon={Camera}
        title="Tekač nima posnetkov zajema"
        desc="Fotografije se zbirajo v modulu Zajem (reality capture) — tukaj se pokažejo z oznako cone."
      />
    )
  }
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200" role="note">
        <span className="inline-flex items-center gap-1.5 font-medium"><Info className="size-3.5" aria-hidden /> Fotografije zajema niso prostorsko registrirane</span>
        — cona (postanek vodene poti) približno označuje območje ob teku, ne pa točnega mesta na modelu.
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {photos.map((ph) => (
          <Card key={ph.id} className="min-w-0 overflow-hidden pt-0">
            <button
              type="button"
              className="block w-full cursor-zoom-in text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpen(ph)}
              aria-label={`Povečaj posnetek — cona ${ph.zoneLabel}`}
            >
              <div className="relative aspect-video w-full overflow-hidden bg-secondary">
                {ph.thumb ? (
                  <img
                    src={ph.thumb}
                    alt={`Posnetek zajema — cona ${ph.zoneLabel}`}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">brez sličice</div>
                )}
                <span className="absolute left-1.5 top-1.5 rounded-md bg-background/85 px-1.5 py-0.5 text-[10px] font-semibold text-foreground backdrop-blur-sm">
                  {ph.zoneLabel}
                </span>
              </div>
            </button>
            <CardContent className="space-y-1 p-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{ph.zoneLabel}</span>
                {ph.atCm != null ? <span>~{fmtM(ph.atCm)}</span> : null}
                <span>{fmtDate(ph.capturedAt)}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-[9px] text-muted-foreground">ni prostorsko registrirana</Badge>
                {ph.offsetCm != null ? <Badge variant="outline" className="text-[9px]">odmik {fmtCm(ph.offsetCm)}</Badge> : null}
              </div>
              {onPin && (
                <Button
                  size="sm" variant="ghost" className="h-7 w-full gap-1 px-2 text-xs"
                  onClick={() => onPin(ph)}
                >
                  <MapPin className="size-3.5" aria-hidden /> Pripni pripombo
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Prikazane so sličice zajema (≤ 120 KB) — interno. Celotne fotografije živijo v merjenjih; javno se izpišejo samo ob veljavnem soglasju.</p>
    </div>
  )
}

// ─── Nov pin (pripomba) ──────────────────────────────────────────────────────

function PinDialog ({
  target, runId, onClose, onCreated,
}: {
  target: { targetType: string; targetKey: string; x?: number; y?: number }
  runId: string
  onClose: () => void
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [note, setNote] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit (): Promise<void> {
    if (!note.trim()) {
      toast({ title: 'Opomba je obvezna.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost('/api/pins', {
        fenceRunId: runId,
        targetType: target.targetType,
        targetKey: target.targetKey,
        note: note.trim(),
        internalNote: internalNote.trim() || undefined,
        ...(target.x != null && target.y != null ? { x: target.x, y: target.y } : {}),
      })
      toast({
        title: 'Pripomba pripeta.',
        description: `Cilj: ${TARGET_LABEL[target.targetType]} ${target.targetKey}. Pripombe ne spreminjajo meritev.`,
      })
      onCreated()
    } catch (e) {
      toast({
        title: 'Pripombe ni bilo mogoče pripeti.',
        description: e instanceof Error ? e.message : 'Neznana napaka.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Nova pripomba (pin)</DialogTitle>
        <DialogDescription>
          Cilj: {TARGET_LABEL[target.targetType] ?? target.targetType} <code className="font-mono text-xs">{target.targetKey}</code>
          {target.x != null && target.y != null
            ? ` · pozicija klika (${Math.round(target.x)}, ${Math.round(target.y)}) cm`
            : ''}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="pin-note">Javna opomba *</Label>
        <Textarea
          id="pin-note" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="npr. Preveriti spojnik na segmentu …"
          rows={3} maxLength={2000}
        />
        <p className="text-xs text-muted-foreground">Vidna vsem z dostopom (tudi v javni povezavi pregleda).</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pin-internal">Interna opomba</Label>
        <Textarea
          id="pin-internal" value={internalNote} onChange={(e) => setInternalNote(e.target.value)}
          placeholder="samo za pisarno/monterje — NE izide v javni povezavi"
          rows={2} maxLength={2000}
        />
      </div>
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200" role="note">
        <span className="inline-flex items-center gap-1.5 font-medium"><Info className="size-3.5" aria-hidden /> Pripombe ne spreminjajo meritev.</span>
        {' '}Za spremembo mere uporabite preverjanje/potrditev v modulu Ogradnja (z revizijo).
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
          Pripni pripombo
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// ─── Seznam pinov (filtri + dejanja) ─────────────────────────────────────────

function PinsCard ({
  pins, user, canPin, onNew, onReload,
}: {
  pins: ReviewPin[]
  user: { id: string; role: string } | null
  canPin: boolean
  onNew: () => void
  onReload: () => void
}) {
  const { toast } = useToast()
  const [statusF, setStatusF] = useState('VSI')
  const [typeF, setTypeF] = useState('VSI')
  const [busy, setBusy] = useState(false)

  // urejanje/brisanje: avtor ali pisarna (ADMIN/VODJA) — isti pogoj kot strežnik
  const isOffice = user?.role === 'ADMIN' || user?.role === 'VODJA'
  const canManage = (p: ReviewPin): boolean => !!user && (isOffice || p.author?.id === user.id)

  const filtered = pins
    .filter((p) => statusF === 'VSI' || p.status === statusF)
    .filter((p) => typeF === 'VSI' || p.targetType === typeF)

  async function transition (p: ReviewPin, status: 'RESENO' | 'ZAPRT'): Promise<void> {
    setBusy(true)
    try {
      await apiPatch(`/api/pins/${p.id}`, { status })
      toast({ title: `Pripomba ${status === 'RESENO' ? 'rešena' : 'zaprta'}.`, description: `${p.targetKey} — ${p.note}` })
      onReload()
    } catch (e) {
      toast({ title: 'Dejanje ni uspelo.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function remove (p: ReviewPin): Promise<void> {
    setBusy(true)
    try {
      await apiDelete(`/api/pins/${p.id}`)
      toast({ title: 'Pripomba izbrisana.', description: 'Izbrisati je mogoče samo odprto pripombo.' })
      onReload()
    } catch (e) {
      toast({ title: 'Brisanje ni uspelo.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-2.5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-medium"><MessageSquare className="size-4 text-muted-foreground" aria-hidden /> Pripombe ({pins.length})</div>
          {canPin && (
            <Button size="sm" variant="outline" onClick={onNew}>
              <Plus className="size-4" aria-hidden /> Nova pripomba
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger aria-label="Filter po statusu"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="VSI">Vsi statusi</SelectItem>
              <SelectItem value="ODPRTO">Odprto</SelectItem>
              <SelectItem value="RESENO">Rešeno</SelectItem>
              <SelectItem value="ZAPRT">Zaprto</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeF} onValueChange={setTypeF}>
            <SelectTrigger aria-label="Filter po cilju"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="VSI">Vsi cilji</SelectItem>
              <SelectItem value="SEGMENT">Segmenti</SelectItem>
              <SelectItem value="VOZLISCE">Vozlišča</SelectItem>
              <SelectItem value="FOTOGRAFIJA">Fotografije</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {pins.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ni pripomb. Kliknite segment na tlorisu ali fotografijo v mreži, da pripnete prvo.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground"> Nobena pripomba ne ustreza filtru.</p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((p) => {
              const tone = PIN_TONE[p.status] ?? PIN_TONE.ZAPRT
              const snap = pinSnapshotSummary(p)
              return (
                <li key={p.id} className="rounded-lg border p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className={tone.cls}>{tone.label}</Badge>
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {p.targetKey}
                    </code>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{TARGET_LABEL[p.targetType] ?? p.targetType}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{fmtDateTime(p.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-sm">{p.note}</p>
                  {p.internalNote && (
                    <p className="mt-1 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-xs italic text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      <span className="mr-1 font-semibold not-italic">INTERNO:</span>{p.internalNote}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{p.author?.name ?? '—'}</span>
                    {p.resolvedAt ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="size-3" aria-hidden />
                        {p.resolvedBy?.name ?? '—'} · {fmtDate(p.resolvedAt)}
                      </span>
                    ) : null}
                    {snap ? <span className="min-w-0 truncate" title={snap}>{snap}</span> : null}
                  </div>
                  {canManage(p) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {p.status === 'ODPRTO' && (
                        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void transition(p, 'RESENO')}>
                          <CheckCircle2 className="size-3.5" aria-hidden /> Reši
                        </Button>
                      )}
                      {(p.status === 'ODPRTO' || p.status === 'RESENO') && (
                        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void transition(p, 'ZAPRT')}>
                          <XCircle className="size-3.5" aria-hidden /> Zapri
                        </Button>
                      )}
                      {p.status === 'ODPRTO' && (
                        <Button
                          size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={busy} onClick={() => void remove(p)}
                        >
                          <Trash2 className="size-3.5" aria-hidden /> Izbriši
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          Prehodi so enosmerni (odprto → rešeno/zaprto → zaprto) — zgodovina ostane v reviziji. Pripombe ne spreminjajo meritev.
        </p>
      </CardContent>
    </Card>
  )
}

// ─── Replay zajema (kazalci na obstoječi motor R465) ─────────────────────────

interface ReplayStepLite {
  n: number
  photo: { thumb: string | null; zoneLabel: string; zoneKind: string | null; critical: boolean | null; offsetCm: number | null; capturedAt: string }
}
interface ReplayPayloadLite {
  session: { id: string; name: string; status: string }
  steps: ReplayStepLite[]
}

function ReplayCard ({
  replay, onOpen,
}: {
  replay: { id: string; name: string; status: string; photoCount: number; replayUrl: string }[]
  onOpen: (id: string) => void
}) {
  if (replay.length === 0) {
    return (
      <Card><CardContent className="space-y-1 text-sm">
        <div className="flex items-center gap-1.5 font-medium"><Film className="size-4 text-muted-foreground" aria-hidden /> Ponovitev zajema</div>
        <p className="text-xs text-muted-foreground">Tekač še ni imel zajema — replay bo na voljo, ko bodo posnetki.</p>
      </CardContent></Card>
    )
  }
  return (
    <Card>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center gap-1.5 font-medium"><Film className="size-4 text-muted-foreground" aria-hidden /> Ponovitev zajema</div>
        <ul className="space-y-1.5">
          {replay.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{r.name}</p>
                <p className="text-[11px] text-muted-foreground">{r.status} · {r.photoCount} posnetkov</p>
              </div>
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => onOpen(r.id)}>
                <Play className="size-3.5" aria-hidden /> Predvajaj
              </Button>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">Predvajanje po korakih — obstoječi replay motor (R465), samo za ogled in izobraževanje.</p>
      </CardContent>
    </Card>
  )
}

function ReplayDialog ({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const replay = useApi<{ data: ReplayPayloadLite }>(`/api/capture-session/${sessionId}/replay`, [sessionId])
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  const steps = replay.data?.data.steps ?? []
  const step = steps[idx] ?? null

  const loadedId = replay.data?.data.session.id ?? null
  const [lastLoadedId, setLastLoadedId] = useState(loadedId)
  if (loadedId !== lastLoadedId) {
    setLastLoadedId(loadedId)
    setIdx(0)
    setPlaying(false)
  }

  // predvajanje — korak na 1,2 s (asinhrono v callbacku, uradni vzorec)
  useEffect(() => {
    if (!playing || steps.length === 0 || idx >= steps.length - 1) return
    const t = setTimeout(() => {
      setIdx((i) => Math.min(i + 1, steps.length - 1))
      if (idx + 1 >= steps.length - 1) setPlaying(false)
    }, 1200)
    return () => clearTimeout(t)
  }, [playing, idx, steps.length])

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Replay zajema — {replay.data?.data.session.name ?? '…'}</DialogTitle>
        <DialogDescription>Predvajanje zajema po korakih (samo za ogled) — kronološko zaporedje zajema.</DialogDescription>
      </DialogHeader>
      <ErrorBox error={replay.error} />
      {replay.loading ? <LoadingRows rows={2} /> : !replay.error && steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">Zajem še ni dodal posnetkov.</p>
      ) : !replay.error && step ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm" variant="outline" aria-label={playing ? 'Ustavi predvajanje' : 'Predvajaj'}
              onClick={() => setPlaying((p) => !p)} disabled={steps.length <= 1}
            >
              {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            </Button>
            <Button size="sm" variant="outline" aria-label="Prejšnji korak" onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)) }} disabled={idx === 0}>
              <ArrowLeftRight className="size-4 rotate-180" aria-hidden />
            </Button>
            <Button size="sm" variant="outline" aria-label="Naslednji korak" onClick={() => { setPlaying(false); setIdx((i) => Math.min(steps.length - 1, i + 1)) }} disabled={idx >= steps.length - 1}>
              <ArrowLeftRight className="size-4" aria-hidden />
            </Button>
            <span className="ml-1 text-sm font-medium tabular-nums">Korak {step.n} / {steps.length}</span>
            <span className="ml-auto text-xs text-muted-foreground">{new Date(step.photo.capturedAt).toLocaleTimeString('sl-SI')}</span>
          </div>
          <div>
            <label htmlFor="replay-slider-pregled" className="sr-only">Položaj predvajanja</label>
            <input
              id="replay-slider-pregled" type="range" min={0} max={Math.max(0, steps.length - 1)} step={1} value={idx}
              onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)) }}
              className="w-full accent-roksal-amber"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{step.photo.zoneLabel}</span>
            {step.photo.zoneKind ? <Badge variant="outline" className="text-[10px]">{step.photo.zoneKind}</Badge> : null}
            {step.photo.critical ? <Badge variant="outline" className="text-[10px]">kritično</Badge> : null}
            {step.photo.offsetCm != null ? <Badge variant="outline" className="text-[10px]">odmik {fmtCm(step.photo.offsetCm)}</Badge> : null}
          </div>
          {step.photo.thumb ? (
            <img src={step.photo.thumb} alt={`Posnetek ${step.n} — ${step.photo.zoneLabel}`} className="max-h-[50vh] w-full rounded-lg border object-contain" />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">brez sličice</div>
          )}
        </div>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Zapri</Button>
      </DialogFooter>
    </DialogContent>
  )
}

// ─── Javna delitev + GDPR soglasje ───────────────────────────────────────────

interface PublicReviewData {
  run: { name: string; status: string }
  project: { code: string; title: string; customerName: string | null } | null
  model: PlanModel
  photos: { id: string; zoneLabel: string; atCm: number | null; thumb: string | null; capturedAt: string }[]
  photosBlocked: string | null
  pins: { id: string; targetKey: string; targetType: string; note: string; status: string; x: number | null; y: number | null; authorName: string | null; createdAt: string }[]
  consent: string
  link: { expiresAt: string }
}

function ShareCard ({
  runId, projectId, projectCode, consent, onConsentChange,
}: {
  runId: string
  projectId: string
  projectCode: string
  consent: { status: 'MANJKA' | 'VELJAVNO' | 'POTEKLO'; photosBlocked: string | null }
  onConsentChange: () => void
}) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const canLinks = hasPerm(user?.perms, 'portal.manage')
  const canConsent = hasPerm(user?.perms, 'customers.write')

  const links = useApi<{ data: ReviewLinkRow[] }>(canLinks && runId ? `/api/fence-run/${runId}/review-link` : null, [runId, canLinks])
  const [days, setDays] = useState('14')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  const rows = links.data?.data ?? []
  const activeCount = rows.filter((l) => l.active).length

  async function setConsent (action: 'SET' | 'CLEAR', validDays?: number): Promise<void> {
    setBusy(true)
    try {
      await apiPost(`/api/projects/${projectId}/consent`, { action, ...(action === 'SET' && validDays != null ? { validDays } : {}) })
      toast({
        title: action === 'SET' ? 'Soglasje za fotografije zapisano.' : 'Soglasje umaknjeno.',
        description: action === 'SET'
          ? 'Fotografije bodo javno vidne (portal, javna povezava pregleda).'
          : 'Fotografije javnih povezav so takoj zamaknjene.',
      })
      onConsentChange()
    } catch (e) {
      toast({ title: 'Sprememba soglasja ni uspela.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function createLink (): Promise<void> {
    const d = Math.trunc(Number(days))
    if (!Number.isFinite(d) || d < 1 || d > 90) {
      toast({ title: 'Neveljaven rok.', description: 'Dovoljenih je 1–90 dni.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: ReviewLinkRow }>(`/api/fence-run/${runId}/review-link`, { days: d, note: note.trim() || undefined })
      toast({
        title: 'Javna povezava ustvarjena.',
        description: `Velja ${d} dni — kopirajte URL in ga pošljite stranki.`,
      })
      setNote('')
      await links.reload()
      // samodejno ponudi kopiranje sveže povezave
      void copyUrl(res.data.url)
    } catch (e) {
      toast({ title: 'Ustvarjanje povezave ni uspelo.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function copyUrl (relUrl: string): Promise<void> {
    const url = `${location.origin}${relUrl}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'URL kopiran.', description: 'Javni pogled brez prijave — brez internih opomb.' })
    } catch {
      toast({ title: 'Kopiranje ni uspelo.', description: url, variant: 'destructive' })
    }
  }

  async function revoke (id: string): Promise<void> {
    setBusy(true)
    try {
      await apiDelete(`/api/fence-run/${runId}/review-link?id=${id}`)
      toast({ title: 'Povezava preklicana.', description: 'Javni dostop takoj preneha (404).' })
      await links.reload()
    } catch (e) {
      toast({ title: 'Preklic ni uspel.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const consentBadge = consent.status === 'VELJAVNO'
    ? <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">soglasje veljavno</Badge>
    : consent.status === 'POTEKLO'
      ? <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">soglasje poteklo</Badge>
      : <Badge className="border-transparent bg-muted text-muted-foreground">soglasje manjka</Badge>

  return (
    <Card>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-medium"><Link2 className="size-4 text-roksal-amber" aria-hidden /> Javna delitev pregleda</div>
          {consentBadge}
        </div>

        {/* GDPR opozorilo pred izdajo povezave */}
        {consent.status !== 'VELJAVNO' && (
          <div className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200" role="alert">
            <span className="inline-flex items-center gap-1.5 font-medium"><ShieldCheck className="size-3.5" aria-hidden /> Fotografije ne bodo javno vidne brez soglasja.</span>
            {' '}Javna povezava bo pokazala model in pripombe, fotografije pa ostanejo zamaknjene, dokler stranka ne da soglasja za objavo.
            {canConsent && (
              <Button size="sm" variant="outline" className="mt-1.5 h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void setConsent('SET', 365)}>
                <ShieldCheck className="size-3.5" aria-hidden /> Zapiši soglasje (1 leto)
              </Button>
            )}
          </div>
        )}

        {canLinks ? (
          <>
            <div className="grid gap-2 sm:grid-cols-[100px_1fr]">
              <div className="space-y-1">
                <Label htmlFor="rl-days">Rok (dni)</Label>
                <Input id="rl-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Veljavnost povezave v dnevih" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rl-note">Opomba (interna)</Label>
                <Input id="rl-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. poslano na e-pošto" maxLength={200} />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => void createLink()} disabled={busy}>
              <Plus className="size-4" aria-hidden /> Ustvari povezavo (1–90 dni)
            </Button>

            <ErrorBox error={links.error} />
            {links.loading ? <LoadingRows rows={1} /> : !links.error && rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ni še javnih povezav tega tekača.</p>
            ) : !links.error ? (
              <ul className="space-y-1.5">
                {rows.map((l) => (
                  <li key={l.id} className="rounded-lg border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">…{l.token.slice(-10)}</code>
                      {l.active ? (
                        <Badge className="border-transparent bg-emerald-700 text-white">velja</Badge>
                      ) : (
                        <Badge variant="secondary">{l.revokedAt ? 'preklicana' : 'potekla'}</Badge>
                      )}
                      <span className="ml-auto inline-flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Eye className="size-3" aria-hidden />{l.viewCount}</span>
                        <span>do {fmtDate(l.expiresAt)}</span>
                      </span>
                    </div>
                    {l.note ? <p className="mt-1 truncate text-xs text-muted-foreground">{l.note}</p> : null}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setPreview(l.token)} disabled={!l.active}>
                        <Eye className="size-3.5" aria-hidden /> Predogled
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => void copyUrl(l.url)}>
                        <Copy className="size-3.5" aria-hidden /> Kopiraj URL
                      </Button>
                      {l.active ? (
                        <Button
                          size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={busy} onClick={() => void revoke(l.id)}
                        >
                          Prekliči
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Javni pogled: model, pripombe (brez internih opomb) in fotografije samo ob veljavnem soglasju. Žeton je omejen, preklicljiv, s tempomatom.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Upravljanje javnih povezav zahteva pravico portal.manage (pisarna).</p>
        )}

        {/* soglasje — polje pisarne */}
        {canConsent && (
          <div className="space-y-1.5 border-t pt-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium"><Lock className="size-3.5 text-muted-foreground" aria-hidden /> Soglasje za fotografije ({projectCode || 'projekt'})</div>
            <p className="text-[11px] text-muted-foreground">
              {consent.status === 'VELJAVNO'
                ? 'Fotografije so javno vidne na portalu in javni povezavi pregleda.'
                : consent.status === 'POTEKLO'
                  ? 'Soglasje je poteklo — javne fotografije so zamaknjene.'
                  : 'Soglasje ni zapisano — javne fotografije so zamaknjene (interno ostanejo vidne).'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void setConsent('SET')}>
                <ShieldCheck className="size-3.5" aria-hidden /> Zapiši (brez roka)
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => void setConsent('SET', 1825)}>
                <ShieldCheck className="size-3.5" aria-hidden /> Zapiši (5 let)
              </Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive" disabled={busy || consent.status === 'MANJKA'} onClick={() => void setConsent('CLEAR')}>
                Umakni
              </Button>
            </div>
          </div>
        )}

        {/* predogled javnega pogleda — natanko to, kar vidi stranka */}
        <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null) }}>
          {preview && <PublicPreviewDialog token={preview} code={projectCode} />}
        </Dialog>
      </CardContent>
    </Card>
  )
}

function PublicPreviewDialog ({ token, code }: { token: string; code: string }) {
  // javni endpoint — enak odgovor kot pri stranki (fetch brez overitve)
  const view = useApi<{ data: PublicReviewData }>(`/api/public/review?token=${token}`, [token])
  const d = view.data?.data
  const m = d?.model

  return (
    <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Predogled javnega pregleda — {code}</DialogTitle>
        <DialogDescription>
          Točno to vidi prejemnik povezave (brez prijave): risba, pripombe brez internih opomb{d?.photosBlocked ? ', fotografije zamaknjene' : ', fotografije ob soglasju'}.
          {d?.link ? ` Povezava velja do ${fmtDate(d.link.expiresAt)}.` : ''}
        </DialogDescription>
      </DialogHeader>
      <ErrorBox error={view.error} />
      {view.loading ? <LoadingRows rows={4} /> : d && m ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{d.run.name}</span>
            <Badge variant="outline">{d.run.status}</Badge>
            {d.project?.customerName ? <span className="text-xs text-muted-foreground">{d.project.customerName}</span> : null}
          </div>
          {/* risba iz javnega modela (brez klikov, brez internih podatkov) */}
          <PublicPlanView m={m} pins={d.pins.map((p) => ({ id: p.id, targetType: p.targetType, x: p.x, y: p.y, targetKey: p.targetKey, status: p.status, note: p.note }))} />
          {d.photosBlocked ? (
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              Fotografije niso javno prikazane — {d.photosBlocked === 'SOGLASJE_POTEKLO' ? 'soglasje je poteklo' : 'manjka soglasje za objavo'}.
            </p>
          ) : d.photos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {d.photos.map((ph) => (
                ph.thumb ? (
                  <img
                    key={ph.id} src={ph.thumb}
                    alt={`Posnetek — cona ${ph.zoneLabel}`}
                    className="aspect-video w-full rounded-lg border object-cover"
                  />
                ) : null
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Brez fotografij.</p>
          )}
          {d.pins.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pripombe (javno)</div>
              <ul className="space-y-1.5">
                {d.pins.map((p) => {
                  const tone = PIN_TONE[p.status] ?? PIN_TONE.ZAPRT
                  return (
                    <li key={p.id} className="rounded-lg border p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className={tone.cls}>{tone.label}</Badge>
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{p.targetKey}</code>
                        <span className="ml-auto text-[10px] text-muted-foreground">{p.authorName ?? '—'}</span>
                      </div>
                      <p className="mt-1">{p.note}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Brez pripomb.</p>
          )}
        </div>
      ) : null}
    </DialogContent>
  )
}

/** Preprost javni tloris (brez interakcije) — isti izris kot interni, iz javnega modela. */
function PublicPlanView ({ m, pins }: { m: PlanModel; pins: PinMarker[] }) {
  const W = 900; const H = 420; const PAD = 60
  const bw = Math.max(1, m.bounds.maxX - m.bounds.minX); const bh = Math.max(1, m.bounds.maxY - m.bounds.minY)
  const scale = Math.min((W - 2 * PAD) / bw, (H - 2 * PAD) / bh)
  const tx = (x: number): number => (x - m.bounds.minX) * scale + PAD + ((W - 2 * PAD) - bw * scale) / 2
  const ty = (y: number): number => (y - m.bounds.minY) * scale + PAD + ((H - 2 * PAD) - bh * scale) / 2
  const edges = projectPlan(m)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="Javni tloris modela">
      {edges.map((e) => (
        <g key={e.key}>
          <line
            x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
            stroke={STROKE[e.status] ?? STROKE.ESTIMATED} strokeWidth={4} strokeLinecap="round"
          />
          <text
            x={(tx(e.x1) + tx(e.x2)) / 2} y={(ty(e.y1) + ty(e.y2)) / 2 - 8}
            textAnchor="middle" className="fill-foreground text-[11px]"
          >
            {`${e.key} · ${Math.round(e.labelCm)}`}
          </text>
        </g>
      ))}
      {m.nodes.map((n) => {
        const g = NODE_GLYPH[n.kind] ?? NODE_GLYPH.STEBER
        const fill = n.kind === 'VOGAL' ? '#d97706' : n.kind === 'VRATA' ? '#8b5cf6' : n.kind === 'KONEC' ? '#475569' : '#059669'
        return (
          <circle key={n.key} cx={tx(n.p.x)} cy={ty(n.p.y)} r={5} fill={fill}>
            <title>{`${n.key} · ${n.kind}`}</title>
          </circle>
        )
      })}
      {/* pini z znanim x/y (javni pogled: javne pripombe) */}
      {pins.filter((p) => p.x != null && p.y != null).map((p) => {
        const tone = PIN_TONE[p.status] ?? PIN_TONE.ZAPRT
        return (
          <circle key={`pp${p.id}`} cx={tx(p.x as number)} cy={ty(p.y as number)} r={6} fill={tone.fill} stroke="#ffffff" strokeWidth={2}>
            <title>{`Pripomba [${tone.label}] · ${p.targetKey}: ${p.note}`}</title>
          </circle>
        )
      })}
      <ScaleBar scale={scale} y={H - 20} />
    </svg>
  )
}

// ─── Pomožno ────────────────────────────────────────────────────────────────

function ScaleBar ({ scale, y }: { scale: number; y: number }) {
  const cm = niceStep(120 / scale) // ~120 px
  const px = cm * scale
  return (
    <g>
      <rect x={24} y={y - 10} width={px} height={5} className="fill-foreground" />
      <rect x={24 + px} y={y - 10} width={px} height={5} className="fill-background stroke-foreground" strokeWidth={1} />
      <text x={24} y={y - 16} className="fill-foreground text-[10px]">{cm} cm</text>
      <text x={24 + px * 2 + 6} y={y - 16} className="fill-foreground text-[10px]">{cm * 2} cm</text>
    </g>
  )
}

function niceStep (min: number): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
  return steps.find((s) => s >= min) ?? 10000
}

function range (a: number, b: number, step: number): number[] {
  const out: number[] = []
  for (let v = a; v <= b + 0.001; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

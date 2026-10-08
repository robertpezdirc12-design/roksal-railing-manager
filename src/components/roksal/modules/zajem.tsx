'use client'

// ZAJEM — ROKSAL REALITY CAPTURE QA (R461 — issue #16)
// Terenska konzola vodenega zajema: LIVE COVERAGE MAP (§1), vodena ruta (§2),
// drift (§3), multi-reference mreža (§4), zunanji pogoji (§16), prekinitev in
// nadaljevanje (§17) ter zaključek z VRATI → AS-MEASURED snapshot (§9).
// Nadstropje nad tekačem (R460) — geometrija ostaja tam.

import { useEffect, useMemo, useState } from 'react'
import {
  Boxes, Camera, CheckCircle2, Circle, FlagTriangleRight, Loader2, MapPin,
  Pause, Play, Plus, RadioTower, RefreshCw, Ruler, Satellite, Trash2,
  TriangleAlert, Waypoints,
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
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiGet, apiPatch, apiPost, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import {
  DRIFT_STATES, OUTDOOR_CONDITIONS, REF_METHODS, STOP_KINDS, TIER_LABELS, ZONE_STATES,
  type DriftState, type ZoneState,
} from '@/lib/capture-qa-engine'

// ─── Tipi ───────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string; name: string; status: string; mode: string; updatedAt: string
  project: { code: string; title: string } | null
  author: { name: string } | null
  fenceRunId: string | null; snapshotId: string | null
  photoCount: number; refCount: number; refConflicts: number
  coverageOk: boolean; coverageZones: number; driftStatus: string | null
}

interface AnalysisPayload {
  plan: { id: string; kind: keyof typeof STOP_KINDS; label: string; atCm?: number; critical: boolean }[]
  coverage: {
    zones: { stopId: string; label: string; critical: boolean; state: ZoneState; photoCount: number; goodCount: number }[]
    criticalMissing: string[]
    gateOk: boolean
  }
  drift: { state: DriftState; maxAbsCm: number; lastRefCode: string | null }
  refs: {
    pairs: { fromCode: string; toCode: string; declaredCm: number; measuredCm: number; diffCm: number; toleranceCm: number; conflict: boolean }[]
    conflicts: string[]
    activeCount: number
  }
  outdoorFactor: number
  requireExtraReference: boolean
  criticalGate: { ponudba: boolean; konfiguracija: boolean; proizvodnja: boolean; manjka: { code: string; message: string }[] } | null
  gates: { coverageOk: boolean; stopsDone: boolean; referencesOk: boolean; driftOk: boolean; allOk: boolean; reasons: string[] }
}

interface SessionDetail {
  id: string; name: string; status: string; mode: string; projectId: string
  fenceRunId: string | null; snapshotId: string | null; note: string | null
  device: { tier: string; caps: Record<string, boolean> } | null
  outdoor: { conditions: string[]; note?: string } | null
  state: { currentStopId: string | null; doneStops: string[] }
  run: {
    id: string; name: string; status: string; measurementId: string | null
    segments: { order: number; lengthCm: number; heightCm: number | null; slopeDeg: number; status: string; hasGate: boolean }[]
  } | null
  references: {
    id: string; code: string; label: string | null; atCm: number; measureCm: number
    method: string; device: string | null; status: string; confidence: number | null
    note: string | null; createdAt: string
  }[]
  photos: { id: string; clientKey: string; zone: string; quality: { dark?: boolean; bright?: boolean; blurry?: boolean } | null; offsetCm: number | null; capturedAt: string }[]
  analysis: AnalysisPayload
}

interface ProjectOption { id: string; code: string; title: string }
interface RunOption { id: string; name: string; status: string; totalLengthCm: number; segmentCount: number }

const STATUS_BADGE: Record<string, string> = {
  V_TEKU: 'bg-sky-100 text-sky-800 border-sky-300',
  PREKINJEN: 'bg-amber-100 text-amber-900 border-amber-300',
  ZAKLJUCEN: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}

// ─── Modul ──────────────────────────────────────────────────────────────────

export default function ZajemModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [refresh, setRefresh] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const list = useApi<{ data: SessionRow[] }>(`/api/capture-session?t=${refresh}`, [refresh])
  const mayWrite = user ? hasPerm(user.perms, 'measurements.write') : false

  const closeDetail = () => {
    setDetailId(null)
    setDetail(null)
    setDetailError(null)
    setLoadingDetail(false)
  }

  useEffect(() => {
    if (!detailId) return
    let alive = true
    const load = async () => {
      setLoadingDetail(true)
      setDetailError(null)
      try {
        const r = await apiGet<{ data: SessionDetail }>(`/api/capture-session/${detailId}`)
        if (alive) setDetail(r.data)
      } catch (e) {
        if (alive) setDetailError((e as Error).message)
      } finally {
        if (alive) setLoadingDetail(false)
      }
    }
    void load()
    return () => { alive = false }
  }, [detailId, refresh])

  const reloadAll = () => setRefresh((n) => n + 1)

  async function deleteSession (id: string, name: string) {
    if (!window.confirm(`Brisanje zajema »${name}«? Zgodovina se izgubi.`)) return
    try {
      await apiDelete(`/api/capture-session/${id}`)
      toast({ title: 'Zajem izbrisan' })
      closeDetail()
      reloadAll()
    } catch (e) {
      toast({ title: 'Napaka', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Zajem — Reality Capture QA"
        desc="Vodeni zajem s pokritostjo, drift kontrolo in referenčno mrežo (R461)"
        actions={mayWrite ? (
          <Button onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" />Nov zajem</Button>
        ) : undefined}
      />

      {list.error && <ErrorBox error={list.error} />}
      {list.loading && <LoadingRows />}
      {!list.loading && !list.error && (list.data?.data.length ?? 0) === 0 && (
        <EmptyState
          title="Ni zajemov"
          desc="Začnite vodeni zajem nad ograjnim tekačem — pokritost, reference in drift se preverjajo sproti."
          icon={Camera}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(list.data?.data ?? []).map((s) => (
          <Card key={s.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => setDetailId(s.id)}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.project?.code ?? '—'} · {s.author?.name ?? '—'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] ?? ''}`}>{s.status}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="outline" className="gap-1"><Waypoints className="h-3 w-3" />{s.mode === 'FENCE_RUN' ? 'tekač' : 'kamera'}</Badge>
                <Badge variant="outline" className={s.coverageOk ? 'border-emerald-300 text-emerald-700' : 'border-red-300 text-red-700'}>
                  pokritost {s.coverageOk ? '✓' : '✗'}
                </Badge>
                <Badge variant="outline" className={s.driftStatus === 'RE_LOC_REQUIRED' ? 'border-red-300 text-red-700' : s.driftStatus === 'DRIFT_WARNING' ? 'border-amber-300 text-amber-800' : 'border-emerald-300 text-emerald-700'}>
                  drift {s.driftStatus === 'RE_LOC_REQUIRED' ? '✗' : s.driftStatus === 'DRIFT_WARNING' ? '!' : '✓'}
                </Badge>
                <Badge variant="outline" className="gap-1"><Camera className="h-3 w-3" />{s.photoCount}</Badge>
                {s.refConflicts > 0 && (
                  <Badge variant="outline" className="border-red-300 text-red-700"><TriangleAlert className="mr-1 h-3 w-3" />{s.refConflicts} konflikt</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ustvari zajem */}
      <NewSessionDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); setDetailId(id); reloadAll() }} />

      {/* podrobnost */}
      <Dialog open={detailId != null} onOpenChange={(o) => { if (!o) closeDetail() }}>
        <DialogContent className="max-h-[92vh] w-[min(980px,96vw)] overflow-hidden p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{detail?.name ?? 'Zajem'}</DialogTitle>
            <DialogDescription>Podrobnost zajema s pokritostjo, ruto, referencami in driftom.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[86vh] p-6">
            {loadingDetail && <LoadingRows />}
            {detailError && <ErrorBox error={{ message: detailError }} />}
            {detail && (
              <SessionDetailBody
                detail={detail}
                mayWrite={mayWrite}
                onReload={reloadAll}
                onDelete={() => deleteSession(detail.id, detail.name)}
              />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Nov zajem ──────────────────────────────────────────────────────────────

function NewSessionDialog ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { toast } = useToast()
  const projects = useApi<{ data: ProjectOption[] }>('/api/projects', [])
  const [projectId, setProjectId] = useState('')
  const [mode, setMode] = useState<'FENCE_RUN' | 'KAMERA'>('FENCE_RUN')
  const [fenceRunId, setFenceRunId] = useState('')
  const [name, setName] = useState('')
  const [caps, setCaps] = useState<Record<string, boolean>>({ camera: true, gyro: true, gps: true })
  const [conditions, setConditions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const runs = useApi<{ data: RunOption[] }>(projectId ? `/api/fence-run?projectId=${projectId}` : null, [projectId])

  const tier = useMemo(() => {
    if ((caps.lidar || caps.depth) && caps.ar && caps.camera) return 'PREMIUM'
    if (caps.ar && caps.camera) return 'STANDARD'
    return 'BASIC'
  }, [caps])

  async function submit () {
    if (!projectId) { toast({ title: 'Izberite projekt' }); return }
    if (mode === 'FENCE_RUN' && !fenceRunId) { toast({ title: 'Izberite tekač', description: 'Zajem FENCE_RUN je vezan na ograjni tekač.' }); return }
    setSaving(true)
    try {
      const res = await apiPost<{ data: { id: string } }>('/api/capture-session', {
        projectId, mode, fenceRunId: mode === 'FENCE_RUN' ? fenceRunId : undefined,
        name: name || undefined,
        device: { tier, caps },
        outdoor: { conditions },
      })
      toast({ title: 'Zajem ustvarjen', description: `Režim naprave: ${tier}` })
      onCreated(res.data.id)
    } catch (e) {
      toast({ title: 'Napaka', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[min(560px,95vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera className="h-5 w-5" />Nov zajem (vodena ruta)</DialogTitle>
          <DialogDescription>
            Ruta izhaja iz geometrije tekača — pokritost, reference in drift se preverjajo sproti (§2).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Projekt *</Label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); setFenceRunId('') }}>
              <SelectTrigger><SelectValue placeholder="Izberite projekt" /></SelectTrigger>
              <SelectContent>
                {(projects.data?.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Način</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'FENCE_RUN' | 'KAMERA')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FENCE_RUN">FENCE_RUN — nad ograjnim tekačem (priporočeno)</SelectItem>
                <SelectItem value="KAMERA">KAMERA — splošni objekt</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === 'FENCE_RUN' && (
            <div className="grid gap-2">
              <Label>Tekač *</Label>
              <Select value={fenceRunId} onValueChange={setFenceRunId}>
                <SelectTrigger><SelectValue placeholder={runs.loading ? 'Nalagam…' : 'Izberite tekač'} /></SelectTrigger>
                <SelectContent>
                  {(runs.data?.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {(r.totalLengthCm / 100).toFixed(1)} m · {r.segmentCount} seg ({r.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label>Ime (neobvezno)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Zajem vhodne ograje" />
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Zmožnosti naprave (§15)</p>
            <p className="text-xs text-muted-foreground">Izbrani režim: <span className="font-semibold">{tier}</span> — {TIER_LABELS[tier as keyof typeof TIER_LABELS]}</p>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {([['camera', 'Kamera'], ['lidar', 'LiDAR'], ['depth', 'Depth'], ['ar', 'AR tracking'], ['gyro', 'Giroskop'], ['gps', 'GPS']] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <Checkbox checked={caps[k] === true} onCheckedChange={(v) => setCaps((c) => ({ ...c, [k]: v === true }))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Zunanji pogoji (§16)</p>
            <div className="flex flex-wrap gap-1.5">
              {OUTDOOR_CONDITIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setConditions((xs) => xs.includes(c.id) ? xs.filter((x) => x !== c.id) : [...xs, c.id])}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${conditions.includes(c.id) ? 'border-orange-400 bg-orange-100 text-orange-900' : 'bg-background hover:bg-muted'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Začni zajem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Podrobnost zajema ──────────────────────────────────────────────────────

function SessionDetailBody ({ detail, mayWrite, onReload, onDelete }: {
  detail: SessionDetail
  mayWrite: boolean
  onReload: () => void
  onDelete: () => void
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const a = detail.analysis
  const zaklenjen = detail.status === 'ZAKLJUCEN'

  // forma reference
  const [refAt, setRefAt] = useState('')
  const [refMeasure, setRefMeasure] = useState('')
  const [refMethod, setRefMethod] = useState('LASER')
  const [refLabel, setRefLabel] = useState('')

  // drift forma
  const [driftOff, setDriftOff] = useState('')

  // kvaliteta posnetka
  const [qDark, setQDark] = useState(false)
  const [qBright, setQBright] = useState(false)
  const [qBlurry, setQBlurry] = useState(false)

  const coverableKinds = new Set(['START', 'SEGMENT', 'VOGAL', 'VRATA', 'TEREN', 'PODLAGA', 'KONEC'])

  async function act (fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } catch (e) {
      toast({ title: 'Napaka', description: (e as Error).message, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function addPhoto (zone: string) {
    await act(async () => {
      const clientKey = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await apiPost(`/api/capture-session/${detail.id}/photo`, {
        zone, clientKey, quality: { dark: qDark, bright: qBright, blurry: qBlurry },
      })
      toast({ title: 'Posnetek dodan', description: `Cona: ${a.plan.find((p) => p.id === zone)?.label ?? zone}` })
      onReload()
    })
  }

  async function markStop (stopId: string, done: boolean) {
    await act(async () => {
      const doneStops = done
        ? [...new Set([...detail.state.doneStops, stopId])]
        : detail.state.doneStops.filter((s) => s !== stopId)
      await apiPatch(`/api/capture-session/${detail.id}`, { doneStops, currentStopId: stopId })
      onReload()
    })
  }

  async function addReference () {
    await act(async () => {
      const atCm = parseFloat(refAt)
      const measureCm = parseFloat(refMeasure)
      if (!Number.isFinite(atCm) || atCm < 0) { toast({ title: 'Neveljaven položaj (cm)' }); return }
      if (!Number.isFinite(measureCm) || measureCm <= 0) { toast({ title: 'Neveljavna izmera (cm)' }); return }
      const res = await apiPost<{ data: { code: string; status: string; network: { conflicts: string[] } } }>(`/api/capture-session/${detail.id}/reference`, {
        atCm, measureCm, method: refMethod, label: refLabel || undefined,
      })
      if (res.data.status === 'KONFLIKT') {
        toast({ title: `REFERENCE CONFLICT — ${res.data.code}`, description: res.data.network.conflicts[0] ?? 'Zahtevana preverba.', variant: 'destructive' })
      } else {
        toast({ title: `Referenca ${res.data.code} dodana` })
      }
      setRefAt(''); setRefMeasure(''); setRefLabel('')
      onReload()
    })
  }

  async function resolveRef (referenceId: string, action: 'ZAVRCI' | 'AKTIVIRAJ') {
    await act(async () => {
      let reason: string | null = null
      if (action === 'ZAVRCI') {
        reason = window.prompt('Razlog zavrnitve reference (obvezno, §18):')
        if (!reason || !reason.trim()) return
      }
      await apiPatch(`/api/capture-session/${detail.id}/reference`, { referenceId, action, reason })
      toast({ title: action === 'ZAVRCI' ? 'Referenca zavrnjena' : 'Referenca aktivirana' })
      onReload()
    })
  }

  async function addDriftSample () {
    await act(async () => {
      const offsetCm = parseFloat(driftOff)
      if (!Number.isFinite(offsetCm)) { toast({ title: 'Neveljaven odmik (cm)' }); return }
      const res = await apiPost<{ data: { state: string } }>(`/api/capture-session/${detail.id}/drift`, { offsetCm })
      toast({ title: `Drift: ${res.data.state}` })
      setDriftOff('')
      onReload()
    })
  }

  async function toggleStatus (status: 'PREKINJEN' | 'V_TEKU') {
    await act(async () => {
      await apiPatch(`/api/capture-session/${detail.id}`, { status })
      toast({ title: status === 'PREKINJEN' ? 'Zajem prekinjen — lahko nadaljujete pozneje' : 'Zajem se nadaljuje' })
      onReload()
    })
  }

  async function finish () {
    const obstojeco = window.prompt('Obstoječe stanje objekta (opis, neobvezno — §9):') ?? ''
    await act(async () => {
      const res = await apiPost<{ data: { snapshotId: string; version: number; criticalGate: { ponudba: boolean; konfiguracija: boolean; proizvodnja: boolean } | null } }>(`/api/capture-session/${detail.id}/finish`, { obstojeco })
      const g = res.data.criticalGate
      toast({
        title: `Zajem zaključen — AS-MEASURED v${res.data.version}`,
        description: g ? `ZA PONUDBO ${g.ponudba ? '✓' : '✗'} · ZA KONFIGURACIJO ${g.konfiguracija ? '✓' : '✗'} · ZA PROIZVODNJO ${g.proizvodnja ? '✓' : '✗'}` : undefined,
      })
      onReload()
    })
  }

  return (
    <div className="space-y-5">
      {/* glava */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {detail.name}
            <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[detail.status] ?? ''}`}>{detail.status}</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            {detail.mode === 'FENCE_RUN' ? 'FENCE_RUN — nad tekačem' : 'KAMERA'} ·{' '}
            {detail.device ? <>naprava: <span className="font-medium">{detail.device.tier}</span></> : 'naprava: —'}
            {detail.run && <> · tekač: {detail.run.name}</>}
          </p>
        </div>
        {mayWrite && !zaklenjen && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => toggleStatus(detail.status === 'PREKINJEN' ? 'V_TEKU' : 'PREKINJEN')}>
              {detail.status === 'PREKINJEN' ? <Play className="mr-1 h-3.5 w-3.5" /> : <Pause className="mr-1 h-3.5 w-3.5" />}
              {detail.status === 'PREKINJEN' ? 'Nadaljuj' : 'Prekini'}
            </Button>
            <Button size="sm" variant="outline" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        )}
      </div>

      {/* drift banner */}
      <div className={`rounded-lg border p-3 text-sm ${DRIFT_STATES[a.drift.state].cls}`}>
        <p className="flex items-center gap-2 font-semibold">
          <RadioTower className="h-4 w-4" />
          {DRIFT_STATES[a.drift.state].label}
          <span className="font-normal">— največji odmik {a.drift.maxAbsCm.toFixed(1)} cm</span>
        </p>
        {a.drift.state !== 'DRIFT_OK' && (
          <p className="mt-1 text-xs">Re-lokalizacija: dodajte novo referenčno točko (REF) — vzorci ostanejo zapisani (§3).</p>
        )}
      </div>

      {/* vrata zaključka */}
      {!zaklenjen && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="flex items-center gap-2 font-medium"><FlagTriangleRight className="h-4 w-4" />Vrata zaključka</p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {([
                ['Pokritost (§1)', a.gates.coverageOk],
                ['Vodena ruta (§2)', a.gates.stopsDone],
                ['Reference (§4)', a.gates.referencesOk],
                ['Drift (§3)', a.gates.driftOk],
              ] as const).map(([label, ok]) => (
                <div key={label} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
                  {ok ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                  {label}: {ok ? 'OK' : 'manjka'}
                </div>
              ))}
            </div>
            {!a.gates.allOk && a.gates.reasons.length > 0 && (
              <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                {a.gates.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            {mayWrite && (
              <Button onClick={finish} disabled={busy || !a.gates.allOk} className="w-full sm:w-auto">
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Zaključi zajem → AS-MEASURED
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* coverage mapa */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="flex items-center gap-2 font-medium"><MapPin className="h-4 w-4" />Live coverage map (§1)</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {a.coverage.zones.map((z) => (
              <div key={z.stopId} className={`rounded-md border px-3 py-2 text-sm ${ZONE_STATES[z.state].cls}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{z.label}</span>
                  {z.critical && <Badge variant="outline" className="shrink-0 border-current text-[10px]">kritično</Badge>}
                </div>
                <p className="mt-0.5 text-xs">{ZONE_STATES[z.state].label} · {z.photoCount} posnetkov ({z.goodCount} dobrih)</p>
                {mayWrite && !zaklenjen && (
                  <Button size="sm" variant="outline" className="mt-1.5 h-7 w-full bg-white/60" disabled={busy} onClick={() => addPhoto(z.stopId)}>
                    <Camera className="mr-1 h-3 w-3" />Dodaj posnetek
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>Kakovost naslednjega posnetka:</span>
            {([['temno', qDark, setQDark], ['svetlo', qBright, setQBright], ['zamegljeno', qBlurry, setQBlurry]] as const).map(([label, val, set]) => (
              <label key={label} className="flex items-center gap-1.5">
                <Checkbox checked={val} onCheckedChange={(v) => set(v === true)} />{label}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* vodena ruta */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="flex items-center gap-2 font-medium"><Waypoints className="h-4 w-4" />Vodena ruta (§2)</p>
          <ScrollArea className="max-h-72">
            <ol className="space-y-1.5">
              {a.plan.map((stop) => {
                const done = detail.state.doneStops.includes(stop.id)
                const isPhoto = coverableKinds.has(stop.kind)
                const zone = a.coverage.zones.find((z) => z.stopId === stop.id)
                return (
                  <li key={stop.id} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${done ? 'border-emerald-300 bg-emerald-50' : isPhoto && zone && zone.photoCount > 0 ? 'border-amber-200 bg-amber-50' : ''}`}>
                    {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{STOP_KINDS[stop.kind].label}</span> — {stop.label}
                    </span>
                    {stop.critical && <Badge variant="outline" className="shrink-0 text-[10px]">obvezno</Badge>}
                    {mayWrite && !zaklenjen && (
                      <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => markStop(stop.id, !done)}>
                        {done ? 'razveljavi' : 'opravljeno'}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ol>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* reference */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="flex items-center gap-2 font-medium"><Satellite className="h-4 w-4" />Referenčna mreža (§4) — {a.refs.activeCount} aktivnih</p>
          {detail.references.length === 0 && (
            <p className="text-sm text-muted-foreground">Ni referenc. Za profesionalni zajem dodajte vsaj eno (zunanje merilo).</p>
          )}
          <div className="space-y-1.5">
            {a.refs.pairs.map((p, i) => (
              <div key={i} className={`rounded-md border px-2.5 py-1.5 text-sm ${p.conflict ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                <span className="font-medium">{p.fromCode} → {p.toCode}</span>: tek {p.declaredCm.toFixed(1)} cm · merilo {p.measuredCm.toFixed(1)} cm ·{' '}
                {p.conflict
                  ? <span className="font-semibold">KONFLIKT (±{p.toleranceCm} cm presežen za {Math.abs(p.diffCm).toFixed(1)} cm)</span>
                  : <span>skladno (±{p.diffCm.toFixed(1)} cm)</span>}
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            {detail.references.map((r) => (
              <div key={r.id} className={`flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${r.status === 'ZAVRACENA' ? 'border-muted bg-muted/50 text-muted-foreground line-through' : r.status === 'KONFLIKT' ? 'border-red-300 bg-red-50' : ''}`}>
                <Badge variant="outline">{r.code}</Badge>
                <span>@ {(r.atCm / 100).toFixed(1)} m · {r.measureCm.toFixed(1)} cm od prejšnje · {REF_METHODS.find((m) => m.id === r.method)?.label ?? r.method}</span>
                {r.status !== 'AKTIVNA' && <Badge variant="outline" className={r.status === 'KONFLIKT' ? 'border-red-400 text-red-700' : ''}>{r.status}</Badge>}
                {r.note && <span className="text-xs text-muted-foreground">“{r.note}”</span>}
                {mayWrite && !zaklenjen && r.status !== 'AKTIVNA' && (
                  <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" disabled={busy} onClick={() => resolveRef(r.id, r.status === 'ZAVRACENA' ? 'AKTIVIRAJ' : 'ZAVRCI')}>
                    {r.status === 'ZAVRACENA' ? 'aktiviraj' : 'zavrni (razlog)'}
                  </Button>
                )}
              </div>
            ))}
          </div>
          {mayWrite && !zaklenjen && (
            <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Položaj (cm)</Label>
                <Input value={refAt} onChange={(e) => setRefAt(e.target.value)} inputMode="decimal" placeholder="420" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Merilo od prejšnje (cm)</Label>
                <Input value={refMeasure} onChange={(e) => setRefMeasure(e.target.value)} inputMode="decimal" placeholder="418" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Metoda</Label>
                <Select value={refMethod} onValueChange={setRefMethod}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REF_METHODS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label} (±{m.toleranceCm} cm)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Oznaka</Label>
                <div className="flex gap-2">
                  <Input value={refLabel} onChange={(e) => setRefLabel(e.target.value)} placeholder="rog vogala" />
                  <Button size="sm" onClick={addReference} disabled={busy}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* drift */}
      {!zaklenjen && mayWrite && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1">
              <Label className="text-xs">Vzorec drifta (cm)</Label>
              <div className="flex gap-2">
                <Input value={driftOff} onChange={(e) => setDriftOff(e.target.value)} inputMode="decimal" placeholder="1.4" className="w-28" />
                <Button size="sm" variant="outline" onClick={addDriftSample} disabled={busy}><Ruler className="mr-1 h-3.5 w-3.5" />Zabeleži</Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Toleranca: ≤ 2 cm OK · ≤ 5 cm opozorilo · &gt; 5 cm re-lokalizacija (§3)
            </p>
          </CardContent>
        </Card>
      )}

      {/* kritična vrata mer iz tekača */}
      {a.criticalGate && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="flex items-center gap-2 font-medium"><Boxes className="h-4 w-4" />Kritične mere (§7)</p>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className={`rounded-md border px-2.5 py-1 ${a.criticalGate.ponudba ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                {a.criticalGate.ponudba ? '✅' : '⚠️'} ZA PONUDBO
              </span>
              <span className={`rounded-md border px-2.5 py-1 ${a.criticalGate.konfiguracija ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                {a.criticalGate.konfiguracija ? '✅' : '⚠️'} ZA KONFIGURACIJO
              </span>
              <span className={`rounded-md border px-2.5 py-1 ${a.criticalGate.proizvodnja ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                {a.criticalGate.proizvodnja ? '✅' : '⚠️'} ZA PROIZVODNJO
              </span>
            </div>
            {a.criticalGate.manjka.length > 0 && (
              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {a.criticalGate.manjka.map((m, i) => <li key={i}>{m.message}</li>)}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Popravite v modulu Ogradnja (verify s POSNETKI/LASER) — tu se samo prikaže stanje.
            </p>
          </CardContent>
        </Card>
      )}

      {/* zaključek */}
      {zaklenjen && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />Zajem zaključen</p>
          <p className="mt-1 text-xs">AS-MEASURED snapshot: {detail.snapshotId?.slice(0, 12) ?? '—'}… — pregled v modulu Digitalni dvojček.</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onReload}><RefreshCw className="mr-1 h-3.5 w-3.5" />Osveži</Button>
      </div>
    </div>
  )
}

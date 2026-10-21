'use client'

// ZAJEM — podrobnost zajema (SessionDetailBody) — R547 izvleček iz zajem.tsx
// (razbitje srednjih modulov po vzorcu R546; BREZ spremembe obnašanja).
// Podkoren gradnikov: sestavlja GeoPanel, ElementQaPanel in ReplayPanel.

import { useEffect, useRef, useState } from 'react'
import {
  Boxes, Camera, CheckCircle2, Circle, FlagTriangleRight, Loader2, MapPin,
  Pause, Play, Plus, RadioTower, RefreshCw, Ruler, Satellite, Trash2,
  TriangleAlert, Waypoints,
} from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiPatch, apiPost } from '@/lib/api-client'
import { compressImage } from '@/lib/offline'
import { DRIFT_STATES, REF_METHODS, STOP_KINDS, ZONE_STATES } from '@/lib/capture-qa-engine'
import { STATUS_BADGE, type SessionDetail } from './zajem-shared'
import { GeoPanel } from './zajem-geo'
import { ElementQaPanel } from './zajem-qa'
import { ReplayPanel } from './zajem-replay'

// ─── Podrobnost zajema ──────────────────────────────────────────────────────

export function SessionDetailBody ({ detail, mayWrite, onReload, onDelete }: {
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

  // ── R486 (issue #7 §4A): posnetek s SLIČICO — file input BREZ capture atributa
  // (izbira iz galerije ali kamere), canvas skrčitev ≤ 120 KB → POST thumb
  // (API photo/route.ts sprejema; prej so bili posnetki SAMO metapodatki).
  const thumbRef = useRef<HTMLInputElement>(null)
  const [pendingZone, setPendingZone] = useState<string | null>(null)

  const THUMB_MAX_BYTES = 120 * 1024

  /** Skrči sliko na ≤ 120 KB (canvas JPEG, postopno nižja kvaliteta). */
  async function shrinkThumb (dataUrl: string): Promise<string | null> {
    let cur = dataUrl
    for (const q of [0.6, 0.45, 0.3, 0.18]) {
      cur = await compressImage(cur, 640, q)
      if (cur.length <= THUMB_MAX_BYTES) return cur
    }
    return null // ni šlo spraviti pod mejo — posnetek gre brez sličice
  }

  function dodajPosnetek (zone: string): void {
    setPendingZone(zone)
    thumbRef.current?.click()
  }

  // preklic izbire datoteke (DOM 'cancel' — React tipi ga ne poznajo na inputu)
  // → posnetek brez sličice (kot prej — tok NI blokiran, §6 »napaka ene slike«)
  useEffect(() => {
    const el = thumbRef.current
    if (!el) return
    const onCancel = (): void => {
      const z = pendingZone
      setPendingZone(null)
      if (z) void addPhoto(z, null)
    }
    el.addEventListener('cancel', onCancel)
    return () => el.removeEventListener('cancel', onCancel)
  }, [pendingZone])

  const coverableKinds = new Set(['START', 'SEGMENT', 'VOGAL', 'VRATA', 'TEREN', 'PODLAGA', 'KONEC'])

  async function act (fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } catch (e) {
      toast({ title: 'Napaka', description: (e as Error).message, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function addPhoto (zone: string, thumb: string | null = null) {
    await act(async () => {
      const clientKey = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await apiPost(`/api/capture-session/${detail.id}/photo`, {
        zone, clientKey, quality: { dark: qDark, bright: qBright, blurry: qBlurry },
        ...(thumb ? { thumb } : {}),
      })
      toast({
        title: 'Posnetek dodan',
        description: `Cona: ${a.plan.find((p) => p.id === zone)?.label ?? zone}${thumb ? ` · sličica ${Math.round(thumb.length / 1024)} KB` : ''}`,
      })
      onReload()
    })
  }

  /** R486: izbrana datoteka → skrči → posnetek S sličico; preklic → brez nje. */
  async function onThumbFile (f: File | undefined): Promise<void> {
    const zone = pendingZone
    setPendingZone(null)
    if (!zone) return
    let thumb: string | null = null
    if (f) {
      const url = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => resolve('')
        reader.readAsDataURL(f)
      })
      if (url) thumb = await shrinkThumb(url)
    }
    await addPhoto(zone, thumb)
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
                  <Button size="sm" variant="outline" className="mt-1.5 h-7 w-full bg-white/60" disabled={busy} onClick={() => dodajPosnetek(z.stopId)}>
                    <Camera className="mr-1 h-3 w-3" />Dodaj posnetek
                  </Button>
                )}
              </div>
            ))}
          </div>
          {/* R486 (issue #7 §4A): skriti file input za sličico posnetka — EN
              skupen (cono nosi pendingZone), brez capture atributa (galerija/kamera) */}
          <input
            ref={thumbRef} type="file" accept="image/*" className="hidden"
            aria-label="Sličica posnetka (izbira iz galerije ali kamere)"
            onChange={(e) => { void onThumbFile(e.target.files?.[0]); e.target.value = '' }}
          />
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

      {/* geo/registracija/loop (R462) */}
      <GeoPanel sessionId={detail.id} zaklenjen={zaklenjen} mayWrite={mayWrite} onReload={onReload} />

      {/* element-level QA (R462 §8) */}
      <ElementQaPanel sessionId={detail.id} />

      {/* CAPTURE REPLAY (R465 — issue #4 §2) */}
      <ReplayPanel sessionId={detail.id} />

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

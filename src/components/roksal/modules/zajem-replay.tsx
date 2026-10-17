'use client'

// ZAJEM — CAPTURE REPLAY (R465 — issue #4 §2) — R547 izvleček iz zajem.tsx
// (razbitje srednjih modulov po vzorcu R546; BREZ spremembe obnašanja).
// Predvajanje zajema po korakih (revizija/izobraževanje). Read-only.

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Film, Pause, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { DRIFT_STATES, ZONE_STATES, type DriftState, type ZoneState } from '@/lib/capture-qa-engine'

// ─── CAPTURE REPLAY (R465 — issue #4 §2) ────────────────────────────────────
// Predvajanje zajema po korakih (revizija/izobraževanje). Read-only: korak =
// posnetek; pokritost in drift se prikažeta KUMULATIVNO (stanje po tem
// posnetku) — natanko tako, kot se je zajem odvijal.

export interface ReplayStep {
  n: number
  photo: {
    id: string; zone: string; zoneLabel: string; zoneKind: string | null; critical: boolean
    quality: { dark?: boolean; bright?: boolean; blurry?: boolean } | null
    offsetCm: number | null; thumb: string | null; capturedAt: string
  }
  coverageAfter: {
    zones: { stopId: string; label: string; critical: boolean; state: ZoneState; photoCount: number; goodCount: number }[]
    gateOk: boolean
    criticalMissing: string[]
  }
  driftAfter: { state: DriftState; maxAbsCm: number; lastAbsCm: number; sampleCount: number }
}

export interface ReplayPayload {
  session: { id: string; name: string; status: string; mode: string; note: string | null; snapshotId: string | null }
  project: { code: string; title: string } | null
  device: { tier: string } | null
  outdoor: { conditions: string[] } | null
  run: { id: string; name: string; status: string; segments: number; totalCm: number | null } | null
  plan: { id: string; kind: string; label: string; atCm: number | null; critical: boolean }[]
  refs: { code: string; atCm: number; measureCm: number; method: string; status: string }[]
  steps: ReplayStep[]
  final: { coverage: { gateOk?: boolean } | null; drift: { status?: string } | null }
}

export function ReplayPanel ({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false)
  const replay = useApi<{ data: ReplayPayload }>(open ? `/api/capture-session/${sessionId}/replay` : null, [open, sessionId])
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  const steps = replay.data?.data.steps ?? []
  const step = steps[idx] ?? null

  // ponastavitev ob novem zajemu (prilagoditev stanja med renderiranjem — uradni vzorec)
  const loadedId = replay.data?.data.session.id ?? null
  const [lastLoadedId, setLastLoadedId] = useState(loadedId)
  if (loadedId !== lastLoadedId) {
    setLastLoadedId(loadedId)
    setIdx(0)
    setPlaying(false)
  }

  // predvajanje: korak naprej na 1,5 s (na koncu se ustavi — asinhrono v callbacku)
  useEffect(() => {
    if (!playing || steps.length === 0) return
    if (idx >= steps.length - 1) return
    const t = setTimeout(() => {
      setIdx((i) => Math.min(i + 1, steps.length - 1))
      if (idx + 1 >= steps.length - 1) setPlaying(false)
    }, 1500)
    return () => clearTimeout(t)
  }, [playing, idx, steps.length])

  // drift vzorci do trenutnega koraka (za graf) — izpeljava ob vsakem renderu (ceneje od memoizacije)
  const driftSamples = steps.slice(0, idx + 1).map((s) => s.photo.offsetCm).filter((o): o is number => o != null)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed p-4 text-left transition hover:bg-secondary/40"
      >
        <Film className="size-5 shrink-0 text-roksal-amber" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Replay zajema</span>
          <span className="block text-xs text-muted-foreground">Predvajajte zajem po korakih — revizija in izobraževanje (samo za ogled).</span>
        </span>
        <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium">
            <Film className="h-4 w-4" aria-hidden /> Replay zajema — {steps.length} korakov
          </p>
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setPlaying(false) }}>Zapri</Button>
        </div>

        <ErrorBox error={replay.error} />
        {replay.loading ? (
          <LoadingRows rows={2} />
        ) : !replay.error && steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zajem še nima posnetkov — replay bo na voljo, ko bodo posnetki dodani.</p>
        ) : !replay.error && step ? (
          <>
            {/* predvajalnik */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                aria-label={playing ? 'Ustavi predvajanje' : 'Predvajaj'}
                onClick={() => setPlaying((p) => !p)}
                disabled={steps.length <= 1}
              >
                {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              </Button>
              <Button size="sm" variant="outline" aria-label="Prejšnji korak" onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)) }} disabled={idx === 0}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button size="sm" variant="outline" aria-label="Naslednji korak" onClick={() => { setPlaying(false); setIdx((i) => Math.min(steps.length - 1, i + 1)) }} disabled={idx >= steps.length - 1}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
              <span className="ml-1 text-sm font-medium tabular-nums">Korak {step.n} / {steps.length}</span>
              <span className="ml-auto text-xs text-muted-foreground">{new Date(step.photo.capturedAt).toLocaleTimeString('sl-SI')}</span>
            </div>
            <div>
              <label htmlFor="replay-slider" className="sr-only">Položaj predvajanja</label>
              <input
                id="replay-slider"
                type="range"
                min={0}
                max={steps.length - 1}
                step={1}
                value={idx}
                onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)) }}
                className="w-full accent-roksal-amber"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
              {/* posnetek */}
              <div className="space-y-1.5">
                {step.photo.thumb ? (
                  <img src={step.photo.thumb} alt={`Posnetek ${step.n} — ${step.photo.zoneLabel}`} className="w-full rounded-lg border" />
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">brez sličice</div>
                )}
                <div className="flex flex-wrap gap-1">
                  {step.photo.quality?.dark ? <Badge variant="outline" className="text-[10px]">temno</Badge> : null}
                  {step.photo.quality?.bright ? <Badge variant="outline" className="text-[10px]">svetlo</Badge> : null}
                  {step.photo.quality?.blurry ? <Badge variant="outline" className="text-[10px]">zamegljeno</Badge> : null}
                  {step.photo.offsetCm != null ? <Badge variant="outline" className="text-[10px]">odmik {step.photo.offsetCm.toFixed(1)} cm</Badge> : null}
                </div>
              </div>

              {/* cona + kumulativna pokritost */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{step.photo.zoneLabel}</span>
                  {step.photo.zoneKind ? <Badge variant="outline" className="text-[10px]">{step.photo.zoneKind}</Badge> : null}
                  {step.photo.critical ? <Badge variant="outline" className="text-[10px]">kritično</Badge> : null}
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${DRIFT_STATES[step.driftAfter.state].cls}`}>drift: {DRIFT_STATES[step.driftAfter.state].label}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {step.coverageAfter.zones.map((z) => (
                    <span key={z.stopId} className={`rounded-md border px-2 py-0.5 text-[11px] ${ZONE_STATES[z.state].cls}`}>
                      {z.label} · {z.photoCount}
                    </span>
                  ))}
                </div>
                {/* drift graf do tega koraka */}
                {driftSamples.length > 0 ? (
                  <div className="rounded-lg border bg-background/60 p-2">
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">Vzorci odmika registra do tega koraka (± 2 / 5 cm)</p>
                    <svg viewBox={`0 0 ${Math.max(40, driftSamples.length * 14)} 56`} className="h-14 w-full" role="img" aria-label="Graf odmikov registra">
                      {/* prag tolerance */}
                      <line x1="0" y1={28 - 2 * 4} x2="100%" y2={28 - 2 * 4} stroke="#059669" strokeDasharray="3 3" strokeWidth="1" />
                      <line x1="0" y1={28 + 2 * 4} x2="100%" y2={28 + 2 * 4} stroke="#059669" strokeDasharray="3 3" strokeWidth="1" />
                      <line x1="0" y1={28 - 5 * 4} x2="100%" y2={28 - 5 * 4} stroke="#dc2626" strokeDasharray="3 3" strokeWidth="1" />
                      <line x1="0" y1={28 + 5 * 4} x2="100%" y2={28 + 5 * 4} stroke="#dc2626" strokeDasharray="3 3" strokeWidth="1" />
                      {driftSamples.map((o, i) => {
                        const h = Math.max(1.5, Math.abs(o) * 4)
                        return <rect key={i} x={i * 14 + 4} y={o >= 0 ? 28 - h : 28} width="6" height={h} rx="1" fill={Math.abs(o) > 5 ? '#dc2626' : Math.abs(o) > 2 ? '#d97706' : '#059669'} />
                      })}
                    </svg>
                  </div>
                ) : null}
              </div>
            </div>

            {/* reference (kontekst, statičen seznam) */}
            {(replay.data?.data.refs.length ?? 0) > 0 ? (
              <p className="text-xs text-muted-foreground">
                Reference: {replay.data?.data.refs.map((r) => `${r.code} (${(r.atCm / 100).toFixed(1)} m, ${r.status})`).join(' · ')}
              </p>
            ) : null}
            {replay.data?.data.session.status === 'ZAKLJUCEN' ? (
              <p className="text-xs text-muted-foreground">
                Zaključen zajem — končno stanje: pokritost {replay.data.data.final.coverage?.gateOk ? 'OK' : 'manjka'} · drift {replay.data.data.final.drift?.status ?? '—'} · AS-MEASURED {(replay.data.data.session.snapshotId ?? '').slice(0, 10) || '—'}…
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

'use client'

// PREGLED — kartice in dialogi: mreža fotografij, nov pin, seznam pinov, replay zajema.
// R546: izvlečeno iz pregled.tsx BREZ spremembe obnašanja; skupni tipi in
// konstante so v pregled-shared.ts.

import { useEffect, useState } from 'react'
import { ArrowLeftRight, Camera, CheckCircle2, Film, Info, Loader2, MapPin, MessageSquare, Pause, Play, Plus, Trash2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiDelete, apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { PIN_TONE, TARGET_LABEL, fmtCm, fmtM, pinSnapshotSummary, type ReviewPhoto, type ReviewPin } from './pregled-shared'

// ─── Mreža fotografij ────────────────────────────────────────────────────────

export function PhotosCard ({
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

export function PinDialog ({
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

export function PinsCard ({
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

export function ReplayCard ({
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

export function ReplayDialog ({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
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

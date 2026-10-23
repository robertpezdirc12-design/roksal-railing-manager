'use client'

// NALOGI — podrobnost naloga: osnovni podatki + terenski tok + časovnica +
// meritve + QA povzetek — R548 izvleček iz nalogi.tsx (razbitje po vzorcu
// R546/R547; BREZ spremembe obnašanja).
// Sestavlja OfflineActionsSection (nalogi-offline) nad skupnimi tipi.

import { useState } from 'react'
import {
  CalendarClock, Camera, CheckCheck, CheckCircle2, ClipboardCheck, ClipboardList,
  FileText, History, Loader2, MessageSquare, Play, Ruler, Users, WifiOff,
} from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import {
  type WorkOrderDetail, type WorkOrderRow,
  EVENT_META, TRANSITIONS, fmtM, type HistoryRow,
} from './nalogi-shared'
import { MeasurementTypeBadge } from './nalogi-shared'
import { OfflineActionsSection } from './nalogi-offline'

// R489 (issue #12): povzetek montažnega QA v podrobnosti naloga (samo online —
// urejanje je v modulu Danes, tukaj samo stanje + primopredaja + PDF)
export function QaSummarySection ({ woId }: { woId: string }) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const qa = useApi<{
    data: {
      povzetek: { skupaj: number; vRedu: number; napake: number; caka: number; niRelevantno: number; odstopanj: number }
      checks: { critical: boolean; status: string; label: string }[]
      handover: { id: string; version: number; status: string; monterConfirmedAt: string | null; customerSignedAt: string | null } | null
    }
  }>(`/api/nalog/${woId}/qa`)
  const [pdfBusy, setPdfBusy] = useState(false)
  const d = qa.data?.data
  if (qa.loading || !d || d.povzetek.skupaj === 0) return null

  const odprteKriticne = d.checks.filter((c) => c.critical && (c.status === 'NAPAKA' || c.status === 'CAKA_PREVERJANJE'))

  async function izvozi (): Promise<void> {
    if (!d?.handover || !token) return
    setPdfBusy(true)
    try {
      const res = await fetch(`/api/pdf/handover/${d.handover.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Napaka strežnika (${res.status}).`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      toast({ title: 'Izvoz PDF ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setPdfBusy(false) }
  }

  return (
    <section aria-label="Kontrola kakovosti montaže — povzetek" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <ClipboardCheck className="size-4 text-roksal-amber" aria-hidden /> Kontrola kakovosti montaže
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {d.povzetek.vRedu} v redu · {d.povzetek.napake} napak · {d.povzetek.caka} čaka · {d.povzetek.niRelevantno} neveljavnih
        </span>
      </div>
      {odprteKriticne.length > 0 ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          ZAKLJUČEK BLOKIRAN — {odprteKriticne.length} kritičnih nerešenih točk (urejanje v modulu Danes).
        </p>
      ) : null}
      {d.handover ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={d.handover.status} />
          <span className="text-[11px] text-muted-foreground">Primopredaja v{d.handover.version}</span>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={pdfBusy} onClick={() => void izvozi()}>
            {pdfBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />} PDF primopredaje
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">Primopredajno poročilo še ni zgrajeno (modul Danes → Primopredaja).</p>
      )}
    </section>
  )
}

// ─── podrobnost: osnovni podatki + terenski tok + časovnica + meritve ───────

/** R439: degraded podrobnost iz predpomnjene vrstice (offline — brez časovnike/meritev). */
export function rowToDetail (wo: WorkOrderRow): WorkOrderDetail {
  return {
    ...wo,
    assignee: wo.assignee ? { id: '', name: wo.assignee.name } : null,
    crew: wo.crew ? { id: '', ...wo.crew } : null,
    instructions: null,
    projectId: null,
    events: [],
    measurements: [],
  }
}

export function NalogDetail ({ detail, offline = false, canTransition, canReschedule, canAssignCrew = false, onTransition, onRescheduled, onCrewChanged }: {
  detail: WorkOrderDetail
  offline?: boolean
  canTransition: boolean
  canReschedule: boolean
  canAssignCrew?: boolean // R445: pisarna (ADMIN/VODJA) dodeljuje ekipe — strežnik preverja managesAssignments
  onTransition: (wo: { id: string; code: string }, to: string, label: string, note: string) => Promise<void>
  onRescheduled: () => Promise<void>
  onCrewChanged?: () => Promise<void>
}) {
  const { toast } = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // ── preurčitev termina (R433: POST /api/nalog/[id]/termin) ──
  const [terminDate, setTerminDate] = useState(detail.scheduledFor ? detail.scheduledFor.slice(0, 10) : '')
  const [terminBusy, setTerminBusy] = useState(false)

  // ── R445: ekipa/podizvajalec na nalogu (dodelitev — samo pisarna, online) ──
  const crews = useApi<{ data: { id: string; name: string; type: string; active: boolean }[] }>(
    canAssignCrew && !offline ? '/api/crews' : null, [canAssignCrew, offline]
  )
  const [crewPick, setCrewPick] = useState('keep') // keep = brez spremembe; none = počisti
  const [crewBusy, setCrewBusy] = useState(false)

  async function assignCrew () {
    if (crewPick === 'keep') return
    setCrewBusy(true)
    try {
      await apiPatch(`/api/nalog/${detail.id}`, { crewId: crewPick === 'none' ? null : crewPick })
      const name = crewPick === 'none' ? 'brez ekipe' : (crews.data?.data.find((c) => c.id === crewPick)?.name ?? 'ekipa')
      toast({ title: 'Ekipa na nalogu posodobljena.', description: `${detail.code} — ${name}` })
      setCrewPick('keep')
      await (onCrewChanged ? onCrewChanged() : onRescheduled())
    } catch (e) {
      toast({ title: 'Dodelitev ekipe ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setCrewBusy(false) }
  }

  async function reschedule () {
    if (!terminDate) { toast({ title: 'Izberi nov datum termina.', variant: 'destructive' }); return }
    setTerminBusy(true)
    try {
      await apiPost(`/api/nalog/${detail.id}/termin`, { scheduledFor: `${terminDate}T08:00:00.000Z`, note: note.trim() || undefined })
      toast({ title: 'Termin preurčen.', description: `${detail.code} → ${fmtDate(`${terminDate}T08:00:00.000Z`)}` })
      await onRescheduled()
    } catch (err) {
      toast({ title: 'Preurčitev ni uspela.', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setTerminBusy(false)
    }
  }

  const actions = TRANSITIONS.filter((t) => t.from.includes(detail.status))

  async function run (to: string, label: string) {
    setBusy(true)
    await onTransition(detail, to, label, note)
    setBusy(false)
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-roksal-amber-text">{detail.code}</span>
          <StatusBadge status={detail.status} />
          {offline ? (
            <Badge variant="secondary" className="border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <WifiOff className="mr-1 size-3" aria-hidden /> predpomnjeno
            </Badge>
          ) : null}
        </div>
        <DialogTitle>{detail.title}</DialogTitle>
        <DialogDescription>
          {detail.project
            ? `${detail.project.customer?.name ?? 'Brez stranke'} · ${detail.project.code} — ${detail.project.title}`
            : 'Brez projekta'}
        </DialogDescription>
      </DialogHeader>

      {/* osnovni podatki */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border bg-secondary/30 p-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Izvajalec</dt><dd className="font-medium">{detail.assignee?.name ?? 'Ni dodeljen'}</dd></div>
        <div>
          <dt className="text-xs text-muted-foreground">Ekipa (R445)</dt>
          <dd className="font-medium">
            {detail.crew ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                <Users className="size-3.5 shrink-0" aria-hidden />
                <span className={detail.crew.type === 'PODIZVAJALEC' ? 'font-semibold text-amber-600 dark:text-amber-400' : 'font-semibold'}>{detail.crew.name}</span>
                <span className="text-xs font-normal text-muted-foreground">({detail.crew.type === 'PODIZVAJALEC' ? 'podizvajalec' : 'interna'})</span>
              </span>
            ) : 'Ni dodeljena'}
          </dd>
        </div>
        <div><dt className="text-xs text-muted-foreground">Termin</dt><dd className="font-medium">{fmtDate(detail.scheduledFor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Začetek</dt><dd className="font-medium">{fmtDateTime(detail.startedAt)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Zaključek</dt><dd className="font-medium">{fmtDateTime(detail.completedAt)}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-muted-foreground">Lokacija</dt><dd className="font-medium">{detail.project?.address ?? '—'}</dd></div>
        {detail.summary ? <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-muted-foreground">Povzetek</dt><dd className="font-medium">{detail.summary}</dd></div> : null}
      </dl>

      {/* navodila za monterja (issue #1: pisarna → teren) */}
      {detail.instructions ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-amber-800 dark:text-amber-300">
            <ClipboardList className="size-3.5" aria-hidden /> Navodila za teren
          </p>
          <p className="whitespace-pre-line text-amber-900 dark:text-amber-100">{detail.instructions}</p>
        </div>
      ) : null}

      {/* vodnik terena — celoten workflow pisarna → monter → teren (issue #1) */}
      <section aria-label="Vodnik terena">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Vodnik terena</h3>
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {[
            { label: 'Projekt odprt', done: !!detail.projectId },
            { label: 'Monter dodeljen', done: !!detail.assignee },
            { label: 'Delo začeto', done: !!detail.startedAt },
            { label: 'Fotografije zajete', done: detail.measurements.some((m) => m.type === 'FOTO') },
            { label: 'Meritve izvedene', done: detail.measurements.some((m) => m.type !== 'FOTO') },
            { label: 'Teren zaključen', done: detail.status === 'ZAKLJUCEN' },
          ].map((step, i) => (
            <li key={step.label} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${step.done ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : ''}`}>
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${step.done ? 'bg-emerald-500 text-white' : 'bg-secondary text-secondary-foreground'}`} aria-hidden>
                {step.done ? '✓' : i + 1}
              </span>
              <span className={step.done ? 'font-medium text-emerald-900 dark:text-emerald-200' : 'text-muted-foreground'}>
                {step.label}
                <span className="sr-only"> — {step.done ? 'opravljeno' : 'čaka'}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* R489 (issue #12): povzetek montažnega QA + primopredaja (urejanje v Danes) */}
      {!offline ? <QaSummarySection woId={detail.id} /> : null}

      {/* R439 (issue #6): OFFLINE DEJANJA — vrsta (vidno v monter/vodja toku).
          Gumbi delujejo TUDI online — vrsta se takoj poskusi sinhronizirati. */}
      {canTransition ? (
        <OfflineActionsSection wo={{ id: detail.id, code: detail.code, status: detail.status }} />
      ) : null}

      {/* preurčitev termina (R433 — zahteva povezavo) */}
      {!offline && canReschedule && detail.status !== 'ZAKLJUCEN' ? (
        <section aria-label="Preurčitev termina" className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="termin-date" className="text-xs text-muted-foreground">Preurči termin</Label>
            <Input
              id="termin-date" type="date" value={terminDate}
              onChange={(e) => setTerminDate(e.target.value)} className="h-9 w-44"
            />
          </div>
          <Button variant="outline" size="sm" className="h-9" disabled={terminBusy || !terminDate} onClick={() => void reschedule()}>
            {terminBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CalendarClock className="size-4" aria-hidden />}
            Preurči
          </Button>
        </section>
      ) : null}

      {/* R445 (issue #7 §9): dodelitev ekipe/podizvajalca — samo pisarna, online */}
      {!offline && canAssignCrew ? (
        <section aria-label="Dodelitev ekipe" className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-xs">
            <Label htmlFor="crew-pick" className="text-xs text-muted-foreground">Ekipa / podizvajalec na nalogu</Label>
            <Select value={crewPick} onValueChange={setCrewPick}>
              <SelectTrigger id="crew-pick" className="h-9">
                <SelectValue placeholder={detail.crew ? `Trenutno: ${detail.crew.name}` : 'Ni dodeljena'} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="keep">{detail.crew ? `Obdrži: ${detail.crew.name}` : 'Brez spremembe'}</SelectItem>
                <SelectItem value="none">Brez ekipe (počisti)</SelectItem>
                {(crews.data?.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.type === 'PODIZVAJALEC' ? 'podizvajalec' : 'interna'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ErrorBox error={crews.error} />
          </div>
          <Button variant="outline" size="sm" className="h-9" disabled={crewBusy || crewPick === 'keep'} onClick={() => void assignCrew()}>
            {crewBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Users className="size-4" aria-hidden />}
            Dodeli
          </Button>
        </section>
      ) : null}

      {/* terenski tok (sprotni prehodi — zahtevajo povezavo; offline uporabite Offline dejanja) */}
      {!offline && canTransition && actions.length > 0 ? (
        <section aria-label="Terenski tok" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Terenski tok</h3>
          <Textarea
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Opomba k prehodu (neobvezno) …"
            aria-label="Opomba k prehodu"
            className="min-h-16"
          />
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.to} size="sm" disabled={busy} onClick={() => void run(a.to, a.label)}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
                {a.label}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      {detail.status === 'ZAKLJUCEN' ? (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          Nalog je zaključen {fmtDateTime(detail.completedAt)} — terenski tok končan.
        </p>
      ) : null}

      {/* časovnica dogodkov */}
      <section aria-label="Časovnica dogodkov">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Časovnica dogodkov</h3>
        {detail.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ni dogodkov.</p>
        ) : (
          <ol className="max-h-96 space-y-0 overflow-y-auto pr-1">
            {detail.events.map((ev, i) => {
              const meta = EVENT_META[ev.type] ?? { label: ev.type, icon: MessageSquare, cls: 'bg-secondary text-secondary-foreground' }
              const Icon = meta.icon
              const last = i === detail.events.length - 1
              return (
                <li key={ev.id} className="relative flex gap-3 pb-4">
                  {!last ? <span className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-border" aria-hidden /> : null}
                  <span className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ${meta.cls}`}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="text-sm font-semibold">{meta.label}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{fmtDateTime(ev.createdAt)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{ev.user?.name ?? 'Sistem'}</div>
                    {ev.note ? <p className="mt-1 break-words rounded-lg bg-secondary/60 p-2 text-xs">{ev.note}</p> : null}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {/* povezane meritve */}
      <section aria-label="Meritve naloga">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Meritve ({detail.measurements.length})</h3>
        {detail.measurements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ni meritev — zajemite jih na terenu (zavihek Meritve / Foto).</p>
        ) : (
          <AnimatedList className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {detail.measurements.map((m) => (
              <AnimatedListItem key={m.id} className="rounded-lg border p-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-x-2">
                  <span className="flex items-center gap-2 font-medium">
                    <MeasurementTypeBadge type={m.type} />
                    {m.location ?? m.type}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">{fmtDate(m.createdAt)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>Dolžina: <strong className="text-foreground">{fmtM(m.lengthCm)}</strong></span>
                  {m.heightCm ? <span>Višina: <strong className="text-foreground">{m.heightCm} cm</strong></span> : null}
                  {m.posts ? <span>Stebri: <strong className="text-foreground">{m.posts}</strong></span> : null}
                  {typeof m.slopeDeg === 'number' ? <span>Nagib: <strong className="text-foreground">{m.slopeDeg.toFixed(2)}°</strong></span> : null}
                </div>
                {m.note ? <p className="mt-1 text-xs text-muted-foreground">{m.note}</p> : null}
              </AnimatedListItem>
            ))}
          </AnimatedList>
        )}
      </section>
    </>
  )
}

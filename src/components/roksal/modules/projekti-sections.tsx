'use client'

// PROJEKTI — sekcije podrobnosti: poslovni tok (R456), kronologija (R433),
// nov projekt, 3D predogled (R436), garancija (R434).
// R546: izvlečeno iz projekti.tsx BREZ spremembe obnašanja; skupni tipi v projekti-shared.ts.

import { useState } from 'react'
import { Box, CalendarCheck, ClipboardList, History, ShieldCheck } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { Railing3D, TIP_LABELS, parseKonfigurator, ralHex, ralLabel } from './viz-3d'
import { STATUSES, type ProjectDetail, type WarrantyRow } from './projekti-shared'

/**
 * R456 (issue #11 §3/§10): POSLOVNI TOK PROJEKTA + NASLEDNJI KORAK.
 * 13 stopenj (POVPRAŠEVANJE → … → GARANCIJA) z vmesti/odprti stanjem,
 * odstotkom in CTA »NADALJUJ: …«, ki uporabnika odpelje na pravi modul —
 * uporabnik ne išče funkcije po menijih, sistem ve, kaj sledi.
 */
export function ProgressSection ({ projectId, onNavigate }: { projectId: string; onNavigate: (tab: string) => void }) {
  const prog = useApi<{ data: {
    steps: { key: string; label: string; state: 'done' | 'todo'; detail: string | null }[]
    done: number; total: number; pct: number
    next: { key: string; label: string; targetTab: string; reason: string } | null
  } }>(`/api/projects/${projectId}/progress`, [projectId])

  if (prog.loading) {
    return <div className="h-20 animate-pulse rounded-lg border bg-muted/40" aria-label="Nalaganje napredka projekta" />
  }
  if (prog.error || !prog.data) return null // napaka ne sme blokirati podrobnosti
  const d = prog.data.data

  return (
    <section aria-label="Poslovni tok projekta" className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <ClipboardList className="size-4 text-roksal-amber" aria-hidden /> Poslovni tok
        </h3>
        <span className="text-xs font-semibold text-muted-foreground">
          {d.done}/{d.total} ({d.pct} %)
        </span>
      </div>

      {/* napredek */}
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar" aria-valuenow={d.pct} aria-valuemin={0} aria-valuemax={100}
        aria-label={`Napredek projekta ${d.pct} %`}
      >
        <div className="h-full rounded-full bg-roksal-amber transition-all" style={{ width: `${d.pct}%` }} />
      </div>

      {/* 13 stopenj — vizualni indikator (§10) */}
      <ol className="mt-2.5 flex flex-wrap gap-1" aria-label="Koraki poslovnega toka">
        {d.steps.map((s) => (
          <li
            key={s.key}
            title={`${s.label}: ${s.detail ?? ''}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              s.state === 'done'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-muted-foreground/25 text-muted-foreground'
            }`}
          >
            <span aria-hidden>{s.state === 'done' ? '✓' : '○'}</span> {s.label}
          </li>
        ))}
      </ol>

      {/* NASLEDNJI KORAK (§3 workflow vodi uporabnika) */}
      {d.next ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-2.5 dark:bg-amber-950/40">
          <p className="min-w-0 flex-1 text-xs text-amber-900 dark:text-amber-200">{d.next.reason}</p>
          <Button size="sm" className="h-9 shrink-0" onClick={() => onNavigate(d.next!.targetTab)}>
            {d.next.label} →
          </Button>
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          ✓ Celoten poslovni tok je zaključen — od povpraševanja do garancije.
        </p>
      )}
    </section>
  )
}

const TIMELINE_TYPE_STYLES: Record<string, string> = {
  ODPERTJE: 'bg-roksal-ink text-primary-foreground',
  PONUDBA: 'bg-secondary text-foreground',
  PODPIS: 'bg-roksal-amber text-roksal-ink',
  MERITEV: 'bg-secondary text-foreground',
  NALOG: 'bg-secondary text-foreground',
  DOGAJEK: 'bg-secondary/70 text-muted-foreground',
  ZAKLJUCEK: 'bg-emerald-700 text-white',
  RACUN: 'bg-secondary text-foreground',
  PLACILO: 'bg-emerald-700 text-white',
  PROIZVODNJA: 'bg-secondary text-foreground',
}

const TIMELINE_TYPE_LABELS: Record<string, string> = {
  ODPERTJE: 'odpertje', PONUDBA: 'ponudba', PODPIS: 'podpis', MERITEV: 'meritev',
  NALOG: 'nalog', DOGAJEK: 'dogodek', ZAKLJUCEK: 'zaključek', RACUN: 'račun',
  PLACILO: 'plačilo', PROIZVODNJA: 'proizvodnja',
}

export function TimelineDialog ({ projectId, code }: { projectId: string; code: string }) {
  const tl = useApi<{ data: { entries: { at: string; type: string; label: string; detail: string; ref: string }[]; count: number } }>(`/api/projects/${projectId}/timeline`, [projectId])
  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Zgodovina — {code}</DialogTitle>
        <DialogDescription>Kronološki tok projekta: ponudbe, podpisi, teren, računi, plačila, proizvodnja.</DialogDescription>
      </DialogHeader>
      <ErrorBox error={tl.error} />
      {tl.loading ? <LoadingRows rows={5} /> : !tl.error && (tl.data?.data.entries ?? []).length === 0 ? (
        <EmptyState title="Ni dogodkov" desc="Zgodovina projekta je prazna." icon={History} />
      ) : (
        <ol className="relative space-y-3 border-l pl-5" aria-label="Kronologija projekta">
          {(tl.data?.data.entries ?? []).map((e, i) => (
            <li key={`${e.at}-${i}`} className="relative">
              <span
                className={cn('absolute -left-[27px] top-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', TIMELINE_TYPE_STYLES[e.type] ?? 'bg-secondary text-foreground')}
                aria-hidden
              >
                {TIMELINE_TYPE_LABELS[e.type] ?? e.type.toLowerCase()}
              </span>
              <div className="rounded-lg border p-2.5">
                <div className="text-sm font-medium leading-snug">{e.label}</div>
                <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="truncate text-xs text-muted-foreground">{e.detail}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">{fmtDateTime(e.at)}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </DialogContent>
  )
}

export function CreateProjectDialog ({ customers, onClose, onCreated }: {
  customers: { id: string; name: string }[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [customerId, setCustomerId] = useState('none')
  const [address, setAddress] = useState('')
  const [status, setStatusS] = useState('NACRT')
  const [busy, setBusy] = useState(false)

  async function submit () {
    if (!title.trim()) { toast({ title: 'Naslov je obvezen.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/projects', { title, customerId: customerId === 'none' ? null : customerId, address, status })
      toast({ title: 'Projekt ustvarjen.' })
      await onCreated()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nov projekt</DialogTitle>
        <DialogDescription>Osnovni podatki — kodo določi sistem.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="np-title">Naslov</Label>
          <Input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="npr. Ograja terasa — Novak" />
        </div>
        <div className="space-y-2">
          <Label>Stranka</Label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger aria-label="Stranka"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez stranke</SelectItem>
              {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="np-addr">Naslov objekta</Label>
          <Input id="np-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ulica, kraj" />
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatusS}>
            <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Ustvarjam…' : 'Ustvari'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

/** 3D predogled (R436) — zadnja shranjena konfiguracija (params.konfigurator). */
export function KonfigPreviewSection ({ measurements }: { measurements: ProjectDetail['measurements'] }) {
  // meritve so urejene desc — prva z konfiguratorjem je ZADNJA shranjena
  // (brez useMemo: parseKonfigurator je poceni, React Compiler pa zanke z
  // zgodnjim returnom ne zna ohraniti kot ročno memoizacijo)
  const found = (() => {
    for (const m of measurements) {
      const k = parseKonfigurator(m.params)
      if (k) return { m, k }
    }
    return null
  })()

  return (
    <section aria-label="3D predogled konfiguracije">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        <Box className="size-3.5 text-roksal-amber" aria-hidden /> 3D predogled
      </h3>
      {!found ? (
        <EmptyState
          title="Ni shranjene konfiguracije"
          desc="Za ta projekt še ni shranjene konfiguracije — ustvarite jo v zavihku Vizualizacija."
          icon={Box}
        />
      ) : (
        <div className="space-y-2 rounded-xl border p-3">
          <Railing3D
            compact
            lengthCm={found.k.lengthCm}
            heightCm={found.k.heightCm}
            posts={found.k.posts}
            handrail={found.k.handrail}
            slopeDeg={found.k.slopeDeg}
            colorHex={ralHex(found.k.colorId)}
            tip={found.k.tip}
            sku={found.k.sku}
          />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{TIP_LABELS[found.k.tip]}</span>
            {found.k.sku ? <span className="font-mono">{found.k.sku}</span> : null}
            <span>{ralLabel(found.k.colorId)}</span>
            <span>
              {(found.k.lengthCm / 100).toFixed(2).replace('.', ',')} m × {Math.round(found.k.heightCm)} cm
            </span>
            <span>{found.k.posts} stebrov</span>
            {found.k.slopeDeg > 0 ? (
              <span>nagib {found.k.slopeDeg.toFixed(1).replace('.', ',')}°</span>
            ) : null}
            <span className="ml-auto">{fmtDate(found.m.createdAt)}</span>
          </p>
        </div>
      )}
    </section>
  )
}

/** Garancija projekta (R434) — stanje, obiski, oddaja garancije. */
export function WarrantySection ({ projectId, projectStatus }: { projectId: string; projectStatus: string }) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const warranty = useApi<{ data: WarrantyRow[] }>(`/api/warranty?projectId=${projectId}`, [projectId])
  const [months, setMonths] = useState('24')
  const [visitNote, setVisitNote] = useState('')
  const [visitDate, setVisitDate] = useState('')
  const [busy, setBusy] = useState(false)

  const canWrite = hasPerm(user?.perms, 'projects.write')
  const w = warranty.data?.data?.[0] ?? null
  const closed = projectStatus === 'ZAKLJUCEN' || projectStatus === 'ARHIV'

  async function createWarranty () {
    setBusy(true)
    try {
      await apiPost('/api/warranty', { projectId, months: Number(months) })
      toast({ title: 'Garancija oddana.', description: `${months} mesecev od danes.` })
      await warranty.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function addVisit () {
    if (!w) return
    if (!visitNote.trim()) { toast({ title: 'Opis obiska je obvezen.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/warranty', { warrantyId: w.id, visitNote, visitDate: visitDate || undefined })
      toast({ title: 'Obisk zabeležen.' })
      setVisitNote(''); setVisitDate('')
      await warranty.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <section aria-label="Garancija">
      <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Garancija</h3>
      <ErrorBox error={warranty.error} />
      {warranty.loading ? <LoadingRows rows={1} /> : !warranty.error && !w ? (
        closed ? (
          canWrite ? (
            <div className="space-y-2 rounded-xl border border-dashed p-3">
              <p className="text-sm text-muted-foreground">Projekt je zaključen — garancija še ni oddana.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={months} onValueChange={setMonths}>
                  <SelectTrigger className="w-32" aria-label="Trajanje garancije"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['12', '24', '36', '60'].map((m) => <SelectItem key={m} value={m}>{m} mesecev</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => void createWarranty()} disabled={busy}>
                  <ShieldCheck className="size-4" aria-hidden /> Oddaj garancijo
                </Button>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">Garancija ni oddana (zahteva pravico projects.write).</p>
        ) : <p className="text-sm text-muted-foreground">Garancija se odda po zaključku projekta.</p>
      ) : !warranty.error && w ? (
        <div className="space-y-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className={cn('size-4', w.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')} aria-hidden />
              {w.valid ? 'Garancija velja' : 'Garancija je potekla'}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {fmtDate(w.startsAt)} → {fmtDate(w.endsAt)} ({w.months} m)
            </span>
          </div>
          {w.note ? <p className="text-xs text-muted-foreground">{w.note}</p> : null}
          {w.nextVisit ? (
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-roksal-amber">
              <CalendarCheck className="size-3.5" aria-hidden /> Naslednji obisk: {fmtDate(w.nextVisit.date)}
              {w.nextVisit.note ? ` — ${w.nextVisit.note}` : ''}
            </p>
          ) : null}
          {w.visits.length > 0 ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {w.visits.map((v) => (
                <li key={v.id} className="flex items-start justify-between gap-2 text-xs">
                  <span className="min-w-0"><span className="font-mono text-muted-foreground">{fmtDate(v.date)}</span> {v.note}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">Ni zabeleženih obiskov.</p>}
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <Input
                type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)}
                className="w-36" aria-label="Datum obiska"
              />
              <Input
                value={visitNote} onChange={(e) => setVisitNote(e.target.value)}
                placeholder="Opis obiska / pregleda" className="min-w-0 flex-1" aria-label="Opis obiska"
                onKeyDown={(e) => { if (e.key === 'Enter') void addVisit() }}
              />
              <Button size="sm" variant="outline" onClick={() => void addVisit()} disabled={busy}>
                <CalendarCheck className="size-4" aria-hidden /> Zapiši obisk
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

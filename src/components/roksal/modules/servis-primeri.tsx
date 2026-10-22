'use client'

// SERVIS — zavihek SERVIS (ServiceCase + ServiceVisit — R446) — R547 izvleček
// iz servis.tsx (razbitje po vzorcu R546; BREZ spremembe obnašanja).
// Tok: PREVERITEV → odločitev → V_SERVISU → zaključek; obiski (pisarna ali monter zase).

import { useState } from 'react'
import {
  BadgeCheck, Ban, CalendarClock, CheckCircle2, FileWarning, HardHat,
  LifeBuoy, Plus, ShieldCheck, User, Wrench,
} from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import {
  CASE_STATUSI, ODLOCITEV_CLS, ODLOCITVE, garancijaVelja, isOffice, odlocitevLabel,
  type ProjectOption, type ServiceCaseRow, type UserOption,
} from './servis-shared'

// ═══ ZAVIHEK: SERVIS (ServiceCase + ServiceVisit — R446) ═════════════════════

export function ServisTab () {
  const user = useAppStore((s) => s.user)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const cases = useApi<{ data: ServiceCaseRow[] }>(`/api/service-cases${status !== 'all' ? `?status=${status}` : ''}`, [status])
  const office = isOffice(user)
  const rows = cases.data?.data ?? []
  const activeCount = rows.filter((c) => c.status === 'PREVERITEV' || c.status === 'ODOBRENA' || c.status === 'V_SERVISU').length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44 min-h-11" aria-label="Filter statusa servisnega primera"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="min-h-11">Vsi statusi</SelectItem>
            {CASE_STATUSI.map((s) => <SelectItem key={s.v} value={s.v} className="min-h-11">{s.l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">
          {rows.length} primerov{activeCount > 0 ? ` · ${activeCount} aktivnih` : ''}
        </Badge>
        {office ? (
          <Button size="sm" className="ml-auto min-h-11" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nov servisni primer
          </Button>
        ) : null}
      </div>

      <ErrorBox error={cases.error} />
      {cases.loading ? <LoadingRows /> : !cases.error && rows.length === 0 ? (
        <EmptyState
          title="Ni servisnih primerov"
          desc={user?.role === 'MONTER'
            ? 'Nimate še svojih servisnih primerov — obiski, ki vam jih dodeli pisarna, se pojavijo tukaj.'
            : 'Servisni primer odprete iz reklamacije ali neposredno za projekt.'}
          icon={Wrench}
        />
      ) : (
        <AnimatedList className="space-y-2">
          {rows.map((c) => (
            <AnimatedListItem key={c.id}>
              <Card className="transition hover:border-roksal-amber/60">
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{c.code}</span>
                    <StatusBadge status={c.status} />
                    {c.decision ? (
                      <Badge variant="secondary" className={`border-transparent font-medium ${ODLOCITEV_CLS[c.decision] ?? ''}`}>
                        {odlocitevLabel(c.decision)}
                      </Badge>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground">{c.visits.length} obiskov</span>
                  </div>
                  <div className="text-sm font-semibold leading-snug">{c.title}</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{c.project.code}</span>
                    {c.claim ? <span className="font-mono">{c.claim.code}</span> : null}
                    {c.warranty ? (
                      c.billable
                        ? <span className="inline-flex items-center gap-1"><BadgeCheck className="size-3" aria-hidden /> zaračunano</span>
                        : <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3" aria-hidden /> garancija pokriva</span>
                    ) : c.billable ? <span className="inline-flex items-center gap-1"><BadgeCheck className="size-3" aria-hidden /> zaračunano</span> : null}
                  </div>
                  <Button variant="outline" size="sm" className="mt-1 min-h-11" onClick={() => setSelected(c.id)}>
                    Podrobnosti in tok
                  </Button>
                </CardContent>
              </Card>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <CaseDetailDialog
          id={selected}
          onClose={() => setSelected(null)}
          onDone={async () => { await cases.reload() }}
        />
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewCaseDialog
          key={String(createOpen)}
          onClose={() => setCreateOpen(false)}
          onDone={async () => { await cases.reload() }}
        />
      </Dialog>
    </div>
  )
}

/** Podrobnost servisnega primera: tok + odločitev + obiski. */
function CaseDetailDialog ({ id, onClose, onDone }: { id: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const detail = useApi<{ data: ServiceCaseRow }>(id ? `/api/service-cases/${id}` : null, [id])
  const users = useApi<{ data: UserOption[] }>(id && isOffice(user) ? '/api/users' : null, [id])

  const [busy, setBusy] = useState(false)
  // odločitev (PREVERITEV)
  const [decision, setDecision] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [billableOverride, setBillableOverride] = useState<boolean | null>(null)
  // zaključek
  const [resolutionNote, setResolutionNote] = useState('')
  // obisk
  const [visitNote, setVisitNote] = useState('')
  const [visitDate, setVisitDate] = useState('')
  const [visitHours, setVisitHours] = useState('')
  const [visitUser, setVisitUser] = useState('')

  const c = detail.data?.data
  const office = isOffice(user)
  // monter lahko zapiše obisk ZASE na odobrenem/v servisnem primeru
  const canVisit = !!c && (c.status === 'ODOBRENA' || c.status === 'V_SERVISU') &&
    (office || (user?.role === 'MONTER' || !!user && hasPerm(user.perms, 'nalog.write')))

  async function patch (body: Record<string, unknown>, msg: string) {
    if (!c) return
    setBusy(true)
    try {
      await apiPatch(`/api/service-cases/${c.id}`, body)
      toast({ title: msg, description: c.code })
      setDecisionNote(''); setResolutionNote(''); setBillableOverride(null)
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Sprememba ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function addVisit () {
    if (!c) return
    const note = visitNote.trim()
    if (!note) {
      toast({ title: 'Opis obiska je obvezen.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost(`/api/service-cases/${c.id}/visits`, {
        note,
        ...(visitDate ? { date: new Date(visitDate).toISOString() } : {}),
        ...(visitHours && Number(visitHours) > 0 ? { hours: Number(visitHours) } : {}),
        ...(office && visitUser ? { userId: visitUser } : {}),
      })
      toast({ title: 'Servisni obisk zabeležen.', description: c.code })
      setVisitNote(''); setVisitDate(''); setVisitHours(''); setVisitUser('')
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Obiska ni bilo mogoče zabeležiti', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  if (!c) {
    return (
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Servisni primer</DialogTitle>
          <DialogDescription className="sr-only">Podrobnosti servisnega primera.</DialogDescription>
        </DialogHeader>
        {detail.loading ? <LoadingRows rows={2} /> : <ErrorBox error={detail.error ?? { message: 'Servisni primer ni na voljo.' }} />}
      </DialogContent>
    )
  }

  const tokKoraki: { l: string; done: boolean }[] = [
    { l: 'Preveritev', done: c.status !== 'PREVERITEV' },
    { l: 'Odločitev', done: !!c.decision },
    { l: 'Servis', done: c.status === 'V_SERVISU' || c.status === 'ZAKLJUCEN' },
    { l: 'Zaključek', done: c.status === 'ZAKLJUCEN' },
  ]

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-roksal-amber">{c.code}</span>
          <StatusBadge status={c.status} />
        </DialogTitle>
        <DialogDescription>
          {c.project.code} — {c.project.title}
          {c.claim ? ` · iz reklamacije ${c.claim.code}` : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="text-sm font-semibold">{c.title}</div>
        <p className="whitespace-pre-line text-sm text-muted-foreground">{c.desc}</p>

        {/* tok: PREVERITEV → odločitev → SERVIS → zaključek */}
        <ol className="flex items-center gap-1 text-xs" aria-label="Tok servisnega primera">
          {tokKoraki.map((k, i) => (
            <li key={k.l} className="flex flex-1 items-center gap-1">
              <span className={`flex h-7 min-w-7 items-center justify-center rounded-full border px-2 font-medium ${k.done
                ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground'}`}>
                {k.done ? <CheckCircle2 className="size-3.5" aria-hidden /> : <span aria-hidden>{i + 1}</span>}
                <span className="sr-only">{k.done ? 'opravljeno: ' : 'korak: '}</span>
              </span>
              <span className="hidden sm:inline">{k.l}</span>
              {i < tokKoraki.length - 1 ? <span className="h-px flex-1 bg-border" aria-hidden /> : null}
            </li>
          ))}
        </ol>

        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          {c.claim ? (
            <div className="inline-flex items-center gap-1.5">
              <FileWarning className="size-3" aria-hidden /> {c.claim.code} — {c.claim.title}
              {c.claim.customer ? ` (${c.claim.customer.name})` : ''}
            </div>
          ) : null}
          {c.warranty ? (
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3" aria-hidden /> {garancijaVelja(c.warranty) ? 'garancija velja' : 'garancija ne velja'} ({c.warranty.months} m)
            </div>
          ) : null}
          {c.decidedBy ? (
            <div className="inline-flex items-center gap-1.5"><User className="size-3" aria-hidden /> odločil {c.decidedBy.name} · {fmtDate(c.decidedAt)}</div>
          ) : null}
          <div className="inline-flex items-center gap-1.5">
            {c.billable
              ? <><BadgeCheck className="size-3" aria-hidden /> zaračunano stranki</>
              : <><LifeBuoy className="size-3" aria-hidden /> garancija pokriva</>}
          </div>
        </div>

        {c.decision ? (
          <div className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Odločitev</span>
              <Badge variant="secondary" className={`border-transparent font-medium ${ODLOCITEV_CLS[c.decision] ?? ''}`}>
                {odlocitevLabel(c.decision)}
              </Badge>
            </div>
            {c.decisionNote ? <p className="mt-1 whitespace-pre-line">{c.decisionNote}</p> : null}
          </div>
        ) : null}
        {c.resolutionNote ? (
          <div className="rounded-lg border p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rešitev</div>
            <p className="mt-1 whitespace-pre-line">{c.resolutionNote}</p>
          </div>
        ) : null}

        {/* pisarniški tok */}
        {office ? (
          <div className="space-y-3 rounded-lg border p-3">
            {c.status === 'PREVERITEV' ? (
              <>
                <div className="text-sm font-semibold">Odločitev po preveritvi</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="case-decision">Odločitev</Label>
                    <Select value={decision} onValueChange={setDecision}>
                      <SelectTrigger id="case-decision" className="min-h-11"><SelectValue placeholder="Izberite odločitev" /></SelectTrigger>
                      <SelectContent>
                        {ODLOCITVE.map((d) => <SelectItem key={d.v} value={d.v} className="min-h-11">{d.l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2 pb-1">
                    <Switch
                      id="case-billable"
                      checked={billableOverride ?? undefined}
                      onCheckedChange={(v) => setBillableOverride(v)}
                      aria-label="Zaračunaj stranki (prepiše samodejni izračun iz garancije)"
                    />
                    <Label htmlFor="case-billable" className="text-sm font-normal text-muted-foreground">
                      Zaračunaj stranki (prepiše samodejni izračun)
                    </Label>
                  </div>
                </div>
                <Textarea
                  aria-label="Utemeljitev odločitve (vsaj 5 znakov)"
                  value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)}
                  placeholder="Utemeljitev odločitve (obvezna)"
                  className="min-h-16"
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="min-h-11"
                    disabled={busy || !decision || decisionNote.trim().length < 5}
                    onClick={() => patch({
                      status: 'ODOBRENA', decision, decisionNote: decisionNote.trim(),
                      ...(billableOverride !== null ? { billable: billableOverride } : {}),
                    }, 'Primer odobren — v servis.')}>
                    <CheckCircle2 className="size-4" aria-hidden /> Odobri in v servis
                  </Button>
                  <Button size="sm" variant="destructive" className="min-h-11"
                    disabled={busy || !decision || decisionNote.trim().length < 5}
                    onClick={() => patch({ status: 'ZAVRNJENA', decision, decisionNote: decisionNote.trim() }, 'Primer zavrnjen.')}>
                    <Ban className="size-4" aria-hidden /> Zavrni
                  </Button>
                </div>
              </>
            ) : null}

            {c.status === 'ODOBRENA' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">Primer je odobren{c.billable ? ' (zaračunano stranki)' : ' (garancija pokriva)'}.</span>
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy}
                  onClick={() => patch({ status: 'V_SERVISU' }, 'Primer je v servisu.')}>
                  <Wrench className="size-4" aria-hidden /> V servis
                </Button>
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy}
                  onClick={() => patch({ billable: !c.billable }, c.billable ? 'Zaračunavanje odstranjeno.' : 'Označeno kot zaračunano.')}>
                  <BadgeCheck className="size-4" aria-hidden /> {c.billable ? 'Ne zaračunaj' : 'Zaračunaj stranki'}
                </Button>
              </div>
            ) : null}

            {c.status === 'ODOBRENA' || c.status === 'V_SERVISU' ? (
              <div className="space-y-2">
                <Textarea
                  aria-label="Opomba o rešitvi (obvezna ob zaključku)"
                  value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Kaj je bilo narejeno (obvezno ob zaključku)"
                  className="min-h-16"
                />
                <Button size="sm" className="min-h-11" disabled={busy || resolutionNote.trim().length < 5}
                  onClick={() => patch({ status: 'ZAKLJUCEN', resolutionNote: resolutionNote.trim() }, 'Servisni primer zaključen.')}>
                  <CheckCircle2 className="size-4" aria-hidden /> Zaključi primer
                </Button>
              </div>
            ) : null}

            {c.status === 'ZAKLJUCEN' || c.status === 'ZAVRNJENA' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Primer je {c.status === 'ZAKLJUCEN' ? 'zaključen' : 'zavrnjen'}.</span>
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy}
                  onClick={() => patch({ billable: !c.billable }, c.billable ? 'Zaračunavanje odstranjeno.' : 'Označeno kot zaračunano.')}>
                  <BadgeCheck className="size-4" aria-hidden /> {c.billable ? 'Ne zaračunaj' : 'Zaračunaj stranki'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* obiski */}
        <div>
          <h4 className="mb-2 text-sm font-semibold">Servisni obiski ({c.visits.length})</h4>
          {c.visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Še ni obiskov.</p>
          ) : (
            <AnimatedList className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {c.visits.map((v) => (
                <AnimatedListItem key={v.id} className="rounded-lg border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" aria-hidden /> {fmtDateTime(v.date)}</span>
                    <span className="inline-flex items-center gap-1"><HardHat className="size-3" aria-hidden /> {v.user.name}</span>
                    {v.hours ? <span>{v.hours} h</span> : null}
                  </div>
                  <div className="mt-0.5 whitespace-pre-line">{v.note}</div>
                </AnimatedListItem>
              ))}
            </AnimatedList>
          )}

          {canVisit ? (
            <div className="mt-2 space-y-2 rounded-lg border p-3">
              <Label htmlFor="visit-note">Nov servisni obisk{office ? '' : ' (zase)'}</Label>
              <Textarea
                id="visit-note" value={visitNote} onChange={(e) => setVisitNote(e.target.value)}
                placeholder="Kaj je bilo storjeno na terenu"
                className="min-h-20"
              />
              <div className="grid gap-2 sm:grid-cols-3">
                {office ? (
                  <div className="space-y-1">
                    <Label htmlFor="visit-user" className="text-xs">Tehnik</Label>
                    <Select value={visitUser} onValueChange={setVisitUser}>
                      <SelectTrigger id="visit-user" className="min-h-11"><SelectValue placeholder="Zame" /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {(users.data?.data ?? []).filter((u) => u.active).map((u) => (
                          <SelectItem key={u.id} value={u.id} className="min-h-11">{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <Label htmlFor="visit-date" className="text-xs">Datum</Label>
                  <Input id="visit-date" type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} className="min-h-11" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="visit-hours" className="text-xs">Ure dela</Label>
                  <Input id="visit-hours" type="number" min="0.5" step="0.5" max="24" value={visitHours}
                    onChange={(e) => setVisitHours(e.target.value)} className="min-h-11" placeholder="Npr. 2.5" />
                </div>
              </div>
              <Button size="sm" className="min-h-11 w-full sm:w-auto" disabled={busy || !visitNote.trim()} onClick={addVisit}>
                <Plus className="size-4" aria-hidden /> Zabeleži obisk
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </DialogContent>
  )
}

/** Nov servisni primer (pisarna) — neposredno za projekt, z ali brez reklamacije. */
function NewCaseDialog ({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const projects = useApi<{ data: ProjectOption[] }>('/api/projects?limit=500')
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    if (!projectId || !title.trim() || !desc.trim()) {
      toast({ title: 'Izpolnite projekt, naslov in opis.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: ServiceCaseRow }>('/api/service-cases', {
        projectId, title: title.trim(), desc: desc.trim(),
      })
      toast({ title: 'Servisni primer odprt.', description: res.data.code })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Servisnega primera ni bilo mogoče odpreti', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Nov servisni primer</DialogTitle>
        <DialogDescription>
          Primer iz reklamacije odprite iz podrobnosti reklamacije — tukaj odprete primer neposredno za projekt.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="case-proj">Projekt</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="case-proj" className="min-h-11"><SelectValue placeholder="Izberite projekt" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {(projects.data?.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id} className="min-h-11">{p.code} — {p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="case-naslov">Naslov</Label>
          <Input id="case-naslov" value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-11"
            placeholder="Npr. Zamenjava zaključnega profila" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="case-opis">Opis</Label>
          <Textarea id="case-opis" value={desc} onChange={(e) => setDesc(e.target.value)} className="min-h-24" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" className="min-h-11" onClick={onClose}>Prekliči</Button>
        <Button className="min-h-11" disabled={busy} onClick={submit}>Odpri primer</Button>
      </DialogFooter>
    </DialogContent>
  )
}

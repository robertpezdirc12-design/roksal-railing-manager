'use client'

// NALOGI — osrednji center delovnih nalogov (vrata nalog.read)
// Filtri (scope/status/iskanje) + seznam + podrobnost s časovnico dogodkov in meritvami
// + terenski tok (nalog.transition) + nov nalog (nalog.write)

import { useMemo, useState } from 'react'
import {
  Camera, CheckCheck, CheckCircle2, ClipboardList, Loader2, MapPin, MessageSquare,
  Play, Plus, Ruler, Search, User, UserPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface WorkOrderRow {
  id: string; code: string; title: string; status: string
  scheduledFor: string | null; startedAt: string | null; completedAt: string | null; summary: string | null
  project: { code: string; title: string; address: string | null; customer: { name: string } | null } | null
  assignee: { name: string } | null
  _count: { measurements: number; events: number }
}

interface WorkOrderDetail extends Omit<WorkOrderRow, 'assignee' | '_count'> {
  assignee: { id: string; name: string } | null
  events: { id: string; type: string; note: string | null; createdAt: string; user: { name: string } | null }[]
  measurements: {
    id: string; type: string; location: string | null; lengthCm: number | null
    heightCm: number | null; posts: number | null; slopeDeg: number | null; note: string | null; createdAt: string
  }[]
}

const SCOPES = [
  { value: 'all', label: 'Vsi' },
  { value: 'open', label: 'Odprti' },
  { value: 'mine', label: 'Moji' },
  { value: 'today', label: 'Danes' },
]

const STATUSES = [
  { value: 'NAPROGRAMIRAN', label: 'Naprogramiran' },
  { value: 'V_TEKU', label: 'V teku' },
  { value: 'V_ZAJEMU', label: 'V zajemu' },
  { value: 'V_PREVERI', label: 'V preveri' },
  { value: 'ZAKLJUCEN', label: 'Zaključen' },
]

// terenski tok — VERBATIM R429 §7 (enako kot backend FLOW na /api/nalog/[id]/transition)
const TRANSITIONS: { from: string[]; to: string; label: string }[] = [
  { from: ['NAPROGRAMIRAN'], to: 'V_TEKU', label: 'ZAČNI DELO' },
  { from: ['V_TEKU'], to: 'V_ZAJEMU', label: 'ZAJEM' },
  { from: ['V_TEKU', 'V_ZAJEMU'], to: 'V_PREVERI', label: 'PREVERI' },
  { from: ['V_PREVERI'], to: 'ZAKLJUCEN', label: 'ZAKLJUČI TEREN' },
]

const EVENT_META: Record<string, { label: string; icon: typeof Play; cls: string }> = {
  DODELJEN: { label: 'Dodeljen', icon: UserPlus, cls: 'bg-secondary text-secondary-foreground' },
  ZACETEK: { label: 'Začetek dela', icon: Play, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  ZAJEM: { label: 'Zajem', icon: Camera, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  PREVERITEV: { label: 'Preveritev', icon: CheckCircle2, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  ZAKLJUCEK: { label: 'Zaključek terena', icon: CheckCheck, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  KOMENTAR: { label: 'Komentar', icon: MessageSquare, cls: 'bg-secondary text-secondary-foreground' },
}

const fmtM = (cm: number | null | undefined) => (typeof cm === 'number' && cm > 0 ? `${(cm / 100).toFixed(2)} m` : '—')

const MEASUREMENT_TYPES: Record<string, { label: string; cls: string }> = {
  OGRAJA: { label: 'Ograja', cls: 'bg-secondary text-secondary-foreground' },
  BALUSTRADA: { label: 'Balustrada', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  NAGIB: { label: 'Nagib', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  FOTO: { label: 'Foto', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  OSTANEO: { label: 'Ostaneo', cls: 'bg-muted text-muted-foreground' },
}

function MeasurementTypeBadge ({ type }: { type: string }) {
  const t = MEASUREMENT_TYPES[type] ?? { label: type, cls: 'bg-muted text-muted-foreground' }
  return <Badge variant="secondary" className={cn('border-transparent font-medium', t.cls)}>{t.label}</Badge>
}

export default function NalogiModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const [scope, setScope] = useState('all')
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const list = useApi<{ data: WorkOrderRow[] }>(
    `/api/nalog?scope=${scope}${status !== 'all' ? `&status=${status}` : ''}`,
    [scope, status]
  )
  const detail = useApi<{ data: WorkOrderDetail }>(selected ? `/api/nalog/${selected}` : null, [selected])

  const canWrite = hasPerm(user?.perms, 'nalog.write')
  const canTransition = hasPerm(user?.perms, 'nalog.transition')

  // iskanje po kodi/naslovu (odjemalec stranke kot bonus)
  const rows = useMemo(() => {
    const all = list.data?.data ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    return all.filter((w) =>
      w.code.toLowerCase().includes(needle) ||
      w.title.toLowerCase().includes(needle) ||
      (w.project?.customer?.name ?? '').toLowerCase().includes(needle)
    )
  }, [list.data, q])

  async function transition (wo: { id: string; code: string }, to: string, label: string, note: string) {
    try {
      // backend: /api/nalog/[id]/transition sprejema POST (PATCH vrne 405)
      await apiPost(`/api/nalog/${wo.id}/transition`, { to, note: note.trim() || label })
      toast({ title: `${label} — ${wo.code}`, description: 'Prehod terenskega toka uspešno izveden.' })
      await Promise.all([list.reload(), detail.reload()])
    } catch (e) {
      toast({
        title: 'Prehod zavrnjen',
        description: e instanceof Error ? e.message : 'Napaka',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Nalogi"
        desc="Osrednji center delovnih nalogov — terenski tok, časovnica, meritve"
        actions={canWrite ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nov nalog
          </Button>
        ) : null}
      />

      {/* filtri: scope + status + iskanje */}
      <div className="flex flex-wrap gap-2">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-32" aria-label="Obseg seznamov">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" aria-label="Filter statusa">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči po kodi, naslovu, stranki …" className="pl-8" aria-label="Iskanje nalogov" />
        </div>
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni nalogov" desc="Poskusite spremeniti obseg, status ali iskalni niz." icon={ClipboardList} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((wo) => (
            <li key={wo.id}>
              <button type="button" className="w-full text-left" onClick={() => setSelected(wo.id)} aria-label={`Odpri nalog ${wo.code}`}>
                <Card className="transition hover:border-roksal-amber/60 hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-roksal-amber">{wo.code}</span>
                      <StatusBadge status={wo.status} />
                    </div>
                    <div className="mt-1.5 font-semibold leading-snug">{wo.title}</div>
                    {wo.project ? (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{wo.project.customer?.name ?? 'Brez stranke'}</span>
                        <span className="font-mono">{wo.project.code}</span>
                        {wo.project.address ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{wo.project.address}</span> : null}
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><User className="size-3" aria-hidden />{wo.assignee?.name ?? 'Ni dodeljen'}</span>
                      <span className="inline-flex items-center gap-1"><ClipboardList className="size-3" aria-hidden />{fmtDate(wo.scheduledFor)}</span>
                      <span className="inline-flex items-center gap-1"><Ruler className="size-3" aria-hidden />{wo._count.measurements}</span>
                      <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" aria-hidden />{wo._count.events}</span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* podrobnost naloga */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {detail.loading ? <LoadingRows rows={3} /> : detail.data ? (
            <NalogDetail
              detail={detail.data.data}
              canTransition={canTransition}
              onTransition={transition}
            />
          ) : <ErrorBox error={detail.error} />}
        </DialogContent>
      </Dialog>

      {/* nov nalog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <CreateNalogDialog
          open={createOpen}
          canReadUsers={hasPerm(user?.perms, 'users.read')}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await list.reload() }}
        />
      </Dialog>
    </div>
  )
}

// ─── podrobnost: osnovni podatki + terenski tok + časovnica + meritve ───────

function NalogDetail ({ detail, canTransition, onTransition }: {
  detail: WorkOrderDetail
  canTransition: boolean
  onTransition: (wo: { id: string; code: string }, to: string, label: string, note: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

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
          <span className="font-mono text-xs font-semibold text-roksal-amber">{detail.code}</span>
          <StatusBadge status={detail.status} />
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
        <div><dt className="text-xs text-muted-foreground">Termin</dt><dd className="font-medium">{fmtDate(detail.scheduledFor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Začetek</dt><dd className="font-medium">{fmtDateTime(detail.startedAt)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Zaključek</dt><dd className="font-medium">{fmtDateTime(detail.completedAt)}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-muted-foreground">Lokacija</dt><dd className="font-medium">{detail.project?.address ?? '—'}</dd></div>
        {detail.summary ? <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-muted-foreground">Povzetek</dt><dd className="font-medium">{detail.summary}</dd></div> : null}
      </dl>

      {/* terenski tok */}
      {canTransition && actions.length > 0 ? (
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
          <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {detail.measurements.map((m) => (
              <li key={m.id} className="rounded-lg border p-2.5 text-sm">
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

// ─── nov nalog ───────────────────────────────────────────────────────────────

function CreateNalogDialog ({ open, canReadUsers, onClose, onCreated }: {
  open: boolean
  canReadUsers: boolean
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('none')
  const [assigneeId, setAssigneeId] = useState('none')
  const [assigneeName, setAssigneeName] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [busy, setBusy] = useState(false)

  // izbirnike naložimo šele ob odprtju dialoga
  const projects = useApi<{ data: { id: string; code: string; title: string }[] }>(open ? '/api/projects' : null, [open])
  const users = useApi<{ data: { id: string; name: string; role: string }[] }>(open && canReadUsers ? '/api/users' : null, [open, canReadUsers])

  async function submit () {
    if (!title.trim()) {
      toast({ title: 'Naslov naloga je obvezen.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost('/api/nalog', {
        title: title.trim(),
        projectId: projectId === 'none' ? null : projectId,
        assigneeId: canReadUsers && assigneeId !== 'none' ? assigneeId : null,
        scheduledFor: scheduledFor || null,
      })
      toast({ title: 'Nalog ustvarjen.', description: `${title.trim()} — kodo je določil sistem.` })
      setTitle(''); setProjectId('none'); setAssigneeId('none'); setAssigneeName(''); setScheduledFor('')
      await onCreated()
    } catch (e) {
      toast({ title: 'Napaka pri ustvarjanju naloga', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nov nalog</DialogTitle>
        <DialogDescription>
          Kodo (N-letno-številka) določi sistem. Nalog se nato vodi skozi terenski tok.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="nn-title">Naslov</Label>
          <Input id="nn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="npr. Zajem meritev — stopnišče" />
        </div>

        <div className="space-y-2">
          <Label>Projekt</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger aria-label="Projekt"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="none">Brez projekta</SelectItem>
              {(projects.data?.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ErrorBox error={projects.error} />
        </div>

        {canReadUsers ? (
          <div className="space-y-2">
            <Label>Izvajalec</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger aria-label="Izvajalec"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">Ni dodeljen</SelectItem>
                {(users.data?.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="nn-assignee">Izvajalec (ime)</Label>
            <Input
              id="nn-assignee" value={assigneeName} onChange={(e) => setAssigneeName(e.target.value)}
              placeholder="Ime izvajalca …"
              aria-describedby="nn-assignee-hint"
            />
            <p id="nn-assignee-hint" className="text-xs text-muted-foreground">
              Brez pravice users.read izvajalca ni mogoče povezati z uporabniškim računom.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="nn-date">Termin</Label>
          <Input id="nn-date" type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Ustvarjam…' : 'Ustvari nalog'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

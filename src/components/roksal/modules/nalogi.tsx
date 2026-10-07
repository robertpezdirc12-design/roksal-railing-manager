'use client'

// NALOGI — osrednji center delovnih nalogov (vrata nalog.read)
// Filtri (scope/status/iskanje) + seznam + podrobnost s časovnico dogodkov in meritvami
// + terenski tok (nalog.transition) + nov nalog (nalog.write)
// R439 (issue #6): offline — predpomnjeni nalogi + pas Brez povezave + razdelek
// Offline dejanja (vrsta: hitra meritev / opomba / status / zaključek — delujejo
// tudi online, vrsta se takoj sinhronizira).
// R445 (issue #7 §9): ekipa/podizvajalec na nalogu — prikaz v seznamu in podrobnosti,
// dodelitev samo za pisarno (ADMIN/VODJA — strežnik: managesAssignments, revizija WO_CREW_ASSIGN).

import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock, Camera, CheckCheck, CheckCircle2, ClipboardList, History, Loader2, MapPin, MessageSquare,
  Play, Plus, Ruler, Search, User, UserPlus, Users, WifiOff,
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
import { apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { cacheNalogi, getCachedNalogi, queueOp, syncNow, useOnline, type OfflineOpKind } from '@/lib/offline'

interface WorkOrderRow {
  id: string; code: string; title: string; status: string
  scheduledFor: string | null; startedAt: string | null; completedAt: string | null; summary: string | null
  project: { code: string; title: string; address: string | null; customer: { name: string } | null } | null
  assignee: { name: string } | null
  crew: { name: string; type: string } | null // R445: ekipa/podizvajalec na nalogu
  _count: { measurements: number; events: number }
}

interface WorkOrderDetail extends Omit<WorkOrderRow, 'assignee' | '_count'> {
  assignee: { id: string; name: string } | null
  crew: { id: string; name: string; type: string } | null // R445: ekipa na nalogu (id za predizbiro)
  instructions: string | null
  projectId: string | null
  events: { id: string; type: string; note: string | null; createdAt: string; user: { name: string } | null }[]
  measurements: {
    id: string; type: string; location: string | null; lengthCm: number | null
    heightCm: number | null; posts: number | null; slopeDeg: number | null; note: string | null; createdAt: string
  }[]
}

interface HistoryRow {
  id: string; type: string; note: string | null; createdAt: string
  user: { name: string } | null
  workOrder: { code: string; status: string; project: { code: string; customer: { name: string } | null } | null }
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
  OPOMBA: { label: 'Opomba', icon: MessageSquare, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' }, // R439: sync op nalog-opomba
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
  const [selectedRow, setSelectedRow] = useState<WorkOrderRow | null>(null) // R439: offline fallback podrobnosti
  const [createOpen, setCreateOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  // R439 (issue #6): stanje signala (useSyncExternalStore) + predpomnjeni nalogi
  const online = useOnline()
  const [cached, setCached] = useState<{ savedAt: string; list: WorkOrderRow[] } | null>(null)

  useEffect(() => {
    void getCachedNalogi<WorkOrderRow>().then((c) => { if (c) setCached(c) }).catch(() => {})
  }, [])

  // R439: ob izgubi signala dohiti predpomnilnik — zapis lahko pride PO mountu
  // (fetch + cacheNalogi medtem uspela, stanje 'cached' pa je še null)
  useEffect(() => {
    if (!online) {
      void getCachedNalogi<WorkOrderRow>().then((c) => { if (c) setCached(c) }).catch(() => {})
    }
  }, [online])

  const list = useApi<{ data: WorkOrderRow[] }>(
    `/api/nalog?scope=${scope}${status !== 'all' ? `&status=${status}` : ''}`,
    [scope, status]
  )
  const detail = useApi<{ data: WorkOrderDetail }>(selected ? `/api/nalog/${selected}` : null, [selected])
  const history = useApi<{ data: HistoryRow[] }>(historyOpen ? '/api/nalog/zgodovina?take=30' : null, [historyOpen])

  const canWrite = hasPerm(user?.perms, 'nalog.write')
  const canTransition = hasPerm(user?.perms, 'nalog.transition')

  // ob uspešnem fetchu VEDNO predpomni (R439 — offline seznam nalogov); stanje
  // 'cached' se osveži ASINHRONO (ob mountu in ob preklopu na offline — pravilo
  // react-hooks/set-state-in-effect: v effectu ni sinkronega setState)
  useEffect(() => {
    if (list.data?.data) void cacheNalogi(list.data.data).catch(() => {})
  }, [list.data])

  // iskanje po kodi/naslovu (odjemalec stranke kot bonus); offline → predpomnjeni
  const rows = useMemo(() => {
    const all = online ? (list.data?.data ?? []) : (cached?.list ?? [])
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    return all.filter((w) =>
      w.code.toLowerCase().includes(needle) ||
      w.title.toLowerCase().includes(needle) ||
      (w.project?.customer?.name ?? '').toLowerCase().includes(needle)
    )
  }, [list.data, q, online, cached])

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
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}>
              <History className="size-4" aria-hidden /> Zgodovina
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden /> Nov nalog
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}>
            <History className="size-4" aria-hidden /> Zgodovina
          </Button>
        )}
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

      {/* R439 (issue #6): pas Brez povezave — predpomnjeni nalogi */}
      {!online ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span>
            Brez povezave — prikazani predpomnjeni nalogi
            {cached ? <span className="font-normal"> (shranjeno {fmtDateTime(cached.savedAt)})</span> : null}.
            Spremembe se shranjujejo lokalno in se samodejno sinhronizirajo.
          </span>
        </div>
      ) : null}

      <ErrorBox error={online ? list.error : null} />
      {online && list.loading ? <LoadingRows /> : rows.length === 0 ? (
        !online ? (
          <EmptyState title="Ni predpomnjenih nalogov" desc="Nalogi se predpomnijo ob prvem uspešnem nalaganju s povezavo." icon={WifiOff} />
        ) : !list.error ? (
          <EmptyState title="Ni nalogov" desc="Poskusite spremeniti obseg, status ali iskalni niz." icon={ClipboardList} />
        ) : null
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((wo) => (
            <li key={wo.id}>
              <button type="button" className="w-full text-left" onClick={() => { setSelected(wo.id); setSelectedRow(wo) }} aria-label={`Odpri nalog ${wo.code}`}>
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
                      {wo.crew ? (
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" aria-hidden />
                          <span className={wo.crew.type === 'PODIZVAJALEC' ? 'font-semibold text-amber-600 dark:text-amber-400' : 'font-semibold'}>{wo.crew.name}</span>
                          <span className="text-muted-foreground/70">({wo.crew.type === 'PODIZVAJALEC' ? 'podizvajalec' : 'interna'})</span>
                        </span>
                      ) : null}
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

      {/* globalna zgodovina dogodkov — R434 (/api/nalog/zgodovina) */}
      {historyOpen ? (
        <section aria-label="Zgodovina dogodkov vseh nalogov">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Zgodovina dogodkov {user?.role === 'MONTER' ? '(moji nalogi)' : '(vsi nalogi)'}
          </h3>
          <ErrorBox error={history.error} />
          {history.loading ? <LoadingRows rows={3} /> : !history.error && (history.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Ni dogodkov.</p>
          ) : !history.error ? (
            <Card>
              <CardContent className="max-h-96 overflow-y-auto p-0">
                <ul className="divide-y">
                  {(history.data?.data ?? []).map((ev) => {
                    const meta = EVENT_META[ev.type] ?? { label: ev.type, icon: MessageSquare, cls: 'bg-secondary text-secondary-foreground' }
                    const Icon = meta.icon
                    return (
                      <li key={ev.id} className="flex items-start gap-3 p-3">
                        <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', meta.cls)}>
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                            <span className="font-mono text-xs font-semibold text-roksal-amber">{ev.workOrder.code}</span>
                            <span className="font-medium">{meta.label}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {ev.note ?? '—'} · {ev.user?.name ?? 'sistem'} · {fmtDateTime(ev.createdAt)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {ev.workOrder.project ? `${ev.workOrder.project.code} · ${ev.workOrder.project.customer?.name ?? '—'}` : 'Brez projekta'}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </section>
      ) : null}

      {/* podrobnost naloga */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setSelectedRow(null) } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {/* dostopnost: naslov+opis tudi med nalaganjem/napako (Radix zahteva DialogTitle) */}
          {detail.loading || !detail.data ? (
            <>
              <DialogTitle className="sr-only">Delovni nalog</DialogTitle>
              <DialogDescription className="sr-only">Podrobnosti delovnega naloga.</DialogDescription>
            </>
          ) : null}
          {detail.loading ? <LoadingRows rows={3} /> : detail.data ? (
            <NalogDetail
              detail={detail.data.data}
              canTransition={canTransition}
              canReschedule={hasPerm(user?.perms, 'nalog.write')}
              canAssignCrew={user?.role === 'ADMIN' || user?.role === 'VODJA'}
              onTransition={transition}
              onRescheduled={async () => { await detail.reload() }}
              onCrewChanged={async () => { await Promise.all([detail.reload(), list.reload()]) }}
            />
          ) : (!online && selectedRow) ? (
            /* R439: offline — degraded podrobnost iz predpomnjene vrstice (Offline dejanja delujejo) */
            <NalogDetail
              detail={rowToDetail(selectedRow)}
              offline
              canTransition={canTransition}
              canReschedule={false}
              onTransition={transition}
              onRescheduled={async () => {}}
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

/** R439: degraded podrobnost iz predpomnjene vrstice (offline — brez časovnike/meritev). */
function rowToDetail (wo: WorkOrderRow): WorkOrderDetail {
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

function NalogDetail ({ detail, offline = false, canTransition, canReschedule, canAssignCrew = false, onTransition, onRescheduled, onCrewChanged }: {
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
          <span className="font-mono text-xs font-semibold text-roksal-amber">{detail.code}</span>
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
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${step.done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'}`} aria-hidden>
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

// ─── R439 (issue #6): OFFLINE DEJANJA — vrsta operacij (deluje tudi online) ──
// Hitra meritev / opomba / sprememba statusa / zaključek terena. Vsako dejanje
// gre v IndexedDB vrsto (queueOp) → toast 'Shranjeno lokalno'; če je signal na
// voljo, se vrsta TAKOJ poskusi sinhronizirati (syncNow).

function OfflineActionsSection ({ wo }: { wo: { id: string; code: string; status: string } }) {
  const { toast } = useToast()
  const [mType, setMType] = useState('OGRAJA')
  const [mLen, setMLen] = useState('')
  const [mHeight, setMHeight] = useState('')
  const [mNote, setMNote] = useState('')
  const [opomba, setOpomba] = useState('')
  const [statusTo, setStatusTo] = useState('')
  // R439: števec remounta izbire statusa — Radix Select po ponastavitvi (value='')
  // še vedno prikaže prejšnjo izbiro IN ne znova sproži onValueChange ob ponovnem
  // kliku iste vrednosti; key-remount vrne svež prikaz (placeholder) in delujočo izbiro
  const [statusKey, setStatusKey] = useState(0)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)

  const nextStatuses = TRANSITIONS.filter((t) => t.from.includes(wo.status))
  const canFinish = wo.status !== 'ZAKLJUCEN'

  async function enqueue (kind: OfflineOpKind, payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    try {
      await queueOp(kind, payload)
      toast({
        title: 'Shranjeno lokalno',
        description: 'Sinhroniziralo se bo samodejno — takoj, ko bo povezava na voljo.',
      })
      // gumbi delujejo TUDI online: vrsto takoj pošljimo na strežnik
      if (navigator.onLine) void syncNow()
      return true
    } catch (e) {
      toast({
        title: 'Shranjevanje v vrsto ni uspelo',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function quickMeasurement (): Promise<void> {
    const len = Number(mLen.replace(',', '.'))
    if (!(len > 0)) {
      toast({ title: 'Vnesite dolžino meritve (cm).', variant: 'destructive' })
      return
    }
    const h = Number(mHeight.replace(',', '.'))
    const ok = await enqueue('meritev', {
      workOrderId: wo.id,
      type: mType,
      lengthCm: len,
      heightCm: h > 0 ? h : null,
      note: mNote.trim() || null,
    })
    if (ok) { setMLen(''); setMHeight(''); setMNote('') }
  }

  async function addOpomba (): Promise<void> {
    if (!opomba.trim()) {
      toast({ title: 'Vnesite besedilo opombe.', variant: 'destructive' })
      return
    }
    const ok = await enqueue('nalog-opomba', { workOrderId: wo.id, note: opomba.trim() })
    if (ok) setOpomba('')
  }

  async function changeStatus (): Promise<void> {
    if (!statusTo) {
      toast({ title: 'Izberite nov status.', variant: 'destructive' })
      return
    }
    const ok = await enqueue('nalog-status', { workOrderId: wo.id, to: statusTo })
    if (ok) { setStatusTo(''); setStatusKey((k) => k + 1) }
  }

  async function finishWo (): Promise<void> {
    if (!summary.trim()) {
      toast({ title: 'Vnesite povzetek zaključka terena.', variant: 'destructive' })
      return
    }
    const ok = await enqueue('nalog-zakljucek', { workOrderId: wo.id, summary: summary.trim() })
    if (ok) setSummary('')
  }

  return (
    <section aria-label="Offline dejanja" className="space-y-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-amber-800 dark:text-amber-300">Offline dejanja</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Dejanja se shranijo lokalno in se samodejno sinhronizirajo — tudi takoj, če je signal na voljo.
        </p>
      </div>

      {/* hitra meritev */}
      <div className="space-y-2 rounded-lg border bg-card p-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Ruler className="size-4 text-roksal-amber" aria-hidden /> Hitra meritev</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor={`oa-tip-${wo.id}`} className="text-xs text-muted-foreground">Tip</Label>
            <Select value={mType} onValueChange={setMType}>
              <SelectTrigger id={`oa-tip-${wo.id}`} className="h-9" aria-label="Tip meritve"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OGRAJA">Ograja</SelectItem>
                <SelectItem value="BALUSTRADA">Balustrada</SelectItem>
                <SelectItem value="NAGIB">Nagib</SelectItem>
                <SelectItem value="OSTANEO">Ostalo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`oa-len-${wo.id}`} className="text-xs text-muted-foreground">Dolžina (cm)</Label>
            <Input
              id={`oa-len-${wo.id}`} type="number" min="1" inputMode="numeric" value={mLen}
              onChange={(e) => setMLen(e.target.value)} placeholder="npr. 350" className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`oa-h-${wo.id}`} className="text-xs text-muted-foreground">Višina (cm)</Label>
            <Input
              id={`oa-h-${wo.id}`} type="number" min="0" inputMode="numeric" value={mHeight}
              onChange={(e) => setMHeight(e.target.value)} placeholder="npr. 100" className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`oa-note-${wo.id}`} className="text-xs text-muted-foreground">Opomba</Label>
            <Input
              id={`oa-note-${wo.id}`} value={mNote} onChange={(e) => setMNote(e.target.value)}
              placeholder="opomba …" className="h-9"
            />
          </div>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void quickMeasurement()}>
          <Ruler className="size-4" aria-hidden /> Shrani meritev v vrsto
        </Button>
      </div>

      {/* opomba */}
      <div className="space-y-2 rounded-lg border bg-card p-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="size-4 text-roksal-amber" aria-hidden /> Opomba naloga</p>
        <Textarea
          value={opomba} onChange={(e) => setOpomba(e.target.value)}
          placeholder="Opomba za pisarno / vodjo …" aria-label="Opomba naloga" className="min-h-14"
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void addOpomba()}>
          <MessageSquare className="size-4" aria-hidden /> Dodaj opombo v vrsto
        </Button>
      </div>

      {/* sprememba statusa */}
      {nextStatuses.length > 0 ? (
        <div className="space-y-2 rounded-lg border bg-card p-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Play className="size-4 text-roksal-amber" aria-hidden /> Sprememba statusa</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid flex-1 gap-1 sm:max-w-64">
              <Label htmlFor={`oa-status-${wo.id}`} className="text-xs text-muted-foreground">Nov status</Label>
              {/* R439: VEDNO kontroliran value (ne `|| undefined` — Radix prehaja
                  med nekontroliran/kontroliran in ob ponastitvi obdrži staro izbiro);
                  key-remount ob ponastavitvi dodatno zagotovi svež prikaz */}
              <Select key={statusKey} value={statusTo} onValueChange={setStatusTo}>
                <SelectTrigger id={`oa-status-${wo.id}`} className="h-9" aria-label="Nov status naloga">
                  <SelectValue placeholder="izberi …" />
                </SelectTrigger>
                <SelectContent>
                  {nextStatuses.map((s) => <SelectItem key={s.to} value={s.to}>{s.label} → {s.to}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" className="h-9" disabled={busy || !statusTo} onClick={() => void changeStatus()}>
              <Play className="size-4" aria-hidden /> Shrani prehod v vrsto
            </Button>
          </div>
        </div>
      ) : null}

      {/* zaključek terena */}
      {canFinish ? (
        <div className="space-y-2 rounded-lg border bg-card p-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><CheckCheck className="size-4 text-roksal-amber" aria-hidden /> Zaključek terena</p>
          <Textarea
            value={summary} onChange={(e) => setSummary(e.target.value)}
            placeholder="Povzetek opravljenih del …" aria-label="Povzetek zaključka terena" className="min-h-14"
          />
          <p className="text-[11px] text-muted-foreground">
            Veljaven prehod iz statusa V preveri — če je nalog niže v toku, uvrstite prehode v vrsto po vrsti.
          </p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void finishWo()}>
            <CheckCheck className="size-4" aria-hidden /> Zaključi teren (v vrsto)
          </Button>
        </div>
      ) : null}
    </section>
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
  const [instructions, setInstructions] = useState('')
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
        instructions: instructions.trim() || null,
      })
      toast({ title: 'Nalog ustvarjen.', description: `${title.trim()} — kodo je določil sistem.` })
      setTitle(''); setProjectId('none'); setAssigneeId('none'); setAssigneeName(''); setScheduledFor(''); setInstructions('')
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

        <div className="space-y-2">
          <Label htmlFor="nn-instructions">Navodila za monterja</Label>
          <Textarea
            id="nn-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder="npr. Pokliči stranko 30 min pred prihodom. Stopnišče ima 14 stopnic — izmeri višino in nagib. Pri vhodu pazi na ploščice."
            className="min-h-20"
          />
          <p className="text-xs text-muted-foreground">Navodila se pokažejo monterju v podrobnosti naloga.</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Ustvarjam…' : 'Ustvari nalog'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

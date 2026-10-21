'use client'

// NALOGI — osrednji center delovnih nalogov (vrata nalog.read)
// Filtri (scope/status/iskanje) + seznam + podrobnost s časovnico dogodkov in meritvami
// + terenski tok (nalog.transition) + nov nalog (nalog.write)
// R439 (issue #6): offline — predpomnjeni nalogi + pas Brez povezave + razdelek
// Offline dejanja (vrsta: hitra meritev / opomba / status / zaključek — delujejo
// tudi online, vrsta se takoj sinhronizira).
// R445 (issue #7 §9): ekipa/podizvajalec na nalogu — prikaz v seznamu in podrobnosti,
// dodelitev samo za pisarno (ADMIN/VODJA — strežnik: managesAssignments, revizija WO_CREW_ASSIGN).
// R548: razbitje po vzorcu R546/R547 — lupina drži filtre/seznam/razširitve,
// gradniki (shared/detail/offline/create) živijo v sosednjih datotekah.

import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardList, History, Loader2, MapPin, MessageSquare, Ruler,
  Plus, Search, User, Users, WifiOff,
} from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { haptic } from '@/lib/haptics'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { cacheNalogi, getCachedNalogi, useOnline } from '@/lib/offline'
import {
  type HistoryRow, type WorkOrderDetail, type WorkOrderRow,
  EVENT_META, SCOPES, STATUSES,
} from './nalogi-shared'
import { NalogDetail, rowToDetail } from './nalogi-detail'
import { CreateNalogDialog } from './nalogi-create'

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
        <AnimatedList className="grid gap-3 md:grid-cols-2" data-tour="nalogi-list">
          {rows.map((wo) => (
            <AnimatedListItem key={wo.id}>
            <li>
              <button type="button" className="w-full text-left" onClick={() => { haptic("light"); setSelected(wo.id); setSelectedRow(wo) }} aria-label={`Odpri nalog ${wo.code}`}>
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
            </AnimatedListItem>
          ))}
        </AnimatedList>
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

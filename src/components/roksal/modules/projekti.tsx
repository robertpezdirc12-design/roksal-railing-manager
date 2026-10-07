'use client'

// PROJEKTI — seznam + podrobnost (vrata projects.read)

import { useMemo, useState } from 'react'
import { FolderKanban, HardHat, History, MapPin, Plus, Ruler, Search, FileText, Banknote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPost, fmtDate, fmtDateTime, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface ProjectRow {
  id: string; code: string; title: string; status: string; address: string | null; createdAt: string
  customer: { name: string; city: string | null } | null
  _count: { workOrders: number; quotes: number; measurements: number }
}

interface ProjectDetail extends ProjectRow {
  note: string | null
  customer: { name: string; city: string | null; email: string | null; phone: string | null } | null
  quotes: { id: string; code: string; status: string; total: number }[]
  workOrders: { id: string; code: string; title: string; status: string; scheduledFor: string | null; assignee: { name: string } | null }[]
  measurements: { id: string; type: string; location: string | null; lengthCm: number | null; createdAt: string }[]
  invoices: { id: string; code: string; status: string; total: number; paid: number }[]
}

const STATUSES = [
  { value: 'NACRT', label: 'Načrt' },
  { value: 'AKTIVNI', label: 'Aktivni' },
  { value: 'TEREN', label: 'Na terenu' },
  { value: 'ZAKLJUCEN', label: 'Zaključen' },
  { value: 'ARHIV', label: 'Arhiv' },
]

export default function ProjektiModule () {
  const user = useAppStore((s) => s.user)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const list = useApi<{ data: ProjectRow[] }>(
    `/api/projects?q=${encodeURIComponent(q)}${status !== 'all' ? `&status=${status}` : ''}`,
    [q, status]
  )
  const detail = useApi<{ data: ProjectDetail }>(selected ? `/api/projects/${selected}` : null, [selected])
  const customers = useApi<{ data: { id: string; name: string }[] }>(createOpen ? '/api/customers?limit=200' : null, [createOpen])

  const canWrite = hasPerm(user?.perms, 'projects.write')
  const rows = useMemo(() => list.data?.data ?? [], [list.data])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projekti" desc="Vsi projekti z statusi"
        actions={canWrite ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden /> Nov projekt</Button> : null}
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči po naslovu, kodi, stranki …" className="pl-8" aria-label="Iskanje projektov" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36" aria-label="Filter statusa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni projektov" desc="Poskusite spremeniti filter ali iskalni niz." icon={FolderKanban} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full text-left" onClick={() => setSelected(p.id)} aria-label={`Odpri projekt ${p.code}`}>
                <Card className="transition hover:border-roksal-amber/60 hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-roksal-amber">{p.code}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-1.5 font-semibold leading-snug">{p.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{p.customer?.name ?? 'Brez stranke'}</span>
                      {p.address ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{p.address}</span> : null}
                    </div>
                    <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><HardHat className="size-3" aria-hidden />{p._count.workOrders}</span>
                      <span className="inline-flex items-center gap-1"><FileText className="size-3" aria-hidden />{p._count.quotes}</span>
                      <span className="inline-flex items-center gap-1"><Ruler className="size-3" aria-hidden />{p._count.measurements}</span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* podrobnost */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {/* dostopnost: naslov+opis tudi med nalaganjem/napako (Radix zahteva DialogTitle) */}
          {detail.loading || !detail.data ? (
            <>
              <DialogTitle className="sr-only">Projekt</DialogTitle>
              <DialogDescription className="sr-only">Podrobnosti projekta.</DialogDescription>
            </>
          ) : null}
          {detail.loading ? <LoadingRows rows={3} /> : detail.data ? (
            <ProjectDetailDialog detail={detail.data.data} />
          ) : <ErrorBox error={detail.error} />}
        </DialogContent>
      </Dialog>

      {/* nov projekt */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <CreateProjectDialog
          customers={customers.data?.data ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await list.reload() }}
        />
      </Dialog>
    </div>
  )
}

function ProjectDetailDialog ({ detail }: { detail: ProjectDetail }) {
  const [timelineOpen, setTimelineOpen] = useState(false)
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-roksal-amber">{detail.code}</span>
          <StatusBadge status={detail.status} />
          <Button
            variant="outline" size="sm" className="ml-auto h-7 gap-1.5 px-2 text-xs"
            onClick={() => setTimelineOpen(true)}
          >
            <History className="size-3.5" aria-hidden /> Zgodovina
          </Button>
        </div>
        <DialogTitle>{detail.title}</DialogTitle>
        <DialogDescription>
          {detail.customer?.name ?? 'Brez stranke'}
          {detail.address ? ` · ${detail.address}` : ''} · ustvarjeno {fmtDate(detail.createdAt)}
        </DialogDescription>
      </DialogHeader>

      {detail.note ? <p className="rounded-lg bg-secondary/60 p-3 text-sm">{detail.note}</p> : null}

      <div className="space-y-4">
        <section aria-label="Ponudbe">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Ponudbe</h3>
          {detail.quotes.length === 0 ? <p className="text-sm text-muted-foreground">Ni ponudb.</p> : (
            <ul className="space-y-1">
              {detail.quotes.map((qq) => (
                <li key={qq.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="font-mono text-xs">{qq.code}</span>
                  <StatusBadge status={qq.status} />
                  <span className="font-semibold">{fmtEUR(qq.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Računi">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Računi</h3>
          {detail.invoices.length === 0 ? <p className="text-sm text-muted-foreground">Ni računov.</p> : (
            <ul className="space-y-1">
              {detail.invoices.map((iv) => (
                <li key={iv.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="inline-flex items-center gap-2 font-mono text-xs"><Banknote className="size-3.5" aria-hidden />{iv.code}</span>
                  <StatusBadge status={iv.status} />
                  <span className="font-semibold">{fmtEUR(iv.total)} <span className="text-xs font-normal text-muted-foreground">(plačano {fmtEUR(iv.paid)})</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Nalogi">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Nalogi</h3>
          {detail.workOrders.length === 0 ? <p className="text-sm text-muted-foreground">Ni nalogov.</p> : (
            <ul className="space-y-1">
              {detail.workOrders.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="min-w-0 truncate"><span className="font-mono text-xs">{w.code}</span> {w.title}</span>
                  <StatusBadge status={w.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Meritve">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Meritve</h3>
          {detail.measurements.length === 0 ? <p className="text-sm text-muted-foreground">Ni meritev.</p> : (
            <ul className="space-y-1">
              {detail.measurements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="min-w-0 truncate">{m.location ?? m.type}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {m.lengthCm ? `${(m.lengthCm / 100).toFixed(2)} m` : '—'} · {fmtDate(m.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* kronološka zgodovina projekta (R433: /api/projects/[id]/timeline) */}
      <Dialog open={timelineOpen} onOpenChange={setTimelineOpen}>
        <TimelineDialog projectId={detail.id} code={detail.code} />
      </Dialog>
    </>
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

function TimelineDialog ({ projectId, code }: { projectId: string; code: string }) {
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

function CreateProjectDialog ({ customers, onClose, onCreated }: {
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

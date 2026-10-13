'use client'

// PROJEKTI — seznam + podrobnost (vrata projects.read)
// R434: garancija projekta — sklop v podrobnosti (/api/warranty, obiski).
// R435: portal stranke — povezave + predogled javnega pogleda (/api/portal, /api/public/portal).
// R436: 3D predogled — zadnja shranjena konfiguracija iz zavihka Vizualizacija.

import { useMemo, useRef, useState } from 'react'
import { Box, CalendarCheck, ClipboardList, Copy, ExternalLink, Eye, FolderKanban, HardHat, History, Layers, Link2, Loader2, MapPin, Package, Plus, Ruler, Scale, Search, FileDown, FileText, Banknote, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiDelete, apiPatch, apiPost, fmtDate, fmtDateTime, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { TIER_ORDER, tierLabel } from '@/lib/quote-core'
import { Railing3D, TIP_LABELS, parseKonfigurator, ralHex, ralLabel } from './viz-3d'

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
  measurements: {
    id: string; type: string; location: string | null; lengthCm: number | null
    heightCm: number | null; posts: number | null; handrail: boolean | null
    slopeDeg: number | null; params: string | null; createdAt: string
  }[]
  invoices: { id: string; code: string; status: string; total: number; paid: number }[]
}

interface WarrantyRow {
  id: string; startsAt: string; months: number; status: string; note: string | null; endsAt: string
  valid: boolean
  nextVisit: { id: string; date: string; note: string | null } | null
  visits: { id: string; date: string; note: string | null }[]
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
  const setTab = useAppStore((s) => s.setTab)
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
            <ProjectDetailDialog detail={detail.data.data} onNavigate={(tab) => { setSelected(null); setTab(tab) }} />
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

function ProjectDetailDialog ({ detail, onNavigate }: { detail: ProjectDetail; onNavigate: (tab: string) => void }) {
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

      {/* R456 (issue #11 §3/§10): poslovni tok + NASLEDNJI KORAK — sistem vodi uporabnika */}
      <ProgressSection projectId={detail.id} onNavigate={onNavigate} />

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

        <KonfigPreviewSection measurements={detail.measurements} />

        <PackagesSection projectId={detail.id} projectCode={detail.code} measurements={detail.measurements} />

        <WarrantySection projectId={detail.id} projectStatus={detail.status} />
        <PortalSection projectId={detail.id} projectCode={detail.code} />
      </div>

      {/* kronološka zgodovina projekta (R433: /api/projects/[id]/timeline) */}
      <Dialog open={timelineOpen} onOpenChange={setTimelineOpen}>
        <TimelineDialog projectId={detail.id} code={detail.code} />
      </Dialog>
    </>
  )
}

/**
 * R456 (issue #11 §3/§10): POSLOVNI TOK PROJEKTA + NASLEDNJI KORAK.
 * 13 stopenj (POVPRAŠEVANJE → … → GARANCIJA) z vmesti/odprti stanjem,
 * odstotkom in CTA »NADALJUJ: …«, ki uporabnika odpelje na pravi modul —
 * uporabnik ne išče funkcije po menijih, sistem ve, kaj sledi.
 */
function ProgressSection ({ projectId, onNavigate }: { projectId: string; onNavigate: (tab: string) => void }) {
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

/** Portal stranke (R435) — povezave za javni pogled statusa + predogled. */
interface PortalLinkRow {
  id: string; token: string; note: string | null; views: number
  lastViewedAt: string | null; createdAt: string; expiresAt: string; revokedAt: string | null; active: boolean
}

function PortalSection ({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  // R496: seznam žetonov portala je pod portal.manage (strežnik vrata tudi
  // preverja) — odjemalec jih ne sme nabračati z vlogami brez te pravice.
  const canManage = hasPerm(user?.perms, 'portal.manage')
  const links = useApi<{ data: PortalLinkRow[] }>(canManage ? `/api/portal?projectId=${projectId}` : null, [projectId, canManage])
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canWrite = hasPerm(user?.perms, 'projects.write')
  const rows = links.data?.data ?? []
  const activeCount = rows.filter((l) => l.active).length

  async function createLink () {
    setBusy(true)
    try {
      await apiPost('/api/portal', { projectId, days: 90 })
      toast({ title: 'Povezava ustvarjena.', description: 'Velja 90 dni — kopirajte jo stranki.' })
      await links.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function revoke (id: string) {
    setBusy(true)
    try {
      await apiDelete(`/api/portal/${id}`)
      toast({ title: 'Povezava preklicana.', description: 'Javni dostop takoj preneha.' })
      await links.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function copyUrl (token: string) {
    const url = `${location.origin}/api/public/portal?token=${token}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'URL kopiran.', description: 'Varni javni pogled — brez internih podatkov.' })
    } catch {
      toast({ title: 'Kopiranje ni uspelo.', description: url, variant: 'destructive' })
    }
  }

  if (!canManage) return null

  return (
    <section aria-label="Portal stranke">
      <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Portal stranke</h3>
      <ErrorBox error={links.error} />
      {links.loading ? <LoadingRows rows={1} /> : !links.error ? (
        <div className="space-y-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-sm">
              <Link2 className="size-4 text-roksal-amber" aria-hidden />
              {activeCount > 0 ? `${activeCount} aktivna povezava` : 'Ni aktivnih povezav'}
              <span className="text-xs text-muted-foreground">— stranka vidi status, montažo in garancijo</span>
            </p>
            {canWrite ? (
              <Button size="sm" variant="outline" onClick={() => void createLink()} disabled={busy}>
                <Plus className="size-4" aria-hidden /> Nova povezava
              </Button>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {canWrite ? 'Ustvarite povezavo in jo pošljite stranki (e-pošta/SMS).' : 'Upravljanje zahteva pravico projects.write.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((l) => (
                <li key={l.id} className="rounded-lg border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">…{l.token.slice(-10)}</code>
                    {l.active ? (
                      <Badge className="border-transparent bg-emerald-700 text-white">velja</Badge>
                    ) : (
                      <Badge variant="secondary">{l.revokedAt ? 'preklicana' : 'potekla'}</Badge>
                    )}
                    <span className="ml-auto inline-flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Eye className="size-3" aria-hidden />{l.views}</span>
                      <span>do {fmtDate(l.expiresAt)}</span>
                    </span>
                  </div>
                  {l.note ? <p className="mt-1 truncate text-xs text-muted-foreground">{l.note}</p> : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setPreview(l.token)} disabled={!l.active}>
                      <ExternalLink className="size-3.5" aria-hidden /> Predogled
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => void copyUrl(l.token)}>
                      <Copy className="size-3.5" aria-hidden /> Kopiraj URL
                    </Button>
                    {canWrite && l.active ? (
                      <Button
                        size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => void revoke(l.id)} disabled={busy}
                      >
                        Prekliči
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* predogled javnega pogleda — natanko to, kar vidi stranka */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null) }}>
        <PortalPreviewDialog token={preview} code={projectCode} />
      </Dialog>
    </section>
  )
}

interface PortalPublicData {
  project: { code: string; title: string; statusLabel: string; address: string | null }
  customer: { name: string | null }
  timeline: { at: string; type: string; label: string }[]
  warranty: { endsAt: string; valid: boolean } | null
  photos: { location: string; photo: string; at: string }[]
  company: { name: string; phone: string; email: string; web: string }
  link: { expiresAt: string }
}

const PORTAL_TYPE_ICON: Record<string, string> = {
  ODPERTJE: '📂', PODPIS: '✍️', MONTAZA: '🔧', ZAKLJUCEK: '✅',
}

function PortalPreviewDialog ({ token, code }: { token: string | null; code: string }) {
  // javni endpoint — enak odgovor kot pri stranki (fetch brez avtorizacije je pravilen)
  const view = useApi<{ data: PortalPublicData }>(token ? `/api/public/portal?token=${token}` : null, [token])
  const d = view.data?.data

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Predogled portala — {code}</DialogTitle>
        <DialogDescription>Javni pogled, ki ga vidi stranka (brez zneskov in internih podatkov).</DialogDescription>
      </DialogHeader>
      <ErrorBox error={view.error} />
      {view.loading ? <LoadingRows rows={4} /> : d ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-gradient-to-br from-[#1d2b3e] to-[#2a3f5f] p-4 text-primary-foreground">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs opacity-80">{d.project.code}</span>
              <span className="rounded-full bg-roksal-amber px-2 py-0.5 text-[11px] font-bold text-roksal-ink">{d.project.statusLabel}</span>
            </div>
            <h4 className="mt-1.5 text-lg font-bold leading-snug">{d.project.title}</h4>
            {d.project.address ? <p className="mt-0.5 inline-flex items-center gap-1 text-xs opacity-90"><MapPin className="size-3" aria-hidden />{d.project.address}</p> : null}
            {d.customer.name ? <p className="mt-0.5 text-xs opacity-75">{d.customer.name}</p> : null}
          </div>

          <section aria-label="Zgodovina za stranko">
            <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Potek dela</h5>
            <ol className="relative space-y-2 border-l pl-5">
              {d.timeline.map((e, i) => (
                <li key={`${e.at}-${i}`} className="relative">
                  <span className="absolute -left-[23px] top-1 size-2.5 rounded-full bg-roksal-amber" aria-hidden />
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{PORTAL_TYPE_ICON[e.type] ?? '•'} {e.label}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{fmtDate(e.at)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {d.warranty ? (
            <section aria-label="Garancija za stranko" className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className={cn('size-4', d.warranty.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')} aria-hidden />
                {d.warranty.valid ? 'Garancija velja' : 'Garancija je potekla'}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Veljavnost do {fmtDate(d.warranty.endsAt)}.</p>
            </section>
          ) : null}

          {d.photos.length > 0 ? (
            <section aria-label="Fotografije del">
              <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Zaključena dela</h5>
              <ul className="grid grid-cols-2 gap-2">
                {d.photos.map((p, i) => (
                  <li key={`${p.at}-${i}`} className="overflow-hidden rounded-lg border">
                    {/* stranki namenjena demonstracijska slika zaključenega dela (SVG) */}
                    <img src={p.photo} alt={p.location} className="aspect-video w-full object-cover" />
                    <p className="truncate px-2 py-1 text-[11px] text-muted-foreground">{p.location}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <footer className="rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{d.company.name}</span> · {d.company.phone} · {d.company.email} · {d.company.web}
            <p className="mt-1 text-[10px] opacity-70">Povezava velja do {fmtDate(d.link.expiresAt)}.</p>
          </footer>
        </div>
      ) : null}
    </DialogContent>
  )
}

/** 3D predogled (R436) — zadnja shranjena konfiguracija (params.konfigurator). */
function KonfigPreviewSection ({ measurements }: { measurements: ProjectDetail['measurements'] }) {
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
function WarrantySection ({ projectId, projectStatus }: { projectId: string; projectStatus: string }) {
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

/** Paketi projekta (R442 — issue #7 §3): projekt = več produktnih paketov.
 * Paket povezuje produkt, varianto, izmero, količino, status in (generirano) kosovnico. */

interface PackageRow {
  id: string; code: string; name: string; qty: number; unit: string
  status: string; note: string | null; calcJson: string | null
  tier: string | null; compareCode: string | null // R476: primerjalni paket
  createdAt: string
  product: { sku: string; name: string; unit: string; family: { code: string; name: string } }
  variant: { sku: string; name: string } | null
  measurement: { id: string; type: string; familyCode: string | null } | null
  bom: { id: string; code: string; status: string; lines: { id: string }[] } | null
}

interface PackageBomLine {
  itemId: string; sku: string; name: string; unit: string
  qty: number; note: string | null; covered: boolean; missing: number; stockQty: number
}

interface PackageCalc {
  generatedAt: string; qty: number; unit: string
  materialCost: number; montazaUnit: number; totalSale: number
  margin: number; marginPct: number; priceSource: string; lines: number
  segmentsApplied?: number // R475: segmentni režim kosovnice
  warnings?: { code: string; message: string }[]
}

const PACKAGE_STATUS_OPTIONS = [
  'POVPRAŠEVANJE', 'IZMERA', 'KONFIGURACIJA', 'PONUDBA', 'POTRJENO',
  'REZERVIRANO', 'V_IZDELAVI', 'DOSTAVLJENO', 'MONTIRANO', 'PREDANO',
]

function PackagesSection ({ projectId, projectCode, measurements }: {
  projectId: string
  projectCode: string
  measurements: { id: string; type: string; location: string | null; createdAt: string }[]
}) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const packages = useApi<{ data: PackageRow[] }>(`/api/project-packages?projectId=${projectId}`, [projectId])
  const [createOpen, setCreateOpen] = useState(false)
  const [bomView, setBomView] = useState<PackageRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const canManage = hasPerm(user?.perms, 'quotes.create')
  const rows = packages.data?.data ?? []
  const withBom = rows.filter((p) => p.bom).length

  // R476: primerjalne skupine (paketi z compareCode) — izris nad navadnim seznamom
  const compareGroups = useMemo(() => {
    const m = new Map<string, PackageRow[]>()
    for (const p of rows) {
      if (p.compareCode) m.set(p.compareCode, [...(m.get(p.compareCode) ?? []), p])
    }
    return [...m.entries()].map(([code, members]) => ({
      code,
      members: [...members].sort((a, b) => {
        const ia = a.tier ? TIER_ORDER.indexOf(a.tier as (typeof TIER_ORDER)[number]) : 99
        const ib = b.tier ? TIER_ORDER.indexOf(b.tier as (typeof TIER_ORDER)[number]) : 99
        return ia - ib
      }),
    }))
  }, [rows])
  const regularRows = useMemo(() => rows.filter((p) => !p.compareCode), [rows])

  async function generateBom (pkg: PackageRow) {
    setBusyId(pkg.id)
    try {
      const res = await apiPost<{ data: { bom: { code: string }; calc: PackageCalc } }>(`/api/project-packages/${pkg.id}/bom`, {})
      toast({
        title: 'Kosovnica generirana.',
        description: `${res.data.bom.code} · ${res.data.calc.lines} vrstic · marža ${res.data.calc.marginPct} %`,
      })
      await packages.reload()
    } catch (e) {
      toast({ title: 'Generiranje ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusyId(null) }
  }

  async function changeStatus (pkg: PackageRow, status: string) {
    setBusyId(pkg.id)
    try {
      await apiPatch(`/api/project-packages/${pkg.id}`, { status })
      toast({ title: 'Status paketa posodobljen.', description: `${pkg.code} → ${status}` })
      await packages.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusyId(null) }
  }

  return (
    <section aria-label="Produktni paketi projekta">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Produktni paketi</h3>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nov paket
          </Button>
        ) : null}
      </div>
      <ErrorBox error={packages.error} />
      {packages.loading ? <LoadingRows rows={1} /> : !packages.error ? (
        <div className="space-y-2 rounded-xl border p-3">
          <p className="inline-flex items-center gap-2 text-sm">
            <Layers className="size-4 text-roksal-amber" aria-hidden />
            {rows.length > 0 ? `${rows.length} paketov · ${withBom} s kosovnico${compareGroups.length ? ` · ${compareGroups.length} primerjav` : ''}` : 'Ni paketov'}
            <span className="text-xs text-muted-foreground">— vsak paket je ena rešitev (terasa, ograja, fasada …)</span>
          </p>

          {/* R476: primerjalne skupine — isti obseg v nivojih STANDARD/BOLJSI/PREMIUM */}
          {compareGroups.map((g) => (
            <CompareGroupCard
              key={g.code}
              group={g}
              canManage={canManage}
              busyId={busyId}
              onGenerateBom={generateBom}
              onStatus={changeStatus}
              onBomView={setBomView}
            />
          ))}

          {regularRows.length > 0 ? (
            <ul className="space-y-2">
              {regularRows.map((p) => (
                <li key={p.id} className="rounded-lg border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                    <StatusBadge status={p.status} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <span className="shrink-0 text-sm font-bold">{p.qty} <span className="text-xs font-normal text-muted-foreground">{p.unit}</span></span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{p.product.sku}</span>
                    {p.variant ? <span>· {p.variant.name}</span> : null}
                    {p.measurement ? <span>· izmera #{p.measurement.id.slice(-6)}</span> : null}
                    {p.bom ? (
                      <button
                        className="inline-flex items-center gap-1 font-medium text-roksal-amber hover:underline"
                        onClick={() => setBomView(p)}
                      >
                        <ClipboardList className="size-3" aria-hidden /> {p.bom.code} ({p.bom.lines.length})
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1"><ClipboardList className="size-3" aria-hidden /> brez kosovnice</span>
                    )}
                  </div>
                  {p.note ? <p className="mt-1 text-xs text-muted-foreground">{p.note}</p> : null}
                  {canManage ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void generateBom(p)} disabled={busyId === p.id}>
                        <ClipboardList className="size-3.5" aria-hidden /> {p.bom ? 'Ponovno generiraj BOM' : 'Generiraj BOM'}
                      </Button>
                      <Select value={p.status} onValueChange={(v) => void changeStatus(p, v)}>
                        <SelectTrigger className="h-7 w-40 text-xs" aria-label={`Status paketa ${p.code}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PACKAGE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {canManage ? 'Dodajte paket — npr. TERASA 36,4 m² + OGRAJA 18,6 m za isti projekt.' : 'Pakete ureja pisarna (quotes.create).'}
            </p>
          )}
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewPackageDialog
          projectId={projectId}
          projectCode={projectCode}
          measurements={measurements}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await packages.reload() }}
        />
      </Dialog>

      <Dialog open={!!bomView} onOpenChange={(o) => { if (!o) setBomView(null) }}>
        <PackageBomDialog pkg={bomView} />
      </Dialog>
    </section>
  )
}

// ── R476: primerjalna skupina paketov (isti obseg, več nivojev) ───────────────

/** Izračun iz calcJson (konfigurator { inputs, plan } ali BOM kalkulacija). */
function parsePkgSale (calcJson: string | null): { totalSale: number | null; marginPct: number | null } {
  if (!calcJson) return { totalSale: null, marginPct: null }
  try {
    const parsed = JSON.parse(calcJson) as {
      plan?: { totalSale?: number; marginPct?: number }
      totalSale?: number
      marginPct?: number
    }
    return {
      totalSale: typeof parsed.plan?.totalSale === 'number' ? parsed.plan.totalSale
        : typeof parsed.totalSale === 'number' ? parsed.totalSale : null,
      marginPct: typeof parsed.plan?.marginPct === 'number' ? parsed.plan.marginPct
        : typeof parsed.marginPct === 'number' ? parsed.marginPct : null,
    }
  } catch {
    return { totalSale: null, marginPct: null }
  }
}

function CompareGroupCard ({ group, canManage, busyId, onGenerateBom, onStatus, onBomView }: {
  group: { code: string; members: PackageRow[] }
  canManage: boolean
  busyId: string | null
  onGenerateBom: (pkg: PackageRow) => Promise<void>
  onStatus: (pkg: PackageRow, status: string) => Promise<void>
  onBomView: (pkg: PackageRow) => void
}) {
  // referenčni nivo = prvi z izračunano ceno (ponavadi STANDARD)
  const refSale = group.members
    .map((m) => parsePkgSale(m.calcJson).totalSale)
    .find((v): v is number => v != null && v > 0) ?? null

  return (
    <div className="space-y-2 rounded-xl border-2 border-amber-200 p-3 dark:border-amber-900/50">
      <div className="flex flex-wrap items-center gap-2">
        <Scale className="size-4 text-roksal-amber" aria-hidden />
        <span className="text-sm font-semibold">Primerjava {group.code}</span>
        <span className="text-xs text-muted-foreground">
          — isti obseg v {group.members.length} nivojih (STANDARD / BOLJŠI / PREMIUM)
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {group.members.map((p) => (
          <CompareTierCard
            key={p.id}
            pkg={p}
            refSale={refSale}
            canManage={canManage}
            busy={busyId === p.id}
            onGenerateBom={onGenerateBom}
            onStatus={onStatus}
            onBomView={onBomView}
          />
        ))}
      </div>
    </div>
  )
}

function CompareTierCard ({ pkg, refSale, canManage, busy, onGenerateBom, onStatus, onBomView }: {
  pkg: PackageRow
  refSale: number | null
  canManage: boolean
  busy: boolean
  onGenerateBom: (pkg: PackageRow) => Promise<void>
  onStatus: (pkg: PackageRow, status: string) => Promise<void>
  onBomView: (pkg: PackageRow) => void
}) {
  const { totalSale, marginPct } = useMemo(() => parsePkgSale(pkg.calcJson), [pkg.calcJson])
  const deltaPct = totalSale != null && refSale != null && refSale > 0
    ? Math.round(((totalSale - refSale) / refSale) * 100)
    : null

  return (
    <div className="space-y-1.5 rounded-lg border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {tierLabel(pkg.tier)}
        </span>
        <StatusBadge status={pkg.status} />
      </div>
      <p className="min-w-0 truncate text-sm font-medium" title={pkg.name}>{pkg.name}</p>
      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{pkg.product.sku}</span>
        {pkg.variant ? <span>· {pkg.variant.name}</span> : null}
        <span>· {pkg.qty} {pkg.unit}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">
          {totalSale != null ? fmtEUR(totalSale) : <span className="text-xs font-normal text-muted-foreground">brez izračuna</span>}
        </span>
        {deltaPct != null && deltaPct !== 0 ? (
          <span className={cn('text-xs font-semibold', deltaPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
            {deltaPct > 0 ? '+' : ''}{deltaPct} %
          </span>
        ) : null}
      </div>
      {marginPct != null ? (
        <p className="text-[11px] text-muted-foreground">marža {marginPct} % (interno)</p>
      ) : null}
      {pkg.bom ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-roksal-amber hover:underline"
          onClick={() => onBomView(pkg)}
        >
          <ClipboardList className="size-3" aria-hidden /> {pkg.bom.code} ({pkg.bom.lines.length})
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <ClipboardList className="size-3" aria-hidden /> brez kosovnice
        </span>
      )}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void onGenerateBom(pkg)} disabled={busy}>
            <ClipboardList className="size-3.5" aria-hidden /> {pkg.bom ? 'BOM' : 'Generiraj BOM'}
          </Button>
          <Select value={pkg.status} onValueChange={(v) => void onStatus(pkg, v)}>
            <SelectTrigger className="h-7 w-36 text-xs" aria-label={`Status paketa ${pkg.code}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {PACKAGE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}

function NewPackageDialog ({ projectId, projectCode, measurements, onClose, onCreated }: {
  projectId: string
  projectCode: string
  measurements: { id: string; type: string; location: string | null; createdAt: string }[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { toast } = useToast()
  const [family, setFamily] = useState('all')
  const [productId, setProductId] = useState('none')
  const [variantId, setVariantId] = useState('none')
  const [qty, setQty] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [measurementId, setMeasurementId] = useState('none')
  const [busy, setBusy] = useState(false)

  const families = useApi<{ data: { code: string; name: string }[] }>('/api/product-families')
  const products = useApi<{ data: { id: string; sku: string; name: string; unit: string; family: { code: string; name: string }; variants: { id: string; name: string }[] }[] }>(
    `/api/products?family=${family}`, [family]
  )

  const prodRows = products.data?.data ?? []
  const selected = prodRows.find((p) => p.id === productId) ?? null

  async function submit () {
    if (productId === 'none') { toast({ title: 'Izberite izdelek.', variant: 'destructive' }); return }
    const qv = Number(qty)
    if (!Number.isFinite(qv) || qv <= 0) { toast({ title: 'Količina mora biti pozitivno število.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/project-packages', {
        projectId, productId,
        variantId: variantId !== 'none' ? variantId : null,
        qty: qv, name: name.trim() || undefined, note: note.trim() || undefined,
        measurementId: measurementId !== 'none' ? measurementId : null,
      })
      toast({ title: 'Paket dodan.', description: `${projectCode} — ${selected?.name ?? ''}` })
      await onCreated()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Nov produktni paket</DialogTitle>
        <DialogDescription>{projectCode} — ena rešitev na projektu (terasa, ograja, fasada …).</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Družina</Label>
            <Select value={family} onValueChange={(v) => { setFamily(v); setProductId('none'); setVariantId('none') }}>
              <SelectTrigger aria-label="Družina"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vse družine</SelectItem>
                {(families.data?.data ?? []).map((f) => <SelectItem key={f.code} value={f.code}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="npk-qty">Količina</Label>
            <Input id="npk-qty" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={selected ? `npr. 36.4 (${selected.unit})` : 'npr. 36.4'} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Izdelek</Label>
          <Select value={productId} onValueChange={(v) => { setProductId(v); setVariantId('none') }}>
            <SelectTrigger aria-label="Izdelek"><SelectValue placeholder="Izberite izdelek" /></SelectTrigger>
            <SelectContent>
              {prodRows.map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {selected && selected.variants.length > 0 ? (
          <div className="space-y-2">
            <Label>Varianta</Label>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger aria-label="Varianta"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— osnovna —</SelectItem>
                {selected.variants.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="npk-name">Prikazno ime (neobvezno)</Label>
          <Input id="npk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={selected ? `npr. ${selected.family.name} — ${selected.name}` : 'npr. Terasa — WPC Grafit'} />
        </div>
        {measurements.length > 0 ? (
          <div className="space-y-2">
            <Label>Veži na izmero (neobvezno)</Label>
            <Select value={measurementId} onValueChange={setMeasurementId}>
              <SelectTrigger aria-label="Izmera"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— brez —</SelectItem>
                {measurements.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.location ?? m.type} · {fmtDate(m.createdAt)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="npk-note">Opomba (neobvezno)</Label>
          <Input id="npk-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. padec 1,5 % proti robu" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Dodajam …' : 'Dodaj paket'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

function PackageBomDialog ({ pkg }: { pkg: PackageRow | null }) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const [expBusy, setExpBusy] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importTick, setImportTick] = useState(0)

  // R477 (issue #9 §6): izvoz kosovnice — CSV (podpično, vejica, BOM) ali
  // XLSX (xlsx-mini) s preverjanji pravil pred izvozom (vidna opozorila)
  async function exportBom (format: 'csv' | 'xlsx'): Promise<void> {
    if (!pkg || !token) return
    setExpBusy(format)
    try {
      const res = await fetch(`/api/export/bom/${pkg.id}?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Napaka strežnika (${res.status}).`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kosovnica-${pkg.code}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      toast({ title: `Kosovnica izvožena (${format.toUpperCase()}).`, description: 'Datoteka je prenesena; opozorila pravil so zapisana v izvoz.' })
    } catch (e) {
      toast({
        title: 'Izvoz kosovnice ni uspel.',
        description: e instanceof Error ? e.message : 'Neznana napaka.',
        variant: 'destructive',
      })
    } finally {
      setExpBusy(null)
    }
  }

  const bom = useApi<{ data: { lines: { id: string; itemId: string; qty: number; unit: string; note: string | null; segmentKey: string | null; group: string | null; wastePct: number | null; sourceRule: string | null; item: { sku: string; name: string; unit: string; qty: number } }[]; product: { sku: string; name: string }; qty: number; unit: string; code: string; status: string } }>(
    pkg?.bom ? `/api/bom/${pkg.bom.id}` : null, [pkg?.bom?.id, importTick]
  )
  const d = bom.data?.data
  const calcJson = pkg?.calcJson
  const calc = useMemo<PackageCalc | null>(() => {
    if (!calcJson) return null
    try { return JSON.parse(calcJson) as PackageCalc } catch { return null }
  }, [calcJson])

  // R475: skupine pozicij (STEBRI → ROCNIK → POLNILO → brez) z sumo materiala
  const grouped = useMemo(() => {
    if (!d) return []
    const order = ['STEBRI', 'ROCNIK', 'POLNILO', 'OSTALO']
    const map = new Map<string, typeof d.lines>()
    for (const l of d.lines) {
      const g = l.group ?? 'OSTALO'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(l)
    }
    const labels: Record<string, string> = {
      STEBRI: 'Stebri in sidranje', ROCNIK: 'Ročnik in profili',
      POLNILO: 'Polnilo', OSTALO: 'Pripadnosti in obdelava',
    }
    return [...map.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([g, lines]) => ({
        key: g, label: labels[g] ?? g, lines,
        count: lines.length,
        segments: new Set(lines.map((l) => l.segmentKey).filter(Boolean)).size,
      }))
  }, [d])
  const segCount = calc && typeof (calc as { segmentsApplied?: number }).segmentsApplied === 'number'
    ? (calc as { segmentsApplied: number }).segmentsApplied
    : 0

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      {/* R475: min-w-0 na neposrednih otrocih grid dialoga — brez tega tabela
          (w-full → auto tirnica) razširi tirnico na max-content in vsebina
          na mobilnem gre čez rob dialoga (grid item min-width:auto). */}
      <DialogHeader className="min-w-0">
        <DialogTitle className="flex flex-wrap items-center gap-2">
          Kosovnica {pkg?.bom?.code ?? ''}
          {pkg ? <StatusBadge status={pkg.bom?.status ?? 'OSNUTEK'} /> : null}
        </DialogTitle>
        <DialogDescription>
          {pkg ? `${pkg.name} · ${pkg.qty} ${pkg.unit}` : ''}
          {d ? ` — ${d.product.sku} × ${d.qty} ${d.unit}` : ''}
        </DialogDescription>
      </DialogHeader>
      {pkg?.bom ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { void exportBom('csv') }} disabled={expBusy != null}>
            {expBusy === 'csv' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
            Izvozi CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => { void exportBom('xlsx') }} disabled={expBusy != null}>
            {expBusy === 'xlsx' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
            Izvozi XLSX
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-3.5" aria-hidden />
            Uvozi …
          </Button>
          <span className="text-[11px] text-muted-foreground">CSV: podpično, decimalna vejica (SI) · XLSX: kosovnica + sume + preverjanja</span>
        </div>
      ) : null}
      <ErrorBox error={bom.error} />
      {bom.loading ? <LoadingRows rows={3} /> : d ? (
        <div className="min-w-0 space-y-3">
          {calc ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border bg-secondary/30 p-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Material</div>
                <div className="text-sm font-bold">{fmtEUR(calc.materialCost)}</div>
              </div>
              <div className="rounded-lg border bg-secondary/30 p-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Prodaja</div>
                <div className="text-sm font-bold">{fmtEUR(calc.totalSale)}</div>
              </div>
              <div className="rounded-lg border bg-secondary/30 p-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Marža</div>
                <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtEUR(calc.margin)} · {calc.marginPct} %</div>
              </div>
              <div className="rounded-lg border bg-secondary/30 p-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Vir cene</div>
                <div className="truncate text-sm font-bold">{calc.priceSource}</div>
              </div>
            </div>
          ) : null}
          {segCount > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
              <Layers className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Kosovnica je izpeljana <strong>po {segCount} {segCount === 1 ? 'segmentu' : segCount < 5 ? 'segmentih' : 'segmentih'}</strong> (ključi seg-N so usklajeni z digitalnim dvojčkom in merilnim modelom) —
                stebri iz razmika, dolžine/ploščine z odpadom iz pravil.
              </span>
            </div>
          ) : null}
          {grouped.map((g) => (
            <div key={g.key} className="overflow-hidden rounded-lg border">
              <div className="flex flex-wrap items-center gap-2 border-b bg-secondary/40 px-3 py-2">
                <span className="text-sm font-semibold">{g.label}</span>
                <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{g.count} {g.count === 1 ? 'vrstica' : g.count < 5 ? 'vrstice' : 'vrstic'}</Badge>
                {g.segments > 0 ? (
                  <Badge variant="secondary" className="border-transparent bg-roksal-amber/15 text-roksal-amber">{g.segments} {g.segments === 1 ? 'segment' : g.segments < 5 ? 'segmenti' : 'segmentov'}</Badge>
                ) : null}
              </div>
              <Table>
                <TableBody>
                  {g.lines.map((l) => (
                    <TableRow key={l.id}>
                      {/* R475: whitespace-normal — osnovni TableCell ima whitespace-nowrap,
                          zaradi česar celica z značko+SKU+imenom+opombo na mobilnem ne prelomi
                          (min-content 394 px) in razširi tabelo čez dialog. */}
                      <TableCell className="whitespace-normal pl-3">
                        {l.segmentKey ? (
                          <Badge variant="outline" className="mb-1 mr-2 font-mono text-[10px] text-roksal-amber">{l.segmentKey}</Badge>
                        ) : null}
                        <span className="font-mono text-xs text-muted-foreground">{l.item.sku}</span>
                        <span className="ml-2 font-medium">{l.item.name}</span>
                        {l.wastePct != null && l.wastePct > 0 ? (
                          <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground" title={l.sourceRule ?? ''}>+ {l.wastePct} % odpad</span>
                        ) : null}
                        {l.note ? <span className="block text-[11px] text-muted-foreground">{l.note}</span> : null}
                      </TableCell>
                      <TableCell className="text-right font-bold">{l.qty} <span className="text-xs font-normal text-muted-foreground">{l.unit}</span></TableCell>
                      <TableCell className="w-24 pr-3">
                        {l.item.qty >= l.qty ? (
                          <Badge variant="secondary" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">pokrito</Badge>
                        ) : (
                          <Badge variant="secondary" className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">manjka {Math.round((l.qty - l.item.qty) * 100) / 100}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Vrstice so vezane na artikle z eksplicitnimi ID — brez ujemanja imen (issue #7 §2).
          </p>
        </div>
      ) : null}
      {/* R478: uvoz kosovnice (round-trip) — preveri (dry-run) nato uvozi */}
      <ImportBomDialog
        pkg={pkg}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => { setImportTick((t) => t + 1) }}
      />
    </DialogContent>
  )
}

// ── R478: UVOZ KOSOVNICE (CSV/XLSX/JSON → paket) ─────────────────────────────

interface BomImportResult {
  mode: 'preveri' | 'uvozi'
  lines: number
  skus?: number
  diff?: {
    unchanged: number
    entries: { sku: string; segmentKey: string | null; kind: 'DODANO' | 'ODSTRANJENO' | 'SPREMENJENA_KOLICINA'; fromQty?: number; toQty?: number }[]
  }
  warnings?: string[]
  bom?: { code: string; lines: number }
  invalidated?: { reset: number; flagged: number; codes: string[] }
}

function ImportBomDialog ({ pkg, open, onOpenChange, onImported }: {
  pkg: PackageRow | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onImported: () => void
}) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BomImportResult | null>(null)
  const [rowErrors, setRowErrors] = useState<{ row: number; field: string; problem: string }[] | null>(null)
  const [busy, setBusy] = useState(false)

  function reset (): void {
    setFile(null); setResult(null); setRowErrors(null)
    if (inputRef.current != null) inputRef.current.value = ''
  }

  async function run (mode: 'preveri' | 'uvozi'): Promise<void> {
    if (!pkg || !file || !token) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('packageId', pkg.id)
      fd.append('mode', mode)
      const res = await fetch('/api/import/bom', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const raw = await res.json().catch(() => ({})) as { data?: BomImportResult; error?: string; rowErrors?: { row: number; field: string; problem: string }[] }
      const data = raw.data ?? (raw as unknown as BomImportResult) // API ovijalnik { data } ali golo
      if (!res.ok) {
        setRowErrors(raw.rowErrors ?? null)
        throw new Error(raw.error ?? `Napaka strežnika (${res.status}).`)
      }
      setRowErrors(null)
      if (mode === 'preveri') {
        setResult(data)
      } else {
        toast({
          title: `Kosovnica ${data.bom?.code ?? ''} uvožena (${data.lines} vrstic).`,
          description: data.invalidated != null && data.invalidated.reset + data.invalidated.flagged > 0
            ? `Povezane ponudbe invalidirane: ${(data.invalidated.codes ?? []).join(', ')}.`
            : 'Kalkulacija (cena/marža) se ni spremenila — cene izračuna ponudba.',
        })
        reset()
        onOpenChange(false)
        onImported()
      }
    } catch (e) {
      toast({ title: 'Uvoz ni uspel.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const diffRows = result?.diff?.entries ?? []
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onOpenChange(false) } else { onOpenChange(true) } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>Uvoz kosovnice — {pkg?.code ?? ''}</DialogTitle>
          <DialogDescription>
            CSV (podpično, vejica), XLSX (tudi iz Excela) ali JSON izvoz. Najprej PREVERI (brez zapisov) — diff se pokaže spodaj.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.json"
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-secondary/80"
            aria-label="Datoteka kosovnice (CSV, XLSX ali JSON)"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setRowErrors(null) }}
          />
          {file != null ? (
            <p className="text-xs text-muted-foreground">{file.name} · {Math.max(1, Math.round(file.size / 1024))} KB</p>
          ) : (
            <p className="text-xs text-muted-foreground">Vsak SKU mora obstajati v katalogu; segmenti seg-N; skupine STEBRI/ROCNIK/POLNILO/OSTALO.</p>
          )}

          {rowErrors != null && rowErrors.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert">
              <p className="mb-1 font-bold">Napake v vrsticah ({rowErrors.length}):</p>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                {rowErrors.map((e, i) => <li key={i}>Vrsta {e.row} · {e.field}: {e.problem}</li>)}
              </ul>
            </div>
          ) : null}

          {result != null ? (
            <div className="space-y-2 rounded-lg border bg-secondary/30 p-3 text-xs">
              <p className="font-bold">Preverjanje: {result.lines} vrstic · {result.skus} SKU</p>
              <p className={diffRows.length === 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium text-amber-700 dark:text-amber-400'}>
                {diffRows.length === 0
                  ? `BREZ SPREMEMB — identično trenutni kosovnici (${result.diff?.unchanged ?? 0} vrstic).`
                  : `${diffRows.length} razlik: ${diffRows.filter((e) => e.kind === 'DODANO').length} dodanih, ${diffRows.filter((e) => e.kind === 'ODSTRANJENO').length} odstranjenih, ${diffRows.filter((e) => e.kind === 'SPREMENJENA_KOLICINA').length} spremenjenih količin.`}
              </p>
              {diffRows.length > 0 ? (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono">
                  {diffRows.slice(0, 50).map((e, i) => (
                    <li key={i}>
                      {e.kind === 'DODANO' ? '+' : e.kind === 'ODSTRANJENO' ? '−' : '±'} {e.sku}{e.segmentKey != null ? ` · ${e.segmentKey}` : ''}
                      {e.kind === 'SPREMENJENA_KOLICINA' ? `: ${e.fromQty} → ${e.toQty}` : e.kind === 'DODANO' ? `: ${e.toQty}` : `: ${e.fromQty}`}
                    </li>
                  ))}
                </ul>
              ) : null}
              {(result.warnings ?? []).length > 0 ? (
                <ul className="space-y-0.5 text-amber-700 dark:text-amber-400">
                  {(result.warnings ?? []).map((w, i) => <li key={i}>⚠ {w}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { void run('preveri') }} disabled={busy || file == null}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Search className="size-3.5" aria-hidden />}
            Preveri
          </Button>
          <Button onClick={() => { void run('uvozi') }} disabled={busy || file == null}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
            Uvozi (novo verzijo)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

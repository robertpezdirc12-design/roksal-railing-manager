'use client'

// PROJEKTI — seznam + podrobnost (vrata projects.read)
// R434: garancija projekta — sklop v podrobnosti (/api/warranty, obiski).
// R435: portal stranke — povezave + predogled javnega pogleda (/api/portal, /api/public/portal).
// R436: 3D predogled — zadnja shranjena konfiguracija iz zavihka Vizualizacija.
// R546: razbitje velikana — sekcije v projekti-sections.tsx, paketi v
// projekti-packages.tsx, portal v projekti-portal.tsx, tipi v projekti-shared.ts.
// Tu ostanejo: seznam, podrobnost in pogled/uvoz kosovnice (PackageBomDialog).

import { useMemo, useState } from 'react'
import { Banknote, FileText, FolderKanban, HardHat, History, MapPin, Plus, Ruler, Search } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CardHover, AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore } from '@/lib/store'
import { fmtDate, fmtEUR, useApi } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { haptic } from '@/lib/haptics'
import { useLongPress } from '@/lib/use-swipe'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { STATUSES, type ProjectDetail, type ProjectRow } from './projekti-shared'
import { CreateProjectDialog, KonfigPreviewSection, ProgressSection, TimelineDialog, WarrantySection } from './projekti-sections'
import { PackagesSection } from './projekti-packages'
import { PortalSection } from './projekti-portal'

export default function ProjektiModule () {
  const user = useAppStore((s) => s.user)
  const setTab = useAppStore((s) => s.setTab)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const { toast } = useToast()
  const longPress = useLongPress(() => { haptic('medium'); toast({ title: 'Projekt', description: 'Dolgi pritisk — kontekstni meni' }) }, 500)

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
        <AnimatedList className="grid gap-3 md:grid-cols-2" data-tour="projekti-list">
          {rows.map((p) => (
            <AnimatedListItem key={p.id}>
              <button type="button" className="w-full text-left" onClick={() => { haptic("light"); setSelected(p.id) }} onTouchStart={longPress.onTouchStart} onTouchEnd={longPress.onTouchEnd} onTouchMove={longPress.onTouchMove} onMouseDown={longPress.onMouseDown} onMouseUp={longPress.onMouseUp} onMouseLeave={longPress.onMouseLeave} aria-label={`Odpri projekt ${p.code}`}>
                <Card className="transition hover:border-roksal-amber/60 hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-roksal-amber-text">{p.code}</span>
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
            </AnimatedListItem>
          ))}
        </AnimatedList>
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
          <span className="font-mono text-xs font-semibold text-roksal-amber-text">{detail.code}</span>
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
            <AnimatedList className="space-y-1">
              {detail.quotes.map((qq) => (
                <AnimatedListItem key={qq.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="font-mono text-xs">{qq.code}</span>
                  <StatusBadge status={qq.status} />
                  <span className="font-semibold">{fmtEUR(qq.total)}</span>
                </AnimatedListItem>
              ))}
            </AnimatedList>
          )}
        </section>

        <section aria-label="Računi">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Računi</h3>
          {detail.invoices.length === 0 ? <p className="text-sm text-muted-foreground">Ni računov.</p> : (
            <AnimatedList className="space-y-1">
              {detail.invoices.map((iv) => (
                <AnimatedListItem key={iv.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="inline-flex items-center gap-2 font-mono text-xs"><Banknote className="size-3.5" aria-hidden />{iv.code}</span>
                  <StatusBadge status={iv.status} />
                  <span className="font-semibold">{fmtEUR(iv.total)} <span className="text-xs font-normal text-muted-foreground">(plačano {fmtEUR(iv.paid)})</span></span>
                </AnimatedListItem>
              ))}
            </AnimatedList>
          )}
        </section>

        <section aria-label="Nalogi">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Nalogi</h3>
          {detail.workOrders.length === 0 ? <p className="text-sm text-muted-foreground">Ni nalogov.</p> : (
            <AnimatedList className="space-y-1">
              {detail.workOrders.map((w) => (
                <AnimatedListItem key={w.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="min-w-0 truncate"><span className="font-mono text-xs">{w.code}</span> {w.title}</span>
                  <StatusBadge status={w.status} />
                </AnimatedListItem>
              ))}
            </AnimatedList>
          )}
        </section>

        <section aria-label="Meritve">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Meritve</h3>
          {detail.measurements.length === 0 ? <p className="text-sm text-muted-foreground">Ni meritev.</p> : (
            <AnimatedList className="space-y-1">
              {detail.measurements.map((m) => (
                <AnimatedListItem key={m.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                  <span className="min-w-0 truncate">{m.location ?? m.type}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {m.lengthCm ? `${(m.lengthCm / 100).toFixed(2)} m` : '—'} · {fmtDate(m.createdAt)}
                  </span>
                </AnimatedListItem>
              ))}
            </AnimatedList>
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


'use client'

// TEREN — terenski pregled projektov (vrata projects.write — teren)

import { HardHat, MapPin } from '@/components/roksal/custom-icons'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'

interface WorkOrderLite { id: string; code: string; title: string; status: string; scheduledFor: string | null; assignee: { name: string } | null }

export default function TerenModule () {
  const list = useApi<{ data: { id: string; code: string; title: string; status: string; address: string | null; customer: { name: string } | null; _count: { workOrders: number } }[] }>('/api/projects?status=TEREN')
  const active = useApi<{ data: { id: string; code: string; title: string; status: string; address: string | null; customer: { name: string } | null; _count: { workOrders: number } }[] }>('/api/projects?status=AKTIVNI')
  const wo = useApi<{ data: WorkOrderLite[] }>('/api/nalog?scope=open')

  const projects = [...(list.data?.data ?? []), ...(active.data?.data ?? [])]

  return (
    <div className="space-y-5" data-tour="teren-module">
      <PageHeader title="Teren" desc="Projekti na terenu in v pripravi — fokus izvajalcem." />

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : projects.length === 0 ? (
        <EmptyState title="Ni projektov na terenu" desc="Ko projekt preide v status „Na terenu“, se prikaže tukaj." icon={HardHat} />
      ) : (
        <AnimatedList className="grid gap-3 md:grid-cols-2" data-tour="teren-list">
          {projects.map((p) => (
            <AnimatedListItem key={p.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{p.code}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-1.5 font-semibold leading-snug">{p.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{p.customer?.name ?? '—'}</span>
                    {p.address ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{p.address}</span> : null}
                  </div>
                </CardContent>
              </Card>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}

      <section aria-label="Odprti nalogi">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">Odprti nalogi (vsi projekti)</h2>
        {wo.loading ? <LoadingRows rows={3} /> : (wo.data?.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Ni odprtih nalogov.</p>
        ) : (
          <AnimatedList className="space-y-2">
            {(wo.data?.data ?? []).map((w) => (
              <AnimatedListItem key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-roksal-amber">{w.code}</span>
                  <span className="ml-2 text-sm font-medium">{w.title}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={w.status} />
                  {w.scheduledFor ? <span>{fmtDate(w.scheduledFor)}</span> : null}
                  {w.assignee ? <span>{w.assignee.name}</span> : null}
                </div>
              </AnimatedListItem>
            ))}
          </AnimatedList>
        )}
      </section>
    </div>
  )
}

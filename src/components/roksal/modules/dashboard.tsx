'use client'

// PREGLEDNICA / DIREKTOR COCKPIT — KPI portfelja (vrata projects.read; R444).
// Denarni sklopi (terjatve, zastarevanje, marže, vrednost zaloge) se prikažejo
// SAMO, če jih API vrne — ta jih izpusti brez invoices.read (ADMIN/VODJA).
// Prodajni lijak samo za vloge s crm.read.

import {
  AlertTriangle, ArrowRight, Banknote, CalendarDays, FolderKanban, HardHat, ListChecks, PackageX, TrendingUp, Warehouse,
} from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fmtEUR, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows, PageHeader, StatCard, StatusBadge } from '@/components/roksal/ui-bits'
import { CardHover, AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { useAppStore } from '@/lib/store'
import { fmtDate } from '@/lib/api-client'
import { cn } from '@/lib/utils'

interface DashData {
  projects: { total: number; byStatus: Record<string, number>; active: number }
  workOrders: { total: number; open: number; today: number; byStatus: Record<string, number> }
  lowStock: { id: string; name: string; qty: number; reorderAt: number; unit: string }[]
  finance: {
    invoices: { outstanding: number; overdueCount: number; overdueSum: number }
    aging: { d0_30: number; d30_60: number; d60plus: number }
    marginsTop: { projectId: string; code: string; title: string; margin: number; marginPct: number; totalSale: number }[]
  } | null
  operations: {
    overdue: { count: number; list: { id: string; code: string; title: string; scheduledFor: string; status: string; assignee: string | null }[] }
    capacity: { days: { date: string; count: number }[]; byAssignee: { name: string; count: number }[] }
    stockValue: { total: number; items: number }
  } | null
  pipeline: { value: number; count: number } | null
}

// R456: vrstica plošče »Naslednji koraki« (/api/projects/next-actions)
interface NextActionRow {
  id: string; code: string; title: string; status: string
  done: number; total: number; pct: number
  next: { key: string; label: string; targetTab: string; reason: string } | null
}

const DAY_SHORT = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob']

export default function DashboardModule () {
  const user = useAppStore((s) => s.user)
  const setTab = useAppStore((s) => s.setTab)
  const { data, loading, error } = useApi<{ data: DashData }>('/api/dashboard')

  // R456 (issue #11 §2 NEXT BEST ACTION): naslednji koraki aktivnih projektov
  const nextActions = useApi<{ data: NextActionRow[] }>('/api/projects/next-actions?limit=8', [])

  const fin = data?.data.finance ?? null
  const ops = data?.data.operations ?? null
  const pipeline = data?.data.pipeline ?? null

  return (
    <div className="space-y-5">
      <PageHeader
        title="Preglednica"
        desc={fin
          ? `Direktorski kokpit — ${user?.name ?? ''}, celoten posel na en pogled.`
          : `Dobrodošli nazaj, ${user?.name ?? ''} — stanje portfelja na en pogled.`}
      />
      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={3} /> : data ? (
        <>
          {/* osnovni KPI (projects.read) + pogojni denarni (invoices.read / crm.read) */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Projekti" value={data.data.projects.total} hint={`${data.data.projects.active} aktivnih`} icon={FolderKanban} />
            <StatCard label="Nalogi odprti" value={data.data.workOrders.open} hint={`${data.data.workOrders.today} danes`} icon={HardHat} tone="amber" />
            {fin ? (
              <StatCard label="Neplačano" value={fmtEUR(fin.invoices.outstanding)} hint={`${fin.invoices.overdueCount} zapadlih — ${fmtEUR(fin.invoices.overdueSum)}`} icon={Banknote} tone={fin.invoices.overdueCount > 0 ? 'red' : 'green'} />
            ) : null}
            {pipeline ? (
              <StatCard label="Prodajni lijak" value={fmtEUR(pipeline.value)} hint={`${pipeline.count} priložnosti`} icon={TrendingUp} />
            ) : null}
          </div>

          {/* ─── R456 (issue #11 §2): NASLEDNJI KORAKI — sistem ve, kaj sledi ─── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ListChecks className="size-4 text-roksal-amber" aria-hidden /> Naslednji koraki
                <span className="ml-auto text-xs font-normal text-muted-foreground">aktivni projekti</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {nextActions.loading ? (
                <p className="text-sm text-muted-foreground">Nalaganje …</p>
              ) : nextActions.error ? (
                <ErrorBox error={nextActions.error} />
              ) : (nextActions.data?.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Ni aktivnih projektov z odprtim korakom.</p>
              ) : (
                <AnimatedList className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {(nextActions.data?.data ?? []).map((r) => (
                    <AnimatedListItem key={r.id}>
                    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-roksal-amber-text">{r.code}</span>
                          <StatusBadge status={r.status} />
                          <span className="text-xs text-muted-foreground">{r.done}/{r.total}</span>
                        </div>
                        <div className="mt-0.5 truncate text-sm font-medium">{r.title}</div>
                        <div className="text-xs text-muted-foreground">{r.next ? r.next.reason : 'Tok zaključen ✓'}</div>
                      </div>
                      {r.next ? (
                        <Button size="sm" className="h-9 shrink-0" onClick={() => setTab(r.next!.targetTab)}>
                          {r.next.label.replace('NADALJUJ: ', '')} <ArrowRight className="size-3.5" aria-hidden />
                        </Button>
                      ) : null}
                    </li>
                    </AnimatedListItem>
                  ))}
                </AnimatedList>
              )}
            </CardContent>
          </Card>

          {/* ─── direktorski kokpit (SAMO invoices.read — API drugače vrne null) ─── */}
          {fin ? (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Terjatve 0–30 dni" value={fmtEUR(fin.aging.d0_30)} icon={Banknote} tone="amber" />
                <StatCard label="Terjatve 30–60 dni" value={fmtEUR(fin.aging.d30_60)} icon={Banknote} tone="amber" />
                <StatCard label="Terjatve 60+ dni" value={fmtEUR(fin.aging.d60plus)} icon={Banknote} tone={fin.aging.d60plus > 0 ? 'red' : 'green'} />
                {ops ? (
                  <StatCard label="Vrednost zaloge" value={fmtEUR(ops.stockValue.total)} hint={`${ops.stockValue.items} artiklov po povprečju lotov`} icon={Warehouse} />
                ) : null}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* marže po projektih — top 5 iz kalkulacij paketov (min-w-0: grid element
                    se lahko skrči — mobile §16, R456) */}
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingUp className="size-4 text-roksal-green" aria-hidden /> Marže po projektih (top 5)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {fin.marginsTop.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Ni kalkuliranih paketov — generirajte kosovnice pri paketih projektov.</p>
                    ) : (
                      <AnimatedList className="space-y-2">
                        {fin.marginsTop.map((m) => (
                          <AnimatedListItem key={m.projectId} className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{m.code} — {m.title}</div>
                              <div className="text-xs text-muted-foreground">prodaja {fmtEUR(m.totalSale)}</div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className={cn('font-bold', m.margin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                                {fmtEUR(m.margin)}
                              </div>
                              <div className="text-xs text-muted-foreground">{m.marginPct.toFixed(1)} %</div>
                            </div>
                          </AnimatedListItem>
                        ))}
                      </AnimatedList>
                    )}
                  </CardContent>
                </Card>

                {/* zamude — nalogi s terminom v preteklosti */}
                {ops ? (
                  <Card className="min-w-0">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <AlertTriangle className="size-4 text-roksal-amber" aria-hidden /> Zamude nalogov
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {ops.overdue.count === 0 ? (
                        <p className="text-sm text-muted-foreground">Ni zamud — vsi nalogi po roku.</p>
                      ) : (
                        <>
                          <p className="mb-2 text-sm font-semibold text-red-600 dark:text-red-400">{ops.overdue.count} nalogov z pretečenim terminom</p>
                          <AnimatedList className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                            {ops.overdue.list.map((w) => (
                              <AnimatedListItem key={w.id} className="flex items-center justify-between gap-2 text-sm">
                                <div className="min-w-0">
                                  <span className="font-mono text-xs font-semibold text-roksal-amber-text">{w.code}</span>
                                  <span className="ml-2 truncate">{w.title}</span>
                                  <span className="block text-xs text-muted-foreground">{w.assignee ?? 'nedodeljen'}</span>
                                </div>
                                <span className="shrink-0 text-xs font-semibold text-red-600 dark:text-red-400">{fmtDate(w.scheduledFor)}</span>
                              </AnimatedListItem>
                            ))}
                          </AnimatedList>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ) : null}
              </div>

              {/* kapaciteta — nalogi naslednjih 7 dni po dnevih + izvajalcih */}
              {ops ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CalendarDays className="size-4 text-roksal-amber" aria-hidden /> Kapaciteta — naslednjih 7 dni
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-end justify-between gap-2" role="img" aria-label="Število nalogov po dnevih za naslednjih 7 dni">
                      {ops.capacity.days.map((d) => {
                        const max = Math.max(...ops.capacity.days.map((x) => x.count), 1)
                        const dt = new Date(d.date)
                        return (
                          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                            <span className="text-xs font-bold">{d.count}</span>
                            <div
                              className={cn('w-full rounded-t-md', d.count > 0 ? 'bg-roksal-amber' : 'bg-secondary')}
                              style={{ height: `${Math.max((d.count / max) * 56, 4)}px` }}
                            />
                            <span className="text-[10px] uppercase text-muted-foreground">{DAY_SHORT[dt.getDay()]}</span>
                            <span className="text-[10px] text-muted-foreground">{dt.getDate()}.{dt.getMonth() + 1}.</span>
                          </div>
                        )
                      })}
                    </div>
                    {ops.capacity.byAssignee.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {ops.capacity.byAssignee.map((a) => (
                          <span key={a.name} className="rounded-full border bg-secondary/50 px-3 py-1 text-xs font-medium">
                            {a.name}: <span className="font-bold">{a.count}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">V naslednjih 7 dneh ni razporejenih nalogov.</p>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader><CardTitle className="text-base">Projekti po statusih</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(data.data.projects.byStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between gap-2">
                    <StatusBadge status={status} />
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader><CardTitle className="text-base">Nalogi po statusih</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(data.data.workOrders.byStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between gap-2">
                    <StatusBadge status={status} />
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4 text-roksal-amber" aria-hidden /> Nizka zaloga
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.data.lowStock.length === 0 ? (
                <p className="text-sm text-muted-foreground">Vsa zaloga je nad mejo naročila.</p>
              ) : (
                <AnimatedList className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {data.data.lowStock.map((i) => (
                    <AnimatedListItem key={i.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <PackageX className="size-4 shrink-0 text-muted-foreground" aria-hidden /> <span className="truncate">{i.name}</span>
                      </span>
                      <span className="shrink-0 font-mono text-red-600 dark:text-red-400">{i.qty} / {i.reorderAt} {i.unit}</span>
                    </AnimatedListItem>
                  ))}
                </AnimatedList>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

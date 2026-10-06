'use client'

// PREGLEDNICA — KPI portfelja (vrata projects.read)

import { FolderKanban, HardHat, AlertTriangle, TrendingUp, PackageX, Banknote } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fmtEUR, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows, PageHeader, StatCard, StatusBadge } from '@/components/roksal/ui-bits'
import { useAppStore } from '@/lib/store'

interface DashData {
  projects: { total: number; byStatus: Record<string, number>; active: number }
  workOrders: { total: number; open: number; today: number; byStatus: Record<string, number> }
  invoices: { outstanding: number; overdueCount: number; overdueSum: number }
  lowStock: { id: string; name: string; qty: number; reorderAt: number; unit: string }[]
  pipeline: { value: number; count: number }
}

export default function DashboardModule () {
  const user = useAppStore((s) => s.user)
  const { data, loading, error } = useApi<{ data: DashData }>('/api/dashboard')

  return (
    <div className="space-y-5">
      <PageHeader title="Preglednica" desc={`Dobrodošli nazaj, ${user?.name ?? ''} — stanje portfelja na en pogled.`} />
      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={3} /> : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Projekti" value={data.data.projects.total} hint={`${data.data.projects.active} aktivnih`} icon={FolderKanban} />
            <StatCard label="Nalogi odprti" value={data.data.workOrders.open} hint={`${data.data.workOrders.today} danes`} icon={HardHat} tone="amber" />
            <StatCard label="Neplačano" value={fmtEUR(data.data.invoices.outstanding)} hint={`${data.data.invoices.overdueCount} zapadlih — ${fmtEUR(data.data.invoices.overdueSum)}`} icon={Banknote} tone={data.data.invoices.overdueCount > 0 ? 'red' : 'green'} />
            <StatCard label="Prodajni lijak" value={fmtEUR(data.data.pipeline.value)} hint={`${data.data.pipeline.count} priložnosti`} icon={TrendingUp} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
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

            <Card>
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
                <ul className="space-y-1.5">
                  {data.data.lowStock.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2">
                        <PackageX className="size-4 text-muted-foreground" aria-hidden /> {i.name}
                      </span>
                      <span className="font-mono text-red-600 dark:text-red-400">{i.qty} / {i.reorderAt} {i.unit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

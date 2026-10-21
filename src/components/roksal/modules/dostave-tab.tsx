'use client'

// DOSTAVE ZAVIHEK: dostave (R549): seznam dostav s filtrom statusa, kartice
// s povezavami + dialoga podrobnosti in nove dostave (izvlečeno bajtno-identično
// iz dostave.tsx).

import { useState } from 'react'
import { CalendarClock, CarFront, ClipboardList, HardHat, MapPin, Plus, Truck, User } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Dialog } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore } from '@/lib/store'
import { fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { DELIVERY_STATUSI, isOffice } from './dostave-shared'
import type { DeliveryRow } from './dostave-shared'
import { DeliveryDetailDialog } from './dostave-detail'
import { NewDeliveryDialog } from './dostave-nova'

// ─── ZAVIHEK: dostave ─────────────────────────────────────────────────────────

export function DostaveTab () {
  const user = useAppStore((s) => s.user)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const deliveries = useApi<{ data: DeliveryRow[] }>(`/api/deliveries${status !== 'all' ? `?status=${status}` : ''}`, [status])
  const office = isOffice(user)
  const rows = deliveries.data?.data ?? []
  const activeCount = rows.filter((d) => !['DOSTAVLJENO', 'PREKLICANA'].includes(d.status)).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Filter statusa dostave"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            {DELIVERY_STATUSI.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">
          {rows.length} dostav{activeCount > 0 ? ` · ${activeCount} aktivnih` : ''}
        </Badge>
        {office ? (
          <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nova dostava
          </Button>
        ) : null}
      </div>

      <ErrorBox error={deliveries.error} />
      {deliveries.loading ? <LoadingRows /> : !deliveries.error && rows.length === 0 ? (
        <EmptyState
          title="Ni dostav"
          desc={status !== 'all' ? 'Za izbrani status ni dostav.' : 'Pisarna ustvari dostavo iz zaključene picking liste ali ročno z naslovom.'}
          icon={Truck}
        />
      ) : (
        <AnimatedList className="space-y-2">
          {rows.map((d) => (
            <AnimatedListItem key={d.id}>
              <Card className="transition hover:border-roksal-amber/60">
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{d.code}</span>
                    <StatusBadge status={d.status} />
                    <span className="ml-auto text-xs text-muted-foreground">{d.items.length} vrstic</span>
                  </div>
                  <div className="text-sm font-semibold leading-snug">
                    {d.project ? <>{d.project.code} — {d.project.title}</> : 'Brez projekta'}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {d.plannedAt ? <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" aria-hidden /> {fmtDateTime(d.plannedAt)}</span> : null}
                    {d.vehicle ? <span className="inline-flex items-center gap-1"><CarFront className="size-3" aria-hidden /> {d.vehicle.plate}</span> : null}
                    {d.driver ? <span className="inline-flex items-center gap-1"><User className="size-3" aria-hidden /> {d.driver.name}</span> : null}
                    {d.pickingList ? <span className="inline-flex items-center gap-1"><ClipboardList className="size-3" aria-hidden /> {d.pickingList.code}</span> : null}
                    {d.workOrder ? <span className="inline-flex items-center gap-1"><HardHat className="size-3" aria-hidden /> {d.workOrder.code}</span> : null}
                  </div>
                  {d.address ? <div className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" aria-hidden /> {d.address}</div> : null}
                  <Button variant="outline" size="sm" className="mt-1 min-h-11" onClick={() => setSelected(d.id)}>
                    Podrobnosti in prehodi
                  </Button>
                </CardContent>
              </Card>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DeliveryDetailDialog
          id={selected}
          onClose={() => setSelected(null)}
          onDone={async () => { await deliveries.reload() }}
        />
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewDeliveryDialog
          key={String(createOpen)} /* remount ob vsakem odprtju — sveža forma */
          onClose={() => setCreateOpen(false)}
          onDone={async () => { await deliveries.reload() }}
        />
      </Dialog>
    </div>
  )
}

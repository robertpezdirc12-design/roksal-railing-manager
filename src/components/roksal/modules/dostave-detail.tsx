'use client'

// DOSTAVE PODROBNOST (R549): podrobnost dostave + prehodi (pripravi → natovari
// → na pot → dostavljeno / prekliči) + zložljiva dopolnitev načrta (izvlečeno
// bajtno-identično iz dostave.tsx).

import { useState } from 'react'
import { CarFront, CheckCircle2, ClipboardList, HardHat, Package, Pencil, Truck, User, XCircle } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, fmtDateTime, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { ACTION_LABELS, isOffice } from './dostave-shared'
import type { DeliveryRow, UserOption, VehicleRow } from './dostave-shared'

// ─── podrobnost dostave + prehodi ────────────────────────────────────────────

export function DeliveryDetailDialog ({ id, onClose, onDone }: { id: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const detail = useApi<{ data: DeliveryRow }>(id ? `/api/deliveries/${id}` : null, [id])
  const [busy, setBusy] = useState('')
  const [recipientNote, setRecipientNote] = useState('')
  const [cancelNote, setCancelNote] = useState('')

  // plan (samo pisarna) — dopolnitev vozila/voznika/časa/naslova
  const vehicles = useApi<{ data: VehicleRow[] }>(id ? '/api/vehicles?all=1' : null, [id])
  const users = useApi<{ data: UserOption[] }>(id ? '/api/users' : null, [id])
  const [planOpen, setPlanOpen] = useState(false)
  const [planVehicle, setPlanVehicle] = useState('')
  const [planDriver, setPlanDriver] = useState('')
  const [planAt, setPlanAt] = useState('')
  const [planAddress, setPlanAddress] = useState('')

  const d = detail.data?.data
  const office = isOffice(user)
  const isDriver = !!d && !!user && d.driver?.id === user.id
  const canTransit = office || isDriver

  async function transition (action: string, extra?: Record<string, unknown>) {
    if (!d) return
    setBusy(action)
    try {
      await apiPatch(`/api/deliveries/${d.id}`, { action, ...extra })
      toast({ title: 'Prehod uspel.', description: `${d.code}: ${ACTION_LABELS[action] ?? action}` })
      setRecipientNote('')
      setCancelNote('')
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Prehod ni uspel', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy('') }
  }

  async function submitPlan () {
    if (!d) return
    setBusy('plan')
    try {
      const body: Record<string, unknown> = {}
      if (planVehicle !== '') body.vehicleId = planVehicle
      if (planDriver !== '') body.driverId = planDriver
      if (planAt) body.plannedAt = new Date(planAt).toISOString()
      if (planAddress.trim()) body.address = planAddress.trim()
      if (Object.keys(body).length === 0) {
        toast({ title: 'Ni sprememb za izvedbo.', variant: 'destructive' })
        return
      }
      await apiPatch(`/api/deliveries/${d.id}`, { action: 'plan', ...body })
      toast({ title: 'Načrt dopolnjen.', description: `${d.code}: vozilo/voznik/termin posodobljeni.` })
      setPlanOpen(false)
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Dopolnitev načrta ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy('') }
  }

  if (!d) {
    return (
      <DialogContent className="sm:max-w-lg">
        {/* dostopnost: tudi med nalaganjem/napako (Radix opozori na manjkajoči opis) */}
        <DialogHeader>
          <DialogTitle>Dostava</DialogTitle>
          <DialogDescription className="sr-only">Podrobnosti dostave in prehodi.</DialogDescription>
        </DialogHeader>
        {detail.loading ? <LoadingRows rows={2} /> : <ErrorBox error={detail.error ?? { message: 'Dostava ni na voljo.' }} />}
      </DialogContent>
    )
  }

  const casovnica: { l: string; v: string | null }[] = [
    { l: 'Načrtovano', v: d.plannedAt },
    { l: 'Natovorjeno', v: d.loadedAt },
    { l: 'Odhod', v: d.departedAt },
    { l: 'Dostavljeno', v: d.deliveredAt },
  ]

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-roksal-amber">{d.code}</span>
          <StatusBadge status={d.status} />
        </DialogTitle>
        <DialogDescription>
          {d.project ? `${d.project.code} — ${d.project.title}` : 'Brez projekta'}
          {d.address ? ` · ${d.address}` : ''}
        </DialogDescription>
      </DialogHeader>

      {/* povezave: projekt, picking, nalog, vozilo, voznik */}
      <div className="flex flex-wrap gap-1.5">
        {d.pickingList ? <Badge variant="secondary" className="border-transparent bg-secondary text-[11px] text-secondary-foreground"><ClipboardList className="mr-1 size-3" aria-hidden /> picking {d.pickingList.code} ({d.pickingList.status})</Badge> : null}
        {d.workOrder ? <Badge variant="secondary" className="border-transparent bg-secondary text-[11px] text-secondary-foreground"><HardHat className="mr-1 size-3" aria-hidden /> nalog {d.workOrder.code}{d.workOrder.scheduledFor ? ` · ${fmtDateTime(d.workOrder.scheduledFor)}` : ''}</Badge> : null}
        {d.vehicle ? <Badge variant="secondary" className="border-transparent bg-secondary text-[11px] text-secondary-foreground"><CarFront className="mr-1 size-3" aria-hidden /> {d.vehicle.plate} — {d.vehicle.name}</Badge> : null}
        {d.driver ? <Badge variant="secondary" className="border-transparent bg-secondary text-[11px] text-secondary-foreground"><User className="mr-1 size-3" aria-hidden /> {d.driver.name}</Badge> : null}
      </div>

      {/* časovnica */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border bg-secondary/30 p-3 text-xs sm:grid-cols-4">
        {casovnica.map((c) => (
          <div key={c.l}>
            <div className="font-semibold uppercase tracking-wide text-muted-foreground">{c.l}</div>
            <div className="font-medium">{c.v ? fmtDateTime(c.v) : '—'}</div>
          </div>
        ))}
      </div>

      {/* vrstice dostave */}
      <section aria-label="Vrstice dostave">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Material ({d.items.length})</h3>
        {d.items.length === 0 ? (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            Dostava je brez vrstic — nastala je brez picking liste (ročna dostava).
          </p>
        ) : (
          <Card>
            <CardContent className="max-h-64 overflow-y-auto p-0">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="pl-4">Artikel</TableHead>
                    <TableHead className="text-right pr-4">Količina</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="pl-4">
                        <div className="font-medium">{it.description}</div>
                        {it.item ? <div className="font-mono text-[11px] text-muted-foreground">{it.item.sku}</div> : <div className="text-[11px] text-muted-foreground">brez artikla</div>}
                        {it.note ? <div className="text-[11px] text-muted-foreground">{it.note}</div> : null}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-bold">{it.qty} <span className="text-xs font-normal text-muted-foreground">{it.unit}</span></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {d.note ? <p className="rounded-xl border bg-secondary/40 p-3 text-xs text-muted-foreground">{d.note}</p> : null}
      {d.recipientNote ? (
        <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> Prevzemnik: {d.recipientNote}
        </p>
      ) : null}

      {/* akcije glede na status + pravice */}
      <div className="flex flex-wrap gap-2 pt-1">
        {office && ['NACRTOVANO', 'PRIPRAVLJENO'].includes(d.status) ? (
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => {
            setPlanVehicle(d.vehicle?.id ?? '')
            setPlanDriver(d.driver?.id ?? '')
            setPlanAt(d.plannedAt ? new Date(d.plannedAt).toISOString().slice(0, 16) : '')
            setPlanAddress(d.address ?? '')
            setPlanOpen((v) => !v)
          }}>
            <Pencil className="size-4" aria-hidden /> Dopolni načrt
          </Button>
        ) : null}
        {office && d.status === 'NACRTOVANO' ? (
          <Button size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('prepare')}>
            <Package className="size-4" aria-hidden /> Pripravi
          </Button>
        ) : null}
        {canTransit && d.status === 'PRIPRAVLJENO' ? (
          <Button size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('load')}>
            <Truck className="size-4" aria-hidden /> Natovari
          </Button>
        ) : null}
        {canTransit && d.status === 'NATOVARJENO' ? (
          <Button size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('depart')}>
            <Truck className="size-4" aria-hidden /> Na pot
          </Button>
        ) : null}
        {canTransit && d.status === 'NA_POTI' ? (
          <Button size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('deliver', recipientNote.trim() ? { recipientNote: recipientNote.trim() } : undefined)}>
            <CheckCircle2 className="size-4" aria-hidden /> Dostavljeno
          </Button>
        ) : null}
        {office && ['NACRTOVANO', 'PRIPRAVLJENO', 'NATOVARJENO'].includes(d.status) ? (
          <Button variant="destructive" size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('cancel', cancelNote.trim() ? { note: cancelNote.trim() } : undefined)}>
            <XCircle className="size-4" aria-hidden /> Prekliči
          </Button>
        ) : null}
      </div>

      {canTransit && d.status === 'NA_POTI' ? (
        <div className="space-y-1.5">
          <Label htmlFor="recipientNote">Prevzemnik / podpis na mestu (opcijsko)</Label>
          <Input id="recipientNote" value={recipientNote} onChange={(e) => setRecipientNote(e.target.value)} placeholder="npr. Prevzel g. Novak ob 14:05" />
        </div>
      ) : null}
      {office && ['NACRTOVANO', 'PRIPRAVLJENO', 'NATOVARJENO'].includes(d.status) ? (
        <div className="space-y-1.5">
          <Label htmlFor="cancelNote">Razlog preklica (opcijsko)</Label>
          <Input id="cancelNote" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder="npr. Stranka je prestavila termin" />
        </div>
      ) : null}

      {/* plan forma (zložljiva) */}
      {planOpen && office ? (
        <section aria-label="Dopolnitev načrta" className="space-y-3 rounded-xl border p-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dopolni načrt</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="planVehicle">Vozilo</Label>
              <Select value={planVehicle} onValueChange={setPlanVehicle}>
                <SelectTrigger id="planVehicle" className="min-h-11"><SelectValue placeholder="Brez vozila" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez vozila</SelectItem>
                  {(vehicles.data?.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.plate} — {v.name}{v.active ? '' : ' (neaktivno)'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planDriver">Voznik / odgovorna oseba</Label>
              <Select value={planDriver} onValueChange={setPlanDriver}>
                <SelectTrigger id="planDriver" className="min-h-11"><SelectValue placeholder="Brez voznika" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez voznika</SelectItem>
                  {(users.data?.data ?? []).filter((u) => u.active).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planAt">Načrtovani čas dostave</Label>
              <Input id="planAt" type="datetime-local" className="min-h-11" value={planAt} onChange={(e) => setPlanAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planAddress">Naslov dostave</Label>
              <Input id="planAddress" value={planAddress} onChange={(e) => setPlanAddress(e.target.value)} placeholder="Ulica in kraj" />
            </div>
          </div>
          <Button size="sm" disabled={busy !== ''} onClick={submitPlan}>
            {busy === 'plan' ? 'Shranjujem …' : 'Shrani načrt'}
          </Button>
        </section>
      ) : null}

      {!canTransit && !['DOSTAVLJENO', 'PREKLICANA'].includes(d.status) ? (
        <p className="text-xs text-muted-foreground">
          Prehode (natovarjanje, odhod, dostava) lahko izvede pisarna ali dodeljeni voznik dostave.
        </p>
      ) : null}
    </DialogContent>
  )
}

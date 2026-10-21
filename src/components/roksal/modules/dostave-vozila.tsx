'use client'

// DOSTAVE VOZILA (R549): zavihek vozil (kartice z aktivnostjo in številom
// dostav) + dialog novo vozilo (izvlečeno bajtno-identično iz dostave.tsx).

import { useState } from 'react'
import { CarFront, Plus } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { isOffice } from './dostave-shared'
import type { VehicleRow } from './dostave-shared'

// ─── ZAVIHEK: vozila ──────────────────────────────────────────────────────────

export function VozilaTab () {
  const user = useAppStore((s) => s.user)
  const vehicles = useApi<{ data: VehicleRow[] }>('/api/vehicles?all=1')
  const [addOpen, setAddOpen] = useState(false)
  const canWrite = isOffice(user)
  const rows = vehicles.data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{rows.length} vozil</Badge>
        {canWrite ? (
          <Button size="sm" className="ml-auto" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden /> Dodaj vozilo
          </Button>
        ) : null}
      </div>
      <ErrorBox error={vehicles.error} />
      {vehicles.loading ? <LoadingRows /> : !vehicles.error && rows.length === 0 ? (
        <EmptyState title="Ni vozil" desc="Dodajte prvo dostavno vozilo (registrska, ime, nosilnost)." icon={CarFront} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((v) => (
            <li key={v.id}>
              <Card className="h-full transition hover:border-roksal-amber/60">
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold text-roksal-amber">{v.plate}</span>
                    {v.active
                      ? <Badge variant="secondary" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">aktivno</Badge>
                      : <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">neaktivno</Badge>}
                  </div>
                  <div className="text-sm font-semibold leading-snug">{v.name}</div>
                  {v.capacityNote ? <div className="text-xs text-muted-foreground">{v.capacityNote}</div> : null}
                  <div className="text-xs text-muted-foreground">{v._count.deliveries} dostav</div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <VehicleDialog
          key={String(addOpen)} /* remount ob vsakem odprtju — sveža forma */
          onClose={() => setAddOpen(false)}
          onDone={async () => { await vehicles.reload() }}
        />
      </Dialog>
    </div>
  )
}

function VehicleDialog ({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const [plate, setPlate] = useState('')
  const [name, setName] = useState('')
  const [capacityNote, setCapacityNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    setBusy(true)
    try {
      await apiPost('/api/vehicles', {
        plate: plate.trim(),
        name: name.trim(),
        capacityNote: capacityNote.trim() || undefined,
      })
      toast({ title: 'Vozilo dodano.', description: `${plate.trim()} — ${name.trim()}` })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Dodajanje vozila ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Novo vozilo</DialogTitle>
        <DialogDescription>Registrska oznaka je unikatna — ponovni vnos vrne napako.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="veh-plate">Registrska oznaka *</Label>
          <Input id="veh-plate" className="min-h-11" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="npr. LJ 123-AB" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="veh-name">Ime / opis *</Label>
          <Input id="veh-name" className="min-h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Fiat Ducato — odprt" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="veh-cap">Nosilnost / prostor</Label>
          <Input id="veh-cap" className="min-h-11" value={capacityNote} onChange={(e) => setCapacityNote(e.target.value)} placeholder="npr. ~14 m³, nosilnost 1,2 t" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button disabled={busy || !plate.trim() || !name.trim()} onClick={submit}>{busy ? 'Dodajam …' : 'Dodaj vozilo'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

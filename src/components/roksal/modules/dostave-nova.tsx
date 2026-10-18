'use client'

// DOSTAVE NOVA (R549): nova dostava (pisarna) — izbira projekta, zaključene
// picking liste istega projekta, montažni termin, naslov in opomba (izvlečeno
// bajtno-identično iz dostave.tsx).

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { apiPost, useApi } from '@/lib/api-client'
import type { DeliveryRow, NalogOption, PickingOption, ProjectOption } from './dostave-shared'

// ─── nova dostava (pisarna) ───────────────────────────────────────────────────

export function NewDeliveryDialog ({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const projects = useApi<{ data: ProjectOption[] }>('/api/projects?limit=200', [])
  const picking = useApi<{ data: PickingOption[] }>('/api/picking?status=ZAKLJUCENA&limit=200', [])

  const [projectId, setProjectId] = useState('')
  const [pickingListId, setPickingListId] = useState('')
  const [workOrderId, setWorkOrderId] = useState('')
  const [plannedAt, setPlannedAt] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const nalogi = useApi<{ data: NalogOption[] }>(projectId ? `/api/nalog?projectId=${projectId}` : null, [projectId])

  // zaključene picking liste IZBRANEGA projekta (povezava teče prek BOM → paket → projekt)
  const projectPicks = useMemo(() => {
    const all = picking.data?.data ?? []
    const proj = (projects.data?.data ?? []).find((p) => p.id === projectId)
    if (!proj) return all
    return all.filter((p) => p.bom?.package?.project?.code === proj.code)
  }, [picking.data, projects.data, projectId])

  async function submit () {
    setBusy(true)
    try {
      const body: Record<string, unknown> = {}
      if (projectId) body.projectId = projectId
      if (pickingListId) body.pickingListId = pickingListId
      if (workOrderId) body.workOrderId = workOrderId
      if (plannedAt) body.plannedAt = new Date(plannedAt).toISOString()
      if (address.trim()) body.address = address.trim()
      if (note.trim()) body.note = note.trim()
      const res = await apiPost<{ data: DeliveryRow }>('/api/deliveries', body)
      toast({
        title: 'Dostava ustvarjena.',
        description: `${res.data.code} — ${res.data.items.length} vrstic${res.data.pickingList ? ` (iz ${res.data.pickingList.code})` : ''}.`,
      })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Ustvarjanje dostave ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Nova dostava</DialogTitle>
        <DialogDescription>
          Vrstice se kopirajo iz zaključene picking liste (s pobranimi količinami in artikelom) — dostava pa se lahko veže tudi na montažni termin.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="nd-project">Projekt</Label>
          <Select value={projectId} onValueChange={(v) => { setProjectId(v === 'none' ? '' : v); setPickingListId(''); setWorkOrderId('') }}>
            <SelectTrigger id="nd-project" className="min-h-11"><SelectValue placeholder="Brez projekta" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez projekta</SelectItem>
              {(projects.data?.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-picking">Picking lista (samo zaključene{projectId ? ' tega projekta' : ''})</Label>
          <Select value={pickingListId} onValueChange={(v) => setPickingListId(v === 'none' ? '' : v)}>
            <SelectTrigger id="nd-picking" className="min-h-11"><SelectValue placeholder="Brez picking liste" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez picking liste (prazna dostava)</SelectItem>
              {projectPicks.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.code}{p.bom?.package ? ` — ${p.bom.package.name}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-wo">Montažni termin (nalog)</Label>
          <Select value={workOrderId} onValueChange={(v) => setWorkOrderId(v === 'none' ? '' : v)} disabled={!projectId || (nalogi.data?.data.length ?? 0) === 0}>
            <SelectTrigger id="nd-wo" className="min-h-11"><SelectValue placeholder={projectId ? 'Brez vezave na nalog' : 'Najprej izberite projekt'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez vezave na nalog</SelectItem>
              {(nalogi.data?.data ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.code} — {w.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-at">Načrtovani čas dostave</Label>
          <Input id="nd-at" type="datetime-local" className="min-h-11" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-address">Naslov dostave</Label>
          <Input id="nd-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ulica in kraj" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-note">Opomba</Label>
          <Textarea id="nd-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Navodila vozniku, kontakt prevzemnika …" rows={2} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button disabled={busy} onClick={submit}>{busy ? 'Ustvarjam …' : 'Ustvari dostavo'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

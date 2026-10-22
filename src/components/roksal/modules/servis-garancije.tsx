'use client'

// SERVIS — zavihek GARANCIJE (obstoječi Warranty tok — R434, razširjen v R446)
// — R547 izvleček iz servis.tsx (razbitje po vzorcu R546; BREZ spremembe obnašanja).

import { useMemo, useState } from 'react'
import { CalendarClock, Plus, ShieldCheck } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { isOffice, type ProjectOption, type WarrantyRow } from './servis-shared'

// ═══ ZAVIHEK: GARANCIJE (obstoječi Warranty tok — R434, razširjen v R446) ═════

export function GarancijeTab () {
  const user = useAppStore((s) => s.user)
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const warranties = useApi<{ data: WarrantyRow[] }>('/api/warranty')
  const office = isOffice(user)
  const rows = warranties.data?.data ?? []
  const validCount = rows.filter((w) => w.valid).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">
          {rows.length} garancij{validCount > 0 ? ` · ${validCount} veljavnih` : ''}
        </Badge>
        {office ? (
          <Button size="sm" className="ml-auto min-h-11" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nova garancija
          </Button>
        ) : null}
      </div>

      <ErrorBox error={warranties.error} />
      {warranties.loading ? <LoadingRows /> : !warranties.error && rows.length === 0 ? (
        <EmptyState
          title="Ni garancij"
          desc="Garancijo oddate za zaključen ali arhiviran projekt."
          icon={ShieldCheck}
        />
      ) : (
        <AnimatedList className="space-y-2">
          {rows.map((w) => (
            <AnimatedListItem key={w.id}>
              <Card className="transition hover:border-roksal-amber/60">
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusBadge status={w.status} />
                    <Badge variant="secondary" className={w.valid
                      ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}>
                      {w.valid ? 'Velja' : 'Ne velja'}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{w.months} mesecev</span>
                  </div>
                  <div className="text-sm font-semibold leading-snug">
                    {w.project ? <>{w.project.code} — {w.project.title}</> : 'Brez projekta'}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {w.project?.customer ? <span>{w.project.customer.name}</span> : null}
                    <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" aria-hidden /> do {fmtDate(w.endsAt)}</span>
                    <span>{w.visits.length} obiskov</span>
                  </div>
                  <Button variant="outline" size="sm" className="mt-1 min-h-11" onClick={() => setSelected(w.id)}>
                    Podrobnosti in obiski
                  </Button>
                </CardContent>
              </Card>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <WarrantyDetailDialog
          id={selected}
          office={office}
          onClose={() => setSelected(null)}
          onDone={async () => { await warranties.reload() }}
        />
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewWarrantyDialog
          key={String(createOpen)}
          warranties={rows}
          onClose={() => setCreateOpen(false)}
          onDone={async () => { await warranties.reload() }}
        />
      </Dialog>
    </div>
  )
}

/** Podrobnost garancije + obiski (obstoječa /api/warranty rute — R434). */
function WarrantyDetailDialog ({ id, office, onClose, onDone }: {
  id: string | null; office: boolean; onClose: () => void; onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  // podrobnost vzamemo iz seznama (enoten vir /api/warranty)
  const list = useApi<{ data: WarrantyRow[] }>(id ? '/api/warranty' : null, [id])
  const w = useMemo(() => list.data?.data.find((x) => x.id === id) ?? null, [list.data, id])
  const [visitNote, setVisitNote] = useState('')
  const [visitDate, setVisitDate] = useState('')
  const [busy, setBusy] = useState(false)

  async function addVisit () {
    if (!w) return
    const note = visitNote.trim()
    if (!note) {
      toast({ title: 'Opis obiska je obvezen.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost('/api/warranty', {
        warrantyId: w.id, visitNote: note, ...(visitDate ? { visitDate: new Date(visitDate).toISOString() } : {}),
      })
      toast({ title: 'Obisk garancije zabeležen.', description: w.project?.code })
      setVisitNote(''); setVisitDate('')
      await list.reload()
      await onDone()
    } catch (e) {
      toast({ title: 'Obiska ni bilo mogoče zabeležiti', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-5 text-roksal-amber" aria-hidden />
          Garancija — {w?.project?.code ?? '…'}
        </DialogTitle>
        <DialogDescription>
          {w ? `${w.project?.title ?? ''} · velja do ${fmtDate(w.endsAt)} (${w.months} mesecev)` : 'Podrobnosti garancije.'}
        </DialogDescription>
      </DialogHeader>

      {list.loading ? <LoadingRows rows={2} /> : !w ? (
        <ErrorBox error={list.error ?? { message: 'Garancija ni na voljo.' }} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={w.status} />
            <Badge variant="secondary" className={w.valid
              ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}>
              {w.valid ? 'Velja' : 'Ne velja'}
            </Badge>
            <span className="text-xs text-muted-foreground">začetek {fmtDate(w.startsAt)}</span>
          </div>
          {w.note ? <p className="text-sm text-muted-foreground">{w.note}</p> : null}

          <div>
            <h4 className="mb-2 text-sm font-semibold">Obiski garancije ({w.visits.length})</h4>
            {w.visits.length === 0 ? (
              <p className="text-sm text-muted-foreground">Še ni obiskov.</p>
            ) : (
              <AnimatedList className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {w.visits.map((v) => (
                  <AnimatedListItem key={v.id} className="rounded-lg border p-2.5 text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CalendarClock className="size-3" aria-hidden /> {fmtDateTime(v.date)}
                    </div>
                    <div className="mt-0.5">{v.note}</div>
                  </AnimatedListItem>
                ))}
              </AnimatedList>
            )}
          </div>

          {office ? (
            <div className="space-y-2 rounded-lg border p-3">
              <Label htmlFor="war-visit-note">Nov obisk garancije</Label>
              <Textarea
                id="war-visit-note" value={visitNote} onChange={(e) => setVisitNote(e.target.value)}
                placeholder="Npr. letni pregled zaključnih profilov, sprednji vrt"
                className="min-h-20"
              />
              <Input
                type="date" aria-label="Datum obiska garancije" value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
              />
              <Button size="sm" className="min-h-11 w-full sm:w-auto" disabled={busy} onClick={addVisit}>
                <Plus className="size-4" aria-hidden /> Zabeleži obisk
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </DialogContent>
  )
}

/** Nova garancija — samo ZAKLJUCEN/ARHIV projekti brez obstoječe garancije. */
function NewWarrantyDialog ({ warranties, onClose, onDone }: {
  warranties: WarrantyRow[]; onClose: () => void; onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  const projects = useApi<{ data: ProjectOption[] }>('/api/projects?limit=500')
  const [projectId, setProjectId] = useState('')
  const [months, setMonths] = useState('24')
  const [startsAt, setStartsAt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const covered = new Set(warranties.map((w) => w.projectId))
  const eligible = (projects.data?.data ?? []).filter((p) =>
    (p.status === 'ZAKLJUCEN' || p.status === 'ARHIV') && !covered.has(p.id))

  async function submit () {
    if (!projectId) {
      toast({ title: 'Izberite projekt.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost('/api/warranty', {
        projectId,
        months: Number(months) || 24,
        ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      toast({ title: 'Garancija oddana.', description: `Za ${months} mesecev.` })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Garancije ni bilo mogoče oddati', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Nova garancija</DialogTitle>
        <DialogDescription>
          Garancijo je mogoče oddati samo za zaključen ali arhiviran projekt, ki je še nima.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="war-proj">Projekt</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="war-proj" className="min-h-11"><SelectValue placeholder="Izberite projekt" /></SelectTrigger>
            <SelectContent>
              {eligible.length === 0 ? <div className="p-2 text-sm text-muted-foreground">Ni upravičenih projektov.</div> : null}
              {eligible.map((p) => (
                <SelectItem key={p.id} value={p.id} className="min-h-11">
                  {p.code} — {p.title}{p.customer ? ` (${p.customer.name})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="war-months">Trajanje (mesecev)</Label>
            <Input id="war-months" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} className="min-h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="war-start">Začetek</Label>
            <Input id="war-start" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="min-h-11" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="war-note">Opomba (opcijsko)</Label>
          <Textarea id="war-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" className="min-h-11" onClick={onClose}>Prekliči</Button>
        <Button className="min-h-11" disabled={busy || !projectId} onClick={submit}>Oddaj garancijo</Button>
      </DialogFooter>
    </DialogContent>
  )
}

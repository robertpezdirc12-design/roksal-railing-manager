'use client'

// DANES — sekcije podrobnosti naloga: kontrolni seznam, poraba materiala,
// težave na terenu in poročilo o predaji — R548 izvleček iz danes.tsx
// (razbitje po vzorcu R546/R547; BREZ spremembe obnašanja).

import { useState } from 'react'
import {
  Check, CheckCheck, ClipboardList, Loader2, Package, Plus, TriangleAlert,
} from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { apiPatch, apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import {
  type ChecklistRow, type StockRow, type UsageRow, type WorkOrderDetailRow,
} from './danes-shared'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'

// ─── kontrolni seznam ────────────────────────────────────────────────────────

export function ChecklistSection ({ woId, rows, loading, error, done, canWrite, onReload }: {
  woId: string
  rows: ChecklistRow[]
  loading: boolean
  error: { message: string; detail?: string } | null
  done: number
  canWrite: boolean
  onReload: () => void
}) {
  const { toast } = useToast()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function addItem () {
    const l = label.trim()
    if (!l) { toast({ title: 'Zapiši besedilo točke.', variant: 'destructive' }); return }
    setBusy('add')
    try {
      await apiPost(`/api/nalog/${woId}/checklist`, { label: l })
      toast({ title: 'Točka dodana.', description: l })
      setLabel('')
      onReload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  async function toggle (row: ChecklistRow) {
    setBusy(row.id)
    try {
      await apiPatch(`/api/nalog/${woId}/checklist`, { id: row.id, done: !row.done })
      onReload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const total = rows.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <section aria-label="Kontrolni seznam" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <ClipboardList className="size-4 text-roksal-amber" aria-hidden /> Kontrolni seznam
        </h3>
        {total > 0 ? (
          <span className={cn('text-xs font-semibold', done === total ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {done}/{total} opravljeno
          </span>
        ) : null}
      </div>
      {total > 0 ? <Progress value={pct} aria-label={`Napredek kontrolnega seznama ${pct} odstotkov`} className="mb-3 h-2" /> : null}

      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={2} /> : !error && total === 0 ? (
        <p className="text-sm text-muted-foreground">Ni točk — dodaj prvo (npr. »Preverjena vodovodna instalacija«).</p>
      ) : !error ? (
        <AnimatedList className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {rows.map((row) => (
            <AnimatedListItem key={row.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={row.done}
                aria-label={`${row.label} — ${row.done ? 'opravljeno' : 'neopravljeno'}`}
                disabled={!!busy || !canWrite}
                onClick={() => void toggle(row)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition',
                  row.done ? 'text-muted-foreground' : 'text-foreground',
                  'hover:bg-secondary/50 focus-visible:outline-2 focus-visible:outline-ring',
                  (busy === row.id || !canWrite) && 'opacity-60',
                )}
              >
                {busy === row.id ? (
                  <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  // R445: čisto VIZUALNI kvadratek (span) — zunanji <button role="checkbox"> že
                  // nosi interakcijo; gnezdjen <button> znotraj <button> (Radix Checkbox) je
                  // NEVELJAVEN HTML in sproža hidratacijsko napako (popravek R444 ostanka).
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs transition-shadow outline-none',
                      'dark:bg-input/30',
                      row.done ? 'bg-primary text-primary-foreground' : 'bg-transparent',
                    )}
                  >
                    {row.done ? <Check className="size-3.5" aria-hidden /> : null}
                  </span>
                )}
                <span className={cn('flex-1 text-sm leading-snug', row.done && 'line-through decoration-muted-foreground/60')}>
                  {row.label}
                </span>
                {row.done && row.doneBy ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{row.doneBy.name}</span>
                ) : null}
              </button>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      ) : null}

      {canWrite ? (
        <div className="mt-3 flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addItem() }}
            placeholder="Nova točka kontrolnega seznama …"
            aria-label="Nova točka kontrolnega seznama"
            className="h-11"
            maxLength={300}
          />
          <Button className="h-11 shrink-0 px-3" disabled={busy === 'add' || !label.trim()} onClick={() => void addItem()} aria-label="Dodaj točko">
            {busy === 'add' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

// ─── poraba materiala ────────────────────────────────────────────────────────

export function MaterialSection ({ woId, rows, loading, error, canUse, onReload }: {
  woId: string
  rows: UsageRow[]
  loading: boolean
  error: { message: string; detail?: string } | null
  canUse: boolean
  onReload: () => void
}) {
  const { toast } = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [itemId, setItemId] = useState('none')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // katalog artiklov za izbiro (monter vidi samo inventory.read podatke)
  const stock = useApi<{ data: StockRow[] }>(formOpen ? '/api/stock' : null, [formOpen])
  const items = stock.data?.data ?? []
  const selected = items.find((it) => it.id === itemId)

  async function submit () {
    if (itemId === 'none') { toast({ title: 'Izberi artikel.', variant: 'destructive' }); return }
    const q = Number(qty)
    if (!Number.isFinite(q) || q <= 0) { toast({ title: 'Količina mora biti pozitivno število.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      const res = await apiPost<{ data: UsageRow }>(`/api/nalog/${woId}/material`, {
        itemId, qty: q, note: note.trim() || null,
      })
      toast({
        title: 'Poraba zabeležena.',
        description: `${res.data.item.sku}: fizična zaloga je sedaj ${res.data.item.qty} ${res.data.item.unit} (gibanje IZDAJA).`,
      })
      setItemId('none'); setQty(''); setNote('')
      onReload()
      setFormOpen(false)
    } catch (e) {
      toast({ title: 'Napaka pri zapisu porabe', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Poraba materiala" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Package className="size-4 text-roksal-amber" aria-hidden /> Poraba materiala
        </h3>
        {rows.length > 0 ? <span className="text-xs font-semibold text-muted-foreground">{rows.length} zapisov</span> : null}
      </div>

      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={2} /> : !error && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Na tem nalogu še ni porabe materiala.</p>
      ) : !error ? (
        <AnimatedList className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {rows.map((r) => (
            <AnimatedListItem key={r.id} className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-secondary/40 px-3 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  <span className="font-mono text-xs text-muted-foreground">{r.item.sku}</span> · {r.item.name}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {fmtDateTime(r.createdAt)} · {r.user?.name ?? '—'}
                  {r.note ? ` · ${r.note}` : ''}
                </div>
              </div>
              <span className="shrink-0 font-mono text-sm font-bold text-foreground">−{r.qty} {r.item.unit}</span>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      ) : null}

      {canUse ? (
        formOpen ? (
          <div className="mt-3 space-y-2 rounded-lg border bg-secondary/30 p-3">
            <div className="space-y-1.5">
              <Label>Artikel</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger className="h-11" aria-label="Artikel porabe">
                  <SelectValue placeholder={stock.loading ? 'Nalagam …' : 'Izberi artikel'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {items.map((it) => (
                    <SelectItem key={it.id} value={it.id} className="py-2">
                      {it.sku} — {it.name} (razpoložljivo {it.available} {it.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected ? (
                <p className="text-xs text-muted-foreground">
                  Fizična: {selected.physical} {selected.unit} · rezervirana: {selected.reserved} · razpoložljiva: {selected.available}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor={`mat-qty-${woId}`}>Količina</Label>
                <Input
                  id={`mat-qty-${woId}`} type="number" min="0" step="any" className="h-11"
                  value={qty} onChange={(e) => setQty(e.target.value)} placeholder="npr. 4.5"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`mat-note-${woId}`}>Opomba</Label>
                <Input
                  id={`mat-note-${woId}`} className="h-11"
                  value={note} onChange={(e) => setNote(e.target.value)} placeholder="neobvezno"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 flex-1" disabled={busy} onClick={() => void submit()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Package className="size-4" aria-hidden />}
                Zabeleži porabo
              </Button>
              <Button variant="outline" className="h-11" disabled={busy} onClick={() => setFormOpen(false)}>Prekliči</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="mt-3 h-11 w-full" onClick={() => setFormOpen(true)}>
            <Plus className="size-4" aria-hidden /> Zabeleži porabo materiala
          </Button>
        )
      ) : null}
    </section>
  )
}

// ─── težave na terenu (dogodek TEZAVA) ───────────────────────────────────────

export function TroubleSection ({ woId, troubles, canWrite, onReload }: {
  woId: string
  troubles: { id: string; note: string | null; createdAt: string; user: { name: string } | null }[]
  canWrite: boolean
  onReload: () => void
}) {
  const { toast } = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    const n = note.trim()
    if (!n) { toast({ title: 'Opiši težavo.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost(`/api/nalog/${woId}/events`, { type: 'TEZAVA', note: n })
      toast({ title: 'Težava zabeležena.', description: 'Pisarna jo vidi v dogodkih naloga.' })
      setNote(''); setFormOpen(false)
      onReload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Težave na terenu" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <TriangleAlert className="size-4 text-roksal-amber" aria-hidden /> Težave
        </h3>
        {troubles.length > 0 ? (
          <span className="text-xs font-semibold text-red-600 dark:text-red-400">{troubles.length}</span>
        ) : null}
      </div>

      {troubles.length > 0 ? (
        <AnimatedList className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {troubles.map((t) => (
            <AnimatedListItem key={t.id} className="min-h-11 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 dark:bg-amber-500/15">
              <p className="text-sm font-medium leading-snug text-foreground">{t.note}</p>
              <p className="text-[11px] text-muted-foreground">{fmtDateTime(t.createdAt)} · {t.user?.name ?? '—'}</p>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      ) : (
        <p className="text-sm text-muted-foreground">Brez zabeleženih težav.</p>
      )}

      {canWrite ? (
        formOpen ? (
          <div className="mt-3 space-y-2">
            <Label htmlFor={`trz-${woId}`}>Opiši težavo</Label>
            <Textarea
              id={`trz-${woId}`} rows={3} value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Kaj je šlo narobe, kaj manjka, kaj blokira montažo …"
              maxLength={1000}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="destructive" className="h-11 flex-1" disabled={busy} onClick={() => void submit()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
                Zabeleži težavo
              </Button>
              <Button variant="outline" className="h-11" disabled={busy} onClick={() => setFormOpen(false)}>Prekliči</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="mt-3 h-11 w-full" onClick={() => setFormOpen(true)}>
            <TriangleAlert className="size-4" aria-hidden /> Zabeleži težavo
          </Button>
        )
      ) : null}
    </section>
  )
}

// ─── PREDAJA — poročilo o predaji ────────────────────────────────────────────

export function PredajaReport ({ wo, clDone, clTotal, usageCount }: {
  wo: WorkOrderDetailRow
  clDone: number
  clTotal: number
  usageCount: number
}) {
  return (
    <section aria-label="Poročilo o predaji" className="rounded-xl border border-roksal-green/40 bg-roksal-green/5 p-3">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        <CheckCheck className="size-4 text-roksal-green" aria-hidden /> Poročilo o predaji
      </h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase text-muted-foreground">Zaključek</dt>
          <dd className="font-semibold">{fmtDateTime(wo.completedAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase text-muted-foreground">Meritve</dt>
          <dd className="font-semibold">{wo.measurements.length}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase text-muted-foreground">Checklist</dt>
          <dd className="font-semibold">{clTotal > 0 ? `${clDone}/${clTotal}` : '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase text-muted-foreground">Poraba materiala</dt>
          <dd className="font-semibold">{usageCount} zapisov</dd>
        </div>
      </dl>
      {wo.summary ? (
        <p className="mt-2 whitespace-pre-line rounded-lg bg-background/60 p-2 text-sm leading-relaxed">{wo.summary}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Nalog je zaključen brez povzetka.</p>
      )}
    </section>
  )
}

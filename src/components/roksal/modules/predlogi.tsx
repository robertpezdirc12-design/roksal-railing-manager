'use client'

// PREDLOGI NAROČILA — R452 (issue #7 §16 P3: avtomatski predlog materiala).
// Pravilo: povpraševanje iz odprtih kosovnic (OSNUTEK/POTRJEN/REZERVIRAN)
// − razpoložljiva zaloga (fizična − rezervirana, R443) + dopolnitev do
// 2× meje naročanja pri nizki zalogi. Vrstice so privzeto izbrane, količine
// PRILAGODLJIVE; »Ustvari naročilo« PONOVNO UPORABI audited ruto
// /api/material-orders (ni podvajanja logike). Monter (samo inventory.read)
// vidi tabelo read-only BREZ ustvarjanja.

import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardList, PackageCheck, ShoppingCart, Trash2, Truck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { apiPost, fmtEUR, useApi } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'

// ─── tipi (odgovor /api/material-suggestions) ────────────────────────────────

interface SuggestionRow {
  itemId: string; sku: string; name: string; unit: string
  demand: number; reserved: number; physical: number; available: number
  missing: number; lowStock: boolean; suggestedQty: number; unitCost: number
  supplierId: string | null; supplierName: string | null; boms: number
}

interface SuggestionsData {
  generatedAt: string
  items: SuggestionRow[]
  rules: { demandStatuses: string[]; replenishFactor: number }
}

interface SupplierRow { id: string; name: string }

const DEFAULT_NOTE = 'Avtomatski predlog materiala'

export default function PredlogiModule () {
  const perms = useAppStore((s) => s.user?.perms) ?? []
  const canWrite = perms.includes('inventory.write') // monter: SAMO branje
  const { toast } = useToast()

  const { data, loading, error, reload } = useApi<{ data: SuggestionsData }>('/api/material-suggestions')
  // dobavitelje nalagamo samo, če uporabnik lahko ustvari naročilo
  const suppliers = useApi<{ data: SupplierRow[] }>(canWrite ? '/api/suppliers' : null)

  // stabilna referenca (useMemo): med nalaganjem data=null → ?? [] bi sicer
  // ustvarilo NOVO prazno tabelo na vsakem renderu → useEffect [items] podvoji
  // setState v zanko („Maximum update depth exceeded" ob počasnejšem nalaganju)
  const items = useMemo(() => data?.data?.items ?? [], [data])
  const rules = data?.data?.rules

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [supplierId, setSupplierId] = useState<string>('')
  const [note, setNote] = useState<string>(DEFAULT_NOTE)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ code: string } | null>(null)

  // ob (ponovnem) nalaganju: VSE vrstice izbrane, količine = predlog (privzeto)
  useEffect(() => {
    setSelected(new Set(items.map((i) => i.itemId)))
    setQtys(Object.fromEntries(items.map((i) => [i.itemId, String(i.suggestedQty)])))
  }, [items])

  const rows = useMemo(() => items.map((i) => {
    const qty = Number(qtys[i.itemId] ?? i.suggestedQty)
    const q = Number.isFinite(qty) && qty > 0 ? qty : 0
    return { ...i, qty: q, amount: Math.round(q * i.unitCost * 100) / 100 }
  }), [items, qtys])

  const selectedRows = rows.filter((r) => selected.has(r.itemId))
  const totalAmount = selectedRows.reduce((s, r) => s + r.amount, 0)

  const allSelected = items.length > 0 && selected.size === items.length
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.itemId)))

  /** Ustvari naročilo prek obstoječe audited rute /api/material-orders. */
  const createOrder = async () => {
    const lines = selectedRows
      .filter((r) => r.qty > 0)
      .map((r) => ({ itemId: r.itemId, itemName: r.name, qty: r.qty, unit: r.unit, unitPrice: r.unitCost }))
    if (lines.length === 0) {
      toast({ title: 'Ni izbranih pozicij', description: 'Označite vsaj eno vrstico s količino > 0.', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const res = await apiPost<{ data: { code: string } }>('/api/material-orders', {
        ...(supplierId ? { supplierId } : {}),
        note: note.trim() || DEFAULT_NOTE,
        lines,
      })
      setCreated({ code: res.data.code })
      toast({ title: 'Naročilo ustvarjeno', description: `${res.data.code} — ${lines.length} pozicij, ${fmtEUR(totalAmount)}.` })
      await reload() // predlogi se poberejo (manjka/lowStock se zmanjša)
    } catch (e) {
      toast({ title: 'Ustvarjanje naročila ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Predlogi naročila"
        desc={`Avtomatski predlog materiala — povpraševanje iz odprtih kosovnic (${rules?.demandStatuses.join(', ') ?? 'OSNUTEK, POTRJEN, REZERVIRAN'}) − razpoložljiva zaloga + dopolnitev nizke zaloge do ${rules?.replenishFactor ?? 2}× meje naročanja (R452).`}
        actions={
          <Badge variant="secondary" className="hidden border-transparent bg-secondary sm:inline-flex">
            <ClipboardList className="mr-1 size-3.5" aria-hidden /> {items.length} predlogov
          </Badge>
        }
      />
      <ErrorBox error={error} />

      {/* pasica uspešno ustvarjenega naročila */}
      {created ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="flex min-w-0 items-center gap-3">
            <PackageCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <div className="min-w-0 text-sm">
              <span className="font-semibold text-emerald-800 dark:text-emerald-200">Ustvarjeno naročilo {created.code}{' '}</span>
              <span className="ml-2 text-emerald-700/80 dark:text-emerald-300/80">vidno pod Skladišče → Zaloga (nabava).</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCreated(null)} className="min-h-11" aria-label="Počisti pasico ustvarjenega naročila">
            <Trash2 className="size-4" aria-hidden /> Počisti
          </Button>
        </div>
      ) : null}

      {loading ? <LoadingRows rows={4} /> : items.length === 0 ? (
        <EmptyState
          title="Ni predlogov"
          desc="Vsa povpraševanja so pokrita in zaloga nad mejami naročila."
          icon={PackageCheck}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    {canWrite ? (
                      <TableHead className="w-12 pl-4">
                        <span className="flex size-11 items-center justify-center">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={toggleAll}
                            aria-label={allSelected ? 'Odznači vse vrstice' : 'Izberi vse vrstice'}
                          />
                        </span>
                      </TableHead>
                    ) : null}
                    <TableHead className={cn('font-medium', canWrite ? '' : 'pl-4')}>Artikel</TableHead>
                    <TableHead className="text-right font-medium">Povpr.</TableHead>
                    <TableHead className="hidden text-right font-medium lg:table-cell">Rezerv.</TableHead>
                    <TableHead className="hidden text-right font-medium lg:table-cell">Fizična</TableHead>
                    <TableHead className="hidden text-right font-medium md:table-cell">Razpol.</TableHead>
                    <TableHead className="text-right font-medium">Manjka</TableHead>
                    <TableHead className="font-medium">Predlagano</TableHead>
                    <TableHead className="text-right font-medium">Znesek</TableHead>
                    <TableHead className="hidden pr-4 font-medium md:table-cell">Dobavitelj</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.itemId} data-testid="predlog-vrstica">
                      {canWrite ? (
                        <TableCell className="pl-4">
                          <span className="flex size-11 items-center justify-center">
                            <Checkbox
                              checked={selected.has(r.itemId)}
                              onCheckedChange={() => toggle(r.itemId)}
                              aria-label={`Izberi ${r.sku} ${r.name}`}
                            />
                          </span>
                        </TableCell>
                      ) : null}
                      <TableCell className={cn('max-w-52', canWrite ? '' : 'pl-4')}>
                        <div className="font-mono text-xs font-semibold text-roksal-amber">{r.sku}</div>
                        <div className="truncate text-sm font-medium" title={r.name}>{r.name}</div>
                        {r.boms > 0 ? (
                          <div className="text-[11px] text-muted-foreground">{r.boms} {r.boms === 1 ? 'kosovnica' : r.boms === 2 ? 'kosovnici' : 'kosovnic'}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{fmtQty(r.demand)}</TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums lg:table-cell">{fmtQty(r.reserved)}</TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums lg:table-cell">{fmtQty(r.physical)}</TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums md:table-cell">{fmtQty(r.available)}</TableCell>
                      <TableCell className={cn('text-right font-mono font-bold tabular-nums', r.missing > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                        {fmtQty(r.missing)}
                      </TableCell>
                      <TableCell>
                        {canWrite ? (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={qtys[r.itemId] ?? String(r.suggestedQty)}
                            onChange={(e) => setQtys((prev) => ({ ...prev, [r.itemId]: e.target.value }))}
                            aria-label={`Predlagana količina za ${r.sku} ${r.name}`}
                            className="h-11 w-24 text-right font-mono tabular-nums"
                          />
                        ) : (
                          <span className="font-mono font-semibold tabular-nums">{fmtQty(r.suggestedQty)}</span>
                        )}
                        <span className="ml-1.5 text-xs text-muted-foreground">{r.unit}</span>
                        {r.lowStock ? (
                          <div className="mt-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">nizka zaloga</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {fmtEUR(r.amount)}
                        <div className="text-[11px] font-normal text-muted-foreground">{fmtEUR(r.unitCost)}/{r.unit}</div>
                      </TableCell>
                      <TableCell className="hidden pr-4 md:table-cell">
                        {r.supplierName ? (
                          <Badge variant="outline" className="max-w-40 truncate border-transparent bg-secondary font-normal">
                            <Truck className="mr-1 size-3 shrink-0" aria-hidden /> {r.supplierName}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* noga: skupaj znesek izbranih pozicij */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                {canWrite ? `${selectedRows.length} od ${rows.length} izbranih` : `${rows.length} predlogov`}
              </span>
              <span className="font-semibold">
                Skupaj: <span className="font-mono tabular-nums">{fmtEUR(totalAmount)}</span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ustvarjanje naročila — SAMO inventory.write (monter ne vidi) */}
      {canWrite && items.length > 0 ? (
        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="predlog-supplier" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dobavitelj naročila</label>
              <Select value={supplierId || 'none'} onValueChange={(v) => setSupplierId(v === 'none' ? '' : v)}>
                <SelectTrigger id="predlog-supplier" className="min-h-11 w-full" aria-label="Dobavitelj naročila">
                  <SelectValue placeholder="Brez dobavitelja" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez dobavitelja</SelectItem>
                  {(suppliers.data?.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="predlog-note" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Opomba</label>
              <Input
                id="predlog-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-11"
                placeholder="Opomba naročila"
                maxLength={200}
              />
            </div>
            <Button onClick={createOrder} disabled={creating || selectedRows.filter((r) => r.qty > 0).length === 0} className="min-h-11 px-5">
              <ShoppingCart className="size-4" aria-hidden />
              {creating ? 'Ustvarjanje …' : 'Ustvari naročilo'}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

/** Količina v slovenski obliki (največ 2 decimalki). */
function fmtQty (n: number): string {
  return n.toLocaleString('sl-SI', { maximumFractionDigits: 2 })
}

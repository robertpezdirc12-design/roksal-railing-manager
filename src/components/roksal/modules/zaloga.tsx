'use client'

// ZALOGA — stanje artiklov, sprejem pošiljk, losi (vrata inventory.read; sprejem = procurement.receive; popravek = inventory.write)

import { useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Layers, PackagePlus, PackageSearch, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDateTime, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatCard } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface LotRow {
  id: string; qty: number; unitCost: number; deliveredAt: string
  supplier: { name: string } | null
  item?: { sku: string; name: string; unit: string } | null
}

interface ItemRow {
  id: string; sku: string; name: string; unit: string; qty: number; reorderAt: number
  location: string | null; avgPrice: number; lastPrice: number; lots: LotRow[]
}

interface SupplierRow { id: string; name: string; email: string | null; phone: string | null }

export default function ZalogaModule () {
  const user = useAppStore((s) => s.user)
  const [q, setQ] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [adjustItem, setAdjustItem] = useState<ItemRow | null>(null)

  const items = useApi<{ data: ItemRow[] }>('/api/inventory')
  const lots = useApi<{ data: LotRow[] }>('/api/inventory/lots?limit=10')
  const suppliers = useApi<{ data: SupplierRow[] }>(receiveOpen ? '/api/suppliers' : null, [receiveOpen])

  const canReceive = hasPerm(user?.perms, 'procurement.receive')
  const canAdjust = hasPerm(user?.perms, 'inventory.write')

  const rows = useMemo(() => {
    const all = items.data?.data ?? []
    const needle = q.trim().toLowerCase()
    return all
      .filter((it) => (lowOnly ? it.qty <= it.reorderAt : true))
      .filter((it) => (needle ? `${it.sku} ${it.name} ${it.location ?? ''}`.toLowerCase().includes(needle) : true))
  }, [items.data, q, lowOnly])

  const lowCount = useMemo(() => (items.data?.data ?? []).filter((it) => it.qty <= it.reorderAt).length, [items.data])
  const stockValue = useMemo(
    () => (items.data?.data ?? []).reduce((s, it) => s + it.qty * (it.avgPrice || it.lastPrice), 0),
    [items.data]
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Zaloga"
        desc="Stanje artiklov, sprejem pošiljk in zadnji losi"
        actions={canReceive ? (
          <Button size="sm" onClick={() => setReceiveOpen(true)}>
            <PackagePlus className="size-4" aria-hidden /> Sprejem pošiljke
          </Button>
        ) : null}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Artikli" value={items.data?.data.length ?? '—'} icon={Boxes} hint="v celotnem seznamu" />
        <StatCard label="Pod mejo naročanja" value={lowCount} icon={AlertTriangle} tone={lowCount > 0 ? 'red' : 'green'} hint="artiklov za naročilo" />
        <StatCard label="Vrednost zaloge" value={fmtEUR(stockValue)} icon={Layers} hint="po povprečnih cenah lotov" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči po SKU, imenu, lokaciji …" className="pl-8" aria-label="Iskanje artiklov" />
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium">
          <Switch checked={lowOnly} onCheckedChange={setLowOnly} aria-label="Samo pod mejo naročanja" />
          Samo pod mejo
        </label>
      </div>

      <ErrorBox error={items.error} />
      {items.loading ? <LoadingRows /> : !items.error && rows.length === 0 ? (
        <EmptyState title="Ni artiklov" desc={lowOnly ? 'Noben artikel ni pod mejo naročanja.' : 'Sprejmite prvo pošiljko ali spremenite filter.'} icon={PackageSearch} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[28rem] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">SKU</TableHead>
                    <TableHead>Ime</TableHead>
                    <TableHead>Enota</TableHead>
                    <TableHead className="text-right">Količina</TableHead>
                    <TableHead className="text-right">Meja</TableHead>
                    <TableHead>Lokacija</TableHead>
                    <TableHead className="text-right">Povp. cena</TableHead>
                    <TableHead className="text-right">Zadnja cena</TableHead>
                    {canAdjust ? <TableHead className="pr-4 text-right">Popravek</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((it) => {
                    const low = it.qty <= it.reorderAt
                    return (
                      <TableRow key={it.id} className={low ? 'bg-red-50 dark:bg-red-950/40' : undefined}>
                        <TableCell className="pl-4 font-mono text-xs font-semibold text-roksal-amber">{it.sku}</TableCell>
                        <TableCell className="font-medium">
                          {it.name}
                          {low ? <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400"><AlertTriangle className="size-3" aria-hidden />pod mejo</span> : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{it.unit}</TableCell>
                        <TableCell className={`text-right font-bold ${low ? 'text-red-600 dark:text-red-400' : ''}`}>{it.qty}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{it.reorderAt}</TableCell>
                        <TableCell className="text-muted-foreground">{it.location ?? '—'}</TableCell>
                        <TableCell className="text-right">{it.avgPrice > 0 ? fmtEUR(it.avgPrice) : '—'}</TableCell>
                        <TableCell className="text-right">{it.lastPrice > 0 ? fmtEUR(it.lastPrice) : '—'}</TableCell>
                        {canAdjust ? (
                          <TableCell className="pr-4 text-right">
                            <Button variant="outline" size="sm" onClick={() => setAdjustItem(it)} aria-label={`Popravek količine za ${it.sku}`}>
                              ±
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* zadnji losi */}
      <section aria-label="Zadnji losi" className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Zadnji losi (10)</h2>
        <ErrorBox error={lots.error} />
        {lots.loading ? <LoadingRows rows={3} /> : !lots.error && (lots.data?.data.length ?? 0) === 0 ? (
          <EmptyState title="Ni lotov" desc="Sprejem pošiljke bo ustvaril prvi lot." icon={Layers} />
        ) : (
          <Card>
            <CardContent className="max-h-96 overflow-y-auto p-0">
              <ul className="divide-y">
                {(lots.data?.data ?? []).map((lot) => (
                  <li key={lot.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{lot.item?.name ?? lot.id}</span>
                      {lot.item ? <span className="ml-2 font-mono text-xs text-muted-foreground">{lot.item.sku}</span> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{lot.qty} {lot.item?.unit ?? ''}</span>
                      <span>{fmtEUR(lot.unitCost)}/en.</span>
                      <span>{lot.supplier?.name ?? 'Brez dobavitelja'}</span>
                      <span>{fmtDateTime(lot.deliveredAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      {/* sprejem pošiljke */}
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <ReceiveDialog
          items={items.data?.data ?? []}
          suppliers={suppliers.data?.data ?? []}
          suppliersLoading={suppliers.loading}
          onClose={() => setReceiveOpen(false)}
          onDone={async () => { await Promise.all([items.reload(), lots.reload()]) }}
        />
      </Dialog>

      {/* ročni popravek */}
      <Dialog open={!!adjustItem} onOpenChange={(o) => { if (!o) setAdjustItem(null) }}>
        <AdjustDialog
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
          onDone={async () => { setAdjustItem(null); await Promise.all([items.reload(), lots.reload()]) }}
        />
      </Dialog>
    </div>
  )
}

function ReceiveDialog ({ items, suppliers, suppliersLoading, onClose, onDone }: {
  items: ItemRow[]
  suppliers: SupplierRow[]
  suppliersLoading: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  const [itemId, setItemId] = useState('none')
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [supplierId, setSupplierId] = useState('none')
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const selected = items.find((it) => it.id === itemId)

  async function submit () {
    if (itemId === 'none') { toast({ title: 'Izberite artikel.', variant: 'destructive' }); return }
    const q = Number(qty)
    const c = Number(unitCost)
    if (!Number.isFinite(q) || q <= 0) { toast({ title: 'Količina mora biti pozitivno število.', variant: 'destructive' }); return }
    if (!Number.isFinite(c) || c < 0) { toast({ title: 'Nabavna cena mora biti veljavno število.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/inventory/lots', { itemId, qty: q, unitCost: c, supplierId: supplierId === 'none' ? null : supplierId })
      toast({ title: 'Pošiljka sprejeta.', description: `${q} × ${selected?.name ?? 'artikel'} dodano v zalogo.` })
      setQty(''); setUnitCost('')
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Napaka pri sprejemu', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Sprejem pošiljke</DialogTitle>
        <DialogDescription>Nov lot poveča količino artikla in zapiše nabavno ceno.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Artikel</Label>
          <Select value={itemId} onValueChange={setItemId}>
            <SelectTrigger aria-label="Artikel"><SelectValue placeholder="Izberite artikel" /></SelectTrigger>
            <SelectContent>
              {items.map((it) => <SelectItem key={it.id} value={it.id}>{it.sku} — {it.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {selected ? <p className="text-xs text-muted-foreground">Trenutna količina: {selected.qty} {selected.unit} · meja {selected.reorderAt}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="rc-qty">Količina</Label>
            <Input id="rc-qty" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="npr. 24" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rc-cost">Nabavna cena (€/en.)</Label>
            <Input id="rc-cost" type="number" min="0" step="any" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="npr. 52" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Dobavitelj</Label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger aria-label="Dobavitelj"><SelectValue placeholder={suppliersLoading ? 'Nalagam …' : 'Izberite dobavitelja'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez dobavitelja</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" size="icon" onClick={() => setSupplierOpen(true)} aria-label="Nov dobavitelj">
              <Plus className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Sprejemam …' : 'Sprejmi pošiljko'}</Button>
      </DialogFooter>

      <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}>
        <NewSupplierDialog
          onCreated={async (id) => { setSupplierId(id); setSupplierOpen(false) }}
          onClose={() => setSupplierOpen(false)}
        />
      </Dialog>
    </DialogContent>
  )
}

function NewSupplierDialog ({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    if (!name.trim()) { toast({ title: 'Ime dobavitelja je obvezno.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      const res = await apiPost<{ data: SupplierRow }>('/api/suppliers', { name, email, phone })
      toast({ title: 'Dobavitelj dodan.' })
      onCreated(res.data.id)
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nov dobavitelj</DialogTitle>
        <DialogDescription>Osnovni kontakt dobavitelja.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="ns-name">Ime</Label>
          <Input id="ns-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. AluPro d.o.o." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ns-email">E-pošta</Label>
          <Input id="ns-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nabava@priimek.si" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ns-phone">Telefon</Label>
          <Input id="ns-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01 234 56 78" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Dodajam …' : 'Dodaj'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

function AdjustDialog ({ item, onClose, onDone }: { item: ItemRow | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const [delta, setDelta] = useState('')

  async function submit (d: number) {
    if (!item) return
    if (!Number.isFinite(d) || d === 0) { toast({ title: 'Vnesite popravek, različen od 0.', variant: 'destructive' }); return }
    try {
      await apiPatch('/api/inventory', { id: item.id, delta: d })
      toast({ title: 'Količina popravljena.', description: `${item.sku}: ${item.qty} → ${Math.round((item.qty + d) * 1000) / 1000}` })
      setDelta('')
      await onDone()
    } catch (e) {
      toast({ title: 'Napaka pri popravku', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  if (!item) return null
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Popravek količine</DialogTitle>
        <DialogDescription>
          {item.sku} — {item.name} · trenutno <strong>{item.qty} {item.unit}</strong> (meja {item.reorderAt})
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[-10, -5, -1, 1, 5, 10].map((d) => (
            <Button key={d} type="button" variant="outline" size="sm" onClick={() => void submit(d)} disabled={item.qty + d < 0}>
              {d > 0 ? `+${d}` : d}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="adj-delta">Poljuben popravek (+/−)</Label>
          <div className="flex gap-2">
            <Input
              id="adj-delta" type="number" step="any" value={delta}
              onChange={(e) => setDelta(e.target.value)} placeholder="npr. -3 ali 12.5"
            />
            <Button onClick={() => void submit(Number(delta))}>Potrdi</Button>
          </div>
          <p className="text-xs text-muted-foreground">Popravek se zapiše v revizijski dnevnik (INVENTORY_ADJUST).</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Zapri</Button>
      </DialogFooter>
    </DialogContent>
  )
}

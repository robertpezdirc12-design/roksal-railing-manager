'use client'

// ZALOGA — skladiščni operativni pogled (R443: issue #7 §7 P1 INVENTORY CORE)
// Zavihki: PREGELED (fizična ≠ rezervirana ≠ razpoložljiva) · GIBANJA (dnevnik) · PICKING.
// Vrata: inventory.read (pogled); sprejem = procurement.receive; popravek/rezervacija = inventory.write.

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, ClipboardCheck, ClipboardList, History, Layers, PackagePlus, PackageSearch, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDateTime, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatCard, StatusBadge } from '@/components/roksal/ui-bits'
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

interface StockRow {
  id: string; sku: string; name: string; unit: string
  location: string | null; reorderAt: number
  physical: number; reserved: number; available: number
}

interface MovementRow {
  id: string; qty: number; type: string; note: string | null; createdAt: string
  refType: string | null
  item: { sku: string; name: string; unit: string }
  user: { name: string; role: string } | null
}

interface PickingRow {
  id: string; code: string; status: string; note: string | null; createdAt: string
  bom: { code: string; product: { sku: string; name: string }; package: { code: string; name: string; project: { code: string; title: string } } | null } | null
  lines: { id: string; qtyNeeded: number; qtyPicked: number; item: { sku: string; name: string; unit: string } }[]
}

interface SupplierRow { id: string; name: string; email: string | null; phone: string | null }

const MOVEMENT_LABELS: Record<string, string> = {
  PREVZEM: 'Prevzem', IZDAJA: 'Izdaja', VRACILO: 'Vračilo', INVENTURA: 'Inventura',
}

export default function ZalogaModule () {
  const [tab, setTab] = useState('pregled')
  return (
    <div className="space-y-4">
      <PageHeader
        title="Zaloga"
        desc="Skladiščni operativni pogled — fizična, rezervirana in razpoložljiva zaloga so vedno ločene"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="pregled"><Boxes className="mr-1.5 size-4" aria-hidden /> Pregled</TabsTrigger>
          <TabsTrigger value="gibanja"><History className="mr-1.5 size-4" aria-hidden /> Gibanja</TabsTrigger>
          <TabsTrigger value="picking"><ClipboardList className="mr-1.5 size-4" aria-hidden /> Picking</TabsTrigger>
        </TabsList>
        <TabsContent value="pregled" className="mt-4"><PregledTab /></TabsContent>
        <TabsContent value="gibanja" className="mt-4"><GibanjaTab /></TabsContent>
        <TabsContent value="picking" className="mt-4"><PickingTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ─── ZAVIHEK: pregled zaloge ─────────────────────────────────────────────────

function PregledTab () {
  const user = useAppStore((s) => s.user)
  const [q, setQ] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [adjustItem, setAdjustItem] = useState<StockRow | null>(null)

  const stock = useApi<{ data: StockRow[] }>('/api/stock')
  const inventory = useApi<{ data: ItemRow[] }>('/api/inventory') // za sprejem (cene/losi)
  const lots = useApi<{ data: LotRow[] }>('/api/inventory/lots?limit=10')
  const suppliers = useApi<{ data: SupplierRow[] }>(receiveOpen ? '/api/suppliers' : null, [receiveOpen])

  const canReceive = hasPerm(user?.perms, 'procurement.receive')
  const canAdjust = hasPerm(user?.perms, 'inventory.write')

  const rows = useMemo(() => {
    const all = stock.data?.data ?? []
    const needle = q.trim().toLowerCase()
    return all
      .filter((it) => (lowOnly ? it.available <= it.reorderAt : true))
      .filter((it) => (needle ? `${it.sku} ${it.name} ${it.location ?? ''}`.toLowerCase().includes(needle) : true))
  }, [stock.data, q, lowOnly])

  const all = stock.data?.data ?? []
  const lowCount = all.filter((it) => it.available <= it.reorderAt).length
  const totalReserved = all.reduce((s, it) => s + it.reserved, 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Artikli" value={all.length} icon={Boxes} hint="v celotnem seznamu" />
        <StatCard label="Pod mejo naročanja" value={lowCount} icon={AlertTriangle} tone={lowCount > 0 ? 'red' : 'green'} hint="po RAZPOLOŽLJIVI zalogi" />
        <StatCard label="Rezervirano" value={totalReserved.toLocaleString('sl-SI')} icon={ClipboardCheck} tone="amber" hint="aktivne rezervacije (ne fizično)" />
        <StatCard label="Sprejem pošiljke" value={canReceive ? 'omogočen' : '—'} icon={PackagePlus} hint={canReceive ? 'procurement.receive' : 'ni pravice'} />
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
        {canReceive ? (
          <Button size="sm" onClick={() => setReceiveOpen(true)}>
            <PackagePlus className="size-4" aria-hidden /> Sprejem pošiljke
          </Button>
        ) : null}
      </div>

      <ErrorBox error={stock.error} />
      {stock.loading ? <LoadingRows /> : !stock.error && rows.length === 0 ? (
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
                    <TableHead className="text-right">Fizična</TableHead>
                    <TableHead className="text-right">Rezervirana</TableHead>
                    <TableHead className="text-right">Razpoložljiva</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Meja</TableHead>
                    <TableHead className="hidden lg:table-cell">Lokacija</TableHead>
                    {canAdjust ? <TableHead className="pr-4 text-right">Popravek</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((it) => {
                    const low = it.available <= it.reorderAt
                    return (
                      <TableRow key={it.id} className={low ? 'bg-red-50 dark:bg-red-950/40' : undefined}>
                        <TableCell className="pl-4 font-mono text-xs font-semibold text-roksal-amber">{it.sku}</TableCell>
                        <TableCell className="font-medium">
                          {it.name}
                          {low ? <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400"><AlertTriangle className="size-3" aria-hidden />pod mejo</span> : null}
                        </TableCell>
                        <TableCell className="text-right font-bold">{it.physical} <span className="text-xs font-normal text-muted-foreground">{it.unit}</span></TableCell>
                        <TableCell className="text-right">
                          {it.reserved > 0 ? (
                            <span className="font-semibold text-amber-600 dark:text-amber-400">{it.reserved}</span>
                          ) : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${low ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{it.available}</TableCell>
                        <TableCell className="text-right text-muted-foreground hidden md:table-cell">{it.reorderAt}</TableCell>
                        <TableCell className="text-muted-foreground hidden lg:table-cell">{it.location ?? '—'}</TableCell>
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
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Fizična ≠ rezervirana ≠ razpoložljiva — razpoložljiva = fizična − aktivne rezervacije (issue #7 §7).
            </p>
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

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <ReceiveDialog
          items={inventory.data?.data ?? []}
          suppliers={suppliers.data?.data ?? []}
          suppliersLoading={suppliers.loading}
          onClose={() => setReceiveOpen(false)}
          onDone={async () => { await Promise.all([stock.reload(), inventory.reload(), lots.reload()]) }}
        />
      </Dialog>

      <Dialog open={!!adjustItem} onOpenChange={(o) => { if (!o) setAdjustItem(null) }}>
        <AdjustDialog
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
          onDone={async () => { setAdjustItem(null); await Promise.all([stock.reload(), lots.reload()]) }}
        />
      </Dialog>
    </div>
  )
}

// ─── ZAVIHEK: dnevnik gibanj ─────────────────────────────────────────────────

function GibanjaTab () {
  const [type, setType] = useState('all')
  const movements = useApi<{ data: MovementRow[] }>(`/api/stock/movements${type !== 'all' ? `?type=${type}` : ''}`, [type])
  const rows = movements.data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-44" aria-label="Filter tipa gibanja"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi tipi</SelectItem>
            {Object.entries(MOVEMENT_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">{rows.length} zadnjih</Badge>
      </div>
      <ErrorBox error={movements.error} />
      {movements.loading ? <LoadingRows /> : !movements.error && rows.length === 0 ? (
        <EmptyState title="Ni gibanj" desc="Prevzemi, izdaje, vračila in inventurni popravki se zapisujejo samodejno." icon={History} />
      ) : (
        <Card>
          <CardContent className="max-h-[32rem] overflow-y-auto p-0">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="pl-4">Čas</TableHead>
                  <TableHead>Tip</TableHead>
                  <TableHead>Artikel</TableHead>
                  <TableHead className="text-right">Količina</TableHead>
                  <TableHead className="hidden sm:table-cell">Uporabnik</TableHead>
                  <TableHead className="hidden md:table-cell pr-4">Opomba</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-4 whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(m.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={m.qty > 0
                        ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}>
                        {m.qty > 0 ? <ArrowDownLeft className="mr-1 size-3" aria-hidden /> : <ArrowUpRight className="mr-1 size-3" aria-hidden />}
                        {MOVEMENT_LABELS[m.type] ?? m.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{m.item.sku}</span>
                      <span className="ml-2 font-medium">{m.item.name}</span>
                    </TableCell>
                    <TableCell className={`text-right font-bold ${m.qty > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {m.qty > 0 ? '+' : ''}{m.qty} <span className="text-xs font-normal text-muted-foreground">{m.item.unit}</span>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{m.user?.name ?? 'sistem'}</TableCell>
                    <TableCell className="hidden max-w-56 truncate text-xs text-muted-foreground md:table-cell pr-4">{m.note ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── ZAVIHEK: picking liste ──────────────────────────────────────────────────

function PickingTab () {
  const user = useAppStore((s) => s.user)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const picking = useApi<{ data: PickingRow[] }>(`/api/picking${status !== 'all' ? `?status=${status}` : ''}`, [status])
  const canWrite = hasPerm(user?.perms, 'inventory.write')
  const rows = picking.data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Filter statusa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            <SelectItem value="PRIPRAVLJENA">Pripravljena</SelectItem>
            <SelectItem value="ZAKLJUCENA">Zaključena</SelectItem>
            <SelectItem value="PREKLICANA">Preklicana</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">{rows.length} list</Badge>
      </div>
      <p className="rounded-xl border border-dashed bg-secondary/40 p-3 text-xs text-muted-foreground">
        Picking lista nastane iz rezervirane kosovnice (Kosovnice → podrobnost → »Ustvari picking listo«).
        Zaključek pickinga izda material zaloge in porabi rezervacije.
      </p>
      <ErrorBox error={picking.error} />
      {picking.loading ? <LoadingRows /> : !picking.error && rows.length === 0 ? (
        <EmptyState title="Ni picking list" desc="Ustvarite jo iz rezervirane kosovnice." icon={ClipboardList} />
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => {
            const done = p.lines.filter((l) => l.qtyPicked >= l.qtyNeeded).length
            return (
              <li key={p.id}>
                <Card className="transition hover:border-roksal-amber/60">
                  <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{p.code}</span>
                    <StatusBadge status={p.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {p.bom ? `${p.bom.product.name} · ${p.bom.package?.project.code ?? ''}` : '—'}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.bom ? `kosovnica ${p.bom.code}` : ''} · {p.lines.length} vrstic · {done}/{p.lines.length} pobranih
                        {` · ${fmtDateTime(p.createdAt)}`}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSelected(p.id)}>
                      <ClipboardList className="size-4" aria-hidden /> {canWrite && p.status === 'PRIPRAVLJENA' ? 'Poberi' : 'Poglej'}
                    </Button>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <PickingDetailDialog
          id={selected}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onDone={async () => { await picking.reload() }}
        />
      </Dialog>
    </div>
  )
}

interface PickingDetail {
  id: string; code: string; status: string; note: string | null
  bom: { code: string; qty: number; unit: string; product: { sku: string; name: string }; package: { code: string; name: string; project: { code: string; title: string } } | null } | null
  lines: { id: string; qtyNeeded: number; qtyPicked: number; note: string | null; item: { id: string; sku: string; name: string; unit: string; qty: number } }[]
}

function PickingDetailDialog ({ id, canWrite, onClose, onDone }: {
  id: string | null
  canWrite: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  const detail = useApi<{ data: PickingDetail }>(id ? `/api/picking/${id}` : null, [id])
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const d = detail.data?.data
  const editable = canWrite && d && d.status === 'PRIPRAVLJENA'

  async function complete () {
    if (!d) return
    const lines = d.lines.map((l) => ({
      lineId: l.id,
      qtyPicked: picks[l.id] !== undefined && picks[l.id] !== '' ? Number(picks[l.id]) : l.qtyNeeded,
    }))
    if (lines.some((l) => !Number.isFinite(l.qtyPicked) || l.qtyPicked < 0)) {
      toast({ title: 'Pobrana količina mora biti veljavno število.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPatch<{ data: { issued: number } }>(`/api/picking/${d.id}`, { action: 'complete', lines })
      toast({ title: 'Picking zaključen.', description: `${d.code}: izdanih ${res.data.issued} vrstic — rezervacije porabljene.` })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Zaključek ni uspel', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function cancel () {
    if (!d) return
    setBusy(true)
    try {
      await apiPatch(`/api/picking/${d.id}`, { action: 'cancel' })
      toast({ title: 'Picking preklican.', description: 'Material ostane fizično nedotaknjen.' })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <ClipboardList className="size-5 text-roksal-amber" aria-hidden />
          {d ? d.code : 'Nalagam …'}
          {d ? <StatusBadge status={d.status} /> : null}
        </DialogTitle>
        <DialogDescription>
          {d?.bom
            ? `${d.bom.product.sku} — ${d.bom.product.name} · ${d.bom.qty} ${d.bom.unit} · kosovnica ${d.bom.code}`
              + (d.bom.package ? ` · ${d.bom.package.project.code} ${d.bom.package.project.title}` : '')
            : 'Picking lista za kosovnico.'}
        </DialogDescription>
      </DialogHeader>
      <ErrorBox error={detail.error} />
      {detail.loading ? <LoadingRows rows={3} /> : d ? (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3">Artikel</TableHead>
                  <TableHead className="text-right">Potrebno</TableHead>
                  <TableHead className="text-right">Fizična zaloga</TableHead>
                  <TableHead className="pr-3 text-right">{editable ? 'Pobrano' : 'Pobrano'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-3">
                      <span className="font-mono text-xs text-muted-foreground">{l.item.sku}</span>
                      <span className="ml-2 font-medium">{l.item.name}</span>
                    </TableCell>
                    <TableCell className="text-right font-bold">{l.qtyNeeded} <span className="text-xs font-normal text-muted-foreground">{l.item.unit}</span></TableCell>
                    <TableCell className="text-right text-muted-foreground">{l.item.qty}</TableCell>
                    <TableCell className="pr-3">
                      {editable ? (
                        <Input
                          type="number" min="0" max={l.qtyNeeded} step="any"
                          className="ml-auto w-24 text-right"
                          value={picks[l.id] ?? String(l.qtyNeeded)}
                          onChange={(e) => setPicks((p) => ({ ...p, [l.id]: e.target.value }))}
                          aria-label={`Pobrano za ${l.item.sku}`}
                        />
                      ) : (
                        <span className="font-semibold">{l.qtyPicked}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {editable ? (
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void cancel()} disabled={busy}>
                Prekliči listo
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Zapri</Button>
                <Button onClick={() => void complete()} disabled={busy}>{busy ? 'Zaključujem …' : 'Zaključi picking'}</Button>
              </div>
            </DialogFooter>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Zapri</Button>
            </DialogFooter>
          )}
        </>
      ) : null}
    </DialogContent>
  )
}

// ─── dialogi (sprejem + popravek) — nespremenjena logika, osvežitev tudi /api/stock ──

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
      toast({ title: 'Pošiljka sprejeta.', description: `${q} × ${selected?.name ?? 'artikel'} dodano v zalogo (zapisano v dnevnik gibanj).` })
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
        <DialogDescription>Nov lot poveča fizično zalogo in se zapiše v dnevnik gibanj (PREVZEM).</DialogDescription>
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
          {selected ? <p className="text-xs text-muted-foreground">Trenutna fizična količina: {selected.qty} {selected.unit} · meja {selected.reorderAt}</p> : null}
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

function AdjustDialog ({ item, onClose, onDone }: { item: StockRow | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const [delta, setDelta] = useState('')

  async function submit (d: number) {
    if (!item) return
    if (!Number.isFinite(d) || d === 0) { toast({ title: 'Vnesite popravek, različen od 0.', variant: 'destructive' }); return }
    try {
      await apiPatch('/api/inventory', { id: item.id, delta: d })
      toast({ title: 'Količina popravljena.', description: `${item.sku}: ${item.physical} → ${Math.round((item.physical + d) * 1000) / 1000} (zapisano v dnevnik)` })
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
        <DialogTitle>Popravek količine (inventura)</DialogTitle>
        <DialogDescription>
          {item.sku} — {item.name} · fizična <strong>{item.physical} {item.unit}</strong> · rezervirana {item.reserved} · meja {item.reorderAt}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[-10, -5, -1, 1, 5, 10].map((d) => (
            <Button key={d} type="button" variant="outline" size="sm" onClick={() => void submit(d)} disabled={item.physical + d < 0}>
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
          <p className="text-xs text-muted-foreground">Popravek se zapiše v revizijski dnevnik (INVENTORY_ADJUST) in dnevnik gibanj (INVENTURA).</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Zapri</Button>
      </DialogFooter>
    </DialogContent>
  )
}

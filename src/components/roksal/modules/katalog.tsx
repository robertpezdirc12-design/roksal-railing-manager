'use client'

// KATALOG — produktni model po družinah (R442, issue #7 P0)
// Zavihka: IZDELKI (družine → izdelki → podrobnost z BOM predlogo + kalkulatorjem)
// in CENIKI (PriceList/PriceRule — poslovne cene NISO hardcoded).
// Profile (stari railing katalog) ostaja v /api/catalog za konfigurator/viz.

import { useMemo, useState } from 'react'
import { BadgeJapaneseYen, Boxes, Calculator, Layers, ListTree, Package, Pencil, Plus, Ruler, Search, Shapes, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { cn } from '@/lib/utils'

// ─── tipi ────────────────────────────────────────────────────────────────────

interface FamilyRow { id: string; code: string; name: string; desc: string | null; unit: string; productCount: number }

interface VariantRow { id: string; sku: string; name: string; color: string | null; ral: string | null; salePrice: number | null }

interface ComponentRow {
  id: string; qty: number; unitBasis: string; optional: boolean; note: string | null; sortOrder: number
  item: { id: string; sku: string; name: string; unit: string; qty: number }
}

interface ProductRow {
  id: string; sku: string; name: string; desc: string | null; unit: string
  widthMm: number | null; heightMm: number | null
  costPrice: number; salePrice: number; warrantyMonths: number; active: boolean
  family: { code: string; name: string; unit: string }
  variants: VariantRow[]
  _count: { components: number; packages: number }
}

interface ProductDetail extends Omit<ProductRow, '_count'> {
  components: ComponentRow[]
  tech: string | null
  _count: { packages: number; boms: number; components: number }
}

interface BomPlanLine {
  itemId: string; sku: string; name: string; unit: string; qty: number
  optional: boolean; note: string | null; unitCost: number; lineCost: number
  stockQty: number; covered: boolean; missing: number
}

interface BomPlan {
  product: { id: string; sku: string; name: string; unit: string }
  variant: { id: string; sku: string; name: string } | null
  qty: number; unit: string
  lines: BomPlanLine[]
  materialCost: number; salePriceUnit: number; montazaUnit: number
  totalSale: number; totalCost: number; margin: number; marginPct: number
  priceSource: string
}

interface PriceRuleRow {
  id: string; price: number; unit: string; discountPct: number; minPrice: number | null
  seasonFrom: string | null; seasonTo: string | null; note: string | null
  product: { id: string; sku: string; name: string; unit: string } | null
  item: { id: string; sku: string; name: string; unit: string } | null
}

interface PriceListRow {
  id: string; name: string; type: string; currency: string; note: string | null
  validFrom: string; validTo: string | null
  rules: PriceRuleRow[]
}

// ─── glavni modul ────────────────────────────────────────────────────────────

export default function KatalogModule () {
  const [tab, setTab] = useState('izdelki')
  return (
    <div className="space-y-4">
      <PageHeader
        title="Katalog"
        desc="Produktni model po družinah — izdelki, variante, BOM predloge in ceniki"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="izdelki"><Shapes className="mr-1.5 size-4" aria-hidden /> Izdelki</TabsTrigger>
          <TabsTrigger value="ceniki"><BadgeJapaneseYen className="mr-1.5 size-4" aria-hidden /> Ceniki</TabsTrigger>
        </TabsList>
        <TabsContent value="izdelki" className="mt-4">
          <ProductsTab />
        </TabsContent>
        <TabsContent value="ceniki" className="mt-4">
          <PriceListsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── zavihek: izdelki po družinah ────────────────────────────────────────────

function ProductsTab () {
  const user = useAppStore((s) => s.user)
  const [family, setFamily] = useState('all')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const families = useApi<{ data: FamilyRow[] }>('/api/product-families')
  const products = useApi<{ data: ProductRow[] }>(
    `/api/products?family=${family}&q=${encodeURIComponent(q)}`,
    [family, q]
  )
  const detail = useApi<{ data: ProductDetail }>(selected ? `/api/products/${selected}` : null, [selected])

  const famRows = families.data?.data ?? []
  const rows = products.data?.data ?? []
  const canCalc = hasPerm(user?.perms, 'quotes.create')
  const canWrite = hasPerm(user?.perms, 'catalog.write')

  const familyName = useMemo(() => famRows.find((f) => f.code === family)?.name ?? 'Vse družine', [famRows, family])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči izdelek ali SKU …" className="pl-8" aria-label="Iskanje izdelkov" />
        </div>
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">
          {rows.length} izdelkov
        </Badge>
        {canWrite ? (
          <Button size="sm" className="ml-auto" onClick={() => { /* ustvarjanje po družini */ setFamily(family === 'all' ? 'TERASA' : family) }}>
            <Plus className="size-4" aria-hidden /> Nov izdelek
          </Button>
        ) : null}
      </div>

      {/* izbira družine — kokarde */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Produktne družine">
        <button
          role="tab" aria-selected={family === 'all'}
          onClick={() => setFamily('all')}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs font-medium transition',
            family === 'all' ? 'border-roksal-amber bg-roksal-amber/10 text-roksal-amber' : 'border-border bg-background text-muted-foreground hover:border-roksal-amber/50'
          )}
        >
          Vse ({famRows.reduce((s, f) => s + f.productCount, 0)})
        </button>
        {famRows.map((f) => (
          <button
            key={f.code} role="tab" aria-selected={family === f.code}
            onClick={() => setFamily(f.code)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition',
              family === f.code ? 'border-roksal-amber bg-roksal-amber/10 text-roksal-amber' : 'border-border bg-background text-muted-foreground hover:border-roksal-amber/50'
            )}
          >
            {f.name} ({f.productCount})
          </button>
        ))}
      </div>

      <ErrorBox error={products.error ?? families.error} />
      {products.loading ? <LoadingRows /> : !products.error && rows.length === 0 ? (
        <EmptyState title="Ni izdelkov" desc={`V družini ${familyName} ni izdelkov ali iskanje ni našlo zadetkov.`} icon={Shapes} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id}>
              <Card className="h-full transition hover:border-roksal-amber/60 hover:shadow-sm">
                <CardContent className="flex h-full flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{p.sku}</span>
                    <Badge variant="secondary" className="border-transparent bg-secondary text-xs text-secondary-foreground">{p.family.name}</Badge>
                  </div>
                  <button
                    className="text-left font-semibold leading-snug hover:underline"
                    onClick={() => setSelected(p.id)}
                  >
                    {p.name}
                  </button>
                  {p.desc ? <p className="line-clamp-2 text-xs text-muted-foreground">{p.desc}</p> : null}
                  <div className="flex flex-wrap gap-1.5">
                    {p.variants.length > 0 ? (
                      <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground"><Tag className="mr-1 size-3" aria-hidden />{p.variants.length} variant</Badge>
                    ) : null}
                    {p._count.components > 0 ? (
                      <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground"><ListTree className="mr-1 size-3" aria-hidden />{p._count.components} komponent</Badge>
                    ) : (
                      <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">brez BOM</Badge>
                    )}
                    {p.warrantyMonths > 0 ? (
                      <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{p.warrantyMonths} mes. garancije</Badge>
                    ) : null}
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                    <div className="text-sm font-bold">
                      {fmtEUR(p.salePrice)}
                      <span className="text-xs font-normal text-muted-foreground"> / {p.unit}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSelected(p.id)}>
                      <Ruler className="size-4" aria-hidden /> Podrobnosti
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <ProductDialog
          detail={detail.data?.data ?? null}
          loading={detail.loading}
          canCalc={canCalc}
          onClose={() => setSelected(null)}
        />
      </Dialog>
    </div>
  )
}

// ─── podrobnost izdelka: variante + BOM predloga + kalkulator ────────────────

function ProductDialog ({ detail, loading, canCalc, onClose }: {
  detail: ProductDetail | null
  loading: boolean
  canCalc: boolean
  onClose: () => void
}) {
  const { toast } = useToast()
  const [qty, setQty] = useState('')
  const [variantId, setVariantId] = useState('none')
  const [plan, setPlan] = useState<BomPlan | null>(null)
  const [busy, setBusy] = useState(false)

  async function calculate () {
    if (!detail) return
    const qv = Number(qty)
    if (!Number.isFinite(qv) || qv <= 0) { toast({ title: 'Vnesite veljavno količino.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      const res = await apiPost<{ data: BomPlan }>(`/api/products/${detail.id}/bom`, {
        qty: qv,
        variantId: variantId !== 'none' ? variantId : null,
      })
      setPlan(res.data)
      toast({ title: 'Kosovnica izračunana.', description: `${res.data.lines.length} vrstic · marža ${res.data.marginPct} %` })
    } catch (e) {
      toast({ title: 'Izračun ni uspel', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {detail ? detail.name : 'Nalagam izdelek …'}
          {detail ? <span className="font-mono text-xs font-semibold text-roksal-amber">{detail.sku}</span> : null}
        </DialogTitle>
        {detail ? (
          <DialogDescription>
            {detail.family.name} · enota {detail.unit}
            {detail.widthMm ? ` · ${detail.widthMm}×${detail.heightMm ?? '?'} mm` : ''}
            {detail.warrantyMonths > 0 ? ` · garancija ${detail.warrantyMonths} mes.` : ''}
          </DialogDescription>
        ) : (
          <DialogDescription>Podrobnosti izdelka s predlogo kosovnice.</DialogDescription>
        )}
      </DialogHeader>
      {loading || !detail ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Nalagam izdelek …</div>
      ) : (
        <>
          {detail.desc ? <p className="text-sm text-muted-foreground">{detail.desc}</p> : null}

          {/* cene */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Prodajna" value={`${fmtEUR(detail.salePrice)}/${detail.unit}`} />
            <MiniStat label="Variante" value={String(detail.variants.length)} />
            <MiniStat label="Komponente" value={String(detail.components.length)} />
            <MiniStat label="Paketi" value={String(detail._count.packages)} />
          </div>

          {/* variante */}
          {detail.variants.length > 0 ? (
            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold">Variante</h3>
              <div className="flex flex-wrap gap-1.5">
                {detail.variants.map((v) => (
                  <Badge key={v.id} variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">
                    {v.name}{v.ral ? ` (${v.ral})` : ''}{v.salePrice != null ? ` · ${fmtEUR(v.salePrice)}` : ''}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}

          {/* BOM predloga — eksplicitne povezave na artikle */}
          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold">BOM predloga (na 1 {detail.unit})</h3>
            {detail.components.length === 0 ? (
              <p className="text-xs text-muted-foreground">Izdelek nima definiranih komponent.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">Artikel (eksplicitna povezava)</TableHead>
                      <TableHead className="text-right">Količina / {detail.unit}</TableHead>
                      <TableHead className="pr-3">Zaloga</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.components.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="pl-3">
                          <span className="font-mono text-xs text-muted-foreground">{c.item.sku}</span>
                          <span className="ml-2 font-medium">{c.item.name}</span>
                          {c.optional ? <Badge variant="secondary" className="ml-2 border-transparent bg-muted text-xs text-muted-foreground">opcijsko</Badge> : null}
                          {c.note ? <span className="block text-[11px] text-muted-foreground">{c.note}</span> : null}
                        </TableCell>
                        <TableCell className="text-right font-bold">{c.qty} <span className="text-xs font-normal text-muted-foreground">{c.item.unit}</span></TableCell>
                        <TableCell className="pr-3 text-xs text-muted-foreground">{c.item.qty} {c.item.unit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          {/* kalkulator BOM (samo pisarna — marža) */}
          {canCalc ? (
            <section className="space-y-2 rounded-lg border border-dashed p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Calculator className="size-4 text-roksal-amber" aria-hidden /> Izračun kosovnice in cene
              </h3>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-28 space-y-1">
                  <Label htmlFor="kb-qty">Količina ({detail.unit})</Label>
                  <Input id="kb-qty" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="npr. 36.4" />
                </div>
                {detail.variants.length > 0 ? (
                  <div className="min-w-44 space-y-1">
                    <Label>Varianta</Label>
                    <Select value={variantId} onValueChange={setVariantId}>
                      <SelectTrigger aria-label="Izbira variante"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— osnovna —</SelectItem>
                        {detail.variants.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <Button size="sm" onClick={() => void calculate()} disabled={busy}>
                  {busy ? 'Računam …' : 'Izračunaj BOM'}
                </Button>
              </div>

              {plan ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MiniStat label="Material" value={fmtEUR(plan.materialCost)} />
                    <MiniStat label="Prodaja (+montaža)" value={fmtEUR(plan.totalSale)} />
                    <MiniStat label="Marža" value={`${fmtEUR(plan.margin)} · ${plan.marginPct} %`} tone={plan.marginPct >= 30 ? 'green' : 'amber'} />
                    <MiniStat label="Vir cene" value={plan.priceSource} />
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-lg border">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead className="pl-3">Artikel</TableHead>
                          <TableHead className="text-right">Potrebno</TableHead>
                          <TableHead className="text-right">Zaloga</TableHead>
                          <TableHead className="pr-3">Stanje</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plan.lines.map((l) => (
                          <TableRow key={l.itemId}>
                            <TableCell className="pl-3">
                              <span className="font-mono text-xs text-muted-foreground">{l.sku}</span>
                              <span className="ml-2 font-medium">{l.name}</span>
                            </TableCell>
                            <TableCell className="text-right font-bold">{l.qty} <span className="text-xs font-normal text-muted-foreground">{l.unit}</span></TableCell>
                            <TableCell className="text-right text-muted-foreground">{l.stockQty}</TableCell>
                            <TableCell className="pr-3">
                              {l.covered ? (
                                <Badge variant="secondary" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">pokrito</Badge>
                              ) : (
                                <Badge variant="secondary" className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">manjka {l.missing} {l.unit}</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Kosovnico lahko shranite kot paket projekta (zavihek Projekti → podrobnost projekta → Paketi).
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Zapri</Button>
          </DialogFooter>
        </>
      )}
    </DialogContent>
  )
}

function MiniStat ({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'green' | 'amber' }) {
  return (
    <div className="rounded-lg border bg-secondary/30 p-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn(
        'text-sm font-bold',
        tone === 'green' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'amber' && 'text-amber-600 dark:text-amber-400'
      )}>{value}</div>
    </div>
  )
}

// ─── zavihek: ceniki ─────────────────────────────────────────────────────────

const PL_TYPE_LABELS: Record<string, string> = {
  NABAVNA: 'Nabavni',
  PRODAJNA: 'Prodajni',
  MONTAZA: 'Montaža',
}

function PriceListsTab () {
  const user = useAppStore((s) => s.user)
  const lists = useApi<{ data: PriceListRow[] }>('/api/price-lists')
  const canManage = hasPerm(user?.perms, 'price.override')
  const [editing, setEditing] = useState<{ listId: string; listName: string; rule: PriceRuleRow | null } | null>(null)

  const rows = lists.data?.data ?? []

  return (
    <div className="space-y-4">
      {canManage ? null : (
        <p className="rounded-xl border border-dashed bg-secondary/40 p-3 text-xs text-muted-foreground">
          Prikazani so prodajni in montažni ceniki. Nabavni cenik je viden samo pooblaščeni osebi (price.override).
        </p>
      )}
      <ErrorBox error={lists.error} />
      {lists.loading ? <LoadingRows /> : rows.length === 0 && !lists.error ? (
        <EmptyState title="Ni cenikov" desc="Ceniki še niso definirani." icon={Layers} />
      ) : (
        <div className="space-y-4">
          {rows.map((l) => (
            <Card key={l.id}>
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <div>
                    <div className="font-semibold">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {PL_TYPE_LABELS[l.type] ?? l.type} · velja od {new Date(l.validFrom).toLocaleDateString('sl-SI')}
                      {l.validTo ? ` do ${new Date(l.validTo).toLocaleDateString('sl-SI')}` : ' dalje'}
                      {l.note ? ` · ${l.note}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{l.rules.length} pravil</Badge>
                  </div>
                </div>
                {l.rules.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">Cenik je prazen.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">Cilj pravila</TableHead>
                          <TableHead className="text-right">Cena</TableHead>
                          <TableHead className="text-right">Popust</TableHead>
                          <TableHead className="hidden sm:table-cell">Sezona</TableHead>
                          {canManage ? <TableHead className="pr-4" /> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {l.rules.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="max-w-64 pl-4">
                              <span className="font-mono text-xs text-muted-foreground">{r.product?.sku ?? r.item?.sku}</span>
                              <span className="ml-2 font-medium">{r.product?.name ?? r.item?.name}</span>
                            </TableCell>
                            <TableCell className="text-right font-bold">{fmtEUR(r.price)}<span className="text-xs font-normal text-muted-foreground"> / {r.product?.unit ?? r.item?.unit ?? r.unit}</span></TableCell>
                            <TableCell className="text-right">{r.discountPct > 0 ? `${r.discountPct} %` : '—'}</TableCell>
                            <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                              {r.seasonFrom && r.seasonTo ? `${r.seasonFrom} → ${r.seasonTo}` : '—'}
                            </TableCell>
                            {canManage ? (
                              <TableCell className="pr-4 text-right">
                                <Button variant="ghost" size="icon" aria-label="Uredi pravilo" onClick={() => setEditing({ listId: l.id, listName: l.name, rule: r })}>
                                  <Pencil className="size-4" aria-hidden />
                                </Button>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <EditRuleDialog
          ctx={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await lists.reload() }}
        />
      </Dialog>
    </div>
  )
}

function EditRuleDialog ({ ctx, onClose, onSaved }: {
  ctx: { listId: string; listName: string; rule: PriceRuleRow | null } | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { toast } = useToast()
  const [price, setPrice] = useState('')
  const [discount, setDiscount] = useState('')

  const [lastKey, setLastKey] = useState<string | null>(null)
  const ruleKey = ctx ? `${ctx.listId}:${ctx.rule?.id ?? 'new'}` : null
  if (ctx && ruleKey && ruleKey !== lastKey) {
    setLastKey(ruleKey)
    setPrice(String(ctx.rule?.price ?? ''))
    setDiscount(String(ctx.rule?.discountPct ?? 0))
  }

  async function submit () {
    if (!ctx) return
    const p = Number(price)
    if (!Number.isFinite(p) || p < 0) { toast({ title: 'Cena mora biti veljavno število.', variant: 'destructive' }); return }
    const d = Number(discount)
    try {
      await apiPost(`/api/price-lists/${ctx.listId}/rules`, {
        productId: ctx.rule?.product?.id ?? null,
        itemId: ctx.rule?.item?.id ?? null,
        price: p,
        discountPct: Number.isFinite(d) ? d : 0,
        unit: ctx.rule?.product?.unit ?? ctx.rule?.item?.unit ?? 'm2',
      })
      toast({ title: 'Pravilo shranjeno.', description: ctx.rule ? `${ctx.rule.product?.name ?? ctx.rule.item?.name}: ${fmtEUR(p)}` : undefined })
      await onSaved()
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  if (!ctx) return null
  const target = ctx.rule?.product?.name ?? ctx.rule?.item?.name ?? ''
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Uredi pravilo cenika</DialogTitle>
        <DialogDescription>{ctx.listName} — {target}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="er-price">Cena (€)</Label>
        <Input id="er-price" type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Label htmlFor="er-disc">Popust (%)</Label>
        <Input id="er-disc" type="number" min="0" max="100" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        <p className="text-xs text-muted-foreground">Sprememba se zapiše v revizijski dnevnik (PRICE_RULE_UPDATE).</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()}>Shrani</Button>
      </DialogFooter>
    </DialogContent>
  )
}

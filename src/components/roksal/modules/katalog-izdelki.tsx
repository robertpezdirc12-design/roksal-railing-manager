'use client'

// KATALOG — zavihek IZDELKI (družine → izdelki → podrobnost z BOM + kalkulatorjem)
// — R548 izvleček iz katalog.tsx (razbitje po vzorcu R546/R547; BREZ spremembe obnašanja).

import { useMemo, useState } from 'react'
import { Calculator, ListTree, Plus, Ruler, Search, Shapes, Tag } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { cn } from '@/lib/utils'
import { type BomPlan, type FamilyRow, type ProductDetail, type ProductRow, familyLabel } from './katalog-shared'
import { ProductAssetsSection } from './katalog-gradiva'

// ─── zavihek: izdelki po družinah ────────────────────────────────────────────

export function ProductsTab () {
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

  const familyName = useMemo(() => {
    const f = famRows.find((x) => x.code === family)
    return f ? familyLabel(f.code, f.name) : 'Vse družine'
  }, [famRows, family])

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

      {/* hitri filter po družini — vodoravno drseče tablete (R448 §11) */}
      <div
        className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1"
        role="tablist" aria-label="Hitri filter po družini"
      >
        <button
          role="tab" aria-selected={family === 'all'}
          onClick={() => setFamily('all')}
          className={cn(
            'shrink-0 snap-start rounded-full border px-3 py-1.5 text-xs font-medium transition',
            family === 'all' ? 'border-roksal-amber bg-roksal-amber/10 text-roksal-amber-text' : 'border-border bg-background text-muted-foreground hover:border-roksal-amber/50'
          )}
        >
          Vsi ({famRows.reduce((s, f) => s + f.productCount, 0)})
        </button>
        {famRows.map((f) => (
          <button
            key={f.code} role="tab" aria-selected={family === f.code}
            onClick={() => setFamily(f.code)}
            className={cn(
              'shrink-0 snap-start rounded-full border px-3 py-1.5 text-xs font-medium transition',
              family === f.code ? 'border-roksal-amber bg-roksal-amber/10 text-roksal-amber-text' : 'border-border bg-background text-muted-foreground hover:border-roksal-amber/50'
            )}
          >
            {familyLabel(f.code, f.name)} ({f.productCount})
          </button>
        ))}
      </div>

      <ErrorBox error={products.error ?? families.error} />
      {products.loading ? <LoadingRows /> : !products.error && rows.length === 0 ? (
        <EmptyState title="Ni izdelkov" desc={`V družini ${familyName} ni izdelkov ali iskanje ni našlo zadetkov.`} icon={Shapes} />
      ) : (
        <AnimatedList className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <AnimatedListItem key={p.id}>
              <Card className="h-full transition hover:border-roksal-amber/60 hover:shadow-sm">
                <CardContent className="flex h-full flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-roksal-amber-text">{p.sku}</span>
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
                      <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">brez BOM</Badge>
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
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <ProductDialog
          detail={detail.data?.data ?? null}
          loading={detail.loading}
          canCalc={canCalc}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onReload={detail.reload}
        />
      </Dialog>
    </div>
  )
}

// ─── podrobnost izdelka: variante + BOM predloga + kalkulator ────────────────

export function ProductDialog ({ detail, loading, canCalc, canWrite, onClose, onReload }: {
  detail: ProductDetail | null
  loading: boolean
  canCalc: boolean
  canWrite: boolean
  onClose: () => void
  onReload: () => Promise<void>
}) {
  const { toast } = useToast()
  const [qty, setQty] = useState('')
  const [variantId, setVariantId] = useState('none')
  const [plan, setPlan] = useState<BomPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [roleBusy, setRoleBusy] = useState<string | null>(null)

  // R475: dodelitev segmentne vloge komponenti (količine po odseku)
  async function setRole (componentId: string, role: string) {
    if (!detail) return
    setRoleBusy(componentId)
    try {
      await apiPatch(`/api/products/${detail.id}/components`, {
        componentId,
        segmentRole: role === 'BREZ' ? null : role,
      })
      await onReload()
      toast({ title: 'Segmentna vloga shranjena.', description: role === 'BREZ' ? 'Komponenta uporablja predlogo × količino.' : 'Količina bo izračunana po segmentih (tekač/konfigurator).' })
    } catch (e) {
      toast({ title: 'Sprememba vloge ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setRoleBusy(null) }
  }

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
          {detail ? <span className="font-mono text-xs font-semibold text-roksal-amber-text">{detail.sku}</span> : null}
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
              {detail.variants.some((v) => v.color && !v.ral) ? (
                <p className="text-[11px] text-muted-foreground">
                  Imena odtenkov so potrjena z uradnimi barvnimi lestvicami roksal.com (prenešene 2026-10-12) in, od 2026-10-13, tudi z Roksalovimi lastnimi naslovi galerijskih fotografij (npr. »Deska 100, ASH WOOD.«) — glej Gradiva. Odtenka Golden teak in White sta potrjena samo s sliko lestvice. Barvni prikaz brez uradnega vzorca ostaja približek.
                </p>
              ) : null}
            </section>
          ) : null}

          {/* originalna produktna gradiva (issue #6) */}
          <ProductAssetsSection productId={detail.id} />

          {/* BOM predloga — eksplicitne povezave na artikle */}
          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold">BOM predloga (na 1 {detail.unit})</h3>
            <p className="text-xs text-muted-foreground">
              Segmentna vloga (R475): komponenta z vlogo dobiva količino PO SEGMENTU, ko paket vsebuje segmente
              (izmera/tekač/konfigurator) — množitelj „/ {detail.unit}“ pomeni takrat kos/steber oz. m/m oz. m²/m².
            </p>
            {detail.components.length === 0 ? (
              <p className="text-xs text-muted-foreground">Izdelek nima definiranih komponent.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">Artikel (eksplicitna povezava)</TableHead>
                      <TableHead className="text-right">Količina / {detail.unit}</TableHead>
                      <TableHead>Segmentna vloga</TableHead>
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
                        <TableCell>
                          {canWrite ? (
                            <Select
                              value={c.segmentRole ?? 'BREZ'}
                              onValueChange={(v) => { if (v !== (c.segmentRole ?? 'BREZ')) void setRole(c.id, v) }}
                              disabled={roleBusy === c.id}
                            >
                              <SelectTrigger className="h-9 w-52" aria-label={`Segmentna vloga za ${c.item.sku}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="BREZ">Brez vloge (predloga × kol.)</SelectItem>
                                <SelectItem value="STEBER">Steber — kos/steber</SelectItem>
                                <SelectItem value="ROCNIK">Ročnik — m na m segmenta</SelectItem>
                                <SelectItem value="POLNILO_M">Polnilo (dolžina) — m/m</SelectItem>
                                <SelectItem value="POLNILO_M2">Polnilo (ploščina) — m²/m²</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : c.segmentRole ? (
                            <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{c.segmentRole}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
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

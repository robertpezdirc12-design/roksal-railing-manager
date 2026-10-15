'use client'

// KATALOG — produktni model po družinah (R442, issue #7 P0)
// Zavihka: IZDELKI (družine → izdelki → podrobnost z BOM predlogo + kalkulatorjem)
// in CENIKI (PriceList/PriceRule — poslovne cene NISO hardcoded).
// R448 (§11): hitri filter po družini na Izdelkih — vodoravno drseče tablete
// s preslikavo ProductFamily.code v slovenska imena.
// Profile (stari railing katalog) ostaja v /api/catalog za konfigurator/viz.

import { useMemo, useRef, useState } from 'react'
import { BadgeJapaneseYen, Boxes, Calculator, Layers, ListTree, Package, Pencil, Plus, Ruler, Search, Shapes, ShieldCheck, Tag, Upload } from 'lucide-react'
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
  segmentRole: string | null // R475: STEBER | ROCNIK | POLNILO_M | POLNILO_M2 | null
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
  segmentKey: string | null; group: string | null; wastePct: number | null; sourceRule: string | null // R475
}

interface BomPlan {
  product: { id: string; sku: string; name: string; unit: string }
  variant: { id: string; sku: string; name: string } | null
  qty: number; unit: string
  lines: BomPlanLine[]
  materialCost: number; salePriceUnit: number; montazaUnit: number
  totalSale: number; totalCost: number; margin: number; marginPct: number
  priceSource: string
  segmentsApplied: number; warnings: { code: string; message: string }[]; segmentEngine: string | null // R475
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

// ── R464 (GitHub issue #1): generična konfiguracijska pravila (KONFIG:<ključ>,
// brez produkta/artikla) — ocene viz/3D konfiguratorja, ki živijo v ceniku.
const KONFIG_RULE_LABELS: Record<string, string> = {
  'KONFIG:STEBER': 'Steber (konfigurator) — ocena',
  'KONFIG:ROCNIK': 'Ročnik na meter (konfigurator)',
  'KONFIG:STEKLO': 'Steklena plošča na m² (konfigurator)',
  'KONFIG:MONTAZA': 'Montaža na meter (konfigurator)',
  'KONFIG:PRIPRAVA': 'Priprava in rezerva % (konfigurator)',
  'KONFIG:PROFIL_OCENA': 'Profil — ocena na meter (konfigurator)',
}
const konfigLabel = (r: PriceRuleRow | null): string | null =>
  r?.note != null && r.note.startsWith('KONFIG:')
    ? (KONFIG_RULE_LABELS[r.note] ?? r.note)
    : null

// ── R448 (issue #7 §11): preslikava kod družin v slovenska imena hitrega filtra ──
const FAMILY_LABELS: Record<string, string> = {
  TERASA: 'Terase',
  OGRAJA_PRECNA: 'Ograje prečne',
  OGRAJA_POKOCNA: 'Ograje pokončne',
  FASADA: 'Fasade',
  PREGRADA: 'Pregrade',
  NAPUSC: 'Napušči',
  STROP: 'Stropi',
  STOPNICE: 'Stopnice',
  VRTNA_RESITEV: 'Vrtne rešitve',
  KOMPONENTA: 'Komponente',
}

function familyLabel (code: string, fallback: string): string {
  return FAMILY_LABELS[code] ?? fallback
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
            family === 'all' ? 'border-roksal-amber bg-roksal-amber/10 text-roksal-amber' : 'border-border bg-background text-muted-foreground hover:border-roksal-amber/50'
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
              family === f.code ? 'border-roksal-amber bg-roksal-amber/10 text-roksal-amber' : 'border-border bg-background text-muted-foreground hover:border-roksal-amber/50'
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
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onReload={detail.reload}
        />
      </Dialog>
    </div>
  )
}

// ─── podrobnost izdelka: variante + BOM predloga + kalkulator ────────────────

function ProductDialog ({ detail, loading, canCalc, canWrite, onClose, onReload }: {
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
  const [importing, setImporting] = useState(false)

  const rows = lists.data?.data ?? []

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-xl text-xs text-muted-foreground">
            Poslovne cene niso hardcodirane — živijo kot pravila cenika. Uvozite jih iz CSV/XLSX/JSON (glava: SKU;Cena;Enota;Popust %;Min cena;Veljavno od;Veljavno do;Opomba).
          </p>
          <Button size="sm" onClick={() => setImporting(true)}>
            <Upload className="mr-1.5 size-4" aria-hidden /> Uvozi cenik
          </Button>
        </div>
      ) : null}
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
                              {konfigLabel(r) ? (
                                <span className="font-medium">{konfigLabel(r)}</span>
                              ) : (
                                <>
                                  <span className="font-mono text-xs text-muted-foreground">{r.product?.sku ?? r.item?.sku}</span>
                                  <span className="ml-2 font-medium">{r.product?.name ?? r.item?.name}</span>
                                </>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-bold">{r.unit === '%' ? `${r.price} %` : fmtEUR(r.price)}<span className="text-xs font-normal text-muted-foreground"> / {r.product?.unit ?? r.item?.unit ?? r.unit}</span></TableCell>
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

      <ImportCenikDialog
        open={importing}
        onOpenChange={setImporting}
        lists={rows}
        onImported={async () => { setImporting(false); await lists.reload() }}
      />
    </div>
  )
}

/** R516 (issue #15 Faza 6): uvoz cenika iz CSV/XLSX/JSON — PREVERI (brez
 *  zapisov, diff se pokaže) nato UVOZI. Cene ostanejo PODATEK (PriceRule). */
function ImportCenikDialog ({ open, onOpenChange, lists, onImported }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  lists: PriceListRow[]
  onImported: () => Promise<void>
}) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [targetId, setTargetId] = useState<string>('__nov__')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('PRODAJNA')
  const [result, setResult] = useState<CenikImportResult | null>(null)
  const [rowErrors, setRowErrors] = useState<{ row: number; field: string; problem: string }[] | null>(null)
  const [busy, setBusy] = useState(false)

  function reset (): void {
    setFile(null); setResult(null); setRowErrors(null)
    if (inputRef.current != null) inputRef.current.value = ''
  }

  async function run (mode: 'preveri' | 'uvozi'): Promise<void> {
    if (file == null || !token) return
    if (targetId === '__nov__' && newName.trim() === '') {
      toast({ title: 'Vnesite ime novega cenika.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', mode)
      if (targetId === '__nov__') {
        fd.append('name', newName.trim())
        fd.append('type', newType)
      } else {
        fd.append('priceListId', targetId)
      }
      const res = await fetch('/api/import/cenik', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const raw = await res.json().catch(() => ({})) as { data?: CenikImportResult; error?: string; hint?: string; rowErrors?: { row: number; field: string; problem: string }[]; diff?: CenikImportResult['diff'] }
      if (!res.ok) {
        setRowErrors(raw.rowErrors ?? null)
        setResult(raw.error != null && raw.diff != null ? { ...raw.diff, mode: 'preveri', lines: 0 } as CenikImportResult : null)
        throw new Error([raw.error ?? `Napaka strežnika (${res.status}).`, raw.hint].filter(Boolean).join(' '))
      }
      setRowErrors(null)
      if (mode === 'preveri') {
        setResult(raw.data ?? null)
      } else {
        const d = raw.data
        toast({
          title: `Cenik „${d?.list?.name ?? ''}“ uvožen (${d?.novo ?? 0} novih, ${d?.posodobljeno ?? 0} nadomeščenih pravil).`,
          description: 'Cene so zapisane kot pravila cenika — izračuni ponudb jih upoštevajo od zdaj.',
        })
        reset()
        onOpenChange(false)
        await onImported()
      }
    } catch (e) {
      toast({ title: 'Uvoz ni uspel.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const d = result?.diff
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onOpenChange(false) } else { onOpenChange(true) } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>Uvoz cenika</DialogTitle>
          <DialogDescription>
            CSV (podpičje, decimalna vejica ali pika), XLSX ali JSON. Najprej PREVERI (brez zapisov) — predogled se pokaže spodaj. Neznani SKU zavrne CEL uvoz.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.json"
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-secondary/80"
            aria-label="Datoteka cenika (CSV, XLSX ali JSON)"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setRowErrors(null) }}
          />

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cenik-target">Cilj uvoza</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger id="cenik-target"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nov__">Nov cenik …</SelectItem>
                  {lists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name} ({PL_TYPE_LABELS[l.type] ?? l.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {targetId === '__nov__' ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="cenik-name">Ime novega cenika</Label>
                  <Input id="cenik-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="npr. Prodajni cenik 2027" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="cenik-type">Tip</Label>
                  <Select value={newType} onValueChange={setNewType}>
                    <SelectTrigger id="cenik-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRODAJNA">Prodajni</SelectItem>
                      <SelectItem value="NABAVNA">Nabavni</SelectItem>
                      <SelectItem value="MONTAZA">Montažni</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}
          </div>

          {file != null ? (
            <p className="text-xs text-muted-foreground">{file.name} · {Math.max(1, Math.round(file.size / 1024))} KB</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Glava: <span className="font-mono">SKU;Cena;Enota;Popust %;Min cena;Veljavno od;Veljavno do;Opomba</span> — enota je neobvezna (vzame se iz kataloga), datumi ISO ali DD.MM.YYYY.
            </p>
          )}

          {rowErrors != null && rowErrors.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert">
              <p className="mb-1 font-bold">Napake v vrsticah ({rowErrors.length}):</p>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                {rowErrors.map((e, i) => <li key={i}>Vrsta {e.row} · {e.field}: {e.problem}</li>)}
              </ul>
            </div>
          ) : null}

          {result != null && d != null ? (
            <div className="space-y-2 rounded-lg border bg-secondary/30 p-3 text-xs">
              <p className="font-bold">Predogled: {result.lines} vrstic · {result.skus ?? 0} SKU</p>
              <p className={d.neznani.length === 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium text-red-700 dark:text-red-400'}>
                {d.novo} novih · {d.posodobljeno} nadomeščenih{d.neznani.length > 0 ? ` · ${d.neznani.length} NEZNANIH SKU (uvoz bo zavrnjen)` : ''}
              </p>
              {d.entries != null && d.entries.length > 0 ? (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono">
                  {d.entries.slice(0, 30).map((e: { kind: string; sku: string; unit: string | null; fromPrice?: number; toPrice: number }, i: number) => (
                    <li key={i}>
                      {e.kind === 'NOVO' ? '+' : e.kind === 'POSODOBLJENO' ? '±' : '✗'} {e.sku}
                      {e.kind === 'POSODOBLJENO' ? `: ${e.fromPrice} → ${e.toPrice}` : `: ${e.toPrice}`} EUR/{e.unit ?? '?'}
                    </li>
                  ))}
                </ul>
              ) : null}
              {(result.warnings ?? []).length > 0 ? (
                <ul className="space-y-0.5 text-muted-foreground">
                  {(result.warnings ?? []).slice(0, 5).map((w: string, i: number) => <li key={i}>• {w}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" disabled={busy || file == null} onClick={() => { void run('preveri') }}>
              {busy ? '…' : 'Preveri'}
            </Button>
            <Button type="button" disabled={busy || file == null || (d != null && d.neznani.length > 0)} onClick={() => { void run('uvozi') }}>
              {busy ? '…' : 'Uvozi'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface CenikImportResult {
  mode: string
  lines: number
  skus?: number
  list?: { id: string | null; name: string; type: string }
  novo?: number
  posodobljeno?: number
  diff?: {
    novo: number
    posodobljeno: number
    neznani: string[]
    brezEnote: string[]
    entries: { kind: string; sku: string; unit: string | null; fromPrice?: number; toPrice: number }[]
  }
  warnings?: string[]
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
    // generično konfiguracijsko pravilo prenesemo kot key (note = KONFIG:<ključ>)
    const konfigKey = ctx.rule?.note?.startsWith('KONFIG:')
      ? ctx.rule.note.slice('KONFIG:'.length)
      : null
    try {
      await apiPost(`/api/price-lists/${ctx.listId}/rules`, {
        productId: ctx.rule?.product?.id ?? null,
        itemId: ctx.rule?.item?.id ?? null,
        key: konfigKey,
        price: p,
        discountPct: Number.isFinite(d) ? d : 0,
        unit: ctx.rule?.product?.unit ?? ctx.rule?.item?.unit ?? ctx.rule?.unit ?? 'm2',
      })
      toast({ title: 'Pravilo shranjeno.', description: konfigKey
        ? `${konfigLabel(ctx.rule) ?? konfigKey}: ${p}`
        : ctx.rule ? `${ctx.rule.product?.name ?? ctx.rule.item?.name}: ${fmtEUR(p)}` : undefined })
      await onSaved()
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  if (!ctx) return null
  const target = konfigLabel(ctx.rule) ?? (ctx.rule?.product?.name ?? ctx.rule?.item?.name ?? '')
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

// ─── Originalna produktna gradiva ROKSAL (R493, issue #6 §5/§6) ─────────────
// Iskreni statusi: Preverjeno / V preverjanju / Manjka / Ni odobreno.
// Približki (VLM barva, RAL_HEX) so VEDNO ločeno označeni od uradnih podatkov.

interface AssetRow {
  id: string
  kind: string
  orientation: string | null
  view: string | null
  colorName: string | null
  colorApprox: string | null
  filePath: string | null
  cdnUrl: string | null
  sourceUrl: string | null
  sha256: string | null
  bytes: number | null
  sourceName: string
  status: string
  note: string | null
}

const ASSET_KIND_LABEL: Record<string, string> = {
  FOTO_IZDELEK: 'Fotografija izdelka',
  PROFIL_PRESEK: 'Presek profila',
  BARVNA_LESTVICA: 'Barvna lestvica',
  DETAJL: 'Detajl',
  GALERIJA: 'Galerija (referenčna montaža)',
  KOMPONENTA: 'Komponenta',
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  VERIFIED: { label: 'Preverjeno', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
  NEEDS_REVIEW: { label: 'V preverjanju', cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200' },
  MISSING: { label: 'Manjka datoteka', cls: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200' },
  NOT_AUTHORIZED: { label: 'Ni odobreno', cls: 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300' },
}

function ProductAssetsSection ({ productId }: { productId: string }) {
  const q = useApi<{ data: AssetRow[]; colors?: string[] }>(`/api/product-assets?productId=${productId}`, [productId])
  const rows = q.data?.data ?? []
  const colors = q.data?.colors ?? []

  if (q.loading) {
    return (
      <section className="space-y-1.5" aria-label="Produktna gradiva">
        <h3 className="text-sm font-semibold">Produktna gradiva</h3>
        <p className="text-xs text-muted-foreground">Nalagam …</p>
      </section>
    )
  }
  if (q.error) {
    return (
      <section className="space-y-1.5" aria-label="Produktna gradiva">
        <h3 className="text-sm font-semibold">Produktna gradiva</h3>
        <ErrorBox error={q.error} />
      </section>
    )
  }
  if (rows.length === 0) return null

  const verified = rows.filter((a) => a.status === 'VERIFIED').length
  const scaleRows = rows.filter((a) => a.kind === 'BARVNA_LESTVICA')
  const otherRows = rows.filter((a) => a.kind !== 'BARVNA_LESTVICA')
  return (
    <section className="space-y-2" aria-label="Produktna gradiva">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Produktna gradiva</h3>
        <Badge variant="secondary" className="border-transparent bg-secondary text-xs text-secondary-foreground">
          <ShieldCheck className="mr-1 size-3" aria-hidden />{verified}/{rows.length} preverjenih
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Izvirniki: {rows[0]?.sourceName ?? 'Roksal d.o.o.'}. Dovoljenje: izvajalec dela za Roksal (izjava lastnika). Izvirne datoteke se ne spreminjajo; izpeljane različice nosijo sled do izvirnika.
      </p>

      {/* R494: barvne lestvice — čez celo širino, neskrčene, z imeni odtenkov */}
      {scaleRows.map((a) => {
        const st = STATUS_BADGE[a.status] ?? STATUS_BADGE.NEEDS_REVIEW
        const src = a.filePath ? a.filePath.replace(/^public/, '') : a.cdnUrl ?? a.sourceUrl ?? ''
        return (
          <div key={a.id} className="overflow-hidden rounded-lg border bg-card">
            {a.status === 'MISSING' ? (
              <div className="flex h-28 items-center justify-center bg-muted/60 p-2 text-center text-[11px] text-muted-foreground" role="img" aria-label="Datoteka barvne lestvice ni bila prenesena">
                Barvna lestvica obstaja na roksal.com — datoteka ni prenesena (WAF). Izvorni URL in alt so zabeleženi.
              </div>
            ) : src ? (
              <img
                src={src}
                alt={ASSET_KIND_LABEL[a.kind] ?? a.kind}
                className="w-full bg-white object-contain dark:bg-zinc-900"
                loading="lazy"
                width={1024}
                height={320}
              />
            ) : (
              <div className="flex h-28 items-center justify-center bg-muted/60 text-xs text-muted-foreground">brez datoteke</div>
            )}
            <div className="space-y-1.5 p-2">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold leading-tight">Uradna barvna lestvica (roksal.com)</span>
                <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
              </div>
              {colors.length > 0 ? (
                <div className="flex flex-wrap gap-1" aria-label="Imena odtenkov">
                  {colors.map((c) => (
                    <span key={c} className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">{c}</span>
                  ))}
                </div>
              ) : null}
              {a.note ? <p className="text-[10px] leading-snug text-muted-foreground" title={a.note}>{a.note.slice(0, 160)}{a.note.length > 160 ? '…' : ''}</p> : null}
              {a.sha256 ? <p className="truncate font-mono text-[9px] text-muted-foreground" title={a.sha256}>sha256: {a.sha256.slice(0, 12)}…</p> : null}
              {a.sourceUrl ? (
                <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-roksal-amber hover:underline" title={a.sourceUrl}>izvirnik (roksal.com)</a>
              ) : null}
            </div>
          </div>
        )
      })}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {otherRows.map((a) => {
          const st = STATUS_BADGE[a.status] ?? STATUS_BADGE.NEEDS_REVIEW
          const src = a.filePath ? a.filePath.replace(/^public/, '') : a.cdnUrl ?? a.sourceUrl ?? ''
          return (
            <li key={a.id} className="overflow-hidden rounded-lg border bg-card">
              {a.status === 'MISSING' ? (
                <div className="flex h-28 items-center justify-center bg-muted/60 p-2 text-center text-[11px] text-muted-foreground" role="img" aria-label="Datoteka gradiva ni bila prenesena">
                  Gradivo obstaja na roksal.com — datoteka ni prenesena. Izvorni URL in alt so zabeleženi.
                </div>
              ) : src ? (
                <img
                  src={src}
                  alt={ASSET_KIND_LABEL[a.kind] ?? a.kind}
                  className="h-28 w-full object-cover"
                  loading="lazy"
                  width={320}
                  height={160}
                />
              ) : (
                <div className="flex h-28 items-center justify-center bg-muted/60 text-xs text-muted-foreground">brez datoteke</div>
              )}
              <div className="space-y-1 p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold leading-tight">{ASSET_KIND_LABEL[a.kind] ?? a.kind}</span>
                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                </div>
                <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  {a.orientation && a.orientation !== 'SPLOSNO' ? <span className="rounded bg-muted px-1 py-0.5">{a.orientation === 'POKOCNA' ? 'pokončna' : a.orientation === 'PRECNA' ? 'prečna' : a.orientation}</span> : null}
                  {a.view ? <span className="rounded bg-muted px-1 py-0.5">{a.view.toLowerCase()}</span> : null}
                  {a.colorName ? <span className="rounded bg-muted px-1 py-0.5">barva: {a.colorName} (potrjena)</span> : null}
                  {a.colorApprox ? <span className="rounded bg-muted px-1 py-0.5">približno: {a.colorApprox} (VLM ocena, ni uradno ime)</span> : null}
                </div>
                {a.sha256 ? <p className="truncate font-mono text-[9px] text-muted-foreground" title={a.sha256}>sha256: {a.sha256.slice(0, 12)}…</p> : null}
                {a.sourceUrl ? (
                  <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-roksal-amber hover:underline" title={a.sourceUrl}>izvirnik (roksal.com)</a>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {rows.some((a) => a.status === 'MISSING') ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Manjkajo uradne barvne lestvice (datoteke). Imena odtenkov so zapisana v slikah na roksal.com in jih bo mogoče dokončno potrditi z datotekami od Roksala — v aplikaciji niso izmišljena.
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground">Odtenki so potrjeni z uradnimi lestvicami roksal.com (2026-10-12) in z naslovi galerijskih fotografij (2026-10-13, oznaka »potrjena«) — fotografije profil×barv so iz Roksalovih galerij. Odtenka Golden teak in White sta potrjena samo s sliko lestvice.</p>
      )}
    </section>
  )
}

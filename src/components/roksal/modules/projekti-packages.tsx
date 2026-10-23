'use client'

// PROJEKTI — produktni paketi (R442/R476): seznam, primerjalne skupine
// (STANDARD/BOLJŠI/PREMIUM), nov paket.
// R546: izvlečeno iz projekti.tsx BREZ spremembe obnašanja; skupni tipi v projekti-shared.ts.
// Pogled kosovnice (PackageBomDialog) ostaja v projekti.tsx (vezan na r511 sidra).

import { useMemo, useState } from 'react'
import { ClipboardList, Layers, Plus, Scale } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPatch, apiPost, fmtDate, fmtEUR, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { TIER_ORDER, tierLabel } from '@/lib/quote-core'
import { PACKAGE_STATUS_OPTIONS, type PackageCalc, type PackageRow } from './projekti-shared'
import { PackageBomDialog } from './projekti-bom'

export function PackagesSection ({ projectId, projectCode, measurements }: {
  projectId: string
  projectCode: string
  measurements: { id: string; type: string; location: string | null; createdAt: string }[]
}) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const packages = useApi<{ data: PackageRow[] }>(`/api/project-packages?projectId=${projectId}`, [projectId])
  const [createOpen, setCreateOpen] = useState(false)
  const [bomView, setBomView] = useState<PackageRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const canManage = hasPerm(user?.perms, 'quotes.create')
  const rows = packages.data?.data ?? []
  const withBom = rows.filter((p) => p.bom).length

  // R476: primerjalne skupine (paketi z compareCode) — izris nad navadnim seznamom
  const compareGroups = useMemo(() => {
    const m = new Map<string, PackageRow[]>()
    for (const p of rows) {
      if (p.compareCode) m.set(p.compareCode, [...(m.get(p.compareCode) ?? []), p])
    }
    return [...m.entries()].map(([code, members]) => ({
      code,
      members: [...members].sort((a, b) => {
        const ia = a.tier ? TIER_ORDER.indexOf(a.tier as (typeof TIER_ORDER)[number]) : 99
        const ib = b.tier ? TIER_ORDER.indexOf(b.tier as (typeof TIER_ORDER)[number]) : 99
        return ia - ib
      }),
    }))
  }, [rows])
  const regularRows = useMemo(() => rows.filter((p) => !p.compareCode), [rows])

  async function generateBom (pkg: PackageRow) {
    setBusyId(pkg.id)
    try {
      const res = await apiPost<{ data: { bom: { code: string }; calc: PackageCalc } }>(`/api/project-packages/${pkg.id}/bom`, {})
      toast({
        title: 'Kosovnica generirana.',
        description: `${res.data.bom.code} · ${res.data.calc.lines} vrstic · marža ${res.data.calc.marginPct} %`,
      })
      await packages.reload()
    } catch (e) {
      toast({ title: 'Generiranje ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusyId(null) }
  }

  async function changeStatus (pkg: PackageRow, status: string) {
    setBusyId(pkg.id)
    try {
      await apiPatch(`/api/project-packages/${pkg.id}`, { status })
      toast({ title: 'Status paketa posodobljen.', description: `${pkg.code} → ${status}` })
      await packages.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusyId(null) }
  }

  return (
    <section aria-label="Produktni paketi projekta">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Produktni paketi</h3>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nov paket
          </Button>
        ) : null}
      </div>
      <ErrorBox error={packages.error} />
      {packages.loading ? <LoadingRows rows={1} /> : !packages.error ? (
        <div className="space-y-2 rounded-xl border p-3">
          <p className="inline-flex items-center gap-2 text-sm">
            <Layers className="size-4 text-roksal-amber" aria-hidden />
            {rows.length > 0 ? `${rows.length} paketov · ${withBom} s kosovnico${compareGroups.length ? ` · ${compareGroups.length} primerjav` : ''}` : 'Ni paketov'}
            <span className="text-xs text-muted-foreground">— vsak paket je ena rešitev (terasa, ograja, fasada …)</span>
          </p>

          {/* R476: primerjalne skupine — isti obseg v nivojih STANDARD/BOLJSI/PREMIUM */}
          {compareGroups.map((g) => (
            <CompareGroupCard
              key={g.code}
              group={g}
              canManage={canManage}
              busyId={busyId}
              onGenerateBom={generateBom}
              onStatus={changeStatus}
              onBomView={setBomView}
            />
          ))}

          {regularRows.length > 0 ? (
            <AnimatedList className="space-y-2">
              {regularRows.map((p) => (
                <AnimatedListItem key={p.id} className="rounded-lg border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                    <StatusBadge status={p.status} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <span className="shrink-0 text-sm font-bold">{p.qty} <span className="text-xs font-normal text-muted-foreground">{p.unit}</span></span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{p.product.sku}</span>
                    {p.variant ? <span>· {p.variant.name}</span> : null}
                    {p.measurement ? <span>· izmera #{p.measurement.id.slice(-6)}</span> : null}
                    {p.bom ? (
                      <button
                        className="inline-flex items-center gap-1 font-medium text-roksal-amber-text hover:underline"
                        onClick={() => setBomView(p)}
                      >
                        <ClipboardList className="size-3" aria-hidden /> {p.bom.code} ({p.bom.lines.length})
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1"><ClipboardList className="size-3" aria-hidden /> brez kosovnice</span>
                    )}
                  </div>
                  {p.note ? <p className="mt-1 text-xs text-muted-foreground">{p.note}</p> : null}
                  {canManage ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void generateBom(p)} disabled={busyId === p.id}>
                        <ClipboardList className="size-3.5" aria-hidden /> {p.bom ? 'Ponovno generiraj BOM' : 'Generiraj BOM'}
                      </Button>
                      <Select value={p.status} onValueChange={(v) => void changeStatus(p, v)}>
                        <SelectTrigger className="h-7 w-40 text-xs" aria-label={`Status paketa ${p.code}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PACKAGE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </AnimatedListItem>
              ))}
            </AnimatedList>
          ) : (
            <p className="text-xs text-muted-foreground">
              {canManage ? 'Dodajte paket — npr. TERASA 36,4 m² + OGRAJA 18,6 m za isti projekt.' : 'Pakete ureja pisarna (quotes.create).'}
            </p>
          )}
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewPackageDialog
          projectId={projectId}
          projectCode={projectCode}
          measurements={measurements}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await packages.reload() }}
        />
      </Dialog>

      <Dialog open={!!bomView} onOpenChange={(o) => { if (!o) setBomView(null) }}>
        <PackageBomDialog pkg={bomView} />
      </Dialog>
    </section>
  )
}

// ── R476: primerjalna skupina paketov (isti obseg, več nivojev) ───────────────

/** Izračun iz calcJson (konfigurator { inputs, plan } ali BOM kalkulacija). R542: jsonb objekt. */
function parsePkgSale (calcJson: Record<string, unknown> | null): { totalSale: number | null; marginPct: number | null } {
  if (!calcJson) return { totalSale: null, marginPct: null }
  const parsed = calcJson as {
    plan?: { totalSale?: number; marginPct?: number }
    totalSale?: number
    marginPct?: number
  }
  return {
    totalSale: typeof parsed.plan?.totalSale === 'number' ? parsed.plan.totalSale
      : typeof parsed.totalSale === 'number' ? parsed.totalSale : null,
    marginPct: typeof parsed.plan?.marginPct === 'number' ? parsed.plan.marginPct
      : typeof parsed.marginPct === 'number' ? parsed.marginPct : null,
  }
}

function CompareGroupCard ({ group, canManage, busyId, onGenerateBom, onStatus, onBomView }: { // R546: lokalen gradnik paketov
  group: { code: string; members: PackageRow[] }
  canManage: boolean
  busyId: string | null
  onGenerateBom: (pkg: PackageRow) => Promise<void>
  onStatus: (pkg: PackageRow, status: string) => Promise<void>
  onBomView: (pkg: PackageRow) => void
}) {
  // referenčni nivo = prvi z izračunano ceno (ponavadi STANDARD)
  const refSale = group.members
    .map((m) => parsePkgSale(m.calcJson).totalSale)
    .find((v): v is number => v != null && v > 0) ?? null

  return (
    <div className="space-y-2 rounded-xl border-2 border-amber-200 p-3 dark:border-amber-900/50">
      <div className="flex flex-wrap items-center gap-2">
        <Scale className="size-4 text-roksal-amber" aria-hidden />
        <span className="text-sm font-semibold">Primerjava {group.code}</span>
        <span className="text-xs text-muted-foreground">
          — isti obseg v {group.members.length} nivojih (STANDARD / BOLJŠI / PREMIUM)
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {group.members.map((p) => (
          <CompareTierCard
            key={p.id}
            pkg={p}
            refSale={refSale}
            canManage={canManage}
            busy={busyId === p.id}
            onGenerateBom={onGenerateBom}
            onStatus={onStatus}
            onBomView={onBomView}
          />
        ))}
      </div>
    </div>
  )
}

function CompareTierCard ({ pkg, refSale, canManage, busy, onGenerateBom, onStatus, onBomView }: { // R546: lokalen gradnik paketov
  pkg: PackageRow
  refSale: number | null
  canManage: boolean
  busy: boolean
  onGenerateBom: (pkg: PackageRow) => Promise<void>
  onStatus: (pkg: PackageRow, status: string) => Promise<void>
  onBomView: (pkg: PackageRow) => void
}) {
  const { totalSale, marginPct } = useMemo(() => parsePkgSale(pkg.calcJson), [pkg.calcJson])
  const deltaPct = totalSale != null && refSale != null && refSale > 0
    ? Math.round(((totalSale - refSale) / refSale) * 100)
    : null

  return (
    <div className="space-y-1.5 rounded-lg border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {tierLabel(pkg.tier)}
        </span>
        <StatusBadge status={pkg.status} />
      </div>
      <p className="min-w-0 truncate text-sm font-medium" title={pkg.name}>{pkg.name}</p>
      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{pkg.product.sku}</span>
        {pkg.variant ? <span>· {pkg.variant.name}</span> : null}
        <span>· {pkg.qty} {pkg.unit}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">
          {totalSale != null ? fmtEUR(totalSale) : <span className="text-xs font-normal text-muted-foreground">brez izračuna</span>}
        </span>
        {deltaPct != null && deltaPct !== 0 ? (
          <span className={cn('text-xs font-semibold', deltaPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
            {deltaPct > 0 ? '+' : ''}{deltaPct} %
          </span>
        ) : null}
      </div>
      {marginPct != null ? (
        <p className="text-[11px] text-muted-foreground">marža {marginPct} % (interno)</p>
      ) : null}
      {pkg.bom ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-roksal-amber-text hover:underline"
          onClick={() => onBomView(pkg)}
        >
          <ClipboardList className="size-3" aria-hidden /> {pkg.bom.code} ({pkg.bom.lines.length})
        </button>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <ClipboardList className="size-3" aria-hidden /> brez kosovnice
        </span>
      )}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void onGenerateBom(pkg)} disabled={busy}>
            <ClipboardList className="size-3.5" aria-hidden /> {pkg.bom ? 'BOM' : 'Generiraj BOM'}
          </Button>
          <Select value={pkg.status} onValueChange={(v) => void onStatus(pkg, v)}>
            <SelectTrigger className="h-7 w-36 text-xs" aria-label={`Status paketa ${pkg.code}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {PACKAGE_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}

function NewPackageDialog ({ projectId, projectCode, measurements, onClose, onCreated }: { // R546: lokalen gradnik paketov
  projectId: string
  projectCode: string
  measurements: { id: string; type: string; location: string | null; createdAt: string }[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { toast } = useToast()
  const [family, setFamily] = useState('all')
  const [productId, setProductId] = useState('none')
  const [variantId, setVariantId] = useState('none')
  const [qty, setQty] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [measurementId, setMeasurementId] = useState('none')
  const [busy, setBusy] = useState(false)

  const families = useApi<{ data: { code: string; name: string }[] }>('/api/product-families')
  const products = useApi<{ data: { id: string; sku: string; name: string; unit: string; family: { code: string; name: string }; variants: { id: string; name: string }[] }[] }>(
    `/api/products?family=${family}`, [family]
  )

  const prodRows = products.data?.data ?? []
  const selected = prodRows.find((p) => p.id === productId) ?? null

  async function submit () {
    if (productId === 'none') { toast({ title: 'Izberite izdelek.', variant: 'destructive' }); return }
    const qv = Number(qty)
    if (!Number.isFinite(qv) || qv <= 0) { toast({ title: 'Količina mora biti pozitivno število.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/project-packages', {
        projectId, productId,
        variantId: variantId !== 'none' ? variantId : null,
        qty: qv, name: name.trim() || undefined, note: note.trim() || undefined,
        measurementId: measurementId !== 'none' ? measurementId : null,
      })
      toast({ title: 'Paket dodan.', description: `${projectCode} — ${selected?.name ?? ''}` })
      await onCreated()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Nov produktni paket</DialogTitle>
        <DialogDescription>{projectCode} — ena rešitev na projektu (terasa, ograja, fasada …).</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Družina</Label>
            <Select value={family} onValueChange={(v) => { setFamily(v); setProductId('none'); setVariantId('none') }}>
              <SelectTrigger aria-label="Družina"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vse družine</SelectItem>
                {(families.data?.data ?? []).map((f) => <SelectItem key={f.code} value={f.code}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="npk-qty">Količina</Label>
            <Input id="npk-qty" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={selected ? `npr. 36.4 (${selected.unit})` : 'npr. 36.4'} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Izdelek</Label>
          <Select value={productId} onValueChange={(v) => { setProductId(v); setVariantId('none') }}>
            <SelectTrigger aria-label="Izdelek"><SelectValue placeholder="Izberite izdelek" /></SelectTrigger>
            <SelectContent>
              {prodRows.map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {selected && selected.variants.length > 0 ? (
          <div className="space-y-2">
            <Label>Varianta</Label>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger aria-label="Varianta"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— osnovna —</SelectItem>
                {selected.variants.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="npk-name">Prikazno ime (neobvezno)</Label>
          <Input id="npk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={selected ? `npr. ${selected.family.name} — ${selected.name}` : 'npr. Terasa — WPC Grafit'} />
        </div>
        {measurements.length > 0 ? (
          <div className="space-y-2">
            <Label>Veži na izmero (neobvezno)</Label>
            <Select value={measurementId} onValueChange={setMeasurementId}>
              <SelectTrigger aria-label="Izmera"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— brez —</SelectItem>
                {measurements.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.location ?? m.type} · {fmtDate(m.createdAt)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="npk-note">Opomba (neobvezno)</Label>
          <Input id="npk-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. padec 1,5 % proti robu" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Dodajam …' : 'Dodaj paket'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

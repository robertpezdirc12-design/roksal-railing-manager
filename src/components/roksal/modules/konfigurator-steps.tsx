'use client'

// KONFIGURATOR — koraki čarovnika (1, 2, 4, 5, 6) + rezultat.
// R546: izvlečeno iz konfigurator.tsx (bil 1752 vrstic) BREZ spremembe obnašanja —
// merilni korak (3) živi v konfigurator-meritve.tsx, stanje in tok ostajajo v konfigurator.tsx.
// Vsi skupni tipi/pomočniki so v konfigurator-shared.ts (en vir resnice).

import { Calculator, CheckCircle2, ClipboardList, FolderKanban, Layers, Loader2, Package, Plus, Save, Scale, TriangleAlert } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { fmtEUR } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { PACKAGE_TIERS, TIER_HINTS, TIER_LABELS, tierLabel } from '@/lib/quote-core'
import { cn } from '@/lib/utils'
import { round2, type CompareGroupRow, type FamilyRow, type PlanData, type ProductDetail, type ProductRow, type ProjectRow, type SaveResult, type VariantRow } from './konfigurator-shared'

// ─── 1. PROJEKT ───────────────────────────────────────────────────────────────

export function StepProjekt ({ projects, total, loading, error, projectId, showClosed, selected, onSelect, onToggleClosed }: {
  projects: ProjectRow[]
  total: number
  loading: boolean
  error: { message: string; detail?: string } | null
  projectId: string
  showClosed: boolean
  selected: ProjectRow | null
  onSelect: (id: string) => void
  onToggleClosed: () => void
}) {
  return (
    <section aria-label="Izbira projekta" className="space-y-4">
      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={2} /> : !error ? (
        projects.length === 0 ? (
          <EmptyState
            title="Ni odprtih projektov"
            desc={showClosed ? 'V bazi ni projektov — najprej ustvarite projekt v modulu Projekti.' : 'Odprli ste samo aktivne projekte — vklopite tudi zaključene/arhivirane ali ustvarite novega v modulu Projekti.'}
            icon={FolderKanban}
          />
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="konf-projekt">Projekt (obvezno)</Label>
              <Select value={projectId || 'none'} onValueChange={(v) => { if (v !== 'none') onSelect(v) }}>
                <SelectTrigger id="konf-projekt" className="h-11" aria-label="Izberite projekt">
                  <SelectValue placeholder="Izberite projekt" />
                </SelectTrigger>
                <SelectContent>
                  {/* sentinel drži select kontroliran tudi pred izbiro (Radix ne sprejema praznega value) */}
                  <SelectItem value="none" disabled>— izberite projekt —</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.title} ({p.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border p-3">
              <Switch checked={showClosed} onCheckedChange={onToggleClosed} aria-label="Pokaži tudi zaključene in arhivirane projekte" />
              <span className="text-sm">
                Pokaži tudi zaključene / arhivirane
                <span className="ml-1.5 text-xs text-muted-foreground">({projects.length}/{total} prikazanih)</span>
              </span>
            </label>
          </div>
        )
      ) : null}

      {selected ? (
        <div className="space-y-1.5 rounded-xl border bg-secondary/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{selected.code}</span>
            <StatusBadge status={selected.status} />
            <span className="text-sm font-semibold">{selected.title}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.customer ? `${selected.customer.name}${selected.customer.city ? `, ${selected.customer.city}` : ''}` : 'Brez stranke'}
            {' '}· paket se veže na ta projekt ({selected.code})
          </p>
        </div>
      ) : null}
    </section>
  )
}

// ─── 2. IZDELEK (+ varianta) ──────────────────────────────────────────────────

export function StepIzdelek ({ families, products, loading, error, familyCode, productId, variantId, onFamily, onProduct, onVariant }: {
  families: FamilyRow[]
  products: ProductRow[]
  loading: boolean
  error: { message: string; detail?: string } | null
  familyCode: string
  productId: string
  variantId: string
  onFamily: (v: string) => void
  onProduct: (id: string) => void
  onVariant: (v: string) => void
}) {
  const selected = products.find((p) => p.id === productId) ?? null
  return (
    <section aria-label="Izbira izdelka" className="space-y-4">
      <ErrorBox error={error} />
      <div className="space-y-2">
        <Label htmlFor="konf-family">Družina (filter)</Label>
        <Select value={familyCode} onValueChange={onFamily}>
          <SelectTrigger id="konf-family" className="h-11" aria-label="Filtriraj po družini">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vse družine</SelectItem>
            {families.map((f) => <SelectItem key={f.code} value={f.code}>{f.name} ({f.unit})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? <LoadingRows rows={3} /> : !error && products.length === 0 ? (
        <EmptyState title="Ni izdelkov v tej družini" desc="Izberite drugo družino ali dodajte izdelek v Katalogu." icon={Package} />
      ) : !error ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Izdelki">
          {products.map((p) => {
            const isSel = p.id === productId
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onProduct(p.id)}
                  aria-pressed={isSel}
                  className={cn(
                    'flex w-full flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors hover:bg-secondary/50',
                    isSel && 'bg-roksal-amber/5 ring-2 ring-roksal-amber',
                  )}
                >
                  <span className="flex w-full flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                    <span className="text-sm font-bold">
                      {fmtEUR(p.salePrice)}<span className="text-xs font-normal text-muted-foreground"> / {p.unit}</span>
                    </span>
                  </span>
                  <span className="text-sm font-medium leading-snug">{p.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="rounded bg-secondary px-1.5 py-0.5">{p.family.name}</span>
                    {p.variants.length > 0 ? <span className="rounded bg-secondary px-1.5 py-0.5">{p.variants.length} variant</span> : null}
                    {p._count.components > 0
                      ? <span className="rounded bg-secondary px-1.5 py-0.5">{p._count.components} komponent</span>
                      : <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-300">brez BOM predloge</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {selected && selected.variants.length > 0 ? (
        <div className="space-y-2">
          <Label htmlFor="konf-variant">Varianta (barva / RAL)</Label>
          <Select value={variantId || 'none'} onValueChange={onVariant}>
            <SelectTrigger id="konf-variant" className="h-11" aria-label="Izberite varianto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— osnovna (brez variante) —</SelectItem>
              {selected.variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}{v.ral ? ` (${v.ral})` : ''}{v.salePrice != null ? ` — ${fmtEUR(v.salePrice)}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Override cene variante se upošteva prek izračuna (planBom); če velja cenik (PRODAJNA), ima ta prednost.
          </p>
        </div>
      ) : null}
    </section>
  )
}

// ─── 4. BARVA / OPCIJE ────────────────────────────────────────────────────────

export function StepOpcije ({ product, variantId, onVariant, optionalComps, requiredCount, includeOptional, onIncludeOptional, loading, error }: {
  product: ProductRow
  variantId: string
  onVariant: (v: string) => void
  optionalComps: ProductDetail['components']
  requiredCount: number
  includeOptional: boolean
  onIncludeOptional: (v: boolean) => void
  loading: boolean
  error: { message: string; detail?: string } | null
}) {
  return (
    <section aria-label="Barva in opcije" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="konf-variant-2">Varianta (barva / RAL)</Label>
        {product.variants.length > 0 ? (
          <Select value={variantId || 'none'} onValueChange={onVariant}>
            <SelectTrigger id="konf-variant-2" className="h-11" aria-label="Izberite varianto"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— osnovna (brez variante) —</SelectItem>
              {product.variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}{v.ral ? ` (${v.ral})` : ''}{v.color ? ` · ${v.color}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="rounded-lg border border-dashed p-2.5 text-sm text-muted-foreground">
            Izdelek {product.sku} nima variant — uporabi se osnovna specifikacija (barvanje po RAL prek komponent predloge).
          </p>
        )}
      </div>

      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={2} /> : !error ? (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Layers className="size-4 text-roksal-amber" aria-hidden /> Neobvezne komponente (checklist iz BOM predloge)</h3>
          {optionalComps.length === 0 ? (
            <p className="rounded-lg border border-dashed p-2.5 text-sm text-muted-foreground">
              Ta izdelek nima neobveznih komponent — kosovnica bo vsebovala {requiredCount} obveznih.
            </p>
          ) : (
            <ul className="space-y-1.5" aria-label="Neobvezne komponente">
              {optionalComps.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-11 items-center gap-3 rounded-lg border p-2.5">
                    <Checkbox
                      checked={includeOptional}
                      onCheckedChange={(v) => onIncludeOptional(v === true)}
                      aria-label={`Vključi ${c.item.sku} v kosovnico`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.item.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        <span className="font-mono">{c.item.sku}</span> · {c.qty} {c.unitBasis} na enoto
                        {c.note ? ` · ${c.note}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Predloga ne razlikuje posamičnih neobveznih komponent — vključijo/izključijo se skupaj
            ({requiredCount} obveznih ostaja vedno v kosovnici).
          </p>
        </div>
      ) : null}
    </section>
  )
}

// ─── 5. IZRAČUN (dry-run planBom) ─────────────────────────────────────────────

export function StepIzracun ({ plan, busy, error, onRecalc, familyLabel }: {
  plan: PlanData | null
  busy: boolean
  error: string | null
  onRecalc: () => void
  familyLabel: string
}) {
  const missing = plan?.lines.filter((l) => !l.covered) ?? []

  if (busy) return <LoadingRows rows={4} />
  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBox error={{ message: error }} />
        <Button variant="outline" className="h-11" onClick={onRecalc}>
          <Calculator className="size-4" aria-hidden /> Ponovno izračunaj
        </Button>
      </div>
    )
  }
  if (!plan) {
    return (
      <div className="space-y-3">
        <EmptyState title="Ni izračuna" desc="Sprožite dry-run izračun — kosovnica, zaloga, cena in marža." icon={Calculator} />
        <Button className="h-11" onClick={onRecalc}>
          <Calculator className="size-4" aria-hidden /> Izračunaj
        </Button>
      </div>
    )
  }

  return (
    <section aria-label="Rezultat izračuna" className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <SummaryTile label="Količina" value={`${plan.qty} ${plan.unit}`} hint={familyLabel} />
        <SummaryTile label="Material (strošek)" value={fmtEUR(plan.materialCost)} hint={`${plan.lines.length} vrstic BOM${plan.segmentsApplied > 0 ? ` · ${plan.segmentsApplied} segmentov` : ''}`} />
        <SummaryTile label="Prodajna cena / enoto" value={fmtEUR(plan.salePriceUnit)} hint={plan.montazaUnit > 0 ? `vključeno: montaža ${fmtEUR(plan.montazaUnit)}` : `montaža ${fmtEUR(plan.montazaUnit)}`} />
        <SummaryTile label="Skupaj (prodaja)" value={fmtEUR(plan.totalSale)} hint={`(${fmtEUR(plan.salePriceUnit + plan.montazaUnit)} × ${plan.qty})`} />
        <SummaryTile label="Marža — interno" value={`${fmtEUR(plan.margin)} (${plan.marginPct} %)`} hint="vidno samo pisarni" tone="green" />
        <SummaryTile label="Vir cene" value={plan.priceSource} hint={plan.variant ? `varianta ${plan.variant.sku}` : 'brez variante'} />
      </div>

      {/* R475: opozorila segmentne izpeljave (vidna, ne tiha) */}
      {(plan.warnings ?? []).length > 0 ? (
        <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" role="alert">
          <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert className="size-4" aria-hidden /> Opozorila segmentnega izračuna</p>
          <ul className="list-inside list-disc space-y-0.5 text-xs">
            {(plan.warnings ?? []).map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" role="alert">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>{missing.length} {missing.length === 1 ? 'artikel manjka' : 'artiklov manjka'} na zalogi:</strong>{' '}
            {missing.map((l) => `${l.sku} (−${l.missing} ${l.unit})`).join(', ')}. Kosovnico lahko ustvarite — pomanjkanje se pokaže pri rezervaciji.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Vseh {plan.lines.length} artiklov kosovnice je pokritih s trenutno zalogo.</span>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          <ClipboardList className="size-4 text-roksal-amber" aria-hidden />
          {plan.segmentsApplied > 0
            ? <>Kosovnica po segmentih — {plan.segmentsApplied} {plan.segmentsApplied === 1 ? 'odsek' : plan.segmentsApplied < 5 ? 'odseki' : 'odsekov'}</>
            : <>Kosovnica (predloga × {plan.qty} {plan.unit})</>}
        </h3>
        <ul className="space-y-1.5">
          {plan.lines.map((l, i) => (
            <li key={`${l.itemId}-${l.segmentKey ?? 'x'}-${i}`} className="rounded-lg border p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{l.sku}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={l.name}>{l.name}</span>
                {l.segmentKey ? (
                  <Badge className="border-transparent bg-roksal-amber/15 text-roksal-amber dark:text-roksal-amber">{l.segmentKey}</Badge>
                ) : null}
                {l.covered ? (
                  <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">na zalogi ({l.stockQty})</Badge>
                ) : (
                  <Badge className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">manjka {l.missing} {l.unit}</Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{l.qty} {l.unit}</span>
                <span className="tabular-nums">{fmtEUR(l.unitCost)} / {l.unit}</span>
                <span className="font-medium tabular-nums text-foreground">skupaj {fmtEUR(l.lineCost)}</span>
                {l.optional ? <span className="rounded bg-secondary px-1.5 py-0.5">neobvezna</span> : null}
                {l.wastePct != null && l.wastePct > 0 ? <span className="rounded bg-secondary px-1.5 py-0.5" title={l.sourceRule ?? ''}>+ {l.wastePct} % odpad</span> : null}
                {l.note ? <span className="italic">{l.note}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Dry-run — nič se ni shranilo. Marža in nabavne cene so interni podatki (pravica quotes.create).
        </p>
        <Button variant="outline" className="h-11" onClick={onRecalc}>
          <Calculator className="size-4" aria-hidden /> Ponovno izračunaj
        </Button>
      </div>
    </section>
  )
}

function SummaryTile ({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'green' }) { // R546: lokalni gradnik StepIzračuna
  return (
    <div className="rounded-lg border bg-secondary/30 p-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-bold leading-tight sm:text-base', tone === 'green' && 'text-emerald-600 dark:text-emerald-400')}>{value}</div>
      {hint ? <div className="truncate text-[11px] text-muted-foreground" title={hint}>{hint}</div> : null}
    </div>
  )
}

// ─── 6. SHRANI ────────────────────────────────────────────────────────────────

export function StepShrani ({ project, product, variant, plan, name, setName, note, setNote, genBom, setGenBom, genQuote, setGenQuote, tier, setTier, comparePick, setComparePick, compareGroups, busy, onSave }: {
  project: ProjectRow | null
  product: ProductRow
  variant: VariantRow | null
  plan: PlanData
  name: string; setName: (v: string) => void
  note: string; setNote: (v: string) => void
  genBom: boolean; setGenBom: (v: boolean) => void
  genQuote: boolean; setGenQuote: (v: boolean) => void
  tier: string; setTier: (v: string) => void
  comparePick: string; setComparePick: (v: string) => void
  compareGroups: CompareGroupRow[]
  busy: boolean
  onSave: () => void
}) {
  const hasTemplate = plan.lines.length > 0
  return (
    <section aria-label="Shrani paket" className="space-y-4">
      <div className="space-y-1.5 rounded-xl border bg-secondary/30 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{project?.code}</span>
          {project ? <StatusBadge status={project.status} /> : null}
          <span className="font-semibold">{project?.title}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{variant?.sku ?? product.sku}</span> · {product.name}
          {variant ? ` — ${variant.name}` : ''} · <strong className="text-foreground">{plan.qty} {plan.unit}</strong>
          {' '}· prodaja skupaj <strong className="text-foreground">{fmtEUR(plan.totalSale)}</strong>
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="konf-name">Prikazno ime paketa</Label>
        <Input id="konf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Terasa — WPC Grafit" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="konf-note">Opomba (neobvezno)</Label>
        <Input id="konf-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. padec 1,5 % proti robu, rok 3 tedne" />
      </div>

      <div className="space-y-1.5">
        <label className="flex min-h-11 items-center gap-3 rounded-lg border p-3">
          <Checkbox
            checked={genBom && hasTemplate}
            disabled={!hasTemplate}
            onCheckedChange={(v) => setGenBom(v === true)}
            aria-label="Generiraj kosovnico ob shranitvi"
          />
          <span className="text-sm">
            Generiraj kosovnico (BOM)
            <span className="block text-xs text-muted-foreground">
              {hasTemplate ? `${plan.lines.length} vrstic iz predloge · status OSNUTEK` : 'Izdelek nima BOM predloge — kosovnica ni mogoča'}
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border p-3">
          <Checkbox
            checked={genQuote}
            onCheckedChange={(v) => setGenQuote(v === true)}
            aria-label="Ustvari osnutek ponudbe ob shranitvi"
          />
          <span className="text-sm">
            Ustvari osnutek ponudbe (PON)
            <span className="block text-xs text-muted-foreground">
              1 pozicija: {variant?.sku ?? product.sku} × {plan.qty} {plan.unit} po {fmtEUR(round2(plan.salePriceUnit + plan.montazaUnit))} (DDV 22 % doda strežnik)
            </span>
          </span>
        </label>
      </div>

      {/* R476: primerjalna ponudba — isti obseg v več nivojih */}
      <div className="space-y-2 rounded-xl border p-3">
        <div className="flex items-center gap-2">
          <Scale className="size-4 text-roksal-amber" aria-hidden />
          <span className="text-sm font-semibold">Primerjalna ponudba</span>
          <span className="text-xs text-muted-foreground">— isti obseg v več rešitvah (neobvezno)</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="konf-tier">Nivo paketa</Label>
            <Select value={tier || 'brez'} onValueChange={(v) => { setTier(v === 'brez' ? '' : v) }}>
              <SelectTrigger id="konf-tier" aria-label="Nivo primerjalnega paketa"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="brez">Brez primerjave</SelectItem>
                {PACKAGE_TIERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIER_LABELS[t]} — {TIER_HINTS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tier ? (
            <div className="space-y-1.5">
              <Label htmlFor="konf-compare">Skupina primerjave</Label>
              <Select
                value={comparePick}
                onValueChange={(v) => setComparePick(v)}
              >
                <SelectTrigger id="konf-compare" aria-label="Skupina primerjave"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Nova primerjava</SelectItem>
                  {compareGroups.map((g) => (
                    <SelectItem key={g.code} value={g.code}>
                      {g.code} (prosti: {g.free.map((t) => TIER_LABELS[t]).join(', ')})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {comparePick === 'new'
                  ? 'Ustvari novo skupino primerjave — naslednji nivo ji pridružite z istim izborom.'
                  : `Paket se pridruži obstoječi primerjavi na projektu ${project?.code ?? ''}.`}
              </p>
            </div>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Vsak nivo je en paket (po navadi drugačen izdelek/varianta) — v Projektih se primerjava izriše
          drug ob drugem s cenami, stranka pa izbere ravovesje med ceno in kakovostjo.
        </p>
      </div>

      <Button className="h-11 w-full sm:w-auto" onClick={onSave} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
        {busy ? 'Ustvarjam …' : 'Ustvari paket'}
      </Button>
    </section>
  )
}

// ─── Rezultat ─────────────────────────────────────────────────────────────────

export function SaveResultPanel ({ result, projectCode, onNew, onOpenProjects, onOpenBom }: {
  result: SaveResult
  projectCode: string
  onNew: () => void
  onOpenProjects: () => void
  onOpenBom: () => void
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-8 shrink-0 text-roksal-green" aria-hidden />
          <div>
            <h2 className="text-lg font-bold">Paket {result.packageCode} ustvarjen</h2>
            <p className="text-sm text-muted-foreground">
              Projekt {projectCode} · status KONFIGURACIJA · strukturirane meritve shranjene v kalkulacijo paketa.
            </p>
          </div>
        </div>

        <ul className="space-y-1.5 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <Package className="size-4 text-muted-foreground" aria-hidden />
            <span>Paket <span className="font-mono font-medium">{result.packageCode}</span></span>
            <StatusBadge status="KONFIGURACIJA" />
            {result.tier ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <Scale className="size-3" aria-hidden /> {tierLabel(result.tier)} · {result.compareCode}
              </span>
            ) : null}
          </li>
          {result.bomCode ? (
            <li className="flex flex-wrap items-center gap-2">
              <ClipboardList className="size-4 text-muted-foreground" aria-hidden />
              <span>Kosovnica <span className="font-mono font-medium">{result.bomCode}</span></span>
              <StatusBadge status="OSNUTEK" />
            </li>
          ) : null}
          {result.quoteCode ? (
            <li className="flex flex-wrap items-center gap-2">
              <Calculator className="size-4 text-muted-foreground" aria-hidden />
              <span>Osnutek ponudbe <span className="font-mono font-medium">{result.quoteCode}</span></span>
              <StatusBadge status="OSNUTEK" />
            </li>
          ) : null}
        </ul>

        <div className="space-y-2 rounded-xl border bg-secondary/30 p-3 text-sm">
          <p className="font-medium">Kam naprej:</p>
          <p className="text-muted-foreground">
            Paket, status in kalkulacijo urejate v <strong>Projekti → {projectCode} → Produktni paketi</strong>.
          </p>
          <p className="text-muted-foreground">
            Rezervacijo materiala in picking izvedete v <strong>Zajem → Kosovnice</strong> ({result.bomCode ?? 'kosovnico generirajte iz paketa'}).
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" className="h-11" onClick={onOpenProjects}>
              <FolderKanban className="size-4" aria-hidden /> Odpri Projekte
            </Button>
            {result.bomCode ? (
              <Button variant="outline" className="h-11" onClick={onOpenBom}>
                <ClipboardList className="size-4" aria-hidden /> Odpri Kosovnice
              </Button>
            ) : null}
            <Button className="h-11" onClick={onNew}>
              <Plus className="size-4" aria-hidden /> Nova konfiguracija
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

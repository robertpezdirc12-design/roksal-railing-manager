'use client'

// primerjava.tsx — skupni izris POTEM (drawPotem) + predogled (4. korak) +
// PREJ/POTEM primerjava (5. korak: slider, ghost, variante A/B/C, akcije,
// shranjene vizualizacije). R537-c: čisto razbitje foto-replace.tsx (brez
// sprememb obnašanja) — useDrawPotem/usePrimerjava sta selitvi NEPREKINJENIH
// nizov hookov (vrstni red klicev identičen izvirniku); OBA zaslonska klica
// drawPotem tukaj uporabljata semeIzrisa iz ./stanje (R536-c veriga semena,
// dobesedno enaka — preostala dva klica živita v izvoz.ts).

import { useCallback, useEffect } from 'react'
import { Check, Download, Eye, FileImage, FolderKanban, Layers, Loader2, Save, Trash2, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { fmtDate, useApi } from '@/lib/api-client'
import { jeGenericniIzdelek, OZNAKA_GENERIKA } from '@/lib/katalog-original'
import { izrisiOgrajo, izrisiPrimerjavo, oceniSvetlobo, type MaterialInfo, type Opozorilo, type RenderParams, type Tocka } from '@/lib/photo-replace-core'
import type { VirTeksture } from '@/lib/photo-replace-texture'
import { cn } from '@/lib/utils'
import { semeIzrisa } from './stanje'
import type { SlojiStanje } from './oznacevanje'
import { VARIANT_LABELS, type DrawPotemFn, type ProductRow, type SavedVizRow, type SlotState, type VariantLabel } from './tipi'

/** useApi odgovor seznama shranjenih vizualizacij (prop savedList). */
type SavedListApi = ReturnType<typeof useApi<{ data: SavedVizRow[] }>>

/** Skupni izris POTEM + zapis opozoril izrisa — selitev 2 useCallbackov iz vstopa. */
export function useDrawPotem ({ photoImg, tekstura, prekrij, sloji, barva, material, setRenderWarnings }: {
  photoImg: HTMLImageElement | null
  tekstura: VirTeksture | null
  prekrij: boolean
  sloji: SlojiStanje
  barva: string
  material: MaterialInfo
  setRenderWarnings: React.Dispatch<React.SetStateAction<Opozorilo[]>>
}) {
  /** Skupni izris POTEM na podan ctx (fotografija + svetloba + ograja).
   *  Vrni opozorila, ki jih je poganjalnik izdal PRI tem izrisu (dokaz z izrisa). */
  const drawPotem = useCallback((
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    p: RenderParams,
    opts: { meja?: number; zig?: boolean; ghostAlpha?: number; seme: number }
  ): Opozorilo[] => {
    if (!photoImg) return []
    // svetloba ocenimo IZ FOTOGRAFIJE (pred izrisom ograje)
    ctx.drawImage(photoImg, 0, 0, W, H)
    const svet = oceniSvetlobo(ctx, W, H, p.quad.map((t) => ({ x: t.x * W, y: t.y * H })) as [Tocka, Tocka, Tocka, Tocka])
    // R507: obnovljeno ozadje + prednji plan + preverjena tekstura (samo kadar
    // je bila izbira preverjena — sicer poganjalnik riše barvni preliv in to tudi pove)
    const plast = {
      gradivo: tekstura,
      ozadje: prekrij ? sloji?.ozadje ?? null : null,
      prednji: sloji?.prednji ?? null,
    }
    if (opts.meja !== undefined) {
      return izrisiPrimerjavo(ctx, photoImg, W, H, p, barva, material, svet, opts.meja,
        { ghost: opts.ghostAlpha ?? 1, zig: opts.zig, seme: opts.seme, prekrijStaro: prekrij, ...plast })
    }
    return izrisiOgrajo(ctx, W, H, p, barva, material, svet,
      { ghost: opts.ghostAlpha ?? 1, zig: opts.zig, seme: opts.seme, prekrijStaro: prekrij, ...plast })
  }, [photoImg, barva, material, prekrij, sloji, tekstura])

  /** Opozorila SHRANIJO se ob dejanskem izrisu — ne napovedano iz parametrov. */
  // R537-ac-verify: dobesedna selitev iz foto-replace.tsx:655–661 — ročni
  // useCallback ostaja (prev/nove opozorile primerja po vsebini, vrne staro
  // referenco ob enakosti — namerno ohranjena memoizacija). Prevajalnik React
  // Compiler memoizacije iz setRenderWarnings propa ne more izpeljati;
  // pretvorba bi spremenila identiteto funkcije med renderji (tehnični dolg R497).
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const zapisiOpozorila = useCallback((w: Opozorilo[]): void => {
    setRenderWarnings((prev) => (
      prev.length === w.length && prev.every((p, i) => p.koda === w[i].koda && p.sporocilo === w[i].sporocilo)
        ? prev
        : w
    ))
  }, [])
  return { drawPotem, zapisiOpozorila }
}

/** Zaslonska izrisa: predogled POTEM (4. korak, debounce 120 ms) in primerjava
 *  PREJ/POTEM (5. korak, 60 ms) — selitev 2 useEffectov iz vstopa. */
export function usePrimerjava ({ step, params, photoImg, photoW, photoH, drawPotem, zapisiOpozorila, ghost, ghostOpacity, comparePos, slot, active, previewRef, compareRef }: {
  step: number
  params: RenderParams | null
  photoImg: HTMLImageElement | null
  photoW: number
  photoH: number
  drawPotem: DrawPotemFn
  zapisiOpozorila: (w: Opozorilo[]) => void
  ghost: boolean
  ghostOpacity: number
  comparePos: number
  slot: SlotState
  active: VariantLabel
  previewRef: React.RefObject<HTMLCanvasElement | null>
  compareRef: React.RefObject<HTMLCanvasElement | null>
}): void {
  // ── 4. korak: predogled POTEM (debounce) ──
  useEffect(() => {
    if (step !== 3 || !params || !photoImg) return
    const t = setTimeout(() => {
      const canvas = previewRef.current
      if (!canvas) return
      const W = Math.min(1100, photoW)
      const H = Math.round(W * (photoH / photoW))
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      zapisiOpozorila(drawPotem(ctx, W, H, params, { ghostAlpha: ghost ? ghostOpacity / 100 : 1, seme: semeIzrisa(params, slot.savedId, active) }))
    }, 120)
    return () => clearTimeout(t)
  }, [step, params, photoImg, photoW, photoH, drawPotem, zapisiOpozorila, ghost, ghostOpacity, slot.savedId, active])

  // ── 5. korak: PREJ/POTEM primerjava ──
  useEffect(() => {
    if (step !== 4 || !params || !photoImg) return
    const t = setTimeout(() => {
      const canvas = compareRef.current
      if (!canvas) return
      const W = Math.min(1100, photoW)
      const H = Math.round(W * (photoH / photoW))
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      zapisiOpozorila(drawPotem(ctx, W, H, params, { meja: comparePos / 100, ghostAlpha: ghost ? ghostOpacity / 100 : 1, seme: semeIzrisa(params, slot.savedId, active) }))
    }, 60)
    return () => clearTimeout(t)
  }, [step, params, photoImg, photoW, photoH, drawPotem, zapisiOpozorila, comparePos, ghost, ghostOpacity, slot.savedId, active])
}

/** UI 5. koraka — zavihki variant, primerjava PREJ/POTEM, akcije in shranjene
 *  vizualizacije (čista komponenta). */
export function PotemPrimerjava ({ slots, active, savedRows, preklopiVarianto, params, compareRef, product, comparePos, setComparePos, ghost, setGhost, ghostOpacity, setGhostOpacity, slot, updateSlot, canWrite, saveBusy, exportBusy, shrani, izvozi, izvoziPdf, vKonfigurator, savedList, rowBusy, nastaviStatus, odpri }: {
  slots: Record<VariantLabel, SlotState>
  active: VariantLabel
  savedRows: SavedVizRow[]
  preklopiVarianto: (label: VariantLabel) => void
  params: RenderParams | null
  compareRef: React.RefObject<HTMLCanvasElement | null>
  product: ProductRow | null
  comparePos: number
  setComparePos: React.Dispatch<React.SetStateAction<number>>
  ghost: boolean
  setGhost: React.Dispatch<React.SetStateAction<boolean>>
  ghostOpacity: number
  setGhostOpacity: React.Dispatch<React.SetStateAction<number>>
  slot: SlotState
  updateSlot: (fn: (s: SlotState) => SlotState) => void
  canWrite: boolean
  saveBusy: boolean
  exportBusy: 'png' | 'primerjava' | 'pdf' | null
  shrani: () => Promise<void>
  izvozi: (format: 'png' | 'primerjava') => Promise<void>
  izvoziPdf: () => Promise<void>
  vKonfigurator: () => void
  savedList: SavedListApi
  rowBusy: string | null
  nastaviStatus: (id: string, status: 'IZBRANA' | 'ARHIV') => Promise<void>
  odpri: (id: string) => Promise<void>
}) {
  return (
            <div className="space-y-4">
              {/* zavihki variant */}
              <div role="tablist" aria-label="Variante vizualizacije" className="flex flex-wrap items-center gap-2">
                {VARIANT_LABELS.map((l) => {
                  const sl = slots[l]
                  const savedRow = savedRows.find((r) => r.variantLabel === l)
                  return (
                    <button
                      key={l} type="button" role="tab" aria-selected={active === l}
                      onClick={() => preklopiVarianto(l)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
                        active === l ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-foreground/30'
                      )}
                    >
                      Varianta {l}
                      {savedRow?.status === 'IZBRANA' ? <Badge className="bg-emerald-600">izbrana</Badge> :
                        savedRow?.status === 'ARHIV' ? <Badge variant="secondary">arhiv</Badge> :
                        sl.savedId ? <Badge variant="outline">shranjena</Badge> : null}
                    </button>
                  )
                })}
                <p className="text-xs text-muted-foreground">Vsaka varianta ima svojo konfiguracijo — stari posnetki se ne prepisujejo.</p>
              </div>

              {params ? (
                <>
                  <div className="relative overflow-hidden rounded-lg border bg-muted">
                    <canvas ref={compareRef} className="block h-auto w-full" role="img" aria-label="Primerjava PREJ in POTEM" />
                    <span className="pointer-events-none absolute left-2 top-2 rounded bg-background/85 px-2 py-0.5 text-xs font-bold">PREJ</span>
                    <span className="pointer-events-none absolute right-2 top-2 rounded bg-background/85 px-2 py-0.5 text-xs font-bold">POTEM</span>
                  </div>
                  {/* R527 (issue #14 §5): izrecna oznaka ob samem rezultatu — uporabnik
                      vidi, da je prikaz generičnega demo izdelka barvni približek */}
                  {product && jeGenericniIzdelek(product.sku) ? (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs" data-testid="genericni-izdelek-potem">
                      <p className="font-semibold text-amber-800 dark:text-amber-300">{OZNAKA_GENERIKA + '.'}</p>
                      <p className="mt-1 text-muted-foreground">{'Brez preverjenih ROKSALOVIH gradiv — izris je barvni približek iz kataloške barve/RAL, ne originalna površina.'}</p>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="pv-slider" className="flex items-center justify-between text-xs font-semibold">
                      <span>PREJ / POTEM</span>
                      <span className="text-muted-foreground">{comparePos} %</span>
                    </Label>
                    <Slider
                      id="pv-slider" min={0} max={100} step={1} value={[comparePos]}
                      onValueChange={(v) => setComparePos(v[0] ?? 50)}
                      aria-label="Premik med PREJ in POTEM"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="pv-ghost" className="flex items-center justify-between text-xs font-semibold">
                        <span>Ghost pogled (prosojnost nove ograje)</span>
                        <span className="text-muted-foreground">{ghost ? `${ghostOpacity} %` : 'izklopljen'}</span>
                      </Label>
                      <div className="flex items-center gap-2">
                        <Switch id="pv-ghost-switch" checked={ghost} onCheckedChange={setGhost} aria-label="Vklopi ghost pogled" />
                        <Slider
                          id="pv-ghost" min={10} max={95} step={5} value={[ghostOpacity]}
                          onValueChange={(v) => setGhostOpacity(v[0] ?? 55)}
                          disabled={!ghost}
                          aria-label="Prosojnost nove ograje"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pv-note" className="text-xs font-semibold">Opomba variante</Label>
                      <Input id="pv-note" className="h-11" placeholder="npr. Varianta s pokončnimi lamelami" value={slot.note} onChange={(e) => updateSlot((s) => ({ ...s, note: e.target.value }))} />
                    </div>
                  </div>

                  {/* akcije */}
                  <div className="flex flex-wrap gap-2">
                    {canWrite ? (
                      <Button type="button" className="h-11" onClick={() => { void shrani() }} disabled={saveBusy || !product}>
                        {saveBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                        {slot.savedId ? `Posodobi varianto ${active} (nova verzija)` : `Shrani varianto ${active}`}
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" className="h-11" onClick={() => { void izvozi('png') }} disabled={exportBusy !== null}>
                      {exportBusy === 'png' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />} Izvozi POTEM (PNG)
                    </Button>
                    <Button type="button" variant="outline" className="h-11" onClick={() => { void izvozi('primerjava') }} disabled={exportBusy !== null}>
                      {exportBusy === 'primerjava' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileImage className="size-4" aria-hidden />} Izvozi PREJ/POTEM
                    </Button>
                    {slot.savedId ? (
                      <>
                        <Button type="button" variant="outline" className="h-11" onClick={() => { void izvoziPdf() }} disabled={exportBusy !== null}>
                          {exportBusy === 'pdf' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileImage className="size-4" aria-hidden />} PDF dokument
                        </Button>
                        <Button type="button" variant="outline" className="h-11" onClick={vKonfigurator}>
                          <Wand2 className="size-4" aria-hidden /> Uporabi v konfiguratorju
                        </Button>
                      </>
                    ) : null}
                  </div>
                </>
              ) : (
                <EmptyState title="Manjkajo podatki za izris" desc="Dokončajte oznake in izberite izdelek." icon={Eye} />
              )}

              {/* shranjene variante */}
              <div className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Layers className="size-4 text-roksal-amber" aria-hidden /> Shranjene vizualizacije projekta</h3>
                {savedList.loading ? <LoadingRows rows={2} /> : savedList.error ? <ErrorBox error={savedList.error} /> : savedRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Za ta projekt še ni shranjenih vizualizacij.</p>
                ) : (
                  <ul className="max-h-96 space-y-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                    {savedRows.map((r) => (
                      <li key={r.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                              Varianta {r.variantLabel}
                              <StatusBadge status={r.status === 'IZBRANA' ? 'POTRJENO' : r.status === 'ARHIV' ? 'ZAKLJUCEN' : 'AKTIVNI'} />
                              <span className="text-xs font-normal text-muted-foreground">v{r._count.versions} · {fmtDate(r.updatedAt)}</span>
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {r.product?.name ?? r.productId}{r.product && jeGenericniIzdelek(r.product.sku) ? ' (generični)' : ''}{r.variant ? ` · ${r.variant.name}${r.variant.ral ? ` (${r.variant.ral})` : ''}` : ''}
                              {r.measurementId ? ` · meritev v${r.measurementVersion ?? 1}` : ''} · {r.author?.name ?? '—'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Button type="button" size="sm" variant="outline" className="h-9" disabled={rowBusy === r.id} onClick={() => { void odpri(r.id) }}>
                              {rowBusy === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FolderKanban className="size-3.5" aria-hidden />} Odpri
                            </Button>
                            {canWrite && r.status !== 'IZBRANA' ? (
                              <Button type="button" size="sm" variant="outline" className="h-9" disabled={rowBusy === r.id} onClick={() => { void nastaviStatus(r.id, 'IZBRANA') }}>
                                <Check className="size-3.5" aria-hidden /> Izberi
                              </Button>
                            ) : null}
                            {canWrite && r.status !== 'ARHIV' ? (
                              <Button type="button" size="sm" variant="ghost" className="h-9 text-muted-foreground hover:text-red-600" disabled={rowBusy === r.id} onClick={() => { void nastaviStatus(r.id, 'ARHIV') }}>
                                <Trash2 className="size-3.5" aria-hidden /> Arhiviraj
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
  )
}

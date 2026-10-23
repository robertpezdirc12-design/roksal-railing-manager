'use client'

// PROJEKTI — kosovnica paketa: pogled po skupinah (R475), vir obsega (R511),
// izvoz CSV/XLSX (R477) in uvoz s preverjanjem (R478).
// R546: izvlečeno iz projekti.tsx BREZ spremembe obnašanja; skupni tipi v
// projekti-shared.ts. Uvažata jo projekti.tsx (nič) — PackagesSection
// (projekti-packages.tsx) jo renderira ob kliku na kosovnico.

import { useMemo, useRef, useState } from 'react'
import { FileDown, Layers, Loader2, Search, Upload } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { fmtEUR, useApi } from '@/lib/api-client'
import { ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { type PackageCalc, type PackageRow } from './projekti-shared'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'

export function PackageBomDialog ({ pkg }: { pkg: PackageRow | null }) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const [expBusy, setExpBusy] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importTick, setImportTick] = useState(0)

  // R477 (issue #9 §6): izvoz kosovnice — CSV (podpično, vejica, BOM) ali
  // XLSX (xlsx-mini) s preverjanji pravil pred izvozom (vidna opozorila)
  async function exportBom (format: 'csv' | 'xlsx'): Promise<void> {
    if (!pkg || !token) return
    setExpBusy(format)
    try {
      const res = await fetch(`/api/export/bom/${pkg.id}?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Napaka strežnika (${res.status}).`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kosovnica-${pkg.code}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      toast({ title: `Kosovnica izvožena (${format.toUpperCase()}).`, description: 'Datoteka je prenesena; opozorila pravil so zapisana v izvoz.' })
    } catch (e) {
      toast({
        title: 'Izvoz kosovnice ni uspel.',
        description: e instanceof Error ? e.message : 'Neznana napaka.',
        variant: 'destructive',
      })
    } finally {
      setExpBusy(null)
    }
  }

  const bom = useApi<{ data: { lines: { id: string; itemId: string; qty: number; unit: string; note: string | null; segmentKey: string | null; group: string | null; wastePct: number | null; sourceRule: string | null; item: { sku: string; name: string; unit: string; qty: number } }[]; product: { sku: string; name: string }; qty: number; unit: string; code: string; status: string } }>(
    pkg?.bom ? `/api/bom/${pkg.bom.id}` : null, [pkg?.bom?.id, importTick]
  )
  const d = bom.data?.data
  const calcJson = pkg?.calcJson
  const calc = useMemo<PackageCalc | null>(() => {
    // R542: calcJson je jsonb objekt (brez JSON.parse)
    if (!calcJson) return null
    return calcJson as unknown as PackageCalc
  }, [calcJson])

  // R475: skupine pozicij (STEBRI → ROCNIK → POLNILO → brez) z sumo materiala
  const grouped = useMemo(() => {
    if (!d) return []
    const order = ['STEBRI', 'ROCNIK', 'POLNILO', 'OSTALO']
    const map = new Map<string, typeof d.lines>()
    for (const l of d.lines) {
      const g = l.group ?? 'OSTALO'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(l)
    }
    const labels: Record<string, string> = {
      STEBRI: 'Stebri in sidranje', ROCNIK: 'Ročnik in profili',
      POLNILO: 'Polnilo', OSTALO: 'Pripadnosti in obdelava',
    }
    return [...map.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([g, lines]) => ({
        key: g, label: labels[g] ?? g, lines,
        count: lines.length,
        segments: new Set(lines.map((l) => l.segmentKey).filter(Boolean)).size,
      }))
  }, [d])
  const segCount = calc && typeof (calc as { segmentsApplied?: number }).segmentsApplied === 'number'
    ? (calc as { segmentsApplied: number }).segmentsApplied
    : 0
  // R511 (issue #7 §8/§10): pisarna mora videti, ODKOD so količine — iz
  // potrjenega tekača, iz konfiguratorja ali pa da dokazanega obsega ni.
  const geometrija = (calc as {
    geometrija?: { odlok: string; razlog: string; fenceRunId: string | null; dolzinaCm: number | null; segmentov?: number; opozorila?: string[] } | null
  } | null)?.geometrija ?? null
  const geoSeg = geometrija?.segmentov ?? 0
  // dolžina verige je v cm — pretvorba v metre je samo prikaz, ne izračun.
  const geoM = geometrija?.dolzinaCm != null ? Math.round(geometrija.dolzinaCm) / 100 : null

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      {/* R475: min-w-0 na neposrednih otrocih grid dialoga — brez tega tabela
          (w-full → auto tirnica) razširi tirnico na max-content in vsebina
          na mobilnem gre čez rob dialoga (grid item min-width:auto). */}
      <DialogHeader className="min-w-0">
        <DialogTitle className="flex flex-wrap items-center gap-2">
          Kosovnica {pkg?.bom?.code ?? ''}
          {pkg ? <StatusBadge status={pkg.bom?.status ?? 'OSNUTEK'} /> : null}
        </DialogTitle>
        <DialogDescription>
          {pkg ? `${pkg.name} · ${pkg.qty} ${pkg.unit}` : ''}
          {d ? ` — ${d.product.sku} × ${d.qty} ${d.unit}` : ''}
        </DialogDescription>
      </DialogHeader>
      {pkg?.bom ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { void exportBom('csv') }} disabled={expBusy != null}>
            {expBusy === 'csv' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
            Izvozi CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => { void exportBom('xlsx') }} disabled={expBusy != null}>
            {expBusy === 'xlsx' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
            Izvozi XLSX
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-3.5" aria-hidden />
            Uvozi …
          </Button>
          <span className="text-[11px] text-muted-foreground">CSV: podpično, decimalna vejica (SI) · XLSX: kosovnica + sume + preverjanja</span>
        </div>
      ) : null}
      <ErrorBox error={bom.error} />
      {bom.loading ? <LoadingRows rows={3} /> : d ? (
        <div className="min-w-0 space-y-3">
          {calc ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border bg-secondary/30 p-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Material</div>
                <div className="text-sm font-bold">{fmtEUR(calc.materialCost)}</div>
              </div>
              <div className="rounded-lg border bg-secondary/30 p-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Prodaja</div>
                <div className="text-sm font-bold">{fmtEUR(calc.totalSale)}</div>
              </div>
              <div className="rounded-lg border bg-secondary/30 p-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Marža</div>
                <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtEUR(calc.margin)} · {calc.marginPct} %</div>
              </div>
              <div className="rounded-lg border bg-secondary/30 p-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Vir cene</div>
                <div className="truncate text-sm font-bold">{calc.priceSource}</div>
              </div>
            </div>
          ) : null}
          {segCount > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
              <Layers className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Kosovnica je izpeljana <strong>po {segCount} {segCount === 1 ? 'segmentu' : segCount < 5 ? 'segmentih' : 'segmentih'}</strong> (ključi seg-N so usklajeni z digitalnim dvojčkom in merilnim modelom) —
                stebri iz razmika, dolžine/ploščine z odpadom iz pravil.
              </span>
            </div>
          ) : null}
          {geometrija ? (
            <div className="min-w-0 rounded-lg border p-2.5 text-xs" role="status">
              <p className="font-semibold">
                Vir obsega:
                {geometrija.odlok === 'TEKOC'
                  ? ` potrjen ograjni tekač (${geoSeg} ${geoSeg === 1 ? 'odsek' : geoSeg < 5 ? 'odseki' : 'odsekov'}${geoM != null ? ` · ${geoM} m` : ''})`
                  : geometrija.odlok === 'KONFIGURATOR'
                    ? ' vhodi konfiguratorja'
                    : ' dokazanega obsega ni — količine so predloga × mera'}
              </p>
              <p className="mt-1 break-words text-muted-foreground">{geometrija.razlog}</p>
              {(geometrija.opozorila ?? []).length > 0 ? (
                <p className="mt-1 text-muted-foreground">Opozorila: {(geometrija.opozorila ?? []).join(', ')}.</p>
              ) : null}
            </div>
          ) : null}
          {grouped.map((g) => (
            <div key={g.key} className="overflow-hidden rounded-lg border">
              <div className="flex flex-wrap items-center gap-2 border-b bg-secondary/40 px-3 py-2">
                <span className="text-sm font-semibold">{g.label}</span>
                <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{g.count} {g.count === 1 ? 'vrstica' : g.count < 5 ? 'vrstice' : 'vrstic'}</Badge>
                {g.segments > 0 ? (
                  <Badge variant="secondary" className="border-transparent bg-roksal-amber/15 text-roksal-amber">{g.segments} {g.segments === 1 ? 'segment' : g.segments < 5 ? 'segmenti' : 'segmentov'}</Badge>
                ) : null}
              </div>
              <Table>
                <TableBody>
                  {g.lines.map((l) => (
                    <TableRow key={l.id}>
                      {/* R475: whitespace-normal — osnovni TableCell ima whitespace-nowrap,
                          zaradi česar celica z značko+SKU+imenom+opombo na mobilnem ne prelomi
                          (min-content 394 px) in razširi tabelo čez dialog. */}
                      <TableCell className="whitespace-normal pl-3">
                        {l.segmentKey ? (
                          <Badge variant="outline" className="mb-1 mr-2 font-mono text-[10px] text-roksal-amber">{l.segmentKey}</Badge>
                        ) : null}
                        <span className="font-mono text-xs text-muted-foreground">{l.item.sku}</span>
                        <span className="ml-2 font-medium">{l.item.name}</span>
                        {l.wastePct != null && l.wastePct > 0 ? (
                          <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground" title={l.sourceRule ?? ''}>+ {l.wastePct} % odpad</span>
                        ) : null}
                        {l.note ? <span className="block text-[11px] text-muted-foreground">{l.note}</span> : null}
                      </TableCell>
                      <TableCell className="text-right font-bold">{l.qty} <span className="text-xs font-normal text-muted-foreground">{l.unit}</span></TableCell>
                      <TableCell className="w-24 pr-3">
                        {l.item.qty >= l.qty ? (
                          <Badge variant="secondary" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">pokrito</Badge>
                        ) : (
                          <Badge variant="secondary" className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">manjka {Math.round((l.qty - l.item.qty) * 100) / 100}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Vrstice so vezane na artikle z eksplicitnimi ID — brez ujemanja imen (issue #7 §2).
          </p>
        </div>
      ) : null}
      {/* R478: uvoz kosovnice (round-trip) — preveri (dry-run) nato uvozi */}
      <ImportBomDialog
        pkg={pkg}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => { setImportTick((t) => t + 1) }}
      />
    </DialogContent>
  )
}

// ── R478: UVOZ KOSOVNICE (CSV/XLSX/JSON → paket) ─────────────────────────────

interface BomImportResult {
  mode: 'preveri' | 'uvozi'
  lines: number
  skus?: number
  diff?: {
    unchanged: number
    entries: { sku: string; segmentKey: string | null; kind: 'DODANO' | 'ODSTRANJENO' | 'SPREMENJENA_KOLICINA'; fromQty?: number; toQty?: number }[]
  }
  warnings?: string[]
  bom?: { code: string; lines: number }
  invalidated?: { reset: number; flagged: number; codes: string[] }
}

function ImportBomDialog ({ pkg, open, onOpenChange, onImported }: {
  pkg: PackageRow | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onImported: () => void
}) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BomImportResult | null>(null)
  const [rowErrors, setRowErrors] = useState<{ row: number; field: string; problem: string }[] | null>(null)
  const [busy, setBusy] = useState(false)

  function reset (): void {
    setFile(null); setResult(null); setRowErrors(null)
    if (inputRef.current != null) inputRef.current.value = ''
  }

  async function run (mode: 'preveri' | 'uvozi'): Promise<void> {
    if (!pkg || !file || !token) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('packageId', pkg.id)
      fd.append('mode', mode)
      const res = await fetch('/api/import/bom', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const raw = await res.json().catch(() => ({})) as { data?: BomImportResult; error?: string; rowErrors?: { row: number; field: string; problem: string }[] }
      const data = raw.data ?? (raw as unknown as BomImportResult) // API ovijalnik { data } ali golo
      if (!res.ok) {
        setRowErrors(raw.rowErrors ?? null)
        throw new Error(raw.error ?? `Napaka strežnika (${res.status}).`)
      }
      setRowErrors(null)
      if (mode === 'preveri') {
        setResult(data)
      } else {
        toast({
          title: `Kosovnica ${data.bom?.code ?? ''} uvožena (${data.lines} vrstic).`,
          description: data.invalidated != null && data.invalidated.reset + data.invalidated.flagged > 0
            ? `Povezane ponudbe invalidirane: ${(data.invalidated.codes ?? []).join(', ')}.`
            : 'Kalkulacija (cena/marža) se ni spremenila — cene izračuna ponudba.',
        })
        reset()
        onOpenChange(false)
        onImported()
      }
    } catch (e) {
      toast({ title: 'Uvoz ni uspel.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  const diffRows = result?.diff?.entries ?? []
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onOpenChange(false) } else { onOpenChange(true) } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>Uvoz kosovnice — {pkg?.code ?? ''}</DialogTitle>
          <DialogDescription>
            CSV (podpično, vejica), XLSX (tudi iz Excela) ali JSON izvoz. Najprej PREVERI (brez zapisov) — diff se pokaže spodaj.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.json"
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-secondary/80"
            aria-label="Datoteka kosovnice (CSV, XLSX ali JSON)"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setRowErrors(null) }}
          />
          {file != null ? (
            <p className="text-xs text-muted-foreground">{file.name} · {Math.max(1, Math.round(file.size / 1024))} KB</p>
          ) : (
            <p className="text-xs text-muted-foreground">Vsak SKU mora obstajati v katalogu; segmenti seg-N; skupine STEBRI/ROCNIK/POLNILO/OSTALO.</p>
          )}

          {rowErrors != null && rowErrors.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert">
              <p className="mb-1 font-bold">Napake v vrsticah ({rowErrors.length}):</p>
              <AnimatedList className="max-h-32 space-y-0.5 overflow-y-auto">
                {rowErrors.map((e, i) => <AnimatedListItem key={i}>Vrsta {e.row} · {e.field}: {e.problem}</AnimatedListItem>)}
              </AnimatedList>
            </div>
          ) : null}

          {result != null ? (
            <div className="space-y-2 rounded-lg border bg-secondary/30 p-3 text-xs">
              <p className="font-bold">Preverjanje: {result.lines} vrstic · {result.skus} SKU</p>
              <p className={diffRows.length === 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium text-amber-700 dark:text-amber-400'}>
                {diffRows.length === 0
                  ? `BREZ SPREMEMB — identično trenutni kosovnici (${result.diff?.unchanged ?? 0} vrstic).`
                  : `${diffRows.length} razlik: ${diffRows.filter((e) => e.kind === 'DODANO').length} dodanih, ${diffRows.filter((e) => e.kind === 'ODSTRANJENO').length} odstranjenih, ${diffRows.filter((e) => e.kind === 'SPREMENJENA_KOLICINA').length} spremenjenih količin.`}
              </p>
              {diffRows.length > 0 ? (
                <AnimatedList className="max-h-40 space-y-0.5 overflow-y-auto font-mono">
                  {diffRows.slice(0, 50).map((e, i) => (
                    <AnimatedListItem key={i}>
                      {e.kind === 'DODANO' ? '+' : e.kind === 'ODSTRANJENO' ? '−' : '±'} {e.sku}{e.segmentKey != null ? ` · ${e.segmentKey}` : ''}
                      {e.kind === 'SPREMENJENA_KOLICINA' ? `: ${e.fromQty} → ${e.toQty}` : e.kind === 'DODANO' ? `: ${e.toQty}` : `: ${e.fromQty}`}
                    </AnimatedListItem>
                  ))}
                </AnimatedList>
              ) : null}
              {(result.warnings ?? []).length > 0 ? (
                <AnimatedList className="space-y-0.5 text-amber-700 dark:text-amber-400">
                  {(result.warnings ?? []).map((w, i) => <AnimatedListItem key={i}>⚠ {w}</AnimatedListItem>)}
                </AnimatedList>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { void run('preveri') }} disabled={busy || file == null}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Search className="size-3.5" aria-hidden />}
            Preveri
          </Button>
          <Button onClick={() => { void run('uvozi') }} disabled={busy || file == null}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
            Uvozi (novo verzijo)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

// MATERIAL V5 — BOM/nabava MVP (vrata inventory.write)
// Izbira ponudbe (iz /api/quotes — modul 4-a) → prikaz pozicij kot BOM → "Preveri zalogo"
// (primerjava z /api/inventory po korenskih besedah alu/inox/stekl/barva).
// Samo prikaz — model naročil (bestelling) sledi v naslednji različici.

import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardList, FileText, HelpCircle, Info, PackageSearch, Plus, Trash2, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAppStore } from '@/lib/store'
import { fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { cn } from '@/lib/utils'

interface QuoteLineRow { id?: string; description: string; qty: number; unitPrice?: number }

interface QuoteRow {
  id: string; code: string; status: string; total?: number
  customer?: { name: string } | null
  project?: { code: string; title: string } | null
  lines?: QuoteLineRow[]
}

interface ItemRow { id: string; sku: string; name: string; unit: string; qty: number; reorderAt: number }

interface BomLine { key: string; description: string; qty: number; unitPrice?: number }

interface Coverage {
  status: 'pokrito' | 'manjka' | 'brez'
  available: number
  missing: number
  matched: { sku: string; name: string; qty: number; unit: string }[]
}

// korenske besede za povezovanje pozicij ↔ zaloga (MVP hevristika)
// \b meja besede: "balustrada" NE sproži "alu", "Steklena" PA sproži "stekl"
const ROOTS = ['alu', 'inox', 'stekl', 'barva']

function rootRe (root: string): RegExp {
  return new RegExp(`\\b${root}`, 'i')
}

function rootsOf (text: string): string[] {
  return ROOTS.filter((r) => rootRe(r).test(text))
}

export default function MaterialV5Module () {
  const user = useAppStore((s) => s.user)
  const [quoteId, setQuoteId] = useState('none')
  const [manual, setManual] = useState<BomLine[]>([])
  const [checked, setChecked] = useState(false)

  // ponudbe (4-a) — seznam za izbiro + podrobnost s pozicijami; ob napaki ročni vnos
  const quotes = useApi<{ data: QuoteRow[] }>('/api/quotes?limit=100')
  const quoteDetail = useApi<{ data: QuoteRow }>(quoteId !== 'none' ? `/api/quotes/${quoteId}` : null, [quoteId])
  const inventory = useApi<{ data: ItemRow[] }>(checked ? '/api/inventory' : null, [checked])

  const canWrite = hasPerm(user?.perms, 'inventory.write')
  const quotesFailed = !!quotes.error || (!!quoteId && quoteId !== 'none' && !quoteDetail.loading && !!quoteDetail.error)
  const selectedQuote = quotes.data?.data.find((q) => q.id === quoteId) ?? quoteDetail.data?.data ?? null
  const quoteLines = quoteDetail.data?.data?.lines ?? []
  const quoteEmpty = quoteId !== 'none' && !quoteDetail.loading && !quoteDetail.error && quoteLines.length === 0
  const manualMode = quotesFailed || quoteId === 'none' || quoteEmpty

  // BOM: pozicije izbrane ponudbe (če je na voljo) ALI ročni vnosi
  const bomLines = useMemo<BomLine[]>(() => {
    if (!manualMode) {
      return quoteLines.map((l, i) => ({
        key: `q-${l.id ?? i}`, description: l.description, qty: l.qty, unitPrice: l.unitPrice,
      }))
    }
    return manual
  }, [manualMode, quoteLines, manual])

  // primerjava z zalogo po korenskih besedah
  const coverage = useMemo<Map<string, Coverage>>(() => {
    const map = new Map<string, Coverage>()
    const items = inventory.data?.data ?? []
    for (const line of bomLines) {
      const roots = rootsOf(line.description)
      if (roots.length === 0 || items.length === 0) {
        map.set(line.key, { status: 'brez', available: 0, missing: line.qty, matched: [] })
        continue
      }
      const matched = items.filter((it) => roots.some((r) => rootRe(r).test(it.name)))
      const available = matched.reduce((s, it) => s + it.qty, 0)
      map.set(line.key, {
        status: available >= line.qty ? 'pokrito' : 'manjka',
        available,
        missing: Math.max(0, line.qty - available),
        matched: matched.map((m) => ({ sku: m.sku, name: m.name, qty: m.qty, unit: m.unit })),
      })
    }
    return map
  }, [bomLines, inventory.data])

  const missingCount = bomLines.filter((l) => coverage.get(l.key)?.status === 'manjka').length
  const unknownCount = bomLines.filter((l) => coverage.get(l.key)?.status === 'brez').length

  function addManualLine () {
    setManual((m) => [...m, { key: `m-${Date.now()}`, description: '', qty: 1 }])
    setChecked(false)
  }

  function updateManualLine (key: string, patch: Partial<BomLine>) {
    setManual((m) => m.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setChecked(false)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Material V5"
        desc="Kosovnica (BOM) iz ponudbe in preverjanje zaloge — MVP"
        actions={
          bomLines.length > 0 ? (
            <Button size="sm" onClick={() => { setChecked(true); void inventory.reload() }} disabled={inventory.loading}>
              <PackageSearch className="size-4" aria-hidden /> {checked ? 'Ponovno preveri zalogo' : 'Preveri zalogo'}
            </Button>
          ) : null
        }
      />

      {!canWrite ? null : (
        <p className="flex items-start gap-2 rounded-xl border border-dashed bg-secondary/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-roksal-amber" aria-hidden />
          MVP: kosovnica se primerja z zalogo po korenskih besedah (alu, inox, stekl, barva) in enotah artiklov.
          Ustvarjanje naročil dobaviteljem (bestelling-model) sledi v naslednji različici — trenutno samo prikaz.
        </p>
      )}

      {/* izbira ponudbe */}
      {quotes.loading ? (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">Ponudbe se nalagajo …</CardContent></Card>
      ) : quotes.error ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-2 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
              <HelpCircle className="size-4" aria-hidden /> Ponudbe trenutno niso na voljo
            </div>
            <p className="text-muted-foreground">
              {quotes.error?.message} — vnesite pozicije kosovnice ročno spodaj; ko bo modul ponudb na voljo, se bodo pozicije naložile samodejno.
            </p>
          </CardContent>
        </Card>
      ) : quoteDetail.error ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-2 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
              <HelpCircle className="size-4" aria-hidden /> Pozicije ponudbe ni mogoče naložiti
            </div>
            <p className="text-muted-foreground">
              {quoteDetail.error?.message} — vnesite pozicije kosovnice ročno spodaj ali izberite drugo ponudbo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <Label>Ponudba (vir kosovnice)</Label>
          <Select value={quoteId} onValueChange={(v) => { setQuoteId(v); setChecked(false) }}>
            <SelectTrigger aria-label="Izbira ponudbe"><SelectValue placeholder="Izberite ponudbo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— brez ponudbe (ročni vnos) —</SelectItem>
              {(quotes.data?.data ?? []).map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  {q.code} · {q.customer?.name ?? q.project?.title ?? 'brez stranke'}{q.status ? ` · ${q.status}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedQuote ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <FileText className="size-3.5" aria-hidden />
              {selectedQuote.project ? `${selectedQuote.project.code} — ${selectedQuote.project.title}` : 'Brez projekta'}
              {typeof selectedQuote.total === 'number' ? <span>· skupaj {fmtEUR(selectedQuote.total)}</span> : null}
            </p>
          ) : null}
        </div>
      )}

      {/* BOM */}
      {quoteDetail.loading ? <LoadingRows rows={2} /> : bomLines.length === 0 ? (
        <EmptyState
          title="Kosovnica je prazna"
          desc={manualMode
            ? 'Dodajte materiale ročno ali izberite ponudbo zgoraj.'
            : 'Izbrana ponudba nima pozicij — dodajte ročno.'}
          icon={ClipboardList}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Pozicija (material)</TableHead>
                    <TableHead className="text-right">Količina</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Cena/en.</TableHead>
                    <TableHead className="pr-4">Zaloga</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bomLines.map((l) => {
                    const cov = checked ? coverage.get(l.key) : undefined
                    return (
                      <TableRow key={l.key}>
                        <TableCell className="max-w-56 pl-4">
                          {l.description ? (
                            <span className="font-medium">{l.description}</span>
                          ) : (
                            <Input
                              value={l.description} onChange={(e) => updateManualLine(l.key, { description: e.target.value })}
                              placeholder="npr. Alu L-profil 80×80" aria-label="Opis pozicije"
                            />
                          )}
                          {cov && cov.matched.length > 0 ? (
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {cov.matched.map((m) => `${m.sku} (${m.qty} ${m.unit})`).join(' + ')}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          {l.unitPrice !== undefined ? (
                            <span className="font-bold">{l.qty}</span>
                          ) : (
                            <Input
                              type="number" min="0" step="any" className="ml-auto w-20 text-right"
                              value={l.qty} onChange={(e) => updateManualLine(l.key, { qty: Number(e.target.value) })}
                              aria-label="Količina"
                            />
                          )}
                        </TableCell>
                        <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                          {typeof l.unitPrice === 'number' ? fmtEUR(l.unitPrice) : '—'}
                        </TableCell>
                        <TableCell className="pr-4">
                          {!checked || inventory.loading ? (
                            <span className="text-xs text-muted-foreground">{inventory.loading ? 'preverjam …' : '—'}</span>
                          ) : cov?.status === 'pokrito' ? (
                            <Badge variant="secondary" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              <CheckCircle2 className="mr-1 size-3" aria-hidden /> pokrito
                            </Badge>
                          ) : cov?.status === 'manjka' ? (
                            <Badge variant="secondary" className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                              manjka {cov.missing}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">
                              ni zadetka
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {checked && !inventory.loading && !inventory.error ? (
              <div className={cn(
                'flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs',
                missingCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'
              )}>
                <span>{bomLines.length} pozicij</span>
                <span>{bomLines.length - missingCount - unknownCount} pokritih</span>
                <span>{missingCount} manjka</span>
                <span>{unknownCount} brez zadetka</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ročni vnos pozicij (nadomestek za ponudbe) */}
      {manualMode ? (
        <Button variant="outline" size="sm" onClick={addManualLine}>
          <Plus className="size-4" aria-hidden /> Dodaj pozicijo
        </Button>
      ) : null}

      {manual.length > 0 && manualMode ? (
        <div className="flex justify-end">
          <Button
            variant="ghost" size="sm" className="text-red-600 dark:text-red-400"
            onClick={() => { setManual([]); setChecked(false) }}
          >
            <Trash2 className="size-4" aria-hidden /> Počisti ročne pozicije
          </Button>
        </div>
      ) : null}

      <ErrorBox error={checked ? inventory.error : null} />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Truck className="size-3.5" aria-hidden />
        Naročila dobaviteljem sledijo — trenutna različica prikazuje samo pokritost zaloge.
      </p>
    </div>
  )
}

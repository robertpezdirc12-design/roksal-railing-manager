'use client'

// PONUDBE — seznam s statusi/zneski, podrobnost s pozicijami, sprejem (quotes.approve)
// ZAKLENJEN dosegljiv samo prek podpisa (modul Signatura — deal.lock).
// R476 (issue #9 §5): POPUST na celotno ponudbo — prikaz v zneskih + urejanje
// na osnutku (PATCH discountPct); DDV je že izračunan iz osnove PO popustu.

import { useMemo, useRef, useState } from 'react'
import { BadgeCheck, FileDown, FileText, Loader2, Lock, Percent, Search, Send, TriangleAlert, Upload, User } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, fmtDate, fmtDateTime, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface QuoteRow {
  id: string
  code: string
  status: string
  /** R564 (issue #24): vir cen — APPROVED | DEMO | NEPREVERJENO. */
  priceCheck?: string | null
  subtotal: number
  discountPct: number | null // R476: popust (%) — null = brez
  discount: number // R476: znesek popusta
  vat: number
  total: number
  note: string | null
  createdAt: string
  signedBy: string | null
  staleAt: string | null // R474: zastarela (spremenjen obseg paketa/kosovnice)
  staleReason: string | null
  customer: { name: string; city: string | null } | null
  project: { code: string; title: string } | null
  _count: { lines: number }
}

interface QuoteLine { id: string; description: string; qty: number; unitPrice: number; total: number }

interface QuoteDetail extends Omit<QuoteRow, '_count'> {
  signature: string | null
  signedAt: string | null
  lines: QuoteLine[]
  invoices: { id: string; code: string; status: string; total: number }[]
}

const STATUSES = [
  { value: 'OSNUTEK', label: 'Osnutek' },
  { value: 'POSLAN', label: 'Poslan' },
  { value: 'SPREJET', label: 'Sprejet' },
  { value: 'ZAVRNJEN', label: 'Zavrnjen' },
  { value: 'ZAKLENJEN', label: 'Zaklenjen' },
]

export default function PonudbeModule () {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const list = useApi<{ data: QuoteRow[] }>(
    `/api/quotes?q=${encodeURIComponent(q)}${status !== 'all' ? `&status=${status}` : ''}`,
    [q, status]
  )
  const detail = useApi<{ data: QuoteDetail }>(selected ? `/api/quotes/${selected}` : null, [selected])

  const canCreate = hasPerm(user?.perms, 'quotes.create')
  const canApprove = hasPerm(user?.perms, 'quotes.approve')
  const rows = useMemo(() => list.data?.data ?? [], [list.data])

  async function setStatusFor (id: string, newStatus: string) {
    setBusy(true)
    try {
      await apiPatch(`/api/quotes/${id}`, { status: newStatus })
      toast({ title: 'Status ponudbe posodobljen.' })
      await Promise.all([list.reload(), detail.reload()])
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  /** R476: sprememba popusta (samo osnutek — strežnik vrata strogo nadzira). */
  async function setDiscountFor (id: string, pct: number) {
    setBusy(true)
    try {
      await apiPatch(`/api/quotes/${id}`, { discountPct: pct })
      toast({ title: pct > 0 ? `Popust ${pct} % uporabljen.` : 'Popust odstranjen.' })
      await Promise.all([list.reload(), detail.reload()])
    } catch (e) {
      toast({ title: 'Popust ni bil uporabljen', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Ponudbe" desc="Ponudbe s pozicijami in podpisi" />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči po kodi, stranki, projektu …" className="pl-8" aria-label="Iskanje ponudb" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36" aria-label="Filter statusa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {canCreate ? (
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" aria-hidden />
            Uvozi ponudbo
          </Button>
        ) : null}
      </div>

      {/* R478: uvoz ponudbe iz JSON izvoza (round-trip) */}
      <ImportQuoteDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => { void list.reload() }}
      />

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni ponudb" desc="Poskusite spremeniti filter ali ustvarite osnutek v modulu Konfigurator." icon={FileText} />
      ) : (
        <AnimatedList className="grid gap-3 md:grid-cols-2">
          {rows.map((qq) => (
            <AnimatedListItem key={qq.id}>
              <button type="button" className="w-full text-left" onClick={() => setSelected(qq.id)} aria-label={`Odpri ponudbo ${qq.code}`}>
                <Card className="transition hover:border-roksal-amber/60 hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-roksal-amber-text">{qq.code}</span>
                      <div className="flex items-center gap-1.5">
                        {qq.staleAt ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-800 dark:bg-red-950 dark:text-red-300"
                            title={qq.staleReason ?? 'Obseg paketa/kosovnice se je spremenil.'}
                          >
                            <TriangleAlert className="size-3" aria-hidden /> Zastarelo
                          </span>
                        ) : null}
                        {qq.status === 'ZAKLENJEN' ? <Lock className="size-3.5 text-amber-600 dark:text-amber-400" aria-label="Zaklenjeno" /> : null}
                        {qq.priceCheck && qq.priceCheck !== 'APPROVED' ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                            title={qq.priceCheck === 'DEMO' ? 'Cene izhajajo iz demo/neodobrenega cenika — zavezujoča ponudba zahteva odobritev cenika ali izrecno potrditev odgovorne osebe.' : 'Vir cen vrstic ni preverjen (ni razpoznavnega pravila cenika) — okvirna ponudba.'}
                          >
                            <TriangleAlert className="size-3" aria-hidden /> {qq.priceCheck === 'DEMO' ? 'Okvirna · demo cene' : 'Okvirna · vir ni preverjen'}
                          </span>
                        ) : null}
                        <StatusBadge status={qq.status} />
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">{qq.customer?.name ?? 'Brez stranke'}</span>
                      <span className="flex shrink-0 items-baseline gap-1.5">
                        {qq.discountPct != null && qq.discountPct > 0 ? (
                          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" title={`Popust ${qq.discountPct} % (−${fmtEUR(qq.discount)})`}>
                            −{qq.discountPct} %
                          </span>
                        ) : null}
                        <span className="text-base font-bold">{fmtEUR(qq.total)}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {qq.project ? <span className="truncate">{qq.project.title}</span> : null}
                      <span>{qq._count.lines} pozicij</span>
                      <span className="ml-auto">{fmtDate(qq.createdAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}

      {/* podrobnost */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {/* dostopnost: opis vsebuje vsa stanja (nalaganje/podatki/napaka) — Radix
              opozori, če DialogContent nima DialogDescription (videno v sprehodu R554) */}
          <DialogDescription className="sr-only">Podrobnosti ponudbe s pozicijami.</DialogDescription>
          {detail.loading ? (
            <>
              <DialogHeader><DialogTitle className="sr-only">Nalaganje podrobnosti ponudbe</DialogTitle></DialogHeader>
              <LoadingRows rows={3} />
            </>
          ) : detail.data ? (
            <QuoteDetailDialog
              detail={detail.data.data}
              canCreate={canCreate}
              canApprove={canApprove}
              busy={busy}
              onStatus={(s) => void setStatusFor(detail.data!.data.id, s)}
              onDiscount={(pct) => setDiscountFor(detail.data!.data.id, pct)}
            />
          ) : (
            <>
              <DialogHeader><DialogTitle>Napaka</DialogTitle></DialogHeader>
              <ErrorBox error={detail.error} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** R476: urejevalnik popusta na osnutku — % + predogled zneska. */
function DiscountEditor ({ initialPct, busy, onApply }: {
  initialPct: number
  busy: boolean
  onApply: (pct: number) => Promise<void>
}) {
  const [val, setVal] = useState(String(initialPct > 0 ? initialPct : ''))
  const parsed = Number(val.replace(',', '.'))
  const valid = val.trim() === '' || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100)

  async function apply () {
    if (!valid) return
    await onApply(val.trim() === '' ? 0 : Math.round(parsed * 100) / 100)
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor="pon-popust" className="text-xs font-medium text-muted-foreground">Popust na ponudbo (%)</label>
        <Input
          id="pon-popust"
          inputMode="decimal"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="npr. 5 ali 7,5"
          aria-invalid={!valid}
          aria-describedby="pon-popust-hint"
          className="h-9 max-w-32"
        />
      </div>
      <Button variant="outline" className="h-9" onClick={() => void apply()} disabled={busy || !valid}>
        <Percent className="size-4" aria-hidden /> Uporabi popust
      </Button>
      <p id="pon-popust-hint" className="w-full text-xs text-muted-foreground">
        {valid
          ? 'DDV 22 % se preračuna iz osnove po popustu. Popust je mogoče spreminjati samo na osnutku.'
          : 'Vnesite odstotek med 0 in 100.'}
      </p>
    </div>
  )
}

function QuoteDetailDialog ({ detail, canCreate, canApprove, busy, onStatus, onDiscount }: {
  detail: QuoteDetail
  canCreate: boolean
  canApprove: boolean
  busy: boolean
  onStatus: (status: string) => void
  onDiscount: (pct: number) => Promise<void>
}) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const [expBusy, setExpBusy] = useState<string | null>(null)

  // R477 (issue #9 §6): izvoz ponudbe — CSV/XLSX (pravila in zastarelost
  // vidno zapisani v izvozu) + JSON (strukturirano, za integracije)
  async function exportQuote (format: 'csv' | 'xlsx' | 'json'): Promise<void> {
    if (!token) return
    setExpBusy(format)
    try {
      const res = await fetch(`/api/export/quote/${detail.id}?format=${format}`, {
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
      a.download = `ponudba-${detail.code}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      toast({ title: `Ponudba izvožena (${format.toUpperCase()}).`, description: format === 'csv' ? 'CSV: podpično, decimalna vejica (SI). Opozorila so v komentarjih.' : 'Datoteka je prenesena.' })
    } catch (e) {
      toast({
        title: 'Izvoz ponudbe ni uspel.',
        description: e instanceof Error ? e.message : 'Neznana napaka.',
        variant: 'destructive',
      })
    } finally {
      setExpBusy(null)
    }
  }

  const canSend = canCreate && detail.status === 'OSNUTEK'
  const canAccept = canApprove && ['OSNUTEK', 'POSLAN'].includes(detail.status)
  const pct = detail.discountPct ?? 0

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-roksal-amber-text">{detail.code}</span>
          <StatusBadge status={detail.status} />
          {detail.priceCheck && detail.priceCheck !== 'APPROVED' ? (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:bg-amber-950 dark:text-amber-300"
              title={detail.priceCheck === 'DEMO' ? 'Cene iz demo/neodobrenega cenika — za zavezujočo ponudbo odobrite cenik ali podajte izrecno potrditev (razlog).' : 'Vir cen ni preverjen — okvirna ponudba.'}
            >
              <TriangleAlert className="size-3" aria-hidden /> {detail.priceCheck === 'DEMO' ? 'Okvirna · demo cene' : 'Okvirna · vir ni preverjen'}
            </span>
          ) : null}
        </div>
        <DialogTitle>Ponudba {detail.code}</DialogTitle>
        {detail.staleAt ? (
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-left text-xs text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <div className="font-bold uppercase tracking-wider">Ponudba je zastarela</div>
              <div className="mt-0.5">{detail.staleReason ?? 'Obseg paketa/kosovnice se je spremenil po izdelavi ponudbe.'}</div>
              <div className="mt-0.5 text-red-700/80 dark:text-red-300/80">
                {['OSNUTEK', 'POSLAN'].includes(detail.status)
                  ? 'Status je bil povrnjen na Osnutek — ponudbo preverite in znova potrdite ali pošljite.'
                  : 'Ponudba je bila sprejeta/zaklenjena pred spremembo — sprememba ne sme iti tiho mimo pisarne.'}
              </div>
            </div>
          </div>
        ) : null}
        <DialogDescription>
          {detail.customer?.name ?? 'Brez stranke'}
          {detail.project ? ` · ${detail.project.title}` : ''} · {fmtDate(detail.createdAt)}
        </DialogDescription>
      </DialogHeader>

      {/* pozicije */}
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-3">Pozicija</TableHead>
              <TableHead className="text-right">Količina</TableHead>
              <TableHead className="text-right">€/enota</TableHead>
              <TableHead className="pr-3 text-right">Znesek</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="max-w-56 truncate pl-3" title={l.description}>{l.description}</TableCell>
                <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtEUR(l.unitPrice)}</TableCell>
                <TableCell className="pr-3 text-right font-medium tabular-nums">{fmtEUR(l.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* zneski */}
      <div className="ml-auto w-full max-w-xs space-y-1 rounded-xl bg-secondary/60 p-3 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Osnova</span><span className="tabular-nums">{fmtEUR(detail.subtotal)}</span></div>
        {pct > 0 ? (
          <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
            <span className="inline-flex items-center gap-1"><Percent className="size-3" aria-hidden /> Popust {pct} %</span>
            <span className="tabular-nums">− {fmtEUR(detail.discount)}</span>
          </div>
        ) : null}
        <div className="flex justify-between"><span className="text-muted-foreground">DDV 22 %</span><span className="tabular-nums">{fmtEUR(detail.vat)}</span></div>
        <div className="flex justify-between border-t pt-1 font-bold"><span>Skupaj</span><span className="tabular-nums">{fmtEUR(detail.total)}</span></div>
      </div>

      {/* R476: urejanje popusta — samo osnutek (poslane/sprejete se ne spreminjajo) */}
      {canCreate && detail.status === 'OSNUTEK' ? (
        <DiscountEditor initialPct={pct} busy={busy} onApply={onDiscount} />
      ) : null}

      {detail.note ? <p className="rounded-lg border p-3 text-sm">{detail.note}</p> : null}

      {/* R477: izvozi ponudbe (CSV/XLSX/JSON) */}
      <div className="flex flex-wrap items-center gap-2">
        {(['csv', 'xlsx', 'json'] as const).map((fmt) => (
          <Button key={fmt} size="sm" variant="outline" onClick={() => { void exportQuote(fmt) }} disabled={expBusy != null}>
            {expBusy === fmt ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
            Izvozi {fmt.toUpperCase()}
          </Button>
        ))}
        {detail.staleAt ? (
          <span className="text-[11px] font-medium text-red-700 dark:text-red-400">Zastarelost bo zapisana v izvozu (opozorilo pred pošiljanjem stranki).</span>
        ) : null}
      </div>

      {/* podpis */}
      {detail.signature ? (
        <section aria-label="Podpis stranke" className="rounded-xl border border-amber-300/60 bg-amber-50/50 p-3 dark:border-amber-800/50 dark:bg-amber-950/30">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
            <Lock className="size-3.5" aria-hidden /> Podpis stranke — posel zaklenjen
          </div>
          <img src={detail.signature} alt={`Podpis podpisnika ${detail.signedBy ?? ''}`} className="h-20 rounded-lg border bg-white" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><User className="size-3" aria-hidden />{detail.signedBy ?? '—'}</span>
            <span>{fmtDateTime(detail.signedAt)}</span>
          </div>
        </section>
      ) : null}

      {/* računi iz te ponudbe */}
      {detail.invoices.length > 0 ? (
        <section aria-label="Izdani računi">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Izdani računi</h3>
          <AnimatedList className="space-y-1">
            {detail.invoices.map((iv) => (
              <AnimatedListItem key={iv.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                <span className="font-mono text-xs">{iv.code}</span>
                <StatusBadge status={iv.status} />
                <span className="font-semibold">{fmtEUR(iv.total)}</span>
              </AnimatedListItem>
            ))}
          </AnimatedList>
        </section>
      ) : null}

      {(canSend || canAccept) ? (
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          {canSend ? (
            <Button variant="outline" disabled={busy} onClick={() => onStatus('POSLAN')}>
              <Send className="size-4" aria-hidden /> Označi kot poslan
            </Button>
          ) : null}
          {canAccept ? (
            <Button disabled={busy} onClick={() => onStatus('SPREJET')}>
              <BadgeCheck className="size-4" aria-hidden /> Označi kot sprejeto
            </Button>
          ) : null}
        </DialogFooter>
      ) : null}
    </>
  )
}

// ── R478: UVOZ PONUDBE (JSON izvoz → nova ponudba OSNUTEK) ──────────────────

interface QuoteImportResult {
  mode: 'preveri' | 'uvozi'
  original?: { code: string | null; status: string | null }
  lines: number
  totals: { subtotal: number; discount: number; vat: number; total: number; discountPct: number | null }
  resolution?: { projectId: string | null; customerId: string | null; packageId: string | null }
  warnings?: string[]
  quote?: { id: string; code: string; status: string; lines: number }
}

function ImportQuoteDialog ({ open, onOpenChange, onImported }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onImported: () => void
}) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<QuoteImportResult | null>(null)
  const [busy, setBusy] = useState(false)

  function reset (): void {
    setFile(null); setResult(null)
    if (inputRef.current != null) inputRef.current.value = ''
  }

  async function run (mode: 'preveri' | 'uvozi'): Promise<void> {
    if (!file || !token) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', mode)
      const res = await fetch('/api/import/quote', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const raw = await res.json().catch(() => ({})) as { data?: QuoteImportResult; error?: string; detail?: string }
      const data = raw.data ?? (raw as unknown as QuoteImportResult) // API ovijalnik { data } ali golo
      if (!res.ok) throw new Error(raw.detail ?? raw.error ?? `Napaka strežnika (${res.status}).`)
      if (mode === 'preveri') {
        setResult(data)
      } else {
        toast({
          title: `Ponudba ${data.quote?.code ?? ''} uvožena (${data.quote?.lines ?? data.lines} pozicij).`,
          description: `SKUPAJ ${fmtEUR(data.totals.total)} · status OSNUTEK — izvirnik${result?.original?.code != null ? ` ${result.original.code}` : ''} ostaja nedotaknjen.`,
        })
        reset()
        onOpenChange(false)
        onImported()
      }
    } catch (e) {
      toast({ title: 'Uvoz ponudbe ni uspel.', description: e instanceof Error ? e.message : 'Neznana napaka.', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onOpenChange(false) } else { onOpenChange(true) } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="min-w-0">
          <DialogTitle>Uvoz ponudbe (JSON)</DialogTitle>
          <DialogDescription>
            Iz JSON izvoza (Ponudbe → Izvozi JSON). Ustvari NOVO ponudbo kot osnutek — obstoječa se nikoli ne prepiše. Zneski se preračunajo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-secondary/80"
            aria-label="Datoteka ponudbe (JSON)"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null) }}
          />
          {result != null ? (
            <div className="space-y-2 rounded-lg border bg-secondary/30 p-3 text-xs">
              <p className="font-bold">
                Preverjanje: {result.lines} pozicij{result.original?.code != null ? ` · izvirnik ${result.original.code}` : ''}
              </p>
              <p>
                Osnova {fmtEUR(result.totals.subtotal)}
                {result.totals.discountPct != null && result.totals.discountPct > 0 ? ` · popust ${result.totals.discountPct} % (−${fmtEUR(result.totals.discount)})` : ''}
                {' '}· DDV {fmtEUR(result.totals.vat)} · <span className="font-bold">SKUPAJ {fmtEUR(result.totals.total)}</span>
              </p>
              {(result.warnings ?? []).length > 0 ? (
                <AnimatedList className="space-y-0.5 text-amber-700 dark:text-amber-400">
                  {(result.warnings ?? []).map((w, i) => <AnimatedListItem key={i}>⚠ {w}</AnimatedListItem>)}
                </AnimatedList>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Stranka se veže po imenu iz datoteke (ali eksplicitno po ID); projekt po kodi — odstopanja so vidna v opozorilih.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { void run('preveri') }} disabled={busy || file == null}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Search className="size-3.5" aria-hidden />}
            Preveri
          </Button>
          <Button onClick={() => { void run('uvozi') }} disabled={busy || file == null}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
            Uvozi (nova ponudba)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

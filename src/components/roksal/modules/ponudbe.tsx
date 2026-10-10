'use client'

// PONUDBE — seznam s statusi/zneski, podrobnost s pozicijami, sprejem (quotes.approve)
// ZAKLENJEN dosegljiv samo prek podpisa (modul Signatura — deal.lock).

import { useMemo, useState } from 'react'
import { BadgeCheck, FileText, Lock, Search, Send, TriangleAlert, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  subtotal: number
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
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni ponudb" desc="Poskusite spremeniti filter ali ustvarite osnutek v modulu Konfigurator." icon={FileText} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((qq) => (
            <li key={qq.id}>
              <button type="button" className="w-full text-left" onClick={() => setSelected(qq.id)} aria-label={`Odpri ponudbo ${qq.code}`}>
                <Card className="transition hover:border-roksal-amber/60 hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-roksal-amber">{qq.code}</span>
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
                        <StatusBadge status={qq.status} />
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">{qq.customer?.name ?? 'Brez stranke'}</span>
                      <span className="shrink-0 text-base font-bold">{fmtEUR(qq.total)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {qq.project ? <span className="truncate">{qq.project.title}</span> : null}
                      <span>{qq._count.lines} pozicij</span>
                      <span className="ml-auto">{fmtDate(qq.createdAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* podrobnost */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
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

function QuoteDetailDialog ({ detail, canCreate, canApprove, busy, onStatus }: {
  detail: QuoteDetail
  canCreate: boolean
  canApprove: boolean
  busy: boolean
  onStatus: (status: string) => void
}) {
  const canSend = canCreate && detail.status === 'OSNUTEK'
  const canAccept = canApprove && ['OSNUTEK', 'POSLAN'].includes(detail.status)

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-roksal-amber">{detail.code}</span>
          <StatusBadge status={detail.status} />
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
        <div className="flex justify-between"><span className="text-muted-foreground">DDV 22 %</span><span className="tabular-nums">{fmtEUR(detail.vat)}</span></div>
        <div className="flex justify-between border-t pt-1 font-bold"><span>Skupaj</span><span className="tabular-nums">{fmtEUR(detail.total)}</span></div>
      </div>

      {detail.note ? <p className="rounded-lg border p-3 text-sm">{detail.note}</p> : null}

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
          <ul className="space-y-1">
            {detail.invoices.map((iv) => (
              <li key={iv.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                <span className="font-mono text-xs">{iv.code}</span>
                <StatusBadge status={iv.status} />
                <span className="font-semibold">{fmtEUR(iv.total)}</span>
              </li>
            ))}
          </ul>
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

'use client'

// DOKUMENTI — poenoten arhiv ponudb in računov (documents.read)
// Podrobnosti nalaga iz obstoječih poti /api/quotes/[id] in /api/invoices/[id]
// (potrebujejo quotes.read / invoices.read — sicer fail-closed z jasno napako).
// PDF izvoz je ločen modul (documents.generate).

import { useMemo, useState } from 'react'
import { Banknote, FileSignature, FileText, Receipt, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtDate, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'

interface DocRow {
  id: string
  kind: 'PONUDBA' | 'RACUN'
  code: string
  status: string
  total: number
  paid: number | null
  customerName: string | null
  projectCode: string | null
  projectTitle: string | null
  dueDate: string | null
  createdAt: string
  signed: boolean
  signedBy: string | null
  signedAt: string | null
}

interface QuoteDetail {
  id: string; code: string; status: string; subtotal: number; vat: number; total: number; note: string | null
  signature: string | null; signedAt: string | null; signedBy: string | null; createdAt: string
  customer: { id: string; name: string; city: string; email: string } | null
  project: { id: string; code: string; title: string } | null
  lines: { id: string; description: string; qty: number; unitPrice: number; total: number }[]
  invoices: { id: string; code: string; status: string; total: number }[]
}

interface InvoiceDetail {
  id: string; code: string; status: string; subtotal: number; vat: number; total: number; paid: number
  dueDate: string | null; note: string | null; createdAt: string
  project: { id: string; code: string; title: string; customer: { name: string } | null } | null
  quote: { id: string; code: string; status: string } | null
  payments: { id: string; amount: number; method: string; reference: string | null; createdAt: string }[]
}

const METHODS: Record<string, string> = { NAKAZNICA: 'Nakaznica', GOTOVINA: 'Gotovina', KARTICA: 'Kartica' }

const STATUS_OPTIONS = [
  { value: 'OSNUTEK', label: 'Osnutek' },
  { value: 'POSLAN', label: 'Poslan' },
  { value: 'SPREJET', label: 'Sprejet' },
  { value: 'ZAVRNJEN', label: 'Zavrnjen' },
  { value: 'ZAKLENJEN', label: 'Zaklenjen' },
  { value: 'IZDAN', label: 'Izdan' },
  { value: 'DELNO_PLACAN', label: 'Delno plačan' },
  { value: 'PLACAN', label: 'Plačan' },
  { value: 'ZAPRT', label: 'Zaprt' },
]

function KindBadge ({ kind }: { kind: 'PONUDBA' | 'RACUN' }) {
  if (kind === 'PONUDBA') {
    return <Badge variant="secondary" className="border-transparent bg-amber-100 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Ponudba</Badge>
  }
  return <Badge variant="secondary" className="border-transparent bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Račun</Badge>
}

export default function DokumentiModule () {
  const [q, setQ] = useState('')
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<DocRow | null>(null)

  const list = useApi<{ data: { documents: DocRow[] } }>(
    `/api/documents?q=${encodeURIComponent(q)}${type !== 'all' ? `&type=${type}` : ''}${status !== 'all' ? `&status=${status}` : ''}`,
    [q, type, status]
  )
  const rows = useMemo(() => list.data?.data.documents ?? [], [list.data])

  // podrobnost — odvisno od vrste dokumenta (obstoječi API-ji)
  const quoteDetail = useApi<{ data: QuoteDetail }>(
    selected?.kind === 'PONUDBA' && selected ? `/api/quotes/${selected.id}` : null,
    [selected?.id, selected?.kind]
  )
  const invoiceDetail = useApi<{ data: InvoiceDetail }>(
    selected?.kind === 'RACUN' && selected ? `/api/invoices/${selected.id}` : null,
    [selected?.id, selected?.kind]
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dokumenti"
        desc="Poenoten arhiv ponudb in računov — kronološko, s podpisi in plačili"
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči po kodi dokumenta, stranki …" className="pl-8" aria-label="Iskanje dokumentov" />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-36" aria-label="Filter vrste"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vse vrste</SelectItem>
            <SelectItem value="ponudba">Ponudbe</SelectItem>
            <SelectItem value="racun">Računi</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Filter statusa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState
          title="Ni dokumentov"
          desc={type === 'ponudba' ? 'Nobena ponudba ne ustreza filtru.' : type === 'racun' ? 'Noben račun ne ustreza filtru.' : 'Spremenite filter ali ustvarite prvi dokument.'}
          icon={FileText}
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Vrsta</TableHead>
                <TableHead>Koda</TableHead>
                <TableHead>Stranka</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Znesek</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead className="pr-3">Podpis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={`${d.kind}-${d.id}`} className="cursor-pointer" onClick={() => setSelected(d)}>
                  <TableCell className="pl-3"><KindBadge kind={d.kind} /></TableCell>
                  <TableCell className="font-mono text-xs font-semibold text-roksal-amber">{d.code}</TableCell>
                  <TableCell className="max-w-40 truncate">{d.customerName ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEUR(d.total)}
                    {d.kind === 'RACUN' && d.paid !== null && d.paid > 0 ? (
                      <span className="block text-xs text-muted-foreground">plačano {fmtEUR(d.paid)}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(d.createdAt)}</TableCell>
                  <TableCell className="pr-3">
                    {d.signed && d.signedAt ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300" title={`Podpisnik: ${d.signedBy ?? '—'}`}>
                        <FileSignature className="size-4 shrink-0" aria-hidden />Podpisano {fmtDate(d.signedAt)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* podrobnost dokumenta */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {selected?.kind === 'PONUDBA' ? (
            quoteDetail.loading ? (
              <>
                <DialogHeader><DialogTitle className="sr-only">Nalaganje podrobnosti ponudbe</DialogTitle></DialogHeader>
                <LoadingRows rows={3} />
              </>
            ) : quoteDetail.data ? (
              <QuoteDetailCard detail={quoteDetail.data.data} />
            ) : (
              <>
                <DialogHeader><DialogTitle>Napaka</DialogTitle></DialogHeader>
                <ErrorBox error={quoteDetail.error} />
              </>
            )
          ) : selected?.kind === 'RACUN' ? (
            invoiceDetail.loading ? (
              <>
                <DialogHeader><DialogTitle className="sr-only">Nalaganje podrobnosti računa</DialogTitle></DialogHeader>
                <LoadingRows rows={3} />
              </>
            ) : invoiceDetail.data ? (
              <InvoiceDetailCard detail={invoiceDetail.data.data} />
            ) : (
              <>
                <DialogHeader><DialogTitle>Napaka</DialogTitle></DialogHeader>
                <ErrorBox error={invoiceDetail.error} />
              </>
            )
          ) : (
            <DialogHeader><DialogTitle className="sr-only">Nalaganje dokumenta</DialogTitle></DialogHeader>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function QuoteDetailCard ({ detail }: { detail: QuoteDetail }) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <KindBadge kind="PONUDBA" />
          <span className="font-mono text-xs font-semibold text-roksal-amber">{detail.code}</span>
          <StatusBadge status={detail.status} />
        </div>
        <DialogTitle>Ponudba {detail.code}</DialogTitle>
        <DialogDescription>
          {detail.customer?.name ?? 'Brez stranke'}
          {detail.project ? ` · ${detail.project.code} ${detail.project.title}` : ''}
        </DialogDescription>
      </DialogHeader>

      {/* pozicije */}
      <section aria-label="Pozicije ponudbe">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Pozicije ({detail.lines.length})</h3>
        <div className="max-h-72 overflow-y-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Opis</TableHead>
                <TableHead className="text-right">Kol.</TableHead>
                <TableHead className="text-right">Cena/en.</TableHead>
                <TableHead className="pr-3 text-right">Skupaj</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="max-w-56 pl-3 text-sm"><span className="line-clamp-2">{l.description}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtEUR(l.unitPrice)}</TableCell>
                  <TableCell className="pr-3 text-right font-medium tabular-nums">{fmtEUR(l.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="ml-auto w-full max-w-xs space-y-1 rounded-xl bg-secondary/60 p-3 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Osnova</span><span className="tabular-nums">{fmtEUR(detail.subtotal)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">DDV 22 %</span><span className="tabular-nums">{fmtEUR(detail.vat)}</span></div>
        <div className="flex justify-between border-t pt-1 font-bold"><span>Skupaj</span><span className="tabular-nums">{fmtEUR(detail.total)}</span></div>
      </div>

      {/* podpis stranke */}
      {detail.signature ? (
        <section aria-label="Podpis stranke" className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <FileSignature className="size-4" aria-hidden />
            Podpisano: {detail.signedBy ?? 'neznan podpisnik'} · {fmtDate(detail.signedAt)}
          </div>
          <img
            src={detail.signature}
            alt={`Podpis stranke — ${detail.signedBy ?? detail.customer?.name ?? 'podpisnik'}`}
            className="mx-auto h-20 rounded-lg border bg-white object-contain p-1 dark:bg-white"
          />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Ponudba še ni podpisana.</p>
      )}

      {detail.invoices.length > 0 ? (
        <section aria-label="Izdani računi" className="space-y-1.5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Izdani računi</h3>
          {detail.invoices.map((iv) => (
            <div key={iv.id} className="flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2 text-sm">
              <span className="font-mono text-xs font-semibold text-roksal-amber">{iv.code}</span>
              <StatusBadge status={iv.status} />
              <span className="tabular-nums">{fmtEUR(iv.total)}</span>
            </div>
          ))}
        </section>
      ) : null}
    </>
  )
}

function InvoiceDetailCard ({ detail }: { detail: InvoiceDetail }) {
  const open = Math.round((detail.total - detail.paid) * 100) / 100
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <KindBadge kind="RACUN" />
          <span className="font-mono text-xs font-semibold text-roksal-amber">{detail.code}</span>
          <StatusBadge status={detail.status} />
        </div>
        <DialogTitle>Račun {detail.code}</DialogTitle>
        <DialogDescription>
          {detail.project?.customer?.name ?? 'Brez stranke'}
          {detail.project ? ` · ${detail.project.code} ${detail.project.title}` : ''}
          {detail.quote ? ` · iz ponudbe ${detail.quote.code}` : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2 rounded-lg bg-secondary/60 p-3 text-sm sm:grid-cols-2">
        <span className="inline-flex items-center gap-2"><Receipt className="size-4 shrink-0 text-muted-foreground" aria-hidden />Rok plačila: {fmtDate(detail.dueDate)}</span>
        <span className="inline-flex items-center gap-2"><Banknote className="size-4 shrink-0 text-muted-foreground" aria-hidden />Št. plačil: {detail.payments.length}</span>
      </div>

      <div className="ml-auto w-full max-w-xs space-y-1 rounded-xl bg-secondary/60 p-3 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Osnova</span><span className="tabular-nums">{fmtEUR(detail.subtotal)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">DDV 22 %</span><span className="tabular-nums">{fmtEUR(detail.vat)}</span></div>
        <div className="flex justify-between border-t pt-1 font-bold"><span>Skupaj</span><span className="tabular-nums">{fmtEUR(detail.total)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Plačano</span><span className="tabular-nums">{fmtEUR(detail.paid)}</span></div>
        <div className={`flex justify-between font-bold ${open > 0.005 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          <span>Odprto</span><span className="tabular-nums">{fmtEUR(open)}</span>
        </div>
      </div>

      <section aria-label="Plačila računa">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Plačila</h3>
        {detail.payments.length === 0 ? <p className="text-sm text-muted-foreground">Ni zapisanih plačil.</p> : (
          <div className="max-h-64 overflow-y-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3">Datum</TableHead>
                  <TableHead>Način</TableHead>
                  <TableHead>Sklic</TableHead>
                  <TableHead className="pr-3 text-right">Znesek</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-3 text-xs">{fmtDate(p.createdAt)}</TableCell>
                    <TableCell>{METHODS[p.method] ?? p.method}</TableCell>
                    <TableCell className="max-w-32 truncate font-mono text-xs text-muted-foreground">{p.reference ?? '—'}</TableCell>
                    <TableCell className="pr-3 text-right font-medium tabular-nums">{fmtEUR(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  )
}

'use client'

// RAČUNI + PLAČILA — R425 LOČITEV: računi (invoices.read/issue) in plačila (payments.read/manage)
// so ločena sklopa. "Zapiši plačilo" je vidno samo z payments.manage.
// R434: izvoz eSLOG XML (UBL 2.1) — gumb v podrobnosti računa.

import { useMemo, useState } from 'react'
import { Banknote, CalendarClock, FileCode2, FilePlus2, HandCoins, Receipt, Search, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, fmtDate, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface InvoiceRow {
  id: string
  code: string
  status: string
  subtotal: number
  vat: number
  total: number
  paid: number
  dueDate: string | null
  createdAt: string
  project: { code: string; title: string; customer: { name: string } | null } | null
  quote: { code: string } | null
  _count: { payments: number }
}

interface PaymentRow {
  id: string
  amount: number
  method: string
  reference: string | null
  createdAt: string
  invoice: { id: string; code: string; status: string; total: number; paid: number; project: { customer: { name: string } | null } | null }
}

interface PaymentDetail {
  id: string
  amount: number
  method: string
  reference: string | null
  createdAt: string
}

interface InvoiceDetail extends Omit<InvoiceRow, '_count'> {
  note: string | null
  payments: PaymentDetail[]
}

interface IssuableQuote {
  id: string
  code: string
  total: number
  status: string
  customer: { name: string } | null
  project: { title: string } | null
}

const STATUSES = [
  { value: 'OSNUTEK', label: 'Osnutek' },
  { value: 'IZDAN', label: 'Izdan' },
  { value: 'DELNO_PLACAN', label: 'Delno plačan' },
  { value: 'PLACAN', label: 'Plačan' },
  { value: 'ZAPRT', label: 'Zaprt' },
]

const METHODS = [
  { value: 'NAKAZNICA', label: 'Nakaznica' },
  { value: 'GOTOVINA', label: 'Gotovina' },
  { value: 'KARTICA', label: 'Kartica' },
]

export default function RacuniModule () {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<InvoiceDetail | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)

  const list = useApi<{ data: InvoiceRow[] }>(
    `/api/invoices?q=${encodeURIComponent(q)}${status !== 'all' ? `&status=${status}` : ''}`,
    [q, status]
  )
  const detail = useApi<{ data: InvoiceDetail }>(selected ? `/api/invoices/${selected}` : null, [selected])
  const payments = useApi<{ data: PaymentRow[] }>(hasPerm(user?.perms, 'payments.read') ? '/api/payments?limit=50' : null, [])
  const quotesForIssue = useApi<{ data: IssuableQuote[] }>(issueOpen ? '/api/quotes?limit=200' : null, [issueOpen])

  const canIssue = hasPerm(user?.perms, 'invoices.issue')
  const canManagePayments = hasPerm(user?.perms, 'payments.manage')
  const canReadPayments = hasPerm(user?.perms, 'payments.read')
  const rows = useMemo(() => list.data?.data ?? [], [list.data])

  const issuable = useMemo(
    () => (quotesForIssue.data?.data ?? []).filter((qq) => qq.status === 'SPREJET' || qq.status === 'ZAKLENJEN'),
    [quotesForIssue.data]
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Računi"
        desc="Računi in plačila — ločena sklopa (R425)"
        actions={canIssue ? (
          <Button size="sm" onClick={() => setIssueOpen(true)}><FilePlus2 className="size-4" aria-hidden /> Izdaj račun</Button>
        ) : null}
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči po kodi računa, stranki, ponudbi …" className="pl-8" aria-label="Iskanje računov" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" aria-label="Filter statusa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni računov" desc="Izdajte račun iz sprejete ponudbe." icon={Receipt} />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-3">Koda</TableHead>
                <TableHead>Stranka</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Skupaj</TableHead>
                <TableHead className="text-right">Plačano</TableHead>
                <TableHead className="text-right">Odprto</TableHead>
                <TableHead className="pr-3 text-right">Rok</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((iv) => {
                const open = Math.round((iv.total - iv.paid) * 100) / 100
                return (
                  <TableRow key={iv.id} className="cursor-pointer" onClick={() => setSelected(iv.id)}>
                    <TableCell className="pl-3 font-mono text-xs font-semibold text-roksal-amber">{iv.code}</TableCell>
                    <TableCell className="max-w-40 truncate">{iv.project?.customer?.name ?? '—'}</TableCell>
                    <TableCell><StatusBadge status={iv.status} /></TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEUR(iv.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEUR(iv.paid)}</TableCell>
                    <TableCell className={`text-right font-medium tabular-nums ${open > 0.005 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {fmtEUR(open)}
                    </TableCell>
                    <TableCell className="pr-3 text-right text-xs text-muted-foreground">{fmtDate(iv.dueDate)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* plačila — R425 ločen sklop */}
      {canReadPayments ? (
        <section aria-label="Zadnja plačila">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Zadnja plačila</h3>
          <ErrorBox error={payments.error} />
          {payments.loading ? <LoadingRows rows={2} /> : (payments.data?.data ?? []).length === 0 ? (
            <EmptyState title="Ni plačil" desc="Plačila se zapisujejo pri posameznem računu." icon={HandCoins} />
          ) : (
            <Card>
              <CardContent className="max-h-96 overflow-y-auto p-0">
                <ul className="divide-y">
                  {(payments.data?.data ?? []).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.invoice.code} · {p.invoice.project?.customer?.name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(p.createdAt)} · {METHODS.find((m) => m.value === p.method)?.label ?? p.method}
                          {p.reference ? ` · sklic ${p.reference}` : ''}
                        </div>
                      </div>
                      <span className="shrink-0 font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">+{fmtEUR(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </section>
      ) : null}

      {/* podrobnost računa */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {detail.loading ? (
            <>
              <DialogHeader><DialogTitle className="sr-only">Nalaganje podrobnosti računa</DialogTitle></DialogHeader>
              <LoadingRows rows={3} />
            </>
          ) : detail.data ? (
            <InvoiceDetailDialog detail={detail.data.data} canManagePayments={canManagePayments} onPay={() => setPayFor(detail.data!.data)} />
          ) : (
            <>
              <DialogHeader><DialogTitle>Napaka</DialogTitle></DialogHeader>
              <ErrorBox error={detail.error} />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* zapiši plačilo */}
      <Dialog open={!!payFor} onOpenChange={(o) => { if (!o) setPayFor(null) }}>
        {payFor ? (
          <PaymentDialog
            invoice={payFor}
            onClose={() => setPayFor(null)}
            onSaved={async () => {
              setPayFor(null)
              await Promise.all([list.reload(), detail.reload(), payments.reload()])
            }}
          />
        ) : null}
      </Dialog>

      {/* izdaj račun iz ponudbe */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        {issueOpen ? (
          <IssueInvoiceDialog
            quotes={issuable}
            loading={quotesForIssue.loading}
            onClose={() => setIssueOpen(false)}
            onIssued={async (code) => {
              setIssueOpen(false)
              toast({ title: `Račun ${code} izdan.` })
              await list.reload()
            }}
          />
        ) : null}
      </Dialog>
    </div>
  )
}

function InvoiceDetailDialog ({ detail, canManagePayments, onPay }: {
  detail: InvoiceDetail
  canManagePayments: boolean
  onPay: () => void
}) {
  const { toast } = useToast()
  const token = useAppStore((s) => s.token)
  const [eslogBusy, setEslogBusy] = useState(false)
  const open = Math.round((detail.total - detail.paid) * 100) / 100
  const payable = open > 0.005 && detail.status !== 'ZAPRT'

  /** eSLOG XML (R434) — prenos prek blob (žeton v glavi). */
  async function exportEslog (): Promise<void> {
    if (!token) return
    setEslogBusy(true)
    try {
      const res = await fetch(`/api/invoices/eslog?id=${detail.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Napaka strežnika (${res.status}).`)
      }
      const xml = await res.text()
      const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${detail.code}-eslog.xml`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'eSLOG XML izvožen.', description: `${detail.code} — UBL 2.1 e-račun prenešen.` })
    } catch (e) {
      toast({ title: 'Izvoz eSLOG ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setEslogBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-roksal-amber">{detail.code}</span>
          <StatusBadge status={detail.status} />
        </div>
        <DialogTitle>Račun {detail.code}</DialogTitle>
        <DialogDescription>
          {detail.project?.customer?.name ?? 'Brez stranke'}
          {detail.project ? ` · ${detail.project.title}` : ''}
          {detail.quote ? ` · iz ponudbe ${detail.quote.code}` : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2 rounded-lg bg-secondary/60 p-3 text-sm sm:grid-cols-2">
        <span className="inline-flex items-center gap-2"><CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />Rok plačila: {fmtDate(detail.dueDate)}</span>
        <span className="inline-flex items-center gap-2"><Banknote className="size-4 shrink-0 text-muted-foreground" aria-hidden />Št. plačil: {detail.payments.length}</span>
      </div>

      {/* zneski */}
      <div className="ml-auto w-full max-w-xs space-y-1 rounded-xl bg-secondary/60 p-3 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Osnova</span><span className="tabular-nums">{fmtEUR(detail.subtotal)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">DDV 22 %</span><span className="tabular-nums">{fmtEUR(detail.vat)}</span></div>
        <div className="flex justify-between border-t pt-1 font-bold"><span>Skupaj</span><span className="tabular-nums">{fmtEUR(detail.total)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Plačano</span><span className="tabular-nums">{fmtEUR(detail.paid)}</span></div>
        <div className={`flex justify-between font-bold ${open > 0.005 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          <span>Odprto</span><span className="tabular-nums">{fmtEUR(open)}</span>
        </div>
      </div>

      {/* plačila */}
      <section aria-label="Plačila računa">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Plačila</h3>
        {detail.payments.length === 0 ? <p className="text-sm text-muted-foreground">Ni zapisanih plačil.</p> : (
          <div className="max-h-72 overflow-y-auto rounded-xl border">
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
                    <TableCell>{METHODS.find((m) => m.value === p.method)?.label ?? p.method}</TableCell>
                    <TableCell className="max-w-32 truncate font-mono text-xs text-muted-foreground">{p.reference ?? '—'}</TableCell>
                    <TableCell className="pr-3 text-right font-medium tabular-nums">{fmtEUR(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={() => void exportEslog()} disabled={eslogBusy}>
          <FileCode2 className="size-4" aria-hidden /> {eslogBusy ? 'Pripravljam …' : 'eSLOG XML'}
        </Button>
        {canManagePayments ? (
          <Button disabled={!payable} onClick={onPay}>
            <Wallet className="size-4" aria-hidden /> Zapiši plačilo
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}

function PaymentDialog ({ invoice, onClose, onSaved }: {
  invoice: InvoiceDetail
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { toast } = useToast()
  const open = Math.round((invoice.total - invoice.paid) * 100) / 100
  const [amount, setAmount] = useState(open > 0 ? String(open.toFixed(2)) : '')
  const [method, setMethod] = useState('NAKAZNICA')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) { toast({ title: 'Znesek mora biti večji od 0.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/payments', { invoiceId: invoice.id, amount: value, method, reference: reference || undefined })
      toast({ title: 'Plačilo zapisano.' })
      await onSaved()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Zapiši plačilo — {invoice.code}</DialogTitle>
        <DialogDescription>
          Skupaj {fmtEUR(invoice.total)} · plačano {fmtEUR(invoice.paid)} · odprto {fmtEUR(open)}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="pay-amount">Znesek (€) *</Label>
          <Input id="pay-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="npr. 500.00" />
          {open > 0.005 && Number(amount) !== open ? (
            <p className="text-xs text-muted-foreground">Ostanek odprto: {fmtEUR(Math.max(open - (Number(amount) || 0), 0))}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label>Način plačila</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger aria-label="Način plačila"><SelectValue /></SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pay-ref">Sklic / referenca</Label>
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="npr. SI12 3456-7890" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Zapisujem…' : 'Zapiši plačilo'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

function IssueInvoiceDialog ({ quotes, loading, onClose, onIssued }: {
  quotes: IssuableQuote[]
  loading: boolean
  onClose: () => void
  onIssued: (code: string) => Promise<void>
}) {
  const { toast } = useToast()
  const [quoteId, setQuoteId] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = quotes.find((qq) => qq.id === quoteId)

  async function submit () {
    if (!quoteId) { toast({ title: 'Izberite ponudbo.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      const res = await apiPost<{ data: { code: string } }>('/api/invoices', { quoteId })
      await onIssued(res.data.code)
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Izdaj račun iz ponudbe</DialogTitle>
        <DialogDescription>Zneske prevzamemo iz sprejete ali zaklenjene ponudbe.</DialogDescription>
      </DialogHeader>
      {loading ? <LoadingRows rows={2} /> : quotes.length === 0 ? (
        <EmptyState title="Ni primerljivih ponudb" desc="Račun lahko izdate samo iz ponudbe v statusu Sprejet ali Zaklenjen." icon={Receipt} />
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Ponudba</Label>
            <Select value={quoteId || undefined} onValueChange={setQuoteId}>
              <SelectTrigger aria-label="Izberi ponudbo"><SelectValue placeholder="Izberite ponudbo …" /></SelectTrigger>
              <SelectContent>
                {quotes.map((qq) => (
                  <SelectItem key={qq.id} value={qq.id}>
                    {qq.code} · {qq.customer?.name ?? 'brez stranke'} · {fmtEUR(qq.total)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected ? (
            <div className="rounded-lg bg-secondary/60 p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Stranka</span><span>{selected.customer?.name ?? '—'}</span></div>
              {selected.project ? <div className="flex justify-between"><span className="text-muted-foreground">Projekt</span><span className="max-w-56 truncate">{selected.project.title}</span></div> : null}
              <div className="flex justify-between font-semibold"><span>Znesek ponudbe</span><span className="tabular-nums">{fmtEUR(selected.total)}</span></div>
            </div>
          ) : null}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy || !quoteId}>{busy ? 'Izdajam…' : 'Izdaj račun'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

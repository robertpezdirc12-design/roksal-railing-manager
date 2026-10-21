'use client'

// PDF — izvoz ponudb/računov v PDF (vrata documents.generate v nav-registry)
// Predogled: fetch /api/pdf/{quote|invoice}/{id} z Bearer žetonom → blob →
// object URL → <iframe>; gumba Prenesi / Odpri v zavihku; revociranje ob menjavi.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, Eye, FileText, Loader2 } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { fmtEUR, useApi, type ApiError } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'

type DocType = 'quote' | 'invoice'

interface QuoteRow {
  id: string; code: string; status: string; total: number
  customer: { name: string; city: string | null } | null
  _count: { lines: number }
}
interface InvoiceRow {
  id: string; code: string; status: string; total: number; paid: number
  dueDate: string | null
  project: { code: string; title: string; customer: { name: string } | null } | null
  quote: { code: string } | null
}

interface Preview { url: string; code: string }

const TYPE_LABEL: Record<DocType, string> = { quote: 'Ponudba', invoice: 'Račun' }

export default function PdfModule () {
  const { toast } = useToast()
  const token = useAppStore((s) => s.token)

  const [type, setType] = useState<DocType>('quote')
  const [docId, setDocId] = useState('none')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)

  const quotes = useApi<{ data: QuoteRow[] }>(type === 'quote' ? '/api/quotes?limit=200' : null, [type])
  const invoices = useApi<{ data: InvoiceRow[] }>(type === 'invoice' ? '/api/invoices?limit=200' : null, [type])

  const rows: { id: string; code: string; status: string; label: string; amount: string }[] = useMemo(() => {
    if (type === 'quote') {
      return (quotes.data?.data ?? []).map((q) => ({
        id: q.id, code: q.code, status: q.status,
        label: q.customer ? `${q.customer.name}${q.customer.city ? `, ${q.customer.city}` : ''}` : 'Brez stranke',
        amount: fmtEUR(q.total),
      }))
    }
    return (invoices.data?.data ?? []).map((i) => ({
      id: i.id, code: i.code, status: i.status,
      label: i.project?.customer?.name ?? i.project?.title ?? i.quote?.code ?? 'Brez projekta',
      amount: fmtEUR(i.total),
    }))
  }, [type, quotes.data, invoices.data])

  const loading = type === 'quote' ? quotes.loading : invoices.loading
  const error: ApiError | null = type === 'quote' ? quotes.error : invoices.error
  const selected = rows.find((r) => r.id === docId) ?? null

  // sprosti prejšnji object URL ob menjavi / odklopu
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  const resetPreview = useCallback(() => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
  }, [])

  function switchType (next: DocType): void {
    if (next === type) return
    resetPreview()
    setDocId('none')
    setType(next)
  }

  async function makePreview (): Promise<void> {
    if (docId === 'none' || !token) return
    setBusy(true)
    try {
      const res = await fetch(`/api/pdf/${type}/${docId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Napaka strežnika (${res.status}).`)
      }
      const blob = await res.blob()
      if (!blob.type.includes('pdf')) throw new Error('Odgovor ni veljaven PDF.')
      const url = URL.createObjectURL(blob)
      const code = selected?.code ?? 'dokument'
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return { url, code }
      })
      toast({ title: 'PDF pripravljen.', description: `${TYPE_LABEL[type]} ${code} — predogled spodaj.` })
    } catch (e) {
      toast({
        title: 'Izvoz PDF ni uspel.',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Izvoz PDF"
        desc="Tiskalne priprave ponudb in računov — predogled, prenos"
      />

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pdf-type">Vrsta dokumenta</Label>
              <Select value={type} onValueChange={(v) => switchType(v as DocType)}>
                <SelectTrigger id="pdf-type" aria-label="Vrsta dokumenta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quote">Ponudba</SelectItem>
                  <SelectItem value="invoice">Račun</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pdf-doc">Dokument</Label>
              <Select
                value={docId}
                onValueChange={(v) => { resetPreview(); setDocId(v) }}
                disabled={loading || rows.length === 0}
              >
                <SelectTrigger id="pdf-doc" aria-label="Izberi dokument">
                  <SelectValue placeholder={loading ? 'Nalagam …' : 'Izberite dokument'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {rows.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.code} — {r.label} · {r.amount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ErrorBox error={error} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void makePreview()} disabled={busy || docId === 'none'}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              Predogled
            </Button>
            {selected ? (
              <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <StatusBadge status={selected.status} />
                <span className="font-mono">{selected.code}</span>
                <span>· {selected.label} · {selected.amount}</span>
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                <FileText className="size-4 text-roksal-amber" aria-hidden />
                {TYPE_LABEL[type]} {preview.code}
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={preview.url} download={`${preview.code}.pdf`}>
                    <Download className="size-4" aria-hidden /> Prenesi
                  </a>
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.open(preview.url, '_blank', 'noopener')}>
                  <ExternalLink className="size-4" aria-hidden /> Odpri v zavihku
                </Button>
              </div>
            </div>
            <iframe
              src={preview.url}
              title={`Predogled PDF — ${preview.code}`}
              className="h-[70vh] w-full rounded-lg border bg-muted"
            />
            <p className="text-xs text-muted-foreground">
              Predogled se izriše v vgrajenem pregledovalniku brskalnika. Za podpis / tiskanje uporabite „Odpri v zavihku“.
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
        <LoadingRows rows={2} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={`Ni ${type === 'quote' ? 'ponudb' : 'računov'}`}
          desc={type === 'quote'
            ? 'Ustvarite ponudbo v modulu Ponudbe ali Konfigurator, nato jo izvozite tukaj.'
            : 'Izdajte račun iz sprejete ponudbe v modulu Računi, nato ga izvozite tukaj.'}
          icon={FileText}
        />
      ) : (
        <EmptyState
          title="Izberite dokument"
          desc="Izberite vrsto in dokument, nato kliknite Predogled — PDF se izriše spodaj."
          icon={Eye}
        />
      )}
    </div>
  )
}

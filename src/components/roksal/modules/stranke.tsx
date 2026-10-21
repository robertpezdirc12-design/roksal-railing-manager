'use client'

// STRANKE — seznam s kontakti, iskanje, novo/urejanje, podrobnost s projekti stranke
// Vrata: branje customers.read, pisanje customers.write (gumbi skriti brez pravice).

import { useMemo, useState } from 'react'
import { FileText, FolderKanban, Mail, MapPin, Pencil, Phone, Plus, Search, Users } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDate, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface CustomerRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  taxId: string | null
  note: string | null
  createdAt: string
  _count: { projects: number; quotes: number }
}

interface CustomerDetail extends CustomerRow {
  projects: { id: string; code: string; title: string; status: string; address: string | null; createdAt: string }[]
  quotes: { id: string; code: string; status: string; total: number; createdAt: string }[]
  _count: { projects: number; quotes: number; leads: number }
}

type FormValues = { name: string; email: string; phone: string; address: string; city: string; taxId: string; note: string }

const EMPTY_FORM: FormValues = { name: '', email: '', phone: '', address: '', city: '', taxId: '', note: '' }

export default function StrankeModule () {
  const user = useAppStore((s) => s.user)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CustomerDetail | null>(null)

  const list = useApi<{ data: CustomerRow[] }>(`/api/customers?q=${encodeURIComponent(q)}`, [q])
  const detail = useApi<{ data: CustomerDetail }>(selected ? `/api/customers/${selected}` : null, [selected])

  const canWrite = hasPerm(user?.perms, 'customers.write')
  const rows = useMemo(() => list.data?.data ?? [], [list.data])

  function openCreate () {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit (c: CustomerDetail) {
    setEditing(c)
    setFormOpen(true)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stranke"
        desc="Seznam strank in kontakti"
        actions={canWrite ? (
          <Button size="sm" onClick={openCreate}><Plus className="size-4" aria-hidden /> Nova stranka</Button>
        ) : null}
      />

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči po imenu, e-pošti, telefonu, kraju …" className="pl-8" aria-label="Iskanje strank" />
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni strank" desc="Poskusite spremeniti iskalni niz ali dodajte novo stranko." icon={Users} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full text-left" onClick={() => setSelected(c.id)} aria-label={`Odpri stranko ${c.name}`}>
                <Card className="transition hover:border-roksal-amber/60 hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold leading-snug">{c.name}</div>
                      {c.taxId ? <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground">{c.taxId}</span> : null}
                    </div>
                    <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                      {c.email ? <span className="inline-flex items-center gap-1.5 truncate"><Mail className="size-3.5 shrink-0" aria-hidden />{c.email}</span> : null}
                      {c.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5 shrink-0" aria-hidden />{c.phone}</span> : null}
                      {c.city || c.address ? (
                        <span className="inline-flex items-center gap-1.5 truncate"><MapPin className="size-3.5 shrink-0" aria-hidden />{[c.address, c.city].filter(Boolean).join(', ')}</span>
                      ) : null}
                    </div>
                    <div className="mt-2.5 flex gap-3 border-t pt-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><FolderKanban className="size-3" aria-hidden />{c._count.projects} projektov</span>
                      <span className="inline-flex items-center gap-1"><FileText className="size-3" aria-hidden />{c._count.quotes} ponudb</span>
                      <span className="ml-auto">{fmtDate(c.createdAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* podrobnost stranke */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {detail.loading ? (
            <>
              <DialogHeader><DialogTitle className="sr-only">Nalaganje podrobnosti stranke</DialogTitle></DialogHeader>
              <LoadingRows rows={3} />
            </>
          ) : detail.data ? (
            <CustomerDetailDialog
              detail={detail.data.data}
              canWrite={canWrite}
              onEdit={() => openEdit(detail.data!.data)}
            />
          ) : (
            <>
              <DialogHeader><DialogTitle>Napaka</DialogTitle></DialogHeader>
              <ErrorBox error={detail.error} />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* nova / urejanje */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setEditing(null) } }}>
        {formOpen ? (
          <CustomerFormDialog
            initial={editing}
            onClose={() => { setFormOpen(false); setEditing(null) }}
            onSaved={async () => {
              setFormOpen(false)
              setEditing(null)
              await Promise.all([list.reload(), detail.reload()])
            }}
          />
        ) : null}
      </Dialog>
    </div>
  )
}

function CustomerDetailDialog ({ detail, canWrite, onEdit }: { detail: CustomerDetail; canWrite: boolean; onEdit: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{detail.name}</DialogTitle>
        <DialogDescription>
          {detail._count.projects} projektov · {detail._count.quotes} ponudb · stranka od {fmtDate(detail.createdAt)}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2 rounded-lg bg-secondary/60 p-3 text-sm sm:grid-cols-2">
        {detail.email ? <span className="inline-flex items-center gap-2 truncate"><Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />{detail.email}</span> : null}
        {detail.phone ? <span className="inline-flex items-center gap-2"><Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden />{detail.phone}</span> : null}
        {detail.address || detail.city ? <span className="inline-flex items-center gap-2 truncate"><MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />{[detail.address, detail.city].filter(Boolean).join(', ')}</span> : null}
        {detail.taxId ? <span className="inline-flex items-center gap-2 font-mono text-xs">ID za DDV: {detail.taxId}</span> : null}
        {!detail.email && !detail.phone && !detail.address && !detail.city && !detail.taxId ? <span className="text-muted-foreground">Ni kontaktnih podatkov.</span> : null}
      </div>

      {detail.note ? <p className="rounded-lg border p-3 text-sm">{detail.note}</p> : null}

      <section aria-label="Projekti stranke">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Projekti</h3>
        {detail.projects.length === 0 ? <p className="text-sm text-muted-foreground">Ni projektov.</p> : (
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {detail.projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                <span className="min-w-0 truncate"><span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.title}</span>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Ponudbe stranke">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Ponudbe</h3>
        {detail.quotes.length === 0 ? <p className="text-sm text-muted-foreground">Ni ponudb.</p> : (
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {detail.quotes.map((qq) => (
              <li key={qq.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                <span className="font-mono text-xs">{qq.code}</span>
                <StatusBadge status={qq.status} />
                <span className="font-semibold">{fmtEUR(qq.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite ? (
        <DialogFooter>
          <Button variant="outline" onClick={onEdit}><Pencil className="size-4" aria-hidden /> Uredi</Button>
        </DialogFooter>
      ) : null}
    </>
  )
}

function CustomerFormDialog ({ initial, onClose, onSaved }: {
  initial: CustomerDetail | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<FormValues>(initial ? {
    name: initial.name,
    email: initial.email ?? '',
    phone: initial.phone ?? '',
    address: initial.address ?? '',
    city: initial.city ?? '',
    taxId: initial.taxId ?? '',
    note: initial.note ?? '',
  } : EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  function set<K extends keyof FormValues> (key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit () {
    if (!form.name.trim()) { toast({ title: 'Ime stranke je obvezno.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      if (initial) {
        await apiPatch(`/api/customers/${initial.id}`, form)
        toast({ title: 'Stranka shranjena.' })
      } else {
        await apiPost('/api/customers', form)
        toast({ title: 'Stranka ustvarjena.' })
      }
      await onSaved()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{initial ? 'Uredi stranko' : 'Nova stranka'}</DialogTitle>
        <DialogDescription>Kontaktni podatki za ponudbe in račune.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="cf-name">Ime / naziv *</Label>
          <Input id="cf-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="npr. Marko Novak" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-email">E-pošta</Label>
          <Input id="cf-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="ime@primer.si" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-phone">Telefon</Label>
          <Input id="cf-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="041 234 567" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-address">Naslov</Label>
          <Input id="cf-address" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Ulica in hišna številka" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-city">Kraj</Label>
          <Input id="cf-city" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="npr. Ljubljana" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-tax">ID za DDV</Label>
          <Input id="cf-tax" value={form.taxId} onChange={(e) => set('taxId', e.target.value)} placeholder="SI12345678" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="cf-note">Opomba</Label>
          <Textarea id="cf-note" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Posebnosti, dogovori …" rows={2} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Shranjujem…' : 'Shrani'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

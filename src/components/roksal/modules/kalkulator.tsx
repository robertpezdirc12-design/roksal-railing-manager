'use client'

// KALKULATOR — zajem → komercialno: izbira profila, dolžina/stebri/montaža,
// izračun pozicij + DDV 22 %, "Ustvari osnutek ponudbe" (quotes.create).
// Profili: /api/catalog (4-c); če še ne obstaja → fiksni seznam v UI (fallback).

import { useMemo, useState } from 'react'
import { Calculator, FilePlus2, Info, Layers, Ruler } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

const VAT_RATE = 0.22
const POST_PRICE = 45 // stebri 80×80 mm — €/kos
const MONTAZA_PRICE = 35 // montaža — €/m

interface ProfileOpt { sku: string; name: string; pricePerM: number }

// fallback, dokler 4-c ne odpre /api/catalog
const FALLBACK_PROFILES: ProfileOpt[] = [
  { sku: 'ALU-L-80', name: 'Alu ograja L-profil 80', pricePerM: 89 },
  { sku: 'ALU-OKR-60', name: 'Alu okrogla ograja 60', pricePerM: 76 },
  { sku: 'INOX-V2A-50', name: 'Inox ograja V2A 50', pricePerM: 120 },
  { sku: 'INOX-BAL-10', name: 'Inox balustrada 10 mm', pricePerM: 145 },
  { sku: 'KOV-TRAD', name: 'Kovana ograja — tradicionalna', pricePerM: 160 },
  { sku: 'KOV-MOD', name: 'Kovana ograja — moderna', pricePerM: 175 },
]

/** Toleranten razpakovalnik odgovora /api/catalog (prepozna data[] ali data.profiles[]). */
function normalizeProfiles (payload: unknown): ProfileOpt[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { profiles?: unknown[] } | null)?.profiles)
      ? (payload as { profiles: unknown[] }).profiles
      : []
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof p.pricePerM === 'number' && typeof p.name === 'string')
    .map((p) => ({
      sku: typeof p.sku === 'string' ? p.sku : String(p.name),
      name: String(p.name),
      pricePerM: Number(p.pricePerM),
    }))
}

interface CalcLine { description: string; qty: number; unitPrice: number }

export default function KalkulatorModule () {
  const user = useAppStore((s) => s.user)
  const [sku, setSku] = useState(FALLBACK_PROFILES[0]!.sku)
  const [lengthM, setLengthM] = useState('')
  const [posts, setPosts] = useState('')
  const [montaza, setMontaza] = useState(true)
  const [submitOpen, setSubmitOpen] = useState(false)

  const catalog = useApi<{ data?: unknown }>('/api/catalog')
  const profiles = useMemo(() => {
    const list = normalizeProfiles(catalog.data?.data)
    return list.length > 0 ? list : FALLBACK_PROFILES
  }, [catalog.data])

  const canCreate = hasPerm(user?.perms, 'quotes.create')

  const length = Number(lengthM.replace(',', '.'))
  const postsN = Number(posts)
  // če katalog prinese drugačen SKU-seznam, padne izbira na prvi veljavni profil
  const effectiveSku = profiles.some((p) => p.sku === sku) ? sku : profiles[0]?.sku ?? ''
  const profile = profiles.find((p) => p.sku === effectiveSku)

  const lines = useMemo<CalcLine[]>(() => {
    const out: CalcLine[] = []
    if (profile && Number.isFinite(length) && length > 0) {
      out.push({ description: `${profile.name} (${profile.sku})`, qty: Math.round(length * 100) / 100, unitPrice: profile.pricePerM })
    }
    if (Number.isFinite(postsN) && postsN > 0) {
      out.push({ description: `Stebri 80×80 mm (${POST_PRICE} €/kos)`, qty: Math.round(postsN), unitPrice: POST_PRICE })
    }
    if (montaza && Number.isFinite(length) && length > 0) {
      out.push({ description: `Montaža (${MONTAZA_PRICE} €/m)`, qty: Math.round(length * 100) / 100, unitPrice: MONTAZA_PRICE })
    }
    return out
  }, [profile, length, postsN, montaza])

  const subtotal = Math.round(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * 100) / 100
  const vat = Math.round(subtotal * VAT_RATE * 100) / 100
  const total = Math.round((subtotal + vat) * 100) / 100

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kalkulator"
        desc="Ocena ograje → osnutek ponudbe v enem koraku"
        actions={canCreate ? (
          <Button size="sm" disabled={lines.length === 0} onClick={() => setSubmitOpen(true)}>
            <FilePlus2 className="size-4" aria-hidden /> Ustvari osnutek ponudbe
          </Button>
        ) : null}
      />

      {catalog.error ? (
        <div className="flex items-start gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground" role="note">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Katalog profilov ({'/api/catalog'}) še ni na voljo — uporabljen je fiksni seznam profilov.</span>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {/* vhod */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Ruler className="size-4 text-roksal-amber" aria-hidden /> Vhodni podatki</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Profil</Label>
              <Select value={effectiveSku} onValueChange={setSku}>
                <SelectTrigger aria-label="Izberi profil"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.sku} value={p.sku}>
                      {p.sku} — {p.name} ({fmtEUR(p.pricePerM)}/m)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="calc-length">Dolžina (m) *</Label>
                <Input id="calc-length" type="number" min="0.1" step="0.01" inputMode="decimal" value={lengthM} onChange={(e) => setLengthM(e.target.value)} placeholder="npr. 12.5" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="calc-posts">Št. stebrov</Label>
                <Input id="calc-posts" type="number" min="0" step="1" inputMode="numeric" value={posts} onChange={(e) => setPosts(e.target.value)} placeholder="npr. 8" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="calc-montaza">Montaža</Label>
                <p className="text-xs text-muted-foreground">{fmtEUR(MONTAZA_PRICE)} / m dolžine</p>
              </div>
              <Switch id="calc-montaza" checked={montaza} onCheckedChange={setMontaza} aria-label="Vključi montažo" />
            </div>
          </CardContent>
        </Card>

        {/* izračun */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Calculator className="size-4 text-roksal-amber" aria-hidden /> Izračun pozicij</CardTitle>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <EmptyState
                title="Vnesite dolžino"
                desc="Izračun se samodejno posodablja — dodajte dolžino ograje."
                icon={Layers}
              />
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-3">Pozicija</TableHead>
                        <TableHead className="text-right">Kol.</TableHead>
                        <TableHead className="text-right">€/enota</TableHead>
                        <TableHead className="pr-3 text-right">Znesek</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell className="max-w-48 truncate pl-3" title={l.description}>{l.description}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtEUR(l.unitPrice)}</TableCell>
                          <TableCell className="pr-3 text-right font-medium tabular-nums">{fmtEUR(l.qty * l.unitPrice)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="ml-auto w-full max-w-xs space-y-1 rounded-xl bg-secondary/60 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Osnova</span><span className="tabular-nums">{fmtEUR(subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">DDV 22 %</span><span className="tabular-nums">{fmtEUR(vat)}</span></div>
                  <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Skupaj</span><span className="tabular-nums">{fmtEUR(total)}</span></div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* osnutek ponudbe */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        {submitOpen ? (
          <QuoteDraftDialog
            lines={lines}
            onClose={() => setSubmitOpen(false)}
          />
        ) : null}
      </Dialog>
    </div>
  )
}

function QuoteDraftDialog ({ lines, onClose }: { lines: CalcLine[]; onClose: () => void }) {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const canReadCustomers = hasPerm(user?.perms, 'customers.read')
  const [customerId, setCustomerId] = useState('none')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const customers = useApi<{ data: { id: string; name: string }[] }>(
    canReadCustomers ? '/api/customers?limit=200' : null,
    []
  )

  async function submit () {
    setBusy(true)
    try {
      const res = await apiPost<{ data: { code: string } }>('/api/quotes', {
        customerId: customerId === 'none' ? null : customerId,
        note: note || undefined,
        lines,
      })
      toast({ title: `Osnutek ponudbe ${res.data.code} ustvarjen.`, description: 'Nadaljujte v modulu Ponudbe.' })
      onClose()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Ustvari osnutek ponudbe</DialogTitle>
        <DialogDescription>
          {lines.length} pozicij · DDV 22 % se izračuna strežniško.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Stranka</Label>
          {canReadCustomers ? (
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger aria-label="Stranka"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brez stranke</SelectItem>
                {(customers.data?.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">Brez pravice customers.read — ponudba bo brez stranke.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="draft-note">Opomba</Label>
          <Input id="draft-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. antracit RAL 7016, rok 3 tedne" />
        </div>
        <div className="max-h-48 overflow-y-auto rounded-xl border">
          <Table>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-52 truncate pl-3">{l.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.qty} × {fmtEUR(l.unitPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Ustvarjam…' : 'Ustvari osnutek'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

'use client'

// KATALOG — mreža profilov s filtri in urejanjem cen (vrata catalog.read; urejanje = catalog.write)

import { useMemo, useState } from 'react'
import { LayoutGrid, Pencil, Plus, Ruler } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

interface ProfileRow {
  id: string; sku: string; name: string; material: string; type: string
  pricePerM: number; description: string | null
}

const MATERIALS = ['ALU', 'INOX', 'KOVANO ŽELEZO', 'STIKLO']
const TYPES = ['OGRAJA', 'BALUSTRADA', 'NAGIBNA']

export default function KatalogModule () {
  const user = useAppStore((s) => s.user)
  const [material, setMaterial] = useState('all')
  const [type, setType] = useState('all')
  const [editProfile, setEditProfile] = useState<ProfileRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const list = useApi<{ data: ProfileRow[] }>('/api/catalog')
  const canWrite = hasPerm(user?.perms, 'catalog.write')

  const rows = useMemo(() => {
    const all = list.data?.data ?? []
    return all
      .filter((p) => (material === 'all' ? true : p.material === material))
      .filter((p) => (type === 'all' ? true : p.type === type))
  }, [list.data, material, type])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Katalog"
        desc="Profili ograj in balustrad s cenami na meter"
        actions={canWrite ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nov profil
          </Button>
        ) : null}
      />

      <div className="flex flex-wrap gap-2">
        <Select value={material} onValueChange={setMaterial}>
          <SelectTrigger className="w-44" aria-label="Filter materiala"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi materiali</SelectItem>
            {MATERIALS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-44" aria-label="Filter tipa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi tipi</SelectItem>
            {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="ml-auto self-center">{rows.length} profilov</Badge>
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni profilov" desc="Spremenite filter ali dodajte nov profil." icon={LayoutGrid} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id}>
              <Card className="h-full transition hover:border-roksal-amber/60 hover:shadow-sm">
                <CardContent className="flex h-full flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{p.sku}</span>
                    {canWrite ? (
                      <Button variant="ghost" size="icon" onClick={() => setEditProfile(p)} aria-label={`Uredi ceno za ${p.sku}`}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                  <div className="font-semibold leading-snug">{p.name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{p.material}</Badge>
                    <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{p.type}</Badge>
                  </div>
                  {p.description ? <p className="text-xs text-muted-foreground">{p.description}</p> : null}
                  <div className="mt-auto flex items-center gap-1.5 pt-1 text-sm font-bold">
                    <Ruler className="size-4 text-muted-foreground" aria-hidden />
                    {fmtEUR(p.pricePerM)} <span className="text-xs font-normal text-muted-foreground">/ m</span>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* urejanje cene */}
      <Dialog open={!!editProfile} onOpenChange={(o) => { if (!o) setEditProfile(null) }}>
        <EditPriceDialog
          profile={editProfile}
          onClose={() => setEditProfile(null)}
          onSaved={async () => { setEditProfile(null); await list.reload() }}
        />
      </Dialog>

      {/* nov profil */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewProfileDialog
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await list.reload() }}
        />
      </Dialog>
    </div>
  )
}

function EditPriceDialog ({ profile, onClose, onSaved }: { profile: ProfileRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [price, setPrice] = useState('')

  // ob vsakem odprtju novega profila ponastavi vnos
  const [lastId, setLastId] = useState<string | null>(null)
  if (profile && profile.id !== lastId) { setLastId(profile.id); setPrice(String(profile.pricePerM)) }

  async function submit () {
    if (!profile) return
    const p = Number(price)
    if (!Number.isFinite(p) || p < 0) { toast({ title: 'Cena mora biti veljavno število.', variant: 'destructive' }); return }
    try {
      await apiPatch(`/api/catalog/${profile.id}`, { pricePerM: p })
      toast({ title: 'Cena posodobljena.', description: `${profile.sku}: ${fmtEUR(p)}/m` })
      await onSaved()
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  if (!profile) return null
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Uredi ceno profila</DialogTitle>
        <DialogDescription>{profile.sku} — {profile.name} · trenutno {fmtEUR(profile.pricePerM)}/m</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="ep-price">Cena na meter (€)</Label>
        <Input id="ep-price" type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
        <p className="text-xs text-muted-foreground">Sprememba se zapiše v revizijski dnevnik (PROFILE_UPDATE).</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()}>Shrani ceno</Button>
      </DialogFooter>
    </DialogContent>
  )
}

function NewProfileDialog ({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const { toast } = useToast()
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [material, setMaterial] = useState('ALU')
  const [type, setType] = useState('OGRAJA')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    if (!sku.trim()) { toast({ title: 'SKU je obvezen.', variant: 'destructive' }); return }
    if (!name.trim()) { toast({ title: 'Ime profila je obvezno.', variant: 'destructive' }); return }
    const p = Number(price)
    if (!Number.isFinite(p) || p < 0) { toast({ title: 'Cena mora biti veljavno število.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/catalog', { sku, name, material, type, pricePerM: p, description })
      toast({ title: 'Profil dodan.', description: `${sku.toUpperCase()} — ${name}` })
      await onCreated()
    } catch (e) {
      toast({ title: 'Napaka pri dodajanju', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nov profil</DialogTitle>
        <DialogDescription>Dodaj profil v katalog izdelkov.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="np-sku">SKU</Label>
            <Input id="np-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="npr. ALU-L-100" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="np-price">Cena/m (€)</Label>
            <Input id="np-price" type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="npr. 92" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="np-name">Ime</Label>
          <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Alu L-profil 100×100" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Material</Label>
            <Select value={material} onValueChange={setMaterial}>
              <SelectTrigger aria-label="Material"><SelectValue /></SelectTrigger>
              <SelectContent>{MATERIALS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tip</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger aria-label="Tip"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="np-desc">Opis (neobvezno)</Label>
          <Input id="np-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="npr. Anodiziran, RAL po naročilu" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Dodajam …' : 'Dodaj profil'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

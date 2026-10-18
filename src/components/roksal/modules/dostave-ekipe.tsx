'use client'

// DOSTAVE EKIPE (R549): zavihek ekipe in podizvajalci — kartice z oceno
// (zvezdice), kontakti, tipi del + dialog ekipe (izvlečeno bajtno-identično
// iz dostave.tsx).

import { useState } from 'react'
import { Mail, Pencil, Phone, Plus, Star, User, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { CREW_TYPES } from '@/lib/crew-core'
import { isOffice } from './dostave-shared'
import type { CrewRow } from './dostave-shared'

// ─── ZAVIHEK: ekipe in podizvajalci ──────────────────────────────────────────

function Stars ({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-xs text-muted-foreground">brez ocene</span>
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Ocena kakovosti ${rating} od 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`size-3.5 ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`} aria-hidden />
      ))}
    </span>
  )
}

export function EkipeTab () {
  const user = useAppStore((s) => s.user)
  const [type, setType] = useState('all')
  const crews = useApi<{ data: CrewRow[] }>(`/api/crews?all=1${type !== 'all' ? `&type=${type}` : ''}`, [type])
  const [editing, setEditing] = useState<CrewRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const canWrite = isOffice(user)
  const rows = crews.data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-52" aria-label="Filter tipa ekipe"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi tipi</SelectItem>
            <SelectItem value="INTERNA">Interne ekipe</SelectItem>
            <SelectItem value="PODIZVAJALEC">Podizvajalci</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">{rows.length} ekip</Badge>
        {canWrite ? (
          <Button size="sm" className="ml-auto" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden /> Dodaj ekipo
          </Button>
        ) : null}
      </div>
      <ErrorBox error={crews.error} />
      {crews.loading ? <LoadingRows /> : !crews.error && rows.length === 0 ? (
        <EmptyState title="Ni ekip" desc="Dodajte interno ekipo ali podizvajalca z regijo, tipi del in oceno kakovosti." icon={Users} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <li key={c.id}>
              <Card className="flex h-full flex-col transition hover:border-roksal-amber/60">
                <CardContent className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold leading-snug">{c.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {c.type === 'INTERNA' ? (
                          <Badge variant="secondary" className="border-transparent bg-secondary text-[10px] text-secondary-foreground">interna</Badge>
                        ) : (
                          <Badge variant="secondary" className="border-transparent bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">podizvajalec</Badge>
                        )}
                        {!c.active ? <Badge variant="secondary" className="border-transparent bg-muted text-[10px] text-muted-foreground">neaktivna</Badge> : null}
                        {c.region ? <span className="text-xs text-muted-foreground">{c.region}</span> : null}
                      </div>
                    </div>
                    {canWrite ? (
                      <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`Uredi ekipo ${c.name}`} onClick={() => setEditing(c)}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                  <Stars rating={c.rating} />
                  {c.workTypes ? <div className="text-xs"><span className="font-semibold">Tipi del:</span> <span className="text-muted-foreground">{c.workTypes}</span></div> : null}
                  {c.contactName || c.contactPhone || c.contactEmail ? (
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      {c.contactName ? <div className="inline-flex items-center gap-1"><User className="size-3" aria-hidden /> {c.contactName}</div> : null}
                      {c.contactPhone ? <div className="inline-flex items-center gap-1"><Phone className="size-3" aria-hidden /> {c.contactPhone}</div> : null}
                      {c.contactEmail ? <div className="inline-flex items-center gap-1 break-all"><Mail className="size-3" aria-hidden /> {c.contactEmail}</div> : null}
                    </div>
                  ) : null}
                  {c.availabilityNote ? <div className="text-xs"><span className="font-semibold">Razpoložljivost:</span> <span className="text-muted-foreground">{c.availabilityNote}</span></div> : null}
                  {c.priceNote ? <div className="text-xs"><span className="font-semibold">Cena:</span> <span className="text-muted-foreground">{c.priceNote}</span></div> : null}
                  {c.note ? <div className="rounded-lg border bg-secondary/40 p-2 text-xs text-muted-foreground">{c.note}</div> : null}
                  <div className="mt-auto pt-1 text-xs text-muted-foreground">{c._count.workOrders} nalogov</div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <CrewDialog
          key={String(addOpen)} /* remount ob vsakem odprtju — sveža forma */
          crew={null}
          onClose={() => setAddOpen(false)}
          onDone={async () => { await crews.reload() }}
        />
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <CrewDialog
          key={editing?.id ?? 'urejanje'} /* remount ob preklopu ekipe — forma se napolni iz ekipe */
          crew={editing}
          onClose={() => setEditing(null)}
          onDone={async () => { await crews.reload() }}
        />
      </Dialog>
    </div>
  )
}

function CrewDialog ({ crew, onClose, onDone }: { crew: CrewRow | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const [name, setName] = useState(crew?.name ?? '')
  const [type, setType] = useState<string>(crew?.type ?? 'INTERNA')
  const [region, setRegion] = useState(crew?.region ?? '')
  const [contactName, setContactName] = useState(crew?.contactName ?? '')
  const [contactPhone, setContactPhone] = useState(crew?.contactPhone ?? '')
  const [contactEmail, setContactEmail] = useState(crew?.contactEmail ?? '')
  const [workTypes, setWorkTypes] = useState(crew?.workTypes ?? '')
  const [availabilityNote, setAvailabilityNote] = useState(crew?.availabilityNote ?? '')
  const [priceNote, setPriceNote] = useState(crew?.priceNote ?? '')
  const [rating, setRating] = useState<string>(crew?.rating !== null && crew?.rating !== undefined ? String(crew.rating) : '0')
  const [active, setActive] = useState(crew?.active ?? true)
  const [note, setNote] = useState(crew?.note ?? '')
  const [busy, setBusy] = useState(false)

  async function submit () {
    setBusy(true)
    try {
      const body = {
        name: name.trim(),
        type,
        region: region.trim() || null,
        contactName: contactName.trim() || null,
        contactPhone: contactPhone.trim() || null,
        contactEmail: contactEmail.trim() || null,
        workTypes: workTypes.trim() || null,
        availabilityNote: availabilityNote.trim() || null,
        priceNote: priceNote.trim() || null,
        rating: rating === '0' ? null : Number(rating),
        ...(crew ? { active } : {}),
        note: note.trim() || null,
      }
      if (crew) {
        await apiPatch(`/api/crews/${crew.id}`, body)
        toast({ title: 'Ekipa shranjena.', description: name.trim() })
      } else {
        await apiPost('/api/crews', body)
        toast({ title: 'Ekipa dodana.', description: name.trim() })
      }
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Shranjevanje ekipe ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{crew ? `Uredi ekipo — ${crew.name}` : 'Nova ekipa / podizvajalec'}</DialogTitle>
        <DialogDescription>
          Regija, tipi del, razpoložljivost, cena, ocena kakovosti (1–5) in opombe o zgodovini/reklamacijah (issue #7 §9).
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cr-name">Ime *</Label>
            <Input id="cr-name" className="min-h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Ekipa Kranj ali Alu-Mont d.o.o." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-type">Tip</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="cr-type" className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CREW_TYPES.map((t) => <SelectItem key={t} value={t}>{t === 'INTERNA' ? 'Interna ekipa' : 'Podizvajalec'}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-region">Regija</Label>
            <Input id="cr-region" className="min-h-11" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="npr. Gorenjska" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-rating">Ocena kakovosti</Label>
            <Select value={rating} onValueChange={setRating}>
              <SelectTrigger id="cr-rating" className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Brez ocene</SelectItem>
                {[1, 2, 3, 4, 5].map((r) => <SelectItem key={r} value={String(r)}>{'★'.repeat(r)} ({r}/5)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-cname">Kontaktna oseba</Label>
            <Input id="cr-cname" className="min-h-11" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-cphone">Telefon</Label>
            <Input id="cr-cphone" className="min-h-11" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="npr. 041 234 567" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cr-cemail">E-pošta</Label>
            <Input id="cr-cemail" type="email" className="min-h-11" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cr-worktypes">Tipi del</Label>
            <Input id="cr-worktypes" className="min-h-11" value={workTypes} onChange={(e) => setWorkTypes(e.target.value)} placeholder="npr. terase, ograje, fasade" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-avail">Razpoložljivost</Label>
            <Input id="cr-avail" className="min-h-11" value={availabilityNote} onChange={(e) => setAvailabilityNote(e.target.value)} placeholder="npr. prosti od novembra" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-price">Cena / referenca</Label>
            <Input id="cr-price" className="min-h-11" value={priceNote} onChange={(e) => setPriceNote(e.target.value)} placeholder="npr. 28 €/m² montaže" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-note">Zgodovina, reklamacije — opombe</Label>
          <Textarea id="cr-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="npr. Reklamacija 3/2026 rešena; zanesljivi pri terminih" />
        </div>
        {crew ? (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium">
            <Switch checked={active} onCheckedChange={setActive} aria-label="Ekipa je aktivna" />
            Aktivna (vidna za dodelitve)
          </label>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button disabled={busy || !name.trim()} onClick={submit}>{busy ? 'Shranjujem …' : crew ? 'Shrani spremembe' : 'Dodaj ekipo'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

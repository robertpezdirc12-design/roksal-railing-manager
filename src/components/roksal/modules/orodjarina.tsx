'use client'

// ORODJARINA — merilna orodja: statistika, izposoja (samopostrežna), servisi, umeritve
// Vrata equipment.read; administrativne akcije (novo/servis/pokvarjeno) dodatno ADMIN/VODJA.

import { useMemo, useState } from 'react'
import { CalendarClock, Cog, History, MapPin, PackageCheck, Plus, Search, UserCheck, Wrench, XCircle } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatCard } from '@/components/roksal/ui-bits'

interface CheckoutRow {
  id: string
  outAt: string
  inAt: string | null
  note: string | null
  user: { id: string; name: string; role: string } | null
}

interface EquipRow {
  id: string
  code: string
  name: string
  category: string
  serialNumber: string | null
  status: string
  location: string | null
  calibrationDue: string | null
  note: string | null
  holder: { id: string; name: string } | null
  checkouts: CheckoutRow[] // samo odprte
}

interface EquipDetail extends Omit<EquipRow, 'checkouts'> {
  checkouts: CheckoutRow[] // cela zgodovina
}

const CATEGORIES = [
  { value: 'MERITEV', label: 'Meritev' },
  { value: 'MONTAZA', label: 'Montaža' },
  { value: 'PREVERITEV', label: 'Preveritev' },
  { value: 'VZDRZEVANJE', label: 'Vzdrževanje' },
]

const STATUSES = [
  { value: 'NA_VOLJO', label: 'Na voljo', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  { value: 'IZPOSOJENO', label: 'Izposojeno', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  { value: 'V_SERVISU', label: 'V servisu', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  { value: 'POKVARJENO', label: 'Pokvarjeno', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
]

const statusMeta = (s: string) => STATUSES.find((x) => x.value === s) ?? { value: s, label: s, cls: 'bg-muted text-muted-foreground' }
const catLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c

const DAY = 86400000

/** Oznaka roka umeritve: potekel (destructive) / pod 14 dni (amber) / navadna. */
function CalibrationTag ({ due }: { due: string | null }) {
  if (!due) return <span className="text-xs text-muted-foreground">Umeritev: —</span>
  const d = new Date(due).getTime()
  const now = Date.now()
  if (d < now) {
    return (
      // R580: kontrast — text-destructive (#ef4444) je na temni kartici 3,94:1 (pod AA); vzorec iz datoteke: red-600/400 kot »Popravljeno« in StatCard tono
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
        <CalendarClock className="size-3.5" aria-hidden />Umeritev potekla ({fmtDate(due)})
      </span>
    )
  }
  if (d < now + 14 * DAY) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
        <CalendarClock className="size-3.5" aria-hidden />Umeritev kmalu ({fmtDate(due)})
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CalendarClock className="size-3.5" aria-hidden />Umeritev: {fmtDate(due)}
    </span>
  )
}

export default function OrodjarinaModule () {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'VODJA'

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [historyFor, setHistoryFor] = useState<EquipRow | null>(null)
  const [checkoutFor, setCheckoutFor] = useState<EquipRow | null>(null)
  const [serviceFor, setServiceFor] = useState<EquipRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const list = useApi<{ data: EquipRow[] }>(`/api/equipment${q ? `?q=${encodeURIComponent(q)}` : ''}`, [q])
  const history = useApi<{ data: EquipDetail }>(historyFor ? `/api/equipment/${historyFor.id}` : null, [historyFor?.id])

  const rows = useMemo(() => {
    const all = list.data?.data ?? []
    return all.filter((e) => (status === 'all' ? true : e.status === status))
  }, [list.data, status])

  const stats = useMemo(() => {
    const all = list.data?.data ?? []
    return {
      naVoljo: all.filter((e) => e.status === 'NA_VOLJO').length,
      izposojeno: all.filter((e) => e.status === 'IZPOSOJENO').length,
      servis: all.filter((e) => e.status === 'V_SERVISU').length,
      pokvarjeno: all.filter((e) => e.status === 'POKVARJENO').length,
      poteklo: all.filter((e) => e.calibrationDue && new Date(e.calibrationDue).getTime() < Date.now()).length,
    }
  }, [list.data])

  /** Pomožna izvedba akcije z osvežitvijo in toastom. */
  async function runAction (equip: EquipRow, action: string, body?: Record<string, unknown>) {
    setBusyId(equip.id)
    try {
      await apiPatch(`/api/equipment/${equip.id}`, { action, ...body })
      toast({ title: `Orodje ${equip.code}: ${ACTION_LABELS[action] ?? 'akcija izvedena'}.` })
      await list.reload()
      if (historyFor?.id === equip.id) await history.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orodjarina"
        desc="Merilna in montažna orodja — izposoja, servisi in roki umeritve"
        actions={isAdmin ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden /> Novo orodje</Button>
        ) : null}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Na voljo" value={stats.naVoljo} icon={PackageCheck} tone="green" hint="pripravljena za izposojo" />
        <StatCard label="Izposojeno" value={stats.izposojeno} icon={UserCheck} tone="amber" hint="pri monterjih na terenu" />
        <StatCard label="V servisu" value={stats.servis} icon={Cog} hint="v popravilu / kalibraciji" />
        <StatCard label="Pokvarjeno" value={stats.pokvarjeno} icon={XCircle} tone={stats.pokvarjeno > 0 ? 'red' : 'default'} hint={stats.poteklo > 0 ? `${stats.poteklo} s poteklo umeritvijo` : 'roki umeritev v redu'} />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči po kodi, imenu, serijski, lokaciji …" className="pl-8" aria-label="Iskanje orodij" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Filter statusa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni orodij" desc="Spremenite filter ali dodajte novo orodje v orodjarino." icon={Wrench} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((e) => {
            const sm = statusMeta(e.status)
            const isHolder = e.holder?.id === user?.id
            const canReturn = e.status === 'IZPOSOJENO' && (isHolder || isAdmin)
            const busy = busyId === e.id
            return (
              <Card key={e.id} className="min-w-0 transition-shadow hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setHistoryFor(e)}
                        className="font-mono text-xs font-bold text-roksal-amber underline-offset-2 hover:underline"
                        aria-label={`Zgodovina izposoj — ${e.code}`}
                      >
                        {e.code}
                      </button>
                      <p className="truncate font-medium text-foreground" title={e.name}>{e.name}</p>
                    </div>
                    <Badge variant="secondary" className={`shrink-0 border-transparent font-medium ${sm.cls}`}>{sm.label}</Badge>
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">{catLabel(e.category)}</Badge>
                      {e.serialNumber ? <span className="font-mono">S/N {e.serialNumber}</span> : null}
                    </div>
                    {e.location ? (
                      <p className="flex items-start gap-1 truncate"><MapPin className="mt-0.5 size-3 shrink-0" aria-hidden /><span className="truncate">{e.location}</span></p>
                    ) : null}
                    {e.status === 'IZPOSOJENO' && e.holder ? (
                      <p className="font-medium text-foreground">Izposojeno: {e.holder.name}</p>
                    ) : null}
                    {e.note ? <p className="line-clamp-2 italic">{e.note}</p> : null}
                  </div>

                  <div className="mt-auto space-y-2">
                    <CalibrationTag due={e.calibrationDue} />
                    <div className="flex flex-wrap gap-2">
                      {e.status === 'NA_VOLJO' ? (
                        <Button size="sm" className="min-h-11" disabled={busy} onClick={() => setCheckoutFor(e)}>
                          <UserCheck className="size-4" aria-hidden /> Izposoji
                        </Button>
                      ) : null}
                      {canReturn ? (
                        <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => void runAction(e, 'return')}>
                          Vrni
                        </Button>
                      ) : null}
                      {isAdmin && e.status !== 'V_SERVISU' && e.status !== 'POKVARJENO' ? (
                        <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => setServiceFor(e)}>
                          <Cog className="size-4" aria-hidden /> V servis
                        </Button>
                      ) : null}
                      {isAdmin && e.status !== 'POKVARJENO' ? (
                        <Button size="sm" variant="outline" className="min-h-11 text-red-600 dark:text-red-400" disabled={busy} onClick={() => void runAction(e, 'broken')}>
                          <XCircle className="size-4" aria-hidden /> Pokvarjeno
                        </Button>
                      ) : null}
                      {isAdmin && (e.status === 'POKVARJENO' || e.status === 'V_SERVISU') ? (
                        <Button size="sm" variant="outline" className="min-h-11 text-emerald-600 dark:text-emerald-400" disabled={busy} onClick={() => void runAction(e, 'repair')}>
                          Popravljeno
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="min-h-11 px-2" onClick={() => setHistoryFor(e)} aria-label={`Zgodovina izposoj orodja ${e.code}`}>
                        <History className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only sm:ml-1">Zgodovina</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* zgodovina izposoj */}
      <Dialog open={!!historyFor} onOpenChange={(o) => { if (!o) setHistoryFor(null) }}>
        <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {history.loading ? (
            <>
              <DialogHeader><DialogTitle className="sr-only">Nalaganje zgodovine izposoj</DialogTitle></DialogHeader>
              <LoadingRows rows={3} />
            </>
          ) : history.data ? (
            <HistoryDialog detail={history.data.data} />
          ) : (
            <>
              <DialogHeader><DialogTitle>Napaka</DialogTitle></DialogHeader>
              <ErrorBox error={history.error} />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* izposoja */}
      <Dialog open={!!checkoutFor} onOpenChange={(o) => { if (!o) setCheckoutFor(null) }}>
        {checkoutFor ? (
          <CheckoutDialog
            equip={checkoutFor}
            userName={user?.name ?? ''}
            onClose={() => setCheckoutFor(null)}
            onDone={async () => {
              setCheckoutFor(null)
              await list.reload()
            }}
          />
        ) : null}
      </Dialog>

      {/* v servis */}
      <Dialog open={!!serviceFor} onOpenChange={(o) => { if (!o) setServiceFor(null) }}>
        {serviceFor ? (
          <ServiceDialog
            equip={serviceFor}
            onClose={() => setServiceFor(null)}
            onDone={async () => {
              setServiceFor(null)
              await list.reload()
            }}
          />
        ) : null}
      </Dialog>

      {/* novo orodje */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {createOpen ? (
          <NewEquipmentDialog
            onClose={() => setCreateOpen(false)}
            onCreated={async (code) => {
              setCreateOpen(false)
              toast({ title: `Orodje ${code} dodano v orodjarino.` })
              await list.reload()
            }}
          />
        ) : null}
      </Dialog>
    </div>
  )
}

const ACTION_LABELS: Record<string, string> = {
  checkout: 'izposoja zabeležena',
  return: 'vrnjeno v orodjarino',
  service: 'poslano v servis',
  broken: 'označeno kot pokvarjeno',
  repair: 'označeno kot popravljeno',
}

function HistoryDialog ({ detail }: { detail: EquipDetail }) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-roksal-amber">{detail.code}</span>
          <Badge variant="secondary" className={`border-transparent font-medium ${statusMeta(detail.status).cls}`}>{statusMeta(detail.status).label}</Badge>
        </div>
        <DialogTitle>Zgodovina izposoj — {detail.code}</DialogTitle>
        <DialogDescription>{detail.name}</DialogDescription>
      </DialogHeader>
      {detail.checkouts.length === 0 ? (
        <EmptyState title="Ni izposoj" desc="To orodje še ni bilo izposojeno." icon={History} />
      ) : (
        <AnimatedList className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {detail.checkouts.map((c) => (
            <AnimatedListItem key={c.id} className={`rounded-xl border p-3 text-sm ${c.inAt ? '' : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.user?.name ?? 'Neznan uporabnik'}</span>
                <span className={`text-xs font-semibold ${c.inAt ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'}`}>
                  {c.inAt ? 'Vrnjeno' : 'V izposoji'}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {fmtDateTime(c.outAt)} → {c.inAt ? fmtDateTime(c.inAt) : 'še ni vrnjeno'}
              </div>
              {c.note ? <p className="mt-1 text-xs italic text-muted-foreground">{c.note}</p> : null}
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}
    </>
  )
}

function CheckoutDialog ({ equip, userName, onClose, onDone }: {
  equip: EquipRow
  userName: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    setBusy(true)
    try {
      await apiPatch(`/api/equipment/${equip.id}`, { action: 'checkout', note: note || undefined })
      toast({ title: `Orodje ${equip.code} izposojeno.`, description: `Izposojil: ${userName}` })
      await onDone()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Izposoji — {equip.code}</DialogTitle>
        <DialogDescription>
          {equip.name} · izposoja se zapiše na vaše ime ({userName}). Ob vrnitvi orodje oddajte nazaj v orodjarino.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="co-note">Opomba (namen izposoje)</Label>
        <Input id="co-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. Terenski dan — terasa Novak" />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Zapisujem…' : 'Potrdi izposojo'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

function ServiceDialog ({ equip, onClose, onDone }: {
  equip: EquipRow
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  const [note, setNote] = useState('')
  const [location, setLocation] = useState(equip.location ?? '')
  const [busy, setBusy] = useState(false)

  async function submit () {
    setBusy(true)
    try {
      await apiPatch(`/api/equipment/${equip.id}`, { action: 'service', note: note || undefined, location: location || undefined })
      toast({ title: `Orodje ${equip.code} je v servisu.` })
      await onDone()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>V servis — {equip.code}</DialogTitle>
        <DialogDescription>
          {equip.name}
          {equip.status === 'IZPOSOJENO' ? ' — odprta izposoja se samodejno zapre.' : ''}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="svc-note">Opomba servisa</Label>
          <Input id="svc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. Zamenjava ležaja, prihodnji teden" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="svc-loc">Lokacija (kje je orodje)</Label>
          <Input id="svc-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="npr. Servis — d.o.o. Elektro Celje" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Pošiljam…' : 'Pošlji v servis'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

function NewEquipmentDialog ({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (code: string) => Promise<void>
}) {
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('MERITEV')
  const [serialNumber, setSerialNumber] = useState('')
  const [location, setLocation] = useState('')
  const [calibrationDue, setCalibrationDue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    if (!code.trim() || !name.trim()) {
      toast({ title: 'Koda in ime orodja sta obvezna.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: EquipRow }>('/api/equipment', {
        code, name, category,
        serialNumber: serialNumber || undefined,
        location: location || undefined,
        calibrationDue: calibrationDue || undefined,
        note: note || undefined,
      })
      await onCreated(res.data.code)
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Novo orodje</DialogTitle>
        <DialogDescription>Vpis novega orodja v orodjarino (koda mora biti enolična).</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="eq-code">Koda *</Label>
          <Input id="eq-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="npr. OR-008" className="font-mono" />
        </div>
        <div className="space-y-2">
          <Label>Kategorija</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label="Kategorija orodja"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="eq-name">Ime *</Label>
          <Input id="eq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Laserski daljinomer Leica DISTO D2" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="eq-sn">Serijska številka</Label>
          <Input id="eq-sn" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="npr. LD2-88412" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="eq-cal">Rok umeritve</Label>
          <Input id="eq-cal" type="date" value={calibrationDue} onChange={(e) => setCalibrationDue(e.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="eq-loc">Lokacija</Label>
          <Input id="eq-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="npr. Skladišče — polica A1" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="eq-note">Opomba</Label>
          <Input id="eq-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opomba za ekipo …" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Dodajam…' : 'Dodaj orodje'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

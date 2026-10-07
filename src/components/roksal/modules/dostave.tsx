'use client'

// DOSTAVE — R445 (issue #7 §9, P1 DELIVERY + INSTALLATION).
// Zavihki: DOSTAVE (tok NAČRTOVANO → PRIPRAVLJENO → NATOVARJENO → NA_POTI → DOSTAVLJENO)
//          · VOZILA · EKIPE IN PODIZVAJALCI.
// Vrata: projects.read (pogled — monter vidi SAMO svoje dostave, kar določa API),
//        projects.write (pisarna: ustvarjanje/urejanje — strežnik dodatno zahteva
//        obseg readsAllData, tako da monterjev terenski projects.read/write tu ne zadostiva),
//        load/depart/deliver lahko izvede tudi VOZNIK dostave (strežnik preverja).
// OPOMBA (IA): zavihek je v sekciji PISARNA; ciljna IA §11 (sekcija OPERATIVA) pride
//        s poznejšo restrukturacijo navigacije.

import { useMemo, useState } from 'react'
import {
  CalendarClock, CarFront, CheckCircle2, ClipboardList, HardHat, Mail, MapPin, Package,
  Pencil, Phone, Plus, Star, Truck, User, Users, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { CREW_TYPES } from '@/lib/crew-core'

// ─── tipi (odgovori API-jev) ──────────────────────────────────────────────────

interface DeliveryItemRow {
  id: string; itemId: string | null; description: string; qty: number; unit: string; note: string | null
  item: { id: string; sku: string; name: string; unit: string } | null
}

interface DeliveryRow {
  id: string; code: string; status: string
  projectId: string | null
  project: { id: string; code: string; title: string; address: string | null } | null
  vehicle: { id: string; plate: string; name: string } | null
  driver: { id: string; name: string } | null
  pickingList: { id: string; code: string; status: string } | null
  workOrder: { id: string; code: string; title: string; scheduledFor: string | null; assigneeId: string | null } | null
  plannedAt: string | null; loadedAt: string | null; departedAt: string | null; deliveredAt: string | null
  address: string | null; recipientNote: string | null; note: string | null
  items: DeliveryItemRow[]
}

interface VehicleRow {
  id: string; plate: string; name: string; capacityNote: string | null; active: boolean
  _count: { deliveries: number }
}

interface CrewRow {
  id: string; name: string; type: string; region: string | null
  contactName: string | null; contactPhone: string | null; contactEmail: string | null
  workTypes: string | null; availabilityNote: string | null; priceNote: string | null
  rating: number | null; active: boolean; note: string | null
  _count: { workOrders: number }
}

interface ProjectOption { id: string; code: string; title: string; address?: string | null }

interface PickingOption {
  id: string; code: string; status: string
  bom: { code: string; package: { code: string; name: string; project: { code: string; title: string } | null } | null } | null
}

interface NalogOption {
  id: string; code: string; title: string; status: string; scheduledFor: string | null
  project: { code: string; title: string } | null
}

interface UserOption { id: string; name: string; role: string; active: boolean }

const DELIVERY_STATUSI: { v: string; l: string }[] = [
  { v: 'NACRTOVANO', l: 'Načrtovano' },
  { v: 'PRIPRAVLJENO', l: 'Pripravljeno' },
  { v: 'NATOVARJENO', l: 'Natovorjeno' },
  { v: 'NA_POTI', l: 'Na poti' },
  { v: 'DOSTAVLJENO', l: 'Dostavljeno' },
  { v: 'PREKLICANA', l: 'Preklicana' },
]

const ACTION_LABELS: Record<string, string> = {
  prepare: 'Pripravljeno',
  load: 'Natovorjeno',
  depart: 'Na poti',
  deliver: 'Dostavljeno',
  cancel: 'Preklicana',
}

/** Pisarna v UI: projects.write + vloga z obsegom vodenja (strežnik je tisti, ki RES preverja). */
function isOffice (user: { role: string; perms: string[] } | null): boolean {
  if (!user) return false
  return user.role !== 'MONTER' && hasPerm(user.perms, 'projects.write')
}

export default function DostaveModule () {
  const [tab, setTab] = useState('dostave')
  return (
    <div className="space-y-4">
      <PageHeader
        title="Dostave"
        desc="Dostave, vozila in ekipe — tok načrtovano → pripravljeno → natovorjeno → na poti → dostavljeno (issue #7 §9)"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="dostave"><Truck className="mr-1.5 size-4" aria-hidden /> Dostave</TabsTrigger>
          <TabsTrigger value="vozila"><CarFront className="mr-1.5 size-4" aria-hidden /> Vozila</TabsTrigger>
          <TabsTrigger value="ekipe"><Users className="mr-1.5 size-4" aria-hidden /> Ekipe in podizvajalci</TabsTrigger>
        </TabsList>
        <TabsContent value="dostave" className="mt-4"><DostaveTab /></TabsContent>
        <TabsContent value="vozila" className="mt-4"><VozilaTab /></TabsContent>
        <TabsContent value="ekipe" className="mt-4"><EkipeTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ─── ZAVIHEK: dostave ─────────────────────────────────────────────────────────

function DostaveTab () {
  const user = useAppStore((s) => s.user)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const deliveries = useApi<{ data: DeliveryRow[] }>(`/api/deliveries${status !== 'all' ? `?status=${status}` : ''}`, [status])
  const office = isOffice(user)
  const rows = deliveries.data?.data ?? []
  const activeCount = rows.filter((d) => !['DOSTAVLJENO', 'PREKLICANA'].includes(d.status)).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Filter statusa dostave"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vsi statusi</SelectItem>
            {DELIVERY_STATUSI.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">
          {rows.length} dostav{activeCount > 0 ? ` · ${activeCount} aktivnih` : ''}
        </Badge>
        {office ? (
          <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nova dostava
          </Button>
        ) : null}
      </div>

      <ErrorBox error={deliveries.error} />
      {deliveries.loading ? <LoadingRows /> : !deliveries.error && rows.length === 0 ? (
        <EmptyState
          title="Ni dostav"
          desc={status !== 'all' ? 'Za izbrani status ni dostav.' : 'Pisarna ustvari dostavo iz zaključene picking liste ali ročno z naslovom.'}
          icon={Truck}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((d) => (
            <li key={d.id}>
              <Card className="transition hover:border-roksal-amber/60">
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{d.code}</span>
                    <StatusBadge status={d.status} />
                    <span className="ml-auto text-xs text-muted-foreground">{d.items.length} vrstic</span>
                  </div>
                  <div className="text-sm font-semibold leading-snug">
                    {d.project ? <>{d.project.code} — {d.project.title}</> : 'Brez projekta'}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {d.plannedAt ? <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" aria-hidden /> {fmtDateTime(d.plannedAt)}</span> : null}
                    {d.vehicle ? <span className="inline-flex items-center gap-1"><CarFront className="size-3" aria-hidden /> {d.vehicle.plate}</span> : null}
                    {d.driver ? <span className="inline-flex items-center gap-1"><User className="size-3" aria-hidden /> {d.driver.name}</span> : null}
                    {d.pickingList ? <span className="inline-flex items-center gap-1"><ClipboardList className="size-3" aria-hidden /> {d.pickingList.code}</span> : null}
                    {d.workOrder ? <span className="inline-flex items-center gap-1"><HardHat className="size-3" aria-hidden /> {d.workOrder.code}</span> : null}
                  </div>
                  {d.address ? <div className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" aria-hidden /> {d.address}</div> : null}
                  <Button variant="outline" size="sm" className="mt-1 min-h-11" onClick={() => setSelected(d.id)}>
                    Podrobnosti in prehodi
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DeliveryDetailDialog
          id={selected}
          onClose={() => setSelected(null)}
          onDone={async () => { await deliveries.reload() }}
        />
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewDeliveryDialog
          key={String(createOpen)} /* remount ob vsakem odprtju — sveža forma */
          onClose={() => setCreateOpen(false)}
          onDone={async () => { await deliveries.reload() }}
        />
      </Dialog>
    </div>
  )
}

// ─── podrobnost dostave + prehodi ────────────────────────────────────────────

function DeliveryDetailDialog ({ id, onClose, onDone }: { id: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const detail = useApi<{ data: DeliveryRow }>(id ? `/api/deliveries/${id}` : null, [id])
  const [busy, setBusy] = useState('')
  const [recipientNote, setRecipientNote] = useState('')
  const [cancelNote, setCancelNote] = useState('')

  // plan (samo pisarna) — dopolnitev vozila/voznika/časa/naslova
  const vehicles = useApi<{ data: VehicleRow[] }>(id ? '/api/vehicles?all=1' : null, [id])
  const users = useApi<{ data: UserOption[] }>(id ? '/api/users' : null, [id])
  const [planOpen, setPlanOpen] = useState(false)
  const [planVehicle, setPlanVehicle] = useState('')
  const [planDriver, setPlanDriver] = useState('')
  const [planAt, setPlanAt] = useState('')
  const [planAddress, setPlanAddress] = useState('')

  const d = detail.data?.data
  const office = isOffice(user)
  const isDriver = !!d && !!user && d.driver?.id === user.id
  const canTransit = office || isDriver

  async function transition (action: string, extra?: Record<string, unknown>) {
    if (!d) return
    setBusy(action)
    try {
      await apiPatch(`/api/deliveries/${d.id}`, { action, ...extra })
      toast({ title: 'Prehod uspel.', description: `${d.code}: ${ACTION_LABELS[action] ?? action}` })
      setRecipientNote('')
      setCancelNote('')
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Prehod ni uspel', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy('') }
  }

  async function submitPlan () {
    if (!d) return
    setBusy('plan')
    try {
      const body: Record<string, unknown> = {}
      if (planVehicle !== '') body.vehicleId = planVehicle
      if (planDriver !== '') body.driverId = planDriver
      if (planAt) body.plannedAt = new Date(planAt).toISOString()
      if (planAddress.trim()) body.address = planAddress.trim()
      if (Object.keys(body).length === 0) {
        toast({ title: 'Ni sprememb za izvedbo.', variant: 'destructive' })
        return
      }
      await apiPatch(`/api/deliveries/${d.id}`, { action: 'plan', ...body })
      toast({ title: 'Načrt dopolnjen.', description: `${d.code}: vozilo/voznik/termin posodobljeni.` })
      setPlanOpen(false)
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Dopolnitev načrta ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy('') }
  }

  if (!d) {
    return (
      <DialogContent className="sm:max-w-lg">
        {/* dostopnost: tudi med nalaganjem/napako (Radix opozori na manjkajoči opis) */}
        <DialogHeader>
          <DialogTitle>Dostava</DialogTitle>
          <DialogDescription className="sr-only">Podrobnosti dostave in prehodi.</DialogDescription>
        </DialogHeader>
        {detail.loading ? <LoadingRows rows={2} /> : <ErrorBox error={detail.error ?? { message: 'Dostava ni na voljo.' }} />}
      </DialogContent>
    )
  }

  const casovnica: { l: string; v: string | null }[] = [
    { l: 'Načrtovano', v: d.plannedAt },
    { l: 'Natovorjeno', v: d.loadedAt },
    { l: 'Odhod', v: d.departedAt },
    { l: 'Dostavljeno', v: d.deliveredAt },
  ]

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-roksal-amber">{d.code}</span>
          <StatusBadge status={d.status} />
        </DialogTitle>
        <DialogDescription>
          {d.project ? `${d.project.code} — ${d.project.title}` : 'Brez projekta'}
          {d.address ? ` · ${d.address}` : ''}
        </DialogDescription>
      </DialogHeader>

      {/* povezave: projekt, picking, nalog, vozilo, voznik */}
      <div className="flex flex-wrap gap-1.5">
        {d.pickingList ? <Badge variant="secondary" className="border-transparent bg-secondary text-[11px] text-secondary-foreground"><ClipboardList className="mr-1 size-3" aria-hidden /> picking {d.pickingList.code} ({d.pickingList.status})</Badge> : null}
        {d.workOrder ? <Badge variant="secondary" className="border-transparent bg-secondary text-[11px] text-secondary-foreground"><HardHat className="mr-1 size-3" aria-hidden /> nalog {d.workOrder.code}{d.workOrder.scheduledFor ? ` · ${fmtDateTime(d.workOrder.scheduledFor)}` : ''}</Badge> : null}
        {d.vehicle ? <Badge variant="secondary" className="border-transparent bg-secondary text-[11px] text-secondary-foreground"><CarFront className="mr-1 size-3" aria-hidden /> {d.vehicle.plate} — {d.vehicle.name}</Badge> : null}
        {d.driver ? <Badge variant="secondary" className="border-transparent bg-secondary text-[11px] text-secondary-foreground"><User className="mr-1 size-3" aria-hidden /> {d.driver.name}</Badge> : null}
      </div>

      {/* časovnica */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border bg-secondary/30 p-3 text-xs sm:grid-cols-4">
        {casovnica.map((c) => (
          <div key={c.l}>
            <div className="font-semibold uppercase tracking-wide text-muted-foreground">{c.l}</div>
            <div className="font-medium">{c.v ? fmtDateTime(c.v) : '—'}</div>
          </div>
        ))}
      </div>

      {/* vrstice dostave */}
      <section aria-label="Vrstice dostave">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Material ({d.items.length})</h3>
        {d.items.length === 0 ? (
          <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            Dostava je brez vrstic — nastala je brez picking liste (ročna dostava).
          </p>
        ) : (
          <Card>
            <CardContent className="max-h-64 overflow-y-auto p-0">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="pl-4">Artikel</TableHead>
                    <TableHead className="text-right pr-4">Količina</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="pl-4">
                        <div className="font-medium">{it.description}</div>
                        {it.item ? <div className="font-mono text-[11px] text-muted-foreground">{it.item.sku}</div> : <div className="text-[11px] text-muted-foreground">brez artikla</div>}
                        {it.note ? <div className="text-[11px] text-muted-foreground">{it.note}</div> : null}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-bold">{it.qty} <span className="text-xs font-normal text-muted-foreground">{it.unit}</span></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {d.note ? <p className="rounded-xl border bg-secondary/40 p-3 text-xs text-muted-foreground">{d.note}</p> : null}
      {d.recipientNote ? (
        <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> Prevzemnik: {d.recipientNote}
        </p>
      ) : null}

      {/* akcije glede na status + pravice */}
      <div className="flex flex-wrap gap-2 pt-1">
        {office && ['NACRTOVANO', 'PRIPRAVLJENO'].includes(d.status) ? (
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => {
            setPlanVehicle(d.vehicle?.id ?? '')
            setPlanDriver(d.driver?.id ?? '')
            setPlanAt(d.plannedAt ? new Date(d.plannedAt).toISOString().slice(0, 16) : '')
            setPlanAddress(d.address ?? '')
            setPlanOpen((v) => !v)
          }}>
            <Pencil className="size-4" aria-hidden /> Dopolni načrt
          </Button>
        ) : null}
        {office && d.status === 'NACRTOVANO' ? (
          <Button size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('prepare')}>
            <Package className="size-4" aria-hidden /> Pripravi
          </Button>
        ) : null}
        {canTransit && d.status === 'PRIPRAVLJENO' ? (
          <Button size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('load')}>
            <Truck className="size-4" aria-hidden /> Natovari
          </Button>
        ) : null}
        {canTransit && d.status === 'NATOVARJENO' ? (
          <Button size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('depart')}>
            <Truck className="size-4" aria-hidden /> Na pot
          </Button>
        ) : null}
        {canTransit && d.status === 'NA_POTI' ? (
          <Button size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('deliver', recipientNote.trim() ? { recipientNote: recipientNote.trim() } : undefined)}>
            <CheckCircle2 className="size-4" aria-hidden /> Dostavljeno
          </Button>
        ) : null}
        {office && ['NACRTOVANO', 'PRIPRAVLJENO', 'NATOVARJENO'].includes(d.status) ? (
          <Button variant="destructive" size="sm" className="min-h-11" disabled={busy !== ''} onClick={() => transition('cancel', cancelNote.trim() ? { note: cancelNote.trim() } : undefined)}>
            <XCircle className="size-4" aria-hidden /> Prekliči
          </Button>
        ) : null}
      </div>

      {canTransit && d.status === 'NA_POTI' ? (
        <div className="space-y-1.5">
          <Label htmlFor="recipientNote">Prevzemnik / podpis na mestu (opcijsko)</Label>
          <Input id="recipientNote" value={recipientNote} onChange={(e) => setRecipientNote(e.target.value)} placeholder="npr. Prevzel g. Novak ob 14:05" />
        </div>
      ) : null}
      {office && ['NACRTOVANO', 'PRIPRAVLJENO', 'NATOVARJENO'].includes(d.status) ? (
        <div className="space-y-1.5">
          <Label htmlFor="cancelNote">Razlog preklica (opcijsko)</Label>
          <Input id="cancelNote" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder="npr. Stranka je prestavila termin" />
        </div>
      ) : null}

      {/* plan forma (zložljiva) */}
      {planOpen && office ? (
        <section aria-label="Dopolnitev načrta" className="space-y-3 rounded-xl border p-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Dopolni načrt</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="planVehicle">Vozilo</Label>
              <Select value={planVehicle} onValueChange={setPlanVehicle}>
                <SelectTrigger id="planVehicle" className="min-h-11"><SelectValue placeholder="Brez vozila" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez vozila</SelectItem>
                  {(vehicles.data?.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.plate} — {v.name}{v.active ? '' : ' (neaktivno)'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planDriver">Voznik / odgovorna oseba</Label>
              <Select value={planDriver} onValueChange={setPlanDriver}>
                <SelectTrigger id="planDriver" className="min-h-11"><SelectValue placeholder="Brez voznika" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez voznika</SelectItem>
                  {(users.data?.data ?? []).filter((u) => u.active).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planAt">Načrtovani čas dostave</Label>
              <Input id="planAt" type="datetime-local" className="min-h-11" value={planAt} onChange={(e) => setPlanAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planAddress">Naslov dostave</Label>
              <Input id="planAddress" value={planAddress} onChange={(e) => setPlanAddress(e.target.value)} placeholder="Ulica in kraj" />
            </div>
          </div>
          <Button size="sm" disabled={busy !== ''} onClick={submitPlan}>
            {busy === 'plan' ? 'Shranjujem …' : 'Shrani načrt'}
          </Button>
        </section>
      ) : null}

      {!canTransit && !['DOSTAVLJENO', 'PREKLICANA'].includes(d.status) ? (
        <p className="text-xs text-muted-foreground">
          Prehode (natovarjanje, odhod, dostava) lahko izvede pisarna ali dodeljeni voznik dostave.
        </p>
      ) : null}
    </DialogContent>
  )
}

// ─── nova dostava (pisarna) ───────────────────────────────────────────────────

function NewDeliveryDialog ({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const projects = useApi<{ data: ProjectOption[] }>('/api/projects?limit=200', [])
  const picking = useApi<{ data: PickingOption[] }>('/api/picking?status=ZAKLJUCENA&limit=200', [])

  const [projectId, setProjectId] = useState('')
  const [pickingListId, setPickingListId] = useState('')
  const [workOrderId, setWorkOrderId] = useState('')
  const [plannedAt, setPlannedAt] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const nalogi = useApi<{ data: NalogOption[] }>(projectId ? `/api/nalog?projectId=${projectId}` : null, [projectId])

  // zaključene picking liste IZBRANEGA projekta (povezava teče prek BOM → paket → projekt)
  const projectPicks = useMemo(() => {
    const all = picking.data?.data ?? []
    const proj = (projects.data?.data ?? []).find((p) => p.id === projectId)
    if (!proj) return all
    return all.filter((p) => p.bom?.package?.project?.code === proj.code)
  }, [picking.data, projects.data, projectId])

  async function submit () {
    setBusy(true)
    try {
      const body: Record<string, unknown> = {}
      if (projectId) body.projectId = projectId
      if (pickingListId) body.pickingListId = pickingListId
      if (workOrderId) body.workOrderId = workOrderId
      if (plannedAt) body.plannedAt = new Date(plannedAt).toISOString()
      if (address.trim()) body.address = address.trim()
      if (note.trim()) body.note = note.trim()
      const res = await apiPost<{ data: DeliveryRow }>('/api/deliveries', body)
      toast({
        title: 'Dostava ustvarjena.',
        description: `${res.data.code} — ${res.data.items.length} vrstic${res.data.pickingList ? ` (iz ${res.data.pickingList.code})` : ''}.`,
      })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Ustvarjanje dostave ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Nova dostava</DialogTitle>
        <DialogDescription>
          Vrstice se kopirajo iz zaključene picking liste (s pobranimi količinami in artikelom) — dostava pa se lahko veže tudi na montažni termin.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="nd-project">Projekt</Label>
          <Select value={projectId} onValueChange={(v) => { setProjectId(v === 'none' ? '' : v); setPickingListId(''); setWorkOrderId('') }}>
            <SelectTrigger id="nd-project" className="min-h-11"><SelectValue placeholder="Brez projekta" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez projekta</SelectItem>
              {(projects.data?.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-picking">Picking lista (samo zaključene{projectId ? ' tega projekta' : ''})</Label>
          <Select value={pickingListId} onValueChange={(v) => setPickingListId(v === 'none' ? '' : v)}>
            <SelectTrigger id="nd-picking" className="min-h-11"><SelectValue placeholder="Brez picking liste" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez picking liste (prazna dostava)</SelectItem>
              {projectPicks.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.code}{p.bom?.package ? ` — ${p.bom.package.name}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-wo">Montažni termin (nalog)</Label>
          <Select value={workOrderId} onValueChange={(v) => setWorkOrderId(v === 'none' ? '' : v)} disabled={!projectId || (nalogi.data?.data.length ?? 0) === 0}>
            <SelectTrigger id="nd-wo" className="min-h-11"><SelectValue placeholder={projectId ? 'Brez vezave na nalog' : 'Najprej izberite projekt'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez vezave na nalog</SelectItem>
              {(nalogi.data?.data ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.code} — {w.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-at">Načrtovani čas dostave</Label>
          <Input id="nd-at" type="datetime-local" className="min-h-11" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-address">Naslov dostave</Label>
          <Input id="nd-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ulica in kraj" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nd-note">Opomba</Label>
          <Textarea id="nd-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Navodila vozniku, kontakt prevzemnika …" rows={2} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button disabled={busy} onClick={submit}>{busy ? 'Ustvarjam …' : 'Ustvari dostavo'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

// ─── ZAVIHEK: vozila ──────────────────────────────────────────────────────────

function VozilaTab () {
  const user = useAppStore((s) => s.user)
  const vehicles = useApi<{ data: VehicleRow[] }>('/api/vehicles?all=1')
  const [addOpen, setAddOpen] = useState(false)
  const canWrite = isOffice(user)
  const rows = vehicles.data?.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">{rows.length} vozil</Badge>
        {canWrite ? (
          <Button size="sm" className="ml-auto" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden /> Dodaj vozilo
          </Button>
        ) : null}
      </div>
      <ErrorBox error={vehicles.error} />
      {vehicles.loading ? <LoadingRows /> : !vehicles.error && rows.length === 0 ? (
        <EmptyState title="Ni vozil" desc="Dodajte prvo dostavno vozilo (registrska, ime, nosilnost)." icon={CarFront} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((v) => (
            <li key={v.id}>
              <Card className="h-full transition hover:border-roksal-amber/60">
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold text-roksal-amber">{v.plate}</span>
                    {v.active
                      ? <Badge variant="secondary" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">aktivno</Badge>
                      : <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">neaktivno</Badge>}
                  </div>
                  <div className="text-sm font-semibold leading-snug">{v.name}</div>
                  {v.capacityNote ? <div className="text-xs text-muted-foreground">{v.capacityNote}</div> : null}
                  <div className="text-xs text-muted-foreground">{v._count.deliveries} dostav</div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <VehicleDialog
          key={String(addOpen)} /* remount ob vsakem odprtju — sveža forma */
          onClose={() => setAddOpen(false)}
          onDone={async () => { await vehicles.reload() }}
        />
      </Dialog>
    </div>
  )
}

function VehicleDialog ({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const [plate, setPlate] = useState('')
  const [name, setName] = useState('')
  const [capacityNote, setCapacityNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    setBusy(true)
    try {
      await apiPost('/api/vehicles', {
        plate: plate.trim(),
        name: name.trim(),
        capacityNote: capacityNote.trim() || undefined,
      })
      toast({ title: 'Vozilo dodano.', description: `${plate.trim()} — ${name.trim()}` })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Dodajanje vozila ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Novo vozilo</DialogTitle>
        <DialogDescription>Registrska oznaka je unikatna — ponovni vnos vrne napako.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="veh-plate">Registrska oznaka *</Label>
          <Input id="veh-plate" className="min-h-11" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="npr. LJ 123-AB" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="veh-name">Ime / opis *</Label>
          <Input id="veh-name" className="min-h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Fiat Ducato — odprt" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="veh-cap">Nosilnost / prostor</Label>
          <Input id="veh-cap" className="min-h-11" value={capacityNote} onChange={(e) => setCapacityNote(e.target.value)} placeholder="npr. ~14 m³, nosilnost 1,2 t" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button disabled={busy || !plate.trim() || !name.trim()} onClick={submit}>{busy ? 'Dodajam …' : 'Dodaj vozilo'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

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

function EkipeTab () {
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

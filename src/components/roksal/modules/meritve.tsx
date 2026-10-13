'use client'

// MERITVE — zajem meritev ograj (vrata measurements.read)
// Seznam s filtrom po tipu + nova meritev (POST /api/measurements) + popravek (PATCH /api/measurements/[id])
// R437: javna deljena povezava meritve (POST/DELETE /api/measurements/[id]/share → /api/public/measure)

import { useMemo, useState } from 'react'
import { Camera, Check, Copy, History, Link2, Loader2, MapPin, Plus, Ruler, Save, Search, ShieldAlert, TrendingUp, Unlink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiDelete, apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { MEASUREMENT_STATUS_LABELS, MEASUREMENT_STATUS_SHORT, measurementStatusAllowsBusiness, type MeasurementStatus } from '@/lib/measure-engine'
import { KameraMeritevDialog } from '@/components/roksal/modules/meritve-kamera'

interface MeasurementRow {
  id: string; type: string; location: string | null
  lengthCm: number | null; heightCm: number | null
  posts: number | null; segments: number | null; handrail: boolean
  slopeDeg: number | null; params: string | null; note: string | null; createdAt: string
  source?: string // ROCNO | KAMERA (večtočkovne meritve na fotografiji)
  status?: string // R501: provenienca — KAKO dobitna je številka (izračuna strežnik)
  statusNote?: string | null // zakaj to stanje (razlog izračuna ali ročnega posega)
  shareToken?: string | null // R437: žeton javne povezave (null = ni deljeno)
  author: { name: string } | null
  project: { code: string; title: string } | null
  workOrder: { code: string; title: string } | null
}

interface VersionRow {
  id: string; version: number; data: string
  note: string | null; createdAt: string
  user: { name: string } | null
}

interface ProjectOption { id: string; code: string; title: string }
interface WorkOrderOption { id: string; code: string; title: string; status: string }

const TYPE_FILTERS = [
  { value: 'all', label: 'Vsi tipi' },
  { value: 'OGRAJA', label: 'Ograja' },
  { value: 'BALUSTRADA', label: 'Balustrada' },
  { value: 'NAGIB', label: 'Nagib' },
  { value: 'FOTO', label: 'Foto' },
  { value: 'OSTANEO', label: 'Ostalo' },
]

const TYPE_BADGES: Record<string, { label: string; cls: string }> = {
  OGRAJA: { label: 'Ograja', cls: 'bg-secondary text-secondary-foreground' },
  BALUSTRADA: { label: 'Balustrada', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  NAGIB: { label: 'Nagib', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  FOTO: { label: 'Foto', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  OSTANEO: { label: 'Ostalo', cls: 'bg-muted text-muted-foreground' },
}

function TypeBadge ({ type }: { type: string }) {
  const t = TYPE_BADGES[type] ?? { label: type, cls: 'bg-muted text-muted-foreground' }
  return <Badge variant="secondary" className={cn('border-transparent font-medium', t.cls)}>{t.label}</Badge>
}

// R501 (issue #15 faza 2): znaczek PROVENIENCE — kako dobitna je številka.
// Ocene/predlogi/razveljavljene mere so rdeče-rumene in NISO poslovna mera;
// dokazane/potrdjene so zeleno-sive. Isti besedi kot v tekaču ogradnje in v
// izvozu (ena lestvica, ne dve).
const STATUS_TONE: Record<string, string> = {
  ESTIMATED: 'bg-muted text-muted-foreground',
  AUTO_SUGGESTED: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  MANUAL: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  CALIBRATED: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  VERIFIED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  CONFIRMED: 'bg-secondary text-secondary-foreground',
  INVALIDATED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
}

function StatusBadge ({ status }: { status?: string | null }) {
  if (!status) return null
  const s = status as MeasurementStatus
  return (
    <Badge
      variant="secondary"
      title={MEASUREMENT_STATUS_LABELS[s] ?? status}
      className={cn('border-transparent px-1.5 py-0 text-[10px] font-medium', STATUS_TONE[s] ?? 'bg-muted text-muted-foreground')}
    >
      {MEASUREMENT_STATUS_SHORT[s] ?? status}
    </Badge>
  )
}

// dolžina v metrih (cm / 100, 2 decimalki)
const fmtM = (cm: number | null | undefined) => (typeof cm === 'number' && cm > 0 ? `${(cm / 100).toFixed(2)} m` : '—')

const numOrNull = (v: string): number | null => {
  if (!v.trim()) return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

export default function MeritveModule () {
  const user = useAppStore((s) => s.user)
  const [type, setType] = useState('all')
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [kameraOpen, setKameraOpen] = useState(false)
  const [editRow, setEditRow] = useState<MeasurementRow | null>(null)

  const list = useApi<{ data: MeasurementRow[] }>(
    `/api/measurements${type !== 'all' ? `?type=${type}` : ''}`,
    [type]
  )

  const canWrite = hasPerm(user?.perms, 'measurements.write')

  const rows = useMemo(() => {
    const all = list.data?.data ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    return all.filter((m) =>
      (m.location ?? '').toLowerCase().includes(needle) ||
      (m.project?.code ?? '').toLowerCase().includes(needle) ||
      (m.workOrder?.code ?? '').toLowerCase().includes(needle) ||
      (m.author?.name ?? '').toLowerCase().includes(needle)
    )
  }, [list.data, q])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Meritve"
        desc="Merjenje ograj po terenu — dolžine, stebri, nagibi"
        actions={canWrite ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setKameraOpen(true)}>
              <Camera className="size-4" aria-hidden /> Meritve s kamero
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden /> Nova meritev
            </Button>
          </>
        ) : null}
      />

      <div className="flex flex-wrap gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40" aria-label="Filter tipa meritve">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Išči po lokaciji, projektu, nalogu, avtorju …" className="pl-8" aria-label="Iskanje meritev" />
        </div>
      </div>

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni meritev" desc="Spremenite filter ali zajemite prvo meritev na terenu." icon={Ruler} />
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="Seznam meritev">
          {rows.map((m) => (
            <button key={m.id} type="button" className="w-full text-left" onClick={() => setEditRow(m)} aria-label={`Odpri meritev ${m.location ?? m.type}`}>
              <Card className="transition hover:border-roksal-amber/60 hover:shadow-sm">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <TypeBadge type={m.type} />
                        <StatusBadge status={m.status} />
                        {m.source === 'KAMERA' ? (
                          <Badge variant="secondary" className="border-transparent bg-violet-100 px-1.5 py-0 text-[10px] font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                            KAMERA
                          </Badge>
                        ) : null}
                        <span className="truncate font-semibold">{m.location ?? 'Brez lokacije'}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {m.project ? <span className="font-mono">{m.project.code}</span> : null}
                        {m.workOrder ? <span className="font-mono">{m.workOrder.code}</span> : null}
                        {m.author ? <span>{m.author.name}</span> : null}
                        <span>{fmtDate(m.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-right text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Ruler className="size-3.5 text-roksal-amber" aria-hidden />
                        <strong className="text-foreground">{fmtM(m.lengthCm)}</strong>
                      </span>
                      {typeof m.posts === 'number' && m.posts > 0 ? <span>stebrov: <strong className="text-foreground">{m.posts}</strong></span> : null}
                      {typeof m.slopeDeg === 'number' ? (
                        <span className="inline-flex items-center gap-1">
                          <TrendingUp className="size-3.5" aria-hidden />
                          <strong className="text-foreground">{m.slopeDeg.toFixed(2)}°</strong>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {m.note ? <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{m.note}</p> : null}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      {/* napredne meritve s kamero (večtočkovne na fotografiji) */}
      <KameraMeritevDialog
        open={kameraOpen}
        onClose={() => setKameraOpen(false)}
        onSaved={() => { void list.reload() }}
      />

      {/* nova meritev */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <MeasurementForm
          mode="create"
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={async () => { setCreateOpen(false); await list.reload() }}
        />
      </Dialog>

      {/* popravek meritve */}
      <Dialog open={!!editRow} onOpenChange={(o) => { if (!o) setEditRow(null) }}>
        {editRow ? (
          <MeasurementForm
            mode="edit"
            open
            initial={editRow}
            onClose={() => setEditRow(null)}
            onSaved={async () => { setEditRow(null); await list.reload() }}
            onRefresh={() => list.reload()}
          />
        ) : null}
      </Dialog>
    </div>
  )
}

// ─── provenienca meritve (R501, issue #15 faza 2) ────────────────────────────
//
// Stanje zaupanja IZRAČUNA strežnik (merilno jedro) — vmesnik ga samo prikaže.
// Pisarna (quotes.approve) ima na voljo dva prehoda: POTRDI (prevzem
// odgovornosti) in RAZVELJAVI (razlog je obvezen). Monterju gumbov ni — sam
// ne more odobriti lastne mere.
function ProvenancePanel ({ initial, onChanged }: {
  initial: MeasurementRow
  onChanged: () => Promise<void>
}) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const canApprove = hasPerm(user?.perms, 'quotes.approve')
  const [status, setStatus] = useState(initial.status ?? 'ESTIMATED')
  const [note, setNote] = useState(initial.statusNote ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const dovoljena = measurementStatusAllowsBusiness(status)

  async function prehod (nov: 'CONFIRMED' | 'INVALIDATED') {
    if (nov === 'INVALIDATED' && reason.trim().length < 3) {
      toast({ title: 'Razveljavitev potrebuje razlog.', description: 'Vpišite, kaj se je spremenilo (npr. «referenčna mera je bila napačna»).', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPatch<{ data: { status: string; statusNote: string | null } }>(
        `/api/measurements/${initial.id}`,
        { status: nov, ...(reason.trim() ? { statusNote: reason.trim() } : {}) }
      )
      setStatus(res.data.status)
      setNote(res.data.statusNote ?? '')
      setReason('')
      toast({
        title: nov === 'CONFIRMED' ? 'Meritev potrjena.' : 'Meritev razveljavljena.',
        description: MEASUREMENT_STATUS_LABELS[res.data.status as MeasurementStatus] ?? res.data.status,
      })
      await onChanged()
    } catch (e) {
      toast({ title: 'Prehod stanja ni uspel', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('space-y-2 rounded-lg border p-2.5', dovoljena ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provenienca mere</span>
        <StatusBadge status={status} />
      </div>
      <p className="text-xs font-medium text-foreground">{MEASUREMENT_STATUS_LABELS[status as MeasurementStatus] ?? status}</p>
      {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      <p className="text-[11px] font-medium">
        {dovoljena
          ? 'Številka je poslovna mera — lahko gre v kosovnico in ponudbo.'
          : 'Ni poslovna mera — kosovnice iz te meritve ni mogoče generirati (strežnik zavrne).'}
      </p>
      {canApprove ? (
        <div className="space-y-2">
          {status !== 'INVALIDATED' ? (
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="razlog (obvezen za razveljavitev)" aria-label="Razlog prehoda stanja" className="h-9" />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {status !== 'CONFIRMED' ? (
              <Button size="sm" variant="outline" className="min-h-9" disabled={busy} onClick={() => void prehod('CONFIRMED')}>
                <Check className="size-3.5" aria-hidden /> Potrdi kot poslovno mero
              </Button>
            ) : null}
            {status !== 'INVALIDATED' ? (
              <Button size="sm" variant="outline" className="min-h-9 text-red-600 hover:text-red-700 dark:text-red-400" disabled={busy} onClick={() => void prehod('INVALIDATED')}>
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ShieldAlert className="size-3.5" aria-hidden />} Razveljavi
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Potrditev prevzame odgovornost za številko; razveljavitev jo umakne iz poslovnih izračunov in zazname povezane pakete.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Potrditev in razveljavitev sta v rokah vodje ali administratorja.</p>
      )}
    </div>
  )
}

// ─── obrazec meritev (ustvari / popravi) ─────────────────────────────────────

interface FormState {
  type: string; location: string; lengthCm: string; heightCm: string
  posts: string; segments: string; handrail: boolean; slopeDeg: string
  note: string; projectId: string; workOrderId: string
}

function MeasurementForm ({ mode, open, initial, onClose, onSaved, onRefresh }: {
  mode: 'create' | 'edit'
  open: boolean
  initial?: MeasurementRow
  onClose: () => void
  onSaved: () => Promise<void>
  onRefresh?: () => Promise<void> // R437: osvežitev seznama brez zapiranja (deljena povezava)
}) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  // R437 — javna deljena povezava (žeton iz seznama; lokalno stanje po akcijah)
  const canWrite = hasPerm(user?.perms, 'measurements.write')
  const [shareToken, setShareToken] = useState<string | null>(initial?.shareToken ?? null)
  const [shareBusy, setShareBusy] = useState(false)
  const [form, setForm] = useState<FormState>({
    type: initial?.type ?? 'OGRAJA',
    location: initial?.location ?? '',
    lengthCm: initial?.lengthCm != null ? String(initial.lengthCm) : '',
    heightCm: initial?.heightCm != null ? String(initial.heightCm) : '',
    posts: initial?.posts != null ? String(initial.posts) : '',
    segments: initial?.segments != null ? String(initial.segments) : '',
    handrail: initial?.handrail ?? true,
    slopeDeg: initial?.slopeDeg != null ? String(initial.slopeDeg) : '',
    note: initial?.note ?? '',
    projectId: 'none',
    workOrderId: 'none',
  })
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  // izbirnike povezav naložimo šele ob odprtju obrazca za nov vnos
  const projects = useApi<{ data: ProjectOption[] }>(open && mode === 'create' ? '/api/projects' : null, [open, mode])
  const orders = useApi<{ data: WorkOrderOption[] }>(open && mode === 'create' ? '/api/nalog?scope=all' : null, [open, mode])
  // zgodovina verzij — samo v načinu popravka (issue #1)
  const verzije = useApi<{ data: VersionRow[] }>(
    open && mode === 'edit' && initial ? `/api/measurements/${initial.id}/verzije` : null,
    [open, mode, initial?.id]
  )

  async function submit () {
    if (!form.location.trim() && !form.note.trim() && form.type !== 'FOTO') {
      toast({ title: 'Vpišite lokacijo merjenja.', description: 'Lokacija pomaga pri nadaljnji izdelavi.', variant: 'destructive' })
      return
    }
    setBusy(true)
    const payload = {
      type: form.type,
      location: form.location.trim() || null,
      lengthCm: numOrNull(form.lengthCm),
      heightCm: numOrNull(form.heightCm),
      posts: numOrNull(form.posts),
      segments: numOrNull(form.segments),
      handrail: form.handrail,
      slopeDeg: numOrNull(form.slopeDeg),
      note: form.note.trim() || null,
      ...(mode === 'create' ? {
        projectId: form.projectId !== 'none' ? form.projectId : null,
        workOrderId: form.workOrderId !== 'none' ? form.workOrderId : null,
      } : {}),
    }
    try {
      if (mode === 'create') {
        await apiPost('/api/measurements', payload)
        toast({ title: 'Meritev shranjena.', description: `${form.type} — ${form.location.trim() || 'brez lokacije'}` })
      } else {
        await apiPatch(`/api/measurements/${initial?.id}`, payload)
        toast({ title: 'Meritev popravljena.' })
      }
      await onSaved()
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju meritve', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  // ── R437: javna deljena povezava meritve ────────────────────────────

  const shareUrl = () =>
    typeof window !== 'undefined' && shareToken
      ? `${window.location.origin}/api/public/measure?token=${shareToken}`
      : ''

  async function generateShare (): Promise<void> {
    if (!initial) return
    setShareBusy(true)
    try {
      const res = await apiPost<{ data: { token: string } }>(`/api/measurements/${initial.id}/share`)
      setShareToken(res.data.token)
      toast({ title: 'Javna povezava ustvarjena.', description: 'Kopirate jo z gumbom Obklonitev povezave.' })
      await onRefresh?.()
    } catch (e) {
      toast({ title: 'Ustvarjanje povezave ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setShareBusy(false)
    }
  }

  async function revokeShare (): Promise<void> {
    if (!initial) return
    setShareBusy(true)
    try {
      await apiDelete(`/api/measurements/${initial.id}/share`)
      setShareToken(null)
      toast({ title: 'Javna povezava preklicana.', description: 'Doslejšnja povezava ne velja več.' })
      await onRefresh?.()
    } catch (e) {
      toast({ title: 'Preklic povezave ni uspel', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setShareBusy(false)
    }
  }

  async function copyShare (): Promise<void> {
    const url = shareUrl()
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'Povezava kopirana.', description: 'Povezavo prilepite stranki (npr. v e-pošto).' })
    } catch {
      toast({ title: 'Kopiranje ni uspelo.', description: url, variant: 'destructive' })
    }
  }

  const typeOptions = mode === 'create'
    ? [{ value: 'OGRAJA', label: 'Ograja' }, { value: 'BALUSTRADA', label: 'Balustrada' }, { value: 'NAGIB', label: 'Nagib' }]
    : [{ value: 'OGRAJA', label: 'Ograja' }, { value: 'BALUSTRADA', label: 'Balustrada' }, { value: 'NAGIB', label: 'Nagib' }, { value: 'FOTO', label: 'Foto' }, { value: 'OSTANEO', label: 'Ostalo' }]

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{mode === 'create' ? 'Nova meritev' : 'Popravek meritve'}</DialogTitle>
        <DialogDescription>
          Dolžine in višine se vnašajo v centimetrih, prikaz pa je v metrih.
          {mode === 'edit' && initial ? ` Zajel ${initial.author?.name ?? '—'} ${fmtDate(initial.createdAt)}.` : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Tip</Label>
            <Select value={form.type} onValueChange={(v) => set('type', v)}>
              <SelectTrigger aria-label="Tip meritve"><SelectValue /></SelectTrigger>
              <SelectContent>
                {typeOptions.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mf-location">Lokacija</Label>
            <Input id="mf-location" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="npr. Terasa — sever" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="mf-length">Dolžina (cm)</Label>
            <Input id="mf-length" type="number" min="0" inputMode="decimal" value={form.lengthCm} onChange={(e) => set('lengthCm', e.target.value)} placeholder="1240" />
            {numOrNull(form.lengthCm) ? <p className="text-[11px] text-muted-foreground">= {fmtM(numOrNull(form.lengthCm))}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mf-height">Višina (cm)</Label>
            <Input id="mf-height" type="number" min="0" inputMode="decimal" value={form.heightCm} onChange={(e) => set('heightCm', e.target.value)} placeholder="110" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mf-posts">Št. stebrov</Label>
            <Input id="mf-posts" type="number" min="0" inputMode="numeric" value={form.posts} onChange={(e) => set('posts', e.target.value)} placeholder="9" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mf-segments">Segmenti</Label>
            <Input id="mf-segments" type="number" min="0" inputMode="numeric" value={form.segments} onChange={(e) => set('segments', e.target.value)} placeholder="4" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="mf-slope">Nagib (°)</Label>
            <Input id="mf-slope" type="number" min="0" step="0.01" inputMode="decimal" value={form.slopeDeg} onChange={(e) => set('slopeDeg', e.target.value)} placeholder="38" />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <Label htmlFor="mf-handrail" className="cursor-pointer">Ročnik</Label>
            <Switch id="mf-handrail" checked={form.handrail} onCheckedChange={(c) => set('handrail', c)} aria-label="Ročnik vključen" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mf-note">Opomba</Label>
          <Textarea id="mf-note" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Opombe s terena …" className="min-h-16" />
        </div>

        {mode === 'create' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Projekt</Label>
              <Select value={form.projectId} onValueChange={(v) => set('projectId', v)}>
                <SelectTrigger aria-label="Povezava na projekt"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  <SelectItem value="none">Brez projekta</SelectItem>
                  {(projects.data?.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ErrorBox error={projects.error} />
            </div>
            <div className="space-y-2">
              <Label>Nalog</Label>
              <Select value={form.workOrderId} onValueChange={(v) => set('workOrderId', v)}>
                <SelectTrigger aria-label="Povezava na nalog"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  <SelectItem value="none">Brez naloga</SelectItem>
                  {(orders.data?.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.code} — {w.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ErrorBox error={orders.error} />
            </div>
          </div>
        ) : null}

        {mode === 'edit' && initial ? <ProvenancePanel initial={initial} onChanged={async () => { await onRefresh?.() }} /> : null}

        {mode === 'edit' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <History className="size-3.5" aria-hidden /> Zgodovina verzij
            </div>
            <ErrorBox error={verzije.error} />
            {verzije.loading ? <LoadingRows rows={2} /> : !verzije.error && (verzije.data?.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Ni še shranjenih verzij.</p>
            ) : (
              <ScrollArea className="max-h-48 rounded-lg border">
                <ul className="divide-y text-xs">
                  {(verzije.data?.data ?? []).map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2">
                      <Badge variant="secondary" className="border-transparent bg-secondary font-mono">v{v.version}</Badge>
                      <span className="font-medium">{v.note ?? 'brez opombe'}</span>
                      <span className="ml-auto text-muted-foreground">
                        {v.user?.name ?? '—'} · {fmtDateTime(v.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
        ) : null}

        {/* R437: javna deljena povezava (measurements.write) — samo v načinu popravka */}
        {mode === 'edit' && canWrite ? (
          <div className="space-y-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Link2 className="size-3.5" aria-hidden /> Javna povezava
            </div>
            {shareToken ? (
              <div className="space-y-2">
                <p className="break-all rounded bg-secondary/60 px-2 py-1.5 font-mono text-[11px] text-muted-foreground" aria-label="URL javne povezave">
                  {shareUrl()}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="min-h-9" onClick={() => void copyShare()}>
                    <Copy className="size-3.5" aria-hidden /> Kopiraj povezavo
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-9 text-red-600 hover:text-red-700 dark:text-red-400" disabled={shareBusy} onClick={() => void revokeShare()}>
                    {shareBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Unlink className="size-3.5" aria-hidden />}
                    Prekliči povezavo
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Povezava je javna (brez prijave) in prikazuje samo mere, lokacijo in projekt — brez internih podatkov.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Meritev ni javno deljena.</p>
                <Button size="sm" variant="outline" className="min-h-9" disabled={shareBusy} onClick={() => void generateShare()}>
                  {shareBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
                  Ustvari povezavo
                </Button>
              </div>
            )}
          </div>
        ) : null}

        <div className="rounded-lg border bg-secondary/40 p-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5" aria-hidden />
            Avtor: <strong className="text-foreground">{user?.name ?? '—'}</strong> (prijavljeni uporabnik)
          </span>
          {mode === 'edit' && initial ? (
            <span className="ml-2">
              Povezava: {initial.project?.code ?? '—'} / {initial.workOrder?.code ?? '—'}
            </span>
          ) : null}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {mode === 'create' ? 'Shrani meritev' : 'Shrani popravek'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

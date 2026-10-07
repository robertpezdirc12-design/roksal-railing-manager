'use client'

// SERVIS — R446 (issue #7 §10, P2 SERVIS: garancije, reklamacije, servis).
// Zavihki: GARANCIJE (obstoječi Warranty/WarrantyVisit tok — R434) · REKLAMACIJE
//          (Claim: NOVA → V_OBRAVNAVI → ZAKLJUCENA/ZAVRNJENA) · SERVIS
//          (ServiceCase: PREVERITEV → ODOBRENA → V_SERVISU → ZAKLJUCEN + obiski).
// Tok iz spec: STRANKA → REKLAMACIJA → PREVERITEV → ODLOČITEV → SERVIS → ZAKLJUČEK.
// Vrata: projects.read (pogled); pisarniške mutacije (nova garancija/reklamacija,
//        odpiranje primera, odločitev, zaključek) → projects.write + readsAllData
//        (strežnik RES preverja — vazen UI); servisni obisk lahko TEHNIK zapiše
//        ZASE (nalog.write), pisarna pa za kogarkoli.
// MONTER: vidi SAMO zavihek Servis s svojimi primeri (brez pisalnih gumbov razen
//        dodaj obisk ZASE) — enak vzorec obsega kot dostave.tsx.
// OPOMBA (IA): zavihek je v sekciji PISARNA; ciljna IA §11 pride v R448.

import { useMemo, useState } from 'react'
import {
  BadgeCheck, Ban, CalendarClock, CheckCircle2, Clock, FileWarning, Hammer, HardHat,
  LifeBuoy, Mail, MessageSquareWarning, Phone, Plus, ShieldCheck, User, Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

// ─── tipi (odgovori API-jev) ──────────────────────────────────────────────────

interface WarrantyRow {
  id: string; projectId: string; startsAt: string; months: number; status: string; note: string | null
  endsAt: string; valid: boolean
  visits: { id: string; date: string; note: string | null; userId: string | null }[]
  nextVisit: { id: string; date: string; note: string | null } | null
  project: { code: string; title: string; status: string; customer: { name: string } | null } | null
}

interface ClaimRow {
  id: string; code: string; customerId: string; projectId: string
  packageId: string | null; warrantyId: string | null
  title: string; desc: string; channel: string; status: string
  reportedBy: string | null; resolutionNote: string | null
  createdAt: string; updatedAt: string
  customer: { id: string; name: string; phone: string | null; email: string | null }
  project: { id: string; code: string; title: string; address: string | null; status: string }
  package: { id: string; code: string; name: string } | null
  warranty: { id: string; startsAt: string; months: number; status: string } | null
  serviceCase: { id: string; code: string; status: string } | null
}

interface VisitRow {
  id: string; caseId: string; date: string; userId: string; note: string; hours: number | null
  user: { id: string; name: string; role: string }
}

interface ServiceCaseRow {
  id: string; code: string; claimId: string | null; projectId: string; warrantyId: string | null
  title: string; desc: string; status: string
  decision: string | null; decisionNote: string | null; decidedById: string | null
  decidedAt: string | null; resolutionNote: string | null; billable: boolean
  createdAt: string; updatedAt: string
  claim: { id: string; code: string; title: string; status: string; channel: string; reportedBy: string | null; customer: { id: string; name: string; phone: string | null } } | null
  project: { id: string; code: string; title: string; address: string | null; status: string }
  warranty: { id: string; startsAt: string; months: number; status: string } | null
  decidedBy: { id: string; name: string } | null
  visits: VisitRow[]
}

interface ProjectOption { id: string; code: string; title: string; status: string; customerId: string | null; customer: { name: string } | null }
interface CustomerOption { id: string; name: string }
interface PackageOption { id: string; code: string; name: string }
interface UserOption { id: string; name: string; role: string; active: boolean }

// ─── oznake ───────────────────────────────────────────────────────────────────

const CLAIM_STATUSI: { v: string; l: string }[] = [
  { v: 'NOVA', l: 'Nova' },
  { v: 'V_OBRAVNAVI', l: 'V obravnavi' },
  { v: 'ZAKLJUCENA', l: 'Zaključena' },
  { v: 'ZAVRNJENA', l: 'Zavrnjena' },
]

const CASE_STATUSI: { v: string; l: string }[] = [
  { v: 'PREVERITEV', l: 'Preveritev' },
  { v: 'ODOBRENA', l: 'Odobrena' },
  { v: 'V_SERVISU', l: 'V servisu' },
  { v: 'ZAKLJUCEN', l: 'Zaključen' },
  { v: 'ZAVRNJENA', l: 'Zavrnjena' },
]

const KANALI: { v: string; l: string; icon: typeof Phone }[] = [
  { v: 'TELEFON', l: 'Telefon', icon: Phone },
  { v: 'EMAIL', l: 'E-pošta', icon: Mail },
  { v: 'PORTAL', l: 'Portal', icon: MessageSquareWarning },
  { v: 'OSEBNO', l: 'Osebno', icon: User },
]

const ODLOCITVE: { v: string; l: string }[] = [
  { v: 'UTEMELJENA', l: 'Utemeljena' },
  { v: 'DELNO_UTEMELJENA', l: 'Delno utemeljena' },
  { v: 'NEUTEMELJENA', l: 'Neutemeljena' },
]

const kanalLabel = (v: string) => KANALI.find((k) => k.v === v)?.l ?? v
const odlocitevLabel = (v: string) => ODLOCITVE.find((k) => k.v === v)?.l ?? v

const ODLOCITEV_CLS: Record<string, string> = {
  UTEMELJENA: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  DELNO_UTEMELJENA: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  NEUTEMELJENA: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
}

/** Pisarna v UI: projects.write + vloga z obsegom vodenja (strežnik RES preverja). */
function isOffice (user: { role: string; perms: string[] } | null): boolean {
  if (!user) return false
  return user.role !== 'MONTER' && hasPerm(user.perms, 'projects.write')
}

/** Ali garancija (iz API odgovora) trenutno velja. */
function garancijaVelja (w: { status: string; startsAt: string; months: number } | null): boolean {
  if (!w || w.status !== 'AKTIVNA') return false
  const ends = new Date(w.startsAt)
  ends.setMonth(ends.getMonth() + w.months)
  return ends >= new Date()
}

// ─── modul ────────────────────────────────────────────────────────────────────

export default function ServisModule () {
  const user = useAppStore((s) => s.user)
  const monterOnly = !!user && user.role === 'MONTER'
  const [tab, setTab] = useState('servis') // monter začne na servisu (edinem zavihku)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Servis"
        desc={monterOnly
          ? 'Vaši servisni primeri in obiski (issue #7 §10)'
          : 'Garancije, reklamacije in servisni primeri — tok stranka → reklamacija → preveritev → odločitev → servis → zaključek (issue #7 §10)'}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {monterOnly ? null : <TabsTrigger value="garancije"><ShieldCheck className="mr-1.5 size-4" aria-hidden /> Garancije</TabsTrigger>}
          {monterOnly ? null : <TabsTrigger value="reklamacije"><FileWarning className="mr-1.5 size-4" aria-hidden /> Reklamacije</TabsTrigger>}
          <TabsTrigger value="servis"><Wrench className="mr-1.5 size-4" aria-hidden /> Servis</TabsTrigger>
        </TabsList>
        {monterOnly ? null : <TabsContent value="garancije" className="mt-4"><GarancijeTab /></TabsContent>}
        {monterOnly ? null : <TabsContent value="reklamacije" className="mt-4"><ReklamacijeTab /></TabsContent>}
        <TabsContent value="servis" className="mt-4"><ServisTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ═══ ZAVIHEK: GARANCIJE (obstoječi Warranty tok — R434, razširjen v R446) ═════

function GarancijeTab () {
  const user = useAppStore((s) => s.user)
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const warranties = useApi<{ data: WarrantyRow[] }>('/api/warranty')
  const office = isOffice(user)
  const rows = warranties.data?.data ?? []
  const validCount = rows.filter((w) => w.valid).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">
          {rows.length} garancij{validCount > 0 ? ` · ${validCount} veljavnih` : ''}
        </Badge>
        {office ? (
          <Button size="sm" className="ml-auto min-h-11" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nova garancija
          </Button>
        ) : null}
      </div>

      <ErrorBox error={warranties.error} />
      {warranties.loading ? <LoadingRows /> : !warranties.error && rows.length === 0 ? (
        <EmptyState
          title="Ni garancij"
          desc="Garancijo oddate za zaključen ali arhiviran projekt."
          icon={ShieldCheck}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((w) => (
            <li key={w.id}>
              <Card className="transition hover:border-roksal-amber/60">
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusBadge status={w.status} />
                    <Badge variant="secondary" className={w.valid
                      ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}>
                      {w.valid ? 'Velja' : 'Ne velja'}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{w.months} mesecev</span>
                  </div>
                  <div className="text-sm font-semibold leading-snug">
                    {w.project ? <>{w.project.code} — {w.project.title}</> : 'Brez projekta'}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {w.project?.customer ? <span>{w.project.customer.name}</span> : null}
                    <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" aria-hidden /> do {fmtDate(w.endsAt)}</span>
                    <span>{w.visits.length} obiskov</span>
                  </div>
                  <Button variant="outline" size="sm" className="mt-1 min-h-11" onClick={() => setSelected(w.id)}>
                    Podrobnosti in obiski
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <WarrantyDetailDialog
          id={selected}
          office={office}
          onClose={() => setSelected(null)}
          onDone={async () => { await warranties.reload() }}
        />
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewWarrantyDialog
          key={String(createOpen)}
          warranties={rows}
          onClose={() => setCreateOpen(false)}
          onDone={async () => { await warranties.reload() }}
        />
      </Dialog>
    </div>
  )
}

/** Podrobnost garancije + obiski (obstoječa /api/warranty rute — R434). */
function WarrantyDetailDialog ({ id, office, onClose, onDone }: {
  id: string | null; office: boolean; onClose: () => void; onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  // podrobnost vzamemo iz seznama (enoten vir /api/warranty)
  const list = useApi<{ data: WarrantyRow[] }>(id ? '/api/warranty' : null, [id])
  const w = useMemo(() => list.data?.data.find((x) => x.id === id) ?? null, [list.data, id])
  const [visitNote, setVisitNote] = useState('')
  const [visitDate, setVisitDate] = useState('')
  const [busy, setBusy] = useState(false)

  async function addVisit () {
    if (!w) return
    const note = visitNote.trim()
    if (!note) {
      toast({ title: 'Opis obiska je obvezen.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost('/api/warranty', {
        warrantyId: w.id, visitNote: note, ...(visitDate ? { visitDate: new Date(visitDate).toISOString() } : {}),
      })
      toast({ title: 'Obisk garancije zabeležen.', description: w.project?.code })
      setVisitNote(''); setVisitDate('')
      await list.reload()
      await onDone()
    } catch (e) {
      toast({ title: 'Obiska ni bilo mogoče zabeležiti', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-5 text-roksal-amber" aria-hidden />
          Garancija — {w?.project?.code ?? '…'}
        </DialogTitle>
        <DialogDescription>
          {w ? `${w.project?.title ?? ''} · velja do ${fmtDate(w.endsAt)} (${w.months} mesecev)` : 'Podrobnosti garancije.'}
        </DialogDescription>
      </DialogHeader>

      {list.loading ? <LoadingRows rows={2} /> : !w ? (
        <ErrorBox error={list.error ?? { message: 'Garancija ni na voljo.' }} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={w.status} />
            <Badge variant="secondary" className={w.valid
              ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}>
              {w.valid ? 'Velja' : 'Ne velja'}
            </Badge>
            <span className="text-xs text-muted-foreground">začetek {fmtDate(w.startsAt)}</span>
          </div>
          {w.note ? <p className="text-sm text-muted-foreground">{w.note}</p> : null}

          <div>
            <h4 className="mb-2 text-sm font-semibold">Obiski garancije ({w.visits.length})</h4>
            {w.visits.length === 0 ? (
              <p className="text-sm text-muted-foreground">Še ni obiskov.</p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {w.visits.map((v) => (
                  <li key={v.id} className="rounded-lg border p-2.5 text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CalendarClock className="size-3" aria-hidden /> {fmtDateTime(v.date)}
                    </div>
                    <div className="mt-0.5">{v.note}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {office ? (
            <div className="space-y-2 rounded-lg border p-3">
              <Label htmlFor="war-visit-note">Nov obisk garancije</Label>
              <Textarea
                id="war-visit-note" value={visitNote} onChange={(e) => setVisitNote(e.target.value)}
                placeholder="Npr. letni pregled zaključnih profilov, sprednji vrt"
                className="min-h-20"
              />
              <Input
                type="date" aria-label="Datum obiska garancije" value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
              />
              <Button size="sm" className="min-h-11 w-full sm:w-auto" disabled={busy} onClick={addVisit}>
                <Plus className="size-4" aria-hidden /> Zabeleži obisk
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </DialogContent>
  )
}

/** Nova garancija — samo ZAKLJUCEN/ARHIV projekti brez obstoječe garancije. */
function NewWarrantyDialog ({ warranties, onClose, onDone }: {
  warranties: WarrantyRow[]; onClose: () => void; onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  const projects = useApi<{ data: ProjectOption[] }>('/api/projects?limit=500')
  const [projectId, setProjectId] = useState('')
  const [months, setMonths] = useState('24')
  const [startsAt, setStartsAt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const covered = new Set(warranties.map((w) => w.projectId))
  const eligible = (projects.data?.data ?? []).filter((p) =>
    (p.status === 'ZAKLJUCEN' || p.status === 'ARHIV') && !covered.has(p.id))

  async function submit () {
    if (!projectId) {
      toast({ title: 'Izberite projekt.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost('/api/warranty', {
        projectId,
        months: Number(months) || 24,
        ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      toast({ title: 'Garancija oddana.', description: `Za ${months} mesecev.` })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Garancije ni bilo mogoče oddati', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Nova garancija</DialogTitle>
        <DialogDescription>
          Garancijo je mogoče oddati samo za zaključen ali arhiviran projekt, ki je še nima.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="war-proj">Projekt</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="war-proj" className="min-h-11"><SelectValue placeholder="Izberite projekt" /></SelectTrigger>
            <SelectContent>
              {eligible.length === 0 ? <div className="p-2 text-sm text-muted-foreground">Ni upravičenih projektov.</div> : null}
              {eligible.map((p) => (
                <SelectItem key={p.id} value={p.id} className="min-h-11">
                  {p.code} — {p.title}{p.customer ? ` (${p.customer.name})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="war-months">Trajanje (mesecev)</Label>
            <Input id="war-months" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} className="min-h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="war-start">Začetek</Label>
            <Input id="war-start" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="min-h-11" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="war-note">Opomba (opcijsko)</Label>
          <Textarea id="war-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" className="min-h-11" onClick={onClose}>Prekliči</Button>
        <Button className="min-h-11" disabled={busy || !projectId} onClick={submit}>Oddaj garancijo</Button>
      </DialogFooter>
    </DialogContent>
  )
}

// ═══ ZAVIHEK: REKLAMACIJE (Claim — R446) ═════════════════════════════════════

function ReklamacijeTab () {
  const user = useAppStore((s) => s.user)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const claims = useApi<{ data: ClaimRow[] }>(`/api/claims${status !== 'all' ? `?status=${status}` : ''}`, [status])
  const office = isOffice(user)
  const rows = claims.data?.data ?? []
  const openCount = rows.filter((c) => c.status === 'NOVA' || c.status === 'V_OBRAVNAVI').length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44 min-h-11" aria-label="Filter statusa reklamacije"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="min-h-11">Vsi statusi</SelectItem>
            {CLAIM_STATUSI.map((s) => <SelectItem key={s.v} value={s.v} className="min-h-11">{s.l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">
          {rows.length} reklamacij{openCount > 0 ? ` · ${openCount} odprtih` : ''}
        </Badge>
        {office ? (
          <Button size="sm" className="ml-auto min-h-11" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nova reklamacija
          </Button>
        ) : null}
      </div>

      <ErrorBox error={claims.error} />
      {claims.loading ? <LoadingRows /> : !claims.error && rows.length === 0 ? (
        <EmptyState
          title="Ni reklamacij"
          desc={status !== 'all' ? 'Za izbrani status ni reklamacij.' : 'Zabeležite prvo reklamacijo stranke — iz nje odprete servisni primer.'}
          icon={FileWarning}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Card className="transition hover:border-roksal-amber/60">
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{c.code}</span>
                    <StatusBadge status={c.status} />
                    {c.serviceCase ? (
                      <Badge variant="outline" className="gap-1 font-mono text-xs">
                        <Wrench className="size-3" aria-hidden /> {c.serviceCase.code}
                      </Badge>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>
                  </div>
                  <div className="text-sm font-semibold leading-snug">{c.title}</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{c.customer.name}</span>
                    <span className="font-mono">{c.project.code}</span>
                    <span className="inline-flex items-center gap-1"><KanaliIconInline v={c.channel} /></span>
                    {c.warranty ? <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3" aria-hidden /> garancija</span> : null}
                  </div>
                  <Button variant="outline" size="sm" className="mt-1 min-h-11" onClick={() => setSelected(c.id)}>
                    Podrobnosti
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <ClaimDetailDialog
          id={selected}
          office={office}
          onClose={() => setSelected(null)}
          onDone={async () => { await claims.reload() }}
        />
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewClaimDialog
          key={String(createOpen)}
          onClose={() => setCreateOpen(false)}
          onDone={async () => { await claims.reload() }}
        />
      </Dialog>
    </div>
  )
}

function KanaliIconInline ({ v }: { v: string }) {
  const I = KANALI.find((k) => k.v === v)?.icon ?? MessageSquareWarning
  return <><I className="size-3" aria-hidden /> {kanalLabel(v)}</>
}

/** Podrobnost reklamacije + prehodi + gumb „Odpri servisni primer". */
function ClaimDetailDialog ({ id, office, onClose, onDone }: {
  id: string | null; office: boolean; onClose: () => void; onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  const detail = useApi<{ data: ClaimRow }>(id ? `/api/claims/${id}` : null, [id])
  const [busy, setBusy] = useState(false)
  const [resolutionNote, setResolutionNote] = useState('')

  const c = detail.data?.data
  const canOpenCase = !!c && office && !c.serviceCase && (c.status === 'NOVA' || c.status === 'V_OBRAVNAVI')

  async function patch (body: Record<string, unknown>, msg: string) {
    if (!c) return
    setBusy(true)
    try {
      await apiPatch(`/api/claims/${c.id}`, body)
      toast({ title: msg, description: c.code })
      setResolutionNote('')
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Sprememba ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function openCase () {
    if (!c) return
    setBusy(true)
    try {
      const res = await apiPost<{ data: ServiceCaseRow }>('/api/service-cases', {
        claimId: c.id,
        projectId: c.projectId,
        ...(c.warrantyId ? { warrantyId: c.warrantyId } : {}),
        title: c.title,
        desc: c.desc,
      })
      toast({ title: 'Servisni primer odprt.', description: `${res.data.code} — reklamacija ${c.code} je v obravnavi.` })
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Servisnega primera ni bilo mogoče odpreti', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  if (!c) {
    return (
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reklamacija</DialogTitle>
          <DialogDescription className="sr-only">Podrobnosti reklamacije.</DialogDescription>
        </DialogHeader>
        {detail.loading ? <LoadingRows rows={2} /> : <ErrorBox error={detail.error ?? { message: 'Reklamacija ni na voljo.' }} />}
      </DialogContent>
    )
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-roksal-amber">{c.code}</span>
          <StatusBadge status={c.status} />
        </DialogTitle>
        <DialogDescription>
          {c.customer.name} · {c.project.code} — {c.project.title} · {fmtDate(c.createdAt)}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="text-sm font-semibold">{c.title}</div>
        <p className="whitespace-pre-line text-sm text-muted-foreground">{c.desc}</p>

        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="inline-flex items-center gap-1.5"><KanaliIconInline v={c.channel} /></div>
          {c.reportedBy ? <div className="inline-flex items-center gap-1.5"><User className="size-3" aria-hidden /> prijavil {c.reportedBy}</div> : null}
          {c.package ? <div className="inline-flex items-center gap-1.5"><Hammer className="size-3" aria-hidden /> {c.package.name}</div> : null}
          {c.warranty ? (
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3" aria-hidden /> garancija {garancijaVelja(c.warranty) ? 'velja' : 'ne velja'} ({c.warranty.months} m)
            </div>
          ) : null}
          {c.serviceCase ? (
            <div className="inline-flex items-center gap-1.5"><Wrench className="size-3" aria-hidden /> primer {c.serviceCase.code} · {c.serviceCase.status}</div>
          ) : null}
        </div>

        {c.resolutionNote ? (
          <div className="rounded-lg border p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zaključek</div>
            <p className="mt-1 whitespace-pre-line">{c.resolutionNote}</p>
          </div>
        ) : null}

        {office ? (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap gap-2">
              {c.status === 'NOVA' || c.status === 'V_OBRAVNAVI' ? (
                <Button size="sm" className="min-h-11" disabled={busy} onClick={() => patch({ status: 'V_OBRAVNAVI' }, 'Reklamacija je v obravnavi.')}>
                  <Clock className="size-4" aria-hidden /> V obravnavo
                </Button>
              ) : null}
              {c.status === 'V_OBRAVNAVI' ? (
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy || resolutionNote.trim().length < 5}
                  onClick={() => patch({ status: 'ZAKLJUCENA', resolutionNote: resolutionNote.trim() }, 'Reklamacija zaključena.')}>
                  <CheckCircle2 className="size-4" aria-hidden /> Zaključi
                </Button>
              ) : null}
              {c.status === 'NOVA' || c.status === 'V_OBRAVNAVI' ? (
                <Button size="sm" variant="destructive" className="min-h-11" disabled={busy}
                  onClick={() => patch({ status: 'ZAVRNJENA', ...(resolutionNote.trim() ? { resolutionNote: resolutionNote.trim() } : {}) }, 'Reklamacija zavrnjena.')}>
                  <Ban className="size-4" aria-hidden /> Zavrni
                </Button>
              ) : null}
              {canOpenCase ? (
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={openCase}>
                  <Wrench className="size-4" aria-hidden /> Odpri servisni primer
                </Button>
              ) : null}
            </div>
            {c.status === 'NOVA' || c.status === 'V_OBRAVNAVI' ? (
              <Textarea
                aria-label="Opomba k zaključku ali zavrnitvi reklamacije"
                value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Opomba k zaključku/zavrnitvi (pri zaključku obvezna)"
                className="min-h-16"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </DialogContent>
  )
}

/** Nova reklamacija: stranka → njeni projekti → paket (opcijsko) → garancija (opcijsko). */
function NewClaimDialog ({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const customers = useApi<{ data: CustomerOption[] }>('/api/customers?limit=500')
  const projects = useApi<{ data: ProjectOption[] }>('/api/projects?limit=500')

  const [customerId, setCustomerId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [packageId, setPackageId] = useState('none')
  const [warrantyId, setWarrantyId] = useState('none')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [channel, setChannel] = useState('TELEFON')
  const [reportedBy, setReportedBy] = useState('')
  const [busy, setBusy] = useState(false)

  // projekti izbrane stranke (eksplicitna vezava customerId ↔ projectId)
  const strankiniProjekti = (projects.data?.data ?? []).filter((p) => p.customerId === customerId)
  const packages = useApi<{ data: PackageOption[] }>(projectId ? `/api/project-packages?projectId=${projectId}` : null, [projectId])
  const warranties = useApi<{ data: WarrantyRow[] }>(projectId ? `/api/warranty?projectId=${projectId}` : null, [projectId])
  // garancija se SAMODEJNO ponudi, če projekt ima veljavno garancijo
  const autoWarranty = (warranties.data?.data ?? []).find((w) => w.valid)
  const effectiveWarranty = warrantyId !== 'none' ? warrantyId : (autoWarranty ? autoWarranty.id : 'none')

  async function submit () {
    if (!customerId || !projectId || !title.trim() || !desc.trim()) {
      toast({ title: 'Izpolnite stranko, projekt, naslov in opis težave.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: ClaimRow }>('/api/claims', {
        customerId, projectId,
        ...(effectiveWarranty !== 'none' ? { warrantyId: effectiveWarranty } : {}),
        ...(packageId !== 'none' ? { packageId } : {}),
        title: title.trim(), desc: desc.trim(), channel,
        ...(reportedBy.trim() ? { reportedBy: reportedBy.trim() } : {}),
      })
      toast({ title: 'Reklamacija zabeležena.', description: res.data.code })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Reklamacije ni bilo mogoče zabeležiti', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Nova reklamacija</DialogTitle>
        <DialogDescription>
          Zabeležite težavo stranke na njenem projektu — iz reklamacije lahko nato odprete servisni primer.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="cl-stranka">Stranka</Label>
          <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setProjectId(''); setPackageId('none'); setWarrantyId('none') }}>
            <SelectTrigger id="cl-stranka" className="min-h-11"><SelectValue placeholder="Izberite stranko" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {(customers.data?.data ?? []).map((cu) => (
                <SelectItem key={cu.id} value={cu.id} className="min-h-11">{cu.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cl-projekt">Projekt stranke</Label>
          <Select value={projectId} onValueChange={(v) => { setProjectId(v); setPackageId('none'); setWarrantyId('none') }} disabled={!customerId}>
            <SelectTrigger id="cl-projekt" className="min-h-11"><SelectValue placeholder={customerId ? 'Izberite projekt' : 'Najprej izberite stranko'} /></SelectTrigger>
            <SelectContent className="max-h-72">
              {strankiniProjekti.length === 0 ? <div className="p-2 text-sm text-muted-foreground">Stranka nima projektov.</div> : null}
              {strankiniProjekti.map((p) => (
                <SelectItem key={p.id} value={p.id} className="min-h-11">{p.code} — {p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {projectId ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cl-paket">Paket (opcijsko)</Label>
              <Select value={packageId} onValueChange={setPackageId}>
                <SelectTrigger id="cl-paket" className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none" className="min-h-11">Cel projekt</SelectItem>
                  {(packages.data?.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id} className="min-h-11">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-garancija">Garancija (opcijsko)</Label>
              <Select value={effectiveWarranty} onValueChange={setWarrantyId}>
                <SelectTrigger id="cl-garancija" className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="min-h-11">Brez garancije</SelectItem>
                  {(warranties.data?.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id} className="min-h-11">
                      {w.valid ? 'Veljavna' : w.status} · {w.months} m (do {fmtDate(w.endsAt)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {autoWarranty ? <p className="text-xs text-muted-foreground">Veljavna garancija je bila samodejno ponujena.</p> : null}
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="cl-naslov">Naslov težave</Label>
          <Input id="cl-naslov" value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-11"
            placeholder="Npr. Šum zaključnega profila pri vetru" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cl-opis">Opis težave</Label>
          <Textarea id="cl-opis" value={desc} onChange={(e) => setDesc(e.target.value)} className="min-h-24"
            placeholder="Kaj stranka poroča, kdaj se težava pojavi …" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cl-kanal">Kanal prijave</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger id="cl-kanal" className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KANALI.map((k) => <SelectItem key={k.v} value={k.v} className="min-h-11">{k.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-prijavitelj">Prijavitelj (opcijsko)</Label>
            <Input id="cl-prijavitelj" value={reportedBy} onChange={(e) => setReportedBy(e.target.value)} className="min-h-11"
              placeholder="Ime, če ni uporabnik" />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" className="min-h-11" onClick={onClose}>Prekliči</Button>
        <Button className="min-h-11" disabled={busy} onClick={submit}>Zabeleži reklamacijo</Button>
      </DialogFooter>
    </DialogContent>
  )
}

// ═══ ZAVIHEK: SERVIS (ServiceCase + ServiceVisit — R446) ═════════════════════

function ServisTab () {
  const user = useAppStore((s) => s.user)
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const cases = useApi<{ data: ServiceCaseRow[] }>(`/api/service-cases${status !== 'all' ? `?status=${status}` : ''}`, [status])
  const office = isOffice(user)
  const rows = cases.data?.data ?? []
  const activeCount = rows.filter((c) => c.status === 'PREVERITEV' || c.status === 'ODOBRENA' || c.status === 'V_SERVISU').length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44 min-h-11" aria-label="Filter statusa servisnega primera"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="min-h-11">Vsi statusi</SelectItem>
            {CASE_STATUSI.map((s) => <SelectItem key={s.v} value={s.v} className="min-h-11">{s.l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground self-center">
          {rows.length} primerov{activeCount > 0 ? ` · ${activeCount} aktivnih` : ''}
        </Badge>
        {office ? (
          <Button size="sm" className="ml-auto min-h-11" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nov servisni primer
          </Button>
        ) : null}
      </div>

      <ErrorBox error={cases.error} />
      {cases.loading ? <LoadingRows /> : !cases.error && rows.length === 0 ? (
        <EmptyState
          title="Ni servisnih primerov"
          desc={user?.role === 'MONTER'
            ? 'Nimate še svojih servisnih primerov — obiski, ki vam jih dodeli pisarna, se pojavijo tukaj.'
            : 'Servisni primer odprete iz reklamacije ali neposredno za projekt.'}
          icon={Wrench}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Card className="transition hover:border-roksal-amber/60">
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs font-semibold text-roksal-amber">{c.code}</span>
                    <StatusBadge status={c.status} />
                    {c.decision ? (
                      <Badge variant="secondary" className={`border-transparent font-medium ${ODLOCITEV_CLS[c.decision] ?? ''}`}>
                        {odlocitevLabel(c.decision)}
                      </Badge>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground">{c.visits.length} obiskov</span>
                  </div>
                  <div className="text-sm font-semibold leading-snug">{c.title}</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{c.project.code}</span>
                    {c.claim ? <span className="font-mono">{c.claim.code}</span> : null}
                    {c.warranty ? (
                      c.billable
                        ? <span className="inline-flex items-center gap-1"><BadgeCheck className="size-3" aria-hidden /> zaračunano</span>
                        : <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3" aria-hidden /> garancija pokriva</span>
                    ) : c.billable ? <span className="inline-flex items-center gap-1"><BadgeCheck className="size-3" aria-hidden /> zaračunano</span> : null}
                  </div>
                  <Button variant="outline" size="sm" className="mt-1 min-h-11" onClick={() => setSelected(c.id)}>
                    Podrobnosti in tok
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <CaseDetailDialog
          id={selected}
          onClose={() => setSelected(null)}
          onDone={async () => { await cases.reload() }}
        />
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewCaseDialog
          key={String(createOpen)}
          onClose={() => setCreateOpen(false)}
          onDone={async () => { await cases.reload() }}
        />
      </Dialog>
    </div>
  )
}

/** Podrobnost servisnega primera: tok + odločitev + obiski. */
function CaseDetailDialog ({ id, onClose, onDone }: { id: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const user = useAppStore((s) => s.user)
  const detail = useApi<{ data: ServiceCaseRow }>(id ? `/api/service-cases/${id}` : null, [id])
  const users = useApi<{ data: UserOption[] }>(id && isOffice(user) ? '/api/users' : null, [id])

  const [busy, setBusy] = useState(false)
  // odločitev (PREVERITEV)
  const [decision, setDecision] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [billableOverride, setBillableOverride] = useState<boolean | null>(null)
  // zaključek
  const [resolutionNote, setResolutionNote] = useState('')
  // obisk
  const [visitNote, setVisitNote] = useState('')
  const [visitDate, setVisitDate] = useState('')
  const [visitHours, setVisitHours] = useState('')
  const [visitUser, setVisitUser] = useState('')

  const c = detail.data?.data
  const office = isOffice(user)
  // monter lahko zapiše obisk ZASE na odobrenem/v servisnem primeru
  const canVisit = !!c && (c.status === 'ODOBRENA' || c.status === 'V_SERVISU') &&
    (office || (user?.role === 'MONTER' || !!user && hasPerm(user.perms, 'nalog.write')))

  async function patch (body: Record<string, unknown>, msg: string) {
    if (!c) return
    setBusy(true)
    try {
      await apiPatch(`/api/service-cases/${c.id}`, body)
      toast({ title: msg, description: c.code })
      setDecisionNote(''); setResolutionNote(''); setBillableOverride(null)
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Sprememba ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function addVisit () {
    if (!c) return
    const note = visitNote.trim()
    if (!note) {
      toast({ title: 'Opis obiska je obvezen.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await apiPost(`/api/service-cases/${c.id}/visits`, {
        note,
        ...(visitDate ? { date: new Date(visitDate).toISOString() } : {}),
        ...(visitHours && Number(visitHours) > 0 ? { hours: Number(visitHours) } : {}),
        ...(office && visitUser ? { userId: visitUser } : {}),
      })
      toast({ title: 'Servisni obisk zabeležen.', description: c.code })
      setVisitNote(''); setVisitDate(''); setVisitHours(''); setVisitUser('')
      await Promise.all([detail.reload(), onDone()])
    } catch (e) {
      toast({ title: 'Obiska ni bilo mogoče zabeležiti', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  if (!c) {
    return (
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Servisni primer</DialogTitle>
          <DialogDescription className="sr-only">Podrobnosti servisnega primera.</DialogDescription>
        </DialogHeader>
        {detail.loading ? <LoadingRows rows={2} /> : <ErrorBox error={detail.error ?? { message: 'Servisni primer ni na voljo.' }} />}
      </DialogContent>
    )
  }

  const tokKoraki: { l: string; done: boolean }[] = [
    { l: 'Preveritev', done: c.status !== 'PREVERITEV' },
    { l: 'Odločitev', done: !!c.decision },
    { l: 'Servis', done: c.status === 'V_SERVISU' || c.status === 'ZAKLJUCEN' },
    { l: 'Zaključek', done: c.status === 'ZAKLJUCEN' },
  ]

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-roksal-amber">{c.code}</span>
          <StatusBadge status={c.status} />
        </DialogTitle>
        <DialogDescription>
          {c.project.code} — {c.project.title}
          {c.claim ? ` · iz reklamacije ${c.claim.code}` : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="text-sm font-semibold">{c.title}</div>
        <p className="whitespace-pre-line text-sm text-muted-foreground">{c.desc}</p>

        {/* tok: PREVERITEV → odločitev → SERVIS → zaključek */}
        <ol className="flex items-center gap-1 text-xs" aria-label="Tok servisnega primera">
          {tokKoraki.map((k, i) => (
            <li key={k.l} className="flex flex-1 items-center gap-1">
              <span className={`flex h-7 min-w-7 items-center justify-center rounded-full border px-2 font-medium ${k.done
                ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground'}`}>
                {k.done ? <CheckCircle2 className="size-3.5" aria-hidden /> : <span aria-hidden>{i + 1}</span>}
                <span className="sr-only">{k.done ? 'opravljeno: ' : 'korak: '}</span>
              </span>
              <span className="hidden sm:inline">{k.l}</span>
              {i < tokKoraki.length - 1 ? <span className="h-px flex-1 bg-border" aria-hidden /> : null}
            </li>
          ))}
        </ol>

        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          {c.claim ? (
            <div className="inline-flex items-center gap-1.5">
              <FileWarning className="size-3" aria-hidden /> {c.claim.code} — {c.claim.title}
              {c.claim.customer ? ` (${c.claim.customer.name})` : ''}
            </div>
          ) : null}
          {c.warranty ? (
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3" aria-hidden /> {garancijaVelja(c.warranty) ? 'garancija velja' : 'garancija ne velja'} ({c.warranty.months} m)
            </div>
          ) : null}
          {c.decidedBy ? (
            <div className="inline-flex items-center gap-1.5"><User className="size-3" aria-hidden /> odločil {c.decidedBy.name} · {fmtDate(c.decidedAt)}</div>
          ) : null}
          <div className="inline-flex items-center gap-1.5">
            {c.billable
              ? <><BadgeCheck className="size-3" aria-hidden /> zaračunano stranki</>
              : <><LifeBuoy className="size-3" aria-hidden /> garancija pokriva</>}
          </div>
        </div>

        {c.decision ? (
          <div className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Odločitev</span>
              <Badge variant="secondary" className={`border-transparent font-medium ${ODLOCITEV_CLS[c.decision] ?? ''}`}>
                {odlocitevLabel(c.decision)}
              </Badge>
            </div>
            {c.decisionNote ? <p className="mt-1 whitespace-pre-line">{c.decisionNote}</p> : null}
          </div>
        ) : null}
        {c.resolutionNote ? (
          <div className="rounded-lg border p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rešitev</div>
            <p className="mt-1 whitespace-pre-line">{c.resolutionNote}</p>
          </div>
        ) : null}

        {/* pisarniški tok */}
        {office ? (
          <div className="space-y-3 rounded-lg border p-3">
            {c.status === 'PREVERITEV' ? (
              <>
                <div className="text-sm font-semibold">Odločitev po preveritvi</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="case-decision">Odločitev</Label>
                    <Select value={decision} onValueChange={setDecision}>
                      <SelectTrigger id="case-decision" className="min-h-11"><SelectValue placeholder="Izberite odločitev" /></SelectTrigger>
                      <SelectContent>
                        {ODLOCITVE.map((d) => <SelectItem key={d.v} value={d.v} className="min-h-11">{d.l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2 pb-1">
                    <Switch
                      id="case-billable"
                      checked={billableOverride ?? undefined}
                      onCheckedChange={(v) => setBillableOverride(v)}
                      aria-label="Zaračunaj stranki (prepiše samodejni izračun iz garancije)"
                    />
                    <Label htmlFor="case-billable" className="text-sm font-normal text-muted-foreground">
                      Zaračunaj stranki (prepiše samodejni izračun)
                    </Label>
                  </div>
                </div>
                <Textarea
                  aria-label="Utemeljitev odločitve (vsaj 5 znakov)"
                  value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)}
                  placeholder="Utemeljitev odločitve (obvezna)"
                  className="min-h-16"
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="min-h-11"
                    disabled={busy || !decision || decisionNote.trim().length < 5}
                    onClick={() => patch({
                      status: 'ODOBRENA', decision, decisionNote: decisionNote.trim(),
                      ...(billableOverride !== null ? { billable: billableOverride } : {}),
                    }, 'Primer odobren — v servis.')}>
                    <CheckCircle2 className="size-4" aria-hidden /> Odobri in v servis
                  </Button>
                  <Button size="sm" variant="destructive" className="min-h-11"
                    disabled={busy || !decision || decisionNote.trim().length < 5}
                    onClick={() => patch({ status: 'ZAVRNJENA', decision, decisionNote: decisionNote.trim() }, 'Primer zavrnjen.')}>
                    <Ban className="size-4" aria-hidden /> Zavrni
                  </Button>
                </div>
              </>
            ) : null}

            {c.status === 'ODOBRENA' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">Primer je odobren{c.billable ? ' (zaračunano stranki)' : ' (garancija pokriva)'}.</span>
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy}
                  onClick={() => patch({ status: 'V_SERVISU' }, 'Primer je v servisu.')}>
                  <Wrench className="size-4" aria-hidden /> V servis
                </Button>
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy}
                  onClick={() => patch({ billable: !c.billable }, c.billable ? 'Zaračunavanje odstranjeno.' : 'Označeno kot zaračunano.')}>
                  <BadgeCheck className="size-4" aria-hidden /> {c.billable ? 'Ne zaračunaj' : 'Zaračunaj stranki'}
                </Button>
              </div>
            ) : null}

            {c.status === 'ODOBRENA' || c.status === 'V_SERVISU' ? (
              <div className="space-y-2">
                <Textarea
                  aria-label="Opomba o rešitvi (obvezna ob zaključku)"
                  value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Kaj je bilo narejeno (obvezno ob zaključku)"
                  className="min-h-16"
                />
                <Button size="sm" className="min-h-11" disabled={busy || resolutionNote.trim().length < 5}
                  onClick={() => patch({ status: 'ZAKLJUCEN', resolutionNote: resolutionNote.trim() }, 'Servisni primer zaključen.')}>
                  <CheckCircle2 className="size-4" aria-hidden /> Zaključi primer
                </Button>
              </div>
            ) : null}

            {c.status === 'ZAKLJUCEN' || c.status === 'ZAVRNJENA' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Primer je {c.status === 'ZAKLJUCEN' ? 'zaključen' : 'zavrnjen'}.</span>
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy}
                  onClick={() => patch({ billable: !c.billable }, c.billable ? 'Zaračunavanje odstranjeno.' : 'Označeno kot zaračunano.')}>
                  <BadgeCheck className="size-4" aria-hidden /> {c.billable ? 'Ne zaračunaj' : 'Zaračunaj stranki'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* obiski */}
        <div>
          <h4 className="mb-2 text-sm font-semibold">Servisni obiski ({c.visits.length})</h4>
          {c.visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Še ni obiskov.</p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {c.visits.map((v) => (
                <li key={v.id} className="rounded-lg border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" aria-hidden /> {fmtDateTime(v.date)}</span>
                    <span className="inline-flex items-center gap-1"><HardHat className="size-3" aria-hidden /> {v.user.name}</span>
                    {v.hours ? <span>{v.hours} h</span> : null}
                  </div>
                  <div className="mt-0.5 whitespace-pre-line">{v.note}</div>
                </li>
              ))}
            </ul>
          )}

          {canVisit ? (
            <div className="mt-2 space-y-2 rounded-lg border p-3">
              <Label htmlFor="visit-note">Nov servisni obisk{office ? '' : ' (zase)'}</Label>
              <Textarea
                id="visit-note" value={visitNote} onChange={(e) => setVisitNote(e.target.value)}
                placeholder="Kaj je bilo storjeno na terenu"
                className="min-h-20"
              />
              <div className="grid gap-2 sm:grid-cols-3">
                {office ? (
                  <div className="space-y-1">
                    <Label htmlFor="visit-user" className="text-xs">Tehnik</Label>
                    <Select value={visitUser} onValueChange={setVisitUser}>
                      <SelectTrigger id="visit-user" className="min-h-11"><SelectValue placeholder="Zame" /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {(users.data?.data ?? []).filter((u) => u.active).map((u) => (
                          <SelectItem key={u.id} value={u.id} className="min-h-11">{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <Label htmlFor="visit-date" className="text-xs">Datum</Label>
                  <Input id="visit-date" type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} className="min-h-11" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="visit-hours" className="text-xs">Ure dela</Label>
                  <Input id="visit-hours" type="number" min="0.5" step="0.5" max="24" value={visitHours}
                    onChange={(e) => setVisitHours(e.target.value)} className="min-h-11" placeholder="Npr. 2.5" />
                </div>
              </div>
              <Button size="sm" className="min-h-11 w-full sm:w-auto" disabled={busy || !visitNote.trim()} onClick={addVisit}>
                <Plus className="size-4" aria-hidden /> Zabeleži obisk
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </DialogContent>
  )
}

/** Nov servisni primer (pisarna) — neposredno za projekt, z ali brez reklamacije. */
function NewCaseDialog ({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useToast()
  const projects = useApi<{ data: ProjectOption[] }>('/api/projects?limit=500')
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    if (!projectId || !title.trim() || !desc.trim()) {
      toast({ title: 'Izpolnite projekt, naslov in opis.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: ServiceCaseRow }>('/api/service-cases', {
        projectId, title: title.trim(), desc: desc.trim(),
      })
      toast({ title: 'Servisni primer odprt.', description: res.data.code })
      await onDone()
      onClose()
    } catch (e) {
      toast({ title: 'Servisnega primera ni bilo mogoče odpreti', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Nov servisni primer</DialogTitle>
        <DialogDescription>
          Primer iz reklamacije odprite iz podrobnosti reklamacije — tukaj odprete primer neposredno za projekt.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="case-proj">Projekt</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="case-proj" className="min-h-11"><SelectValue placeholder="Izberite projekt" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {(projects.data?.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id} className="min-h-11">{p.code} — {p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="case-naslov">Naslov</Label>
          <Input id="case-naslov" value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-11"
            placeholder="Npr. Zamenjava zaključnega profila" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="case-opis">Opis</Label>
          <Textarea id="case-opis" value={desc} onChange={(e) => setDesc(e.target.value)} className="min-h-24" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" className="min-h-11" onClick={onClose}>Prekliči</Button>
        <Button className="min-h-11" disabled={busy} onClick={submit}>Odpri primer</Button>
      </DialogFooter>
    </DialogContent>
  )
}

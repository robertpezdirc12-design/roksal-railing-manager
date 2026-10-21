'use client'

// SERVIS — zavihek REKLAMACIJE (Claim — R446) — R547 izvleček iz servis.tsx
// (razbitje po vzorcu R546; BREZ spremembe obnašanja).

import { useState } from 'react'
import {
  Ban, CheckCircle2, Clock, FileWarning, Hammer, MessageSquareWarning, Plus,
  ShieldCheck, User, Wrench,
} from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import {
  CLAIM_STATUSI, KANALI, garancijaVelja, isOffice, kanalLabel,
  type ClaimRow, type CustomerOption, type PackageOption,
  type ProjectOption, type ServiceCaseRow, type WarrantyRow,
} from './servis-shared'

// ═══ ZAVIHEK: REKLAMACIJE (Claim — R446) ═════════════════════════════════════

export function ReklamacijeTab () {
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

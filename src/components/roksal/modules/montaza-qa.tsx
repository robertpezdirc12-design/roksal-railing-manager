'use client'

// MONTAŽA QA & PRIMOPREDAJA — R489 (GitHub issue #12, P1).
// Del montažnega poteka na nalogu (Danes), vzporedno obstoječemu preprostemu
// kontrolnemu seznamu (R444) — NE nadomesti ga:
//   • MontazaQaSection — statusne kontrolne točke iz virov (playbook MONTAZA +
//     segmenti tekača + inženirska pravila), odstopanja, korektivni ukrepi;
//   • HandoverSection — verzionirano primopredajno poročilo: primerjava
//     načrtovano/izvedeno, fotografije, potrditev monterja + podpis stranke
//     (ZABELEŽENA potrditev — ne kvalificiran e-podpis), izvoz PDF.
// Mobile-first (390 px), ena roka, brez prekrivanja merilnih kontrol.

import { useEffect, useRef, useState } from 'react'
import {
  CalendarClock, Check, CheckCheck, ChevronDown, ClipboardCheck, FileText, Loader2, Minus,
  PenLine, Plus, ShieldAlert, TriangleAlert, Undo2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { apiPatch, apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

// ── tipi ─────────────────────────────────────────────────────────────────────

export interface QaActionRow {
  id: string; description: string; status: string; dueAt: string | null
  note: string | null; photoId: string | null; completedAt: string | null; verifiedAt: string | null
  assignee: { name: string } | null
  verifiedBy: { name: string } | null
}

export interface QaDeviationRow {
  id: string; reason: string; location: string | null; targetKey: string | null
  impactSafety: boolean; impactMaterial: boolean; impactPrice: boolean
  resolvedAt: string | null; createdAt: string; note: string | null
  checkId: string | null
  createdBy: { name: string } | null
  resolvedBy: { name: string } | null
  actions: QaActionRow[]
}

export interface QaCheckRow {
  id: string; label: string; instruction: string | null
  templateKey: string; templateVersion: number; stepId: string | null
  critical: boolean; targetKey: string | null
  status: string; note: string | null; photoId: string | null; resolutionNote: string | null
  checkedAt: string | null; checkedBy: { name: string } | null; sortOrder: number
  deviations: QaDeviationRow[]
}

export interface HandoverRow {
  id: string; workOrderId: string; version: number; status: string
  summary: string | null
  designedSnapshotId: string | null; installedSnapshotId: string | null
  diffJson: string | null; photosJson: string | null
  monterConfirmedAt: string | null
  monterConfirmedBy: { name: string } | null
  customerSignedAt: string | null; customerSignedBy: string | null
  customerRemark: string | null
  createdAt: string
}

interface QaResponse {
  data: {
    checks: QaCheckRow[]
    deviations: QaDeviationRow[]
    handover: HandoverRow | null
    povzetek: { skupaj: number; vRedu: number; napake: number; caka: number; niRelevantno: number; odstopanj: number }
  }
}

const ACTION_FLOW = ['ODPRTO', 'V_OBRAVNAVI', 'ODRAVLJENO', 'PREVERJENO']

// ── Kontrola kakovosti montaže ──────────────────────────────────────────────

export function MontazaQaSection ({ woId, canWrite, fotoOptions, onTransitioned }: {
  woId: string
  canWrite: boolean
  fotoOptions: { id: string; label: string }[]
  onTransitioned: () => Promise<void> | void
}) {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const qa = useApi<QaResponse>(`/api/nalog/${woId}/qa`)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<{ check: QaCheckRow; status: string } | null>(null)
  const [form, setForm] = useState({ note: '', resolutionNote: '', reason: '', location: '', impactSafety: false, impactMaterial: false, impactPrice: false, photoId: '' })
  const [actionForm, setActionForm] = useState<{ deviationId: string; description: string; assigneeId: string; dueAt: string } | null>(null)
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const canPickUsers = hasPerm(user?.perms, 'users.read')

  useEffect(() => {
    if (!canPickUsers) return
    let cancelled = false
    void import('@/lib/api-client').then(async ({ apiGet }) => {
      try {
        const d = await apiGet<{ data: { id: string; name: string; role: string; active: boolean }[] }>('/api/users')
        if (!cancelled) setUsers(d.data.filter((u) => u.active).map((u) => ({ id: u.id, name: `${u.name} (${u.role.toLowerCase()})` })))
      } catch { /* brez seznama — ukrep brez odgovorne osebe */ }
    })
    return () => { cancelled = true }
  }, [canPickUsers])

  const data = qa.data?.data
  const checks = data?.checks ?? []
  const manualDeviations = data?.deviations ?? []
  const povzetek = data?.povzetek

  async function pripravi (): Promise<void> {
    setBusy('prepare')
    try {
      const d = await apiPost<{ data: { stevilo: number; viri: { playbook: { key: string; version: number }; segmenti: number; pravila: number } } }>(`/api/nalog/${woId}/qa`, {})
      toast({
        title: `Pripravljenih ${d.data.stevilo} kontrolnih točk`,
        description: `Viri: playbook ${d.data.viri.playbook.key} v${d.data.viri.playbook.version}${d.data.viri.segmenti > 0 ? ` · ${d.data.viri.segmenti} segmentov tekača` : ''}${d.data.viri.pravila > 0 ? ` · ${d.data.viri.pravila} inženirskih pravil` : ''}`,
      })
      await qa.reload()
    } catch (e) {
      toast({ title: 'Priprava ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  function zacetiStatus (check: QaCheckRow, status: string): void {
    // kateri dodatni podatki so obvezni (issue #12 §2B)
    const needForm = status === 'NAPAKA'
      || status === 'NI_RELEVANTNO'
      || (status === 'V_REDU' && (check.status === 'NAPAKA' || check.status === 'CAKA_PREVERJANJE'))
    if (!needForm) { void poslji(check, status, {}); return }
    setForm({ note: '', resolutionNote: '', reason: '', location: '', impactSafety: false, impactMaterial: false, impactPrice: false, photoId: '' })
    setPending({ check, status })
  }

  async function poslji (check: QaCheckRow, status: string, extra: Record<string, unknown>): Promise<void> {
    setBusy(check.id)
    try {
      await apiPatch(`/api/nalog/${woId}/qa/check`, { checkId: check.id, status, ...extra })
      toast({ title: `${check.label.slice(0, 60)} → ${statusLabel(status)}` })
      setPending(null)
      await Promise.all([qa.reload(), onTransitioned()])
    } catch (e) {
      toast({ title: 'Sprememba zavrnjena', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function potrdiPending (): Promise<void> {
    if (!pending) return
    const { check, status } = pending
    if (status === 'NAPAKA' && form.reason.trim().length < 3) {
      toast({ title: 'Zapiši razlog napake (vsaj 3 znaki).', variant: 'destructive' }); return
    }
    if (status === 'NI_RELEVANTNO' && form.note.trim().length < 3) {
      toast({ title: 'Zapiši razlog, zakaj točka ni relevantna.', variant: 'destructive' }); return
    }
    if (status === 'V_REDU' && form.resolutionNote.trim().length < 3) {
      toast({ title: 'Zapiši opombo o rešitvi napake.', variant: 'destructive' }); return
    }
    await poslji(check, status, {
      note: form.note.trim() || null,
      resolutionNote: form.resolutionNote.trim() || null,
      photoId: form.photoId || null,
      deviationReason: status === 'NAPAKA' ? form.reason.trim() : null,
      deviationLocation: status === 'NAPAKA' ? (form.location.trim() || null) : null,
      deviationTargetKey: check.targetKey,
      deviationImpactSafety: form.impactSafety,
      deviationImpactMaterial: form.impactMaterial,
      deviationImpactPrice: form.impactPrice,
    })
  }

  async function resi (deviationId: string): Promise<void> {
    setBusy(deviationId)
    try {
      await apiPatch(`/api/nalog/${woId}/qa/deviation`, { id: deviationId })
      toast({ title: 'Odstopanje odpravljeno.' })
      await Promise.all([qa.reload(), onTransitioned()])
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function ustvariUkrep (): Promise<void> {
    if (!actionForm) return
    if (actionForm.description.trim().length < 3) {
      toast({ title: 'Zapiši opis ukrepa (vsaj 3 znaki).', variant: 'destructive' }); return
    }
    setBusy(actionForm.deviationId)
    try {
      await apiPost(`/api/nalog/${woId}/qa/action`, {
        deviationId: actionForm.deviationId,
        description: actionForm.description.trim(),
        assigneeId: actionForm.assigneeId || null,
        dueAt: actionForm.dueAt || null,
      })
      toast({ title: 'Korektivni ukrep dodan.' })
      setActionForm(null)
      await Promise.all([qa.reload(), onTransitioned()])
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function naprejUkrep (a: QaActionRow): Promise<void> {
    const idx = ACTION_FLOW.indexOf(a.status)
    if (idx < 0 || idx >= ACTION_FLOW.length - 1) return
    setBusy(a.id)
    try {
      await apiPatch(`/api/nalog/${woId}/qa/action`, { id: a.id, status: ACTION_FLOW[idx + 1] })
      toast({ title: `Ukrep → ${ACTION_FLOW[idx + 1]}` })
      await Promise.all([qa.reload(), onTransitioned()])
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  if (qa.loading && !data) return <LoadingRows rows={2} />
  if (qa.error) return <ErrorBox error={qa.error} />

  const total = checks.length
  const opravljeno = (povzetek?.vRedu ?? 0) + (povzetek?.niRelevantno ?? 0)
  const pct = total > 0 ? Math.round((opravljeno / total) * 100) : 0

  return (
    <section aria-label="Kontrola kakovosti montaže" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <ClipboardCheck className="size-4 text-roksal-amber" aria-hidden /> Kontrola kakovosti montaže
        </h3>
        {total > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {opravljeno}/{total} opravljeno{(povzetek?.napake ?? 0) > 0 ? ` · ${povzetek?.napake} napak` : ''}{(povzetek?.caka ?? 0) > 0 ? ` · ${povzetek?.caka} čaka` : ''}
          </span>
        ) : null}
      </div>

      {total === 0 ? (
        canWrite ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Kontrolne točke se sestavijo iz virov: delovni postopek (playbook MONTAŽA), segmenti potrjenega tekača in aktivna inženirska pravila.
            </p>
            <Button className="h-11 w-full sm:w-auto" disabled={busy === 'prepare'} onClick={() => void pripravi()}>
              {busy === 'prepare' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              Pripravi kontrolne točke
            </Button>
          </div>
        ) : (
          <EmptyState icon={ClipboardCheck} title="Ni kontrolnih točk" desc="Monter jih pripravi pred začetkom dela." />
        )
      ) : (
        <>
          <Progress value={pct} className="mb-3 h-2" aria-label={`Napredek kontrole kakovosti ${pct} %`} />
          <ul className="space-y-1.5">
            {checks.map((c) => {
              const open = expanded === c.id
              return (
                <li key={c.id} className="rounded-lg border">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 p-2.5 text-left"
                    aria-expanded={open}
                    onClick={() => { setExpanded(open ? null : c.id); setPending(null) }}
                  >
                    {c.critical ? <ShieldAlert className="mt-0.5 size-4 shrink-0 text-roksal-amber" aria-label="Kritična točka" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium leading-snug">{c.label}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={c.status} />
                        {c.targetKey ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{c.targetKey}</span> : null}
                        {c.photoId ? <span className="text-[10px] text-muted-foreground">📷 dokaz</span> : null}
                        {c.deviations.length > 0 ? <span className="text-[10px] font-medium text-red-600">{c.deviations.length}× odstopanje</span> : null}
                      </span>
                    </span>
                    <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
                  </button>

                  {open ? (
                    <div className="border-t px-2.5 pb-3 pt-2">
                      {c.instruction ? <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{c.instruction}</p> : null}
                      {c.checkedAt && c.checkedBy ? (
                        <p className="mb-2 text-[11px] text-muted-foreground">Nazadnje preveril {c.checkedBy.name} · {fmtDateTime(c.checkedAt)}</p>
                      ) : null}
                      {c.resolutionNote ? <p className="mb-2 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Rešitev: {c.resolutionNote}</p> : null}

                      {pending?.check.id === c.id ? (
                        <div className="mb-3 space-y-2 rounded-lg bg-muted/50 p-2.5">
                          {pending.status === 'NAPAKA' ? (
                            <>
                              <Label htmlFor={`reason-${c.id}`}>Razlog napake (obvezno — ustvari se zapis odstopanja)</Label>
                              <Textarea id={`reason-${c.id}`} rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Kaj je narobe …" />
                              <Label htmlFor={`loc-${c.id}`}>Lokacija/element (neobvezno)</Label>
                              <Input id={`loc-${c.id}`} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={c.targetKey ?? 'npr. vogal pri vhodu'} />
                              <div className="grid grid-cols-3 gap-1.5">
                                <label className="flex items-center gap-1.5 text-xs" aria-label="Vpliv na varnost">
                                  <Checkbox checked={form.impactSafety} onCheckedChange={(v) => setForm({ ...form, impactSafety: v === true })} /> Varnost
                                </label>
                                <label className="flex items-center gap-1.5 text-xs" aria-label="Vpliv na material">
                                  <Checkbox checked={form.impactMaterial} onCheckedChange={(v) => setForm({ ...form, impactMaterial: v === true })} /> Material
                                </label>
                                <label className="flex items-center gap-1.5 text-xs" aria-label="Vpliv na ceno">
                                  <Checkbox checked={form.impactPrice} onCheckedChange={(v) => setForm({ ...form, impactPrice: v === true })} /> Cena
                                </label>
                              </div>
                            </>
                          ) : null}
                          {pending.status === 'NI_RELEVANTNO' ? (
                            <>
                              <Label htmlFor={`note-${c.id}`}>Razlog, da točka ni relevantna (obvezno)</Label>
                              <Textarea id={`note-${c.id}`} rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Zakaj ta kontrola ne velja za to izvedbo …" />
                            </>
                          ) : null}
                          {pending.status === 'V_REDU' ? (
                            <>
                              <Label htmlFor={`res-${c.id}`}>Opomba o rešitvi (obvezno ob odpravi napake)</Label>
                              <Textarea id={`res-${c.id}`} rows={2} value={form.resolutionNote} onChange={(e) => setForm({ ...form, resolutionNote: e.target.value })} placeholder="Kako je bila napaka odpravljena …" />
                            </>
                          ) : null}
                          {fotoOptions.length > 0 ? (
                            <>
                              <Label htmlFor={`foto-${c.id}`}>Dokazna fotografija (neobvezno)</Label>
                              <Select value={form.photoId || 'none'} onValueChange={(v) => setForm({ ...form, photoId: v === 'none' ? '' : v })}>
                                <SelectTrigger id={`foto-${c.id}`} className="h-9"><SelectValue placeholder="Izberi FOTO s tega naloga" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">— brez dokaza —</SelectItem>
                                  {fotoOptions.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </>
                          ) : null}
                          <div className="flex gap-2">
                            <Button size="sm" className="h-9 flex-1" disabled={busy === c.id} onClick={() => void potrdiPending()}>
                              {busy === c.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check aria-hidden />} Potrdi
                            </Button>
                            <Button size="sm" variant="outline" className="h-9" onClick={() => setPending(null)}>Prekliči</Button>
                          </div>
                        </div>
                      ) : canWrite ? (
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                          <Button size="sm" variant="outline" className="h-9 justify-start gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400" disabled={busy === c.id} onClick={() => zacetiStatus(c, 'V_REDU')}>
                            <Check className="size-3.5" aria-hidden /> V redu
                          </Button>
                          <Button size="sm" variant="outline" className="h-9 justify-start gap-1.5" disabled={busy === c.id} onClick={() => zacetiStatus(c, 'CAKA_PREVERJANJE')}>
                            <Undo2 className="size-3.5" aria-hidden /> Čaka
                          </Button>
                          <Button size="sm" variant="outline" className="h-9 justify-start gap-1.5 border-red-300 text-red-700 hover:bg-red-50 dark:text-red-400" disabled={busy === c.id} onClick={() => zacetiStatus(c, 'NAPAKA')}>
                            <X className="size-3.5" aria-hidden /> Napaka
                          </Button>
                          <Button size="sm" variant="outline" className="h-9 justify-start gap-1.5" disabled={busy === c.id} onClick={() => zacetiStatus(c, 'NI_RELEVANTNO')}>
                            <Minus className="size-3.5" aria-hidden /> Ni relevantno
                          </Button>
                        </div>
                      ) : null}

                      {c.deviations.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {c.deviations.map((d) => (
                            <DeviationCard key={d.id} d={d} canWrite={canWrite} busy={busy === d.id} users={users} canPickUsers={canPickUsers}
                              onResi={() => void resi(d.id)}
                              actionForm={actionForm?.deviationId === d.id ? actionForm : null}
                              onActionForm={(f) => setActionForm(f ? { deviationId: d.id, description: '', assigneeId: '', dueAt: '' } : null)}
                              onActionFormChange={setActionForm}
                              onUstvariUkrep={() => void ustvariUkrep()}
                              onNaprejUkrep={(a) => void naprejUkrep(a)} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {manualDeviations.length > 0 ? (
            <div className="mt-3 space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Odstopanja brez točke (izvedba ≠ načrt)</h4>
              {manualDeviations.map((d) => (
                <DeviationCard key={d.id} d={d} canWrite={canWrite} busy={busy === d.id} users={users} canPickUsers={canPickUsers}
                  onResi={() => void resi(d.id)}
                  actionForm={actionForm?.deviationId === d.id ? actionForm : null}
                  onActionForm={(f) => setActionForm(f ? { deviationId: d.id, description: '', assigneeId: '', dueAt: '' } : null)}
                  onActionFormChange={setActionForm}
                  onUstvariUkrep={() => void ustvariUkrep()}
                  onNaprejUkrep={(a) => void naprejUkrep(a)} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

function statusLabel (s: string): string {
  return ({ NI_ZACETO: 'Ni začeto', V_REDU: 'V redu', NAPAKA: 'Napaka', NI_RELEVANTNO: 'Ni relevantno', CAKA_PREVERJANJE: 'Čaka na preverjanje' } as Record<string, string>)[s] ?? s
}

// ── kartica odstopanja + ukrepi ─────────────────────────────────────────────

function DeviationCard ({ d, canWrite, busy, users, canPickUsers, onResi, actionForm, onActionForm, onActionFormChange, onUstvariUkrep, onNaprejUkrep }: {
  d: QaDeviationRow
  canWrite: boolean
  busy: boolean
  users: { id: string; name: string }[]
  canPickUsers: boolean
  onResi: () => void
  actionForm: { deviationId: string; description: string; assigneeId: string; dueAt: string } | null
  onActionForm: (open: boolean) => void
  onActionFormChange: (f: { deviationId: string; description: string; assigneeId: string; dueAt: string }) => void
  onUstvariUkrep: () => void
  onNaprejUkrep: (a: QaActionRow) => void
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-900 dark:bg-amber-950/40">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-xs font-medium leading-snug">{d.reason}</p>
        {d.resolvedAt ? (
          <span className="shrink-0 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">odpravljeno {fmtDateTime(d.resolvedAt)}</span>
        ) : (
          <span className="shrink-0 text-[10px] font-semibold text-red-600">NEREŠENO</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {d.impactSafety ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">VARNOST</span> : null}
        {d.impactMaterial ? <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300">MATERIAL</span> : null}
        {d.impactPrice ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">CENA</span> : null}
        {d.location ? <span className="text-[10px] text-muted-foreground">📍 {d.location}</span> : null}
      </div>

      {d.actions.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {d.actions.map((a) => {
            const idx = ACTION_FLOW.indexOf(a.status)
            const next = idx >= 0 && idx < ACTION_FLOW.length - 1 ? ACTION_FLOW[idx + 1] : null
            return (
              <li key={a.id} className="flex items-start justify-between gap-2 rounded bg-background/80 px-2 py-1.5">
                <span className="min-w-0">
                  <span className="block break-words text-[11px] leading-snug">{a.description}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {a.assignee ? `${a.assignee.name}` : 'brez odgovorne osebe'}{a.dueAt ? ` · rok ${fmtDateTime(a.dueAt)}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <StatusBadge status={a.status} />
                  {canWrite && next ? (
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={busy} onClick={() => onNaprejUkrep(a)}>
                      → {next === 'V_OBRAVNAVI' ? 'obdelava' : next === 'ODRAVLJENO' ? 'odpravljeno' : 'preverjeno'}
                    </Button>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}

      {canWrite ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!d.resolvedAt ? (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={onResi}>
              <Check className="size-3" aria-hidden /> Odpravi odstopanje
            </Button>
          ) : null}
          {actionForm?.deviationId === d.id ? (
            <div className="w-full space-y-1.5 rounded border bg-background p-2">
              <Label htmlFor={`adesc-${d.id}`} className="text-[11px]">Korektivni ukrep — opis (obvezno)</Label>
              <Input id={`adesc-${d.id}`} className="h-8 text-xs" value={actionForm.description}
                onChange={(e) => onActionFormChange({ ...actionForm, description: e.target.value })} placeholder="Kaj je treba storiti …" />
              {canPickUsers ? (
                <>
                  <Label htmlFor={`aasg-${d.id}`} className="text-[11px]">Odgovorna oseba</Label>
                  <Select value={actionForm.assigneeId || 'none'} onValueChange={(v) => onActionFormChange({ ...actionForm, assigneeId: v === 'none' ? '' : v })}>
                    <SelectTrigger id={`aasg-${d.id}`} className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— ne določeno —</SelectItem>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              ) : null}
              <Label htmlFor={`adue-${d.id}`} className="text-[11px]">Rok</Label>
              <Input id={`adue-${d.id}`} type="date" className="h-8 text-xs" value={actionForm.dueAt}
                onChange={(e) => onActionFormChange({ ...actionForm, dueAt: e.target.value })} />
              <div className="flex gap-1.5">
                <Button size="sm" className="h-7 text-[11px]" disabled={busy} onClick={onUstvariUkrep}>
                  <Plus className="size-3" aria-hidden /> Dodaj ukrep
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => onActionForm(false)}>Prekliči</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onActionForm(true)}>
              <Plus className="size-3" aria-hidden /> Korektivni ukrep
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ── Primopredaja ─────────────────────────────────────────────────────────────

interface DiffData {
  primerjava?: { key: string; nacrtCm: number | null; izvedenoCm: number | null; ujema: boolean | null }[]
  nacrtovano?: { source: string }[]
  izvedeno?: { source: string }[]
}
type PhotosData = { id: string; stage: string }[]

export function HandoverSection ({ woId, canWrite, onTransitioned }: {
  woId: string
  canWrite: boolean
  onTransitioned: () => Promise<void> | void
}) {
  const token = useAppStore((s) => s.token)
  const { toast } = useToast()
  const ho = useApi<{ data: { latest: HandoverRow | null; versions: { id: string; version: number; status: string; createdAt: string }[] } }>(`/api/nalog/${woId}/handover`)
  const [busy, setBusy] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [signedBy, setSignedBy] = useState('')
  const [remark, setRemark] = useState('')
  const [showSign, setShowSign] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  const latest = ho.data?.data.latest ?? null
  const versions = ho.data?.data.versions ?? []
  const diff: DiffData = (() => { try { return JSON.parse(latest?.diffJson ?? '{}') } catch { return {} } })()
  const photos: PhotosData = (() => { try { return JSON.parse(latest?.photosJson ?? '[]') } catch { return [] } })()
  const photosBy = (stage: string) => photos.filter((p) => p.stage === stage).length

  async function zgradi (): Promise<void> {
    setBusy('build')
    try {
      await apiPost(`/api/nalog/${woId}/handover`, summary.trim() ? { summary: summary.trim() } : {})
      toast({ title: 'Primopredajno poročilo zgrajeno.', description: 'Primerjava, fotografije in kontrole so vzete iz istih podatkov naloga.' })
      setSummary('')
      await Promise.all([ho.reload(), onTransitioned()])
    } catch (e) {
      toast({ title: 'Izgradnja ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function patch (action: string, body: Record<string, unknown>, title: string): Promise<void> {
    setBusy(action)
    try {
      await apiPatch(`/api/nalog/${woId}/handover`, { action, ...body })
      toast({ title })
      await Promise.all([ho.reload(), onTransitioned()])
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function podpisi (): Promise<void> {
    if (!canvasRef.current || !hasInk) {
      toast({ title: 'Stranka naj podpiše na zaslonu.', variant: 'destructive' }); return
    }
    if (signedBy.trim().length < 3) {
      toast({ title: 'Zapiši ime/identiteto podpisnika.', variant: 'destructive' }); return
    }
    const signatureDataUrl = canvasRef.current.toDataURL('image/jpeg', 0.85)
    await patch('sign', { signatureDataUrl, signedBy: signedBy.trim(), ...(remark.trim() ? { remark: remark.trim() } : {}) }, 'Potrditev stranke zabeležena.')
    setHasInk(false); setResetKey((k) => k + 1); setSignedBy(''); setRemark(''); setShowSign(false)
  }

  async function izvoziPdf (): Promise<void> {
    if (!latest || !token) return
    setBusy('pdf')
    try {
      const res = await fetch(`/api/pdf/handover/${latest.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? `Napaka strežnika (${res.status}).`)
      }
      const blob = await res.blob()
      if (!blob.type.includes('pdf')) throw new Error('Odgovor ni veljaven PDF.')
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      toast({ title: 'Izvoz PDF ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  if (ho.loading && !latest && versions.length === 0) return <LoadingRows rows={1} />
  if (ho.error) return <ErrorBox error={ho.error} />

  return (
    <section aria-label="Primopredaja" className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <FileText className="size-4 text-roksal-amber" aria-hidden /> Primopredaja
        </h3>
        {latest ? <StatusBadge status={latest.status} /> : null}
      </div>

      {!latest ? (
        canWrite ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Zgradi poročilo iz istih podatkov: kontrolne točke, odstopanja, primerjava načrtovano/izvedeno (seg-N) in fotografije pred/med/po.</p>
            <Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Povzetek izvedbe (kaj je bilo narejeno, dogovori …)" aria-label="Povzetek izvedbe" />
            <Button className="h-11 w-full sm:w-auto" disabled={busy === 'build'} onClick={() => void zgradi()}>
              {busy === 'build' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
              Zgradi primopredajno poročilo
            </Button>
          </div>
        ) : (
          <EmptyState icon={FileText} title="Poročilo še ni zgrajeno" desc="Zgradi ga monter ali pisarna ob predaji." />
        )
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Verzija {latest.version} · zgrajeno {fmtDateTime(latest.createdAt)}
            {versions.length > 1 ? ` · zgodovina: ${versions.length} verzij` : ''}
          </p>

          {latest.status === 'NEPOPOLNA' ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <TriangleAlert className="mr-1 inline size-3.5" aria-hidden />
              {latest.monterConfirmedAt && latest.customerSignedAt
                ? 'Poročilo je NEPOPOLNO: obstajajo kritične nerešene zadeve (zaključek je blokiran).'
                : 'Poročilo je NEPOPOLNO: manjka potrditev monterja ali stranke, ali obstajajo kritične nerešene zadeve.'}
            </p>
          ) : null}
          {latest.status === 'POGOJNA' ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <TriangleAlert className="mr-1 inline size-3.5" aria-hidden />
              Primopredaja je POGOJNA: odprte zadeve so izpisane v poročilu.
            </p>
          ) : null}

          {(diff.primerjava?.length ?? 0) > 0 ? (
            <div>
              <h4 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Načrtovano / izvedeno (seg-N)</h4>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Segment</th>
                      <th className="px-2 py-1.5 font-medium">Načrt</th>
                      <th className="px-2 py-1.5 font-medium">Izvedeno</th>
                      <th className="px-2 py-1.5 font-medium">Ujema</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(diff.primerjava ?? []).map((p) => (
                      <tr key={p.key} className="border-b last:border-0">
                        <td className="px-2 py-1.5 font-medium">{p.key}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{p.nacrtCm != null ? `${Math.round(p.nacrtCm)} cm` : '—'}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{p.izvedenoCm != null ? `${Math.round(p.izvedenoCm)} cm` : '—'}</td>
                        <td className="px-2 py-1.5">
                          {p.ujema == null ? <span className="text-muted-foreground">—</span>
                            : p.ujema ? <span className="font-semibold text-emerald-700 dark:text-emerald-400">DA</span>
                              : <span className="font-semibold text-red-600">NE</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Viri: {diff.nacrtovano?.[0]?.source ?? '—'} / {diff.izvedeno?.[0]?.source ?? 'brez AS-INSTALLED dvojčka'}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">— brez primerjave segmentov (ni potrjenega tekača/dvojčka) —</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">📷 pred: {photosBy('PRED')}</span>
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">📷 med: {photosBy('MED')}</span>
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">📷 po: {photosBy('PO')}</span>
          </div>

          {latest.summary ? <p className="whitespace-pre-line rounded-lg bg-muted/40 px-2.5 py-2 text-xs">{latest.summary}</p> : null}

          {/* potrditvi */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border p-2.5">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Potrditev monterja</h4>
              {latest.monterConfirmedAt ? (
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCheck className="mr-1 inline size-3.5" aria-hidden />
                  {latest.monterConfirmedBy?.name ?? '—'} · {fmtDateTime(latest.monterConfirmedAt)}
                </p>
              ) : canWrite ? (
                <Button size="sm" className="mt-1.5 h-8 w-full text-[11px]" disabled={busy === 'monter-confirm'} onClick={() => void patch('monter-confirm', {}, 'Potrditev monterja zabeležena.')}>
                  {busy === 'monter-confirm' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCheck className="size-3.5" aria-hidden />} Potrdi izvedbo
                </Button>
              ) : <p className="mt-1 text-xs text-muted-foreground">— ni potrjeno —</p>}
            </div>
            <div className="rounded-lg border p-2.5">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Potrditev stranke</h4>
              {latest.customerSignedAt ? (
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    <PenLine className="mr-1 inline size-3.5" aria-hidden />
                    {latest.customerSignedBy ?? '—'} · {fmtDateTime(latest.customerSignedAt)}
                  </p>
                  {latest.customerRemark ? <p className="rounded bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">Pripomba: {latest.customerRemark}</p> : null}
                </div>
              ) : canWrite ? (
                showSign ? (
                  <div className="mt-1.5 space-y-1.5">
                    <SignaturePad canvasRef={canvasRef} onChange={setHasInk} resetKey={resetKey} hasInk={hasInk} />
                    <Input className="h-8 text-xs" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Ime/identiteta podpisnika" aria-label="Ime podpisnika" />
                    <Textarea rows={2} className="text-xs" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Pripomba stranke (neobvezno — postane sledljiv zapis)" aria-label="Pripomba stranke" />
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-8 flex-1 text-[11px]" disabled={busy === 'sign'} onClick={() => void podpisi()}>
                        {busy === 'sign' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PenLine className="size-3.5" aria-hidden />} Podpiši primopredajo
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => { setShowSign(false); setHasInk(false); setResetKey((k) => k + 1) }}>Prekliči</Button>
                    </div>
                    <p className="text-[10px] leading-snug text-muted-foreground">Podpis na zaslonu je zabeležena potrditev v sistemu — ni kvalificiran elektronski podpis.</p>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="mt-1.5 h-8 w-full text-[11px]" onClick={() => setShowSign(true)}>
                    <PenLine className="size-3.5" aria-hidden /> Podpis stranke
                  </Button>
                )
              ) : <p className="mt-1 text-xs text-muted-foreground">— ni podpisano —</p>}
            </div>
          </div>

          {latest.customerSignedAt && !latest.customerRemark && canWrite ? (
            <div className="flex gap-1.5">
              <Input className="h-8 flex-1 text-xs" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Dodaj pripombo stranke …" aria-label="Pripomba stranke" />
              <Button size="sm" variant="outline" className="h-8 text-[11px]" disabled={!remark.trim() || busy === 'remark'}
                onClick={() => { void patch('remark', { remark: remark.trim() }, 'Pripomba stranke zabeležena.'); setRemark('') }}>
                Zabeleži
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-[11px]" disabled={busy === 'pdf'} onClick={() => void izvoziPdf()}>
              {busy === 'pdf' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />} Izvozi PDF
            </Button>
            {canWrite ? (
              <Button size="sm" variant="outline" className="h-8 text-[11px]" disabled={busy === 'build'} onClick={() => void zgradi()}>
                {busy === 'build' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CalendarClock className="size-3.5" aria-hidden />}
                Zgradi novo verzijo
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

// ── podpis na zaslonu (canvas → dataURL; vzorec signatura.tsx R459) ─────────

function SignaturePad ({ canvasRef, onChange, resetKey, hasInk }: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onChange: (hasInk: boolean) => void
  resetKey: number
  hasInk: boolean
}) {
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  function pos (e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  function start (e: React.PointerEvent<HTMLCanvasElement>) {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* sintetični dogodki */ }
    drawing.current = true
    last.current = pos(e)
  }
  function move (e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = pos(e)
    const from = last.current
    if (from) {
      ctx.strokeStyle = '#1d2b3e'
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      onChange(true)
    }
    last.current = p
  }
  function end () {
    drawing.current = false
    last.current = null
  }
  function clear () {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    onChange(false)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.scale(dpr, dpr)
    onChange(false)
  }, [resetKey])

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        className="h-24 w-full touch-none rounded-lg border bg-white"
        aria-label="Podpis stranke na zaslonu"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="flex justify-between">
        <span className="text-[10px] text-muted-foreground">Podpis s prstom ali miško</span>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={clear} disabled={!hasInk}>Počisti</Button>
      </div>
    </div>
  )
}

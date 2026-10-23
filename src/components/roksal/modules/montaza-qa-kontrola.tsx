'use client'

// MONTAŽA QA KONTROLA (R549): statusne kontrolne točke iz virov (playbook
// MONTAŽA + segmenti tekača + inženirska pravila) — dokazila, obrazci napak,
// odstopanja in korektivni ukrepi (izvlečeno bajtno-identično iz montaza-qa.tsx).

import { useEffect, useState } from 'react'
import { Check, ChevronDown, ClipboardCheck, Loader2, Minus, Plus, ShieldAlert, Undo2, X } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
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
import { ACTION_FLOW } from './montaza-qa-shared'
import type { QaActionRow, QaCheckRow, QaDeviationRow, QaResponse } from './montaza-qa-shared'
import { DeviationCard } from './montaza-qa-odstopanja'

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
          <AnimatedList className="space-y-1.5">
            {checks.map((c) => {
              const open = expanded === c.id
              return (
                <AnimatedListItem key={c.id} className="rounded-lg border">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 p-2.5 text-left"
                    aria-expanded={open}
                    onClick={() => { setExpanded(open ? null : c.id); setPending(null) }}
                  >
                    {c.critical ? <ShieldAlert className="mt-0.5 size-4 shrink-0 text-roksal-amber-text" aria-label="Kritična točka" /> : null}
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
                </AnimatedListItem>
              )
            })}
          </AnimatedList>

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

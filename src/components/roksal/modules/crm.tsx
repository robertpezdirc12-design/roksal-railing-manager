'use client'

// CRM — vodi in priložnosti s pipelineom (vrata crm.read; spremembe = crm.write)

import { useMemo, useState } from 'react'
import { ArrowRight, ChevronsRight, FolderPlus, Mail, Phone, Plus, Target, TrendingUp, UserRound, XCircle } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDate, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatCard, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { cn } from '@/lib/utils'

interface LeadRow {
  id: string; name: string; email: string | null; phone: string | null
  source: string; status: string; note: string | null; createdAt: string
  opportunities: { id: string; title: string; stage: string; value: number }[]
}

interface OpportunityRow {
  id: string; title: string; stage: string; value: number; probability: number
  expectedClose: string | null; note: string | null
  lead: { name: string } | null
}

const LEAD_FLOW = ['NOV', 'KONTAKTIRAN', 'KVALIFIKACIJAN', 'PRETVORJEN']
const LEAD_TERMINAL = ['PRETVORJEN', 'IZGUBLJEN']
const STAGES = ['KVALIFIKACIJA', 'PONUDBA', 'POGAJANJA', 'ZMAGOVALNA', 'IZGUBLJENA']
const SOURCES = [
  { value: 'SPLET', label: 'Splet' },
  { value: 'TELEFON', label: 'Telefon' },
  { value: 'PRIPOROČILO', label: 'Priporočilo' },
  { value: 'SEJEM', label: 'Sejem' },
  { value: 'VIZUALIZATOR', label: 'Vizualizator' },
]

export default function CrmModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [leadOpen, setLeadOpen] = useState(false)
  const crm = useApi<{ data: { leads: LeadRow[]; opportunities: OpportunityRow[] } }>('/api/crm')

  const canWrite = hasPerm(user?.perms, 'crm.write')
  const leads = crm.data?.data.leads ?? []
  const opportunities = crm.data?.data.opportunities ?? []

  const openOpps = useMemo(() => opportunities.filter((o) => o.stage !== 'IZGUBLJENA'), [opportunities])
  const pipelineValue = useMemo(() => openOpps.reduce((s, o) => s + o.value, 0), [openOpps])
  const weighted = useMemo(() => openOpps.reduce((s, o) => s + (o.value * o.probability) / 100, 0), [openOpps])

  async function patchLead (id: string, status: string) {
    try {
      await apiPatch(`/api/crm/${id}`, { kind: 'lead', status })
      await crm.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  /** Pretvorba voda v projekt (issue #1: korak 1–2 workflowa). */
  async function convertLead (id: string, name: string) {
    const title = window.prompt('Naslov novega projekta:', `Ograja — ${name}`)
    if (title === null) return
    try {
      const res = await apiPost<{ data: { project: { code: string; title: string } } }>(`/api/crm/${id}/pretvorba`, {
        title: title.trim() || undefined,
      })
      toast({
        title: 'Vod pretvorjen v projekt.',
        description: `${res.data.project.code} — ${res.data.project.title} (stranka ustvarjena/povezana).`,
      })
      await crm.reload()
    } catch (e) {
      toast({ title: 'Pretvorba ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  async function patchOpp (id: string, body: Record<string, unknown>) {
    try {
      await apiPatch(`/api/crm/${id}`, { kind: 'opportunity', ...body })
      await crm.reload()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4" data-tour="crm-module">
      <PageHeader
        title="CRM"
        desc="Vodi in priložnosti — pipeline prodaje"
        actions={canWrite ? (
          <Button size="sm" onClick={() => setLeadOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nov lead
          </Button>
        ) : null}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Skupna vrednost pipeline-a" value={fmtEUR(pipelineValue)} icon={Target} tone="amber" hint={`${openOpps.length} odprtih priložnosti`} />
        <StatCard label="Obtežena vrednost" value={fmtEUR(weighted)} icon={TrendingUp} hint="po verjetnostih" />
        <StatCard label="Vodi" value={leads.length} icon={UserRound} hint={`${leads.filter((l) => !LEAD_TERMINAL.includes(l.status)).length} v obdelavi`} />
      </div>

      <ErrorBox error={crm.error} />
      {crm.loading ? <LoadingRows /> : (
        <div className="space-y-6">
          {/* ── Vodi ── */}
          <section aria-label="Vodi" className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Vodi</h2>
            {!crm.error && leads.length === 0 ? (
              <EmptyState title="Ni vodov" desc="Dodajte nov lead iz spletne forme, telefona ali priporočila." icon={UserRound} />
            ) : (
              <Card>
                <CardContent className="max-h-96 overflow-y-auto p-0">
                  <AnimatedList className="divide-y">
                    {leads.map((l) => {
                      const idx = LEAD_FLOW.indexOf(l.status)
                      const next = idx >= 0 && idx < LEAD_FLOW.length - 1 ? LEAD_FLOW[idx + 1] : null
                      const terminal = LEAD_TERMINAL.includes(l.status)
                      return (
                        <AnimatedListItem key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{l.name}</span>
                              <StatusBadge status={l.status} />
                              {/* R580: kontrast — muted-foreground na bg-secondary je 4,12:1 (pod AA); secondary-foreground je 9,2:1 */}
                              <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                                {SOURCES.find((s) => s.value === l.source)?.label ?? l.source}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              {l.email ? <span className="inline-flex items-center gap-1"><Mail className="size-3" aria-hidden />{l.email}</span> : null}
                              {l.phone ? <span className="inline-flex items-center gap-1"><Phone className="size-3" aria-hidden />{l.phone}</span> : null}
                              <span>{fmtDate(l.createdAt)}</span>
                              {l.opportunities.length > 0 ? <span>{l.opportunities.length} priložnosti</span> : null}
                            </div>
                            {l.note ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/90">{l.note}</p> : null}
                          </div>
                          {canWrite && !terminal ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                              {next ? (
                                <Button size="sm" variant="outline" onClick={() => void patchLead(l.id, next)}>
                                  <ArrowRight className="size-3.5" aria-hidden />
                                  <StatusBadgeInline status={next} />
                                </Button>
                              ) : null}
                              <Button
                                size="sm" variant="outline" className="border-roksal-amber/50 text-roksal-amber hover:bg-amber-50 hover:text-roksal-amber dark:hover:bg-amber-950/30"
                                onClick={() => void convertLead(l.id, l.name)} aria-label={`Pretvori vod ${l.name} v projekt`}
                              >
                                <FolderPlus className="size-3.5" aria-hidden /> V projekt
                              </Button>
                              <Button
                                size="sm" variant="ghost" className="text-red-600 hover:text-red-700 dark:text-red-400"
                                onClick={() => void patchLead(l.id, 'IZGUBLJEN')} aria-label={`Označi ${l.name} kot izgubljen`}
                              >
                                <XCircle className="size-3.5" aria-hidden /> Izgubljen
                              </Button>
                            </div>
                          ) : null}
                        </AnimatedListItem>
                      )
                    })}
                  </AnimatedList>
                </CardContent>
              </Card>
            )}
          </section>

          {/* ── Priložnosti (pipeline) ── */}
          <section aria-label="Priložnosti" className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Priložnosti — pipeline</h2>
            {!crm.error && opportunities.length === 0 ? (
              <EmptyState title="Ni priložnosti" desc="Priložnosti nastanejo iz kvalificiranih vodov." icon={Target} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {STAGES.map((stage) => {
                  const cards = opportunities.filter((o) => o.stage === stage)
                  const sum = cards.reduce((s, o) => s + o.value, 0)
                  return (
                    <div key={stage} className="flex min-w-0 flex-col rounded-xl border bg-secondary/30">
                      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                        <StatusBadge status={stage} />
                        <span className="text-xs text-muted-foreground">{cards.length} · {fmtEUR(sum)}</span>
                      </div>
                      <AnimatedList className="flex-1 space-y-2 p-2">
                        {cards.map((o) => {
                          const idx = STAGES.indexOf(o.stage)
                          const next = idx < STAGES.length - 2 ? STAGES[idx + 1] : null // ZMAGOVALNA je predzadnja
                          return (
                            <AnimatedListItem key={o.id}>
                              <Card className="border-border/70 shadow-none">
                                <CardContent className="space-y-1.5 p-3">
                                  <div className="text-sm font-semibold leading-snug">{o.title}</div>
                                  {o.lead ? <div className="text-xs text-muted-foreground">{o.lead.name}</div> : null}
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="font-bold">{fmtEUR(o.value)}</span>
                                    <span className={cn('text-xs font-medium', o.probability >= 60 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                                      {o.probability} %
                                    </span>
                                  </div>
                                  {o.expectedClose ? <div className="text-[11px] text-muted-foreground">Pričakovani zaključek: {fmtDate(o.expectedClose)}</div> : null}
                                  {canWrite ? (
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                      {next ? (
                                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void patchOpp(o.id, { stage: next })}>
                                          <ChevronsRight className="size-3.5" aria-hidden />
                                          {next === 'KVALIFIKACIJA' ? 'Kvalifikacija' : next === 'PONUDBA' ? 'Ponudba' : next === 'POGAJANJA' ? 'Pogajanja' : 'Zmagovitna'}
                                        </Button>
                                      ) : null}
                                      {stage !== 'IZGUBLJENA' && stage !== 'ZMAGOVALNA' ? (
                                        <Button
                                          size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-600 dark:text-red-400"
                                          onClick={() => void patchOpp(o.id, { stage: 'IZGUBLJENA' })}
                                        >
                                          Izgubljena
                                        </Button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </CardContent>
                              </Card>
                            </AnimatedListItem>
                          )
                        })}
                      </AnimatedList>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* nov lead */}
      <Dialog open={leadOpen} onOpenChange={setLeadOpen}>
        <NewLeadDialog
          onClose={() => setLeadOpen(false)}
          onCreated={async () => { setLeadOpen(false); await crm.reload() }}
        />
      </Dialog>
    </div>
  )
}

function StatusBadgeInline ({ status }: { status: string }) {
  const labels: Record<string, string> = { KONTAKTIRAN: 'Kontaktiraj', KVALIFIKACIJAN: 'Kvalificiraj', PRETVORJEN: 'Pretvori' }
  return <span>{labels[status] ?? status}</span>
}

function NewLeadDialog ({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('SPLET')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    if (!name.trim()) { toast({ title: 'Ime kontakta je obvezno.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/crm', { name, email, phone, source, note })
      toast({ title: 'Lead dodan.', description: name })
      await onCreated()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nov lead</DialogTitle>
        <DialogDescription>Svež kontakt iz spletne forme, telefona ali priporočila.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="nl-name">Ime</Label>
          <Input id="nl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Simon Vidmar" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nl-email">E-pošta</Label>
            <Input id="nl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ime@primer.si" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nl-phone">Telefon</Label>
            <Input id="nl-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="041 234 567" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Vir</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger aria-label="Vir"><SelectValue /></SelectTrigger>
            <SelectContent>{SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="nl-note">Opomba</Label>
          <Textarea id="nl-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kaj zanima stranko …" rows={3} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Dodajam …' : 'Dodaj lead'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

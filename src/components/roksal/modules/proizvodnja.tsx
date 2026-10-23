'use client'

// PROIZVODNJA — proizvodni nalogi s prehodi statusov (vrata production.read; prehodi = production.manage)
// R434: kontrola kakovosti (QC) — dialog s kontrolnimi točkami po nalogu (/api/qc).
// R444 (issue #7 §8 PROIZVODNJA): Priprava materiala — za proizvodni nalog pokaže
// kosovnice (BOM) povezanega projekta (ProductionOrder NI direktno vezan na BOM —
// povezava teče prek projekta paketov; informativni pregled, rezervacija/picking
// ostajata v Zaloga → Kosovnice).

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, BadgeCheck, ClipboardCheck, Factory, Layers, Package, Plus } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDate, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { cn } from '@/lib/utils'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'

interface ProductionRow {
  id: string; code: string; title: string; status: string; dueAt: string | null; note: string | null
  project: { id: string; code: string; title: string } | null
}

interface BomRow {
  id: string; code: string; status: string; qty: number; unit: string
  product: { sku: string; name: string }
  package: { code: string; name: string } | null
  lines: { id: string; item: { sku: string; name: string } }[]
}

interface QcCheckRow {
  id: string; item: string; result: string; note: string | null; createdAt: string
  user: { name: string } | null
}

interface ProjectOption { id: string; code: string; title: string }

// Linearni tok: NAVRTEN → V_IZDELAVI → DOKONCAN → ODPOSLAN
const FLOW = ['NAVRTEN', 'V_IZDELAVI', 'DOKONCAN', 'ODPOSLAN'] as const
const NEXT_LABEL: Record<string, string> = {
  NAVRTEN: 'V izdelavo',
  V_IZDELAVI: 'Dokončaj',
  DOKONCAN: 'Odpošlji',
}

// QC (R434)
const QC_LABEL: Record<string, string> = { OK: 'Ustrezno', NOK: 'Neustrezno', NA: 'Ni relevantno', V_TEKU: 'V teku' }
const QC_CLS: Record<string, string> = {
  OK: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  NOK: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  NA: 'bg-secondary text-secondary-foreground',
  V_TEKU: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
}
const QC_RESULTS = ['OK', 'NOK', 'NA', 'V_TEKU'] as const

// Prefab elementi (R465): statusni tok lističa — linearno, brez preskakovanja
const ELEMENT_FLOW = ['NAVRTEN', 'REZANJE', 'IZDELAVA', 'POVRSINA', 'DOKONCAN'] as const
const ELEMENT_NEXT_LABEL: Record<string, string> = {
  NAVRTEN: 'V rezanje',
  REZANJE: 'V izdelavo',
  IZDELAVA: 'Na površino',
  POVRSINA: 'Dokončaj',
}

interface ElementRow {
  id: string; key: string; label: string
  lengthCm: number | null; heightCm: number | null; posts: number | null
  ral: string | null; produkt: string | null
  status: string; note: string | null; updatedAt: string; user: string | null
}

interface ElementsPayload {
  order: { id: string; code: string; title: string; status: string; projectId: string | null }
  sourceSnapshotId: string | null; snapshotVersion: number | null
  progress: { total: number; done: number; pct: number }
  elements: ElementRow[]
}

export default function ProizvodnjaModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [qcFor, setQcFor] = useState<ProductionRow | null>(null)
  const list = useApi<{ data: ProductionRow[] }>('/api/production')
  const projects = useApi<{ data: ProjectOption[] }>(createOpen ? '/api/projects?limit=200' : null, [createOpen])
  const qc = useApi<{ data: QcCheckRow[] }>(qcFor ? `/api/qc?productionOrderId=${qcFor.id}` : null, [qcFor?.id])

  const canManage = hasPerm(user?.perms, 'production.manage')
  const canSeeBom = hasPerm(user?.perms, 'inventory.read')

  const rows = useMemo(() => {
    const all = list.data?.data ?? []
    return [...all].sort((a, b) => {
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return 0
    })
  }, [list.data])

  async function advance (order: ProductionRow) {
    const idx = FLOW.indexOf(order.status as (typeof FLOW)[number])
    const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null
    if (!next) return
    try {
      await apiPatch(`/api/production/${order.id}`, { status: next })
      toast({ title: `${order.code}: ${NEXT_LABEL[order.status] ?? next} ✓`, description: `Status: ${order.status} → ${next}` })
      await list.reload()
    } catch (e) {
      toast({ title: 'Napaka pri prehodu', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  function closeQc () { setQcFor(null) }

  const qcRows = qc.data?.data ?? []
  const qcNok = qcRows.filter((c) => c.result === 'NOK').length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Proizvodnja"
        desc="Proizvodni nalogi — od načrta do odpošiljanja"
        actions={canManage ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nov nalog
          </Button>
        ) : null}
      />

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && rows.length === 0 ? (
        <EmptyState title="Ni proizvodnih nalogov" desc="Ustvarite prvi nalog iz projekta ali kataloga." icon={Factory} />
      ) : (
        <Card>
          <CardContent className="max-h-[32rem] overflow-y-auto p-0">
            <AnimatedList className="divide-y">
              {rows.map((o) => {
                const overdue = o.dueAt ? new Date(o.dueAt).getTime() < Date.now() && o.status !== 'ODPOSLAN' : false
                const idx = FLOW.indexOf(o.status as (typeof FLOW)[number])
                const hasNext = idx >= 0 && idx < FLOW.length - 1
                return (
                  <AnimatedListItem key={o.id} className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-secondary/40" onClick={() => setQcFor(o)}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-roksal-amber-text">{o.code}</span>
                        <StatusBadge status={o.status} />
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <ClipboardCheck className="size-3" aria-hidden /> QC
                        </span>
                      </div>
                      <div className="mt-1 font-semibold leading-snug">{o.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{o.project ? `${o.project.code} · ${o.project.title}` : 'Brez projekta'}</span>
                        <span className={cn(overdue && 'font-semibold text-red-600 dark:text-red-400')}>
                          Rok: {o.dueAt ? fmtDate(o.dueAt) : '—'}
                          {overdue ? <span className="ml-1 inline-flex items-center gap-0.5"><AlertTriangle className="size-3" aria-hidden />zamujen</span> : null}
                        </span>
                      </div>
                    </div>
                    {canManage && hasNext ? (
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => void advance(o)}>
                        <ArrowRight className="size-3.5" aria-hidden /> {NEXT_LABEL[o.status]}
                      </Button>
                    ) : null}
                  </AnimatedListItem>
                )
              })}
            </AnimatedList>
          </CardContent>
        </Card>
      )}

      {/* kontrola kakovosti — R434 */}
      <Dialog open={!!qcFor} onOpenChange={(o) => { if (!o) closeQc() }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          {/* dostopnost: naslov+opis tudi ko qcFor=null med izhodno animacijo (Radix) */}
          {!qcFor ? (
            <>
              <DialogTitle className="sr-only">Kontrola kakovosti</DialogTitle>
              <DialogDescription className="sr-only">Podrobnosti kontrole kakovosti proizvodnega naloga.</DialogDescription>
            </>
          ) : null}
          {qcFor ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-roksal-amber-text">{qcFor.code}</span>
                  <StatusBadge status={qcFor.status} />
                </div>
                <DialogTitle>Kontrola kakovosti — {qcFor.code}</DialogTitle>
                <DialogDescription>
                  {qcFor.title}
                  {qcFor.project ? ` · ${qcFor.project.code}` : ''}
                </DialogDescription>
              </DialogHeader>

              {/* Prefab elementi iz AS-PRODUCED dvojčka (R465, issue #4 §3) */}
              <PrefabSection order={qcFor} canManage={canManage} />

              {/* Priprava materiala — kosovnice projekta (R444, issue #7 §8 PROIZVODNJA) */}
              {canSeeBom ? (
                <MaterialPrepSection projectId={qcFor.project?.id ?? null} projectCode={qcFor.project?.code ?? null} />
              ) : null}

              <ErrorBox error={qc.error} />
              {qc.loading ? <LoadingRows rows={3} /> : !qc.error && qcRows.length === 0 ? (
                <EmptyState title="Ni kontrol" desc="Dodajte prvo kontrolno točko (npr. vertikalnost, zvari, premaz)." icon={ClipboardCheck} />
              ) : !qc.error ? (
                <div className="max-h-72 overflow-y-auto rounded-xl border">
                  <AnimatedList className="divide-y">
                    {qcRows.map((c) => (
                      <AnimatedListItem key={c.id} className="flex items-start justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium leading-snug">{c.item}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {fmtDateTime(c.createdAt)} · {c.user?.name ?? 'sistem'}
                            {c.note ? ` · ${c.note}` : ''}
                          </div>
                        </div>
                        <Badge className={QC_CLS[c.result] ?? ''}>{QC_LABEL[c.result] ?? c.result}</Badge>
                      </AnimatedListItem>
                    ))}
                  </AnimatedList>
                </div>
              ) : null}

              {qcRows.length > 0 ? (
                <p className={cn('text-xs', qcNok > 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                  {qcNok > 0
                    ? `⚠ ${qcNok} neustreznih kontrol — nalog zahteva ponovno obdelavo.`
                    : 'Vse kontrole ustrezne.'}
                </p>
              ) : null}

              {canManage ? (
                <QcAddForm orderId={qcFor.id} onSaved={async () => { await qc.reload() }} />
              ) : (
                <p className="text-xs text-muted-foreground">Dodajanje kontrol zahteva pravico production.manage.</p>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* nov proizvodni nalog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NewOrderDialog
          projects={projects.data?.data ?? []}
          projectsLoading={projects.loading}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await list.reload() }}
        />
      </Dialog>
    </div>
  )
}

function NewOrderDialog ({ projects, projectsLoading, onClose, onCreated }: {
  projects: ProjectOption[]
  projectsLoading: boolean
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('none')
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    if (!title.trim()) { toast({ title: 'Naslov naloga je obvezen.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      const res = await apiPost<{ data: ProductionRow }>('/api/production', {
        title,
        projectId: projectId === 'none' ? null : projectId,
        dueAt: dueAt || null,
      })
      toast({ title: 'Proizvodni nalog ustvarjen.', description: `${res.data.code} — ${title}` })
      setTitle(''); setDueAt('')
      await onCreated()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nov proizvodni nalog</DialogTitle>
        <DialogDescription>Kodo PR-&lt;leto&gt;-&lt;zap&gt; določi sistem.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="po-title">Naslov</Label>
          <Input id="po-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="npr. Izdelava segmentov ograje" />
        </div>
        <div className="space-y-2">
          <Label>Projekt (neobvezno)</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger aria-label="Projekt"><SelectValue placeholder={projectsLoading ? 'Nalagam …' : 'Brez projekta'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brez projekta</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="po-due">Rok izdelave</Label>
          <Input id="po-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Prekliči</Button>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Ustvarjam …' : 'Ustvari nalog'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}

/** Obrazec za novo kontrolno točko (R434) — POST /api/qc. */
function QcAddForm ({ orderId, onSaved }: { orderId: string; onSaved: () => Promise<void> }) {
  const { toast } = useToast()
  const [item, setItem] = useState('')
  const [result, setResult] = useState<string>('OK')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit () {
    if (!item.trim()) { toast({ title: 'Kontrolna točka je obvezna.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/qc', { productionOrderId: orderId, item, result, note: note || undefined })
      toast({ title: 'Kontrola zabeležena.', description: `${item} — ${QC_LABEL[result]}` })
      setItem(''); setNote('')
      await onSaved()
    } catch (e) {
      toast({ title: 'Napaka', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2 rounded-xl border bg-secondary/40 p-3">
      <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Nova kontrola</h4>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Kontrolna točka, npr. Vertikalnost stebričev" aria-label="Kontrolna točka" />
        <Select value={result} onValueChange={setResult}>
          <SelectTrigger className="sm:w-40" aria-label="Rezultat kontrole"><SelectValue /></SelectTrigger>
          <SelectContent>
            {QC_RESULTS.map((r) => <SelectItem key={r} value={r}>{QC_LABEL[r]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opomba (neobvezno)" aria-label="Opomba kontrole" />
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void submit()} disabled={busy}>
          <BadgeCheck className="size-4" aria-hidden /> {busy ? 'Zapisujem …' : 'Zabeleži kontrolo'}
        </Button>
      </div>
    </div>
  )
}

/** Prefab elementi (R465 — issue #4 §3) — proizvodni lističi iz AS-PRODUCED dvojčka.
 *  Enota proizvodnje = segment (seg-N); mere so posnetek snapshot-a (vir: verzionirani dvojček). */
function PrefabSection ({ order, canManage }: { order: ProductionRow; canManage: boolean }) {
  const { toast } = useToast()
  const elements = useApi<{ data: ElementsPayload }>(`/api/production/${order.id}/elements`, [order.id])
  const [busy, setBusy] = useState<string | null>(null) // id elementa | 'generate'

  async function generate () {
    setBusy('generate')
    try {
      const res = await apiPost<{ data: { elements: { key: string }[]; snapshotVersion: number } }>('/api/production/from-twin', {
        productionOrderId: order.id,
        reason: `Prefab iz AS-PRODUCED — ${order.code}`,
      })
      toast({
        title: 'Prefab elementi ustvarjeni.',
        description: `${res.data.elements.length} lističev iz AS-PRODUCED dvojčka (v${res.data.snapshotVersion}).`,
      })
      await elements.reload()
    } catch (e) {
      toast({ title: 'Prefab ni mogoč.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  async function advanceEl (el: ElementRow) {
    const idx = ELEMENT_FLOW.indexOf(el.status as (typeof ELEMENT_FLOW)[number])
    const next = idx >= 0 && idx < ELEMENT_FLOW.length - 1 ? ELEMENT_FLOW[idx + 1] : null
    if (!next) return
    setBusy(el.id)
    try {
      await apiPatch(`/api/production/elements/${el.id}`, { status: next })
      await elements.reload()
    } catch (e) {
      toast({ title: 'Napaka pri prehodu', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  if (!order.project) {
    return (
      <div className="rounded-xl border bg-secondary/40 p-3">
        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Layers className="size-4 text-roksal-amber" aria-hidden /> Prefab elementi
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">Nalog ni vezan na projekt — prefab izhaja iz AS-PRODUCED dvojčka projekta.</p>
      </div>
    )
  }

  const rows = elements.data?.data.elements ?? []
  const progress = elements.data?.data.progress

  return (
    <div className="rounded-xl border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Layers className="size-4 text-roksal-amber" aria-hidden /> Prefab elementi — {order.project.code}
        </h4>
        {canManage && rows.length === 0 ? (
          <Button size="sm" variant="outline" onClick={() => void generate()} disabled={busy === 'generate'}>
            <Plus className="size-3.5" aria-hidden /> {busy === 'generate' ? 'Ustvarjam …' : 'Ustvari iz dvojčka'}
          </Button>
        ) : null}
      </div>

      <ErrorBox error={elements.error} />
      {elements.loading ? (
        <LoadingRows rows={1} />
      ) : !elements.error && rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {canManage
            ? 'Nalog še nima proizvodnih lističev — ustvarite jih iz zadnjega AS-PRODUCED snapshot-a digitalnega dvojčka.'
            : 'Nalog še nima proizvodnih lističev (ustvari jih vodja/proizvodnja z pravico production.manage).'}
        </p>
      ) : !elements.error ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>Vir: AS-PRODUCED dvojček{elements.data?.data.snapshotVersion ? ` v${elements.data.data.snapshotVersion}` : ''}</span>
            <span> napredek: {progress?.done ?? 0}/{progress?.total ?? rows.length} dokončanih</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress?.pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Napredek prefab proizvodnje">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress?.pct ?? 0}%` }} />
          </div>
          <AnimatedList className="mt-2 max-h-64 divide-y overflow-y-auto rounded-lg border bg-background/60">
            {rows.map((el) => {
              const idx = ELEMENT_FLOW.indexOf(el.status as (typeof ELEMENT_FLOW)[number])
              const hasNext = idx >= 0 && idx < ELEMENT_FLOW.length - 1
              return (
                <AnimatedListItem key={el.id} className="flex flex-wrap items-center gap-2.5 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">{el.key}</span>
                      <span className="truncate text-sm font-medium">{el.label}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                      {el.lengthCm != null ? <span>{(el.lengthCm / 100).toLocaleString('sl-SI', { maximumFractionDigits: 2 })} m</span> : null}
                      {el.heightCm != null ? <span>višina {Math.round(el.heightCm)} cm</span> : null}
                      {el.posts != null ? <span>{el.posts} stebrov</span> : null}
                      {el.ral ? <span>RAL {el.ral}</span> : null}
                      {el.produkt ? <span className="truncate">{el.produkt}</span> : null}
                    </div>
                  </div>
                  <StatusBadge status={el.status} />
                  {canManage && hasNext ? (
                    <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => void advanceEl(el)} disabled={busy === el.id}>
                      <ArrowRight className="size-3" aria-hidden /> {ELEMENT_NEXT_LABEL[el.status]}
                    </Button>
                  ) : null}
                </AnimatedListItem>
              )
            })}
          </AnimatedList>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Lističi so posnetek mer AS-PRODUCED dvojčka — vir resnice ostaja verzionirani snapshot (Dvojček). Material rezervirate prek kosovnic v Zaloga.
          </p>
        </>
      ) : null}
    </div>
  )
}

/** Priprava materiala (R444) — kosovnice projekta proizvodnega naloga (informativno). */
function MaterialPrepSection ({ projectId, projectCode }: { projectId: string | null; projectCode: string | null }) {
  const boms = useApi<{ data: BomRow[] }>(projectId ? `/api/bom?projectId=${projectId}` : null, [projectId])

  if (!projectId) {
    return (
      <div className="rounded-xl border bg-secondary/40 p-3">
        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Package className="size-4 text-roksal-amber" aria-hidden /> Priprava materiala
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">Nalog ni vezan na projekt — potrebe po materialu ni mogoče prikazati.</p>
      </div>
    )
  }

  const rows = boms.data?.data ?? []
  return (
    <div className="rounded-xl border bg-secondary/40 p-3">
      <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        <Package className="size-4 text-roksal-amber" aria-hidden /> Priprava materiala — kosovnice projekta {projectCode}
      </h4>
      <ErrorBox error={boms.error} />
      {boms.loading ? (
        <LoadingRows rows={1} />
      ) : !boms.error && rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Projekt še nima generiranih kosovnic (paketih projektov manjka BOM).</p>
      ) : !boms.error ? (
        <AnimatedList className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {rows.map((b) => (
            <AnimatedListItem key={b.id} className="flex items-center justify-between gap-3 rounded-lg bg-background/60 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  <span className="font-mono text-xs text-muted-foreground">{b.code}</span> · {b.product.name}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {b.package ? `${b.package.name} · ` : ''}{b.qty} {b.unit} · {b.lines.length} vrstic materiala
                </div>
              </div>
              <StatusBadge status={b.status} />
            </AnimatedListItem>
          ))}
        </AnimatedList>
      ) : null}
      {rows.length > 0 ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Rezervacijo materiala in picking listo izvedete v Zaloga → Kosovnice (informativni pregled za proizvodnjo).
        </p>
      ) : null}
    </div>
  )
}

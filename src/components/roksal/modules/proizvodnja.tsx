'use client'

// PROIZVODNJA — proizvodni nalogi s prehodi statusov (vrata production.read; prehodi = production.manage)

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Factory, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, apiPost, fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { cn } from '@/lib/utils'

interface ProductionRow {
  id: string; code: string; title: string; status: string; dueAt: string | null; note: string | null
  project: { code: string; title: string } | null
}

interface ProjectOption { id: string; code: string; title: string }

// Linearni tok: NAVRTEN → V_IZDELAVI → DOKONCAN → ODPOSLAN
const FLOW = ['NAVRTEN', 'V_IZDELAVI', 'DOKONCAN', 'ODPOSLAN'] as const
const NEXT_LABEL: Record<string, string> = {
  NAVRTEN: 'V izdelavo',
  V_IZDELAVI: 'Dokončaj',
  DOKONCAN: 'Odpošlji',
}

export default function ProizvodnjaModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const list = useApi<{ data: ProductionRow[] }>('/api/production')
  const projects = useApi<{ data: ProjectOption[] }>(createOpen ? '/api/projects?limit=200' : null, [createOpen])

  const canManage = hasPerm(user?.perms, 'production.manage')

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
            <ul className="divide-y">
              {rows.map((o) => {
                const overdue = o.dueAt ? new Date(o.dueAt).getTime() < Date.now() && o.status !== 'ODPOSLAN' : false
                const idx = FLOW.indexOf(o.status as (typeof FLOW)[number])
                const hasNext = idx >= 0 && idx < FLOW.length - 1
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-roksal-amber">{o.code}</span>
                        <StatusBadge status={o.status} />
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
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

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

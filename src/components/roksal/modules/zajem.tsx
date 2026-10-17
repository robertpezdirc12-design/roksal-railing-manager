'use client'

// ZAJEM — ROKSAL REALITY CAPTURE QA (R461 — issue #16)
// Terenska konzola vodenega zajema: LIVE COVERAGE MAP (§1), vodena ruta (§2),
// drift (§3), multi-reference mreža (§4), zunanji pogoji (§16), prekinitev in
// nadaljevanje (§17) ter zaključek z VRATI → AS-MEASURED snapshot (§9).
// Nadstropje nad tekačem (R460) — geometrija ostaja tam.
// R465 (issue #4 §2): CAPTURE REPLAY — predvajanje zajema po korakih za
// revizijo/izobraževanje (read-only, kumulativna pokritost/drift po posnetku).
// R547: razbitje po vzorcu R546 — glavni drži seznam/podrobnost, gradniki
// (shared/new/geo/qa/replay/detail) živijo v sosednjih datotekah.

import { useEffect, useState } from 'react'
import { Camera, Plus, TriangleAlert, Waypoints } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiGet, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { STATUS_BADGE, type SessionDetail, type SessionRow } from './zajem-shared'
import { NewSessionDialog } from './zajem-new'
import { SessionDetailBody } from './zajem-detail'

// ─── Modul ──────────────────────────────────────────────────────────────────

export default function ZajemModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [refresh, setRefresh] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const list = useApi<{ data: SessionRow[] }>(`/api/capture-session?t=${refresh}`, [refresh])
  const mayWrite = user ? hasPerm(user.perms, 'measurements.write') : false

  const closeDetail = () => {
    setDetailId(null)
    setDetail(null)
    setDetailError(null)
    setLoadingDetail(false)
  }

  useEffect(() => {
    if (!detailId) return
    let alive = true
    const load = async () => {
      setLoadingDetail(true)
      setDetailError(null)
      try {
        const r = await apiGet<{ data: SessionDetail }>(`/api/capture-session/${detailId}`)
        if (alive) setDetail(r.data)
      } catch (e) {
        if (alive) setDetailError((e as Error).message)
      } finally {
        if (alive) setLoadingDetail(false)
      }
    }
    void load()
    return () => { alive = false }
  }, [detailId, refresh])

  const reloadAll = () => setRefresh((n) => n + 1)

  async function deleteSession (id: string, name: string) {
    if (!window.confirm(`Brisanje zajema »${name}«? Zgodovina se izgubi.`)) return
    try {
      await apiDelete(`/api/capture-session/${id}`)
      toast({ title: 'Zajem izbrisan' })
      closeDetail()
      reloadAll()
    } catch (e) {
      toast({ title: 'Napaka', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Zajem — Reality Capture QA"
        desc="Vodeni zajem s pokritostjo, drift kontrolo in referenčno mrežo (R461)"
        actions={mayWrite ? (
          <Button onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" />Nov zajem</Button>
        ) : undefined}
      />

      {list.error && <ErrorBox error={list.error} />}
      {list.loading && <LoadingRows />}
      {!list.loading && !list.error && (list.data?.data.length ?? 0) === 0 && (
        <EmptyState
          title="Ni zajemov"
          desc="Začnite vodeni zajem nad ograjnim tekačem — pokritost, reference in drift se preverjajo sproti."
          icon={Camera}
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(list.data?.data ?? []).map((s) => (
          <Card key={s.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => setDetailId(s.id)}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.project?.code ?? '—'} · {s.author?.name ?? '—'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] ?? ''}`}>{s.status}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="outline" className="gap-1"><Waypoints className="h-3 w-3" />{s.mode === 'FENCE_RUN' ? 'tekač' : 'kamera'}</Badge>
                <Badge variant="outline" className={s.coverageOk ? 'border-emerald-300 text-emerald-700' : 'border-red-300 text-red-700'}>
                  pokritost {s.coverageOk ? '✓' : '✗'}
                </Badge>
                <Badge variant="outline" className={s.driftStatus === 'RE_LOC_REQUIRED' ? 'border-red-300 text-red-700' : s.driftStatus === 'DRIFT_WARNING' ? 'border-amber-300 text-amber-800' : 'border-emerald-300 text-emerald-700'}>
                  drift {s.driftStatus === 'RE_LOC_REQUIRED' ? '✗' : s.driftStatus === 'DRIFT_WARNING' ? '!' : '✓'}
                </Badge>
                <Badge variant="outline" className="gap-1"><Camera className="h-3 w-3" />{s.photoCount}</Badge>
                {s.refConflicts > 0 && (
                  <Badge variant="outline" className="border-red-300 text-red-700"><TriangleAlert className="mr-1 h-3 w-3" />{s.refConflicts} konflikt</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ustvari zajem */}
      <NewSessionDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); setDetailId(id); reloadAll() }} />

      {/* podrobnost */}
      <Dialog open={detailId != null} onOpenChange={(o) => { if (!o) closeDetail() }}>
        <DialogContent className="max-h-[92vh] w-[min(980px,96vw)] overflow-hidden p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{detail?.name ?? 'Zajem'}</DialogTitle>
            <DialogDescription>Podrobnost zajema s pokritostjo, ruto, referencami in driftom.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[86vh] p-6">
            {loadingDetail && <LoadingRows />}
            {detailError && <ErrorBox error={{ message: detailError }} />}
            {detail && (
              <SessionDetailBody
                detail={detail}
                mayWrite={mayWrite}
                onReload={reloadAll}
                onDelete={() => deleteSession(detail.id, detail.name)}
              />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}

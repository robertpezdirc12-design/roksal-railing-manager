'use client'

// OGRADNJA — detail dialog (odprt seznam/pregled tekača) — R547 izvleček iz
// ogradnja.tsx (razbitje po vzorcu R546; BREZ spremembe obnašanja).

import { Fence, Mountain } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useApi } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { SEGMENT_STATUSES, terrainAt } from '@/lib/fence-run-engine'
import { ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { ReviewRow, STATUS_BADGES, ValidationList, fmtM, type RunDetail } from './ogradnja-shared'

// ─── Detail dialog (odprt seznam/pregled tekača) ────────────────────────────

export function DetailDialog ({ runId, canWrite, onClose }: {
  runId: string
  canWrite: boolean
  onClose: () => void
}) {
  const detail = useApi<{ data: RunDetail }>(`/api/fence-run/${runId}`, [runId])
  const d = detail.data?.data

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fence className="size-5" aria-hidden /> {d?.run.name ?? 'Tekač'}
          </DialogTitle>
          <DialogDescription>
            {d?.run.project ? `${d.run.project.code} · ${d.run.project.title}` : ''}
            {d ? ` · ${STATUS_BADGES[d.run.status]?.label ?? d.run.status}` : ''}
          </DialogDescription>
        </DialogHeader>
        <ErrorBox error={detail.error} />
        {detail.loading && <LoadingRows />}
        {d && (
          <ScrollArea className="max-h-[65vh] pr-3">
            <div className="space-y-3 px-0.5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <ReviewRow label="Dolžina" value={fmtM(d.analysis.summary.totalLengthCm)} />
                <ReviewRow label="Stebri" value={String(d.analysis.summary.postCount)} />
                <ReviewRow label="Segmenti" value={String(d.analysis.summary.segmentCount)} />
                <ReviewRow label="Max padina" value={`${d.analysis.summary.maxSlopeDeg.toFixed(1)}°`} />
                <ReviewRow label="Δ višine" value={`${d.analysis.summary.heightDiffCm.toFixed(0)} cm`} />
                <ReviewRow label="Preverjenih" value={`${d.analysis.summary.verifiedCount}/${d.segments.length}`} />
              </div>
              {d.run.terrain && d.run.terrain.length >= 2 && (
                <div className="rounded-lg border p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-medium"><Mountain className="size-4" aria-hidden /> Profil terena (§12)</p>
                  <div className="max-h-32 overflow-y-auto text-xs">
                    {d.run.nodes.map((n) => (
                      <div key={n.atCm} className="flex justify-between border-b py-0.5 last:border-0">
                        <span>{fmtM(n.atCm)} · {n.kind}</span>
                        <span className="text-muted-foreground">teren {terrainAt(d.run.terrain, n.atCm).toFixed(0)} cm</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="max-h-56 overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2 py-1.5">#</th>
                      <th className="px-2 py-1.5">dolžina</th>
                      <th className="px-2 py-1.5">padina</th>
                      <th className="px-2 py-1.5">status</th>
                      <th className="px-2 py-1.5">preverjeno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.segments.map((s) => {
                      const st = SEGMENT_STATUSES[s.status] ?? SEGMENT_STATUSES.ESTIMATED
                      return (
                        <tr key={s.id} className="border-t">
                          <td className="px-2 py-1.5">{s.order + 1}</td>
                          <td className="px-2 py-1.5 font-medium">{fmtM(s.lengthCm)}</td>
                          <td className="px-2 py-1.5">{s.slopeDeg.toFixed(1)}°</td>
                          <td className="px-2 py-1.5">
                            <Badge variant="secondary" className={cn('border-transparent', st.cls)}>{st.label}</Badge>
                          </td>
                          <td className="px-2 py-1.5">{s.verifiedCm != null ? fmtM(s.verifiedCm) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <ValidationList validation={d.analysis.validation} />
              {d.versions.length > 0 && (
                <div className="rounded-lg border p-3">
                  <p className="mb-1 text-sm font-medium">Zgodovina verzij</p>
                  <div className="max-h-28 overflow-y-auto text-xs text-muted-foreground">
                    {d.versions.map((v) => (
                      <div key={v.version} className="flex justify-between border-b py-0.5 last:border-0">
                        <span>v{v.version} · {v.note ?? '—'}</span>
                        <span>{v.user?.name ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {d.run.measurementId && (
                <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                  Potrjeno → kanonična meritev ({d.run.measurementId.slice(0, 12)}…){canWrite ? ' — vidna v zavihku Meritve.' : '.'}
                </p>
              )}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zapri</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

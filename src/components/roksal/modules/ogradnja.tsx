'use client'

// OGRADNJA — ROKSAL OGRAJNI TEKAČ (R460 — issue #15)
// Specializirana ograjna izmera: ZAČETEK → STEBER → SEGMENT → … → KONEC (§1)
// z višinskim profilom terena (§12), produktno-zavednim razporedom stebrov
// (§8/§11), statusi dimenzij + VERIFIED z zunanjim merilnikom (§9/§10),
// quality gate 🟢🟡🔴 (§3), review (§20) in handoff v meritev/paket BREZ
// ponovnega vnosa (§21). Živi predogled računa ISTI engine kot strežnik
// (src/lib/fence-run-engine — čist, brez AI).
// R547: razbitje po vzorcu R546 — glavni drži seznam, gradniki (shared/
// carovnik/verify/detail) živijo v sosednjih datotekah.

import { useState } from 'react'
import { Fence, Pencil, Plus, Trash2 } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, useApi } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { STATUS_BADGES, type RunRow, QualityDot, fmtM } from './ogradnja-shared'
import { WizardDialog } from './ogradnja-carovnik'
import { DetailDialog } from './ogradnja-detail'

// ─── Glavni modul ───────────────────────────────────────────────────────────

export default function OgradnjaModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  const canWrite = hasPerm(user?.perms, 'measurements.write')
  const list = useApi<{ data: RunRow[] }>(`/api/fence-run?t=${refresh}`, [refresh])

  const rows = list.data?.data ?? []

  function reload (): void {
    setRefresh((r) => r + 1)
  }

  async function removeRun (row: RunRow): Promise<void> {
    if (!window.confirm(`Izbrišem tekač „${row.name}"?`)) return
    try {
      await apiDelete(`/api/fence-run/${row.id}`)
      toast({ title: 'Tekač izbrisan' })
      reload()
    } catch (e) {
      toast({ title: 'Brisanje ni uspelo', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ogradnja"
        desc="Vodena ograjna izmera — stebri, segmenti, teren (R460)"
        actions={canWrite ? (
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nova ograjna izmera
          </Button>
        ) : null}
      />

      <ErrorBox error={list.error} />
      {list.loading && <LoadingRows />}

      {!list.loading && rows.length === 0 && (
        <EmptyState
          icon={Fence}
          title="Ni ograjnih tekačev"
          desc={canWrite ? 'Začnite vodeno izmero: začetek → steber → segment → konec.' : 'Zaenkrat še ni nobene izmere.'}
        />
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const st = STATUS_BADGES[r.status] ?? { label: r.status, cls: 'bg-muted text-muted-foreground' }
            return (
              <Card key={r.id} className="gap-3 py-4">
                <CardContent className="space-y-3 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        className="truncate text-left text-sm font-semibold hover:underline"
                        onClick={() => setDetailId(r.id)}
                      >
                        {r.name}
                      </button>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.project ? `${r.project.code} · ${r.project.title}` : '—'}
                      </p>
                    </div>
                    <Badge variant="secondary" className={cn('border-transparent', st.cls)}>{st.label}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-sm font-semibold">{fmtM(r.totalLengthCm)}</p>
                      <p className="text-[11px] text-muted-foreground">dolžina</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{r.segmentCount}</p>
                      <p className="text-[11px] text-muted-foreground">segmentov</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{r.verifiedCount}/{r.segmentCount}</p>
                      <p className="text-[11px] text-muted-foreground">preverjenih</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <QualityDot state={r.qualityState} />
                      {r.product ? (
                        <span className="truncate">{r.product.sku}{r.variant ? ` · ${r.variant.sku}` : ''}</span>
                      ) : (
                        <span>brez produkta</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setDetailId(r.id)}>
                        <Pencil className="size-3.5" aria-hidden /> <span className="sr-only">Odpri</span>
                      </Button>
                      {canWrite && r.status !== 'POTRJEN' && (
                        <Button size="sm" variant="ghost" onClick={() => void removeRun(r)}>
                          <Trash2 className="size-3.5 text-destructive" aria-hidden /> <span className="sr-only">Izbriši</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {wizardOpen && (
        <WizardDialog
          onClose={() => setWizardOpen(false)}
          onSaved={() => { reload() }}
        />
      )}
      {detailId && (
        <DetailDialog
          runId={detailId}
          canWrite={canWrite}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  )
}

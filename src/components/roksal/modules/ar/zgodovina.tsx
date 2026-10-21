'use client'

// zgodovina.tsx — R454: zgodovina AR posnetkov (GET /api/ar-snapshots) z
// ogledom podrobnosti (fotografija + analiza + zaznave), brisanjem in ročno
// oznako na posnetku (R537-b: dobesedna selitev iz ar.tsx). Stanje podrobnosti
// (detail/detailBusy/deleting/detailTag*) je SAMO tukaj — vstop ga ne vidi;
// seznam (snapshots) je skupen (capture ga osveži) in pride prek propa.

import { useCallback, useState } from 'react'

import { Download, History, Loader2, Plus, Trash2 } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorBox, LoadingRows } from '@/components/roksal/ui-bits'
import { useToast } from '@/hooks/use-toast'
import { apiDelete, apiGet, apiPost, useApi } from '@/lib/api-client'
import type { SceneElement } from '@/lib/scene-understanding-core'

import { MANUAL_BBOX_DEFAULT, type ArAnalysis, type SnapshotRow } from './tipi'
import { downloadPng } from './zajem'
import { ManualTagForm, SceneElementRow } from './zaznave'
import type { ManualTagValues } from './tipi'

/** R542: analysis je jsonb objekt (API vrača razčlenjenega); niz ostane le kot obramba za starejše oblike. */
function parseAnalysis (raw: Record<string, unknown> | string | null | undefined): ArAnalysis | null {
  if (!raw) return null
  const p = (typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as unknown } catch { return null } })() : raw) as ArAnalysis | null
  if (!p || typeof p !== 'object' || !Array.isArray(p.placement)) return null
  return p
}

export function Zgodovina ({ canWrite, snapshots }: {
  canWrite: boolean
  snapshots: ReturnType<typeof useApi<{ data: SnapshotRow[] }>>
}): React.ReactElement {
  const { toast } = useToast()

  const [detail, setDetail] = useState<{ row: SnapshotRow; photo: string | null; analysis: ArAnalysis | null; elements: SceneElement[] | null } | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  /** R485 (§1): obrazec ročne oznake na PERSISTIRANEM posnetku (POST scene-element). */
  const [detailTagOpen, setDetailTagOpen] = useState(false)
  const [detailTagBusy, setDetailTagBusy] = useState(false)
  const [detailBBox, setDetailBBox] = useState<[number, number, number, number] | null>(null)

  /** R485: bbox predogleda ročne oznake (stabilen callback — brez render zank). */
  const handleDetailBBox = useCallback((b: [number, number, number, number] | null): void => {
    setDetailBBox(b)
  }, [])

  /** R485 (issue #8 §1): ROČNA OZNAKA na PERSISTIRANEM posnetku — POST
   *  /api/ar-snapshots/[id]/scene-element (2-a ruta; OSEBA zavrnjena na
   *  strežniku) → osvežen prikaz (element se pojavi z virom ROCNO). */
  async function addManualElementToSnapshot (v: ManualTagValues): Promise<void> {
    if (!detail || detailTagBusy) return
    setDetailTagBusy(true)
    try {
      await apiPost(`/api/ar-snapshots/${detail.row.id}/scene-element`, {
        cls: v.cls,
        bbox: v.bbox,
        ...(v.label ? { label: v.label } : {}),
      })
      const se = await apiGet<{ data: { displayed: SceneElement[] } }>(`/api/ar-snapshots/${detail.row.id}/scene-element`)
      if (Array.isArray(se.data?.displayed)) {
        const displayed = se.data.displayed
        setDetail((prev) => (prev && prev.row.id === detail.row.id ? { ...prev, elements: displayed } : prev))
      }
      setDetailTagOpen(false)
      setDetailBBox(null)
      toast({ title: 'Oznaka dodana na posnetek.', description: `${v.cls} — vir: ročno (ROCNO). Element je takoj viden v seznamu zaznav.` })
    } catch (e) {
      toast({ title: 'Dodajanje oznake ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setDetailTagBusy(false)
    }
  }

  // ── R454: zgodovina — ogled podrobnosti s fotografijo ──
  // R485 (§1/§9): ob ogledu naloži tudi ZAZNAVE PRIZORA (GET scene-element →
  //  displayed) za seznam + ročno oznako (POST); brez razumevanja = brez bloka.
  async function viewSnapshot (row: SnapshotRow): Promise<void> {
    if (detail?.row.id === row.id) {
      setDetail(null)
      setDetailTagOpen(false)
      setDetailBBox(null)
      return
    }
    setDetailBusy(true)
    try {
      const res = await apiGet<{ data: { id: string; params: Record<string, unknown> | null; scene: string | null; analysis: Record<string, unknown> | null; note: string | null; createdAt: string } }>(`/api/ar-snapshots/${row.id}`)
      // R542: params/analysis sta jsonb objekta — brez JSON.parse
      let photo: string | null = null
      const p = res.data.params
      if (p && typeof p === 'object') {
        const ph = (p as { photo?: unknown }).photo
        if (typeof ph === 'string' && ph.startsWith('data:image/')) photo = ph
      }
      let elements: SceneElement[] | null = null
      try {
        const se = await apiGet<{ data: { displayed: SceneElement[] } }>(`/api/ar-snapshots/${row.id}/scene-element`)
        if (Array.isArray(se.data?.displayed)) elements = se.data.displayed
      } catch { /* posnetek brez razumevanja prizora — blok se ne prikaže */ }
      setDetailTagOpen(false)
      setDetailBBox(null)
      setDetail({ row, photo, analysis: parseAnalysis(res.data.analysis), elements })
    } catch (e) {
      toast({ title: 'Podrobnosti ni bilo mogoče naložiti.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setDetailBusy(false)
    }
  }

  async function deleteSnapshot (id: string): Promise<void> {
    setDeleting(id)
    try {
      await apiDelete(`/api/ar-snapshots/${id}`)
      if (detail?.row.id === id) setDetail(null)
      void snapshots.reload()
      toast({ title: 'AR posnetek izbrisan.' })
    } catch (e) {
      toast({ title: 'Brisanje ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setDeleting(null)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <History className="size-4 text-roksal-amber" aria-hidden /> Zgodovina AR posnetkov
        </h2>

        {snapshots.loading ? (
          <LoadingRows rows={3} />
        ) : snapshots.error ? (
          <ErrorBox error={snapshots.error} />
        ) : (snapshots.data?.data ?? []).length === 0 ? (
          <EmptyState
            title="Ni AR posnetkov"
            desc="Zajemite prvi posnetek iz AR predogleda — shranili se bodo tukaj s fotografijo, nastavitvami in morebitno AI analizo."
          />
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {(snapshots.data?.data ?? []).map((row) => (
              <div key={row.id} className="rounded-lg border">
                <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {row.scene || row.note || 'AR posnetek'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString('sl-SI')}
                      {row.author ? ` · ${row.author.name}` : ''}
                      {row.project ? ` · ${row.project.code}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-9" onClick={() => void viewSnapshot(row)} disabled={detailBusy && detail?.row.id !== row.id}>
                      {detailBusy && detail?.row.id !== row.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                      {detail?.row.id === row.id ? 'Skrij' : 'Ogled'}
                    </Button>
                    {canWrite ? (
                      <Button variant="ghost" size="icon" className="size-9 text-destructive hover:text-destructive"
                        aria-label="Izbriši AR posnetek" onClick={() => void deleteSnapshot(row.id)} disabled={deleting === row.id}>
                        {deleting === row.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* podrobnost: fotografija + analiza */}
                {detail?.row.id === row.id ? (
                  <div className="grid gap-3 border-t p-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                    {detail.photo ? (
                      <div className="space-y-1.5">
                        {/* R485 (§1): relativni ovoj — živi predogled bboxa ročne
                            oznake čez fotografijo posnetka (isti števci 0..1). */}
                        <div className="relative">
                          <img src={detail.photo} alt={`AR posnetek — ${row.scene ?? 'brez opisa'}`} className="w-full rounded-lg border" />
                          {detailTagOpen && detailBBox != null ? (
                            <div
                              className="pointer-events-none absolute rounded-md border-2 border-dashed border-roksal-amber bg-roksal-amber/10"
                              style={{
                                left: `${Math.round(detailBBox[0] * 100)}%`,
                                top: `${Math.round(detailBBox[1] * 100)}%`,
                                width: `${Math.round(detailBBox[2] * 100)}%`,
                                height: `${Math.round(detailBBox[3] * 100)}%`,
                              }}
                              aria-hidden
                            />
                          ) : null}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-full text-xs"
                          onClick={() => downloadPng(detail.photo as string, `ar-posnetek-${row.id.slice(0, 8)}.png`)}
                        >
                          <Download className="size-3.5" aria-hidden /> Prenesi PNG
                        </Button>
                      </div>
                    ) : (
                      <p className="self-center text-xs text-muted-foreground">Posnetek ne vsebuje fotografije.</p>
                    )}
                    <div className="space-y-2 text-sm">
                      {row.note && row.note !== (row.scene ?? '') ? <p className="text-muted-foreground">{row.note}</p> : null}
                      {detail.analysis ? (
                        <>
                          <ul className="space-y-1.5">
                            {detail.analysis.placement.map((p, i) => (
                              <li key={i} className="rounded-md border bg-secondary/40 p-2">
                                <span className="font-semibold">{p.label}</span>
                                {p.estLenCm != null ? <span className="ml-2 text-xs text-roksal-amber">≈ {(p.estLenCm / 100).toFixed(1).replace('.', ',')} m</span> : null}
                                <p className="text-xs text-muted-foreground">{p.where}</p>
                              </li>
                            ))}
                          </ul>
                          {detail.analysis.obstacles.length > 0 ? (
                            <p className="text-xs text-muted-foreground"><span className="font-semibold">Ovire:</span> {detail.analysis.obstacles.join(' · ')}</p>
                          ) : null}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Posnetek je bil zajet brez AI analize prizora.</p>
                      )}
                    </div>

                    {/* R485 (issue #8 §1/§9): ZAZNAVE PRIZORA na posnetku —
                        seznam displayed elementov (GET scene-element) + ROČNA
                        OZNAKA prek POST scene-element (vir ROCNO; OSEBA na
                        strežniku zavrnjena — zasebnost §5). */}
                    {detail.elements != null ? (
                      <div className="border-t p-3 md:col-span-2">
                        <div className="rounded-lg border">
                          <p className="flex items-center justify-between border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            <span>Zaznave prizora</span>
                            <span className="font-semibold" aria-label={`${detail.elements.length} elementov`}>{detail.elements.length}</span>
                          </p>
                          {detail.elements.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">
                              Posnetek ne vsebuje zaznav — zajet je bil, preden je razumevanje prizora našlo elemente.
                            </p>
                          ) : (
                            <ul className="max-h-72 divide-y overflow-y-auto pr-1" aria-label="Zaznave prizora na posnetku">
                              {detail.elements.map((el) => (
                                <li key={el.id}><SceneElementRow el={el} /></li>
                              ))}
                            </ul>
                          )}
                          {canWrite ? (
                            <div className="border-t p-3">
                              {detailTagOpen ? (
                                <ManualTagForm
                                  onSubmit={(v) => { void addManualElementToSnapshot(v) }}
                                  onCancel={() => { setDetailTagOpen(false); setDetailBBox(null) }}
                                  busy={detailTagBusy}
                                  onBBoxChange={handleDetailBBox}
                                  helpNote="Oznaka se takoj zapiše na posnetek (vir: ročno — ROCNO) in je takoj vidna v seznamu. OSEBA ni na voljo (zasebnost)."
                                />
                              ) : (
                                <Button variant="outline" size="sm" aria-expanded={detailTagOpen} onClick={() => { setDetailTagOpen(true); setDetailBBox(MANUAL_BBOX_DEFAULT) }}>
                                  <Plus className="size-3.5" aria-hidden /> Dodaj oznako ročno
                                </Button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

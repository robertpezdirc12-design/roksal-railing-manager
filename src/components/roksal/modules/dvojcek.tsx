'use client'

// DVOJČEK — ROKSAL DIGITAL TWIN (R461 — issue #16 §8–§14)
// Enotni verzirani model projekta: viri (foto/2D/3D/meritve/paketi/BOM),
// snapshoti AS-MEASURED → AS-DESIGNED → AS-PRODUCED → AS-INSTALLED,
// cross-check virov, geometrijski diff in vrata ZA PONUDBO/KONFIGURACIJO/PROIZVODNJO.

import { useEffect, useMemo, useState } from 'react'
import {
  Boxes, ClipboardCheck, Clock, FileStack, GitCompareArrows, Hammer, Loader2,
  MousePointerClick, Plus, Ruler, ScanLine, ShieldCheck, TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiGet, apiPost, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import { TWIN_KINDS } from '@/lib/capture-qa-engine'
import { DEVIATION_STATUSES, ELEMENT_STATES, LOOP_STATUSES, REG_QUALITY } from '@/lib/reality-r2p-engine'

// ─── Tipi ───────────────────────────────────────────────────────────────────

interface ProjectOption { id: string; code: string; title: string }

interface SnapshotRow {
  id: string; kind: string; version: number; reason: string
  createdFrom: string | null; parentSnapshotId: string | null
  author: { name: string } | null; createdAt: string
  sources: { vrsta: string; id: string }[]
  summary: {
    totalLengthCm: number | null; segments: number
    produkt: string | null; varianta: string | null; ral: string | null
    bom: { code: string; status: string; lines: number; qty: number; unit: string } | null
  }
}

interface TwinOverview {
  snapshots: { id: string; kind: string; version: number; reason: string; createdAt: string; summary: { totalLengthCm: number | null; segments: number } }[]
  criticalGate: { ponudba: boolean; konfiguracija: boolean; proizvodnja: boolean; manjka: { code: string; message: string }[] } | null
  consistency: {
    rows: { key: string; label: string; photo: boolean; sketch2d: boolean; threeD: boolean; measurement: boolean }[]
    warnings: string[]
    consistent: boolean
  }
  counts: {
    measurements: number; fenceRuns: number; packages: number; photoViz: number
    vizProjects: number; boms: number; captureSessions: number; photos: number
  }
}

interface DiffPayload {
  from: { id: string; version: number }
  to: { id: string; version: number }
  diff: {
    rows: { key: string; label: string; metric: string; a: number | null; b: number | null; diff: number | null; unit: string }[]
    compared: number; deviations: number; maxAbsDiffCm: number
  }
}

interface PackageOption { id: string; code: string; name: string; productId: string; variantId: string | null }
interface BomOption { id: string; code: string; status: string }

interface AsBuiltPayload {
  stages: {
    stage: string; label: string; available: boolean
    from: { id: string; version: number } | null
    to: { id: string; version: number } | null
    rows: { key: string; label: string; metric: string; a: number | null; b: number | null; diff: number | null; unit: string; status: string; ruleKey: string }[]
    summary: { compared: number; within: number; review: number; blocking: number; noRule: number }
  }[]
  provenance: { kaj: string; kdaj: string; kako: string; kdo: string; verzija: string; izpeljanoIz: string }[]
  snapshotChain: { id: string; kind: string; version: number; reason: string; createdAt: string }[]
  toleranceRulesDefined: { key: string; value: number; unit: string; label: string }[]
  verdict: { asBuiltOk: boolean; blocking: number; review: number; message: string }
  recapture: { sessions: { id: string; name: string; createdAt: string; geoCount: number; photoCount: number }[]; message: string }
}

interface TimelinePayload {
  entries: { t: string; label: string; at: string | null; detail: string }[]
}

interface ElementProv {
  key: string; label: string
  photo: { zone: string; count: number } | null
  meritev: { id: string; lengthCm: number | null; heightCm: number | null; source: string } | null
  tekač: { id: string; name: string; status: string } | null
  produkt: { ime: string | null; varianta: string | null; ral: string | null } | null
  bom: { code: string; status: string; lines: number } | null
  snapshots: { kind: string; version: number; value: number | null }[]
  zgodovina: { opis: string; at: string }[]
}

const KIND_LABEL: Record<string, string> = {
  AS_MEASURED: 'AS-MEASURED',
  AS_DESIGNED: 'AS-DESIGNED',
  AS_PRODUCED: 'AS-PRODUCED',
  AS_INSTALLED: 'AS-INSTALLED',
}

const KIND_ORDER = ['AS_MEASURED', 'AS_DESIGNED', 'AS_PRODUCED', 'AS_INSTALLED']

// ─── Modul ──────────────────────────────────────────────────────────────────

export default function DvojcekModule () {
  const user = useAppStore((s) => s.user)
  const [projectId, setProjectId] = useState('')
  const projects = useApi<{ data: ProjectOption[] }>(user ? '/api/projects' : null, [user])
  const [refresh, setRefresh] = useState(0)

  const overview = useApi<{ data: TwinOverview }>(
    projectId ? `/api/digital-twin?projectId=${projectId}&t=${refresh}` : null,
    [projectId, refresh],
  )
  const snapshots = useApi<{ data: SnapshotRow[] }>(
    projectId ? `/api/digital-twin/snapshot?projectId=${projectId}&t=${refresh}` : null,
    [projectId, refresh],
  )
  const od = overview.data?.data ?? null
  const snapRows = snapshots.data?.data ?? []

  const mayWrite = user ? (hasPerm(user.perms, 'projects.write') || hasPerm(user.perms, 'measurements.write')) : false

  const [createKind, setCreateKind] = useState<string | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [elementKey, setElementKey] = useState<string | null>(null)
  const reload = () => setRefresh((n) => n + 1)

  const asBuilt = useApi<{ data: AsBuiltPayload }>(
    projectId ? `/api/digital-twin/as-built?projectId=${projectId}&t=${refresh}` : null,
    [projectId, refresh],
  )
  const timeline = useApi<{ data: TimelinePayload }>(
    projectId ? `/api/digital-twin/timeline?projectId=${projectId}&t=${refresh}` : null,
    [projectId, refresh],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Digitalni dvojček"
        desc="AS-DESIGNED ↔ AS-MEASURED ↔ AS-PRODUCED ↔ AS-INSTALLED — enoten verzirani model objekta (R461)"
        actions={projectId && mayWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDiffOpen(true)}><GitCompareArrows className="mr-1 h-4 w-4" />Diff</Button>
            <Button size="sm" onClick={() => setCreateKind('AS_DESIGNED')}><Plus className="mr-1 h-4 w-4" />Snapshot</Button>
          </div>
        ) : undefined}
      />

      <div className="w-full max-w-md">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger><SelectValue placeholder="Izberite projekt" /></SelectTrigger>
          <SelectContent>
            {(projects.data?.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!projectId && <EmptyState title="Izberite projekt" desc="Digitalni dvojček je vedno vezan na posamezen projekt (§8)." icon={Boxes} />}

      {projectId && overview.error && <ErrorBox error={overview.error} />}
      {projectId && overview.loading && <LoadingRows />}

      {projectId && od && (
        <div className="space-y-4">
          {/* vrata §7 */}
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" />Kritične mere (§7)</p>
              {od.criticalGate ? (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {([
                      ['ZA PONUDBO', od.criticalGate.ponudba],
                      ['ZA KONFIGURACIJO', od.criticalGate.konfiguracija],
                      ['ZA PROIZVODNJO', od.criticalGate.proizvodnja],
                    ] as const).map(([label, ok]) => (
                      <span key={label} className={`rounded-md border px-2.5 py-1 ${ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                        {ok ? '✅' : '⚠️'} {label}
                      </span>
                    ))}
                  </div>
                  {od.criticalGate.manjka.length > 0 && (
                    <>
                      <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                        {od.criticalGate.manjka.map((m, i) => <li key={i}>{m.message}</li>)}
                      </ul>
                      <p className="text-xs font-medium text-amber-800">[ODPRAVI MANJKAJOČE PODATKE] — Ogradnja: verify segmentov z LASER/mičnik + kalibracija + podlaga.</p>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Ni tekača na projektu — vrata mer niso izračunana.</p>
              )}
            </CardContent>
          </Card>

          {/* časovnica snapshotov */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="flex items-center gap-2 font-medium"><FileStack className="h-4 w-4" />Časovnica dvojčka (§8–§12)</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {KIND_ORDER.map((kind) => {
                  const sn = (od?.snapshots ?? []).filter((s) => s.kind === kind)
                  const last = sn[sn.length - 1]
                  return (
                    <div key={kind} className={`rounded-lg border p-3 ${last ? 'border-emerald-300 bg-emerald-50/50' : 'border-dashed'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{KIND_LABEL[kind]}</p>
                        {last && <Badge variant="outline">v{last.version}</Badge>}
                      </div>
                      {last ? (
                        <>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {last.summary.totalLengthCm != null ? `${(last.summary.totalLengthCm / 100).toFixed(2)} m · ` : ''}
                            {last.summary.segments} seg
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{last.reason}</p>
                          {mayWrite && kind !== 'AS_MEASURED' && (
                            <Button size="sm" variant="outline" className="mt-2 h-7 w-full" onClick={() => setCreateKind(kind)}>
                              <Plus className="mr-1 h-3 w-3" />nova verzija
                            </Button>
                          )}
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {kind === 'AS_MEASURED' ? 'ustvari se s zaključkom zajema' : kind === 'AS_DESIGNED' ? 'iz projektnega paketa' : kind === 'AS_PRODUCED' ? 'iz kosovnice (zahteva AS-DESIGNED)' : 'po montaži (zahteva AS-DESIGNED)'}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* viri + cross-check */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="space-y-2 p-4">
                <p className="flex items-center gap-2 font-medium"><ScanLine className="h-4 w-4" />Viri dvojčka</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {([
                    ['Meritve', od?.counts?.measurements],
                    ['Tekači', od?.counts?.fenceRuns],
                    ['Paketi', od?.counts?.packages],
                    ['Foto-viz', od?.counts?.photoViz],
                    ['3D projekti', od?.counts?.vizProjects],
                    ['Kosovnice', od?.counts?.boms],
                    ['Zajemi', od?.counts?.captureSessions],
                    ['Posnetki zajema', od?.counts?.photos],
                  ] as const).map(([label, n]) => (
                    <div key={label} className="flex items-center justify-between rounded-md border px-2.5 py-1.5">
                      <span className="text-muted-foreground">{label}</span><span className="font-semibold">{n}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 p-4">
                <p className="flex items-center gap-2 font-medium"><GitCompareArrows className="h-4 w-4" />Cross-check virov (§14)</p>
                {od.consistency.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ni segmentov za primerjavo (potreben tekač ali meritev).</p>
                ) : (
                  <>
                    <div className="space-y-1">
                      {od.consistency.rows.map((r) => (
                        <button key={r.key} type="button" onClick={() => setElementKey(r.key)} className="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted">
                          <span className="min-w-0 flex-1 truncate">{r.label}</span>
                          {([['foto', r.photo], ['2D', r.sketch2d], ['3D', r.threeD], ['mer', r.measurement]] as const).map(([l, ok]) => (
                            <span key={l} className={`rounded px-1.5 py-0.5 text-xs ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{l} {ok ? '✓' : '✗'}</span>
                          ))}
                        </button>
                      ))}
                    </div>
                    {od.consistency.warnings.length > 0 && (
                      <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                        {od.consistency.warnings.map((w, i) => <li key={i} className="flex gap-1.5"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</li>)}
                      </ul>
                    )}
                    {od.consistency.consistent && (
                      <p className="text-xs text-emerald-700">Vsi viri so skladni.</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* AS-BUILT QA poročilo (R462 §27) */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="flex items-center gap-2 font-medium"><ClipboardCheck className="h-4 w-4" />AS-BUILT QA poročilo (R462)</p>
              {asBuilt.data?.data ? (
                <>
                  <div className={`rounded-lg border p-3 text-sm font-medium ${asBuilt.data.data.verdict.asBuiltOk ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                    {asBuilt.data.data.verdict.message}
                  </div>
                  {asBuilt.data.data.toleranceRulesDefined.length === 0 && (
                    <p className="rounded-md border border-gray-300 bg-gray-50 p-2 text-xs text-gray-700">
                      NO VERIFIED TOLERANCE RULE — tolerance niso definirane (EngineeringRule: tol_dolzina_segmenta, tol_visina, …). Odstopanja so prikazana brez ocene (§12, brez ugibanj).
                    </p>
                  )}
                  {asBuilt.data.data.stages.map((st) => (
                    <div key={st.stage} className="rounded-lg border p-3">
                      <p className="text-sm font-medium">{st.label}</p>
                      {!st.available ? (
                        <p className="mt-1 text-xs text-muted-foreground">Manjkajo snapshoti za to primerjavo.</p>
                      ) : (
                        <>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {st.summary.compared} mer · ✅ {st.summary.within} · ⚠ {st.summary.review} · 🔴 {st.summary.blocking} · bez pravila {st.summary.noRule}
                          </p>
                          <div className="mt-2 space-y-1">
                            {st.rows.map((r) => (
                              <div key={r.key} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {r.a != null ? r.a.toFixed(1) : '—'} → {r.b != null ? r.b.toFixed(1) : '—'} {r.unit}
                                </span>
                                <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${DEVIATION_STATUSES[r.status as keyof typeof DEVIATION_STATUSES]?.cls ?? ''}`}>
                                  {r.diff != null ? `${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)} ${r.unit} · ` : ''}{DEVIATION_STATUSES[r.status as keyof typeof DEVIATION_STATUSES]?.label ?? r.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {/* recapture (§16) */}
                  <p className="text-xs text-muted-foreground">Recapture (§16): {asBuilt.data.data.recapture.message}</p>
                </>
              ) : asBuilt.loading ? <LoadingRows /> : <p className="text-sm text-muted-foreground">Poročilo ni na voljo.</p>}
            </CardContent>
          </Card>

          {/* 4D timeline (R462 §15) */}
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="flex items-center gap-2 font-medium"><Clock className="h-4 w-4" />4D timeline (T0–T6)</p>
              {timeline.data?.data && timeline.data.data.entries.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {timeline.data.data.entries.map((e) => (
                    <div key={e.t + e.label} className="min-w-36 flex-1 rounded-lg border p-2.5">
                      <p className="text-xs font-bold text-muted-foreground">{e.t}</p>
                      <p className="text-sm font-medium">{e.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{e.detail}</p>
                      {e.at && <p className="text-[10px] text-muted-foreground">{new Date(e.at).toLocaleDateString('sl-SI')}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Ni časovnih vnosov — začnite z zajemom.</p>
              )}
            </CardContent>
          </Card>

          {/* verzije snapshotov */}
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="flex items-center gap-2 font-medium"><Ruler className="h-4 w-4" />Vse verzije snapshotov (§22)</p>
              <ScrollArea className="max-h-80">
                <div className="space-y-1.5">
                  {snapRows.map((s) => (
                    <div key={s.id} className="rounded-md border px-2.5 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{KIND_LABEL[s.kind] ?? s.kind} v{s.version}</Badge>
                        <span className="text-muted-foreground">
                          {s.summary.totalLengthCm != null ? `${(s.summary.totalLengthCm / 100).toFixed(2)} m · ` : ''}
                          {s.summary.segments} seg
                          {s.summary.produkt ? ` · ${s.summary.produkt}` : ''}
                          {s.summary.ral ? ` (${s.summary.ral})` : ''}
                          {s.summary.bom ? ` · BOM ${s.summary.bom.code} (${s.summary.bom.status})` : ''}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">{s.author?.name ?? '—'} · {new Date(s.createdAt).toLocaleString('sl-SI')}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">“{s.reason}”</p>
                    </div>
                  ))}
                  {snapRows.length === 0 && (
                    <p className="text-sm text-muted-foreground">Ni snapshotov — začnite z zajemom (AS-MEASURED) ali načrtom (AS-DESIGNED).</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ustvari snapshot */}
      <CreateSnapshotDialog
        projectId={projectId}
        kind={createKind}
        onClose={() => setCreateKind(null)}
        onCreated={() => { setCreateKind(null); reload() }}
      />

      {/* element provenance (R462 §13) */}
      <ElementDialog projectId={projectId} elementKey={elementKey} onClose={() => setElementKey(null)} />

      {/* diff dialog */}
      <DiffDialog
        projectId={projectId}
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        snapshots={od?.snapshots ?? []}
      />
    </div>
  )
}

// ─── Element provenance dialog (R462 §13) ───────────────────────────────────

function ElementDialog ({ projectId, elementKey, onClose }: {
  projectId: string
  elementKey: string | null
  onClose: () => void
}) {
  const [prov, setProv] = useState<ElementProv | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!elementKey) return
    let alive = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const r = await apiGet<{ data: ElementProv }>(`/api/digital-twin/element?projectId=${projectId}&key=${elementKey}`)
        if (alive) setProv(r.data)
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => { alive = false }
  }, [projectId, elementKey])

  if (!elementKey) return null

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[min(640px,95vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MousePointerClick className="h-5 w-5" />{elementKey} — provenance (§13)</DialogTitle>
          <DialogDescription>Vsi povezani podatki elementa: foto/meritev/produkt/BOM/snapshoti/zgodovina.</DialogDescription>
        </DialogHeader>
        {loading && <LoadingRows />}
        {error && <ErrorBox error={{ message: error }} />}
        {prov && (
          <div className="space-y-2 text-sm">
            <div className="grid gap-1.5">
              {([
                ['Fotografije', prov.photo ? `${prov.photo.count} posnetkov v coni ${prov.photo.zone}` : 'ni posnetkov v coni'],
                ['Meritev', prov.meritev ? `${(prov.meritev.lengthCm ?? 0).toFixed(1)} cm · vir ${prov.meritev.source}` : 'ni kanonične meritve'],
                ['Tekač', prov.tekač ? `${prov.tekač.name} (${prov.tekač.status})` : '—'],
                ['Produkt', prov.produkt ? `${prov.produkt.ime ?? '—'}${prov.produkt.varianta ? ' · ' + prov.produkt.varianta : ''}${prov.produkt.ral ? ' (' + prov.produkt.ral + ')' : ''}` : 'ni izbran'],
                ['BOM', prov.bom ? `${prov.bom.code} (${prov.bom.status}, ${prov.bom.lines} vrstic)` : 'ni kosovnice'],
              ] as const).map(([l, v]) => (
                <div key={l} className="flex gap-2 rounded-md border px-2.5 py-1.5">
                  <span className="w-24 shrink-0 text-muted-foreground">{l}</span>
                  <span className="min-w-0 flex-1">{v}</span>
                </div>
              ))}
            </div>
            {prov.snapshots.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Vrednost skozi snapshot-e:</p>
                <div className="flex flex-wrap gap-1.5">
                  {prov.snapshots.map((s) => (
                    <Badge key={s.kind + s.version} variant="outline">{s.kind} v{s.version}: {s.value != null ? (s.value / 100).toFixed(2) + ' m' : '—'}</Badge>
                  ))}
                </div>
              </div>
            )}
            {prov.zgodovina.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Zgodovina sprememb:</p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {prov.zgodovina.slice(-5).map((z, i) => <li key={i}>{new Date(z.at).toLocaleDateString('sl-SI')} — {z.opis}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zapri</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Ustvari snapshot ───────────────────────────────────────────────────────

function CreateSnapshotDialog ({ projectId, kind, onClose, onCreated }: {
  projectId: string
  kind: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  // AS_DESIGNED
  const packages = useApi<{ data: PackageOption[] }>(kind === 'AS_DESIGNED' && projectId ? `/api/project-packages?projectId=${projectId}` : null, [kind, projectId])
  const [packageId, setPackageId] = useState('')
  const [fotoVizId, setFotoVizId] = useState('')

  // AS_PRODUCED
  const boms = useApi<{ data: BomOption[] }>(kind === 'AS_PRODUCED' && projectId ? `/api/bom?projectId=${projectId}` : null, [kind, projectId])
  const [bomId, setBomId] = useState('')
  const [spremembe, setSpremembe] = useState('')

  // AS_INSTALLED
  const [finalSegs, setFinalSegs] = useState('')
  const [notes, setNotes] = useState('')

  const photoViz = useApi<{ data: { id: string; variantLabel: string; productId: string; variantId: string | null }[] }>(
    kind === 'AS_DESIGNED' && projectId ? `/api/photo-visualization?projectId=${projectId}` : null,
    [kind, projectId],
  )

  useEffect(() => { setReason(''); setPackageId(''); setFotoVizId(''); setBomId(''); setSpremembe(''); setFinalSegs(''); setNotes('') }, [kind])

  const selectedPkg = useMemo(() => (packages.data?.data ?? []).find((p) => p.id === packageId), [packages, packageId])
  const matchingViz = useMemo(() => (photoViz.data?.data ?? []).filter((v) => v.productId === selectedPkg?.productId), [photoViz, selectedPkg])

  async function submit () {
    if (!kind) return
    setSaving(true)
    try {
      let body: Record<string, unknown> = { projectId, kind, reason }
      if (kind === 'AS_DESIGNED') {
        body = { ...body, packageId, ...(fotoVizId ? { fotoVizId } : {}) }
      } else if (kind === 'AS_PRODUCED') {
        const sp = spremembe.trim()
          ? spremembe.split('\n').filter((l) => l.trim()).map((l) => {
              const [opis, odobril] = l.split('|').map((x) => x.trim())
              return { opis: opis ?? '', odobril: odobril ?? '' }
            }).filter((c) => c.opis && c.odobril)
          : []
        body = { ...body, bomId, spremembe: sp }
      } else {
        // AS_INSTALLED — finalSegments iz AS-DESIGNED keys
        const res = await apiGet<{ data: SnapshotRow[] }>(`/api/digital-twin/snapshot?projectId=${projectId}&kind=AS_DESIGNED`)
        const designed = (res.data ?? [])[0]
        if (!designed) { toast({ title: 'Manjka AS-DESIGNED', variant: 'destructive' }); return }
        const lines = finalSegs.trim() ? finalSegs.split('\n').filter((l) => l.trim()) : []
        const finalSegments = Array.from({ length: designed.summary.segments }, (_, i) => {
          const key = `seg-${i + 1}`
          const line = lines[i] ?? ''
          const [l, h] = line.split(',').map((x) => parseFloat(x.trim()))
          return {
            key,
            lengthCm: Number.isFinite(l) ? l : null,
            heightCm: Number.isFinite(h) ? h : null,
          }
        })
        body = { ...body, finalSegments, notes: notes.trim() ? notes.split('\n').filter((n) => n.trim()) : [] }
      }
      const r = await apiPost<{ data: { id: string; kind: string; version: number } }>('/api/digital-twin/snapshot', body)
      toast({ title: `${KIND_LABEL[r.data.kind] ?? r.data.kind} v${r.data.version} ustvarjen` })
      onCreated()
    } catch (e) {
      toast({ title: 'Napaka', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (!kind) return null

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[min(600px,95vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind === 'AS_PRODUCED' ? <Hammer className="h-5 w-5" /> : <Boxes className="h-5 w-5" />}
            {KIND_LABEL[kind]} — nova verzija
          </DialogTitle>
          <DialogDescription>{TWIN_KINDS[kind as keyof typeof TWIN_KINDS]?.desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Razlog (obvezen, §22) *</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="npr. Odobrena sprememba višine na željo stranke" />
          </div>

          {kind === 'AS_DESIGNED' && (
            <>
              <div className="grid gap-2">
                <Label>Projektni paket *</Label>
                <Select value={packageId} onValueChange={setPackageId}>
                  <SelectTrigger><SelectValue placeholder="Izberite paket" /></SelectTrigger>
                  <SelectContent>
                    {(packages.data?.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Foto-vizualizacija (§19 — ista konfiguracija)</Label>
                <Select value={fotoVizId} onValueChange={setFotoVizId}>
                  <SelectTrigger><SelectValue placeholder="neobvezno" /></SelectTrigger>
                  <SelectContent>
                    {matchingViz.map((v) => (
                      <SelectItem key={v.id} value={v.id}>Varianta {v.variantLabel}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPkg && matchingViz.length === 0 && (
                  <p className="text-xs text-muted-foreground">Ni vizualizacij, vezanih na ta izdelek — §19 zahteva isto konfiguracijo.</p>
                )}
              </div>
            </>
          )}

          {kind === 'AS_PRODUCED' && (
            <>
              <div className="grid gap-2">
                <Label>Kosovnica (POTRJEN/REZERVIRAN/PORABLJEN) *</Label>
                <Select value={bomId} onValueChange={setBomId}>
                  <SelectTrigger><SelectValue placeholder="Izberite kosovnico" /></SelectTrigger>
                  <SelectContent>
                    {(boms.data?.data ?? []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.code} ({b.status})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Spremembe med proizvodnjo (opis | odobril; ena na vrstico)</Label>
                <textarea
                  className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                  value={spremembe}
                  onChange={(e) => setSpremembe(e.target.value)}
                  placeholder={'Višina segmenta 2: 108 cm | M. Kovač\nDodatni steber pri vogalu | M. Kovač'}
                />
              </div>
            </>
          )}

          {kind === 'AS_INSTALLED' && (
            <>
              <div className="grid gap-2">
                <Label>Končne mere po segmentih (dolžina, višina v cm — ena vrstica na segment; prazno = po načrtu)</Label>
                <textarea
                  className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                  value={finalSegs}
                  onChange={(e) => setFinalSegs(e.target.value)}
                  placeholder={'482, 110\n310, 110\n205, 108'}
                />
              </div>
              <div className="grid gap-2">
                <Label>Montažne pripombe (ena na vrstico)</Label>
                <textarea
                  className="min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={'Pritrditev na desni strani na novo betonsko podlago'}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          <Button onClick={submit} disabled={saving || reason.trim().length < 3}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Ustvari snapshot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Diff dialog ────────────────────────────────────────────────────────────

function DiffDialog ({ projectId, open, onClose, snapshots }: {
  projectId: string
  open: boolean
  onClose: () => void
  snapshots: { kind: string; version: number }[]
}) {
  const [from, setFrom] = useState('AS_DESIGNED')
  const [to, setTo] = useState('AS_INSTALLED')
  const [result, setResult] = useState<DiffPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = useMemo(() => {
    const kinds = [...new Set(snapshots.map((s) => s.kind))]
    return KIND_ORDER.filter((k) => kinds.includes(k))
  }, [snapshots])

  useEffect(() => {
    if (available.length > 0 && !available.includes(from)) setFrom(available[0])
    if (available.length > 1 && !available.includes(to)) setTo(available[available.length - 1])
  }, [available, from, to])

  async function run () {
    setLoading(true); setError(null); setResult(null)
    try {
      const r = await apiGet<{ data: DiffPayload }>(`/api/digital-twin/diff?projectId=${projectId}&from=${from}&to=${to}`)
      setResult(r.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[min(680px,95vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitCompareArrows className="h-5 w-5" />Geometrijski diff (§13)</DialogTitle>
          <DialogDescription>Primerjajo se SAMO znane vrednosti — brez ugibanj.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid flex-1 gap-1">
            <Label className="text-xs">Od</Label>
            <Select value={from} onValueChange={setFrom} disabled={available.length === 0}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {available.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid flex-1 gap-1">
            <Label className="text-xs">Do</Label>
            <Select value={to} onValueChange={setTo} disabled={available.length === 0}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {available.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={loading || from === to || available.length < 2}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ruler className="mr-1 h-4 w-4" />}Primerjaj
          </Button>
        </div>
        {error && <ErrorBox error={{ message: error }} />}
        {result && (
          <ScrollArea className="max-h-80">
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">
                Primerjanih {result.diff.compared} mer · odstopanj {result.diff.deviations} · največje odstopanje {result.diff.maxAbsDiffCm.toFixed(1)} cm
              </p>
              {result.diff.rows.map((r) => (
                <div key={r.key} className={`flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${r.diff != null && Math.abs(r.diff) > (r.unit === 'cm' ? 1 : r.unit === '°' ? 1 : 0) ? 'border-amber-300 bg-amber-50' : ''}`}>
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="text-muted-foreground">
                    načrtovano {r.a != null ? r.a.toFixed(1) : '—'} · dejansko {r.b != null ? r.b.toFixed(1) : '—'} {r.unit}
                  </span>
                  {r.diff != null && (
                    <span className={`font-semibold ${Math.abs(r.diff) > 1 ? 'text-amber-800' : 'text-emerald-700'}`}>
                      {r.diff > 0 ? '+' : ''}{r.diff.toFixed(1)} {r.unit}
                    </span>
                  )}
                </div>
              ))}
              {result.diff.compared === 0 && <p className="text-sm text-muted-foreground">Ni primerljivih mer (manjkajo vrednosti).</p>}
            </div>
          </ScrollArea>
        )}
        {available.length < 2 && (
          <p className="text-sm text-muted-foreground">Za diff sta potrebna vsaj dva snapshot-a (npr. AS-DESIGNED in AS-INSTALLED).</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

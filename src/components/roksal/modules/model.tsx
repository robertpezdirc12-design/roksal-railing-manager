'use client'

// MODEL — ROKSAL MERILNI MODEL (R473 — issue #9 §3 HOVER PARITY)
// Pregledovalnik merilno skalirane geometrije, izpeljane IZ tekača:
// tloris / profil (elevacija) / 3D perspektiva, izbira segmenta z merami,
// virom, statusom in izdelkom; poštena kakovost (σ, predpostavke, nezajeto).
// Tekač je vir resnice — model je deterministična izpeljava (model-core/1.0).

import { useMemo, useState } from 'react'
import {
  ArrowLeftRight, Box, Compass, Fence, Info, Layers, Loader2, Map as MapIcon,
  Mountain, RotateCcw, Ruler, ScanLine, ShieldQuestion,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiGet, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatCard } from '@/components/roksal/ui-bits'
import { SEGMENT_STATUSES } from '@/lib/fence-run-engine'
import { project3d, projectPlan, projectProfile, type PlanModel, type ModelSegment, type ModelNode } from '@/lib/model-core'

// ─── Tipi (API) ──────────────────────────────────────────────────────────────

interface ProjectOption { id: string; code: string; title: string }

interface RunOption {
  id: string; name: string; status: string; updatedAt: string
  totalLengthCm: number
  product: { sku: string; name: string } | null
}

interface ModelPayload {
  run: { id: string; name: string; status: string; project: { code: string; title: string } | null }
  product: { id: string; sku: string; name: string } | null
  variant: { id: string; sku: string; name: string; ral: string | null } | null
  calibration: { method: string; refValueCm: number } | null
  tolerance: { sigmaRule: { key: string; valueCm: number } | null; dolzinaRule: { key: string; valueCm: number } | null }
  model: PlanModel
}

// barve segmentov po statusu (usklajeno s SEGMENT_STATUSES lestvico)
const STROKE: Record<string, string> = {
  ESTIMATED: '#9ca3af',
  AUTO_SUGGESTED: '#8b5cf6',
  MANUAL: '#d97706',
  CALIBRATED: '#0d9488',
  VERIFIED: '#059669',
  CONFIRMED: '#475569',
}
const STROKE_SELECTED = '#dc2626'

const GATE_TONE: Record<string, string> = {
  DOBER: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  DODAJ: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  NEZADOSTNO: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
}

const NODE_GLYPH: Record<string, { shape: 'circle' | 'rect' | 'diamond'; label: string }> = {
  ZACETEK: { shape: 'circle', label: 'Z' },
  STEBER: { shape: 'circle', label: 'S' },
  VOGAL: { shape: 'diamond', label: 'V' },
  VRATA: { shape: 'rect', label: 'Vr' },
  STOPNISCE: { shape: 'rect', label: 'St' },
  KONEC: { shape: 'circle', label: 'K' },
}

const fmtCm = (n: number | null | undefined, unit = 'cm'): string =>
  n == null ? '—' : `${(Math.round(n * 10) / 10).toLocaleString('sl-SI')} ${unit}`

// ─── Modul ──────────────────────────────────────────────────────────────────

export default function ModelModule () {
  const user = useAppStore((s) => s.user)
  const [projectId, setProjectId] = useState<string>('')
  const [runId, setRunId] = useState<string>('')
  const [view, setView] = useState<'plan' | 'profile' | '3d'>('plan')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [turns, setTurns] = useState<string>('') // niz L/D po vrstnem redu vogalov
  const [yaw, setYaw] = useState(-30)
  const [pitch, setPitch] = useState(25)

  const projects = useApi<{ data: ProjectOption[] }>(user ? '/api/projects?limit=500' : null)
  const runs = useApi<{ data: RunOption[] }>(projectId ? `/api/fence-run?projectId=${projectId}` : null)
  const modelApi = useApi<{ data: ModelPayload }>(
    runId ? `/api/fence-run/${runId}/model${turns ? `?turns=${encodeURIComponent(turns)}` : ''}` : null
  )

  // izbira projekta/tekača → počisti stanje (model se naloči prek useApi)
  function onProject (v: string): void {
    setProjectId(v); setRunId(''); setSelectedKey(null); setTurns('')
  }
  function onRun (v: string): void {
    setRunId(v); setSelectedKey(null); setTurns('')
  }

  const m = modelApi.data?.data?.model
  const model = modelApi.data?.data
  const selected = m?.segments.find((s) => s.key === selectedKey) ?? null
  const corners = useMemo(
    () => m?.nodes.filter((n) => n.kind === 'VOGAL' && n.interiorDeg != null) ?? [],
    [m]
  )

  function setTurn (idx: number, v: 'L' | 'D'): void {
    const arr = (turns || 'L'.repeat(corners.length)).split('')
    arr[idx] = v
    setTurns(arr.join(''))
  }
  function mirrorTurns (): void {
    if (!corners.length) return
    const cur = turns || 'L'.repeat(corners.length)
    setTurns(cur.split('').map((c) => (c === 'D' ? 'L' : 'D')).join(''))
  }

  const projOpts = projects.data?.data ?? []
  const runOpts = runs.data?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Merilni model"
        desc="Geometrija iz tekača — tloris, profil, 3D (issue #9 §3, R473)"
        actions={m ? (
          <Badge variant="outline" className="gap-1 font-normal">
            <ScanLine className="size-3" aria-hidden /> {m.engineVersion}
          </Badge>
        ) : null}
      />

      {/* izbire */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="model-proj">Projekt</Label>
          <Select value={projectId} onValueChange={onProject}>
            <SelectTrigger id="model-proj" aria-label="Projekt">
              <SelectValue placeholder="Izberite projekt" />
            </SelectTrigger>
            <SelectContent>
              <ScrollArea className="max-h-64">
                {projOpts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                ))}
              </ScrollArea>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="model-run">Ograjni tekač</Label>
          <Select value={runId} onValueChange={onRun} disabled={!projectId}>
            <SelectTrigger id="model-run" aria-label="Ograjni tekač">
              <SelectValue placeholder={projectId ? 'Izberite tekač' : 'Najprej projekt'} />
            </SelectTrigger>
            <SelectContent>
              <ScrollArea className="max-h-64">
                {runOpts.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} · {fmtCm(r.totalLengthCm)}
                  </SelectItem>
                ))}
              </ScrollArea>
            </SelectContent>
          </Select>
        </div>
      </div>

      <ErrorBox error={projects.error} />
      <ErrorBox error={runs.error} />
      {projects.loading && <LoadingRows />}

      {!projects.loading && !projectId && projOpts.length > 0 && (
        <EmptyState icon={MapIcon} title="Izberite projekt" desc="Merilni model se gradi iz potrjene ali vodene izmere tekača projekta." />
      )}
      {projectId && runs.loading && <LoadingRows />}
      {projectId && !runs.loading && runOpts.length === 0 && (
        <EmptyState icon={Fence} title="Projekt nima ograjnega tekača" desc="Ustvarite ga v modulu Ogradnja — model se izpelje samodejno (nič ne ovira projekta)." />
      )}

      <ErrorBox error={modelApi.error} />
      {modelApi.loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Izpeljujem model…</div>
      )}

      {m && (
        <>
          {/* kakovost — poštena glava */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Quality gate tekača"
              value={m.quality.gate ? m.quality.gate.state : '—'}
              hint={m.quality.gate ? `ocena ${m.quality.gate.score}/100` : 'brez izračuna'}
              icon={ShieldQuestion}
              tone={m.quality.gate?.state === 'DOBER' ? 'green' : m.quality.gate?.state === 'DODAJ' ? 'amber' : 'red'}
            />
            <StatCard
              label="Preverjeni segmenti"
              value={`${Math.round(m.quality.verifiedShare * 100)} %`}
              hint={`${m.quality.unverified} nepreverjenih od ${m.segments.length}`}
              icon={ScanLine}
              tone={m.quality.verifiedShare >= 0.99 ? 'green' : m.quality.verifiedShare >= 0.5 ? 'amber' : 'red'}
            />
            <StatCard
              label="Ocena napake položaja σ"
              value={m.quality.sigmaCm != null ? `± ${fmtCm(m.quality.sigmaCm)}` : 'ni podatka'}
              hint={
                m.quality.sigmaSource === 'RULE:tol_pozicija_modela' ? 'pravilo tol_pozicija_modela'
                  : m.quality.sigmaSource === 'OCENA_METODE' ? `ocena po metodi${model?.calibration ? ` (${model.calibration.method})` : ''}`
                    : 'brez kalibracije'
              }
              icon={Ruler}
            />
            <StatCard
              label="Skupna dolžina"
              value={fmtCm(m.totalLengthCm)}
              hint={`tloris ${fmtCm(m.totalPlanCm)}${m.closureGapCm != null ? ` · odprtina ${fmtCm(m.closureGapCm)}` : ''}`}
              icon={ArrowLeftRight}
            />
          </div>

          {/* predpostavke — IZRECNO */}
          {m.quality.assumptions.length > 0 && (
            <Card>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex items-center gap-1.5 font-medium"><Info className="size-4 text-muted-foreground" aria-hidden /> Predpostavke izpeljave</div>
                {m.quality.assumptions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Badge variant="outline" className={a.severity === 'OPOZORILO' ? 'border-amber-400 text-amber-700 dark:text-amber-300' : ''}>{a.severity}</Badge>
                    <span className="text-muted-foreground">{a.message}</span>
                  </div>
                ))}
                <div className="pt-1 text-xs text-muted-foreground">{m.originNote}</div>
              </CardContent>
            </Card>
          )}

          {/* smeri zavojev */}
          {corners.length > 0 && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium"><Compass className="size-4 text-muted-foreground" aria-hidden /> Smeri zavojev ({corners.length})</div>
                  <Button size="sm" variant="outline" onClick={mirrorTurns}>
                    <RotateCcw className="size-4" aria-hidden /> Zrcali
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {corners.map((c, i) => (
                    <div key={c.key} className="flex items-center gap-1 rounded-lg border px-2 py-1">
                      <span className="text-xs text-muted-foreground">{c.key} · {(c.atCm / 100).toFixed(1)} m · {c.interiorDeg}°</span>
                      <div className="flex">
                        <Button
                          size="sm" variant={(turns[i] ?? 'L') === 'L' ? 'default' : 'outline'} className="h-7 px-2 text-xs"
                          onClick={() => setTurn(i, 'L')} aria-label={`Zavoj ${i + 1} levo`}
                        >LEVO</Button>
                        <Button
                          size="sm" variant={turns[i] === 'D' ? 'default' : 'outline'} className="h-7 px-2 text-xs"
                          onClick={() => setTurn(i, 'D')} aria-label={`Zavoj ${i + 1} desno`}
                        >DESNO</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Tekač ne beleži smeri zavojev — izbira je predpostavka in je zapisana v kakovosti modela. Mere segmentov so od nje neodvisne.</p>
              </CardContent>
            </Card>
          )}

          {/* pogledi */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={view === 'plan' ? 'default' : 'outline'} onClick={() => setView('plan')}><MapIcon className="size-4" aria-hidden /> Tloris</Button>
            <Button size="sm" variant={view === 'profile' ? 'default' : 'outline'} onClick={() => setView('profile')}><Mountain className="size-4" aria-hidden /> Profil</Button>
            <Button size="sm" variant={view === '3d' ? 'default' : 'outline'} onClick={() => setView('3d')}><Box className="size-4" aria-hidden /> 3D</Button>
            <span className="ml-auto text-xs text-muted-foreground">Kliknite segment za mere, vir in status</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <Card>
              <CardContent className="p-2 sm:p-4">
                {view === 'plan' && <PlanView m={m} selectedKey={selectedKey} onSelect={setSelectedKey} />}
                {view === 'profile' && <ProfileView m={m} selectedKey={selectedKey} onSelect={setSelectedKey} />}
                {view === '3d' && <PerspectiveView m={m} selectedKey={selectedKey} onSelect={setSelectedKey} yaw={yaw} pitch={pitch} setYaw={setYaw} setPitch={setPitch} />}
              </CardContent>
            </Card>

            <div className="space-y-3">
              {selected ? <SegmentPanel seg={selected} nodeA={m.nodes.find((n) => n.key === selected.fromKey)} nodeB={m.nodes.find((n) => n.key === selected.toKey)} product={model?.product ?? null} variant={model?.variant ?? null} /> : (
                <Card><CardContent className="text-sm text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">Segment</div>
                  Izberite segment na risbi (ali spodaj na seznamu) za mere, vir, status in izdelek.
                </CardContent></Card>
              )}
              <Card>
                <CardContent className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium"><Layers className="size-4 text-muted-foreground" aria-hidden /> Segmenti</div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.segments.map((s) => (
                      <button
                        key={s.key} type="button"
                        onClick={() => setSelectedKey(s.key)}
                        className={`rounded-md border px-2 py-1 text-xs ${s.key === selectedKey ? 'border-red-400 bg-red-50 dark:bg-red-950' : 'hover:bg-muted'}`}
                        aria-pressed={s.key === selectedKey}
                      >
                        <span className="inline-block size-2 rounded-full align-middle" style={{ background: STROKE[s.status] ?? STROKE.ESTIMATED }} aria-hidden /> {s.key}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Tloris ─────────────────────────────────────────────────────────────────

function PlanView ({ m, selectedKey, onSelect }: { m: PlanModel; selectedKey: string | null; onSelect: (k: string) => void }) {
  const W = 900; const H = 560; const PAD = 60
  const bw = Math.max(1, m.bounds.maxX - m.bounds.minX); const bh = Math.max(1, m.bounds.maxY - m.bounds.minY)
  const scale = Math.min((W - 2 * PAD) / bw, (H - 2 * PAD) / bh)
  const tx = (x: number): number => (x - m.bounds.minX) * scale + PAD + ((W - 2 * PAD) - bw * scale) / 2
  const ty = (y: number): number => (y - m.bounds.minY) * scale + PAD + ((H - 2 * PAD) - bh * scale) / 2
  const edges = projectPlan(m)
  const gridStep = niceStep(50 / scale) // ~50 cm na zaslonu → svetlejša mreža v cm
  const [gMinX, gMaxX] = [Math.floor(m.bounds.minX / gridStep) * gridStep, Math.ceil(m.bounds.maxX / gridStep) * gridStep]
  const [gMinY, gMaxY] = [Math.floor(m.bounds.minY / gridStep) * gridStep, Math.ceil(m.bounds.maxY / gridStep) * gridStep]

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="Tloris merilnega modela">
        {/* mreža */}
        {range(gMinX, gMaxX, gridStep).map((gx) => (
          <line key={`gx${gx}`} x1={tx(gx)} y1={0} x2={tx(gx)} y2={H} className="stroke-muted/30" strokeWidth={1} />
        ))}
        {range(gMinY, gMaxY, gridStep).map((gy) => (
          <line key={`gy${gy}`} x1={0} y1={ty(gy)} x2={W} y2={ty(gy)} className="stroke-muted/30" strokeWidth={1} />
        ))}
        {/* segmenti */}
        {edges.map((e) => {
          const sel = e.key === selectedKey
          const st = SEGMENT_STATUSES[e.status as keyof typeof SEGMENT_STATUSES] ?? SEGMENT_STATUSES.ESTIMATED
          return (
            <g key={e.key}>
              <line
                x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
                stroke={sel ? STROKE_SELECTED : (STROKE[e.status] ?? STROKE.ESTIMATED)}
                strokeWidth={sel ? 6 : 4} strokeLinecap="round" className="cursor-pointer"
                onClick={() => onSelect(e.key)}
              >
                <title>{`${e.key} — ${fmtCm(e.labelCm)} (${st.label})`}</title>
              </line>
              <text
                x={(tx(e.x1) + tx(e.x2)) / 2} y={(ty(e.y1) + ty(e.y2)) / 2 - 8}
                textAnchor="middle" className="fill-foreground pointer-events-none text-[11px]"
              >
                {`${e.key} · ${Math.round(e.labelCm)}`}
              </text>
            </g>
          )
        })}
        {/* vozlišča */}
        {m.nodes.map((n) => <NodeGlyph key={n.key} n={n} cx={tx(n.p.x)} cy={ty(n.p.y)} />)}
        {/* smer +X (orientacija izhodišča) */}
        <g>
          <defs>
            <marker id="arrowX" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          <line x1={PAD - 30} y1={H - PAD + 20} x2={PAD + 10} y2={H - PAD + 20} className="stroke-muted-foreground" strokeWidth={1.5} markerEnd="url(#arrowX)" />
          <text x={PAD - 30} y={H - PAD + 36} className="fill-muted-foreground text-[10px]">+X (smer 1. segmenta)</text>
        </g>
        {/* merilec */}
        <ScaleBar scale={scale} y={H - 24} />
      </svg>
      <div className="text-xs text-muted-foreground">Tloris (cm) — {m.originNote}</div>
    </div>
  )
}

function NodeGlyph ({ n, cx, cy }: { n: ModelNode; cx: number; cy: number }) {
  const g = NODE_GLYPH[n.kind] ?? NODE_GLYPH.STEBER
  const fill = n.kind === 'VOGAL' ? '#d97706' : n.kind === 'VRATA' ? '#8b5cf6' : n.kind === 'KONEC' ? '#475569' : '#059669'
  return (
    <g>
      {g.shape === 'diamond'
        ? <rect x={cx - 5} y={cy - 5} width={10} height={10} transform={`rotate(45 ${cx} ${cy})`} fill={fill} />
        : g.shape === 'rect'
          ? <rect x={cx - 5} y={cy - 5} width={10} height={10} fill={fill} />
          : <circle cx={cx} cy={cy} r={5} fill={fill} />}
      <text x={cx + 8} y={cy - 6} className="fill-muted-foreground pointer-events-none text-[9px]">{g.label}</text>
      <title>{`${n.key} · ${n.kind}${n.heightCm != null ? ` · h=${n.heightCm} cm` : ''}${n.podlaga != null ? ` · ${n.podlaga}` : ''}`}</title>
    </g>
  )
}

// ─── Profil (elevacija) ─────────────────────────────────────────────────────

function ProfileView ({ m, selectedKey, onSelect }: { m: PlanModel; selectedKey: string | null; onSelect: (k: string) => void }) {
  const W = 900; const H = 420; const PAD = 50
  const { points, segs } = projectProfile(m)
  const maxAt = Math.max(1, ...points.map((p) => p.atCm))
  const zMin = Math.min(0, ...points.map((p) => p.zGround)); const zMax = Math.max(1, ...points.map((p) => p.zTop ?? p.zGround))
  const sx = (at: number): number => PAD + (at / maxAt) * (W - 2 * PAD)
  const sy = (z: number): number => H - PAD - ((z - zMin) / (zMax - zMin)) * (H - 2 * PAD)
  const scale = (W - 2 * PAD) / maxAt

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="Višinski profil modela">
        {/* teren */}
        <polyline
          points={points.map((p) => `${sx(p.atCm)},${sy(p.zGround)}`).join(' ')}
          className="fill-none stroke-muted-foreground/60" strokeWidth={2}
        />
        {/* segmenti (klik) */}
        {segs.map((s) => {
          const sel = s.key === selectedKey
          return (
            <line
              key={s.key} x1={sx(s.x1)} y1={sy(s.z1)} x2={sx(s.x2)} y2={sy(s.z2)}
              stroke={sel ? STROKE_SELECTED : (STROKE[s.status] ?? STROKE.ESTIMATED)} strokeWidth={sel ? 6 : 4} strokeLinecap="round"
              className="cursor-pointer" onClick={() => onSelect(s.key)}
            >
              <title>{`${s.key} — padina ${s.slopeDeg.toFixed(1)}°`}</title>
            </line>
          )
        })}
        {/* stebri od tal do vrha */}
        {points.map((p) => (
          <g key={p.key}>
            <line x1={sx(p.atCm)} y1={sy(p.zGround)} x2={sx(p.atCm)} y2={p.zTop != null ? sy(p.zTop) : sy(p.zGround)} className="stroke-foreground/70" strokeWidth={2} />
            <circle cx={sx(p.atCm)} cy={sy(p.zGround)} r={3} className="fill-muted-foreground" />
            <title>{`${p.key} · teren ${Math.round(p.zGround)} cm${p.zTop != null ? ` · vrh ${Math.round(p.zTop)} cm` : ''}`}</title>
          </g>
        ))}
        {/* ročnik (vrhovi z višino) */}
        <polyline
          points={points.filter((p) => p.zTop != null).map((p) => `${sx(p.atCm)},${sy(p.zTop as number)}`).join(' ')}
          className="fill-none stroke-foreground/50" strokeWidth={1.5} strokeDasharray="5 4"
        />
        <ScaleBar scale={scale} y={H - 16} />
      </svg>
      <div className="text-xs text-muted-foreground">Profil ob teku (x = oddaljenost, y = višina v cm) — črtkano = vrhovi stebrov (kjer je višina znana).</div>
    </div>
  )
}

// ─── 3D perspektiva ─────────────────────────────────────────────────────────

function PerspectiveView ({
  m, selectedKey, onSelect, yaw, pitch, setYaw, setPitch,
}: {
  m: PlanModel; selectedKey: string | null; onSelect: (k: string) => void
  yaw: number; pitch: number; setYaw: (n: number) => void; setPitch: (n: number) => void
}) {
  const W = 900; const H = 560
  const cx = (m.bounds.minX + m.bounds.maxX) / 2; const cy = (m.bounds.minY + m.bounds.maxY) / 2
  const cz = (m.bounds.minZ + m.bounds.maxZ) / 2
  const span = Math.max(
    50, m.bounds.maxX - m.bounds.minX, m.bounds.maxY - m.bounds.minY,
    (m.bounds.maxZ - m.bounds.minZ) + 120,
  )
  const f = Math.max(500, 2.2 * span)
  const P = (x: number, y: number, z: number) => {
    const r = project3d({ x: x - cx, y: y - cy, z: z - cz }, yaw, pitch, f)
    return { sx: W / 2 + r.sx, sy: H / 2 + r.sy, depth: r.depth }
  }

  // liki: tla + ploskve segmentov — TEREN vedno prvi (za ograjo), nato
  // ograjne ploskve po globini (painterjev algoritem); zvezni ročnik/tla
  // (spodaj) vizualno povežeta segmente v eno steno.
  type Quad = { pts: { sx: number; sy: number; depth: number }[]; key: string; kind: 'seg' | 'terrain' }
  const quads: Quad[] = []
  for (const s of m.segments) {
    const ha = m.nodes.find((n) => n.key === s.fromKey); const hb = m.nodes.find((n) => n.key === s.toKey)
    const hA = ha?.heightCm ?? 110; const hB = hb?.heightCm ?? 110
    const a = { x: s.a.x, y: s.a.y, z: s.a.z }; const b = { x: s.b.x, y: s.b.y, z: s.b.z }
    quads.push({
      key: s.key, kind: 'seg',
      pts: [
        P(a.x, a.y, a.z), P(b.x, b.y, b.z), P(b.x, b.y, b.z + hB), P(a.x, a.y, a.z + hA),
      ],
    })
    quads.push({ key: s.key, kind: 'terrain', pts: [P(a.x, a.y, a.z - 6), P(b.x, b.y, b.z - 6), P(b.x, b.y, b.z), P(a.x, a.y, a.z)] })
  }
  const terrainQuads = quads.filter((q) => q.kind === 'terrain')
  const segQuads = quads.filter((q) => q.kind === 'seg').sort((q1, q2) => avgDepth(q2) - avgDepth(q1))

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="3D perspektiva modela">
        {/* teren — vedno za ograjo */}
        {terrainQuads.map((q, i) => (
          <polygon
            key={`t${q.key}${i}`} points={q.pts.map((p) => `${p.sx},${p.sy}`).join(' ')}
            className="fill-muted/40 stroke-muted/60" strokeWidth={1}
          />
        ))}
        {/* ograjne ploskve — po globini */}
        {segQuads.map((q, i) => {
          const s = m.segments.find((ss) => ss.key === q.key)
          const sel = q.key === selectedKey
          return (
            <polygon
              key={`s${q.key}${i}`} points={q.pts.map((p) => `${p.sx},${p.sy}`).join(' ')}
              fill={sel ? 'rgba(220,38,38,0.35)' : 'rgba(5,150,105,0.18)'}
              stroke={sel ? STROKE_SELECTED : (STROKE[s?.status ?? 'ESTIMATED'] ?? STROKE.ESTIMATED)}
              strokeWidth={sel ? 3 : 2} className="cursor-pointer" onClick={() => onSelect(q.key)}
            >
              <title>{`${q.key} — ${s ? fmtCm(s.lengthCm) : ''}`}</title>
            </polygon>
          )
        })}
        {/* ZVEZNA talna črta + ročnik — povežeta segmente v eno steno */}
        <polyline
          points={m.nodes.map((n) => { const p = P(n.p.x, n.p.y, n.p.z); return `${p.sx},${p.sy}` }).join(' ')}
          className="fill-none stroke-foreground/50" strokeWidth={1.5}
        />
        <polyline
          points={m.nodes.map((n) => { const p = P(n.p.x, n.p.y, n.p.z + (n.heightCm ?? 110)); return `${p.sx},${p.sy}` }).join(' ')}
          className="fill-none stroke-foreground/80" strokeWidth={2.5} strokeLinejoin="round"
        />
        {/* stebri kot črte */}
        {m.nodes.map((n) => {
          const h = n.heightCm ?? 110
          const b = P(n.p.x, n.p.y, n.p.z); const t = P(n.p.x, n.p.y, n.p.z + h)
          return (
            <line key={`p${n.key}`} x1={b.sx} y1={b.sy} x2={t.sx} y2={t.sy} className="stroke-foreground/80" strokeWidth={2.5} strokeLinecap="round">
              <title>{`${n.key} · ${n.kind} · h=${h} cm`}</title>
            </line>
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-48 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground"><span>Obhod (yaw)</span><span>{yaw}°</span></div>
          <Slider value={[yaw]} min={-90} max={90} step={5} onValueChange={(v) => setYaw(v[0])} aria-label="Obhod pogleda" />
        </div>
        <div className="flex-1 min-w-48 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground"><span>Nagib (pitch)</span><span>{pitch}°</span></div>
          <Slider value={[pitch]} min={5} max={60} step={5} onValueChange={(v) => setPitch(v[0])} aria-label="Nagib pogleda" />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Perspektivni prikaz — mere (cm) iz tekača; višine stebrov prikazane tudi tam, kjer niso izmerjene (privzeto 110 cm).</div>
    </div>
  )
}

function avgDepth (q: { pts: { depth: number }[] }): number {
  return q.pts.reduce((a, p) => a + p.depth, 0) / q.pts.length
}

// ─── Podatki izbranega segmenta ─────────────────────────────────────────────

function SegmentPanel ({
  seg, nodeA, nodeB, product, variant,
}: {
  seg: ModelSegment
  nodeA: ModelNode | undefined; nodeB: ModelNode | undefined
  product: ModelPayload['product']; variant: ModelPayload['variant']
}) {
  const st = SEGMENT_STATUSES[seg.status] ?? SEGMENT_STATUSES.ESTIMATED
  return (
    <Card>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">Segment {seg.key}</div>
          <Badge className={st.cls}>{st.label}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <Row k="Dolžina (po padini)" v={fmtCm(seg.lengthCm)} />
          <Row k="Tlorisna dolžina" v={fmtCm(seg.planCm)} />
          <Row k="Višina polnila" v={seg.heightCm != null ? fmtCm(seg.heightCm) : 'ni izmerjena'} />
          <Row k="Višinska razlika" v={fmtCm(seg.heightDiffCm)} />
          <Row k="Padina" v={`${seg.slopeDeg.toFixed(1)}°`} />
          <Row k="Notranji kot" v={seg.interiorDeg != null ? `${seg.interiorDeg.toFixed(1)}°` : '—'} />
          <Row k="Vmesni stebri" v={`${seg.posts}`} />
          <Row k="σ položaja" v={seg.sigmaCm != null ? `± ${fmtCm(seg.sigmaCm)}` : 'ni podatka'} />
        </dl>
        <div className="space-y-1 border-t pt-2">
          <div className="text-xs font-medium text-muted-foreground">Vir</div>
          <div className="text-xs text-muted-foreground">
            {seg.verifiedCm != null
              ? `Preverjeno z zunanjim merilnikom: ${fmtCm(seg.verifiedCm)}${seg.verifyMethod ? ` (${seg.verifyMethod})` : ''}`
              : 'Brez zunanje verifikacije — vir: tekač (vnos/kalibracija).'}
          </div>
          <div className="text-xs text-muted-foreground">
            Vozlišči: {nodeA?.key ?? '—'} ({nodeA?.kind ?? '—'}{nodeA?.podlaga ? `, ${nodeA.podlaga}` : ''}) → {nodeB?.key ?? '—'} ({nodeB?.kind ?? '—'}{nodeB?.podlaga ? `, ${nodeB.podlaga}` : ''})
          </div>
          {(nodeA?.gateWcm != null || nodeB?.gateWcm != null) && (
            <div className="text-xs text-muted-foreground">Vrata: širina {fmtCm(nodeA?.gateWcm ?? nodeB?.gateWcm)}</div>
          )}
        </div>
        <div className="space-y-1 border-t pt-2">
          <div className="text-xs font-medium text-muted-foreground">Izdelek</div>
          <div className="text-xs text-muted-foreground">
            {product ? `${product.sku} — ${product.name}${variant ? ` · ${variant.name}${variant.ral ? ` (RAL ${variant.ral})` : ''}` : ''}` : 'Izdelek ni izbran na tekaču.'}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Row ({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium tabular-nums">{v}</dd>
    </div>
  )
}

// ─── Pomožno ────────────────────────────────────────────────────────────────

function ScaleBar ({ scale, y }: { scale: number; y: number }) {
  const cm = niceStep(120 / scale) // ~120 px
  const px = cm * scale
  return (
    <g>
      <rect x={24} y={y - 10} width={px} height={5} className="fill-foreground" />
      <rect x={24 + px} y={y - 10} width={px} height={5} className="fill-background stroke-foreground" strokeWidth={1} />
      <text x={24} y={y - 16} className="fill-foreground text-[10px]">{cm} cm</text>
      <text x={24 + px * 2 + 6} y={y - 16} className="fill-foreground text-[10px]">{cm * 2} cm</text>
    </g>
  )
}

function niceStep (min: number): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
  return steps.find((s) => s >= min) ?? 10000
}

function range (a: number, b: number, step: number): number[] {
  const out: number[] = []
  for (let v = a; v <= b + 0.001; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

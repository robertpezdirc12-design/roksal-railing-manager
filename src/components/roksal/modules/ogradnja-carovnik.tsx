'use client'

// OGRADNJA — čarovnik (5 faz §1/§23: sistem vodi monterja) — R547 izvleček iz
// ogradnja.tsx (razbitje po vzorcu R546; BREZ spremembe obnašanja).
// Živi predogled uporablja ISTI engine kot strežnik (src/lib/fence-run-engine).

import { useMemo, useState } from 'react'
import {
  BadgeCheck, ChevronLeft, ChevronRight, Fence, Gauge, Loader2, Mountain,
  Plus, Radar, Ruler, SquareStack, Trash2, Wand2,
} from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiPatch, apiPost, useApi } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
  CALIB_METHODS, NODE_KINDS, PODLAGE, PRITRDITVE,
  computeSegments, methodConfidence, productRulesFromTech, suggestPosts,
  validateRun, qualityGate,
  type NodeKind, type ProductRules, type RunCalibration, type RunNode, type TerrainPoint,
} from '@/lib/fence-run-engine'
import { PHASES, QualityDot, ReviewRow, ValidationList, fmtM, gateLabel, num, type ProductOption, type ProjectOption, type RunDetail } from './ogradnja-shared'
import { VerifyPhase } from './ogradnja-verify'

// ─── Čarovnik (5 faz §1/§23: sistem vodi monterja) ─────────────────────────

interface WizardState {
  projectId: string
  name: string
  productId: string
  variantId: string
  calibrationMethod: string
  refValueCm: string
  refObject: string
  device: string
  nodes: RunNode[]
  terrain: TerrainPoint[]
  note: string
}

export function WizardDialog ({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [phase, setPhase] = useState(0)
  const [busy, setBusy] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [handoff, setHandoff] = useState(true)
  const [detail, setDetail] = useState<RunDetail | null>(null)

  const projects = useApi<{ data: ProjectOption[] }>('/api/projects', [])
  const productsAll = useApi<{ data: ProductOption[] }>('/api/products?family=all', [])

  const [st, setSt] = useState<WizardState>({
    projectId: '', name: '', productId: '', variantId: '',
    calibrationMethod: 'ZNANA_MERA', refValueCm: '', refObject: '', device: '',
    nodes: [{ kind: 'ZACETEK', atCm: 0 }],
    terrain: [{ distCm: 0, elevCm: 0 }],
    note: '',
  })

  const product = useMemo(
    () => productsAll.data?.data.find((p) => p.id === st.productId) ?? null,
    [productsAll.data, st.productId]
  )
  const rules: ProductRules = useMemo(() => {
    const t = productRulesFromTech(product?.tech)
    return { maxSpanCm: t.maxSpanCm ?? 120, maxSlopeDeg: t.maxSlopeDeg ?? 30, gateMaxWcm: t.gateMaxWcm ?? 500 }
  }, [product])

  // živi izračun — ISTI engine kot strežnik
  const segmentsCalc = useMemo(
    () => computeSegments({ nodes: st.nodes, terrain: st.terrain.length >= 2 ? st.terrain : null, rules }),
    [st.nodes, st.terrain, rules]
  )
  const suggestions = useMemo(
    () => suggestPosts(segmentsCalc, rules),
    [segmentsCalc, rules]
  )
  const validation = useMemo(
    () => validateRun({
      nodes: st.nodes, segments: segmentsCalc, terrain: st.terrain.length >= 2 ? st.terrain : null,
      rules, calibration: st.refValueCm ? { method: st.calibrationMethod as RunCalibration['method'], refValueCm: Number(st.refValueCm) } : null,
      pendingPosts: suggestions,
    }),
    [st.nodes, st.terrain, segmentsCalc, rules, st.calibrationMethod, st.refValueCm, suggestions]
  )
  const quality = useMemo(
    () => qualityGate({
      nodes: st.nodes, segments: segmentsCalc, validation,
      calibration: st.refValueCm ? { method: st.calibrationMethod as RunCalibration['method'], refValueCm: Number(st.refValueCm) } : null,
      terrain: st.terrain.length >= 2 ? st.terrain : null, verifications: 0,
    }),
    [st.nodes, segmentsCalc, validation, st.calibrationMethod, st.refValueCm, st.terrain]
  )

  function setNode (i: number, patch: Partial<RunNode>): void {
    setSt((s) => ({ ...s, nodes: s.nodes.map((n, k) => (k === i ? { ...n, ...patch } : n)) }))
  }

  /** Vodenje (§23): dodajanje točke z dolžino od prejšnje. */
  function addNode (kind: NodeKind): void {
    setSt((s) => {
      const last = s.nodes[s.nodes.length - 1]
      const at = last ? last.atCm + 250 : 0
      return { ...s, nodes: [...s.nodes, { kind, atCm: at, manual: true }] }
    })
  }

  async function createRun (): Promise<boolean> {
    if (!st.projectId) {
      toast({ title: 'Izberite projekt', variant: 'destructive' })
      return false
    }
    setBusy(true)
    try {
      const cal = st.refValueCm
        ? {
          method: st.calibrationMethod,
          refValueCm: Number(st.refValueCm),
          ...(st.refObject ? { refObject: st.refObject } : {}),
          ...(st.device ? { device: st.device } : {}),
          capturedAt: new Date().toISOString().slice(0, 16),
        }
        : null
      const res = await apiPost<{ data: { id: string } }>('/api/fence-run', {
        projectId: st.projectId,
        name: st.name || undefined,
        nodes: st.nodes,
        terrain: st.terrain.length >= 2 ? st.terrain : undefined,
        calibration: cal ?? undefined,
        productId: st.productId || undefined,
        variantId: st.variantId || undefined,
        note: st.note || undefined,
      })
      setRunId(res.data.id)
      toast({ title: 'Tekač ustvarjen', description: 'Osnova shranjena — nadaljujte z vozlišči.' })
      return true
    } catch (e) {
      toast({ title: 'Ustvarjanje ni uspelo', description: (e as Error).message, variant: 'destructive' })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function patchNodes (nodes: RunNode[]): Promise<boolean> {
    if (!runId) return false
    setBusy(true)
    try {
      // vozlišča IN teren skupaj — teren se ureja v isti fazi (§12)
      await apiPatch(`/api/fence-run/${runId}`, {
        nodes,
        terrain: st.terrain.length >= 2 ? st.terrain : null,
      })
      return true
    } catch (e) {
      toast({ title: 'Shranjevanje ni uspelo', description: (e as Error).message, variant: 'destructive' })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function applyLayout (): Promise<void> {
    if (!runId) return
    setBusy(true)
    try {
      const res = await apiPost<{ data: { applied: number } }>(`/api/fence-run/${runId}/layout`, { apply: true })
      const applied = res.data.applied
      if (applied > 0) {
        // osveži lokalna vozlišča iz strežniške resnice
        const det = await apiGet<{ data: RunDetail }>(`/api/fence-run/${runId}`)
        setSt((s) => ({ ...s, nodes: det.data.run.nodes }))
        toast({ title: `Vstavljenih ${applied} stebrov`, description: 'Razpored sledi max razponu produkta.' })
      } else {
        toast({ title: 'Ni predlogov', description: 'Vsi segmenti so znotraj max razpona.' })
      }
    } catch (e) {
      toast({ title: 'Razpored ni uspel', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function confirmRun (): Promise<void> {
    if (!runId) return
    setBusy(true)
    try {
      const res = await apiPost<{ data: { measurementId: string; package?: { code: string }; summary: { totalLengthCm: number } } }>(
        `/api/fence-run/${runId}/confirm`, { handoff }
      )
      toast({
        title: 'Izmera potrjena',
        description: `Meritev ustvarjena${res.data.package ? ` · paket ${res.data.package.code}` : ''} — ${fmtM(res.data.summary.totalLengthCm)}.`,
      })
      onSaved()
      onClose()
    } catch (e) {
      toast({ title: 'Potrditev zavrnjena', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function goto (next: number): Promise<void> {
    // ustvari tekač ob prehodu iz OSNOVE (1. faza) — incrementalni save
    if (phase === 0 && next > 0 && !runId) {
      const okDone = await createRun()
      if (!okDone) return
    }
    // shrani vozlišča ob prehodu iz TEKAČA
    if (phase === 1 && next > 1 && runId) {
      const okDone = await patchNodes(st.nodes)
      if (!okDone) return
    }
    if (next === 3 && runId) {
      // osveži podrobnost za fazo PREVERI
      try {
        const det = await apiGet<{ data: RunDetail }>(`/api/fence-run/${runId}`)
        setDetail(det.data)
      } catch { /* pusti prazno */ }
    }
    setPhase(next)
  }

  const ogrProducts = (productsAll.data?.data ?? []).filter((p) => !p.family || p.family.code.startsWith('OGRAJA'))

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[92vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fence className="size-5" aria-hidden /> Nova ograjna izmera
          </DialogTitle>
          <DialogDescription>
            {PHASES[phase]} ({phase + 1}/{PHASES.length}) — vodeni postopek: sistem pove, kaj je treba izmeriti.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1" role="tablist" aria-label="Faze izmere">
          {PHASES.map((p, i) => (
            <div
              key={p}
              role="tab"
              aria-selected={i === phase}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                i < phase ? 'bg-primary' : i === phase ? 'bg-primary/60' : 'bg-muted'
              )}
            />
          ))}
        </div>

        <ScrollArea className="max-h-[58vh] pr-3">
          <div className="space-y-4 px-0.5">
            {phase === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ogr-projekt">Projekt *</Label>
                  <Select value={st.projectId} onValueChange={(v) => setSt((s) => ({ ...s, projectId: v }))}>
                    <SelectTrigger id="ogr-projekt" aria-label="Projekt">
                      <SelectValue placeholder="Izberite projekt" />
                    </SelectTrigger>
                    <SelectContent>
                      {(projects.data?.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ogr-ime">Ime izmere</Label>
                  <Input id="ogr-ime" value={st.name} onChange={(e) => setSt((s) => ({ ...s, name: e.target.value }))} placeholder="npr. Ograja vhod — leva stran" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ogr-izdelek">ROKSAL izdelek (§8 isti vir)</Label>
                  <Select
                    value={st.productId || 'brez'}
                    onValueChange={(v) => setSt((s) => ({ ...s, productId: v === 'brez' ? '' : v, variantId: '' }))}
                  >
                    <SelectTrigger id="ogr-izdelek" aria-label="Izdelek">
                      <SelectValue placeholder="Brez produkta" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="brez">Brez produkta (razpon 120 cm)</SelectItem>
                      {ogrProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ogr-varianta">Varianta (RAL)</Label>
                  <Select
                    value={st.variantId || 'brez'}
                    onValueChange={(v) => setSt((s) => ({ ...s, variantId: v === 'brez' ? '' : v }))}
                    disabled={!st.productId}
                  >
                    <SelectTrigger id="ogr-varianta" aria-label="Varianta">
                      <SelectValue placeholder="Osnovna" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="brez">Osnovna</SelectItem>
                      {(product?.variants ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name}{v.ral ? ` · ${v.ral}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Card className="gap-2 py-3 sm:col-span-2">
                  <CardContent className="space-y-3 px-4">
                    <p className="flex items-center gap-1.5 text-sm font-medium"><Gauge className="size-4" aria-hidden /> Kalibracija (§4)</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="ogr-cal-method">Metoda</Label>
                        <Select value={st.calibrationMethod} onValueChange={(v) => setSt((s) => ({ ...s, calibrationMethod: v }))}>
                          <SelectTrigger id="ogr-cal-method" aria-label="Metoda kalibracije">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CALIB_METHODS.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ogr-cal-ref">Referenca (cm) *</Label>
                        <Input id="ogr-cal-ref" inputMode="decimal" value={st.refValueCm} onChange={(e) => setSt((s) => ({ ...s, refValueCm: e.target.value }))} placeholder="npr. 92" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ogr-cal-dev">Naprava</Label>
                        <Input id="ogr-cal-dev" value={st.device} onChange={(e) => setSt((s) => ({ ...s, device: e.target.value }))} placeholder="npr. Leica DISTO D2" />
                      </div>
                      <div className="space-y-1.5 sm:col-span-3">
                        <Label htmlFor="ogr-cal-obj">Kaj je bilo izmerjeno</Label>
                        <Input id="ogr-cal-obj" value={st.refObject} onChange={(e) => setSt((s) => ({ ...s, refObject: e.target.value }))} placeholder="npr. vhodna plošča hiše" />
                      </div>
                    </div>
                    {st.refValueCm && (
                      <p className="text-xs text-muted-foreground">
                        Zaupanje reference: <strong>{methodConfidence({ method: st.calibrationMethod as RunCalibration['method'], refValueCm: Number(st.refValueCm) })} %</strong>
                      </p>
                    )}
                  </CardContent>
                </Card>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ogr-opomba">Opomba</Label>
                  <Input id="ogr-opomba" value={st.note} onChange={(e) => setSt((s) => ({ ...s, note: e.target.value }))} placeholder="opomba k izmeri" />
                </div>
              </div>
            )}

            {phase === 1 && (
              <div className="space-y-4">
                <p className="rounded-lg bg-muted/60 p-3 text-sm">
                  <strong>ZDAJ OZNAČITE TEK OGRAJE:</strong> začnite pri začetku, nato dodajajte točke —
                  za vsako podajte dolžino od prejšnje točke (kamera/laser/meter). Na koncu dodajte <strong>konec</strong>.
                </p>
                <div className="space-y-2">
                  {st.nodes.map((n, i) => {
                    const prev = i > 0 ? st.nodes[i - 1].atCm : null
                    const gap = prev != null ? n.atCm - prev : null
                    return (
                      <div key={i} className="rounded-lg border p-2.5">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div className="space-y-1">
                            <Label className="text-xs">Točka</Label>
                            <Select value={n.kind} onValueChange={(v) => setNode(i, { kind: v as NodeKind })}>
                              <SelectTrigger aria-label="Vrsta točke" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {NODE_KINDS.map((k) => (
                                  <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">{i === 0 ? 'Položaj (cm)' : `Od prejšnje (cm)`}</Label>
                            <Input
                              className="h-8 text-xs"
                              inputMode="decimal"
                              value={i === 0 ? String(n.atCm) : (gap != null ? String(Math.round(gap)) : '')}
                              onChange={(e) => {
                                const v = num(e.target.value)
                                if (v == null) return
                                const at = i === 0 ? v : (prev ?? 0) + v
                                setNode(i, { atCm: at, manual: true })
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Višina (cm)</Label>
                            <Input
                              className="h-8 text-xs"
                              inputMode="decimal"
                              value={n.heightCm ?? ''}
                              placeholder="110"
                              onChange={(e) => {
                                const v = num(e.target.value)
                                setNode(i, { heightCm: v == null ? undefined : v })
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Podlaga</Label>
                            <Select
                              value={n.podlaga ?? 'brez'}
                              onValueChange={(v) => setNode(i, { podlaga: v === 'brez' ? undefined : v as RunNode['podlaga'] })}
                            >
                              <SelectTrigger aria-label="Podlaga" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="brez">—</SelectItem>
                                {PODLAGE.map((p) => (
                                  <SelectItem key={p} value={p}>{p}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {n.kind === 'VRATA' && (
                            <div className="space-y-1">
                              <Label className="text-xs">Širina vrat (cm)</Label>
                              <Input
                                className="h-8 text-xs"
                                inputMode="decimal"
                                value={n.gateWcm ?? ''}
                                onChange={(e) => {
                                  const v = num(e.target.value)
                                  setNode(i, { gateWcm: v == null ? undefined : v })
                                }}
                              />
                            </div>
                          )}
                          {n.kind === 'VOGAL' && (
                            <div className="space-y-1">
                              <Label className="text-xs">Notranji kot (°)</Label>
                              <Input
                                className="h-8 text-xs"
                                inputMode="decimal"
                                value={n.interiorDeg ?? ''}
                                onChange={(e) => {
                                  const v = num(e.target.value)
                                  setNode(i, { interiorDeg: v == null ? undefined : v })
                                }}
                              />
                            </div>
                          )}
                          <div className="space-y-1">
                            <Label className="text-xs">Pritrditev</Label>
                            <Select
                              value={n.pritrditev ?? 'brez'}
                              onValueChange={(v) => setNode(i, { pritrditev: v === 'brez' ? undefined : v as RunNode['pritrditev'] })}
                            >
                              <SelectTrigger aria-label="Pritrditev" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="brez">—</SelectItem>
                                {PRITRDITVE.map((p) => (
                                  <SelectItem key={p} value={p}>{p}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {st.nodes.length > 1 && i === st.nodes.length - 1 && (
                          <div className="mt-2 flex justify-end">
                            <Button size="sm" variant="ghost" onClick={() => setSt((s) => ({ ...s, nodes: s.nodes.slice(0, -1) }))}>
                              <Trash2 className="size-3.5" aria-hidden /> Odstrani točko
                            </Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => addNode('STEBER')}><SquareStack className="size-4" aria-hidden /> Dodaj steber</Button>
                  <Button size="sm" variant="outline" onClick={() => addNode('VOGAL')}><ChevronRight className="size-4" aria-hidden /> Dodaj vogal</Button>
                  <Button size="sm" variant="outline" onClick={() => addNode('VRATA')}><Plus className="size-4" aria-hidden /> Dodaj vrata</Button>
                  <Button size="sm" variant="outline" onClick={() => addNode('STOPNISCE')}><Mountain className="size-4" aria-hidden /> Stopnišče</Button>
                  <Button size="sm" onClick={() => addNode('KONEC')}><Fence className="size-4" aria-hidden /> Konec ograje</Button>
                </div>

                <Card className="gap-2 py-3">
                  <CardContent className="space-y-2 px-4">
                    <p className="flex items-center gap-1.5 text-sm font-medium"><Mountain className="size-4" aria-hidden /> Teren — višinske točke (§12)</p>
                    <p className="text-xs text-muted-foreground">Na klancu dodajte točke: oddaljenost od začetka + višina (cm). Prazno = raven teren.</p>
                    {st.terrain.map((t, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          className="h-8 w-32 text-xs"
                          inputMode="decimal"
                          placeholder="oddaljenost cm"
                          value={String(t.distCm)}
                          onChange={(e) => {
                            const v = num(e.target.value)
                            if (v != null) setSt((s) => ({ ...s, terrain: s.terrain.map((q, k) => (k === i ? { ...q, distCm: v } : q)) }))
                          }}
                        />
                        <span className="text-xs text-muted-foreground">↕</span>
                        <Input
                          className="h-8 w-32 text-xs"
                          inputMode="decimal"
                          placeholder="višina cm"
                          value={String(t.elevCm)}
                          onChange={(e) => {
                            const v = num(e.target.value)
                            if (v != null) setSt((s) => ({ ...s, terrain: s.terrain.map((q, k) => (k === i ? { ...q, elevCm: v } : q)) }))
                          }}
                        />
                        {st.terrain.length > 1 && (
                          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setSt((s) => ({ ...s, terrain: s.terrain.filter((_, k) => k !== i) }))}>
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setSt((s) => ({
                      ...s,
                      terrain: [...s.terrain, { distCm: (s.terrain[s.terrain.length - 1]?.distCm ?? 0) + 250, elevCm: 0 }],
                    }))}>
                      <Plus className="size-4" aria-hidden /> Dodaj višinsko točko
                    </Button>
                  </CardContent>
                </Card>

                {segmentsCalc.length > 0 && (
                  <div className="rounded-lg border">
                    <div className="border-b px-3 py-2 text-sm font-medium">Živi predogled segmentov (isti engine kot strežnik)</div>
                    <div className="max-h-48 overflow-y-auto p-2 text-xs">
                      <table className="w-full">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="px-2 py-1">#</th>
                            <th className="px-2 py-1">od → do</th>
                            <th className="px-2 py-1">dolžina</th>
                            <th className="px-2 py-1">padina</th>
                            <th className="px-2 py-1">Δ višine</th>
                            <th className="px-2 py-1">vmesni</th>
                          </tr>
                        </thead>
                        <tbody>
                          {segmentsCalc.map((s) => (
                            <tr key={s.order} className="border-t">
                              <td className="px-2 py-1">{s.order + 1}</td>
                              <td className="px-2 py-1">{s.fromKind} → {s.toKind}</td>
                              <td className="px-2 py-1 font-medium">{fmtM(s.lengthCm)}</td>
                              <td className="px-2 py-1">{s.slopeDeg.toFixed(1)}°</td>
                              <td className="px-2 py-1">{s.heightDiffCm.toFixed(0)} cm</td>
                              <td className="px-2 py-1">{s.posts}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <ValidationList validation={validation} />
              </div>
            )}

            {phase === 2 && (
              <div className="space-y-4">
                <p className="rounded-lg bg-muted/60 p-3 text-sm">
                  <strong>STEBRI:</strong> engine predlaga vmesne stebre, kadar segment presega max razpon
                  izdelka (<strong>{rules.maxSpanCm} cm</strong>{product ? ` — ${product.sku}` : ' — privzeto'}). Položaj lahko vedno popravite ročno v prejšnji fazi.
                </p>
                <Card className="gap-2 py-3">
                  <CardContent className="space-y-2 px-4">
                    <p className="flex items-center gap-1.5 text-sm font-medium"><Ruler className="size-4" aria-hidden /> Predlogi ({suggestions.length})</p>
                    {suggestions.length === 0 && (
                      <p className="text-xs text-muted-foreground">Vsi segmenti so znotraj max razpona — ni predlogov.</p>
                    )}
                    <AnimatedList className="space-y-1 text-xs">
                      {suggestions.map((s, i) => (
                        <AnimatedListItem key={i} className="flex items-center gap-2">
                          <span className="inline-block size-1.5 rounded-full bg-primary" aria-hidden />
                          Steber na <strong>{fmtM(s.afterAtCm)}</strong> — {s.reason}
                        </AnimatedListItem>
                      ))}
                    </AnimatedList>
                    <Button size="sm" disabled={suggestions.length === 0 || busy || !runId} onClick={() => void applyLayout()}>
                      <Wand2 className="size-4" aria-hidden /> Vstavi predlagane stebre
                    </Button>
                  </CardContent>
                </Card>
                <ValidationList validation={validation} />
              </div>
            )}

            {phase === 3 && (
              <VerifyPhase
                runId={runId}
                detail={detail}
                onRefresh={async () => {
                  if (!runId) return
                  try {
                    const det = await apiGet<{ data: RunDetail }>(`/api/fence-run/${runId}`)
                    setDetail(det.data)
                  } catch { /* prazno */ }
                }}
              />
            )}

            {phase === 4 && detail && (
              <div className="space-y-4">
                <p className="rounded-lg bg-muted/60 p-3 text-sm">
                  <strong>PREGLED PRED POTRDITVIM (§20):</strong> preverite vsako kritično dimenzijo.
                  Potrditev ustvari kanonično meritev — brez ponovnega vnosa v konfigurator/ponudbo (§21).
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ReviewRow label="Skupna dolžina" value={fmtM(detail.analysis.summary.totalLengthCm)} />
                  <ReviewRow label="Stebri (skupaj)" value={String(detail.analysis.summary.postCount)} />
                  <ReviewRow label="Segmenti" value={String(detail.analysis.summary.segmentCount)} />
                  <ReviewRow label="Max padina" value={`${detail.analysis.summary.maxSlopeDeg.toFixed(1)}°`} />
                  <ReviewRow label="Višinska razlika" value={`${detail.analysis.summary.heightDiffCm.toFixed(0)} cm`} />
                  <ReviewRow label="Preverjenih segmentov" value={`${detail.analysis.summary.verifiedCount}/${detail.segments.length}`} />
                  <ReviewRow label="Izdelek" value={detail.run.product ? `${detail.run.product.sku}${detail.run.variant ? ` · ${detail.run.variant.name}` : ''}` : 'brez'} />
                  <ReviewRow label="Kalibracija" value={detail.run.calibration ? `${detail.run.calibration.method} · ${detail.run.calibration.refValueCm} cm` : 'MANJKA'} />
                </div>
                <div className="rounded-lg border p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-medium"><Radar className="size-4" aria-hidden /> Quality gate</p>
                  <div className="flex items-center gap-2">
                    <QualityDot state={detail.analysis.quality.state} />
                    <span className="text-sm font-medium">{gateLabel(detail.analysis.quality.state)}</span>
                    <span className="text-xs text-muted-foreground">({detail.analysis.quality.score}/100)</span>
                  </div>
                  {detail.analysis.quality.reasons.length > 0 && (
                    <ul className="mt-1.5 list-inside list-disc text-xs text-muted-foreground">
                      {detail.analysis.quality.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                </div>
                <ValidationList validation={detail.analysis.validation} />
                <div className="flex items-center space-x-2">
                  <Checkbox id="ogr-handoff" checked={handoff} onCheckedChange={(v) => setHandoff(v === true)} />
                  <Label htmlFor="ogr-handoff" className="text-sm font-normal">
                    Ustvari paket projekta za konfigurator/BOM (isti produkt, količina iz izmere)
                  </Label>
                </div>
                <Button className="w-full" disabled={busy} onClick={() => void confirmRun()}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BadgeCheck className="size-4" aria-hidden />}
                  Potrdi izmero
                </Button>
              </div>
            )}
            {phase === 4 && !detail && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Nalagam pregled …
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={phase === 0 || busy} onClick={() => setPhase((p) => p - 1)}>
            <ChevronLeft className="size-4" aria-hidden /> Nazaj
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 pr-2 text-xs text-muted-foreground">
              <QualityDot state={quality.state} /> {gateLabel(quality.state)}
            </div>
            {phase < PHASES.length - 1 && (
              <Button disabled={busy} onClick={() => void goto(phase + 1)}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Naprej <ChevronRight className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

// KONFIGURATOR — merilni korak (3/6): družinski vhodni obrazec (issue #7 §4)
// + R455 prefill iz potrjene izmere + R488 prenos PRAVIH segmentov tekača.
// R546: izvlečeno iz konfigurator.tsx BREZ spremembe obnašanja.

import { useState } from 'react'
import { Download, Layers, Loader2, Plus, RotateCcw, Ruler, Trash2 } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiGet } from '@/lib/api-client'
import { NACINI_PRITRDITVE, PODLAGE_TERASA, parseNum, pos, round2, runSegmentsFromParams, type Odb, type Seg2, type SegM } from './konfigurator-shared'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'

// ─── 3. MERITVE (družinski vhodni obrazec, issue #7 §4) ───────────────────────

export function StepMeritve (p: {
  familyCode: string
  formType: 'm2' | 'm' | 'kos'
  unit: string
  projectId: string
  segs2: Seg2[]; setSegs2: (v: Seg2[]) => void
  segsM: SegM[]; setSegsM: (v: SegM[]) => void
  odbitki: Odb[]; setOdbitki: (v: Odb[]) => void
  podlaga: string; setPodlaga: (v: string) => void
  visinske: string; setVisinske: (v: string) => void
  padec: string; setPadec: (v: string) => void
  robovi: string; setRobovi: (v: string) => void
  razmik: string; setRazmik: (v: string) => void
  vrata: string; setVrata: (v: string) => void
  nacin: string; setNacin: (v: string) => void
  kosQty: string; setKosQty: (v: string) => void
  opombe: string; setOpombe: (v: string) => void
  qtyManual: string; setQtyManual: (v: string) => void
  computedQty: number
  brutoM2: number
  odbitkiM2: number
  effectiveQty: number
  manualActive: boolean
  nextSegId: () => number
}) {
  const { formType } = p
  const segLabel = formType === 'm' ? 'Segment ograje' : 'Segment površine'
  const { toast } = useToast()
  const [prefillBusy, setPrefillBusy] = useState(false)

  /**
   * R455 (issue #10 §5 — SAMODEJNI PRENOS PODATKOV): prevzeme POTRJENE meritve
   * izbranega projekta (KAMERA + ROCNO, lengthCm > 0) in jih pretvori v segmente
   * — brez ponovnega ročnega prepisovanja istih podatkov v drugem modulu.
   * R488 (P2): meritev iz tekača (params.fenceRunId + params.segments) prenese
   * PRAVE segmente tekača (seg-1 … seg-N) namesto ene flat dolžine — struktura
   * izmere ostane celovita do BOM/ponudbe. Prefill je samo PREDLOGA: segmenti
   * ostanejo ročno urejavi.
   */
  async function prefillFromMeasurements (): Promise<void> {
    if (!p.projectId) {
      toast({ title: 'Najprej izberite projekt.', description: 'Meritve so vezane na projekt (1. korak).', variant: 'destructive' })
      return
    }
    setPrefillBusy(true)
    try {
      const res = await apiGet<{ data: { id: string; type: string; source: string; lengthCm: number | null; heightCm: number | null; location: string | null; params: Record<string, unknown> | null }[] }>(
        `/api/measurements?projectId=${p.projectId}`
      )
      const rows = (res.data ?? []).filter((m) => m.type !== 'FOTO' && (m.lengthCm ?? 0) > 0)
      if (rows.length === 0) {
        toast({ title: 'Ni potrjenih meritev.', description: 'Za ta projekt še ni potrdjenih meritev z dolžino — izmerite s kamero ali vnesite ročno.' })
        return
      }
      const segs: SegM[] = []
      let runBased = 0
      for (const m of rows) {
        const runSegs = runSegmentsFromParams(m.params)
        if (runSegs) {
          // meritev iz tekača → PRAVI segmenti (dolžine/višine 1:1)
          runBased++
          for (const rs of runSegs) {
            segs.push({
              id: p.nextSegId(),
              len: String(Math.round(rs.lengthCm) / 100), // cm → m (na cel cm)
              h: rs.heightCm && rs.heightCm > 0 ? String(Math.round(rs.heightCm) / 100) : '',
            })
          }
        } else {
          // stara flat pot: ena meritev = en segment
          segs.push({
            id: p.nextSegId(),
            len: String(Math.round(m.lengthCm as number) / 100), // cm → m (2 dec.)
            h: m.heightCm && m.heightCm > 0 ? String(Math.round(m.heightCm) / 100) : '',
          })
        }
      }
      p.setSegsM(segs)
      toast({
        title: runBased > 0
          ? `Prevzetih ${segs.length} segmentov iz ${runBased} meritev tekača.`
          : `Prevzetih ${rows.length} meritev iz projekta.`,
        description: runBased > 0
          ? 'Segmenti so 1:1 iz potrjenih tekačev (seg-1 … seg-N) — po potrebi jih prilagodite.'
          : 'Segmenti so iz potrjenih meritev (kamera/ročno) — po potrebi jih prilagodite.',
      })
    } catch (e) {
      toast({ title: 'Prevzem meritev ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setPrefillBusy(false)
    }
  }

  return (
    <section aria-label="Meritve po družini" className="space-y-4">
      {/* ── m²: TERASA / FASADA / PREGRADA / NAPUŠČ / STROP ── */}
      {formType === 'm2' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Ruler className="size-4 text-roksal-amber" aria-hidden /> Segmenti (dolžina × širina)</h3>
            <Button
              type="button" size="sm" variant="outline" className="h-11"
              onClick={() => p.setSegs2([...p.segs2, { id: p.nextSegId(), len: '', wid: '' }])}
            >
              <Plus className="size-4" aria-hidden /> Dodaj segment
            </Button>
          </div>
          <AnimatedList className="space-y-2">
            {p.segs2.map((g, i) => (
              <AnimatedListItem key={g.id} className="space-y-2 rounded-lg border p-2.5">
                <span className="text-xs font-medium text-muted-foreground">{segLabel} {i + 1}</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`seg-${g.id}-len`} className="sr-only">Dolžina segmenta {i + 1} v metrih</Label>
                    <Input
                      id={`seg-${g.id}-len`} className="h-11" type="number" min="0" step="any" inputMode="decimal"
                      placeholder="dolžina m" value={g.len}
                      onChange={(e) => p.setSegs2(p.segs2.map((x) => x.id === g.id ? { ...x, len: e.target.value } : x))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`seg-${g.id}-wid`} className="sr-only">Širina segmenta {i + 1} v metrih</Label>
                    <Input
                      id={`seg-${g.id}-wid`} className="h-11" type="number" min="0" step="any" inputMode="decimal"
                      placeholder="širina m" value={g.wid}
                      onChange={(e) => p.setSegs2(p.segs2.map((x) => x.id === g.id ? { ...x, wid: e.target.value } : x))}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {pos(parseNum(g.len)) && pos(parseNum(g.wid))
                      ? <>površina <span className="font-medium text-foreground">{round2(parseNum(g.len) * parseNum(g.wid))} m²</span></>
                      : 'vnesite dolžino in širino'}
                  </span>
                  <Button
                    type="button" variant="ghost" size="icon" className="size-11 text-muted-foreground hover:text-red-600"
                    aria-label={`Odstrani segment ${i + 1}`}
                    disabled={p.segs2.length === 1}
                    onClick={() => p.setSegs2(p.segs2.filter((x) => x.id !== g.id))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </AnimatedListItem>
            ))}
          </AnimatedList>
        </div>
      ) : null}

      {/* ── FASADA: odbitki okna/vrata/izrezi ── */}
      {formType === 'm2' && p.familyCode === 'FASADA' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Layers className="size-4 text-roksal-amber" aria-hidden /> Odbitki (okna, vrata, izrezi)</h3>
            <Button
              type="button" size="sm" variant="outline" className="h-11"
              onClick={() => p.setOdbitki([...p.odbitki, { id: p.nextSegId(), opis: '', m2: '' }])}
            >
              <Plus className="size-4" aria-hidden /> Dodaj odbitek
            </Button>
          </div>
          {p.odbitki.length === 0 ? (
            <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">Ni odbitkov — bruto površina se uporabi kot neto.</p>
          ) : (
            <AnimatedList className="space-y-2">
              {p.odbitki.map((o, i) => (
                <AnimatedListItem key={o.id} className="space-y-2 rounded-lg border p-2.5">
                  <span className="text-xs font-medium text-muted-foreground">Odbitek {i + 1}</span>
                  <div className="space-y-1">
                    <Label htmlFor={`odb-${o.id}-opis`} className="sr-only">Opis odbitka {i + 1}</Label>
                    <Input
                      id={`odb-${o.id}-opis`} placeholder="npr. okno dnevne sobe" value={o.opis}
                      onChange={(e) => p.setOdbitki(p.odbitki.map((x) => x.id === o.id ? { ...x, opis: e.target.value } : x))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-32 space-y-1">
                      <Label htmlFor={`odb-${o.id}-m2`} className="sr-only">Površina odbitka {i + 1} v m²</Label>
                      <Input
                        id={`odb-${o.id}-m2`} className="h-11" type="number" min="0" step="any" inputMode="decimal"
                        placeholder="m²" value={o.m2}
                        onChange={(e) => p.setOdbitki(p.odbitki.map((x) => x.id === o.id ? { ...x, m2: e.target.value } : x))}
                      />
                    </div>
                    <Button
                      type="button" variant="ghost" size="icon" className="ml-auto size-11 text-muted-foreground hover:text-red-600"
                      aria-label={`Odstrani odbitek ${i + 1}`}
                      onClick={() => p.setOdbitki(p.odbitki.filter((x) => x.id !== o.id))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </AnimatedListItem>
              ))}
            </AnimatedList>
          )}
        </div>
      ) : null}

      {/* ── TERASA: podlaga / višinske razlike / padec / robovi ── */}
      {formType === 'm2' && p.familyCode === 'TERASA' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="konf-podlaga">Podlaga</Label>
            <Select value={p.podlaga} onValueChange={p.setPodlaga}>
              <SelectTrigger id="konf-podlaga" className="h-11" aria-label="Podlaga"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PODLAGE_TERASA.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="konf-visinske">Višinske razlike</Label>
            <Input
              id="konf-visinske" placeholder="npr. 2 stopnice × 17 cm" value={p.visinske}
              onChange={(e) => p.setVisinske(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="konf-padec">Padec (%)</Label>
            <Input
              id="konf-padec" className="h-11" type="number" min="0" max="100" step="any" inputMode="decimal"
              placeholder="npr. 1.5" value={p.padec}
              onChange={(e) => p.setPadec(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="konf-robovi">Robovi (m)</Label>
            <Input
              id="konf-robovi" className="h-11" type="number" min="0" step="any" inputMode="decimal"
              placeholder="npr. 14.5" value={p.robovi}
              onChange={(e) => p.setRobovi(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {/* ── PREGRADA: vrata ── */}
      {formType === 'm2' && p.familyCode === 'PREGRADA' ? (
        <div className="space-y-2">
          <Label htmlFor="konf-vrata-preg">Vrata (kos)</Label>
          <Input
            id="konf-vrata-preg" className="h-11 w-32" type="number" min="0" step="1" inputMode="numeric"
            placeholder="0" value={p.vrata}
            onChange={(e) => p.setVrata(e.target.value)}
          />
        </div>
      ) : null}

      {/* ── m: OGRAJA_PRECNA / OGRAJA_POKOCNA ── */}
      {formType === 'm' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Ruler className="size-4 text-roksal-amber" aria-hidden /> Segmenti ograje (dolžina × višina)</h3>
            <div className="flex flex-wrap gap-2">
              {/* R455 (issue #10 §5): prevzem iz potrjene izmere — brez ponovnega vnosa */}
              <Button
                type="button" size="sm" variant="outline" className="h-11"
                onClick={() => void prefillFromMeasurements()} disabled={prefillBusy}
              >
                {prefillBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
                Prevzemi iz izmere
              </Button>
              <Button
                type="button" size="sm" variant="outline" className="h-11"
                onClick={() => p.setSegsM([...p.segsM, { id: p.nextSegId(), len: '', h: '' }])}
              >
                <Plus className="size-4" aria-hidden /> Dodaj segment
              </Button>
            </div>
          </div>
          <AnimatedList className="space-y-2">
            {p.segsM.map((g, i) => (
              <AnimatedListItem key={g.id} className="space-y-2 rounded-lg border p-2.5">
                <span className="text-xs font-medium text-muted-foreground">{segLabel} {i + 1}</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`segm-${g.id}-len`} className="sr-only">Dolžina segmenta {i + 1} v metrih</Label>
                    <Input
                      id={`segm-${g.id}-len`} className="h-11" type="number" min="0" step="any" inputMode="decimal"
                      placeholder="dolžina m" value={g.len}
                      onChange={(e) => p.setSegsM(p.segsM.map((x) => x.id === g.id ? { ...x, len: e.target.value } : x))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`segm-${g.id}-h`} className="sr-only">Višina segmenta {i + 1} v metrih</Label>
                    <Input
                      id={`segm-${g.id}-h`} className="h-11" type="number" min="0" step="any" inputMode="decimal"
                      placeholder="višina m" value={g.h}
                      onChange={(e) => p.setSegsM(p.segsM.map((x) => x.id === g.id ? { ...x, h: e.target.value } : x))}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {pos(parseNum(g.len))
                      ? <>dolžina <span className="font-medium text-foreground">{round2(parseNum(g.len))} m</span>{pos(parseNum(g.h)) ? <> · višina {round2(parseNum(g.h))} m</> : null}</>
                      : 'vnesite dolžino (višina je informativna)'}
                  </span>
                  <Button
                    type="button" variant="ghost" size="icon" className="size-11 text-muted-foreground hover:text-red-600"
                    aria-label={`Odstrani segment ${i + 1}`}
                    disabled={p.segsM.length === 1}
                    onClick={() => p.setSegsM(p.segsM.filter((x) => x.id !== g.id))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </AnimatedListItem>
            ))}
          </AnimatedList>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="konf-razmik">Razmik stebrov (m)</Label>
              <Input
                id="konf-razmik" className="h-11" type="number" min="0" step="any" inputMode="decimal"
                placeholder="npr. 2.9" value={p.razmik}
                onChange={(e) => p.setRazmik(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="konf-vrata-ogr">Vrata (kos)</Label>
              <Input
                id="konf-vrata-ogr" className="h-11" type="number" min="0" step="1" inputMode="numeric"
                placeholder="0" value={p.vrata}
                onChange={(e) => p.setVrata(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="konf-nacin">Način pritrditve</Label>
              <Select value={p.nacin} onValueChange={p.setNacin}>
                <SelectTrigger id="konf-nacin" className="h-11" aria-label="Način pritrditve"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NACINI_PRITRDITVE.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── kos: STOPNICE / VRTNA RESITEV / KOMPONENTA ── */}
      {formType === 'kos' ? (
        <div className="space-y-2">
          <Label htmlFor="konf-kos-qty">Količina (kos) *</Label>
          <Input
            id="konf-kos-qty" className="h-11 w-32" type="number" min="0" step="1" inputMode="numeric"
            placeholder="npr. 1" value={p.kosQty}
            onChange={(e) => p.setKosQty(e.target.value)}
          />
        </div>
      ) : null}

      {/* ── skupne opombe (vse družine) ── */}
      <div className="space-y-2">
        <Label htmlFor="konf-opombe">Opombe / posebnosti (izrezi, ovire, koti, zaključki …)</Label>
        <Textarea
          id="konf-opombe" rows={2} placeholder="npr. izrez za kanal na robu, notranji kot 90°, stopnice 3 × 17 cm"
          value={p.opombe} onChange={(e) => p.setOpombe(e.target.value)}
        />
      </div>

      {/* ── povzetek količine + ročni popravek ── */}
      <div className="space-y-3 rounded-xl border bg-secondary/30 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {formType === 'm2' && p.familyCode === 'FASADA' ? (
            <>
              <span>Bruto: <strong className="tabular-nums">{p.brutoM2} m²</strong></span>
              <span className="text-muted-foreground">− odbitki: <span className="tabular-nums">{p.odbitkiM2} m²</span></span>
            </>
          ) : null}
          {formType === 'm2' ? (
            <span className="text-base">Neto površina: <strong className="tabular-nums">{p.computedQty} m²</strong></span>
          ) : formType === 'm' ? (
            <span className="text-base">Skupna dolžina: <strong className="tabular-nums">{p.computedQty} m</strong></span>
          ) : (
            <span className="text-base">Količina: <strong className="tabular-nums">{p.computedQty} kos</strong></span>
          )}
          {p.manualActive ? (
            <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300">ročno nastavljeno</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="konf-qty-manual">Ročni popravek količine (neobvezno — za izjeme)</Label>
            <Input
              id="konf-qty-manual" className="h-11 w-32" type="number" min="0" step="any" inputMode="decimal"
              placeholder={String(p.computedQty)} value={p.qtyManual}
              onChange={(e) => p.setQtyManual(e.target.value)}
            />
          </div>
          {p.manualActive ? (
            <Button type="button" variant="ghost" className="h-11" onClick={() => p.setQtyManual('')}>
              <RotateCcw className="size-4" aria-hidden /> Uporabi izračunano
            </Button>
          ) : null}
          <p className="ml-auto self-center text-sm">
            Paket bo <strong className="tabular-nums">{p.effectiveQty} {p.unit}</strong>
          </p>
        </div>
      </div>
    </section>
  )
}

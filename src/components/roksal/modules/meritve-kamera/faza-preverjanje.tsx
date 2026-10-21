'use client'

// faza-preverjanje.tsx — FAZA 4: PREVERJANJE: primerjava pogledov + stopnja
// zaupanja, preverjanje na strežniku (/api/railing-layout), domenske možnosti
// po načinu (§8–§11) in kanonična analiza engine-a (/api/measure-engine/analyze).
// R537-a: dobesedna selitev iz meritve-kamera.tsx — skupno stanje pride prek
// propsov; verifyServer/runEngine sta krajevni (živijo le v tej fazi).

import type { Dispatch, SetStateAction } from 'react'
import { Check, Loader2, Sparkles, Undo2 } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiPost } from '@/lib/api-client'
import {
  INPUT_SOURCE_LABELS, MODE_RULES,
  type AnalyzeResult, type CalibrationMethod, type DomainOptions, type MeasureMode,
} from '@/lib/measure-engine'
import { domainRows, fmt1, type CalcResult, type MultiView } from './geometrija'
import type { View } from './tipi'

export interface FazaPreverjanjeProps {
  view: View
  busy: boolean
  setBusy: Dispatch<SetStateAction<boolean>>
  setServerLayout: Dispatch<SetStateAction<string | null>>
  serverLayout: string | null
  multi: MultiView
  mode: MeasureMode
  calc: CalcResult
  analyzing: boolean
  setAnalyzing: Dispatch<SetStateAction<boolean>>
  analysis: AnalyzeResult | null
  setAnalysis: Dispatch<SetStateAction<AnalyzeResult | null>>
  buildOptions: () => DomainOptions
  maxTilt: number | null
  overrideOn: boolean
  overrideLen: string
  maxSpanS: string
  setMaxSpanS: Dispatch<SetStateAction<string>>
  heightS: string
  setHeightS: Dispatch<SetStateAction<string>>
  tileW: string
  setTileW: Dispatch<SetStateAction<string>>
  tileH: string
  setTileH: Dispatch<SetStateAction<string>>
  jointMm: string
  setJointMm: Dispatch<SetStateAction<string>>
  pattern: 'PRAVOKOTNO' | 'DIAGONALNO'
  setPattern: Dispatch<SetStateAction<'PRAVOKOTNO' | 'DIAGONALNO'>>
  opCount: string
  setOpCount: Dispatch<SetStateAction<string>>
  opW: string
  setOpW: Dispatch<SetStateAction<string>>
  opH: string
  setOpH: Dispatch<SetStateAction<string>>
  pitchDeg: string
  setPitchDeg: Dispatch<SetStateAction<string>>
  roofMaterial: 'BETONNA' | 'KOVINSKA'
  setRoofMaterial: Dispatch<SetStateAction<'BETONNA' | 'KOVINSKA'>>
  stepsS: string
  setStepsS: Dispatch<SetStateAction<string>>
  calibMethod: CalibrationMethod
  refObject: string
  views: View[]
  setPhase: Dispatch<SetStateAction<1 | 2 | 3 | 4 | 5>>
}

export function FazaPreverjanje (props: FazaPreverjanjeProps) {
  const {
    view, busy, setBusy, setServerLayout, serverLayout, multi, mode, calc, analyzing, setAnalyzing,
    analysis, setAnalysis, buildOptions, maxTilt, overrideOn, overrideLen, maxSpanS, setMaxSpanS,
    heightS, setHeightS, tileW, setTileW, tileH, setTileH, jointMm, setJointMm, pattern, setPattern,
    opCount, setOpCount, opW, setOpW, opH, setOpH, pitchDeg, setPitchDeg, roofMaterial, setRoofMaterial,
    stepsS, setStepsS, calibMethod, refObject, views, setPhase,
  } = props
  const { toast } = useToast()

  /** Preverjanje na strežniku (POST /api/railing-layout) — primarni pogled. */
  async function verifyServer (): Promise<void> {
    if (!view || !view.calib || calc.pts.length < 2) {
      toast({ title: 'Potrebna sta kalibracija in vsaj 2 točki.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: { totalLengthCm: number; posts: number; handrailM: number } }>('/api/railing-layout', {
        points: calc.pts.map((p) => ({ x: p.x * view.imgW, y: p.y * view.imgH })),
        calibration: view.calib,
      })
      setServerLayout(`Strežnik: ${fmt1(res.data.totalLengthCm / 100)} m · ${res.data.posts} stebrov · ročnik ${fmt1(res.data.handrailM)} m`)
    } catch (e) {
      toast({ title: 'Preverjanje ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  /** R457: kanonična analiza engine-a (POST /api/measure-engine/analyze). */
  async function runEngine (): Promise<void> {
    if (!view || !view.calib || calc.pts.length < 2) {
      toast({ title: 'Potrebna sta kalibracija in vsaj 2 točki.', variant: 'destructive' })
      return
    }
    setAnalyzing(true)
    try {
      const res = await apiPost<{ data: AnalyzeResult }>('/api/measure-engine/analyze', {
        mode,
        points: calc.pts.map((p) => ({ x: p.x, y: p.y })),
        calibration: { ...view.calib, imgW: Math.round(view.imgW), imgH: Math.round(view.imgH), method: calibMethod, refObject: refObject.trim() || undefined },
        options: buildOptions(),
        quality: views[0].quality
          ? {
            brightness: views[0].quality.brightness,
            blurScore: views[0].quality.blurScore,
            dark: views[0].quality.dark,
            bright: views[0].quality.bright,
            blurry: views[0].quality.blurry,
          }
          : undefined,
        tiltDeg: maxTilt,
        viewAgreementPct: multi.lengths.length > 1 && multi.spreadPct !== null ? Math.max(0, 100 - multi.spreadPct) : null,
        manualLengthCm: overrideOn && Number(overrideLen.replace(',', '.')) > 0 ? Number(overrideLen.replace(',', '.')) * 100 : null,
      })
      setAnalysis(res.data)
      const errs = res.data.validation.filter((i) => i.severity === 'NAPAKA').length
      toast({
        title: errs > 0 ? `Analiza: ${errs} napak za popravilo.` : 'Analiza engine-a končana.',
        description: `Zaupanje ${res.data.confidence.confidence} % (${res.data.confidence.band}) · način ${MODE_RULES[mode].label}.`,
        variant: errs > 0 ? 'destructive' : undefined,
      })
    } catch (e) {
      toast({ title: 'Analiza engine-a ni uspela', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setAnalyzing(false) }
  }

  return (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Preverjanje meritve</p>
                {/* R455: stopnja zaupanja (§3) */}
                <Badge className={multi.label === 'DOBRO'
                  ? 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : multi.label === 'OPOZORILO'
                    ? 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                    : 'border-transparent bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-300'}>
                  Zaupanje: {multi.conf} % · {multi.label}
                </Badge>
              </div>

              {/* primerjava pogledov (§3) */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="py-1.5 pr-3 font-medium">Pogled</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">Dolžina</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">Točk</th>
                      <th scope="col" className="py-1.5 font-medium">Δ od povprečja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {multi.per.map((x, i) => {
                      const cm = x.c.totalCm
                      const delta = cm !== null && multi.mean ? ((cm - multi.mean) / multi.mean) * 100 : null
                      return (
                        <tr key={x.v.key} className="border-b last:border-0">
                          <td className="py-1.5 pr-3">{i + 1}{i === 0 ? ' (glavni)' : ''}</td>
                          <td className="py-1.5 pr-3 font-semibold">{cm !== null ? `${fmt1(cm / 100)} m` : '— px'}</td>
                          <td className="py-1.5 pr-3">{x.c.pts.length}</td>
                          <td className="py-1.5">{delta !== null ? `${delta > 0 ? '+' : ''}${fmt1(delta)} %` : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {multi.lengths.length > 1 ? (
                <p className="text-xs text-muted-foreground">
                  Povprečje {fmt1((multi.mean ?? 0) / 100)} m · razpršenost {multi.spreadPct !== null ? `${fmt1(multi.spreadPct)} %` : '—'}
                  {multi.spreadPct !== null && multi.spreadPct > 5
                    ? ' — ⚠ ocene se preveč razlikujejo: popravite točke ali kalibracijo na pogledih, ali vnesite lasersko meritev z razlogom v koraku Potrditev — potrditev je blokirana, dokler razhajanje ni rešeno'
                    : multi.spreadPct !== null && multi.spreadPct <= 2 ? ' — pogledi se odlično strinjajo' : ''}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">En sam pogled — za večjo zanesljivost dodajte še eno fotografijo istega objekta (v koraku Meritev).</p>
              )}

              {view.quality && !view.quality.ok ? (
                <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  ⚠ Kakovost zajema: {view.quality.blurry ? 'mehka slika ' : ''}{view.quality.dark ? 'temna ' : ''}{view.quality.bright ? 'presočena ' : ''}
                  — preverite točke na povečavi ali posnemite znova.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void verifyServer()} disabled={!view.calib || busy}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />} Preveri na strežniku
                </Button>
                {serverLayout ? <span className="text-xs text-muted-foreground">{serverLayout}</span> : null}
              </div>
            </CardContent>
          </Card>

          {/* R457: domenske možnosti + kanonična analiza engine-a (§8–§11, §13–§15) */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Merilni engine — {MODE_RULES[mode].label}</p>
                <Button size="sm" onClick={() => void runEngine()} disabled={analyzing || !view.calib || calc.pts.length < 2}>
                  {analyzing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
                  {analyzing ? 'Analiziram …' : 'Analiziraj (engine)'}
                </Button>
              </div>

              {/* domenske možnosti po načinu (§8–§11) — R506: prazno polje NI
                  enako 0; pomeni »monter tega ni izmeril«, jedro številko
                  označi kot PRIVZETO in jo izpisuje kot oceno. */}
              {mode === 'OGRAJA' ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="km-maxspan" className="text-xs">Razmak stebrov (cm) — brez vpisa se predpostavi 120</Label>
                    <Input id="km-maxspan" className="h-9" type="number" min="40" max="300" inputMode="numeric" placeholder="npr. 120 (iz naročila)" value={maxSpanS} onChange={(e) => setMaxSpanS(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-height-eng" className="text-xs">Višina polnila (cm) — brez vpisa se predpostavi 100</Label>
                    <Input id="km-height-eng" className="h-9" type="number" min="20" inputMode="numeric" placeholder="npr. 100 (izmeri ali poišči v naročilu)" value={heightS} onChange={(e) => setHeightS(e.target.value)} />
                  </div>
                </div>
              ) : null}
              {mode === 'KERAMIKA' ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="space-y-1">
                    <Label htmlFor="km-tilew" className="text-xs">Ploščica Š (cm)</Label>
                    <Input id="km-tilew" className="h-9" type="number" min="1" inputMode="numeric" placeholder="60" value={tileW} onChange={(e) => setTileW(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-tileh" className="text-xs">Ploščica V (cm)</Label>
                    <Input id="km-tileh" className="h-9" type="number" min="1" inputMode="numeric" placeholder="60" value={tileH} onChange={(e) => setTileH(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-joint" className="text-xs">Fuga (mm)</Label>
                    <Input id="km-joint" className="h-9" type="number" min="0" max="30" inputMode="numeric" placeholder="3" value={jointMm} onChange={(e) => setJointMm(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-pattern" className="text-xs">Vzorec</Label>
                    <Select value={pattern} onValueChange={(v) => setPattern(v as 'PRAVOKOTNO' | 'DIAGONALNO')}>
                      <SelectTrigger id="km-pattern" className="h-9" aria-label="Vzorec polaganja"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PRAVOKOTNO">Pravokotno</SelectItem>
                        <SelectItem value="DIAGONALNO">Diagonalno</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-opcount" className="text-xs">Odprtine (št., Š×V)</Label>
                    <div className="flex gap-1">
                      <Input id="km-opcount" className="h-9" type="number" min="0" inputMode="numeric" placeholder="0" value={opCount} onChange={(e) => setOpCount(e.target.value)} />
                      <Input aria-label="Širina odprtine" className="h-9 w-14" type="number" min="1" inputMode="numeric" placeholder="Š" value={opW} onChange={(e) => setOpW(e.target.value)} />
                      <Input aria-label="Višina odprtine" className="h-9 w-14" type="number" min="1" inputMode="numeric" placeholder="V" value={opH} onChange={(e) => setOpH(e.target.value)} />
                    </div>
                  </div>
                </div>
              ) : null}
              {mode === 'STREHA' ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="km-pitch" className="text-xs">Naklon strehe (°) — izmeri z nagibomerom; brez vpisa se predpostavi 35°</Label>
                    <Input id="km-pitch" className="h-9" type="number" min="0" max="84" inputMode="numeric" placeholder="npr. 35 (brez vpisa = ocena)" value={pitchDeg} onChange={(e) => setPitchDeg(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-roofmat" className="text-xs">Kritina</Label>
                    <Select value={roofMaterial} onValueChange={(v) => setRoofMaterial(v as 'BETONNA' | 'KOVINSKA')}>
                      <SelectTrigger id="km-roofmat" className="h-9" aria-label="Kritina"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BETONNA">Betonska (odpad 10 %)</SelectItem>
                        <SelectItem value="KOVINSKA">Kovinska (odpad 7 %)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
              {mode === 'FASADA' ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="km-opw-f" className="text-xs">Okna/vrata Š (cm)</Label>
                    <Input id="km-opw-f" className="h-9" type="number" min="1" inputMode="numeric" placeholder="npr. 100" value={opW} onChange={(e) => setOpW(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-oph-f" className="text-xs">Okna/vrata V (cm)</Label>
                    <Input id="km-oph-f" className="h-9" type="number" min="1" inputMode="numeric" placeholder="npr. 120" value={opH} onChange={(e) => setOpH(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-opcount-f" className="text-xs">Število odprtin — brez vpisa neto trdi, da odprtin ni</Label>
                    <Input id="km-opcount-f" className="h-9" type="number" min="0" inputMode="numeric" placeholder="0" value={opCount} onChange={(e) => setOpCount(e.target.value)} />
                  </div>
                </div>
              ) : null}
              {mode === 'STOPNICE' ? (
                <div className="max-w-56 space-y-1">
                  <Label htmlFor="km-steps" className="text-xs">Število stopnic (neobvezno — sicer ocena po 17 cm)</Label>
                  <Input id="km-steps" className="h-9" type="number" min="1" inputMode="numeric" value={stepsS} onChange={(e) => setStepsS(e.target.value)} placeholder="npr. 14" />
                </div>
              ) : null}

              {analysis ? (
                <>
                  {/* §14 geometrijska kontrola */}
                  <div className="space-y-1">
                    <p className="text-xs font-semibold">Geometrijska kontrola (§14)</p>
                    {analysis.validation.length === 0 ? (
                      <p className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300"><Check className="size-3.5" aria-hidden /> Brez ugotovitev — geometrija v redu.</p>
                    ) : (
                      <ul className="space-y-1">
                        {analysis.validation.map((iss, k) => (
                          <li key={k} className={`flex items-start gap-1.5 text-[11px] ${iss.severity === 'NAPAKA' ? 'text-red-700 dark:text-red-300' : iss.severity === 'OPOZORILO' ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground'}`}>
                            <span aria-hidden>{iss.severity === 'NAPAKA' ? '✗' : iss.severity === 'OPOZORILO' ? '⚠' : 'ℹ'}</span>
                            <span>{iss.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {/* §13 confidence */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={analysis.confidence.band === 'VISOK'
                      ? 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : analysis.confidence.band === 'SREDNJI'
                        ? 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                        : 'border-transparent bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-300'}>
                      Engine zaupanje: {analysis.confidence.confidence} % · {analysis.confidence.band}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{analysis.confidence.reasons.join(' · ')}</span>
                  </div>
                  {/* §8–§11 domenski rezultat */}
                  <div>
                    <p className="mb-1 text-xs font-semibold">Domenski izračun — {MODE_RULES[analysis.domain.mode].label}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <tbody>
                          {domainRows(analysis.domain).map(([k, v]) => (
                            <tr key={k} className="border-b last:border-0">
                              <td className="py-1 pr-3 text-muted-foreground">{k}</td>
                              <td className="py-1 font-semibold">{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* R506 (issue #15 faza 4): IZVOR vsake domenske številke.
                        Seznam zloži jedro (`domainInputs`), zato ga noben
                        prikaz ne more pozabiti — številka, ki je monter ni
                        izmeril, je tukaj označena, ne izgine iz zaslona. */}
                    {(() => {
                      const nep = analysis.inputs.filter((x) => x.vir !== 'VNOS')
                      return nep.length > 0 ? (
                        <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status" aria-label="Številke, ki niso izmerjene">
                          <p className="font-semibold">Te številke niso izmerjene na terenu:</p>
                          <ul className="mt-0.5 space-y-0.5">
                            {nep.map((x) => (
                              <li key={x.key}>
                                <strong>{x.label}</strong>
                                {x.vrednost !== '—' ? `: ${x.vrednost}${x.enota ? ` ${x.enota}` : ''}` : ''}
                                {' — '}
                                {INPUT_SOURCE_LABELS[x.vir]}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null
                    })()}
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Pritisnite »Analiziraj (engine)« za kanonično preverjeno analizo: geometrija, §14 validacija, zaupanje in domenski izračun ({MODE_RULES[mode].label}).
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setPhase(3)}><Undo2 className="size-4" aria-hidden /> Nazaj na točke</Button>
            <Button onClick={() => setPhase(5)}>Naprej — potrditev</Button>
          </div>
        </div>
  )
}

'use client'

// scena-detail.tsx — kartica izbranega zaznanega elementa pod AR predogledom
// (R537-b: dobesedna selitev iz ar.tsx). R470 (§5): mere po osih +
// referenčna skala; R471 (F4): mera z AR globino. Komentar R467/R468 z
// originalnega mesta je v ar.tsx (vstop) pred pogojem tega dela.

import { useState, type Dispatch, type SetStateAction } from 'react'

import { Loader2, MapPin, Ruler, Save, ScanLine, Shapes, Smartphone } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { geomStatusText, slopeSourceText } from '@/components/roksal/scene-overlay'
import { useToast } from '@/hooks/use-toast'
import type { DepthSupportInfo } from '@/lib/depth-adapter'
import { Naklonomer } from './naklonomer'
import { AXIS_KIND_TEXT, MEASURE_METHOD_TEXT, SCENE_CLASSES, SURFACE_KINDS, ascentText, personHeightNote, type ConsolidatedMeasure, type DimAxis, type SceneClass, type SceneEdit, type SceneElement, type SurfaceKind } from '@/lib/scene-understanding-core'
import type { SessionUser } from '@/lib/store'

export function ScenaDetail ({
  sceneSelected, scenePinned, setScenePinned,
  slopeInput, setSlopeInput, stepsInput, setStepsInput, angleInput, setAngleInput,
  measureInputs, setMeasureInputs, refAxisIdx, setRefAxisIdx, refCmInput, setRefCmInput,
  selectedAxes, selectedMeasures, refAxis, computedForAxis, setSceneEdits, setSceneSelectedId, user,
  depthSupport, depthTaps, depthBusy, runDepthMeasure, runDepthPolygonMeasure,
}: {
  sceneSelected: SceneElement
  scenePinned: Set<string>
  setScenePinned: Dispatch<SetStateAction<Set<string>>>
  slopeInput: string
  setSlopeInput: Dispatch<SetStateAction<string>>
  stepsInput: string
  setStepsInput: Dispatch<SetStateAction<string>>
  angleInput: string
  setAngleInput: Dispatch<SetStateAction<string>>
  measureInputs: Record<number, string>
  setMeasureInputs: Dispatch<SetStateAction<Record<number, string>>>
  refAxisIdx: string
  setRefAxisIdx: Dispatch<SetStateAction<string>>
  refCmInput: string
  setRefCmInput: Dispatch<SetStateAction<string>>
  selectedAxes: DimAxis[]
  selectedMeasures: ConsolidatedMeasure[]
  refAxis: DimAxis | null
  computedForAxis: (i: number) => number | null
  setSceneEdits: Dispatch<SetStateAction<SceneEdit[]>>
  setSceneSelectedId: Dispatch<SetStateAction<string | null>>
  user: SessionUser | null
  depthSupport: DepthSupportInfo | null
  /** R558 (raziskava V1.2): poligonska mera (celotna linija v eni seji). */
  runDepthPolygonMeasure: (label: string) => Promise<void>
  depthTaps: number
  depthBusy: boolean
  runDepthMeasure: (label: string) => Promise<void>
}): React.ReactElement {
  const { toast } = useToast()
  // R558 (raziskava V1.1): naklonomer — odpre se ob vnosu naklona (slopeInput);
  // prevzem izmerjenega kota zapiše vrednost v isti vnos (vir ostaja ročni vnos
  // — monterjeva izjava, a iz SENSORSKE izmere; poštenost discipline). 
  const [naklonomerOpen, setNaklonomerOpen] = useState(false)
  return (
    <div className="rounded-lg border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Zaznan element: {sceneSelected.cls}
          {sceneSelected.kind ? ` · ${sceneSelected.kind}` : ''}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant={scenePinned.has(sceneSelected.id) ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[11px]"
            aria-pressed={scenePinned.has(sceneSelected.id)}
            onClick={() => {
              setScenePinned((prev) => {
                const next = new Set(prev)
                if (next.has(sceneSelected.id)) next.delete(sceneSelected.id)
                else next.add(sceneSelected.id)
                return next
              })
            }}
          >
            <MapPin className="size-3.5" aria-hidden />
            {scenePinned.has(sceneSelected.id) ? 'Pripeto' : 'Pripni'}
          </Button>
          <Badge variant="outline" className="text-[10px]">
            vir: {sceneSelected.source === 'ROCNO' ? 'ročno potrjeno' : sceneSelected.source === 'VLM' ? 'AI predlog' : 'lokalna hevristika'}
          </Badge>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Popravek se shrani kot označen podatek ob zajemu AR posnetka — izvirna zaznava ostane nespremenjena.
      </p>

      {/* R469 (F3 §4): geometrija stopnic — števec, smer, pravilnost, podest;
          POŠTENOST: višin čel in globin nastopov NI mogoče izmeriti
          iz enega 2D pogleda (issue §4) — to je izrecno zapisano. */}
      {sceneSelected.cls === 'STOPNICA' ? (
        <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
          <p className="font-semibold">Geometrija stopnic</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            <li>
              Vidni nastopi: {sceneSelected.steps != null
                ? `${sceneSelected.steps} (${sceneSelected.source === 'ROCNO' ? 'ročno potrjeno' : 'ocena iz vizualne geometrije'})`
                : 'nezaznani v tem kadru'}
            </li>
            <li>
              Smer vzpenjanja: {sceneSelected.ascent != null
                ? `${ascentText(sceneSelected.ascent)} (ocena — preverite na objektu)`
                : 'ni ocenljiva iz tega kadra'}
            </li>
            <li>
              Razmaki med nastopi: {sceneSelected.stepIrregular === true
                ? 'NEENAKOMERNI — ročni pregled odstopajoče stopnice'
                : sceneSelected.stepGap != null ? 'videti enakomerni (ocena)' : 'nezaznani'}
            </li>
            <li>
              Podest: {sceneSelected.landing === true
                ? 'morebiten (večja vrzel med nastopi) — potrdite'
                : 'ni zaznan'}
            </li>
            <li className="text-foreground">
              Višine čel in globine nastopov niso izmerljive iz enega pogleda — izmerite z referenco ali AR globino.
            </li>
            <li>
              Status geometrije: <span className="font-medium text-foreground">{geomStatusText(sceneSelected) ?? 'ni podatka'}</span>
              {sceneSelected.geomStatus === 'GEOMETRIJA_OCENJENA' ? ' — ocena, ne izmera.' : ''}
            </li>
          </ul>
          <div className="mt-2 flex flex-wrap items-end gap-1.5">
            <div className="space-y-0.5">
              <Label htmlFor="scene-steps" className="text-[11px]">Potrjeno število stopnic (preštejte na objektu)</Label>
              <Input
                id="scene-steps"
                inputMode="numeric"
                className="h-8 w-28 text-xs"
                placeholder="npr. 5"
                value={stepsInput}
                onChange={(e) => { setStepsInput(e.target.value) }}
                aria-describedby="scene-steps-help"
              />
            </div>
            <Button
              size="sm"
              className="h-8"
              disabled={Number.isNaN(Number(stepsInput.replace(',', '.'))) || stepsInput.trim() === '' ||
                !(Number(stepsInput.replace(',', '.')) >= 1) || !(Number(stepsInput.replace(',', '.')) <= 20)}
              onClick={() => {
                const v = Math.round(Number(stepsInput.replace(',', '.')))
                if (!Number.isFinite(v) || v < 1 || v > 20) return
                setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                  elementId: sceneSelected.id,
                  steps: v,
                  by: user?.name ?? 'monter',
                  at: Date.now(),
                }])
                toast({ title: 'Potrjeno število stopnic zabeleženo.', description: `${v} stopnic (ročno potrjeno). Shrani se z zajemom AR posnetka.` })
                setStepsInput('')
              }}
            >
              <Save className="size-3.5" aria-hidden />
              Potrdi
            </Button>
            <span id="scene-steps-help" className="sr-only">
              Preštejte vidne stopnice na objektu in vnesite število od 1 do 20; potrditev se shrani z zajemom.
            </span>
          </div>
        </div>
      ) : null}

      {/* R485 (issue #8 §2/§9): OGRAJA — lastna sekcija: število stebrov
          (postCount = OCENA iz periodike navpičnic, detectPostLines)
          + pošteno o mejah enega kadra. Mere so v razdelku Mere. */}
      {sceneSelected.cls === 'OGRAJA' ? (
        <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
          <p className="font-semibold">Geometrija ograje</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            <li>
              Zaznanih stebrov: {sceneSelected.postCount != null
                ? `${sceneSelected.postCount} (ocena iz periodike navpičnih črt)`
                : 'nezaznani v tem kadru (dokaz so vodoravne črte, ne stebri)'}
            </li>
            <li>
              Status geometrije: <span className="font-medium text-foreground">{geomStatusText(sceneSelected) ?? 'ni podatka'}</span>
              {sceneSelected.source === 'ROCNO'
                ? ' — razred ročno potrjen.'
                : ' — dokaz je šibek, zato hevristika ostaja NEJASNO (nikoli samodejno prepoznano).'}
            </li>
            <li className="text-foreground">
              Odseki, vogali, vrata in pritrdilna mesta niso ločljivi iz enega kadra — več objektov iste vrste ostane en element (znana meja, SMART-VISION-8 §2).
            </li>
            <li>Mere segmenta so v razdelku Mere (osi brez cm, dokler ni veljavne metode).</li>
          </ul>
        </div>
      ) : null}

      {/* R468 (F2 §3): geometrija površine — ločena od prepoznave (§2/§6) */}
      {(sceneSelected.cls === 'TLA' || sceneSelected.cls === 'PODLAGA' || sceneSelected.cls === 'ROB') ? (
        <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
          <p className="font-semibold">Geometrija površine</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            <li>
              Maska tal: {sceneSelected.maskPoints && sceneSelected.maskPoints.length >= 3
                ? `zaznana (${sceneSelected.maskPoints.length} točk poligona)`
                : 'ni zaznana v tem kadru'}
            </li>
            {sceneSelected.cls === 'ROB' ? (
              <li>
                Kot roba v kadru: {sceneSelected.angleDeg != null
                  ? `${sceneSelected.angleDeg.toFixed(1).replace('.', ',')}°${sceneSelected.source === 'ROCNO' ? ' (ročno potrjeno)' : ' (ocena iz vizualne geometrije)'}`
                  : 'neznan'}
              </li>
            ) : (
              <li>
                Naklon: {sceneSelected.slopeDeg != null
                  ? `${sceneSelected.slopeDeg === 0 ? '~0°' : `~${Math.abs(sceneSelected.slopeDeg).toFixed(1).replace('.', ',')}° (${sceneSelected.slopeDeg > 0 ? 'padec desno' : 'padec levo'})`} — vir: ${slopeSourceText(sceneSelected) ?? 'neznan'}`
                  : `ni ocenljiv iz tega kadra${geomStatusText(sceneSelected) ? ` (${geomStatusText(sceneSelected)})` : ''}`}
              </li>
            )}
            <li>
              Status geometrije: <span className="font-medium text-foreground">{geomStatusText(sceneSelected) ?? 'ni podatka'}</span>
              {sceneSelected.geomStatus === 'GEOMETRIJA_OCENJENA' ? ' — ocena, ne izmera; potrdite z referenco.' : ''}
            </li>
          </ul>
          {sceneSelected.cls === 'ROB' ? (
            /* R485 (issue #8 §2): POPRAVEK KOTA ROBA — vnos −90..360;
               črta roba je NEUSMERJENA: normalizacija mod 180 v
               [−90, 90] (350° ≡ −10°) se izvede v applyEdits
               (jedro, enako na strežniku); vir ROCNO + IZMERJENO. */
            <div className="mt-2 flex flex-wrap items-end gap-1.5">
              <div className="space-y-0.5">
                <Label htmlFor="scene-angle" className="text-[11px]">Popravek kota roba (°, −90..360; npr. −8 ali 350)</Label>
                <Input
                  id="scene-angle"
                  inputMode="decimal"
                  className="h-8 w-32 text-xs"
                  placeholder="Stopinje"
                  value={angleInput}
                  onChange={(e) => { setAngleInput(e.target.value) }}
                  aria-describedby="scene-angle-help"
                />
              </div>
              <Button
                size="sm"
                className="h-8"
                disabled={Number.isNaN(Number(angleInput.replace(',', '.'))) || angleInput.trim() === '' ||
                  !(Number(angleInput.replace(',', '.')) >= -90) || !(Number(angleInput.replace(',', '.')) <= 360)}
                onClick={() => {
                  const v = Number(angleInput.replace(',', '.'))
                  if (!Number.isFinite(v) || v < -90 || v > 360) return
                  setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                    elementId: sceneSelected.id,
                    angleDeg: v,
                    by: user?.name ?? 'monter',
                    at: Date.now(),
                  }])
                  const norm = Math.round((((v + 90) % 180 + 180) % 180 - 90) * 10) / 10
                  toast({
                    title: 'Popravek kota roba zabeležen.',
                    description: `Kot ${v.toFixed(1).replace('.', ',')}° → shranjen kot ${norm.toFixed(1).replace('.', ',')}° (črta roba je neusmerjena — mod 180; ročno, IZMERJENO). Shrani se z zajemom AR posnetka.`,
                  })
                  setAngleInput('')
                }}
              >
                <Save className="size-3.5" aria-hidden />
                Zabeleži
              </Button>
              <span id="scene-angle-help" className="sr-only">
                Vnesite preštani ali izmerjeni kot roba glede na vodoravnico kadra v stopinjah; veljavno od −90 do 360, normalizira se na −90 do 90.
              </span>
            </div>
          ) : (
            <>
            <div className="mt-2 flex flex-wrap items-end gap-1.5">
              <div className="space-y-0.5">
                <Label htmlFor="scene-slope" className="text-[11px]">Izmerjeni naklon (°, npr. 3,5 ali −2)</Label>
                <Input
                  id="scene-slope"
                  inputMode="decimal"
                  className="h-8 w-28 text-xs"
                  placeholder="Stopinje"
                  value={slopeInput}
                  onChange={(e) => { setSlopeInput(e.target.value) }}
                  aria-describedby="scene-slope-help"
                />
              </div>
              <Button
                size="sm"
                className="h-8"
                disabled={Number.isNaN(Number(slopeInput.replace(',', '.'))) || slopeInput.trim() === '' || Math.abs(Number(slopeInput.replace(',', '.'))) > 45}
                onClick={() => {
                  const v = Number(slopeInput.replace(',', '.'))
                  if (!Number.isFinite(v) || Math.abs(v) > 45) return
                  setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                    elementId: sceneSelected.id,
                    slopeDeg: v,
                    by: user?.name ?? 'monter',
                    at: Date.now(),
                  }])
                  toast({ title: 'Izmerjeni naklon zabeležen.', description: `Naklon ${v.toFixed(1).replace('.', ',')}° (ročno, IZMERJENO). Shrani se z zajemom AR posnetka.` })
                  setSlopeInput('')
                }}
              >
                <Save className="size-3.5" aria-hidden />
                Zabeleži
              </Button>
              <span id="scene-slope-help" className="sr-only">
                Vnesite z nivelirjem ali referenčno metodo izmerjen naklon tal v stopinjah; veljavno od −45 do 45.
              </span>
              {/* R558 (raziskava V1.1): NAKLONOMER — relativna gravitacijska metoda
                  (ničla na vodoravni + deska čez zobce); vir ostaja monterjev
                  vnos — senzor izmeri, monter potrdi (ista disciplina kot kamera). */}
              <Button
                size="sm"
                variant={naklonomerOpen ? 'secondary' : 'outline'}
                className="h-8"
                aria-expanded={naklonomerOpen}
                onClick={() => { setNaklonomerOpen(!naklonomerOpen) }}
              >
                <Smartphone className="size-3.5" aria-hidden />
                Izmeri s telefonom
              </Button>
            </div>
            {naklonomerOpen ? (
              <div className="mt-2">
                <Naklonomer
                  onPrevzemi={(v) => { setSlopeInput(v) }}
                  onClose={() => { setNaklonomerOpen(false) }}
                />
              </div>
            ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* R470 (issue #8 §5): MERE PREDMETOV — predlog dimenzijskih osi
          BREZ cm vrednosti; fizična mera pride SAMO z zapisano metodo
          (ročni vnos ali kalibrirana fotografija prek reference). */}
      {sceneSelected.cls !== 'OSEBA' && (selectedAxes.length > 0 || selectedMeasures.length > 0) ? (
        <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
          <p className="font-semibold">Mere</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Osi so predlog — vrednosti v cm se ne izračunavajo iz pikslov brez veljavne reference (poštenost §5).
          </p>

          {/* predlogane osi + vnos mere po osi */}
          {selectedAxes.length > 0 ? (
            <ul className="mt-1.5 space-y-1.5">
              {selectedAxes.map((a, i) => {
                const computed = computedForAxis(i)
                const manual = measureInputs[i] ?? ''
                const manualVal = Number(manual.replace(',', '.'))
                return (
                  <li key={`${a.label}-${i}`} className="rounded border bg-secondary/30 px-2 py-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-medium">{a.label}</span>
                      <span className="text-[10px] text-muted-foreground">{AXIS_KIND_TEXT[a.kind]} · potrebna mera</span>
                    </div>
                    {computed != null ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Iz reference: <span className="font-semibold text-foreground">≈ {computed.toFixed(1).replace('.', ',')} cm</span>{' '}
                        <span className="text-[10px]">(ocena iz kalibrirane fotografije — potrdite z izmero)</span>
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-end gap-1.5">
                      <div className="space-y-0.5">
                        <Label htmlFor={`scene-measure-${i}`} className="text-[10px]">Izmerjeno (cm, npr. 117,5)</Label>
                        <Input
                          id={`scene-measure-${i}`}
                          inputMode="decimal"
                          className="h-8 w-28 text-xs"
                          placeholder="cm"
                          value={manual}
                          onChange={(e) => { setMeasureInputs((prev) => ({ ...prev, [i]: e.target.value })) }}
                          aria-describedby={`scene-measure-${i}-help`}
                        />
                      </div>
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={Number.isNaN(manualVal) || manual.trim() === '' || !(manualVal >= 0.1) || manualVal > 100000}
                        onClick={() => {
                          if (!Number.isFinite(manualVal) || manualVal < 0.1 || manualVal > 100000) return
                          setSceneEdits((prev) => [...prev, {
                            elementId: sceneSelected.id,
                            measure: { label: a.label, valueCm: manualVal },
                            by: user?.name ?? 'monter',
                            at: Date.now(),
                          }])
                          toast({
                            title: 'Mera zabeležena.',
                            description: `${a.label}: ${manualVal.toFixed(1).replace('.', ',')} cm (ročni vnos). Shrani se z zajemom AR posnetka.`,
                          })
                          setMeasureInputs((prev) => ({ ...prev, [i]: '' }))
                        }}
                      >
                        <Save className="size-3.5" aria-hidden />
                        Zabeleži
                      </Button>
                      {computed != null ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => {
                            setSceneEdits((prev) => [...prev, {
                              elementId: sceneSelected.id,
                              measure: { label: a.label, valueCm: computed, method: 'KALIBRIRANA_FOTOGRAFIJA' },
                              by: user?.name ?? 'monter',
                              at: Date.now(),
                            }])
                            toast({
                              title: 'Mera prevzeta iz reference.',
                              description: `${a.label}: ≈ ${computed.toFixed(1).replace('.', ',')} cm (kalibrirana fotografija — ocena, potrdite z izmero).`,
                            })
                          }}
                        >
                          <Ruler className="size-3.5" aria-hidden />
                          Prevzemi ≈ {computed.toFixed(1).replace('.', ',')} cm
                        </Button>
                      ) : null}
                      {/* R471 (F4): MERA Z AR GLOBINO — samo, ko naprava DEJANSKO podpira
                          immersive-ar (issue §0); drugače gumba preprosto ni. */}
                      {depthSupport?.supported === true ? (
                        <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={depthBusy}
                          aria-label={`Izmeri ${a.label} z AR globino (dva tapa v AR pogledu)`}
                          onClick={() => { void runDepthMeasure(a.label) }}
                        >
                          {depthBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ScanLine className="size-3.5" aria-hidden />}
                          {depthBusy ? (depthTaps > 0 ? `Točka ${depthTaps}/2 …` : 'AR seja …') : 'AR globina'}
                        </Button>
                        {/* R558 (raziskava V1.2): POLIGON — celotna linija v eni seji;
                            izstop (Nazaj) pri ≥2 točkah je ZAKLJUČEK mere. */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={depthBusy}
                          aria-label={`Izmeri ${a.label} s poligonom AR globine (tapni vogale, do 8; izstop zaključi mero)`}
                          onClick={() => { void runDepthPolygonMeasure(a.label) }}
                        >
                          {depthBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Shapes className="size-3.5" aria-hidden />}
                          {depthBusy ? (depthTaps > 0 ? `Točka ${depthTaps} …` : 'AR seja …') : 'Poligon (3–8)'}
                        </Button>
                        </>
                      ) : null}
                      <span id={`scene-measure-${i}-help`} className="sr-only">
                        Vnesite z merilnim trakom ali laserjem izmerjeno dolžino te osi v centimetrih.
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}

          {/* R471 (F4): zmožnost AR globine — pošteno sporočilo o senzorju
              (podprto / zakaj ne); mere ostanejo možne tudi brez njega. */}
          <div className="mt-2 rounded border bg-secondary/30 px-2 py-1.5">
            <p className="text-[11px] font-medium">AR globina (senzor)</p>
            {depthSupport == null ? (
              <p className="mt-0.5 text-[10px] text-muted-foreground">Preverjam podporo senzorja globine …</p>
            ) : depthSupport.supported ? (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Podprta prek WebXR/ARCore — gumb „AR globina“ pri osi odpre AR mero z dvema tapoma; gumb „Poligon (3–8)“ pa zajame CELO linijo v eni seji (tapni vogale; izstop z Nazaj pri ≥2 točkah zaključi mero). Rezultat se zapiše z metodo „AR globina“ in manifestom senzorja.
              </p>
            ) : (
              <p className="mt-0.5 text-[10px] text-muted-foreground">{depthSupport.reason}</p>
            )}
          </div>

          {/* referenčna skala: ena znana dolžina → izračun ostalih osi */}
          {selectedAxes.length >= 1 ? (
            <div className="mt-2 rounded border bg-secondary/30 px-2 py-1.5">
              <p className="text-[11px] font-medium">Referenca za oceno ostalih osi (neobvezno)</p>
              <div className="mt-1 flex flex-wrap items-end gap-1.5">
                <div className="space-y-0.5">
                  <Label htmlFor="scene-ref-axis" className="text-[10px]">Referenčna os</Label>
                  <Select value={refAxisIdx} onValueChange={setRefAxisIdx}>
                    <SelectTrigger id="scene-ref-axis" className="h-8 w-44 text-xs"><SelectValue placeholder="izberi os" /></SelectTrigger>
                    <SelectContent>
                      {selectedAxes.map((a, i) => (
                        <SelectItem key={`ref-${i}`} value={String(i)}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-0.5">
                  <Label htmlFor="scene-ref-cm" className="text-[10px]">Znana dolžina (cm)</Label>
                  <Input
                    id="scene-ref-cm"
                    inputMode="decimal"
                    className="h-8 w-24 text-xs"
                    placeholder="cm"
                    value={refCmInput}
                    onChange={(e) => { setRefCmInput(e.target.value) }}
                    aria-describedby="scene-ref-help"
                  />
                </div>
                <span id="scene-ref-help" className="sr-only">
                  Izberite os, katere dejansko dolžino poznate (npr. širina stopnice), in jo vnesite — ostale osi nato dobijo oceno iz kalibrirane fotografije.
                </span>
              </div>
              {refAxis != null ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Skala aktivna — ocene so označene kot „kalibrirana fotografija“ in ostanejo OCENA, dokler jih ne potrdite z izmero.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* konsolidirane mere z metodo + konflikti (§5.6) */}
          {selectedMeasures.length > 0 ? (
            <div className="mt-2">
              <p className="text-[11px] font-medium">Zabeležene mere</p>
              <ul className="mt-1 space-y-1">
                {selectedMeasures.map((m) => (
                  <li key={m.label} className={`rounded border px-2 py-1 ${m.conflict ? 'border-destructive/50 bg-destructive/5' : 'bg-secondary/30'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-medium">{m.label}</span>
                      <span className="font-semibold">{m.valueCm.toFixed(1).replace('.', ',')} cm</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      metoda: {MEASURE_METHOD_TEXT[m.method]}
                      {m.toleranceCm != null ? ` · ±${m.toleranceCm.toFixed(1).replace('.', ',')} cm` : ''}
                      {m.count > 1 ? ` · ${m.count} mere (razpon ${m.spreadPct.toFixed(1).replace('.', ',')} %)` : ''}
                    </p>
                    {m.conflict ? (
                      <p className="text-[10px] font-medium text-destructive">
                        Konflikt: mere istega naziva odstopajo — preverite na objektu.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* R470 (issue #8 §5 „Osebe“): figura SAMO za razumevanje zakritja —
          brez identifikacije, brez mer na osebi, ne persistira se. */}
      {sceneSelected.cls === 'OSEBA' ? (
        <div className="mt-2 rounded-md border border-dashed px-2.5 py-2 text-xs">
          <p className="font-semibold">Morebitna oseba (ocena iz gibanja in oblike)</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            <li>{personHeightNote(sceneSelected)}</li>
            <li>Namen zaznave je samo razumevanje zakritja merilnih točk — brez identifikacije oseb.</li>
            <li>Ta zaznava se ne shrani v posnetek (zasebnost).</li>
            <li>Počakajte na prost kader ali označite merilne točke ročno.</li>
          </ul>
        </div>
      ) : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="scene-cls" className="text-xs">Razred</Label>
          <Select
            value={sceneSelected.cls}
            onValueChange={(v) => {
              const cls = v as SceneClass
              setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                elementId: sceneSelected.id,
                cls,
                by: user?.name ?? 'monter',
                at: Date.now(),
              }])
              toast({ title: 'Popravek razreda zabeležen.', description: `Nov razred: ${cls}. Shrani se z zajemom AR posnetka.` })
            }}
          >
            <SelectTrigger id="scene-cls" className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SCENE_CLASSES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="scene-kind" className="text-xs">Vrsta podlage {sceneSelected.cls !== 'PODLAGA' ? '(samo za podlago)' : ''}</Label>
          <Select
            value={sceneSelected.kind ?? undefined}
            disabled={sceneSelected.cls !== 'PODLAGA' && sceneSelected.cls !== 'TLA'}
            onValueChange={(v) => {
              const kind = v as SurfaceKind
              setSceneEdits((prev) => [...prev.filter((e) => e.elementId !== sceneSelected.id), {
                elementId: sceneSelected.id,
                kind,
                by: user?.name ?? 'monter',
                at: Date.now(),
              }])
              toast({ title: 'Popravek podlage zabeležen.', description: `Vrsta: ${kind}.` })
            }}
          >
            <SelectTrigger id="scene-kind" className="h-9"><SelectValue placeholder="neznana" /></SelectTrigger>
            <SelectContent>
              {SURFACE_KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setSceneSelectedId(null)}>Zapri</Button>
      </div>
    </div>
  )
}

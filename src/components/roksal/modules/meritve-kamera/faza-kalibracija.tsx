'use client'

// faza-kalibracija.tsx — FAZA 2: KALIBRACIJA: Smart Capture Guide + vodeni
// zajem po tipu objekta, označevanje referenčnih točk, kalibracija merila
// (5 metod + perspektivna ravnina R513 + ločena Y referenca R506), VLM zaznava.
// R537-a: dobesedna selitev iz meritve-kamera.tsx — stanje je skupno (vstop)
// in pride prek propsov.

import type { Dispatch, MouseEvent, SetStateAction } from 'react'
import { Crosshair, Loader2, Lock, LockOpen, Ruler, Sparkles, Trash2, Undo2, WifiOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { OrientationCheck } from '@/lib/exif-orientation'
import {
  CALIB_METHODS, MODE_RULES, captureGuide, captureProgress, manjkajociVnosi, resolveScale,
  type CalibrationMethod, type CaptureStepState, type DomainOptions, type EngineCalib, type MeasureMode,
} from '@/lib/measure-engine'
import { meriloOznaka, type CalcResult } from './geometrija'
import { ORIENTACIJA_NAPIS, type Pt, type View } from './tipi'
import { YRefBlock } from './y-ref-blok'

export interface FazaKalibracijaProps {
  view: View
  busy: boolean
  orientacija: OrientationCheck | null
  uploadPhoto: (namen?: 'KALIBRACIJA' | 'POTRDITEV') => Promise<void>
  detect: () => Promise<void>
  detecting: boolean
  /** R563 (issue #23): gumb VLM se pokaže SAMO ob izrecno vklopljenem eksperimentu. */
  vlmEnabled: boolean
  resetAll: () => void
  online: boolean
  maxTilt: number | null
  views: View[]
  mode: MeasureMode
  buildOptions: () => DomainOptions
  onImageClick: (e: MouseEvent<HTMLDivElement>) => void
  calibA: number | null
  setCalibA: Dispatch<SetStateAction<number | null>>
  calibCm: string
  setCalibCm: Dispatch<SetStateAction<string>>
  calibMethod: CalibrationMethod
  setCalibMethod: Dispatch<SetStateAction<CalibrationMethod>>
  refObject: string
  setRefObject: Dispatch<SetStateAction<string>>
  planeW: string
  setPlaneW: Dispatch<SetStateAction<string>>
  planeH: string
  setPlaneH: Dispatch<SetStateAction<string>>
  snapshot: () => void
  setViews: Dispatch<SetStateAction<View[]>>
  calc: CalcResult
  px: (a: Pt, b: Pt) => number
  applyYRef: (pxY: number | null, cmY: number | null) => void
  setPhase: Dispatch<SetStateAction<1 | 2 | 3 | 4 | 5>>
  onClose: () => void
}

export function FazaKalibracija (props: FazaKalibracijaProps) {
  const {
    view, busy, orientacija, uploadPhoto, detect, detecting, resetAll, online, maxTilt, views, mode,
    buildOptions, onImageClick, calibA, setCalibA, calibCm, setCalibCm, calibMethod, setCalibMethod,
    refObject, setRefObject, planeW, setPlaneW, planeH, setPlaneH, snapshot, setViews, calc, px,
    applyYRef, setPhase, onClose,
  } = props
  const { toast } = useToast()

  return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="border-transparent bg-secondary text-secondary-foreground">
              {view.photoId ? 'Fotografija shranjena ✓' : busy ? 'Nalaganje …' : 'Ni še shranjena'}
            </Badge>
            {view.quality ? (
              <Badge className={view.quality.ok
                ? 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                : 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'}>
                Kakovost: {view.quality.ok ? 'DOBRO' : 'OPOZORILO'}
                {view.quality.blurry ? ' · mehka' : ''}{view.quality.dark ? ' · temna' : ''}{view.quality.bright ? ' · presočena' : ''}
              </Badge>
            ) : null}
            {/* R506 (H8): napis se pokaže SAMO, kadar je ugotovitev odprta ali
                zahteva poseg. NI_PODATKA/PRAVOKOTNA sta tiho — sicer bi vsak
                zajem trdil, da je bil analiziran, kar ni res. */}
            {orientacija && orientacija.status !== 'NI_PODATKA' && orientacija.status !== 'PRAVOKOTNA' ? (
              <Badge
                title={orientacija.razlog}
                className={orientacija.status === 'UPORABLJENA'
                  ? 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'}>
                {ORIENTACIJA_NAPIS[orientacija.status]}
              </Badge>
            ) : null}
            {!view.photoId ? (
              <Button size="sm" onClick={() => void uploadPhoto('KALIBRACIJA')} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Naloži fotografijo
              </Button>
            ) : null}
            {/* R563 (issue #23): VLM = ločen eksperiment (privzeto IZKLOPLJEN) —
                gumb obstaja SAMO ob ROKSAL_VLM_EXPERIMENT=1 in je odkritosno
                označen: fotografija gre ZUNANJEMU modelu; predlogi niso mera. */}
            {vlmEnabled ? (
              <Button size="sm" variant="outline" onClick={() => void detect()} disabled={detecting || !view.photoId} title="Eksperiment: fotografija se pošlje zunanjemu modelu (glm-4.6v) prek strežnika. Predlogi ostanejo PREDLOG — nikoli potrjena mera brez kalibracije.">
                {detecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                {detecting ? 'VLM analizira (do 60 s) …' : 'Zaznaj samodejno (VLM eksperiment)'}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => { resetAll(); setPhase(1) }}>
              <Undo2 className="size-4" aria-hidden /> Druga fotografija
            </Button>
          </div>

          {!online ? (
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
              <WifiOff className="size-3.5 shrink-0" aria-hidden />
              Brez povezave — točke označite ročno, shranite z gumbom »Shrani (offline)« v koraku potrditve.
            </p>
          ) : null}

          {/* R457 (§3): Smart Capture Guide — DOBRO/OPOZORILO/NEZADOSTNO */}
          {(() => {
            const guide = captureGuide({
              quality: view.quality,
              tiltDeg: maxTilt,
              calibPresent: view.calib !== null,
              viewCount: views.length,
            })
            const tone = guide.status === 'DOBRO'
              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
              : guide.status === 'OPOZORILO'
                ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
                : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
            return (
              <div className={`rounded-lg border px-3 py-2 ${tone}`} role="status" aria-label="Vodnik kakovosti zajema">
                <p className="text-xs font-semibold">
                  Vodnik zajema: {guide.status === 'DOBRO' ? 'DOBRO — nadaljuj' : guide.status === 'OPOZORILO' ? 'OPOZORILO — dodaj posnetek' : 'NEZADOSTNO — meritev še ni pripravljena'}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {guide.checks.map((c) => (
                    <li key={c.code} className="flex items-start gap-1.5 text-[11px]">
                      <span aria-hidden>{c.state === 'DOBRO' ? '✓' : c.state === 'OPOZORILO' ? '⚠' : '✗'}</span>
                      <span><strong>{c.label}:</strong> {c.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}

          {/* R506 (issue #15 faza 4): VODENI ZAJEM PO TIPU OBJEKTA. Koraki so
              iz jedra (`capturePlan`), stanje pa se izračuna iz dejanskih
              podatkov zajema — monter ne more obkljukati koraka, ki ga ni
              naredil. Tri stanja: ✓ opravljeno, ✗ manjka, ◻ ročna predba
              (tega iz teh podatkov ni mogoče vedeti — koda ne trdi ne nečesa). */}
          {(() => {
            const prog = captureProgress(mode, {
              pointCount: view.points.filter((p) => p.src !== 'PREDLOG').length,
              calibPresent: view.calib !== null,
              viewCount: views.length,
              tiltDeg: maxTilt,
              options: buildOptions(),
            })
            const znaki: Record<CaptureStepState, string> = { ZAKLJUČENO: '✓', MANJKA: '✗', PREVERI_ROČNO: '◻' }
            return (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2" role="group" aria-label={`Načrt zajema — ${MODE_RULES[mode].label}`}>
                <p className="text-xs font-semibold">
                  Načrt zajema — {MODE_RULES[mode].label}
                  {prog.obvezniManjkajo.length > 0
                    ? <span className="ml-1 font-normal text-red-700 dark:text-red-400">({prog.obvezniManjkajo.length} obveznih korakov manjka — rezultat je ocena, ne mera)</span>
                    : null}
                </p>
                <ol className="mt-1 space-y-0.5">
                  {prog.steps.map((s) => (
                    <li key={s.key} className="flex items-start gap-1.5 text-[11px]">
                      <span aria-hidden>{znaki[s.state]}</span>
                      <span>
                        {s.navodilo}
                        {' '}
                        <span className="text-muted-foreground">
                          {s.obvezno ? '[obvezno]' : '[neobvezno]'} · {s.dokaz}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                {(() => {
                  const manj = manjkajociVnosi(mode, buildOptions())
                  return manj.length > 0 ? (
                    <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
                      Manjkajoči vnosi (jedro bo uporabil privzeto pravilo): {manj.join(' · ')}
                    </p>
                  ) : null
                })()}
              </div>
            )
          })()}

          <div className="mx-auto inline-block max-w-full rounded-lg border bg-muted/40 p-1">
            <div className="relative inline-block cursor-crosshair" onClick={onImageClick} role="application" aria-label="Fotografija za kalibracijo — klik dodaja referenčni točki">
              <img src={view.dataUrl} alt="Teren za merjenje" className="block h-auto max-h-[380px] w-auto max-w-full select-none" draggable={false} />
              {view.points.length > 1 ? (
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
                  <polyline
                    points={view.points.filter((p) => p.src !== 'PREDLOG').map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="#d97706" strokeWidth={2} vectorEffect="non-scaling-stroke"
                  />
                </svg>
              ) : null}
              {view.points.map((p, i) => (
                <span
                  key={`${i}-${p.x.toFixed(4)}`}
                  title={p.label ?? `Točka ${i + 1}`}
                  className={`pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 text-[9px] font-bold leading-none ${p.src === 'PREDLOG' ? 'border-sky-600 border-dashed bg-sky-400/80 text-white' : calibA === i ? 'border-sky-500 bg-sky-500 text-white' : 'border-amber-600 bg-amber-500 text-white'}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                >
                  <span className="flex size-full items-center justify-center">{i + 1}</span>
                </span>
              ))}
            </div>
          </div>

          {/* kalibracija */}
          <Card>
            <CardContent className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Crosshair className="size-4 text-roksal-amber" aria-hidden /> Kalibracija merila
                  {/* R455: zaklep referenčne mere (§4) */}
                  {view.calib ? (
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2" aria-pressed={view.calibLocked}
                      onClick={() => { snapshot(); setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calibLocked: !v.calibLocked } : v))) }}
                    >
                      {view.calibLocked ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
                      {view.calibLocked ? 'zaklenjeno' : 'zakleni'}
                    </Button>
                  ) : null}
                </p>
                {meriloOznaka(calc.scale) !== null ? (
                  <span className="text-xs text-muted-foreground">
                    {meriloOznaka(calc.scale)}
                    {!view.calibLocked ? (
                      <Button size="sm" variant="ghost" className="ml-2 h-7 px-2" onClick={() => { snapshot(); setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: null } : v))) }}>
                        <Trash2 className="size-3.5" aria-hidden /> ponastavi
                      </Button>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{view.calib ? 'neveljavna referenca — px in cm morata biti večja od 0' : calibMethod === 'RAVNINA' ? 'označite 4 vogale pravokotnika na merjeni ravnini' : 'izberite 2 točki + vnesite realno razdaljo'}</span>
                )}
              </div>
              {/* R457 (§4): metoda kalibracije + referenčni objekt */}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="km-calib-method" className="text-xs">Metoda kalibracije (§4)</Label>
                  <Select value={calibMethod} onValueChange={(v) => setCalibMethod(v as CalibrationMethod)}>
                    <SelectTrigger id="km-calib-method" className="h-9" aria-label="Metoda kalibracije"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CALIB_METHODS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label} — {m.desc}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="km-calib-ref" className="text-xs">Referenčni objekt</Label>
                  <Input id="km-calib-ref" className="h-9" value={refObject} onChange={(e) => setRefObject(e.target.value)} placeholder="npr. vrata 110 cm / marker 20 cm" />
                </div>
              </div>
              {/* R513 (issue #15 faza 1): PERSPEKTIVNA RAVNINA — 4 vogali znanega
                  pravokotnika NA merjeni ravnini → homografija. Merilo je DOKAZANO
                  v vseh smereh na ravnini (brez predpostavke frontalnosti). */}
              {!view.calib && calibMethod === 'RAVNINA' ? (
                <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30" data-testid="km-plane-calib">
                  <p className="text-xs font-semibold">Perspektivna ravnina — 4 vogali znanega pravokotnika</p>
                  <p className="text-[11px] text-muted-foreground">
                    Označite 4 vogale pravokotnika NA merjeni ravnini (npr. vrata, plošča, fasadno polje) v zaporedju: zgornji levi → zgornji desni → spodnji desni → spodnji levi. Mere veljajo za točke na tej ravnini.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="km-plane-w" className="text-xs">Širina pravokotnika (cm)</Label>
                      <Input id="km-plane-w" className="h-9 w-36" type="number" min="1" inputMode="decimal" value={planeW} onChange={(e) => setPlaneW(e.target.value)} placeholder="npr. 200" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="km-plane-h" className="text-xs">Višina pravokotnika (cm)</Label>
                      <Input id="km-plane-h" className="h-9 w-36" type="number" min="1" inputMode="decimal" value={planeH} onChange={(e) => setPlaneH(e.target.value)} placeholder="npr. 100" />
                    </div>
                    <Button
                      size="sm" className="h-9"
                      disabled={view.points.length < 4 || !(Number(planeW.replace(',', '.')) > 0) || !(Number(planeH.replace(',', '.')) > 0)}
                      onClick={() => {
                        const w = Number(planeW.replace(',', '.')); const h = Number(planeH.replace(',', '.'))
                        const four = view.points.slice(-4) // zadnji 4 kliki = vogali (popravek točke = nov klik); NORMALIZIRANI 0..1 — isto pogodbo kot meritvene točke (jedro pretvori prek imgW/imgH)
                        const test: EngineCalib = { px: 0, cm: 0, imgW: view.imgW, imgH: view.imgH, plane: { points: four, widthCm: w, heightCm: h } }
                        if (resolveScale(test).H == null) {
                          toast({ title: 'Vogali niso uporabni.', description: 'Točke morajo biti 4 razločni vogali (ne na premici) pravokotnika na merjeni ravnini.', variant: 'destructive' })
                          return
                        }
                        snapshot()
                        setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: { px: 0, cm: 0, plane: { points: four, widthCm: w, heightCm: h } } } : v)))
                      }}
                    >
                      <Ruler className="size-4" aria-hidden /> Postavi ravnino
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Označenih točk: {Math.min(view.points.length, 4)}/4 {view.points.length >= 4 ? '✓ (zadnji 4 kliki so vogali — popravek = nov klik)' : '— klikajte vogale na sliki zgoraj'}</p>
                </div>
              ) : null}
              {!view.calib && calibMethod !== 'RAVNINA' ? (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    Najprej kliknite na sliko in označite 2 točki znane razdalje (npr. rob stopnice, širina vrat), nato ju izberite spodaj.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="km-calib-a" className="text-xs">1. točka</Label>
                      <Select value={calibA !== null ? String(calibA) : 'none'} onValueChange={(v) => setCalibA(v === 'none' ? null : Number(v))}>
                        <SelectTrigger id="km-calib-a" className="h-9 w-28" aria-label="Prva točka kalibracije"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {view.points.map((p, i) => <SelectItem key={i} value={String(i)}>Točka {i + 1}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="km-calib-cm" className="text-xs">Realna razdalja (cm)</Label>
                      <Input id="km-calib-cm" className="h-9 w-32" type="number" min="1" inputMode="decimal" value={calibCm} onChange={(e) => setCalibCm(e.target.value)} placeholder="npr. 110" />
                    </div>
                    <Button
                      size="sm" className="h-9"
                      disabled={calibA === null || !(Number(calibCm) > 0) || view.points.length < 2}
                      onClick={() => {
                        const a = view.points[calibA ?? 0]
                        const b = view.points[calibA === view.points.length - 1 ? calibA - 1 : (calibA ?? 0) + 1]
                        if (!a || !b) return
                        const d = px(a, b)
                        if (d > 0) {
                          snapshot()
                          setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: { px: Math.round(d), cm: Number(calibCm) } } : v)))
                        }
                      }}
                    >
                      <Ruler className="size-4" aria-hidden /> Kalibriraj
                    </Button>
                  </div>
                </>
              ) : null}
              {/* Y referenca nima pomena pri ravnini — homografija že dokazuje obe smeri */}
              {view.calib && !view.calib.plane ? <YRefBlock key={`y1-${view.key}`} view={view} pxOf={px} onApply={applyYRef} idp="km1" /> : null}
            </CardContent>
          </Card>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={onClose}>Prekliči</Button>
            <Button onClick={() => setPhase(3)}>
              Naprej — meritev {view.calib ? '' : '(brez kalibracije — dolžine v px)'}
            </Button>
          </div>
        </div>
  )
}

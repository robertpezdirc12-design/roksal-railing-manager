'use client'

// faza-meritev.tsx — FAZA 3: MERITEV: označevanje/vlečenje točk s povečevalnim
// steklom, undo/redo, VLM predlogi, dodatni pogledi in dokumentacijske slike
// detajlov, kompaktna kalibracija pogleda in izračun v živo.
// R537-a: dobesedna selitev iz meritve-kamera.tsx — skupno stanje pride prek
// propsov; točkovni pomočniki (removePoint/onPoint*) in predlogi
// (acceptPredloge/rejectPredloge) so krajevni (živijo le v tej fazi).

import type { Dispatch, MouseEvent, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from 'react'
import { Camera, Check, Crosshair, Eraser, Loader2, Lock, LockOpen, Paperclip, Redo2, Ruler, Sparkles, SquarePlus, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/roksal/ui-bits'
import { useToast } from '@/hooks/use-toast'
import { fmtDate } from '@/lib/api-client'
import { DOC_TAG_LABELS, DOC_TAGS, MAX_DOK_SLIK, jeVeljavenDocTag, prostorZaDokSlike, type DokSlika } from '@/lib/measure-doc'
import { MODE_RULES, type MeasureMode } from '@/lib/measure-engine'
import { fmt1, merilaPasus, meriloOznaka, type CalcResult, type MultiView } from './geometrija'
import { parsePhoto } from './kakovost'
import { MAX_VIEWS, type DragState, type LensState, type PhotoRow, type Pt, type View, type ZgodovinaVnos } from './tipi'
import { Povecalo } from './povecalo'
import { YRefBlock } from './y-ref-blok'

export interface FazaMeritevProps {
  view: View
  undo: () => void
  redo: () => void
  past: RefObject<ZgodovinaVnos[]>
  future: RefObject<ZgodovinaVnos[]>
  snapshot: () => void
  setViews: Dispatch<SetStateAction<View[]>>
  rocnoCnt: number
  detect: () => Promise<void>
  detecting: boolean
  views: View[]
  addingView: boolean
  setAddingView: Dispatch<SetStateAction<boolean>>
  detajli: DokSlika[]
  setDetajli: Dispatch<SetStateAction<DokSlika[]>>
  addingDok: boolean
  setAddingDok: Dispatch<SetStateAction<boolean>>
  fileViewRef: RefObject<HTMLInputElement | null>
  onFileView: (f: File | undefined) => Promise<void>
  fileDokRef: RefObject<HTMLInputElement | null>
  onFileDok: (f: File | undefined) => Promise<void>
  existingPhotos: PhotoRow[]
  pickExistingView: (p: PhotoRow) => void
  pickExistingDok: (p: PhotoRow) => void
  mode: MeasureMode
  activeView: number
  setActiveView: Dispatch<SetStateAction<number>>
  calibA: number | null
  setCalibA: Dispatch<SetStateAction<number | null>>
  predlogi: Pt[]
  imgBoxRef: RefObject<HTMLDivElement | null>
  onImageClick: (e: MouseEvent<HTMLDivElement>) => void
  calc: CalcResult
  calibCm: string
  setCalibCm: Dispatch<SetStateAction<string>>
  px: (a: Pt, b: Pt) => number
  applyYRef: (pxY: number | null, cmY: number | null) => void
  stairMode: boolean
  setStairMode: Dispatch<SetStateAction<boolean>>
  multi: MultiView
  lens: LensState | null
  setLens: Dispatch<SetStateAction<LensState | null>>
  dragRef: RefObject<DragState | null>
  setHistTick: Dispatch<SetStateAction<number>>
  setServerLayout: Dispatch<SetStateAction<string | null>>
  setPhase: Dispatch<SetStateAction<1 | 2 | 3 | 4 | 5>>
}

export function FazaMeritev (props: FazaMeritevProps) {
  const {
    view, undo, redo, past, future, snapshot, setViews, rocnoCnt, detect, detecting, views, addingView,
    setAddingView, detajli, setDetajli, addingDok, setAddingDok, fileViewRef, onFileView, fileDokRef,
    onFileDok, existingPhotos, pickExistingView, pickExistingDok, mode, activeView, setActiveView, calibA,
    setCalibA, predlogi, imgBoxRef, onImageClick, calc, calibCm, setCalibCm, px, applyYRef, stairMode,
    setStairMode, multi, lens, setLens, dragRef, setHistTick, setServerLayout, setPhase,
  } = props
  const { toast } = useToast()

  function removePoint (i: number): void {
    if (!view) return
    snapshot()
    setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, points: v.points.filter((_, k) => k !== i) } : v)))
    if (calibA === i) setCalibA(null)
    setServerLayout(null)
  }

  // ── R455: vlečenje točk (premik) + povečevalno steklo (§1/§4) ──
  function onPointDown (e: ReactPointerEvent<HTMLButtonElement>, i: number): void {
    if (!view) return
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* nekateri brskalniki */ }
    // stanje PRED morebitnim vlečenjem — za undo (posnetek ob koncu vlečenja)
    dragRef.current = {
      view: activeView, point: i, startX: e.clientX, startY: e.clientY, moved: false,
      preViews: structuredClone(views),
    }
    setLens({ x: e.clientX, y: e.clientY, view: activeView })
  }

  function onPointMove (e: ReactPointerEvent<HTMLButtonElement>): void {
    const d = dragRef.current
    if (!d) return
    const box = imgBoxRef.current?.getBoundingClientRect()
    if (!box) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) {
      setLens({ x: e.clientX, y: e.clientY, view: d.view })
      return
    }
    d.moved = true
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))
    setViews((vs) => vs.map((v, vi) => {
      if (vi !== d.view) return v
      return { ...v, points: v.points.map((p, pi) => (pi === d.point ? { ...p, x, y } : p)) }
    }))
    setServerLayout(null)
    setLens({ x: e.clientX, y: e.clientY, view: d.view })
  }

  function onPointUp (i: number): void {
    const d = dragRef.current
    setLens(null)
    dragRef.current = null
    if (!d) return
    if (!d.moved) {
      // premik pod pragom → tap = izbriši (ohranjeno vedenje iz prejšnjih verzij)
      removePoint(i)
      return
    }
    // posnetek stanja PRED vlečenjem — undo vrne točko na izhodišče (§4)
    // R537-ac-verify: refsa past/future (iz useUndoRedo) ohranjata izvirna imena iz
    // meritve-kamera.tsx:1170–1172 — preimenovanje na *Ref bi razkrilo novo
    // opozorilo react-hooks/refs na branjih med renderjem (gumbi undo/redo spodaj),
    // zato ostaja eno ciljno izključeno opozorilo immutability na prirejanju.
    past.current.push({ views: d.preViews, activeView })
    if (past.current.length > 50) past.current.shift()
    // eslint-disable-next-line react-hooks/immutability
    future.current = []
    setHistTick((t) => t + 1)
  }

  /** R455: sprejme VSE predloge (PREDLOG → ROCNO) na aktivnem pogledu. */
  function acceptPredloge (): void {
    if (!view) return
    snapshot()
    setViews((vs) => vs.map((v) => (v.key === view.key
      ? { ...v, points: v.points.map((p) => (p.src === 'PREDLOG' ? { ...p, src: 'ROCNO' as const } : p)) }
      : v)))
    toast({ title: 'Predlogi sprejeti.', description: 'Točke so sedaj ročno potrjene in štejejo v izračun.' })
  }

  /** R455: zavrže VSE predloge na aktivnem pogledu. */
  function rejectPredloge (): void {
    if (!view) return
    snapshot()
    setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, points: v.points.filter((p) => p.src !== 'PREDLOG') } : v)))
  }

  return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* R455: undo/redo (§4) */}
            <Button size="sm" variant="outline" onClick={undo} disabled={past.current.length === 0} aria-label="Razveljavi">
              <Undo2 className="size-4" aria-hidden /> Razveljavi
            </Button>
            <Button size="sm" variant="outline" onClick={redo} disabled={future.current.length === 0} aria-label="Uveljavi">
              <Redo2 className="size-4" aria-hidden /> Uveljavi
            </Button>
            <Button size="sm" variant="outline" onClick={() => { snapshot(); setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, points: v.points.filter((p) => p.src !== 'PREDLOG') } : v))) }} disabled={rocnoCnt === 0}>
              <Eraser className="size-4" aria-hidden /> Počisti točke
            </Button>
            <Button size="sm" variant="outline" onClick={() => void detect()} disabled={detecting || !view.photoId}>
              {detecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {detecting ? 'VLM …' : 'Zaznaj samodejno'}
            </Button>
            {/* R455: dodatni pogled (§3) — R487 (issue #3): gumb odpre panel z
                DVEMA potema — terenska (kamera/datoteka) in izbira obstoječe
                FOTO projekta (isti vzorec kot 1. pogled) */}
            {views.length < MAX_VIEWS ? (
              <Button size="sm" variant="outline" onClick={() => setAddingView((a) => !a)} aria-expanded={addingView}>
                <SquarePlus className="size-4" aria-hidden /> Dodaj pogled ({views.length}/{MAX_VIEWS})
              </Button>
            ) : null}
            {/* R522 (issue #7 §4B): dokumentacijska slika detajla — LOČENA od
                merilnih pogledov (dokaz, ne rekonstrukcija) zato je na voljo
                TUDI ko so vsi pogledi zasedeni. Meja je lastna (MAX_DOK_SLIK). */}
            <Button size="sm" variant="outline" onClick={() => setAddingDok((a) => !a)} aria-expanded={addingDok} disabled={prostorZaDokSlike(detajli.length) <= 0}>
              <Paperclip className="size-4" aria-hidden /> Dok. slika{detajli.length > 0 ? ` (${detajli.length}/${MAX_DOK_SLIK})` : ''}
            </Button>
          </div>

          {/* R487 (issue #3): panel dodajanja pogleda — terenska pot OSTANE
              (file/capture input) + alternativna izbira obstoječe FOTO */}
          {addingView && views.length < MAX_VIEWS ? (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-sm font-medium">Dodaj pogled istega objekta</p>
              <p className="text-[11px] text-muted-foreground">
                Vsak pogled ima svojo kalibracijo in točke — označite iste točke kot na prvem pogledu; pogledi se primerjajo v koraku Preverjanje.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => fileViewRef.current?.click()}>
                  <Camera className="size-4" aria-hidden /> Posnemi / naloži iz telefona
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingView(false)}>Prekliči</Button>
              </div>
              <input ref={fileViewRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { setAddingView(false); void onFileView(e.target.files?.[0]); e.target.value = '' }} aria-label="Dodaj fotografijo istega objekta" />
              {existingPhotos.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">Ali izberi obstoječo fotografijo:</p>
                  <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="list">
                    {existingPhotos.map((p) => (
                      <button key={p.id} type="button" onClick={() => pickExistingView(p)} className="group overflow-hidden rounded-lg border text-left transition hover:border-roksal-amber" role="listitem">
                        <img src={parsePhoto(p.params) ?? ''} alt={`Fotografija ${p.location ?? 'brez lokacije'}`} className="h-16 w-full object-cover" />
                        <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground group-hover:text-foreground">
                          {p.location ?? p.project?.code ?? fmtDate(p.createdAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* R522 (issue #7 §4B): panel dodajanja DOKUMENTACIJSKE slike — isto
              dvopotno nalaganje kot pogled, a gre v ločen seznam (dokaz). */}
          {addingDok ? (
            <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-sm font-medium">Dodaj dokumentacijsko sliko detajla</p>
              <p className="text-[11px] text-muted-foreground">
                Slika je DOKAZ (vijak, nosilec, podlaga, ovira), ne merilni pogled — brez kalibracije in točk. Po dodajanju izberite oznako in jo po potrebi pripnite na segment.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => fileDokRef.current?.click()}>
                  <Camera className="size-4" aria-hidden /> Posnemi / naloži iz telefona
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingDok(false)}>Prekliči</Button>
              </div>
              <input ref={fileDokRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { setAddingDok(false); void onFileDok(e.target.files?.[0]); e.target.value = '' }} aria-label="Dodaj dokumentacijsko sliko detajla" />
              {existingPhotos.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground">Ali izberi obstoječo fotografijo:</p>
                  <div className="grid max-h-40 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="list">
                    {existingPhotos.map((p) => (
                      <button key={p.id} type="button" onClick={() => pickExistingDok(p)} className="group overflow-hidden rounded-lg border text-left transition hover:border-roksal-amber" role="listitem">
                        <img src={parsePhoto(p.params) ?? ''} alt={`Fotografija ${p.location ?? 'brez lokacije'}`} className="h-16 w-full object-cover" />
                        <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground group-hover:text-foreground">
                          {p.location ?? p.project?.code ?? fmtDate(p.createdAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* R522: seznam dokumentacijskih slik — oznaka + segment + opomba +
              brisanje pred potrditvijo (vse popravljivo, §4B »ročno popravljivo«). */}
          {detajli.length > 0 ? (
            <div className="space-y-2 rounded-lg border p-3" aria-label="Dokumentacijske slike detajlov">
              <p className="text-xs font-medium">Dokumentacijske slike ({detajli.length}/{MAX_DOK_SLIK}) — dokaz, ne mera</p>
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {detajli.map((d, i) => (
                  <div key={d.key} className="flex flex-wrap items-start gap-2 rounded-md border bg-muted/30 p-2">
                    <img src={d.dataUrl} alt={`Detajl ${i + 1}`} className="h-16 w-24 shrink-0 rounded object-cover" />
                    <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`dok-tag-${d.key}`} className="text-[11px]">Oznaka detajla</Label>
                        <Select value={d.tag} onValueChange={(v) => { if (jeVeljavenDocTag(v)) setDetajli((ds) => ds.map((x) => x.key === d.key ? { ...x, tag: v } : x)) }}>
                          <SelectTrigger id={`dok-tag-${d.key}`} className="h-8 w-44" aria-label="Oznaka detajla"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DOC_TAGS.map((t) => <SelectItem key={t} value={t}>{DOC_TAG_LABELS[t]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {calc.segs.length > 1 ? (
                        <div className="space-y-1">
                          <Label htmlFor={`dok-seg-${d.key}`} className="text-[11px]">Segment</Label>
                          <Select value={d.segmentIdx === null ? 'cela' : String(d.segmentIdx)} onValueChange={(v) => setDetajli((ds) => ds.map((x) => x.key === d.key ? { ...x, segmentIdx: v === 'cela' ? null : Number(v) } : x))}>
                            <SelectTrigger id={`dok-seg-${d.key}`} className="h-8 w-36" aria-label="Pripni na segment"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cela">Cela meritev</SelectItem>
                              {calc.segs.map((s, si) => <SelectItem key={si} value={String(si)}>Segment {si + 1} ({fmt1((s.cmLen ?? 0) / 100)} m)</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                      <div className="min-w-32 flex-1 space-y-1">
                        <Label htmlFor={`dok-note-${d.key}`} className="text-[11px]">Opomba</Label>
                        <Input id={`dok-note-${d.key}`} className="h-8" value={d.note} maxLength={200} placeholder="npr. vijaki M12 na betonskih sidrih"
                          onChange={(e) => setDetajli((ds) => ds.map((x) => x.key === d.key ? { ...x, note: e.target.value } : x))} />
                      </div>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" aria-label={`Odstrani detajl ${i + 1}`} onClick={() => setDetajli((ds) => ds.filter((x) => x.key !== d.key))}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* R457 (§2): vodilo načina za označevanje */}
          <p className="rounded-lg bg-muted/60 px-3 py-1.5 text-[11px] text-muted-foreground" role="note">
            <strong className="text-foreground">{MODE_RULES[mode].label}:</strong> {MODE_RULES[mode].hint}
          </p>

          {/* R455: zavihki pogledov */}
          {views.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Pogledi meritve">
              {views.map((v, i) => (
                <button
                  key={v.key} type="button" role="tab" aria-selected={i === activeView}
                  onClick={() => { setActiveView(i); setCalibA(null) }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${i === activeView ? 'border-roksal-amber bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'text-muted-foreground hover:border-foreground/30'}`}
                >
                  Pogled {i + 1}
                  {v.calib ? ' ✓' : ' ⚠'}
                  {i === 0 ? ' (glavni)' : ''}
                </button>
              ))}
            </div>
          ) : null}

          {/* R455: predlogi VLM — vizualno ločeni, zahtevajo potrditev (§2) */}
          {predlogi.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/40" role="status">
              <p className="text-xs font-medium text-sky-900 dark:text-sky-200">
                {predlogi.length} samodejnih predlogov točk — niso potrjeni in ne štejejo v izračun.
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="h-8" onClick={acceptPredloge}><Check className="size-3.5" aria-hidden /> Sprejmi vse</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={rejectPredloge}><Trash2 className="size-3.5" aria-hidden /> Zavrzi</Button>
              </div>
            </div>
          ) : null}

          <div className="mx-auto inline-block max-w-full rounded-lg border bg-muted/40 p-1">
            <div
              ref={imgBoxRef}
              className="relative inline-block cursor-crosshair" onClick={onImageClick}
              role="application" aria-label="Slika za označevanje merilnih točk — klik dodaja točko, vlečenje premika, klik na točko briše"
            >
              <img src={view.dataUrl} alt="Teren za merjenje" className="block h-auto max-h-[420px] w-auto max-w-full select-none" draggable={false} />
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
                {calc.pts.length > 1 ? (
                  <polyline
                    points={calc.pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="#d97706" strokeWidth={2} vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
              {view.points.map((p, i) => (
                <button
                  key={`${i}-${p.x.toFixed(4)}`}
                  type="button"
                  title={p.src === 'PREDLOG' ? `PREDLOG: ${p.label ?? 'samodejna točka'} — sprejmite ali zavrzi` : `${p.label ?? `Točka ${i + 1}`} — klik za brisanje, vleci za premik`}
                  aria-label={p.src === 'PREDLOG' ? `Predlog točke ${i + 1}${p.label ? ` ${p.label}` : ''}` : `Točka ${i + 1}${p.label ? ` ${p.label}` : ''} — klik za brisanje, vlečenje za premik`}
                  onPointerDown={(e) => onPointDown(e, i)}
                  onPointerMove={onPointMove}
                  onPointerUp={() => onPointUp(i)}
                  onPointerCancel={() => { dragRef.current = null; setLens(null) }}
                  className={`absolute size-7 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 text-[10px] font-bold leading-none ${p.src === 'PREDLOG'
                    ? 'border-dashed border-sky-700 bg-sky-400/80 text-white'
                    : calibA === i
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-amber-600 bg-amber-500 text-white'}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                >
                  <span className="flex size-full items-center justify-center">{i + 1}</span>
                </button>
              ))}
            </div>
          </div>

          {/* R455: povečevalno steklo med vlečenjem (§4) */}
          <Povecalo lens={lens} view={view} imgBoxRef={imgBoxRef} />

          {/* kalibracija pogleda (kompaktno — za dodatne poglede / popravke) */}
          <Card>
            <CardContent className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Crosshair className="size-4 text-roksal-amber" aria-hidden /> Kalibracija {views.length > 1 ? `— pogled ${activeView + 1}` : ''}
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
                  <span className="text-xs text-muted-foreground">{meriloOznaka(calc.scale)}{!view.calibLocked ? (
                    <Button size="sm" variant="ghost" className="ml-2 h-7 px-2" onClick={() => { snapshot(); setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: null } : v))) }}>
                      <Trash2 className="size-3.5" aria-hidden /> ponastavi
                    </Button>
                  ) : null}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">{view.calib ? 'neveljavna referenca — px in cm morata biti večja od 0' : 'označite 2 točki znane razdalje na sliki, ju izberite in kalibrirajte'}</span>
                )}
              </div>
              {!view.calib ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="km-calib-a2" className="text-xs">1. točka</Label>
                    <Select value={calibA !== null ? String(calibA) : 'none'} onValueChange={(v) => setCalibA(v === 'none' ? null : Number(v))}>
                      <SelectTrigger id="km-calib-a2" className="h-9 w-28" aria-label="Prva točka kalibracije"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {view.points.map((p, i) => <SelectItem key={i} value={String(i)}>Točka {i + 1}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-calib-cm2" className="text-xs">Realna razdalja (cm)</Label>
                    <Input id="km-calib-cm2" className="h-9 w-32" type="number" min="1" inputMode="decimal" value={calibCm} onChange={(e) => setCalibCm(e.target.value)} placeholder="npr. 110" />
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
              ) : null}
              {view.calib ? <YRefBlock key={`y2-${view.key}`} view={view} pxOf={px} onApply={applyYRef} idp="km2" /> : null}
            </CardContent>
          </Card>

          {/* izračun */}
          {calc.pts.length >= 2 ? (
            <Card>
              <CardContent className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Izračun {calc.scale.basis === 'RAVNINA' ? '(perspektivna ravnina)' : calc.cmPerPx ? '' : '(px — brez kalibracije)'}</p>
                  <Button size="sm" variant={stairMode ? 'default' : 'outline'} className="h-8" onClick={() => setStairMode((s) => !s)} aria-pressed={stairMode}>
                    Stopnišče {stairMode ? 'vklop' : 'izklop'}
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th scope="col" className="py-1.5 pr-3 font-medium">Točki</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Dolžina</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium">Kot</th>
                        <th scope="col" className="py-1.5 font-medium">Δ višine</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calc.segs.map((s) => (
                        <tr key={s.i} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 font-mono">{s.i + 1} → {s.j + 1}</td>
                          <td className="py-1.5 pr-3 font-semibold">{s.cmLen !== null ? `${fmt1(s.cmLen)} cm` : `${Math.round(s.pxLen)} px`}</td>
                          <td className="py-1.5 pr-3">{fmt1(Math.abs(s.angleDeg))}°</td>
                          <td className="py-1.5">{s.dVCm !== null ? `${s.dVCm > 0 ? '+' : ''}${fmt1(s.dVCm)} cm` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>Skupaj: <strong className="text-foreground">{calc.totalCm !== null ? `${fmt1(calc.totalCm / 100)} m` : `${Math.round(calc.totalPx)} px`}</strong></span>
                  {views.length > 1 && multi.mean !== null ? <span>Povprečje {views.length} pogledov: <strong className="text-foreground">{fmt1(multi.mean / 100)} m</strong></span> : null}
                </div>
                {/* R501 (issue #15 faza 2): enako pojasnilo merila kot na strežniku
                    — jedro (resolveScale) pove, KAJ je dokazano in kaj predpostavljeno. */}
                <p className={`text-[11px] ${calc.scale.known && calc.scale.isotropicProven ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {merilaPasus(calc.scale)}
                </p>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              title={predlogi.length > 0 ? 'Sprejmite ali zavrzite predloge, ali označite točke' : 'Označite točke'}
              desc="Kliknite na sliko: vogali ograje, robovi stopnic, tla ob stebrih … Klik na točko jo izbriše, vlečenje jo premika (s povečevalnim steklom)."
              icon={Crosshair}
            />
          )}

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setPhase(2)}><Undo2 className="size-4" aria-hidden /> Nazaj na kalibracijo</Button>
            <Button onClick={() => setPhase(4)} disabled={rocnoCnt < 2}>
              Naprej — preverjanje
            </Button>
          </div>
        </div>
  )
}

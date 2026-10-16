'use client'

// predogled.tsx — kartica AR predogleda (R537-b: dobesedna selitev iz ar.tsx):
// glava (statusne značke + izklop kamere), ogledno okno (video, SceneOverlay,
// ročni bbox, demo ozadje, vlečni overlay z ograjo), preklop pogledov zaznav
// (R485 §9) in zložljiva navodila (R483 §11-3). Stanje ostaja v vstopu.

import { useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from 'react'

import { Camera, CameraOff, ChevronDown, ChevronRight, Lightbulb, Loader2, Lock, Move, Plus, Video, Waypoints } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import SceneOverlay from '@/components/roksal/scene-overlay'
import type { SceneUnderstandingState } from '@/hooks/use-scene-understanding'
import type { SceneElement } from '@/lib/scene-understanding-core'

import { ArRailingSvg, ArRunRailingSvg, OVERLAY_H, OVERLAY_W } from './ograja-overlay'
import { DEMO_GRAD, MANUAL_BBOX_DEFAULT, SCENE_VIEWS, type ManualTagValues, type Mode, type RunSegmentRow, type SceneView } from './tipi'
import { ManualTagForm, SceneElementRow } from './zaznave'

/** Glava predogleda: naslov + statusne značke + izklop kamere. */
export function PredogledGlava ({ mode, locked, vir, runSegs, stopCamera }: {
  mode: Mode
  locked: boolean
  vir: 'rocno' | 'tekac'
  runSegs: RunSegmentRow[] | null
  stopCamera: () => void
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
        <Video className="size-4 text-roksal-amber" aria-hidden /> Predogled
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'on' ? <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Kamera aktivna</Badge> : null}
        {mode === 'demo' ? <Badge className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Demo ozadje</Badge> : null}
        {locked && mode !== 'off' ? <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">Zaklenjeno</Badge> : null}
        {vir === 'tekac' && mode !== 'off' ? <Badge className="border-transparent bg-secondary text-secondary-foreground">Tekač: {runSegs?.length ?? 0} seg.</Badge> : null}
        {mode !== 'off' ? (
          <Button variant="outline" size="sm" onClick={stopCamera}>
            <CameraOff className="size-4" aria-hidden /> Izklopi kamero
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Ogledno okno predogleda: video/demo ozadje, žive zaznave, predogled bboxa
 *  ročne oznake, vlečni overlay z ograjo (SVG) + stabilizacija povleka. */
export function PredogledViewport ({
  viewportRef, videoRef, svgRef, setVideoAspect,
  mode, sceneState, sceneOverlayElements, sceneSelectedId, scenePinned, sceneView,
  selectSceneElement, manualOpen, manualBBox, starting, startCamera, setMode,
  locked, pos, scale, opacity, vir, runSegs, runLoading, posts, heightCm,
  onPointerDown, onPointerMove, onPointerUp,
}: {
  viewportRef: RefObject<HTMLDivElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  svgRef: RefObject<SVGSVGElement | null>
  setVideoAspect: Dispatch<SetStateAction<number>>
  mode: Mode
  sceneState: SceneUnderstandingState
  sceneOverlayElements: SceneElement[]
  sceneSelectedId: string | null
  scenePinned: Set<string>
  sceneView: SceneView
  selectSceneElement: (el: SceneElement) => void
  manualOpen: boolean
  manualBBox: [number, number, number, number] | null
  starting: boolean
  startCamera: () => Promise<void>
  setMode: Dispatch<SetStateAction<Mode>>
  locked: boolean
  pos: { x: number; y: number }
  scale: number
  opacity: number
  vir: 'rocno' | 'tekac'
  runSegs: RunSegmentRow[] | null
  runLoading: boolean
  posts: number
  heightCm: number
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: () => void
}): React.ReactElement {
  return (
    <div
      ref={viewportRef}
      className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-xl border bg-muted"
      aria-label="AR predogled ograje"
    >
      {/* video (samo ko je kamera aktivna) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 size-full object-cover"
        aria-label="Živa slika kamere"
        onLoadedMetadata={(e) => {
          // R470 (§5): razmerje stranic za izračun dolžin osi v px
          const vw = e.currentTarget.videoWidth
          const vh = e.currentTarget.videoHeight
          if (vw > 0 && vh > 0) setVideoAspect(vw / vh)
        }}
      />

      {/* R467 (issue #8 F1): žive zaznave prizora — samo z živo kamero;
          POD ograjinim overlayjem (ograja ostane glavni interakcijski objekt).
          R485 (§9): pogled (ŽIVO/PREPOZNANO/MERE) — SAMO prikaz istih elementov. */}
      {mode === 'on' && sceneOverlayElements.length > 0 ? (
        <SceneOverlay
          elements={sceneOverlayElements}
          quality={sceneState.quality}
          selectedId={sceneSelectedId}
          pinnedIds={scenePinned}
          view={sceneView === 'PREPOZNANO' ? 'PREPOZNANO' : sceneView === 'MERE' ? 'MERE' : 'ZIVO'}
          onSelect={selectSceneElement}
        />
      ) : null}

      {/* R485 (issue #8 §1): živi predogled bboxa ročne oznake — kam
          bo oznaka postavljena (števci 0..1 → delež kadra). */}
      {mode === 'on' && manualOpen && manualBBox != null ? (
        <div
          className="pointer-events-none absolute rounded-md border-2 border-dashed border-roksal-amber bg-roksal-amber/10"
          style={{
            left: `${Math.round(manualBBox[0] * 100)}%`,
            top: `${Math.round(manualBBox[1] * 100)}%`,
            width: `${Math.round(manualBBox[2] * 100)}%`,
            height: `${Math.round(manualBBox[3] * 100)}%`,
          }}
          aria-hidden
        />
      ) : null}

      {/* demo ozadje */}
      {mode === 'demo' ? (
        <div className="absolute inset-0" style={{ background: DEMO_GRAD }} aria-hidden />
      ) : null}

      {/* izklopljeno stanje */}
      {mode === 'off' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-secondary/60 p-6 text-center">
          <Camera className="size-10 text-muted-foreground/60" aria-hidden />
          <p className="max-w-sm text-sm text-muted-foreground">
            Vklopite kamero za predogled ograje na realni lokaciji — ali uporabite demo ozadje, če kamere ni.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => void startCamera()} disabled={starting}>
              {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
              Vklopi kamero
            </Button>
            <Button variant="outline" onClick={() => setMode('demo')} disabled={starting}>
              Demo ozadje
            </Button>
          </div>
        </div>
      ) : null}

      {/* overlay ograja — vlečna (samo ko predogled teče; v stanju "off" ne sme
          prekrivati gumbov Zaženi kamero / Demo ozadje) */}
      {mode !== 'off' ? (
        <div
          className={`touch-none ${locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
          style={{
            opacity,
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: OVERLAY_W,
            height: OVERLAY_H,
            transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="img"
          aria-label={vir === 'tekac'
            ? `Predogled ograje iz tekača: ${runSegs?.length ?? 0} segmentov${locked ? ' — položaj zaklenjen' : ' — povlecite za premik'}`
            : `Predogled ograje: ${posts} stebrov, višina ${heightCm} centimetrov${locked ? ' — položaj zaklenjen' : ' — povlecite za premik'}`}
          tabIndex={0}
        >
          {vir === 'tekac' && runSegs && runSegs.length > 0 ? (
            <ArRunRailingSvg ref={svgRef} segments={runSegs} fallbackHeightCm={heightCm} />
          ) : vir === 'tekac' ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/70 bg-black/35 p-4 text-center text-[11px] font-medium text-white">
              <Waypoints className="size-5" aria-hidden />
              {runLoading ? 'Nalagam segmente tekača …' : 'Izberite tekača (levo) za predogled realne geometrije'}
            </div>
          ) : (
            <ArRailingSvg ref={svgRef} posts={posts} heightCm={heightCm} />
          )}
          <span className="pointer-events-none absolute -top-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
            {locked ? <Lock className="size-3" aria-hidden /> : <Move className="size-3" aria-hidden />}
            {locked ? 'zaklenjeno' : 'povleci'}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** Preklop pogledov zaznav + gumb/obrazec ročne oznake + PREGLED seznam
 *  (R485 §9; selitev iz ar.tsx — R537-b). */
export function PredogledPogledi ({
  sceneView, setSceneView, canWrite, manualOpen, setManualOpen, setManualBBox,
  sceneDisplayed, sceneSelectedId, selectSceneElement, addManualElementLive, handleManualBBox,
}: {
  sceneView: SceneView
  setSceneView: Dispatch<SetStateAction<SceneView>>
  canWrite: boolean
  manualOpen: boolean
  setManualOpen: Dispatch<SetStateAction<boolean>>
  setManualBBox: Dispatch<SetStateAction<[number, number, number, number] | null>>
  sceneDisplayed: SceneElement[]
  sceneSelectedId: string | null
  selectSceneElement: (el: SceneElement) => void
  addManualElementLive: (v: ManualTagValues) => void
  handleManualBBox: (b: [number, number, number, number] | null) => void
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label="Pogled zaznav v AR predogledu"
        className="grid grid-cols-4 gap-1 rounded-lg border bg-secondary/40 p-1"
      >
        {SCENE_VIEWS.map((v) => {
          const active = sceneView === v.id
          return (
            <button
              key={v.id}
              type="button"
              title={v.hint}
              aria-pressed={active}
              className={`flex min-h-11 items-center justify-center rounded-md px-1 text-[11px] font-bold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-roksal-amber ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
              onClick={() => { setSceneView(v.id) }}
            >
              {v.text.toUpperCase()}
            </button>
          )
        })}
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground" role="note">
        {SCENE_VIEWS.find((v) => v.id === sceneView)?.hint}
      </p>

      {/* R485 (issue #8 §1): ROČNA OZNAKA — »neprepoznano, tapni za
          označitev« prej ni imela poti (zaznavanje NE producira
          NEZNANO — poštenost). V ŽIVO/PREPOZNANO/PREGLED pogledu. */}
      {canWrite && sceneView !== 'MERE' && !manualOpen ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setManualOpen(true); setManualBBox(MANUAL_BBOX_DEFAULT) }}
        >
          <Plus className="size-3.5" aria-hidden /> Dodaj oznako ročno
        </Button>
      ) : null}
      {manualOpen && canWrite ? (
        <ManualTagForm
          onSubmit={addManualElementLive}
          onCancel={() => { setManualOpen(false); setManualBBox(null) }}
          onBBoxChange={handleManualBBox}
        />
      ) : null}

      {/* PREGLED (§9 :137): tapljivi seznam VSEH elementov — vrstica
          na element (ikona/razred, opomba, status, zaupanje, mere,
          vir); tap odpre obstoječi tap-detail pod predogledom. */}
      {sceneView === 'PREGLED' ? (
        <div className="rounded-lg border">
          <p className="flex items-center justify-between border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <span>Pregled elementov</span>
            <span className="font-semibold" aria-label={`${sceneDisplayed.length} elementov`}>{sceneDisplayed.length}</span>
          </p>
          {sceneDisplayed.length === 0 ? (
            <div className="space-y-2 p-3">
              <p className="text-sm text-muted-foreground">
                V tem kadru ni zaznanih elementov — zaznavanje je namenoma konservativno
                (brez dokaza ne trdi razreda; NEZNANO je poštena zadnja možnost).
              </p>
              {canWrite ? (
                <Button variant="outline" size="sm" onClick={() => { setManualOpen(true); setManualBBox(MANUAL_BBOX_DEFAULT) }}>
                  <Plus className="size-3.5" aria-hidden /> Dodaj oznako ročno
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto pr-1" aria-label="Seznam zaznanih elementov prizora">
              {sceneDisplayed.map((el) => (
                <li key={el.id}>
                  <SceneElementRow el={el} selected={sceneSelectedId === el.id} onSelect={selectSceneElement} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* MERE brez mer — pošteno prazno stanje (osi so predlog brez cm) */}
      {sceneView === 'MERE' && !sceneDisplayed.some((e) => (e.measures?.length ?? 0) > 0) ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground" role="note">
          V tem kadru še ni zabeleženih mer — izberite element in zabeležite mero
          (ročni vnos, referenčna skala ali AR globina). Osi brez metode ostanejo brez cm.
        </p>
      ) : null}
    </div>
  )
}

/** Zložljiva navodila ob nezadostnih podatkih (R483 §11-3; selitev iz
 *  ar.tsx — R537-b). */
export function PredogledNavodila (): React.ReactElement {
  /** R483 (issue #8 F5 §11-3): zložljiva navodila ob nezadostnih podatkih —
   *  privzeto ZAPRTO (naslov vedno viden pod AR predogledom). */
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
      <div className="rounded-lg border border-dashed">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-roksal-amber"
            aria-expanded={helpOpen}
            aria-controls="ar-nezadostni-podatki"
          >
            {helpOpen ? <ChevronDown className="size-4 shrink-0 text-roksal-amber" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-roksal-amber" aria-hidden />}
            <Lightbulb className="size-4 shrink-0 text-roksal-amber" aria-hidden />
            <span className="text-xs font-bold uppercase tracking-wide">Nezadostni podatki — kaj zdaj?</span>
            <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">{helpOpen ? 'skrči' : 'razpri'}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol id="ar-nezadostni-podatki" className="space-y-1.5 border-t px-3 py-2.5">
            <li className="flex items-start gap-1.5 text-xs leading-snug">
              <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">1.</span>
              <span><strong>Posnemite dodatni pogled z drugega kota</strong> — zakriti rob ali konec se pogosto pokaže že z malo drugačnega stališča.</span>
            </li>
            <li className="flex items-start gap-1.5 text-xs leading-snug">
              <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">2.</span>
              <span><strong>Določite referenčno mero</strong> — znana dolžina v kadru (miknik, plošča, stopnica) omogoči izpeljavo centimetrov.</span>
            </li>
            <li className="flex items-start gap-1.5 text-xs leading-snug">
              <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">3.</span>
              <span><strong>Manjkajoči rob ali točko označite ročno</strong> — popravek razreda ali vrste se shrani kot označen podatek, izvirna zaznava ostane.</span>
            </li>
            <li className="flex items-start gap-1.5 text-xs leading-snug">
              <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">4.</span>
              <span><strong>Pri naklonu uporabite nivelir ali referenčno metodo</strong> — brez globinskih podatkov je naklon samo ocena (ročni vnos šteje kot izmera).</span>
            </li>
            <li className="flex items-start gap-1.5 text-xs leading-snug">
              <span aria-hidden className="mt-0.5 shrink-0 font-bold text-roksal-amber">5.</span>
              <span><strong>Kritična mera brez dokaza NE gre v kosovnico</strong> — izmerite ročno ali iz tekača; prepoznava je samo predlog.</span>
            </li>
          </ol>
          <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            Velja vsem zaznavam: to je predlog prepoznave, še ni proizvodna mera (issue #8 §8).
          </p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

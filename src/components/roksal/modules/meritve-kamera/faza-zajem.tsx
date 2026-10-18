'use client'

// faza-zajem.tsx — FAZA 1: ZAJEM (fotografija + kakovost + vodila): izbor
// načina izmere, zmogljivosti naprave, živi predogled kamere (bliskavica,
// preklop, vodila, razumevanje prizora), nalaganje iz telefona, izbira
// obstoječe FOTO ter projekt/nalog/lokacija.
// R537-a: dobesedna selitev iz meritve-kamera.tsx — stanje je skupno (vstop)
// in pride prek propsov; `capture` je krajevni (živi le tu).

import { useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Camera, Cpu, Flashlight, FlashlightOff, Grid3x3, Image as ImageIcon, Ruler, SwitchCamera, ZoomIn } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ErrorBox } from '@/components/roksal/ui-bits'
import { fmtDate, useApi } from '@/lib/api-client'
import { napisZmogljivosti, type SmerKamere, type ZmogljivostiKamere } from '@/lib/camera-capabilities'
import { napisNastavitev, type KameraNastavitve } from '@/lib/camera-prefs'
import type { OrientationCheck } from '@/lib/exif-orientation'
import { MEASURE_MODES, MODE_RULES, recommendMethod, type DeviceCaps, type MeasureMode } from '@/lib/measure-engine'
import SceneOverlay from '@/components/roksal/scene-overlay'
import type { SceneUnderstandingState } from '@/hooks/use-scene-understanding'
import { parsePhoto } from './kakovost'
import { MAX_IMG_W, type CachedWoRow, type PhotoRow, type ProjectOption, type WorkOrderOption } from './tipi'
import { Vodila } from './vodila'

export interface FazaZajemProps {
  mode: MeasureMode
  setMode: Dispatch<SetStateAction<MeasureMode>>
  caps: DeviceCaps | null
  startCamera: (smer?: SmerKamere) => Promise<boolean>
  camActive: boolean
  fileRef: RefObject<HTMLInputElement | null>
  onFile: (f: File | undefined) => Promise<void>
  videoRef: RefObject<HTMLVideoElement | null>
  sceneState: SceneUnderstandingState
  guides: boolean
  setGuides: Dispatch<SetStateAction<boolean>>
  zmoKamere: ZmogljivostiKamere | null
  torchNa: boolean
  preklopiTorch: () => Promise<void>
  preklopiSmer: () => Promise<void>
  stopCamera: () => void
  nastavitve: KameraNastavitve
  /** R550: aktivna smer — za zrcaljenje predogleda pri sprednji kameri. */
  smerKamere: SmerKamere
  /** R550: potrjena vrednost zooma (null = naprava še ni potrdila / ni podprto). */
  zoomVrednost: number | null
  /** R550: drsnik približanja — tihi uspeh, napaka se pove. */
  nastaviZoomVrednost: (v: number) => Promise<void>
  /** R550: tap-to-focus na normalizirani točki (0..1). */
  ostrenjeNaTocki: (t: { x: number; y: number }) => Promise<void>
  existingPhotos: PhotoRow[]
  pickExisting: (p: PhotoRow) => void
  projects: ReturnType<typeof useApi<{ data: ProjectOption[] }>>
  projectId: string
  setProjectId: Dispatch<SetStateAction<string>>
  workOrderId: string
  setWorkOrderId: Dispatch<SetStateAction<string>>
  orderOptions: WorkOrderOption[] | CachedWoRow[]
  orders: ReturnType<typeof useApi<{ data: WorkOrderOption[] }>>
  online: boolean
  location: string
  setLocation: Dispatch<SetStateAction<string>>
  setOrientacija: Dispatch<SetStateAction<OrientationCheck | null>>
  acceptImage: (url: string) => Promise<void>
}

export function FazaZajem (props: FazaZajemProps) {
  const {
    mode, setMode, caps, startCamera, camActive, fileRef, onFile, videoRef, sceneState, guides, setGuides,
    zmoKamere, torchNa, preklopiTorch, preklopiSmer, stopCamera, nastavitve, existingPhotos, pickExisting,
    smerKamere, zoomVrednost, nastaviZoomVrednost, ostrenjeNaTocki,
    projects, projectId, setProjectId, workOrderId, setWorkOrderId, orderOptions, orders, online,
    location, setLocation, setOrientacija, acceptImage,
  } = props

  // R550: shutter odziv — beli blisk (180 ms) + najboljša-zmožnost vibracija.
  // Oba sta tiho brezpogojna: če ju brskalnik/naprava ne ponuja, nič ne manjka.
  const [blisk, setBlisk] = useState(false)
  // R550: prehodni obroč na točki tap-to-focus (izgine po 700 ms).
  const [fokusTocka, setFokusTocka] = useState<{ x: number; y: number } | null>(null)

  function capture (): void {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    // R550: shutter odziv NAVORIJ (ob obema ročajema) — standard najboljših
    // implementacij: hvaležna potrditev, da se je zajem ZGODIL.
    setBlisk(true)
    window.setTimeout(() => setBlisk(false), 180)
    try { navigator.vibrate?.(25) } catch { /* najboljša zmožnost — tiho */ }
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, MAX_IMG_W / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/jpeg', 0.85)
    stopCamera()
    // Živi zajem nima EXIF kodeka (canvas slika je že v prikaznem prostoru) —
    // poštenje zahteva, da prejšnji dokaz o datoteki ne preživi v novem kadru.
    // R550: slika je NE-ZRCALJENA (canvas riše surov okvir) — enako kot
    // nativni aplikaciji kamero: predogled je zrcaljen, zajem pa ostane
    // fizično pravilen, zato kalibracija/meritve niso obračene.
    setOrientacija(null)
    void acceptImage(url)
  }

  /** R550: tap-to-focus — normalizirana točka v okviru videa + prehodni obroč. */
  function naTapPredogled (e: React.MouseEvent<HTMLVideoElement>): void {
    if (zmoKamere?.fokus !== 'PODPRTO') return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    setFokusTocka({ x, y })
    window.setTimeout(() => setFokusTocka(null), 700)
    void ostrenjeNaTocki({ x, y })
  }

  return (
        <div className="space-y-4">
          {/* R457 (§2): adaptivni način izmere — izbor PRED zajemom */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Ruler className="size-4 text-roksal-amber" aria-hidden /> Način izmere</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Način izmere">
              {MEASURE_MODES.map((m) => (
                <button
                  key={m} type="button" role="radio" aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-lg border p-2 text-left text-xs transition ${mode === m ? 'border-roksal-amber bg-amber-50 font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'text-muted-foreground hover:border-foreground/30'}`}
                >
                  <span className="block">{MODE_RULES[m].label}</span>
                  <span className="mt-0.5 block text-[10px] font-normal opacity-80">{MODE_RULES[m].desc}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">💡 {MODE_RULES[mode].hint}</p>
          </div>

          {/* R457 (§16/§18): zmogljivosti naprave + priporočena metoda */}
          {caps ? (
            <Card>
              <CardContent className="space-y-1.5 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Cpu className="size-4 text-roksal-amber" aria-hidden /> Naprava in priporočena metoda</p>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <Badge variant={caps.camera ? 'secondary' : 'destructive'}>kamera {caps.camera ? '✓' : '✗'}</Badge>
                  <Badge variant={caps.orientation ? 'secondary' : 'outline'}>žiroskop {caps.orientation ? '✓' : '—'}</Badge>
                  <Badge variant={caps.gps ? 'secondary' : 'outline'}>GPS {caps.gps ? '✓' : '—'}</Badge>
                  <Badge variant={caps.webgl ? 'secondary' : 'outline'}>WebGL {caps.webgl ? '✓' : '—'}</Badge>
                  <Badge variant={caps.network ? 'secondary' : 'outline'}>{caps.network ? 'povezava ✓' : 'brez povezave'}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Priporočena metoda: <strong className="text-foreground">{recommendMethod(caps).label}</strong> — {recommendMethod(caps).reason}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Button size="lg" className="h-12" onClick={() => void startCamera()} disabled={camActive}>
              <Camera className="size-5" aria-hidden /> Zajemi s kamero
            </Button>
            <Button size="lg" variant="outline" className="h-12" onClick={() => fileRef.current?.click()}>
              <ImageIcon className="size-5" aria-hidden /> Naloži iz telefona
            </Button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Izberi fotografijo" />
          </div>

          {camActive ? (
            <div className="space-y-2 overflow-hidden rounded-lg border bg-black">
              <div className="relative">
                {/* R550: predogled sprednje kamere je ZRCALJEN (standard nativnih
                    aplikacij — tako monter vidi sebe, kot v ogledalu); zajem
                    ostaja ne-zrcaljen (capture riše surov okvir), zato so točke
                    in kalibracija fizično pravilne. */}
                <video ref={videoRef} autoPlay playsInline muted
                  onClick={naTapPredogled}
                  className={`max-h-[360px] w-full object-contain ${smerKamere === 'user' ? '-scale-x-100' : ''} ${zmoKamere?.fokus === 'PODPRTO' ? 'cursor-crosshair' : ''}`}
                  aria-label="Predogled kamere" />
                {/* R550: shutter blisk — 180 ms bela zavesa; potrditev zajema. */}
                {blisk ? <div className="pointer-events-none absolute inset-0 z-20 bg-white/90" aria-hidden /> : null}
                {/* R550: prehodni obroč točke ostrenja (700 ms). */}
                {fokusTocka ? (
                  <div className="pointer-events-none absolute z-10 size-16 -translate-x-8 -translate-y-8 rounded-full border-2 border-white/90 shadow-[0_0_0_2px_rgba(0,0,0,0.35)]"
                    style={{ left: `${Math.round(fokusTocka.x * 100)}%`, top: `${Math.round(fokusTocka.y * 100)}%` }} aria-hidden />
                ) : null}
                {/* R467 (issue #8 F1): žive zaznave prizora (tla, ovire, struktura) —
                    čist pogled, 2–4 oznake, tap za podatek; nikoli ne blokira zajema */}
                {sceneState.elements.length > 0 ? (
                  <SceneOverlay
                    elements={sceneState.elements}
                    quality={sceneState.quality}
                  />
                ) : null}
                {/* R455: vodila za vodenje zajema (§4) — mreža + vodoravnica + središče */}
                {guides ? <Vodila /> : null}
              </div>
              {/* R550: drsnik približanja — VIDEN SAMO, kadar je razpon potrjen
                  (getCapabilities().zoom); vrednost je prikaz kot mnogokratnik
                  najmanjšega približanja (enako nativnim aplikacijam kamere). */}
              {zmoKamere?.zoom.stanje === 'PODPRTO' ? (
                <div className="flex items-center gap-2 px-2 pt-1">
                  <ZoomIn className="size-4 shrink-0 text-white/80" aria-hidden />
                  <input
                    type="range"
                    className="h-1.5 flex-1 accent-white"
                    min={zmoKamere.zoom.min}
                    max={zmoKamere.zoom.max}
                    step={zmoKamere.zoom.step}
                    value={zoomVrednost ?? zmoKamere.zoom.min}
                    onChange={(e) => { void nastaviZoomVrednost(Number(e.target.value)) }}
                    aria-label="Približanje kamere"
                  />
                  <span className="w-10 shrink-0 text-right text-[11px] font-medium tabular-nums text-white/80">
                    {((zoomVrednost ?? zmoKamere.zoom.min) / zmoKamere.zoom.min).toFixed(1)}×
                  </span>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 p-2">
                <Button className="flex-1" onClick={capture}><Camera className="size-4" aria-hidden /> Zajemi</Button>
                {/* R508 (issue #7 §4A): bliskavica in preklop kamer — gumb je viden
                    SAMO, če naprava zmožnost POTRDI; sicer je napis pošten
                    (»ni podprto / ni dokaza«), ne pa lažno aktiven gumb. */}
                {zmoKamere?.torch === 'PODPRTO' ? (
                  <Button variant={torchNa ? 'default' : 'outline'} onClick={() => void preklopiTorch()} aria-pressed={torchNa}>
                    {torchNa ? <FlashlightOff className="size-4" aria-hidden /> : <Flashlight className="size-4" aria-hidden />}
                    Bliskavica {torchNa ? 'izklop' : 'vklop'}
                  </Button>
                ) : null}
                {zmoKamere?.preklop === 'PODPRTO' ? (
                  <Button variant="outline" onClick={() => void preklopiSmer()}>
                    <SwitchCamera className="size-4" aria-hidden /> Preklopi kamero
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => setGuides((g) => !g)} aria-pressed={guides}>
                  <Grid3x3 className="size-4" aria-hidden /> Vodila {guides ? 'vklop' : 'izklop'}
                </Button>
                <Button variant="outline" onClick={stopCamera}>Prekliči</Button>
              </div>
              {zmoKamere ? (
                <p className="px-2 pb-2 text-[11px] text-muted-foreground">
                  Naprava: {napisZmogljivosti(zmoKamere)}
                </p>
              ) : null}
              {/* R509 (issue #7 §9): opomba o spominu — svetilke iz spomina ne
                  prižgemo sami; monter jo mora prižgati. */}
              <p className="px-2 pb-2 text-[11px] text-muted-foreground">{napisNastavitev(nastavitve, torchNa)}</p>
            </div>
          ) : null}

          {existingPhotos.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Ali izberite obstoječo fotografijo:</p>
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="list">
                {existingPhotos.map((p) => (
                  <button key={p.id} type="button" onClick={() => pickExisting(p)} className="group overflow-hidden rounded-lg border text-left transition hover:border-roksal-amber" role="listitem">
                    <img src={parsePhoto(p.params) ?? ''} alt={`Fotografija ${p.location ?? 'brez lokacije'}`} className="h-20 w-full object-cover" />
                    <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground group-hover:text-foreground">
                      {p.location ?? p.project?.code ?? fmtDate(p.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Projekt (za shranjevanje)</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger aria-label="Povezava na projekt"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  <SelectItem value="none">Brez projekta</SelectItem>
                  {(projects.data?.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>)}
                </SelectContent>
              </Select>
              <ErrorBox error={projects.error} />
            </div>
            <div className="space-y-2">
              <Label>Nalog</Label>
              <Select value={workOrderId} onValueChange={setWorkOrderId}>
                <SelectTrigger aria-label="Povezava na nalog"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-48">
                  <SelectItem value="none">Brez naloga</SelectItem>
                  {/* R439: offline → predpomnjeni nalogi iz IndexedDB */}
                  {orderOptions.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.title}</SelectItem>)}
                </SelectContent>
              </Select>
              {!online && orderOptions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Brez povezave in brez predpomnjenih nalogov — nalog izberite, ko bo signal nazaj.</p>
              ) : null}
              <ErrorBox error={online ? orders.error : null} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="km-location">Lokacija merjenja</Label>
            <Input id="km-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="npr. Stopnišče — vhod" />
          </div>
        </div>
  )
}

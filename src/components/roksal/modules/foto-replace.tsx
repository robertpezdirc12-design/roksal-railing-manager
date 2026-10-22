'use client'

// FOTO VIZUALIZACIJA (REALISTIC PHOTO REPLACEMENT) — R459 (GitLab issue #14)
// Fotorealistična menjava obstoječe ograje na ORIGINALNI fotografiji:
//   PROJEKT → FOTOGRAFIJA → OZNAČI OGRAJO + REFERENCA → IZDELEK/KONFIGURACIJA
//   → PREJ/POTEM (slider, ghost, variante A/B/C) → SHRANI/IZVOZ/PDF/KONFIGURATOR.
//
// Načela (issue #14):
//  - §1  original ostane vir slike — riše se SAMO območje ograje;
//  - §2  videz izključno iz ROKSAL kataloga (izdelek + varianta/RAL + lamele);
//  - §6  geometrija iz konfiguracije/meritve — vizualizacija NI proizvodna mera;
//  - §7  PREJ/POTEM slider + ghost + A/B/C + shranjevanje vsake variante;
//  - §10 BREZ runtime AI — deterministična perspektivna projekcija (fallback,
//         ki deluje na vsaki napravi brez LiDAR);
//  - §15 žig VIZUALIZACIJA ZA PREDSTAVITEV na zaslonu in izvozu.
// Engine: src/lib/photo-replace-core.ts (čist TS, strežnik validira ISTA pravila).
//
// R537-c: modul je razbit v podmapo ./foto-replace (tipi, stanje, oznacevanje,
// izdelek-izbor, primerjava, izvoz) — ČISTA selitev brez sprememb obnašanja:
// vrstni red hookov, logika semena (R536-c) in vsi izrazi ostajajo identični.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, Check, Eye, FolderKanban, ImageIcon, Loader2, Package, Pencil, Sparkles, TriangleAlert, Upload } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { useToast } from '@/hooks/use-toast'
import { haptic } from '@/lib/haptics'
import { useSwipe, useLongPress } from '@/lib/use-swipe'
import { useAppStore } from '@/lib/store'
import { apiGet, apiPatch, apiPost, fmtDate } from '@/lib/api-client'
import { hasPerm } from '@/lib/permissions-core'
// R480 (issue #9 §10): javna povezava vizualizatorja + zgodovina izborov stranke
import { VizLinksPanel } from '@/components/roksal/modules/foto-replace-links'
import { VIZ_ZIG, generirajRazpored, type Opozorilo } from '@/lib/photo-replace-core'
import { cn } from '@/lib/utils'
import { prazenSlot, slotIzZapisa, toNum, useFotoPodatki, useSlotParams } from './foto-replace/stanje'
import { Oznacevanje, useOznacevanje, useSloji } from './foto-replace/oznacevanje'
import { IzdelekIzbor, useGradivo } from './foto-replace/izdelek-izbor'
import { PotemPrimerjava, useDrawPotem, usePrimerjava } from './foto-replace/primerjava'
import { izvoziFormat, izvoziPdfDokument, renderJpegDataUrl, naloziDatoteko as naloziDatotekoAkcija, uporabiProjektno as uporabiProjektnoAkcija } from './foto-replace/izvoz'
import { VARIANT_LABELS, type DokazVeriga, type MaskaVrsta, type OdpriZapis, type ParsedRenderParams, type SlotState, type VariantLabel } from './foto-replace/tipi'
import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'

// ─── Koraki ──────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'projekt', label: 'Projekt', icon: FolderKanban },
  { key: 'foto', label: 'Fotografija', icon: Camera },
  { key: 'oznaci', label: 'Označi območje', icon: Pencil },
  { key: 'izdelek', label: 'Izdelek', icon: Package },
  { key: 'potem', label: 'PREJ / POTEM', icon: Eye },
] as const

const STEP_HINTS = [
  'Vizualizacija je vedno vezana na projekt in stranko.',
  'Posnamite ali izberite ORIGINALNO fotografijo objekta — ostane osnova slike.',
  'Označite 4 vogale obstoječe ograje in podajte referenčno merilo.',
  'Izberite dejanski ROKSAL izdelek, barvo/RAL in parametre polnila.',
  'Primerjajte PREJ/POTEM, ustvarite variante A/B/C in izvozite dokumentacijo.',
]

// ─── Modul ───────────────────────────────────────────────────────────────────

export default function FotoReplaceModule () {
  const user = useAppStore((s) => s.user)
  const token = useAppStore((s) => s.token)
  const setTab = useAppStore((s) => s.setTab)
  const setPhotoVizId = useAppStore((s) => s.setPhotoVizId)
  const { toast } = useToast()

  const canWrite = hasPerm(user?.perms, 'measurements.write')

  const [step, setStep] = useState(0)
  const [projectId, setProjectId] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState('')
  const [photoImg, setPhotoImg] = useState<HTMLImageElement | null>(null)
  const [photoW, setPhotoW] = useState(0)
  const [photoH, setPhotoH] = useState(0)
  // R510: dokaz, ki ga je vrnil strežnik ob zadnjem shranjevanju/odpiranju
  const [dokaz, setDokaz] = useState<DokazVeriga | null>(null)

  const [active, setActive] = useState<VariantLabel>('A')
  const [slots, setSlots] = useState<Record<VariantLabel, SlotState>>({ A: prazenSlot(), B: prazenSlot(), C: prazenSlot() })
  const slot = slots[active]
  const variantOrder: VariantLabel[] = ["A", "B", "C"]
  const swipe = useSwipe({
    onSwipeLeft: () => { const idx = variantOrder.indexOf(active); if (idx < variantOrder.length - 1) preklopiVarianto(variantOrder[idx + 1]) },
    onSwipeRight: () => { const idx = variantOrder.indexOf(active); if (idx > 0) preklopiVarianto(variantOrder[idx - 1]) },
  })
  const longPress = useLongPress(() => { haptic('medium'); toast({ title: 'Varianta ' + active, description: 'Dolgi pritisk — kontekstni meni za varianto ' + active }) }, 500)
  const updateSlot = useCallback((fn: (s: SlotState) => SlotState): void => {
    setSlots((prev) => ({ ...prev, [active]: fn(prev[active]) }))
  }, [active])

  const [comparePos, setComparePos] = useState(50)
  const [ghost, setGhost] = useState(false)
  const [ghostOpacity, setGhostOpacity] = useState(55)
  const [prekrij, setPrekrij] = useState(true)

  const [busy, setBusy] = useState(false)
  /** Opozorila, ki jih je vrnil POGANJALNIK pri zadnjem izrisu (renitveni dokaz). */
  const [renderWarnings, setRenderWarnings] = useState<Opozorilo[]>([])
  const [saveBusy, setSaveBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState<'png' | 'primerjava' | 'pdf' | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  const editRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const compareRef = useRef<HTMLCanvasElement | null>(null)
  const dragIdx = useRef<number | null>(null)
  const dragMask = useRef<{ vrsta: MaskaVrsta; oblika: number; tocka: number } | null>(null)

  // ── podatki / parametri / sloji / gradivo — hooki iz ./foto-replace/* so
  //    selitve NEPREKINJENIH nizov hookov (vrstni red klicev enak izvirniku) ──
  const {
    projects, measurements, savedList, project, ograjaProducts, product, variant,
    refMeasurements, fotoMeasurements, linkedMeasurement, setSavedVersion,
  } = useFotoPodatki(projectId, slot)

  // ── referenčna mera ──
  const refCm = slot.refTip === 'MERITEV'
    ? (linkedMeasurement?.lengthCm ?? 0)
    : toNum(slot.refCmS, 0, 20, 20000)

  const { jePovrsina, maxVisina, maskaUreja, setMaskaUreja, maskaStanje, params, barva, material, vsaOpozorila } =
    useSlotParams({ slot, refCm, product, variant, linkedMeasurement, photoW, photoH, renderWarnings })

  const sloji = useSloji({ photoImg, photoW, photoH, maskaStanje })
  const { izbiraGradiva, tekstura } = useGradivo({ slot, product, variant })

  // ── nalaganje fotografije ──
  useEffect(() => {
    if (!photo) { setPhotoImg(null); setPhotoW(0); setPhotoH(0); return }
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (alive) { setPhotoImg(img); setPhotoW(img.naturalWidth); setPhotoH(img.naturalHeight) }
    }
    img.onerror = () => { if (alive) toast({ title: 'Fotografije ni bilo mogoče naložiti.', variant: 'destructive' }) }
    img.src = photo
    return () => { alive = false }
  }, [photo, toast])

  const { drawPotem, zapisiOpozorila } =
    useDrawPotem({ photoImg, tekstura, prekrij, sloji, barva, material, setRenderWarnings })
  const { editDown, editMove, editUp, razveljaviTocko } =
    useOznacevanje({ editRef, dragIdx, dragMask, photoImg, photoW, photoH, step, slot, maskaUreja, refCm, updateSlot, toast })
  usePrimerjava({ step, params, photoImg, photoW, photoH, drawPotem, zapisiOpozorila, ghost, ghostOpacity, comparePos, slot, active, previewRef, compareRef })

  // ── izbira projekta ──
  function izberiProjekt (id: string): void {
    setProjectId(id)
    // ponastavi delovne variante ob novem projektu
    setSlots({ A: prazenSlot(), B: prazenSlot(), C: prazenSlot() })
    setDokaz(null)
    setActive('A')
    setSavedVersion((v) => v + 1)
  }

  // ── menjava zavihka variante: shrani trenutno, naloži ciljno ──
  function preklopiVarianto (label: VariantLabel): void {
    if (label === active) return
    setActive(label)
  }

  // ── izris/izvoz/priprava fotografije prek pomožnikov v ./foto-replace/izvoz
  //    (kontekst sestavimo iz trenutnega stanja — obnašanje enako notranjim
  //    funkcijam izvirnika) ──
  const renderJpeg = (maxPx: number, zig: boolean, meja?: number): Promise<string> =>
    renderJpegDataUrl({ photoImg, params, photoW, photoH, slot, active, drawPotem }, maxPx, zig, meja)
  const izvozi = (format: 'png' | 'primerjava'): Promise<void> =>
    izvoziFormat({ photoImg, params, photoW, photoH, comparePos, slot, active, project, drawPotem, setExportBusy, setSavedVersion, toast }, format)
  const izvoziPdf = (): Promise<void> =>
    izvoziPdfDokument({ slot, active, project, token, toast, setExportBusy })
  const naloziDatoteko = (file: File | undefined): Promise<void> =>
    naloziDatotekoAkcija({ toast, setBusy, setPhoto, setPhotoName, setSlots, setDokaz }, file)
  const uporabiProjektno = (mid: string): Promise<void> =>
    uporabiProjektnoAkcija({ fotoMeasurements, toast, setBusy, setPhoto, setPhotoName, setSlots }, mid)

  // ── shranjevanje variante ──
  async function shrani (): Promise<void> {
    if (!projectId || !photo || !params || !product) return
    setSaveBusy(true)
    // R510: odjemalec sme TRDITI samo identifikator gradiva; pot in SHA-256
    // potrdi strežnik. Brez preverjenega gradiva trditve ne pošiljamo.
    const trdnja = izbiraGradiva?.smeUporabiti && izbiraGradiva.gradivo
      ? { assetId: izbiraGradiva.gradivo.id }
      : undefined
    try {
      const rendered = await renderJpeg(1280, true)
      if (slot.savedId) {
        // posodobitev → NOVA VERZIJA (§12: nikoli tiho prepisano)
        const res = await apiPatch<{ data: { dokaz?: DokazVeriga | null } }>(`/api/photo-visualization/${slot.savedId}`, {
          renderParams: params,
          rendered,
          note: slot.note || null,
          productId: product.id,
          variantId: slot.variantId || null,
          sourcePhotoId: slot.photoSourceId,
          ...(trdnja ? { gradivo: trdnja } : {}),
          versionNote: 'Posodobitev iz zavihka Foto vizualizacija',
        })
        setDokaz(res.data?.dokaz ?? null)
        toast({ title: `Varianta ${active} posodobljena — nova verzija posnetka.`, description: `${product.name}${variant ? ` · ${variant.name}` : ''}` })
      } else {
        const res = await apiPost<{ data: { id: string; variantLabel: string; dokaz?: DokazVeriga | null } }>('/api/photo-visualization', {
          projectId,
          variantLabel: active,
          sourcePhoto: photo,
          rendered,
          sourcePhotoId: slot.photoSourceId,
          measurementId: slot.measurementId || null,
          productId: product.id,
          variantId: slot.variantId || null,
          renderParams: params,
          note: slot.note || null,
          ...(trdnja ? { gradivo: trdnja } : {}),
        })
        updateSlot((s) => ({ ...s, savedId: res.data.id }))
        setDokaz(res.data?.dokaz ?? null)
        toast({ title: `Varianta ${active} shranjena na projekt.`, description: `${product.name}${variant ? ` · ${variant.name}` : ''} — verzija v1.` })
      }
      setSavedVersion((v) => v + 1)
    } catch (e) {
      toast({ title: 'Shranjevanje ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaveBusy(false)
    }
  }

  // ── izbira / arhiviranje shranjene variante ──
  async function nastaviStatus (id: string, status: 'IZBRANA' | 'ARHIV'): Promise<void> {
    setRowBusy(id)
    try {
      await apiPatch(`/api/photo-visualization/${id}`, { status })
      setSavedVersion((v) => v + 1)
      toast({ title: status === 'IZBRANA' ? 'Varianta izbrana za projekt.' : 'Varianta arhivirana.' })
    } catch (e) {
      toast({ title: 'Sprememba statusa ni uspela.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setRowBusy(null)
    }
  }

  // ── odpiranje shranjene variante v urejevalnik ──
  async function odpri (id: string): Promise<void> {
    setRowBusy(id)
    try {
      const res = await apiGet<{ data: OdpriZapis }>(`/api/photo-visualization/${id}`)
      const d = res.data
      let rp: ParsedRenderParams = {}
      // R542: renderParams je jsonb objekt — API vrača razčlenjenega (brez JSON.parse)
      if (d.renderParams && typeof d.renderParams === 'object' && !Array.isArray(d.renderParams)) rp = d.renderParams as ParsedRenderParams
      const label = (VARIANT_LABELS as readonly string[]).includes(d.variantLabel) ? (d.variantLabel as VariantLabel) : 'A'
      setPhoto(d.sourcePhoto)
      setPhotoName('shranjena fotografija')
      // R510: izvirnik in dokaz se vrneta iz baze — sicer bi urejanje shranjene
      // variante znova poslalo prazen izvirnik in zabrisalo verigo.
      setDokaz(d.dokaz ?? null)
      // gradnjo stanja slotu (vključno z R536 semenom) opravi slotIzZapisa
      const nov = slotIzZapisa(d, rp)
      setSlots((prev) => ({ ...prev, [label]: nov }))
      setActive(label)
      setStep(d.status === 'ARHIV' ? 3 : 3) // odpremo na izdelku/predogledu
      toast({ title: `Varianta ${label} odprta za urejanje.`, description: `${d.product.name} · status ${d.status === 'IZBRANA' ? 'IZBRANA' : d.status}` })
    } catch (e) {
      toast({ title: 'Odpiranje ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setRowBusy(null)
    }
  }

  // ── prenos v konfigurator (brez ponovnega vnosa, §14) ──
  function vKonfigurator (): void {
    if (!slot.savedId) {
      toast({ title: 'Najprej shranite varianto.', description: 'Konfigurator prevzame shranjeno konfiguracijo s povezavami.' })
      return
    }
    setPhotoVizId(slot.savedId)
    setTab('konfigurator')
  }

  // ── validacija korakov ──
  function korakOk (i: number): { ok: boolean; reason?: string } {
    switch (STEPS[i].key) {
      case 'projekt': return projectId ? { ok: true } : { ok: false, reason: 'Izberite projekt.' }
      case 'foto': return photo ? { ok: true } : { ok: false, reason: 'Naložite fotografijo objekta.' }
      case 'oznaci':
        if (slot.quad.length !== 4) return { ok: false, reason: 'Označite vse 4 vogale obstoječe ograje.' }
        if (refCm < 20) return { ok: false, reason: 'Podajte referenčno merilo (meritev ali znano dolžino).' }
        return { ok: true }
      case 'izdelek': return product ? { ok: true } : { ok: false, reason: 'Izberite ROKSAL izdelek.' }
      default: return { ok: true }
    }
  }

  const razporedInfo = useMemo(() => (params ? generirajRazpored(params.config) : null), [params])
  const savedRows = savedList.data?.data ?? []

  // ═══ RENDER ═══

  return (
    <div className="space-y-4" data-tour="foto-replace-module">
      <PageHeader
        title="Foto vizualizacija"
        desc="Fotorealistična menjava obstoječe ograje na originalni fotografiji (R459)"
      />

      {/* §15: jasna ločitev vizualizacija / proizvodna mera */}
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-xs leading-relaxed sm:text-sm">
          <span className="font-semibold">{VIZ_ZIG} — ni dokaz proizvodne točnosti.</span>{' '}
          Potrjene proizvodne mere izhajajo izključno iz merilnega in konfiguracijskega poteka.
        </p>
      </div>

      {/* stepper */}
      <nav aria-label="Koraki foto-vizualizacije" className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm">
        {STEPS.map((s, i) => {
          const done = korakOk(i).ok && i < step
          const current = i === step
          const Icon = s.icon
          return (
            <span key={s.key} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { if (i <= step || korakOk(step).ok) setStep(i) }}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors',
                  current ? 'border-primary bg-primary text-primary-foreground' :
                    done ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                      'border-border text-muted-foreground hover:border-foreground/30'
                )}
                aria-current={current ? 'step' : undefined}
                title={`${s.label}${done ? ' — opravljeno' : current ? ' — trenutni korak' : ''}`}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
                <span className="font-medium">{s.label}</span>
              </button>
              {i < STEPS.length - 1 ? <span aria-hidden className="text-muted-foreground/50">›</span> : null}
            </span>
          )
        })}
      </nav>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <p className="mb-4 text-xs text-muted-foreground">{STEP_HINTS[step]}</p>

          {/* ── 1. PROJEKT ── */}
          {STEPS[step].key === 'projekt' ? (
            projects.loading ? <LoadingRows rows={3} /> : projects.error ? <ErrorBox error={projects.error} /> : (
              <div className="space-y-2">
                {(projects.data?.data ?? []).length === 0 ? (
                  <EmptyState title="Ni projektov" desc="Ustvarite projekt v zavihku Projekti." icon={FolderKanban} />
                ) : (
                  <AnimatedList className="max-h-96 space-y-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                    {(projects.data?.data ?? []).map((p) => (
                      <AnimatedListItem key={p.id}>
                        <button
                          type="button"
                          onClick={() => izberiProjekt(p.id)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/50',
                            projectId === p.id && 'border-primary bg-primary/5'
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{p.code} — {p.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {p.customer ? `${p.customer.name}${p.customer.city ? `, ${p.customer.city}` : ''}` : 'brez stranke'} · {p.status}
                            </span>
                          </span>
                          {projectId === p.id ? <Badge>Izbrano</Badge> : null}
                        </button>
                      </AnimatedListItem>
                    ))}
                  </AnimatedList>
                )}
              </div>
            )
          ) : null}

          {/* ── 2. FOTOGRAFIJA ── */}
          {STEPS[step].key === 'foto' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 rounded-lg border border-dashed p-4">
                  <Label htmlFor="foto-upload" className="flex items-center gap-1.5 text-sm font-semibold">
                    <Upload className="size-4 text-roksal-amber" aria-hidden /> Naloži fotografijo
                  </Label>
                  <p className="text-xs text-muted-foreground">Posnetek obstoječega stanja (JPEG, max 1600 px). Original ostane vir slike.</p>
                  <Input
                    id="foto-upload" type="file" accept="image/*" className="h-11"
                    onChange={(e) => { void naloziDatoteko(e.target.files?.[0]) }}
                  />
                  {busy ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Priprava slike …</p> : null}
                </div>
                <div className="space-y-2 rounded-lg border border-dashed p-4">
                  <p className="flex items-center gap-1.5 text-sm font-semibold"><ImageIcon className="size-4 text-roksal-amber" aria-hidden /> Projektna fotografija</p>
                  <p className="text-xs text-muted-foreground">Prevzemite fotografijo, ki je že shranjena kot foto-dokaz tega projekta.</p>
                  {measurements.loading ? <LoadingRows rows={2} /> : fotoMeasurements.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Ta projekt še nima foto-dokazov.</p>
                  ) : (
                    <AnimatedList className="max-h-40 space-y-1.5 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                      {fotoMeasurements.map(({ m }) => (
                        <AnimatedListItem key={m.id}>
                          <Button
                            type="button" variant="outline" size="sm" className="h-10 w-full justify-start"
                            disabled={busy} onClick={() => { void uporabiProjektno(m.id) }}
                          >
                            <Camera className="size-4 shrink-0" aria-hidden />
                            <span className="truncate">{m.location || 'foto-dokaz'} · {fmtDate(m.createdAt)}</span>
                          </Button>
                        </AnimatedListItem>
                      ))}
                    </AnimatedList>
                  )}
                </div>
              </div>
              {photo ? (
                <figure className="space-y-1.5" onTouchStart={(e) => { swipe.onTouchStart(e); longPress.onTouchStart() }} onTouchEnd={(e) => { swipe.onTouchEnd(e); longPress.onTouchEnd() }} onTouchMove={longPress.onTouchMove} onMouseDown={longPress.onMouseDown} onMouseUp={longPress.onMouseUp} onMouseLeave={longPress.onMouseLeave}>
                  <img src={photo} alt="Originalna fotografija objekta" className="max-h-72 w-full rounded-lg border object-contain" />
                  <figcaption className="text-xs text-muted-foreground">Vir: {photoName || 'naložena fotografija'}</figcaption>
                </figure>
              ) : null}
            </div>
          ) : null}

          {/* ── 3. OZNAČITEV + REFERENCA ── (R537-c: UI v ./foto-replace/oznacevanje) */}
          {STEPS[step].key === 'oznaci' ? (
            <Oznacevanje slot={slot} editRef={editRef} editDown={editDown} editMove={editMove} editUp={editUp}
              updateSlot={updateSlot} refCm={refCm} linkedMeasurement={linkedMeasurement} maskaUreja={maskaUreja}
              setMaskaUreja={setMaskaUreja} razveljaviTocko={razveljaviTocko} maskaStanje={maskaStanje} sloji={sloji}
              izbiraGradiva={izbiraGradiva} product={product} dokaz={dokaz} refMeasurements={refMeasurements}
            />
          ) : null}

          {/* ── 4. IZDELEK + KONFIGURACIJA ── (R537-c: UI v ./foto-replace/izdelek-izbor) */}
          {STEPS[step].key === 'izdelek' ? (
            <IzdelekIzbor slot={slot} product={product} variant={variant} ograjaProducts={ograjaProducts}
              updateSlot={updateSlot} jePovrsina={jePovrsina} maxVisina={maxVisina} prekrij={prekrij} setPrekrij={setPrekrij}
              razporedInfo={razporedInfo} previewRef={previewRef} params={params}
            />
          ) : null}

          {/* ── 5. PREJ / POTEM + VARIANTE ── (R537-c: UI v ./foto-replace/primerjava) */}
          {STEPS[step].key === 'potem' ? (
            <PotemPrimerjava slots={slots} active={active} savedRows={savedRows} preklopiVarianto={preklopiVarianto}
              params={params} compareRef={compareRef} product={product} comparePos={comparePos} setComparePos={setComparePos}
              ghost={ghost} setGhost={setGhost} ghostOpacity={ghostOpacity} setGhostOpacity={setGhostOpacity}
              slot={slot} updateSlot={updateSlot} canWrite={canWrite} saveBusy={saveBusy} exportBusy={exportBusy}
              shrani={shrani} izvozi={izvozi} izvoziPdf={izvoziPdf} vKonfigurator={vKonfigurator}
              savedList={savedList} rowBusy={rowBusy} nastaviStatus={nastaviStatus} odpri={odpri}
            />
          ) : null}

          {/* opozorila kakovosti (§1) */}
          {vsaOpozorila.length > 0 && step >= 2 ? (
            <AnimatedList className="mt-4 space-y-1.5" aria-label="Opozorila kakovosti vizualizacije">
              {vsaOpozorila.map((w) => (
                <AnimatedListItem key={w.koda} className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{w.sporocilo}</span>
                </AnimatedListItem>
              ))}
            </AnimatedList>
          ) : null}

          {/* navigacija */}
          <div className="mt-5 flex items-center justify-between gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={() => { haptic("light"); setStep((s) => Math.max(0, s - 1)) }} disabled={step === 0}>
              <ArrowLeft className="size-4" aria-hidden /> Nazaj
            </Button>
            <p className="hidden text-xs text-muted-foreground sm:block">{project ? `${project.code} — ${project.title}` : ''}</p>
            {step < STEPS.length - 1 ? (
              <Button
                type="button" className="h-11"
                onClick={() => { if (korakOk(step).ok) { haptic("light"); setStep((s) => s + 1) } }}
                disabled={!korakOk(step).ok}
                title={korakOk(step).reason}
              >
                Naprej — {STEPS[step + 1].label} <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button type="button" variant="outline" className="h-11" onClick={() => setStep(0)}>
                <Sparkles className="size-4" aria-hidden /> Nova vizualizacija
              </Button>
            )}
          </div>
          {step < STEPS.length - 1 && !korakOk(step).ok ? (
            <p className="text-right text-xs text-muted-foreground">{korakOk(step).reason}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* R480 (§10): javna povezava vizualizatorja + zgodovina izborov stranke */}
      {projectId ? <VizLinksPanel projectId={projectId} projectCode={project?.code ?? null} /> : null}
    </div>
  )
}

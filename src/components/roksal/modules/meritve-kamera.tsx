'use client'

// MERITVE S KAMERO (issue #1) — večtočkovne meritve na fotografiji:
// zajem/nalaganje fotografije → označevanje točk → kalibracija merila →
// izračun dolžin/kotov/višin v živo → VLM samodejna zaznava → potrditev in
// shranjevanje v projekt/nalog (POST /api/measurement/confirm).
// Več meritev na isti fotografiji; ročni obrazec v meritve.tsx ostane fallback.
// R439 (issue #6): brez signala — gumb 'Shrani (offline)' v fazi potrditve
// (compressImage → photos shramba + op 'foto' z merilnimi podatki; izbor
// nalogov pade na predpomnjene vrstice).
//
// R455 (issue #10 — PROFESIONALNE KAMERNE MERITVE):
//   • 5-fazni profesionalni tok: ZAJEM → KALIBRACIJA → MERITEV → PREVERJANJE →
//     POTRDITEV (jasen status na vsakem koraku, §4);
//   • kakovost zajema: analiza svetlosti/ostrosti kadra (canvas) + opozorila
//     DOBRO/OPOZORILO (§2, §4);
//   • vodila v živem predogledu kamere (mreža + vodoravnica + središče, §4);
//   • vlečenje točk (premik) + povečevalno steklo za natančno postavitev (§1, §4);
//   • undo/redo celotnega urejanja (§4);
//   • zaklep kalibracije (§4);
//   • VLM predlogi točk so VIZUALNO LOČENI (PREDLOG) in ne štejejo v izračun,
//     dokler jih monter ne sprejme — avtomatika je predlog, ne avtoriteta (§1, §2);
//   • več pogledov (do 4 fotografije istega objekta) s primerjavo ocen,
//     povprečjem, razpršenostjo in stopnjo zaupanja (§3);
//   • ročni popravek dolžine z obveznim razlogom — sledljivost (§1);
//   • potrditev pošlje views/quality/confidence/manualOverride na strežnik,
//     ki ji zapiše v params + verzijo + revizijo (issue #10 §5–§7).
//
// R457 (issue #12 — VRHUNSKI MERILNI ENGINE):
//   • adaptivni načini izmere (§2): OGRAJA | KERAMIKA | STREHA | FASADA |
//     STOPNICE | PROSTOR | SPLOSNO — vsak s svojim vodilom in pravili;
//   • Smart Capture Guide (§3): ostrost/svetloba/nagib/referenca/pokritost —
//     DOBRO / OPOZORILO / NEZADOSTNO (faza kalibracije);
//   • profesionalna kalibracija (§4): 5 metod + referenčni objekt (meta v params);
//   • zmogljivosti naprave (§16) + priporočena metoda (§18 provider-agnostic);
//   • kanonična analiza engine-a v fazi PREVERJANJE (POST
//     /api/measure-engine/analyze): geometrija + §14 validacija + §13 confidence
//     + §8–§11 domenski paket (ograje/keramika/streha/fasada/stopnice/prostor);
//   • potrditev nosi mode + engine rezultat (params.mode/params.engine);
//   • izvoz CSV/JSON potrjene meritve (GET /api/measure-engine/export, §19).
//
// R537-a: ta datoteka je VSTOPNA (orkestracija skupnega stanja, preklop faz,
// sestava delov). Čisti pomožniki in faze živijo v ./meritve-kamera/:
// tipi, geometrija, kakovost, izvoz, use-kamera, use-undo-redo, y-ref-blok,
// vodila, povecalo, status, faza-zajem/kalibracija/meritev/preverjanje/
// potrditev. Stanje, ki si ga delijo faze, ostaja TUKAJ in se prenaša prek
// propsov (nobenih sprememb obnašanja — koda je seljena dobesedno).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, FileCode, FileJson, FileSpreadsheet } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { apiPost, useApi } from '@/lib/api-client'
import { getCachedNalogi, getOfflineState, stanjeShranjevanja, useOnline, type VrsticaShranjevanja } from '@/lib/offline'
import { clearDraft, loadSeje, saveDraft, sejaKljuc, splosciSejo, type MeasureDraft, type MeasureDraftSnapshot } from '@/lib/measure-draft'
import { MAX_DOK_SLIK, jeVeljavenDocTag, prostorZaDokSlike, type DocTag, type DokSlika } from '@/lib/measure-doc'
import { useAppStore } from '@/lib/store'
import {
  CALIB_METHODS, MEASURE_MODES, MODE_RULES, detectDeviceCaps,
  type AnalyzeResult, type CalibrationMethod, type DeviceCaps, type DomainOptions, type MeasureMode,
} from '@/lib/measure-engine'
import { checkOrientationFromBytes, type OrientationCheck } from '@/lib/exif-orientation'
import { nastaviVodila as nastaviVodilaPref, preberiNastavitve, shramba } from '@/lib/camera-prefs'
import { useSceneUnderstanding } from '@/hooks/use-scene-understanding'
import { CALC_PRAZEN, calcView } from './meritve-kamera/geometrija'
import { MAX_VIEWS, type CachedWoRow, type DragState, type LensState, type PhotoRow, type ProjectOption, type Pt, type View, type WorkOrderOption } from './meritve-kamera/tipi'
import { analyzeQuality, imageSize, parsePhoto, shrinkToDataUrl } from './meritve-kamera/kakovost'
import { useKamera } from './meritve-kamera/use-kamera'
import { useUndoRedo } from './meritve-kamera/use-undo-redo'
import { FazniStatus, PasicaOsnutek, StatusShranjevanja } from './meritve-kamera/status'
import { FazaZajem } from './meritve-kamera/faza-zajem'
import { FazaKalibracija } from './meritve-kamera/faza-kalibracija'
import { FazaMeritev } from './meritve-kamera/faza-meritev'
import { FazaPreverjanje } from './meritve-kamera/faza-preverjanje'
import { FazaPotrditev } from './meritve-kamera/faza-potrditev'
import { prenesiIzvoz } from './meritve-kamera/izvoz'

export function KameraMeritevDialog ({ open, onClose, onSaved, initialProjectId, initialWorkOrderId, autoResumeDraft }: {
  open: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
  /** R486 (issue #7 §3): predpolnjen kontekst iz naloga (ZAČNI MERITEV v DANES)
   *  — monter NE izbira projekta/naloga ročno (enostaven privzeti potek). */
  initialProjectId?: string
  initialWorkOrderId?: string
  /** R486: »Nadaljuj nedokončano« iz DANES — osnutek obnovi TAKOJ ob odprtju. */
  autoResumeDraft?: boolean
}) {
  const { toast } = useToast()

  // faza 1..5 (R455: ZAJEM → KALIBRACIJA → MERITEV → PREVERJANJE → POTRDITEV)
  const [phase, setPhase] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [busy, setBusy] = useState(false)
  const [projectId, setProjectId] = useState('none')
  const [workOrderId, setWorkOrderId] = useState('none')
  const [location, setLocation] = useState('')

  // ── kamera (R508/R509): zagon, smer, bliskavica, zmogljivosti, spomin ──
  const kamera = useKamera({ toast })
  const { camActive, videoRef, fileRef, torchNa, zmoKamere, nastavitve, smerKamere, zoomVrednost, nastaviZoomVrednost, ostrenjeNaTocki, resToka, naprave, trenutnaNaprava, preklopiNapravo, svetloba, startCamera, stopCamera, preklopiSmer, preklopiTorch } = kamera

  // ── R467 (issue #8 F1): živo razumevanje prizora med zajemom ──
  // R468 (F2 §3): trenutni nagib telefona (roll) za ločitev naklona telefona
  // od naklona tal — ref, da se percepcijska zanka NE restarta ob dogodku.
  const phoneRollRef = useRef<number | null>(null)
  const sceneState = useSceneUnderstanding(videoRef, camActive, {
    getPhoneRollDeg: () => phoneRollRef.current,
  })
  // R573: vodila si ZAPOMNIJO izbiro (vzorec R509 — nastavitve naprave so
  // lokalne, localStorage). Privzeto vklopljena (R455 §4), a monterjev izklop
  // preživi ponovni zagon kamere — kot Grid na najboljših kamerah (iPhone
  // Settings > Camera > Grid). SSR/bralnik brez shrambe → privzeto, brez trditve.
  const [guides, setGuides] = useState(() => preberiNastavitve(shramba()).vodila)
  /** R573: preklop vodil — stanje IN spomin v enem koraku (lastnik stanja). */
  function nastaviVodila (na: boolean): void {
    setGuides(na)
    nastaviVodilaPref(shramba(), na)
  }

  // R455: pogledi (fotografije istega objekta) + aktivni zavihek
  const [views, setViews] = useState<View[]>([])
  // R522 (issue #7 §4B): dokumentacijske slike detajlov — LOČENE od merilnih
  // pogledov. Pogled (max 4) je vir REKONSTRUKCIJE (točke + kalibracija);
  // detajl (max 30) je DOKAZ (vijak/nosilec/podlaga/ovira) brez mere.
  const [detajli, setDetajli] = useState<DokSlika[]>([])
  const [addingDok, setAddingDok] = useState(false)
  const [activeView, setActiveView] = useState(0)
  const viewKey = useRef(1)
  const dokKey = useRef(1)

  // R506 (issue #15 faza 4, H8): EXIF ugotovitev nazadnje naložene DOTOKE.
  // Ni merilni podatek in se ne shrani (viewForStorage dovoli samo
  // photoId/points/calibration) — je pa dokaz, ki ga mora monter VIDETI, kadar
  // obrata ni mogoče potrditi. Pri živem zajemu in pri izbiri obstoječe FOTO je
  // stanje null: pikselni prostor tu že določi canvas, ne EXIF kodeksa.
  const [orientacija, setOrientacija] = useState<OrientationCheck | null>(null)

  const [calibA, setCalibA] = useState<number | null>(null) // indeks prve točke kalibracije
  const [calibCm, setCalibCm] = useState('')
  // R513 (issue #15 faza 1): dimenziji perspektivne ravnine (metoda RAVNINA)
  const [planeW, setPlaneW] = useState('')
  const [planeH, setPlaneH] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [stairMode, setStairMode] = useState(false)
  const [serverLayout, setServerLayout] = useState<string | null>(null)

  // ── R457 (issue #12): način izmere, kalibracijska metoda, engine analiza ──
  const [mode, setMode] = useState<MeasureMode>('OGRAJA')
  const [calibMethod, setCalibMethod] = useState<CalibrationMethod>('MARKER')
  const [refObject, setRefObject] = useState('')
  const [caps, setCaps] = useState<DeviceCaps | null>(null)
  const [vrsticaShranjevanja, setVrsticaShranjevanja] = useState<VrsticaShranjevanja | null>(null)
  const [maxTilt, setMaxTilt] = useState<number | null>(null)
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  // domenske možnosti (§8–§11)
  // R506 (issue #15 faza 4): polja se začnejo PRAZNA. Predpolnjen 120/60/3/35
  // je engine videl kot »vpisano«, zato je bila številka na zaslonu videti kot
  // izmerjena, čeprav je monter ni nikoli vnesel. Pravila ostanejo v jedru —
  // tu so samo placeholderji, ki povedo, kaj bo predpostavljeno.
  const [maxSpanS, setMaxSpanS] = useState('')
  const [tileW, setTileW] = useState('')
  const [tileH, setTileH] = useState('')
  const [jointMm, setJointMm] = useState('')
  const [pattern, setPattern] = useState<'PRAVOKOTNO' | 'DIAGONALNO'>('PRAVOKOTNO')
  const [pitchDeg, setPitchDeg] = useState('')
  const [roofMaterial, setRoofMaterial] = useState<'BETONNA' | 'KOVINSKA'>('BETONNA')
  const [stepsS, setStepsS] = useState('')
  const [opW, setOpW] = useState('')
  const [opH, setOpH] = useState('')
  const [opCount, setOpCount] = useState('')

  // faza 5: potrditev + R455 ročni popravek
  const [type, setType] = useState('OGRAJA')
  const [heightS, setHeightS] = useState('')
  const [note, setNote] = useState('')
  const [overrideOn, setOverrideOn] = useState(false)
  const [overrideLen, setOverrideLen] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  // R487 (issue #3): panel dodajanja pogleda — terenska pot (kamera/datoteka)
  // OSTANE, poleg nje pa izbira obstoječe FOTO projekta (kot za 1. pogled)
  const [addingView, setAddingView] = useState(false)

  const fileViewRef = useRef<HTMLInputElement>(null)
  const fileDokRef = useRef<HTMLInputElement>(null)

  // R455: referenca na vlečenje — vključuje stanje pred vlečenjem (undo)
  const dragRef = useRef<DragState | null>(null)
  const [lens, setLens] = useState<LensState | null>(null)
  const imgBoxRef = useRef<HTMLDivElement>(null)

  const projects = useApi<{ data: ProjectOption[] }>(open ? '/api/projects' : null, [open])
  const orders = useApi<{ data: WorkOrderOption[] }>(open ? '/api/nalog?scope=open' : null, [open])
  const photos = useApi<{ data: PhotoRow[] }>(open ? '/api/measurements?type=FOTO' : null, [open])
  // R563 (issue #23): VLM zaznava je EKSPERIMENT, privzeto izklopljen — gumb se
  // prikaže SAMO, če strežnik potrdi ROKSAL_VLM_EXPERIMENT=1 (GET /api/measurement/detect).
  const vlmFlag = useApi<{ data: { enabled: boolean; model: string | null } }>(open ? '/api/measurement/detect' : null, [open])
  const vlmEnabled = vlmFlag.data?.data?.enabled === true

  // R439 (issue #6): stanje signala (useSyncExternalStore) + offline nabor nalogov
  const online = useOnline()
  const [cachedOrders, setCachedOrders] = useState<CachedWoRow[]>([])

  useEffect(() => {
    if (!open) return
    void getCachedNalogi<CachedWoRow>().then((c) => { if (c) setCachedOrders(c.list) }).catch(() => {})
  }, [open])

  // ── R574: označevanje na tablici/mobilnem ── živa reprodukcija (Playwright
  // touchscreen, Galaxy Tab S9 640×1024): fotografija za označevanje se je
  // izrisala pri 73 % višine zaslona in jo je pogovorno okno (max-h-85vh) REZALO
  // PO SREDINI SLIKE — vidna le ~polovica; tap spodaj od dialoga je ujel
  // prekrivalo Radixa in CEL ZAJEM se je zaprl (točke so izginile) → monterjev
  // vtis »označevanje ne deluje«. Dva popravka po vzorcu najboljših:
  // (1) ob vstopu v fazo označevanja (KALIBRACIJA/MERITEV) oz. preklopu pogleda
  //     se fotografija ZAVRTI V VIDNO POLJE dialoga (scrollIntoView center) —
  //     monter VIDI, kaj označuje (iPhone Measure odpre skico vedno v celoti);
  // (2) tap/potrkaj IZVEN dialoga NE zapre več zajema, ko že obstaja delo
  //     (fotografija/točke) — prekliče se izrecno (Prekliči/Zapri/Esc), kot
  //     vsak urejevalnik z nedokoncanim delom. Brez fotografije (faza 1) outside
  //     zapiranje ostane (ničesar ni za izgubiti).
  useEffect(() => {
    if (!open || (phase !== 2 && phase !== 3)) return
    const prizgi = (): void => { imgBoxRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' }) }
    prizgi()
    // dataUrl slika se naloži asinhrono — višina škatle zraste šele po onload;
    // ponovni zavit varen (idempotenten, brez animacije).
    const t = window.setTimeout(prizgi, 350)
    return () => { window.clearTimeout(t) }
  }, [open, phase, activeView])

  // ── R508 (issue #7 §6): statusna vrstica KORAK-NA-KORAK ────────────────────
  // Monter mora SRED meritve vedeti, kje je njegova fotografija in mera —
  // v telefonu, v vrsti, na strežniku ali v napaki. Stanje se izračuna iz
  // PRAVIH podatkov (IndexedDB vrsta + signal + potrjeni id) prek čiste
  // funkcije stanjeShranjevanja, nikoli iz predpostavke «verjetno je shranjeno».
  const [shranjevanjeTick, setShranjevanjeTick] = useState(0)
  const osveziShranjevanje = useCallback((): void => { setShranjevanjeTick((n) => n + 1) }, [])
  useEffect(() => {
    if (!open) return
    let odpovedano = false
    void getOfflineState()
      .then((s) => {
        if (odpovedano) return
        setVrsticaShranjevanja(stanjeShranjevanja({
          online: s.online,
          caka: s.pending,
          napake: s.errors,
          konflikti: s.conflicts,
          lokalno: s.photos,
          potrjeno: savedId !== null,
        }))
      })
      .catch(() => { if (!odpovedano) setVrsticaShranjevanja(null) })
    return () => { odpovedano = true }
  }, [open, online, savedId, shranjevanjeTick, views.length])

  // ── R486 (issue #7 §3): predpolnjen kontekst iz naloga (ZAČNI MERITEV v DANES) ──
  useEffect(() => {
    if (!open) return
    if (initialProjectId) setProjectId(initialProjectId)
    if (initialWorkOrderId) setWorkOrderId(initialWorkOrderId)
  }, [open, initialProjectId, initialWorkOrderId])

  // ── R486 (issue #7 §3/§6): nedokončana meritev — pasica NADALJUJ / ZAČNI NOVO ──
  // osvežitev/zaprtje/klic sred merjenja NE izgubi točk/kalibracije/pogledov
  const [pendingDraft, setPendingDraft] = useState<MeasureDraft | null>(null)
  /** R508 (§6): koliko nedokončanih meritev (sej) je na napravi. */
  const [sejeNedokoncanih, setSejeNedokoncanih] = useState(0)

  /** R508 (§6): identiteta trenutne meritve — projekt/nalog (brez tihe prepisi). */
  function osnutekKljuc (): string {
    return sejaKljuc({
      projectId: projectId !== 'none' ? projectId : null,
      workOrderId: workOrderId !== 'none' ? workOrderId : null,
    })
  }

  useEffect(() => {
    if (!open) return
    setPendingDraft(null)
    setSejeNedokoncanih(0)
    const uid = useAppStore.getState().user?.id
    if (!uid) return
    void loadSeje(uid).then((seje) => {
      // R508: na napravi je lahko VEČ nedokončanih meritev (po projekt/nalog).
      // Prikaze se NAJNOVEJŠA, številka v pasici pa pove, da jih je več — Monter
      // ve, da nadalednje mere ne izginejo.
      const uporabne = seje.filter((s) => Array.isArray(s.snapshot.views) && s.snapshot.views.length > 0)
      for (const prazna of seje.filter((s) => !uporabne.includes(s))) void clearDraft(uid, prazna.key)
      if (uporabne.length === 0) return
      const najnovejsa = splosciSejo(uid, uporabne[0])
      setSejeNedokoncanih(uporabne.length)
      if (autoResumeDraft) { resumeDraft(najnovejsa); return }
      setPendingDraft(najnovejsa)
    }).catch(() => {})
  }, [open, autoResumeDraft])

  /** R486: obnovi stanje iz osnutka (točke, kalibracija, pogledi, faza, kakovost). */
  function resumeDraft (d: MeasureDraft): void {
    const modes = MEASURE_MODES as string[]
    const validMode = modes.includes(d.mode) ? (d.mode as MeasureMode) : 'OGRAJA'
    const types = ['OGRAJA', 'BALUSTRADA', 'NAGIB', 'OSTANEO']
    const validType = typeof d.type === 'string' && types.includes(d.type) ? d.type : null
    const restored: View[] = d.views.map((v, i) => ({ ...v, key: viewKey.current + i }))
    viewKey.current += d.views.length
    // R522: obnovi tudi dokumentacijske slike (samo veljavne oznake —
    // pokvarjen osnutek ne sme ustaviti obnove meritev)
    const restoredDok = (Array.isArray(d.dokSlike) ? d.dokSlike : [])
      .filter((s) => s && typeof s.dataUrl === 'string' && s.dataUrl.startsWith('data:image/'))
      .slice(0, MAX_DOK_SLIK)
      .map((s) => ({
        key: dokKey.current++,
        dataUrl: s.dataUrl,
        tag: jeVeljavenDocTag(s.tag) ? s.tag : 'SPLOSNO' as DocTag,
        note: typeof s.note === 'string' ? s.note.slice(0, 200) : '',
        segmentIdx: typeof s.segmentIdx === 'number' && Number.isFinite(s.segmentIdx) && s.segmentIdx >= 0 ? Math.round(s.segmentIdx) : null,
      }))
    if (validMode !== mode) typeRestoreRef.current = true
    setMode(validMode)
    if (validType) setType(validType)
    setViews(restored)
    setDetajli(restoredDok)
    setActiveView(Math.max(0, Math.min(d.activeView ?? 0, restored.length - 1)))
    const ph = Math.min(5, Math.max(1, Math.round(d.phase ?? 1)))
    setPhase(ph as 1 | 2 | 3 | 4 | 5)
    if (d.projectId) setProjectId(d.projectId)
    if (d.workOrderId) setWorkOrderId(d.workOrderId)
    if (typeof d.location === 'string') setLocation(d.location)
    const cal = CALIB_METHODS.find((c) => c.id === d.calibMethod)
    if (cal) setCalibMethod(cal.id)
    if (typeof d.heightS === 'string' && d.heightS) setHeightS(d.heightS)
    if (typeof d.note === 'string' && d.note) setNote(d.note)
    if (typeof d.maxTilt === 'number' && Number.isFinite(d.maxTilt)) setMaxTilt(d.maxTilt)
    past.current = []; future.current = []
    setServerLayout(null)
    setPendingDraft(null)
    toast({ title: 'Nedokončana meritev obnovljena.', description: 'Točke, kalibracija in pogledi so nazaj — nadaljuj, kjer si končal.' })
  }

  /** R486: trenutno stanje dialoga → osnutek (IndexedDB, 1 na uporabnika). */
  function draftSnapshot (): MeasureDraftSnapshot {
    return {
      projectId: projectId !== 'none' ? projectId : null,
      workOrderId: workOrderId !== 'none' ? workOrderId : null,
      mode,
      phase,
      views,
      activeView,
      location,
      calibMethod,
      type,
      heightS,
      note,
      maxTilt,
      // R522: dokumentacijski detajli so dela seje (§6 — brez izgube podatkov
      // ob osvežitvi). dataUrl-ji so že kompresirani (shrinkToDataUrl/izbira).
      dokSlike: detajli.map((d) => ({ dataUrl: d.dataUrl, tag: d.tag, note: d.note, segmentIdx: d.segmentIdx })),
    }
  }

  // R486 (issue #7 §6): samodejni osnutek — debounce 500 ms.
  // R508: osnutek se shrani POD KLJUČEM projekt/nalog, zato začetek druge
  // meritve NE prepisuje prve. Če zaradi meje sej katera izpade, to poveomo
  // monterju (ne tiho brisanje nedokončane meritve).
  const draftTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!open) return
    const uid = useAppStore.getState().user?.id
    if (!uid || views.length === 0) return
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      void saveDraft(uid, draftSnapshot())
        .then(({ izpadle }) => {
          setPendingDraft(null)
          osveziShranjevanje()
          if (izpadle.length > 0) {
            toast({
              title: izpadle.length === 1 ? 'Najstarejši osnutek je izpadel' : 'Najstarejši osnutki so izpadli',
              description: 'V telefonu je prostor za največ 6 nedokončanih meritev. Potrdi ali zavrži starejše meritve, da trenutna ne ostane brez varnosti.',
            })
          }
        })
        .catch((e: unknown) => {
          // Osnutek ne sme blokirati merjenja, a prevelik osnutek mora biti
          // NAPAKA — drugače bi monter verjel, da je nedokončana mera varna.
          toast({
            title: 'Osnutek te meritve ni shranjen v telefonu',
            description: e instanceof Error
              ? `${e.message} Meritev lahko še vedno pošlješ v vrsto ali jo potrdiš, ko je signal nazaj.`
              : 'Prostor v telefonu je poln. Odstrani najmanj uporaben pogled ali potrdi meritev.',
            variant: 'destructive',
          })
        })
    }, 500)
    return () => { if (draftTimer.current !== null) { window.clearTimeout(draftTimer.current); draftTimer.current = null } }
  }, [open, phase, views, activeView, projectId, workOrderId, mode, location, calibMethod, type, heightS, note, maxTilt, detajli, toast, osveziShranjevanje])

  // R457 (§16): zmogljivosti naprave ob odprtju pogovornega okna
  useEffect(() => {
    if (!open) return
    void detectDeviceCaps().then(setCaps).catch(() => {})
  }, [open])

  // R457 (§2): način izmere določi priporočeni legacy tip + počisti analizo
  // R486: ob obnovitvi osnutka tip pusti, kot je bil shranjen (typeRestoreRef)
  const typeRestoreRef = useRef(false)
  useEffect(() => {
    if (typeRestoreRef.current) {
      typeRestoreRef.current = false
    } else {
      setType(MODE_RULES[mode].legacyType)
    }
    setStairMode(mode === 'STOPNICE')
    setAnalysis(null)
  }, [mode])

  // R457 (§3): nagib naprave med živim predogledom (DeviceOrientation)
  useEffect(() => {
    if (!camActive) return
    phoneRollRef.current = null
    const h = (e: DeviceOrientationEvent): void => {
      const t = Math.max(Math.abs(e.beta ?? 0), Math.abs(e.gamma ?? 0))
      setMaxTilt((prev) => (prev === null || t > prev ? t : prev))
      // R468 (F2): trenutni roll (gamma) za oceno naklona tal
      const g = e.gamma
      phoneRollRef.current = typeof g === 'number' && Number.isFinite(g) ? g : null
    }
    window.addEventListener('deviceorientation', h)
    return () => {
      window.removeEventListener('deviceorientation', h)
      phoneRollRef.current = null
    }
  }, [camActive])

  /** Nalogi za izbor: online API, offline predpomnjeni. */
  const orderOptions = useMemo(
    () => (orders.data?.data?.length ? orders.data.data : cachedOrders),
    [orders.data, cachedOrders]
  )

  const view = views[activeView] ?? null

  // ── R455: undo/redo (§4) — sklad je v useUndoRedo ──
  const { past, future, snapshot, undo, redo, setHistTick } = useUndoRedo({ views, setViews, activeView, setActiveView })

  /**
   * issue #15 faza 4 (H8): SKUPNA priprava naložene fotografije za obe vnosni
   * poti (1. pogled in dodaten pogled). Brskalnikove EXIF domneve NISO
   * dokaz: orientacija se prebere iz bajtov, dimenzije kodeksa se primerjajo z
   * dimenzijami, ki jih upošteva brskalnik, in obrat se po potrebi izvede SAM.
   * Rezultat vrne tudi zato, da ga UI lahko POŠTENO pokaže (NEUPORABLJENA
   * pomeni, da obrata niti sami nismo mogli dokazati/izvesti).
   */
  async function naložiDatoteko (f: File): Promise<{ url: string; orientacija: OrientationCheck | null }> {
    const raw = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(f)
    })
    const natural = await imageSize(raw)
    let check: OrientationCheck | null = null
    try {
      if (natural) check = checkOrientationFromBytes(new Uint8Array(await f.arrayBuffer()), natural)
    } catch {
      check = null // branju bajtov ni uspelo → NI_PODATKA, ne lažna trditev
    }
    setOrientacija(check)
    return { url: await shrinkToDataUrl(raw, check), orientacija: check }
  }

  async function onFile (f: File | undefined): Promise<void> {
    if (!f) return
    const { url } = await naložiDatoteko(f)
    await acceptImage(url)
  }

  /** Nastavi sliko kot PRVI pogled in ponastavi označevanje + R455 kakovost. */
  async function acceptImage (url: string): Promise<void> {
    const quality = await analyzeQuality(url)
    setSavedId(null) // R457: nov zajem — izvoz prejšnje meritve ni več aktualen
    const v: View = {
      key: viewKey.current++,
      photoId: null,
      dataUrl: url,
      imgW: 1, imgH: 1,
      quality,
      points: [], calib: null, calibLocked: false,
    }
    const img = new Image()
    img.onload = () => {
      setViews((vs) => vs.map((x) => (x.key === v.key ? { ...x, imgW: img.naturalWidth, imgH: img.naturalHeight } : x)))
    }
    img.src = url
    snapshot()
    setViews([v])
    setActiveView(0)
    setCalibA(null); setCalibCm(''); setServerLayout(null)
    setPhase(2)
    if (quality && !quality.ok) {
      toast({
        title: 'Opozorilo o kakovosti zajema.',
        description: `${quality.dark ? 'Slika je temna. ' : ''}${quality.bright ? 'Slika je presočena. ' : ''}${quality.blurry ? 'Slika je mehka — točke postavljajte previdno ali posnemite znova. ' : ''}Meritev lahko vseeno nadaljujete.`,
      })
    }
  }

  /** R455: doda DODATEN pogled (fotografija istega objekta, §3). */
  async function addView (url: string): Promise<void> {
    if (views.length >= MAX_VIEWS) {
      toast({ title: `Največ ${MAX_VIEWS} pogledov.`, variant: 'destructive' })
      return
    }
    const quality = await analyzeQuality(url)
    const v: View = {
      key: viewKey.current++,
      photoId: null,
      dataUrl: url,
      imgW: 1, imgH: 1,
      quality,
      points: [], calib: null, calibLocked: false,
    }
    const img = new Image()
    img.onload = () => {
      setViews((vs) => vs.map((x) => (x.key === v.key ? { ...x, imgW: img.naturalWidth, imgH: img.naturalHeight } : x)))
    }
    img.src = url
    snapshot()
    setViews((vs) => [...vs, v])
    setActiveView(views.length)
    setCalibA(null); setCalibCm('')
    toast({ title: `Dodan pogled ${views.length + 1}/${MAX_VIEWS}.`, description: 'Kalibrirajte merilo in označite iste točke kot na prvem pogledu.' })
  }

  async function onFileView (f: File | undefined): Promise<void> {
    if (!f) return
    const pri = await naložiDatoteko(f)
    await addView(pri.url)
  }

  /** R522: doda DOKUMENTACIJSKO sliko detajla (§4B) — brez točk, brez
   *  kalibracije, BREZ meje pogledov (ločena meja MAX_DOK_SLIK). Pošteno
   *  predstavljeno: slika je dokaz, ne mera. */
  async function addDokSlika (url: string): Promise<void> {
    if (prostorZaDokSlike(detajli.length) <= 0) {
      toast({ title: `Največ ${MAX_DOK_SLIK} dokumentacijskih slik.`, variant: 'destructive' })
      return
    }
    setDetajli((ds) => [...ds, { key: dokKey.current++, dataUrl: url, tag: 'SPLOSNO', note: '', segmentIdx: null }])
    toast({ title: `Dokumentacijska slika dodana (${detajli.length + 1}/${MAX_DOK_SLIK}).`, description: 'Slika je dokaz, ne merilni pogled — izberite oznako detajla in jo po potrebi pripnite na segment.' })
  }

  async function onFileDok (f: File | undefined): Promise<void> {
    if (!f) return
    const pri = await naložiDatoteko(f)
    await addDokSlika(pri.url)
  }

  /** R522: izbere obstoječo FOTO kot dokumentacijski detajl. */
  function pickExistingDok (p: PhotoRow): void {
    const url = parsePhoto(p.params)
    if (!url) return
    setAddingDok(false)
    void addDokSlika(url)
  }

  /** Izbere obstoječo FOTO meritev. */
  function pickExisting (p: PhotoRow): void {
    const url = parsePhoto(p.params)
    if (!url) return
    setOrientacija(null) // shranjena slika je že normaliziran canvas — EXIF datoteke ni
    void acceptImage(url)
  }

  /** R487 (issue #3): izbere obstoječo FOTO kot DODATEN pogled — isti vzorec
   *  kot izbira 1. pogleda (pickExisting), le da gre v addView namesto
   *  acceptImage. Terenska pot (kamera/datoteka) ostaja neodvisno poleg. */
  function pickExistingView (p: PhotoRow): void {
    const url = parsePhoto(p.params)
    if (!url) return
    setAddingView(false)
    setOrientacija(null) // glej pickExisting: shranjena FOTO nima EXIF dokaza
    void addView(url)
  }

  /** Naloži fotografijo (POST /api/measure/photo) za AKTIVNI pogled.
   *  R556-d: opis tosta je NAMEN-specifičen — isti gumb je na dveh fazah:
   *  v KALIBRACIJI monterju reče »zdaj kalibriraj«, v POTRDITVI pa ne sme
   *  (uporabnik je že za kalibracijo; tam je nalaganje pogoj za shranitev). */
  async function uploadPhoto (namen: 'KALIBRACIJA' | 'POTRDITEV' = 'KALIBRACIJA'): Promise<void> {
    if (!view) return
    setBusy(true)
    try {
      const res = await apiPost<{ data: { id: string } }>('/api/measure/photo', {
        dataUrl: view.dataUrl,
        location: location.trim() || null,
        projectId: projectId !== 'none' ? projectId : null,
        workOrderId: workOrderId !== 'none' ? workOrderId : null,
      })
      snapshot()
      setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, photoId: res.data.id } : v)))
      toast({
        title: 'Fotografija shranjena.',
        description: namen === 'KALIBRACIJA'
          ? 'Zdaj kalibrirajte merilo in označite točke.'
          : 'Fotografija je pripeta k meritvi — nadaljujte s potrditvijo.',
      })
    } catch (e) {
      toast({ title: 'Napaka pri nalaganju fotografije', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  // klik na sliko → točka (normalizirano 0..1) — R455: v fazi KALIBRACIJA (2)
  // označimo referenčni točki, v fazi MERITEV (3) merilne točke
  function onImageClick (e: React.MouseEvent<HTMLDivElement>): void {
    if (!view || (phase !== 2 && phase !== 3)) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    snapshot()
    setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, points: [...v.points, { x, y, src: 'ROCNO' }] } : v)))
    setServerLayout(null)
  }

  /** Pikselska razdalja med dvema točkama (po dejanski resoluciji slike). */
  const px = useCallback((a: Pt, b: Pt) => {
    if (!view) return 0
    return Math.hypot((b.x - a.x) * view.imgW, (b.y - a.y) * view.imgH)
  }, [view])

  /** R455: izračun v živo za AKTIVNI pogled. */
  const calc = useMemo(() => (view ? calcView(view) : CALC_PRAZEN), [view])

  /** R506 (issue #15 faza 4): Y referenca se vedno nastavi ali odstrani v PARU
   *  (`pxY`+`cmY`) — polovičen par bi merilo tiho spremenil iz dokazanega v
   *  nedokazano. Isti par nosita `/analyze` in `/confirm` (vojna pogodba
   *  `parseCalibration` ga filtrira na strežniku). */
  const applyYRef = useCallback((pxY: number | null, cmY: number | null) => {
    if (!view) return
    snapshot()
    setViews((vs) => vs.map((v) => {
      if (v.key !== view.key || !v.calib) return v
      const { pxY: _o, cmY: _o2, ...osnova } = v.calib
      return { ...v, calib: pxY !== null && cmY !== null && pxY > 0 && cmY > 0 ? { ...osnova, pxY, cmY } : osnova }
    }))
  }, [view])

  /** R455: primerjava vseh pogledov + zaupanje (§3). */
  const multi = useMemo(() => {
    const per = views.map((v) => ({ v, c: calcView(v) }))
    const withCm = per.filter((x) => x.c.totalCm !== null && (x.c.totalCm ?? 0) > 0)
    const lengths = withCm.map((x) => x.c.totalCm as number)
    const mean = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : null
    const spreadPct = lengths.length > 1 && mean
      ? ((Math.max(...lengths) - Math.min(...lengths)) / mean) * 100
      : null
    // zaupanje: kakovost + kalibracija + strinjanje pogledov (advisory, §3)
    let conf = 85
    const q0 = views[0]?.quality ?? null
    if (q0?.blurry) conf -= 20
    if (q0?.dark || q0?.bright) conf -= 10
    if (!views[0]?.calib) conf -= 30
    if (lengths.length > 1) {
      if (spreadPct !== null && spreadPct <= 2) conf += 5
      else if (spreadPct !== null && spreadPct > 5) conf -= 20
    } else {
      conf -= 5 // en sam pogled — manj kontrole
    }
    conf = Math.max(5, Math.min(98, Math.round(conf)))
    const label = conf >= 85 ? 'DOBRO' : conf >= 60 ? 'OPOZORILO' : 'NEZADOSTNO'
    return { per, lengths, mean, spreadPct, conf, label }
  }, [views])

  const predlogi = useMemo(() => view?.points.filter((p) => p.src === 'PREDLOG') ?? [], [view])
  const rocnoCnt = calc.pts.length

  /** VLM zaznava (POST /api/measurement/detect) — R455: točke kot PREDLOG (§2). */
  async function detect (): Promise<void> {
    if (!view) return
    if (!view.photoId) {
      toast({ title: 'Najprej shranite fotografijo.', description: 'Pritisnite »Naloži fotografijo«.', variant: 'destructive' })
      return
    }
    setDetecting(true)
    try {
      const res = await apiPost<{ data: { scene: string; points: Pt[]; refObjects: { x1: number; y1: number; x2: number; y2: number; estCm: number; label: string }[] } }>(
        '/api/measurement/detect', { measurementId: view.photoId }
      )
      const d = res.data
      snapshot()
      setViews((vs) => vs.map((v) => (v.key === view.key
        ? { ...v, points: [...v.points, ...d.points.map((p) => ({ x: p.x, y: p.y, label: p.label, src: 'PREDLOG' as const }))] }
        : v)))
      // referenčni objekt → kalibracija (če še ni oz. ni zaklenjena)
      let calibMsg = ''
      if (d.refObjects.length > 0 && !view.calibLocked) {
        const r = d.refObjects[0]
        const pxLen = Math.hypot((r.x2 - r.x1) * view.imgW, (r.y2 - r.y1) * view.imgH)
        if (pxLen > 0 && !view.calib) {
          setViews((vs) => vs.map((v) => (v.key === view.key ? { ...v, calib: { px: Math.round(pxLen), cm: r.estCm } } : v)))
          calibMsg = ` · kalibracija iz "${r.label}" (${r.estCm} cm)`
        }
      }
      toast({
        title: 'Zaznava končana.',
        description: `${d.points.length} predlogov točk${d.scene ? ` · ${d.scene}` : ''}${calibMsg} — predloge pregledajte, sprejmite ali popravite.`,
      })
    } catch (e) {
      toast({
        title: 'Samodejna zaznava ni uspela.',
        description: e instanceof Error ? `${e.message} Točke označite ročno — ročni vnos je popolnoma podprt.` : undefined,
        variant: 'destructive',
      })
    } finally { setDetecting(false) }
  }

  /** Končna dolžina: ročni popravek > povprečje pogledov > primarni pogled.
   *  R487 (issue #3 §4C): ob konfliktu pogledov (razpršenost > 5 %) BREZ
   *  ročnega popravka vrednost NI na voljo — NE tiho povprečje (vrata POTRDI). */
  const finalLengthCm = useMemo(() => {
    if (overrideOn) {
      const v = Number(overrideLen.replace(',', '.'))
      // R556-e: vnosno polje je v METRIH (oznaka »Dolžina (m)« + predizpolnitev
      // finalLengthCm/100), ta memo pa vrača CENTIMETRE (lengthCm v potrditvi,
      // vrsta brez signala, tosti in izpisi delijo s 100). Do R556 je vrednost
      // šla NEPRETVORJENO — 5,20 m se je shranilo kot lengthCm 5,2 (100×
      // premalo; živo ujeto v sprehodu R556). Round1 po konvenciji R556-a.
      return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 10 : null
    }
    if (multi.mean !== null && multi.lengths.length > 1) {
      if (multi.spreadPct !== null && multi.spreadPct > 5) return null // konflikt → rešitev ali popravek
      return Math.round(multi.mean * 10) / 10
    }
    // R556-a: ena-pogled pot zaokroži na 1 decimalko (0,1 cm) — ISTA konvencija
    // kot več-pogled zgoraj, nagib v confirm in fence-run round1. Surovi px→cm
    // zmnožek ima podmilimetrke iz plavajoče vejice (npr. 430.6000061035156),
    // ki niso merilna natančnost, ampak aritmetični šum; točke in kalibracija
    // ostanejo shranjene v polni natančnosti, zato dokazljivost ni prizadeta.
    return calc.totalCm !== null ? Math.round(calc.totalCm * 10) / 10 : null
  }, [overrideOn, overrideLen, multi, calc])

  /** R487 (issue #3 §4C): konflikt pogledov (razpršenost > 5 %) brez rešitve —
   *  POTRDI (in offline shranjevanje) onemogočena, dokler uporabnik NE popravi
   *  točk/kalibracije na pogledih (→ razpršenost ≤ 5 %) ALI izrecno ne potrdi
   *  razhajanja z ročnim popravkom dolžine z razlogom (manualOverride —
   *  obstoječa r455 pot v tej fazi). 0 tihih povprečij ob konfliktu. */
  const conflictBlocked = multi.lengths.length > 1 && multi.spreadPct !== null && multi.spreadPct > 5 &&
    !(overrideOn && Number(overrideLen.replace(',', '.')) > 0 && overrideReason.trim().length >= 3)

  function resetAll (): void {
    setPhase(1); setViews([]); setActiveView(0)
    setDetajli([]); setAddingDok(false) // R522: detajli so dela seje
    setCalibA(null); setCalibCm(''); setNote('')
    setLocation(''); setServerLayout(null); setStairMode(mode === 'STOPNICE')
    setProjectId('none'); setWorkOrderId('none')
    setOverrideOn(false); setOverrideLen(''); setOverrideReason('')
    // R457: počisti analizo/nagib; savedId ostane (izvoz zadnje shranjene meritve)
    setAnalysis(null); setMaxTilt(null)
    setOrientacija(null) // R506: brez dokaza o orientaciji, dokler ni nove datoteke
    past.current = []; future.current = []
  }

  /** R457: domenske možnosti za engine (§8–§11) iz UI stanja. */
  function buildOptions (): DomainOptions {
    const n = (s: string): number | null => {
      const v = Number(s.replace(',', '.'))
      return Number.isFinite(v) && v > 0 ? v : null
    }
    const openings = (): DomainOptions['openings'] => {
      const c = n(opCount)
      const w = n(opW); const h = n(opH)
      return c != null && c > 0 && w != null && h != null ? [{ wCm: w, hCm: h, count: Math.round(c) }] : undefined
    }
    switch (mode) {
      case 'OGRAJA': {
        const o: DomainOptions = {}
        const ms = n(maxSpanS); if (ms != null) o.maxSpanCm = ms
        const hh = n(heightS); if (hh != null) o.heightCm = hh
        return o
      }
      case 'KERAMIKA': {
        const o: DomainOptions = {}
        const w = n(tileW); const hh = n(tileH)
        // prazno polje fugue pomeni »ni vpisano«, ne 0 mm — sicer bi jedro
        // videlo VNOS in založilo 0 mm fugo kot izmerjeno (R506)
        const j = jointMm.trim() === '' ? null : Number(jointMm.replace(',', '.'))
        if (w != null) o.tileWcm = w
        if (hh != null) o.tileHcm = hh
        if (j != null && Number.isFinite(j) && j >= 0) o.jointMm = j
        o.pattern = pattern
        const op = openings(); if (op != null) o.openings = op
        return o
      }
      case 'STREHA': {
        const o: DomainOptions = {}
        const p = n(pitchDeg); if (p != null) o.pitchDeg = p
        o.roofMaterial = roofMaterial
        return o
      }
      case 'FASADA': {
        const o: DomainOptions = {}
        const op = openings(); if (op != null) o.openings = op
        return o
      }
      case 'STOPNICE': {
        const o: DomainOptions = {}
        const s = n(stepsS); if (s != null) o.steps = Math.round(s)
        return o
      }
      default:
        return {}
    }
  }

  /** R457 (§19): prenos izvoza CSV/JSON/DXF potrjene meritve (logika v ./meritve-kamera/izvoz). */
  async function downloadExport (fmt: 'csv' | 'json' | 'dxf'): Promise<void> {
    await prenesiIzvoz(savedId, fmt, toast)
  }

  const existingPhotos = useMemo(
    () => (photos.data?.data ?? []).filter((p) => parsePhoto(p.params) !== null).slice(0, 12),
    [photos.data]
  )

  /** R455: statusni korak (5-fazni tok, §4) — izpeljan iz stanja. */
  const stepDone = [
    views.length > 0, // ZAJEM
    Boolean(views[0]?.calib), // KALIBRACIJA
    rocnoCnt >= 2, // MERITEV
    phase > 4 || (phase === 4 && (serverLayout !== null || analysis !== null)), // PREVERJANJE
    false, // POTRDITEV (izvedeno ob shranitvi)
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      {/* R574: tap IZVEN dialoga NE uniči zajema z že zajetim delom — živa
          reprodukcija na tablici: tap 5 px pod robom dialoga (izgleda kot del
          fotografije) je zaprl celotnega čarovnika in pobrisal točke.
          preventDefault na onInteractOutside blokira zunanji tap/fokus;
          Esc in gumba Prekliči/Zapri ostajata (namerna pot). Brez fotografije
          (faza 1) zunanji tap še vedno zapre — ničesar ni za izgubiti. */}
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-4xl"
        onInteractOutside={(e) => { if (views.length > 0) e.preventDefault() }}
      >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Camera className="size-5 text-roksal-amber" aria-hidden /> Meritve s kamero
        </DialogTitle>
        <DialogDescription>
          Fotografirajte teren, kalibrirajte merilo, označite točke — dolžine, koti in višine se izračunajo samodejno.
        </DialogDescription>
      </DialogHeader>

      <FazniStatus phase={phase} stepDone={stepDone} />

      {vrsticaShranjevanja ? <StatusShranjevanja vrstica={vrsticaShranjevanja} /> : null}

      {pendingDraft && views.length === 0 ? (
        <PasicaOsnutek pendingDraft={pendingDraft} sejeNedokoncanih={sejeNedokoncanih} resumeDraft={resumeDraft} setPendingDraft={setPendingDraft} setSejeNedokoncanih={setSejeNedokoncanih} />
      ) : null}

      {/* R457 (§19): izvoz zadnje shranjene meritve — viden v vseh fazah po potrditvi */}
      {savedId ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 dark:border-emerald-900 dark:bg-emerald-950/30" role="status">
          <span className="text-[11px] font-medium text-emerald-900 dark:text-emerald-200">Meritev shranjena ✓ — izvoz dokumenta:</span>
          <Button size="sm" variant="outline" className="h-8" onClick={() => void downloadExport('csv')}><FileSpreadsheet className="size-3.5" aria-hidden /> CSV</Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => void downloadExport('json')}><FileJson className="size-3.5" aria-hidden /> JSON</Button>
          {/* R558 (raziskava V1.3): DXF — CAD risba (razviti prikaz ograje). */}
          <Button size="sm" variant="outline" className="h-8" onClick={() => void downloadExport('dxf')}><FileCode className="size-3.5" aria-hidden /> DXF</Button>
        </div>
      ) : null}

      {/* ══ FAZA 1: ZAJEM (fotografija + kakovost + vodila) ══ */}
      {phase === 1 ? (
        <FazaZajem
          mode={mode} setMode={setMode} caps={caps} startCamera={startCamera} camActive={camActive}
          fileRef={fileRef} onFile={onFile} videoRef={videoRef} sceneState={sceneState} guides={guides}
          nastaviVodila={nastaviVodila} zmoKamere={zmoKamere} torchNa={torchNa} preklopiTorch={preklopiTorch}
          preklopiSmer={preklopiSmer} stopCamera={stopCamera} nastavitve={nastavitve}
          smerKamere={smerKamere} zoomVrednost={zoomVrednost} nastaviZoomVrednost={nastaviZoomVrednost}
          ostrenjeNaTocki={ostrenjeNaTocki}
          resToka={resToka} naprave={naprave} trenutnaNaprava={trenutnaNaprava}
          preklopiNapravo={preklopiNapravo} svetloba={svetloba}
          existingPhotos={existingPhotos} pickExisting={pickExisting} projects={projects}
          projectId={projectId} setProjectId={setProjectId} workOrderId={workOrderId}
          setWorkOrderId={setWorkOrderId} orderOptions={orderOptions} orders={orders} online={online}
          location={location} setLocation={setLocation} setOrientacija={setOrientacija} acceptImage={acceptImage}
        />
      ) : null}

      {/* ══ FAZA 2: KALIBRACIJA ══ */}
      {phase === 2 && view ? (
        <FazaKalibracija
          view={view} busy={busy} orientacija={orientacija} uploadPhoto={uploadPhoto} detect={detect}
          detecting={detecting} resetAll={resetAll} online={online} maxTilt={maxTilt} views={views} mode={mode}
          vlmEnabled={vlmEnabled}
          buildOptions={buildOptions} onImageClick={onImageClick} calibA={calibA} setCalibA={setCalibA}
          calibCm={calibCm} setCalibCm={setCalibCm} calibMethod={calibMethod} setCalibMethod={setCalibMethod}
          refObject={refObject} setRefObject={setRefObject} planeW={planeW} setPlaneW={setPlaneW}
          planeH={planeH} setPlaneH={setPlaneH} snapshot={snapshot} setViews={setViews} calc={calc}
          px={px} applyYRef={applyYRef} setPhase={setPhase} onClose={onClose} imgBoxRef={imgBoxRef}
        />
      ) : null}

      {/* ══ FAZA 3: MERITEV (točke + pogoji + predlogi + več pogledov) ══ */}
      {phase === 3 && view ? (
        <FazaMeritev
          view={view} undo={undo} redo={redo} past={past} future={future} snapshot={snapshot}
          setViews={setViews} rocnoCnt={rocnoCnt} detect={detect} detecting={detecting} views={views}
          vlmEnabled={vlmEnabled}
          addingView={addingView} setAddingView={setAddingView} detajli={detajli} setDetajli={setDetajli}
          addingDok={addingDok} setAddingDok={setAddingDok} fileViewRef={fileViewRef} onFileView={onFileView}
          fileDokRef={fileDokRef} onFileDok={onFileDok} existingPhotos={existingPhotos}
          pickExistingView={pickExistingView} pickExistingDok={pickExistingDok} mode={mode}
          activeView={activeView} setActiveView={setActiveView} calibA={calibA} setCalibA={setCalibA}
          predlogi={predlogi} imgBoxRef={imgBoxRef} onImageClick={onImageClick} calc={calc}
          calibCm={calibCm} setCalibCm={setCalibCm} px={px} applyYRef={applyYRef} stairMode={stairMode}
          setStairMode={setStairMode} multi={multi} lens={lens} setLens={setLens} dragRef={dragRef}
          setHistTick={setHistTick} setServerLayout={setServerLayout} setPhase={setPhase}
        />
      ) : null}

      {/* ══ FAZA 4: PREVERJANJE (primerjava pogledov + zaupanje + strežnik) ══ */}
      {phase === 4 && view ? (
        <FazaPreverjanje
          view={view} busy={busy} setBusy={setBusy} setServerLayout={setServerLayout}
          serverLayout={serverLayout} multi={multi} mode={mode} calc={calc} analyzing={analyzing}
          setAnalyzing={setAnalyzing} analysis={analysis} setAnalysis={setAnalysis}
          buildOptions={buildOptions} maxTilt={maxTilt} overrideOn={overrideOn} overrideLen={overrideLen}
          maxSpanS={maxSpanS} setMaxSpanS={setMaxSpanS} heightS={heightS} setHeightS={setHeightS}
          tileW={tileW} setTileW={setTileW} tileH={tileH} setTileH={setTileH} jointMm={jointMm}
          setJointMm={setJointMm} pattern={pattern} setPattern={setPattern} opCount={opCount}
          setOpCount={setOpCount} opW={opW} setOpW={setOpW} opH={opH} setOpH={setOpH}
          pitchDeg={pitchDeg} setPitchDeg={setPitchDeg} roofMaterial={roofMaterial}
          setRoofMaterial={setRoofMaterial} stepsS={stepsS} setStepsS={setStepsS}
          calibMethod={calibMethod} refObject={refObject} views={views} setPhase={setPhase}
        />
      ) : null}

      {/* ══ FAZA 5: POTRDITEV ══ */}
      {phase === 5 && view ? (
        <FazaPotrditev
          view={view} views={views} calc={calc} multi={multi} analysis={analysis} mode={mode}
          type={type} setType={setType} stairMode={stairMode} heightS={heightS} setHeightS={setHeightS}
          note={note} setNote={setNote} overrideOn={overrideOn} setOverrideOn={setOverrideOn}
          overrideLen={overrideLen} setOverrideLen={setOverrideLen} overrideReason={overrideReason}
          setOverrideReason={setOverrideReason} location={location} projectId={projectId}
          workOrderId={workOrderId} calibMethod={calibMethod} refObject={refObject}
          finalLengthCm={finalLengthCm} conflictBlocked={conflictBlocked} online={online} busy={busy}
          setBusy={setBusy} setSavedId={setSavedId} detajli={detajli} setViews={setViews}
          setAnalysis={setAnalysis} setServerLayout={setServerLayout} setPhase={setPhase}
          resetAll={resetAll} osnutekKljuc={osnutekKljuc} osveziShranjevanje={osveziShranjevanje}
          onSaved={onSaved} onClose={onClose} past={past} future={future} uploadPhoto={uploadPhoto}
          rocnoCnt={rocnoCnt}
        />
      ) : null}

      {phase === 1 && !camActive ? (
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zapri</Button>
        </DialogFooter>
      ) : null}
      </DialogContent>
    </Dialog>
  )
}

// R537-a: privzeti izvoz vstopne datoteke (dinamični uvoz v module-view/meritve
// ostaja nespremenjen — '@/components/roksal/modules/meritve-kamera').
export default KameraMeritevDialog

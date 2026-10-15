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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Camera, Check, Download, Eye, FileImage, FolderKanban,
  Image as ImageIcon, Layers, Loader2, Package, Pencil, RotateCcw,
  Save, Sparkles, Trash2, TriangleAlert, Upload, Wand2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiGet, apiPatch, apiPost, fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
// R480 (issue #9 §10): javna povezava vizualizatorja + zgodovina izborov stranke
import { VizLinksPanel } from '@/components/roksal/modules/foto-replace-links'
import {
  VIZ_ZIG, barvaVariante, generirajRazpored, izrisiOgrajo, izrisiPrimerjavo, lameleIzTecha,
  materialIzTecha, maskaZaIzris, oceniKakovost, oceniSvetlobo, ralHex, rezaIzTecha, sirinaIzImena, visinaIzTecha,
  FASADA_REZA_MM, FASADA_SIRINA_MM, TERASA_REZA_MM,
  type NacinPritrditve, type Opozorilo, type OzadjeSloj, type RenderParams, type Tocka, type TipPolnila,
} from '@/lib/photo-replace-core'
// R507 (issue #14 §1–§4): lastna maska + obnova ozadja iz robov + originalna gradiva
import {
  deležPokritja, jePraznaMaska, maskaIzQuada, obnoviOzadje, pokrij, preveriMasko,
  slojObnove, slojPrednjega, MAX_OBLIK, MAX_TOCK, type Maska, type Oblika,
} from '@/lib/photo-replace-mask'
import {
  celiceZaElement, izberiGradivo, izmeriIzrezeNavpicnihPalic, izmeriSmerVlaken, projekcijaIzRavnine, vzorciTeksturo,
  type GradivoDTO, type IzbiraGradiva, type VirTeksture,
} from '@/lib/photo-replace-texture'
import { cn } from '@/lib/utils'

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

const VARIANT_LABELS = ['A', 'B', 'C'] as const
type VariantLabel = (typeof VARIANT_LABELS)[number]

// ─── Tipi ────────────────────────────────────────────────────────────────────

interface ProjectRow { id: string; code: string; title: string; status: string; customer: { name: string; city: string | null } | null }
interface VariantRow { id: string; sku: string; name: string; color: string | null; ral: string | null }
interface ProductRow {
  id: string; sku: string; name: string; unit: string; tech: string | null
  family: { code: string; name: string }
  variants: VariantRow[]
}
interface MeasurementRow {
  id: string; type: string; location: string | null; lengthCm: number | null; heightCm: number | null
  posts: number | null; params: string | null; createdAt: string
}
interface SavedVizRow {
  id: string; variantLabel: string; status: string; note: string | null
  measurementId: string | null; measurementVersion: number | null
  productId: string; variantId: string | null; engineVersion: string
  createdAt: string; updatedAt: string
  author: { name: string; role: string } | null
  product: { sku: string; name: string } | null
  variant: { sku: string; name: string; ral: string | null } | null
  _count: { versions: number }
}

/** Stanje ene variante (zavihek A/B/C) — delovno + savedId po shranjevanju. */
interface SlotState {
  quad: Tocka[]
  /** R507 §1: lastna maska — oblike namesto kvada, izpusti in prednji plan. */
  maskaOgraja: Oblika[]
  maskaIzpusti: Oblika[]
  maskaPrednji: Oblika[]
  refTip: 'MERITEV' | 'ROCNO'
  measurementId: string
  refCmS: string
  refOpis: string
  productId: string
  variantId: string
  tip: TipPolnila
  pritrditev: NacinPritrditve
  lengthCmS: string
  heightCmS: string
  postsS: string
  handrail: boolean
  lamelaMmS: string
  rezaMmS: string
  deskaMmS: string
  vijaki: boolean
  note: string
  savedId: string | null
  /** R510: meritev tipa FOTO, iz katere izvira trenutna fotografija (null = naložena datoteka). */
  photoSourceId: string | null
}

const prazenSlot = (): SlotState => ({
  quad: [], maskaOgraja: [], maskaIzpusti: [], maskaPrednji: [],
  refTip: 'ROCNO', measurementId: '', refCmS: '', refOpis: '',
  productId: '', variantId: '', tip: 'POKOCNA', pritrditev: 'TALNA',
  lengthCmS: '400', heightCmS: '110', postsS: '5', handrail: true,
  lamelaMmS: '70', rezaMmS: '20', deskaMmS: '120', vijaki: true,
  note: '', savedId: null, photoSourceId: null,
})

// ─── Pomočniki ───────────────────────────────────────────────────────────────

const toNum = (v: string, fb: number, min: number, max: number): number => {
  const n = Number(String(v).trim().replace(',', '.'))
  if (!Number.isFinite(n)) return fb
  return Math.min(max, Math.max(min, n))
}

/** Blob → JPEG data URL (max rob maxPx, kakovost q) — original ostane vir. */
function blobToJpeg (blob: Blob, maxPx: number, q: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Branje datoteke ni uspelo.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Slike ni bilo mogoče odpreti.'))
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) { reject(new Error('Canvas ni na voljo.')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', q))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(blob)
  })
}

/** Data URL slike → JPEG data URL (normalizacija velikosti/formata). */
async function dataUrlToJpeg (dataUrl: string, maxPx: number, q: number): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Slike ni bilo mogoče odpreti.'))
    i.src = dataUrl
  })
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas ni na voljo.')
  ctx.drawImage(img, 0, 0, w, h)
  return c.toDataURL('image/jpeg', q)
}

/** Prenese blob in ga shrani kot datoteko. */
function prenesiBlob (blob: Blob, ime: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = ime
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Prebere params JSON meritve FOTO → data URL fotografije (ali null). */
function fotoIzMeritve (params: string | null): string | null {
  if (!params) return null
  try {
    const p = JSON.parse(params) as { photo?: unknown }
    return typeof p.photo === 'string' && p.photo.startsWith('data:image/') ? p.photo : null
  } catch {
    return null
  }
}

/** Deterministično seme iz id-ja (zrno izrisa). */
function semeIzId (id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Katero vrsto oblike maska-trenutno rišemo (3. korak). */
type MaskaVrsta = 'ograja' | 'izpust' | 'prednji'

/** SlotState ključ za vrsto oblike (branje). */
const maskaKljuc = (v: MaskaVrsta): 'maskaOgraja' | 'maskaIzpusti' | 'maskaPrednji' =>
  v === 'ograja' ? 'maskaOgraja' : v === 'izpust' ? 'maskaIzpusti' : 'maskaPrednji'

/** Piksli originalne fotografije na dani velikosti (DOM — samo na odjemalcu). */
function piksliIzSlike (img: HTMLImageElement, W: number, H: number): Uint8ClampedArray | null {
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, W, H)
  try {
    return ctx.getImageData(0, 0, W, H).data
  } catch {
    // slika z drugega izvora ne sme prekriti plašča branjenja — brez pikslov
    return null
  }
}

/** Piksli → platno, ki ga poganjalnik riše kot sloj (drawImage skalira po needah). */
function slojNaPlatno (piksli: Uint8ClampedArray, W: number, H: number): HTMLCanvasElement | null {
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  try {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(piksli), W, H), 0, 0)
  } catch {
    return null
  }
  return c
}

/** ProductAsset vrstica iz /api/product-assets (samo polja, ki jih potrebuje izbira gradiva). */
interface AssetRow {
  id: string; kind: string; orientation: string | null; view: string | null
  colorName: string | null; variantSku: string | null; productId: string | null
  filePath: string | null; sha256: string | null; status: string
  permission: string; sourceName: string
}

/** Dokazna veriga izvedene slike (R510) — kar je ob shranjevanju POTRDIL strežnik. */
interface DokazVeriga {
  meritev: { status: string; verzija: number | null } | null
  izvirnikFotografije: string | null
  gradivo: { assetId: string; kind: string; pot: string; sha256: string } | null
  gradivoRazlog: string | null
}

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

  // ── podatki ──
  const projects = useApi<{ data: ProjectRow[] }>('/api/projects', [])
  const productsAll = useApi<{ data: ProductRow[] }>('/api/products?family=all', [])
  const measurements = useApi<{ data: MeasurementRow[] }>(
    projectId ? `/api/measurements?projectId=${projectId}` : null,
    [projectId]
  )
  const [savedVersion, setSavedVersion] = useState(0)
  const savedList = useApi<{ data: SavedVizRow[] }>(
    projectId ? `/api/photo-visualization?projectId=${projectId}` : null,
    [projectId, savedVersion]
  )

  const project = (projects.data?.data ?? []).find((p) => p.id === projectId) ?? null
  // R520: poleg ograj tudi FASADE in TERASE — enak modul, enak katalog.
  const ograjaProducts = useMemo(
    () => (productsAll.data?.data ?? []).filter((p) =>
      p.family.code === 'OGRAJA_PRECNA' || p.family.code === 'OGRAJA_POKOCNA' ||
      p.family.code === 'FASADA' || p.family.code === 'TERASA'),
    [productsAll.data]
  )
  const product = ograjaProducts.find((p) => p.id === slot.productId) ?? null
  const variant = product?.variants.find((v) => v.id === slot.variantId) ?? null
  const refMeasurements = useMemo(
    () => (measurements.data?.data ?? []).filter((m) => m.type !== 'FOTO' && (m.lengthCm ?? 0) > 0),
    [measurements.data]
  )
  const fotoMeasurements = useMemo(
    () => (measurements.data?.data ?? []).map((m) => ({ m, foto: fotoIzMeritve(m.params) })).filter((x) => x.foto !== null),
    [measurements.data]
  )
  const linkedMeasurement = refMeasurements.find((m) => m.id === slot.measurementId) ?? null

  // ── referenčna mera ──
  const refCm = slot.refTip === 'MERITEV'
    ? (linkedMeasurement?.lengthCm ?? 0)
    : toNum(slot.refCmS, 0, 20, 20000)

  // ── konfiguracija (številke iz nizov) ──
  // R520: višina/globina je odvisna od tipa — ograja ≤ 400 cm, FASADA (odsek
  // stene) in TERASA (globina tal) pa do 2000 cm (enaka meja kot preveriConfig).
  const jePovrsina = slot.tip === 'FASADA' || slot.tip === 'TERASA'
  const maxVisina = jePovrsina ? 2000 : 400
  const cfg = useMemo(() => ({
    tip: slot.tip,
    lengthCm: toNum(slot.lengthCmS, 400, 20, 6000),
    heightCm: toNum(slot.heightCmS, 110, 20, maxVisina),
    posts: Math.round(toNum(slot.postsS, 5, 1, 40)),
    handrail: slot.handrail,
    lamelaMm: Math.round(toNum(slot.lamelaMmS, 70, 10, 300)),
    rezaMm: Math.round(toNum(slot.rezaMmS, 20, 0, 300)),
    deskaMm: Math.round(toNum(slot.deskaMmS, 120, 40, 400)),
    pritrditev: slot.pritrditev,
    vijaki: slot.vijaki,
  }), [slot.tip, slot.lengthCmS, slot.heightCmS, slot.postsS, slot.handrail, slot.lamelaMmS, slot.rezaMmS, slot.deskaMmS, slot.pritrditev, slot.vijaki, maxVisina])

  // ── R507 §1: lastna maska (ograža sme biti natančnejša od kvada, izpusti in
  //    PREDNJI plan ostanejo originalni piksli) ──
  const [maskaUreja, setMaskaUreja] = useState<MaskaVrsta>('izpust')

  const maskaStanje = useMemo(() => {
    if (slot.quad.length !== 4) return { maska: null as Maska | null, napake: [] as string[] }
    const kvad = maskaIzQuada(slot.quad as [Tocka, Tocka, Tocka, Tocka])
    const poizkus: Maska = {
      ograja: slot.maskaOgraja.length > 0 ? slot.maskaOgraja : kvad.ograja,
      izpusti: slot.maskaIzpusti,
      prednji: slot.maskaPrednji,
    }
    const prever = preveriMasko(poizkus)
    if (prever.napake.length === 0) return { maska: poizkus, napake: [] as string[] }
    return { maska: kvad, napake: prever.napake.map((n) => n.sporocilo) }
  }, [slot.quad, slot.maskaOgraja, slot.maskaIzpusti, slot.maskaPrednji])

  const params: RenderParams | null = useMemo(() => {
    if (slot.quad.length !== 4 || refCm < 20) return null
    const m = maskaStanje.maska
    return {
      quad: slot.quad as [Tocka, Tocka, Tocka, Tocka],
      reference: {
        tip: slot.refTip,
        cm: refCm,
        ...(slot.refTip === 'ROCNO' && slot.refOpis.trim() ? { opis: slot.refOpis.trim() } : {}),
      },
      config: cfg,
      // prazna maska se NE shrani kot ključ → stari zapis ostane bit-enak (§: nazaj združljivo)
      ...(m && !jePraznaMaska(m) ? { maska: m } : {}),
    }
  }, [slot.quad, slot.refTip, slot.refOpis, refCm, cfg, maskaStanje])

  // R517: WPC variante nimajo RAL — barva gre čez odtenek iz URADNE lestvice
  // (ODTENKI_HEX), ne čez temno-sivi RAL fallback, ki je prej pobarval vse
  // lesene ograje v sivo ne glede na izbrani odtenek.
  const barva = barvaVariante(variant ? { ral: variant.ral, color: variant.color } : null)
  const material = useMemo(() => materialIzTecha(product?.tech ?? null), [product?.tech])

  // ── opozorila kakovosti (§1/§15) ──
  const warnings: Opozorilo[] = useMemo(() => {
    if (!params || photoW <= 0) return []
    return oceniKakovost(params, photoW, photoH, linkedMeasurement?.lengthCm ?? null)
  }, [params, photoW, photoH, linkedMeasurement?.lengthCm])

  /** Prikaz: ocena iz parametrov + opozorila, ki jih je poganjalnik vrnil ob IZRISU. */
  const vsaOpozorila = useMemo(() => {
    const videne = new Set<string>()
    return [...warnings, ...renderWarnings].filter((w) => {
      if (videne.has(w.koda)) return false
      videne.add(w.koda)
      return true
    })
  }, [warnings, renderWarnings])

  // ── R507 §2: OBNOVA OZADJA iz robov fotografije (brez AI) + §1 prednji plan ──
  // Platna gradimo na ENI velikosti; poganjalnik ju drawImage skalira po needah,
  // zato poročilo na zaslonu in izris vedno govorita o isti obnovi.
  const sloji = useMemo(() => {
    const m = maskaStanje.maska
    if (!photoImg || photoW <= 0 || !m || jePraznaMaska(m)) return null
    const W = Math.min(1100, photoW)
    const H = Math.max(1, Math.round(W * (photoH / photoW)))
    const izvirnik = piksliIzSlike(photoImg, W, H)
    if (!izvirnik) return null
    const pk = pokrij(m, W, H)
    const obnova = obnoviOzadje(izvirnik, W, H, pk.ograja)
    const ozadjePlatno = slojNaPlatno(slojObnove(obnova, pk.ograja, W, H), W, H)
    const prednjiPlatno = deležPokritja(pk.prednji) > 0
      ? slojNaPlatno(slojPrednjega(izvirnik, W, H, pk.prednji), W, H)
      : null
    const pasovi = obnova.pasovi
      .filter((p) => p.pokritihPikslov > 0 && p.razmerje > 0)
      .map((p) => `${p.ime} ${Math.round(p.razmerje * 100)} %`)
    const ozadje: OzadjeSloj | null = ozadjePlatno
      ? { sloj: ozadjePlatno, nedokončano: obnova.razmerjeNedokončanega, pasovi, sporocilo: obnova.sporocilo }
      : null
    return {
      obnova,
      ozadje,
      prednji: prednjiPlatno ? { sloj: prednjiPlatno as CanvasImageSource } : null,
    }
  }, [photoImg, photoW, photoH, maskaStanje])

  // ── R507 §3/§4: originalno ROKSALOVO gradivo SAMO iz preverjenih sredstev ──
  const gradiva = useApi<{ data: AssetRow[] }>(
    slot.productId ? `/api/product-assets?productId=${slot.productId}` : null,
    [slot.productId]
  )

  const izbiraGradiva: IzbiraGradiva | null = useMemo(() => {
    const vrstice = gradiva.data?.data
    if (!vrstice || !product) return null
    const dto: GradivoDTO[] = vrstice.map((a) => ({
      id: a.id, kind: a.kind, orientation: a.orientation, view: a.view,
      colorName: a.colorName, variantSku: a.variantSku, productId: a.productId,
      filePath: a.filePath, sha256: a.sha256, status: a.status,
      permission: a.permission, sourceName: a.sourceName,
    }))
    const orientacija = slot.tip === 'PRECNA' ? 'PRECNA' : slot.tip === 'POKOCNA' ? 'POKOCNA' : 'SPLOSNO'
    // R520: FASADA/TERASA gradiva (DETAJL SPLOSNO/SPREDAJ) so splošne
    // orientacije — enak kanal kot STEKLO.
    return izberiGradivo(dto, { productId: product.id, variantSku: variant?.sku ?? null, orientation: orientacija })
  }, [gradiva.data, product, variant, slot.tip])

  const [tekstura, setTekstura] = useState<VirTeksture | null>(null)
  useEffect(() => {
    const g = izbiraGradiva?.smeUporabiti ? izbiraGradiva.gradivo : null
    if (!g?.filePath) { setTekstura(null); return }
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      // R520: FASADA — tekstura KUBO pride iz namestitvene fotografije z VEČ
      // navpičnimi deskami: izrežemo ENO (izmerjeno korak), da se na letvico
      // ne stiska cela hiša. TERASA/ograje imajo DETAJL posnetke ene deske —
      // izmera vrne null in slika ostane cela (fail-closed).
      // R523: izmerimo VSE deske (množina) — izris nato vsako letvico obleče
      // z drugo (deterministično seme), konec identičnih klonov. En sam izrez
      // (najbližji sredini) ostane zaradi združljivosti poročil/stanjev.
      let izrezi: VirTeksture['izrezi']
      let izrez: VirTeksture['izrez']
      if (slot.tip === 'FASADA') {
        try {
          const mc = document.createElement('canvas')
          mc.width = img.naturalWidth; mc.height = img.naturalHeight
          const mctx = mc.getContext('2d', { willReadFrequently: true })
          if (mctx) {
            mctx.drawImage(img, 0, 0)
            const vsi = izmeriIzrezeNavpicnihPalic((x, y) => {
              const d = mctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
              return (d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114) / 255
            }, img.naturalWidth, img.naturalHeight)
            if (vsi && vsi.length > 0) {
              izrezi = vsi
              const sredina = img.naturalWidth / 2
              izrez = vsi.reduce((a, b) =>
                Math.abs(a.x + a.w / 2 - sredina) <= Math.abs(b.x + b.w / 2 - sredina) ? a : b)
            }
          }
        } catch { /* izrez ni nujen — cela slika kot doslej */ }
      }
      // R524: vlakna VZDOLŽ elementa — vir ENE površine (DETAJL čip uradne
      // lestvice) se ob nalaganju IZMERI (izmeriSmerVlaken — enaka metoda kot
      // dokazna orodja) in rotira za 90°, kadar njegova vlakna tečejo ČEZ
      // element (pokončna ograja → navpična vlakna v viru; prečna → vodoravna).
      // FASADA/TERASA imata že prav obrnjena gradiva (KUBO čipi navpično,
      // terasni posnetki vzdolžno) — brez spremembe.
      const jeDetajl = g.kind === 'DETAJL'
      let slikaVir: CanvasImageSource = img
      let sirinaPx = img.naturalWidth
      let visinaPx = img.naturalHeight
      if (jeDetajl && (slot.tip === 'POKOCNA' || slot.tip === 'PRECNA')) {
        try {
          const mc = document.createElement('canvas')
          mc.width = img.naturalWidth; mc.height = img.naturalHeight
          const mctx = mc.getContext('2d', { willReadFrequently: true })
          if (mctx) {
            mctx.drawImage(img, 0, 0)
            const dd = mctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data
            const smer = izmeriSmerVlaken((x, y) => {
              const i = (y * img.naturalWidth + x) * 4
              return (dd[i] * 0.299 + dd[i + 1] * 0.587 + dd[i + 2] * 0.114) / 255
            }, img.naturalWidth, img.naturalHeight)
            const hocemoNavpicno = slot.tip === 'POKOCNA'
            const imaNavpicno = smer <= 1
            if (hocemoNavpicno !== imaNavpicno) {
              const rc = document.createElement('canvas')
              rc.width = img.naturalHeight; rc.height = img.naturalWidth
              const rctx = rc.getContext('2d')
              if (rctx) {
                rctx.translate(rc.width / 2, rc.height / 2)
                rctx.rotate(Math.PI / 2)
                rctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
                slikaVir = rc
                sirinaPx = img.naturalHeight
                visinaPx = img.naturalWidth
              }
            }
          }
        } catch { /* izmera ni uspela — vir nerotiran, kot je */ }
      }
      setTekstura({
        slika: slikaVir, sirinaPx, visinaPx,
        doklad: izbiraGradiva?.doklad ?? g.filePath ?? '',
        oznaka: g.variantSku ?? g.id,
        ...(izrez ? { izrez } : {}),
        ...(izrezi && izrezi.length > 0 ? { izrezi } : {}),
      })
    }
    img.onerror = () => { if (alive) setTekstura(null) }
    img.src = g.filePath.replace(/^public/, '')
    return () => { alive = false }
  }, [izbiraGradiva, slot.tip])

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

  /** Skupni izris POTEM na podan ctx (fotografija + svetloba + ograja).
   *  Vrni opozorila, ki jih je poganjalnik izdal PRI tem izrisu (dokaz z izrisa). */
  const drawPotem = useCallback((
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    p: RenderParams,
    opts: { meja?: number; zig?: boolean; ghostAlpha?: number; seme: number }
  ): Opozorilo[] => {
    if (!photoImg) return []
    // svetloba ocenimo IZ FOTOGRAFIJE (pred izrisom ograje)
    ctx.drawImage(photoImg, 0, 0, W, H)
    const svet = oceniSvetlobo(ctx, W, H, p.quad.map((t) => ({ x: t.x * W, y: t.y * H })) as [Tocka, Tocka, Tocka, Tocka])
    // R507: obnovljeno ozadje + prednji plan + preverjena tekstura (samo kadar
    // je bila izbira preverjena — sicer poganjalnik riše barvni preliv in to tudi pove)
    const plast = {
      gradivo: tekstura,
      ozadje: prekrij ? sloji?.ozadje ?? null : null,
      prednji: sloji?.prednji ?? null,
    }
    if (opts.meja !== undefined) {
      return izrisiPrimerjavo(ctx, photoImg, W, H, p, barva, material, svet, opts.meja,
        { ghost: opts.ghostAlpha ?? 1, zig: opts.zig, seme: opts.seme, prekrijStaro: prekrij, ...plast })
    }
    return izrisiOgrajo(ctx, W, H, p, barva, material, svet,
      { ghost: opts.ghostAlpha ?? 1, zig: opts.zig, seme: opts.seme, prekrijStaro: prekrij, ...plast })
  }, [photoImg, barva, material, prekrij, sloji, tekstura])

  /** Opozorila SHRANIJO se ob dejanskem izrisu — ne napovedano iz parametrov. */
  const zapisiOpozorila = useCallback((w: Opozorilo[]): void => {
    setRenderWarnings((prev) => (
      prev.length === w.length && prev.every((p, i) => p.koda === w[i].koda && p.sporocilo === w[i].sporocilo)
        ? prev
        : w
    ))
  }, [])

  // ── 3. korak: označevanje (canvas s točkami) ──
  useEffect(() => {
    const canvas = editRef.current
    if (!canvas || !photoImg || step !== 2) return
    const W = Math.min(1100, photoW)
    const H = Math.round(W * (photoH / photoW))
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(photoImg, 0, 0, W, H)

    const q = slot.quad
    if (q.length > 0) {
      // povezovalne črte (odprta polilinija do 4. točke, nato poligon)
      ctx.save()
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.95)'
      ctx.lineWidth = 2
      ctx.setLineDash(q.length === 4 ? [] : [8, 5])
      ctx.beginPath()
      q.forEach((t, i) => {
        const x = t.x * W, y = t.y * H
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      if (q.length === 4) ctx.closePath()
      ctx.stroke()
      // polprosojno polnilo
      if (q.length === 4) {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.12)'
        ctx.fill()
      }
      // spodnji rob — prikaz merila
      if (q.length === 4 && refCm >= 20) {
        const px = Math.hypot((q[1].x - q[0].x) * W, (q[1].y - q[0].y) * H)
        const tekst = `${Math.round(refCm)} cm ≈ ${Math.round(px)} px`
        ctx.font = '600 13px system-ui, sans-serif'
        const tw = ctx.measureText(tekst).width
        const mx = ((q[0].x + q[1].x) / 2) * W - tw / 2
        const my = Math.min(H - 10, ((q[0].y + q[1].y) / 2) * H + 20)
        ctx.fillStyle = 'rgba(15, 17, 21, 0.75)'
        ctx.fillRect(mx - 6, my - 14, tw + 12, 20)
        ctx.fillStyle = '#fafafa'
        ctx.fillText(tekst, mx, my)
      }
      ctx.restore()
    }
    // točke z oznakami
    const CRS = ['1', '2', '3', '4']
    const IME: string[] = ['spodaj levo', 'spodaj desno', 'zgoraj desno', 'zgoraj levo']
    q.forEach((t, i) => {
      const x = t.x * W, y = t.y * H
      ctx.beginPath()
      ctx.arc(x, y, 11, 0, Math.PI * 2)
      ctx.fillStyle = dragIdx.current === i ? '#f59e0b' : 'rgba(250, 204, 21, 0.95)'
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#1c1917'
      ctx.stroke()
      ctx.fillStyle = '#1c1917'
      ctx.font = '700 11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(CRS[i], x, y + 0.5)
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
      // pasica z imenom vogala
      const label = `${i + 1} — ${IME[i]}`
      ctx.font = '600 11px system-ui, sans-serif'
      const lw = ctx.measureText(label).width
      const lx = Math.min(W - lw - 8, Math.max(6, x + 15))
      const ly = Math.max(16, y - 15)
      ctx.fillStyle = 'rgba(15, 17, 21, 0.72)'
      ctx.fillRect(lx - 4, ly - 11, lw + 8, 16)
      ctx.fillStyle = '#fafafa'
      ctx.fillText(label, lx, ly + 1)
    })

    // ── R507 §1: oblike mask (ograža / izpusti / prednji plan) ──
    const BARVE: Record<MaskaVrsta, { rob: string; polnilo: string }> = {
      ograja: { rob: 'rgba(56, 189, 248, 0.95)', polnilo: 'rgba(56, 189, 248, 0.14)' },
      izpust: { rob: 'rgba(248, 113, 113, 0.95)', polnilo: 'rgba(248, 113, 113, 0.20)' },
      prednji: { rob: 'rgba(74, 222, 128, 0.95)', polnilo: 'rgba(74, 222, 128, 0.16)' },
    }
    const SKUPINE: [MaskaVrsta, Oblika[]][] = [
      ['ograja', slot.maskaOgraja], ['izpust', slot.maskaIzpusti], ['prednji', slot.maskaPrednji],
    ]
    for (const [vrsta, oblike] of SKUPINE) {
      const barve = BARVE[vrsta]
      oblike.forEach((oblika, oi) => {
        if (oblika.length === 0) return
        ctx.save()
        ctx.strokeStyle = barve.rob
        ctx.lineWidth = 2
        ctx.setLineDash(oblika.length >= 3 ? [] : [6, 4])
        ctx.beginPath()
        oblika.forEach((t, i) => {
          const x = t.x * W, y = t.y * H
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        })
        if (oblika.length >= 3) {
          ctx.closePath()
          ctx.fillStyle = barve.polnilo
          ctx.fill()
        }
        ctx.stroke()
        oblika.forEach((t, i) => {
          const x = t.x * W, y = t.y * H
          const aktivna = vrsta === maskaUreja && oi === oblike.length - 1
          ctx.beginPath()
          ctx.arc(x, y, aktivna ? 7 : 5, 0, Math.PI * 2)
          ctx.fillStyle = barve.rob
          ctx.fill()
          ctx.lineWidth = 1.5
          ctx.strokeStyle = '#1c1917'
          ctx.stroke()
        })
        ctx.restore()
      })
    }
  }, [photoImg, photoW, photoH, slot.quad, slot.maskaOgraja, slot.maskaIzpusti, slot.maskaPrednji, maskaUreja, step, refCm])

  /** Kazalec na točko ali prazno mesto. */
  function editPointer (e: React.PointerEvent<HTMLCanvasElement>): Tocka {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }

  /** Zapis oblike po vrsti (branje/pisanje ločeno, da TS drži ključ). */
  const nastaviOblike = useCallback((v: MaskaVrsta, fn: (o: Oblika[]) => Oblika[]): void => {
    updateSlot((s) => v === 'ograja'
      ? { ...s, maskaOgraja: fn(s.maskaOgraja) }
      : v === 'izpust'
        ? { ...s, maskaIzpusti: fn(s.maskaIzpusti) }
        : { ...s, maskaPrednji: fn(s.maskaPrednji) })
  }, [updateSlot])

  /** Razveljavi zadnjo točko aktivne vrste (prazna oblika pade ven). */
  const razveljaviTocko = useCallback((): void => {
    nastaviOblike(maskaUreja, (o) => {
      if (o.length === 0) return o
      const zadnja = o[o.length - 1]
      if (zadnja.length <= 1) return o.slice(0, -1)
      return o.slice(0, -1).concat([zadnja.slice(0, -1)])
    })
  }, [nastaviOblike, maskaUreja])

  function editDown (e: React.PointerEvent<HTMLCanvasElement>): void {
    if (step !== 2) return
    const p = editPointer(e)
    const W = editRef.current?.width ?? 1
    const H = editRef.current?.height ?? 1
    // najdi najbližjo točko (radij 22 px v canvas prostoru)
    let best = -1
    let bestD = 22
    slot.quad.forEach((t, i) => {
      const d = Math.hypot((t.x - p.x) * W, (t.y - p.y) * H)
      if (d < bestD) { bestD = d; best = i }
    })
    if (best >= 0) {
      dragIdx.current = best
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    // kvad je pogoj za izris — maska se ureja, ko so štirje vogali označeni
    if (slot.quad.length < 4) {
      updateSlot((s) => ({ ...s, quad: [...s.quad, p] }))
      return
    }
    const kljuc = maskaKljuc(maskaUreja)
    const oblike = slot[kljuc]
    const zadnja = oblike.length > 0 ? oblike[oblike.length - 1] : null
    // točka obstoječe oblike → premik
    if (zadnja) {
      let bi = -1
      let bd = 16
      zadnja.forEach((t, i) => {
        const d = Math.hypot((t.x - p.x) * W, (t.y - p.y) * H)
        if (d < bd) { bd = d; bi = i }
      })
      if (bi >= 0) {
        dragMask.current = { vrsta: maskaUreja, oblika: oblike.length - 1, tocka: bi }
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }
    // nova točka aktivne vrste (meji MAX_OBLIK / MAX_TOCK vodita UI)
    if (zadnja && zadnja.length < MAX_TOCK) {
      nastaviOblike(maskaUreja, (o) => o.map((oblika, i) => (i === o.length - 1 ? [...oblika, p] : oblika)))
      return
    }
    if (oblike.length < MAX_OBLIK) {
      nastaviOblike(maskaUreja, (o) => [...o, [p]])
    } else {
      toast({ title: `Največ ${MAX_OBLIK} oblik na vrsto mask.`, description: 'Zmanjšajte območje ali počistite obliko.', variant: 'destructive' })
    }
  }

  function editMove (e: React.PointerEvent<HTMLCanvasElement>): void {
    if (step !== 2) return
    const p = editPointer(e)
    if (dragIdx.current !== null) {
      const i = dragIdx.current
      updateSlot((s) => ({ ...s, quad: s.quad.map((t, k) => (k === i ? p : t)) }))
      return
    }
    const dm = dragMask.current
    if (dm) {
      nastaviOblike(dm.vrsta, (o) => o.map((oblika, i) => (i === dm.oblika
        ? oblika.map((t, k) => (k === dm.tocka ? p : t))
        : oblika)))
    }
  }

  function editUp (): void {
    dragIdx.current = null
    dragMask.current = null
  }

  // ── 4. korak: predogled POTEM (debounce) ──
  useEffect(() => {
    if (step !== 3 || !params || !photoImg) return
    const t = setTimeout(() => {
      const canvas = previewRef.current
      if (!canvas) return
      const W = Math.min(1100, photoW)
      const H = Math.round(W * (photoH / photoW))
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      zapisiOpozorila(drawPotem(ctx, W, H, params, { ghostAlpha: ghost ? ghostOpacity / 100 : 1, seme: semeIzId(slot.savedId ?? `slot-${active}`) }))
    }, 120)
    return () => clearTimeout(t)
  }, [step, params, photoImg, photoW, photoH, drawPotem, zapisiOpozorila, ghost, ghostOpacity, slot.savedId, active])

  // ── 5. korak: PREJ/POTEM primerjava ──
  useEffect(() => {
    if (step !== 4 || !params || !photoImg) return
    const t = setTimeout(() => {
      const canvas = compareRef.current
      if (!canvas) return
      const W = Math.min(1100, photoW)
      const H = Math.round(W * (photoH / photoW))
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      zapisiOpozorila(drawPotem(ctx, W, H, params, { meja: comparePos / 100, ghostAlpha: ghost ? ghostOpacity / 100 : 1, seme: semeIzId(slot.savedId ?? `slot-${active}`) }))
    }, 60)
    return () => clearTimeout(t)
  }, [step, params, photoImg, photoW, photoH, drawPotem, zapisiOpozorila, comparePos, ghost, ghostOpacity, slot.savedId, active])

  // ── izbira projekta ──
  function izberiProjekt (id: string): void {
    setProjectId(id)
    // ponastavi delovne variante ob novem projektu
    setSlots({ A: prazenSlot(), B: prazenSlot(), C: prazenSlot() })
    setDokaz(null)
    setActive('A')
    setSavedVersion((v) => v + 1)
  }

  // ── izbira izdelka: prednastavi tip/višino/lamele iz produktnih podatkov ──
  // R517: širina profila pride IZ IMENA (ROMB 67 → 67 mm, POLNA 128 → 128 mm),
  // zato ima prečna ograja pravilo število desk in pokončna pravilno širino lamel.
  // R518: tudi RAZMIK pride iz tech (razmakDeskMm — npr. »5–30 (priporočeno)« →
  // sredina obsega), saj POLNE ograje niso brez rež: tech jih priporoča 5–30 mm
  // in uporabnik vidi resničen razmik iz kataloga namesto splošne 20 mm.
  // R520: FASADE in TERASE — mere iz uradnih virov roksal.com (enak vir kot
  // tech.vir): KUBO 80×42 SAMO navpično, razmik poljuben (privzeto 20 mm je
  // izmerjen z namestitvenih fotografij); terasna deska 150×25 iz IMENA
  // izdelka, reža 5–6 mm po uradnem FAQ (privzeto 6 mm).
  function izberiIzdelek (pid: string): void {
    const p = ograjaProducts.find((x) => x.id === pid) ?? null
    const sirina = p ? lameleIzTecha(p.tech) ?? sirinaIzImena(p.name) : null
    const razmik = p ? rezaIzTecha(p.tech) : null
    const jeFasada = p?.family.code === 'FASADA'
    const jeTerasa = p?.family.code === 'TERASA'
    updateSlot((s) => ({
      ...s,
      productId: pid,
      variantId: p?.variants[0]?.id ?? '',
      tip: jeFasada ? 'FASADA' : jeTerasa ? 'TERASA'
        : p?.family.code === 'OGRAJA_PRECNA' ? 'PRECNA' : 'POKOCNA',
      ...(p ? {
        heightCmS: String(Math.round((visinaIzTecha(p.tech) ?? (jeFasada ? 250 : jeTerasa ? 400 : 1100)) / 10)),
        ...(sirina != null ? {
          lamelaMmS: String(sirina),
          deskaMmS: String(sirina), // prečna/terasna: višina deske = širina istega profila
        } : {}),
        ...(razmik != null ? { rezaMmS: String(razmik) } : {}),
        // R520 uradni privzeti razmik, KADER ga katalog nima: KUBO (poljuben)
        // → izmerjenih 20 mm; terasa (FAQ 5–6 mm) → 6 mm.
        ...(jeFasada && razmik == null ? { rezaMmS: String(FASADA_REZA_MM) } : {}),
        ...(jeTerasa && razmik == null ? { rezaMmS: String(TERASA_REZA_MM) } : {}),
        // KUBO nima mere v tech ne v imenu → uradna 80 mm.
        ...(jeFasada && sirina == null ? { lamelaMmS: String(FASADA_SIRINA_MM) } : {}),
      } : {}),
    }))
  }

  // ── povezava meritve → referenca + predfill geometrije ──
  function izberiMeritev (mid: string): void {
    const m = refMeasurements.find((x) => x.id === mid) ?? null
    updateSlot((s) => ({
      ...s,
      refTip: 'MERITEV',
      measurementId: mid,
      ...(m?.lengthCm ? {
        refCmS: String(Math.round(m.lengthCm)),
        lengthCmS: String(Math.round(m.lengthCm)),
      } : {}),
      ...(m?.heightCm ? { heightCmS: String(Math.round(m.heightCm)) } : {}),
      ...(m?.posts ? { postsS: String(m.posts) } : {}),
    }))
  }

  // ── menjava zavihka variante: shrani trenutno, naloži ciljno ──
  function preklopiVarianto (label: VariantLabel): void {
    if (label === active) return
    setActive(label)
  }

  // ── render v JPEG data URL (za `rendered` ob shranjevanju/izvozu) ──
  async function renderJpeg (maxPx: number, zig: boolean, meja?: number): Promise<string> {
    if (!photoImg || !params) throw new Error('Ni podatkov za izris.')
    const W = Math.min(maxPx, photoW)
    const H = Math.round(W * (photoH / photoW))
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('Canvas ni na voljo.')
    drawPotem(ctx, W, H, params, { ...(meja !== undefined ? { meja } : {}), zig, ghostAlpha: 1, seme: semeIzId(slot.savedId ?? `slot-${active}`) })
    return c.toDataURL('image/jpeg', 0.85)
  }

  /** PNG izvoz (celoten POTEM ali PREJ/POTEM primerjava). */
  async function izvozi (format: 'png' | 'primerjava'): Promise<void> {
    if (!photoImg || !params) return
    setExportBusy(format)
    try {
      const W = Math.min(1600, photoW)
      const H = Math.round(W * (photoH / photoW))
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('Canvas ni na voljo.')
      drawPotem(ctx, W, H, params, {
        ...(format === 'primerjava' ? { meja: comparePos / 100 } : {}),
        zig: true, ghostAlpha: 1, seme: semeIzId(slot.savedId ?? `slot-${active}`),
      })
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
      if (!blob) throw new Error('Izdelava PNG ni uspela.')
      prenesiBlob(blob, `${project?.code ?? 'vizualizacija'}-varianta-${active}${format === 'primerjava' ? '-prej-potem' : '-potem'}.png`)
      // če je varianta shranjena → zabeleži izvoz + posodobi rendered (za PDF)
      if (slot.savedId) {
        const rendered = await renderJpeg(1280, true, format === 'primerjava' ? comparePos / 100 : undefined)
        await apiPost(`/api/photo-visualization/${slot.savedId}/export`, { format, rendered })
        setSavedVersion((v) => v + 1)
      }
      toast({ title: format === 'primerjava' ? 'Izvožena primerjava PREJ/POTEM.' : 'Izvožena POTEM fotografija.', description: 'PNG vsebuje žig VIZUALIZACIJA ZA PREDSTAVITEV.' })
    } catch (e) {
      toast({ title: 'Izvoz ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setExportBusy(null)
    }
  }

  /** PDF dokument (fetch z žetonom → blob → prenos). */
  async function izvoziPdf (): Promise<void> {
    if (!slot.savedId || !token) return
    setExportBusy('pdf')
    try {
      const res = await fetch(`/api/pdf/photoviz/${slot.savedId}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      if (!blob.type.includes('pdf')) throw new Error('Odgovor ni veljaven PDF.')
      prenesiBlob(blob, `${project?.code ?? 'vizualizacija'}-varianta-${active}.pdf`)
      toast({ title: 'PDF dokument vizualizacije izvožen.' })
    } catch (e) {
      toast({ title: 'PDF izvoz ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setExportBusy(null)
    }
  }

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
      const res = await apiGet<{
        data: {
          id: string; variantLabel: string; status: string; sourcePhoto: string
          renderParams: string; measurementId: string | null; note: string | null
          sourcePhotoId: string | null
          productId: string; variantId: string | null
          product: { id: string; sku: string; name: string; tech: string | null; family: { code: string } }
          opozorila: Opozorilo[]
          dokaz: DokazVeriga | null
        }
      }>(`/api/photo-visualization/${id}`)
      const d = res.data
      let rp: {
        quad?: Tocka[]; reference?: { tip?: string; cm?: number; opis?: string }; config?: Record<string, unknown>
        maska?: { ograja?: Tocka[][]; izpusti?: Tocka[][]; prednji?: Tocka[][] }
      } = {}
      try { rp = JSON.parse(d.renderParams) as typeof rp } catch { /* prazno */ }
      const oblike = (v: unknown): Oblika[] =>
        Array.isArray(v) ? v.filter((o) => Array.isArray(o) && o.length >= 3).map((o) => o.map((t) => ({ x: Number(t.x), y: Number(t.y) }))) : []
      const label = (VARIANT_LABELS as readonly string[]).includes(d.variantLabel) ? (d.variantLabel as VariantLabel) : 'A'
      setPhoto(d.sourcePhoto)
      setPhotoName('shranjena fotografija')
      // R510: izvirnik in dokaz se vrneta iz baze — sicer bi urejanje shranjene
      // variante znova poslalo prazen izvirnik in zabrisalo verigo.
      setDokaz(d.dokaz ?? null)
      const s0 = prazenSlot()
      const nov: SlotState = {
        ...s0,
        photoSourceId: d.sourcePhotoId ?? null,
        quad: Array.isArray(rp.quad) && rp.quad.length === 4 ? rp.quad.map((t) => ({ x: t.x, y: t.y })) : [],
        maskaOgraja: oblike(rp.maska?.ograja),
        maskaIzpusti: oblike(rp.maska?.izpusti),
        maskaPrednji: oblike(rp.maska?.prednji),
        refTip: rp.reference?.tip === 'MERITEV' ? 'MERITEV' : 'ROCNO',
        measurementId: d.measurementId ?? '',
        refCmS: String(Math.round(rp.reference?.cm ?? 400)),
        refOpis: rp.reference?.opis ?? '',
        productId: d.productId,
        variantId: d.variantId ?? '',
        tip: (rp.config?.tip === 'PRECNA' || rp.config?.tip === 'STEKLO') ? rp.config.tip : 'POKOCNA',
        pritrditev: (rp.config?.pritrditev === 'STEBRI_V_BETON' || rp.config?.pritrditev === 'BOCNA_NA_STENO') ? rp.config.pritrditev : 'TALNA',
        lengthCmS: String(Math.round(Number(rp.config?.lengthCm ?? 400))),
        heightCmS: String(Math.round(Number(rp.config?.heightCm ?? 110))),
        postsS: String(Math.round(Number(rp.config?.posts ?? 5))),
        handrail: rp.config?.handrail !== false,
        lamelaMmS: String(Math.round(Number(rp.config?.lamelaMm ?? lameleIzTecha(d.product.tech) ?? 70))),
        rezaMmS: String(Math.round(Number(rp.config?.rezaMm ?? 20))),
        deskaMmS: String(Math.round(Number(rp.config?.deskaMm ?? 120))),
        vijaki: rp.config?.vijaki !== false,
        note: d.note ?? '',
        savedId: d.id,
      }
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

  // ── upload fotografije ──
  async function naloziDatoteko (file: File | undefined): Promise<void> {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Izberite slikovno datoteko.', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const dataUrl = await blobToJpeg(file, 1600, 0.85)
      setPhoto(dataUrl)
      setPhotoName(file.name)
      // ponastavi točke in vezave shranjenih variant ob novi fotografiji
      // (R510: zveza na izvirnik je null — datoteka zunaj projekta ga nima)
      setSlots(() => ({ A: prazenSlot(), B: prazenSlot(), C: prazenSlot() }))
      setDokaz(null)
      toast({ title: 'Fotografija pripravljena.', description: 'Original se pretvori v JPEG (max 1600 px) — ostaja vir slike.' })
    } catch (e) {
      toast({ title: 'Priprava fotografije ni uspela.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  /** Obstoječa projektna fotografija (meritev FOTO) → vir. */
  async function uporabiProjektno (mid: string): Promise<void> {
    const row = fotoMeasurements.find((x) => x.m.id === mid)
    if (!row?.foto) return
    setBusy(true)
    try {
      const dataUrl = await dataUrlToJpeg(row.foto, 1600, 0.85)
      setPhoto(dataUrl)
      setPhotoName(`projektna fotografija ${row.m.location ? `— ${row.m.location}` : ''}`)
      // R510: projektna fotografija IMA izvirnik — povezavo nosi vsaka varianta
      // (meritev, ki je bila umaknjena, na strežniku pomeni zavrnjeno ustvarjanje).
      setSlots(() => {
        const z = (): SlotState => ({ ...prazenSlot(), photoSourceId: mid })
        return { A: z(), B: z(), C: z() }
      })
      toast({ title: 'Projektna fotografija prevzeta.', description: 'Izvirnik fotografije je povezan — dokaz gre ob shranjevanju v dokument.' })
    } catch (e) {
      toast({ title: 'Prevzem fotografije ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
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
    <div className="space-y-4">
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
                  <ul className="max-h-96 space-y-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                    {(projects.data?.data ?? []).map((p) => (
                      <li key={p.id}>
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
                      </li>
                    ))}
                  </ul>
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
                    <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                      {fotoMeasurements.map(({ m }) => (
                        <li key={m.id}>
                          <Button
                            type="button" variant="outline" size="sm" className="h-10 w-full justify-start"
                            disabled={busy} onClick={() => { void uporabiProjektno(m.id) }}
                          >
                            <Camera className="size-4 shrink-0" aria-hidden />
                            <span className="truncate">{m.location || 'foto-dokaz'} · {fmtDate(m.createdAt)}</span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {photo ? (
                <figure className="space-y-1.5">
                  <img src={photo} alt="Originalna fotografija objekta" className="max-h-72 w-full rounded-lg border object-contain" />
                  <figcaption className="text-xs text-muted-foreground">Vir: {photoName || 'naložena fotografija'}</figcaption>
                </figure>
              ) : null}
            </div>
          ) : null}

          {/* ── 3. OZNAČITEV + REFERENCA ── */}
          {STEPS[step].key === 'oznaci' ? (
            <div className="space-y-4">
              <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                <p className="rounded-lg border p-2.5">
                  Kliknite vogale obstoječe ograje po vrsti:{' '}
                  <span className="font-medium text-foreground">1 spodaj levo → 2 spodaj desno → 3 zgoraj desno → 4 zgoraj levo</span>. Točke vlecite za popravek.
                </p>
                <p className="rounded-lg border p-2.5">
                  Območje določa ravnino ograje v perspektivi fotografije — hiša, tla in okolica ostanejo nespremenjeni.
                </p>
              </div>
              <div className="relative overflow-hidden rounded-lg border bg-muted">
                <canvas
                  ref={editRef}
                  className={cn('block h-auto w-full touch-none select-none', slot.quad.length < 4 && 'cursor-crosshair')}
                  onPointerDown={editDown}
                  onPointerMove={editMove}
                  onPointerUp={editUp}
                  onPointerCancel={editUp}
                  aria-label="Označevanje območja obstoječe ograje na fotografiji"
                  role="img"
                />
                {slot.quad.length < 4 ? (
                  <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs font-medium shadow">
                    Kliknite točko {slot.quad.length + 1} od 4
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => updateSlot((s) => ({ ...s, quad: [] }))}>
                  <RotateCcw className="size-4" aria-hidden /> Ponastavi točke
                </Button>
                {slot.quad.length === 4 && refCm >= 20 ? (
                  <span className="text-xs text-muted-foreground">
                    Merilo: spodnji rob ≈ <span className="font-semibold text-foreground">{Math.round(refCm)} cm</span>
                    {linkedMeasurement ? ` (iz meritve ${linkedMeasurement.location || 'brez lokacije'})` : ''}
                  </span>
                ) : null}
              </div>

              {/* R507 (issue #14 §1/§2): maska — kaj je STARO (ograža), kaj ostane (izpusti), kaj je SPREDAJ */}
              {slot.quad.length === 4 ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Maska obstoječe ograje</p>
                    <div className="flex items-center gap-1" role="group" aria-label="Vrsta oblike, ki jo rišete">
                      {([
                        ['ograja', 'ograža'],
                        ['izpust', 'izpusti (ostane original)'],
                        ['prednji', 'prednji plan'],
                      ] as [MaskaVrsta, string][]).map(([v, label]) => (
                        <Button
                          key={v} type="button" size="sm" variant={maskaUreja === v ? 'default' : 'outline'}
                          className="h-9 text-xs" onClick={() => setMaskaUreja(v)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {maskaUreja === 'ograja'
                      ? 'Rišite točno obliko stare ograje (največ 4 oblike × 20 točk). Prazno = uporabi se 4 vogalna kota.'
                      : maskaUreja === 'izpust'
                        ? 'Izpust = del znotraj ograje, ki ostane ORIGINAL (npr. daska, leseni stebel, cvetje).'
                        : 'Prednji plan = roba balkona, stebriček, rastlina ali stopnica, ki mora ostati PRED novo ograjo.'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-sky-500/15 px-2 py-1 font-medium text-sky-700 dark:text-sky-400">
                      ograja: {slot.maskaOgraja.reduce((s, o) => s + o.length, 0)} točk / {slot.maskaOgraja.length} oblik
                    </span>
                    <span className="rounded-md bg-red-500/15 px-2 py-1 font-medium text-red-700 dark:text-red-400">
                      izpusti: {slot.maskaIzpusti.reduce((s, o) => s + o.length, 0)} točk / {slot.maskaIzpusti.length} oblik
                    </span>
                    <span className="rounded-md bg-emerald-500/15 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">
                      prednji: {slot.maskaPrednji.reduce((s, o) => s + o.length, 0)} točk / {slot.maskaPrednji.length} oblik
                    </span>
                    <Button type="button" variant="outline" size="sm" className="h-9" onClick={razveljaviTocko}>
                      <ArrowLeft className="size-4" aria-hidden /> Razveljavi točko
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-9"
                      onClick={() => updateSlot((s) => ({ ...s, maskaOgraja: [], maskaIzpusti: [], maskaPrednji: [] }))}>
                      <Trash2 className="size-4" aria-hidden /> Počisti masko
                    </Button>
                  </div>
                  {maskaStanje.napake.length > 0 ? (
                    <p className="text-xs font-medium text-destructive">
                      Masko ste merili po nepričakovano: {maskaStanje.napake[0]} — za izris se uporabi samo kvad.
                    </p>
                  ) : null}
                  {sloji?.obnova.zahtevaRočniPoseg ? (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
                      <p className="font-semibold text-amber-800 dark:text-amber-300">
                        Obnova ozadja ni dokončana — {Math.round((sloji?.obnova.razmerjeNedokončanega ?? 0) * 100)} % označenega
                        območja nima dokaza iz znanih sosedov.
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {sloji?.obnova.sporocilo}
                        {sloji && sloji.obnova.pasovi.some((p) => p.razmerje > 0)
                          ? ` Manjka dokaz: ${sloji.obnova.pasovi.filter((p) => p.razmerje > 0).map((p) => `${p.ime} ${Math.round(p.razmerje * 100)} %`).join(', ')}.`
                          : ''}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Rezultat je na takih mestih označen s šrafuro — ni rekonstruirane strukture, samo iz robov izpeljana podlaga.
                      </p>
                    </div>
                  ) : null}
                  {izbiraGradiva ? (
                    <div className="rounded-lg border p-2.5 text-xs">
                      <p className={cn('font-semibold', izbiraGradiva.smeUporabiti ? 'text-foreground' : 'text-muted-foreground')}>
                        Gradivo površine: {izbiraGradiva.napis}
                      </p>
                      {izbiraGradiva.manjkajo.length > 0 ? (
                        <p className="mt-1 text-muted-foreground">Manjka: {izbiraGradiva.manjkajo.join(', ')}.</p>
                      ) : null}
                      {izbiraGradiva.doklad ? (
                        <p className="mt-1 break-words text-[11px] text-muted-foreground">Vir: {izbiraGradiva.doklad}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {/* R510 (issue #15 Faza 6): kaj je ob zadnjem shranjevanju POTRDIL strežnik.
                      Odjemalčeve trditve tu niso — prikazujemo samo zapisano verigo. */}
                  {dokaz ? (
                    <div className="rounded-lg border p-2.5 text-xs">
                      <p className="font-semibold">Dokazna veriga izvedene slike</p>
                      <p className="mt-1 text-muted-foreground">
                        Podlaga mere: {dokaz.meritev
                          ? `${dokaz.meritev.status}${dokaz.meritev.verzija ? ` · verzija ${dokaz.meritev.verzija}` : ''}`
                          : 'brez povezane mere'}
                        {dokaz.meritev?.status === 'INVALIDATED' ? ' — mera je bila razveljavljena; slika ostane predstavitev, ne podlaga za naročilo.' : ''}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Izvirnik fotografije: {dokaz.izvirnikFotografije
                          ? `projektna fotografija (${dokaz.izvirnikFotografije.slice(0, 8)}…)`
                          : 'naložena datoteka — projectskega izvirnika ni'}
                      </p>
                      {dokaz.gradivo ? (
                        <p className="mt-1 break-words text-muted-foreground">
                          Originalno gradivo potrjeno: {dokaz.gradivo.kind} · {dokaz.gradivo.pot} · SHA-256 {dokaz.gradivo.sha256.slice(0, 12)}…
                        </p>
                      ) : (
                        <p className="mt-1 text-muted-foreground">
                          {dokaz.gradivoRazlog ?? 'Dokaz o gradivu ni bil zapisan — veriga je bila vzpostavljena šele ob naslednjem shranjevanju.'}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">Vizualizacija je PREDSTAVITEV: ne meri in ne proizvaja količin.</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* referenca */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ref-meritev" className="text-sm font-semibold">Referenca iz potrjene meritve</Label>
                  <Select value={slot.measurementId || 'none'} onValueChange={(v) => { if (v === 'none') { updateSlot((s) => ({ ...s, refTip: 'ROCNO', measurementId: '' })) } else { izberiMeritev(v) } }}>
                    <SelectTrigger id="ref-meritev" className="h-11"><SelectValue placeholder="Izberite meritev" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— ročna referenca —</SelectItem>
                      {refMeasurements.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {Math.round(m.lengthCm ?? 0)} cm · {m.location || m.type} · {fmtDate(m.createdAt)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Dolžina spodnjega roba se prevzame iz POTRJENE meritve projekta (§6).</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ref-cm" className="text-sm font-semibold">Ročna referenca (znana dolžina spodnjega roba)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="ref-cm" className="h-11" type="number" min="20" max="20000" step="any" inputMode="decimal"
                      placeholder="npr. 420" value={slot.refTip === 'ROCNO' ? slot.refCmS : String(Math.round(refCm))}
                      disabled={slot.refTip === 'MERITEV'}
                      onChange={(e) => updateSlot((s) => ({ ...s, refTip: 'ROCNO', refCmS: e.target.value }))}
                    />
                    <span className="flex items-center text-sm text-muted-foreground">cm</span>
                  </div>
                  <Input
                    className="h-11" placeholder="opis reference (npr. obstoječa ograja med stebri)"
                    value={slot.refOpis}
                    disabled={slot.refTip === 'MERITEV'}
                    onChange={(e) => updateSlot((s) => ({ ...s, refOpis: e.target.value }))}
                    aria-label="Opis ročne reference"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {/* ── 4. IZDELEK + KONFIGURACIJA ── */}
          {STEPS[step].key === 'izdelek' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pv-izdelek" className="text-sm font-semibold">ROKSAL izdelek <span className="text-red-600">*</span></Label>
                  <Select value={slot.productId || 'none'} onValueChange={izberiIzdelek}>
                    <SelectTrigger id="pv-izdelek" className="h-11"><SelectValue placeholder="Izberite izdelek" /></SelectTrigger>
                    <SelectContent>
                      {ograjaProducts.length === 0 ? <SelectItem value="none" disabled>Ni izdelkov (ograje/fasade/terase)</SelectItem> : null}
                      {ograjaProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Videz izključno iz ROKSAL kataloga — brez generičnih modelov (§2).</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pv-varianta" className="text-sm font-semibold">Barva / varianta (RAL)</Label>
                  <Select value={slot.variantId || 'none'} onValueChange={(v) => updateSlot((s) => ({ ...s, variantId: v === 'none' ? '' : v }))} disabled={!product}>
                    <SelectTrigger id="pv-varianta" className="h-11"><SelectValue placeholder="Izberite varianto" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— brez variante —</SelectItem>
                      {(product?.variants ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          <span className="flex items-center gap-2">
                            <span aria-hidden className="inline-block size-3 rounded-full border" style={{ background: v.ral ? ralHex(v.ral) : v.color ? barvaVariante({ ral: null, color: v.color }, '#9aa2ab') : '#9aa2ab' }} />
                            {v.name}{v.ral ? ` — ${v.ral}` : ''}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {variant?.ral ? <p className="text-xs text-muted-foreground">{variant.ral} · {variant.name}</p> : null}
                </div>
              </div>

              {product ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {jePovrsina ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Površina</Label>
                      <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground" aria-live="polite">
                        {slot.tip === 'FASADA'
                          ? 'Fasada — navpične KUBO letvice (uradno: profil 80×42, samo navpična montaža, pritrditev zadaj).'
                          : 'Terasa — deske ležijo vzdolž spodnjega roba območja; reža med deskami po uradnem priporočilu 5–6 mm.'}
                      </p>
                    </div>
                  ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="pv-tip" className="text-xs font-semibold">Polnilo</Label>
                    <Select value={slot.tip} onValueChange={(v) => updateSlot((s) => ({ ...s, tip: v as TipPolnila }))}>
                      <SelectTrigger id="pv-tip" className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="POKOCNA">Pokončne palice / lamele</SelectItem>
                        <SelectItem value="PRECNA">Horizontalne deske</SelectItem>
                        <SelectItem value="STEKLO">Stekleno polnilo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="pv-len" className="text-xs font-semibold">
                      {slot.tip === 'FASADA' ? 'Širina območja (cm)' : slot.tip === 'TERASA' ? 'Dolžina vzdolž desk (cm)' : 'Prikazna dolžina (cm)'}
                    </Label>
                    <Input id="pv-len" className="h-11" type="number" min="20" max="6000" step="any" inputMode="decimal" value={slot.lengthCmS} onChange={(e) => updateSlot((s) => ({ ...s, lengthCmS: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pv-vis" className="text-xs font-semibold">
                      {slot.tip === 'FASADA' ? 'Višina območja (cm)' : slot.tip === 'TERASA' ? 'Globina terase (cm)' : 'Višina (cm)'}
                    </Label>
                    <Input id="pv-vis" className="h-11" type="number" min="20" max={maxVisina} step="any" inputMode="decimal" value={slot.heightCmS} onChange={(e) => updateSlot((s) => ({ ...s, heightCmS: e.target.value }))} />
                  </div>
                  {!jePovrsina ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="pv-posts" className="text-xs font-semibold">Število stebrov</Label>
                    <Input id="pv-posts" className="h-11" type="number" min="1" max="40" value={slot.postsS} onChange={(e) => updateSlot((s) => ({ ...s, postsS: e.target.value }))} />
                  </div>
                  ) : null}
                  {slot.tip === 'POKOCNA' || slot.tip === 'FASADA' ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="pv-lamela" className="text-xs font-semibold">{slot.tip === 'FASADA' ? 'Širina letvice (mm)' : 'Širina lamele (mm)'}</Label>
                        <Input id="pv-lamela" className="h-11" type="number" min="10" max="300" value={slot.lamelaMmS} onChange={(e) => updateSlot((s) => ({ ...s, lamelaMmS: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pv-reza" className="text-xs font-semibold">{slot.tip === 'FASADA' ? 'Razmik med letvicami (mm)' : 'Razmik med palicami (mm)'}</Label>
                        <Input id="pv-reza" className="h-11" type="number" min="0" max="300" value={slot.rezaMmS} onChange={(e) => updateSlot((s) => ({ ...s, rezaMmS: e.target.value }))} />
                      </div>
                    </>
                  ) : null}
                  {slot.tip === 'PRECNA' || slot.tip === 'TERASA' ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="pv-deska" className="text-xs font-semibold">{slot.tip === 'TERASA' ? 'Širina deske (mm)' : 'Višina deske (mm)'}</Label>
                        <Input id="pv-deska" className="h-11" type="number" min="40" max="400" value={slot.deskaMmS} onChange={(e) => updateSlot((s) => ({ ...s, deskaMmS: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pv-reza2" className="text-xs font-semibold">Razmik med deskami (mm)</Label>
                        <Input id="pv-reza2" className="h-11" type="number" min="0" max="300" value={slot.rezaMmS} onChange={(e) => updateSlot((s) => ({ ...s, rezaMmS: e.target.value }))} />
                      </div>
                    </>
                  ) : null}
                  {!jePovrsina ? (
                  <>
                  <div className="space-y-1.5">
                    <Label htmlFor="pv-pritrditev" className="text-xs font-semibold">Pritrditev</Label>
                    <Select value={slot.pritrditev} onValueChange={(v) => updateSlot((s) => ({ ...s, pritrditev: v as NacinPritrditve }))}>
                      <SelectTrigger id="pv-pritrditev" className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TALNA">Talna (vijaki v podlago)</SelectItem>
                        <SelectItem value="STEBRI_V_BETON">Stebri v beton</SelectItem>
                        <SelectItem value="BOCNA_NA_STENO">Bočna na steno</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <Label htmlFor="pv-rocnik" className="text-xs font-medium">Ročnik</Label>
                    <Switch id="pv-rocnik" checked={slot.handrail} onCheckedChange={(v) => updateSlot((s) => ({ ...s, handrail: v }))} />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <Label htmlFor="pv-vijaki" className="text-xs font-medium">Vidni vijaki (§5)</Label>
                    <Switch id="pv-vijaki" checked={slot.vijaki} onCheckedChange={(v) => updateSlot((s) => ({ ...s, vijaki: v }))} />
                  </div>
                  </>
                  ) : null}
                  <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                    <Label htmlFor="pv-prekrij" className="text-xs font-medium">Prekrij staro {jePovrsina ? (slot.tip === 'FASADA' ? 'oblogo' : 'tla') : 'ograjo'}</Label>
                    <Switch id="pv-prekrij" checked={prekrij} onCheckedChange={setPrekrij} />
                  </div>
                </div>
              ) : null}

              {razporedInfo ? (
                <p className="text-xs text-muted-foreground">
                  {jePovrsina
                    ? <>Razpored: <span className="font-medium text-foreground">{razporedInfo.palice.length > 0
                        ? `${razporedInfo.palice.length} letvic (${slot.lamelaMmS} mm + ${slot.rezaMmS} mm razmik)`
                        : `${razporedInfo.deske.length} desk (${slot.deskaMmS} mm + ${slot.rezaMmS} mm reža)`}</span>
                      — iz konfiguracije, ne po občutku.</>
                    : <>Razpored: <span className="font-medium text-foreground">{razporedInfo.posts.length} stebrov</span>
                      {razporedInfo.palice.length > 0 ? ` · ${razporedInfo.palice.length} palic (${slot.lamelaMmS} mm + ${slot.rezaMmS} mm razmik)` : ''}
                      {razporedInfo.deske.length > 0 ? ` · ${razporedInfo.deske.length} desk (${slot.deskaMmS} mm)` : ''}
                      {razporedInfo.vijaki.length > 0 ? ` · ${razporedInfo.vijaki.length} vijakov` : ''} — iz konfiguracije, ne po občutku.</>}
                </p>
              ) : null}

              {params ? (
                <figure className="space-y-1.5">
                  <figcaption className="text-xs font-semibold text-muted-foreground">Predogled POTEM (brez žiga — ta je na izvozu)</figcaption>
                  <canvas ref={previewRef} className="block h-auto w-full rounded-lg border" role="img" aria-label="Predogled nove ograje na fotografiji" />
                </figure>
              ) : (
                <EmptyState title="Manjka označitev ali referenca" desc="Vrnite se na korak Označi območje." icon={Pencil} />
              )}
            </div>
          ) : null}

          {/* ── 5. PREJ / POTEM + VARIANTE ── */}
          {STEPS[step].key === 'potem' ? (
            <div className="space-y-4">
              {/* zavihki variant */}
              <div role="tablist" aria-label="Variante vizualizacije" className="flex flex-wrap items-center gap-2">
                {VARIANT_LABELS.map((l) => {
                  const sl = slots[l]
                  const savedRow = savedRows.find((r) => r.variantLabel === l)
                  return (
                    <button
                      key={l} type="button" role="tab" aria-selected={active === l}
                      onClick={() => preklopiVarianto(l)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
                        active === l ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-foreground/30'
                      )}
                    >
                      Varianta {l}
                      {savedRow?.status === 'IZBRANA' ? <Badge className="bg-emerald-600">izbrana</Badge> :
                        savedRow?.status === 'ARHIV' ? <Badge variant="secondary">arhiv</Badge> :
                        sl.savedId ? <Badge variant="outline">shranjena</Badge> : null}
                    </button>
                  )
                })}
                <p className="text-xs text-muted-foreground">Vsaka varianta ima svojo konfiguracijo — stari posnetki se ne prepisujejo.</p>
              </div>

              {params ? (
                <>
                  <div className="relative overflow-hidden rounded-lg border bg-muted">
                    <canvas ref={compareRef} className="block h-auto w-full" role="img" aria-label="Primerjava PREJ in POTEM" />
                    <span className="pointer-events-none absolute left-2 top-2 rounded bg-background/85 px-2 py-0.5 text-xs font-bold">PREJ</span>
                    <span className="pointer-events-none absolute right-2 top-2 rounded bg-background/85 px-2 py-0.5 text-xs font-bold">POTEM</span>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pv-slider" className="flex items-center justify-between text-xs font-semibold">
                      <span>PREJ / POTEM</span>
                      <span className="text-muted-foreground">{comparePos} %</span>
                    </Label>
                    <Slider
                      id="pv-slider" min={0} max={100} step={1} value={[comparePos]}
                      onValueChange={(v) => setComparePos(v[0] ?? 50)}
                      aria-label="Premik med PREJ in POTEM"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="pv-ghost" className="flex items-center justify-between text-xs font-semibold">
                        <span>Ghost pogled (prosojnost nove ograje)</span>
                        <span className="text-muted-foreground">{ghost ? `${ghostOpacity} %` : 'izklopljen'}</span>
                      </Label>
                      <div className="flex items-center gap-2">
                        <Switch id="pv-ghost-switch" checked={ghost} onCheckedChange={setGhost} aria-label="Vklopi ghost pogled" />
                        <Slider
                          id="pv-ghost" min={10} max={95} step={5} value={[ghostOpacity]}
                          onValueChange={(v) => setGhostOpacity(v[0] ?? 55)}
                          disabled={!ghost}
                          aria-label="Prosojnost nove ograje"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pv-note" className="text-xs font-semibold">Opomba variante</Label>
                      <Input id="pv-note" className="h-11" placeholder="npr. Varianta s pokončnimi lamelami" value={slot.note} onChange={(e) => updateSlot((s) => ({ ...s, note: e.target.value }))} />
                    </div>
                  </div>

                  {/* akcije */}
                  <div className="flex flex-wrap gap-2">
                    {canWrite ? (
                      <Button type="button" className="h-11" onClick={() => { void shrani() }} disabled={saveBusy || !product}>
                        {saveBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                        {slot.savedId ? `Posodobi varianto ${active} (nova verzija)` : `Shrani varianto ${active}`}
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" className="h-11" onClick={() => { void izvozi('png') }} disabled={exportBusy !== null}>
                      {exportBusy === 'png' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />} Izvozi POTEM (PNG)
                    </Button>
                    <Button type="button" variant="outline" className="h-11" onClick={() => { void izvozi('primerjava') }} disabled={exportBusy !== null}>
                      {exportBusy === 'primerjava' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileImage className="size-4" aria-hidden />} Izvozi PREJ/POTEM
                    </Button>
                    {slot.savedId ? (
                      <>
                        <Button type="button" variant="outline" className="h-11" onClick={() => { void izvoziPdf() }} disabled={exportBusy !== null}>
                          {exportBusy === 'pdf' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileImage className="size-4" aria-hidden />} PDF dokument
                        </Button>
                        <Button type="button" variant="outline" className="h-11" onClick={vKonfigurator}>
                          <Wand2 className="size-4" aria-hidden /> Uporabi v konfiguratorju
                        </Button>
                      </>
                    ) : null}
                  </div>
                </>
              ) : (
                <EmptyState title="Manjkajo podatki za izris" desc="Dokončajte oznake in izberite izdelek." icon={Eye} />
              )}

              {/* shranjene variante */}
              <div className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Layers className="size-4 text-roksal-amber" aria-hidden /> Shranjene vizualizacije projekta</h3>
                {savedList.loading ? <LoadingRows rows={2} /> : savedList.error ? <ErrorBox error={savedList.error} /> : savedRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Za ta projekt še ni shranjenih vizualizacij.</p>
                ) : (
                  <ul className="max-h-96 space-y-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                    {savedRows.map((r) => (
                      <li key={r.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                              Varianta {r.variantLabel}
                              <StatusBadge status={r.status === 'IZBRANA' ? 'POTRJENO' : r.status === 'ARHIV' ? 'ZAKLJUCEN' : 'AKTIVNI'} />
                              <span className="text-xs font-normal text-muted-foreground">v{r._count.versions} · {fmtDate(r.updatedAt)}</span>
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {r.product?.name ?? r.productId}{r.variant ? ` · ${r.variant.name}${r.variant.ral ? ` (${r.variant.ral})` : ''}` : ''}
                              {r.measurementId ? ` · meritev v${r.measurementVersion ?? 1}` : ''} · {r.author?.name ?? '—'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Button type="button" size="sm" variant="outline" className="h-9" disabled={rowBusy === r.id} onClick={() => { void odpri(r.id) }}>
                              {rowBusy === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FolderKanban className="size-3.5" aria-hidden />} Odpri
                            </Button>
                            {canWrite && r.status !== 'IZBRANA' ? (
                              <Button type="button" size="sm" variant="outline" className="h-9" disabled={rowBusy === r.id} onClick={() => { void nastaviStatus(r.id, 'IZBRANA') }}>
                                <Check className="size-3.5" aria-hidden /> Izberi
                              </Button>
                            ) : null}
                            {canWrite && r.status !== 'ARHIV' ? (
                              <Button type="button" size="sm" variant="ghost" className="h-9 text-muted-foreground hover:text-red-600" disabled={rowBusy === r.id} onClick={() => { void nastaviStatus(r.id, 'ARHIV') }}>
                                <Trash2 className="size-3.5" aria-hidden /> Arhiviraj
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {/* opozorila kakovosti (§1) */}
          {vsaOpozorila.length > 0 && step >= 2 ? (
            <ul className="mt-4 space-y-1.5" aria-label="Opozorila kakovosti vizualizacije">
              {vsaOpozorila.map((w) => (
                <li key={w.koda} className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{w.sporocilo}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {/* navigacija */}
          <div className="mt-5 flex items-center justify-between gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              <ArrowLeft className="size-4" aria-hidden /> Nazaj
            </Button>
            <p className="hidden text-xs text-muted-foreground sm:block">{project ? `${project.code} — ${project.title}` : ''}</p>
            {step < STEPS.length - 1 ? (
              <Button
                type="button" className="h-11"
                onClick={() => { if (korakOk(step).ok) setStep((s) => s + 1) }}
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

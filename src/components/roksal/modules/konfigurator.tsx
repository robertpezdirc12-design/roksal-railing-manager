'use client'

// KONFIGURATOR — R447 (issue #7 §5, P2 KONFIGURATORJI za teraso/ograjo/fasado/pregrado/napušč)
// Splošni tok: PROJEKT → PRODUCT → VARIANT → MEASUREMENTS → COLOR/OPTIONS → CALCULATE
//              → BOM → STOCK CHECK → PRICE/MARGIN → QUOTE.
// Osnova je produktno jedro R442 (planBom iz predlog ProductComponent, cene iz cenikov)
// — NIČ hardcoded poslovnih cen (issue #7 §15). 3D vizualizacija (viz-3d.tsx) ostaja
// ločen modul; ta konfigurator pokriva vse družine brez 3D zahteve.
// NADOMEŠČA stari "Kalkulator" (ta je imel hardcoded poslovne cene — kršitev §15;
// R464: tudi viz/3D ocene so odstranjene iz UI kode in živijo v ceniku).
// Vrata: quotes.create (pisarna ADMIN/VODJA) — monter zavihka sploh ne vidi.
// Ciljna IA §11 (preselitev iz sekcije ZAJEM) pride z R448.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Calculator, CheckCircle2, Circle, ClipboardList, Download, FolderKanban, Image as ImageIcon, Layers, Loader2,
  Package, Palette, Plus, RotateCcw, Ruler, Save, Trash2, TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiGet, apiPost, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader, StatusBadge } from '@/components/roksal/ui-bits'
import { cn } from '@/lib/utils'

// ─── Koraki čarovnika (tok §5) ────────────────────────────────────────────────

const STEPS = [
  { key: 'projekt', label: 'Projekt', icon: FolderKanban },
  { key: 'izdelek', label: 'Izdelek', icon: Package },
  { key: 'meritve', label: 'Meritve', icon: Ruler },
  { key: 'opcije', label: 'Barva / opcije', icon: Palette },
  { key: 'izracun', label: 'Izračun', icon: Calculator },
  { key: 'shrani', label: 'Shrani', icon: Save },
] as const

const STEP_HINTS = [
  'Paket vedno pripada projektu — izberite obstoječega ali ga ustvarite v Projektih.',
  'Družina → izdelek → varianta (barva / RAL). Cena se razreši iz cenika ob izračunu.',
  'Družinski vhodni obrazec po merilih iz issue #7 §4.',
  'Varianta + neobvezne komponente iz BOM predloge.',
  'Dry-run izračun: kosovnica, zaloga, cena in marža — nič se še ne shrani.',
  'Ustvari paket (KONFIGURACIJA) z opcijo kosovnice in osnutka ponudbe.',
]

// ─── Družinski obrazci (issue #7 §4 — vhodi po družinah) ──────────────────────

/** Preslikava družina → vrsta vhodnega obrazca. */
function formTypeOf (familyCode: string): 'm2' | 'm' | 'kos' {
  if (familyCode === 'OGRAJA_PRECNA' || familyCode === 'OGRAJA_POKOCNA') return 'm'
  if (familyCode === 'STOPNICE' || familyCode === 'VRTNA_RESITEV' || familyCode === 'KOMPONENTA') return 'kos'
  return 'm2' // TERASA | FASADA | PREGRADA | NAPUSC | STROP
}

const PODLAGE_TERASA = [
  'Beton',
  'Estrih',
  'Pesek / dražena podlaga',
  'Lesena podkonstrukcija',
  'Alu podkonstrukcija',
]

const NACINI_PRITRDITVE = [
  { value: 'TALNA', label: 'Talna pritrditev (vijaki v podlago)' },
  { value: 'STEBRI_V_BETON', label: 'Stebri v beton' },
  { value: 'BOCNA_NA_STENO', label: 'Bočna pritrditev na steno' },
]

const CLOSED_PROJECT_STATUSES = ['ZAKLJUCEN', 'ARHIV']

// ─── Tipi ─────────────────────────────────────────────────────────────────────

interface ProjectRow {
  id: string; code: string; title: string; status: string
  customer: { name: string; city: string | null } | null
}
interface FamilyRow { id: string; code: string; name: string; unit: string }
interface VariantRow {
  id: string; sku: string; name: string; color: string | null; ral: string | null
  salePrice: number | null
}
interface ProductRow {
  id: string; sku: string; name: string; unit: string; salePrice: number
  family: { code: string; name: string; unit: string }
  variants: VariantRow[]
  _count: { components: number; packages: number }
}
interface ProductDetail extends ProductRow {
  components: {
    id: string; qty: number; unitBasis: string; optional: boolean; note: string | null
    item: { sku: string; name: string; unit: string }
  }[]
}
interface PlanLine {
  itemId: string; sku: string; name: string; unit: string
  qty: number; optional: boolean; note: string | null
  unitCost: number; lineCost: number
  stockQty: number; covered: boolean; missing: number
  segmentKey: string | null; group: string | null; wastePct: number | null; sourceRule: string | null // R475
}
interface PlanData {
  product: { id: string; sku: string; name: string; unit: string }
  variant: { id: string; sku: string; name: string } | null
  qty: number; unit: string
  lines: PlanLine[]
  materialCost: number; salePriceUnit: number; montazaUnit: number
  totalSale: number; totalCost: number; margin: number; marginPct: number
  priceSource: string
  segmentsApplied: number; warnings: { code: string; message: string }[]; segmentEngine: string | null // R475
  family: { code: string; name: string; unit: string }
}

interface Seg2 { id: number; len: string; wid: string }
interface SegM { id: number; len: string; h: string }
interface Odb { id: number; opis: string; m2: string }

interface SaveResult {
  packageId: string; packageCode: string
  bomCode: string | null; quoteCode: string | null
}

// ─── Pomočniki ────────────────────────────────────────────────────────────────

/** Toleranten numerični vnos (sprejme tudi decimalno vejico — SI navada). */
function parseNum (s: string): number {
  const v = Number(String(s).trim().replace(',', '.'))
  return Number.isFinite(v) ? v : NaN
}
const round2 = (n: number) => Math.round(n * 100) / 100
const pos = (n: number) => Number.isFinite(n) && n > 0

// ─── Modul ────────────────────────────────────────────────────────────────────

export default function KonfiguratorModule () {
  const setTab = useAppStore((s) => s.setTab)
  const photoVizId = useAppStore((s) => s.photoVizId)
  const setPhotoVizIdStore = useAppStore((s) => s.setPhotoVizId)
  const { toast } = useToast()

  const [step, setStep] = useState(0)
  const [projectId, setProjectId] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [familyCode, setFamilyCode] = useState('all')
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')

  // ── meritve (družinski obrazec) ──
  const [segs2, setSegs2] = useState<Seg2[]>([{ id: 1, len: '', wid: '' }])
  const [segsM, setSegsM] = useState<SegM[]>([{ id: 1, len: '', h: '' }])
  const [odbitki, setOdbitki] = useState<Odb[]>([])
  const [podlaga, setPodlaga] = useState(PODLAGE_TERASA[0])
  const [visinske, setVisinske] = useState('')
  const [padec, setPadec] = useState('')
  const [robovi, setRobovi] = useState('')
  const [razmik, setRazmik] = useState('')
  const [vrata, setVrata] = useState('')
  const [nacin, setNacin] = useState(NACINI_PRITRDITVE[0].value)
  const [kosQty, setKosQty] = useState('1')
  const [opombe, setOpombe] = useState('')
  const [qtyManual, setQtyManual] = useState('')

  // ── opcije / izračun / shrani ──
  const [includeOptional, setIncludeOptional] = useState(true)
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [calcBusy, setCalcBusy] = useState(false)
  const [calcError, setCalcError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [genBom, setGenBom] = useState(true)
  const [genQuote, setGenQuote] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [result, setResult] = useState<SaveResult | null>(null)

  const segId = useRef(1)
  const nextSegId = () => ++segId.current
  const vizPrefillDone = useRef<string | null>(null)
  const [vizBusy, setVizBusy] = useState(false)

  // ── podatki ──
  const projects = useApi<{ data: ProjectRow[] }>('/api/projects?limit=500')
  const families = useApi<{ data: FamilyRow[] }>('/api/product-families')
  const products = useApi<{ data: ProductRow[] }>(`/api/products?family=${familyCode}`, [familyCode])
  const detail = useApi<{ data: ProductDetail }>(productId ? `/api/products/${productId}` : null, [productId])

  const projectRows = projects.data?.data ?? []
  const openProjects = projectRows.filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status))
  const projectChoices = showClosed ? projectRows : openProjects
  const project = projectRows.find((p) => p.id === projectId) ?? null

  const prodRows = products.data?.data ?? []
  const product = prodRows.find((p) => p.id === productId) ?? null
  const variant = product?.variants.find((v) => v.id === variantId) ?? null
  const family = product?.family ?? null
  const formType: 'm2' | 'm' | 'kos' = family ? formTypeOf(family.code) : 'm2'

  // ── izračun količine iz vhodov ──
  const computedQty = useMemo(() => {
    if (formType === 'm2') {
      const bruto = segs2.reduce((s, g) => s + (pos(parseNum(g.len)) && pos(parseNum(g.wid)) ? parseNum(g.len) * parseNum(g.wid) : 0), 0)
      if (family?.code === 'FASADA') {
        const od = odbitki.reduce((s, o) => s + (pos(parseNum(o.m2)) ? parseNum(o.m2) : 0), 0)
        return round2(Math.max(0, bruto - od))
      }
      return round2(bruto)
    }
    if (formType === 'm') {
      return round2(segsM.reduce((s, g) => s + (pos(parseNum(g.len)) ? parseNum(g.len) : 0), 0))
    }
    const k = parseNum(kosQty)
    return pos(k) ? round2(k) : 0
  }, [formType, family?.code, segs2, segsM, odbitki, kosQty])

  const manualQty = parseNum(qtyManual)
  const manualActive = pos(manualQty)
  const effectiveQty = manualActive ? round2(manualQty) : computedQty

  const brutoM2 = useMemo(
    () => round2(segs2.reduce((s, g) => s + (pos(parseNum(g.len)) && pos(parseNum(g.wid)) ? parseNum(g.len) * parseNum(g.wid) : 0), 0)),
    [segs2],
  )
  const odbitkiM2 = useMemo(
    () => round2(odbitki.reduce((s, o) => s + (pos(parseNum(o.m2)) ? parseNum(o.m2) : 0), 0)),
    [odbitki],
  )

  // sprememba relevantnih vhodov → izračun ni več aktualen
  useEffect(() => { setPlan(null); setCalcError(null) }, [productId, variantId, effectiveQty, includeOptional])

  // ── ravnanje ──

  /**
   * R459 (issue #14 §14): prefill iz shranjene FOTO-VIZUALIZACIJE — projekt,
   * družina, izdelek, varianta in segmenti se prevzamejo po EKSPlicitnih ID
   * povezavah (brez ponovnega ročnega vnosa konfiguracije).
   */
  async function prefillFromPhotoViz (id: string): Promise<void> {
    setVizBusy(true)
    try {
      const res = await apiGet<{
        data: {
          id: string; projectId: string; variantId: string | null; renderParams: string
          product: { id: string; sku: string; name: string; family: { code: string; name: string } }
          variant: { id: string; name: string } | null
        }
      }>(`/api/photo-visualization/${id}`)
      const d = res.data
      let cfg: { config?: { lengthCm?: number; heightCm?: number } } = {}
      try { cfg = JSON.parse(d.renderParams) as typeof cfg } catch { /* brez segmentov */ }
      setProjectId(d.projectId)
      setFamilyCode(d.product.family.code)
      setProductId(d.product.id)
      setVariantId(d.variantId ?? '')
      setName('')
      const len = typeof cfg.config?.lengthCm === 'number' && cfg.config.lengthCm > 0 ? cfg.config.lengthCm : null
      const h = typeof cfg.config?.heightCm === 'number' && cfg.config.heightCm > 0 ? cfg.config.heightCm : null
      if (len) {
        setSegsM([{ id: nextSegId(), len: String(round2(len / 100)), h: h ? String(round2(h / 100)) : '' }])
      }
      setStep(2) // meritve — uporabnik nadaljuje tok do izračuna/ponudbe
      toast({
        title: 'Konfiguracija prevzeta iz foto-vizualizacije.',
        description: `${d.product.name}${d.variant ? ` · ${d.variant.name}` : ''} — segmenti so predpolnjeni.`,
      })
    } catch (e) {
      toast({ title: 'Prevzem foto-vizualizacije ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setVizBusy(false)
    }
  }

  /** Prevezjava iz Foto vizualizacije (store) — enkraten prefill ob vstopu. */
  useEffect(() => {
    if (!photoVizId || vizPrefillDone.current === photoVizId) return
    vizPrefillDone.current = photoVizId
    const id = photoVizId
    setPhotoVizIdStore(null)
    void prefillFromPhotoViz(id)
  }, [photoVizId, setPhotoVizIdStore])

  /** Ročni prevzem: izbrana (ali zadnja) vizualizacija izbranega projekta. */
  async function prefillFromProjectViz (): Promise<void> {
    if (!projectId) {
      toast({ title: 'Najprej izberite projekt.', description: 'Foto-vizualizacije so vezane na projekt.', variant: 'destructive' })
      return
    }
    setVizBusy(true)
    try {
      const res = await apiGet<{ data: { id: string; status: string; variantLabel: string }[] }>(`/api/photo-visualization?projectId=${projectId}`)
      const rows = res.data ?? []
      if (rows.length === 0) {
        toast({ title: 'Ta projekt nima foto-vizualizacij.', description: 'Ustvarite jo v zavihku Foto vizualizacija.' })
        return
      }
      const izbrana = rows.find((r) => r.status === 'IZBRANA') ?? rows[0]
      await prefillFromPhotoViz(izbrana.id)
    } catch (e) {
      toast({ title: 'Prevzem foto-vizualizacije ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setVizBusy(false)
    }
  }

  function resetMeasurements () {
    setSegs2([{ id: nextSegId(), len: '', wid: '' }])
    setSegsM([{ id: nextSegId(), len: '', h: '' }])
    setOdbitki([])
    setPodlaga(PODLAGE_TERASA[0])
    setVisinske(''); setPadec(''); setRobovi('')
    setRazmik(''); setVrata('')
    setNacin(NACINI_PRITRDITVE[0].value)
    setKosQty('1'); setOpombe(''); setQtyManual('')
  }

  function selectProduct (id: string) {
    const p = prodRows.find((x) => x.id === id) ?? null
    const prevForm = product ? formTypeOf(product.family.code) : null
    const newForm = p ? formTypeOf(p.family.code) : null
    setProductId(id)
    setVariantId('')
    setName('') // ponovno predpolnjenje ob vstopu v korak Shrani
    if (prevForm !== newForm) resetMeasurements()
  }

  async function calc () {
    if (!product || !(effectiveQty > 0)) return
    setCalcBusy(true); setCalcError(null)
    try {
      // R475: m-forma pošlje SEGMENTE (s ključi seg-N) + razmik — komponente z
      // segmentno vlogo dobijo količine PO ODSEKU (stebri/ročnik/polnilo+odpad)
      const segBody = formType === 'm'
        ? { segments: buildSegmentsM(), ...(pos(parseNum(razmik)) ? { razmikStebrovM: parseNum(razmik) } : {}) }
        : {}
      const res = await apiPost<{ data: PlanData }>('/api/project-packages/plan', {
        productId: product.id,
        variantId: variantId || null,
        qty: effectiveQty,
        includeOptional,
        ...segBody,
      })
      setPlan(res.data)
    } catch (e) {
      setCalcError(e instanceof Error ? e.message : 'Izračun ni uspel.')
    } finally { setCalcBusy(false) }
  }

  function gotoStep (i: number) {
    const target = Math.max(0, Math.min(STEPS.length - 1, i))
    // vstop v Izračun: samodejni dry-run, če še ni aktualen
    if (STEPS[target].key === 'izracun' && !plan && !calcBusy && product && effectiveQty > 0) void calc()
    // predpolnitev prikaznega imena (npr. „Terase — WPC terasa Standard 150×25 (Grafit)“)
    if (STEPS[target].key === 'shrani' && product && !name) {
      setName(`${family?.name ?? product.family.name} — ${product.name}${variant ? ` (${variant.name})` : ''}`)
    }
    setStep(target)
  }

  function canProceed (): { ok: boolean; reason?: string } {
    switch (STEPS[step].key) {
      case 'projekt': return projectId ? { ok: true } : { ok: false, reason: 'Izberite projekt — paket brez projekta ni mogoč.' }
      case 'izdelek': return productId ? { ok: true } : { ok: false, reason: 'Izberite izdelek iz kataloga.' }
      case 'meritve': return effectiveQty > 0
        ? { ok: true }
        : { ok: false, reason: formType === 'm2' ? 'Dodajte vsaj en celoten segment (dolžina × širina).' : formType === 'm' ? 'Dodajte vsaj en segment z dolžino.' : 'Vnesite količino.' }
      case 'opcije': return { ok: true }
      case 'izracun': return plan ? { ok: true } : { ok: false, reason: 'Najprej izvedite izračun.' }
      default: return { ok: false }
    }
  }

  function next () {
    const c = canProceed()
    if (!c.ok) { toast({ title: 'Korak ni zaključen', description: c.reason, variant: 'destructive' }); return }
    gotoStep(step + 1)
  }

  /** R475: segmenti m-forme s KLJUČI seg-N (vezava vrstic BOM ← segment). */
  function buildSegmentsM (): { kljuc: string; dolzina: number; visina: number | null }[] {
    return segsM
      .filter((g) => pos(parseNum(g.len)))
      .map((g, i) => ({
        kljuc: `seg-${i + 1}`,
        dolzina: parseNum(g.len),
        visina: pos(parseNum(g.h)) ? parseNum(g.h) : null,
      }))
  }

  /** Strukturirani vhodi → paket.calcJson.inputs (issue #7 §4). */
  function buildInputs (): Record<string, unknown> {
    const inputs: Record<string, unknown> = {
      familyCode: family?.code ?? null,
      form: formType,
      qty: effectiveQty,
      qtySource: manualActive ? 'rocno' : 'izracunano',
    }
    if (formType === 'm2') {
      inputs.segments = segs2
        .filter((g) => pos(parseNum(g.len)) && pos(parseNum(g.wid)))
        .map((g) => ({ dolzina: parseNum(g.len), sirina: parseNum(g.wid), povrsina: round2(parseNum(g.len) * parseNum(g.wid)) }))
      if (family?.code === 'FASADA') {
        inputs.brutoM2 = brutoM2
        inputs.odbitki = odbitki
          .filter((o) => pos(parseNum(o.m2)))
          .map((o) => ({ opis: o.opis.trim() || 'Odbitek', m2: parseNum(o.m2) }))
        inputs.netoM2 = effectiveQty
      }
      if (family?.code === 'TERASA') {
        inputs.podlaga = podlaga
        if (visinske.trim()) inputs.visinskeRazlike = visinske.trim()
        if (pos(parseNum(padec))) inputs.padecPct = parseNum(padec)
        if (pos(parseNum(robovi))) inputs.roboviM = parseNum(robovi)
      }
      if (family?.code === 'PREGRADA' && pos(parseNum(vrata))) inputs.vrataKos = Math.trunc(parseNum(vrata))
    } else if (formType === 'm') {
      inputs.segments = buildSegmentsM()
      if (pos(parseNum(razmik))) inputs.razmikStebrovM = parseNum(razmik)
      if (pos(parseNum(vrata))) inputs.vrataKos = Math.trunc(parseNum(vrata))
      inputs.nacinPritrditve = nacin
    } else {
      inputs.kolicina = effectiveQty
    }
    if (opombe.trim()) inputs.opombe = opombe.trim()
    return inputs
  }

  async function save () {
    if (!project || !product || !plan || !(effectiveQty > 0)) return
    setSaveBusy(true)
    try {
      const pkgRes = await apiPost<{ data: { id: string; code: string } }>('/api/project-packages', {
        projectId: project.id,
        productId: product.id,
        variantId: variantId || null,
        name: name.trim() || undefined,
        qty: effectiveQty,
        unit: product.unit,
        status: 'KONFIGURACIJA',
        note: note.trim() || undefined,
        calcJson: { inputs: buildInputs(), plan },
      })
      const out: SaveResult = { packageId: pkgRes.data.id, packageCode: pkgRes.data.code, bomCode: null, quoteCode: null }

      if (genBom && plan.lines.length > 0) {
        try {
          const bomRes = await apiPost<{ data: { bom: { code: string } } }>(`/api/project-packages/${pkgRes.data.id}/bom`, { includeOptional })
          out.bomCode = bomRes.data.bom.code
        } catch (e) {
          toast({ title: 'Kosovnica ni bila generirana', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
        }
      }
      if (genQuote) {
        try {
          // prosta pozicija po obliki /api/quotes: ena pozicija = produkt (+ varianta),
          // cena na enoto = prodajna + montaža (DDV 22 % doda strežnik)
          const unitPrice = round2(plan.salePriceUnit + plan.montazaUnit)
          const qRes = await apiPost<{ data: { code: string } }>('/api/quotes', {
            projectId: project.id,
            packageId: pkgRes.data.id,
            note: `Konfigurator — paket ${pkgRes.data.code}`,
            lines: [{
              description: `${product.name}${variant ? ` — ${variant.name}` : ''} (${variant?.sku ?? product.sku})`,
              qty: plan.qty,
              unitPrice,
            }],
          })
          out.quoteCode = qRes.data.code
        } catch (e) {
          toast({ title: 'Osnutek ponudbe ni bil ustvarjen', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
        }
      }

      setResult(out)
      toast({
        title: `Paket ${out.packageCode} ustvarjen.`,
        description: [
          `Projekt ${project.code} · status KONFIGURACIJA`,
          out.bomCode ? `kosovnica ${out.bomCode}` : null,
          out.quoteCode ? `osnutek ponudbe ${out.quoteCode}` : null,
        ].filter(Boolean).join(' · '),
      })
    } catch (e) {
      toast({ title: 'Ustvarjanje paketa ni uspelo', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setSaveBusy(false) }
  }

  function resetAll () {
    setStep(0); setProjectId(''); setShowClosed(false)
    setFamilyCode('all'); setProductId(''); setVariantId('')
    resetMeasurements()
    setIncludeOptional(true); setPlan(null); setCalcError(null)
    setName(''); setNote(''); setGenBom(true); setGenQuote(false)
    setResult(null)
  }

  const optionalComps = (detail.data?.data?.components ?? []).filter((c) => c.optional)
  const requiredCount = (detail.data?.data?.components ?? []).filter((c) => !c.optional).length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Konfigurator"
        desc="Produkt → izmera → izračun → paket s kosovnico in ponudbo (vse družine, cene iz cenikov)"
        actions={!result && (step > 0 || productId) ? (
          <Button size="sm" variant="outline" className="h-11" onClick={resetAll}>
            <RotateCcw className="size-4" aria-hidden /> Ponastavi
          </Button>
        ) : null}
      />

      {/* lepljivi stepper — vodoravno drsenje na ozkih zaslonih (vzorec MOJ DAN) */}
      <div
        className="sticky top-14 z-20 -mx-1 rounded-xl border bg-background/95 px-2 py-2 backdrop-blur"
        role="group"
        aria-label={`Koraki konfiguratorja — trenutno ${STEPS[step].label}`}
      >
        {/* relative: sr-only vsebina kovčkov mora ostati znotraj drsečega območja ol */}
        <ol className="relative flex items-stretch gap-1 overflow-x-auto pb-1" aria-label="Koraki konfiguracije">
          {STEPS.map((s, i) => {
            const done = i < step
            const current = i === step
            const Icon = s.icon
            return (
              <li key={s.key} className="flex shrink-0 items-center gap-1" aria-current={current ? 'step' : undefined}>
                <button
                  type="button"
                  onClick={() => { if (i <= step) gotoStep(i) }}
                  disabled={i > step}
                  aria-disabled={i > step}
                  title={`${s.label} — ${done ? 'opravljeno' : current ? 'trenutni korak' : 'pred nami'}`}
                  className={cn(
                    'flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    done && 'bg-roksal-green/15 text-roksal-green',
                    current && 'bg-roksal-amber/20 text-roksal-amber ring-1 ring-roksal-amber/50',
                    !done && !current && 'bg-secondary/60 text-muted-foreground',
                    i <= step && 'hover:bg-secondary',
                  )}
                >
                  {done ? <CheckCircle2 className="size-4 shrink-0" aria-hidden /> : <Icon className="size-4 shrink-0" aria-hidden />}
                  <span className="whitespace-nowrap">{i + 1}. {s.label}</span>
                  <span className="sr-only"> — {done ? 'opravljeno' : current ? 'trenutni korak' : 'pred nami'}</span>
                </button>
                {i < STEPS.length - 1 ? <span aria-hidden className="text-muted-foreground/60">›</span> : null}
              </li>
            )
          })}
        </ol>
      </div>

      {result ? (
        <SaveResultPanel
          result={result}
          projectCode={project?.code ?? ''}
          onNew={resetAll}
          onOpenProjects={() => setTab('projekti')}
          onOpenBom={() => setTab('material-v5')}
        />
      ) : (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <p className="mb-4 text-xs text-muted-foreground">{STEP_HINTS[step]}</p>

            {STEPS[step].key === 'projekt' ? (
              <StepProjekt
                projects={projectChoices}
                total={projectRows.length}
                loading={projects.loading}
                error={projects.error}
                projectId={projectId}
                showClosed={showClosed}
                selected={project}
                onSelect={setProjectId}
                onToggleClosed={() => setShowClosed((v) => !v)}
              />
            ) : null}

            {STEPS[step].key === 'izdelek' ? (
              <div className="space-y-3">
                {projectId ? (
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="outline" className="h-10" disabled={vizBusy} onClick={() => { void prefillFromProjectViz() }}>
                      {vizBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImageIcon className="size-4" aria-hidden />}
                      Prevzemi iz foto-vizualizacije
                    </Button>
                  </div>
                ) : null}
                <StepIzdelek
                  families={families.data?.data ?? []}
                  products={prodRows}
                  loading={products.loading}
                  error={products.error}
                  familyCode={familyCode}
                  productId={productId}
                  variantId={variantId}
                  onFamily={(v) => { setFamilyCode(v); setProductId(''); setVariantId('') }}
                  onProduct={selectProduct}
                  onVariant={setVariantId}
                />
              </div>
            ) : null}

            {STEPS[step].key === 'meritve' && product ? (
              <StepMeritve
                familyCode={product.family.code}
                formType={formType}
                unit={product.unit}
                segs2={segs2} setSegs2={setSegs2}
                projectId={projectId}
                segsM={segsM} setSegsM={setSegsM}
                odbitki={odbitki} setOdbitki={setOdbitki}
                podlaga={podlaga} setPodlaga={setPodlaga}
                visinske={visinske} setVisinske={setVisinske}
                padec={padec} setPadec={setPadec}
                robovi={robovi} setRobovi={setRobovi}
                razmik={razmik} setRazmik={setRazmik}
                vrata={vrata} setVrata={setVrata}
                nacin={nacin} setNacin={setNacin}
                kosQty={kosQty} setKosQty={setKosQty}
                opombe={opombe} setOpombe={setOpombe}
                qtyManual={qtyManual} setQtyManual={setQtyManual}
                computedQty={computedQty}
                brutoM2={brutoM2}
                odbitkiM2={odbitkiM2}
                effectiveQty={effectiveQty}
                manualActive={manualActive}
                nextSegId={nextSegId}
              />
            ) : null}

            {STEPS[step].key === 'opcije' && product ? (
              <StepOpcije
                product={product}
                variantId={variantId}
                onVariant={setVariantId}
                optionalComps={optionalComps}
                requiredCount={requiredCount}
                includeOptional={includeOptional}
                onIncludeOptional={setIncludeOptional}
                loading={detail.loading}
                error={detail.error}
              />
            ) : null}

            {STEPS[step].key === 'izracun' && product ? (
              <StepIzracun
                plan={plan}
                busy={calcBusy}
                error={calcError}
                onRecalc={() => void calc()}
                familyLabel={family?.name ?? ''}
              />
            ) : null}

            {STEPS[step].key === 'shrani' && product && plan ? (
              <StepShrani
                project={project}
                product={product}
                variant={variant}
                plan={plan}
                name={name} setName={setName}
                note={note} setNote={setNote}
                genBom={genBom} setGenBom={setGenBom}
                genQuote={genQuote} setGenQuote={setGenQuote}
                busy={saveBusy}
                onSave={() => void save()}
              />
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-col gap-2 border-t p-4 sm:flex-row sm:justify-between">
            <Button
              variant="outline" className="h-11 w-full sm:w-auto" onClick={() => gotoStep(step - 1)} disabled={step === 0}
            >
              Nazaj
            </Button>
            {step < STEPS.length - 1 ? (
              <Button className="h-11 w-full sm:w-auto" onClick={next}>
                Naprej — {STEPS[step + 1].label}
              </Button>
            ) : (
              <Button className="h-11 w-full sm:w-auto" onClick={() => void save()} disabled={saveBusy || !plan}>
                {saveBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                {saveBusy ? 'Ustvarjam …' : 'Ustvari paket'}
              </Button>
            )}
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

// ─── 1. PROJEKT ───────────────────────────────────────────────────────────────

function StepProjekt ({ projects, total, loading, error, projectId, showClosed, selected, onSelect, onToggleClosed }: {
  projects: ProjectRow[]
  total: number
  loading: boolean
  error: { message: string; detail?: string } | null
  projectId: string
  showClosed: boolean
  selected: ProjectRow | null
  onSelect: (id: string) => void
  onToggleClosed: () => void
}) {
  return (
    <section aria-label="Izbira projekta" className="space-y-4">
      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={2} /> : !error ? (
        projects.length === 0 ? (
          <EmptyState
            title="Ni odprtih projektov"
            desc={showClosed ? 'V bazi ni projektov — najprej ustvarite projekt v modulu Projekti.' : 'Odprli ste samo aktivne projekte — vklopite tudi zaključene/arhivirane ali ustvarite novega v modulu Projekti.'}
            icon={FolderKanban}
          />
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="konf-projekt">Projekt (obvezno)</Label>
              <Select value={projectId || 'none'} onValueChange={(v) => { if (v !== 'none') onSelect(v) }}>
                <SelectTrigger id="konf-projekt" className="h-11" aria-label="Izberite projekt">
                  <SelectValue placeholder="Izberite projekt" />
                </SelectTrigger>
                <SelectContent>
                  {/* sentinel drži select kontroliran tudi pred izbiro (Radix ne sprejema praznega value) */}
                  <SelectItem value="none" disabled>— izberite projekt —</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.title} ({p.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border p-3">
              <Switch checked={showClosed} onCheckedChange={onToggleClosed} aria-label="Pokaži tudi zaključene in arhivirane projekte" />
              <span className="text-sm">
                Pokaži tudi zaključene / arhivirane
                <span className="ml-1.5 text-xs text-muted-foreground">({projects.length}/{total} prikazanih)</span>
              </span>
            </label>
          </div>
        )
      ) : null}

      {selected ? (
        <div className="space-y-1.5 rounded-xl border bg-secondary/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{selected.code}</span>
            <StatusBadge status={selected.status} />
            <span className="text-sm font-semibold">{selected.title}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.customer ? `${selected.customer.name}${selected.customer.city ? `, ${selected.customer.city}` : ''}` : 'Brez stranke'}
            {' '}· paket se veže na ta projekt ({selected.code})
          </p>
        </div>
      ) : null}
    </section>
  )
}

// ─── 2. IZDELEK (+ varianta) ──────────────────────────────────────────────────

function StepIzdelek ({ families, products, loading, error, familyCode, productId, variantId, onFamily, onProduct, onVariant }: {
  families: FamilyRow[]
  products: ProductRow[]
  loading: boolean
  error: { message: string; detail?: string } | null
  familyCode: string
  productId: string
  variantId: string
  onFamily: (v: string) => void
  onProduct: (id: string) => void
  onVariant: (v: string) => void
}) {
  const selected = products.find((p) => p.id === productId) ?? null
  return (
    <section aria-label="Izbira izdelka" className="space-y-4">
      <ErrorBox error={error} />
      <div className="space-y-2">
        <Label htmlFor="konf-family">Družina (filter)</Label>
        <Select value={familyCode} onValueChange={onFamily}>
          <SelectTrigger id="konf-family" className="h-11" aria-label="Filtriraj po družini">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Vse družine</SelectItem>
            {families.map((f) => <SelectItem key={f.code} value={f.code}>{f.name} ({f.unit})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? <LoadingRows rows={3} /> : !error && products.length === 0 ? (
        <EmptyState title="Ni izdelkov v tej družini" desc="Izberite drugo družino ali dodajte izdelek v Katalogu." icon={Package} />
      ) : !error ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Izdelki">
          {products.map((p) => {
            const isSel = p.id === productId
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onProduct(p.id)}
                  aria-pressed={isSel}
                  className={cn(
                    'flex w-full flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors hover:bg-secondary/50',
                    isSel && 'bg-roksal-amber/5 ring-2 ring-roksal-amber',
                  )}
                >
                  <span className="flex w-full flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                    <span className="text-sm font-bold">
                      {fmtEUR(p.salePrice)}<span className="text-xs font-normal text-muted-foreground"> / {p.unit}</span>
                    </span>
                  </span>
                  <span className="text-sm font-medium leading-snug">{p.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="rounded bg-secondary px-1.5 py-0.5">{p.family.name}</span>
                    {p.variants.length > 0 ? <span className="rounded bg-secondary px-1.5 py-0.5">{p.variants.length} variant</span> : null}
                    {p._count.components > 0
                      ? <span className="rounded bg-secondary px-1.5 py-0.5">{p._count.components} komponent</span>
                      : <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-300">brez BOM predloge</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {selected && selected.variants.length > 0 ? (
        <div className="space-y-2">
          <Label htmlFor="konf-variant">Varianta (barva / RAL)</Label>
          <Select value={variantId || 'none'} onValueChange={onVariant}>
            <SelectTrigger id="konf-variant" className="h-11" aria-label="Izberite varianto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— osnovna (brez variante) —</SelectItem>
              {selected.variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}{v.ral ? ` (${v.ral})` : ''}{v.salePrice != null ? ` — ${fmtEUR(v.salePrice)}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Override cene variante se upošteva prek izračuna (planBom); če velja cenik (PRODAJNA), ima ta prednost.
          </p>
        </div>
      ) : null}
    </section>
  )
}

// ─── 3. MERITVE (družinski vhodni obrazec, issue #7 §4) ───────────────────────

function StepMeritve (p: {
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
   */
  async function prefillFromMeasurements (): Promise<void> {
    if (!p.projectId) {
      toast({ title: 'Najprej izberite projekt.', description: 'Meritve so vezane na projekt (1. korak).', variant: 'destructive' })
      return
    }
    setPrefillBusy(true)
    try {
      const res = await apiGet<{ data: { id: string; type: string; source: string; lengthCm: number | null; heightCm: number | null; location: string | null }[] }>(
        `/api/measurements?projectId=${p.projectId}`
      )
      const rows = (res.data ?? []).filter((m) => m.type !== 'FOTO' && (m.lengthCm ?? 0) > 0)
      if (rows.length === 0) {
        toast({ title: 'Ni potrjenih meritev.', description: 'Za ta projekt še ni potrdjenih meritev z dolžino — izmerite s kamero ali vnesite ročno.' })
        return
      }
      const segs = rows.map((m) => ({
        id: p.nextSegId(),
        len: String(Math.round((m.lengthCm as number) / 10) / 100), // cm → m (2 dec.)
        h: m.heightCm && m.heightCm > 0 ? String(Math.round(m.heightCm) / 100) : '',
      }))
      p.setSegsM(segs)
      toast({
        title: `Prevzetih ${rows.length} meritev iz projekta.`,
        description: 'Segmenti so iz potrjenih meritev (kamera/ročno) — po potrebi jih prilagodite.',
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
          <ul className="space-y-2">
            {p.segs2.map((g, i) => (
              <li key={g.id} className="space-y-2 rounded-lg border p-2.5">
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
              </li>
            ))}
          </ul>
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
            <ul className="space-y-2">
              {p.odbitki.map((o, i) => (
                <li key={o.id} className="space-y-2 rounded-lg border p-2.5">
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
                </li>
              ))}
            </ul>
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
          <ul className="space-y-2">
            {p.segsM.map((g, i) => (
              <li key={g.id} className="space-y-2 rounded-lg border p-2.5">
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
              </li>
            ))}
          </ul>

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

// ─── 4. BARVA / OPCIJE ────────────────────────────────────────────────────────

function StepOpcije ({ product, variantId, onVariant, optionalComps, requiredCount, includeOptional, onIncludeOptional, loading, error }: {
  product: ProductRow
  variantId: string
  onVariant: (v: string) => void
  optionalComps: ProductDetail['components']
  requiredCount: number
  includeOptional: boolean
  onIncludeOptional: (v: boolean) => void
  loading: boolean
  error: { message: string; detail?: string } | null
}) {
  return (
    <section aria-label="Barva in opcije" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="konf-variant-2">Varianta (barva / RAL)</Label>
        {product.variants.length > 0 ? (
          <Select value={variantId || 'none'} onValueChange={onVariant}>
            <SelectTrigger id="konf-variant-2" className="h-11" aria-label="Izberite varianto"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— osnovna (brez variante) —</SelectItem>
              {product.variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}{v.ral ? ` (${v.ral})` : ''}{v.color ? ` · ${v.color}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="rounded-lg border border-dashed p-2.5 text-sm text-muted-foreground">
            Izdelek {product.sku} nima variant — uporabi se osnovna specifikacija (barvanje po RAL prek komponent predloge).
          </p>
        )}
      </div>

      <ErrorBox error={error} />
      {loading ? <LoadingRows rows={2} /> : !error ? (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Layers className="size-4 text-roksal-amber" aria-hidden /> Neobvezne komponente (checklist iz BOM predloge)</h3>
          {optionalComps.length === 0 ? (
            <p className="rounded-lg border border-dashed p-2.5 text-sm text-muted-foreground">
              Ta izdelek nima neobveznih komponent — kosovnica bo vsebovala {requiredCount} obveznih.
            </p>
          ) : (
            <ul className="space-y-1.5" aria-label="Neobvezne komponente">
              {optionalComps.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-11 items-center gap-3 rounded-lg border p-2.5">
                    <Checkbox
                      checked={includeOptional}
                      onCheckedChange={(v) => onIncludeOptional(v === true)}
                      aria-label={`Vključi ${c.item.sku} v kosovnico`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.item.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        <span className="font-mono">{c.item.sku}</span> · {c.qty} {c.unitBasis} na enoto
                        {c.note ? ` · ${c.note}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Predloga ne razlikuje posamičnih neobveznih komponent — vključijo/izključijo se skupaj
            ({requiredCount} obveznih ostaja vedno v kosovnici).
          </p>
        </div>
      ) : null}
    </section>
  )
}

// ─── 5. IZRAČUN (dry-run planBom) ─────────────────────────────────────────────

function StepIzracun ({ plan, busy, error, onRecalc, familyLabel }: {
  plan: PlanData | null
  busy: boolean
  error: string | null
  onRecalc: () => void
  familyLabel: string
}) {
  const missing = plan?.lines.filter((l) => !l.covered) ?? []

  if (busy) return <LoadingRows rows={4} />
  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBox error={{ message: error }} />
        <Button variant="outline" className="h-11" onClick={onRecalc}>
          <Calculator className="size-4" aria-hidden /> Ponovno izračunaj
        </Button>
      </div>
    )
  }
  if (!plan) {
    return (
      <div className="space-y-3">
        <EmptyState title="Ni izračuna" desc="Sprožite dry-run izračun — kosovnica, zaloga, cena in marža." icon={Calculator} />
        <Button className="h-11" onClick={onRecalc}>
          <Calculator className="size-4" aria-hidden /> Izračunaj
        </Button>
      </div>
    )
  }

  return (
    <section aria-label="Rezultat izračuna" className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <SummaryTile label="Količina" value={`${plan.qty} ${plan.unit}`} hint={familyLabel} />
        <SummaryTile label="Material (strošek)" value={fmtEUR(plan.materialCost)} hint={`${plan.lines.length} vrstic BOM${plan.segmentsApplied > 0 ? ` · ${plan.segmentsApplied} segmentov` : ''}`} />
        <SummaryTile label="Prodajna cena / enoto" value={fmtEUR(plan.salePriceUnit)} hint={plan.montazaUnit > 0 ? `vključeno: montaža ${fmtEUR(plan.montazaUnit)}` : `montaža ${fmtEUR(plan.montazaUnit)}`} />
        <SummaryTile label="Skupaj (prodaja)" value={fmtEUR(plan.totalSale)} hint={`(${fmtEUR(plan.salePriceUnit + plan.montazaUnit)} × ${plan.qty})`} />
        <SummaryTile label="Marža — interno" value={`${fmtEUR(plan.margin)} (${plan.marginPct} %)`} hint="vidno samo pisarni" tone="green" />
        <SummaryTile label="Vir cene" value={plan.priceSource} hint={plan.variant ? `varianta ${plan.variant.sku}` : 'brez variante'} />
      </div>

      {/* R475: opozorila segmentne izpeljave (vidna, ne tiha) */}
      {(plan.warnings ?? []).length > 0 ? (
        <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" role="alert">
          <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert className="size-4" aria-hidden /> Opozorila segmentnega izračuna</p>
          <ul className="list-inside list-disc space-y-0.5 text-xs">
            {(plan.warnings ?? []).map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" role="alert">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>{missing.length} {missing.length === 1 ? 'artikel manjka' : 'artiklov manjka'} na zalogi:</strong>{' '}
            {missing.map((l) => `${l.sku} (−${l.missing} ${l.unit})`).join(', ')}. Kosovnico lahko ustvarite — pomanjkanje se pokaže pri rezervaciji.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Vseh {plan.lines.length} artiklov kosovnice je pokritih s trenutno zalogo.</span>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          <ClipboardList className="size-4 text-roksal-amber" aria-hidden />
          {plan.segmentsApplied > 0
            ? <>Kosovnica po segmentih — {plan.segmentsApplied} {plan.segmentsApplied === 1 ? 'odsek' : plan.segmentsApplied < 5 ? 'odseki' : 'odsekov'}</>
            : <>Kosovnica (predloga × {plan.qty} {plan.unit})</>}
        </h3>
        <ul className="space-y-1.5">
          {plan.lines.map((l, i) => (
            <li key={`${l.itemId}-${l.segmentKey ?? 'x'}-${i}`} className="rounded-lg border p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{l.sku}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={l.name}>{l.name}</span>
                {l.segmentKey ? (
                  <Badge className="border-transparent bg-roksal-amber/15 text-roksal-amber dark:text-roksal-amber">{l.segmentKey}</Badge>
                ) : null}
                {l.covered ? (
                  <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">na zalogi ({l.stockQty})</Badge>
                ) : (
                  <Badge className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">manjka {l.missing} {l.unit}</Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{l.qty} {l.unit}</span>
                <span className="tabular-nums">{fmtEUR(l.unitCost)} / {l.unit}</span>
                <span className="font-medium tabular-nums text-foreground">skupaj {fmtEUR(l.lineCost)}</span>
                {l.optional ? <span className="rounded bg-secondary px-1.5 py-0.5">neobvezna</span> : null}
                {l.wastePct != null && l.wastePct > 0 ? <span className="rounded bg-secondary px-1.5 py-0.5" title={l.sourceRule ?? ''}>+ {l.wastePct} % odpad</span> : null}
                {l.note ? <span className="italic">{l.note}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Dry-run — nič se ni shranilo. Marža in nabavne cene so interni podatki (pravica quotes.create).
        </p>
        <Button variant="outline" className="h-11" onClick={onRecalc}>
          <Calculator className="size-4" aria-hidden /> Ponovno izračunaj
        </Button>
      </div>
    </section>
  )
}

function SummaryTile ({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'green' }) {
  return (
    <div className="rounded-lg border bg-secondary/30 p-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-bold leading-tight sm:text-base', tone === 'green' && 'text-emerald-600 dark:text-emerald-400')}>{value}</div>
      {hint ? <div className="truncate text-[11px] text-muted-foreground" title={hint}>{hint}</div> : null}
    </div>
  )
}

// ─── 6. SHRANI ────────────────────────────────────────────────────────────────

function StepShrani ({ project, product, variant, plan, name, setName, note, setNote, genBom, setGenBom, genQuote, setGenQuote, busy, onSave }: {
  project: ProjectRow | null
  product: ProductRow
  variant: VariantRow | null
  plan: PlanData
  name: string; setName: (v: string) => void
  note: string; setNote: (v: string) => void
  genBom: boolean; setGenBom: (v: boolean) => void
  genQuote: boolean; setGenQuote: (v: boolean) => void
  busy: boolean
  onSave: () => void
}) {
  const hasTemplate = plan.lines.length > 0
  return (
    <section aria-label="Shrani paket" className="space-y-4">
      <div className="space-y-1.5 rounded-xl border bg-secondary/30 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{project?.code}</span>
          {project ? <StatusBadge status={project.status} /> : null}
          <span className="font-semibold">{project?.title}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{variant?.sku ?? product.sku}</span> · {product.name}
          {variant ? ` — ${variant.name}` : ''} · <strong className="text-foreground">{plan.qty} {plan.unit}</strong>
          {' '}· prodaja skupaj <strong className="text-foreground">{fmtEUR(plan.totalSale)}</strong>
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="konf-name">Prikazno ime paketa</Label>
        <Input id="konf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Terasa — WPC Grafit" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="konf-note">Opomba (neobvezno)</Label>
        <Input id="konf-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="npr. padec 1,5 % proti robu, rok 3 tedne" />
      </div>

      <div className="space-y-1.5">
        <label className="flex min-h-11 items-center gap-3 rounded-lg border p-3">
          <Checkbox
            checked={genBom && hasTemplate}
            disabled={!hasTemplate}
            onCheckedChange={(v) => setGenBom(v === true)}
            aria-label="Generiraj kosovnico ob shranitvi"
          />
          <span className="text-sm">
            Generiraj kosovnico (BOM)
            <span className="block text-xs text-muted-foreground">
              {hasTemplate ? `${plan.lines.length} vrstic iz predloge · status OSNUTEK` : 'Izdelek nima BOM predloge — kosovnica ni mogoča'}
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border p-3">
          <Checkbox
            checked={genQuote}
            onCheckedChange={(v) => setGenQuote(v === true)}
            aria-label="Ustvari osnutek ponudbe ob shranitvi"
          />
          <span className="text-sm">
            Ustvari osnutek ponudbe (PON)
            <span className="block text-xs text-muted-foreground">
              1 pozicija: {variant?.sku ?? product.sku} × {plan.qty} {plan.unit} po {fmtEUR(round2(plan.salePriceUnit + plan.montazaUnit))} (DDV 22 % doda strežnik)
            </span>
          </span>
        </label>
      </div>

      <Button className="h-11 w-full sm:w-auto" onClick={onSave} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
        {busy ? 'Ustvarjam …' : 'Ustvari paket'}
      </Button>
    </section>
  )
}

// ─── Rezultat ─────────────────────────────────────────────────────────────────

function SaveResultPanel ({ result, projectCode, onNew, onOpenProjects, onOpenBom }: {
  result: SaveResult
  projectCode: string
  onNew: () => void
  onOpenProjects: () => void
  onOpenBom: () => void
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-8 shrink-0 text-roksal-green" aria-hidden />
          <div>
            <h2 className="text-lg font-bold">Paket {result.packageCode} ustvarjen</h2>
            <p className="text-sm text-muted-foreground">
              Projekt {projectCode} · status KONFIGURACIJA · strukturirane meritve shranjene v kalkulacijo paketa.
            </p>
          </div>
        </div>

        <ul className="space-y-1.5 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <Package className="size-4 text-muted-foreground" aria-hidden />
            <span>Paket <span className="font-mono font-medium">{result.packageCode}</span></span>
            <StatusBadge status="KONFIGURACIJA" />
          </li>
          {result.bomCode ? (
            <li className="flex flex-wrap items-center gap-2">
              <ClipboardList className="size-4 text-muted-foreground" aria-hidden />
              <span>Kosovnica <span className="font-mono font-medium">{result.bomCode}</span></span>
              <StatusBadge status="OSNUTEK" />
            </li>
          ) : null}
          {result.quoteCode ? (
            <li className="flex flex-wrap items-center gap-2">
              <Calculator className="size-4 text-muted-foreground" aria-hidden />
              <span>Osnutek ponudbe <span className="font-mono font-medium">{result.quoteCode}</span></span>
              <StatusBadge status="OSNUTEK" />
            </li>
          ) : null}
        </ul>

        <div className="space-y-2 rounded-xl border bg-secondary/30 p-3 text-sm">
          <p className="font-medium">Kam naprej:</p>
          <p className="text-muted-foreground">
            Paket, status in kalkulacijo urejate v <strong>Projekti → {projectCode} → Produktni paketi</strong>.
          </p>
          <p className="text-muted-foreground">
            Rezervacijo materiala in picking izvedete v <strong>Zajem → Kosovnice</strong> ({result.bomCode ?? 'kosovnico generirajte iz paketa'}).
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" className="h-11" onClick={onOpenProjects}>
              <FolderKanban className="size-4" aria-hidden /> Odpri Projekte
            </Button>
            {result.bomCode ? (
              <Button variant="outline" className="h-11" onClick={onOpenBom}>
                <ClipboardList className="size-4" aria-hidden /> Odpri Kosovnice
              </Button>
            ) : null}
            <Button className="h-11" onClick={onNew}>
              <Plus className="size-4" aria-hidden /> Nova konfiguracija
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

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
// R546: razbitje velikana — koraki čarovnika so v konfigurator-steps.tsx (1,2,4,5,6)
// in konfigurator-meritve.tsx (3); tipi + pomočniki v konfigurator-shared.ts.
// Tu ostanejo: stanje, tok, prefill (foto-viz), izračun in shranjevanje.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, CheckCircle2, FolderKanban, Image as ImageIcon, Loader2, Package, Palette, RotateCcw, Ruler, Save } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiGet, apiPost, useApi } from '@/lib/api-client'
import { PageHeader } from '@/components/roksal/ui-bits'
import { PACKAGE_TIERS, tierLabel } from '@/lib/quote-core'
import { cn } from '@/lib/utils'
import {
  CLOSED_PROJECT_STATUSES, NACINI_PRITRDITVE, PODLAGE_TERASA, formTypeOf, parseNum, pos, round2,
  type CompareGroupRow, type FamilyRow, type Odb, type PlanData, type ProductDetail,
  type ProductRow, type ProjectRow, type SaveResult, type Seg2, type SegM, type VariantRow,
} from './konfigurator-shared'
import { SaveResultPanel, StepIzdelek, StepIzracun, StepOpcije, StepProjekt, StepShrani } from './konfigurator-steps'
import { StepMeritve } from './konfigurator-meritve'

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
  // R476: primerjalna ponudba — nivo + izbira skupine
  const [tier, setTier] = useState<string>('') // '' | STANDARD | BOLJSI | PREMIUM
  const [comparePick, setComparePick] = useState<string>('new') // 'new' | CMP-koda

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

  // R476: paketi izbranega projekta — za obstoječe primerjalne skupine
  const projPackages = useApi<{ data: { id: string; compareCode: string | null; tier: string | null }[] }>(
    project ? `/api/project-packages?projectId=${project.id}` : null, [project?.id]
  )
  const compareGroups = useMemo<CompareGroupRow[]>(() => {
    const m = new Map<string, string[]>()
    for (const p of projPackages.data?.data ?? []) {
      if (p.compareCode) m.set(p.compareCode, [...(m.get(p.compareCode) ?? []), p.tier ?? ''])
    }
    return [...m.entries()]
      .map(([code, tiers]) => ({ code, tiers, free: PACKAGE_TIERS.filter((t) => !tiers.includes(t)) }))
      .filter((g) => g.free.length > 0) // polne skupine nimajo prostih nivojev
      .sort((a, b) => b.code.localeCompare(a.code))
  }, [projPackages.data])

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
          id: string; projectId: string; variantId: string | null; renderParams: Record<string, unknown> // R542: jsonb
          product: { id: string; sku: string; name: string; family: { code: string; name: string } }
          variant: { id: string; name: string } | null
        }
      }>(`/api/photo-visualization/${id}`)
      const d = res.data
      // R542: renderParams je jsonb objekt — API vrača razčlenjenega (brez JSON.parse)
      const cfg: { config?: { lengthCm?: number; heightCm?: number } } =
        (d.renderParams && typeof d.renderParams === 'object' && !Array.isArray(d.renderParams))
          ? d.renderParams as typeof cfg : {}
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
      // R476: primerjalni paket — nivo + (nova ali obstoječa) skupina primerjave
      const tierBody = tier
        ? { tier, ...(comparePick !== 'new' ? { compareCode: comparePick } : { compare: true }) }
        : {}
      const pkgRes = await apiPost<{ data: { id: string; code: string; tier: string | null; compareCode: string | null } }>('/api/project-packages', {
        projectId: project.id,
        productId: product.id,
        variantId: variantId || null,
        name: name.trim() || undefined,
        qty: effectiveQty,
        unit: product.unit,
        status: 'KONFIGURACIJA',
        note: note.trim() || undefined,
        calcJson: { inputs: buildInputs(), plan },
        ...tierBody,
      })
      const out: SaveResult = {
        packageId: pkgRes.data.id, packageCode: pkgRes.data.code, bomCode: null, quoteCode: null,
        tier: pkgRes.data.tier ?? null, compareCode: pkgRes.data.compareCode ?? null,
      }

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
          out.tier ? `${tierLabel(out.tier)} · primerjava ${out.compareCode}` : null,
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
    setTier(''); setComparePick('new')
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
                    done && 'bg-roksal-green/15 text-emerald-700 dark:text-roksal-green',
                    current && 'bg-roksal-amber/20 text-roksal-amber-text ring-1 ring-roksal-amber/50',
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
                tier={tier} setTier={setTier}
                comparePick={comparePick} setComparePick={setComparePick}
                compareGroups={compareGroups}
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

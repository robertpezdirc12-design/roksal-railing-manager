'use client'

// stanje.ts — stanje slotov/variant + logika semena izrisa (R536-c, DOBESEDLNO
// ohranjena) + podatkovni in parameterni hooki modula. R537-c: čisto razbitje
// foto-replace.tsx v podmapo, brez sprememb obnašanja — useFotoPodatki in
// useSlotParams sta selitvi NEPREKINJENIH nizov hookov iz vstopa (vrstni red
// klicev identičen izvirniku). POZOR: seme izrisa se generira SAMO tukaj
// (novoSeme → prazenSlot) in nikjer drugje.

import { useMemo, useState } from 'react'
import { useApi } from '@/lib/api-client'
import {
  barvaVariante, lameleIzTecha, materialIzTecha, oceniKakovost,
  type Opozorilo, type RenderParams, type Tocka,
} from '@/lib/photo-replace-core'
import { jePraznaMaska, maskaIzQuada, preveriMasko, type Maska, type Oblika } from '@/lib/photo-replace-mask'
import type {
  MaskaVrsta, MeasurementRow, OdpriZapis, ParsedRenderParams, ProductRow, ProjectRow,
  SavedVizRow, SlotState, VariantLabel, VariantRow,
} from './tipi'

// ─── Stanje slotov (pomočniki brez komponent) ────────────────────────────────

export const prazenSlot = (): SlotState => ({
  quad: [], maskaOgraja: [], maskaIzpusti: [], maskaPrednji: [],
  refTip: 'ROCNO', measurementId: '', refCmS: '', refOpis: '',
  productId: '', variantId: '', tip: 'POKOCNA', pritrditev: 'TALNA',
  lengthCmS: '400', heightCmS: '110', postsS: '5', handrail: true,
  lamelaMmS: '70', rezaMmS: '20', deskaMmS: '120', vijaki: true,
  note: '', savedId: null, seme: novoSeme(), photoSourceId: null,
})

export const toNum = (v: string, fb: number, min: number, max: number): number => {
  const n = Number(String(v).trim().replace(',', '.'))
  if (!Number.isFinite(n)) return fb
  return Math.min(max, Math.max(min, n))
}

/** Prebere params JSON meritve FOTO → data URL fotografije (ali null). */
export function fotoIzMeritve (params: string | null): string | null {
  if (!params) return null
  try {
    const p = JSON.parse(params) as { photo?: unknown }
    return typeof p.photo === 'string' && p.photo.startsWith('data:image/') ? p.photo : null
  } catch {
    return null
  }
}

/** Deterministično seme iz id-ja (FNV-1a) — zrno izrisa za ZAPISE BREZ
 *  zapisanega semena (pred R536) in za ne-shranjene zavihke. */
export function semeIzId (id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** R536: sveže seme variante (uint32, crypto naključje; fallback Math.random).
 *  Generira se OB NASTANKU variante (prazen slot) in se nato SHRANI v
 *  renderParams — izris tako ostane reproducibilen tudi pod drugim id-jem
 *  (prej: seme iz savedId → enaki parametri pod novim id-jem = drugačen izris). */
export function novoSeme (): number {
  try {
    const b = new Uint32Array(1)
    crypto.getRandomValues(b)
    return b[0]
  } catch {
    return Math.floor(Math.random() * 4_294_967_296) >>> 0
  }
}

/**
 * R536: seme za trenutni izris — veriga (vzporedna združljivost):
 *  1. params.seme — zapisano V renderParams (zapisi od R536): isti zapis
 *     reproducira isti izris NEODVISNO od id-ja;
 *  2. semeIzId(savedId) — zapisi PRED R536 (brez semena): izpeljava iz
 *     savedId, BAJTNO IDENTIČEN izris kot doslej;
 *  3. semeIzId(`slot-<črka>`) — ne-shranjen zavihek, kot doslej.
 */
export function semeIzrisa (p: RenderParams, savedId: string | null, active: VariantLabel): number {
  if (typeof p.seme === 'number' && Number.isInteger(p.seme) && p.seme >= 0 && p.seme <= 4_294_967_295) {
    return p.seme
  }
  return semeIzId(savedId ?? `slot-${active}`)
}

/** SlotState ključ za vrsto oblike (branje). */
export const maskaKljuc = (v: MaskaVrsta): 'maskaOgraja' | 'maskaIzpusti' | 'maskaPrednji' =>
  v === 'ograja' ? 'maskaOgraja' : v === 'izpust' ? 'maskaIzpusti' : 'maskaPrednji'

/** Zapis vizualizacije (GET /api/photo-visualization/[id]) + odprti renderParams
 *  → stanje enega slotu. Kliče odpri() v vstopu; gradnja (vključno z R536
 *  semenom) je R537-c presetavljena sem, da logika semena živi na enem mestu. */
export function slotIzZapisa (d: OdpriZapis, rp: ParsedRenderParams): SlotState {
  const oblike = (v: unknown): Oblika[] =>
    Array.isArray(v) ? v.filter((o) => Array.isArray(o) && o.length >= 3).map((o) => o.map((t) => ({ x: Number(t.x), y: Number(t.y) }))) : []
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
    // R536: seme PREBEREMO iz shranjenih parametrov — ponovni izris odprtega
    // zapisa je identičen izrisu ob shranjevanju. Stari zapisi (brez semena)
    // ostanejo brez njega: izris izpelje iz savedId (bajtno identično) in
    // tudi naslednja shranitev NOVE verzije semena NE doda — odprtje samo
    // po sebi ne naredi star zapis novim.
    seme: typeof rp.seme === 'number' && Number.isInteger(rp.seme) && rp.seme >= 0 && rp.seme <= 4_294_967_295 ? rp.seme : null,
  }
  return nov
}

// ─── Podatki: projekti, katalog, meritve, shranjene vizualizacije (hook) ─────
// Selitev neprekinjenega niza useApi/useMemo klicev iz vstopa (R537-c) —
// vrstni red hookov in odvisnosti ostajata enaka izvirniku.

export function useFotoPodatki (projectId: string, slot: SlotState) {
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
  return {
    projects, measurements, savedList, project, ograjaProducts, product, variant,
    refMeasurements, fotoMeasurements, linkedMeasurement, setSavedVersion,
  }
}

// ─── Parametri slotu: konfiguracija → maska → RenderParams (hook; R536 seme!) ─
// Selitev neprekinjenega niza useMemo/useState klicev iz vstopa (R537-c) —
// params memo zapiše seme (null se NE zapiše), dobesedno kot v R536-c.

export function useSlotParams ({ slot, refCm, product, variant, linkedMeasurement, photoW, photoH, renderWarnings }: {
  slot: SlotState
  refCm: number
  product: ProductRow | null
  variant: VariantRow | null
  linkedMeasurement: MeasurementRow | null
  photoW: number
  photoH: number
  renderWarnings: Opozorilo[]
}) {
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
      // R536: seme se SHRANI v parametre — ponovni izris istega zapisa je
      // identičen neodvisno od id-ja. null (odprt stari zapis) se NE zapiše:
      // ključ odsoten = izris pade na izpeljavo iz savedId kot doslej.
      ...(slot.seme !== null ? { seme: slot.seme } : {}),
    }
  }, [slot.quad, slot.refTip, slot.refOpis, refCm, cfg, maskaStanje, slot.seme])

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
  return { jePovrsina, maxVisina, maskaUreja, setMaskaUreja, maskaStanje, params, barva, material, vsaOpozorila }
}

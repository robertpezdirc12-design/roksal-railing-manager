'use client'

// izdelek-izbor.tsx — 4. korak: izbor ROKSAL izdelka/variante + konfiguracija
// polnila + izbira gradiva in nalaganje teksture (R507/R517/R518/R520/R523/
// R524). R537-c: čisto razbitje foto-replace.tsx (brez sprememb obnašanja) —
// useGradivo je selitev neprekinjenega niza hookov (useApi + memo + useState +
// useEffect) iz vstopa, IzdelekIzbor je čista komponenta koraka (podatki prek
// propsov).

import { useEffect, useMemo, useState } from 'react'
import { Pencil } from '@/components/roksal/custom-icons'
import { EmptyState } from '@/components/roksal/ui-bits'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useApi } from '@/lib/api-client'
// R527 (issue #14 §5): izrecna oznaka generičnih demo izdelkov — niso ROKSALOVI originali
import { jeGenericniIzdelek, OZNAKA_GENERIKA } from '@/lib/katalog-original'
import {
  barvaVariante, FASADA_REZA_MM, FASADA_SIRINA_MM, lameleIzTecha, ralHex, rezaIzTecha,
  sirinaIzImena, TERASA_REZA_MM, visinaIzTecha,
  type NacinPritrditve, type Razpored, type RenderParams, type TipPolnila,
} from '@/lib/photo-replace-core'
import {
  izberiGradivo, izmeriIzrezeNavpicnihPalic, izmeriSmerVlaken,
  type GradivoDTO, type IzbiraGradiva, type VirTeksture,
} from '@/lib/photo-replace-texture'
import type { AssetRow, ProductRow, SlotState, VariantRow } from './tipi'

/** Izbira gradiva (R507 §3/§4) + nalaganje teksture — selitev neprekinjenega
 *  niza hookov (useApi + useMemo + useState + useEffect) iz vstopa. */
export function useGradivo ({ slot, product, variant }: {
  slot: SlotState
  product: ProductRow | null
  variant: VariantRow | null
}) {
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
    // R537-ac-verify: dobesedna selitev iz foto-replace.tsx:526 (R507 §3/§4) —
    // ponastavitev teksture, ko izbrano gradivo nima datoteke, SINHRONO v efektu.
    // Prestavitev v render-fazo bi spremenilo zaporedje risanj platna (korak 3/4);
    // zavestno ohranjeno (tehnični dolg R497).
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  return { izbiraGradiva, tekstura }
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
export function izberiIzdelek (pid: string, ograjaProducts: ProductRow[], updateSlot: (fn: (s: SlotState) => SlotState) => void): void {
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

/** UI 4. koraka — izdelek, varianta, konfiguracija in predogled (čista komponenta). */
export function IzdelekIzbor ({ slot, product, variant, ograjaProducts, updateSlot, jePovrsina, maxVisina, prekrij, setPrekrij, razporedInfo, previewRef, params }: {
  slot: SlotState
  product: ProductRow | null
  variant: VariantRow | null
  ograjaProducts: ProductRow[]
  updateSlot: (fn: (s: SlotState) => SlotState) => void
  jePovrsina: boolean
  maxVisina: number
  prekrij: boolean
  setPrekrij: React.Dispatch<React.SetStateAction<boolean>>
  razporedInfo: Razpored | null
  previewRef: React.RefObject<HTMLCanvasElement | null>
  params: RenderParams | null
}) {
  return (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pv-izdelek" className="text-sm font-semibold">ROKSAL izdelek <span className="text-red-600">*</span></Label>
                  <Select value={slot.productId || 'none'} onValueChange={(v) => izberiIzdelek(v, ograjaProducts, updateSlot)}>
                    <SelectTrigger id="pv-izdelek" className="h-11"><SelectValue placeholder="Izberite izdelek" /></SelectTrigger>
                    <SelectContent>
                      {ograjaProducts.length === 0 ? <SelectItem value="none" disabled>Ni izdelkov (ograje/fasade/terase)</SelectItem> : null}
                      {ograjaProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku}){jeGenericniIzdelek(p.sku) ? ' — generični' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Videz izključno iz ROKSAL kataloga — brez generičnih modelov (§2). Izdelki z dopolnilom »— generični« so demo izdelki brez preverjenih gradiv — njihov izris je barvni približek.</p>
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

              {product && jeGenericniIzdelek(product.sku) ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs" data-testid="genericni-izdelek-opozorilo">
                  <p className="font-semibold text-amber-800 dark:text-amber-300">{OZNAKA_GENERIKA}.</p>
                  <p className="mt-1 text-muted-foreground">
                    Ta izdelek nima preverjenih ROKSALOVIH gradiv (barvna lestvica, produktni posnetek) — izris bo
                    barvni približek iz kataloške barve/RAL, ne originalna površina. Za prikaz prave površine izberite
                    ROKSALOV izdelek (ROK-…).
                  </p>
                </div>
              ) : null}

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
  )
}

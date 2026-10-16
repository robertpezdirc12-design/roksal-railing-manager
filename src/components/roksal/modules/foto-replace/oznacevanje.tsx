'use client'

// oznacevanje.tsx — 3. korak: označevanje kvada + referenca + maske (R507) in
// sloji obnove ozadja. R537-c: čisto razbitje foto-replace.tsx (brez sprememb
// obnašanja) — useSloji/useOznacevanje sta selitvi NEPREKINJENIH nizov hookov
// iz vstopa (vrstni red klicev identičen izvirniku), Oznacevanje je čista
// komponenta koraka, ki vse potrebuje prek propsov.

import { useCallback, useEffect, useMemo } from 'react'
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtDate } from '@/lib/api-client'
// R527 (issue #14 §5): izrecna oznaka generičnih demo izdelkov — niso ROKSALOVI originali
import { jeGenericniIzdelek, OZNAKA_GENERIKA } from '@/lib/katalog-original'
// R507 (issue #14 §1–§4): lastna maska + obnova ozadja iz robov + originalna gradiva
import {
  deležPokritja, jePraznaMaska, obnoviOzadje, pokrij, slojObnove, slojPrednjega, MAX_OBLIK, MAX_TOCK,
  type Oblika,
} from '@/lib/photo-replace-mask'
import type { OzadjeSloj, Tocka } from '@/lib/photo-replace-core'
import type { IzbiraGradiva } from '@/lib/photo-replace-texture'
import { cn } from '@/lib/utils'
import { maskaKljuc } from './stanje'
import type {
  DokazVeriga, MaskaStanje, MaskaVrsta, MeasurementRow, ProductRow, SlotState, ToastFn,
} from './tipi'

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

/** Sloji izrisa (R507 §2: obnova ozadja + prednji plan) — memo seljen iz vstopa. */
export function useSloji ({ photoImg, photoW, photoH, maskaStanje }: {
  photoImg: HTMLImageElement | null
  photoW: number
  photoH: number
  maskaStanje: MaskaStanje
}) {
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
  return sloji
}
export type SlojiStanje = ReturnType<typeof useSloji>

/** Označevanje (3. korak): risanje kvada/mask na platno + urejanje s kazalci —
 *  selitev neprekinjenega niza hookov (useEffect + 2× useCallback) iz vstopa. */
// R537-ac-verify: parametra dragIdx/dragMask sta refsa (useRef iz vstopa) — lokalno
// preimenovana na *Ref po konvenciji react-hooks/immutability (sufiks Ref), brez
// spremembe vezave (isti objekt, isti klic iz vstopa: dragIdx/dragMask ključa).
export function useOznacevanje ({ editRef, dragIdx: dragIdxRef, dragMask: dragMaskRef, photoImg, photoW, photoH, step, slot, maskaUreja, refCm, updateSlot, toast }: {
  editRef: React.RefObject<HTMLCanvasElement | null>
  dragIdx: React.RefObject<number | null>
  dragMask: React.RefObject<{ vrsta: MaskaVrsta; oblika: number; tocka: number } | null>
  photoImg: HTMLImageElement | null
  photoW: number
  photoH: number
  step: number
  slot: SlotState
  maskaUreja: MaskaVrsta
  refCm: number
  updateSlot: (fn: (s: SlotState) => SlotState) => void
  toast: ToastFn
}) {
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
      ctx.fillStyle = dragIdxRef.current === i ? '#f59e0b' : 'rgba(250, 204, 21, 0.95)'
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
      dragIdxRef.current = best
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
        dragMaskRef.current = { vrsta: maskaUreja, oblika: oblike.length - 1, tocka: bi }
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
    if (dragIdxRef.current !== null) {
      const i = dragIdxRef.current
      updateSlot((s) => ({ ...s, quad: s.quad.map((t, k) => (k === i ? p : t)) }))
      return
    }
    const dm = dragMaskRef.current
    if (dm) {
      nastaviOblike(dm.vrsta, (o) => o.map((oblika, i) => (i === dm.oblika
        ? oblika.map((t, k) => (k === dm.tocka ? p : t))
        : oblika)))
    }
  }

  function editUp (): void {
    dragIdxRef.current = null
    dragMaskRef.current = null
  }
  return { editDown, editMove, editUp, razveljaviTocko }
}

// ── povezava meritve → referenca + predfill geometrije ──
export function izberiMeritev (mid: string, refMeasurements: MeasurementRow[], updateSlot: (fn: (s: SlotState) => SlotState) => void): void {
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

/** UI 3. koraka — označevanje območja, maske in referenca (čista komponenta). */
export function Oznacevanje ({ slot, editRef, editDown, editMove, editUp, updateSlot, refCm, linkedMeasurement, maskaUreja, setMaskaUreja, razveljaviTocko, maskaStanje, sloji, izbiraGradiva, product, dokaz, refMeasurements }: {
  slot: SlotState
  editRef: React.RefObject<HTMLCanvasElement | null>
  editDown: (e: React.PointerEvent<HTMLCanvasElement>) => void
  editMove: (e: React.PointerEvent<HTMLCanvasElement>) => void
  editUp: () => void
  updateSlot: (fn: (s: SlotState) => SlotState) => void
  refCm: number
  linkedMeasurement: MeasurementRow | null
  maskaUreja: MaskaVrsta
  setMaskaUreja: React.Dispatch<React.SetStateAction<MaskaVrsta>>
  razveljaviTocko: () => void
  maskaStanje: MaskaStanje
  sloji: SlojiStanje
  izbiraGradiva: IzbiraGradiva | null
  product: ProductRow | null
  dokaz: DokazVeriga | null
  refMeasurements: MeasurementRow[]
}) {
  return (
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
                      {product && jeGenericniIzdelek(product.sku) ? (
                        <p className="mt-1 font-medium text-amber-800 dark:text-amber-300">{OZNAKA_GENERIKA + ' — izris je barvni približek.'}</p>
                      ) : null}
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
                  <Select value={slot.measurementId || 'none'} onValueChange={(v) => { if (v === 'none') { updateSlot((s) => ({ ...s, refTip: 'ROCNO', measurementId: '' })) } else { izberiMeritev(v, refMeasurements, updateSlot) } }}>
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
  )
}

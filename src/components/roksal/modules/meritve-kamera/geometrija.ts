// MERITVE S KAMERO — geometrija in izpeljani prikazi mere (čisti izračuni,
// brez Reacta). R501 (issue #15 faza 2): cm-vrednosti ne smejo biti LASTNA
// delitev `cm / px` — merilo in geometrijo vrača ENOTNO jedro
// (`computeGeometry`/`resolveScale`); UI sam šteje samo piksle.
// R537-a: selitev iz meritve-kamera.tsx (izhodiščne glave ostajajo ob kodi).

import { computeGeometry, resolveScale, type AnalyzeResult, type ScaleModel } from '@/lib/measure-engine'
import type { Pt, View } from './tipi'

export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',')

/** R455: izračun dolžin segmentov za en pogled (točke + kalibracija).
 *  R501 (issue #15 faza 2): cm-vrednosti niso več LASTNA delitev `cm / px` —
 *  merilo in geometrijo vrne ENOTNO jedro (`computeGeometry`/`resolveScale`),
 *  UI sam šteje samo piksle (prikaz, ko kalibracije še ni). S tem monter v
 *  živi predogledu vidi ISTO število kot strežnik ob potrditvi. */
export interface CalcSeg { i: number; j: number; pxLen: number; cmLen: number | null; angleDeg: number; dVCm: number | null }
export interface CalcResult { pts: Pt[]; segs: CalcSeg[]; totalPx: number; totalCm: number | null; cmPerPx: number | null; scale: ScaleModel }

export function calcView (view: View): CalcResult {
  const pts = view.points.filter((p) => p.src !== 'PREDLOG') // predlogi ne štejejo (§2)
  const geo = computeGeometry(pts, view.calib ? { ...view.calib, imgW: view.imgW, imgH: view.imgH } : null)
  const segs: CalcSeg[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]; const b = pts[i + 1]
    const dx = (b.x - a.x) * view.imgW; const dy = (b.y - a.y) * view.imgH
    const g = geo.segments[i] // jedro vrne segmente v istem vrstnem redu kot pts
    segs.push({
      i, j: i + 1,
      pxLen: Math.hypot(dx, dy),
      cmLen: g ? g.lengthCm : null,
      angleDeg: g ? g.angleDeg : Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10,
      dVCm: g ? g.heightDiffCm : null,
    })
  }
  const totalPx = segs.reduce((s, x) => s + x.pxLen, 0)
  return { pts, segs, totalPx, totalCm: geo.scale.known ? geo.totalLengthCm : null, cmPerPx: geo.cmPerPx, scale: geo.scale }
}

/** Rezultat brez pogleda — aktivne fotografije še ni (isti tip kot `calcView`). */
export const CALC_PRAZEN: CalcResult = { pts: [], segs: [], totalPx: 0, totalCm: null, cmPerPx: null, scale: resolveScale(null) }

/** R455: primerjava vseh pogledov + zaupanje (§3) — oblika memoja `multi`
 *  (izračun ostaja v vstopni komponenti, ker bere stanje pogledov). */
export interface MultiView {
  per: { v: View; c: CalcResult }[]
  lengths: number[]
  mean: number | null
  spreadPct: number | null
  conf: number
  label: string
}

/** R501 (issue #15 faza 2): pošteno besedilo o merilu, zloženo iz ENOTNEGA
 *  modela merila (`ScaleModel`) — monter vidi, katera količina je dokazana in
 *  katera je predpostavka, že v živi predogledu (ne šele na strežniku). */
export function merilaPasus (scale: ScaleModel): string {
  if (!scale.known) return 'Merilo ni znano — mere so v pikslih; cm-vrednost še NI izračunana.'
  if (scale.basis === 'ANIZOTROPNO') return `Merilo je dokazano ločeno za X in Y — ${scale.reasons[0] ?? ''}.`
  if (scale.isotropicProven) return `Merilo je dokazano v vseh smereh — ${scale.reasons[0] ?? ''}.`
  return `Merilo je za vse smeri PREDPOSTAVKA — ${scale.reasons[0] ?? ''}`
}

/** R506 (issue #15 faza 4): kratka oznaka merila, sestavljena iz modela
 *  merila (`ScaleModel`), ki ga vrne jedro. Ankoraz pri anizotropnem merilu
 *  `cmPerPx` ni eno samo razmerje — takrat UI ne sme izpisati
 *  »neveljavna referenca«, ker referenca JE veljavna, samo po smereh ločena. */
export function meriloOznaka (scale: ScaleModel): string | null {
  if (!scale.known) return null
  // R513: ravnina nima enotnega cm/px — merilo je homografija
  if (scale.basis === 'RAVNINA' && scale.planeRect != null) {
    return `ravnina ${fmt1(scale.planeRect.widthCm)} × ${fmt1(scale.planeRect.heightCm)} cm (perspektivno rectificirano)`
  }
  if (scale.cmPerPxX === null) return null
  if (scale.cmPerPxY !== null && scale.cmPerPxY !== scale.cmPerPxX) {
    return `X ${fmt1(scale.cmPerPxX)} cm/px · Y ${fmt1(scale.cmPerPxY)} cm/px (ločeno)`
  }
  return `1 px = ${fmt1(scale.cmPerPxX)} cm`
}

/** R457: domenski rezultat kot vrstice za prikaz/tabelo (§8–§11). */
export function domainRows (d: AnalyzeResult['domain']): [string, string][] {
  switch (d.mode) {
    case 'OGRAJA':
      return [
        ['Skupna dolžina', `${fmt1(d.totalLengthCm)} cm`],
        ['Stebri', `${d.posts} kos (razmak ≤ ${d.spacingCm} cm)`],
        ['Ročnik', `${fmt1(d.handrailM)} m`],
        ['Površina polnila', `${fmt1(d.infillM2)} m²`],
        ['Segmentov', String(d.segments.length)],
      ]
    case 'KERAMIKA':
      return [
        ['Bruto površina', `${fmt1(d.areaM2)} m²`],
        ['Odprtine', `${fmt1(d.openingsM2)} m²`],
        ['Neto površina', `${fmt1(d.netAreaM2)} m²`],
        ['Ploščice', `${d.tileWcm}×${d.tileHcm} cm · ${d.pattern.toLowerCase()}`],
        ['Razporeditev', `${d.rows} vrst × ${d.cols} stolpcev`],
        ['Št. ploščic', `${d.tilesCount} kos (rezi ≈ ${d.cuts})`],
        ['Odpad', `${d.wastePct} %`],
        ['Lepak C2', `≈ ${d.adhesiveKg} kg`],
        ['Fuga', `≈ ${d.fugueKg} kg`],
      ]
    case 'STREHA':
      return [
        ['Tloris ploskve', `${fmt1(d.footprintM2)} m²`],
        ['Naklon', `${d.pitchDeg}°`],
        ['Površina ploskve', `${fmt1(d.faceAreaM2)} m²`],
        ['Slemen', `${fmt1(d.ridgeCm)} cm`],
        ['Ostali robovi', `${fmt1(d.eaveCm)} cm`],
        ['Material', `${d.material === 'KOVINSKA' ? 'kovinska' : 'betonska'} kritina · odpad ${d.wastePct} %`],
        ['Material skupaj', `${fmt1(d.materialM2)} m²`],
      ]
    case 'FASADA':
      return [
        ['Bruto površina', `${fmt1(d.grossM2)} m²`],
        ['Odprtine', `${fmt1(d.openingsM2)} m² (${d.openings.reduce((s, o) => s + o.count, 0)} kos)`],
        ['Neto površina', `${fmt1(d.netM2)} m²`],
        ['Obseg', `${fmt1(d.perimeterCm)} cm`],
      ]
    case 'STOPNICE':
      return [
        ['Nagibna dolžina', `${fmt1(d.slopeLengthCm)} cm`],
        ['Višinska razlika', `${fmt1(d.heightDiffCm)} cm`],
        ['Vodoravno', `${fmt1(d.horizontalCm)} cm`],
        ['Nagib', `${d.angleDeg}°`],
        ['Stopnic', String(d.steps)],
        ['Vzpon × čežnost', `${fmt1(d.riseCm)} × ${fmt1(d.runCm)} cm`],
      ]
    case 'PROSTOR':
      return [
        ['Površina', `${fmt1(d.areaM2)} m²`],
        ['Obseg', `${fmt1(d.perimeterCm)} cm`],
        ...d.diagonals.map((x) => [`Diagonala ${x.i + 1}↔${x.j + 1}`, `${fmt1(x.lengthCm)} cm`] as [string, string]),
        ...(d.rectangleOk != null ? ([[d.rectangleOk ? 'Pravokotnost' : 'Pravokotnost', d.rectangleOk ? 'DA — diagonali se ujemata' : 'NE — diagonali odstopata']] as [string, string][]) : []),
      ]
    default:
      return [
        ['Skupna dolžina', `${fmt1(d.totalLengthCm)} cm`],
        ['Segmentov', String(d.segments.length)],
      ]
  }
}

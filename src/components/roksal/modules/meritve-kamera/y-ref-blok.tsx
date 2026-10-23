'use client'

// MERITVE S KAMERO — vnosni blok LOČENE Y reference (R506 issue #15 faza 4,
// H1 a). R537-a: selitev iz meritve-kamera.tsx (izhodiščne glave ostajajo ob
// kodi); uporabljata ga faza KALIBRACIJA in faza MERITEV.

import { useState } from 'react'
import { ArrowDownToLine, Trash2 } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmt1 } from './geometrija'
import type { Pt, View } from './tipi'

/**
 * R506 (issue #15 faza 4, H1 a): vnos LOČENE Y reference.
 *
 * Ena `px/cm` referenca dokže merilo samo v smeri, v kateri je bila izmerjena.
 * Pri nagnjenem kadru smer Y na sliki NI enaka smeri X, zato jedro potrebuje
 * second par (`pxY`/`cmY`). Brez tega vnosnega polja je bila anizotropna
 * pogodba v jedru sicer izvedena, a nedosegljiva monterju — to je zaprto tu.
 *
 * UI nastavi par SAMO skupaj (in ga tudi skupaj odstrani): polovičen par bi
 * merilo tiho spremenil iz dokazanega v nedokazano, kar `parseCalibration`
 * zavrne. Delitev cm/px ostane v jedru.
 */
export function YRefBlock ({ view, pxOf, onApply, idp }: {
  view: View
  pxOf: (a: Pt, b: Pt) => number
  onApply: (pxY: number | null, cmY: number | null) => void
  idp: string
}) {
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [cmS, setCmS] = useState('')
  const cm = Number(cmS.replace(',', '.'))
  const par = a !== null && b !== null ? [view.points[a], view.points[b]] : null
  const pxY = par && par[0] && par[1] ? Math.round(pxOf(par[0], par[1])) : 0
  const vecerno = par && par[0] && par[1]
    ? Math.abs(par[1].y - par[0].y) * view.imgH >= Math.abs(par[1].x - par[0].x) * view.imgW
    : true
  const velja = pxY > 0 && Number.isFinite(cm) && cm > 0 && a !== b

  if (view.calib?.pxY && view.calib.cmY) {
    return (
      <div className="space-y-1 rounded-md border border-sky-500/40 bg-sky-500/5 p-2">
        <p className="text-[11px] font-semibold text-sky-700">Ločena Y referenca je nastavljena</p>
        <p className="text-[11px] text-muted-foreground">
          {view.calib.pxY} px = {fmt1(view.calib.cmY)} cm v smeri Y · X referenca: {view.calib.px} px = {fmt1(view.calib.cm)} cm.
          Merilo se računa ločeno za obe smeri (vrednosti dobi jedro).
        </p>
        {!view.calibLocked ? (
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onApply(null, null)}>
            <Trash2 className="size-3.5" aria-hidden /> Odstrani Y referenco
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-1 rounded-md border border-dashed p-2">
      <p className="text-[11px] font-semibold">Ločena Y referenca (priporočeno, če slika ni pravokotna na ravnino)</p>
      <p className="text-[11px] text-muted-foreground">
        Izberite dve točki, med katerma je na terenu izmerjena NAVPIČNA razdalja (npr. višina stebra, robov stopnice).
        Brez tega eno merilo velja za vse smeri samo kot predpostavka.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${idp}-y-a`} className="text-[11px]">Y: 1. točka</Label>
          <Select value={a !== null ? String(a) : 'none'} onValueChange={(v) => setA(v === 'none' ? null : Number(v))}>
            <SelectTrigger id={`${idp}-y-a`} className="h-8 w-24" aria-label="Prva točka Y reference"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {view.points.map((p, i) => <SelectItem key={i} value={String(i)}>Točka {i + 1}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idp}-y-b`} className="text-[11px]">Y: 2. točka</Label>
          <Select value={b !== null ? String(b) : 'none'} onValueChange={(v) => setB(v === 'none' ? null : Number(v))}>
            <SelectTrigger id={`${idp}-y-b`} className="h-8 w-24" aria-label="Druga točka Y reference"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {view.points.map((p, i) => <SelectItem key={i} value={String(i)}>Točka {i + 1}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idp}-y-cm`} className="text-[11px]">Realna višina (cm)</Label>
          <Input id={`${idp}-y-cm`} className="h-8 w-28" type="number" min="1" inputMode="decimal" value={cmS} onChange={(e) => setCmS(e.target.value)} placeholder="npr. 110" />
        </div>
        <Button size="sm" className="h-8" disabled={!velja || !view.calib} onClick={() => onApply(pxY, cm)}>
          <ArrowDownToLine className="size-4" aria-hidden /> Nastavi Y merilo
        </Button>
      </div>
      {!view.calib ? (
        <p className="text-[11px] text-muted-foreground">Najprej nastavite X referenco — Y merilo brez osnovne kalibracije nima smisla.</p>
      ) : !velja && a !== null && b !== null && a === b ? (
        <p className="text-[11px] text-muted-foreground">Izberite DVE različni točki.</p>
      ) : !vecerno && a !== null && b !== null ? (
        <p className="text-[11px] text-roksal-amber-text">Izbrana para sta bolj VODORAVNA kot navpična — Y referenca naj meri višino.</p>
      ) : null}
    </div>
  )
}

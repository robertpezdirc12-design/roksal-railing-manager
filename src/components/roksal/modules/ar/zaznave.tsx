'use client'

// zaznave.tsx — skupni deli UI zaznav prizora (R537-b: dobesedna selitev iz
// ar.tsx): vrstica elementa (PREGLED seznam + zaznave posnetka) in obrazec
// ročne oznake. Delita ju predogled.tsx (živa seja) in zgodovina.tsx (posnetek).

import { useState } from 'react'

import { Loader2, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SCENE_CLS_COLOR, SCENE_CLS_ICON, SCENE_CLS_LABEL, SCENE_STATUS_TEXT } from '@/components/roksal/scene-overlay'
import { consolidateMeasures, type SceneClass, type SceneElement } from '@/lib/scene-understanding-core'

import { MANUAL_CLASSES, SCENE_LABEL_MAX, type ManualTagValues } from './tipi'

// ─── R485 (issue #8 §9 :137): VRSTICA ELEMENTA — tapljivi seznam (PREGLED) ──
// Ista vrstica za živi PREGLED in zaznave posnetka: ikona/razred, opomba,
// status chip, zaupanje, mere če so, vir. Tap → obstoječi tap-detail.

export function SceneElementRow ({ el, selected, onSelect }: {
  el: SceneElement
  selected?: boolean
  onSelect?: (el: SceneElement) => void
}): React.ReactElement {
  const Icon = SCENE_CLS_ICON[el.cls]
  const color = SCENE_CLS_COLOR[el.cls]
  const measures = el.cls === 'OSEBA' ? [] : consolidateMeasures(el.measures ?? [])
  const name = el.cls === 'OSEBA' ? 'Morebitna oseba' : SCENE_CLS_LABEL[el.cls]
  return (
    <button
      type="button"
      className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-roksal-amber ${selected ? 'bg-secondary/60' : ''}`}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${name}${el.label ? `, opomba: ${el.label}` : ''} — ${SCENE_STATUS_TEXT[el.status]}, zaupanje ${Math.round(el.confidence * 100)} %, vir: ${el.source === 'ROCNO' ? 'ročno' : el.source === 'VLM' ? 'AI predlog' : 'lokalna hevristika'}`}
      onClick={onSelect != null ? () => { onSelect(el) } : undefined}
    >
      <Icon className="size-4 shrink-0" style={{ color }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {el.label ? <span className="truncate text-xs italic text-muted-foreground">„{el.label}“</span> : null}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] leading-snug text-muted-foreground">
          <span>{el.source === 'ROCNO' ? 'ročno potrjeno' : el.source === 'VLM' ? 'AI predlog' : 'lokalna hevristika'}</span>
          <span aria-hidden>·</span>
          <span>zaupanje {Math.round(el.confidence * 100)} %</span>
          {measures.length > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className="font-semibold text-foreground">
                ≈ {measures[0].valueCm.toFixed(1).replace('.', ',')} cm{measures.length > 1 ? ` (+${measures.length - 1})` : ''}
              </span>
            </>
          ) : null}
        </span>
      </span>
      <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">{SCENE_STATUS_TEXT[el.status]}</Badge>
    </button>
  )
}

// ─── R485 (issue #8 §1): OBRAZEC ROČNE OZNAKE — razred iz belenga seznama ────
// BREZ OSEBA (zasebnost §5 — enak seznam kot POST scene-element na strežniku),
// bbox kot 4 števci 0..1 (x, y, širina, višina — delež kadra) z živim
// predogledom pravokotnika (onBBoxChange) in neobvezno opombo (≤ 60 znakov).

/** Privzete vrednosti polj bboxa kot NIZI (za Input) — par tipa
 *  MANUAL_BBOX_DEFAULT iz tipi.ts (R537-b: selitev iz ar.tsx). */
const MANUAL_BBOX_DEFAULT_STR = { x: '0,35', y: '0,35', w: '0,30', h: '0,30' }

function parseBBoxPart (raw: string): number | null {
  const v = Number(raw.replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null
}

export function ManualTagForm ({ onSubmit, onCancel, busy = false, onBBoxChange, helpNote }: {
  onSubmit: (v: ManualTagValues) => void
  onCancel: () => void
  busy?: boolean
  onBBoxChange?: (bbox: [number, number, number, number] | null) => void
  helpNote?: string
}): React.ReactElement {
  const [cls, setCls] = useState<SceneClass>('NEZNANO')
  const [bx, setBx] = useState(MANUAL_BBOX_DEFAULT_STR.x)
  const [by, setBy] = useState(MANUAL_BBOX_DEFAULT_STR.y)
  const [bw, setBw] = useState(MANUAL_BBOX_DEFAULT_STR.w)
  const [bh, setBh] = useState(MANUAL_BBOX_DEFAULT_STR.h)
  const [label, setLabel] = useState('')

  const x = parseBBoxPart(bx)
  const y = parseBBoxPart(by)
  const w = parseBBoxPart(bw)
  const h = parseBBoxPart(bh)
  const bbox: [number, number, number, number] | null =
    x != null && y != null && w != null && h != null && w > 0 && h > 0
      ? [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(w * 1000) / 1000, Math.round(h * 1000) / 1000]
      : null

  function updateBBox (next: Partial<Record<'x' | 'y' | 'w' | 'h', string>>): void {
    const vals = { x: bx, y: by, w: bw, h: bh, ...next }
    const nx = parseBBoxPart(vals.x); const ny = parseBBoxPart(vals.y)
    const nw = parseBBoxPart(vals.w); const nh = parseBBoxPart(vals.h)
    onBBoxChange?.(nx != null && ny != null && nw != null && nh != null && nw > 0 && nh > 0
      ? [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000, Math.round(nw * 1000) / 1000, Math.round(nh * 1000) / 1000]
      : null)
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-roksal-amber/50 bg-secondary/30 p-3">
      <p className="text-xs font-bold uppercase tracking-wide">Dodaj oznako ročno</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="manual-cls">Razred</Label>
          <Select value={cls} onValueChange={(v) => { setCls(v as SceneClass) }}>
            <SelectTrigger id="manual-cls" aria-label="Razred ročno dodane oznake">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {MANUAL_CLASSES.map((c) => (
                <SelectItem key={c} value={c}>{c === 'NEZNANO' ? 'NEZNANO (razred določite kasneje)' : c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="manual-label">Opomba (neobvezno, do 60 znakov)</Label>
          <Input
            id="manual-label"
            value={label}
            maxLength={SCENE_LABEL_MAX}
            onChange={(e) => { setLabel(e.target.value) }}
            placeholder="npr. vogal terase"
          />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-medium" id="manual-bbox-label">
          Položaj v kadru (0..1): levo X · zgoraj Y · širina W · višina H — delež kadra
        </p>
        <div className="grid grid-cols-4 gap-2" role="group" aria-labelledby="manual-bbox-label">
          <div className="space-y-1">
            <Label htmlFor="manual-bx" className="text-[10px]">X</Label>
            <Input id="manual-bx" inputMode="decimal" className="h-8 text-xs" value={bx}
              aria-label="Bbox X — levi rob (0..1)"
              onChange={(e) => { setBx(e.target.value); updateBBox({ x: e.target.value }) }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="manual-by" className="text-[10px]">Y</Label>
            <Input id="manual-by" inputMode="decimal" className="h-8 text-xs" value={by}
              aria-label="Bbox Y — zgornji rob (0..1)"
              onChange={(e) => { setBy(e.target.value); updateBBox({ y: e.target.value }) }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="manual-bw" className="text-[10px]">W</Label>
            <Input id="manual-bw" inputMode="decimal" className="h-8 text-xs" value={bw}
              aria-label="Bbox W — širina (0..1)"
              onChange={(e) => { setBw(e.target.value); updateBBox({ w: e.target.value }) }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="manual-bh" className="text-[10px]">H</Label>
            <Input id="manual-bh" inputMode="decimal" className="h-8 text-xs" value={bh}
              aria-label="Bbox H — višina (0..1)"
              onChange={(e) => { setBh(e.target.value); updateBBox({ h: e.target.value }) }} />
          </div>
        </div>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        {helpNote ?? 'Oznaka se zapiše z virom ROCNO in shrani z zajemom AR posnetka. OSEBA ni na voljo (zasebnost — živa zaznava oseb se ne persistira).'}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Prekliči</Button>
        <Button
          size="sm"
          disabled={busy || bbox == null}
          onClick={() => { if (bbox != null) onSubmit({ cls, bbox, label: label.trim().slice(0, SCENE_LABEL_MAX) }) }}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
          Dodaj oznako
        </Button>
      </div>
    </div>
  )
}

'use client'

// SceneOverlay — R467 (issue #8 Faza 1, §9): ŽIVI SVG overlay zaznanih
// elementov prizora čez predogled kamere. Čist pogled: 2–4 oznake naenkrat
// (pickLabels), barva NI edini nosilec statusa (beseda + ikona + barva).
// Tap na oznako → onSelect (detail/popravek). Brez oznak = brez overlayja
// (kamera ostane čista, issue: privzeti pogled čist).

import { HelpCircle, Layers, Ruler, TriangleAlert, User, Waypoints } from 'lucide-react'
import type { SceneClass, SceneElement, SceneStatus } from '@/lib/scene-understanding-core'
import { nextStepGuidance, pickLabels } from '@/lib/scene-understanding-core'

export interface SceneOverlayProps {
  elements: SceneElement[]
  /** kakovost kadra za naslednji korak (issue §8) — ali null. */
  quality?: { dark: boolean; bright: boolean; blurry: boolean } | null
  /** izbrani element (highlight). */
  selectedId?: string | null
  onSelect?: (el: SceneElement) => void
  /** max sočasno prikazanih oznak (issue §9: 2–4). */
  maxLabels?: number
}

const CLS_LABEL: Record<SceneClass, string> = {
  TLA: 'Tla',
  PODLAGA: 'Podlaga',
  OGRAJA: 'Ograja',
  STOPNICA: 'Stopnice',
  OSEBA: 'Oseba',
  OVIRA: 'Ovira',
  NEZNANO: 'Neprepoznano',
}

const CLS_ICON: Record<SceneClass, typeof Layers> = {
  TLA: Layers,
  PODLAGA: Layers,
  OGRAJA: Waypoints,
  STOPNICA: Ruler,
  OSEBA: User,
  OVIRA: TriangleAlert,
  NEZNANO: HelpCircle,
}

const CLS_COLOR: Record<SceneClass, string> = {
  TLA: '#0d9488', // teal
  PODLAGA: '#0d9488',
  OGRAJA: '#2b2f36', // anthracite
  STOPNICA: '#b45309', // amber-700
  OSEBA: '#dc2626', // red
  OVIRA: '#d97706', // amber-600
  NEZNANO: '#71717a', // zinc
}

const STATUS_TEXT: Record<SceneStatus, string> = {
  PREPOZNANO: 'Prepoznano',
  VERJETNO: 'Verjetno',
  NEJASNO: 'Nejasno',
  SKRITO: 'Skrito',
}

export default function SceneOverlay ({ elements, quality, selectedId, onSelect, maxLabels = 4 }: SceneOverlayProps) {
  const shown = pickLabels(elements, maxLabels)
  if (shown.length === 0) return null
  const guidance = nextStepGuidance(elements, quality ?? undefined)

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 size-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-label={`Živi zaznave: ${shown.map((e) => CLS_LABEL[e.cls]).join(', ')}`}
      >
        {shown.map((el) => {
          const [x, y, w, h] = el.bbox
          const color = CLS_COLOR[el.cls]
          const selected = selectedId === el.id
          return (
            <g key={el.id}>
              <rect
                x={x * 100}
                y={y * 100}
                width={w * 100}
                height={h * 100}
                fill={color}
                fillOpacity={selected ? 0.14 : 0.06}
                stroke={color}
                strokeWidth={selected ? 0.7 : 0.4}
                strokeDasharray={el.status === 'NEJASNO' || el.status === 'SKRITO' ? '1.6 1.2' : undefined}
                rx={0.6}
              />
            </g>
          )
        })}
      </svg>
      {/* oznake so NAVADEN DOM nad svg — dotik mora biti dosegljiv (44 px) */}
      <div className="pointer-events-none absolute inset-0">
        {shown.map((el) => {
          const [x, y, w] = el.bbox
          const Icon = CLS_ICON[el.cls]
          const color = CLS_COLOR[el.cls]
          const selected = selectedId === el.id
          return (
            <button
              key={el.id}
              type="button"
              className={`pointer-events-auto absolute flex min-h-[28px] items-center gap-1 rounded-full border bg-white/95 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur transition dark:bg-zinc-900/95 ${selected ? 'ring-2 ring-offset-1' : ''} ${onSelect ? 'cursor-pointer hover:bg-white' : 'cursor-default'}`}
              style={{
                left: `${Math.min(92, Math.max(1, x * 100 + w * 50 - 12))}%`,
                top: `${Math.min(94, Math.max(2, y * 100 - 4))}%`,
                borderColor: color,
                color: '#2b2f36',
                ...(selected ? ({ '--tw-ring-color': color } as React.CSSProperties) : {}),
              }}
              onClick={onSelect ? () => { onSelect(el) } : undefined}
              aria-label={`${CLS_LABEL[el.cls]}${el.kind ? ` (${el.kind.toLowerCase()})` : ''} — ${STATUS_TEXT[el.status]}${el.cls === 'NEZNANO' ? ' — tapnite za označitev' : ''}`}
            >
              <Icon className="size-3" style={{ color }} aria-hidden />
              <span>{CLS_LABEL[el.cls]}{el.kind && el.kind !== 'NEZNANA' ? ` · ${el.kind.toLowerCase()}` : ''}</span>
              <span className="font-normal text-zinc-500">· {STATUS_TEXT[el.status]}</span>
            </button>
          )
        })}
      </div>
      {/* naslednji korak za monterja (issue §8) — ena vrstica, spodaj */}
      {guidance ? (
        <p
          className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-zinc-900/75 px-2.5 py-1.5 text-center text-[11px] leading-snug text-white shadow"
          role="status"
        >
          {guidance}
        </p>
      ) : null}
    </>
  )
}

'use client'

// SceneOverlay — R467 (issue #8 Faza 1, §9): ŽIVI SVG overlay zaznanih
// elementov prizora čez predogled kamere. Čist pogled: 2–4 oznake naenkrat
// (pickLabels), barva NI edini nosilec statusa (beseda + ikona + barva).
// Tap na oznako → onSelect (detail/popravek). Brez oznak = brez overlayja
// (kamera ostane čista, issue: privzeti pogled čist).
//
// R468 (issue #8 Faza 2, §9): maska tal kot POLIGON (ne samo pravokotnik),
// ROB kot črta pod kotom angleDeg, naklon v oznaki tal, pripnjeni (zaklep)
// elementi so vedno prikazani.
//
// R469 (issue #8 Faza 3, §4/§9): STOPNICA — vsaka nastopna črta kot svoja
// daljica (ne en sam okvir), število nastopov v oznaki (ocena, nikoli izmera).
//
// R470 (issue #8 §5/§9): dimenzijske OSI izbranega elementa kot merilne
// črte (glavna črta + končni črtici) — BREZ cm vrednosti (te pridejo samo
// z zapisano metodo, §5 poštenost); chip izmerjene mere „≈ 120,5 cm
// (ročni vnos)“; OSEBA se izrecno imenuje „morebitna oseba“ (hevristika
// ne trdi identitete) in se NE shranjuje (zasebnost).
//
// R485 (issue #8 §9): PREKLOP POGLEDOV — ZIVO (privzeto: oznake, mere, osi
// izbranega), PREPOZNANO (samo semantične oznake — razredi/statusi/zaupanje;
// mere in osi SKRITE), MERE (samo osi in čipi mer z metodo — razredi manj
// vidni). Pogled je SAMO prikaz istih elementov (NE nov podatkovni model).

import { HelpCircle, Layers, MapPin, MoveHorizontal, Ruler, TriangleAlert, User, Waypoints } from '@/components/roksal/custom-icons'
import type { DimAxis, SceneClass, SceneElement, SceneStatus } from '@/lib/scene-understanding-core'
import { consolidateMeasures, MEASURE_METHOD_TEXT, nextStepGuidance, pickLabels, proposeAxes } from '@/lib/scene-understanding-core'

/** R485 (issue #8 §9): pogled overlayja — ZIVO | PREPOZNANO | MERE. */
export type SceneOverlayView = 'ZIVO' | 'PREPOZNANO' | 'MERE'

/** R485: izvozi za tapljivi seznam PREGLED v ar.tsx (isti vir resnice). */
export { CLS_LABEL as SCENE_CLS_LABEL, CLS_ICON as SCENE_CLS_ICON, CLS_COLOR as SCENE_CLS_COLOR, STATUS_TEXT as SCENE_STATUS_TEXT }

export interface SceneOverlayProps {
  elements: SceneElement[]
  /** kakovost kadra za naslednji korak (issue §8) — ali null. */
  quality?: { dark: boolean; bright: boolean; blurry: boolean } | null
  /** izbrani element (highlight). */
  selectedId?: string | null
  onSelect?: (el: SceneElement) => void
  /** max sočasno prikazanih oznak (issue §9: 2–4). */
  maxLabels?: number
  /** pripnjeni (zaklenjeni) elementi — vedno prikazani (issue §9). */
  pinnedIds?: ReadonlySet<string>
  /** R485 (issue #8 §9): pogled overlayja (privzeto ZIVO = sedanje obnašanje). */
  view?: SceneOverlayView
  /** R570: naj se izriše notranja vrstica »naslednji korak« (privzeto DA)?
   *  V celozaslonskem zajemu (faza-zajem) jo nosilec izriše NAD gumbi,
   *  da ne zaide pod ploščo kontrol — tam se poda false. */
  guidance?: boolean
}

const CLS_LABEL: Record<SceneClass, string> = {
  TLA: 'Tla',
  PODLAGA: 'Podlaga',
  OGRAJA: 'Ograja',
  STOPNICA: 'Stopnice',
  ROB: 'Rob',
  OSEBA: 'Oseba',
  OVIRA: 'Ovira',
  NEZNANO: 'Neprepoznano',
}

const CLS_ICON: Record<SceneClass, typeof Layers> = {
  TLA: Layers,
  PODLAGA: Layers,
  OGRAJA: Waypoints,
  STOPNICA: Ruler,
  ROB: MoveHorizontal,
  OSEBA: User,
  OVIRA: TriangleAlert,
  NEZNANO: HelpCircle,
}

const CLS_COLOR: Record<SceneClass, string> = {
  TLA: '#0d9488', // teal
  PODLAGA: '#0d9488',
  OGRAJA: '#2b2f36', // anthracite
  STOPNICA: '#b45309', // amber-700
  ROB: '#65a30d', // lime-600 — rob plošče/terase
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

const GEOM_TEXT: Record<string, string> = {
  GEOMETRIJA_OCENJENA: 'geometrija ocenjena',
  IZMERJENO: 'izmerjeno',
  NEZADOSTNI_PODATKI: 'nezadostni podatki',
}

const SLOPE_TEXT: Record<string, string> = {
  VIZUALNA_GEOMETRIJA: 'vizualna geometrija',
  SENZOR_NAPRAVE: 'senzor naprave',
  ROCNO: 'ročno',
}

/** Oznaka vrstice za podlagi z naklonom: „naklon ~3,5° (ocena)“. */
function slopeChip (el: SceneElement): string | null {
  if (el.slopeDeg == null) return null
  if (el.slopeDeg === 0) return 'naklon ~0°'
  return `naklon ~${Math.abs(el.slopeDeg).toFixed(1).replace('.', ',')}°`
}

/** R469 (F3 §4): oznaka za stopnice — „5 nastopov (ocena)“. */
function stairChip (el: SceneElement): string | null {
  if (el.cls !== 'STOPNICA' || el.steps == null) return null
  return `${el.steps} nastopov (ocena)`
}

/** R470 (§5): chip izmerjene mere — „≈ 120,5 cm (ročni vnos)“ — vedno z metodo.
 *  R485 (§9): v pogledu MERE izpiše tudi metodo (vir mere), sicer samo vrednost;
 *  v pogledu PREPOZNANO se chip NE izriše (mere skrite). */
function measureChip (el: SceneElement, withMethod = false): string | null {
  const consolidated = consolidateMeasures(el.measures ?? [])
  if (consolidated.length === 0) return null
  const m = consolidated[0]
  const method = withMethod ? ` (${MEASURE_METHOD_TEXT[m.method]})` : ''
  return `≈ ${m.valueCm.toFixed(1).replace('.', ',')} cm${m.conflict ? ' (!)' : ''}${method}`
}

/** R470 (§5): SVG za eno dimenzijsko os — merilna črta s končnima črticama. */
function AxisLine ({ a, color, selected }: { a: DimAxis; color: string; selected: boolean }): React.ReactElement {
  const dx = a.x2 - a.x1
  const dy = a.y2 - a.y1
  const len = Math.max(1e-6, Math.hypot(dx, dy))
  // enotska normala (za končni črtici, ~2,2 % višine kadra)
  const nx = -dy / len
  const ny = dx / len
  const t = 1.1
  const x1 = a.x1 * 100; const y1 = a.y1 * 100
  const x2 = a.x2 * 100; const y2 = a.y2 * 100
  const ex1 = (a.x1 + nx * t / 100) * 100; const ey1 = (a.y1 + ny * t / 100) * 100
  const ex2 = (a.x1 - nx * t / 100) * 100; const ey2 = (a.y1 - ny * t / 100) * 100
  const fx1 = (a.x2 + nx * t / 100) * 100; const fy1 = (a.y2 + ny * t / 100) * 100
  const fx2 = (a.x2 - nx * t / 100) * 100; const fy2 = (a.y2 - ny * t / 100) * 100
  return (
    <g>
      <line x1={x1.toFixed(2)} y1={y1.toFixed(2)} x2={x2.toFixed(2)} y2={y2.toFixed(2)}
        stroke={color} strokeWidth={selected ? 0.55 : 0.4} strokeLinecap="round" />
      <line x1={x1.toFixed(2)} y1={y1.toFixed(2)} x2={x2.toFixed(2)} y2={y2.toFixed(2)}
        stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.16} strokeLinecap="round" />
      <line x1={ex1.toFixed(2)} y1={ey1.toFixed(2)} x2={ex2.toFixed(2)} y2={ey2.toFixed(2)}
        stroke={color} strokeWidth={0.45} strokeLinecap="round" />
      <line x1={fx1.toFixed(2)} y1={fy1.toFixed(2)} x2={fx2.toFixed(2)} y2={fy2.toFixed(2)}
        stroke={color} strokeWidth={0.45} strokeLinecap="round" />
    </g>
  )
}

export default function SceneOverlay ({ elements, quality, selectedId, onSelect, maxLabels = 4, pinnedIds, view = 'ZIVO', guidance = true }: SceneOverlayProps) {
  const shown = pickLabels(elements, maxLabels, pinnedIds)
  if (shown.length === 0) return null
  const guidanceText = nextStepGuidance(elements, quality ?? undefined)
  // R485 (§9): pogled — PREPOZNANO skrije mere/osi (samo semantika), MERE
  // pokaže osi VSEH prikazanih elementov (pogled mer); ŽIVO = osi izbranega
  // (R470). Elementi so ISTI — spreminja se samo prikaz.
  const semanticOnly = view === 'PREPOZNANO'
  const measuresOnly = view === 'MERE'
  const axesOf = (el: SceneElement): DimAxis[] =>
    el.axes && el.axes.length >= 1 ? el.axes : proposeAxes(el)
  const axesFor: SceneElement[] = semanticOnly
    ? []
    : measuresOnly
      ? shown
      : elements.filter((e) => e.id === selectedId)

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 size-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-label={`Živi zaznave: ${shown.map((e) => CLS_LABEL[e.cls]).join(', ')}`}
      >
        {shown.map((el) => {
          const color = CLS_COLOR[el.cls]
          const selected = selectedId === el.id
          const pinned = pinnedIds?.has(el.id) ?? false

          // R468 (F2 §3): TLA/PODLAGA z masko → POLIGON (območje, ne okvir)
          if ((el.cls === 'TLA' || el.cls === 'PODLAGA') && el.maskPoints && el.maskPoints.length >= 3) {
            const points = el.maskPoints.map((p) => `${(p.x * 100).toFixed(1)},${(p.y * 100).toFixed(1)}`).join(' ')
            return (
              <g key={el.id}>
                <polygon
                  points={points}
                  fill={color}
                  fillOpacity={selected ? 0.16 : 0.08}
                  stroke={color}
                  strokeWidth={selected ? 0.6 : 0.35}
                  strokeDasharray="1.6 1.2"
                />
                {pinned ? <circle cx={2} cy={98} r={0.9} fill={color} fillOpacity={0.5} /> : null}
              </g>
            )
          }

          // R468 (F2 §3): ROB → črta pod kotom angleDeg (transform okrog središča)
          if (el.cls === 'ROB') {
            const [x, y, w, h] = el.bbox
            const cx = (x + w / 2) * 100
            const cy = (y + h / 2) * 100
            const len = Math.max(4, w * 100 * 0.92)
            return (
              <g key={el.id} transform={`rotate(${(-(el.angleDeg ?? 0)).toFixed(2)}, ${cx.toFixed(2)}, ${cy.toFixed(2)})`}>
                <line
                  x1={(cx - len / 2).toFixed(2)}
                  y1={cy.toFixed(2)}
                  x2={(cx + len / 2).toFixed(2)}
                  y2={cy.toFixed(2)}
                  stroke={color}
                  strokeWidth={selected ? 1 : 0.65}
                  strokeLinecap="round"
                />
                <line
                  x1={(cx - len / 2).toFixed(2)}
                  y1={cy.toFixed(2)}
                  x2={(cx + len / 2).toFixed(2)}
                  y2={cy.toFixed(2)}
                  stroke="#ffffff"
                  strokeOpacity={0.5}
                  strokeWidth={0.18}
                  strokeLinecap="round"
                />
                {pinned ? <circle cx={(x * 100 + 2).toFixed(1)} cy={cy.toFixed(1)} r={0.9} fill={color} fillOpacity={0.5} /> : null}
              </g>
            )
          }

          // R469 (F3 §4): STOPNICA → vsaka nastopna črta kot svoja daljica
          if (el.cls === 'STOPNICA' && el.stepLines && el.stepLines.length >= 1) {
            return (
              <g key={el.id}>
                {el.stepLines.map((l, i) => (
                  <g key={`${el.id}-l${i}`}>
                    <line
                      x1={(l.x1 * 100).toFixed(2)}
                      y1={(l.y1 * 100).toFixed(2)}
                      x2={(l.x2 * 100).toFixed(2)}
                      y2={(l.y2 * 100).toFixed(2)}
                      stroke={color}
                      strokeWidth={selected ? 0.8 : 0.5}
                      strokeLinecap="round"
                    />
                    <line
                      x1={(l.x1 * 100).toFixed(2)}
                      y1={(l.y1 * 100).toFixed(2)}
                      x2={(l.x2 * 100).toFixed(2)}
                      y2={(l.y2 * 100).toFixed(2)}
                      stroke="#ffffff"
                      strokeOpacity={0.45}
                      strokeWidth={0.16}
                      strokeLinecap="round"
                    />
                  </g>
                ))}
                {pinned ? <circle cx={2} cy={2} r={0.9} fill={color} fillOpacity={0.5} /> : null}
              </g>
            )
          }

          const [x, y, w, h] = el.bbox
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
              {pinned ? <circle cx={x * 100 + 1.5} cy={y * 100 + 1.5} r={0.9} fill={color} fillOpacity={0.5} /> : null}
            </g>
          )
        })}
        {/* R470 (§5)/R485 (§9): dimenzijske osi — merilne črte brez cm;
            ŽIVO: izbrani element; MERE: vsi prikazani; PREPOZNANO: nikoli */}
        {axesFor.length >= 1 ? (
          <g aria-hidden>
            {axesFor.flatMap((el) =>
              axesOf(el).map((a, i) => (
                <AxisLine key={`axis-${el.id}-${i}`} a={a} color={CLS_COLOR[el.cls]} selected={selectedId === el.id} />
              )),
            )}
          </g>
        ) : null}
      </svg>
      {/* oznake so NAVADEN DOM nad svg — dotik mora biti dosegljiv (44 px) */}
      <div className="pointer-events-none absolute inset-0">
        {shown.map((el) => {
          const [x, y, w] = el.bbox
          const Icon = CLS_ICON[el.cls]
          const color = CLS_COLOR[el.cls]
          const selected = selectedId === el.id
          const pinned = pinnedIds?.has(el.id) ?? false
          const slope = slopeChip(el)
          const stair = stairChip(el)
          const measure = semanticOnly ? null : measureChip(el, measuresOnly)
          const confPct = `${Math.round(el.confidence * 100)} %`
          const name = el.cls === 'OSEBA' ? 'Morebitna oseba' : CLS_LABEL[el.cls]
          return (
            <button
              key={el.id}
              type="button"
              className={`pointer-events-auto absolute flex min-h-[28px] items-center gap-1 rounded-full border bg-white/95 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur transition dark:bg-zinc-900/95 ${selected ? 'ring-2 ring-offset-1' : ''} ${onSelect ? 'cursor-pointer hover:bg-white' : 'cursor-default'} ${measuresOnly ? 'opacity-95' : ''}`}
              style={{
                left: `${Math.min(92, Math.max(1, x * 100 + w * 50 - 12))}%`,
                top: `${Math.min(94, Math.max(2, y * 100 - 4))}%`,
                borderColor: color,
                color: '#2b2f36',
                ...(selected ? ({ '--tw-ring-color': color } as React.CSSProperties) : {}),
              }}
              onClick={onSelect ? () => { onSelect(el) } : undefined}
              aria-label={`${name}${el.kind ? ` (${el.kind.toLowerCase()})` : ''}${slope ? `, ${slope}` : ''}${stair ? `, ${stair}` : ''}${measure ? `, ${measure}` : ''} — ${STATUS_TEXT[el.status]}${pinned ? ' — pripeto' : ''}${el.cls === 'NEZNANO' ? ' — tapnite za označitev' : ''}`}
            >
              {pinned ? <MapPin className="size-3" style={{ color }} aria-hidden /> : null}
              <Icon className="size-3" style={{ color }} aria-hidden />
              <span className={measuresOnly ? 'text-[9px] font-normal text-zinc-500' : ''}>{name}{el.kind && el.kind !== 'NEZNANA' ? ` · ${el.kind.toLowerCase()}` : ''}</span>
              {stair ? <span className="font-semibold" style={{ color }}>{stair}</span> : null}
              {measure ? <span className="font-semibold" style={{ color }}>{measure}</span> : null}
              {slope ? <span className="font-semibold" style={{ color }}>{slope}</span> : null}
              <span className="font-normal text-zinc-500">· {STATUS_TEXT[el.status]}</span>
              {semanticOnly ? <span className="font-normal text-zinc-500">· {confPct}</span> : null}
            </button>
          )
        })}
      </div>
      {/* naslednji korak za monterja (issue §8) — ena vrstica, spodaj;
          R570: v celozaslonskem načinu jo izriše nosilec nad gumbi (guidance=false) */}
      {guidance && guidanceText ? (
        <p
          className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-zinc-900/75 px-2.5 py-1.5 text-center text-[11px] leading-snug text-white shadow"
          role="status"
        >
          {guidanceText}
        </p>
      ) : null}
    </>
  )
}

/** Slovenska beseda za vir/estatus geometrije (izvoz za detail kartice). */
export function geomStatusText (el: SceneElement): string | null {
  if (el.geomStatus == null) return null
  return GEOM_TEXT[el.geomStatus] ?? null
}

/** Slovenska beseda za vir naklona (izvoz za detail kartice). */
export function slopeSourceText (el: SceneElement): string | null {
  if (el.slopeSource == null) return null
  return SLOPE_TEXT[el.slopeSource] ?? null
}

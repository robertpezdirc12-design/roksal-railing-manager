'use client'

// PREGLED — risbe (tloris / profil / 3D perspektiva / javni tloris / merilo).
// R546: izvlečeno iz pregled.tsx BREZ spremembe obnašanja; skupni tipi in
// konstante so v pregled-shared.ts.

import { project3d, projectPlan, projectProfile, type ModelNode, type PlanModel } from '@/lib/model-core'
import { Slider } from '@/components/ui/slider'
import { SEGMENT_STATUSES } from '@/lib/fence-run-engine'
import { NODE_GLYPH, PIN_TONE, STROKE, STROKE_SELECTED, fmtCm, niceStep, range, type PinMarker } from './pregled-shared'

// ─── Tloris (z markerji pinov + izolacija + klik → x/y) ──────────────────────

export function PlanViewP ({
  m, selectedKey, onSegmentClick, pins, segDim, nodeDim,
}: {
  m: PlanModel
  selectedKey: string | null
  onSegmentClick: (key: string, world?: { x: number; y: number }) => void
  pins: PinMarker[]
  segDim: (key: string) => boolean
  nodeDim: (key: string) => boolean
}) {
  const W = 900; const H = 560; const PAD = 60
  const bw = Math.max(1, m.bounds.maxX - m.bounds.minX); const bh = Math.max(1, m.bounds.maxY - m.bounds.minY)
  const scale = Math.min((W - 2 * PAD) / bw, (H - 2 * PAD) / bh)
  const offX = ((W - 2 * PAD) - bw * scale) / 2; const offY = ((H - 2 * PAD) - bh * scale) / 2
  const tx = (x: number): number => (x - m.bounds.minX) * scale + PAD + offX
  const ty = (y: number): number => (y - m.bounds.minY) * scale + PAD + offY
  const edges = projectPlan(m)
  const gridStep = niceStep(50 / scale)
  const [gMinX, gMaxX] = [Math.floor(m.bounds.minX / gridStep) * gridStep, Math.ceil(m.bounds.maxX / gridStep) * gridStep]
  const [gMinY, gMaxY] = [Math.floor(m.bounds.minY / gridStep) * gridStep, Math.ceil(m.bounds.maxY / gridStep) * gridStep]

  /** klik v SVG → svetovne koordinate modela (cm) — za x/y pina */
  function worldFromEvent (e: React.MouseEvent<SVGLineElement>): { x: number; y: number } | undefined {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return undefined
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0) return undefined
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const vy = ((e.clientY - rect.top) / rect.height) * H
    return {
      x: (vx - PAD - offX) / scale + m.bounds.minX,
      y: (vy - PAD - offY) / scale + m.bounds.minY,
    }
  }

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="Tloris merilnega modela s pripombami">
        {/* mreža */}
        {range(gMinX, gMaxX, gridStep).map((gx) => (
          <line key={`gx${gx}`} x1={tx(gx)} y1={0} x2={tx(gx)} y2={H} className="stroke-muted/30" strokeWidth={1} />
        ))}
        {range(gMinY, gMaxY, gridStep).map((gy) => (
          <line key={`gy${gy}`} x1={0} y1={ty(gy)} x2={W} y2={ty(gy)} className="stroke-muted/30" strokeWidth={1} />
        ))}
        {/* segmenti */}
        {edges.map((e) => {
          const sel = e.key === selectedKey
          const dim = segDim(e.key)
          const st = SEGMENT_STATUSES[e.status as keyof typeof SEGMENT_STATUSES] ?? SEGMENT_STATUSES.ESTIMATED
          return (
            <g key={e.key} opacity={dim ? 0.15 : 1}>
              <line
                x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
                stroke={sel ? STROKE_SELECTED : (STROKE[e.status] ?? STROKE.ESTIMATED)}
                strokeWidth={sel ? 6 : 4} strokeLinecap="round" className="cursor-pointer"
                onClick={(ev) => onSegmentClick(e.key, worldFromEvent(ev))}
              >
                <title>{`${e.key} — ${fmtCm(e.labelCm)} (${st.label})`}</title>
              </line>
              <text
                x={(tx(e.x1) + tx(e.x2)) / 2} y={(ty(e.y1) + ty(e.y2)) / 2 - 8}
                textAnchor="middle" className="fill-foreground pointer-events-none text-[11px]"
              >
                {`${e.key} · ${Math.round(e.labelCm)}`}
              </text>
            </g>
          )
        })}
        {/* vozlišča */}
        {m.nodes.map((n) => <NodeGlyphP key={n.key} n={n} cx={tx(n.p.x)} cy={ty(n.p.y)} dim={nodeDim(n.key)} />)}
        {/* markerji pinov (x/y v svetovnih cm) */}
        {pins.filter((p) => p.x != null && p.y != null).map((p) => {
          const tone = PIN_TONE[p.status] ?? PIN_TONE.ZAPRT
          return (
            <g key={`pin${p.id}`} className="pointer-events-none">
              <circle cx={tx(p.x as number)} cy={ty(p.y as number)} r={7} fill={tone.fill} stroke="#ffffff" strokeWidth={2} />
              <circle cx={tx(p.x as number)} cy={ty(p.y as number)} r={11} fill="none" stroke={tone.fill} strokeWidth={1.5} opacity={0.5} />
              <title>{`Pripomba [${tone.label}] · ${p.targetKey}: ${p.note}`}</title>
            </g>
          )
        })}
        {/* smer +X */}
        <g>
          <defs>
            <marker id="arrowX-pregled" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          <line x1={PAD - 30} y1={H - PAD + 20} x2={PAD + 10} y2={H - PAD + 20} className="stroke-muted-foreground" strokeWidth={1.5} markerEnd="url(#arrowX-pregled)" />
          <text x={PAD - 30} y={H - PAD + 36} className="fill-muted-foreground text-[10px]">+X (smer 1. segmenta)</text>
        </g>
        <ScaleBar scale={scale} y={H - 24} />
      </svg>
      <div className="text-xs text-muted-foreground">Tloris (cm) — {m.originNote}. Pripombe (pike) ne spreminjajo meritev.</div>
    </div>
  )
}

function NodeGlyphP ({ n, cx, cy, dim }: { n: ModelNode; cx: number; cy: number; dim: boolean }) { // R546: lokalen gradnik tlorisa
  const g = NODE_GLYPH[n.kind] ?? NODE_GLYPH.STEBER
  const fill = n.kind === 'VOGAL' ? '#d97706' : n.kind === 'VRATA' ? '#8b5cf6' : n.kind === 'KONEC' ? '#475569' : '#059669'
  return (
    <g opacity={dim ? 0.15 : 1}>
      {g.shape === 'diamond'
        ? <rect x={cx - 5} y={cy - 5} width={10} height={10} transform={`rotate(45 ${cx} ${cy})`} fill={fill} />
        : g.shape === 'rect'
          ? <rect x={cx - 5} y={cy - 5} width={10} height={10} fill={fill} />
          : <circle cx={cx} cy={cy} r={5} fill={fill} />}
      <text x={cx + 8} y={cy - 6} className="fill-muted-foreground pointer-events-none text-[9px]">{g.label}</text>
      <title>{`${n.key} · ${n.kind}${n.heightCm != null ? ` · h=${n.heightCm} cm` : ''}${n.podlaga != null ? ` · ${n.podlaga}` : ''}`}</title>
    </g>
  )
}

// ─── Profil (elevacija) ─────────────────────────────────────────────────────

export function ProfileViewP ({ m, selectedKey, onSelect, segDim }: {
  m: PlanModel; selectedKey: string | null; onSelect: (k: string) => void; segDim: (key: string) => boolean
}) {
  const W = 900; const H = 420; const PAD = 50
  const { points, segs } = projectProfile(m)
  const maxAt = Math.max(1, ...points.map((p) => p.atCm))
  const zMin = Math.min(0, ...points.map((p) => p.zGround)); const zMax = Math.max(1, ...points.map((p) => p.zTop ?? p.zGround))
  const sx = (at: number): number => PAD + (at / maxAt) * (W - 2 * PAD)
  const sy = (z: number): number => H - PAD - ((z - zMin) / (zMax - zMin)) * (H - 2 * PAD)
  const scale = (W - 2 * PAD) / maxAt

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="Višinski profil modela">
        <polyline
          points={points.map((p) => `${sx(p.atCm)},${sy(p.zGround)}`).join(' ')}
          className="fill-none stroke-muted-foreground/60" strokeWidth={2}
        />
        {segs.map((s) => {
          const sel = s.key === selectedKey
          return (
            <line
              key={s.key} x1={sx(s.x1)} y1={sy(s.z1)} x2={sx(s.x2)} y2={sy(s.z2)}
              stroke={sel ? STROKE_SELECTED : (STROKE[s.status] ?? STROKE.ESTIMATED)} strokeWidth={sel ? 6 : 4} strokeLinecap="round"
              className="cursor-pointer" onClick={() => onSelect(s.key)} opacity={segDim(s.key) ? 0.15 : 1}
            >
              <title>{`${s.key} — padina ${s.slopeDeg.toFixed(1)}°`}</title>
            </line>
          )
        })}
        {points.map((p) => (
          <g key={p.key}>
            <line x1={sx(p.atCm)} y1={sy(p.zGround)} x2={sx(p.atCm)} y2={p.zTop != null ? sy(p.zTop) : sy(p.zGround)} className="stroke-foreground/70" strokeWidth={2} />
            <circle cx={sx(p.atCm)} cy={sy(p.zGround)} r={3} className="fill-muted-foreground" />
            <title>{`${p.key} · teren ${Math.round(p.zGround)} cm${p.zTop != null ? ` · vrh ${Math.round(p.zTop)} cm` : ''}`}</title>
          </g>
        ))}
        <polyline
          points={points.filter((p) => p.zTop != null).map((p) => `${sx(p.atCm)},${sy(p.zTop as number)}`).join(' ')}
          className="fill-none stroke-foreground/50" strokeWidth={1.5} strokeDasharray="5 4"
        />
        <ScaleBar scale={scale} y={H - 16} />
      </svg>
      <div className="text-xs text-muted-foreground">Profil ob teku (x = oddaljenost, y = višina v cm) — črtkano = vrhovi stebrov, kjer so znani.</div>
    </div>
  )
}

// ─── 3D perspektiva ─────────────────────────────────────────────────────────

export function PerspectiveViewP ({
  m, selectedKey, onSelect, yaw, pitch, setYaw, setPitch, segDim,
}: {
  m: PlanModel; selectedKey: string | null; onSelect: (k: string) => void
  yaw: number; pitch: number; setYaw: (n: number) => void; setPitch: (n: number) => void
  segDim: (key: string) => boolean
}) {
  const W = 900; const H = 560
  const cx = (m.bounds.minX + m.bounds.maxX) / 2; const cy = (m.bounds.minY + m.bounds.maxY) / 2
  const cz = (m.bounds.minZ + m.bounds.maxZ) / 2
  const span = Math.max(
    5, m.bounds.maxX - m.bounds.minX, m.bounds.maxY - m.bounds.minY,
    (m.bounds.maxZ - m.bounds.minZ) + 120,
  )
  const f = Math.max(500, 2.2 * span)
  const P = (x: number, y: number, z: number) => {
    const r = project3d({ x: x - cx, y: y - cy, z: z - cz }, yaw, pitch, f)
    return { sx: W / 2 + r.sx, sy: H / 2 + r.sy, depth: r.depth }
  }

  type Quad = { pts: { sx: number; sy: number; depth: number }[]; key: string; kind: 'seg' | 'terrain' }
  const quads: Quad[] = []
  for (const s of m.segments) {
    const ha = m.nodes.find((n) => n.key === s.fromKey); const hb = m.nodes.find((n) => n.key === s.toKey)
    const hA = ha?.heightCm ?? 110; const hB = hb?.heightCm ?? 110
    const a = { x: s.a.x, y: s.a.y, z: s.a.z }; const b = { x: s.b.x, y: s.b.y, z: s.b.z }
    quads.push({
      key: s.key, kind: 'seg',
      pts: [P(a.x, a.y, a.z), P(b.x, b.y, b.z), P(b.x, b.y, b.z + hB), P(a.x, a.y, a.z + hA)],
    })
    quads.push({ key: s.key, kind: 'terrain', pts: [P(a.x, a.y, a.z - 6), P(b.x, b.y, b.z - 6), P(b.x, b.y, b.z), P(a.x, a.y, a.z)] })
  }
  const terrainQuads = quads.filter((q) => q.kind === 'terrain')
  const segQuads = quads.filter((q) => q.kind === 'seg').sort((q1, q2) => avgDepth(q2) - avgDepth(q1))

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="3D perspektiva modela">
        {terrainQuads.map((q, i) => (
          <polygon
            key={`t${q.key}${i}`} points={q.pts.map((p) => `${p.sx},${p.sy}`).join(' ')}
            className="fill-muted/40 stroke-muted/60" strokeWidth={1}
          />
        ))}
        {segQuads.map((q, i) => {
          const s = m.segments.find((ss) => ss.key === q.key)
          const sel = q.key === selectedKey
          return (
            <polygon
              key={`s${q.key}${i}`} points={q.pts.map((p) => `${p.sx},${p.sy}`).join(' ')}
              fill={sel ? 'rgba(220,38,38,0.35)' : 'rgba(5,150,105,0.18)'}
              stroke={sel ? STROKE_SELECTED : (STROKE[s?.status ?? 'ESTIMATED'] ?? STROKE.ESTIMATED)}
              strokeWidth={sel ? 3 : 2} className="cursor-pointer" onClick={() => onSelect(q.key)}
              opacity={segDim(q.key) ? 0.15 : 1}
            >
              <title>{`${q.key} — ${s ? fmtCm(s.lengthCm) : ''}`}</title>
            </polygon>
          )
        })}
        <polyline
          points={m.nodes.map((n) => { const p = P(n.p.x, n.p.y, n.p.z); return `${p.sx},${p.sy}` }).join(' ')}
          className="fill-none stroke-foreground/50" strokeWidth={1.5}
        />
        <polyline
          points={m.nodes.map((n) => { const p = P(n.p.x, n.p.y, n.p.z + (n.heightCm ?? 110)); return `${p.sx},${p.sy}` }).join(' ')}
          className="fill-none stroke-foreground/80" strokeWidth={2.5} strokeLinejoin="round"
        />
        {m.nodes.map((n) => {
          const h = n.heightCm ?? 110
          const b = P(n.p.x, n.p.y, n.p.z); const t = P(n.p.x, n.p.y, n.p.z + h)
          return (
            <line key={`p${n.key}`} x1={b.sx} y1={b.sy} x2={t.sx} y2={t.sy} className="stroke-foreground/80" strokeWidth={2.5} strokeLinecap="round">
              <title>{`${n.key} · ${n.kind} · h=${h} cm`}</title>
            </line>
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-48 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground"><span>Obhod (yaw)</span><span>{yaw}°</span></div>
          <Slider value={[yaw]} min={-90} max={90} step={5} onValueChange={(v) => setYaw(v[0])} aria-label="Obhod pogleda" />
        </div>
        <div className="flex-1 min-w-48 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground"><span>Nagib (pitch)</span><span>{pitch}°</span></div>
          <Slider value={[pitch]} min={5} max={60} step={5} onValueChange={(v) => setPitch(v[0])} aria-label="Nagib pogleda" />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Perspektivni prikaz — mere (cm) iz tekača; višine stebrov prikazane tudi tam, kjer niso izmerjene (privzeto 110 cm).</div>
    </div>
  )
}

function avgDepth (q: { pts: { depth: number }[] }): number {
  return q.pts.reduce((a, p) => a + p.depth, 0) / q.pts.length
}

/** Preprost javni tloris (brez interakcije) — isti izris kot interni, iz javnega modela. */
export function PublicPlanView ({ m, pins }: { m: PlanModel; pins: PinMarker[] }) {
  const W = 900; const H = 420; const PAD = 60
  const bw = Math.max(1, m.bounds.maxX - m.bounds.minX); const bh = Math.max(1, m.bounds.maxY - m.bounds.minY)
  const scale = Math.min((W - 2 * PAD) / bw, (H - 2 * PAD) / bh)
  const tx = (x: number): number => (x - m.bounds.minX) * scale + PAD + ((W - 2 * PAD) - bw * scale) / 2
  const ty = (y: number): number => (y - m.bounds.minY) * scale + PAD + ((H - 2 * PAD) - bh * scale) / 2
  const edges = projectPlan(m)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border bg-background" role="img" aria-label="Javni tloris modela">
      {edges.map((e) => (
        <g key={e.key}>
          <line
            x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
            stroke={STROKE[e.status] ?? STROKE.ESTIMATED} strokeWidth={4} strokeLinecap="round"
          />
          <text
            x={(tx(e.x1) + tx(e.x2)) / 2} y={(ty(e.y1) + ty(e.y2)) / 2 - 8}
            textAnchor="middle" className="fill-foreground text-[11px]"
          >
            {`${e.key} · ${Math.round(e.labelCm)}`}
          </text>
        </g>
      ))}
      {m.nodes.map((n) => {
        const g = NODE_GLYPH[n.kind] ?? NODE_GLYPH.STEBER
        const fill = n.kind === 'VOGAL' ? '#d97706' : n.kind === 'VRATA' ? '#8b5cf6' : n.kind === 'KONEC' ? '#475569' : '#059669'
        return (
          <circle key={n.key} cx={tx(n.p.x)} cy={ty(n.p.y)} r={5} fill={fill}>
            <title>{`${n.key} · ${n.kind}`}</title>
          </circle>
        )
      })}
      {/* pini z znanim x/y (javni pogled: javne pripombe) */}
      {pins.filter((p) => p.x != null && p.y != null).map((p) => {
        const tone = PIN_TONE[p.status] ?? PIN_TONE.ZAPRT
        return (
          <circle key={`pp${p.id}`} cx={tx(p.x as number)} cy={ty(p.y as number)} r={6} fill={tone.fill} stroke="#ffffff" strokeWidth={2}>
            <title>{`Pripomba [${tone.label}] · ${p.targetKey}: ${p.note}`}</title>
          </circle>
        )
      })}
      <ScaleBar scale={scale} y={H - 20} />
    </svg>
  )
}

// ─── Pomožno ────────────────────────────────────────────────────────────────

export function ScaleBar ({ scale, y }: { scale: number; y: number }) {
  const cm = niceStep(120 / scale) // ~120 px
  const px = cm * scale
  return (
    <g>
      <rect x={24} y={y - 10} width={px} height={5} className="fill-foreground" />
      <rect x={24 + px} y={y - 10} width={px} height={5} className="fill-background stroke-foreground" strokeWidth={1} />
      <text x={24} y={y - 16} className="fill-foreground text-[10px]">{cm} cm</text>
      <text x={24 + px * 2 + 6} y={y - 16} className="fill-foreground text-[10px]">{cm * 2} cm</text>
    </g>
  )
}

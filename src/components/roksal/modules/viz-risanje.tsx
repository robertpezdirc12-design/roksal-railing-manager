'use client'

// VIZ — SVG risalno jedro: parametrična tehnična risba ograje (tloris +
// stranski pogled, merilo 1:1, mreža 50 cm, izvoz SVG prek ref) — R548 izvleček
// iz viz.tsx (razbitje po vzorcu R546/R547; BREZ spremembe obnašanja).
// computeGeometry je čista funkcija nad RailingSvgProps (en vir geometrije).

import { useMemo, type ReactNode, type Ref } from 'react'
import { fmtM } from './viz-3d'

// ─── konstante ───────────────────────────────────────────────────────────────

const GLASS_FILL = 'rgba(148, 163, 184, 0.28)'
const GLASS_STROKE = 'rgba(100, 116, 139, 0.55)'
const INK = '#334155'      // črte / besedilo
const INK_SOFT = '#94a3b8' // mreža
const PAPER = '#ffffff'

// ─── SVG risba ───────────────────────────────────────────────────────────────

export interface RailingSvgProps {
  lengthCm: number
  heightCm: number
  posts: number
  handrail: boolean
  slopeDeg: number
  colorHex: string
  glass: boolean
  sku: string | null
  profileName: string | null
  colorLabel: string
  titleId: string
}

export function RailingSvg (props: RailingSvgProps & { ref?: Ref<SVGSVGElement> }) {
  const { ref, titleId } = props
  const geo = useMemo(() => computeGeometry(props), [props])

  const postsX = geo.postsX
  const x0 = geo.x0
  const x1 = geo.x1
  const groundY = geo.groundY
  const pxH = geo.pxH
  const slope = props.slopeDeg

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${geo.VW} ${geo.VH}`}
      className="w-full"
      role="img"
      aria-label={`Risba ograje: dolžina ${fmtM(props.lengthCm)} m, višina ${Math.round(props.heightCm)} cm, ${props.posts} stebrov`}
    >
      <title id={titleId}>Vizualizacija ograje — tloris in stranski pogled</title>

      {/* platno */}
      <rect x="0" y="0" width={geo.VW} height={geo.VH} fill={PAPER} />
      <rect x="4" y="4" width={geo.VW - 8} height={geo.VH - 8} fill="none" stroke="#e2e8f0" strokeWidth="2" rx="10" />

      {/* ── TLORIS ── */}
      <text x="28" y="34" fontSize="15" fontWeight="700" fill={INK}>Tloris</text>
      <PlanView geo={geo} colorHex={props.colorHex} glass={props.glass} />

      {/* dimenzija dolžine */}
      <DimLine x1={x0} x2={x1} y={geo.planDimY} label={`${fmtM(props.lengthCm)} m`} />

      {/* ── STRANSKI POGLED ── */}
      <text x="28" y={geo.elevTitleY} fontSize="15" fontWeight="700" fill={INK}>Stranski pogled</text>

      {/* mreža 50 cm */}
      <GridLines geo={geo} />

      {/* tla */}
      <line x1={geo.gridX0 - 16} y1={groundY} x2={geo.gridX1 + 16} y2={groundY} stroke={INK} strokeWidth="2.5" />

      {/* ograja (rotirana pri nagibu) */}
      <g transform={slope > 0 ? `rotate(${-slope} ${x0} ${groundY})` : undefined}>
        {/* polnilo segmentov */}
        {postsX.slice(0, -1).map((px, i) => {
          const nx = postsX[i + 1]
          const w = nx - px - geo.postW - 4
          if (w <= 2) return null
          const fillTop = groundY - pxH + (props.handrail ? 16 : 6)
          const fillBot = groundY - 8
          if (props.glass) {
            return (
              <rect
                key={`seg-${i}`} x={px + geo.postW / 2 + 2} y={fillTop}
                width={w} height={fillBot - fillTop}
                fill={GLASS_FILL} stroke={GLASS_STROKE} strokeWidth="1"
              />
            )
          }
          // navpični palice — razmak ~12 cm
          const paleGap = Math.max(6, geo.pxPerCm * 12)
          const paleCount = Math.max(2, Math.floor(w / paleGap))
          const paleW = Math.max(2, Math.min(5, geo.pxPerCm * 2))
          return (
            <g key={`seg-${i}`}>
              {Array.from({ length: paleCount }).map((_, j) => {
                const pxx = px + geo.postW / 2 + 4 + (j * (w - paleW)) / Math.max(1, paleCount - 1)
                return <rect key={j} x={pxx} y={fillTop} width={paleW} height={fillBot - fillTop} fill={props.colorHex} opacity="0.9" rx="1" />
              })}
            </g>
          )
        })}

        {/* srednja palica */}
        {props.handrail ? (
          <rect x={x0 - 4} y={groundY - pxH * 0.55} width={x1 - x0 + 8} height={Math.max(4, geo.pxPerCm * 3)} fill={props.colorHex} rx="2" />
        ) : null}

        {/* stebri */}
        {postsX.map((px, i) => (
          <rect key={`post-${i}`} x={px} y={groundY - pxH} width={geo.postW} height={pxH} fill={props.colorHex} rx="1.5" />
        ))}

        {/* ročnik */}
        {props.handrail ? (
          <rect x={x0 - 6} y={groundY - pxH - 10} width={x1 - x0 + 12} height={Math.max(6, geo.pxPerCm * 4)} fill={props.colorHex} rx="3" />
        ) : null}
      </g>

      {/* dimenzija višine */}
      <DimLineV x={geo.dimVX} y1={groundY - pxH - (props.handrail ? 14 : 4)} y2={groundY} label={`${Math.round(props.heightCm)} cm`} />

      {/* kot nagiba */}
      {slope > 0 ? (
        <g>
          <path
            d={`M ${x0 + 44} ${groundY} A 44 44 0 0 0 ${x0 + 44 * Math.cos((slope * Math.PI) / 180)} ${groundY - 44 * Math.sin((slope * Math.PI) / 180)}`}
            fill="none" stroke="#b45309" strokeWidth="1.5"
          />
          <text x={x0 + 54} y={groundY - 12} fontSize="12" fontWeight="700" fill="#b45309">
            {slope.toFixed(1).replace('.', ',')}°
          </text>
        </g>
      ) : null}

      {/* naslovni blok */}
      <g>
        <rect x={geo.VW - 330} y={geo.VH - 74} width="300" height="58" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
        <text x={geo.VW - 316} y={geo.VH - 54} fontSize="12" fontWeight="700" fill={INK}>
          {props.sku ? `${props.sku} · ${props.profileName ?? ''}` : 'Ograja po meri'}
        </text>
        <text x={geo.VW - 316} y={geo.VH - 36} fontSize="11" fill={INK}>
          {fmtM(props.lengthCm)} m × {Math.round(props.heightCm)} cm · {props.posts} stebrov{props.handrail ? ' · ročnik' : ''}
        </text>
        <text x={geo.VW - 316} y={geo.VH - 20} fontSize="11" fill={INK}>Barva: {props.colorLabel}</text>
      </g>

      {/* merilo */}
      <g>
        <rect x="28" y={geo.VH - 60} width={geo.scaleBarPx} height="8" fill="#0f172a" />
        <rect x="28" y={geo.VH - 60} width={geo.scaleBarPx / 2} height="8" fill="#ffffff" stroke="#0f172a" strokeWidth="1" />
        <text x="28" y={geo.VH - 66} fontSize="11" fill={INK}>Merilo: {geo.scaleLabel}</text>
      </g>
    </svg>
  )
}

// ─── geometrija ──────────────────────────────────────────────────────────────

export interface Geo {
  VW: number; VH: number
  x0: number; x1: number; pxLen: number; postW: number
  planBandY: number; planBandH: number; planDimY: number
  elevTitleY: number; groundY: number; pxH: number
  gridX0: number; gridX1: number; gridStep: number
  dimVX: number; pxPerCm: number; postsX: number[]
  scaleBarPx: number; scaleLabel: string
}

export function computeGeometry (p: RailingSvgProps): Geo {
  const VW = 860
  const VH = 720
  const x0 = 90
  const availW = VW - 90 - 60 // 710
  const availH = 300          // prostor za višino v elevaciji
  const pxPerCm = Math.min(availW / p.lengthCm, availH / p.heightCm)
  const pxLen = p.lengthCm * pxPerCm
  const x1 = x0 + pxLen
  const postW = Math.max(5, Math.min(14, pxPerCm * 8))
  const pxH = p.heightCm * pxPerCm

  const n = Math.max(1, p.posts)
  const postsX = n === 1
    ? [x0]
    : Array.from({ length: n }, (_, i) => x0 + (i * pxLen) / (n - 1) - postW / 2)

  const planBandY = 120
  const planBandH = 44
  const planDimY = planBandY + planBandH + 44
  const elevTitleY = planDimY + 58
  const groundY = elevTitleY + 26 + pxH

  // mreža: 50 cm
  const gridStep = pxPerCm * 50
  const gridX0 = x0
  const gridX1 = x1

  const scaleBarPx = Math.max(60, Math.min(220, pxPerCm * 100))
  const scaleLabel = `1 px = ${(1 / pxPerCm).toFixed(2).replace('.', ',')} cm · trak = ${fmtM(scaleBarPx / pxPerCm)} m`

  return {
    VW, VH, x0, x1, pxLen, postW,
    planBandY, planBandH, planDimY,
    elevTitleY, groundY, pxH,
    gridX0, gridX1, gridStep,
    dimVX: x0 - 34, pxPerCm, postsX,
    scaleBarPx, scaleLabel,
  }
}

// ─── delci risbe ─────────────────────────────────────────────────────────────

export function PlanView ({ geo, colorHex, glass }: { geo: Geo; colorHex: string; glass: boolean }) {
  const bandY = geo.planBandY
  const bandH = geo.planBandH
  const midY = bandY + bandH / 2
  const posts = geo.postsX
  const x0 = geo.x0
  const x1 = geo.x1

  return (
    <g>
      {/* banda ograje */}
      <rect x={x0} y={bandY} width={geo.pxLen} height={bandH} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1" />
      {/* polnilo segmentov (tloris) */}
      {posts.slice(0, -1).map((px, i) => {
        const nx = posts[i + 1]
        const w = nx - px - geo.postW - 4
        if (w <= 2) return null
        if (glass) {
          return <rect key={`pg-${i}`} x={px + geo.postW / 2 + 2} y={bandY + 8} width={w} height={bandH - 16} fill={GLASS_FILL} stroke={GLASS_STROKE} strokeWidth="0.8" />
        }
        return <line key={`pg-${i}`} x1={px + geo.postW / 2 + 3} y1={midY} x2={nx + geo.postW / 2 - 3} y2={midY} stroke={colorHex} strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      })}
      {/* stebri */}
      {posts.map((px, i) => (
        <rect key={`pp-${i}`} x={px} y={midY - geo.postW / 2} width={geo.postW} height={geo.postW} fill={colorHex} stroke="#1f293722" rx="1" />
      ))}
      {/* središčna os */}
      <line x1={x0} y1={midY} x2={x1} y2={midY} stroke="#cbd5e1" strokeWidth="0.6" strokeDasharray="6 4" />
    </g>
  )
}

export function GridLines ({ geo }: { geo: Geo }) {
  const lines: ReactNode[] = []
  const topY = geo.elevTitleY + 18
  const bottomY = geo.groundY
  if (geo.gridStep < 8) return null // pregosto — izpusti
  for (let x = geo.gridX0, i = 0; x <= geo.gridX1 + 0.1; x += geo.gridStep, i++) {
    lines.push(<line key={`gx-${i}`} x1={x} y1={topY} x2={x} y2={bottomY} stroke={INK_SOFT} strokeWidth="0.5" opacity="0.35" />)
  }
  for (let y = bottomY, j = 0; y >= topY; y -= geo.gridStep, j++) {
    lines.push(<line key={`gy-${j}`} x1={geo.gridX0} y1={y} x2={geo.gridX1} y2={y} stroke={INK_SOFT} strokeWidth="0.5" opacity="0.35" />)
  }
  // oznaka mreže
  lines.push(
    <text key="grid-label" x={geo.gridX0} y={topY - 4} fontSize="10" fill={INK_SOFT}>
      mreža = 50 cm
    </text>
  )
  return <g>{lines}</g>
}

export function DimLine ({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  const mid = (x1 + x2) / 2
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={INK} strokeWidth="1" />
      <line x1={x1} y1={y - 8} x2={x1} y2={y + 8} stroke={INK} strokeWidth="1" />
      <line x1={x2} y1={y - 8} x2={x2} y2={y + 8} stroke={INK} strokeWidth="1" />
      <polygon points={`${x1},${y} ${x1 + 8},${y - 3.5} ${x1 + 8},${y + 3.5}`} fill={INK} />
      <polygon points={`${x2},${y} ${x2 - 8},${y - 3.5} ${x2 - 8},${y + 3.5}`} fill={INK} />
      <rect x={mid - 34} y={y - 20} width="68" height="16" fill={PAPER} />
      <text x={mid} y={y - 8} fontSize="13" fontWeight="700" fill={INK} textAnchor="middle">{label}</text>
    </g>
  )
}

export function DimLineV ({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) {
  const mid = (y1 + y2) / 2
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={INK} strokeWidth="1" />
      <line x1={x - 8} y1={y1} x2={x + 8} y2={y1} stroke={INK} strokeWidth="1" />
      <line x1={x - 8} y1={y2} x2={x + 8} y2={y2} stroke={INK} strokeWidth="1" />
      <polygon points={`${x},${y1} ${x - 3.5},${y1 + 8} ${x + 3.5},${y1 + 8}`} fill={INK} />
      <polygon points={`${x},${y2} ${x - 3.5},${y2 - 8} ${x + 3.5},${y2 - 8}`} fill={INK} />
      <rect x={x - 4} y={mid - 24} width="52" height="16" fill={PAPER} />
      <text x={x + 4} y={mid - 12} fontSize="12" fontWeight="700" fill={INK}>{label}</text>
    </g>
  )
}

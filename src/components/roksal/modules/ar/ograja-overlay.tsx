'use client'

// ograja-overlay.tsx — SVG ograja kot vlečni overlay za AR predogled (R537-b:
// iz ar.tsx, dobesedna selitev). Eksplicitne barve — samostojen data URL,
// ker se SVG serializira in riše na canvas ob zajemu.

import type { Ref } from 'react'

import type { RunSegmentRow } from './tipi'

const ANTHRACITE = '#2b2f36'
export const OVERLAY_W = 320
export const OVERLAY_H = 220

// ─── SVG ograja za AR overlay (eksplicitne barve — samostojen data URL) ──────

export function ArRailingSvg ({ ref, posts, heightCm }: { ref?: Ref<SVGSVGElement>; posts: number; heightCm: number }) {
  const baseY = 200
  const hPx = Math.min(158, Math.max(48, heightCm * 0.72))
  const x0 = 18
  const x1 = OVERLAY_W - 18
  const postW = 9
  const xs = Array.from({ length: posts }, (_, i) => x0 + (i * (x1 - x0 - postW)) / Math.max(1, posts - 1))

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${OVERLAY_W} ${OVERLAY_H}`}
      width={OVERLAY_W}
      height={OVERLAY_H}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>AR ograja</title>
      {/* mehka senca */}
      <ellipse cx={OVERLAY_W / 2} cy={baseY + 5} rx={(x1 - x0) / 2 + 8} ry="7" fill="rgba(0,0,0,0.28)" />
      {/* polnilo — navpične palice */}
      {xs.slice(0, -1).map((px, i) => {
        const nx = xs[i + 1]
        const w = nx - px - postW - 3
        if (w <= 3) return null
        const count = Math.max(2, Math.round(w / 11))
        return (
          <g key={`p-${i}`}>
            {Array.from({ length: count }).map((_, j) => (
              <rect
                key={j}
                x={px + postW + 2 + (j * (w - 4)) / Math.max(1, count - 1)}
                y={baseY - hPx + 13}
                width="3.5"
                height={hPx - 21}
                fill={ANTHRACITE}
                opacity="0.92"
                rx="1"
              />
            ))}
          </g>
        )
      })}
      {/* srednja palica */}
      <rect x={x0 - 3} y={baseY - hPx * 0.55} width={x1 - x0 + 6} height="5" fill={ANTHRACITE} rx="2" />
      {/* stebri */}
      {xs.map((px, i) => (
        <rect key={`s-${i}`} x={px} y={baseY - hPx} width={postW} height={hPx} fill={ANTHRACITE} rx="2" />
      ))}
      {/* ročnik */}
      <rect x={x0 - 5} y={baseY - hPx - 8} width={x1 - x0 + 10} height="8" fill={ANTHRACITE} rx="3" />
    </svg>
  )
}

// ─── SVG ograja IZ TEKAČA (R465 — več segmentov po realni geometriji) ──────
// Segmenti (R460 engine) se narišejo sorazmerno dolžinam; višine, stebri,
// vrata (toKind=VRATA) in vogali (toKind=VOGAL) iz segmentnih podatkov.
// Eksplicitne barve — samostojen data URL za zajem na canvas.

export function ArRunRailingSvg ({ ref, segments, fallbackHeightCm }: {
  ref?: Ref<SVGSVGElement>
  segments: RunSegmentRow[]
  fallbackHeightCm: number
}) {
  const baseY = 200
  const postW = 9
  const x0 = 14
  const x1 = OVERLAY_W - 14
  const usable = x1 - x0
  const totalCm = Math.max(1, segments.reduce((a, s) => a + Math.max(1, s.lengthCm), 0))
  const segWidth = (s: RunSegmentRow): number => Math.max(8, (Math.max(1, s.lengthCm) / totalCm) * usable)

  // razporeditev segmentov po dolžini (sorazmerno) — brez mutacij
  const drawn = segments.map((s, i) => ({
    s,
    x: x0 + segments.slice(0, i).reduce((a, p) => a + segWidth(p), 0),
    w: segWidth(s),
  }))

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${OVERLAY_W} ${OVERLAY_H}`}
      width={OVERLAY_W}
      height={OVERLAY_H}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>AR ograja — segmenti tekača</title>
      {/* mehka senca */}
      <ellipse cx={OVERLAY_W / 2} cy={baseY + 5} rx={usable / 2 + 6} ry="7" fill="rgba(0,0,0,0.28)" />
      {drawn.map(({ s, x: sx, w }, i) => {
        const hPx = Math.min(158, Math.max(48, (s.heightCm ?? fallbackHeightCm) * 0.72))
        const jeVrata = s.toKind === 'VRATA'
        const posts = Math.max(2, Math.max(0, s.posts) + 2) // robna stebra + vmesni
        const postXs = Array.from({ length: posts }, (_, j) => sx + (j * (w - postW)) / (posts - 1))
        return (
          <g key={`seg-${i}`}>
            {/* polnilo — navpične palice (ob vratah pusti odprtino na koncu) */}
            {postXs.slice(0, -1).map((px, j) => {
              const nx = postXs[j + 1]
              const gateGap = jeVrata && j >= postXs.length - 3
              const barW = nx - px - postW - 2
              if (gateGap || barW <= 3) return null
              const count = Math.max(2, Math.round(barW / 11))
              return (
                <g key={`b-${i}-${j}`}>
                  {Array.from({ length: count }).map((_, k) => (
                    <rect
                      key={k}
                      x={px + postW + 1 + (k * (barW - 3)) / Math.max(1, count - 1)}
                      y={baseY - hPx + 13}
                      width="3.5"
                      height={hPx - 21}
                      fill={ANTHRACITE}
                      opacity="0.92"
                      rx="1"
                    />
                  ))}
                </g>
              )
            })}
            {/* srednja palica + ročnik po višini segmenta */}
            <rect x={sx} y={baseY - hPx * 0.55} width={w} height="5" fill={ANTHRACITE} rx="2" />
            <rect x={sx - 1} y={baseY - hPx - 8} width={w + 2} height="8" fill={ANTHRACITE} rx="3" />
            {/* stebri */}
            {postXs.map((px, j) => (
              <rect key={`p-${i}-${j}`} x={px} y={baseY - hPx} width={postW} height={hPx} fill={ANTHRACITE} rx="2" />
            ))}
            {/* vrata: odprtina z lokom */}
            {jeVrata ? (
              <g>
                <path
                  d={`M ${sx + w - 26} ${baseY - hPx - 4} A 22 22 0 0 1 ${sx + w - 2} ${baseY - hPx - 4}`}
                  fill="none"
                  stroke="#f5f5f4"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <text x={sx + w - 14} y={baseY - hPx - 10} textAnchor="middle" fontSize="8" fontWeight="700" fill="#f5f5f4">VRATA</text>
              </g>
            ) : null}
            {/* vogal: oznaka kota */}
            {s.toKind === 'VOGAL' ? (
              <text x={sx + w - 3} y={baseY + 14} textAnchor="end" fontSize="7.5" fontWeight="700" fill="#f5f5f4">
                {s.angleDeg != null ? `${Math.round(s.angleDeg)}°` : 'vogal'}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

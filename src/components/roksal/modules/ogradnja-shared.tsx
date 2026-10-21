'use client'

// OGRADNJA — skupni tipi, konstante, pomočniki in drobni gradniki (R547: en vir
// resnice). Uporabljajo ga ogradnja.tsx (seznam), ogradnja-carovnik.tsx (čarovnik),
// ogradnja-verify.tsx (faza PREVERI) in ogradnja-detail.tsx (podrobnost).
// Izvlečeno iz ogradnja.tsx BREZ spremembe obnašanja (razbitje po vzorcu R546).
// (Edini shared z JSX med tremi razbitji R547: QualityDot/ReviewRow/ValidationList
// so drobni gradniki z več potrošniki — pripadajo skupnemu viru.)

import { BadgeCheck, Radar, TriangleAlert } from '@/components/roksal/custom-icons'
import { cn } from '@/lib/utils'
import type { ProductRules, RunCalibration, RunNode, SegmentStatus, TerrainPoint } from '@/lib/fence-run-engine'

// ─── Tipi ───────────────────────────────────────────────────────────────────

export interface RunRow {
  id: string; name: string; status: string; updatedAt: string
  project: { code: string; title: string } | null
  product: { sku: string; name: string } | null
  variant: { sku: string; name: string } | null
  author: { name: string } | null
  measurementId: string | null
  totalLengthCm: number; segmentCount: number; verifiedCount: number
  qualityState: string | null; qualityScore: number | null
}

export interface SegmentRow {
  id: string; order: number; fromKind: string; toKind: string
  fromAtCm: number; toAtCm: number; lengthCm: number; heightCm: number | null
  angleDeg: number | null; slopeDeg: number; heightDiffCm: number; posts: number
  status: SegmentStatus; verifiedCm: number | null; verifyMethod: string | null
  verifyNote: string | null; version: number
}

export interface AnalysisPayload {
  validation: { code: string; severity: string; message: string }[]
  quality: { state: string; score: number; reasons: string[] }
  summary: { totalLengthCm: number; postCount: number; segmentCount: number; maxSlopeDeg: number; heightDiffCm: number; verifiedCount: number }
  pendingPosts: { afterAtCm: number; segmentOrder: number; reason: string }[]
  terrainProfile: { atCm: number; elevCm: number }[]
}

export interface RunDetail {
  run: {
    id: string; name: string; status: string; note: string | null
    projectId: string; project: { code: string; title: string } | null
    product: { id: string; sku: string; name: string; unit: string; tech: string | null } | null
    variant: { id: string; sku: string; name: string; ral: string | null } | null
    measurementId: string | null
    nodes: RunNode[]; terrain: TerrainPoint[] | null
    calibration: RunCalibration | null; rules: ProductRules
  }
  segments: SegmentRow[]
  analysis: AnalysisPayload
  versions: { version: number; note: string | null; createdAt: string; user: { name: string } | null }[]
}

export interface ProjectOption { id: string; code: string; title: string }
export interface ProductOption {
  id: string; sku: string; name: string; unit: string; tech: string | null
  family: { code: string } | null
  variants: { id: string; sku: string; name: string; ral: string | null }[]
}

export const PHASES = ['Osnova', 'Tekač', 'Stebri', 'Preveri', 'Potrdi'] as const

export const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  OSNUTEK: { label: 'Osnutek', cls: 'bg-muted text-muted-foreground' },
  PREGLED: { label: 'Pregled', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  POTRJEN: { label: 'Potrjen', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  ARHIV: { label: 'Arhiv', cls: 'bg-secondary text-secondary-foreground' },
}

export const fmtM = (cm: number) => `${(cm / 100).toFixed(2)} m`
export const num = (v: string): number | null => {
  if (!v.trim()) return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// ─── Quality dot (🟢🟡🔴 §3) ────────────────────────────────────────────────

export function QualityDot ({ state, className }: { state: string | null; className?: string }) {
  const cls = state === 'DOBER' ? 'bg-emerald-500' : state === 'DODAJ' ? 'bg-amber-500' : state === 'NEZADOSTNO' ? 'bg-destructive' : 'bg-muted-foreground/40'
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', cls, className)} />
}

export function gateLabel (state: string): string {
  return state === 'DOBER' ? 'Dober zajem' : state === 'DODAJ' ? 'Dopolnite zajem' : 'Zajem ni zanesljiv'
}

export function ReviewRow ({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  )
}

export function ValidationList ({ validation }: { validation: { code: string; severity: string; message: string }[] }) {
  if (validation.length === 0) {
    return <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"><BadgeCheck className="size-4" aria-hidden /> Brez opozoril — geometrija je konsistentna.</p>
  }
  return (
    <ul className="space-y-1">
      {validation.map((v, i) => (
        <li
          key={i}
          className={cn(
            'flex items-start gap-2 rounded-lg px-3 py-2 text-xs',
            v.severity === 'NAPAKA' ? 'bg-destructive/10 text-destructive'
              : v.severity === 'OPOZORILO' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'bg-muted text-muted-foreground'
          )}
        >
          {v.severity === 'NAPAKA' ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <Radar className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          <span>{v.message}</span>
        </li>
      ))}
    </ul>
  )
}

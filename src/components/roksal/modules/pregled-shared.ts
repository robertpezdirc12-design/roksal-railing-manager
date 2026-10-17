// PREGLED — skupni tipi, konstante in pomočniki (R546: en vir resnice).
// Čist TS modul — uporabljajo ga pregled.tsx (lupina), pregled-views.tsx (risbe),
// pregled-cards.tsx (kartice/dialogi) in pregled-share.tsx (javna delitev).
// Izvlečeno iz pregled.tsx BREZ spremembe obnašanja.

import type { PlanModel } from '@/lib/model-core'

// ─── Tipi (API) ──────────────────────────────────────────────────────────────

export interface ProjectOption { id: string; code: string; title: string }

export interface RunOption {
  id: string; name: string; status: string; updatedAt: string
  totalLengthCm: number
  product: { sku: string; name: string } | null
}

export interface ReviewPhoto {
  id: string
  sessionId: string
  sessionName: string
  zone: string
  zoneLabel: string
  atCm: number | null
  spatiallyRegistered: false
  thumb: string | null
  offsetCm: number | null
  capturedAt: string
}

export interface ReviewPin {
  id: string
  fenceRunId: string
  targetType: string
  targetKey: string
  x: number | null
  y: number | null
  note: string
  internalNote: string | null
  status: string
  resolvedAt: string | null
  author: { id: string; name: string | null } | null
  resolvedBy: { id: string; name: string | null } | null
  snapshot: Record<string, unknown> | null // R542: jsonb objekt
  createdAt: string
  updatedAt: string
}

export interface ReviewCheck { code: string; severity: string; message: string }

export interface ReviewLinkRow {
  id: string; token: string; url: string
  note: string | null; viewCount: number
  lastViewAt: string | null; revokedAt: string | null
  createdAt: string; expiresAt: string; active: boolean
}

export interface ReviewPayload {
  run: { id: string; name: string; status: string; projectId: string; createdAt: string; updatedAt: string }
  project: { code: string; title: string; status: string; customerName: string | null } | null
  productId: string | null
  product: { id: string; sku: string; name: string; unit: string } | null
  variantId: string | null
  variant: { id: string; sku: string; name: string; ral: string | null } | null
  model: PlanModel
  photos: ReviewPhoto[]
  photosSpatiallyRegistered: false
  pins: ReviewPin[]
  replay: { id: string; name: string; status: string; photoCount: number; replayUrl: string }[]
  consent: { status: 'MANJKA' | 'VELJAVNO' | 'POTEKLO'; photosBlocked: string | null }
  checks: ReviewCheck[]
}

/** Pin v risbi (zadostuje za marker: interni in javni pin imata ta polja) */
export interface PinMarker { id: string; targetType: string; targetKey: string; x: number | null; y: number | null; status: string; note: string }

// ─── Konstante ───────────────────────────────────────────────────────────────

// barve segmentov po statusu — USKLAJENO z modulom Model (R473)
export const STROKE: Record<string, string> = {
  ESTIMATED: '#9ca3af',
  AUTO_SUGGESTED: '#8b5cf6',
  MANUAL: '#d97706',
  CALIBRATED: '#0d9488',
  VERIFIED: '#059669',
  CONFIRMED: '#475569',
}
export const STROKE_SELECTED = '#dc2626'

export const PIN_TONE: Record<string, { fill: string; label: string; cls: string }> = {
  ODPRTO: { fill: '#dc2626', label: 'Odprto', cls: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  RESENO: { fill: '#d97706', label: 'Rešeno', cls: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  ZAPRT: { fill: '#64748b', label: 'Zaprto', cls: 'border-transparent bg-muted text-muted-foreground' },
}

export const TARGET_LABEL: Record<string, string> = { SEGMENT: 'segment', VOZLISCE: 'vozlišče', FOTOGRAFIJA: 'fotografija' }

export const NODE_GLYPH: Record<string, { shape: 'circle' | 'rect' | 'diamond'; label: string }> = {
  ZACETEK: { shape: 'circle', label: 'Z' },
  STEBER: { shape: 'circle', label: 'S' },
  VOGAL: { shape: 'diamond', label: 'V' },
  VRATA: { shape: 'rect', label: 'Vr' },
  STOPNISCE: { shape: 'rect', label: 'St' },
  KONEC: { shape: 'circle', label: 'K' },
}

// kategorije izolacije (§7: odseki, vrata, stebri, mere, opozorila …)
export const ISOLATION_CATS: { key: string; label: string }[] = [
  { key: 'odseki', label: 'Odseki' },
  { key: 'vrata', label: 'Vrata' },
  { key: 'stebri', label: 'Stebri' },
  { key: 'vogali', label: 'Vogali' },
  { key: 'nepreverjene', label: 'Nepreverjene mere' },
  { key: 'opozorila', label: 'Odpri pini' },
]

export const fmtCm = (n: number | null | undefined, unit = 'cm'): string =>
  n == null ? '—' : `${(Math.round(n * 10) / 10).toLocaleString('sl-SI')} ${unit}`

export const fmtM = (cm: number | null | undefined): string =>
  cm == null ? '—' : `${(cm / 100).toLocaleString('sl-SI', { maximumFractionDigits: 2 })} m`

/** Kratek povzetek snapshot-a cilja (dokaz o geometriji ob nastanku pina). R542: jsonb objekt — brez JSON.parse. */
export function pinSnapshotSummary (p: ReviewPin): string | null {
  const s = p.snapshot
  if (!s || typeof s !== 'object') return null
  if (p.targetType === 'SEGMENT') {
    const parts: string[] = []
    if (typeof s.lengthCm === 'number') parts.push(`dolžina ${fmtCm(s.lengthCm)}`)
    if (typeof s.status === 'string') parts.push(`status ${s.status}`)
    return parts.length ? `ob nastanku: ${parts.join(' · ')}` : null
  }
  if (p.targetType === 'VOZLISCE') {
    const parts: string[] = []
    if (typeof s.kind === 'string') parts.push(String(s.kind))
    if (typeof s.atCm === 'number') parts.push(fmtM(s.atCm))
    return parts.length ? `ob nastanku: ${parts.join(' · ')}` : null
  }
  if (typeof s.zone === 'string') return `ob nastanku: cona ${s.zone}`
  return null
}

// ─── Risbalne pomožne (mreža / merilo) ───────────────────────────────────────

export function niceStep (min: number): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
  return steps.find((s) => s >= min) ?? 10000
}

export function range (a: number, b: number, step: number): number[] {
  const out: number[] = []
  for (let v = a; v <= b + 0.001; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

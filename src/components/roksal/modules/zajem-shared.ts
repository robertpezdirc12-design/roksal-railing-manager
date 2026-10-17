// ZAJEM — skupni tipi in konstante (R547: en vir resnice).
// Čist TS modul brez JSX — uporabljata ga zajem.tsx (seznam/podrobnost) in
// zajem-detail.tsx (SessionDetailBody). Izvlečeno iz zajem.tsx BREZ spremembe
// obnašanja (razbitje srednjih modulov po vzorcu R546).

import { STOP_KINDS, type DriftState, type ZoneState } from '@/lib/capture-qa-engine'

// ─── Tipi ───────────────────────────────────────────────────────────────────
export interface SessionRow {
  id: string; name: string; status: string; mode: string; updatedAt: string
  project: { code: string; title: string } | null
  author: { name: string } | null
  fenceRunId: string | null; snapshotId: string | null
  photoCount: number; refCount: number; refConflicts: number
  coverageOk: boolean; coverageZones: number; driftStatus: string | null
}

export interface AnalysisPayload {
  plan: { id: string; kind: keyof typeof STOP_KINDS; label: string; atCm?: number; critical: boolean }[]
  coverage: {
    zones: { stopId: string; label: string; critical: boolean; state: ZoneState; photoCount: number; goodCount: number }[]
    criticalMissing: string[]
    gateOk: boolean
  }
  drift: { state: DriftState; maxAbsCm: number; lastRefCode: string | null }
  refs: {
    pairs: { fromCode: string; toCode: string; declaredCm: number; measuredCm: number; diffCm: number; toleranceCm: number; conflict: boolean }[]
    conflicts: string[]
    activeCount: number
  }
  outdoorFactor: number
  requireExtraReference: boolean
  criticalGate: { ponudba: boolean; konfiguracija: boolean; proizvodnja: boolean; manjka: { code: string; message: string }[] } | null
  gates: { coverageOk: boolean; stopsDone: boolean; referencesOk: boolean; driftOk: boolean; allOk: boolean; reasons: string[] }
}

export interface SessionDetail {
  id: string; name: string; status: string; mode: string; projectId: string
  fenceRunId: string | null; snapshotId: string | null; note: string | null
  device: { tier: string; caps: Record<string, boolean> } | null
  outdoor: { conditions: string[]; note?: string } | null
  state: { currentStopId: string | null; doneStops: string[] }
  run: {
    id: string; name: string; status: string; measurementId: string | null
    segments: { order: number; lengthCm: number; heightCm: number | null; slopeDeg: number; status: string; hasGate: boolean }[]
  } | null
  references: {
    id: string; code: string; label: string | null; atCm: number; measureCm: number
    method: string; device: string | null; status: string; confidence: number | null
    note: string | null; createdAt: string
  }[]
  photos: { id: string; clientKey: string; zone: string; quality: { dark?: boolean; bright?: boolean; blurry?: boolean } | null; offsetCm: number | null; capturedAt: string }[]
  analysis: AnalysisPayload
}

export const STATUS_BADGE: Record<string, string> = {
  V_TEKU: 'bg-sky-100 text-sky-800 border-sky-300',
  PREKINJEN: 'bg-amber-100 text-amber-900 border-amber-300',
  ZAKLJUCEN: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}

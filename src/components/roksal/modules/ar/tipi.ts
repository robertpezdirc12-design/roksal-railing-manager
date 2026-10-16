// tipi.ts — skupni tipi in konstante modula AR (R537-b: čista razbitja ar.tsx,
// brez sprememb obnašanja). Čisti TS brez komponent/hookov — BREZ 'use client'.
// Uporabniki: ar.tsx (vstop) + vsi deli v tej podmapi.

import { SCENE_CLASSES, SCENE_LIMITS } from '@/lib/scene-understanding-core'
import type { SceneClass } from '@/lib/scene-understanding-core'

export type Mode = 'off' | 'on' | 'demo'

/** R485 (issue #8 §9): pogled AR predogleda — SAMO pogled na obstoječe
 * elemente (filter/prikaz, NE nov podatkovni model). ŽIVO je privzet in
 * enak sedanjemu obnašanju; PREGLED doda tapljivi seznam vseh elementov. */
export type SceneView = 'ZIVO' | 'PREPOZNANO' | 'MERE' | 'PREGLED'

export const SCENE_VIEWS: { id: SceneView; text: string; hint: string }[] = [
  { id: 'ZIVO', text: 'Živo', hint: 'Oznake, mere in osi čez sliko (sedanji prikaz).' },
  { id: 'PREPOZNANO', text: 'Prepoznano', hint: 'Samo razredi, statusi in zaupanje — mere skrite.' },
  { id: 'MERE', text: 'Mere', hint: 'Samo osi in zabeležene mere z metodo — razredi manj vidni.' },
  { id: 'PREGLED', text: 'Pregled', hint: 'Tapljivi seznam vseh zaznanih elementov (issue §9:137).' },
]

/** R485 (issue #8 §1, zasebnost §5): razredi za ROČNO dodajanje oznake —
 * beli seznam BREZ OSEBA (enak seznam kot na strežniku: POST scene-element). */
export const MANUAL_CLASSES: SceneClass[] = SCENE_CLASSES.filter((c) => c !== 'OSEBA')

/** Privzeti bbox ročne oznake (sredina kadra) — števci so 0..1. */
export const MANUAL_BBOX_DEFAULT: [number, number, number, number] = [0.35, 0.35, 0.3, 0.3]

/** R485: dolžina opombe ročne oznake (ista meja kot strežnik — SCENE_LIMITS). */
export const SCENE_LABEL_MAX = SCENE_LIMITS.elementLabelMaxLen

/** Demo ozadje predogleda, če kamere ni (POŠTEN nadomestek — gradient). */
export const DEMO_GRAD = 'linear-gradient(160deg, #e7e5e4 0%, #a8a29e 55%, #78716c 100%)'

export interface ProjectRow { id: string; code: string; title: string }

/** R465: tekač projekta za vir geometrije overlayja (GET /api/fence-run). */
export interface RunOption { id: string; name: string; status: string; totalLengthCm: number; segmentCount: number }

/** R465: segment tekača (GET /api/fence-run/[id] → data.segments). */
export interface RunSegmentRow {
  order: number
  fromKind: string
  toKind: string
  fromAtCm: number
  toAtCm: number
  lengthCm: number
  heightCm: number | null
  angleDeg: number | null
  posts: number
  status: string
}

/** R454: rezultat VLM analize prizora (POST /api/ar/analyze). */
export interface ArAnalysis {
  scene: string
  placement: { label: string; where: string; estLenCm: number | null; note: string | null }[]
  obstacles: string[]
  references: string[]
}

/** R454: vrstica zgodovine AR posnetkov (GET /api/ar-snapshots — brez params). */
export interface SnapshotRow {
  id: string
  projectId: string | null
  scene: string | null
  note: string | null
  createdAt: string
  author?: { name: string; role: string } | null
  project?: { code: string; title: string } | null
}

/** R485 (issue #8 §1): vrednosti, ki jih izda obrazec ročne oznake
 *  (razred iz belega seznama + bbox 0..1 + opomba). */
export interface ManualTagValues {
  cls: SceneClass
  bbox: [number, number, number, number]
  label: string
}

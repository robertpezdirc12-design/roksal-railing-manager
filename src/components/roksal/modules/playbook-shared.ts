// PLAYBOOK SHARED (R549): tipi API odgovorov, ikone/barve kategorij korakov
// in detekcija zmogljivosti naprave (§9 — BREZ runtime AI) — en vir za vse
// gradnike vodenega postopka (izvlečeno bajtno-identično iz playbook.tsx,
// recept R546–R548).

import { Camera, CheckCircle2, ClipboardCheck, GitBranch, MapPin, NotebookPen, Ruler } from 'lucide-react'
import type { NapravaTier } from '@/lib/playbook-core'

// ─── tipi (odgovori API) ─────────────────────────────────────────────────────

export interface NalogRow {
  id: string; code: string; title: string; status: string
  assignee?: { id: string } | null
}

export interface DefRow {
  id: string; key: string; name: string; version: number; status: string
  effectiveFrom: string; updatedAt: string; author: string | null
  zagonov: number; korakov: number
}

export interface RunPovzetek {
  id: string; key: string; version: number; naziv: string; status: string
  startedAt: string; completedAt: string | null
  workOrderId?: string | null
  napredek: { trenutni: number; skupaj: number; koncanih: number; izjem: number; odstotek: number } | null
}

export const KATEGORIJA_IKONA: Record<string, typeof Camera> = {
  PRIHOD: MapPin, FOTO: Camera, MERITEV: Ruler, ODLOCITEV: GitBranch,
  KONTROLA: ClipboardCheck, AKCIJA: NotebookPen, PREDAJA: CheckCircle2,
}

export const KATEGORIJA_BARVA: Record<string, string> = {
  PRIHOD: 'text-sky-600 dark:text-sky-400',
  FOTO: 'text-roksal-amber',
  MERITEV: 'text-emerald-600 dark:text-emerald-400',
  ODLOCITEV: 'text-violet-600 dark:text-violet-400',
  KONTROLA: 'text-orange-600 dark:text-orange-400',
  AKCIJA: 'text-foreground',
  PREDAJA: 'text-teal-600 dark:text-teal-400',
}

export const STATUS_OZNaka: Record<string, string> = {
  PENDING: 'čaka', IN_PROGRESS: 'v teku', COMPLETED: 'zaključen',
  NI_PRIMERNO: 'ni primerno', BLOKIRANO: 'blokirano', NEUSPESNO: 'neuspešno',
}

// ─── detekcija zmogljivosti naprave (§9 — BREZ runtime AI) ─────────────────

export async function preveriNapravo (): Promise<{ tier: NapravaTier; opis: string }> {
  const nav = navigator as Navigator & {
    xr?: { isSessionSupported?: (m: string) => Promise<boolean> }
    mediaDevices?: MediaDevices
    maxTouchPoints?: number
  }
  const imaKamero = !!nav.mediaDevices?.getUserMedia
  let imaAr = false
  try { imaAr = !!(await nav.xr?.isSessionSupported?.('immersive-ar')) } catch { imaAr = false }
  // depth/LiDAR v brskalniku ni izpostavljen — pošteno poročamo AR/kamero
  if (imaAr) return { tier: 'AR', opis: 'WebXR AR — ravnine in raycast' }
  if (imaKamero) return { tier: 'KAMERA', opis: 'kamera + žiroskop + referenca' }
  return { tier: 'OGRANICENO', opis: 'omejena naprava — ročni vnos' }
}

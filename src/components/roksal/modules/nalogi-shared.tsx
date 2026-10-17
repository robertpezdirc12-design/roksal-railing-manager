'use client'

// NALOGI — skupni tipi, filtri, prehodi in vrstici meritev (R548: en vir resnice).
// Shared z JSX (MeasurementTypeBadge ima več potrošnikov — vzorec ogradnja-shared
// iz R547). Uporabljajo ga nalogi.tsx, nalogi-detail.tsx, nalogi-offline.tsx in
// nalogi-create.tsx. Izvlečeno iz nalogi.tsx BREZ spremembe obnašanja.

import { Camera, CheckCheck, CheckCircle2, MessageSquare, Play, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface WorkOrderRow {
  id: string; code: string; title: string; status: string
  scheduledFor: string | null; startedAt: string | null; completedAt: string | null; summary: string | null
  project: { code: string; title: string; address: string | null; customer: { name: string } | null } | null
  assignee: { name: string } | null
  crew: { name: string; type: string } | null // R445: ekipa/podizvajalec na nalogu
  _count: { measurements: number; events: number }
}

export interface WorkOrderDetail extends Omit<WorkOrderRow, 'assignee' | '_count'> {
  assignee: { id: string; name: string } | null
  crew: { id: string; name: string; type: string } | null // R445: ekipa na nalogu (id za predizbiro)
  instructions: string | null
  projectId: string | null
  events: { id: string; type: string; note: string | null; createdAt: string; user: { name: string } | null }[]
  measurements: {
    id: string; type: string; location: string | null; lengthCm: number | null
    heightCm: number | null; posts: number | null; slopeDeg: number | null; note: string | null; createdAt: string
  }[]
}

export interface HistoryRow {
  id: string; type: string; note: string | null; createdAt: string
  user: { name: string } | null
  workOrder: { code: string; status: string; project: { code: string; customer: { name: string } | null } | null }
}

export const SCOPES = [
  { value: 'all', label: 'Vsi' },
  { value: 'open', label: 'Odprti' },
  { value: 'mine', label: 'Moji' },
  { value: 'today', label: 'Danes' },
]

export const STATUSES = [
  { value: 'NAPROGRAMIRAN', label: 'Naprogramiran' },
  { value: 'V_TEKU', label: 'V teku' },
  { value: 'V_ZAJEMU', label: 'V zajemu' },
  { value: 'V_PREVERI', label: 'V preveri' },
  { value: 'ZAKLJUCEN', label: 'Zaključen' },
]

// terenski tok — VERBATIM R429 §7 (enako kot backend FLOW na /api/nalog/[id]/transition)
export const TRANSITIONS: { from: string[]; to: string; label: string }[] = [
  { from: ['NAPROGRAMIRAN'], to: 'V_TEKU', label: 'ZAČNI DELO' },
  { from: ['V_TEKU'], to: 'V_ZAJEMU', label: 'ZAJEM' },
  { from: ['V_TEKU', 'V_ZAJEMU'], to: 'V_PREVERI', label: 'PREVERI' },
  { from: ['V_PREVERI'], to: 'ZAKLJUCEN', label: 'ZAKLJUČI TEREN' },
]

export const EVENT_META: Record<string, { label: string; icon: typeof Play; cls: string }> = {
  DODELJEN: { label: 'Dodeljen', icon: UserPlus, cls: 'bg-secondary text-secondary-foreground' },
  ZACETEK: { label: 'Začetek dela', icon: Play, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  ZAJEM: { label: 'Zajem', icon: Camera, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  PREVERITEV: { label: 'Preveritev', icon: CheckCircle2, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  ZAKLJUCEK: { label: 'Zaključek terena', icon: CheckCheck, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  KOMENTAR: { label: 'Komentar', icon: MessageSquare, cls: 'bg-secondary text-secondary-foreground' },
  OPOMBA: { label: 'Opomba', icon: MessageSquare, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' }, // R439: sync op nalog-opomba
}

export const fmtM = (cm: number | null | undefined) => (typeof cm === 'number' && cm > 0 ? `${(cm / 100).toFixed(2)} m` : '—')

export const MEASUREMENT_TYPES: Record<string, { label: string; cls: string }> = {
  OGRAJA: { label: 'Ograja', cls: 'bg-secondary text-secondary-foreground' },
  BALUSTRADA: { label: 'Balustrada', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  NAGIB: { label: 'Nagib', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  FOTO: { label: 'Foto', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  OSTANEO: { label: 'Ostaneo', cls: 'bg-muted text-muted-foreground' },
}

export function MeasurementTypeBadge ({ type }: { type: string }) {
  const t = MEASUREMENT_TYPES[type] ?? { label: type, cls: 'bg-muted text-muted-foreground' }
  return <Badge variant="secondary" className={cn('border-transparent font-medium', t.cls)}>{t.label}</Badge>
}

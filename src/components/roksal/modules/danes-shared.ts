// DANES — skupni tipi, faze in prehodi (R548: en vir resnice).
// Čist TS modul — uporabljajo ga danes.tsx (lupina + kartice), danes-detail.tsx,
// danes-sekcije.tsx in danes-vreme.tsx. Izvlečeno iz danes.tsx BREZ spremembe
// obnašanja (razbitje po vzorcu R546/R547).
// 7-fazni delovni tok (UI plast nad statusi — preslikava v glavi danes.tsx):
//   PRIHOD = NAPROGRAMIRAN · PRED ZAČETKOM = V_TEKU · ZAJEM = V_ZAJEMU ·
//   KONTROLA = V_PREVERI (montaža implicitno za nami) · PREDAJA = ZAKLJUCEN.

import { Camera, CheckCheck, CheckCircle2, Play } from '@/components/roksal/custom-icons'

export interface WorkOrderRow {
  id: string; code: string; title: string; status: string
  scheduledFor: string | null; startedAt: string | null; completedAt: string | null; summary: string | null
  instructions: string | null
  project: { id?: string; code: string; title: string; address: string | null; customer: { name: string } | null } | null
  assignee: { name: string } | null
  _count: { measurements: number; events: number }
}

export interface WorkOrderDetailRow extends WorkOrderRow {
  instructions: string | null
  assignee: { id: string; name: string } | null
  events: { id: string; type: string; note: string | null; createdAt: string; user: { name: string } | null }[]
  measurements: { id: string; type: string; familyCode: string | null; lengthCm: number | null; createdAt: string }[]
}

export interface ChecklistRow {
  id: string; label: string; done: boolean; doneAt: string | null
  doneBy: { name: string } | null; sortOrder: number
}

export interface UsageRow {
  id: string; qty: number; note: string | null; createdAt: string
  item: { sku: string; name: string; unit: string; qty: number }
  user: { name: string } | null
}

export interface StockRow {
  id: string; sku: string; name: string; unit: string
  physical: number; reserved: number; available: number
}

export interface WeatherDay {
  date: string; tmin: number; tmax: number; precip: number; precipHours: number
  windMax: number; code: number; label: string; icon: string; score: number
}

// ─── 7-fazni delovni tok (UI plast nad statusi — glej preslikavo v glavi) ────

export const FAZE = [
  { key: 'PRIHOD', label: 'Prihod' },
  { key: 'PRED_ZACETKOM', label: 'Pred začetkom' },
  { key: 'ZAJEM', label: 'Zajem' },
  { key: 'MONTAZA', label: 'Montaža' },
  { key: 'KONTROLA', label: 'Kontrola' },
  { key: 'ZAKLJUCEK', label: 'Zaključek' },
  { key: 'PREDAJA', label: 'Predaja' },
] as const

/** Indeks trenutne faze iz statusa naloga (MONTAŽA[3] je implicitno opravljena ob prehodu v V_PREVERI). */
export function phaseIndex (status: string): number {
  switch (status) {
    case 'NAPROGRAMIRAN': return 0 // PRIHOD
    case 'V_TEKU': return 1 // PRED ZAČETKOM
    case 'V_ZAJEMU': return 2 // ZAJEM
    case 'V_PREVERI': return 4 // KONTROLA (montaža za nami)
    case 'ZAKLJUCEN': return 6 // PREDAJA (zaključek za nami)
    default: return 0
  }
}

// prehodi terenskega toka (nespremenjen backend model)
export const NEXT_ACTION: Record<string, { to: string; label: string; icon: typeof Play }> = {
  NAPROGRAMIRAN: { to: 'V_TEKU', label: 'ZAČNI DELO', icon: Play },
  V_TEKU: { to: 'V_ZAJEMU', label: 'ZAJEM', icon: Camera },
  V_ZAJEMU: { to: 'V_PREVERI', label: 'PREVERI', icon: CheckCircle2 },
  V_PREVERI: { to: 'ZAKLJUCEN', label: 'ZAKLJUČI TEREN', icon: CheckCheck },
}

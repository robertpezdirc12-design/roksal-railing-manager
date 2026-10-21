// SERVIS — skupni tipi, oznake in pomočniki (R547: en vir resnice).
// Čist TS modul brez JSX — uporabljajo ga servis.tsx (lupina z zavihki),
// servis-garancije.tsx, servis-reklamacije.tsx in servis-primeri.tsx.
// Izvlečeno iz servis.tsx BREZ spremembe obnašanja (razbitje po vzorcu R546).

import { Mail, MessageSquareWarning, Phone, User } from '@/components/roksal/custom-icons'
import { hasPerm } from '@/lib/permissions-core'

// ─── tipi (odgovori API-jev) ──────────────────────────────────────────────────

export interface WarrantyRow {
  id: string; projectId: string; startsAt: string; months: number; status: string; note: string | null
  endsAt: string; valid: boolean
  visits: { id: string; date: string; note: string | null; userId: string | null }[]
  nextVisit: { id: string; date: string; note: string | null } | null
  project: { code: string; title: string; status: string; customer: { name: string } | null } | null
}

export interface ClaimRow {
  id: string; code: string; customerId: string; projectId: string
  packageId: string | null; warrantyId: string | null
  title: string; desc: string; channel: string; status: string
  reportedBy: string | null; resolutionNote: string | null
  createdAt: string; updatedAt: string
  customer: { id: string; name: string; phone: string | null; email: string | null }
  project: { id: string; code: string; title: string; address: string | null; status: string }
  package: { id: string; code: string; name: string } | null
  warranty: { id: string; startsAt: string; months: number; status: string } | null
  serviceCase: { id: string; code: string; status: string } | null
}

export interface VisitRow {
  id: string; caseId: string; date: string; userId: string; note: string; hours: number | null
  user: { id: string; name: string; role: string }
}

export interface ServiceCaseRow {
  id: string; code: string; claimId: string | null; projectId: string; warrantyId: string | null
  title: string; desc: string; status: string
  decision: string | null; decisionNote: string | null; decidedById: string | null
  decidedAt: string | null; resolutionNote: string | null; billable: boolean
  createdAt: string; updatedAt: string
  claim: { id: string; code: string; title: string; status: string; channel: string; reportedBy: string | null; customer: { id: string; name: string; phone: string | null } } | null
  project: { id: string; code: string; title: string; address: string | null; status: string }
  warranty: { id: string; startsAt: string; months: number; status: string } | null
  decidedBy: { id: string; name: string } | null
  visits: VisitRow[]
}

export interface ProjectOption { id: string; code: string; title: string; status: string; customerId: string | null; customer: { name: string } | null }
export interface CustomerOption { id: string; name: string }
export interface PackageOption { id: string; code: string; name: string }
export interface UserOption { id: string; name: string; role: string; active: boolean }

// ─── oznake ───────────────────────────────────────────────────────────────────

export const CLAIM_STATUSI: { v: string; l: string }[] = [
  { v: 'NOVA', l: 'Nova' },
  { v: 'V_OBRAVNAVI', l: 'V obravnavi' },
  { v: 'ZAKLJUCENA', l: 'Zaključena' },
  { v: 'ZAVRNJENA', l: 'Zavrnjena' },
]

export const CASE_STATUSI: { v: string; l: string }[] = [
  { v: 'PREVERITEV', l: 'Preveritev' },
  { v: 'ODOBRENA', l: 'Odobrena' },
  { v: 'V_SERVISU', l: 'V servisu' },
  { v: 'ZAKLJUCEN', l: 'Zaključen' },
  { v: 'ZAVRNJENA', l: 'Zavrnjena' },
]

export const KANALI: { v: string; l: string; icon: typeof Phone }[] = [
  { v: 'TELEFON', l: 'Telefon', icon: Phone },
  { v: 'EMAIL', l: 'E-pošta', icon: Mail },
  { v: 'PORTAL', l: 'Portal', icon: MessageSquareWarning },
  { v: 'OSEBNO', l: 'Osebno', icon: User },
]

export const ODLOCITVE: { v: string; l: string }[] = [
  { v: 'UTEMELJENA', l: 'Utemeljena' },
  { v: 'DELNO_UTEMELJENA', l: 'Delno utemeljena' },
  { v: 'NEUTEMELJENA', l: 'Neutemeljena' },
]

export const kanalLabel = (v: string) => KANALI.find((k) => k.v === v)?.l ?? v
export const odlocitevLabel = (v: string) => ODLOCITVE.find((k) => k.v === v)?.l ?? v

export const ODLOCITEV_CLS: Record<string, string> = {
  UTEMELJENA: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  DELNO_UTEMELJENA: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  NEUTEMELJENA: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
}

/** Pisarna v UI: projects.write + vloga z obsegom vodenja (strežnik RES preverja). */
export function isOffice (user: { role: string; perms: string[] } | null): boolean {
  if (!user) return false
  return user.role !== 'MONTER' && hasPerm(user.perms, 'projects.write')
}

/** Ali garancija (iz API odgovora) trenutno velja. */
export function garancijaVelja (w: { status: string; startsAt: string; months: number } | null): boolean {
  if (!w || w.status !== 'AKTIVNA') return false
  const ends = new Date(w.startsAt)
  ends.setMonth(ends.getMonth() + w.months)
  return ends >= new Date()
}

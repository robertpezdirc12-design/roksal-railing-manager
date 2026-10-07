// service-core — R446 (issue #7 §10, P2 SERVIS: garancije, reklamacije, servis).
// Tok: STRANKA → REKLAMACIJA (Claim) → PREVERITEV → ODLOČITEV → SERVIS → ZAKLJUČEK.
// Statusi toka, skupni include za odgovore API-jev in veljavnost garancije.
// UVOZ LE S STREŽNIKA (vsebuje Prisma tipe za include) — UI ima svoje oznake.

import type { Prisma } from '@prisma/client'

/** Veljavni statusi reklamacije (issue #7 §10). */
export const CLAIM_STATUSES = ['NOVA', 'V_OBRAVNAVI', 'ZAKLJUCENA', 'ZAVRNJENA'] as const

/** Kanali prijave reklamacije. */
export const CLAIM_CHANNELS = ['TELEFON', 'EMAIL', 'PORTAL', 'OSEBNO'] as const

/** Veljavni statusi servisnega primera: PREVERITEV → ODOBRENA → V_SERVISU → ZAKLJUCEN (+ ZAVRNJENA). */
export const SERVICE_CASE_STATUSES = ['PREVERITEV', 'ODOBRENA', 'V_SERVISU', 'ZAKLJUCEN', 'ZAVRNJENA'] as const

/** Odločitve po preveritvi: UTEMELJENA | DELNO_UTEMELJENA | NEUTEMELJENA. */
export const SERVICE_DECISIONS = ['UTEMELJENA', 'DELNO_UTEMELJENA', 'NEUTEMELJENA'] as const

/** Opis toka za sporočila o napakah (409). */
export const SERVICE_FLOW_DESC = 'PREVERITEV → ODOBRENA → V_SERVISU → ZAKLJUCEN'

/** Dovoljeni prehodi statusov servisnega primera (vse ostalo → 409). */
export const SERVICE_CASE_TRANSITIONS: Record<string, string[]> = {
  PREVERITEV: ['ODOBRENA', 'ZAVRNJENA'],
  ODOBRENA: ['V_SERVISU', 'ZAKLJUCEN'],
  V_SERVISU: ['ZAKLJUCEN'],
  ZAKLJUCEN: [],
  ZAVRNJENA: [],
}

/** Dovoljeni prehodi statusov reklamacije (vse ostalo → 409). */
export const CLAIM_TRANSITIONS: Record<string, string[]> = {
  NOVA: ['V_OBRAVNAVI', 'ZAVRNJENA'],
  V_OBRAVNAVI: ['ZAKLJUCENA', 'ZAVRNJENA'],
  ZAKLJUCENA: [],
  ZAVRNJENA: [],
}

/** Relacije, ki jih vračajo rute claims (stranka, projekt, paket, garancija, servisni primer). */
export const CLAIM_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  project: { select: { id: true, code: true, title: true, address: true, status: true } },
  package: { select: { id: true, code: true, name: true } },
  warranty: { select: { id: true, startsAt: true, months: true, status: true } },
  serviceCase: { select: { id: true, code: true, status: true } },
} satisfies Prisma.ClaimInclude

/** Relacije, ki jih vračajo rute service-cases (claim, projekt, garancija, odločitelj, obiski). */
export const SERVICE_CASE_INCLUDE = {
  claim: {
    select: {
      id: true, code: true, title: true, status: true, channel: true, reportedBy: true,
      customer: { select: { id: true, name: true, phone: true } },
    },
  },
  project: { select: { id: true, code: true, title: true, address: true, status: true } },
  warranty: { select: { id: true, startsAt: true, months: true, status: true } },
  decidedBy: { select: { id: true, name: true } },
  visits: {
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: { date: 'asc' as const },
  },
} satisfies Prisma.ServiceCaseInclude

/** Ali garancija TRENUTNO velja (status AKTIVNA in startsAt + months ≥ danes). */
export function warrantyValid (
  w: { status: string; startsAt: Date; months: number } | null | undefined,
  now: Date = new Date()
): boolean {
  if (!w || w.status !== 'AKTIVNA') return false
  const endsAt = new Date(w.startsAt)
  endsAt.setMonth(endsAt.getMonth() + w.months)
  return endsAt >= now
}

/** Datum poteka garancije (startsAt + months). */
export function warrantyEndsAt (w: { startsAt: Date; months: number }): Date {
  const endsAt = new Date(w.startsAt)
  endsAt.setMonth(endsAt.getMonth() + w.months)
  return endsAt
}

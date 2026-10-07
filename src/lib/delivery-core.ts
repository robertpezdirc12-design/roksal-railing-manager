// delivery-core — R445 (issue #7 §9 DELIVERY + INSTALLATION).
// Tok dostave + skupni include za odgovore API-ja + obseg dostopov.
// UVOZ LE S STREŽNIKA (vsebuje Prisma tipe za include) — UI ima svoje oznake.

import type { Prisma } from '@prisma/client'

/** Veljavni statusi dostave (issue #7 §9). */
export const DELIVERY_STATUSES = ['NACRTOVANO', 'PRIPRAVLJENO', 'NATOVARJENO', 'NA_POTI', 'DOSTAVLJENO', 'PREKLICANA'] as const

/** Opis toka za sporočila o napakah (409). */
export const DELIVERY_FLOW_DESC = 'NACRTOVANO → PRIPRAVLJENO → NATOVARJENO → NA_POTI → DOSTAVLJENO'

/** Relacije, ki jih vračata GET/POST/PATCH dostav (projekt, vozilo, voznik, picking, nalog, vrstice). */
export const DELIVERY_INCLUDE = {
  project: { select: { id: true, code: true, title: true, address: true } },
  vehicle: { select: { id: true, plate: true, name: true } },
  driver: { select: { id: true, name: true } },
  pickingList: { select: { id: true, code: true, status: true } },
  workOrder: { select: { id: true, code: true, title: true, scheduledFor: true, assigneeId: true } },
  items: { include: { item: { select: { id: true, sku: true, name: true, unit: true } } } },
} satisfies Prisma.DeliveryInclude

/** Ali dostava pade v obseg uporabnika z omejenim branjem (MONTER): voznik ali nalog dodeljen njemu. */
export function deliveryInScope (
  delivery: { driverId: string | null; workOrder: { assigneeId: string | null } | null },
  userId: string
): boolean {
  return delivery.driverId === userId || delivery.workOrder?.assigneeId === userId
}

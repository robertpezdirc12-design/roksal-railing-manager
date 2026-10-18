// DOSTAVE SHARED (R549): tipi API odgovorov, statusi dostav, oznake akcij
// prehodov in pisarniška vrata — en vir za vse gradnike dostav (izvlečeno
// bajtno-identično iz dostave.tsx, recept R546–R548).

import { hasPerm } from '@/lib/permissions-core'

// ─── tipi (odgovori API-jev) ──────────────────────────────────────────────────

export interface DeliveryItemRow {
  id: string; itemId: string | null; description: string; qty: number; unit: string; note: string | null
  item: { id: string; sku: string; name: string; unit: string } | null
}

export interface DeliveryRow {
  id: string; code: string; status: string
  projectId: string | null
  project: { id: string; code: string; title: string; address: string | null } | null
  vehicle: { id: string; plate: string; name: string } | null
  driver: { id: string; name: string } | null
  pickingList: { id: string; code: string; status: string } | null
  workOrder: { id: string; code: string; title: string; scheduledFor: string | null; assigneeId: string | null } | null
  plannedAt: string | null; loadedAt: string | null; departedAt: string | null; deliveredAt: string | null
  address: string | null; recipientNote: string | null; note: string | null
  items: DeliveryItemRow[]
}

export interface VehicleRow {
  id: string; plate: string; name: string; capacityNote: string | null; active: boolean
  _count: { deliveries: number }
}

export interface CrewRow {
  id: string; name: string; type: string; region: string | null
  contactName: string | null; contactPhone: string | null; contactEmail: string | null
  workTypes: string | null; availabilityNote: string | null; priceNote: string | null
  rating: number | null; active: boolean; note: string | null
  _count: { workOrders: number }
}

export interface ProjectOption { id: string; code: string; title: string; address?: string | null }

export interface PickingOption {
  id: string; code: string; status: string
  bom: { code: string; package: { code: string; name: string; project: { code: string; title: string } | null } | null } | null
}

export interface NalogOption {
  id: string; code: string; title: string; status: string; scheduledFor: string | null
  project: { code: string; title: string } | null
}

export interface UserOption { id: string; name: string; role: string; active: boolean }

export const DELIVERY_STATUSI: { v: string; l: string }[] = [
  { v: 'NACRTOVANO', l: 'Načrtovano' },
  { v: 'PRIPRAVLJENO', l: 'Pripravljeno' },
  { v: 'NATOVARJENO', l: 'Natovorjeno' },
  { v: 'NA_POTI', l: 'Na poti' },
  { v: 'DOSTAVLJENO', l: 'Dostavljeno' },
  { v: 'PREKLICANA', l: 'Preklicana' },
]

export const ACTION_LABELS: Record<string, string> = {
  prepare: 'Pripravljeno',
  load: 'Natovorjeno',
  depart: 'Na poti',
  deliver: 'Dostavljeno',
  cancel: 'Preklicana',
}

/** Pisarna v UI: projects.write + vloga z obsegom vodenja (strežnik je tisti, ki RES preverja). */
export function isOffice (user: { role: string; perms: string[] } | null): boolean {
  if (!user) return false
  return user.role !== 'MONTER' && hasPerm(user.perms, 'projects.write')
}

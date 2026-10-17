// PROJEKTI — skupni tipi in konstante (R546: en vir resnice).
// Čist TS modul — uporabljajo ga projekti.tsx (seznam/podrobnost/kosovnica),
// projekti-sections.tsx, projekti-packages.tsx.
// Izvlečeno iz projekti.tsx BREZ spremembe obnašanja.

export interface ProjectRow {
  id: string; code: string; title: string; status: string; address: string | null; createdAt: string
  customer: { name: string; city: string | null } | null
  _count: { workOrders: number; quotes: number; measurements: number }
}

export interface ProjectDetail extends ProjectRow {
  note: string | null
  customer: { name: string; city: string | null; email: string | null; phone: string | null } | null
  quotes: { id: string; code: string; status: string; total: number }[]
  workOrders: { id: string; code: string; title: string; status: string; scheduledFor: string | null; assignee: { name: string } | null }[]
  measurements: {
    id: string; type: string; location: string | null; lengthCm: number | null
    heightCm: number | null; posts: number | null; handrail: boolean | null
    slopeDeg: number | null; params: Record<string, unknown> | null; createdAt: string // R542: jsonb objekt
  }[]
  invoices: { id: string; code: string; status: string; total: number; paid: number }[]
}

export interface WarrantyRow {
  id: string; startsAt: string; months: number; status: string; note: string | null; endsAt: string
  valid: boolean
  nextVisit: { id: string; date: string; note: string | null } | null
  visits: { id: string; date: string; note: string | null }[]
}

export const STATUSES = [
  { value: 'NACRT', label: 'Načrt' },
  { value: 'AKTIVNI', label: 'Aktivni' },
  { value: 'TEREN', label: 'Na terenu' },
  { value: 'ZAKLJUCEN', label: 'Zaključen' },
  { value: 'ARHIV', label: 'Arhiv' },
]

/** Paketi projekta (R442 — issue #7 §3): projekt = več produktnih paketov.
 * Paket povezuje produkt, varianto, izmero, količino, status in (generirano) kosovnico. */
export interface PackageRow {
  id: string; code: string; name: string; qty: number; unit: string
  status: string; note: string | null; calcJson: Record<string, unknown> | null // R542: jsonb objekt
  tier: string | null; compareCode: string | null // R476: primerjalni paket
  createdAt: string
  product: { sku: string; name: string; unit: string; family: { code: string; name: string } }
  variant: { sku: string; name: string } | null
  measurement: { id: string; type: string; familyCode: string | null } | null
  bom: { id: string; code: string; status: string; lines: { id: string }[] } | null
}

export interface PackageBomLine {
  itemId: string; sku: string; name: string; unit: string
  qty: number; note: string | null; covered: boolean; missing: number; stockQty: number
}

export interface PackageCalc {
  generatedAt: string; qty: number; unit: string
  materialCost: number; montazaUnit: number; totalSale: number
  margin: number; marginPct: number; priceSource: string; lines: number
  segmentsApplied?: number // R475: segmentni režim kosovnice
  warnings?: { code: string; message: string }[]
}

export const PACKAGE_STATUS_OPTIONS = [
  'POVPRAŠEVANJE', 'IZMERA', 'KONFIGURACIJA', 'PONUDBA', 'POTRJENO',
  'REZERVIRANO', 'V_IZDELAVI', 'DOSTAVLJENO', 'MONTIRANO', 'PREDANO',
]

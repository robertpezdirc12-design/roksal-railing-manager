// VIZ — skupni tipi, pomočniki in tipi cene (R548: en vir resnice).
// Čist TS modul — uporablja ga viz.tsx (stanjski del konfiguratorja).
// Izvlečeno iz viz.tsx BREZ spremembe obnašanja (razbitje po vzorcu R546/R547).
// R464: ocena cene teče strežniško (POST /api/price-lists/calculate) — tipi
// odgovora živijo tu; UI samo prikaže rezultat (brez klientnih cen).

export interface ProfileRow { id: string; sku: string; name: string; material: string; type: string; pricePerM: number }
export interface ProjectRow { id: string; code: string; title: string }
export interface MeasurementRow {
  id: string; type: string; location: string | null; note: string | null; params: string | null
  lengthCm: number | null; heightCm: number | null; posts: number | null
  segments: number | null; handrail: boolean | null; slopeDeg: number | null
  projectId: string | null; createdAt: string
}

/** R454: shranjen 3D projekt (GET/POST /api/viz/projects) — params = JSON konfiguratorja. */
export interface VizRow {
  id: string
  name: string
  tip: string
  params: Record<string, unknown> | null
  note: string | null
  projectId: string | null
  createdAt: string
  updatedAt: string
  author?: { name: string; role: string } | null
  project?: { code: string; title: string } | null
}

export const toNum = (v: string, fallback: number, min: number, max: number): number => {
  const n = Number(v.replace(',', '.'))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// ── R464: ocena cene iz strežniškega pricing core-a (brez klientnih cen) ──

export interface CenaPostavka {
  key: string
  label: string
  qty: number
  qtyUnit: string
  unitPrice: number
  total: number
}
export interface CenaRezultat {
  postavke: CenaPostavka[]
  skupaj: number
  dolzinaM: number
  priceSource: string
  unitPrices: Partial<Record<string, number>>
}

// prefab-core — R465 PREFAB ENGINE (issue #4 §3: proizvodnja elementov iz
// digitalnega dvojčka). ČIST, brez db — uporaben na odjemalcu in strežniku.
// Enota proizvodnje = SEGMENT AS-PRODUCED dvojčka (ključ seg-N).
// Listič je DENORMALIZIRAN posnetek mer — vir resnice ostaja verzionirani
// snapshot (§22); brez tihih sprememb, brez podvajanja kosovnic (BOM ostaja
// materialni pogled, prefab je elementni pogled).

import type { TwinSnapshotData } from './capture-qa-engine'

export const PREFAB_VERSION = 'prefab/1.0'

// ── Statusni tok elementa (linearno — brez preskakovanja) ───────────────────

export type ElementStatus = 'NAVRTEN' | 'REZANJE' | 'IZDELAVA' | 'POVRSINA' | 'DOKONCAN'

/** Tovarna ROKSAL: razrez → izdelava → površina → priprava za odpremo. */
export const ELEMENT_FLOW: ElementStatus[] = ['NAVRTEN', 'REZANJE', 'IZDELAVA', 'POVRSINA', 'DOKONCAN']

export const ELEMENT_STATUS_LABELS: Record<ElementStatus, { label: string; desc: string }> = {
  NAVRTEN: { label: 'Načrtovan', desc: 'Listič ustvarjen iz AS-PRODUCED dvojčka' },
  REZANJE: { label: 'Rezanje', desc: 'Profili in polnila razrezani na merico' },
  IZDELAVA: { label: 'Izdelava', desc: 'Varjenje/sestavljanje elementa' },
  POVRSINA: { label: 'Površinska obdelava', desc: 'Priprava/peskanje/lakiranje po RAL' },
  DOKONCAN: { label: 'Dokončan', desc: 'Element pripravljen za odpremo' },
}

export function elementStatusValid (s: string): s is ElementStatus {
  return ELEMENT_FLOW.includes(s as ElementStatus)
}

/** Naslednji dovoljeni status (linearni tok) ali null, če ga ni. */
export function nextElementStatus (current: string): ElementStatus | null {
  const idx = ELEMENT_FLOW.indexOf(current as ElementStatus)
  if (idx === -1 || idx === ELEMENT_FLOW.length - 1) return null
  return ELEMENT_FLOW[idx + 1]
}

// ── Gradnja proizvodnih lističev iz snapshot-a ──────────────────────────────

export interface PrefabElementDraft {
  key: string // seg-N (stabilen ključ iz snapshot-a)
  label: string
  lengthCm: number | null
  heightCm: number | null
  posts: number | null
  ral: string | null
  produkt: string | null
}

/** AS-PRODUCED snapshot → nabor lističev (1 listič = 1 segment dvojčka). */
export function draftsFromSnapshot (snap: TwinSnapshotData): PrefabElementDraft[] {
  const produkt = snap.produkt
    ? [snap.produkt.ime, snap.produkt.varianta].filter((v): v is string => !!v).join(' — ') || null
    : null
  const ral = snap.produkt?.ral ?? null
  return snap.segments.map((seg) => ({
    key: seg.key,
    label: seg.label,
    lengthCm: seg.lengthCm,
    heightCm: seg.heightCm,
    posts: seg.posts,
    ral,
    produkt,
  }))
}

// ── Napredek tekmice ───────────────────────────────────────────────────────

export interface PrefabProgress {
  total: number
  done: number
  byStatus: Record<string, number>
  pct: number // 0..100 (delež DOKONCAN)
}

export function prefabProgress (statuses: string[]): PrefabProgress {
  const total = statuses.length
  const byStatus: Record<string, number> = {}
  for (const s of statuses) byStatus[s] = (byStatus[s] ?? 0) + 1
  const done = byStatus.DOKONCAN ?? 0
  return { total, done, byStatus, pct: total === 0 ? 0 : Math.round((done / total) * 100) }
}

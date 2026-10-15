// measure-doc — R522 (issue #7 §4B): DOKUMENTACIJSKE SLIKE DETAJLOV.
// Merilni pogledi (View, max 4) so za REKONSTRUKCIJO mere — vsak nosi točke in
// kalibracijo. Dokumentacijska slika detajla (vijak, nosilec, podlaga, ovira)
// pa je DOKAZ, ne vir mere: nima točk, ne kalibracije, ne sodeluje v izračunu
// in je zato NEODVISNA od meje pogledov. Šteje se ločeno (MAX_DOK_SLIK).
//
// Čist modul: brez Prisma, brez DOM, brez next/* — uporabljajo ga kamera (UI),
// /api/measurements (online pot), /api/sync/opFoto (offline pot) in testi r522.

/** Oznake detajlov iz issue #7 §4B (»vijak, nosilec, podlaga, ovira«) + SPLOSNO
 *  za vse, kar je dokumentacija, pa ni eden od naštetih. */
export const DOC_TAGS = ['VIJAK', 'NOSILEC', 'PODLAGA', 'OVIRA', 'SPLOSNO'] as const
export type DocTag = typeof DOC_TAGS[number]

export const DOC_TAG_LABELS: Record<DocTag, string> = {
  VIJAK: 'Vijak / pritrditev',
  NOSILEC: 'Nosilec / konzola',
  PODLAGA: 'Podlaga / tla',
  OVIRA: 'Ovira / namestitvena težava',
  SPLOSNO: 'Splošni detajl',
}

/**
 * Meja dokumentacijskih slik na SEJO. »Poljubno smiselno število« (issue #7
 * §4B) ne pomeni neskončno: vsaka slika je JPEG ≤ 1600 px v osnutku (IndexedDB,
 * skupna meja seje 8 MB) in POST na strežniku. 30 podrobnih zajemov na eno
 * meritev je veliko več, kot terenska praksa potrebuje; višje meje ne moremo
 * utemeljiti z izmero.
 */
export const MAX_DOK_SLIK = 30

/** Najdaljša opomba detajla (enaka meji ročnega popraveka iz R455). */
export const MAX_DOK_NOTE = 200

/** Slika detajla v seji kamere (serializabilna — gre tudi v osnutek). */
export interface DokSlika {
  key: number
  dataUrl: string
  tag: DocTag
  note: string
  /** Indeks segmenta izračuna (0-based), null = cela meritev. */
  segmentIdx: number | null
}

export function jeVeljavenDocTag (v: unknown): v is DocTag {
  return typeof v === 'string' && (DOC_TAGS as readonly string[]).includes(v)
}

/** Normalizacija segmenta: null ali celo število ≥ 0 (negativno → null). */
export function normalizirajDocSegment (v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.round(v)
  return n < 0 ? null : n
}

/** Opomba: trim + meja dolžine (prazno → ''). */
export function normalizirajDocNote (v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, MAX_DOK_NOTE)
}

/**
 * Preveri doc* polja, kot jih pošilja odjemalec (online: POST
 * /api/measurements). Vrne { napaka } ALI očiščena polja — nikoli oboje.
 *
 * Pravila (fail-closed):
 *  - če NI podano nobeno doc* polje → vse null/undefined (nazaj kompatibilno,
 *    obstoječi klici foto.tsx se ne spremenijo);
 *  - `docOfMeasurementId` podan → type MORA biti 'FOTO' (dokumentacijska slika
 *    je vedno foto zapis, ne merilna geometrija);
 *  - `docTag` podan → MORA biti iz DOC_TAGS (neznana oznaka = napaka, ker bi
 *    sicer v bazi nastal neprepoznaven filter);
 *  - `docSegmentIdx` → null ali ≥ 0;
 *  - `docNote` → ≤ 200 znakov.
 */
export function preveriDocPolja (vhod: {
  type?: unknown
  docOfMeasurementId?: unknown
  docTag?: unknown
  docSegmentIdx?: unknown
  docNote?: unknown
}): { napaka: string } | {
  docOf: string | null
  docTag: DocTag | null
  docSegmentIdx: number | null
  docNote: string
} {
  const podanDocOf = typeof vhod.docOfMeasurementId === 'string' && vhod.docOfMeasurementId.trim() !== ''
  const docOf = podanDocOf ? (vhod.docOfMeasurementId as string).trim() : null
  const podanTag = vhod.docTag !== undefined && vhod.docTag !== null && vhod.docTag !== ''
  const podanSegment = vhod.docSegmentIdx !== undefined && vhod.docSegmentIdx !== null
  const podanaNote = typeof vhod.docNote === 'string' && vhod.docNote.trim() !== ''

  if (!docOf && !podanTag && !podanSegment && !podanaNote) {
    return { docOf: null, docTag: null, docSegmentIdx: null, docNote: '' }
  }
  if (podanTag && !jeVeljavenDocTag(vhod.docTag)) {
    return { napaka: `Neveljavna oznaka dokumentacijske slike. Veljavne: ${DOC_TAGS.join(', ')}.` }
  }
  if (vhod.type !== undefined && vhod.type !== 'FOTO') {
    return { napaka: 'Dokumentacijska slika detajla je vedno tip FOTO. Merilna geometrija je ločen zapis.' }
  }
  if (podanaNote && (vhod.docNote as string).length > MAX_DOK_NOTE) {
    return { napaka: `Opomba detajla je predolga (meja ${MAX_DOK_NOTE} znakov).` }
  }
  return {
    docOf,
    docTag: podanTag ? (vhod.docTag as DocTag) : null,
    docSegmentIdx: normalizirajDocSegment(vhod.docSegmentIdx),
    docNote: normalizirajDocNote(vhod.docNote),
  }
}

/**
 * Zapiše doc* polja v obstoječi params JSON meritev (aditivno — obstoječe
 * ključe pusti pri miru). Vrne JSON string; če params ni bil veljaven JSON,
 * ga POŠTENO zamenja z objektom, ki vsebuje vsaj doc polja (izguba pokvarjenih
 * podatkov ni možna — pokvarjen JSON že prej ni bil uporaben).
 */
export function zapišiDocVParams (params: string | null, doc: {
  docOf?: string | null
  docTag?: DocTag | null
  docSegmentIdx?: number | null
  docNote?: string
  docOffline?: boolean
}): string {
  let obj: Record<string, unknown> = {}
  if (params) {
    try { obj = JSON.parse(params) as Record<string, unknown> } catch { obj = {} }
  }
  if (doc.docOf !== null && doc.docOf !== undefined) obj.docOf = doc.docOf
  if (doc.docTag !== null && doc.docTag !== undefined) obj.docTag = doc.docTag
  if (doc.docSegmentIdx !== null && doc.docSegmentIdx !== undefined) obj.docSegmentIdx = doc.docSegmentIdx
  if (doc.docNote !== undefined && doc.docNote !== '') obj.docNote = doc.docNote
  if (doc.docOffline === true) obj.docOffline = true
  return JSON.stringify(obj)
}

/**
 * Preveri, koliko dokumentacijskih slik sme še v sejo (0 = meja dosežena).
 * Ločeno od MAX_VIEWS: dodajanje dokumentacijske slike NIKOLI ne zavrne zaradi
 * števila merilnih pogledov — to je točka te ločitve (issue #7 §4B).
 */
export function prostorZaDokSlike (trenutno: number): number {
  return Math.max(0, MAX_DOK_SLIK - Math.max(0, trenutno))
}

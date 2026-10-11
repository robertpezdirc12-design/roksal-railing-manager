// pin-core — ROKSAL REVIEW PINS (R479 — issue #9 §7 + §10 osnova)
// ČIST lib: NIČ strežniških uvozov (enak vzorec kot model-core/quote-core) —
// uporaben na odjemalcu (enotni pregledovalnik) in strežniku (API).
//
// NAČELO (§7 zadnja alinea): pripomba NE spreminja mere. Pin nima poti do
// FenceSegment/verifiedCm — vsaka sprememba mere gre čez obstoječi
// verify/confirm tok tekača z revizijo. Pin je SAMO pripomba.
//
// JAVNA VARNOST (§7): javni žeton pregleda NE sme razkriti internih opomb
// (internalNote), e-pošte uporabnikov, cen ali marž — publicPin() projekcija
// je edina dovoljena oblika pina na javni poti.
//
// GDPR (§10): fotografije stranke se javno izpišejo SAMO ob VELJAVNEM
// soglasju (consentStatus na projektu); sicer photosBlocked z razlogom.

// ─── Cilji pinov ────────────────────────────────────────────────────────────

/** Cilj pina: segment tekača | vozlišče tekača | fotografija zajema. */
export const PIN_TARGET_TYPES = ['SEGMENT', 'VOZLISCE', 'FOTOGRAFIJA'] as const
export type PinTargetType = (typeof PIN_TARGET_TYPES)[number]

export const PIN_TARGET_TYPE_LABELS: Record<PinTargetType, string> = {
  SEGMENT: 'Segment',
  VOZLISCE: 'Vozlišče',
  FOTOGRAFIJA: 'Fotografija',
}

// ─── Statusi + prehodi ──────────────────────────────────────────────────────

/** Status pina. Prehodi so ENSMERNI — nazaj ne gre (revizija sledi). */
export const PIN_STATUSES = ['ODPRTO', 'RESENO', 'ZAPRT'] as const
export type PinStatus = (typeof PIN_STATUSES)[number]

/** Dovoljeni prehodi: ODPRTO→RESENO, ODPRTO→ZAPRT, RESENO→ZAPRT. NIKOLI nazaj. */
export const PIN_TRANSITIONS: Readonly<Record<PinStatus, readonly PinStatus[]>> = {
  ODPRTO: ['RESENO', 'ZAPRT'],
  RESENO: ['ZAPRT'],
  ZAPRT: [],
}

export function isPinStatus (v: unknown): v is PinStatus {
  return typeof v === 'string' && (PIN_STATUSES as readonly string[]).includes(v)
}

export function isPinTargetType (v: unknown): v is PinTargetType {
  return typeof v === 'string' && (PIN_TARGET_TYPES as readonly string[]).includes(v)
}

/** Prehod veljaven? (prehod nazaj / isti status / iz zaprtega = vedno napaka) */
export function canTransitionPin (from: PinStatus, to: PinStatus): boolean {
  return PIN_TRANSITIONS[from].includes(to)
}

// ─── Validacija targetKey ──────────────────────────────────────────────────
// Usklajeno z model-core (R473):
//  • SEGMENT  → 'seg-N'   (N ≥ 1; tekačev order je 0-based, ključi 1-based —
//                          ISTO kot digitalni dvojček/prefab/kosovnica)
//  • VOZLISCE → 'node-N'  (N ≥ 0; vozlišča so 0-based — node-0 je izvor)
//  • FOTOGRAFIJA → capturePhotoId (cuid)

const SEG_RE = /^seg-(\d+)$/
const NODE_RE = /^node-(\d+)$/
// Prisma cuid(): 'c' + 24 base36 znakov (25 skupaj) — dopuščamo 20..32 za robustnost.
const CUID_RE = /^c[0-9a-z]{19,31}$/

export interface PinTargetParse {
  targetType: PinTargetType
  targetKey: string
  /** zaporedni N (seg/node) ali null (fotografija) */
  index: number | null
}

/**
 * Razčleni + validiraj targetKey za targetType.
 * Vrne null, če ključ ne ustreza konvenciji (fail-closed).
 */
export function parsePinTarget (targetType: PinTargetType, targetKey: string): PinTargetParse | null {
  if (typeof targetKey !== 'string' || !targetKey || targetKey.length > 64) return null
  if (targetType === 'SEGMENT') {
    const m = SEG_RE.exec(targetKey)
    if (!m) return null
    const n = Number(m[1])
    if (!Number.isInteger(n) || n < 1) return null
    return { targetType, targetKey, index: n }
  }
  if (targetType === 'VOZLISCE') {
    const m = NODE_RE.exec(targetKey)
    if (!m) return null
    const n = Number(m[1])
    if (!Number.isInteger(n) || n < 0) return null
    return { targetType, targetKey, index: n }
  }
  // FOTOGRAFIJA — capturePhotoId (cuid)
  if (!CUID_RE.test(targetKey)) return null
  return { targetType, targetKey, index: null }
}

/**
 * parsePinTargets za UI — razrez prostega vnosa cilja ('seg-1', 'node-2', cuid).
 * Vrne { targetType, targetKey } ali null, če ni prepoznano.
 */
export function parsePinTargets (input: string): { targetType: PinTargetType; targetKey: string } | null {
  if (typeof input !== 'string') return null
  const s = input.trim().toLowerCase()
  if (!s) return null
  if (SEG_RE.test(s)) {
    const p = parsePinTarget('SEGMENT', s)
    return p ? { targetType: p.targetType, targetKey: p.targetKey } : null
  }
  if (NODE_RE.test(s)) {
    const p = parsePinTarget('VOZLISCE', s)
    return p ? { targetType: p.targetType, targetKey: p.targetKey } : null
  }
  if (CUID_RE.test(s)) return { targetType: 'FOTOGRAFIJA', targetKey: s }
  return null
}

// ─── Velikosti / validacija vsebine ─────────────────────────────────────────

export const PIN_NOTE_MAX = 2000
/** svetovni XY modela v cm (meja 10 km — velikodušno, a končno) */
export const PIN_XY_MAX_CM = 1_000_000

export function validPinNote (v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= PIN_NOTE_MAX
}

export function validPinInternalNote (v: unknown): v is string | null {
  return v == null || (typeof v === 'string' && v.length <= PIN_NOTE_MAX)
}

/** Veljavna opcijska koordinata pina (svetovni cm) — null = brez pozicije. */
export function validPinCoord (v: unknown): v is number | null {
  if (v == null) return true
  if (typeof v !== 'number' || !Number.isFinite(v)) return false
  return Math.abs(v) <= PIN_XY_MAX_CM
}

// ─── publicPin — projekcija za JAVNO pot (žeton) ────────────────────────────
// Past #3: internalNote NIKOLI ne sme priti na javni odgovor. Prav tako NE
// izdamo avtorjevega e-pošte naslova (samo ime), niti resolvedById/authorId.

export interface PublicPin {
  id: string
  fenceRunId: string
  targetType: string
  targetKey: string
  x: number | null
  y: number | null
  note: string
  status: string
  resolvedAt: string | null
  resolvedBy: string | null
  authorName: string | null
  snapshot: unknown
  createdAt: string
}

/**
 * Projekcija pina za javni žeton: BREZ internalNote, brez ID-jev uporabnikov,
 * brez e-pošte (samo ime avtorja/reševalca). snapshot ostane (geometrijski dokaz).
 */
export function publicPin (p: {
  id: string
  fenceRunId: string
  targetType: string
  targetKey: string
  x: unknown
  y: unknown
  note: string
  status: string
  resolvedAt: Date | null
  resolvedBy?: { name: string } | null
  author?: { name: string } | null
  snapshot?: string | null
  createdAt: Date
}): PublicPin {
  let snapshot: unknown = null
  if (p.snapshot) {
    try { snapshot = JSON.parse(p.snapshot) } catch { snapshot = null }
  }
  return {
    id: p.id,
    fenceRunId: p.fenceRunId,
    targetType: p.targetType,
    targetKey: p.targetKey,
    x: p.x == null ? null : Number(p.x),
    y: p.y == null ? null : Number(p.y),
    note: p.note,
    status: p.status,
    resolvedAt: p.resolvedAt ? p.resolvedAt.toISOString() : null,
    resolvedBy: p.resolvedBy?.name ?? null,
    authorName: p.author?.name ?? null,
    snapshot,
    createdAt: p.createdAt.toISOString(),
  }
}

// ─── GDPR soglasje za fotografije (§10) ─────────────────────────────────────

export type ConsentStatus = 'MANJKA' | 'VELJAVNO' | 'POTEKLO'

export type PhotosBlockedReason = 'MANJKA_SOGLASJE' | 'SOGLASJE_POTEKLO'

/**
 * Stanje soglasja projekta za objavo fotografij:
 *  MANJKA  — photoConsentAt ni nastavljen (privzeto: NE objavimo)
 *  VELJAVNO— soglasje je dano in ni poteklo (ali brez roka)
 *  POTEKLO — soglasje je bilo dano, a je rok (photoConsentExpiresAt) potekel
 */
export function consentStatus (
  project: { photoConsentAt: Date | string | null; photoConsentExpiresAt: Date | string | null } | null | undefined,
  now: Date = new Date()
): ConsentStatus {
  if (!project || !project.photoConsentAt) return 'MANJKA'
  const expires = project.photoConsentExpiresAt
  if (expires != null) {
    const exp = typeof expires === 'string' ? new Date(expires) : expires
    if (exp.getTime() <= now.getTime()) return 'POTEKLO'
  }
  return 'VELJAVNO'
}

/** Razlog zamika fotografij na javni poti (null = ni zamika — smejo ven). */
export function photosBlockedReason (status: ConsentStatus): PhotosBlockedReason | null {
  if (status === 'MANJKA') return 'MANJKA_SOGLASJE'
  if (status === 'POTEKLO') return 'SOGLASJE_POTEKLO'
  return null
}

// ─── Žetoni javne delitve ───────────────────────────────────────────────────
// Tempomat JE skupni lib (src/lib/rate-limit.ts, 60 zadetkov/60 s na bucket,
// vzorec public/portal iz R437) — tukaj NI podvojen; javna pot ga kliče z
// ključem `review:<token>`. Dovoljena dolžina žetona (enako kot portal):

export const REVIEW_TOKEN_MIN = 8
export const REVIEW_TOKEN_MAX = 80

/** Privzeti rok javne povezave pregleda (dni) + največji dovoljeni rok. */
export const REVIEW_LINK_DEFAULT_DAYS = 14
export const REVIEW_LINK_MAX_DAYS = 90

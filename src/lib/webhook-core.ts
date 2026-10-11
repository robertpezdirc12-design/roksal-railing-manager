// webhook-core — R481 (issue #9 §9): WEBHOOK INTEGRACIJSKA PLAST — čist lib.
// NIČ strežniških/db uvozov (vzorec pin-core/viz-core) — uporaben na
// odjemalcu (nastavitve integracij) in strežniku (API rute + dostava).
//
// LOČENOST (past raziskave #4): to NI notify-providers NOTIFY_WEBHOOK_URL —
// to je poslovno-dogodkovni webhook izhod za partnerje: naročnine po dogodkih,
// lastna skrivnost, podpis X-ROKSAL-Signature, outbox z idempotenco in retry.
//
// Podpisovanje (strežniško, node:crypto) je v src/lib/webhook-sign.ts — čist
// lib tukaj pozna samo OBLIKO podpisa (sporočilo `${timestamp}.${body}`) in
// validacije. Do veljavnosti skrivnosti: min 16 znakov (WEBHOOK_SECRET_MIN).
//
// VARNOST (§9 „integracijski ključi ne smejo obiti obsega projekta"):
//  • naročnina je globalna za pisarno, a payload nosi projectId + varni
//    podskup (publicWebhookPayload) — BREZ internih cen/marž, BREZ e-pošte
//    strank (naslovi gredo izključno prek obvestilnega kanala notify.ts);
//  • URL naročnine mora biti https (SSRF vrata — localhost/privatni dobesedno
//    zavrnjeni; razvoj dovoli 127.0.0.1 SAMO prek allowLocal zastavice, ki
//    strežniška ruta nastavi le izven produkcije — past raziskave #16).

import { NOTIFICATION_EVENT_TYPES } from './notify-events'

// ─── Katalog dogodkov ────────────────────────────────────────────────────────

/**
 * Vsi podprti webhook dogodki = katalog obvestilnih dogodkov (16 tipov:
 * 12 obstoječih R438–R480 + 4 novi iz §9 — CAPTURE_PROCESSED, MODEL_CHANGED,
 * PRODUCTION_READY, ORDER_CONFIRMED). En vir resnice z IN_APP obvestili:
 * emitEvent (notify.ts) poganja OBE dostavi — webhook NE ločuje tipov.
 */
export const WEBHOOK_EVENTS: readonly string[] = [...NOTIFICATION_EVENT_TYPES]

export function isWebhookEventType (t: string): boolean {
  return WEBHOOK_EVENTS.includes(t)
}

/** Pomožni dogodek testnega pinga (NI v katalogu naročin — posebna vrsta). */
export const WEBHOOK_TEST_EVENT = 'WEBHOOK_TEST'

/** HTTP metoda dostave (fiksna — dokumentacija partnerjem). */
export const WEBHOOK_METHOD = 'POST'
/** Časovna omejitev enega dostavnega poskusa. */
export const WEBHOOK_TIMEOUT_MS = 10_000

// ─── events[] v nizu (JSON — vzorec FenceRun.nodes) ─────────────────────────

export const WEBHOOK_EVENTS_MAX = 16

/** Razčleni JSON niz seznama dogodkov: `["A","B"]` → ['A','B']; smeti → null. */
export function parseWebhookEvents (raw: string | null | undefined): string[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > WEBHOOK_EVENTS_MAX) return null
  const out: string[] = []
  for (const t of parsed) {
    if (typeof t !== 'string' || !isWebhookEventType(t)) return null
    if (!out.includes(t)) out.push(t) // dedup
  }
  return out.length > 0 ? out : null
}

/** Serializiraj seznam dogodov nazaj v obliko shranjevanja (JSON niz). */
export function serializeWebhookEvents (events: readonly string[]): string {
  return JSON.stringify([...new Set(events)])
}

// ─── Validacija URL (SSRF osnovna vrata) ────────────────────────────────────

/** Loopback vzorci (smejo v razvoju prek http — testni sprejemnik). */
const URL_LOOPBACK_SUBSTRINGS = ['localhost', '127.', '0.0.0.0', '[::1]', '::1/']
/** Privatna/link-local območja — ZAVEK zavrnjena (SSRF; tudi https, tudi razvoj). */
const URL_PRIVATE_SUBSTRINGS = ['10.', '192.168.', '169.254.']

/**
 * Veljaven URL webhook naročnine:
 *  • https (produkcija) — vedno dovoljen protokol za javne gostitelje;
 *  • http SAMO z allowLocal (razvoj/testi) in SAMO za loopback naslove
 *    (127.0.0.1 sprejemnik) — http do zunanjih gostov je zavrnjen TUDI v razvoju;
 *  • privatna/link-local območja (10./192.168./169.254.) so zavrnjena VEDEN
 *    (osnovna SSRF zaščita — string vrata, ne resolucija DNS: poštena meja
 *    za brez-npm implementacijo).
 */
export function validWebhookUrl (url: string | null | undefined, opts: { allowLocal?: boolean } = {}): boolean {
  if (typeof url !== 'string') return false
  const u = url.trim()
  if (!u || u.length > 2048) return false
  let parsed: URL
  try { parsed = new URL(u) } catch { return false }
  const host = parsed.hostname.toLowerCase()
  if (URL_PRIVATE_SUBSTRINGS.some((s) => host.includes(s))) return false // privatno: vedno ne
  const loopback = URL_LOOPBACK_SUBSTRINGS.some((s) => host.includes(s))
  if (loopback && !opts.allowLocal) return false // loopback: samo razvoj
  if (parsed.protocol === 'https:') return true
  if (opts.allowLocal && loopback && parsed.protocol === 'http:') return true
  return false
}

// ─── Validacija skrivnosti ──────────────────────────────────────────────────

export const WEBHOOK_SECRET_MIN = 16
export const WEBHOOK_SECRET_MAX = 200

/** Skrivnost naročnine: 16–200 znakov (dolžina je edina omejitev — vsebino izbere partner). */
export function validWebhookSecret (secret: string | null | undefined): boolean {
  if (typeof secret !== 'string') return false
  const s = secret
  return s.length >= WEBHOOK_SECRET_MIN && s.length <= WEBHOOK_SECRET_MAX
}

// ─── Podpis (OBLIKA — izračun je v webhook-sign.ts) ─────────────────────────

export const WEBHOOK_SIGNATURE_HEADER = 'x-roksal-signature'
export const WEBHOOK_TIMESTAMP_HEADER = 'x-roksal-timestamp'
export const WEBHOOK_EVENT_HEADER = 'x-roksal-event'
export const WEBHOOK_SIGNATURE_PREFIX = 'sha256='

/**
 * Sporočilo, ki ga podpisujemo: `${timestamp}.${body}` (telo = DOBESEDEN JSON
 * niz, kot gre po žici — partner podpiše iste bajte). Partner preveri:
 *   key = sha256_hex(lastnostna skrivnost)  // skrivnost NI shranjena pri ROKSAL
 *   expected = HMAC-SHA256(key, `${X-ROKSAL-Timestamp}.${rawBody}`)
 *   X-ROKSAL-Signature === 'sha256=' + expected
 */
export function webhookSignatureMessage (timestamp: string, body: string): string {
  return `${timestamp}.${body}`
}

/** Časovno okno preverjanja podpisa (replay zaščita — priporočilo partnerju). */
export const WEBHOOK_SIGNATURE_TOLERANCE_S = 300

// ─── Backoff dostave ────────────────────────────────────────────────────────

/** Največ poskusov dostave; po tem je vrstica DEAD (mrtvo pismo). */
export const WEBHOOK_MAX_ATTEMPTS = 5

/** Zamik naslednjega poskusa v minutah po (1., 2., 3., 4., 5.) poskusu. */
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 30, 30, 30] as const

/**
 * Zamik naslednjega poskusa po neuspelem poskusu `attempt` (1-based).
 * 1 → 1 min, 2 → 5 min, 3+ → 30 min; attempt ≥ WEBHOOK_MAX_ATTEMPTS → null
 * (klicnik označi DEAD — mrtvo pismo; več poskusov ni).
 */
export function deliveryBackoff (attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt >= WEBHOOK_MAX_ATTEMPTS) return null
  const idx = Math.max(0, Math.min(WEBHOOK_BACKOFF_MINUTES.length - 1, Math.trunc(attempt) - 1))
  return WEBHOOK_BACKOFF_MINUTES[idx]
}

/** Pomožnik: naslednji čas poskusa (epoch ms) ali null, če poskusov ni več. */
export function nextAttemptAt (attempt: number, from: Date = new Date()): Date | null {
  const minutes = deliveryBackoff(attempt)
  return minutes === null ? null : new Date(from.getTime() + minutes * 60_000)
}

// ─── publicWebhookPayload — VARNI podskup telesa dostave ────────────────────

/**
 * Dovoljena polja telesa webhook dostave (whitelist — vse ostalo se BRIŠE):
 * id (eventKey — partner deduplicira), type, createdAt, projectId? in data
 * { title, body, customerName? } — opisi so isti kot IN_APP obvestila.
 * IZKLJUČENO: customerEmail (naslovi strank gredo SAMO prek notify kanalov),
 * cene/marže/zaloga/interni ID-ji uporabnikov (§9 „ne obidi obsega projekta").
 */
export interface PublicWebhookPayload {
  id: string
  type: string
  createdAt: string
  projectId: string | null
  data: {
    title: string
    body: string
    customerName?: string
  }
}

/** Projekcija telesa dostave na varni podskup (whitelist, ne blacklist). */
export function publicWebhookPayload (input: {
  eventKey: string
  eventType: string
  occurredAt?: Date | string
  projectId?: string | null
  title?: string | null
  body?: string | null
  customerName?: string | null
}): PublicWebhookPayload {
  const iso = (d: Date | string | undefined): string =>
    d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : new Date().toISOString()
  const name = typeof input.customerName === 'string' && input.customerName.trim()
    ? input.customerName.trim().slice(0, 200)
    : undefined
  return {
    id: input.eventKey,
    type: input.eventType,
    createdAt: iso(input.occurredAt),
    projectId: input.projectId ?? null,
    data: {
      title: (input.title ?? '').slice(0, 300),
      body: (input.body ?? '').slice(0, 2000),
      ...(name ? { customerName: name } : {}),
    },
  }
}

/** Skrajšaj napako dostave (vzorec notify: 200 znakov). */
export function clampWebhookError (err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.slice(0, 200)
}

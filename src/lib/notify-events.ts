// notify-events — R438 (issue #5): client-safe katalog tipov obvestil.
// Čist konstantni modul (NIČ strežniških uvozov) — skupen vir za API (src/lib/notify.ts)
// in UI (profil.tsx nastavitve, varnost.tsx dnevnik dostav).

/** Tipi poslovnih dogodkov → obvestil (en dogodek = en vir resnice).
 *  R481 (issue #9 §9): +4 prehodi, ki jih webhook integracijska plast izrecno
 *  zahteva — zajem obdelan, model spremenjen, proizvodnja pripravljena,
 *  naročilo potrjeno (IN_APP obvestila + webhook dostava prek emitEvent). */
export const NOTIFICATION_EVENT_TYPES = [
  'WO_ASSIGNED',
  'WO_TERMIN',
  'WO_INSTRUCTIONS',
  'WO_COMPLETED',
  'PROJECT_STATUS',
  'MEASUREMENT_CONFIRMED',
  'QUOTE_SIGNED',
  'PAYMENT_RECEIVED',
  'PORTAL_PUBLISHED',
  'QC_NOK',
  'SURVEY_NEW',
  'VIZ_CHOICE',
  // R481 (issue #9 §9 — webhook dogodki):
  'CAPTURE_PROCESSED',
  'MODEL_CHANGED',
  'PRODUCTION_READY',
  'ORDER_CONFIRMED',
  // R489 (issue #12 — montaža QA):
  'MONTAZA_NOK',
] as const

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

/** Slovenski nazivi dogodkov (UI). */
export const NOTIFICATION_EVENT_LABELS: Record<string, string> = {
  WO_ASSIGNED: 'Dodelitev naloga',
  WO_TERMIN: 'Sprememba termina',
  WO_INSTRUCTIONS: 'Nova navodila',
  WO_COMPLETED: 'Zaključek terena',
  PROJECT_STATUS: 'Status projekta',
  MEASUREMENT_CONFIRMED: 'Potrditev meritve',
  QUOTE_SIGNED: 'Podpis ponudbe',
  PAYMENT_RECEIVED: 'Prejeto plačilo',
  PORTAL_PUBLISHED: 'Objava portala',
  QC_NOK: 'QC neustrezno',
  SURVEY_NEW: 'Novo povpraševanje',
  VIZ_CHOICE: 'Izbor stranke v vizualizatorju',
  // R481 (issue #9 §9 — webhook dogodki):
  CAPTURE_PROCESSED: 'Zajem obdelan',
  MODEL_CHANGED: 'Model spremenjen',
  PRODUCTION_READY: 'Proizvodnja pripravljena',
  ORDER_CONFIRMED: 'Naročilo potrjeno',
  MONTAZA_NOK: 'Kritična napaka na montaži',
}

/** Oznaka za '*' (privzeto za vse dogodke). */
export const NOTIFICATION_EVENT_ALL = '*'
export const NOTIFICATION_EVENT_ALL_LABEL = 'Vsi dogodki (privzeto)'

/** Kanali dostave. */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

/** Kanali, ki jih uporabnik lahko nastavi v profilu (WHATSAPP ostaja zunanji/adapter). */
export const NOTIFICATION_PREF_CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL', 'SMS']

/** Vrni slovensko oznavo dogodka (fallback = surova koda). */
export function notificationEventLabel (event: string): string {
  return event === NOTIFICATION_EVENT_ALL
    ? NOTIFICATION_EVENT_ALL_LABEL
    : NOTIFICATION_EVENT_LABELS[event] ?? event
}

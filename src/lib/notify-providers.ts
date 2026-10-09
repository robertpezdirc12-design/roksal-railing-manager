// notify-providers — R464 (GitHub issue #1, sklop 7): PRODUKCIJSKI NOTIFICATION
// ADAPTERJI. Adapter plast med poslovnim event modelom (emitEvent v notify.ts)
// in zunanjimi dostavnimi providerji.
//
// Načela:
//  • konfiguracija IZKLJUČNO prek okolja (process.env) — brez spremembe poslovnih
//    klicev emitEvent() in brez sprememb v bazi (schema je nespremenjena);
//  • IN_APP ostaja notranja dostava (vrstica v modelu Notification) — ni provider;
//  • PRIVZETO VEDENJE OHRANJENO (R438 kompatibilno): EMAIL = log adapter,
//    SMS/WHATSAPP = nekonfiguriran kanal ('kanal ni konfiguriran');
//  • prejemniki so v dostavi/dnevniku/auditu VEDNO prikriti (maskirani) —
//    `recipient` je maskiran naslov, `address` (realen cilj) gre SAMO providerju;
//  • provider NIKOLI ne sme vrniti izjeme — vedno { ok, error } odgovor;
//    poslovni tok ščiti že sendDelivery/emitEvent (ognjevaren ovoj).
//
// Okoljske spremenljivke (glej docs/notifications.md):
//  • NOTIFY_EMAIL_PROVIDER    = log (privzeto) | smtp | webhook | none
//  • NOTIFY_SMS_PROVIDER      = none (privzeto) | webhook | log
//  • NOTIFY_WHATSAPP_PROVIDER = none (privzeto) | webhook | log
//  • NOTIFY_WEBHOOK_URL       = URL, kamor webhook provider POST-a dostavo
//  • SMTP_HOST/PORT/USER/PASS/FROM = pripravljena konfiguracija SMTP stuba

// ─── Vtičnik providerja ──────────────────────────────────────────────────────

/** Kar provider potrebuje za eno dostavo (poslovno neodvisen vmesnik). */
export interface ProviderDelivery {
  /** Kanal, prek katerega dostava poteka (EMAIL | SMS | WHATSAPP). */
  channel: string
  /** MASKIRANI prejemnik — to je edina vrednost, ki se zapisuje v bazo/dnevnike. */
  recipient: string | null
  /** Dejanski dostavni naslov (EMAIL: realna e-pošta; SMS/WHATSAPP: null —
   *  telefonska številka ni del event modela, webhook jo razreši po referenci). */
  address: string | null
  /** Prejemnik-app uporabnik (za ločljivost v zunanjem sistemu), če obstaja. */
  userId: string | null
  title: string
  body: string
  /** Dedup ključ eventa ( sledljivost v zunanjem sistemu). */
  eventKey: string
  eventType: string
  customerName: string | null
}

/** Rezultat poskusa dostave pri providerju. */
export interface ProviderOutcome {
  ok: boolean
  /** Zunanji identifikator sporočila (dnevnik; v bazi ni stolpca — schema fiksna). */
  providerId?: string
  /** Človeku berljiva napaka (sekne na 200 znakov pri zapisu dostave). */
  error?: string
}

/** Vtičnik zunanjega dostavnega providerja (R464 adapter). */
export interface NotificationProvider {
  readonly name: string
  deliver (d: ProviderDelivery): Promise<ProviderOutcome>
}

// ─── LOG provider (privzeti za EMAIL — R438 vedenje) ────────────────────────

/** Log adapter: zapiše vrstico v strežniški dnevnik in uspešno zaključi. */
export const logProvider: NotificationProvider = {
  name: 'log',
  async deliver (d) {
    // R438 kompatibilna vrstica (isti format kot prej — ne razbij obstoječih dnevnikov)
    console.log(`[notify:${d.channel}] → ${d.recipient ?? '?'} · ${d.title}`)
    return { ok: true, providerId: 'log' }
  },
}

// ─── WEBHOOK provider (produkcija — global fetch, brez npm paketov) ─────────

/** HTTP POST na NOTIFY_WEBHOOK_URL (npr. mail/SMS servis ali Make/Zapier). */
export const webhookProvider: NotificationProvider = {
  name: 'webhook',
  async deliver (d) {
    const url = (process.env.NOTIFY_WEBHOOK_URL ?? '').trim()
    if (!url) {
      return { ok: false, error: 'webhook provider: manjka NOTIFY_WEBHOOK_URL' }
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: d.channel,
          // pozor: `address` je REALNI dostavni cilj — namenjen SAMO zunanjemu
          // dostavnemu servisu; v dnevnik/bazo gre izključno maskirani `recipient`
          address: d.address,
          recipient: d.recipient,
          customerName: d.customerName,
          userId: d.userId,
          title: d.title,
          body: d.body,
          eventKey: d.eventKey,
          eventType: d.eventType,
        }),
        signal: AbortSignal.timeout(10_000), // produkcija: brez večnega visečih dostav
      })
      if (!res.ok) {
        return { ok: false, error: `webhook HTTP ${res.status} (${url})` }
      }
      return { ok: true, providerId: res.headers.get('x-provider-id') ?? 'webhook' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `webhook (${url}): ${message}` }
    }
  },
}

// ─── SMTP stub (dokumentiran, pripravljen — brez npm paketov) ───────────────

/**
 * SMTP provider je PRIPRAVLJEN STUB: konfiguracija (SMTP_*) se preveri, samo
 * transport ni implementiran, ker surovi SMTP/TLS prek Node socketov brez
 * npm paketa (npr. nodemailer) ni produkcijsko odgovoren. Vrnete jasno napako:
 * dostava FAILED z razlogom, job obvestila-retry jo poskusi znova, ko bo
 * pravi transport vstavljen. Za produkcijo uporabite NOTIFY_*_PROVIDER=webhook
 * in SMTP prek zunanjega HTTP servisa.
 */
export const smtpStubProvider: NotificationProvider = {
  name: 'smtp',
  async deliver () {
    const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']
      .filter((v) => !(process.env[v] ?? '').trim())
    if (missing.length > 0) {
      return { ok: false, error: `SMTP ni konfiguriran (manjka: ${missing.join(', ')})` }
    }
    return {
      ok: false,
      error: 'SMTP transport stub: pošiljanje ni implementirano brez npm paketa (pripravljeno za vstavitev nodemailerja) — uporabite webhook provider',
    }
  },
}

// ─── Registr providerjev (konfiguracija prek okolja) ─────────────────────────

/** Veljavne vrednosti NOTIFY_*_PROVIDER (dokumentacija/validacija). */
export const PROVIDER_KINDS = ['none', 'log', 'smtp', 'webhook'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/** Ime okoljske spremenljivke za kanal (null = kanal nima zunanjega providerja). */
export function providerEnvName (channel: string): string | null {
  switch (channel) {
    case 'EMAIL': return 'NOTIFY_EMAIL_PROVIDER'
    case 'SMS': return 'NOTIFY_SMS_PROVIDER'
    case 'WHATSAPP': return 'NOTIFY_WHATSAPP_PROVIDER'
    default: return null
  }
}

/**
 * Poišče provider za kanal glede na okolje.
 *  • EMAIL brez nastavitve → logProvider (privzeto, R438: log adapter);
 *  • SMS/WHATSAPP brez nastavitve ali 'none' → null (kanal ni konfiguriran);
 *  • 'smtp' smemo izbrati samo za EMAIL (telefon po SMTP nima smisla);
 *  • neznana vrednost → privzeti provider + opozorilo v dnevnik
 *    (napaka v konfiguraciji NE sme ustaviti dostav).
 */
export function resolveProvider (channel: string): NotificationProvider | null {
  const envName = providerEnvName(channel)
  if (envName === null) return null
  const kind = (process.env[envName] ?? '').trim().toLowerCase()
  const fallback = channel === 'EMAIL' ? logProvider : null
  switch (kind) {
    case '':
    case 'log':
      return fallback === null ? null : logProvider
    case 'none':
      return null
    case 'webhook':
      return webhookProvider
    case 'smtp':
      if (channel !== 'EMAIL') return fallback
      return smtpStubProvider
    default:
      console.warn(`[notify] neznana vrednost ${envName}='${kind}' — kanal ${channel} uporablja privzetega providerja`)
      return fallback
  }
}

/** Ali je za kanal konfiguriran zunanji provider (EMAIL: vedno — log privzeto). */
export function providerConfigured (channel: string): boolean {
  return resolveProvider(channel) !== null
}

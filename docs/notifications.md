# Obvestila — produkcijska konfiguracija kanalov (R464, GitHub issue #1 sklop 7)

## Arhitektura

```
poslovni klic (nalog, termin, plačilo, …)
        │
        ▼
emitEvent()                      src/lib/notify.ts        (NI SE SPREMENIL)
  • dedup po ključu (key @unique)
  • prefs po uporabniku (IN_APP/EMAIL/SMS)
  • IN_APP → vrstica v modelu Notification (zvonec app-shell)
  • ognjevaren: napake se ZABELEŽIJO, poslovni tok se nadaljuje (200/201)
        │
        ▼  zunanji kanali (EMAIL / SMS / WHATSAPP)
sendDelivery()                   src/lib/notify.ts
  • dostava (NotificationDelivery) PENDING → poskus → SENT / FAILED
  • neuspeh → FAILED + razlog (sekano na 200 znakov), retry prek joba
        │
        ▼
resolveProvider(channel)        src/lib/notify-providers.ts   ← NOVO (R464)
  • provider iz process.env — brez spremembe poslovnih klicev
  • privzeto: EMAIL = log, SMS/WHATSAPP = nekonfiguriran
        │
        ▼
NotificationProvider.deliver() → { ok, providerId?, error? }
```

## Okoljske spremenljivke

| Spremenljivka | Vrednosti | Privzeto | Opis |
|---|---|---|---|
| `NOTIFY_EMAIL_PROVIDER` | `log` \| `smtp` \| `webhook` \| `none` | `log` | e-pošta: log adapter (R438), SMTP stub ali webhook |
| `NOTIFY_SMS_PROVIDER` | `none` \| `webhook` \| `log` | `none` | SMS za zunanje prejemnike (stranke) |
| `NOTIFY_WHATSAPP_PROVIDER` | `none` \| `webhook` \| `log` | `none` | WhatsApp za zunanje prejemnike |
| `NOTIFY_WEBHOOK_URL` | URL | — | kamor `webhook` provider POST-a dostavo |
| `SMTP_HOST` … `SMTP_FROM` | glej spodaj | — | konfiguracija SMTP stuba |

- **neznan kanal** (npr. tiskalnik) → obstoječe vedenje: napaka `kanal ni konfiguriran` (dostava FAILED), poslovni tok se nadaljuje;
- **neznana vrednost** env spremenljivke → opozorilo v dnevnik + privzeti provider (napaka v konfiguraciji ne ustavi dostav);
- `none` vedno pomeni »kanal ni konfiguriran« (SMS/WHATSAPP dostave strank ostanejo SKIPPED z razlogom).

## Providerji

### `log` (privzeti za EMAIL — R438 kompatibilno)
Zapiše vrstico `[notify:EMAIL] → i***@domena · Naslov` v strežniški dnevnik in
označi dostavo SENT. Uporabno za razvoj in preglede.

### `webhook` (produkcija — priporočena pot)
`POST NOTIFY_WEBHOOK_URL` z JSON telesom (global `fetch`, timeout 10 s, brez npm
paketov). HTTP 2xx = SENT, drugače FAILED s razlogom (npr. `webhook HTTP 502`).
Primerno za SendGrid/Mailgun/Twilio prek preprostega proxyja ali Make/Zapier.

Telo zahtevka:

```json
{
  "channel": "EMAIL",
  "address": "ivan.zajc@gmail.com",
  "recipient": "i***@gmail.com",
  "customerName": "Ivan Zajc",
  "userId": null,
  "title": "Sprememba termina",
  "body": "WO-2026-001 — montaža · nov termin: 15. 11. 2026",
  "eventKey": "wo-termin:cmp…:2026-11-15T08:00:00.000Z",
  "eventType": "WO_TERMIN"
}
```

> `address` je REALNI dostavni cilj in gre **samo** zunanjemu providerju — v
> bazo, dnevnik in API (`recipient`) se zapisuje izključno maskirani naslov
> (`i***@gmail.com`). Za SMS/WHATSAPP je `address` null (telefonska številka ni
> del event modela — webhook jo razreši po `customerName`/`eventKey` v CRM).

Odgovor lahko vrne glavo `x-provider-id` — zapiše se v strežniški dnevnik
(dostavna tabela po R464 ne dodaja stolpcev; schema je nespremenjena).

### `smtp` (dokumentiran stub)
Pripravljena konfiguracija (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_FROM`). Transport **ni implementiran** — surovi SMTP/TLS brez npm paketa
(npr. nodemailer) ni produkcijsko odgovoren, zato stub vrne jasno napako:
`SMTP ni konfiguriran (manjka: SMTP_HOST, …)` oz.
`SMTP transport stub: pošiljanje ni implementirano …`.
Dostava FAILED → job `obvestila-retry` poskusi znova, ko bo pravi transport
vstavljen. Za produkcijo uporabite `webhook`.

## Varnost in odpovedi

- **ognjevaren poslovni tok** — neuspešna dostava NIKOLI ne podre API klica,
  ki je sprožil dogodek (emitEvent je ovit v try/catch);
- **retry je varen** — dedup po `key` (dogodki) + `@@unique([eventId, channel,
  userId])` (dostave) + `attempts < 3` (job `obvestila-retry` vsakih 15 min);
- **maskirani prejemniki** — celoten e-poštni naslov/telefon nikoli ne zapusti
  strežnika v dnevnikih, dostavah ali auditu (samo provider prejme `address`);
- **prefs spoštovani neodvisno od providerja** — izklopljeno v nastavitvah →
  dostava SKIPPED (`izklopljeno v nastavitvah`), tudi če je provider aktiven.

## Testi

- `tests/r438.sh` — R438 regresija (privzeti log/none adapterji);
- `tests/r464-notifications.py` — adapter plast: privzeto vedenje, webhook
  uspeh (lokalni sprejemnik), neuspeh/SMTP stub + retry, dedup, prefs opt-out.

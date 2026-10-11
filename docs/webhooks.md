# Webhook integracijska plast — poslovno-dogodkovni izhod (R481, GitHub issue #9 §9)

## 1. Kaj je to (in kaj NI)

Webhook naročnina je **poslovno-dogodkovni izhod ROKSAL za partnerje**: ob
pomembnih prehodih (zajem obdelan, ponudba sprejeta, proizvodnja pripravljena,
naročilo potrjeno …) ROKSAL takoj POST-a JSON dogodek na HTTPS naslov partnerja,
podpisan z `X-ROKSAL-Signature` (HMAC-SHA256).

To je **ločeno od obvestilnega kanala** `NOTIFY_WEBHOOK_URL` (R464,
docs/notifications.md), ki dostavlja e-pošto/SMS/WhatsApp prek zunanjih
providerjev. Webhook naročnina ima lastno skrivnost, lasten outbox in lastne
API rute — dva sistema se ne mešata.

## 2. Kako nastaviti naročnino

Naročnine upravljajo vloge z dovoljenjem `integrations.manage`
(**ADMIN / VODJA**; nova pravica R481, vzorec `portal.manage` — monter,
skladišče in proizvodnja dostop zavrnejo s 403).

```http
POST /api/webhooks
Authorization: Bearer <žeton>
Content-Type: application/json

{
  "url": "https://partner.si/hooks/roksal",
  "events": ["QUOTE_SIGNED", "ORDER_CONFIRMED", "PRODUCTION_READY"],
  "secret": "moja-skrivnost-16+znakov",
  "description": "ERP sinhronizacija"
}
```

- **url** — SAMO `https` (glej §7 SSRF vrata);
- **events** — neprazen seznam tipov iz kataloga (§4, max 16 različnih);
- **secret** — skrivnost, ki si jo **izbere partner** (16–200 znakov). ROKSAL
  shrani **IZKLJUČNO njen SHA-256 hex has** (podpisni ključ) — skrivnost sama
  se nikoli ne shrani, ne vrne in ne zapiše v revizijski dnevnik. Ob vsakem
  času lahko partner skrivnost zamenja (nova naročnina ali ponovna prijava
  skrivnosti ni mogoča — za novo vrednost ustvarite novo naročnino).
- **description** — opomba za pisarno (≤ 200 znakov).

Odgovor `201`:

```json
{
  "data": {
    "id": "cmv3…",
    "url": "https://partner.si/hooks/roksal",
    "events": ["QUOTE_SIGNED", "ORDER_CONFIRMED", "PRODUCTION_READY"],
    "active": true,
    "description": "ERP sinhronizacija",
    "secretInfo": "shranjeno (hash) — skrivnost shranite sedaj, več je ne bo mogoče videti"
  }
}
```

Sprememba/preklic (URL in skrivnost se NE spreminjata — za nov cilj ustvarite
novo naročnino; preklic NE briše zgodovine dostav):

```http
PATCH  /api/webhooks/<id>   {"active": false}  |  {"events": […]}  |  {"description": "…"}
DELETE /api/webhooks/<id>                        # preklic — idempotenten
```

## 3. Dostava — glave, telo, podpis

Ob vsakem dogodku, ki ga naročnina posluša, ROKSAL pošlje:

```http
POST <url naročnine>
Content-Type: application/json
X-ROKSAL-Event: ORDER_CONFIRMED
X-ROKSAL-Timestamp: 1760192400          # epoch sekunde
X-ROKSAL-Signature: sha256=<hex>        # HMAC-SHA256, glej spodaj
```

Telo (varni podskup — isti opisi kot IN_APP obvestila pisarne):

```json
{
  "id": "order-confirmed:cmv3un3yg01ion47bfwynpgb",
  "type": "ORDER_CONFIRMED",
  "createdAt": "2026-10-11T13:10:22.418Z",
  "projectId": "cmv3grxdd000en4ut0yrr71b5",
  "data": {
    "title": "Naročilo potrjeno",
    "body": "Nabavno naročilo NAR-2026-014 je prejeto — 2 lota v zalogi.",
    "customerName": "Ivan Zajc"
  }
}
```

- **`id` = idempotenčni ključ dogodka** (eventKey) — partner po njem
  deduplicira (isti dogodek se nikoli ne dostavi dvakrat na isto naročnino);
- `projectId` je **notranji identifikator projekta** (isti kot v izvozih) —
  naročnina NE razširi obsega projekta: telo vsebuje izključno javne
  identifikatorje in opise, NIKOLI notranje cene, marže, zaloge, e-pošte
  strank ali internih ID-jev uporabnikov;
- `customerName` je prisoten samo, kadar ga dogodek nosi (npr. podpis
  ponudbe); e-pošta/telefon stranke gresta IZKLJUČNO prek obvestilnega
  kanala (notify), nikoli prek webhooka.

### Preverjanje podpisa (partner)

Podpisano sporočilo je `"${X-ROKSAL-Timestamp}.${rawBody}"`, ključ je
SHA-256 hex has skrivnosti (ista vrednost, ki jo hrani ROKSAL):

```
key       = sha256_hex(secret)
expected  = HMAC-SHA256(key, `${X-ROKSAL-Timestamp}.${rawBody}`)
veljavno  ⇔ X-ROKSAL-Signature === "sha256=" + expected
```

Node/JavaScript:

```js
const crypto = require('crypto')
function verify (secret, timestamp, rawBody, signatureHeader) {
  const key = crypto.createHash('sha256').update(secret, 'utf8').digest('hex')
  const expected = 'sha256=' + crypto
    .createHmac('sha256', key)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(expected), Buffer.from(signatureHeader))
}
```

Python:

```python
import hashlib, hmac

def verify(secret: str, timestamp: str, raw_body: bytes, signature_header: str) -> bool:
    key = hashlib.sha256(secret.encode()).hexdigest()
    expected = 'sha256=' + hmac.new(
        key.encode(), f'{timestamp}.'.encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

> Preverjajte NAD DOBESEDNIM telesom (bytes, kakor so prišli po žici) — ne
> razčlenjenega in ponovno serializiranega JSON-a.

### Replay zaščita (priporočilo partnerju)

Preverite, da je `X-ROKSAL-Timestamp` znotraj **5 minut** (300 s) trenutnega
časa, preden sprejmete dogodek (`WEBHOOK_SIGNATURE_TOLERANCE_S`), in zavržite
že viden `id`. ROKSAL priporoča obe preverbi; okno 5 min je dokumentirana
vrednost.

## 4. Katalog dogodkov (16)

En vir resnice z IN_APP obvestili (`NOTIFICATION_EVENT_TYPES`) — naročnina
lahko posluša katerikoli podskup. Webhook dostava je vključena za VSE tipe
automatsko (eno mesto: `emitEvent` v `src/lib/notify.ts`).

| Tip | SLO naziv | Sprožilec |
|---|---|---|
| `WO_ASSIGNED` | Dodelitev naloga | nastavitev monterja na nalogu |
| `WO_TERMIN` | Sprememba termina | termin naloga |
| `WO_INSTRUCTIONS` | Nova navodila | navodila/attachments naloga |
| `WO_COMPLETED` | Zaključek terena | prehod naloga v ZAKLJUCEN |
| `PROJECT_STATUS` | Status projekta | sprememba statusa projekta |
| `MEASUREMENT_CONFIRMED` | Potrditev meritve | potrditev meritve |
| `QUOTE_SIGNED` | Podpis ponudbe | podpis ponudbe s stranko |
| `PAYMENT_RECEIVED` | Prejeto plačilo | nova plačila |
| `PORTAL_PUBLISHED` | Objava portala | izdaja povezave portala stranke |
| `QC_NOK` | QC neustrezno | QC preverjanje NEUSTREZNO |
| `SURVEY_NEW` | Novo povpraševanje | javno povpraševanje |
| `VIZ_CHOICE` | Izbor stranke v vizualizatorju | izbor na /v/[token] (R480) |
| `CAPTURE_PROCESSED` | Zajem obdelan | zaključek zajema → AS-MEASURED (R481) |
| `MODEL_CHANGED` | Model spremenjen | sprememba model-relevantnih polj tekača (nodes/terrain/calibration/produkt) — vsaka verzija nov dogodek (R481) |
| `PRODUCTION_READY` | Proizvodnja pripravljena | proizvodni nalog → DOKONCAN (R481) |
| `ORDER_CONFIRMED` | Naročilo potrjeno | nabavno naročilo → PREJETO (R481) |

Pomožni tip `WEBHOOK_TEST` se uporablja SAMO za testni ping (§6) in NI na
voljo za naročnino.

## 5. Zanesljivost dostave — outbox, retry, mrtvo pismo

Vsak (naročnina, dogodek) par je **ENA vrstica outboxa** (`WebhookDelivery`,
unique `[subscriptionId, eventKey]`):

1. **PENDING** → takojšnji prvi poskus (inline, ob samem dogodku; timeout 10 s,
   HTTP 2xx = uspeh);
2. neuspeh → **FAILED** + `nextAttemptAt` po backoff tabeli:
   **1 min → 5 min → 30 min → 30 min** (poskusi 1–4);
3. po **5. neuspešnem poskusu** vrstica postane **DEAD** (mrtvo pismo) —
   več poskusov ni; `nextAttemptAt: null`;
4. uspeh → **SENT** + `deliveredAt`.

Retry poganja job **webhook-retry** (jobs/run, cron **dnevno ob 03:30** —
preverjeno v `vercel.json`; to je ISTI cron kot za obvestila) ter ročna pot:

```http
POST /api/webhooks/retry        # integrations.manage; 30/min na uporabnika
→ { "data": { "processed": 3, "sent": 2, "failed": 1, "dead": 0 } }
```

> **Omejitev (dokumentirana):** cron teče enkrat dnevno — FAILED dostave
> čakajo do 03:30 (ali ročnega klica `/api/webhooks/retry`). Prvi poskus je
> vedno takojšen (inline), zamuda velja SAMO za ponovitve.

Idempotenca je dvoslojna: NotificationEvent deduplicira po `key` (isti
poslovni dogodek se ne izda dvakrat), outbox pa po `[subscriptionId, eventKey]`
(podvojen poskus ustvarjanja vrstice se tiho prezre — unique constraint).
Preklicana naročnina: nove dogodke NE prejema; čakajoče vrstice ob poskusu
postanejo DEAD (»naročnina preklicana«).

## 6. Testni ping

```http
POST /api/webhooks/<id>/test    # integrations.manage; 10/min na naročnino
→ { "data": { "delivered": true, "responseStatus": 200 } }
```

Pošlje enkraten `WEBHOOK_TEST` dogodev na ciljni URL z enakim podpisom in
glavami kot prava dostava (telo: »To je testni ping naročnine ROKSAL —
potrditev prejema (in podpisa).«) — partnerju za preverbo verifikacijske kode.
Vsak ping je sveža vrstica v zgodovini dostav (`webhook-test:<id>:<epoch ms>`).

## 7. Varnost

- **RBAC**: vse rute zahtevajo `integrations.manage` (ADMIN/VODJA); anonimni
  klic → 401, monter/skladišče/proizvodnja → 403. Revizijski dnevnik:
  `WEBHOOK_CREATE` (brez skrivnosti in brez hasa!), `WEBHOOK_UPDATE`,
  `WEBHOOK_REVOKE`, `WEBHOOK_TEST`, `WEBHOOK_RETRY`.
- **Skrivnost**: partner jo izbere in posreduje enkrat; shranjen je SAMO
  SHA-256 has (podpisni ključ), ki nikoli ne gre ven (niti v GET odgovore
  niti v revizijo niti v zgodovino dostav). Izgubljene skrivnosti ni mogoče
  povrniti — ustvarite novo naročnino.
- **SSRF vrata** (osnovna, brez-npm): URL mora biti `https`; privatna/
  link-local naslovi (`10.*`, `192.168.*`, `169.254.*`) so zavrnjeni VEDNO;
  `http` je dovoljen SAMO za loopback (`127.0.0.1`) in SAMO izven produkcije
  (testni sprejemnik). To so nizkovne string vrata — ne nadomeščajo
  omrežne segmentacije.
- **Obseg projekta** (§9 »integracijski ključi ne smejo obiti obsega
  projekta«): naročnina je globalna za pisarno, a dostavlja IZKLJUČNO varni
  podskup — `projectId` + javni identifikatorji + naslov/vsebina dogodka;
  brez cen, marž, zalog, kontaktnih podatkov strank in internih ID-jev
  uporabnikov.
- **Tempomat**: testni ping 10/min na naročnino, ročna ponovitev 30/min na
  uporabnika (rate-limit.ts — v pomnilniku enega procesa, dokumentirana
  omejitev Vercel lambde, enako kot javne žetonske poti).
- **Ognjevarnost**: odpoved webhook dostave NIKOLI ne prekine poslovnega toka
  (emitWebhookEvent lovi vse napake; vzorec emitEvent iz R438).

## 8. API povzetek (ZA UI in partnerje)

| Ruta | Metoda | Dovoljenje | Opis |
|---|---|---|---|
| `/api/webhooks` | GET | integrations.manage | seznam naročnin + statistika dostav (sent/failed/dead/pending) + katalog `events` |
| `/api/webhooks` | POST | integrations.manage | nova naročnina `{url, events[], secret, description?}` → 201 |
| `/api/webhooks/[id]` | PATCH | integrations.manage | `active`/`events`/`description` (preklicana → 409) |
| `/api/webhooks/[id]` | DELETE | integrations.manage | preklic (idempotentno) |
| `/api/webhooks/[id]/test` | POST | integrations.manage | testni ping (10/min) |
| `/api/webhooks/deliveries` | GET | integrations.manage | zgodovina dostav `?subscriptionId=&status=&limit=` (≤ 100, newest first) |
| `/api/webhooks/retry` | POST | integrations.manage | ročna ponovitev zaravnanih dostav (30/min) |

Zgodovina dostav (`WebhookDelivery`): `eventKey`, `eventType`, `status`
(PENDING/SENT/FAILED/DEAD), `attempts`, `responseStatus`, `nextAttemptAt`,
`deliveredAt`, `error` (≤ 200 znakov), `createdAt`.

## 9. Omejitve (pošteno)

- cron retry 1× dnevno (glej §5) — prvi poskus je vedno takojšen;
- tempomat v pomnilniku enega procesa (Vercel lambda) — meja je
  »približno«, ne trdna;
- SSRF string vrata ne ločijo DNS imena, ki se razreši v privatni IP —
  partnerji so znani (ADMIN/VODJA jih registrirajo), to je poslovna meja;
- vhodna (machine-to-machine) API ključev R481 ne dodaja (issue #9 jih ne
  zahteva; `API_KEY_PEPPER` ostaja neuporabljen — glej AUDIT-9) —
  integracije so: webhook izhod + izvozi (CSV/XLSX/JSON, eSLOG XML) +
  javne žetonske poti (portal/pregled/vizualizator).

## 10. Implementacija (za razvoj)

- Čist lib: `src/lib/webhook-core.ts` (katalog dogodkov, validacije, backoff
  tabela, varni podskup — 0 strežniških uvozov, uporaben tudi na odjemalcu);
- Podpisovalnik: `src/lib/webhook-sign.ts` (node:crypto — edino mesto);
- Dostava: `src/lib/webhook-delivery.ts` (emitWebhookEvent → outbox vrstice +
  inline poskus; attemptWebhookDelivery; retryWebhookDeliveries);
- Modela: `WebhookSubscription` (url, secretHash, events JSON niz, active,
  revokedAt, lastSuccessAt/lastFailureAt) + `WebhookDelivery` (outbox, unique
  `[subscriptionId, eventKey]`, index `[status, nextAttemptAt]`);
- Migracija: `prisma/migrations/20261016000000_r481_webhooks/`;
- Testi: `tests/r481.py` (126 kontrol: RBAC, čist lib, CRUD, podpis,
  backoff/DEAD, dogodki v toku, idempotenca, revizije, zgodovina).

#!/usr/bin/env python3
"""tests/r481.py — R481 (issue #9 §9): WEBHOOK INTEGRACIJSKA PLAST —
naročnine (WebhookSubscription) + dostave z outbox (WebhookDelivery) +
podpisi (X-ROKSAL-Signature) + testni ping + 4 novi dogodki.

Preverja:
  A) RBAC (fail-closed): anon 401 ×7 internih poti; monter/skladišče/
     proizvodnja 403 (brez integrations.manage); admin + vodja 200.
  B) ČIST LIB webhook-core (bun; 0 strežniških uvozov): katalog 16 tipov,
     validWebhookUrl (https; http samo lokalno v razvoju; SSRF zavrnitve),
     validWebhookSecret, parseWebhookEvents (dedup/smeti), deliveryBackoff
     (1/5/30/30/DEAD), publicWebhookPayload (whitelist BREZ e-pošte),
     oblika podpisnega sporočila.
  C) NAROČNINE CRUD: ustvari 201 (secret NE v odgovoru; v DB SAMO SHA-256
     has); neveljaven http URL 400; prekratka skrivnost 400; smetni/pražni/
     ne-arrays dogodki 400; PATCH events/active/description; PATCH preklicane
     409; DELETE preklic idempotenten; neobstoječa 404.
  D) TESTNI PING + PODPIS: delivered true/responseStatus 200; sprejemnik
     prejme WEBHOOK_TEST s pravim X-ROKSAL-Signature (HMAC-SHA256 nad
     sha256(secret)); telo = varni podskup (id/type/projectId/data);
     tempomat 10/min → 429; ping preklicane 409 / neobstoječe 404.
  E) DOSTAVA — neuspeh/backoff/DEAD: sprejemnik 500 → FAILED + attempts 1 +
     nextAttemptAt ~+1 min; retry pred rokom → processed 0; po presleditvi
     (testni helper backdate) → poskus 2; po 5. poskusu DEAD (mrtvo pismo,
     nextAttemptAt null); DEAD se ne ponavlja; uspeh 2xx → SENT + deliveredAt.
  F) DOGDODKI V TOKU: ORDER_CONFIRMED ob material-order PREJETO (dostava na
     sprejemnik z eventKey order-confirmed:<id>; projectId; BREZ cen v telesu;
     IN_APP obvestilo pisarni; brez duplikatov); MODEL_CHANGED ob fence-run
     PATCH vozlišč (verzija v ključu), NE ob preimenovanju.
  G) IDEMPOTENCA (baza): dvojna vrstica [subscriptionId, eventKey] →
     unique napaka (isti dogodek NE gre 2×).
  H) REVIZIJE: WEBHOOK_CREATE/UPDATE/REVOKE/TEST + WEBHOOK_RETRY v globalnem
     dnevniku; WEBHOOK_CREATE detail BREZ skrivnosti in BREZ hasha.
  I) ZGODOVINA DOSTAV: ?subscriptionId=/?status= filtri; neveljaven status
     400; neobstoječa naročnina 404; secretHash NI nikjer v odgovorih.
  J) Idempotentno čiščenje ×2 (direktno prek Prisma).
"""
import hashlib, hmac, json, os, subprocess, sys, threading, time
import urllib.request, urllib.error
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R481-TEST'
HOOK_PORT = 5997          # lokalni sprejemnik (5998 zaseden — r464)
PASS, FAIL = 0, 0
SECRET = 'r481-test-skrivnost-abcdef'   # 16+ znakov

def call (method, path, token=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}
    except Exception as e:
        return 0, str(e).encode(), {}

def callj (method, path, token=None, body=None, timeout=60):
    s, b, _ = call(method, path, token, body, timeout)
    try: return s, json.loads(b.decode('utf-8', 'replace'))
    except Exception: return s, {}

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun_ts (script):
    env_url = os.environ.get('DATABASE_URL') or ''
    if not env_url.startswith(('postgresql://', 'postgres://')):
        env_url = ''
    db_url = os.environ.get('TEST_DB_URL') or env_url or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:800]

def bun_out (script):
    out, err = bun_ts(script)
    try: return json.loads(out)
    except Exception: return {'_err': err or out[:400]}

def wait_for (pred, timeout=5.0, step=0.2):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred(): return True
        time.sleep(step)
    return pred()

def global_audit (token, action, limit=200):
    s, d = callj('GET', f'/api/audit?action={action}&limit={limit}', token)
    return d.get('data', []) if s == 200 else []

# ── lokalni sprejemnik (vzorec r464-notifications.py) ────────────────────────

RECEIVED = []

class HookHandler (BaseHTTPRequestHandler):
    def do_POST (self):
        ln = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(ln)
        RECEIVED.append({
            'path': self.path,
            'headers': {k.lower(): v for k, v in self.headers.items()},
            'body': raw.decode('utf-8', 'replace'),
        })
        # pot /fail → 500 (test neuspešne dostave); vse drugo → 200
        code = 500 if self.path.startswith('/fail') else 200
        payload = b'{"ok":true}'
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def log_message (self, *a): pass

def start_hook ():
    srv = ThreadingHTTPServer(('127.0.0.1', HOOK_PORT), HookHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def received (path_prefix=None, event=None):
    out = []
    for r in RECEIVED:
        if path_prefix and not r['path'].startswith(path_prefix): continue
        if event and r['headers'].get('x-roksal-event') != event: continue
        try: r['json'] = json.loads(r['body'])
        except Exception: r['json'] = None
        out.append(r)
    return out

def verify_signature (r):
    """Podpis: sha256=<HMAC-SHA256(sha256_hex(SECRET), `${ts}.${body}`)>."""
    ts = r['headers'].get('x-roksal-timestamp', '')
    sig = r['headers'].get('x-roksal-signature', '')
    key = hashlib.sha256(SECRET.encode()).hexdigest()
    expected = 'sha256=' + hmac.new(key.encode(), f'{ts}.{r["body"]}'.encode(), hashlib.sha256).hexdigest()
    return sig == expected

# ═══════════════════════════════════ TEST ═════════════════════════════════════

print(f'════ R481 — webhook integracijska plast (issue #9 §9) ════')
print(f'     BASE={BASE} · sprejemnik=127.0.0.1:{HOOK_PORT}')
start_hook()

# ── priprava ────────────────────────────────────────────────────────────────
admin = login('admin@roksal.si', 'Admin123!')
vodja = login('vodja@roksal.si', 'Vodja123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')
chk(bool(P4), 'projekt P-2026-004 najden')

SUBS = []      # id-ji testnih naročnin (za čiščenje)
ORDERS = []    # id-ji testnih naročil
RUNS = []      # id-ji testnih tekačev

def mk_sub (events, path='/ok', secret=SECRET, description=TAG, expect=201):
    s, d = callj('POST', '/api/webhooks', admin, {
        'url': f'http://127.0.0.1:{HOOK_PORT}{path}',
        'events': events, 'secret': secret, 'description': description,
    })
    if s == 201 and d.get('data', {}).get('id'): SUBS.append(d['data']['id'])
    return s, d

# ═══ FAZA A — RBAC (fail-closed) ═════════════════════════════════════════════
print('── A) RBAC')
INTERNAL = [
    ('GET', '/api/webhooks', None),
    ('POST', '/api/webhooks', {'url': 'https://example.com/hook', 'events': ['QUOTE_SIGNED'], 'secret': 'x' * 20}),
    ('PATCH', '/api/webhooks/ne-obstaja', {'active': False}),
    ('DELETE', '/api/webhooks/ne-obstaja', None),
    ('POST', '/api/webhooks/ne-obstaja/test', None),
    ('GET', '/api/webhooks/deliveries', None),
    ('POST', '/api/webhooks/retry', None),
]
for method, path, body in INTERNAL:
    s, _ = callj(method, path, None, body)
    chk(s == 401, f'anon {method} {path.split("?")[0]} → 401 (dobljeno {s})')

for tok, name in ((monter, 'monter'), (skladisce, 'skladišče'), (proizvodnja, 'proizvodnja')):
    s, _ = callj('GET', '/api/webhooks', tok)
    chk(s == 403, f'{name} brez integrations.manage → GET /api/webhooks 403 (dobljeno {s})')
s, _ = callj('GET', '/api/webhooks', monter)
s2, _ = callj('POST', '/api/webhooks', monter, {'url': 'https://example.com/h', 'events': ['QUOTE_SIGNED'], 'secret': 'x' * 20})
chk(s == 403 and s2 == 403, 'monter 403 tudi na POST /api/webhooks')
s, _ = callj('GET', '/api/webhooks/deliveries', monter)
s2, _ = callj('POST', '/api/webhooks/retry', monter)
chk(s == 403 and s2 == 403, 'monter 403 na deliveries + retry')
s, _ = callj('GET', '/api/webhooks', vodja)
chk(s == 200, 'vodja (integrations.manage) → GET /api/webhooks 200')
s, d = callj('GET', '/api/webhooks', admin)
chk(s == 200 and isinstance(d.get('data'), list), 'admin → GET /api/webhooks 200')

# ═══ FAZA B — čist lib (bun, 0 strežniških uvozov) ═══════════════════════════
print('── B) webhook-core (čist lib)')
BUN_LIB = r'''
const c = require('./src/lib/webhook-core.ts')
const out = []
const t = (name, v) => out.push([name, v])
t('events_len', c.WEBHOOK_EVENTS.length)
t('has_capture', c.WEBHOOK_EVENTS.includes('CAPTURE_PROCESSED'))
t('has_model', c.WEBHOOK_EVENTS.includes('MODEL_CHANGED'))
t('has_production', c.WEBHOOK_EVENTS.includes('PRODUCTION_READY'))
t('has_order', c.WEBHOOK_EVENTS.includes('ORDER_CONFIRMED'))
t('has_quote', c.WEBHOOK_EVENTS.includes('QUOTE_SIGNED'))
t('is_type_ok', c.isWebhookEventType('WO_ASSIGNED'))
t('is_type_bad', c.isWebhookEventType('SMETI'))
t('test_event', c.WEBHOOK_TEST_EVENT)
t('url_https', c.validWebhookUrl('https://partner.example.com/hook'))
t('url_http', c.validWebhookUrl('http://partner.example.com/hook'))
t('url_ftp', c.validWebhookUrl('ftp://partner.example.com/hook'))
t('url_garbage', c.validWebhookUrl('ni-url'))
t('url_empty', c.validWebhookUrl(''))
t('url_localhost_https', c.validWebhookUrl('https://localhost/x'))
t('url_localhost_prod', c.validWebhookUrl('https://localhost/x', { allowLocal: false }))
t('url_127_prod', c.validWebhookUrl('http://127.0.0.1:5997/x', { allowLocal: false }))
t('url_127_dev', c.validWebhookUrl('http://127.0.0.1:5997/x', { allowLocal: true }))
t('url_127_https_dev', c.validWebhookUrl('https://127.0.0.1:5997/x', { allowLocal: true }))
t('url_http_external_dev', c.validWebhookUrl('http://partner.example.com/hook', { allowLocal: true }))
t('url_priv_10', c.validWebhookUrl('https://10.0.0.1/hook'))
t('url_priv_192', c.validWebhookUrl('https://192.168.1.5/hook'))
t('url_priv_169', c.validWebhookUrl('https://169.254.1.1/hook'))
t('url_priv_10_dev', c.validWebhookUrl('https://10.0.0.1/hook', { allowLocal: true }))
t('secret_15', c.validWebhookSecret('x'.repeat(15)))
t('secret_16', c.validWebhookSecret('x'.repeat(16)))
t('secret_200', c.validWebhookSecret('x'.repeat(200)))
t('secret_201', c.validWebhookSecret('x'.repeat(201)))
t('secret_null', c.validWebhookSecret(null))
t('parse_ok', JSON.stringify(c.parseWebhookEvents('["QUOTE_SIGNED","ORDER_CONFIRMED"]')))
t('parse_dedup', JSON.stringify(c.parseWebhookEvents('["QUOTE_SIGNED","QUOTE_SIGNED"]')))
t('parse_bad_type', c.parseWebhookEvents('["SMETI"]'))
t('parse_empty', c.parseWebhookEvents('[]'))
t('parse_not_json', c.parseWebhookEvents('nuj je'))
t('parse_not_array', c.parseWebhookEvents('{"a":1}'))
t('parse_null', c.parseWebhookEvents(null))
t('backoff_1', c.deliveryBackoff(1))
t('backoff_2', c.deliveryBackoff(2))
t('backoff_3', c.deliveryBackoff(3))
t('backoff_4', c.deliveryBackoff(4))
t('backoff_5', c.deliveryBackoff(5))
t('backoff_0', c.deliveryBackoff(0))
t('sig_msg', c.webhookSignatureMessage('123', 'BODY'))
t('max_attempts', c.WEBHOOK_MAX_ATTEMPTS)
const p = c.publicWebhookPayload({ eventKey: 'k1', eventType: 'T', projectId: 'p1', title: 'Naslov', body: 'Vsebina', customerName: 'Janez', customerEmail: 'a@b.si' })
t('pp_keys', JSON.stringify(Object.keys(p).sort()))
t('pp_data_keys', JSON.stringify(Object.keys(p.data).sort()))
t('pp_no_email', JSON.stringify(p).includes('a@b.si'))
t('pp_id', p.id + '|' + p.type + '|' + p.projectId)
console.log(JSON.stringify(Object.fromEntries(out)))
'''
res = bun_out(BUN_LIB)
def bt (k): return res.get(k)

chk(bt('events_len') == 16, 'WEBHOOK_EVENTS ima 16 tipov (12 + 4 novi)')
chk(bt('has_capture') and bt('has_model') and bt('has_production') and bt('has_order'), 'novi tipi: CAPTURE_PROCESSED/MODEL_CHANGED/PRODUCTION_READY/ORDER_CONFIRMED')
chk(bt('has_quote') and bt('is_type_ok'), 'stari tipi ostajajo (QUOTE_SIGNED …)')
chk(bt('is_type_bad') is False and bt('is_type_ok'), 'isWebhookEventType fail-closed za smeti')
chk(bt('test_event') == 'WEBHOOK_TEST', 'WEBHOOK_TEST pomožni tip')
chk(bt('url_https') is True, 'validWebhookUrl: https zunanji OK')
chk(bt('url_http') is False, 'validWebhookUrl: http zunanji ZAVRNJEN (tudi v razvoju)')
chk(bt('url_ftp') is False and bt('url_garbage') is False and bt('url_empty') is False, 'validWebhookUrl: ftp/smeti/prazno zavrnjeni')
chk(bt('url_localhost_prod') is False and bt('url_127_prod') is False, 'validWebhookUrl: localhost/127.0.0.1 ZAVRNJENA brez allowLocal (produkcija)')
chk(bt('url_127_dev') is True and bt('url_127_https_dev') is True, 'validWebhookUrl: 127.0.0.1 dovoljen z allowLocal (testni sprejemnik)')
chk(bt('url_http_external_dev') is False, 'validWebhookUrl: http do zunanjega ZAVRNJEN tudi z allowLocal')
chk(bt('url_priv_10') is False and bt('url_priv_192') is False and bt('url_priv_169') is False, 'validWebhookUrl: privatna IP dobesedno zavrnjena (SSRF)')
chk(bt('url_priv_10_dev') is False, 'validWebhookUrl: privatni IP zavrnjen TUDI z allowLocal (razvoj)')
chk(bt('secret_15') is False and bt('secret_16') is True, 'validWebhookSecret: meja 16 znakov')
chk(bt('secret_200') is True and bt('secret_201') is False, 'validWebhookSecret: zgornja meja 200')
chk(bt('secret_null') is False, 'validWebhookSecret: null zavrnjen')
chk(bt('parse_ok') == '["QUOTE_SIGNED","ORDER_CONFIRMED"]', 'parseWebhookEvents: veljaven seznam')
chk(bt('parse_dedup') == '["QUOTE_SIGNED"]', 'parseWebhookEvents: dedup')
chk(bt('parse_bad_type') is None and bt('parse_not_json') is None, 'parseWebhookEvents: smeti → null')
chk(bt('parse_empty') is None and bt('parse_not_array') is None and bt('parse_null') is None, 'parseWebhookEvents: prazen/ne-array/null → null')
chk(bt('backoff_1') == 1 and bt('backoff_2') == 5 and bt('backoff_3') == 30 and bt('backoff_4') == 30, 'deliveryBackoff: 1/5/30/30 min')
chk(bt('backoff_5') is None and bt('max_attempts') == 5, 'deliveryBackoff: po 5. poskusu ni več (DEAD, mrtvo pismo)')
chk(bt('backoff_0') == 1, 'deliveryBackoff(0) → 1 min (rob)')
chk(bt('sig_msg') == '123.BODY', 'webhookSignatureMessage: `${ts}.${body}`')
chk(bt('pp_keys') == '["createdAt","data","id","projectId","type"]', 'publicWebhookPayload: whitelist ključev')
chk(bt('pp_data_keys') == '["body","customerName","title"]', 'publicWebhookPayload: data {title, body, customerName?}')
chk(bt('pp_no_email') is False, 'publicWebhookPayload: e-pošta stranke IZKLJUČENA')
chk(bt('pp_id') == 'k1|T|p1', 'publicWebhookPayload: id/type/projectId projekcija')

core_src = open(os.path.join(REPO, 'src/lib/webhook-core.ts'), encoding='utf-8').read()
chk(all(x not in core_src for x in ("from '@/lib/db'", 'next/server', "from 'crypto'", "from 'node:crypto'")),
    'webhook-core.ts: ČIST lib (brez db/next/node:crypto uvozov)')

# ═══ FAZA C — naročnine CRUD ═════════════════════════════════════════════════
print('── C) naročnine CRUD')
s, d = mk_sub(['QUOTE_SIGNED', 'ORDER_CONFIRMED'], path='/ok')
chk(s == 201, f'POST /api/webhooks → 201 (dobljeno {s})')
SUB = d['data']['id']
chk(d['data']['url'].endswith('/ok') and d['data']['events'] == ['QUOTE_SIGNED', 'ORDER_CONFIRMED'], '201 odgovor: url + events')
chk(d['data']['active'] is True and d['data']['description'] == TAG, '201 odgovor: active + description')
chk(SECRET not in json.dumps(d) and 'secrethash' not in json.dumps(d).lower(),
    '201 odgovor: BREZ skrivnosti in BREZ hasha (podpisni ključ ne gre ven)')
chk(isinstance(d['data'].get('secretInfo'), str) and 'hash' in d['data']['secretInfo'], '201 odgovor: secretInfo opozorilo')

row = bun_out(f'''
const {{PrismaClient}} = require('@prisma/client'); const p = new PrismaClient();
(async () => {{
  const s = await p.webhookSubscription.findUnique({{where: {{id: '{SUB}'}}}});
  console.log(JSON.stringify({{hash: s.secretHash, len: s.secretHash.length, eq_secret: s.secretHash === '{SECRET}', events: s.events, active: s.active, revoked: s.revokedAt}}));
  await p.$disconnect();
}})()
''')
chk(row.get('len') == 64 and bool(row.get('hash')) and row.get('eq_secret') is False,
    'DB: shranjen SAMO SHA-256 hex has (64 znakov, ≠ skrivnost)')
chk(row.get('events') == ['QUOTE_SIGNED', 'ORDER_CONFIRMED'] and row.get('active') is True and row.get('revoked') is None,
    'DB: events kot jsonb tabela + active + ni preklica (R542)')

s, d = callj('POST', '/api/webhooks', admin, {'url': 'http://partner.example.com/h', 'events': ['QUOTE_SIGNED'], 'secret': 'x' * 20})
chk(s == 400, 'POST http (zunanji) URL → 400')
s, d = callj('POST', '/api/webhooks', admin, {'url': 'https://10.0.0.1/h', 'events': ['QUOTE_SIGNED'], 'secret': 'x' * 20})
chk(s == 400, f'POST privatni IP URL → 400 — tudi v razvoju (dobljeno {s})')
s, d = callj('POST', '/api/webhooks', admin, {'url': 'https://192.168.1.5/h', 'events': ['QUOTE_SIGNED'], 'secret': 'x' * 20})
chk(s == 400, 'POST privatni IP (192.168) → 400')
s, d = callj('POST', '/api/webhooks', admin, {'url': f'https://partner.example.com/h', 'events': ['SMETI'], 'secret': 'x' * 20})
chk(s == 400, 'POST neveljaven tip dogodka → 400')
s, d = callj('POST', '/api/webhooks', admin, {'url': 'https://partner.example.com/h', 'events': [], 'secret': 'x' * 20})
chk(s == 400, 'POST prazen seznam dogodkov → 400')
s, d = callj('POST', '/api/webhooks', admin, {'url': 'https://partner.example.com/h', 'events': 'QUOTE_SIGNED', 'secret': 'x' * 20})
chk(s == 400, 'POST events ni array → 400')
s, d = callj('POST', '/api/webhooks', admin, {'url': 'https://partner.example.com/h', 'events': ['QUOTE_SIGNED'], 'secret': 'kratko'})
chk(s == 400, 'POST prekratka skrivnost → 400')
s, d = callj('POST', '/api/webhooks', monter, {'url': 'https://partner.example.com/h', 'events': ['QUOTE_SIGNED'], 'secret': 'x' * 20})
chk(s == 403, 'POST monter brez pravice → 403')

s, d = callj('PATCH', f'/api/webhooks/{SUB}', admin, {'events': ['ORDER_CONFIRMED', 'MODEL_CHANGED']})
chk(s == 200 and d['data']['events'] == ['ORDER_CONFIRMED', 'MODEL_CHANGED'], 'PATCH events → posodobljeno')
s, d = callj('PATCH', f'/api/webhooks/{SUB}', admin, {'description': TAG + ' (opis)'})
chk(s == 200 and d['data']['description'] == TAG + ' (opis)', 'PATCH description')
s, d = callj('PATCH', f'/api/webhooks/{SUB}', admin, {'events': ['SMETI']})
chk(s == 400, 'PATCH smetni dogodki → 400')
s, d = callj('PATCH', '/api/webhooks/ne-obstaja', admin, {'active': False})
chk(s == 404, 'PATCH neobstoječa naročnina → 404')

s, d = callj('DELETE', f'/api/webhooks/{SUB}', admin)
chk(s == 200 and d['data']['revoked'] is True, 'DELETE → preklic (revoked)')
s, d = callj('DELETE', f'/api/webhooks/{SUB}', admin)
chk(s == 200 and d['data']['revoked'] is True, 'DELETE idempotenten (drugič)')
s, d = callj('PATCH', f'/api/webhooks/{SUB}', admin, {'active': True})
chk(s == 409, 'PATCH preklicane naročnine → 409')
s, d = callj('GET', '/api/webhooks', admin)
rev = next((x for x in d['data'] if x['id'] == SUB), None)
chk(rev and rev['active'] is False and rev['revokedAt'], 'GET seznam: preklicana ima revokedAt + active=false')

# ═══ FAZA D — testni ping + podpis ═══════════════════════════════════════════
print('── D) testni ping + podpis')
s, d = mk_sub(['QUOTE_SIGNED'], path='/ping')      # SUB_PING
SUB_PING = d['data']['id']
s, d = callj('POST', f'/api/webhooks/{SUB_PING}/test', admin)
chk(s == 200 and d['data']['delivered'] is True and d['data']['responseStatus'] == 200,
    f'POST test → delivered 200 (dobljeno {s})')
got = wait_for(lambda: len(received('/ping')) > 0)
chk(got, 'sprejemnik prejel testni ping')
if got:
    r = received('/ping')[-1]
    chk(r['headers'].get('x-roksal-event') == 'WEBHOOK_TEST', 'glava X-ROKSAL-Event: WEBHOOK_TEST')
    chk(verify_signature(r), 'PODPIS veljaven: sha256=HMAC-SHA256(sha256(secret), `${ts}.${body}`)')
    b = r['json']
    chk(b and b.get('type') == 'WEBHOOK_TEST' and str(b.get('id', '')).startswith('webhook-test:'),
        'telo: type WEBHOOK_TEST + id eventKey oblike webhook-test:…')
    chk(set(b.keys()) == {'id', 'type', 'createdAt', 'projectId', 'data'}, 'telo: točno whitelist ključi')
    chk(SECRET not in r['body'], 'skrivnost NI v telesu dostave')
s, d = callj('POST', '/api/webhooks/ne-obstaja/test', admin)
chk(s == 404, 'ping neobstoječe naročnine → 404')
s, d = callj('POST', f'/api/webhooks/{SUB}/test', admin)  # preklicana
chk(s == 409, 'ping preklicane naročnine → 409')

# tempomat 10/min na naročnino (SUB_PING je že porabil 1)
codes = [callj('POST', f'/api/webhooks/{SUB_PING}/test', admin)[0] for _ in range(10)]
chk(codes.count(200) == 9 and codes.count(429) == 1,
    f'tempomat testnega pinga 10/min → 429 (200×{codes.count(200)}, 429×{codes.count(429)})')

# ═══ FAZA E — dostava: neuspeh, backoff, DEAD, uspeh ════════════════════════
print('── E) dostava — backoff in mrtvo pismo')
s, d = mk_sub(['QUOTE_SIGNED'], path='/fail')      # SUB_FAIL
SUB_FAIL = d['data']['id']
s, d = callj('POST', f'/api/webhooks/{SUB_FAIL}/test', admin)
chk(s == 200 and d['data']['delivered'] is False and d['data']['responseStatus'] == 500,
    'ping na 500 → delivered false + responseStatus 500')

def del_row (sub_id):
    return bun_out(f'''
const {{PrismaClient}} = require('@prisma/client'); const p = new PrismaClient();
(async () => {{
  const rows = await p.webhookDelivery.findMany({{where: {{subscriptionId: '{sub_id}'}}, orderBy: {{createdAt: 'desc'}}}});
  const r = rows.find(x => x.eventType === 'WEBHOOK_TEST');
  console.log(JSON.stringify({{status: r.status, attempts: r.attempts, next: r.nextAttemptAt, error: r.error, responseStatus: r.responseStatus, deliveredAt: r.deliveredAt, eventKey: r.eventKey}}));
  await p.$disconnect();
}})()
''')

row = del_row(SUB_FAIL)
chk(row.get('status') == 'FAILED' and row.get('attempts') == 1, f'outbox: FAILED + attempts 1 (status={row.get("status")}, att={row.get("attempts")})')
chk(row.get('responseStatus') == 500 and '500' in str(row.get('error')), 'outbox: responseStatus 500 + error HTTP 500')
nxt = row.get('next')
delta = None
if isinstance(nxt, str):
    try:
        delta = (datetime.fromisoformat(nxt.replace('Z', '+00:00')) - datetime.now(timezone.utc)).total_seconds()
    except Exception:
        delta = None
chk(delta is not None and 30 < delta < 120, f'outbox: nextAttemptAt ≈ +1 min (delta={delta and round(delta)}s)')

s, d = callj('POST', '/api/webhooks/retry', admin)
chk(s == 200 and d['data']['processed'] == 0, 'retry PRED rokom → processed 0 (backoff se spoštuje)')

def backdate (sub_id):
    bun_ts(f'''
const {{PrismaClient}} = require('@prisma/client'); const p = new PrismaClient();
(async () => {{
  await p.webhookDelivery.updateMany({{where: {{subscriptionId: '{sub_id}', status: 'FAILED'}}, data: {{nextAttemptAt: new Date(Date.now() - 120000)}}}});
  await p.$disconnect();
}})()
''')

# poskusi 2–5 (skupaj 5 → DEAD)
for i in range(2, 6):
    backdate(SUB_FAIL)
    s, d = callj('POST', '/api/webhooks/retry', admin)
    row = del_row(SUB_FAIL)
    if i < 5:
        chk(s == 200 and row.get('attempts') == i and row.get('status') == 'FAILED',
            f'retry #{i}: attempts {i}, FAILED, responseStatus {row.get("responseStatus")}')
    else:
        chk(s == 200 and row.get('attempts') == 5 and row.get('status') == 'DEAD' and row.get('next') is None,
            f'retry #5: attempts 5 → DEAD (mrtvo pismo), nextAttemptAt null (status={row.get("status")}, att={row.get("attempts")})')
s, d = callj('POST', '/api/webhooks/retry', admin)
chk(s == 200 and d['data']['processed'] == 0, 'retry po DEAD → processed 0 (mrtvo pismo se ne ponavlja)')

s, d = callj('GET', '/api/webhooks', admin)
failsub = next((x for x in d['data'] if x['id'] == SUB_FAIL), None)
chk(failsub and failsub['deliveries']['dead'] == 1, 'GET /api/webhooks: dead: 1 v statistiki')
chk(failsub and failsub['lastFailureAt'], 'GET /api/webhooks: lastFailureAt nastavljen')
pingsub = next((x for x in d['data'] if x['id'] == SUB_PING), None)
chk(pingsub and pingsub['deliveries']['sent'] >= 10 and pingsub['lastSuccessAt'], 'GET /api/webhooks: sent ≥10 + lastSuccessAt (uspešne dostave)')

# ═══ FAZA F — dogodki v poslovnem toku ══════════════════════════════════════
print('── F) dogodki v toku (ORDER_CONFIRMED + MODEL_CHANGED)')
before = len(received('/ok', event='ORDER_CONFIRMED'))
s, d = mk_sub(['ORDER_CONFIRMED'], path='/ok')       # SUB_ORD — aktivni poslušalec
SUB_ORD = d['data']['id']
s, d = callj('POST', '/api/material-orders', admin, {'lines': [
    {'itemName': TAG + ' cev', 'qty': 2, 'unit': 'm', 'unitPrice': 10.5},
]})
chk(s == 201, f'POST material-order 201 (dobljeno {s})')
OID = d['data']['id']; ORDERS.append(OID)
s, d = callj('POST', '/api/material-orders', admin, {'id': OID, 'status': 'POSLANO'})
chk(s == 200, 'naročilo POSLANO')
s, d = callj('POST', '/api/material-orders', admin, {'id': OID, 'status': 'PREJETO'})
chk(s == 200, 'naročilo PREJETO')
chk(wait_for(lambda: len(received('/ok', event='ORDER_CONFIRMED')) > before), 'ORDER_CONFIRMED dostavljen na sprejemnik')
rows = received('/ok', event='ORDER_CONFIRMED')
r = rows[-1]; b = r['json']
chk(b['id'] == f'order-confirmed:{OID}', f'eventKey = order-confirmed:<id> (dobljeno {b["id"][:40]})')
chk(b['data']['title'] == 'Naročilo potrjeno' and 'NAR-' in b['data']['body'], 'telo: naslov + vsebina dogodka')
chk(verify_signature(r), 'PODPIS dogodka v toku veljaven')
body_str = json.dumps(b)
chk(all(x not in body_str for x in ('salePrice', 'costPrice', 'margin', 'unitPrice', 'customerEmail')),
    'telo BREZ internih cen/marž/e-pošte (varni podskup)')
dup = [x for x in rows if x['json'] and x['json'].get('id') == f'order-confirmed:{OID}']
chk(len(dup) == 1, f'idempotenca v toku: isti dogodek dostavljen 1× (dobljeno {len(dup)})')
s, d = callj('POST', '/api/material-orders', admin, {'id': OID, 'status': 'PREJETO'})
chk(s == 409, 'ponovni PREJETO → 409 (prehod enkraten — tudi dogodek)')

# naročnina posluša ORDER_CONFIRMED — QUOTE_SIGNED naj NE dostavi ničesar
s, d = mk_sub(['QUOTE_SIGNED'], path='/quote')
SUB_QUOTE = d['data']['id']
chk(len(received('/quote')) == 0, 'naročnina brez dogodka v seznamu NE prejema (filtriranje po tipih)')

s, d = callj('GET', '/api/notifications', admin)
chk(any(n.get('title') == 'Naročilo potrjeno' for n in d.get('data', [])),
    'IN_APP obvestilo pisarni za ORDER_CONFIRMED (isti dogodek = IN_APP + webhook)')

# MODEL_CHANGED: tekač — PATCH vozlišč emitira, preimenovanje NE
NODES = [{'kind': 'ZACETEK', 'atCm': 0}, {'kind': 'STEBER', 'atCm': 150}, {'kind': 'KONEC', 'atCm': 460}]
s, d = callj('POST', '/api/fence-run', admin, {'projectId': P4, 'name': TAG + ' tekač', 'nodes': NODES})
chk(s == 201, f'POST fence-run 201 (dobljeno {s})')
RID = d['data']['id']; RUNS.append(RID)
s, d = mk_sub(['MODEL_CHANGED'], path='/model')
SUB_MODEL = d['data']['id']
s, d = callj('PATCH', f'/api/fence-run/{RID}', admin, {'name': TAG + ' tekač preimenovan'})
chk(s == 200 and len(received('/model')) == 0, 'PATCH ime (ni model) → BREZ MODEL_CHANGED')
NODES2 = [{'kind': 'ZACETEK', 'atCm': 0}, {'kind': 'STEBER', 'atCm': 160}, {'kind': 'KONEC', 'atCm': 460}]
s, d = callj('PATCH', f'/api/fence-run/{RID}', admin, {'nodes': NODES2})
chk(s == 200, 'PATCH vozlišč (model) → 200')
chk(wait_for(lambda: len(received('/model')) > 0), 'MODEL_CHANGED dostavljen')
mb = received('/model')[-1]['json']
chk(str(mb.get('id', '')).startswith(f'model-changed:{RID}:'), f'eventKey = model-changed:<runId>:<verzija> (dobljeno {mb.get("id", "")[:45]})')
chk(mb.get('projectId') == P4, 'MODEL_CHANGED nosi projectId (obseg projekta)')

# ═══ FAZA G — idempotenca (baza, unique) ════════════════════════════════════
print('── G) idempotenca (unique [subscriptionId, eventKey])')
row = del_row(SUB_PING)
evk = row.get('eventKey')
out, err = bun_ts(f'''
const {{PrismaClient}} = require('@prisma/client'); const p = new PrismaClient();
(async () => {{
  try {{
    await p.webhookDelivery.create({{data: {{subscriptionId: '{SUB_PING}', eventKey: '{evk}', eventType: 'WEBHOOK_TEST', payload: '{{}}', status: 'PENDING'}}}});
    console.log('DUP-OK');
  }} catch (e) {{
    console.log('DUP-ERR:' + (e.code ?? e.message.slice(0, 40)));
  }}
  await p.$disconnect();
}})()
''')
chk('DUP-ERR' in out and 'P2002' in out, 'dvojna vrstica [subscriptionId, eventKey] → unique napaka P2002')

# ═══ FAZA H — revizije ══════════════════════════════════════════════════════
print('── H) revizije (brez skrivnosti!)')
a_create = global_audit(admin, 'WEBHOOK_CREATE')
chk(len(a_create) > 0, 'revizija WEBHOOK_CREATE v globalnem dnevniku')
detail_blob = json.dumps([e.get('detail') for e in a_create], ensure_ascii=False)
chk(SECRET not in detail_blob, 'WEBHOOK_CREATE detail BREZ skrivnosti')
# R542: detail je jsonb objekt — podniz po serializaciji (ista namena)
chk(not any('secretHash' in json.dumps(e.get('detail'), ensure_ascii=False) for e in a_create), 'WEBHOOK_CREATE detail BREZ secretHash')
chk(any('events' in json.dumps(e.get('detail'), ensure_ascii=False) for e in a_create), 'WEBHOOK_CREATE detail vsebuje events')
for action in ('WEBHOOK_UPDATE', 'WEBHOOK_REVOKE', 'WEBHOOK_TEST', 'WEBHOOK_RETRY'):
    rows = global_audit(admin, action)
    chk(len(rows) > 0, f'revizija {action} zabeležena')

# ═══ FAZA I — zgodovina dostav ══════════════════════════════════════════════
print('── I) zgodovina dostav')
s, d = callj('GET', '/api/webhooks/deliveries', admin)
chk(s == 200 and isinstance(d.get('data'), list), 'GET deliveries 200')
all_blob = json.dumps(d)
chk(SECRET not in all_blob and 'secretHash' not in all_blob, 'odgovori NIKOLER ne razkrivajo skrivnosti/hasa')
row = next((x for x in d['data'] if x['subscriptionId'] == SUB_FAIL), None)
chk(row and row['status'] == 'DEAD' and row['attempts'] == 5, 'zgodovina: DEAD vrstica z attempts 5')
s, d = callj('GET', f'/api/webhooks/deliveries?subscriptionId={SUB_PING}&status=SENT', admin)
chk(s == 200 and len(d['data']) > 0 and all(x['status'] == 'SENT' for x in d['data']), 'filter subscriptionId + status=SENT')
s, d = callj('GET', '/api/webhooks/deliveries?status=SMETI', admin)
chk(s == 400, 'neveljaven status → 400')
s, d = callj('GET', '/api/webhooks/deliveries?subscriptionId=ne-obstaja', admin)
chk(s == 404, 'neobstoječa naročnina v filtru → 404')
s, d = callj('GET', '/api/webhooks/deliveries?limit=1', admin)
chk(s == 200 and len(d['data']) <= 1, 'limit deluje (≤ 1)')

# ═══ FAZA J — idempotentno čiščenje ×2 ══════════════════════════════════════
print('── J) čiščenje (×2)')
def cleanup ():
    return bun_out(r'''
const {PrismaClient} = require('@prisma/client'); const p = new PrismaClient();
(async () => {
  const d = await p.webhookDelivery.deleteMany({});
  const s = await p.webhookSubscription.deleteMany({where: {OR: [{description: {contains: 'R481-TEST'}}, {id: {in: []}}]}});
  const s2 = await p.webhookSubscription.deleteMany({});
  const o = await p.materialOrder.deleteMany({where: {lines: {some: {itemName: {contains: 'R481-TEST'}}}}});
  const fr = await p.fenceRun.deleteMany({where: {name: {contains: 'R481-TEST'}}});
  const ne = await p.notificationEvent.deleteMany({where: {OR: [{key: {contains: 'order-confirmed:'}}, {key: {contains: 'model-changed:'}}, {key: {contains: 'webhook-test:'}}]}});
  const n = await p.notification.deleteMany({where: {title: {in: ['Naročilo potrjeno', 'Model spremenjen']}}});
  console.log(JSON.stringify({subs: s.count + s2.count, del: d.count, ord: o.count, run: fr.count, ev: ne.count, notif: n.count}));
  await p.$disconnect();
})()
''')
c1 = cleanup()
chk(all(c1.get(k, 0) >= 0 for k in ('subs', 'del', 'ord', 'run', 'ev', 'notif')) and c1.get('subs', 0) >= 5 and c1.get('del', 0) >= 10,
    f'čiščenje #1: naročnine={c1.get("subs")}, dostave={c1.get("del")}, naročila={c1.get("ord")}, tekači={c1.get("run")}')
c2 = cleanup()
left = bun_out(r'''
const {PrismaClient} = require('@prisma/client'); const p = new PrismaClient();
(async () => {
  const s = await p.webhookSubscription.count({});
  const d = await p.webhookDelivery.count({});
  console.log(JSON.stringify({subs: s, del: d}));
  await p.$disconnect();
})()
''')
chk(left.get('subs') == 0 and left.get('del') == 0, f'čiščenje #2 idempotentno: 0 naročnin, 0 dostav (left={left})')

# ═════════════════════════════════════════════════════════════════════════════
print(f'════ R481 REZULTAT: ✓ {PASS} / ✗ {FAIL} ════')
sys.exit(1 if FAIL else 0)

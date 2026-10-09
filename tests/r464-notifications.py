#!/usr/bin/env python3
"""tests/r464-notifications.py — R464 PRODUCTION HARDENING (GitHub issue #1, sklop 7):
PRODUKCIJSKI NOTIFICATION ADAPTERJI (emitEvent → adapter → provider).

Preverja (faze — vsaka s svojo konfiguracijo okolja dev strežnika):
  A) PRIVZETO VEDENJE OHRANJENO (brez NOTIFY_* env — R438 kompatibilno):
     IN_APP dostava SENT; EMAIL uporabnika SKIPPED (izklopljeno v nastavitvah);
     EMAIL stranke SENT prek log adapterja (maskiran prejemnik);
     SMS/WHATSAPP stranke SKIPPED (kanal ni konfiguriran).
  B) WEBHOOK PROVIDER USPEH (NOTIFY_*_PROVIDER=webhook + lokalni sprejemnik):
     IN_APP nedotaknjen; EMAIL/SMS/WHATSAPP dostave SENT; webhook prejel
     maskiranega prejemnika + realni naslov SAMO v telesu providerju;
     dedup (ponoven enak emit → brez novih dostav); prefs opt-out spoštovan
     tudi ob konfiguriranem providerju (SKIPPED 'izklopljeno v nastavitvah').
  C) NEUSPEH + RETRY (SMTP stub + mrtvi webhook URL): poslovni tok vrne
     200 kljub spodletelim dostavam; dostave FAILED z jasnima napakama
     (SMTP ni konfiguriran / webhook fetch fail); job obvestila-retry
     poveča attempts; dedup tudi ob napakah (isti event → ena dostava).
  D) CLEANUP + obnovitev privzetega dev strežnika (health OK).

Test SAM upravlja z dev strežnikom na portu iz BASE_URL (privzeto 3030):
med fazami ga ponovno zaganja z različnimi NOTIFY_* okoljskimi spremenljivkami
(process.env se bere ob zagonu strežnika), na koncu pusti teči privzetega.

Uporaba:
  cd /home/z/roksal-d && source env.sh && \
  BASE_URL=http://localhost:3030 TEST_DB_URL=file:/home/z/roksal-d/db/roksal.db \
  python3 tests/r464-notifications.py
"""
import json, os, re, shutil, signal, subprocess, sys, threading, time
import urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.environ.get('BASE_URL', 'http://localhost:3030')
PORT = int(re.search(r':(\d+)$', BASE).group(1)) if re.search(r':(\d+)$', BASE) else 3030
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.environ.get('TEST_DB_URL', 'file:' + REPO + '/db/roksal.db')
HOOK_PORT = 5998          # lokalni webhook sprejemnik (faza B)
DEAD_HOOK = 'http://127.0.0.1:59999/neobstoja'  # nihče ne posluša (faza C)
DEV_LOG = '/tmp/r464-dev.log'
BUNX = shutil.which('bunx') or '/usr/local/bin/bunx'
NOTIFY_VARS = ('NOTIFY_EMAIL_PROVIDER', 'NOTIFY_SMS_PROVIDER', 'NOTIFY_WHATSAPP_PROVIDER',
               'NOTIFY_WEBHOOK_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM')
PASS, FAIL = 0, 0
PROCS = []

# ── pomožne (stil obstoječih testov) ─────────────────────────────────────────

def callj (method, path, token=None, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {'error': str(e)}

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun (script):
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       env={**os.environ, 'DATABASE_URL': DB})
    return r.stdout, r.stderr[:400]

# ── upravljanje dev strežnika (faze potrebujejo različen process.env) ────────

def http_ok (url, timeout=3):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False

def wait_health (timeout=240):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if http_ok(f'http://127.0.0.1:{PORT}/api/public/health'):
            return True
        time.sleep(1.5)
    return False

def listener_pid (port):
    """PID procesa, ki posluša na portu (ss -tlnp)."""
    try:
        out = subprocess.run(['ss', '-tlnp', f'sport = :{port}'], capture_output=True, text=True).stdout
        m = re.search(r'pid=(\d+)', out)
        return int(m.group(1)) if m else None
    except Exception:
        return None

def kill_server ():
    """Ustavi dev strežnik na portu PORT (CLI + listener + njegov proces)."""
    subprocess.run(['pkill', '-9', '-f', f'next dev -p {PORT}'], capture_output=True)
    pid = listener_pid(PORT)
    if pid:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try: os.kill(pid, sig)
            except ProcessLookupError: pass
            except PermissionError: break
            if listener_pid(PORT) is None: break
            time.sleep(1)
    t0 = time.time()
    while time.time() - t0 < 25:
        if listener_pid(PORT) is None:
            time.sleep(1.0)  # sprostitev vtičnice
            return True
        time.sleep(0.5)
    return False

def start_server (env_overrides):
    """Zagon dev strežnika s podanimi NOTIFY_* spremenljivkami (ostalo podedovano)."""
    kill_server()
    env = {k: v for k, v in os.environ.items() if k not in NOTIFY_VARS}
    env['DATABASE_URL'] = DB  # sandbox vbrizga napačen DATABASE_URL — vedno prepiši
    env.update(env_overrides)
    logf = open(DEV_LOG, 'a')
    proc = subprocess.Popen([BUNX, 'next', 'dev', '-p', str(PORT)], cwd=REPO, env=env,
                            stdout=logf, stderr=subprocess.STDOUT, start_new_session=True)
    PROCS.append(proc)
    return wait_health()

def phase (name):
    print(f'── {name}')

# ── lokalni webhook sprejemnik (faza B) ──────────────────────────────────────

RECEIVED = []

class HookHandler (BaseHTTPRequestHandler):
    def do_POST (self):
        ln = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(ln)
        try: body = json.loads(raw)
        except Exception: body = {'_raw': raw.decode('utf-8', 'replace')}
        RECEIVED.append({'path': self.path, 'body': body})
        payload = json.dumps({'ok': True, 'id': f'hook-{len(RECEIVED)}'}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('x-provider-id', f'hook-{len(RECEIVED)}')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def log_message (self, *a): pass

def start_hook ():
    srv = ThreadingHTTPServer(('127.0.0.1', HOOK_PORT), HookHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

# ── skupni pomožni za dostave ────────────────────────────────────────────────

def deliveries (token, **params):
    q = '&'.join(f'{k}={v}' for k, v in params.items())
    s, d = callj('GET', f'/api/notifications/deliveries?all=1{("&" + q) if q else ""}', token)
    return d.get('data', []) if s == 200 else []

def pick (rows, **conds):
    out = []
    for r in rows:
        if all(str(r.get(k)) == str(v) for k, v in conds.items()):
            out.append(r)
    return out

def by_key (rows, keypart):
    return [r for r in rows if keypart in (r.get('event') or {}).get('key', '')]

# ═══════════════════════════════════ TEST ═════════════════════════════════════

print(f'════ R464 — produkcijski notification adapterji (issue #1 sklop 7) ════')
print(f'     BASE={BASE} · DB={DB} · dev dnevnik={DEV_LOG}')
TEST_START = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime())
WO_IDS = []

# ── priprava: uporabniki + projekt s stranko ────────────────────────────────
phase('priprava')
chk(start_server({}), 'faza A: dev strežnik zagnan (privzeto okolje, brez NOTIFY_*)')
TOK = login('admin@roksal.si', 'Admin123!')
MTOK = login('monter@roksal.si', 'Monter123!')
s, d = callj('GET', '/api/users', TOK)
MID = next((u['id'] for u in d.get('data', []) if u.get('email') == 'monter@roksal.si'), None)
s, d = callj('GET', '/api/projects', TOK)
PID = next((p['id'] for p in d.get('data', []) if p.get('code') == 'P-2026-006'), None)
chk(MID is not None, 'id monterja pridobljen')
chk(PID is not None, 'projekt P-2026-006 (stranka z e-pošto) najden')

def post_nalog (title, extra=None):
    body = {'title': title, 'assigneeId': MID, **(extra or {})}
    s, d = callj('POST', '/api/nalog', TOK, body)
    if s == 201 and d.get('data', {}).get('id'):
        WO_IDS.append(d['data']['id'])
    return s, d

def post_termin (woid, when):
    return callj('POST', f'/api/nalog/{woid}/termin', TOK, {'scheduledFor': when})

# ═══ FAZA A — privzeto vedenje ohranjeno (R438 kompatibilno) ═════════════════
phase('A) privzeto vedenje (log/none adapterji)')
s, d = post_nalog('R464-A nalog brez projekta')
chk(s == 201, f'POST nalog A 201 (dobljeno {s})')
WOA = WO_IDS[-1]
s, d = callj('GET', '/api/notifications', MTOK)
chk(any('Nov nalog dodeljen' in (n.get('title') or '') for n in d.get('data', [])), 'monter vidi IN_APP obvestilo o dodelitvi')

rows = by_key(deliveries(TOK), WOA)
chk(len(pick(rows, channel='IN_APP')) == 1 and pick(rows, channel='IN_APP')[0]['status'] == 'SENT',
    'A: IN_APP dostava SENT (notranja — brez providerja)')
em = pick(rows, channel='EMAIL')
chk(len(em) == 1 and em[0]['status'] == 'SKIPPED' and em[0]['error'] == 'izklopljeno v nastavitvah',
    'A: EMAIL uporabnika SKIPPED (privzeto izklopljen — R438)')

# stranka: termin na nalogu s projektom → WO_TERMIN
s, d = post_nalog('R464-A nalog s projektom', {'projectId': PID})
WOA2 = WO_IDS[-1]
s, d = post_termin(WOA2, '2026-11-15T08:00:00.000Z')
chk(s == 200, f'A: POST termin 200 (dobljeno {s})')
rows = by_key(deliveries(TOK), WOA2)
trem = [r for r in rows if r['event']['type'] == 'WO_TERMIN']
em = pick(trem, channel='EMAIL', userId=None)
chk(len(em) == 1 and em[0]['status'] == 'SENT', 'A: EMAIL stranke SENT prek privzetega log adapterja')
chk('***' in (em[0].get('recipient') or ''), 'A: prejemnik maskiran (*** v recipient)')
chk('ivan.zajc@gmail.com' not in json.dumps(em), 'A: celoten e-poštni naslov NI v dostavi')
sm = pick(trem, channel='SMS')
wa = pick(trem, channel='WHATSAPP')
chk(len(sm) == 1 and sm[0]['status'] == 'SKIPPED' and sm[0]['error'] == 'kanal ni konfiguriran',
    'A: SMS stranke SKIPPED (kanal ni konfiguriran — R438)')
chk(len(wa) == 1 and wa[0]['status'] == 'SKIPPED' and wa[0]['error'] == 'kanal ni konfiguriran',
    'A: WHATSAPP stranke SKIPPED (kanal ni konfiguriran — R438)')

# ═══ FAZA B — webhook provider uspeh ══════════════════════════════════════════
phase('B) webhook provider uspeh (lokalni sprejemnik)')
hook = start_hook()
ENV_B = {'NOTIFY_EMAIL_PROVIDER': 'webhook', 'NOTIFY_SMS_PROVIDER': 'webhook',
         'NOTIFY_WHATSAPP_PROVIDER': 'webhook', 'NOTIFY_WEBHOOK_URL': f'http://127.0.0.1:{HOOK_PORT}/hook'}
chk(start_server(ENV_B), 'faza B: strežnik ponovno zagnan z NOTIFY_*_PROVIDER=webhook')
TOK = login('admin@roksal.si', 'Admin123!')
MTOK = login('monter@roksal.si', 'Monter123!')

# uporabnik: monter vklopi EMAIL pref → dostava gre prek webhooka
s, d = callj('POST', '/api/notifications/prefs', MTOK, {'event': 'WO_ASSIGNED', 'channel': 'EMAIL', 'enabled': True})
chk(s == 200, f'B: monter vklopi EMAIL pref 200 (dobljeno {s})')
before = len(RECEIVED)
s, d = post_nalog('R464-B nalog webhook')
WOB = WO_IDS[-1]
rows = by_key(deliveries(TOK), WOB)
inapp = pick(rows, channel='IN_APP')
em = pick(rows, channel='EMAIL')
chk(len(inapp) == 1 and inapp[0]['status'] == 'SENT', 'B: IN_APP nedotaknjen ob webhook providerju (SENT)')
chk(len(em) == 1 and em[0]['status'] == 'SENT', 'B: EMAIL uporabnika SENT prek webhook providerja')
time.sleep(0.5)
new = [r for r in RECEIVED[before:]]
email_hooks = [r for r in new if r['body'].get('channel') == 'EMAIL']
chk(len(email_hooks) == 1, f'B: webhook prejel 1 EMAIL zahtevek (dobljenih {len(email_hooks)})')
if email_hooks:
    b = email_hooks[0]['body']
    chk(b.get('address') == 'monter@roksal.si', 'B: provider prejel realni naslov (address)')
    chk('***' in (b.get('recipient') or ''), 'B: provider prejel MASKIRANEGA prejemnika (recipient)')
    chk(bool(b.get('eventKey')) and 'wo-assign' in b.get('eventKey', ''), 'B: eventKey prisoten v webhook telesu')
    chk(b.get('eventType') == 'WO_ASSIGNED', 'B: eventType v webhook telesu')

# stranka: EMAIL + SMS + WHATSAPP prek webhooka
s, d = post_nalog('R464-B nalog stranka', {'projectId': PID})
WOB2 = WO_IDS[-1]
s, d = post_termin(WOB2, '2026-11-20T08:00:00.000Z')
chk(s == 200, f'B: POST termin stranke 200 (dobljeno {s})')
rows = by_key(deliveries(TOK), WOB2)
trem = [r for r in rows if r['event']['type'] == 'WO_TERMIN']
for ch in ('EMAIL', 'SMS', 'WHATSAPP'):
    rr = pick(trem, channel=ch, userId=None)
    chk(len(rr) == 1 and rr[0]['status'] == 'SENT', f'B: {ch} stranke SENT prek webhook providerja')
time.sleep(0.5)
new = [r for r in RECEIVED[before:] if r['body'].get('eventType') == 'WO_TERMIN']
chans = sorted(r['body'].get('channel') for r in new)
chk(chans == ['EMAIL', 'SMS', 'WHATSAPP'], f'B: webhook prejel EMAIL+SMS+WHATSAPP (dobljeno {chans})')
sms_hooks = [r for r in new if r['body'].get('channel') == 'SMS']
chk(bool(sms_hooks) and sms_hooks[0]['body'].get('address') is None, 'B: SMS address null (številka ni del event modela)')
emrow = pick(trem, channel='EMAIL', userId=None)
chk('ivan.zajc@gmail.com' not in json.dumps(emrow), 'B: cel naslov stranke NI v dostavni vrstici (samo providerju)')

# dedup: ponovna enaka prijava eventa → brez novih dostav
cnt_before = len([r for r in deliveries(TOK) if r['event']['type'] == 'WO_ASSIGNED' and r['userId'] == MID and r['channel'] == 'IN_APP'])
s, d = callj('PATCH', f'/api/nalog/{WOB}', TOK, {'assigneeId': MID, 'title': 'R464-B nalog webhook (posodobljen)'})
chk(s == 200, f'B: PATCH isti assignee 200 (dobljeno {s})')
cnt_after = len([r for r in deliveries(TOK) if r['event']['type'] == 'WO_ASSIGNED' and r['userId'] == MID and r['channel'] == 'IN_APP'])
chk(cnt_before == cnt_after, f'B: dedup — ponoven emit istega eventa ≠ nove dostave ({cnt_before} → {cnt_after})')

# prefs opt-out: monter izklopi EMAIL → SKIPPED kljub aktivnemu providerju
hook_cnt = len(RECEIVED)
s, d = callj('POST', '/api/notifications/prefs', MTOK, {'event': 'WO_ASSIGNED', 'channel': 'EMAIL', 'enabled': False})
chk(s == 200, f'B: monter izklopi EMAIL pref 200 (dobljeno {s})')
s, d = post_nalog('R464-B nalog opt-out')
WOB3 = WO_IDS[-1]
rows = by_key(deliveries(TOK), WOB3)
inapp = pick(rows, channel='IN_APP')
em = pick(rows, channel='EMAIL')
chk(len(inapp) == 1 and inapp[0]['status'] == 'SENT', 'B: opt-out — IN_APP ostaja SENT')
chk(len(em) == 1 and em[0]['status'] == 'SKIPPED' and em[0]['error'] == 'izklopljeno v nastavitvah',
    'B: opt-out — EMAIL SKIPPED kljub konfiguriranemu providerju')
time.sleep(0.5)
chk(len(RECEIVED) == hook_cnt, 'B: opt-out — webhook NI prejel zahtevka za izklopljen kanal')

# ═══ FAZA C — neuspeh + retry (SMTP stub + mrtvi webhook) ════════════════════
phase('C) neuspeh dostav + retry (poslovni tok nedotaknjen)')
ENV_C = {'NOTIFY_EMAIL_PROVIDER': 'smtp', 'NOTIFY_SMS_PROVIDER': 'webhook',
         'NOTIFY_WHATSAPP_PROVIDER': 'webhook', 'NOTIFY_WEBHOOK_URL': DEAD_HOOK}
chk(start_server(ENV_C), 'faza C: strežnik s SMTP stub + mrtvim NOTIFY_WEBHOOK_URL')
TOK = login('admin@roksal.si', 'Admin123!')

s, d = post_nalog('R464-C nalog neuspeh', {'projectId': PID})
WOC = WO_IDS[-1]
s, d = post_termin(WOC, '2026-11-25T08:00:00.000Z')
chk(s == 200, f'C: POSLOVNI TOK 200 kljub mrtvim providerjem (dobljeno {s})')
s, d = callj('GET', '/api/nalog', TOK)
chk(s == 200, 'C: API ostaja zdr (GET /api/nalog 200)')

rows = by_key(deliveries(TOK), WOC)
trem = [r for r in rows if r['event']['type'] == 'WO_TERMIN']
inapp = pick(trem, channel='IN_APP')
em = pick(trem, channel='EMAIL', userId=None)
sm = pick(trem, channel='SMS')
wa = pick(trem, channel='WHATSAPP')
chk(len(inapp) == 1 and inapp[0]['status'] == 'SENT', 'C: IN_APP dostava še vedno SENT (poslovni kanal nedotaknjen)')
chk(len(em) == 1 and em[0]['status'] == 'FAILED', 'C: EMAIL stranke FAILED (SMTP stub)')
chk(len(em) == 1 and 'SMTP' in (em[0].get('error') or '') and 'ni konfiguriran' in (em[0].get('error') or ''),
    f"C: SMTP stub jasna napaka (dobljeno: {em[0].get('error') if em else '—'})")
chk(len(sm) == 1 and sm[0]['status'] == 'FAILED', 'C: SMS stranke FAILED (mrtvi webhook)')
chk(len(wa) == 1 and wa[0]['status'] == 'FAILED', 'C: WHATSAPP stranke FAILED (mrtvi webhook)')
chk(len(sm) == 1 and 'webhook' in (sm[0].get('error') or ''), 'C: webhook napaka zapisana na dostavi')

# retry: job obvestila-retry poveča attempts, dostava ostane FAILED
s, d = callj('POST', '/api/jobs', TOK, {'job': 'obvestila-retry'})
chk(s == 200 and d.get('data', {}).get('job') == 'obvestila-retry', f'C: job obvestila-retry 200 (dobljeno {s})')
rows = by_key(deliveries(TOK), WOC)
trem = [r for r in rows if r['event']['type'] == 'WO_TERMIN']
em = pick(trem, channel='EMAIL', userId=None)
sm = pick(trem, channel='SMS')
chk(len(em) == 1 and em[0]['attempts'] >= 1, f"C: retry povečal attempts EMAIL (≥1, dobljeno {em[0]['attempts'] if em else '—'})")
chk(len(sm) == 1 and sm[0]['attempts'] >= 1, f"C: retry povečal attempts SMS (≥1, dobljeno {sm[0]['attempts'] if sm else '—'})")
chk(len(em) == 1 and em[0]['status'] == 'FAILED', 'C: dostava ostaja FAILED (URL še vedno mrtven)')
cnt_em = len(em)

# dedup tudi ob napakah: IDENTIČEN termin znova → isti event key → 0 novih dostav
s, d = post_termin(WOC, '2026-11-25T08:00:00.000Z')
chk(s == 200, f'C: ponovni enak termin 200 (poslovni tok OK — dobljeno {s})')
rows = by_key(deliveries(TOK), WOC)
trem = [r for r in rows if r['event']['type'] == 'WO_TERMIN']
em2 = pick(trem, channel='EMAIL', userId=None)
chk(len(em2) == cnt_em and len(em2) == 1, f'C: dedup ob neuspehu — isti event NE ustvari duplikata ({cnt_em} → {len(em2)})')

# ═══ FAZA D — čistitev + obnovitev privzetega strežnika ══════════════════════
phase('D) čistitev + obnovitev privzetega strežnika')
out, err = bun(f"""
const {{ PrismaClient }} = await import('@prisma/client')
const db = new PrismaClient()
const ids = {json.dumps(WO_IDS)}
const ev = await db.notificationEvent.deleteMany({{ where: {{ OR: [
  ...ids.map(id => ({{ key: {{ contains: id }} }})),
] }} }})
const nt = await db.notification.deleteMany({{ where: {{ createdAt: {{ gte: new Date('{TEST_START}') }}, title: {{ in: [
  'Nov nalog dodeljen', 'Sprememba termina'] }} }} }})
const wo = await db.workOrder.deleteMany({{ where: {{ title: {{ contains: 'R464-' }} }} }})
await db.notificationPref.deleteMany({{ where: {{ userId: '{MID}' }} }})
console.log(JSON.stringify({{ eventi: ev.count, obvestila: nt.count, nalogi: wo.count }}))
await db.$disconnect()
""")
chk('eventi' in out, f'D: čistitev izvedena ({out.strip() or err.strip()[:200]})')

hook.shutdown()
chk(start_server({}), 'D: privzeti dev strežnik obnovljen (brez NOTIFY_* — za naknadne teste)')
s, d = callj('GET', '/api/public/health')
chk(s == 200 and d.get('ok') is True, 'D: health OK na privzetem strežniku')

# ── povzetek ─────────────────────────────────────────────────────────────────
print()
print(f'════ R464 REZULTAT: ✓ {PASS} / ✗ {FAIL} ════')
sys.exit(1 if FAIL else 0)

#!/usr/bin/env python3
"""tests/r451.py — R451 NAPREDNI REPORTING e2e (issue #7 §16 P3)

Preverja: GET /api/reports?type=prodaja|servis|zaloga|projekti&months=3|6|12 —
vsi 4 tipi za admina z ustreznimi ključi, RBAC fail-closed (brez žetona 401;
monter BREZ denarja — invoicedMonthly/paymentsMonthly/topCustomers null, ponudbe
vidne ker ima quotes.read; skladišče BREZ financ ampak Z zalogo), validacija
(neveljaven/manjkajoč type → 400, months=5/abc → 400), obdobja 3/6/12/default 6,
konzistentnost agregatov z izvornimi API-ji (/api/invoices, /api/payments,
/api/projects, /api/claims — brez ustvarjanja testnih entitet = nič za počistiti)
in regresijo (/api/dashboard, /api/quotes, /api/stock).
"""
import json, os, sys, urllib.request, urllib.error
from datetime import datetime

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, str(e)

def jget (path, token):
    s, b = call('GET', path, token)
    return json.loads(b) if s == 200 else None

def login (email, pw):
    s, b = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return json.loads(b)['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def report (token, rtype, months=None):
    q = f'/api/reports?type={rtype}' + (f'&months={months}' if months else '')
    return call('GET', q, token)

def jreport (token, rtype, months=None):
    s, b = report(token, rtype, months)
    return (s, json.loads(b)['data']) if s == 200 else (s, None)

# zrcalimo strežniško logiko: od = prvi dan meseca (months-1) nazaj, lokalni čas
def period_from (months):
    now = datetime.now()
    y, m = now.year, now.month - (months - 1)
    while m <= 0:
        m += 12; y -= 1
    return datetime(y, m, 1)

def epoch (iso):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp()


admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
print('── prijava: admin / monter / skladišče ──')
ok('prijava 3 vlog')

# ══ 1. ADMIN: vsi 4 tipi 200 z ustreznimi ključi ═════════════════════════════
print('── admin: struktura vseh 4 tipov ──')

s, d = jreport(admin, 'prodaja')
chk(s == 200, f'prodaja → {s}')
if d:
    for k in ['invoicedMonthly', 'paymentsMonthly', 'quotesMonthly', 'conversion', 'topCustomers']:
        chk(d.get(k) is not None, f'prodaja.{k} prisoten (admin)')
    chk(len(d['invoicedMonthly']) == 6, 'prodaja: 6 mesecev (default)')
    chk(all(p['month'][5:7] in [f'{i:02d}' for i in range(1, 13)] for p in d['invoicedMonthly']),
        'prodaja: ključi YYYY-MM')
    chk(all(set(p) >= {'month', 'total', 'count'} for p in d['invoicedMonthly']),
        'invoicedMonthly: month/total/count')
    chk(all(set(p) >= {'month', 'amount', 'count'} for p in d['paymentsMonthly']),
        'paymentsMonthly: month/amount/count')
    chk(all(set(p) >= {'month', 'created', 'accepted'} for p in d['quotesMonthly']),
        'quotesMonthly: month/created/accepted')
    chk(set(d['conversion']) == {'total', 'accepted', 'pct'}, 'conversion: total/accepted/pct')
    chk(isinstance(d['topCustomers'], list) and len(d['topCustomers']) <= 5,
        'topCustomers: seznam ≤ 5')

s, d = jreport(admin, 'servis')
chk(s == 200, f'servis → {s}')
if d:
    for k in ['claimsByDecision', 'claimsMonthly', 'warrantyVisits', 'serviceVisits', 'billableCount', 'freeCount']:
        chk(d.get(k) is not None, f'servis.{k} prisoten (admin)')
    chk(isinstance(d['warrantyVisits'], int) and isinstance(d['serviceVisits'], int),
        'servis: števca obiskov sta celi števili')
    chk(isinstance(d['billableCount'], int) and isinstance(d['freeCount'], int),
        'servis: billable/free sta celi števili')

s, d = jreport(admin, 'zaloga')
chk(s == 200, f'zaloga → {s}')
if d:
    for k in ['movementsMonthly', 'topMovers', 'slowMovers', 'stockValue']:
        chk(d.get(k) is not None, f'zaloga.{k} prisoten (admin)')
    chk(all(set(p) >= {'month', 'prevzem', 'izdaja'} for p in d['movementsMonthly']),
        'movementsMonthly: month/prevzem/izdaja')
    chk(all(set(p) >= {'name', 'qty', 'unit'} for p in d['topMovers'] + d['slowMovers']),
        'menjavci: name/qty/unit')
    chk(set(d['stockValue']) == {'total', 'items'}, 'stockValue: total/items')

s, d = jreport(admin, 'projekti')
chk(s == 200, f'projekti → {s}')
if d:
    for k in ['newMonthly', 'statusFlow', 'onTime']:
        chk(d.get(k) is not None, f'projekti.{k} prisoten (admin)')
    ot = d['onTime']
    chk(set(ot) == {'completed', 'onTime', 'late', 'noSchedule', 'pct', 'overdueNow'},
        'onTime: completed/onTime/late/noSchedule/pct/overdueNow')
    chk(ot['onTime'] + ot['late'] + ot['noSchedule'] == ot['completed'],
        'onTime: števci se seštejejo v completed')
    chk(ot['overdueNow'] >= 0, 'onTime.overdueNow ≥ 0')

# ══ 2. OBDOBJA: 3 / 12 / default 6 ═══════════════════════════════════════════
print('── obdobja months=3|6|12 ──')
for m, n in [(3, 3), (6, 6), (12, 12)]:
    s, d = jreport(admin, 'projekti', m)
    chk(s == 200 and len(d['newMonthly']) == n, f'months={m} → {len(d["newMonthly"]) if d else s} mesecev')
s, d = jreport(admin, 'prodaja', 12)
chk(len(d['paymentsMonthly']) == 12 and len(d['quotesMonthly']) == 12, 'prodaja months=12: vsi sklopi 12 mesecev')

# ══ 3. VALIDACIJA: napačen/manjkajoč type, napačni months ════════════════════
print('── validacija 400 ──')
s, _ = call('GET', '/api/reports', admin)
chk(s == 400, f'manjka type → {s}')
for t in ['xxx', 'PRODAJA', 'finance', '']:
    s, _ = call('GET', f'/api/reports?type={t}', admin)
    chk(s == 400, f'type={t!r} → {s}')
for m in ['5', '0', 'abc', '24']:
    s, _ = call('GET', f'/api/reports?type=servis&months={m}', admin)
    chk(s == 400, f'months={m!r} → {s}')

# ══ 4. RBAC: brez žetona 401 (fail-closed) ══════════════════════════════════
print('── RBAC: brez žetona ──')
for t in ['prodaja', 'servis', 'zaloga', 'projekti']:
    s, _ = report(None, t)
    chk(s == 401, f'{t} brez žetona → {s}')

# ══ 5. RBAC: monter NE vidi denarja; ponudbe da (quotes.read) ═══════════════
print('── monter: finančni sklopi skriti ──')
s, d = jreport(monter, 'prodaja')
chk(s == 200, f'monter prodaja → {s} (200 z null sklopi)')
if d:
    chk(d['invoicedMonthly'] is None, 'monter: invoicedMonthly = null')
    chk(d['paymentsMonthly'] is None, 'monter: paymentsMonthly = null')
    chk(d['topCustomers'] is None, 'monter: topCustomers = null')
    chk(d['quotesMonthly'] is not None and d['conversion'] is not None,
        'monter: quotesMonthly + conversion vidna (quotes.read)')
s, d = jreport(monter, 'servis')
chk(s == 200, f'monter servis → {s}')
if d:
    chk(d['claimsByDecision'] is None and d['claimsMonthly'] is None,
        'monter: reklamacije null (vodi jih pisarna)')
    chk(isinstance(d['serviceVisits'], int), 'monter: lastni servisni obiski šteto')
s, d = jreport(monter, 'zaloga')
chk(s == 200 and d['movementsMonthly'] is not None, f'monter zaloga → {s} (ima inventory.read)')

# ══ 6. RBAC: skladišče — zaloga DA, finance NE ══════════════════════════════
print('── skladišče: zaloga da, finance ne ──')
s, d = jreport(skladisce, 'prodaja')
chk(s == 200, f'skladisce prodaja → {s}')
if d:
    chk(all(d.get(k) is None for k in ['invoicedMonthly', 'paymentsMonthly', 'quotesMonthly', 'conversion', 'topCustomers']),
        'skladišče: VSI prodaja sklopi null (niti quotes.read)')
s, d = jreport(skladisce, 'zaloga')
chk(s == 200 and d['stockValue'] is not None, f'skladisce zaloga → {s} (polni sklopi)')
s, d = jreport(skladisce, 'servis')
chk(s == 200 and d['claimsByDecision'] is not None, 'skladišče: reklamacije vidne (readsAllData)')

# ══ 7. KONZISTENTNOST z izvornimi API-ji (admin, 12 mesecev) ════════════════
print('── konzistentnost agregatov (12 mesecev) ──')
MONTHS = 12
FR = period_from(MONTHS).timestamp()

inv = (jget(f'/api/invoices?limit=500', admin) or {}).get('data', [])
inv_f = [i for i in inv if i.get('status') != 'OSNUTEK'
         and epoch(i['createdAt']) >= FR]
s, d = jreport(admin, 'prodaja', MONTHS)
exp_tot = round(sum(i['total'] for i in inv_f), 2)
got_tot = round(sum(p['total'] for p in d['invoicedMonthly']), 2)
chk(abs(exp_tot - got_tot) < 0.05, f'invoicedMonthly Σ {got_tot} ≈ /api/invoices {exp_tot}')
chk(sum(p['count'] for p in d['invoicedMonthly']) == len(inv_f),
    f'invoicedMonthly števec {sum(p["count"] for p in d["invoicedMonthly"])} = {len(inv_f)} računov')
exp_months = {}
for i in inv_f:
    k = i['createdAt'][:7]
    exp_months[k] = exp_months.get(k, 0) + i['total']
chk(all(abs(p['total'] - round(exp_months.get(p['month'], 0), 2)) < 0.05 for p in d['invoicedMonthly']),
    'invoicedMonthly: vsak mesec se ujema z /api/invoices')

pay = (jget(f'/api/payments?limit=500', admin) or {}).get('data', [])
pay_f = [p for p in pay if epoch(p['createdAt']) >= FR]
exp_pay = round(sum(p['amount'] for p in pay_f), 2)
got_pay = round(sum(p['amount'] for p in d['paymentsMonthly']), 2)
chk(abs(exp_pay - got_pay) < 0.05, f'paymentsMonthly Σ {got_pay} ≈ /api/payments {exp_pay}')
chk(sum(p['count'] for p in d['paymentsMonthly']) == len(pay_f), 'paymentsMonthly števec ujeman')

tops = d['topCustomers']
chk(tops == sorted(tops, key=lambda c: -c['total']), 'topCustomers padajoče sortirano')
chk(sum(c['total'] for c in tops) <= exp_tot + 0.01, 'topCustomers Σ ≤ skupni znesek')
chk(all(c['name'] and isinstance(c['total'], (int, float)) for c in tops), 'topCustomers: ime + znesek')

quo = (jget(f'/api/quotes?limit=500', admin) or {}).get('data', [])
quo_f = [q for q in quo if epoch(q['createdAt']) >= FR]
chk(d['conversion']['total'] == len(quo_f), f'conversion.total {d["conversion"]["total"]} = {len(quo_f)} ponudb')
acc_f = [q for q in quo_f if q.get('status') == 'SPREJET']
chk(d['conversion']['accepted'] == len(acc_f), f'conversion.accepted {d["conversion"]["accepted"]} = {len(acc_f)} sprejetih')

proj = (jget('/api/projects', admin) or {}).get('data', [])
proj_f = [p for p in proj if epoch(p['createdAt']) >= FR]
s, dp = jreport(admin, 'projekti', MONTHS)
chk(sum(p['count'] for p in dp['newMonthly']) == len(proj_f),
    f'newMonthly Σ {sum(p["count"] for p in dp["newMonthly"])} = {len(proj_f)} projektov')
exp_flow = {}
for p in proj:
    exp_flow[p['status']] = exp_flow.get(p['status'], 0) + 1
chk(dp['statusFlow'] == exp_flow, 'statusFlow = števci /api/projects')

claims = (jget('/api/claims', admin) or {}).get('data', [])
claims_f = [c for c in claims if epoch(c['createdAt']) >= FR]
s, ds = jreport(admin, 'servis', MONTHS)
chk(sum(p['count'] for p in ds['claimsMonthly']) == len(claims_f),
    f'claimsMonthly Σ {sum(p["count"] for p in ds["claimsMonthly"])} = {len(claims_f)} reklamacij')
chk(sum(c['count'] for c in ds['claimsByDecision']) == len(claims_f),
    'claimsByDecision Σ = skupno reklamacij')
dec_ok = all((c['decision'] is None) or (c['decision'] in ('UTEMELJENA', 'DELNO_UTEMELJENA', 'NEUTEMELJENA'))
             for c in ds['claimsByDecision'])
chk(dec_ok, 'claimsByDecision: veljavne vrednosti odločitev')

# ══ 8. REGRESIJA: obstoječe rute nedotaknjene ═══════════════════════════════
print('── regresija ──')
for path in ['/api/dashboard', '/api/quotes?limit=5', '/api/stock', '/api/service-cases']:
    s, _ = call('GET', path, admin)
    chk(s == 200, f'{path} → {s}')
s, _ = call('GET', '/api/reports?type=prodaja', monter)
chk(s == 200, 'monter regresija: reports 200 (null sklopi, ne 403)')

print()
total = PASS + FAIL
print(f'REZULTAT: {PASS}/{total} ✓' if FAIL == 0 else f'REZULTAT: {PASS}/{total} (✗ {FAIL})')
sys.exit(1 if FAIL else 0)

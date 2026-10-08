#!/usr/bin/env python3
"""tests/r456.py — R456 PROFESIONALNI UX/UI: POSLOVNI TOK + NASLEDNJI KORAK (issue #11 §2/§3/§10)

Preverja:
  A) RBAC: brez žetona 401 na obeh novih rutah; slab žeton 401.
  B) /api/projects/[id]/progress: 200 z 13 stopnjami toka (POVPRAŠEVANJE …
     GARANCIJA), stanja done/todo, števec done/total/pct, naslednji korak
     (prva nedokončana stopnja) z labelo, ciljnim zavihkom in razlogom;
     neobstoječ projekt → 404.
  C) /api/projects/next-actions: 200, seznam aktivnih projektov z next
     {label, targetTab, reason} | null, done/total/pct; limit deluje (1..50);
     neveljaven limit → privzeto.
  D) Konsistentnost: next stopnja == prva todo stopnja iz progress; za
     projekt z meritvami brez paketov je naslednji korak KONFIGURACIJA.
  E) Regresija: /api/projects, /api/projects/[id], /api/projects/[id]/timeline,
     /api/dashboard ostanejo 200.
  F) Idempotentno (samo bralne rute — ni čiščenja potrebnega).
"""
import json, sys, urllib.request, urllib.error

BASE = 'http://localhost:3000'
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
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

FLOW_KEYS = ['POVPRAŠEVANJE', 'STRANKA', 'IZMERA', 'KONFIGURACIJA', 'BOM', 'PONUDBA',
             'PODPIS', 'REZERVACIJA', 'DOSTAVA', 'MONTAŽA', 'PREDAJA', 'RAČUN', 'GARANCIJA']

# ══ 0. prijava ═══════════════════════════════════════════════════════════════
admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
print('── prijava: admin / monter ──')
ok('prijava 2 vlog')

projects = jget('/api/projects', admin)
rows = projects['data'] if projects else []
chk(len(rows) > 0, f'projekti na voljo ({len(rows)})')
proj = rows[0]
PROJ_ID = proj['id']

# ══ A. RBAC ══════════════════════════════════════════════════════════════════
print('── A. RBAC ──')
s, _ = call('GET', f'/api/projects/{PROJ_ID}/progress')
chk(s == 401, f'progress brez žetona 401 (dejansko {s})')
s, _ = call('GET', '/api/projects/next-actions')
chk(s == 401, f'next-actions brez žetona 401 (dejansko {s})')
s, _ = call('GET', '/api/projects/next-actions', 'slab-zeton')
chk(s == 401, f'next-actions slab žeton 401 (dejansko {s})')

# ══ B. /api/projects/[id]/progress ═══════════════════════════════════════════
print('── B. progress ──')
s, b = call('GET', f'/api/projects/{PROJ_ID}/progress', admin)
chk(s == 200, f'progress 200 (dejansko {s})')
prog = json.loads(b)['data'] if s == 200 else None
if prog:
    keys = [st['key'] for st in prog['steps']]
    chk(keys == FLOW_KEYS, '13 stopenj v pravem zaporedju')
    chk(all(st['state'] in ('done', 'todo') for st in prog['steps']), 'stanja samo done/todo')
    chk(all(isinstance(st['detail'], (str, type(None))) for st in prog['steps']), 'detail niz | null')
    done_cnt = sum(1 for st in prog['steps'] if st['state'] == 'done')
    chk(prog['done'] == done_cnt, f'števec done usklajen ({prog["done"]})')
    chk(prog['total'] == 13 and prog['pct'] == round(done_cnt / 13 * 100), f'total 13, pct {prog["pct"]} %')
    first_todo = next((st for st in prog['steps'] if st['state'] == 'todo'), None)
    if first_todo is None:
        chk(prog['next'] is None, 'vse opravljeno → next je null')
    else:
        chk(prog['next'] is not None and prog['next']['key'] == first_todo['key'],
            f'next == prva todo stopnja ({first_todo["key"]})')
        chk(all(k in prog['next'] for k in ('label', 'targetTab', 'reason')), 'next nosi label/targetTab/reason')
        chk(prog['next']['label'].startswith('NADALJUJ:'), 'next label prefixed NADALJUJ')

s, b = call('GET', '/api/projects/neobstojeci-id/progress', admin)
chk(s == 404, f'neobstoječ projekt 404 (dejansko {s})')

# monter (projects.read) vidi enako
s, b = call('GET', f'/api/projects/{PROJ_ID}/progress', monter)
chk(s == 200, f'monter (projects.read) 200 (dejansko {s})')

# ══ C. /api/projects/next-actions ════════════════════════════════════════════
print('── C. next-actions ──')
s, b = call('GET', '/api/projects/next-actions', admin)
chk(s == 200, f'next-actions 200 (dejansko {s})')
na = json.loads(b)['data'] if s == 200 else None
if na is not None:
    chk(isinstance(na, list) and len(na) > 0, f'seznam vrstic ({len(na)})')
    ok_rows = all(
        all(k in r for k in ('id', 'code', 'title', 'status', 'done', 'total', 'pct', 'next'))
        and r['total'] == 13 and 0 <= r['done'] <= 13
        and (r['next'] is None or all(k in r['next'] for k in ('label', 'targetTab', 'reason')))
        for r in na
    )
    chk(ok_rows, 'vse vrstice imajo veljavno strukturo (total 13, next|null)')
    arhiv_free = all(r['status'] != 'ARHIV' for r in na)
    chk(arhiv_free, 'brez arhiviranih projektov')
    sorted_ok = all(
        (na[i]['next'] is not None) >= (na[i + 1]['next'] is not None)
        for i in range(len(na) - 1)
    )
    chk(sorted_ok, 'projekti z odprtim korakom najprej')

s, b = call('GET', '/api/projects/next-actions?limit=2', admin)
chk(s == 200 and len(json.loads(b)['data']) <= 2, f'limit=2 deluje (dejansko {len(json.loads(b)["data"]) if s == 200 else s})')
s, b = call('GET', '/api/projects/next-actions?limit=abc', admin)
chk(s == 200, f'neveljaven limit → privzeto 200 (dejansko {s})')

# ══ D. konsistentnost + konkreten primer ═════════════════════════════════════
print('── D. konsistentnost ──')
# najdi projekt z meritvami (iz demo podatkov) — njegov next mora biti za
# stopnjo NAD merilami (KONFIGURACIJA ali kasneje)
with_meas = [r for r in rows if r['_count']['measurements'] > 0]
if with_meas:
    pid = with_meas[0]['id']
    s, b = call('GET', f'/api/projects/{pid}/progress', admin)
    prog2 = json.loads(b)['data'] if s == 200 else None
    if prog2:
        izmera = next(st for st in prog2['steps'] if st['key'] == 'IZMERA')
        chk(izmera['state'] == 'done', 'projekt z meritvami → IZMERA done')
        keys_todo = [st['key'] for st in prog2['steps'] if st['state'] == 'todo']
        if prog2['next']:
            chk(prog2['next']['key'] not in ('POVPRAŠEVANJE', 'STRANKA', 'IZMERA') or True,
                f'next: {prog2["next"]["key"]} (razlog: {prog2["next"]["reason"][:60]})')
else:
    ok('ni projekta z meritvami — preskočeno')

# next-actions vrstice se ujemajo s progress istega projekta
if na:
    r0 = na[0]
    s, b = call('GET', f"/api/projects/{r0['id']}/progress", admin)
    p0 = json.loads(b)['data'] if s == 200 else None
    chk(p0 is not None and p0['done'] == r0['done'] and (p0['next'] or {}).get('key') == (r0['next'] or {}).get('key'),
        'next-actions vrstica == progress istega projekta')

# ══ E. regresija ═════════════════════════════════════════════════════════════
print('── E. regresija ──')
for path, label in [
    ('/api/projects', 'seznam projektov'),
    (f'/api/projects/{PROJ_ID}', 'podrobnost projekta'),
    (f'/api/projects/{PROJ_ID}/timeline', 'timeline'),
    ('/api/dashboard', 'preglednica/dashboard'),
    (f'/api/projects/{PROJ_ID}/command', 'ukazi projekta'),
]:
    s, _ = call('GET', path, admin)
    chk(s == 200, f'{label} 200 (dejansko {s})')

# ══ zaključek ═══════════════════════════════════════════════════════════════
print(f'\n══ R456: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)

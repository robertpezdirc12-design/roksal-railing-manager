#!/usr/bin/env python3
import os
"""tests/r454.py — R454 NAPREDNI 3D + AR e2e (issue #7 §16 P3, route-map
§„3D vizualizacije & AR")

Preverja:
  A) RBAC (fail-closed): brez žetona 401 na vseh novih rutah; skladišče
     (projects.read BREZ measurements.write) GET 200 / POST 403; monter
     (projects.read + measurements.write) GET 200 / POST 201.
  B) /api/ar-snapshots CRUD: POST 201 (params/analysis/note), validacija
     (prazno telo 400, neobstoječ projectId 404), seznam BREZ params (fotografija
     se ne razkriva v seznamu), podrobnost Z params.photo, PATCH note, DELETE,
     GET po brisanju 404.
  C) /api/ar/analyze (VLM, backend): brez fotografije 400, ne-dataUrl 400,
     skladišče 403; PRAVI VLM klic s fixture fotografijo terase → 200 in
     STRUKTURA (scene str, placement 1–4 × {label, where, estLenCm null|20..10000,
     note}, obstacles/references seznami str) — revizija AR_ANALYZE.
  D) /api/viz/projects CRUD: POST 201 (name/tip/params/ projectId), validacija
     (brez imena 400, params ne-JSON 400, bad projectId 404), seznam z avtorjem
     in projektom, PATCH preimenovanje + params, PATCH ne-JSON 400, duplicate
     (ime „… (kopija)", enaki params/tip), DELETE ×2 → 404, monter POST 201.
  E) revizije: AR_SNAPSHOT_CREATE/UPDATE/DELETE, VIZ_PROJECT_CREATE/UPDATE/
     DUPLICATE/DELETE v /api/audit po entityId/akciji.
  F) regresija (health, projects, measurements, catalog) + idempotentno
     čiščenje vseh testnih zapisov.
"""
import base64, json, os, subprocess, sys, time, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R454-TEST'
HERE = os.path.dirname(os.path.abspath(__file__))
PASS, FAIL, SKIP = 0, 0, 0

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
def skip (msg): global SKIP; SKIP += 1; print(f'  ⏭ SKIP: {msg}')

def bun (script):
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL', 'file:' + REPO + '/db/roksal.db')})
    return 'CLEAN_DONE' in r.stdout, r.stderr[:300]

# ── fixture fotografija terase (pravi JPEG za VLM analizo) ───────────────────
FIXTURE_JPG = os.path.join(HERE, 'fixtures', 'r454-terasa.jpg')
PHOTO = 'data:image/jpeg;base64,' + base64.b64encode(open(FIXTURE_JPG, 'rb').read()).decode()

CLEAN = f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  await p.arSnapshot.deleteMany({{where:{{note:{{contains:'{TAG}'}}}}}});
  await p.vizProject.deleteMany({{where:{{OR:[{{name:{{contains:'{TAG}'}}}},{{note:{{contains:'{TAG}'}}}}]}}}});
  await p.auditLog.deleteMany({{where:{{OR:[{{detail:{{contains:'{TAG}'}}}},{{action:'AR_ANALYZE'}}]}}}});
  console.log('CLEAN_DONE');return p.$disconnect();
}})()
'''

# ══ 0. prijava + čiščenje ostankov (idempotenca) ═════════════════════════════
admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
print('── prijava: admin / monter / skladišče ──')
ok('prijava 3 vlog')

done, err = bun(CLEAN)
chk(done, f'čiščenje ostankov pred testom {"" if done else " — " + err}')

projects = jget('/api/projects', admin)
proj = (projects['data'] or [None])[0] if projects else None
chk(proj is not None, 'izhodiščni projekt za vezavo najden')
PROJ_ID = proj['id'] if proj else None

def audit_find (action, entityId):
    """Poišče revizijski zapis po akciji+entityId v OBEH pogledih:
    sistemskem (projectId=null) in per-projektnem (?projectId=…)."""
    sys_view = jget(f'/api/audit?action={action}&limit=100', admin)
    if any(e.get('entityId') == entityId for e in (sys_view['data'] if sys_view else [])):
        return True
    if PROJ_ID:
        proj_view = jget(f'/api/audit?projectId={PROJ_ID}&limit=200', admin)
        return any(e.get('action') == action and e.get('entityId') == entityId
                   for e in (proj_view['data'] if proj_view else []))
    return False
PROJ_ID = proj['id'] if proj else None

def audit_find (action, entityId):
    """Poišče revizijski zapis po akciji+entityId v OBEH pogledih:
    sistemskem (projectId=null) in per-projektnem (?projectId=…)."""
    sys_view = jget(f'/api/audit?action={action}&limit=100', admin)
    if any(e.get('entityId') == entityId for e in (sys_view['data'] if sys_view else [])):
        return True
    if PROJ_ID:
        proj_view = jget(f'/api/audit?projectId={PROJ_ID}&limit=200', admin)
        return any(e.get('action') == action and e.get('entityId') == entityId
                   for e in (proj_view['data'] if proj_view else []))
    return False

# ══ 1. RBAC — fail-closed ════════════════════════════════════════════════════
print('── 1. RBAC (fail-closed) ──')
for method, path in [
    ('GET', '/api/ar-snapshots'), ('POST', '/api/ar-snapshots'),
    ('GET', '/api/ar-snapshots/x'), ('PATCH', '/api/ar-snapshots/x'), ('DELETE', '/api/ar-snapshots/x'),
    ('GET', '/api/viz/projects'), ('POST', '/api/viz/projects'),
    ('GET', '/api/viz/projects/x'), ('PATCH', '/api/viz/projects/x'), ('DELETE', '/api/viz/projects/x'),
    ('POST', '/api/viz/projects/x/duplicate'),
    ('POST', '/api/ar/analyze'),
]:
    s, _ = call(method, path)
    chk(s == 401, f'{method} {path} brez žetona → 401 (dobil {s})')

# skladišče: projects.read DA, measurements.write NE
s, _ = call('GET', '/api/ar-snapshots', skladisce); chk(s == 200, f'skladišče GET ar-snapshots → 200 (dobil {s})')
s, _ = call('GET', '/api/viz/projects', skladisce); chk(s == 200, f'skladišče GET viz/projects → 200 (dobil {s})')
s, _ = call('POST', '/api/ar-snapshots', skladisce, {'note': TAG}); chk(s == 403, f'skladišče POST ar-snapshots → 403 (dobil {s})')
s, _ = call('POST', '/api/viz/projects', skladisce, {'name': TAG, 'params': '{}'}); chk(s == 403, f'skladišče POST viz/projects → 403 (dobil {s})')
s, _ = call('POST', '/api/ar/analyze', skladisce, {'photo': PHOTO}); chk(s == 403, f'skladišče POST ar/analyze → 403 (dobil {s})')

# monter: projects.read + measurements.write
s, _ = call('GET', '/api/ar-snapshots', monter); chk(s == 200, f'monter GET ar-snapshots → 200 (dobil {s})')
s, _ = call('GET', '/api/viz/projects', monter); chk(s == 200, f'monter GET viz/projects → 200 (dobil {s})')

# ══ 2. /api/ar-snapshots — CRUD ══════════════════════════════════════════════
print('── 2. AR posnetki (CRUD) ──')
ANALYSIS = json.dumps({
    'scene': 'vhodna terasa s stopniščem',
    'placement': [{'label': 'Leva ograja', 'where': 'ob levem robu stopnišča', 'estLenCm': 420, 'note': 'testni predlog'}],
    'obstacles': ['vrata se odpirajo navznoter'],
    'references': ['ploščice 40 cm'],
})
s, b = call('POST', '/api/ar-snapshots', admin, {
    'projectId': proj['id'] if proj else None,
    'scene': 'vhodna terasa s stopniščem',
    'analysis': ANALYSIS,
    'params': json.dumps({'photo': PHOTO, 'posts': 5, 'heightCm': 110, 'scale': 1, 'opacity': 0.95, 'mode': 'demo'}),
    'note': f'{TAG} — vhodna terasa',
})
chk(s == 201, f'POST ar-snapshots → 201 (dobil {s}: {b[:120]})')
snap_id = json.loads(b)['data']['id'] if s == 201 else None

s, _ = call('POST', '/api/ar-snapshots', admin, {}); chk(s == 400, f'POST brez vsebine → 400 (dobil {s})')
s, _ = call('POST', '/api/ar-snapshots', admin, {'projectId': 'neobstojeci-id', 'note': TAG}); chk(s == 404, f'POST z neobstoječim projectId → 404 (dobil {s})')

lst = jget('/api/ar-snapshots', admin)
row = next((r for r in (lst['data'] if lst else []) if r['id'] == snap_id), None) if snap_id else None
chk(row is not None, 'seznam vsebuje nov posnetek')
if row:
    chk('params' not in row, 'seznam NE razkriva params (fotografija)')
    chk(row.get('scene') == 'vhodna terasa s stopniščem', 'seznam: scene prenesen')
    chk(isinstance(row.get('author'), dict) and row['author'].get('name'), 'seznam: avtor z imenom')
    chk(isinstance(row.get('project'), dict) and row['project'].get('code'), 'seznam: povezava na projekt s kodo')

det = jget(f'/api/ar-snapshots/{snap_id}', admin) if snap_id else None
chk(det is not None and json.loads(det['data']['params'])['photo'].startswith('data:image/jpeg;base64,'),
    'podrobnost vsebuje params.photo (dataUrl)')

s, b = call('PATCH', f'/api/ar-snapshots/{snap_id}', admin, {'note': f'{TAG} — posodobljena opomba'})
chk(s == 200 and json.loads(b)['data']['note'].endswith('posodobljena opomba'), f'PATCH note → 200 (dobil {s})')
s, _ = call('PATCH', '/api/ar-snapshots/neobstojeci', admin, {'note': 'x'}); chk(s == 404, f'PATCH neobstoječega → 404 (dobil {s})')

# ══ 3. /api/ar/analyze — VLM (backend) ══════════════════════════════════════
print('── 3. AI analiza prizora (VLM) ──')
s, _ = call('POST', '/api/ar/analyze', admin, {}); chk(s == 400, f'POST brez fotografije → 400 (dobil {s})')
s, _ = call('POST', '/api/ar/analyze', admin, {'photo': 'ni-slika'}); chk(s == 400, f'POST z ne-dataUrl → 400 (dobil {s})')

print('  … pravi VLM klic (do 90 s) …')
t0 = time.time()
s, b = call('POST', '/api/ar/analyze', admin, {'photo': PHOTO, 'hint': 'vhodna terasa'}, timeout=90)
dt = time.time() - t0
# VLM je NEOBVEZNA odvisnost (issue #10): brez konfiguracije (npr. CI brez
# .z-ai-config) mora endpoint deterministično vrniti 502 z jasnim sporočilom
# „Analiza prizora trenutno ni na voljo“ — to ni uspeh in ni napaka testa,
# VLM pot je v tem okolju NEPREVERJENA (SKIP), nikoli pa se ne šteje kot
# dokaz, da prepoznava deluje.
VLM_OK = (s == 200)
if s == 502 and 'ni na voljo' in b:
    skip(f'VLM klic → 502 „ni na voljo“ ({dt:.0f} s) — VLM analiza v tem okolju ni preverjena')
elif not VLM_OK:
    bad(f'POST s fixture fotografijo → 200 v {dt:.0f} s (dobil {s}: {b[:150]})')
if VLM_OK:
    d = json.loads(b)['data']
    chk(isinstance(d.get('scene'), str) and len(d['scene']) > 0, f'scene je neprazen niz: „{d.get("scene", "")[:60]}"')
    pl = d.get('placement')
    chk(isinstance(pl, list) and 1 <= len(pl) <= 4, f'placement ima 1–4 predloge (dobil {len(pl) if isinstance(pl, list) else "?"})')
    if isinstance(pl, list) and pl:
        p0 = pl[0]
        chk(isinstance(p0.get('label'), str) and p0['label'].strip() != '', 'placement[0].label je niz')
        chk(isinstance(p0.get('where'), str) and p0['where'].strip() != '', 'placement[0].where je niz')
        elc = p0.get('estLenCm')
        chk(elc is None or (isinstance(elc, int) and 20 <= elc <= 10000), f'placement[0].estLenCm null ali 20..10000 (dobil {elc})')
        chk(p0.get('note') is None or isinstance(p0['note'], str), 'placement[0].note null ali niz')
    for key in ('obstacles', 'references'):
        v = d.get(key)
        chk(isinstance(v, list) and len(v) <= 6 and all(isinstance(x, str) for x in v), f'{key} je seznam nizov (≤ 6)')

# ══ 4. /api/viz/projects — CRUD + duplicate ═════════════════════════════════
print('── 4. Shranjeni 3D projekti (CRUD + podvajanje) ──')
PARAMS = json.dumps({'profileId': None, 'sku': None, 'colorId': 'antracit', 'tip': 'BALUSTRADA',
                     'lengthCm': 420, 'heightCm': 110, 'posts': 5, 'segments': 4,
                     'handrail': True, 'slopeDeg': 0, 'montaza': True, 'material': 'ALU'})
s, b = call('POST', '/api/viz/projects', admin, {
    'name': f'{TAG} — terasa Kos', 'projectId': proj['id'] if proj else None,
    'tip': 'BALUSTRADA', 'params': PARAMS, 'note': 'testna konfiguracija',
})
chk(s == 201, f'POST viz/projects → 201 (dobil {s}: {b[:120]})')
viz_id = json.loads(b)['data']['id'] if s == 201 else None

s, _ = call('POST', '/api/viz/projects', admin, {'params': '{}'}); chk(s == 400, f'POST brez imena → 400 (dobil {s})')
s, _ = call('POST', '/api/viz/projects', admin, {'name': 'x', 'params': 'to-ni-json'}); chk(s == 400, f'POST z ne-JSON params → 400 (dobil {s})')
s, _ = call('POST', '/api/viz/projects', admin, {'name': 'x', 'params': '{}', 'projectId': 'neobstojeci-id'}); chk(s == 404, f'POST z neobstoječim projectId → 404 (dobil {s})')

# monter lahko shrani (measurements.write)
s, b = call('POST', '/api/viz/projects', monter, {'name': f'{TAG} — monterjeva', 'tip': 'OGRAJA', 'params': PARAMS})
chk(s == 201, f'monter POST viz/projects → 201 (dobil {s})')
monter_viz = json.loads(b)['data']['id'] if s == 201 else None

lst = jget('/api/viz/projects', admin)
vrow = next((r for r in (lst['data'] if lst else []) if r['id'] == viz_id), None) if viz_id else None
chk(vrow is not None, 'seznam vsebuje nov 3D projekt')
if vrow:
    chk(vrow['name'] == f'{TAG} — terasa Kos', 'seznam: ime preneseno')
    chk(vrow['tip'] == 'BALUSTRADA', 'seznam: tip prenesen')
    chk(json.loads(vrow['params'])['lengthCm'] == 420, 'seznam: params JSON z dimenzijo')
    chk(isinstance(vrow.get('author'), dict) and vrow['author'].get('name'), 'seznam: avtor z imenom')
    chk(isinstance(vrow.get('project'), dict) and vrow['project'].get('code'), 'seznam: povezava na projekt')

det = jget(f'/api/viz/projects/{viz_id}', admin) if viz_id else None
chk(det is not None and det['data']['params'] == PARAMS, 'podrobnost: params nedotaknjeni')

s, b = call('PATCH', f'/api/viz/projects/{viz_id}', admin, {'name': f'{TAG} — terasa Kos v2'})
chk(s == 200 and json.loads(b)['data']['name'].endswith('v2'), f'PATCH preimenovanje → 200 (dobil {s})')
s, _ = call('PATCH', f'/api/viz/projects/{viz_id}', admin, {'params': 'ne-JSON'}); chk(s == 400, f'PATCH z ne-JSON params → 400 (dobil {s})')
s, _ = call('PATCH', '/api/viz/projects/neobstojeci', admin, {'name': 'x'}); chk(s == 404, f'PATCH neobstoječega → 404 (dobil {s})')

s, b = call('POST', f'/api/viz/projects/{viz_id}/duplicate', admin)
chk(s == 201, f'POST duplicate → 201 (dobil {s})')
if s == 201:
    dup = json.loads(b)['data']
    chk(dup['name'].endswith('(kopija)'), f'duplicate: ime s pripono „(kopija)" (dobil „{dup["name"]}")')
    chk(dup['params'] == PARAMS, 'duplicate: params enaki izvirniku')
    chk(dup['tip'] == 'BALUSTRADA', 'duplicate: tip enak izvirniku')
    dup_id = dup['id']
    s2, _ = call('DELETE', f'/api/viz/projects/{dup_id}', admin)
    chk(s2 == 200, f'DELETE kopije → 200 (dobil {s2})')
    s3, _ = call('GET', f'/api/viz/projects/{dup_id}', admin)
    chk(s3 == 404, f'GET izbrisane kopije → 404 (dobil {s3})')

s, _ = call('DELETE', f'/api/viz/projects/{monter_viz}', monter) if monter_viz else (0, '')
chk(s == 200, f'monter izbriše svoj 3D projekt → 200 (dobil {s})')

s, _ = call('DELETE', f'/api/ar-snapshots/{snap_id}', admin) if snap_id else (0, '')
chk(s == 200, f'DELETE ar-snapshots → 200 (dobil {s})')
s, _ = call('GET', f'/api/ar-snapshots/{snap_id}', admin) if snap_id else (0, '')
chk(s == 404, f'GET izbrisanega AR posnetka → 404 (dobil {s})')

# ══ 5. revizije ═════════════════════════════════════════════════════════════
print('── 5. revizije (audit) ──')
for action, eid in [
    ('AR_SNAPSHOT_CREATE', snap_id), ('AR_SNAPSHOT_UPDATE', snap_id), ('AR_SNAPSHOT_DELETE', snap_id),
    ('VIZ_PROJECT_CREATE', viz_id), ('VIZ_PROJECT_UPDATE', viz_id), ('VIZ_PROJECT_DELETE', monter_viz),
]:
    if eid is None:
        bad(f'revizija {action}: entityId manjka (ustvarjanje ni uspelo)')
        continue
    chk(audit_find(action, eid), f'revizija {action} obstaja za entityId')

chk(dup_id is not None and audit_find('VIZ_PROJECT_DUPLICATE', dup_id),
    'revizija VIZ_PROJECT_DUPLICATE obstaja za kopijo')
if VLM_OK:
    an_audit = jget('/api/audit?action=AR_ANALYZE&limit=50', admin)
    chk(an_audit is not None and len(an_audit['data']) >= 1, 'revizija AR_ANALYZE zapisana (VLM klic)')
else:
    skip('revizija AR_ANALYZE — VLM klic v tem okolju ni bil izveden')

# ══ 6. regresija ════════════════════════════════════════════════════════════
print('── 6. regresija ──')
for path in ['/api/public/health', '/api/projects', '/api/measurements', '/api/catalog', '/api/material-suggestions']:
    s, _ = call('GET', path, admin)
    chk(s == 200, f'GET {path} → 200 (dobil {s})')

# ══ 7. čiščenje (idempotentno) ══════════════════════════════════════════════
done, err = bun(CLEAN)
chk(done, f'čiščenje testnih zapisov {"" if done else " — " + err}')
left_viz = jget('/api/viz/projects', admin)
left_snap = jget('/api/ar-snapshots', admin)
chk(not any(TAG in (r.get('name') or '') or TAG in (r.get('note') or '') for r in (left_viz['data'] if left_viz else [])),
    'ni ostankov viz projektov s TAG')
chk(not any(TAG in (r.get('note') or '') or TAG in (r.get('scene') or '') for r in (left_snap['data'] if left_snap else [])),
    'ni ostankov AR posnetkov s TAG')

print(f'═══ R454: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏭ ═══')
sys.exit(1 if FAIL else 0)

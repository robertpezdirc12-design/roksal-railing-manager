#!/usr/bin/env python3
"""tests/r455.py — R455 PROFESIONALNE KAMERNE MERITVE (issue #10)

Preverja:
  A) RBAC (fail-closed): brez žetona 401 na /api/measurement/confirm; skladišče
     (brez measurements.write) 403; monter (measurements.write) 201.
  B) Razširjena potrditev (R455):
     • POST s views[] (2 dodatna pogleda) + quality + confidence + manualOverride
       → 201; params JSON vsebuje views/quality/confidence/manualOverride;
       verzija v1 omenja poglede + zaupanje + ročni popravek; revizija
       MEASUREMENT_CONFIRM nosi confidence + views + manualOverride.
     • validacija: views kot niz → 400; 5 pogledov → 400; manualOverride brez
       razloga → 400; confidence 150 → 400; computedLengthCm 0 → 400.
     • povratna združljivost: klasična potrditev brez novih polj → 201.
  C) GET /api/measurements/[id] vrne params z novimi polji (revizija/ponovna
     izdelava).
  D) Regresija: /api/measurements seznam, /api/railing-layout izračun iz točk +
     kalibracije, detect brez measurementId → 400.
  E) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R455-TEST'
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
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
    return 'CLEAN_DONE' in r.stdout, r.stderr[:300]

# 1×1 px JPEG dataUrl (dovolj za params — kamera ne preverja vsebine)
PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

CLEAN = f'''
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
(async()=>{{
  const ms=await p.measurement.findMany({{where:{{note:{{contains:'{TAG}'}}}},select:{{id:true}}}});
  for(const m of ms){{
    await p.projectPackage.updateMany({{where:{{measurementId:m.id}},data:{{measurementId:null}}}});
    await p.measurementVersion.deleteMany({{where:{{measurementId:m.id}}}});
    await p.measurement.delete({{where:{{id:m.id}}}});
  }}
  // R542: detail je jsonb — podniz po serializiranem jsonb (ista semantika contains)
  await p.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE "detail"::text LIKE $1', '%{TAG}%');
  await p.measurement.deleteMany({{where:{{note:'DBG-TEST'}}}});
  console.log('CLEAN_DONE');return p.$disconnect();
}})()
'''

def audit_find (action, entityId):
    """Poišče revizijski zapis po akciji+entityId v OBEH pogledih:
    sistemskem (brez filtra) in per-projektnem (?projectId=…)."""
    sys_view = jget(f'/api/audit?action={action}&limit=100', admin)
    if any(e.get('entityId') == entityId for e in (sys_view['data'] if sys_view else [])):
        return True, (sys_view['data'] if sys_view else [])
    if PROJ_ID:
        proj_view = jget(f'/api/audit?projectId={PROJ_ID}&limit=200', admin)
        rows = proj_view['data'] if proj_view else []
        for e in rows:
            if e.get('action') == action and e.get('entityId') == entityId:
                return True, rows
    return False, []

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
PROJ_ID = proj['id'] if proj else None
chk(proj is not None, 'izhodiščni projekt za vezavo najden')

# ══ A. RBAC fail-closed ══════════════════════════════════════════════════════
print('── A. RBAC ──')
s, _ = call('POST', '/api/measurement/confirm', body={'photoId': 'x', 'type': 'OGRAJA', 'lengthCm': 100})
chk(s == 401, f'brez žetona 401 (dejansko {s})')

# pripravi FOTO meritev (monter)
s, b = call('POST', '/api/measurements', monter, {
    'type': 'FOTO', 'projectId': PROJ_ID, 'location': f'{TAG} teren',
    'params': {'photo': PHOTO},  # R542: jsonb objekt (niz → zod 400)
    'note': f'{TAG} foto osnova',
})
chk(s == 201, f'FOTO meritev ustvarjena (dejansko {s})')
photo_id = json.loads(b)['data']['id'] if s == 201 else None

s, _ = call('POST', '/api/measurement/confirm', skladisce, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 500,
})
chk(s == 403, f'skladišče brez measurements.write → 403 (dejansko {s})')

# ══ B. Razširjena potrditev (R455) ═══════════════════════════════════════════
print('── B. razširjena potrditev ──')
CONFIRM_BODY = {
    'photoId': photo_id,
    'type': 'OGRAJA',
    'location': f'{TAG} severna ograja',
    'lengthCm': 486.5,          # ročno popravljeni konec (viz laser)
    'heightCm': 105,
    'posts': 5, 'segments': 3,
    'projectId': PROJ_ID,
    'points': [{'x': 0.1, 'y': 0.5}, {'x': 0.4, 'y': 0.5}, {'x': 0.7, 'y': 0.55}, {'x': 0.95, 'y': 0.55}],
    'calibration': {'px': 300, 'cm': 110, 'imgW': 1600, 'imgH': 1200},
    # ── R455 nova polja ──
    'views': [
        {'photoId': photo_id, 'points': [{'x': 0.1, 'y': 0.5}, {'x': 0.9, 'y': 0.5}],
         'calibration': {'px': 500, 'cm': 180, 'imgW': 1600, 'imgH': 1200}},
        {'points': [{'x': 0.2, 'y': 0.4}, {'x': 0.8, 'y': 0.4}],
         'calibration': {'px': 400, 'cm': 150, 'imgW': 1400, 'imgH': 1000}},
    ],
    'quality': {'brightness': 132, 'blurScore': 180, 'dark': False, 'bright': False, 'blurry': False},
    'confidence': 92,
    'manualOverride': {'computedLengthCm': 461.2, 'reason': f'{TAG} izmerjeno z laserjem na terenu'},
    'note': f'{TAG} več pogledov + ročni popravek',
}
s, b = call('POST', '/api/measurement/confirm', monter, CONFIRM_BODY)
chk(s == 201, f'potrditev z razširitvami 201 (dejansko {s}: {b[:120] if s != 201 else ""})')
mid = json.loads(b)['data']['id'] if s == 201 else None

if mid:
    params = jget(f'/api/measurements/{mid}', admin)['data']['params'] or {}  # R542: jsonb objekt
    chk(isinstance(params.get('views'), list) and len(params['views']) == 2, 'params.views: 2 dodatna pogleda')
    v0 = params['views'][0]
    chk(v0.get('photoId') == photo_id and isinstance(v0.get('points'), list), 'views[0] nosi photoId + točke')
    chk(v0['calibration'].get('px') == 500 and v0['calibration'].get('imgW') == 1600, 'views[0] kalibracija normalizirana')
    chk(params.get('quality', {}).get('brightness') == 132 and params['quality'].get('blurScore') == 180, 'params.quality zapisan')
    chk(params.get('confidence') == 92, 'params.confidence = 92')
    mo = params.get('manualOverride')
    chk(isinstance(mo, dict) and mo.get('computedLengthCm') == 461.2 and 'laserjem' in mo.get('reason', ''), 'params.manualOverride z razlogom')

    # verzija v1
    vers = jget(f'/api/measurements/{mid}/verzije', admin)
    v1 = next((v for v in (vers['data'] or []) if v.get('version') == 1), None)
    chk(v1 is not None, 'verzija v1 obstaja')
    if v1:
        chk('3 pogledov' in (v1.get('note') or ''), f'opomba verzije omenja poglede («{v1.get("note")}»)')
        chk('zaupanje 92' in (v1.get('note') or ''), 'opomba verzije omenja zaupanje')
        chk('ročni popravek' in (v1.get('note') or ''), 'opomba verzije omenja ročni popravek')

    # revizija (oba pogleda: sistemski + per-projektni)
    found, rows = audit_find('MEASUREMENT_CONFIRM', mid)
    chk(found, 'revizija MEASUREMENT_CONFIRM najdena')
    if found:
        row = next(e for e in rows if e.get('entityId') == mid)
        d = row.get('detail') or {}
        if isinstance(d, str):
            try: d = json.loads(d)
            except Exception: d = {}
        chk(d.get('confidence') == 92, 'revizija nosi confidence')
        chk(d.get('views') == 2, 'revizija nosi št. pogledov')
        chk(isinstance(d.get('manualOverride'), dict), 'revizija nosi manualOverride')

# ── validacijski primeri ──
s, b = call('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 300, 'views': 'ne-seznam',
})
chk(s == 400, f'views kot niz → 400 (dejansko {s})')

s, b = call('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 300,
    'views': [{'points': [{'x': 0.1, 'y': 0.2}, {'x': 0.5, 'y': 0.2}]}] * 5,
})
chk(s == 400, f'5 pogledov → 400 (dejansko {s})')

s, b = call('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 300,
    'manualOverride': {'computedLengthCm': 290, 'reason': '  '},
})
chk(s == 400 and 'razlog' in b.lower(), f'manualOverride brez razloga → 400 (dejansko {s})')

s, b = call('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 300, 'confidence': 150,
})
chk(s == 400, f'confidence 150 → 400 (dejansko {s})')

s, b = call('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 300,
    'manualOverride': {'computedLengthCm': 0, 'reason': 'test'},
})
chk(s == 400, f'computedLengthCm 0 → 400 (dejansko {s})')

# ── povratna združljivost: klasična potrditev brez novih polj ──
# R501 (issue #15 Faza 1): strežniški preračun je avtoriteta — lengthCm se
# ujema s computeGeometry (0,1→0,9 × imgW 1000 = 800 px × 200/400 = 400 cm).
s, b = call('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 400,
    'points': [{'x': 0.1, 'y': 0.5}, {'x': 0.9, 'y': 0.5}],
    'calibration': {'px': 400, 'cm': 200, 'imgW': 1000, 'imgH': 800},
    'note': f'{TAG} klasična',
})
chk(s == 201, f'klasična potrditev (brez novih polj) 201 (dejansko {s})')
if s == 201:
    params2 = jget(f"/api/measurements/{json.loads(b)['data']['id']}", admin)['data']['params'] or {}  # R542: jsonb objekt
    chk('views' not in params2 and 'confidence' not in params2, 'brez novih polj params ostane čist')

# ══ C. GET [id] vrne params z novimi polji ═══════════════════════════════════
print('── C. podrobnost meritve ──')
det = jget(f'/api/measurements/{mid}', admin) if mid else None
chk(det is not None and det['data']['lengthCm'] == 486.5, 'GET [id] vrne končno (ročno popravljeno) dolžino')
chk(det is not None and det['data']['source'] == 'KAMERA', 'source ostaja KAMERA')

# ══ D. Regresija osnovnih merilnih tokov ═════════════════════════════════════
print('── D. regresija ──')
s, _ = call('GET', '/api/measurements', monter)
chk(s == 200, f'seznam meritev 200 (dejansko {s})')

s, b = call('POST', '/api/railing-layout', monter, {
    'points': [{'x': 0, 'y': 0}, {'x': 300, 'y': 0}, {'x': 600, 'y': 50}],
    'calibration': {'px': 300, 'cm': 110},
})
chk(s in (200, 201), f'railing-layout izračun 200/201 (dejansko {s})')
if s in (200, 201):
    lay = json.loads(b)['data']
    chk(lay.get('totalLengthCm') is not None and lay.get('posts', 0) >= 2, f'geometrija: {lay.get("totalLengthCm")} cm, {lay.get("posts")} stebrov')

s, b = call('POST', '/api/measurement/detect', monter, {})
# R563 (issue #23): detect je zdaj EKSPERIMENT, privzeto IZKLOPLJEN — vrata
# so PRED validacijo telesa, zato brez env vrne 503 tudi brez measurementId.
# Če je ROKSAL_VLM_EXPERIMENT=1 (izrecno vklopljen), velja stara pogodba: 400.
if s == 503:
    chk('izklopljen' in b.lower(), f'detect brez env → 503 izklopljen (dejansko {s}: {b[:60]})')
else:
    chk(s == 400, f'detect brez measurementId (eksperiment vklopljen) → 400 (dejansko {s})')

# detect na drocni testni sliki: privzeto (brez env) fail-closed 503 — VLM
# cevovod se sploh NE zažene in fotografija NE gre nikamor (issue #23 DoD).
# Ob vklopu eksperimenta velja stara pogodba: 422 „ni prepoznala“ na prazni
# sliki (ročni vnos je fallback) ali 502, če zunanji model ni dosegljiv.
s, b = call('POST', '/api/measurement/detect', monter, {'measurementId': photo_id})
if s == 503 and 'izklopljen' in (b or '').lower():
    chk(True, 'detect na sliki brez env → 503 izklopljen (fotografija NE gre zunanjemu modelu — issue #23)')
elif s == 502 and 'ni na voljo' in b:
    skip('detect: eksperiment vklopljen, a VLM trenutno ni na voljo (502 — zunanja storitev)')
else:
    chk(s == 422 and 'ni prepoznala' in b, f'detect na prazni sliki (eksperiment vklopljen) → 422 z navodilom (dejansko {s}: {b[:80]})')

# ══ E. Čiščenje ══════════════════════════════════════════════════════════════
print('── E. čiščenje ──')
done, err = bun(CLEAN)
chk(done, f'čiščenje po testu {"" if done else " — " + err}')

print(f'\n══ R455: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏭ ══')
sys.exit(1 if FAIL else 0)

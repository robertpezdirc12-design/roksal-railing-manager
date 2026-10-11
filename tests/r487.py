#!/usr/bin/env python3
"""tests/r487.py — R487 (issue #3 — MULTI-VIEW → KONSISTENTNA POTRDJENA
MERITEV): strežniška konsolidacija pogledov + konfliktna vrata.

Preverja:
  A) RBAC (fail-closed): brez žetona 401 na /api/measurement/confirm;
     skladišče (brez measurements.write) 403.
  B) STREŽNIŠKA KONSOLIDACIJA (confirm preračuna per-view dolžine iz točk +
     kalibracij — NE iz odjemalčeve izjave):
     • strinjajoči pogledi (razpršenost ≤ 5 %) → 201; params.multiView =
       {count, values, mean, spreadPct, conflict:false};
     • konflikt > 15 % BREZ manualOverride → 409 (vrata — §4C »ne popravljaš
       geometrije tiho«) z navodilom za rešitev; meritev NI ustvarjena;
     • isti konflikt Z manualOverride (razlog) → 201 + conflict:true +
       manualOverride:true (r455 vzorec — ročna rešitev je veljavna);
     • zmerna razpršenost 5–15 % → 201 + conflict:false (strežnik blokira
       SAMO kritične > 15 %; UI vrata 5 % so odjemalška);
     • pogledi brez kalibracije → ni konsolidacije ('multiView' ni v params,
       §4C »samo kadar podatki to omogočajo«);
     • brez views → params BITNO enak staremu (r439/r455 legacy — točna
       primerjava nabora ključev);
     • ponovljivost: enaki vhodi → enak multiView (determinizem, §6).
  C) VERZIJA + REVIZIJA + EXPORT: verzija v1 omenja poglede in razpršenost;
     revizija MEASUREMENT_CONFIRM nosi multiView; izvoz CSV/JSON ima skupino
     Pogledi (povprečje/razpršenost/strinjanje).
  D) bun — multiViewStats (lib, čista funkcija): < 2 vrednosti → null;
     filtri neveljavnih; povprečje/razpršenost (r455 fixture vrednosti);
     determinizem; computeGeometry dolžina pogleda (ista koda client/server).
  E) UI-nizi (source grep): izbira obstoječe FOTO za dodatne poglede,
     terenska pot (file input) ostaja, konfliktna vrata besedila, multiView
     v confirm/export.
  F) Idempotentno čiščenje ×2 (direktno prek Prisma).
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R487-TEST'
PASS, FAIL = 0, 0

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

def callraw (method, path, token=None, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8', 'replace'), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), dict(e.headers)
    except Exception as e:
        return 0, str(e), {}

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun_ts (script):
    # samo veljavni postgres URL-ji iz okolja (r470)
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

def src_has (relpath, needle):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return needle in f.read()
    except Exception:
        return False

def meas_params (mid):
    out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.measurement.findUnique({{where:{{id:'{mid}'}},select:{{params:true,lengthCm:true}}}}).then(r=>{{
console.log(JSON.stringify(r));return p.$disconnect()}})""")
    try: return json.loads(out)
    except Exception: return {}

# ═══════════════════════════════ TEST ═══════════════════════════════════════

print('════ R487 — multi-view konsolidacija + konfliktna vrata (issue #3) ════')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
print('── prijava: admin / monter / skladišče ──')
ok('prijava 3 vlog')

print('── A) RBAC (fail-closed)')
s, _ = callj('POST', '/api/measurement/confirm', body={'photoId': 'x', 'type': 'OGRAJA', 'lengthCm': 100})
chk(s == 401, f'brez žetona 401 ({s})')

projects = callj('GET', '/api/projects', admin)[1]
PROJ_ID = (projects.get('data') or [{}])[0].get('id')

# FOTO osnova (kot r455)
PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
s, d = callj('POST', '/api/measurements', monter, {
    'type': 'FOTO', 'projectId': PROJ_ID, 'location': f'{TAG} teren',
    'params': json.dumps({'photo': PHOTO}), 'note': f'{TAG} foto osnova'})
chk(s == 201, f'FOTO osnova ustvarjena ({s})')
photo_id = d.get('data', {}).get('id')

s, _ = callj('POST', '/api/measurement/confirm', skladisce, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 500})
chk(s == 403, f'skladišče brez measurements.write → 403 ({s})')

# ── fiksni pogledi (deterministični izračun, enaki client/server) ──
# primarni: 2 točki 0,1→0,9 (1280 px) × kalibracija 200 cm/800 px = 320,0 cm
PTS = [{'x': 0.1, 'y': 0.5}, {'x': 0.9, 'y': 0.5}]
CAL = {'px': 800, 'cm': 200, 'imgW': 1600, 'imgH': 1200}
# strinjajoč: 0,2→0,98 (1248 px) × 156/624 = 312,0 cm → razpršenost 2,5 %
V_OK = [{'points': [{'x': 0.2, 'y': 0.5}, {'x': 0.98, 'y': 0.5}],
         'calibration': {'px': 624, 'cm': 156, 'imgW': 1600, 'imgH': 1200}}]
# konflikt: 1280 px × 400/800 = 640,0 cm → razpršenost 66,7 % (> 15 %)
V_BAD = [{'points': [{'x': 0.1, 'y': 0.5}, {'x': 0.9, 'y': 0.5}],
          'calibration': {'px': 800, 'cm': 400, 'imgW': 1600, 'imgH': 1200}}]
# zmerno (5–15 %): 1280 px × 216/800 = 345,6 cm → razpršenost 7,7 %
V_MID = [{'points': [{'x': 0.2, 'y': 0.5}, {'x': 1.0, 'y': 0.5}],
          'calibration': {'px': 800, 'cm': 216, 'imgW': 1600, 'imgH': 1200}}]

print('── B) strežniška konsolidacija')
# B1: strinjajoči pogledi → 201 + multiView brez konflikta
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 316,
    'location': f'{TAG} severna ograja', 'projectId': PROJ_ID,
    'points': PTS, 'calibration': CAL, 'views': V_OK, 'confidence': 88,
    'note': f'{TAG} strinjanje'})
chk(s == 201, f'strinjajoči pogledi → 201 ({s}: {json.dumps(d)[:120] if s != 201 else ""})')
M1 = d.get('data', {}).get('id')
p1 = meas_params(M1) if M1 else {}
pr1 = json.loads(p1.get('params') or '{}')
mv = pr1.get('multiView') or {}
chk(mv.get('count') == 2, f'multiView.count = 2 ({mv.get("count")})')
chk(mv.get('values') == [320, 312], f'multiView.values = [320, 312] ({mv.get("values")})')
chk(mv.get('mean') == 316, f'multiView.mean = 316 ({mv.get("mean")})')
chk(mv.get('spreadPct') == 2.5, f'multiView.spreadPct = 2,5 % ({mv.get("spreadPct")})')
chk(mv.get('conflict') is False, f'multiView.conflict = false ({mv.get("conflict")})')
chk('manualOverride' not in mv, 'multiView brez manualOverride (ni ga poslal)')
chk(isinstance(pr1.get('views'), list) and len(pr1['views']) == 1, 'params.views ostaja (revizija)')

# B2: konflikt > 15 % BREZ manualOverride → 409 (vrata)
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 480,
    'location': f'{TAG} konflikt brez rešitve', 'projectId': PROJ_ID,
    'points': PTS, 'calibration': CAL, 'views': V_BAD,
    'note': f'{TAG} konflikt-zavrnjen'})
chk(s == 409, f'konflikt > 15 % brez manualOverride → 409 ({s})')
if s == 409:
    chk('razlikujejo' in json.dumps(d, ensure_ascii=False).lower(), f'409 razloži vzrok ({d.get("error")})')
    det = d.get('detail') or ''
    chk('66,7' in det, f'409 navaja razpršenost 66,7 % ({det[:60]})')
    chk('manualOverride' in det, '409 navodi rešitev (manualOverride z razlogom)')
out, _ = bun_ts(f"""
const {{PrismaClient}}=require('@prisma/client');const p=new PrismaClient();
p.measurement.count({{where:{{note:{{contains:'{TAG} konflikt-zavrnjen'}}}}}}).then(n=>{{console.log(n);return p.$disconnect()}})""")
chk(out.strip() == '0', f' zavrnjena potrditev NI ustvarila meritve ({out.strip()})')

# B3: isti konflikt Z manualOverride (razlog) → 201 (veljavna rešitev, r455)
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 315,
    'location': f'{TAG} konflikt z laserjem', 'projectId': PROJ_ID,
    'points': PTS, 'calibration': CAL, 'views': V_BAD, 'confidence': 62,
    'manualOverride': {'computedLengthCm': 480, 'reason': 'izmerjeno z laserjem Leica na terenu'},
    'note': f'{TAG} konflikt-resen'})
chk(s == 201, f'konflikt + manualOverride z razlogom → 201 ({s})')
M3 = d.get('data', {}).get('id')
p3 = meas_params(M3) if M3 else {}
pr3 = json.loads(p3.get('params') or '{}')
mv3 = pr3.get('multiView') or {}
chk(mv3.get('conflict') is True, f'multiView.conflict = true — zapisan, NE tih ({mv3.get("conflict")})')
chk(mv3.get('manualOverride') is True, f'multiView.manualOverride = true ({mv3.get("manualOverride")})')
chk(mv3.get('spreadPct') == 66.7, f'multiView.spreadPct = 66,7 ({mv3.get("spreadPct")})')
chk(p3.get('lengthCm') == 315, f'končna dolžina = ročna vrednost, NE povprečje ({p3.get("lengthCm")})')

# B4: zmerna razpršenost 5–15 % → 201 + conflict:false (strežnik > 15 %)
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 332.8,
    'location': f'{TAG} zmerno', 'projectId': PROJ_ID,
    'points': PTS, 'calibration': CAL, 'views': V_MID,
    'note': f'{TAG} zmerno'})
chk(s == 201, f'razpršenost 7,7 % (≤ 15 %) → 201 ({s})')
M4 = d.get('data', {}).get('id')
pr4 = json.loads(meas_params(M4).get('params') or '{}') if M4 else {}
mv4 = pr4.get('multiView') or {}
chk(mv4.get('spreadPct') == 7.7 and mv4.get('conflict') is False,
    f'7,7 % → conflict:false (strežniška vrata SAMO > 15 %) ({mv4.get("spreadPct")}/{mv4.get("conflict")})')

# B5: pogled brez kalibracije → ni konsolidacije (samo kadar podatki omogočajo)
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 320,
    'location': f'{TAG} brez kalibracije pogoleda', 'projectId': PROJ_ID,
    'points': PTS, 'calibration': CAL,
    'views': [{'points': [{'x': 0.2, 'y': 0.5}, {'x': 0.9, 'y': 0.5}]}],
    'note': f'{TAG} nekonsolidabilno'})
chk(s == 201, f'pogled brez kalibracije → 201 brez konsolidacije ({s})')
M5 = d.get('data', {}).get('id')
pr5 = json.loads(meas_params(M5).get('params') or '{}') if M5 else {}
chk('multiView' not in pr5, f'brez izračunljivih ≥ 2 dolžin NI multiView ({sorted(pr5.keys())})')
chk(isinstance(pr5.get('views'), list), 'views kljub temu persistirani (revizija)')

# B6: brez views → params BITNO enak staremu (legacy, r439/r455)
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 420,
    'location': f'{TAG} klasika', 'projectId': PROJ_ID,
    'points': [{'x': 0.1, 'y': 0.5}, {'x': 0.9, 'y': 0.5}],
    'calibration': {'px': 400, 'cm': 200},
    'note': f'{TAG} klasična'})
chk(s == 201, f'klasična potrditev brez views 201 ({s})')
M6 = d.get('data', {}).get('id')
pr6 = json.loads(meas_params(M6).get('params') or '{}') if M6 else {}
chk(set(pr6.keys()) == {'photoId', 'source', 'points', 'calibration'},
    f'legacy params točno {{photoId, source, points, calibration}} ({sorted(pr6.keys())})')

# B7: ponovljivost — enaki vhodi → enak multiView (determinizem §6)
s, d = callj('POST', '/api/measurement/confirm', monter, {
    'photoId': photo_id, 'type': 'OGRAJA', 'lengthCm': 316,
    'location': f'{TAG} ponovitev', 'projectId': PROJ_ID,
    'points': PTS, 'calibration': CAL, 'views': V_OK, 'confidence': 88,
    'note': f'{TAG} determinizem'})
chk(s == 201, f'ponovljena potrditev 201 ({s})')
M7 = d.get('data', {}).get('id')
mv7 = json.loads(meas_params(M7).get('params') or '{}').get('multiView') if M7 else None
chk(mv7 == mv, f'isti vhodi → enak multiView ({mv7 == mv})')

print('── C) verzija + revizija + export')
vers = callj('GET', f'/api/measurements/{M1}/verzije', admin)[1]
v1 = next((v for v in (vers.get('data') or []) if v.get('version') == 1), None)
chk(v1 is not None, 'verzija v1 obstaja')
if v1:
    chk('2 pogledov' in (v1.get('note') or ''), f'opomba verzije omenja poglede («{v1.get("note")}»)')
    chk('razpršenost 2,5 %' in (v1.get('note') or ''), 'opomba verzije omenja razpršenost')
vers3 = callj('GET', f'/api/measurements/{M3}/verzije', admin)[1]
v13 = next((v for v in (vers3.get('data') or []) if v.get('version') == 1), None)
chk(v13 is not None and '⚠ konflikt' in (v13.get('note') or ''),
    f'opomba verzije konflikta nosi ⚠ konflikt («{v13.get("note") if v13 else ""}»)')

# revizija: sistemski pogled = samo globalne vrstice (projectId null) — vrstica
# s projectId je v PER-PROJEKTNEM pogledu (vzorec r455 audit_find)
aud = callj('GET', f'/api/audit?projectId={PROJ_ID}&limit=200', admin)[1]
def audit_detail (e):
    dd = e.get('detail')
    return json.loads(dd) if isinstance(dd, str) else (dd or {})
row = next((e for e in (aud.get('data') or []) if e.get('entityId') == M1 and e.get('action') == 'MEASUREMENT_CONFIRM'), None)
chk(row is not None, 'revizija MEASUREMENT_CONFIRM najdena (per-projektni pogled)')
if row:
    amv = audit_detail(row).get('multiView') or {}
    chk(amv.get('count') == 2 and amv.get('mean') == 316 and amv.get('spreadPct') == 2.5 and amv.get('conflict') is False,
        f'revizija nosi multiView ({amv})')

s, b, h = callraw('GET', f'/api/measure-engine/export?id={M1}&format=json', monter)
chk(s == 200, f'JSON izvoz 200 ({s})')
jd = json.loads(b) if s == 200 else {}
mere = jd.get('data', {}).get('mere', [])
polja = {(m.get('skupina'), m.get('polje')): m.get('vrednost') for m in mere}
chk(polja.get(('Pogledi', 'Število pogledov')) == '2', f'izvoz: število pogledov ({polja.get(("Pogledi", "Število pogledov"))})')
chk(polja.get(('Pogledi', 'Povprečje')) == '316', f'izvoz: povprečje 316 cm ({polja.get(("Pogledi", "Povprečje"))})')
chk(polja.get(('Pogledi', 'Razpršenost')) == '2,5', f'izvoz: razpršenost 2,5 % ({polja.get(("Pogledi", "Razpršenost"))})')
chk(polja.get(('Pogledi', 'Strinjanje')) == 'strinjajo se', f'izvoz: strinjanje ({polja.get(("Pogledi", "Strinjanje"))})')
s, b, _ = callraw('GET', f'/api/measure-engine/export?id={M3}&format=csv', monter)
chk(s == 200 and 'KONFLIKT — rešen z ročnim popravkom' in b, 'CSV izvoz konflikta nosi izrecen zapis')

print('── D) bun — multiViewStats (lib, čista funkcija)')
UNIT_JS = r'''
const { multiViewStats, computeGeometry } = await import('./src/lib/measure-engine')
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const r1 = (n) => Math.round(n * 10) / 10
// dolžina pogleda prek obstoječega computeGeometry (ista koda client/server)
const L = (pts, cal) => computeGeometry(pts, cal).totalLengthCm
const v1 = L([{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], { px: 800, cm: 200, imgW: 1600, imgH: 1200 })
const v455 = L([{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], { px: 500, cm: 180, imgW: 1600, imgH: 1200 })
console.log(JSON.stringify({
  n_empty: multiViewStats([]) === null,
  n_one: multiViewStats([100]) === null,
  n_zero: multiViewStats([0, 100]) === null,
  s_same: eq(multiViewStats([100, 100]), { count: 2, values: [100, 100], mean: 100, spreadPct: 0 }),
  s_ok: eq(multiViewStats([320, 312]), { count: 2, values: [320, 312], mean: 316, spreadPct: 2.5 }),
  s_r455: eq(multiViewStats([461, 315]), { count: 2, values: [461, 315], mean: 388, spreadPct: 37.6 }),
  s_r455_3: eq(multiViewStats([500, 460.8, 315]), { count: 3, values: [500, 460.8, 315], mean: 425.3, spreadPct: 43.5 }),
  det: eq(multiViewStats([320, 312]), multiViewStats([320, 312])),
  geo320: v1 === 320,
  geo455: v455 === 460.8,
}))
'''
m = bun_out(UNIT_JS)
chk(m.get('n_empty') is True and m.get('n_one') is True and m.get('n_zero') is True,
    f'< 2 veljavne vrednosti → null ({m.get("n_empty")}/{m.get("n_one")}/{m.get("n_zero")})')
chk(m.get('s_same') is True, 'enake vrednosti → spreadPct 0')
chk(m.get('s_ok') is True, f'povprečje/razpršenost [320, 12] ({m.get("_err", "")[:80] if not m.get("s_ok") else ""})')
chk(m.get('s_r455') is True, 'r455 fixture [461, 315] → mean 388, spread 37,6 %')
chk(m.get('s_r455_3') is True, 'r455 3 vrednosti → mean 425,3, spread 43,5 %')
chk(m.get('det') is True, 'determinizem (isti vhodi → isti izhod)')
chk(m.get('geo320') is True, f'computeGeometry dolžina pogleda = 320 cm ({m.get("geo320")})')
chk(m.get('geo455') is True, f'computeGeometry r455 fixture = 460,8 cm ({m.get("geo455")})')

print('── E) UI-nizi (source grep)')
ui = [
    # (a) izbira obstoječe FOTO za DODATNE poglede + terenska pot ostaja
    ('src/components/roksal/modules/meritve-kamera.tsx', 'pickExistingView', 'KAMERA: izbira obstoječe FOTO kot dodatni pogled'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'Ali izberi obstoječo fotografijo', 'KAMERA: mreža obstoječih FOTO v panelu dodajanja'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'setAddingView', 'KAMERA: panel dodajanja pogleda'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'Posnemi / naloži iz telefona', 'KAMERA: terenska pot v panelu'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'Dodaj fotografijo istega objekta', 'KAMERA: file/capture input ostaja (teren)'),
    # (b) konfliktna vrata
    ('src/components/roksal/modules/meritve-kamera.tsx', 'conflictBlocked', 'KAMERA: vrata konflikta pogledov'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'potrditev je blokirana', 'KAMERA: izrecno besedilo blokade'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'Pogledi se razlikujejo', 'KAMERA: opozorilo ob konfliktu (faza 5)'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'NE tiho povprečje', 'KAMERA: konflikt → final ni tiho povprečje'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'laser', 'KAMERA: laserska rešitev z razlogom'),
    # (c) strežniška konsolidacija
    ('src/app/api/measurement/confirm/route.ts', 'viewLengthCm', 'CONFIRM: per-view izračun'),
    ('src/app/api/measurement/confirm/route.ts', 'computeGeometry', 'CONFIRM: obstoječi computeGeometry (NE tretja semantika)'),
    ('src/app/api/measurement/confirm/route.ts', 'multiViewStats', 'CONFIRM: statistika iz lib'),
    ('src/app/api/measurement/confirm/route.ts', 'MEASURE_CONFLICT_PCT', 'CONFIRM: prag 15 % deljen z AR konsolidatorjem'),
    ('src/app/api/measurement/confirm/route.ts', 'extra.multiView', 'CONFIRM: params.multiView zapis'),
    # (d) export
    ('src/lib/measure-engine.ts', 'multiViewStats', 'LIB: multiViewStats izvoz'),
    ('src/lib/measure-engine.ts', 'Število pogledov', 'EXPORT: skupina Pogledi'),
    ('src/lib/measure-engine.ts', 'Razpršenost', 'EXPORT: razpršenost v izvozu'),
]
for rel, needle, msg in ui:
    chk(src_has(rel, needle), msg)

print('── F) Idempotentno čiščenje ×2')
CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const ms=await p.measurement.findMany({where:{note:{contains:'__TAG__'}},select:{id:true}});
  for (const m of ms) {
    await p.projectPackage.updateMany({where:{measurementId:m.id},data:{measurementId:null}});
    await p.measurementVersion.deleteMany({where:{measurementId:m.id}});
    await p.notificationDelivery.deleteMany({where:{event:{key:{contains:':'+m.id}}}});
    await p.notificationEvent.deleteMany({where:{key:{contains:':'+m.id}}});
    await p.measurement.delete({where:{id:m.id}});
  }
  await p.auditLog.deleteMany({where:{detail:{contains:'__TAG__'}}});
  await p.auditLog.deleteMany({where:{entityId:{in:ms.map(m=>m.id)}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG)
for i in range(2):
    out, err = bun_ts(CLEAN)
    chk('CLEAN_DONE' in out, f'počiščenje testnih zapisov ({i + 1}.) {"" if "CLEAN_DONE" in out else err[:200]}')

print()
print(f'══ R487 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL else 0)

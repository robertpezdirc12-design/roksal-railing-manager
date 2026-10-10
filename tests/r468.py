#!/usr/bin/env python3
"""tests/r468.py — R468 SMART VISION F2: TLA, RAVNINE, ROBOVI IN NAKLON (issue #8 §11 Faza 2)

Preverja:
  A) RBAC (fail-closed): PATCH scene-element z novo poljem slopeDeg brez
     žetona 401; skladišče/proizvodnja (brez measurements.write) 403.
  B) SANITIZACIJA novih geometrijskih polj na POST /api/ar-snapshots:
     veljavni ROB (angleDeg), maskPoints (3..32 točk 0..1), slopeDeg z
     slopeSource + geomStatus se ohranijo v sceneJson (GET scene-element);
     neveljavni (izven 0..1, 100 točk → reže na 32, slopeDeg brez vira →
     izpuščen, slopeDeg 90 → izpuščen, angleDeg 999 → izpuščen).
  C) PATCH scene-element slopeDeg (ročna izmera): 200 + revizija SCENE_EDIT
     z before.slopeDeg; GET displayed kaže ROCNO + IZMERJENO; izvirni
     element ostane brez slopeDeg (označen podatek, ne tiha sprememba);
     slopeDeg 50 kot edini popravek → 400; neobstoječ elementId → 404.
  D) CORE LOGIKA (bun): estimateSlope — brez senzorja ne trdi naklona;
     telefon ~raven + vizualni kot → GEOMETRIJA_OCENJENA; kompenzacija
     (vizualni −7°, roll +5° → −2°); telefon premočno nagnjen → null;
     ~0° → "videti ravna"; pickLabels z pripetim elementom (vedno prikaz);
     sanitize izpusti slopeDeg brez slopeSource; applyEdits slopeDeg →
     ROCNO/IZMERJENO; vrstni red prikaza: OSEBA > OVIRA > ROB > OGRAJA.
  E) Regresija: F1 struktura (brez novih polj) gre še vedno skozi sanitize;
     /api/ar-snapshots, meritve, projekti 200.
  F) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R468-TEST'
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

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun_ts (script):
    db_url = os.environ.get('TEST_DB_URL') or os.environ.get('DATABASE_URL') or ('postgresql://roksal:roksal@localhost:54329/roksal')
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:600]

def audit_has (token, action, entityId=None):
    s, d = callj('GET', f'/api/audit?action={action}&limit=100', token)
    rows = d.get('data', []) if s == 200 else []
    for e in rows:
        if entityId and e.get('entityId') != entityId:
            continue
        return True
    return False

CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  await p.arSnapshot.deleteMany({where:{OR:[{note:{contains:'__TAG__'}},{scene:{contains:'__TAG__'}}]}});
  await p.user.deleteMany({where:{email:{contains:'r468'}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG)

def el (eid='el-1', cls='PODLAGA', status='VERJETNO', source='LOKALNO',
         bbox=None, confidence=0.5, kind='BETON', **extra):
    e = {
        'id': eid, 'cls': cls, 'status': status, 'source': source,
        'confidence': confidence, 'bbox': bbox or [0, 2/3, 1, 1/3],
        'kind': kind, 'at': 1760000000000,
    }
    e.update(extra)
    return e

# ── priprava ────────────────────────────────────────────────────────────────
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'predčiščenje')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

snap_ids = []

print('── A) RBAC (fail-closed)')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', body={'elementId': 'el-1', 'slopeDeg': 3})
chk(s == 401, f'PATCH scene-element (slopeDeg) brez žetona 401 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', skladisce, {'elementId': 'el-1', 'slopeDeg': 3})
chk(s == 403, f'skladišče PATCH slopeDeg 403 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', proizvodnja, {'elementId': 'el-1', 'slopeDeg': 3})
chk(s == 403, f'proizvodnja PATCH slopeDeg 403 ({s})')

print('── B) sanitizacija novih geometrijskih polj (POST ar-snapshots)')
# B1: veljaven F2 snapshot — ROB z angleDeg, PODLAGA z masko/naklonom z virom
mask_ok = [{'x': 0.1, 'y': 0.7}, {'x': 0.9, 'y': 0.72}, {'x': 0.88, 'y': 1.0}, {'x': 0.12, 'y': 1.0}]
scene_ok = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-floor', 'PODLAGA', maskPoints=mask_ok, slopeDeg=3.5,
           slopeSource='VIZUALNA_GEOMETRIJA', geomStatus='GEOMETRIJA_OCENJENA'),
        el('el-edge', 'ROB', bbox=[0.05, 0.44, 0.9, 0.1], kind=None,
           angleDeg=-4.2, geomStatus='GEOMETRIJA_OCENJENA'),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG, 'sceneUnderstanding': scene_ok})
chk(s == 201, f'POST z veljavno F2 geometrijo 201 ({s})')
sid = d.get('data', {}).get('id'); snap_ids.append(sid)
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
res = d.get('data', {}).get('result', {})
els = {e['id']: e for e in res.get('elements', [])}
fl = els.get('el-floor', {})
ed = els.get('el-edge', {})
chk(len(fl.get('maskPoints', [])) == 4, f'maskPoints (4 točke) ohranjene ({len(fl.get("maskPoints", []))})')
chk(fl.get('slopeDeg') == 3.5 and fl.get('slopeSource') == 'VIZUALNA_GEOMETRIJA'
    and fl.get('geomStatus') == 'GEOMETRIJA_OCENJENA',
    f"slopeDeg+slopeSource+geomStatus ohranjeni ({fl.get('slopeDeg')}/{fl.get('slopeSource')}/{fl.get('geomStatus')})")
chk(ed.get('cls') == 'ROB' and ed.get('angleDeg') == -4.2, f"ROB z angleDeg ohranjen ({ed.get('cls')}/{ed.get('angleDeg')})")

# B2: neveljavni vnosi se izločijo/orežejo
bad_pts = [{'x': 0.2, 'y': 0.8}, {'x': 1.4, 'y': 0.9}, {'x': 0.5, 'y': 1.2}]  # izven 0..1
scene_bad = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        # slopeDeg brez slopeSource → naklon IZPUŠČEN (brez vira ni veljaven)
        el('el-a', 'PODLAGA', slopeDeg=5.0, geomStatus='GEOMETRIJA_OCENJENA'),
        # slopeDeg 90 → izven meje → izpuščen
        el('el-b', 'PODLAGA', slopeDeg=90, slopeSource='VIZUALNA_GEOMETRIJA'),
        # angleDeg 999 → izpuščen
        el('el-c', 'ROB', kind=None, bbox=[0.05, 0.4, 0.9, 0.1], angleDeg=999),
        # maska z neveljavnimi točkami → manj kot 3 veljavne → izpuščena
        el('el-d', 'PODLAGA', maskPoints=bad_pts),
        # 100 točk → reže na 32
        el('el-e', 'PODLAGA', maskPoints=[{'x': i / 100, 'y': 0.9} for i in range(100)]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'b', 'sceneUnderstanding': scene_bad})
chk(s == 201, f'POST z neveljavnimi polji vseeno 201 (elementi sami po sebi veljavni) ({s})')
sid_b = d.get('data', {}).get('id'); snap_ids.append(sid_b)
s, d = callj('GET', f'/api/ar-snapshots/{sid_b}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
chk('slopeDeg' not in els.get('el-a', {}), f"slopeDeg brez slopeSource izpuščen ({els.get('el-a', {}).get('slopeDeg')})")
chk('slopeDeg' not in els.get('el-b', {}), f"slopeDeg 90 izpuščen ({els.get('el-b', {}).get('slopeDeg')})")
chk('angleDeg' not in els.get('el-c', {}), f"angleDeg 999 izpuščen ({els.get('el-c', {}).get('angleDeg')})")
chk('maskPoints' not in els.get('el-d', {}), f'neveljavna maska izpuščena ({els.get("el-d", {}).get("maskPoints")})')
chk(len(els.get('el-e', {}).get('maskPoints', [])) == 32, f'maska 100 točk reže na 32 ({len(els.get("el-e", {}).get("maskPoints", []))})')

# B3: edit z neveljavnim slopeDeg se izpusti (sanitize edits)
scene_edit_bad = {
    'version': 1, 'at': 1760000000000,
    'elements': [el('el-ok', 'PODLAGA')],
    'edits': [{'elementId': 'el-ok', 'slopeDeg': 88, 'by': 'test', 'at': 1}],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'c', 'sceneUnderstanding': scene_edit_bad})
sid_c = d.get('data', {}).get('id'); snap_ids.append(sid_c)
s, d = callj('GET', f'/api/ar-snapshots/{sid_c}/scene-element', monter)
edits = d.get('data', {}).get('result', {}).get('edits', [])
chk(len(edits) == 0, f'edit z slopeDeg 88 izpuščen ({len(edits)})')

print('── C) PATCH slopeDeg — ročna izmera kot OZNAČEN PODATEK')
# C1: veljaven popravek
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-floor', 'slopeDeg': 2.5})
chk(s == 200, f'PATCH slopeDeg 200 ({s})')
chk(d.get('data', {}).get('edit', {}).get('slopeDeg') == 2.5, 'odgovor vsebuje edit.slopeDeg')
chk(audit_has(admin, 'SCENE_EDIT', sid), 'revizija SCENE_EDIT zapisana')
# C2: displayed kaže ROCNO + IZMERJENO; izvirnik ostane VIZUALNA_GEOMETRIJA/ocenjena
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
data = d.get('data', {})
orig = next((e for e in data.get('result', {}).get('elements', []) if e['id'] == 'el-floor'), {})
disp = next((e for e in data.get('displayed', []) if e['id'] == 'el-floor'), {})
chk(orig.get('slopeSource') == 'VIZUALNA_GEOMETRIJA', f'izvirnik ostaja z izvirnim virom ({orig.get("slopeSource")})')
chk(disp.get('slopeDeg') == 2.5 and disp.get('slopeSource') == 'ROCNO' and disp.get('geomStatus') == 'IZMERJENO',
    f"prikaz: ročno IZMERJENO ({disp.get('slopeDeg')}/{disp.get('slopeSource')}/{disp.get('geomStatus')})")
# C3: slopeDeg 50 kot edini popravek → 400
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-floor', 'slopeDeg': 50})
chk(s == 400, f'PATCH slopeDeg 50 (izven ±45) → 400 ({s})')
# C4: neobstoječ elementId → 404
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-ne-obstaja', 'slopeDeg': 3})
chk(s == 404, f'PATCH z neobstoječim elementId 404 ({s})')
# C5: negativen veljaven slopeDeg
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-floor', 'slopeDeg': -3.2})
chk(s == 200, f'PATCH slopeDeg −3,2 veljaven ({s})')

print('── D) core logika (scene-understanding-core, bun)')
CORE_JS = r'''
import { estimateSlope, pickLabels, sanitizeSceneResult, applyEdits } from './src/lib/scene-understanding-core'
const out = []
// brez senzorja → NE trdi naklona (ločitev ni mogoča)
const noSensor = estimateSlope(5, null)
out.push('nosensor=' + (noSensor.slopeDeg === null ? 'NULL' : 'BAD') + '/' + noSensor.geomStatus)
// brez vizualne meje → NEZADOSTNI_PODATKI
const noEdge = estimateSlope(null, 0)
out.push('noedge=' + (noEdge.slopeDeg === null ? 'NULL' : 'BAD') + '/' + noEdge.geomStatus)
// telefon ~raven (0°) + vizualni 5° → ocena 5°
const straight = estimateSlope(5, 0)
out.push('straight=' + straight.slopeDeg + '/' + straight.geomStatus)
// kompenzacija: vizualni −7°, roll +5° → −2° (ločitev od nagiba telefona)
const comp = estimateSlope(-7, 5)
out.push('comp=' + comp.slopeDeg + '/' + comp.geomStatus)
// telefon premočno nagnjen (20°) → zavrne oceno
const tooRolled = estimateSlope(4, 20)
out.push('toorolled=' + (tooRolled.slopeDeg === null ? 'NULL' : 'BAD'))
// ~0° → videti ravna
const flat = estimateSlope(0.5, 0)
out.push('flat=' + flat.slopeDeg + '/' + flat.geomStatus)
// smer padca
out.push('dir=' + (estimateSlope(6, 0).direction ?? 'none'))
// pickLabels z pripetim elementom: PODLAGA pripeta ostane prikazana kljub 5 višjim
const els = [
  { id: 'p', cls: 'PODLAGA', status: 'PREPOZNANO', source: 'LOKALNO', confidence: 0.6, bbox: [0, 0.67, 1, 0.33], at: 1 },
  { id: 'o', cls: 'OSEBA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.5, 0.2, 0.1, 0.3], at: 1 },
  { id: 'r', cls: 'ROB', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.05, 0.44, 0.9, 0.1], at: 1 },
  { id: 'g', cls: 'OGRAJA', status: 'NEJASNO', source: 'LOKALNO', confidence: 0.25, bbox: [0.1, 0.3, 0.8, 0.1], at: 1 },
  { id: 's', cls: 'STOPNICA', status: 'NEJASNO', source: 'LOKALNO', confidence: 0.3, bbox: [0.05, 0.4, 0.9, 0.2], at: 1 },
  { id: 'v', cls: 'OVIRA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.35, bbox: [0.7, 0.1, 0.2, 0.2], at: 1 },
]
const pk = pickLabels(els, 4)
out.push('order=' + pk.map(e => e.cls).join(','))
const pkPin = pickLabels(els, 4, new Set(['p']))
out.push('pin=' + pkPin.map(e => e.id).join(','))
// sanitize: slopeDeg brez vira izpuščen
const san = sanitizeSceneResult({ version: 1, at: 1, elements: [
  { id: 'e1', cls: 'PODLAGA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.5, bbox: [0, 0.6, 1, 0.4], slopeDeg: 7, at: 1 },
  { id: 'e2', cls: 'PODLAGA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.5, bbox: [0, 0.6, 1, 0.4], slopeDeg: 7, slopeSource: 'VIZUALNA_GEOMETRIJA', at: 1 },
], edits: [] })
const e1 = san.elements.find(e => e.id === 'e1'); const e2 = san.elements.find(e => e.id === 'e2')
out.push('sanslope=' + (e1.slopeDeg === undefined ? 'DROPPED' : 'BAD') + '/' + (e2.slopeDeg === 7 ? 'KEPT' : 'BAD'))
// applyEdits slopeDeg → ROCNO/IZMERJENO
const disp = applyEdits({ version: 1, at: 1, elements: [JSON.parse(JSON.stringify(e2))], edits: [{ elementId: 'e2', slopeDeg: 4.5, by: 'test', at: 2 }] })
out.push('edit=' + disp[0].slopeDeg + '/' + disp[0].slopeSource + '/' + disp[0].geomStatus)
console.log(out.join('|'))
'''
out, err = bun_ts(CORE_JS)
if out.strip():
    parts = out.strip().split('\n')[-1].split('|')
    m = {}
    for p in parts:
        if '=' in p:
            k, v = p.split('=', 1)
            m[k] = v
    chk(m.get('nosensor') == 'NULL/NEZADOSTNI_PODATKI', f'brez senzorja: naklon NI trden ({m.get("nosensor")})')
    chk(m.get('noedge') == 'NULL/NEZADOSTNI_PODATKI', f'brez vizualne meje: NEZADOSTNI_PODATKI ({m.get("noedge")})')
    chk(m.get('straight') == '5/GEOMETRIJA_OCENJENA', f'raven telefon + vizualni 5° → ocena 5° ({m.get("straight")})')
    chk(m.get('comp') == '-2/GEOMETRIJA_OCENJENA', f'kompenzacija −7°+5° roll → −2° ({m.get("comp")})')
    chk(m.get('toorolled') == 'NULL', f'premočno nagnjen telefon → zavrnjeno ({m.get("toorolled")})')
    chk(m.get('flat') == '0/GEOMETRIJA_OCENJENA', f'~0° → videti ravna ({m.get("flat")})')
    chk(m.get('dir') == 'desno', f'smer padca desno ({m.get("dir")})')
    order = m.get('order', '')
    chk(order == 'OSEBA,OVIRA,ROB,STOPNICA', f'vrstni red: OSEBA>OVIRA>ROB>STOPNICA ({order})')
    chk(m.get('pin') == 'p,o,v,r', f'pripnjen element vedno prikazan (p + OSEBA/OVIRA/ROB izpodrini STOPNICO) ({m.get("pin")})')
    chk(m.get('sanslope') == 'DROPPED/KEPT', f'sanitize: slope brez vira izpuščen, z virom ohranjen ({m.get("sanslope")})')
    chk(m.get('edit') == '4.5/ROCNO/IZMERJENO', f'applyEdits slopeDeg → ROCNO/IZMERJENO ({m.get("edit")})')
else:
    bad(f'core bun izvedba: {err}')

print('── E) regresija (F1 struktura brez novih polj)')
# E1: F1 struktura gre še vedno skozi sanitize
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'note': TAG + 'f1',
    'sceneUnderstanding': {'version': 1, 'at': 1760000000000, 'elements': [el('el-f1', 'PODLAGA')], 'edits': []},
})
chk(s == 201, f'F1 struktura (brez novih polj) 201 ({s})')
sid_f1 = d.get('data', {}).get('id'); snap_ids.append(sid_f1)
s, d = callj('GET', f'/api/ar-snapshots/{sid_f1}/scene-element', monter)
chk(s == 200 and len(d.get('data', {}).get('result', {}).get('elements', [])) == 1, f'F1 snapshot preberljiv ({s})')
# E2: osnovni endpointi
s, _ = callj('GET', '/api/ar-snapshots', monter)
chk(s == 200, f'seznam AR posnetkov 200 ({s})')
s, _ = callj('GET', '/api/measurements', monter)
chk(s == 200, f'meritve 200 ({s})')
s, _ = callj('GET', '/api/projects', monter)
chk(s == 200, f'projekti 200 ({s})')

print('── F) čiščenje')
CLEAN_ALL = CLEAN_JS.replace('__TAG__', TAG)  # vse R468-TEST* (tudi 'b','c','f1')
out, _ = bun_ts(CLEAN_ALL)
chk('CLEAN_DONE' in out, 'počiščenje testnih zapisov')

print()
print(f'══ R468 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL else 0)

#!/usr/bin/env python3
"""tests/r469.py — R469 SMART VISION F3: STOPNICE (issue #8 §11 Faza 3)

Preverja:
  A) RBAC (fail-closed): PATCH scene-element z novima poljema steps/ascent brez
     žetona 401; skladišče/proizvodnja (brez measurements.write) 403.
  B) SANITIZACIJA novih polj stopnic na POST /api/ar-snapshots: veljaven
     STOPNICA (steps, ascent, stepLines, stepGap, stepIrregular, landing) se
     ohrani v sceneJson (GET scene-element); neveljavni (steps 99, 0 →
     izpuščeni; ascent 'gor' → izpusten; daljica y=1.5 → izpuščena; 15 daljic
     → reže na 12; stepGap 0/1.4 → izpuščen).
  C) PATCH scene-element steps/ascent (ročna potrditev): 200 + revizija
     SCENE_EDIT z before.steps/before.ascent; GET displayed kaže ROCNO +
     IZMERJENO; izvirni element ostane z izvirnimi vrednostmi (označen
     podatek, ne tiha sprememba); steps 50 kot edini popravek → 400;
     neobstoječ elementId → 404.
  D) CORE LOGIKA (bun): analyzeStairPattern — enakomeren vzorec (5 črt) →
     steps/ascent 'globina'/pravilen; drif središč → levo/desno; vrzel 3×
     medij → landing; neenakomeren razmak → stepIrregular; 2 črti → null;
     šum (razmak 1 px) → null; sanitize izpusti neveljavna polja; applyEdits
     steps → ROCNO/IZMERJENO; nextStepGuidance za stopnice s podestom in
     neenakomernostjo.
  E) Regresija: F2 struktura (ROB z angleDeg, PODLAGA z masko/naklonom) gre
     še vedno skozi sanitize; /api/ar-snapshots, meritve, projekti 200.
  F) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R469-TEST'
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
  await p.user.deleteMany({where:{email:{contains:'r469'}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG)

def el (eid='el-1', cls='STOPNICA', status='VERJETNO', source='LOKALNO',
         bbox=None, confidence=0.4, kind=None, **extra):
    e = {
        'id': eid, 'cls': cls, 'status': status, 'source': source,
        'confidence': confidence, 'bbox': bbox or [0.05, 0.2, 0.9, 0.5],
        'at': 1760000000000,
    }
    if kind is not None: e['kind'] = kind
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
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', body={'elementId': 'el-1', 'steps': 5})
chk(s == 401, f'PATCH scene-element (steps) brez žetona 401 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', body={'elementId': 'el-1', 'ascent': 'desno'})
chk(s == 401, f'PATCH scene-element (ascent) brez žetona 401 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', skladisce, {'elementId': 'el-1', 'steps': 5})
chk(s == 403, f'skladišče PATCH steps 403 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', proizvodnja, {'elementId': 'el-1', 'ascent': 'levo'})
chk(s == 403, f'proizvodnja PATCH ascent 403 ({s})')

print('── B) sanitizacija novih polj stopnic (POST ar-snapshots)')
# B1: veljaven F3 snapshot — STOPNICA z vsemi polji
lines_ok = [
    {'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3},
    {'x1': 0.1, 'y1': 0.4, 'x2': 0.9, 'y2': 0.4},
    {'x1': 0.1, 'y1': 0.5, 'x2': 0.9, 'y2': 0.5},
]
scene_ok = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-stair', steps=6, ascent='desno', stepLines=lines_ok,
           stepGap=0.083, stepIrregular=False, landing=True, geomStatus='GEOMETRIJA_OCENJENA'),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG, 'sceneUnderstanding': scene_ok})
chk(s == 201, f'POST z veljavno F3 stopniško geometrijo 201 ({s})')
sid = d.get('data', {}).get('id'); snap_ids.append(sid)
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
st = els.get('el-stair', {})
chk(st.get('steps') == 6 and st.get('ascent') == 'desno', f"steps+ascent ohranjena ({st.get('steps')}/{st.get('ascent')})")
chk(len(st.get('stepLines', [])) == 3, f"stepLines (3 daljice) ohranjene ({len(st.get('stepLines', []))})")
chk(st.get('stepGap') == 0.083, f'stepGap ohranjen ({st.get("stepGap")})')
chk(st.get('landing') is True and st.get('stepIrregular') is None,
    f"landing=True ohranjen; stepIrregular=False izpuščen (privzeto) ({st.get('landing')}/{st.get('stepIrregular')})")

# B2: neveljavni vnosi se izločijo/orežejo
many_lines = [{'x1': 0.05, 'y1': 0.2 + i * 0.03, 'x2': 0.95, 'y2': 0.2 + i * 0.03} for i in range(15)]
scene_bad = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        # steps 99 → izven meje → izpuščen
        el('el-a', steps=99, ascent='desno'),
        # steps 0 → izpuščen; ascent 'gor' → izpuščen
        el('el-b', steps=0, ascent='gor'),
        # daljica z y=1.5 → izpuščena, ostale veljavne ostanejo
        el('el-c', stepLines=[{'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3},
                              {'x1': 0.1, 'y1': 1.5, 'x2': 0.9, 'y2': 1.5}]),
        # 15 daljic → reže na 12
        el('el-d', stepLines=many_lines),
        # stepGap 1.4 → izven 0..1 → izpuščen; stepGap 0 → izpuščen
        el('el-e', stepGap=1.4),
        el('el-f', stepGap=0.0),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'b', 'sceneUnderstanding': scene_bad})
chk(s == 201, f'POST z neveljavnimi polji vseeno 201 (elementi sami po sebi veljavni) ({s})')
sid_b = d.get('data', {}).get('id'); snap_ids.append(sid_b)
s, d = callj('GET', f'/api/ar-snapshots/{sid_b}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
chk('steps' not in els.get('el-a', {}), f"steps 99 izpuščen ({els.get('el-a', {}).get('steps')})")
chk('steps' not in els.get('el-b', {}) and 'ascent' not in els.get('el-b', {}),
    f"steps 0 in ascent 'gor' izpuščena ({els.get('el-b', {}).get('steps')}/{els.get('el-b', {}).get('ascent')})")
chk(len(els.get('el-c', {}).get('stepLines', [])) == 1, f"neveljavna daljica izpuščena, veljavna ostane ({len(els.get('el-c', {}).get('stepLines', []))})")
chk(len(els.get('el-d', {}).get('stepLines', [])) == 12, f"15 daljic reže na 12 ({len(els.get('el-d', {}).get('stepLines', []))})")
chk('stepGap' not in els.get('el-e', {}) and 'stepGap' not in els.get('el-f', {}),
    f'stepGap izven meja izpuščen ({els.get("el-e", {}).get("stepGap")}/{els.get("el-f", {}).get("stepGap")})')

# B3: edit z neveljavnim steps/ascent se izpusti (sanitize edits)
scene_edit_bad = {
    'version': 1, 'at': 1760000000000,
    'elements': [el('el-ok')],
    'edits': [{'elementId': 'el-ok', 'steps': 88, 'by': 'test', 'at': 1},
               {'elementId': 'el-ok', 'ascent': 'gor', 'by': 'test', 'at': 2}],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'c', 'sceneUnderstanding': scene_edit_bad})
sid_c = d.get('data', {}).get('id'); snap_ids.append(sid_c)
s, d = callj('GET', f'/api/ar-snapshots/{sid_c}/scene-element', monter)
edits = d.get('data', {}).get('result', {}).get('edits', [])
chk(len(edits) == 0, f'edita z steps 88 / ascent "gor" izpuščena ({len(edits)})')

print('── C) PATCH steps/ascent — ročna potrditev kot OZNAČEN PODATEK')
# C1: veljaven popravek števila
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-stair', 'steps': 7})
chk(s == 200, f'PATCH steps 200 ({s})')
chk(d.get('data', {}).get('edit', {}).get('steps') == 7, 'odgovor vsebuje edit.steps')
chk(audit_has(admin, 'SCENE_EDIT', sid), 'revizija SCENE_EDIT zapisana')
# C2: displayed kaže ROCNO + IZMERJENO; izvirnik ostane 6 (LOKALNO ocena)
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
data = d.get('data', {})
orig = next((e for e in data.get('result', {}).get('elements', []) if e['id'] == 'el-stair'), {})
disp = next((e for e in data.get('displayed', []) if e['id'] == 'el-stair'), {})
chk(orig.get('steps') == 6, f'izvirnik ostaja z izvirnim številom ({orig.get("steps")})')
chk(disp.get('steps') == 7 and disp.get('source') == 'ROCNO' and disp.get('geomStatus') == 'IZMERJENO',
    f'prikaz: ročno potrjeno IZMERJENO ({disp.get("steps")}/{disp.get("source")}/{disp.get("geomStatus")})')
# C3: popravek smeri
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-stair', 'ascent': 'levo'})
chk(s == 200, f'PATCH ascent levo 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
disp = next((e for e in d.get('data', {}).get('displayed', []) if e['id'] == 'el-stair'), {})
chk(disp.get('ascent') == 'levo', f'displayed ascent levo ({disp.get("ascent")})')
# C4: steps 50 kot edini popravek → 400
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-stair', 'steps': 50})
chk(s == 400, f'PATCH steps 50 (izven 1..20) → 400 ({s})')
# C5: neobstoječ elementId → 404
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {'elementId': 'el-ne-obstaja', 'steps': 5})
chk(s == 404, f'PATCH z neobstoječim elementId 404 ({s})')

print('── D) core logika (scene-understanding-core, bun)')
CORE_JS = r'''
import { analyzeStairPattern, ascentText, applyEdits, sanitizeSceneResult, nextStepGuidance } from './src/lib/scene-understanding-core'
const out = []
// enakomeren vzorec: 5 črt na 30 px, središča fiksna → globina, pravilni razmaki
const reg = [{y:60,xFrom:30,xTo:290},{y:90,xFrom:30,xTo:290},{y:120,xFrom:30,xTo:290},{y:150,xFrom:30,xTo:290},{y:180,xFrom:30,xTo:290}]
const v1 = analyzeStairPattern(reg, 320, 240)
out.push('reg=' + v1.steps + '/' + v1.ascent + '/' + v1.stepIrregular + '/' + v1.landing)
// drif navzgor v desno → vzpon 'desno'
const dr = [{y:60,xFrom:150,xTo:270},{y:90,xFrom:120,xTo:240},{y:120,xFrom:90,xTo:210},{y:150,xFrom:60,xTo:180},{y:180,xFrom:30,xTo:150}]
out.push('driftR=' + analyzeStairPattern(dr, 320, 240).ascent)
// drif navzgor v levo → vzpon 'levo'
const dl = [{y:60,xFrom:50,xTo:170},{y:90,xFrom:80,xTo:200},{y:120,xFrom:110,xTo:230},{y:150,xFrom:140,xTo:260},{y:180,xFrom:170,xTo:290}]
out.push('driftL=' + analyzeStairPattern(dl, 320, 240).ascent)
// vrzel 3× medij → podest
const la = [{y:60,xFrom:30,xTo:290},{y:90,xFrom:30,xTo:290},{y:120,xFrom:30,xTo:290},{y:210,xFrom:30,xTo:290}]
const v4 = analyzeStairPattern(la, 320, 240)
out.push('landing=' + v4.landing + '/' + v4.stepIrregular)
// neenakomeren razmak brez podesta (42 pri mediju 30)
const irr = [{y:60,xFrom:30,xTo:290},{y:90,xFrom:30,xTo:290},{y:132,xFrom:30,xTo:290},{y:162,xFrom:30,xTo:290}]
out.push('irr=' + analyzeStairPattern(irr, 320, 240).stepIrregular + '/' + analyzeStairPattern(irr, 320, 240).landing)
// dve črti → ni vzorca
out.push('two=' + (analyzeStairPattern(reg.slice(0, 2), 320, 240) === null ? 'NULL' : 'BAD'))
// šum (razmak 1 px) → null
const noise = [{y:60,xFrom:30,xTo:290},{y:61,xFrom:30,xTo:290},{y:62,xFrom:30,xTo:290}]
out.push('noise=' + (analyzeStairPattern(noise, 320, 240) === null ? 'NULL' : 'BAD'))
// stepGap normaliziran na višino (30/240 = 0.125)
out.push('gap=' + v1.stepGap)
// ascentText preslikave
out.push('atext=' + [ascentText('desno'), ascentText('levo'), ascentText('globina'), ascentText(undefined)].join(';'))
// sanitize: neveljavna polja izpuščena, veljavna ohranjena
const san = sanitizeSceneResult({ version: 1, at: 1, elements: [
  { id: 's1', cls: 'STOPNICA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.05,0.2,0.9,0.5], steps: 6, ascent: 'desno',
    stepLines: [{x1:0.1,y1:0.3,x2:0.9,y2:0.3},{x1:0.1,y1:0.5,x2:1.5,y2:0.5}], at: 1 },
  { id: 's2', cls: 'STOPNICA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.05,0.2,0.9,0.5], steps: 99, ascent: 'gor', at: 1 },
], edits: [] })
const s1 = san.elements.find(e => e.id === 's1'); const s2 = san.elements.find(e => e.id === 's2')
out.push('san=' + s1.steps + '/' + s1.ascent + '/' + s1.stepLines.length + '/' + (s2.steps === undefined ? 'DROPPED' : 'BAD') + '/' + (s2.ascent === undefined ? 'DROPPED' : 'BAD'))
// applyEdits steps → ROCNO/IZMERJENO
const disp = applyEdits({ version: 1, at: 1, elements: [JSON.parse(JSON.stringify(s1))], edits: [{ elementId: 's1', steps: 7, by: 'test', at: 2 }] })
out.push('edit=' + disp[0].steps + '/' + disp[0].source + '/' + disp[0].geomStatus)
// guidance: stopnice s podestom / neenakomerne / navadne
out.push('g1=' + nextStepGuidance([s1]).slice(0, 30))
out.push('g2=' + nextStepGuidance([{ ...s1, landing: true }]).slice(0, 25))
out.push('g3=' + nextStepGuidance([{ ...s1, stepIrregular: true }]).slice(0, 22))
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
    chk(m.get('reg') == '5/globina/false/false', f'enakomeren vzorec: 5 nastopov, globina, pravilni ({m.get("reg")})')
    chk(m.get('driftR') == 'desno', f'drif navzgor desno → vzpon desno ({m.get("driftR")})')
    chk(m.get('driftL') == 'levo', f'drif navzgor levo → vzpon levo ({m.get("driftL")})')
    chk(m.get('landing') == 'true/true', f'vrzel 3× medij → podest + neenakomernost ({m.get("landing")})')
    chk(m.get('irr') == 'true/false', f'neenakomeren razmak brez podesta ({m.get("irr")})')
    chk(m.get('two') == 'NULL', f'dve črti nista vzorec stopnic ({m.get("two")})')
    chk(m.get('noise') == 'NULL', f'šum (razmak 1 px) zavrnjen ({m.get("noise")})')
    chk(m.get('gap') == '0.125', f'stepGap normaliziran na višino kadra ({m.get("gap")})')
    chk(m.get('atext') == 'v desno;v levo;od kamere (v globino);neznana', f'ascentText preslikave ({m.get("atext")})')
    chk(m.get('san') == '6/desno/1/DROPPED/DROPPED', f'sanitize: veljavno ohranjeno, neveljavna daljica/steps/ascent izpuščeni ({m.get("san")})')
    chk(m.get('edit') == '7/ROCNO/IZMERJENO', f'applyEdits steps → ROCNO/IZMERJENO ({m.get("edit")})')
    chk(m.get('g1', '').startswith('Zaznane stopnice (6 nastopov'), f'guidance: število nastopov v sporočilu ({m.get("g1")})')
    chk(m.get('g2', '').startswith('Stopnišče z morebitni'), f'guidance: podest ima prednost ({m.get("g2")})')
    chk(m.get('g3', '').startswith('Razmaki med stopnicami'), f'guidance: neenakomernost ima prednost ({m.get("g3")})')
else:
    bad(f'core bun izvedba: {err}')

print('── E) regresija (F2 struktura brez novih polj)')
# E1: F2 struktura gre še vedno skozi sanitize
mask_ok = [{'x': 0.1, 'y': 0.7}, {'x': 0.9, 'y': 0.72}, {'x': 0.88, 'y': 1.0}, {'x': 0.12, 'y': 1.0}]
scene_f2 = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-floor', 'PODLAGA', maskPoints=mask_ok, slopeDeg=3.5,
           slopeSource='VIZUALNA_GEOMETRIJA', geomStatus='GEOMETRIJA_OCENJENA', kind='BETON'),
        el('el-edge', 'ROB', bbox=[0.05, 0.44, 0.9, 0.1], angleDeg=-4.2, geomStatus='GEOMETRIJA_OCENJENA'),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'f2', 'sceneUnderstanding': scene_f2})
chk(s == 201, f'F2 struktura (brez F3 polj) 201 ({s})')
sid_f2 = d.get('data', {}).get('id'); snap_ids.append(sid_f2)
s, d = callj('GET', f'/api/ar-snapshots/{sid_f2}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
fl = els.get('el-floor', {}); ed = els.get('el-edge', {})
chk(fl.get('slopeDeg') == 3.5 and fl.get('slopeSource') == 'VIZUALNA_GEOMETRIJA', f'F2 naklon z virom še deluje ({fl.get("slopeDeg")}/{fl.get("slopeSource")})')
chk(ed.get('angleDeg') == -4.2, f'F2 ROB z angleDeg še deluje ({ed.get("angleDeg")})')
# E2: osnovni endpointi
s, _ = callj('GET', '/api/ar-snapshots', monter)
chk(s == 200, f'seznam AR posnetkov 200 ({s})')
s, _ = callj('GET', '/api/measurements', monter)
chk(s == 200, f'meritve 200 ({s})')
s, _ = callj('GET', '/api/projects', monter)
chk(s == 200, f'projekti 200 ({s})')

print('── F) čiščenje')
CLEAN_ALL = CLEAN_JS.replace('__TAG__', TAG)  # vse R469-TEST* (tudi 'b','c','f2')
out, _ = bun_ts(CLEAN_ALL)
chk('CLEAN_DONE' in out, 'počiščenje testnih zapisov')

print()
print(f'══ R469 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL else 0)

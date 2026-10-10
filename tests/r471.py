#!/usr/bin/env python3
"""tests/r471.py — R471 SMART VISION Faza 4: SENZORJI, OPTIMIZACIJA, INTEGRACIJA (issue #8 §11)

Preverja:
  A) RBAC (fail-closed): PATCH scene-element z measure+depth brez žetona 401;
     skladišče/proizvodnja (brez measurements.write) 403.
  B) CORE LOGIKA (bun, čista):
     isDepthManifest (veljaven/neveljaven), unprojectDepthSample (center/odmik/
     izven meja), depthDistanceCm (znana geometrija; neveljavno → NULL),
     pointsDistanceCm (3-4-5 → 500 cm), nextPerfPlan (guverner: hiter kadrček
     brez spremembe, 3 počasni → degradacija, null → reset, strop 750/160),
     applyEdits (manifest → DEPTH_AR + sensor; ročni popravek po globini →
     ROCNO_POPRAVLJENO; ročni vnos → ROCNI_VNOS), consolidateMeasures
     (popravka prevlada nad DEPTH_AR), sanitizeSceneResult (DEPTH_AR brez
     manifesta se izpusti, z njim se ohrani; OSEBA še vedno strip), ter čiste
     pomožne depth-adapterja (focalPxFromProjection, multiplyPoint, transformRay).
  C) API PATCH z globino: { measure, depth } → 200; metoda DEPTH_AR se izpelje
     IZ manifesta (method='DEPTH_AR' brez manifesta ostane ROCNI_VNOS);
     neveljaven manifest → 400; depth brez measure → 400; revizija SCENE_EDIT
     z depthSource; displayed (GET) nosi sensor manifest.
  D) POST /api/ar-snapshots: element measures DEPTH_AR z manifestom se ohrani,
     brez manifesta se izpusti; edit.measure.depth preživi sanitizacijo.
  E) Regresija: F2/F3 struktura, /api/ar-snapshots 200, health OK.
  F) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R471-TEST'
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
    env_url = os.environ.get('DATABASE_URL') or ''
    if not env_url.startswith(('postgresql://', 'postgres://')):
        env_url = ''
    db_url = os.environ.get('TEST_DB_URL') or env_url or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:600]

CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  await p.arSnapshot.deleteMany({where:{OR:[{note:{contains:'__TAG__'}},{scene:{contains:'__TAG__'}}]}});
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

# veljaven manifest senzorja globine (WebXR depth-sensing)
DEPTH_OK = {
    'provider': 'WEBXR_DEPTH',
    'depthFormat': 'luminance-alpha',
    'rawValueToMeters': 0.001,
    'width': 160,
    'height': 120,
    'focalPx': 80,
    'timestamp': 1760000000123,
}

# ── priprava ────────────────────────────────────────────────────────────────
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'predčiščenje')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

snap_ids = []

print('── A) RBAC (fail-closed)')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', body={'elementId': 'el-1', 'measure': {'label': 'višina', 'valueCm': 100}, 'depth': DEPTH_OK})
chk(s == 401, f'PATCH scene-element (measure+depth) brez žetona 401 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', skladisce, {'elementId': 'el-1', 'measure': {'label': 'višina', 'valueCm': 100}, 'depth': DEPTH_OK})
chk(s == 403, f'skladišče PATCH measure+depth 403 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', proizvodnja, {'elementId': 'el-1', 'measure': {'label': 'višina', 'valueCm': 100}, 'depth': DEPTH_OK})
chk(s == 403, f'proizvodnja PATCH measure+depth 403 ({s})')

print('── B) CORE LOGIKA (bun, čista)')
CORE_JS = r'''
import {
  isDepthManifest, unprojectDepthSample, depthDistanceCm, pointsDistanceCm,
  applyEdits, consolidateMeasures, sanitizeSceneResult,
} from './src/lib/scene-understanding-core'
import { focalPxFromProjection, multiplyPoint, transformRay } from './src/lib/depth-adapter'
import { nextPerfPlan } from './src/lib/scene-perception'
const out = []
const M = {
  provider: 'WEBXR_DEPTH', depthFormat: 'luminance-alpha', rawValueToMeters: 0.001,
  width: 160, height: 120, focalPx: 80, timestamp: 1760000000123,
}
// isDepthManifest
const iv = isDepthManifest(M)
out.push('man=' + (iv != null) + '/' + (isDepthManifest({...M, provider: 'LAŽNJI'}) == null) + '/' +
  (isDepthManifest({...M, width: 0}) == null) + '/' + (isDepthManifest({...M, focalPx: -1}) == null) + '/' +
  (isDepthManifest({...M, timestamp: NaN}) == null) + '/' + (isDepthManifest(null) == null))
// unproject: center (u=.5,v=.5) pri globini 2 → {0,0,-2}; u=.75 → px=40 → x=40*2/80=1
const c = unprojectDepthSample({u: 0.5, v: 0.5, depthM: 2}, M)
const o75 = unprojectDepthSample({u: 0.75, v: 0.5, depthM: 2}, M)
out.push('unp=' + (c.x === 0 && c.y === 0 && c.z === -2) + '/' + (Math.abs(o75.x - 1) < 1e-9) + '/' +
  (unprojectDepthSample({u: 0.75, v: 0.5, depthM: 9}, M) == null) + '/' +
  (unprojectDepthSample({u: 1.5, v: 0.5, depthM: 2}, M) == null))
// depthDistanceCm: dva vzorca isti globini 2 m, u=0.25↔0.75 → 80 px razmaka → 2 m → 200 cm
const dd = depthDistanceCm({u: 0.25, v: 0.5, depthM: 2}, {u: 0.75, v: 0.5, depthM: 2}, M)
const ddBad = depthDistanceCm({u: 0.25, v: 0.5, depthM: 2}, {u: 0.75, v: 0.5, depthM: 20}, M)
out.push('dd=' + dd + '/' + (ddBad == null))
// pointsDistanceCm: 3-4-5 → 500 cm
const pd = pointsDistanceCm({x: 0, y: 0, z: 0}, {x: 3, y: 4, z: 0})
out.push('pd=' + pd)
// nextPerfPlan (guverner)
let plan = { intervalMs: 250, workWidth: 320, slowRun: 0 }
const fast = nextPerfPlan(plan, 50)
const slow1 = nextPerfPlan(plan, 200)     // 200 > 250*0.6 = 150
const slow2 = nextPerfPlan(slow1, 200)
const slow3 = nextPerfPlan(slow2, 200)    // 3. počasni → degradacija
const afterNull = nextPerfPlan({ intervalMs: 250, workWidth: 320, slowRun: 2 }, null)
out.push('gov=' + (fast.intervalMs === 250 && fast.workWidth === 320 && fast.slowRun === 0) + '/' +
  slow1.slowRun + slow2.slowRun + '/' + slow3.intervalMs + ',' + slow3.workWidth + '/' +
  afterNull.slowRun)
let p2 = { intervalMs: 350, workWidth: 250, slowRun: 0 }
for (let i = 0; i < 3; i++) p2 = nextPerfPlan(p2, 999)
let p3 = p2
for (let i = 0; i < 30; i++) p3 = nextPerfPlan(p3, 999)
out.push('gov2=' + p2.intervalMs + ',' + p2.workWidth + '/' + p3.intervalMs + ',' + p3.workWidth)
// applyEdits: manifest → DEPTH_AR + sensor
const mkScene = (measures) => ({ version: 1, at: 1, elements: [
  { id: 'e1', cls: 'ROB', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4,
    bbox: [0.1, 0.2, 0.8, 0.6], at: 1, ...(measures ? { measures } : {}) },
], edits: [] })
const applied = applyEdits({ version: 1, at: 1, elements: [ { id: 'e1', cls: 'ROB', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.1, 0.2, 0.8, 0.6], at: 1, measures: [{ label: 'dolžina', valueCm: 180, method: 'DEPTH_AR', sensor: M, at: 2 }] } ], edits: [] })
const depthMeasure = applied[0].measures?.[0]
out.push('ap1=' + (depthMeasure?.method === 'DEPTH_AR') + '/' + (depthMeasure?.sensor?.provider === 'WEBXR_DEPTH'))
// ročni popravek po globini na isti naziv → ROCNO_POPRAVLJENO (prevlada konsolidacije)
const applied2 = applyEdits({ version: 1, at: 1, elements: [
  { id: 'e1', cls: 'ROB', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.1, 0.2, 0.8, 0.6], at: 1,
    measures: [{ label: 'dolžina', valueCm: 180, method: 'DEPTH_AR', sensor: M, at: 2 }] },
], edits: [{ elementId: 'e1', measure: { label: 'dolžina', valueCm: 183 }, by: 'monter', at: 3 }] })
const cons = consolidateMeasures(applied2[0].measures ?? [])
out.push('ap2=' + cons[0].method + '/' + cons[0].valueCm)
// edit z manifestom (senzorska pot prek PATCH)
const applied3 = applyEdits({ version: 1, at: 1, elements: [
  { id: 'e1', cls: 'ROB', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.1, 0.2, 0.8, 0.6], at: 1 },
], edits: [{ elementId: 'e1', measure: { label: 'širina', valueCm: 95.5, depth: M }, by: 'monter', at: 3 }] })
const dm3 = applied3[0].measures?.[0]
out.push('ap3=' + (dm3?.method === 'DEPTH_AR') + '/' + (dm3?.sensor?.depthFormat === 'luminance-alpha'))
// ročni vnos brez manifesta → ROCNI_VNOS (invarianta R470)
const applied4 = applyEdits({ version: 1, at: 1, elements: [
  { id: 'e1', cls: 'ROB', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.1, 0.2, 0.8, 0.6], at: 1 },
], edits: [{ elementId: 'e1', measure: { label: 'širina', valueCm: 90, method: 'DEPTH_AR' }, by: 'monter', at: 3 }] })
out.push('ap4=' + (applied4[0].measures?.[0]?.method === 'ROCNI_VNOS'))
// sanitize: DEPTH_AR z manifestom ohranjena, brez manifesta izpuščena
const sRaw = { version: 1, at: 1, elements: [
  { id: 'e1', cls: 'ROB', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.1, 0.2, 0.8, 0.6], at: 1,
    measures: [
      { label: 'z manifestom', valueCm: 120, method: 'DEPTH_AR', sensor: M, at: 1 },
      { label: 'brez manifesta', valueCm: 130, method: 'DEPTH_AR', at: 1 },
      { label: 'običajna', valueCm: 140, method: 'ROCNI_VNOS', at: 1 },
    ] },
], edits: [
  { elementId: 'e1', measure: { label: 'iz patcha', valueCm: 100, depth: M }, by: 'monter', at: 2 },
  { elementId: 'e1', measure: { label: 'iz patcha slab', valueCm: 110, depth: { provider: 'X' } }, by: 'monter', at: 2 },
] }
const sane = sanitizeSceneResult(JSON.parse(JSON.stringify(sRaw)))
const saneEl = sane?.elements?.[0]
const saneM = saneEl?.measures ?? []
out.push('san=' + saneM.length + '/' + (saneM[0]?.sensor?.provider === 'WEBXR_DEPTH') + '/' +
  (sane?.edits?.[0]?.measure?.depth != null) + '/' + (sane?.edits?.[1]?.measure?.depth == null))
// adapter pomožne
const fx = focalPxFromProjection([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 160)
const mp = multiplyPoint([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1], { x: 1, y: 2, z: 3 })
const tr = transformRay([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 })
out.push('adp=' + fx + '/' + (mp.x === 6 && mp.y === 8 && mp.z === 10) + '/' + (tr.dir.z === -1 && tr.dir.x === 0))
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
    chk(m.get('man') == 'true/true/true/true/true/true', f'isDepthManifest: veljaven sprejet, vsi neveljavni zavrnjeni ({m.get("man")})')
    chk(m.get('unp') == 'true/true/true/true', f'unprojectDepthSample: center/odmik/meje ({m.get("unp")})')
    chk(m.get('dd') == '200/true', f'depthDistanceCm: 80 px @ 2 m / f 80 → 200 cm; izven meja NULL ({m.get("dd")})')
    chk(m.get('pd') == '500', f'pointsDistanceCm: 3-4-5 → 500 cm ({m.get("pd")})')
    chk(m.get('gov') == 'true/12/350,250/0', f'nextPerfPlan: hiter mir, 3 počasni → degradacija, null resetira ({m.get("gov")})')
    chk(m.get('gov2') == '490,190/750,160', f'nextPerfPlan: ponovna degradacija in strop 750/160 ({m.get("gov2")})')
    chk(m.get('ap1') == 'true/true', f'applyEdits: persistirana DEPTH_AR mera nosi sensor ({m.get("ap1")})')
    chk(m.get('ap2') == 'ROCNO_POPRAVLJENO/183', f'konsolidacija: ročna popravka prevlada nad DEPTH_AR ({m.get("ap2")})')
    chk(m.get('ap3') == 'true/true', f'applyEdits: edit z manifestom → DEPTH_AR + sensor ({m.get("ap3")})')
    chk(m.get('ap4') == 'true', f'applyEdits: method=DEPTH_AR BREZ manifesta → ROCNI_VNOS ({m.get("ap4")})')
    chk(m.get('san') == '2/true/true/true', f'sanitize: DEPTH_AR brez manifesta izpuščena, z njim ohranjena; edit.depth preživi ({m.get("san")})')
    chk(m.get('adp') == '80/true/true', f'adapter: fokus iz projekcije, multiplyPoint, transformRay ({m.get("adp")})')
else:
    bad(f'CORE_JS brez izhoda: {err}')

print('── C) API PATCH z globino (manifest → DEPTH_AR)')
# C0: posnetek z elementom brez mer
scene_c = {
    'version': 1, 'at': 1760000000000,
    'elements': [el('el-c', 'ROB', angleDeg=-4)],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'c0', 'sceneUnderstanding': scene_c})
chk(s == 201, f'posnetek C0 201 ({s})')
sid = d.get('data', {}).get('id'); snap_ids.append(sid)

# C1: PATCH measure+depth (veljaven manifest) → 200, metoda se izpelje IZ manifesta
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {
    'elementId': 'el-c', 'measure': {'label': 'dolžina roba', 'valueCm': 212.3}, 'depth': DEPTH_OK,
})
chk(s == 200, f'PATCH measure+depth 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('displayed', [])}
ms = els.get('el-c', {}).get('measures', [])
chk(len(ms) == 1 and ms[0].get('method') == 'DEPTH_AR', f'displayed: mera z metodo DEPTH_AR ({[x.get("method") for x in ms]})')
chk(ms[0].get('sensor', {}).get('provider') == 'WEBXR_DEPTH', f'displayed: sensor manifest prisoten ({ms[0].get("sensor", {}).get("provider")})')
chk(abs(ms[0].get('valueCm', 0) - 212.3) < 0.01, f'displayed: vrednost 212,3 cm ({ms[0].get("valueCm")})')

# C2: zahteva z method='DEPTH_AR' BREZ manifesta → ROCNI_VNOS (invarianta R470)
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {
    'elementId': 'el-c', 'measure': {'label': 'širina', 'valueCm': 88, 'method': 'DEPTH_AR'},
})
chk(s == 200, f'PATCH method=DEPTH_AR brez manifesta 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('displayed', [])}
ms = {x['label']: x for x in els.get('el-c', {}).get('measures', [])}
chk(ms.get('širina', {}).get('method') == 'ROCNI_VNOS', f'lažni DEPTH_AR → ROCNI_VNOS ({ms.get("širina", {}).get("method")})')

# C3: neveljaven manifest → 400
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {
    'elementId': 'el-c', 'measure': {'label': 'x', 'valueCm': 50}, 'depth': {'provider': 'NIKPAK'},
})
chk(s == 400, f'neveljaven manifest → 400 ({s})')

# C4: depth brez measure → 400
s, d = callj('PATCH', f'/api/ar-snapshots/{sid}/scene-element', monter, {
    'elementId': 'el-c', 'depth': DEPTH_OK,
})
chk(s == 400, f'depth brez measure → 400 ({s})')

# C5: revizija SCENE_EDIT z depthSource
s, d = callj('GET', '/api/audit?action=SCENE_EDIT&limit=50', admin)
rows = d.get('data', []) if s == 200 else []
def row_detail (r):
    det = r.get('detail')
    if isinstance(det, str):
        try: det = json.loads(det)
        except Exception: det = {}
    return det if isinstance(det, dict) else {}
hit = next((r for r in rows if r.get('entityId') == sid and row_detail(r).get('depthSource', {}).get('provider') == 'WEBXR_DEPTH'), None)
chk(hit is not None, 'revizija SCENE_EDIT vsebuje depthSource (provider)')

print('── D) POST sanitizacija globine')
scene_d = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-d', 'ROB', angleDeg=-4, measures=[
            {'label': 'z globino', 'valueCm': 150, 'method': 'DEPTH_AR', 'sensor': DEPTH_OK, 'at': 1760000000001},
            {'label': 'brez manifesta', 'valueCm': 151, 'method': 'DEPTH_AR', 'at': 1760000000002},
            {'label': 'ročna', 'valueCm': 152, 'method': 'ROCNI_VNOS', 'at': 1760000000003},
        ]),
    ],
    'edits': [
        {'elementId': 'el-d', 'measure': {'label': 'iz patcha z globino', 'valueCm': 99, 'depth': DEPTH_OK}, 'by': 'monter', 'at': 1760000000004},
    ],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'd1', 'sceneUnderstanding': scene_d})
chk(s == 201, f'posnetek D 201 ({s})')
sid_d = d.get('data', {}).get('id'); snap_ids.append(sid_d)
s, d = callj('GET', f'/api/ar-snapshots/{sid_d}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('displayed', [])}
ms = {x['label']: x for x in els.get('el-d', {}).get('measures', [])}
chk(ms.get('z globino', {}).get('method') == 'DEPTH_AR', f'DEPTH_AR z manifestom ohranjena ({ms.get("z globino", {}).get("method")})')
chk(ms.get('z globino', {}).get('sensor', {}).get('provider') == 'WEBXR_DEPTH', 'sensor manifest persistiran')
chk('brez manifesta' not in ms, 'mera DEPTH_AR brez manifesta IZPUŠČENA (poštenost §6)')
chk(ms.get('ročna', {}).get('method') == 'ROCNI_VNOS', 'običajna mera ohranjena')
chk(ms.get('iz patcha z globino', {}).get('method') == 'DEPTH_AR', f'edit z manifestom → DEPTH_AR ({ms.get("iz patcha z globino", {}).get("method")})')

print('── E) regresija')
s, d = callj('GET', '/api/ar-snapshots', monter)
chk(s == 200, f'GET /api/ar-snapshots 200 ({s})')
s, d = callj('GET', '/api/health')
chk(s == 200 and d.get('status') == 'ok', f'health OK ({s})')
# F2/F3 struktura še vedno gre skozi
scene_e = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-e', 'ROB', angleDeg=-4),
        el('el-f', 'STOPNICA', steps=5, ascent='levo', stepLines=[{'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3}]),
        el('el-p', 'OSEBA'),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'e1', 'sceneUnderstanding': scene_e})
chk(s == 201, f'F2/F3 posnetek 201 ({s})')
sid_e = d.get('data', {}).get('id'); snap_ids.append(sid_e)
s, d = callj('GET', f'/api/ar-snapshots/{sid_e}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
chk(els.get('el-e', {}).get('angleDeg') == -4, 'ROB z angleDeg ohranjen (F2)')
chk(els.get('el-f', {}).get('steps') == 5 and els.get('el-f', {}).get('ascent') == 'levo', 'STOPNICA s steps/ascent ohranjena (F3)')
chk('el-p' not in els, 'OSEBA se NE persistira (zasebnost §5)')

print('── F) čiščenje')
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'počiščenje')

print(f'\n{TAG}: {PASS} OK, {FAIL} NAPAK')
sys.exit(1 if FAIL > 0 else 0)

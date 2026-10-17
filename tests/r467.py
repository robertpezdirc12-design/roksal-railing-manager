#!/usr/bin/env python3
"""tests/r467.py — R467 SMART VISION F1: ŽIVE OZNAKE IN RAZREDI PRIZORA (issue #8)

Preverja:
  A) RBAC (fail-closed): brez žetona 401 (ar-snapshots POST/GET, scene-element
     GET/PATCH); skladišče (projects.read) GET 200 / POST+PATCH 403;
     proizvodnja GET 200 / PATCH 403; monter (measurements.write) sme vse.
  B) SANITIZACIJA sceneUnderstanding na POST /api/ar-snapshots: neveljavni
     razredi/bbox/viri se izločijo; če nič ne ostane → 400 (brez druge
     vsebine); veljavno → 201 + sceneJson preberljiv na GET [id]; >24
     elementov → reže na 24; version != 1 → zavrnjeno.
  C) SCENE-ELEMENT PATCH (označen podatek): veljaven popravek cls 200 +
     revizija SCENE_EDIT; IZVIRNI element ostane nespremenjen (edits raste,
     elements[0].cls enak); GET scene-element displayed kaže popravek;
     neveljaven elementId 404; brez cls/status/kind 400; snapshot brez
     sceneJson 404; meja maxEdits 409.
  D) CORE LOGIKA (bun): classifySurface — trava→TRAVA, beton→BETON,
     nejasno→NEZNANA; stabilizeElements IoU ohrani ID; pickLabels ≤4 in
     vrstni red (OSEBA pred PODLAGA); nextStepGuidance za osebo/stopnice;
     applyEdits NE mutira izvirnika; sanitize reže na 24.
  E) Regresija: /api/ar-snapshots seznam 200; meritve 200.
  F) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R467-TEST'
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
    # R470: samo veljavni postgres URL-ji iz okolja — sqlite ostanki (sandbox
    # razvojne lupine) ne smejo prelomiti Prisma klienta (shema je postgresql)
    env_url = os.environ.get('DATABASE_URL') or ''
    if not env_url.startswith(('postgresql://', 'postgres://')):
        env_url = ''
    db_url = os.environ.get('TEST_DB_URL') or env_url or 'postgresql://roksal:roksal@localhost:54329/roksal'
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
  await p.user.deleteMany({where:{email:{contains:'r467'}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG)

def el (eid='el-1', cls='PODLAGA', status='VERJETNO', source='LOKALNO',
         bbox=None, confidence=0.5, kind='BETON'):
    return {
        'id': eid, 'cls': cls, 'status': status, 'source': source,
        'confidence': confidence, 'bbox': bbox or [0, 2/3, 1, 1/3],
        'kind': kind, 'at': 1760000000000,
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
s, _ = callj('POST', '/api/ar-snapshots')
chk(s == 401, f'POST ar-snapshots brez žetona 401 ({s})')
s, _ = callj('GET', '/api/ar-snapshots')
chk(s == 401, f'GET ar-snapshots brez žetona 401 ({s})')
s, _ = callj('GET', '/api/ar-snapshots/xxx/scene-element')
chk(s == 401, f'GET scene-element brez žetona 401 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', body={'elementId': 'el-1', 'cls': 'TLA'})
chk(s == 401, f'PATCH scene-element brez žetona 401 ({s})')
# skladišče: projects.read DA, measurements.write NE
s, _ = callj('POST', '/api/ar-snapshots', skladisce, {'note': TAG})
chk(s == 403, f'skladišče POST ar-snapshots 403 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', skladisce, {'elementId': 'el-1', 'cls': 'TLA'})
chk(s == 403, f'skladišče PATCH scene-element 403 ({s})')
# proizvodnja: projects.read DA, measurements.write NE
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', proizvodnja, {'elementId': 'el-1', 'status': 'SKRITO'})
chk(s == 403, f'proizvodnja PATCH scene-element 403 ({s})')
s, _ = callj('GET', '/api/ar-snapshots/xxx/scene-element', skladisce)
chk(s == 404, f'skladišče GET scene-element (read OK, neobstoječ → 404, ne 403) ({s})')

print('── B) sanitizacija sceneUnderstanding (POST ar-snapshots)')
# B1: samo neveljaven sceneUnderstanding → nič vsebine → 400
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'sceneUnderstanding': {'version': 1, 'elements': [el(cls='TLE')], 'edits': []},
})
chk(s == 400, f'neveljaven razred izločen → brez vsebine 400 ({s})')
# B2: version != 1 → zavrnjeno
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'note': TAG,
    'sceneUnderstanding': {'version': 2, 'elements': [el()], 'edits': []},
})
chk(s == 201, f'version != 1 zavrže scene, note ohranjen → 201 ({s})')
snap_plain = d.get('data', {}).get('id')
if snap_plain: snap_ids.append(snap_plain)
s, d = callj('GET', f'/api/ar-snapshots/{snap_plain}', monter)
chk(s == 200 and d.get('data', {}).get('sceneJson') is None, f'sceneJson ni shranjen ob zavrnjeni verziji ({s})')
# B3: bbox > 1 izločen, veljaven ostane
mixed = [el('el-bad', bbox=[0, 0, 2, 2]), el('el-ok', bbox=[0.1, 0.5, 0.4, 0.3])]
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'note': TAG,
    'sceneUnderstanding': {'version': 1, 'elements': mixed, 'edits': []},
})
chk(s == 201, f'mešani elementi → 201 ({s})')
snap_mixed = d.get('data', {}).get('id')
if snap_mixed: snap_ids.append(snap_mixed)
s, d = callj('GET', f'/api/ar-snapshots/{snap_mixed}', monter)
stored = d.get('data', {}).get('sceneJson')
try:
    parsed = stored if isinstance(stored, dict) else json.loads(stored)  # R542: jsonb objekt
    ids = [e['id'] for e in parsed['elements']]
    chk('el-ok' in ids and 'el-bad' not in ids, 'bbox >1 izločen, veljaven ostane')
    chk(parsed['elements'][0]['cls'] == 'PODLAGA' and parsed['elements'][0]['kind'] == 'BETON', 'razred+kind shranjena')
except Exception as ex:
    bad(f'sceneJson berljiv: {ex}')
# B4: >24 elementov → reže na 24
many = [el(f'el-{i}', bbox=[0.01 * (i % 90), 0.1, 0.05, 0.05]) for i in range(40)]
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'note': TAG,
    'sceneUnderstanding': {'version': 1, 'elements': many, 'edits': []},
})
snap_many = d.get('data', {}).get('id')
if snap_many: snap_ids.append(snap_many)
s, d = callj('GET', f'/api/ar-snapshots/{snap_many}', monter)
try:
    shranjen = d['data']['sceneJson']
    n = len((shranjen if isinstance(shranjen, dict) else json.loads(shranjen))['elements'])  # R542: jsonb
    chk(n == 24, f'>24 elementov reže na 24 (shranjeno {n})')
except Exception as ex:
    bad(f'preveč elementov: {ex}')
# B5: neveljaven source izločen
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'sceneUnderstanding': {'version': 1, 'elements': [el(source='NEOBNOSTAN')], 'edits': []},
})
chk(s == 400, f'neveljaven vir izločen → 400 brez vsebine ({s})')

print('── C) scene-element PATCH (označen podatek)')
# C1: snapshot brez sceneJson → 404
s, d = callj('PATCH', f'/api/ar-snapshots/{snap_plain}/scene-element', monter, {'elementId': 'el-1', 'cls': 'TLA'})
chk(s == 404, f'snapshot brez razumevanja → 404 ({s})')
# C2: veljaven popravek → 200 + izvirnik nespremenjen
s, d = callj('PATCH', f'/api/ar-snapshots/{snap_mixed}/scene-element', monter, {'elementId': 'el-ok', 'cls': 'TLA'})
chk(s == 200, f'popravek cls 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{snap_mixed}/scene-element', monter)
res = d.get('data', {}).get('result', {})
disp = d.get('data', {}).get('displayed', [])
orig = next((e for e in res.get('elements', []) if e['id'] == 'el-ok'), None)
disp_el = next((e for e in disp if e['id'] == 'el-ok'), None)
chk(orig is not None and orig['cls'] == 'PODLAGA', 'IZVIRNI element nespremenjen (PODLAGA)')
chk(disp_el is not None and disp_el['cls'] == 'TLA' and disp_el.get('source') == 'ROCNO', 'displayed kaže popravek (TLA, ROCNO)')
chk(len(res.get('edits', [])) == 1, 'edits zapisan (1)')
chk(audit_has(admin, 'SCENE_EDIT', snap_mixed), 'revizija SCENE_EDIT zapisana')
# C3: neveljaven elementId → 404
s, _ = callj('PATCH', f'/api/ar-snapshots/{snap_mixed}/scene-element', monter, {'elementId': 'ne-obstaja', 'cls': 'TLA'})
chk(s == 404, f'neobstoječ elementId 404 ({s})')
# C4: brez polj → 400
s, _ = callj('PATCH', f'/api/ar-snapshots/{snap_mixed}/scene-element', monter, {'elementId': 'el-ok'})
chk(s == 400, f'brez cls/status/kind 400 ({s})')
# C5: neveljaven status → 400 (nič veljavnega)
s, _ = callj('PATCH', f'/api/ar-snapshots/{snap_mixed}/scene-element', monter, {'elementId': 'el-ok', 'status': 'MOGOCE'})
chk(s == 400, f'neveljaven status 400 ({s})')
# C6: skladišče ne sme popravljati (fail-closed read-only)
s, _ = callj('PATCH', f'/api/ar-snapshots/{snap_mixed}/scene-element', skladisce, {'elementId': 'el-ok', 'status': 'SKRITO'})
chk(s == 403, f'skladišče PATCH 403 ({s})')
# C7: meja maxEdits (96) → 409
for i in range(96):
    callj('PATCH', f'/api/ar-snapshots/{snap_mixed}/scene-element', monter, {'elementId': 'el-ok', 'status': 'SKRITO'})
s, _ = callj('PATCH', f'/api/ar-snapshots/{snap_mixed}/scene-element', monter, {'elementId': 'el-ok', 'status': 'SKRITO'})
chk(s == 409, f'meja popravkov 409 ({s})')

print('── D) core logika (scene-understanding-core, bun)')
CORE_JS = r'''
import { classifySurface, stabilizeElements, pickLabels, nextStepGuidance, applyEdits, sanitizeSceneResult } from './src/lib/scene-understanding-core'
const out = []
// classifySurface: trava
const trav = classifySurface({ brightness: 120, grayness: 0.2, greenRatio: 0.55, saturation: 0.35, edgeDensity: 0.05, textureVariance: 300, warmth: 0.2 })
out.push('trava=' + trav.kind)
// classifySurface: beton (siv, malo robov)
const bet = classifySurface({ brightness: 160, grayness: 0.85, greenRatio: 0.02, saturation: 0.05, edgeDensity: 0.02, textureVariance: 150, warmth: 0.1 })
out.push('beton=' + bet.kind)
// classifySurface: nejasno → NEZNANA
const nezn = classifySurface({ brightness: 130, grayness: 0.35, greenRatio: 0.2, saturation: 0.5, edgeDensity: 0.3, textureVariance: 400, warmth: 0.3 })
out.push('neznana=' + nezn.kind)
// stabilizeElements: IoU ohrani ID
const prev = [{ id: 'SAME', cls: 'OVIRA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.35, bbox: [0.4, 0.3, 0.2, 0.2], at: 1 }]
const next = [{ id: 'X', cls: 'OVIRA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.35, bbox: [0.41, 0.31, 0.2, 0.2], at: 2 }]
const st = stabilizeElements(prev, next, { iouMin: 0.3, maxMisses: 1 })
out.push('stab=' + (st[0].id === 'SAME' ? 'SAME' : 'NEW'))
// pickLabels: OSEBA pred PODLAGA, max 4
const els = [
  { id: 'p', cls: 'PODLAGA', status: 'PREPOZNANO', source: 'LOKALNO', confidence: 0.6, bbox: [0, 0.67, 1, 0.33], at: 1 },
  { id: 'o', cls: 'OSEBA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4, bbox: [0.5, 0.2, 0.1, 0.3], at: 1 },
  { id: 'g', cls: 'OGRAJA', status: 'NEJASNO', source: 'LOKALNO', confidence: 0.25, bbox: [0.1, 0.3, 0.8, 0.1], at: 1 },
  { id: 's', cls: 'STOPNICA', status: 'NEJASNO', source: 'LOKALNO', confidence: 0.3, bbox: [0.05, 0.4, 0.9, 0.2], at: 1 },
  { id: 'v', cls: 'OVIRA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.35, bbox: [0.7, 0.1, 0.2, 0.2], at: 1 },
]
const pk = pickLabels(els, 4)
out.push('pick=' + pk.map(e => e.cls).join(','))
// nextStepGuidance: oseba
out.push('guide1=' + (nextStepGuidance(els).includes('Oseba') ? 'OSEBA' : 'DRUGO'))
// nextStepGuidance: stopnice brez osebe
out.push('guide2=' + (nextStepGuidance([els[3]]).includes('stopnic') ? 'OK' : 'NE'))
// applyEdits NE mutira izvirnika
const res = { version: 1, at: 1, elements: [JSON.parse(JSON.stringify(els[0]))], edits: [{ elementId: 'p', cls: 'TLA', by: 'test', at: 2 }] }
const disp = applyEdits(res)
out.push('edit=' + disp[0].cls + '/orig=' + res.elements[0].cls)
// sanitize: 30 → 24
const san = sanitizeSceneResult({ version: 1, at: 1, elements: Array.from({ length: 30 }, (_, i) => ({ id: 'e' + i, cls: 'OVIRA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.3, bbox: [0.01 * i, 0.2, 0.05, 0.05], at: 1 })), edits: [] })
out.push('san=' + (san ? san.elements.length : 'null'))
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
    chk(m.get('trava', '').startswith('TRAVA'), f'classifySurface travinat → TRAVA ({m.get("trava")})')
    chk(m.get('beton') == 'BETON', f'classifySurface beton → BETON ({m.get("beton")})')
    chk(m.get('neznana') == 'NEZNANA', f'classifySurface nejasno → NEZNANA ({m.get("neznana")})')
    chk(m.get('stab') == 'SAME', f'stabilizacija IoU ohrani ID ({m.get("stab")})')
    pick = m.get('pick', '')
    chk(pick.split(',')[0] == 'OSEBA' and len(pick.split(',')) == 4, f'pickLabels: OSEBA prvi, max 4 ({pick})')
    chk(m.get('guide1') == 'OSEBA', f'guidance za osebo ({m.get("guide1")})')
    chk(m.get('guide2') == 'OK', f'guidance za stopnice ({m.get("guide2")})')
    chk(m.get('edit') == 'TLA/orig=PODLAGA', f'applyEdits popravi kopijo, izvirnik ostane ({m.get("edit")})')
    chk(m.get('san') == '24', f'sanitize reže na 24 ({m.get("san")})')
else:
    bad(f'core bun izvedba: {err}')

print('── E) regresija')
s, _ = callj('GET', '/api/ar-snapshots', monter)
chk(s == 200, f'seznam AR posnetkov 200 ({s})')
s, _ = callj('GET', '/api/measurements', monter)
chk(s == 200, f'meritve 200 ({s})')
s, _ = callj('GET', '/api/projects', monter)
chk(s == 200, f'projekti 200 ({s})')

print('── F) čiščenje')
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'počiščenje testnih zapisov')

print()
print(f'══ R467 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL else 0)

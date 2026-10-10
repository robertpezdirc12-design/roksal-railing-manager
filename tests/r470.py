#!/usr/bin/env python3
"""tests/r470.py — R470 SMART VISION §5: MERE PREDMETOV IN ČLOVEŠKA FIGURA (issue #8)

Preverja:
  A) RBAC (fail-closed): PATCH scene-element z measure brez žetona 401;
     skladišče/proizvodnja (brez measurements.write) 403.
  B) SANITIZACIJA novih polj na POST /api/ar-snapshots:
     veljavne osi (axes) in mere (measures) se ohranijo v sceneJson;
     neveljavne osi (koordinate 1.5, napačen kind, 6 osi → reže na 4) in
     neveljavne mere (valueCm 0, metod 'UGANJEN', label 100 znakov,
     toleranca > vrednost) se izpustijo; mera brez metode NI veljavna.
  C) ZASEBNOST (§5 „Osebe“): element OSEBA se ob POST NE persistira
     (strip v sanitize) — v posnetku ostanejo samo ne-osebni elementi.
  D) PATCH scene-element measure: prva mera na naziv → ROCNI_VNOS, druga →
     ROCNO_POPRAVLJENO (metodo izpelje applyEdits, ne odjemalec); revizija
     SCENE_EDIT z before.measures; izvirni element ostaja nedotaknjen
     (označen podatek); neveljavna mera → 400; neobstoječ elementId → 404;
     konsolidacija: popravka prevladuje + konflikt (>15 % razpon) se prijavi.
  E) CORE LOGIKA (bun): proposeAxes (STOPNICA 2 osi, ROB/OGRAJA/OSEBA 1,
     PODLAGA z masko 1, NEZNANO 0); axisCmFromReference (razmerje 0,5/0,25 →
     100/50); consolidateMeasures (konflikt, popravka zmaga, metoda
     VEC_POGLEDOV pri več merah); looksLikePerson + personHeightNote
     (odrezana figura); sanitize izpusti neveljavno + ohrani veljavno;
     applyEdits izpelje metodo mere.
  F) Regresija: F2/F3 struktura (ROB z angleDeg, STOPNICA s stepLines) gre
     še vedno skozi sanitize; /api/ar-snapshots, meritve, projekti 200.
  G) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R470-TEST'
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
    # samo veljavne postgres URL-je — sqlite ostanki iz okolja (npr. razvojne
    # sandbox lupine) ne smejo prelomiti Prisma klienta (shema je postgresql)
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
  await p.user.deleteMany({where:{email:{contains:'r470'}}});
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
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', body={'elementId': 'el-1', 'measure': {'label': 'višina', 'valueCm': 100}})
chk(s == 401, f'PATCH scene-element (measure) brez žetona 401 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', skladisce, {'elementId': 'el-1', 'measure': {'label': 'višina', 'valueCm': 100}})
chk(s == 403, f'skladišče PATCH measure 403 ({s})')
s, _ = callj('PATCH', '/api/ar-snapshots/xxx/scene-element', proizvodnja, {'elementId': 'el-1', 'measure': {'label': 'višina', 'valueCm': 100}})
chk(s == 403, f'proizvodnja PATCH measure 403 ({s})')

print('── B) sanitizacija osi in mer (POST ar-snapshots)')
# B1: veljavne osi + mere na STOPNICI
axes_ok = [
    {'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3, 'kind': 'SIRINA', 'label': 'širina stopnice'},
    {'x1': 0.5, 'y1': 0.3, 'x2': 0.5, 'y2': 0.8, 'kind': 'VISINA', 'label': 'višina stopnišča'},
]
measures_ok = [
    {'label': 'širina stopnice', 'valueCm': 117.5, 'method': 'KALIBRIRANA_FOTOGRAFIJA', 'at': 1760000000000},
    {'label': 'višina stopnišča', 'valueCm': 145, 'method': 'ROCNI_VNOS', 'toleranceCm': 2, 'at': 1760000000001},
]
scene_b1 = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-stair', 'STOPNICA', axes=axes_ok, measures=measures_ok, steps=4,
           ascent='desno', stepLines=[{'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3}]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'b1', 'sceneUnderstanding': scene_b1})
chk(s == 201, f'veljaven F5 snapshot (osi+mere) 201 ({s})')
sid = d.get('data', {}).get('id'); snap_ids.append(sid)
s, d = callj('GET', f'/api/ar-snapshots/{sid}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
st = els.get('el-stair', {})
chk(len(st.get('axes', [])) == 2, f'veljavne osi ohranjene ({len(st.get("axes", []))}/2)')
chk(st.get('axes', [{}])[0].get('label') == 'širina stopnice', f'label osi ohranjen ({st.get("axes", [{}])[0].get("label")})')
chk(len(st.get('measures', [])) == 2, f'veljavne mere ohranjene ({len(st.get("measures", []))}/2)')
m0 = st.get('measures', [{}])[0]
chk(m0.get('method') == 'KALIBRIRANA_FOTOGRAFIJA', f'metoda mere ohranjena ({m0.get("method")})')
chk(m0.get('valueCm') == 117.5, f'vrednost mere ohranjena ({m0.get("valueCm")})')

# B2: neveljavne osi + mere se izpustijo, veljavne ostanejo
axes_bad = [
    {'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3, 'kind': 'SIRINA', 'label': 'širina stopnice'},   # OK
    {'x1': 0.1, 'y1': 0.3, 'x2': 1.5, 'y2': 0.3, 'kind': 'SIRINA', 'label': 'nedovoljena koordinata'},  # x2 > 1
    {'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3, 'kind': 'DEBELINA', 'label': 'napačen kind'},    # kind izven seznama
    {'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3, 'kind': 'VISINA'},                               # brez labela
] + [{'x1': 0.05, 'y1': 0.1 * i, 'x2': 0.95, 'y2': 0.1 * i, 'kind': 'DOLZINA', 'label': f'os{i}'} for i in range(6)]
measures_bad = [
    {'label': 'višina stopnišča', 'valueCm': 145, 'method': 'ROCNI_VNOS'},                        # OK
    {'label': 'ničelna', 'valueCm': 0, 'method': 'ROCNI_VNOS'},                                    # valueCm 0
    {'label': 'uganjena metoda', 'valueCm': 100, 'method': 'UGANJEN'},                             # metoda izven seznama
    {'label': 'x' * 100, 'valueCm': 100, 'method': 'ROCNI_VNOS'},                                  # label predolg
    {'label': 'prevelika toleranca', 'valueCm': 100, 'method': 'ROCNI_VNOS', 'toleranceCm': 150},  # tol > vrednost
    {'label': 'brez metode', 'valueCm': 100},                                                      # metoda manjka
]
scene_b2 = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-stair2', 'STOPNICA', axes=axes_bad, measures=measures_bad,
           stepLines=[{'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3},
                      {'x1': 0.1, 'y1': 0.5, 'x2': 0.9, 'y2': 0.5},
                      {'x1': 0.1, 'y1': 0.7, 'x2': 0.9, 'y2': 0.7}]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'b2', 'sceneUnderstanding': scene_b2})
chk(s == 201, f'snapshot z neveljavnimi polji 201 ({s})')
sid_b2 = d.get('data', {}).get('id'); snap_ids.append(sid_b2)
s, d = callj('GET', f'/api/ar-snapshots/{sid_b2}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
st = els.get('el-stair2', {})
chk(len(st.get('axes', [])) == 4, f'osi: neveljavne izločene, veljavne reže na max 4 ({len(st.get("axes", []))}/4)')
chk(all(a.get('kind') in ('SIRINA', 'VISINA', 'DOLZINA', 'GLOBINA') for a in st.get('axes', [])), 'vse ohranjene osi imajo veljaven kind')
ms = st.get('measures', [])
chk(len(ms) == 3, f'mere: neveljavne (0 cm, UGANJEN, brez metode) izpuščene — 3 veljavne ostanejo ({len(ms)}/3)')
m_valid = next((m for m in ms if m.get('label') == 'višina stopnišča'), {})
chk(m_valid.get('valueCm') == 145, f'veljavna mera ohranjena ({m_valid.get("valueCm")})')
m_tol = next((m for m in ms if 'toleranc' in m.get('label', '')), {})
chk(m_tol.get('valueCm') == 100 and m_tol.get('toleranceCm') is None, f'neveljavna toleranca (> vrednost) izpuščena, mera ohranjena ({m_tol.get("valueCm")}/{m_tol.get("toleranceCm")})')
m_long = next((m for m in ms if m.get('label', '').startswith('xxxx')), {})
chk(len(m_long.get('label', '')) == 48, f'predolg label mere se okrajša na 48 znakov ({len(m_long.get("label", ""))})')

print('── C) zasebnost: OSEBA se ne persistira (§5)')
scene_c = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-person', 'OSEBA', bbox=[0.35, 0.15, 0.18, 0.6], confidence=0.3),
        el('el-floor', 'PODLAGA', kind='BETON', bbox=[0.0, 0.66, 1.0, 0.34]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'c', 'sceneUnderstanding': scene_c})
chk(s == 201, f'snapshot z OSEBO 201 ({s})')
sid_c = d.get('data', {}).get('id'); snap_ids.append(sid_c)
s, d = callj('GET', f'/api/ar-snapshots/{sid_c}/scene-element', monter)
res_els = d.get('data', {}).get('result', {}).get('elements', [])
ids = [e['id'] for e in res_els]
chk('el-person' not in ids, f'OSEBA NI persistirana (zasebnost §5) — elementi: {ids}')
chk('el-floor' in ids, f'ne-osebni elementi ostanejo ({ids})')
# PATCH na (neobstoječ) osebni element → 404 (ni ga v shrambi)
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid_c}/scene-element', monter, {'elementId': 'el-person', 'measure': {'label': 'višina', 'valueCm': 175}})
chk(s == 404, f'PATCH na ne-persistirani OSEBA element → 404 ({s})')

print('── D) PATCH scene-element measure (ročna izmera)')
# D1: snapshot z ROB elementom (1 os) brez mer
scene_d = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-edge', 'ROB', bbox=[0.05, 0.44, 0.9, 0.1], angleDeg=-4.2,
           axes=[{'x1': 0.05, 'y1': 0.49, 'x2': 0.95, 'y2': 0.49, 'kind': 'DOLZINA', 'label': 'dolžina roba'}]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'd', 'sceneUnderstanding': scene_d})
chk(s == 201, f'snapshot z ROB (osi, brez mer) 201 ({s})')
sid_d = d.get('data', {}).get('id'); snap_ids.append(sid_d)
# D2: prva mera na naziv → ROCNI_VNOS
s, d = callj('PATCH', f'/api/ar-snapshots/{sid_d}/scene-element', monter, {
    'elementId': 'el-edge', 'measure': {'label': 'dolžina roba', 'valueCm': 320.5}})
chk(s == 200, f'PATCH measure (prvi vnos) 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{sid_d}/scene-element', monter)
disp = next((e for e in d.get('data', {}).get('displayed', []) if e['id'] == 'el-edge'), {})
ms = disp.get('measures', [])
chk(len(ms) == 1 and ms[0].get('method') == 'ROCNI_VNOS', f'prva mera → ROCNI_VNOS ({[m.get("method") for m in ms]})')
chk(ms[0].get('valueCm') == 320.5, f'vrednost mere pravilna ({ms[0].get("valueCm")})')
res = next((e for e in d.get('data', {}).get('result', {}).get('elements', []) if e['id'] == 'el-edge'), {})
chk('measures' not in res, f'izvirni element BREZ mere (označen podatek, ne tiha sprememba) ({res.get("measures")})')
chk(audit_has(admin, 'SCENE_EDIT', sid_d), 'revizija SCENE_EDIT zapisana (admin vidi dnevnik)')
# D3: druga mera istega naziva → ROCNO_POPRAVLJENO (izpeljava)
s, d = callj('PATCH', f'/api/ar-snapshots/{sid_d}/scene-element', monter, {
    'elementId': 'el-edge', 'measure': {'label': 'dolžina roba', 'valueCm': 335}})
chk(s == 200, f'PATCH measure (popravek) 200 ({s})')
s, d = callj('GET', f'/api/ar-snapshots/{sid_d}/scene-element', monter)
disp = next((e for e in d.get('data', {}).get('displayed', []) if e['id'] == 'el-edge'), {})
ms = disp.get('measures', [])
chk(len(ms) == 2, f'dve meri na elementu ({len(ms)}/2)')
chk(ms[-1].get('method') == 'ROCNO_POPRAVLJENO', f'drugi vnos istega naziva → ROCNO_POPRAVLJENO ({ms[-1].get("method")})')
# D4: neveljavna mera → 400
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid_d}/scene-element', monter, {'elementId': 'el-edge', 'measure': {'label': 'x', 'valueCm': 0}})
chk(s == 400, f'PATCH measure valueCm 0 → 400 ({s})')
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid_d}/scene-element', monter, {'elementId': 'el-edge', 'measure': {'valueCm': 100}})
chk(s == 400, f'PATCH measure brez labela → 400 ({s})')
# D5: neobstoječ elementId → 404
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid_d}/scene-element', monter, {'elementId': 'el-ne-obstaja', 'measure': {'label': 'višina', 'valueCm': 100}})
chk(s == 404, f'PATCH z neobstoječim elementId 404 ({s})')

# D6: konsolidacija — konflikt se prijavi, popravka prevladuje
scene_d6 = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-edge2', 'ROB', bbox=[0.05, 0.44, 0.9, 0.1], angleDeg=0,
           measures=[{'label': 'dolžina roba', 'valueCm': 300, 'method': 'KALIBRIRANA_FOTOGRAFIJA', 'at': 1760000000000}]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'd6', 'sceneUnderstanding': scene_d6})
sid_d6 = d.get('data', {}).get('id'); snap_ids.append(sid_d6)
s, _ = callj('PATCH', f'/api/ar-snapshots/{sid_d6}/scene-element', monter, {
    'elementId': 'el-edge2', 'measure': {'label': 'dolžina roba', 'valueCm': 380}})
chk(s == 200, f'PATCH popravka na obstoječi meri 200 ({s})')

print('── E) core logika (scene-understanding-core, bun)')
CORE_JS = r'''
import {
  proposeAxes, axisCmFromReference, consolidateMeasures, looksLikePerson,
  personHeightNote, sanitizeSceneResult, applyEdits,
} from './src/lib/scene-understanding-core'
const out = []
const mkEl = (over) => ({ id: 'e1', cls: 'STOPNICA', status: 'VERJETNO', source: 'LOKALNO', confidence: 0.4,
  bbox: [0.1, 0.2, 0.8, 0.6], at: 1, ...over })
// proposeAxes: STOPNICA z 3 nastopnimi črtami → 2 osi (SIRINA + VISINA)
const stair = mkEl({ stepLines: [
  {x1: 0.1, y1: 0.3, x2: 0.9, y2: 0.3},
  {x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5},
  {x1: 0.1, y1: 0.7, x2: 0.9, y2: 0.7},
] })
const sa = proposeAxes(stair)
out.push('stair=' + sa.length + '/' + sa.map(a => a.kind).join(','))
// ROB → 1 os DOLZINA; OGRAJA → 1 os DOLZINA; OSEBA → 1 os VISINA; NEZNANO → 0
out.push('edge=' + proposeAxes(mkEl({ cls: 'ROB', angleDeg: -4 })).length + '/' + proposeAxes(mkEl({ cls: 'ROB' }))[0].kind)
out.push('fence=' + proposeAxes(mkEl({ cls: 'OGRAJA' })).length + '/' + proposeAxes(mkEl({ cls: 'OGRAJA' }))[0].kind)
out.push('person=' + proposeAxes(mkEl({ cls: 'OSEBA' })).length + '/' + proposeAxes(mkEl({ cls: 'OSEBA' }))[0].kind)
out.push('unknown=' + proposeAxes(mkEl({ cls: 'NEZNANO' })).length)
// PODLAGA z masko → 1 os SIRINA čez spodnji rob maske
const floor = mkEl({ cls: 'PODLAGA', bbox: [0, 0.6, 1, 0.4], maskPoints: [
  {x: 0.1, y: 0.7}, {x: 0.9, y: 0.7}, {x: 0.95, y: 1.0}, {x: 0.05, y: 1.0},
] })
const fa = proposeAxes(floor)
out.push('floor=' + fa.length + '/' + fa[0].kind + '/' + fa[0].x1 + '-' + fa[0].x2)
// axisCmFromReference: ref os span 0.5 (vodoravna, aspect 4/3) = 100 cm → ciljna 0.25 → 50
const ref = { x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.5, kind: 'SIRINA', label: 'r' }
const target = { x1: 0.3, y1: 0.6, x2: 0.55, y2: 0.6, kind: 'SIRINA', label: 't' }
out.push('ref=' + axisCmFromReference(ref, 100, target, 4/3))
out.push('refzero=' + (axisCmFromReference({ ...ref, x2: 0.2 }, 100, target, 4/3) === null ? 'NULL' : 'BAD'))
// consolidateMeasures: popravka zmaga + konflikt pri >15 %
const c1 = consolidateMeasures([
  { label: 'višina', valueCm: 100, method: 'KALIBRIRANA_FOTOGRAFIJA', at: 1 },
  { label: 'višina', valueCm: 130, method: 'ROCNI_VNOS', at: 2 },
])
out.push('conf=' + c1[0].conflict + '/' + c1[0].valueCm + '/' + c1[0].method + '/' + c1[0].count)
const c2 = consolidateMeasures([
  { label: 'višina', valueCm: 100, method: 'KALIBRIRANA_FOTOGRAFIJA', at: 1 },
  { label: 'višina', valueCm: 105, method: 'ROCNO_POPRAVLJENO', at: 2 },
])
out.push('corr=' + c2[0].valueCm + '/' + c2[0].method + '/' + c2[0].conflict)
const c3 = consolidateMeasures([
  { label: 'višina', valueCm: 100, method: 'ROCNI_VNOS', at: 1 },
  { label: 'višina', valueCm: 102, method: 'ROCNI_VNOS', at: 2 },
])
out.push('multi=' + c3[0].method + '/' + c3[0].conflict + '/' + c3[0].valueCm)
// looksLikePerson: pokončna figura da, široka stvar ne
out.push('pl1=' + looksLikePerson([0.4, 0.2, 0.15, 0.6]))
out.push('pl2=' + looksLikePerson([0.2, 0.3, 0.6, 0.3]))
// personHeightNote: odrezana figura
const pCut = mkEl({ cls: 'OSEBA', bbox: [0.4, 0.0, 0.15, 0.6] })
const pFull = mkEl({ cls: 'OSEBA', bbox: [0.4, 0.15, 0.15, 0.6] })
out.push('ph1=' + personHeightNote(pCut).slice(0, 20))
out.push('ph2=' + personHeightNote(pFull).slice(0, 12))
// sanitize: OSEBA izpuščen, mere z neveljavno metodo izpuščene
const san = sanitizeSceneResult({ version: 1, at: 1, elements: [
  mkEl({ id: 'p1', cls: 'OSEBA', bbox: [0.4, 0.2, 0.15, 0.6] }),
  mkEl({ id: 's1', measures: [
    { label: 'višina', valueCm: 100, method: 'ROCNI_VNOS', at: 1 },
    { label: 'slaba', valueCm: 100, method: 'UGANJEN', at: 1 },
  ] }),
], edits: [] })
const s1 = san.elements.find(e => e.id === 's1')
out.push('san=' + (san.elements.find(e => e.id === 'p1') === undefined ? 'NO_PERSON' : 'BAD') + '/' + s1.measures.length)
// applyEdits: prvi vnos mere → ROCNI_VNOS; ponovni → ROCNO_POPRAVLJENO
const disp1 = applyEdits({ version: 1, at: 1, elements: [mkEl({ id: 's2', cls: 'ROB' })], edits: [
  { elementId: 's2', measure: { label: 'dolžina', valueCm: 200 }, by: 't', at: 2 },
] })
const disp2 = applyEdits({ version: 1, at: 1, elements: [mkEl({ id: 's2', cls: 'ROB' })], edits: [
  { elementId: 's2', measure: { label: 'dolžina', valueCm: 200 }, by: 't', at: 2 },
  { elementId: 's2', measure: { label: 'dolžina', valueCm: 210 }, by: 't', at: 3 },
] })
out.push('ed=' + disp1[0].measures[0].method + '/' + disp2[0].measures.length + '/' + disp2[0].measures[1].method)
// applyEdits: method DEPTH_AR se NE more vpeljati prek ročnega popravka (rezervirana za senzorje)
const disp3 = applyEdits({ version: 1, at: 1, elements: [mkEl({ id: 's3', cls: 'ROB' })], edits: [
  { elementId: 's3', measure: { label: 'dolžina', valueCm: 200, method: 'DEPTH_AR' }, by: 't', at: 2 },
] })
out.push('ed3=' + disp3[0].measures[0].method)
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
    chk(m.get('stair') == '2/SIRINA,VISINA', f'proposeAxes STOPNICA: 2 osi (širina, višina) ({m.get("stair")})')
    chk(m.get('edge') == '1/DOLZINA', f'proposeAxes ROB: 1 os dolžina ({m.get("edge")})')
    chk(m.get('fence') == '1/DOLZINA', f'proposeAxes OGRAJA: 1 os dolžina ({m.get("fence")})')
    chk(m.get('person') == '1/VISINA', f'proposeAxes OSEBA: 1 os višina ({m.get("person")})')
    chk(m.get('unknown') == '0', f'proposeAxes NEZNANO: brez osi — ne izmišljujemo ({m.get("unknown")})')
    chk(m.get('floor') == '1/SIRINA/0.05-0.95', f'proposeAxes PODLAGA z masko: os čez spodnji rob maske ({m.get("floor")})')
    chk(m.get('ref') == '50', f'axisCmFromReference: 0,5→100 cm, 0,25→50 cm ({m.get("ref")})')
    chk(m.get('refzero') == 'NULL', f'ničelna referenca → null (ne ugibamo) ({m.get("refzero")})')
    chk(m.get('conf') == 'true/115/VEC_POGLEDOV/2', f'konsolidacija: konflikt >15 %, mediana, VEC_POGLEDOV ({m.get("conf")})')
    chk(m.get('corr') == '105/ROCNO_POPRAVLJENO/false', f'konsolidacija: popravka zmaga, brez konflikta ({m.get("corr")})')
    chk(m.get('multi') == 'VEC_POGLEDOV/false/101', f'konsolidacija: dve blizu meri → mediana brez konflikta ({m.get("multi")})')
    chk(m.get('pl1') == 'true', f'looksLikePerson: pokončna figura da ({m.get("pl1")})')
    chk(m.get('pl2') == 'false', f'looksLikePerson: široka stvar ne ({m.get("pl2")})')
    chk(m.get('ph1', '').startswith('Figura je odrezana'), f'personHeightNote: odrezana figura ({m.get("ph1")})')
    chk(m.get('ph2', '').startswith('Figura je c'), f'personHeightNote: celotna figura — samo z referenco ({m.get("ph2")})')
    chk(m.get('san') == 'NO_PERSON/1', f'sanitize: OSEBA izpuščen, neveljavna metoda mere izpuščena ({m.get("san")})')
    chk(m.get('ed') == 'ROCNI_VNOS/2/ROCNO_POPRAVLJENO', f'applyEdits: prvi vnos ROCNI_VNOS, ponovni ROCNO_POPRAVLJENO ({m.get("ed")})')
    chk(m.get('ed3') == 'ROCNI_VNOS', f'applyEdits: DEPTH_AR se NE more vpeljati ročno ({m.get("ed3")})')
else:
    bad(f'core bun izvedba: {err}')

print('── F) regresija (F2/F3 struktura brez novih polj)')
# F1: F2/F3 struktura gre še vedno skozi sanitize
mask_ok = [{'x': 0.1, 'y': 0.7}, {'x': 0.9, 'y': 0.72}, {'x': 0.88, 'y': 1.0}, {'x': 0.12, 'y': 1.0}]
scene_f = {
    'version': 1, 'at': 1760000000000,
    'elements': [
        el('el-floor', 'PODLAGA', maskPoints=mask_ok, slopeDeg=3.5,
           slopeSource='VIZUALNA_GEOMETRIJA', geomStatus='GEOMETRIJA_OCENJENA', kind='BETON'),
        el('el-stair', 'STOPNICA', steps=5, ascent='levo',
           stepLines=[{'x1': 0.1, 'y1': 0.3, 'x2': 0.9, 'y2': 0.3}, {'x1': 0.1, 'y1': 0.5, 'x2': 0.9, 'y2': 0.5},
                      {'x1': 0.1, 'y1': 0.7, 'x2': 0.9, 'y2': 0.7}]),
    ],
    'edits': [],
}
s, d = callj('POST', '/api/ar-snapshots', monter, {'note': TAG + 'f', 'sceneUnderstanding': scene_f})
chk(s == 201, f'F2/F3 struktura (brez R470 polj) 201 ({s})')
sid_f = d.get('data', {}).get('id'); snap_ids.append(sid_f)
s, d = callj('GET', f'/api/ar-snapshots/{sid_f}/scene-element', monter)
els = {e['id']: e for e in d.get('data', {}).get('result', {}).get('elements', [])}
fl = els.get('el-floor', {}); st = els.get('el-stair', {})
chk(fl.get('slopeDeg') == 3.5 and fl.get('slopeSource') == 'VIZUALNA_GEOMETRIJA', f'F2 naklon z virom še deluje ({fl.get("slopeDeg")}/{fl.get("slopeSource")})')
chk(st.get('steps') == 5 and st.get('ascent') == 'levo', f'F3 stopnice še delujejo ({st.get("steps")}/{st.get("ascent")})')
# F2: osnovni endpointi
s, _ = callj('GET', '/api/ar-snapshots', monter)
chk(s == 200, f'seznam AR posnetkov 200 ({s})')
s, _ = callj('GET', '/api/measurements', monter)
chk(s == 200, f'meritve 200 ({s})')
s, _ = callj('GET', '/api/projects', monter)
chk(s == 200, f'projekti 200 ({s})')

print('── G) čiščenje')
CLEAN_ALL = CLEAN_JS.replace('__TAG__', TAG)  # vse R470-TEST* (tudi 'b','c','d','f')
out, _ = bun_ts(CLEAN_ALL)
chk('CLEAN_DONE' in out, 'počiščenje testnih zapisov')

print()
print(f'══ R470 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL else 0)

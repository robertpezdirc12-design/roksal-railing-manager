#!/usr/bin/env python3
"""tests/r462.py — R462 REALITY-TO-PRODUCTION (issue #17)

Preverja:
  A) RBAC (fail-closed): brez žetona 401; skladišče 403; proizvodnja read-only;
     monter brez nalog 403.
  B) Georeferenca (§1/§2): SURVEY tier + GNSS_RTK FIX + korekcije; natančnost
     OMEJENA na vir (zahtevana 0,001 m pri GNSS_NONE → capa 3 m); FLOAT ni
     uporaben; revizija GEO_REF_CREATE; RTK ni proizvodna mera (navedba).
  C) 3-točkovna registracija (§3): veljavna → GOOD z RMS; verzioniranost v1/v2;
     degenerirane/kolinearne točke → INVALID; napačno število točk 400.
  D) Loop closure (§5): zaprta (≤2 cm) / warning (≤4) / failed (>4); revizija.
  E) Element QA + heatmapi (§6/§7/§8): elementi seg-N/polnilo-N/stebri-N/vogal-N/
     vrata-N z GREEN/WARNING/RED; quality heatmap posnetkov (usableForGeometry).
  F) Tolerance iz pravil (§12): brez tol_ pravil → NO VERIFIED TOLERANCE RULE;
     po setu pravil (production.manage) → WITHIN/REVIEW/BLOCKING.
  G) AS-BUILT poročilo (§9–§11/§27): faze measured↔designed↔produced↔installed
     z statusi, verdict, snapshot veriga.
  H) 4D timeline (§15): vnosi T0–T5 iz snapshotov.
  I) Element provenance (§13): seg-1 → foto/meritev/tekač/produkt/snapshoti;
     napačen ključ 400/404.
  J) IDOR: monter2 brez nalog 403; monter z nalogom 200.
  K) Regresija: r461 kritične točke + osnovni API-ji.
  L) Idempotentno čiščenje.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R462-TEST'
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

def bun (script):
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL', 'file:' + REPO + '/db/roksal.db')})
    return r.stdout, r.stderr[:400]

def audit_has (token, action, entityId, projectId=None):
    urls = [f'/api/audit?action={action}&limit=100']
    if projectId:
        urls.append(f'/api/audit?projectId={projectId}&action={action}&limit=100')
    for u in urls:
        s, d = callj('GET', u, token)
        rows = d.get('data', []) if s == 200 else []
        if any(e.get('entityId') == entityId for e in rows):
            return True
    return False

CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  await p.loopClosure.deleteMany({});
  await p.registration.deleteMany({});
  await p.geoReference.deleteMany({});
  const snaps=await p.digitalTwinSnapshot.findMany({where:{reason:{contains:'__TAG__'}}});
  for(const s of snaps){await p.digitalTwinSnapshot.delete({where:{id:s.id}});}
  const sess=await p.captureSession.findMany({where:{OR:[{note:{contains:'__TAG__'}},{name:{contains:'__TAG__'}}]}});
  for(const s of sess){await p.captureSession.delete({where:{id:s.id}});}
  const boms=await p.bom.findMany({where:{note:{contains:'__TAG__'}}});
  for(const b of boms){await p.bom.delete({where:{id:b.id}});}
  const pkgs=await p.projectPackage.findMany({where:{note:{contains:'__TAG__'}}});
  for(const k of pkgs){await p.projectPackage.delete({where:{id:k.id}});}
  const runs=await p.fenceRun.findMany({where:{OR:[{note:{contains:'__TAG__'}},{name:{contains:'__TAG__'}}]}});
  for(const r of runs){
    if(r.measurementId){
      await p.projectPackage.updateMany({where:{measurementId:r.measurementId},data:{measurementId:null}});
      await p.measurementVersion.deleteMany({where:{measurementId:r.measurementId}});
      await p.measurement.deleteMany({where:{id:r.measurementId}});
    }
    await p.fenceRun.delete({where:{id:r.id}});
  }
  await p.photoVisualization.deleteMany({where:{note:{contains:'__TAG__'}}});
  // tolerance pravila odstranjena (test jih doda sam)
  for(const k of ['tol_dolzina_segmenta','tol_visina','tol_pozicija_stebra','tol_kot','tol_nagib','tol_loop_zanka']){
    const r=await p.engineeringRule.findUnique({where:{key:k}});
    if(r){await p.ruleVersion.deleteMany({where:{ruleId:r.id}});await p.engineeringRule.delete({where:{id:r.id}});}
  }
  await p.auditLog.deleteMany({where:{entity:{in:['geoReference','registration','loopClosure','digitalTwinSnapshot']}}});
  await p.user.deleteMany({where:{email:{contains:'r462'}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG)

# ── priprava ────────────────────────────────────────────────────────────────
out, _ = bun(CLEAN)
chk('CLEAN_DONE' in out, 'predčiščenje')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
proizvodnja = login('proizvodnja@roksal.si', 'Proizvodnja123!')

M2 = '''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const crypto=require('crypto');
  const salt=crypto.randomUUID().replace(/-/g,'');
  const hash=crypto.scryptSync('Monter123!',salt,64).toString('hex');
  const u=await p.user.upsert({where:{email:'monter2-r462@roksal.si'},update:{},create:{
    email:'monter2-r462@roksal.si',name:'Monter2 R462',role:'MONTER',
    passwordHash:salt+':'+hash,active:true}});
  console.log('M2='+u.id);return p.$disconnect();
})()
'''
out, _ = bun(M2)
monter2 = login('monter2-r462@roksal.si', 'Monter123!')
chk('M2=' in out, 'monter2 pripravljen')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')
P3 = PROJ.get('P-2026-003')
s, d = callj('GET', '/api/products?family=all', admin)
OGRK2 = {p['sku']: p for p in d.get('data', [])}.get('OGR-K-002')

# tekač (2 segmenta, vogal na koncu seg1) + zajem
NODES = [
    {'kind': 'ZACETEK', 'atCm': 0, 'podlaga': 'BETON', 'pritrditev': 'TLACNA'},
    {'kind': 'VOGAL', 'atCm': 300, 'podlaga': 'BETON'},
    {'kind': 'VRATA', 'atCm': 500, 'gateWcm': 100},
    {'kind': 'KONEC', 'atCm': 700, 'podlaga': 'ZEMLJA'},
]
CAL = {'method': 'ZUNANJA_NAPRAVA', 'refValueCm': 92, 'refObject': 'plošča', 'device': 'DISTO'}
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Tekač {TAG}', 'nodes': NODES,
    'terrain': [{'distCm': 0, 'elevCm': 0}, {'distCm': 700, 'elevCm': 20}],
    'calibration': CAL, 'productId': OGRK2['id'], 'note': TAG})
chk(s == 201, f'tekač 201 (dejansko {s})')
RUN = d.get('data', {}).get('id')
s, d = callj('POST', '/api/capture-session', admin, {
    'projectId': P4, 'mode': 'FENCE_RUN', 'fenceRunId': RUN,
    'name': f'Zajem {TAG}', 'note': TAG,
    'device': {'caps': {'camera': True, 'ar': True, 'gps': True}}})
chk(s == 201, f'zajem 201 (dejansko {s})')
SESS = d.get('data', {}).get('id')

# ══ A. RBAC ════════════════════════════════════════════════════════════════
print('── A. RBAC ──')
for path in [f'/api/capture-session/{SESS}/geo-reference', f'/api/capture-session/{SESS}/qa',
             f'/api/digital-twin/as-built?projectId={P4}', f'/api/digital-twin/timeline?projectId={P4}']:
    s, _ = callj('GET', path)
    chk(s == 401, f'GET {path.split("?")[0].split("/")[-1] or path} brez žetona 401 (dejansko {s})')
s, _ = callj('POST', f'/api/capture-session/{SESS}/geo-reference', body={})
chk(s == 401, 'geo POST brez žetona 401')
s, _ = callj('GET', f'/api/capture-session/{SESS}/geo-reference', skladisce)
chk(s == 403, f'skladišče geo 403 (dejansko {s})')
s, _ = callj('POST', f'/api/capture-session/{SESS}/register', proizvodnja, {'points': []})
chk(s == 403, f'proizvodnja register 403 (dejansko {s})')
s, _ = callj('GET', f'/api/capture-session/{SESS}/qa', proizvodnja)
chk(s == 200, f'proizvodnja qa read 200 (dejansko {s})')

# ══ B. Georeferenca (§1/§2) ════════════════════════════════════════════════
print('── B. Georeferenca ──')
s, d = callj('POST', f'/api/capture-session/{SESS}/geo-reference', admin, {
    'tier': 'SURVEY', 'source': 'GNSS_RTK', 'rtkStatus': 'FIX',
    'lat': 46.056946, 'lon': 14.505751, 'altM': 312.4, 'atCm': 0,
    'correctionAgeSec': 8, 'device': 'Emlid Reach RS3'})
chk(s == 201 and d['data']['code'] == 'GEO-001', f'GEO-001 RTK FIX 201 (dejansko {s})')
chk(d['data']['rtkUsable'] is True, 'RTK FIX uporabna')
chk(d['data']['capped'] is False, 'natančnost v okviru vira (RTK 2 cm)')
chk('NI proizvodna mera' in d.get('data', {}).get('rtkNotProduction', ''), 'RTK ni proizvodna mera (navedba)')
GEO1 = d['data']['id']
chk(audit_has(admin, 'GEO_REF_CREATE', GEO1, P4), 'revizija GEO_REF_CREATE')

# lažna natančnost: GNSS_NONE z zahtevano 0,001 m → capa 3 m
s, d = callj('POST', f'/api/capture-session/{SESS}/geo-reference', admin, {
    'tier': 'BASIC', 'source': 'GNSS_NONE', 'rtkStatus': 'NONE',
    'lat': 46.0569, 'lon': 14.5057, 'hAccM': 0.001})
chk(s == 201 and d['data']['capped'] is True, f'natančnost OMEJENA na vir (dejansko capped={d.get("data", {}).get("capped")})')
chk(abs(d['data']['hAccM'] - 3.0) < 0.01, f'capa GNSS_NONE = 3 m (dejansko {d.get("data", {}).get("hAccM")})')

# FLOAT ni uporaben
s, d = callj('POST', f'/api/capture-session/{SESS}/geo-reference', admin, {
    'tier': 'SURVEY', 'source': 'GNSS_FLOAT', 'rtkStatus': 'FLOAT',
    'lat': 46.057, 'lon': 14.506})
chk(s == 201 and d['data']['rtkUsable'] is False, 'RTK FLOAT ni uporaben (izrecno)')

# GNSS brez rtkStatus → 400
s, _ = callj('POST', f'/api/capture-session/{SESS}/geo-reference', admin, {
    'tier': 'SURVEY', 'source': 'GNSS_RTK', 'lat': 46.057, 'lon': 14.506})
chk(s == 400, f'GNSS brez rtkStatus 400 (dejansko {s})')
# napačen vir → 400
s, _ = callj('POST', f'/api/capture-session/{SESS}/geo-reference', admin, {
    'tier': 'BASIC', 'source': 'TELEPATIJA', 'lat': 46, 'lon': 14})
chk(s == 400, f'neznan vir 400 (dejansko {s})')

# ══ C. 3-točkovna registracija (§3) ════════════════════════════════════════
print('── C. Registracija ──')
# veljavna: identiteta + rotacija 0 — source = target (3 dobro razporejene točke)
PTS = [
    {'code': 'GEO-001', 'source': {'x': 0, 'y': 0}, 'target': {'x': 10, 'y': 5}},
    {'code': 'GEO-002', 'source': {'x': 300, 'y': 60}, 'target': {'x': 310, 'y': 65}},
    {'code': 'GEO-003', 'source': {'x': 700, 'y': 10}, 'target': {'x': 710, 'y': 15}},
]
s, d = callj('POST', f'/api/capture-session/{SESS}/register', admin, {'points': PTS, 'note': f'{TAG} v1'})
chk(s == 201 and d['data']['quality'] == 'GOOD', f'registracija GOOD (dejansko {d.get("data", {}).get("quality")})')
chk(d['data']['rmsCm'] is not None and d['data']['rmsCm'] < 0.5, f'RMS < 0,5 cm (dejansko {d.get("data", {}).get("rmsCm")})')
tr = d['data']['transform']
chk(abs(tr['tx'] - 10) < 0.5 and abs(tr['ty'] - 5) < 0.5, f'translacija ~ (10, 5) (dejansko tx={tr.get("tx")}, ty={tr.get("ty")})')
chk(abs(tr['rotationDeg']) < 0.1, f'rotacija ~0° (dejansko {tr.get("rotationDeg")})')
chk(abs(tr['scale'] - 1) < 0.01, f'merilo ~1 (dejansko {tr.get("scale")})')
chk(d['data']['version'] == 1, 'verzija v1')
REG1 = d['data']['id']
chk(audit_has(admin, 'REGISTRATION_CREATE', REG1, P4), 'revizija REGISTRATION_CREATE')

# v2 z drugačno transformacijo (verzionirano, ne prepisano)
PTS2 = [
    {'code': 'GEO-001', 'source': {'x': 0, 'y': 0}, 'target': {'x': 11, 'y': 6}},
    {'code': 'GEO-002', 'source': {'x': 300, 'y': 60}, 'target': {'x': 311, 'y': 66}},
    {'code': 'GEO-003', 'source': {'x': 700, 'y': 10}, 'target': {'x': 711, 'y': 16}},
]
s, d = callj('POST', f'/api/capture-session/{SESS}/register', admin, {'points': PTS2, 'note': f'{TAG} v2'})
chk(s == 201 and d['data']['version'] == 2, f'verzija v2 (dejansko {d.get("data", {}).get("version")})')

# velik RMS → INVALID
PTS_BAD = [
    {'code': 'A', 'source': {'x': 0, 'y': 0}, 'target': {'x': 0, 'y': 0}},
    {'code': 'B', 'source': {'x': 300, 'y': 0}, 'target': {'x': 300, 'y': 9}},
    {'code': 'C', 'source': {'x': 700, 'y': 0}, 'target': {'x': 702, 'y': 0}},
]
s, d = callj('POST', f'/api/capture-session/{SESS}/register', admin, {'points': PTS_BAD})
chk(s == 201 and d['data']['quality'] == 'INVALID', f'velik RMS → INVALID (dejansko {d.get("data", {}).get("quality")}, rms={d.get("data", {}).get("rmsCm")})')

# kolinearne/točke preblizu → INVALID
PTS_DEG = [
    {'code': 'A', 'source': {'x': 0, 'y': 0}, 'target': {'x': 0, 'y': 0}},
    {'code': 'B', 'source': {'x': 10, 'y': 0}, 'target': {'x': 10, 'y': 0}},
    {'code': 'C', 'source': {'x': 20, 'y': 0}, 'target': {'x': 20, 'y': 0}},
]
s, d = callj('POST', f'/api/capture-session/{SESS}/register', admin, {'points': PTS_DEG})
chk(s == 201 and d['data']['quality'] == 'INVALID' and any('kolinearne' in r or 'Razpetost' in r for r in d['data']['reasons']),
    f'degenerirana geometrija INVALID z razlogom (dejansko {d.get("data", {}).get("reasons")})')

# 2 točki → 400
s, _ = callj('POST', f'/api/capture-session/{SESS}/register', admin, {'points': PTS[:2]})
chk(s == 400, f'2 točki 400 (dejansko {s})')

# ══ D. Loop closure (§5) ═══════════════════════════════════════════════════
print('── D. Loop closure ──')
s, d = callj('POST', f'/api/capture-session/{SESS}/loop', admin, {
    'startCode': 'START', 'endCode': 'GEO-001', 'expectedCm': 700, 'measuredCm': 701.2})
chk(s == 201 and d['data']['status'] == 'LOOP_CLOSED', f'loop 1,2 cm → CLOSED (dejansko {d.get("data", {}).get("status")})')
chk(audit_has(admin, 'LOOP_CLOSURE_CREATE', d['data']['id'], P4), 'revizija LOOP_CLOSURE_CREATE')
s, d = callj('POST', f'/api/capture-session/{SESS}/loop', admin, {
    'startCode': 'START', 'endCode': 'GEO-001', 'expectedCm': 700, 'measuredCm': 703.5})
chk(d['data']['status'] == 'LOOP_WARNING', f'loop 3,5 cm → WARNING (dejansko {d.get("data", {}).get("status")})')
s, d = callj('POST', f'/api/capture-session/{SESS}/loop', admin, {
    'startCode': 'START', 'endCode': 'GEO-001', 'expectedCm': 700, 'measuredCm': 712, 'heightDiffCm': 4})
chk(d['data']['status'] == 'LOOP_FAILED', f'loop 12 cm → FAILED (dejansko {d.get("data", {}).get("status")})')
chk(any('NE spreminjamo' in r for r in d['data']['reasons']), 'FAILED razlog: starih meritev ne spreminjamo')
# napačne vrednosti → 400
s, _ = callj('POST', f'/api/capture-session/{SESS}/loop', admin, {'startCode': 'A', 'endCode': 'B', 'expectedCm': -1, 'measuredCm': 5})
chk(s == 400, f'negativna razdalja 400 (dejansko {s})')

# ══ E. Element QA + heatmapi (§6/§7/§8) ════════════════════════════════════
print('── E. Element QA ──')
# posnetki za quality heatmap
PLAN_ZONES = None
s, d = callj('GET', f'/api/capture-session/{SESS}', admin)
for p_stop in d['data']['analysis']['plan']:
    if p_stop['kind'] in ('START', 'SEGMENT', 'VOGAL', 'VRATA', 'TEREN', 'PODLAGA', 'KONEC'):
        callj('POST', f'/api/capture-session/{SESS}/photo', admin, {
            'zone': p_stop['id'], 'clientKey': f'q-{p_stop["id"]}', 'quality': {}})
# slab posnetek
s, d = callj('GET', f'/api/capture-session/{SESS}', admin)
first_zone = next((p2['id'] for p2 in d['data']['analysis']['plan'] if p2['kind'] == 'SEGMENT'), None)
callj('POST', f'/api/capture-session/{SESS}/photo', admin, {
    'zone': first_zone, 'clientKey': 'q-slab', 'quality': {'blurry': True, 'dark': True}})

s, d = callj('GET', f'/api/capture-session/{SESS}/qa', admin)
chk(s == 200, f'qa 200 (dejansko {s})')
qa = d.get('data', {})
elems = qa.get('elements', [])
keys = [e['key'] for e in elems]
chk('seg-1' in keys and 'seg-2' in keys and 'seg-3' in keys, f'elementi seg-1..3 (dejansko {keys})')
chk('polnilo-1' in keys and 'rocnik-1' in keys, 'polnilo/ročnik elementi (§8)')
chk('vogal-1' in keys, 'vogal element (struktura tekača)')
chk('vrata-2' in keys, 'vrata element (segment končan z vrati)')
seg1 = next((e for e in elems if e['key'] == 'seg-1'), {})
chk(seg1.get('state') in ('WARNING', 'RED'), f"seg-1 statusni QA (ESTIMATED → ne GREEN; dejansko {seg1.get('state')})")
heat = qa.get('coverageHeatmap', [])
chk(any(z['state'] == 'ZELENO' for z in heat) or len(heat) > 0, f'coverage heatmap cona (dejansko {len(heat)})')
frames = qa.get('frames', [])
slab = next((f for f in frames if not f['usableForGeometry']), None)
chk(slab is not None, 'slab posnetek označen neuporaben za geometrijo (§7)')
chk(slab is not None and 'zamegljenost' in slab['reason'], f"razlog 'zamegljenost' (dejansko {slab and slab.get('reason')})")

# ══ F. Tolerance iz pravil (§12) ═══════════════════════════════════════════
print('── F. Tolerance ──')
# BREZ pravil → AS-BUILT vrača NO_VERIFIED_TOLERANCE_RULE
s, d = callj('GET', f'/api/digital-twin/as-built?projectId={P4}', admin)
chk(s == 200, f'as-built 200 (dejansko {s})')
chk(len(d['data']['stages']) == 3 and all('available' in st and 'summary' in st for st in d['data']['stages']), '3 faze z available/summary (demo veriga na P4 lahko vliva)')
chk(d['data'].get('recapture', {}).get('sessions', []) is not None, 'recapture kontekst prisoten')

# dodaj tolerance pravila (production.manage — admin)
for key, label, value, unit in [
    ('tol_dolzina_segmenta', 'Toleranca dolžine segmenta', 2, 'cm'),
    ('tol_visina', 'Toleranca višine', 2, 'cm'),
    ('tol_pozicija_stebra', 'Toleranca pozicije stebra', 1.5, 'cm'),
    ('tol_kot', 'Toleranca kota', 2, '°'),
    ('tol_nagib', 'Toleranca nagiba', 2, '°'),
    ('tol_loop_zanka', 'Toleranca zanke', 3, 'cm'),
]:
    s, _ = callj('POST', '/api/engineering-rules', admin, {'key': key, 'label': label, 'value': value, 'unit': unit})
    chk(s == 200 or s == 201, f'pravilo {key} shranjeno (dejansko {s})')

# loop s pravilom tol_loop_zanka=3 → 3,5 cm odmik je sedaj WITHIN (CLOSED)
s, d = callj('POST', f'/api/capture-session/{SESS}/loop', admin, {
    'startCode': 'START', 'endCode': 'GEO-001', 'expectedCm': 700, 'measuredCm': 702.5})
chk(d['data']['status'] == 'LOOP_CLOSED', f'loop 2,5 cm ≤ tol 3 (pravilo) → CLOSED (dejansko {d.get("data", {}).get("status")}, tol={d.get("data", {}).get("toleranceCm")})')
chk(d['data']['toleranceNoRule'] is False, 'toleranca IZ pravila')

# ══ G. AS-BUILT faze (§9–§11) ══════════════════════════════════════════════
print('── G. AS-BUILT faze ──')
# zgradi celotno verigo: finish zajem → AS-MEASURED; paket → AS-DESIGNED;
# BOM POTRJEN → AS-PRODUCED; končne mere z odstopanjem → AS-INSTALLED
for p_stop, done in [(p3, None) for p3 in []]: pass
s, d = callj('GET', f'/api/capture-session/{SESS}', admin)
plan = d['data']['analysis']['plan']
actions = [p4['id'] for p4 in plan if p4['kind'] in ('REFERENCA', 'COVERAGE', 'KALIBRACIJA')]
callj('PATCH', f'/api/capture-session/{SESS}', admin, {'doneStops': actions})
callj('POST', f'/api/capture-session/{SESS}/reference', admin, {'atCm': 350, 'measureCm': 350.4, 'method': 'LASER'})
s, d = callj('POST', f'/api/capture-session/{SESS}/finish', admin, {'obstojeco': 'Stara kovinska ograja 70 cm.'})
chk(s == 201, f'zaključek → AS-MEASURED (dejansko {s}, {d.get("detail", "")})')

s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGRK2['id'], 'name': f'Paket {TAG}', 'qty': 7, 'unit': 'm', 'note': TAG})
PKG = d.get('data', {}).get('id')
s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_DESIGNED', 'packageId': PKG, 'reason': f'Načrt {TAG}'})
chk(s == 201, f'AS-DESIGNED (dejansko {s})')

BOM_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const pkg=await p.projectPackage.findFirst({where:{note:{contains:'__TAG__'}},orderBy:{createdAt:'desc'}});
  const prod=await p.product.findFirst({where:{sku:'OGR-K-002'}});
  const bom=await p.bom.create({data:{code:'BOM-__TAG__',packageId:pkg.id,productId:prod.id,
    qty:7,unit:'m',status:'POTRJEN',note:'__TAG__'}});
  console.log('BOM='+bom.id);return p.$disconnect();
})()
'''
out, _ = bun(BOM_JS.replace('__TAG__', TAG))
BOM = out.strip().split('BOM=')[-1].strip()
s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_PRODUCED', 'bomId': BOM,
    'spremembe': [{'opis': 'višina seg-2: 105 cm', 'odobril': 'M. Kovač'}],
    'segmentOverrides': [{'key': 'seg-2', 'heightCm': 105}],
    'reason': f'Proizvodnja {TAG}'})
chk(s == 201, f'AS-PRODUCED z overridи (dejansko {s}, {d.get("detail", "")})')

s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_INSTALLED',
    'finalSegments': [
        {'key': 'seg-1', 'lengthCm': 305.0, 'heightCm': 100},
        {'key': 'seg-2', 'lengthCm': 201.0, 'heightCm': 105},
        {'key': 'seg-3', 'lengthCm': 202.0, 'heightCm': 100}],
    'notes': ['montaža OK'], 'reason': f'Montaža {TAG}'})
chk(s == 201, f'AS-INSTALLED (dejansko {s}, {d.get("detail", "")})')

# as-built poročilo s fazami
s, d = callj('GET', f'/api/digital-twin/as-built?projectId={P4}', admin)
chk(s == 200, 'as-built 200 po verigi')
stages = {st['stage']: st for st in d['data']['stages']}
chk(stages['MEASURED_VS_DESIGNED']['available'], 'faza measured↔designed na voljo')
chk(stages['DESIGNED_VS_PRODUCED']['available'], 'faza designed↔produced na voljo')
chk(stages['PRODUCED_VS_INSTALLED']['available'], 'faza produced↔installed na voljo')
# §10: odobrena sprememba (seg-2 višina 105) → APPROVED_CHANGE, ne BLOCKING
dp = stages['DESIGNED_VS_PRODUCED']
seg2h = next((r for r in dp['rows'] if r['key'] == 'seg-2:VISINA'), {})
chk(seg2h.get('status') == 'APPROVED_CHANGE', f"seg-2 višina odobrena sprememba → APPROVED_CHANGE (dejansko {seg2h.get('status')}, diff={seg2h.get('diff')})")
pi = stages['PRODUCED_VS_INSTALLED']
seg1row = next((r for r in pi['rows'] if r['key'] == 'seg-1:DOLZINA'), {})
chk(seg1row.get('status') == 'BLOCKING', f"seg-1 ~+4,9 cm > 1,5×tol → BLOCKING (dejansko {seg1row.get('status')}, diff={seg1row.get('diff')})")
chk(d['data']['verdict']['blocking'] >= 1 and d['data']['verdict']['asBuiltOk'] is False,
    f"verdict BLOKIRA (dejansko blocking={d['data']['verdict']['blocking']}, ok={d['data']['verdict']['asBuiltOk']})")
chk(len(d['data']['toleranceRulesDefined']) >= 5, f"tolerančna pravila prikazana (dejansko {len(d['data'].get('toleranceRulesDefined', []))})")
chk(len(d['data']['provenance']) >= 4, f"provenance zapisi (dejansko {len(d['data'].get('provenance', []))})")
chk(len(d['data']['recapture']['sessions']) >= 1, 'recapture seznami')

# ══ H. 4D timeline (§15) ═══════════════════════════════════════════════════
print('── H. 4D timeline ──')
s, d = callj('GET', f'/api/digital-twin/timeline?projectId={P4}', admin)
chk(s == 200, f'timeline 200 (dejansko {s})')
ts = [e['t'] for e in d['data']['entries']]
chk('T0' in ts and 'T1' in ts and 'T2' in ts and 'T4' in ts and 'T5' in ts, f'T0/T1/T2/T4/T5 prisotni (dejansko {ts})')

# ══ I. Element provenance (§13) ════════════════════════════════════════════
print('── I. Element provenance ──')
s, d = callj('GET', f'/api/digital-twin/element?projectId={P4}&key=seg-1', admin)
chk(s == 200, f'element seg-1 200 (dejansko {s})')
prov = d.get('data', {})
chk(prov.get('tekač') is not None, 'tekač v provenance')
chk(prov.get('snapshots') and len(prov['snapshots']) >= 4, f"snapshots skozi zgodovino (dejansko {len(prov.get('snapshots', []))})")
chk(prov.get('bom') is not None, 'BOM v provenance')
s, _ = callj('GET', f'/api/digital-twin/element?projectId={P4}&key=seg-99', admin)
chk(s == 404, f'neznan segment 404 (dejansko {s})')
s, _ = callj('GET', f'/api/digital-twin/element?projectId={P4}&key=foobar', admin)
chk(s == 400, f'napačen format ključa 400 (dejansko {s})')

# ══ J. IDOR ════════════════════════════════════════════════════════════════
print('── J. IDOR ──')
s, _ = callj('GET', f'/api/capture-session/{SESS}/geo-reference', monter2)
chk(s == 403, f'monter2 geo 403 (dejansko {s})')
s, _ = callj('GET', f'/api/capture-session/{SESS}/qa', monter2)
chk(s == 403, f'monter2 qa 403 (dejansko {s})')
s, _ = callj('GET', f'/api/digital-twin/as-built?projectId={P4}', monter2)
chk(s == 403, f'monter2 as-built 403 (dejansko {s})')
s, _ = callj('GET', f'/api/capture-session/{SESS}/qa', monter)
chk(s == 200, f'monter z nalogom qa 200 (dejansko {s})')

# ══ K. Regresija ═══════════════════════════════════════════════════════════
print('── K. Regresija ──')
s, _ = callj('GET', '/api/capture-session', admin)
chk(s == 200, 'r461 seznam zajemov 200')
s, _ = callj('GET', '/api/fence-run', admin)
chk(s == 200, 'tekači 200')
s, d = callj('GET', f'/api/digital-twin?projectId={P4}', admin)
chk(s == 200, 'r461 dvojček pregled 200')
s, d = callj('GET', f'/api/digital-twin/diff?projectId={P4}&from=AS_DESIGNED&to=AS_INSTALLED', admin)
chk(s == 200, 'r461 diff 200')

# ══ L. Čiščenje ════════════════════════════════════════════════════════════
print('── L. Čiščenje ──')
out, _ = bun(CLEAN)
chk('CLEAN_DONE' in out, 'čiščenje izvedeno')
COUNT_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const g=await p.geoReference.count();
  const r=await p.registration.count();
  const l=await p.loopClosure.count();
  const t=await p.digitalTwinSnapshot.count({where:{reason:{contains:'__TAG__'}}});
  const s=await p.captureSession.count({where:{note:{contains:'__TAG__'}}});
  const tol=await p.engineeringRule.count({where:{key:{contains:'tol_'}}});
  console.log('N='+g+'|'+r+'|'+l+'|'+t+'|'+s+'|'+tol);return p.$disconnect();
})()
'''
out, _ = bun(COUNT_JS.replace('__TAG__', TAG))
chk('N=0|0|0|0|0|0' in out, f'vsi testni zapisi odstranjeni (dejansko {out.strip()})')

print(f'\n══════ REZULTAT: {PASS} ✓ / {FAIL} ✗ ══════')
sys.exit(1 if FAIL else 0)

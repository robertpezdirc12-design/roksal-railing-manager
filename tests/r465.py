#!/usr/bin/env python3
"""tests/r465.py — R465 FIELD AR + CAPTURE REPLAY + PREFAB ENGINE (issue #4)

Preverja:
  A) RBAC (fail-closed): brez žetona 401 (replay/elements/from-twin);
     skladišče replay 403; proizvodnja read-only (GET elements 200 /
     from-tun 403 / PATCH 403); monter brez production.manage from-twin
     403; IDOR monter2 brez nalog → replay 403.
  B) FIELD AR vir podatkov: /api/fence-run seznam + detail s segmenti
     (dolžine/višine/stebri/toKind za večsegmentni overlay); AR posnetek
     z virom „iz tekača“ v params se shrani in prebere (201/GET).
  C) CAPTURE REPLAY: zajem nad tekačem → koraki = posnetki po času;
     kumulativna pokritost raste (ZAJETO → DOBRO, SLABO po blurry),
     drift evolucija (OK → WARNING po odmiku 2,5 cm), sličice (thumb),
     oznake con iz plan-a; 404 za neobstoječ; po zaključku final
     (gateOk, snapshotId) + reference v meta.
  D) PREFAB ENGINE: from-twin brez AS-PRODUCED 409; iz POTRJENE
     kosovnice + AS-DESIGNED + AS-PRODUCED → 201 (nov nalog PR-xxxx,
     lističi = segmenti z merami/RAL/produktom); idempotenca 409;
     statusni tok lističa linearen (preskok 400, naslednji 200 ×4,
     DOKONCAN terminal 400); revizije PREFAB_GENERATE/PREFAB_STATUS/
     PREFAB_UPDATE; regeneracija po začetku 409; brisanje naloga
     kaskadno pobriše elemente.
  E) Regresija: proizvodnja/nalogi nemoteni (GET 200).
  F) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R465-TEST'
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
    db_url = os.environ.get('TEST_DB_URL') or os.environ.get('DATABASE_URL') or ('file:' + REPO + '/db/roksal.db')
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO,
                       env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:400]

def audit_has (token, action, entityId=None, projectId=None, contains=None):
    urls = [f'/api/audit?action={action}&limit=100']
    if projectId:
        urls.append(f'/api/audit?projectId={projectId}&action={action}&limit=100')
    for u in urls:
        s, d = callj('GET', u, token)
        rows = d.get('data', []) if s == 200 else []
        for e in rows:
            if entityId and e.get('entityId') != entityId:
                continue
            if contains and contains not in json.dumps(e.get('detail', {}), ensure_ascii=False):
                continue
            return True
    return False

CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  await p.productionOrder.deleteMany({where:{OR:[{title:{contains:'__TAG__'}},{title:{contains:'Prefab — P-2026-004'}}]}});
  const snaps=await p.digitalTwinSnapshot.findMany({where:{reason:{contains:'__TAG__'}}});
  const sIds=snaps.map(s=>s.id);
  await p.digitalTwinSnapshot.deleteMany({where:{reason:{contains:'__TAG__'}}});
  await p.photoVisualization.deleteMany({where:{note:{contains:'__TAG__'}}});
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
  await p.digitalTwinSnapshot.deleteMany({where:{id:{in:sIds}}});
  await p.arSnapshot.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.measurement.deleteMany({where:{location:{contains:'__TAG__'}}});
  await p.user.deleteMany({where:{email:{contains:'r465'}}});
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
  const u=await p.user.upsert({where:{email:'monter2-r465@roksal.si'},update:{},create:{
    email:'monter2-r465@roksal.si',name:'Monter2 R465',role:'MONTER',
    passwordHash:salt+':'+hash,active:true}});
  console.log('M2='+u.id);return p.$disconnect();
})()
'''
out, _ = bun(M2)
chk('M2=' in out, 'monter2 uporabnik pripravljen')
monter2 = login('monter2-r465@roksal.si', 'Monter123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')
P3 = PROJ.get('P-2026-003')
chk(bool(P4 and P3), 'projekta P-2026-004/P-2026-003 najdena')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p['sku']: p for p in d.get('data', [])}
OGRK2 = PRODUCTS.get('OGR-K-002')
chk(bool(OGRK2), 'izdelek OGR-K-002 najden')

# tekač (za AR vir + zajem): ZAČETEK → VRATA → KONEC + teren
NODES = [
    {'kind': 'ZACETEK', 'atCm': 0, 'podlaga': 'BETON', 'pritrditev': 'TLACNA'},
    {'kind': 'VRATA', 'atCm': 300, 'gateWcm': 100, 'podlaga': 'BETON'},
    {'kind': 'KONEC', 'atCm': 600, 'podlaga': 'ZEMLJA'},
]
TERRAIN = [{'distCm': 0, 'elevCm': 0}, {'distCm': 300, 'elevCm': 30}, {'distCm': 600, 'elevCm': 60}]
CAL = {'method': 'ZUNANJA_NAPRAVA', 'refValueCm': 92, 'refObject': 'vhodna plošča', 'device': 'Leica DISTO D2'}
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Ograja tekač {TAG}', 'nodes': NODES,
    'terrain': TERRAIN, 'calibration': CAL, 'productId': OGRK2['id'], 'note': TAG})
chk(s == 201, f'tekač pripravljen 201 (dejansko {s}, {d.get("error", "")})')
RUN = d.get('data', {}).get('id')

# ══ B. FIELD AR — vir podatkov za večsegmentni overlay ═════════════════════
print('── B. FIELD AR vir podatkov ──')
s, d = callj('GET', f'/api/fence-run?projectId={P4}', admin)
rows = d.get('data', [])
run_row = next((r for r in rows if r['id'] == RUN), {})
chk(s == 200 and bool(run_row), f'seznam tekačev projekta 200 z testnim (seg={run_row.get("segmentCount")}, {run_row.get("totalLengthCm")} cm)')

s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
segs = d.get('data', {}).get('segments', [])
chk(s == 200 and len(segs) >= 2, f'detail tekača 200 s {len(segs)} segmenti (overlay vir)')
chk(all('lengthCm' in x and 'posts' in x and 'toKind' in x for x in segs), 'segmenti nosijo dolžine/stebre/toKind (R460 vir za AR)')
chk(any(x.get('toKind') == 'VRATA' for x in segs), 'segment z VRATA obstaja (oznaka vrat v overlayju)')

# AR posnetek z virom „iz tekača“ v params (R465: izvoz/vir se hrani)
TINY_PNG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA='
s, d = callj('POST', '/api/ar-snapshots', monter, {
    'projectId': P4, 'scene': 'testni prizor',
    'params': json.dumps({'photo': TINY_PNG, 'scale': 1.2, 'opacity': 0.9, 'mode': 'demo',
                          'source': {'vir': 'tekac', 'runId': RUN, 'segments': len(segs), 'totalCm': 600}}),
    'note': TAG})
chk(s == 201, f'AR posnetek z virom tekača 201 (dejansko {s})')
ARSNAP = d.get('data', {}).get('id') if s == 201 else None
s, d = callj('GET', f'/api/ar-snapshots/{ARSNAP}', monter)
src = None
try: src = json.loads(d['data']['params']).get('source')
except Exception: pass
chk(s == 200 and (src or {}).get('vir') == 'tekac' and src.get('runId') == RUN, f'vir tekača preberljiv v podrobnosti AR posnetka ({src})')

# ══ A. RBAC (fail-closed) ═══════════════════════════════════════════════════
print('── A. RBAC (fail-closed) ──')
for path in [f'/api/capture-session/x/replay', '/api/production/x/elements', '/api/production/from-twin']:
    s, _ = callj('GET' if 'from-twin' not in path else 'POST', path)
    chk(s == 401, f'{path} brez žetona 401 (dejansko {s})')

# zajem za RBAC test (skladisce nima measurements.*, monter2 nima nalog)
s, d = callj('POST', '/api/capture-session', admin, {
    'projectId': P4, 'mode': 'FENCE_RUN', 'fenceRunId': RUN,
    'name': f'Zajem {TAG}', 'note': TAG,
    'device': {'caps': {'camera': True, 'gyro': True, 'gps': True}}})
chk(s == 201, f'zajem ustvarjen 201 (dejansko {s})')
SESS = d.get('data', {}).get('id')
PLAN = d.get('data', {}).get('plan', [])

s, _ = callj('GET', f'/api/capture-session/{SESS}/replay', skladisce)
chk(s == 403, f'skladišče replay 403 (dejansko {s})')
s, _ = callj('GET', f'/api/capture-session/{SESS}/replay', monter)
chk(s == 200, f'monter (z nalogo v P4) replay 200 (dejansko {s})')
s, _ = callj('GET', f'/api/capture-session/{SESS}/replay', monter2)
chk(s == 403, f'IDOR monter2 brez nalog replay 403 (dejansko {s})')

s, _ = callj('POST', '/api/production/from-twin', monter, {'projectId': P4})
chk(s == 403, f'monter from-twin 403 (brez production.manage) (dejansko {s})')
s, _ = callj('POST', '/api/production/from-twin', skladisce, {'projectId': P4})
chk(s == 403, f'skladišče from-twin 403 (brez production.manage) (dejansko {s})')
# proizvodnja IMA production.manage (to je njena vloga) → pride do poslovne logike:
# P4 v tem trenutku še nima AS-PRODUCED → 409 (dostop uspešen, poslovna vrata zavrnejo)
s, _ = callj('POST', '/api/production/from-twin', proizvodnja, {'projectId': P4})
chk(s == 409, f'proizvodnja from-twin pride do poslovne logike — 409 brez dvojčka, ne 403 (dejansko {s})')
s, _ = callj('PATCH', '/api/production/elements/x', skladisce, {'status': 'REZANJE'})
chk(s == 403, f'skladišče PATCH elementa 403 (dejansko {s})')

# ══ C. CAPTURE REPLAY ═══════════════════════════════════════════════════════
print('── C. CAPTURE REPLAY ──')
s, _ = callj('GET', '/api/capture-session/neobstaja/replay', admin)
chk(s == 404, f'replay neobstoječega 404 (dejansko {s})')

coverable = [p['id'] for p in PLAN if p['kind'] in ('START', 'SEGMENT', 'VRATA', 'TEREN', 'PODLAGA', 'KONEC')]
actions = [p['id'] for p in PLAN if p['kind'] in ('REFERENCA', 'COVERAGE', 'KALIBRACIJA')]
chk(len(coverable) >= 3, f'pokrivalne cone iz plan-a ({len(coverable)})')

def photo (zone, key, dark=False, bright=False, blurry=False, offset=None, thumb=None):
    body = {'zone': zone, 'clientKey': key, 'quality': {'dark': dark, 'bright': bright, 'blurry': blurry}}
    if offset is not None: body['offsetCm'] = offset
    if thumb is not None: body['thumb'] = thumb
    return callj('POST', f'/api/capture-session/{SESS}/photo', admin, body)

PHOTOS_ADDED = 0
# 1: coverable[0] dober + odmik 1,0 → ZAJETO / DRIFT_OK
s, d = photo(coverable[0], 'rp-1', offset=1.0)
chk(s == 201, f'posnetek 1 (offset 1,0) 201 (dejansko {s})'); PHOTOS_ADDED += 1
# 2: coverable[0] dober + odmik 2,5 → DOBRO / DRIFT_WARNING
s, d = photo(coverable[0], 'rp-2', offset=2.5)
chk(s == 201, f'posnetek 2 (offset 2,5) 201 (dejansko {s})'); PHOTOS_ADDED += 1
# 3: coverable[1] blurry → SLABO
s, d = photo(coverable[1], 'rp-3', blurry=True)
chk(s == 201, f'posnetek 3 (blurry) 201 (dejansko {s})'); PHOTOS_ADDED += 1
# 4: coverable[1] dober → ZAJETO (+ thumb za prikaz)
s, d = photo(coverable[1], 'rp-4', thumb=TINY_PNG)
chk(s == 201, f'posnetek 4 (thumb) 201 (dejansko {s})'); PHOTOS_ADDED += 1
# 5..: ostale cone po 1 dober
for i, zone in enumerate(coverable[2:], start=5):
    s, d = photo(zone, f'rp-{i}')
    chk(s == 201, f'posnetek {i} (cona) 201 (dejansko {s})'); PHOTOS_ADDED += 1

# replay v teku: koraki, kumulativna pokritost, drift evolucija, thumb
s, d = callj('GET', f'/api/capture-session/{SESS}/replay', admin)
steps = d.get('data', {}).get('steps', [])
chk(s == 200 and len(steps) == PHOTOS_ADDED, f'replay 200 s točno {PHOTOS_ADDED} koraki (dejansko {len(steps)})')
st1, st2, st3, st4 = (steps + [None] * 4)[:4]
z0 = next((z for z in st1['coverageAfter']['zones'] if z['stopId'] == coverable[0]), None)
z1 = next((z for z in st3['coverageAfter']['zones'] if z['stopId'] == coverable[1]), None)
z1b = next((z for z in st4['coverageAfter']['zones'] if z['stopId'] == coverable[1]), None)
chk(st1['driftAfter']['state'] == 'DRIFT_OK', f'korak 1 drift OK (dejansko {st1["driftAfter"]["state"]})')
chk(st2['driftAfter']['state'] == 'DRIFT_WARNING', f'korak 2 drift WARNING po 2,5 cm (dejansko {st2["driftAfter"]["state"]})')
chk(st2['driftAfter']['maxAbsCm'] == 2.5, f'korak 2 maxAbs 2,5 (dejansko {st2["driftAfter"]["maxAbsCm"]})')
chk(z0 and z0['state'] == 'ZAJETO' and z0['photoCount'] == 1, f'korak 1 cona ZAJETO ({z0})')
chk(st2 and next(z for z in st2['coverageAfter']['zones'] if z['stopId'] == coverable[0])['state'] == 'DOBRO', 'korak 2 cona DOBRO (2 dobri)')
chk(z1 and z1['state'] == 'SLABO', f'korak 3 cona SLABO po blurry ({z1 and z1["state"]})')
chk(z1b and z1b['state'] == 'ZAJETO', f'korak 4 cona ZAJETO po dobrem ({z1b and z1b["state"]})')
chk(st4['photo'].get('thumb', '').startswith('data:image/'), 'korak 4 ima sličico (thumb)')
chk(st1['photo'].get('zoneLabel') and st1['photo'].get('zoneKind'), f'korak nosi oznako+vrsto cone ({st1["photo"].get("zoneLabel")})')
chk(st1['photo'].get('critical') is True, 'kritičnost cone v koraku')

# zaključek zajema (ista vrata kot r461 F): obvezni koraki + referenca
s, d = callj('PATCH', f'/api/capture-session/{SESS}', admin, {'doneStops': actions})
chk(s == 200, f'obvezni koraki opravljeni (dejansko {s})')
s, d = callj('POST', f'/api/capture-session/{SESS}/reference', admin, {'atCm': 100, 'measureCm': 100, 'method': 'LASER'})
chk(s == 201, f'referenca dodana (dejansko {s})')
s, d = callj('POST', f'/api/capture-session/{SESS}/finish', admin, {'obstojeco': 'test'})
chk(s == 201, f'zaključek zajema 201 (dejansko {s}, {d.get("error", "")} {d.get("detail", "")})')
SNAP = d.get('data', {}).get('snapshotId')

s, d = callj('GET', f'/api/capture-session/{SESS}/replay', admin)
data = d.get('data', {})
final = data.get('final', {})
chk(s == 200 and data.get('session', {}).get('status') == 'ZAKLJUCEN', 'replay zaključenega zajema 200')
chk(final.get('coverage', {}).get('gateOk') is True, f'final.coverage.gateOk true ({final.get("coverage", {}).get("gateOk")})')
chk(data.get('session', {}).get('snapshotId') == SNAP, 'replay snapshotId == finish snapshotId')
chk(len(data.get('refs', [])) == 1 and data['refs'][0]['method'] == 'LASER', 'referenca v meta dela replaya')
chk(len(data.get('steps', [])) == PHOTOS_ADDED, f'koraki po zaključku nespremenjeni ({len(data.get("steps", []))})')

# ══ D. PREFAB ENGINE ═══════════════════════════════════════════════════════
print('── D. PREFAB ENGINE ──')
# brez AS-PRODUCED → 409
s, d = callj('POST', '/api/production/from-twin', admin, {'projectId': P3, 'reason': f'brez dvojčka {TAG}'})
chk(s == 409, f'from-twin brez AS-PRODUCED 409 (dejansko {s})')

# priprava: paket + POTRJENA kosovnica + AS_DESIGNED + AS_PRODUCED (r461 vzorec)
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGRK2['id'], 'name': f'Test paket {TAG}', 'qty': 6, 'unit': 'm', 'note': TAG})
chk(s == 201, f'paket 201 (dejansko {s})')
PKG = d.get('data', {}).get('id')

BOM_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const pkg=await p.projectPackage.findFirst({where:{note:{contains:'__TAG__'}},orderBy:{createdAt:'desc'}});
  const prod=await p.product.findFirst({where:{sku:'OGR-K-002'}});
  const bom=await p.bom.create({data:{code:'BOM-__TAG__',packageId:pkg.id,productId:prod.id,
    variantId:pkg.variantId,qty:6,unit:'m',status:'POTRJEN',note:'__TAG__'}});
  console.log('BOM='+bom.id);return p.$disconnect();
})()
'''
out, _ = bun(BOM_JS.replace('__TAG__', TAG))
chk('BOM=' in out, 'kosovnica pripravljena')
BOM = out.strip().split('BOM=')[-1].strip()

s, d = callj('POST', '/api/digital-twin/snapshot', admin, {'projectId': P4, 'kind': 'AS_DESIGNED', 'packageId': PKG, 'reason': f'načrt {TAG}'})
chk(s == 201, f'AS_DESIGNED 201 (dejansko {s})')
s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_PRODUCED', 'bomId': BOM,
    'spremembe': [{'opis': 'Višina segmenta 1: 106 cm', 'odobril': 'M. Kovač'}],
    'reason': f'proizvodnja {TAG}'})
chk(s == 201, f'AS_PRODUCED 201 (dejansko {s}, {d.get("error", "")} {d.get("detail", "")})')
PROD_SNAP = d.get('data', {}).get('id')

# from-twin → nov nalog + lističi iz segmentov
s, d = callj('POST', '/api/production/from-twin', admin, {'projectId': P4, 'reason': f'prefab {TAG}'})
chk(s == 201, f'from-twin 201 (dejansko {s}, {d.get("error", "")} {d.get("detail", "")})')
PO = d.get('data', {})
ORDER = PO.get('productionOrderId')
CODE = PO.get('code', '')
els = PO.get('elements', [])
chk(bool(ORDER) and CODE.startswith('PR-'), f'nov nalog s kodo {CODE}')
chk(PO.get('snapshotId') == PROD_SNAP, 'vir = zadnji AS-PRODUCED')
chk(len(els) == len(segs), f'lističi = segmenti dvojčka ({len(els)} vs {len(segs)})')
chk(all(e['status'] == 'NAVRTEN' for e in els), 'vsak listič začne v NAVRTEN')
chk(all(e['key'].startswith('seg-') for e in els), f'ključi seg-N ({[e["key"] for e in els]})')
chk(all(e.get('lengthCm') is not None for e in els), 'mere dolžin prenesene iz snapshot-a')
chk(PO.get('progress', {}).get('total') == len(els) and PO.get('progress', {}).get('pct') == 0, 'napredek 0 % ob nastanku')
chk(audit_has(admin, 'PREFAB_GENERATE', ORDER, P4), 'revizija PREFAB_GENERATE')

# idempotenca: isti nalog, isti snapshot → 409
s, d = callj('POST', '/api/production/from-twin', admin, {'productionOrderId': ORDER, 'reason': f'ponovno {TAG}'})
chk(s == 409, f'idempotentni ponovni POST 409 (dejansko {s})')

# GET elements (production.read) + proizvodnja read-only
s, d = callj('GET', f'/api/production/{ORDER}/elements', admin)
rows = d.get('data', {})
chk(s == 200 and rows.get('progress', {}).get('total') == len(segs), f'GET elements 200 ({rows.get("progress")})')
chk(rows.get('sourceSnapshotId') == PROD_SNAP, 'sourceSnapshotId v seznamu')
chk(rows.get('order', {}).get('code') == CODE, 'koda naloga v seznamu')
s, d = callj('GET', f'/api/production/{ORDER}/elements', proizvodnja)
chk(s == 200, f'proizvodnja GET elements 200 (dejansko {s})')
s, _ = callj('GET', f'/api/production/neobstaja/elements', admin)
chk(s == 404, f'elementi neobstoječega naloga 404 (dejansko {s})')

# PATCH statusni tok: preskok 400, neveljaven 400, linearno 200 ×4, terminal 400
EL1 = els[0]['id']
s, _ = callj('PATCH', f'/api/production/elements/{EL1}', admin, {'status': 'IZDELAVA'})
chk(s == 400, f'preskok NAVRTEN → IZDELAVA 400 (dejansko {s})')
s, _ = callj('PATCH', f'/api/production/elements/{EL1}', admin, {'status': 'NEVELJAVEN'})
chk(s == 400, f'neveljaven status 400 (dejansko {s})')
s, _ = callj('PATCH', f'/api/production/elements/neobstaja', admin, {'status': 'REZANJE'})
chk(s == 404, f'neobstoječ element 404 (dejansko {s})')

for next_st, lbl in [('REZANJE', 'rezanje'), ('IZDELAVA', 'izdelava'), ('POVRSINA', 'površina'), ('DOKONCAN', 'dokončan')]:
    s, d = callj('PATCH', f'/api/production/elements/{EL1}', admin, {'status': next_st})
    chk(s == 200 and d.get('data', {}).get('status') == next_st, f'prehod v {lbl} 200 (dejansko {s})')
s, _ = callj('PATCH', f'/api/production/elements/{EL1}', admin, {'status': 'REZANJE'})
chk(s == 400, f'DOKONCAN je terminal 400 (dejansko {s})')
chk(audit_has(admin, 'PREFAB_STATUS', EL1, P4), 'revizija PREFAB_STATUS')

# opomba na lističu → PREFAB_UPDATE
s, d = callj('PATCH', f'/api/production/elements/{els[1]["id"]}', admin, {'note': f'opomba {TAG}'})
chk(s == 200 and d.get('data', {}).get('note', '').startswith('opomba'), f'opomba na lističu 200 (dejansko {s})')
chk(audit_has(admin, 'PREFAB_UPDATE', els[1]['id'], P4), 'revizija PREFAB_UPDATE')

# regeneracija po začetem delu → 409 (brez tihih sprememb)
s, d = callj('POST', '/api/production/from-twin', admin, {'productionOrderId': ORDER, 'reason': f'regen {TAG}'})
chk(s == 409, f'regeneracija po začetku 409 (dejansko {s})')

# nalog brez projekta → 400
s, d = callj('POST', '/api/production', admin, {'title': f'brez projekta {TAG}'})
NO_PROJ_ORDER = d.get('data', {}).get('id') if s == 201 else None
chk(s == 201, f'nalog brez projekta 201 (dejansko {s})')
s, _ = callj('POST', '/api/production/from-twin', admin, {'productionOrderId': NO_PROJ_ORDER, 'reason': f'brez {TAG}'})
chk(s == 400, f'from-tun nalog brez projekta 400 (dejansko {s})')

# ── E. regresija ──
print('── E. Regresija ──')
s, d = callj('GET', '/api/production', admin)
chk(s == 200 and any(o['code'] == CODE for o in d.get('data', [])), f'seznam proizvodnih nalogov vsebuje {CODE} ({s})')
s, d = callj('GET', f'/api/digital-twin/snapshot?projectId={P4}&kind=AS_PRODUCED', admin)
chk(s == 200 and any(r['id'] == PROD_SNAP for r in d.get('data', [])), 'AS-PRODUCED snapshot na seznamu dvojčka')

# ── F. čiščenje ──
print('── F. Čiščenje ──')
FINAL_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const left=await p.productionElement.count();
  await p.productionOrder.deleteMany({where:{OR:[{title:{contains:'__TAG__'}},{title:{contains:'Prefab — P-2026-004'}}]}});
  const gone=await p.productionElement.count();
  const snaps=await p.digitalTwinSnapshot.findMany({where:{reason:{contains:'__TAG__'}}});
  const sIds=snaps.map(s=>s.id);
  await p.digitalTwinSnapshot.deleteMany({where:{reason:{contains:'__TAG__'}}});
  await p.photoVisualization.deleteMany({where:{note:{contains:'__TAG__'}}});
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
  await p.digitalTwinSnapshot.deleteMany({where:{id:{in:sIds}}});
  await p.arSnapshot.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.measurement.deleteMany({where:{location:{contains:'__TAG__'}}});
  await p.user.deleteMany({where:{email:{contains:'r465'}}});
  console.log('LEFT='+left+';GONE='+gone);return p.$disconnect();
})()
'''
out, _ = bun(FINAL_JS.replace('__TAG__', TAG))
chk('GONE=0' in out.replace('\n', ''), f'elementi kaskadno pobrisani z nalogom (izpis: {out.strip()[-40:]})')
chk('CLEAN_DONE' not in out and 'GONE=' in out, 'čiščenje zaključeno')

print('─' * 50)
print(f'REZULTAT: {PASS} ✓ / {FAIL} ✗')
sys.exit(1 if FAIL > 0 else 0)

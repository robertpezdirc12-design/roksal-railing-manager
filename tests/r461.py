#!/usr/bin/env python3
"""tests/r461.py — R461 REALITY CAPTURE QA + DIGITAL TWIN (issue #16)

Preverja:
  A) RBAC (fail-closed): brez žetona 401; skladišče (brez measurements.*)
     capture-session 403; proizvodnja read-only (GET 200 / POST 403 / twin
     snapshot POST 403); monter brez nalog v projektu → 403 (obseg).
  B) Ustvarjanje zajema (§2/§15/§16): nad tekačem → vodena ruta s postanki
     SEGMENT/VRATA/REFERENCA/KALIBRACIJA/COVERAGE/KONEC; tier PREMIUM iz
     caps (lidar+ar+kamera); zunanji pogoji shranjeni; revizija CAPTURE_START.
  C) Pokritost (§1): posnetki v cone → ZAJETO/DOBRO; slaba kakovost → SLABO;
     vsa kritična območja pokrita → gateOk; idempotenten clientKey (brez
     podvajanja, §17).
  D) Drift (§3): 1,4 cm → DRIFT_OK; 3 cm → DRIFT_WARNING; 6 cm →
     RE_LOC_REQUIRED; zaključek blokiran 409.
  E) Referenčna mreža (§4): veriga START→REF-001→REF-002 skladna; REF-003 v
     konfliktu → status KONFLIKT (izrecen, ne tih); zaključek blokiran 409;
     zavrnitev z razlogom → konflikt izginne; brez razloga 400.
  F) Zaključek z vrati (§1/§9): vsa vrata → 201, ZAKLJUCEN, AS-MEASURED
     snapshot v1, reviziji CAPTURE_FINISH + TWIN_SNAPSHOT_CREATE; ponovni
     zaključek 409; PATCH/foto po zaključku 409 (§22 brez tihih sprememb).
  G) Pregled dvojčka (§8): viri, snapshoti, kritična vrata (§7).
  H) Vrste snapshotov (§10/§11/§12/§22): AS_DESIGNED iz paketa v1+v2 (parent
     povezava, obvezen razlog); foto-viz napačne konfiguracije 409 (§19);
     AS_PRODUCED brez načrta 409; iz POTRJENE kosovnice 201 s spremembami;
     AS_INSTALLED neznan ključ 400; veljaven 201.
  I) Geometrijski diff (§13): AS_DESIGNED vs AS_INSTALLED → vrstice z
     razliko (npr. −1,2 cm), odstopanja; napačen kind 400.
  J) Cross-check (§14): matrika virov po segmentih + opozorila.
  K) IDOR: monter2 (brez nalog) → zajem 403, twin 403, snapshot 403; monter
     z nalogom vidi 200.
  L) Regresija: meritve/tekači/foto-viz/measure-engine nedotaknjeni.
  M) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = 'http://localhost:3000'
TAG = 'R461-TEST'
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
                       env={**os.environ, 'DATABASE_URL': 'file:/home/z/my-project/db/custom.db'})
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
  await p.measurement.deleteMany({where:{location:{contains:'__TAG__'}}});
  await p.auditLog.deleteMany({where:{OR:[{entity:{in:['captureSession','captureReference','digitalTwinSnapshot']}}]}});
  await p.user.deleteMany({where:{email:{contains:'r461'}}});
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
  const u=await p.user.upsert({where:{email:'monter2-r461@roksal.si'},update:{},create:{
    email:'monter2-r461@roksal.si',name:'Monter2 R461',role:'MONTER',
    passwordHash:salt+':'+hash,active:true}});
  console.log('M2='+u.id);return p.$disconnect();
})()
'''
out, _ = bun(M2)
chk('M2=' in out, 'monter2 uporabnik pripravljen')
monter2 = login('monter2-r461@roksal.si', 'Monter123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')
P3 = PROJ.get('P-2026-003')
chk(bool(P4 and P3), 'projekta P-2026-004/P-2026-003 najdena')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p['sku']: p for p in d.get('data', [])}
OGRK2 = PRODUCTS.get('OGR-K-002')
chk(bool(OGRK2), 'izdelek OGR-K-002 najden')

# tekač (isto telo kot r460 B): ZAČETEK → VRATA → KONEC + teren
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
s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
SEG1 = d['data']['segments'][0]['lengthCm'] if s == 200 and d.get('data', {}).get('segments') else 301.5
chk(s == 200, f'tekač detail 200 (SEG1={SEG1})')

# ══ A. RBAC ════════════════════════════════════════════════════════════════
print('── A. RBAC (fail-closed) ──')
for path in ['/api/capture-session', '/api/capture-session/x', '/api/digital-twin']:
    s, _ = callj('GET', path)
    chk(s == 401, f'{path} brez žetona 401 (dejansko {s})')
s, _ = callj('POST', '/api/capture-session', body={'projectId': 'x'})
chk(s == 401, 'ustvarjanje brez žetona 401')
s, _ = callj('GET', '/api/capture-session', skladisce)
chk(s == 403, f'skladišče seznam zajemov 403 (dejansko {s})')
s, _ = callj('POST', '/api/capture-session', skladisce, {'projectId': P4, 'mode': 'KAMERA'})
chk(s == 403, f'skladišče ustvarjanje zajema 403 (dejansko {s})')
s, _ = callj('GET', '/api/capture-session', proizvodnja)
chk(s == 200, f'proizvodnja seznam zajemov 200 (dejansko {s})')
s, _ = callj('POST', '/api/capture-session', proizvodnja, {'projectId': P4, 'mode': 'KAMERA'})
chk(s == 403, f'proizvodnja ustvarjanje zajema 403 (dejansko {s})')
s, _ = callj('POST', '/api/digital-twin/snapshot', proizvodnja, {'projectId': P4, 'kind': 'AS_DESIGNED', 'reason': 'test'})
chk(s == 403, f'proizvodnja twin snapshot 403 (dejansko {s})')
s, _ = callj('POST', '/api/capture-session', monter, {'projectId': P3, 'mode': 'KAMERA', 'note': TAG})
chk(s == 403, f'monter brez nalog v projektu 403 (dejansko {s})')

# ══ B. Ustvarjanje zajema (§2/§15/§16) ═════════════════════════════════════
print('── B. Ustvarjanje zajema ──')
CAPS_PREMIUM = {'camera': True, 'lidar': True, 'ar': True, 'gyro': True, 'gps': True}
s, d = callj('POST', '/api/capture-session', admin, {
    'projectId': P4, 'mode': 'FENCE_RUN', 'fenceRunId': RUN,
    'name': f'Zajem {TAG}', 'note': TAG,
    'device': {'tier': 'BASIC', 'caps': CAPS_PREMIUM},  # napačna trditev → strežnik izračuna PREMIUM
    'outdoor': {'conditions': ['SONCE', 'SENCE']}})
chk(s == 201, f'ustvarjanje 201 (dejansko {s}, {d.get("error", "")})')
SESS = d.get('data', {}).get('id')
chk(bool(SESS), f'zajem id={SESS}')
plan = d.get('data', {}).get('plan', [])
kinds = [p['kind'] for p in plan]
for k in ['START', 'SEGMENT', 'VRATA', 'REFERENCA', 'TEREN', 'PODLAGA', 'COVERAGE', 'KALIBRACIJA', 'KONEC']:
    chk(k in kinds, f'postanek {k} v ruti (dejansko {kinds})')
chk(d.get('data', {}).get('device', {}).get('tier') == 'PREMIUM', 'tier PREMIUM izračunan na strežniku (§15)')
chk(audit_has(admin, 'CAPTURE_START', SESS, P4), 'revizija CAPTURE_START')

# KAMERA brez tekača → 400
s, _ = callj('POST', '/api/capture-session', admin, {'projectId': P4, 'mode': 'FENCE_RUN', 'note': TAG})
chk(s == 400, f'FENCE_RUN brez fenceRunId 400 (dejansko {s})')
s, _ = callj('POST', '/api/capture-session', admin, {'projectId': P4, 'mode': 'FENCE_RUN', 'fenceRunId': 'neobstaja', 'note': TAG})
chk(s == 404, f'neznan tekač 404 (dejansko {s})')

# ══ C. Pokritost (§1/§17) ══════════════════════════════════════════════════
print('── C. Pokritost ──')
def photo (zone, key, dark=False, bright=False, blurry=False, offset=None):
    body = {'zone': zone, 'clientKey': key, 'quality': {'dark': dark, 'bright': bright, 'blurry': blurry}}
    if offset is not None: body['offsetCm'] = offset
    return callj('POST', f'/api/capture-session/{SESS}/photo', admin, body)

coverable = [p['id'] for p in plan if p['kind'] in ('START', 'SEGMENT', 'VRATA', 'TEREN', 'PODLAGA', 'KONEC')]
actions = [p['id'] for p in plan if p['kind'] in ('REFERENCA', 'COVERAGE', 'KALIBRACIJA')]

# slaba kakovost → SLABO
s, d = photo(coverable[0], 'k-slabo', dark=True)
chk(s == 201, f'posnetek slabe kakovosti 201 (dejansko {s})')
an = d.get('data', {}).get('analysis', {}).get('coverage', {})
z0 = next((z for z in an.get('zones', []) if z['stopId'] == coverable[0]), {})
chk(z0.get('state') == 'SLABO', f"cona SLABO (dejansko {z0.get('state')})")
chk(an.get('gateOk') is False, 'vrata pokritosti zaprta')

# idempotentnost (§17): isti clientKey → duplicate, brez podvajanja
s, d = photo(coverable[0], 'k-slabo', dark=True)
chk(s == 200 and d.get('data', {}).get('duplicate') is True, f'idempotenten clientKey (dejansko {s})')
s, d = callj('GET', f'/api/capture-session/{SESS}', admin)
photos = d.get('data', {}).get('photos', [])
chk(len([p for p in photos if p['clientKey'] == 'k-slabo']) == 1, 'ni podvojenega posnetka')

# dobra kakovost po conah → gateOk
for i, z in enumerate(coverable):
    photo(z, f'k-{i}')
    photo(z, f'k2-{i}')
s, d = callj('GET', f'/api/capture-session/{SESS}', admin)
an = d.get('data', {}).get('analysis', {})
cov = an.get('coverage', {})
chk(cov.get('gateOk') is True, f'vsake kritične cone pokrite → gateOk (manjka: {cov.get("criticalMissing")})')
dobro = [z for z in cov.get('zones', []) if z['state'] == 'DOBRO']
chk(len(dobro) >= 1, f'vsaj ena cona DOBRO (dejansko {len(dobro)})')

# neznana zona → 400
s, _ = photo('ne-obstaja', 'k-neznana')
chk(s == 400, f'neznana zona 400 (dejansko {s})')
# prevelika sličica → 400 (§24)
s, _ = callj('POST', f'/api/capture-session/{SESS}/photo', admin, {
    'zone': coverable[0], 'clientKey': 'k-velik', 'thumb': 'data:image/jpeg,' + 'x' * (121 * 1024)})
chk(s == 400, f'sličica > 120 KB 400 (dejansko {s})')

# ══ D. Drift (§3) ══════════════════════════════════════════════════════════
print('── D. Drift ──')
s, d = callj('POST', f'/api/capture-session/{SESS}/drift', admin, {'offsetCm': 1.4})
chk(s == 201 and d.get('data', {}).get('state') == 'DRIFT_OK', f"drift 1,4 cm → DRIFT_OK (dejansko {d.get('data', {}).get('state')})")
s, d = callj('POST', f'/api/capture-session/{SESS}/drift', admin, {'offsetCm': 3.0})
chk(d.get('data', {}).get('state') == 'DRIFT_WARNING', f"drift 3 cm → DRIFT_WARNING (dejansko {d.get('data', {}).get('state')})")
s, d = callj('POST', f'/api/capture-session/{SESS}/drift', admin, {'offsetCm': 6.0})
chk(d.get('data', {}).get('state') == 'RE_LOC_REQUIRED', f"drift 6 cm → RE_LOC_REQUIRED (dejansko {d.get('data', {}).get('state')})")

# zaključek blokiran (drift + manjkajoči koraki + brez referenc)
s, d = callj('POST', f'/api/capture-session/{SESS}/finish', admin, {})
chk(s == 409, f'zaključek blokiran (drift/rute/refs) 409 (dejansko {s})')
chk('RE-LOKALIZACIJA' in (d.get('detail') or ''), 'razlog vsebuje re-lokalizacijo')

# re-lokalizacija = nova referenca + nadaljevanje (vzorci ostanejo zapisani)
# (najprej označi opravljene korce, potem reference — vrata se preverijo ob koncu)
s, d = callj('PATCH', f'/api/capture-session/{SESS}', admin, {'doneStops': actions})
chk(s == 200, f'opravljeni koraki rutе 200 (dejansko {s})')

# ══ E. Referenčna mreža (§4) ═══════════════════════════════════════════════
print('── E. Referenčna mreža ──')
def ref (at, meas, method='LASER', label=None, key=None):
    return callj('POST', f'/api/capture-session/{SESS}/reference', admin,
                 {'atCm': at, 'measureCm': meas, 'method': method, **({'label': label} if label else {})})

s, d = ref(150, 150.2, label='levi vogal')
chk(s == 201 and d.get('data', {}).get('code') == 'REF-001', f'REF-001 201 (dejansko {s})')
chk(d.get('data', {}).get('status') == 'AKTIVNA', 'REF-001 AKTIVNA')
s, d = ref(450, 300.1, label='desni vogal')
chk(s == 201 and d.get('data', {}).get('code') == 'REF-002', 'REF-002 dodana')
net = d.get('data', {}).get('network', {})
chk(len(net.get('conflicts', [])) == 0, f'veriga skladna (konflikti: {net.get("conflicts")})')

# napačna metoda → 400
s, _ = ref(500, 50, method='GPS')
chk(s == 400, f'neveljavna metoda 400 (dejansko {s})')

# KONFLIKT: REF-003 @600, merilo 180 (deklarirano 150) → +30 cm pri ±0,5 tolerance
s, d = ref(600, 180.0, label='konec')
chk(s == 201, f'REF-003 dodana 201 (dejansko {s})')
chk(d.get('data', {}).get('status') == 'KONFLIKT', f"REF-003 status KONFLIKT (dejansko {d.get('data', {}).get('status')})")
net = d.get('data', {}).get('network', {})
chk(len(net.get('conflicts', [])) == 1 and 'REFERENCE CONFLICT' in net['conflicts'][0],
    f'izrecen REFERENCE CONFLICT (dejansko {net.get("conflicts")})')
s, d = callj('POST', f'/api/capture-session/{SESS}/finish', admin, {})
chk(s == 409 and 'konflikt' in (d.get('detail') or '').lower(), f'zaključek blokiran ob konfliktu 409 (dejansko {s})')

# zavrnitev brez razloga → 400 (§18)
REF3 = None
s, d = callj('GET', f'/api/capture-session/{SESS}', admin)
for r in d.get('data', {}).get('references', []):
    if r['code'] == 'REF-003': REF3 = r['id']
s, _ = callj('PATCH', f'/api/capture-session/{SESS}/reference', admin, {'referenceId': REF3, 'action': 'ZAVRCI'})
chk(s == 400, f'zavrnitev brez razloga 400 (dejansko {s})')

# zavrnitev z razlogom → konflikt izgine
s, d = callj('PATCH', f'/api/capture-session/{SESS}/reference', admin, {
    'referenceId': REF3, 'action': 'ZAVRCI', 'reason': 'Merjeno čez oviro — ponovna izmera na voljo.'})
chk(s == 200, f'zavrnitev z razlogom 200 (dejansko {s})')
net = d.get('data', {}).get('network', {})
chk(len(net.get('conflicts', [])) == 0, f'konflikt razrešen izrecno (dejansko {net.get("conflicts")})')

# ══ F. Zaključek z vrati (§1/§9/§22) ═══════════════════════════════════════
print('── F. Zaključek ──')
# drift še RE_LOC → najprej nova referenca kot re-lokalizacija (REF-004 blizu konca, skladna)
s, d = ref(590, 140.3, label='re-lokalizacija')
chk(s == 201 and d.get('data', {}).get('status') == 'AKTIVNA', 'REF-004 (re-lokalizacija) dodana')
# drift vzorci ostanejo — RE_LOC še velja? vzorci se NE čistijo (§3), zato dodamo
# dober vzorec po re-lokalizaciji in preverimo, da status upošteva najnovejše…
#引擎 vrne RE_LOC dokler obstaja vzorec > 5 — po namenu: zahtevaj PONOVNI zajem
# problema. Za test: nova seja bo imela čiste vzorce; tukaj zaključek še blokiran.
s, d = callj('POST', f'/api/capture-session/{SESS}/finish', admin, {'obstojeco': 'Obstoječa lesenа ograja, delno poškodovana.'})
chk(s == 409, f'zaključek blokiran ob RE_LOC driftu (dejansko {s})')
# rešitev: drift se izniči z novo sejo — tu preverimo le, da je razlog izrecen
chk('re-lokalizacij' in (d.get('detail') or '').lower(), 'razlog navaja re-lokalizacijo')

# nova seja s čistim driftom za uspešen zaključek
s, d = callj('POST', '/api/capture-session', admin, {
    'projectId': P4, 'mode': 'FENCE_RUN', 'fenceRunId': RUN,
    'name': f'Zajem čist {TAG}', 'note': TAG,
    'device': {'caps': {'camera': True, 'ar': True}}, 'outdoor': {'conditions': []}})
SESS2 = d.get('data', {}).get('id')
plan2 = d.get('data', {}).get('plan', [])
coverable2 = [p['id'] for p in plan2 if p['kind'] in ('START', 'SEGMENT', 'VRATA', 'TEREN', 'PODLAGA', 'KONEC')]
actions2 = [p['id'] for p in plan2 if p['kind'] in ('REFERENCA', 'COVERAGE', 'KALIBRACIJA')]
for i, z in enumerate(coverable2):
    callj('POST', f'/api/capture-session/{SESS2}/photo', admin, {'zone': z, 'clientKey': f'c2-{i}', 'quality': {}})
callj('PATCH', f'/api/capture-session/{SESS2}', admin, {'doneStops': actions2})
callj('POST', f'/api/capture-session/{SESS2}/reference', admin, {'atCm': 150, 'measureCm': 150.1, 'method': 'LASER'})
s, d = callj('POST', f'/api/capture-session/{SESS2}/finish', admin, {'obstojeco': 'Obstoječa ograja — les, delno poškodovana.'})
chk(s == 201, f'zaključek uspešen 201 (dejansko {s}, {d.get("error", "")} {d.get("detail", "")})')
SNAP = d.get('data', {}).get('snapshotId')
chk(bool(SNAP), f'AS-MEASURED snapshot={SNAP}')
chk((d.get('data', {}).get('version') or 0) >= 1, f"verzija AS-MEASURED >= 1 (demo podatki lahko zasedejo v1; dejansko {d.get('data', {}).get('version')})")
g = d.get('data', {}).get('criticalGate') or {}
chk('ponudba' in g, f'kritična vrata v odgovoru (§7)')
chk(audit_has(admin, 'CAPTURE_FINISH', SESS2, P4), 'revizija CAPTURE_FINISH')
chk(audit_has(admin, 'TWIN_SNAPSHOT_CREATE', SNAP, P4), 'revizija TWIN_SNAPSHOT_CREATE')

# ponovni zaključek 409; PATCH/foto po zaključku 409 (§22)
s, _ = callj('POST', f'/api/capture-session/{SESS2}/finish', admin, {})
chk(s == 409, f'ponovni zaključek 409 (dejansko {s})')
s, _ = callj('PATCH', f'/api/capture-session/{SESS2}', admin, {'note': 'po zaključku'})
chk(s == 409, f'PATCH po zaključku 409 (dejansko {s})')
s, _ = callj('POST', f'/api/capture-session/{SESS2}/photo', admin, {'zone': 'start', 'clientKey': 'po-zakljucku'})
chk(s == 409, f'foto po zaključku 409 (dejansko {s})')
s, _ = callj('DELETE', f'/api/capture-session/{SESS2}', admin)
chk(s == 409, f'brisanje zaključenega 409 (dejansko {s})')

# prekinitev + nadaljevanje (§17)
s, d = callj('PATCH', f'/api/capture-session/{SESS}', admin, {'status': 'PREKINJEN'})
chk(s == 200 and d.get('data', {}).get('status') == 'PREKINJEN', 'prekinitev zajema')
s, d = callj('PATCH', f'/api/capture-session/{SESS}', admin, {'status': 'V_TEKU'})
chk(s == 200 and d.get('data', {}).get('status') == 'V_TEKU', 'nadaljevanje zajema')

# ══ G. Pregled dvojčka (§8) ════════════════════════════════════════════════
print('── G. Pregled dvojčka ──')
s, d = callj('GET', f'/api/digital-twin?projectId={P4}', admin)
chk(s == 200, f'pregled 200 (dejansko {s})')
ov = d.get('data', {})
chk(any(x['kind'] == 'AS_MEASURED' for x in ov.get('snapshots', [])), 'AS_MEASURED v časovnici')
chk(ov.get('counts', {}).get('captureSessions', 0) >= 2, f'števec zajemov (dejansko {ov.get("counts", {}).get("captureSessions")})')
chk(ov.get('counts', {}).get('photos', 0) >= 10, f'števec posnetkov (dejansko {ov.get("counts", {}).get("photos")})')
chk(ov.get('criticalGate') is not None, 'kritična vrata iz tekača (§7)')

# ══ H. Vrste snapshotov (§10/§11/§12/§22) ══════════════════════════════════
print('── H. Vrste snapshotov ──')
# paket za AS-DESIGNED
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGRK2['id'], 'name': f'Test paket {TAG}', 'qty': 6, 'unit': 'm', 'note': TAG})
chk(s == 201, f'paket 201 (dejansko {s}, {d.get("error", "")})')
PKG = d.get('data', {}).get('id')

# AS_PRODUCED brez AS-DESIGNED → 409 (kosovnica še ne obstaja → 404 najprej)
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

s, _ = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_PRODUCED', 'bomId': BOM, 'reason': f'preskus {TAG}'})
chk(s == 409, f'AS_PRODUCED brez AS-DESIGNED 409 (dejansko {s})')

# AS_DESIGNED v1 + v2 (parent, razlog)
s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_DESIGNED', 'packageId': PKG, 'reason': f'Odobrena rešitev {TAG}'})
chk(s == 201 and d.get('data', {}).get('version') == 1, f'AS_DESIGNED v1 (dejansko {s})')
DES1 = d.get('data', {}).get('id')
s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_DESIGNED', 'packageId': PKG, 'reason': f'Sprememba višine {TAG}'})
chk(s == 201 and d.get('data', {}).get('version') == 2, f'AS_DESIGNED v2 (dejansko {s})')
DES2 = d.get('data', {}).get('id')
s, d = callj('GET', f'/api/digital-twin/snapshot?projectId={P4}&kind=AS_DESIGNED', admin)
rows = d.get('data', [])
v2row = next((r for r in rows if r['id'] == DES2), {})
chk(v2row.get('parentSnapshotId') == DES1, 'v2 povezan na v1 (§22)')
# brez razloga → 400
s, _ = callj('POST', '/api/digital-twin/snapshot', admin, {'projectId': P4, 'kind': 'AS_DESIGNED', 'packageId': PKG})
chk(s == 400, f'brez razloga 400 (dejansko {s})')
# AS_MEASURED prek snapshot API → 400 (samo prek zaključka)
s, _ = callj('POST', '/api/digital-twin/snapshot', admin, {'projectId': P4, 'kind': 'AS_MEASURED', 'reason': 'test'})
chk(s == 400, f'AS_MEASURED samo prek zaključka 400 (dejansko {s})')

# §19: foto-viz napačnega produkta → 409
PV_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const proj=await p.project.findFirst({where:{code:'P-2026-004'}});
  const prods=await p.product.findMany({where:{sku:{not:'OGR-K-002'}},take:1});
  const pv=await p.photoVisualization.create({data:{projectId:proj.id,
    sourcePhoto:'data:image/jpeg;base64,R0lGODlhAQABAAAAACw=',productId:prods[0].id,
    engineVersion:'photo-replace/1.0',renderParams:'{}',note:'__TAG__'}});
  console.log('PV='+pv.id);return p.$disconnect();
})()
'''
out, _ = bun(PV_JS.replace('__TAG__', TAG))
chk('PV=' in out, 'foto-viz tujega produkta pripravljena')
PV = out.strip().split('PV=')[-1].strip()
s, _ = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_DESIGNED', 'packageId': PKG, 'fotoVizId': PV, 'reason': f'test {TAG}'})
chk(s == 409, f'§19 napačna konfiguracija vizualizacije 409 (dejansko {s})')

# AS_PRODUCED iz POTRJENE kosovnice s spremembami (DESIGNED → CHANGE → APPROVED → PRODUCED)
s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_PRODUCED', 'bomId': BOM,
    'spremembe': [{'opis': 'Višina segmenta 2: 108 cm', 'odobril': 'M. Kovač'}],
    'reason': f'Proizvodnja zaključena {TAG}'})
chk(s == 201, f'AS_PRODUCED 201 (dejansko {s}, {d.get("error", "")} {d.get("detail", "")})')

# AS_INSTALLED: neznan ključ 400 / veljaven 201
s, _ = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_INSTALLED',
    'finalSegments': [{'key': 'seg-42', 'lengthCm': 500}], 'notes': [], 'reason': f'test {TAG}'})
chk(s == 400, f'AS_INSTALLED neznan ključ 400 (dejansko {s})')
s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': P4, 'kind': 'AS_INSTALLED',
    'finalSegments': [
        {'key': 'seg-1', 'lengthCm': round(SEG1 - 1.2, 1), 'heightCm': 110},
        {'key': 'seg-2', 'lengthCm': 301.5, 'heightCm': 110}],
    'notes': ['Pritrditev na desni strani na novo betonsko podlago'],
    'reason': f'Montaža potrjena {TAG}'})
chk(s == 201, f'AS_INSTALLED 201 (dejansko {s}, {d.get("error", "")} {d.get("detail", "")})')

# ══ I. Geometrijski diff (§13) ═════════════════════════════════════════════
print('── I. Geometrijski diff ──')
s, d = callj('GET', f'/api/digital-twin/diff?projectId={P4}&from=AS_DESIGNED&to=AS_INSTALLED', admin)
chk(s == 200, f'diff 200 (dejansko {s})')
diff = d.get('data', {}).get('diff', {})
rows = diff.get('rows', [])
seg1l = next((r for r in rows if r['key'] == 'seg-1:DOLZINA'), {})
chk(seg1l.get('a') is not None and seg1l.get('diff') is not None, f'seg-1 dolžina primerjana ({seg1l})')
chk(abs((seg1l.get('diff') or 0) + 1.2) < 0.2, f"seg-1 odstopanje −1,2 cm (dejansko {seg1l.get('diff')})")
chk(diff.get('compared', 0) >= 3, f'primerjanih mer ≥ 3 (dejansko {diff.get('compared')})')
chk(diff.get('deviations', 0) >= 1, f'vsaj eno odstopanje (dejansko {diff.get('deviations')})')
s, _ = callj('GET', f'/api/digital-twin/diff?projectId={P4}&from=AS_DESIGNED&to=CARKA', admin)
chk(s == 400, f'napačen kind 400 (dejansko {s})')
s, _ = callj('GET', f'/api/digital-twin/diff?projectId={P3}&from=AS_DESIGNED&to=AS_INSTALLED', admin)
chk(s == 404, f'snapshotov ni na P3 → 404 (dejansko {s})')

# ══ J. Cross-check (§14) ═══════════════════════════════════════════════════
print('── J. Cross-check ──')
s, d = callj('GET', f'/api/digital-twin/consistency?projectId={P4}', admin)
chk(s == 200, f'consistency 200 (dejansko {s})')
cons = d.get('data', {})
rows = cons.get('rows', [])
chk(len(rows) >= 1, f'vrstice po segmentih (dejansko {len(rows)})')
if rows:
    r0 = rows[0]
    chk('photo' in r0 and 'sketch2d' in r0 and 'threeD' in r0 and 'measurement' in r0, 'matrika PHOTO/2D/3D/MERITEV')
    chk(r0.get('measurement') is True, 'kanonična meritev označena')

# ══ K. IDOR ════════════════════════════════════════════════════════════════
print('── K. IDOR ──')
s, _ = callj('GET', f'/api/capture-session/{SESS}', monter2)
chk(s == 403, f'monter2 tuji zajem 403 (dejansko {s})')
s, _ = callj('GET', f'/api/digital-twin?projectId={P4}', monter2)
chk(s == 403, f'monter2 tuji twin 403 (dejansko {s})')
s, _ = callj('POST', '/api/digital-twin/snapshot', monter2, {
    'projectId': P4, 'kind': 'AS_DESIGNED', 'packageId': PKG, 'reason': 'test'})
chk(s == 403, f'monter2 snapshot 403 (dejansko {s})')
s, _ = callj('GET', f'/api/capture-session/{SESS}', monter)
chk(s == 200, f'monter z nalogom vidi zajem 200 (dejansko {s})')
s, _ = callj('GET', f'/api/digital-twin?projectId={P4}', monter)
chk(s == 200, f'monter z nalogom vidi twin 200 (dejansko {s})')

# ══ L. Regresija ═══════════════════════════════════════════════════════════
print('── L. Regresija ──')
s, _ = callj('GET', '/api/measurements', admin)
chk(s == 200, f'meritve seznam 200 (dejansko {s})')
s, _ = callj('GET', '/api/fence-run', admin)
chk(s == 200, f'tekači seznam 200 (dejansko {s})')
s, _ = callj('GET', f'/api/photo-visualization?projectId={P4}', admin)
chk(s == 200, f'foto-viz seznam 200 (dejansko {s})')
s, d = callj('POST', '/api/measure-engine/analyze', admin, {
    'mode': 'OGRAJA', 'points': [{'x': 0, 'y': 0}, {'x': 300, 'y': 0}],
    'calibration': {'px': 1, 'cm': 1}})
chk(s == 200, f'measure-engine analyze 200 (dejansko {s})')

# ══ M. Čiščenje ════════════════════════════════════════════════════════════
print('── M. Čiščenje ──')
out, _ = bun(CLEAN)
chk('CLEAN_DONE' in out, 'čiščenje izvedeno')
COUNT_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const s=await p.captureSession.count({where:{OR:[{note:{contains:'__TAG__'}},{name:{contains:'__TAG__'}}]}});
  const r=await p.captureReference.count({where:{note:{contains:'__TAG__'}}});
  const t=await p.digitalTwinSnapshot.count({where:{reason:{contains:'__TAG__'}}});
  const ph=await p.capturePhoto.count({where:{clientKey:{contains:'k-'}}});
  const b=await p.bom.count({where:{note:{contains:'__TAG__'}}});
  console.log('N='+s+'|'+r+'|'+t+'|'+b);return p.$disconnect();
})()
'''
out, _ = bun(COUNT_JS.replace('__TAG__', TAG))
chk('N=0|0|0|0' in out, f'vsi testni zapisi odstranjeni (dejansko {out.strip()})')

print(f'\n══════ REZULTAT: {PASS} ✓ / {FAIL} ✗ ══════')
sys.exit(1 if FAIL else 0)

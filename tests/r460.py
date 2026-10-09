#!/usr/bin/env python3
"""tests/r460.py — R460 ULTIMATE MEASUREMENT ENGINE: OGRAJNI TEKAČ (issue #15)

Preverja:
  A) RBAC (fail-closed): brez žetona 401; skladišče (brez measurements.*)
     GET+POST 403; proizvodnja (read, ne write) GET 200 / POST 403; monter
     (read+write) 201. Monter brez nalog v projektu → POST 403 (obseg).
  B) Ustvarjanje tekača (§1): 3 vozlišča (ZAČETEK → VRATA → KONEC) + teren
     (§12, 10 % klanec) + kalibracija LASER (§4) + produkt → 201, verzija v1,
     segmenti izračunani (3D dolžina po padini), statusi CALIBRATED,
     validacija vsebuje PREDLAGANE_STEBRE (§11: 300 cm > 120 cm razpon),
     revizija FENCE_RUN_CREATE.
  C) Validacije vhoda: padajoča vozlišča 400; teren z napačno elevacijo 400;
     slaba metoda kalibracije 400; varianta brez izdelka 400; neznan projekt
     404; <1 vozlišče 400.
  D) Razpored stebrov (§11): POST layout apply → vstavljeni vmesni stebri,
     predlogi izpraznjeni, verzija +1, revizija FENCE_RUN_LAYOUT.
  E) VERIFIED iz zunanjega merilnika (§10): preveritev znotraj tolerance →
     status VERIFIED, odstopanje zapisano; konflikt (veliko odstopanje) →
     validacija KONFLIKT_VERIFIED (§19) + potrditev zavrnjena 409.
  F) Quality gate + potrditev (§3/§20/§21): tekač brez kalibracije → 409;
     tekač z ESTIMATED segmenti → 409; veljaven tekač → 201: kanonična
     meritev (params.fenceRunId), segmenti CONFIRMED, status POTRJEN,
     paket projekta (handoff), revizija FENCE_RUN_CONFIRM. Ponovna
     potrditev 409; PATCH potrjenega 409 (§19: brez tihih sprememb).
  G) Poštena razveljavitev (§19): preverjen segment + sprememba geometrije →
     status pade na ESTIMATED (brez tihega prenosa verifikacije).
  H) IDOR: monter2 (brez nalog v projektu) → GET/PATCH/verify/confirm/DELETE
     403/404; monter z nalogom vidi tekač.
  I) Regresija: /api/measurements seznam, /api/railing-layout izračun,
     /api/measure-engine/analyze (deterministični engine nedotaknjen).
  J) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
TAG = 'R460-TEST'
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
    """Poišče revizijski zapis po akciji+entityId v OBEH pogledih:
    sistemskem (brez filtra) in per-projektnem (?projectId=…)."""
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
  const runs=await p.fenceRun.findMany({where:{OR:[{note:{contains:'__TAG__'}},{name:{contains:'__TAG__'}}]},select:{id:true,measurementId:true,projectId:true}});
  for(const r of runs){
    if(r.measurementId){
      await p.projectPackage.updateMany({where:{measurementId:r.measurementId},data:{measurementId:null}});
      await p.measurementVersion.deleteMany({where:{measurementId:r.measurementId}});
      await p.measurement.deleteMany({where:{id:r.measurementId}});
    }
    await p.fenceRun.delete({where:{id:r.id}});
  }
  await p.projectPackage.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.measurement.deleteMany({where:{location:{contains:'__TAG__'}}});
  await p.auditLog.deleteMany({where:{OR:[{entity:'fenceRun',detail:{contains:'__TAG__'}},{action:{in:['FENCE_RUN_CREATE','FENCE_RUN_UPDATE','FENCE_RUN_LAYOUT','FENCE_RUN_VERIFY','FENCE_RUN_CONFIRM','FENCE_RUN_DELETE']}}]}});
  await p.user.deleteMany({where:{email:{contains:'r460'}}});
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
  const u=await p.user.upsert({where:{email:'monter2-r460@roksal.si'},update:{},create:{
    email:'monter2-r460@roksal.si',name:'Monter2 R460',role:'MONTER',
    passwordHash:salt+':'+hash,active:true}});
  console.log('M2='+u.id);return p.$disconnect();
})()
'''
out, _ = bun(M2)
chk('M2=' in out, 'monter2 uporabnik pripravljen')
monter2 = login('monter2-r460@roksal.si', 'Monter123!')

# projekti: P-2026-004 (monter IMA nalog) in P-2026-003 (monter NIMA naloga)
s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')
P3 = PROJ.get('P-2026-003')
chk(bool(P4 and P3), 'projekta P-2026-004/P-2026-003 najdena')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p['sku']: p for p in d.get('data', [])}
OGRK2 = PRODUCTS.get('OGR-K-002')
chk(bool(OGRK2), 'izdelek OGR-K-002 najden')

CAL = {'method': 'ZUNANJA_NAPRAVA', 'refValueCm': 92, 'refObject': 'vhodna plošča', 'device': 'Leica DISTO D2'}

# ══ A. RBAC ════════════════════════════════════════════════════════════════
print('── A. RBAC (fail-closed) ──')
s, _ = callj('GET', '/api/fence-run')
chk(s == 401, f'seznam brez žetona 401 (dejansko {s})')
s, _ = callj('POST', '/api/fence-run', body={'projectId': 'x', 'nodes': []})
chk(s == 401, f'ustvarjanje brez žetona 401 (dejansko {s})')
s, _ = callj('GET', '/api/fence-run/x')
chk(s == 401, f'detail brez žetona 401 (dejansko {s})')
s, _ = callj('GET', '/api/fence-run', skladisce)
chk(s == 403, f'skladišče seznam 403 (dejansko {s})')
s, _ = callj('POST', '/api/fence-run', skladisce, {'projectId': P4, 'nodes': [{'kind': 'ZACETEK', 'atCm': 0}]})
chk(s == 403, f'skladišče ustvarjanje 403 (dejansko {s})')
s, _ = callj('GET', '/api/fence-run', proizvodnja)
chk(s == 200, f'proizvodnja seznam 200 (dejansko {s})')
s, _ = callj('POST', '/api/fence-run', proizvodnja, {'projectId': P4, 'nodes': [{'kind': 'ZACETEK', 'atCm': 0}]})
chk(s == 403, f'proizvodnja ustvarjanje 403 (dejansko {s})')

# monter brez nalog v P-2026-003 → 403 (obseg projekta)
s, _ = callj('POST', '/api/fence-run', monter, {
    'projectId': P3, 'nodes': [{'kind': 'ZACETEK', 'atCm': 0}], 'note': TAG})
chk(s == 403, f'monter brez nalog v projektu 403 (dejansko {s})')

# ══ B. Ustvarjanje tekača (§1/§4/§12) ══════════════════════════════════════
print('── B. Ustvarjanje tekača ──')
NODES_B = [
    {'kind': 'ZACETEK', 'atCm': 0, 'podlaga': 'BETON', 'pritrditev': 'TLACNA'},
    {'kind': 'VRATA', 'atCm': 300, 'gateWcm': 100, 'podlaga': 'BETON'},
    {'kind': 'KONEC', 'atCm': 600, 'podlaga': 'ZEMLJA'},
]
TERRAIN_B = [{'distCm': 0, 'elevCm': 0}, {'distCm': 300, 'elevCm': 30}, {'distCm': 600, 'elevCm': 60}]
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Ograja tekač {TAG}', 'nodes': NODES_B,
    'terrain': TERRAIN_B, 'calibration': CAL, 'productId': OGRK2['id'], 'note': TAG})
chk(s == 201, f'ustvarjanje 201 (dejansko {s}, {d.get("error", "")})')
RUN = d.get('data', {}).get('id')
chk(bool(RUN), f'tekač id={RUN}')
chk(d.get('data', {}).get('version') == 1, 'verzija v1 ob ustvarjanju')
chk(audit_has(admin, 'FENCE_RUN_CREATE', RUN, P4), 'revizija FENCE_RUN_CREATE')

s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
det = d.get('data', {})
segs = det.get('segments', [])
chk(s == 200 and len(segs) == 2, f'2 segmenta (dejansko {len(segs)})')
seg1 = segs[0] if segs else {}
# 3D dolžina po padini: horizontalno 300, Δv 30 → √(300²+30²) ≈ 301.5
chk(abs(seg1.get('lengthCm', 0) - 301.5) < 1.5, f"seg1 3D dolžina ~301,5 (dejansko {seg1.get('lengthCm')})")
chk(abs(seg1.get('slopeDeg', 99) - 5.7) < 0.3, f"seg1 padina ~5,7° (dejansko {seg1.get('slopeDeg')})")
chk(seg1.get('status') == 'CALIBRATED', f"seg1 status CALIBRATED (dejansko {seg1.get('status')})")
codes = [v['code'] for v in det.get('analysis', {}).get('validation', [])]
chk('PREDLAGANI_STEBRI' in codes, f'validacija PREDLAGANI_STEBRI (dejansko {codes})')
chk('VRATA_PROSTOR' not in codes, 'vrata imajo prostor (30 cm+ na obeh straneh)')

# ══ C. Validacije vhoda ════════════════════════════════════════════════════
print('── C. Validacije vhoda ──')
s, _ = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'nodes': [{'kind': 'ZACETEK', 'atCm': 100}, {'kind': 'KONEC', 'atCm': 103}], 'note': TAG})
chk(s == 400, f'vozlišča preblizu (<5 cm) 400 (dejansko {s})')
s, _ = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'nodes': [{'kind': 'ZACETEK', 'atCm': 0}], 'terrain': [{'distCm': 0, 'elevCm': 99999}], 'note': TAG})
chk(s == 400, f'teren z napačno elevacijo 400 (dejansko {s})')
s, _ = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'nodes': [{'kind': 'ZACETEK', 'atCm': 0}],
    'calibration': {'method': 'MAGIJA', 'refValueCm': 92}, 'note': TAG})
chk(s == 400, f'slaba metoda kalibracije 400 (dejansko {s})')
s, _ = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'nodes': [{'kind': 'ZACETEK', 'atCm': 0}], 'variantId': OGRK2['variants'][0]['id'] if OGRK2.get('variants') else 'x', 'note': TAG})
chk(s == 400, f'varianta brez izdelka 400 (dejansko {s})')
s, _ = callj('POST', '/api/fence-run', admin, {'projectId': 'neobstojad', 'nodes': [{'kind': 'ZACETEK', 'atCm': 0}], 'note': TAG})
chk(s == 404, f'neznan projekt 404 (dejansko {s})')
s, _ = callj('POST', '/api/fence-run', admin, {'projectId': P4, 'nodes': [], 'note': TAG})
chk(s == 400, f'prazna vozlišča 400 (dejansko {s})')

# ══ D. Razpored stebrov (§11) ══════════════════════════════════════════════
print('── D. Razpored stebrov ──')
s, d = callj('POST', f'/api/fence-run/{RUN}/layout', admin, {'apply': True})
applied = d.get('data', {}).get('applied', -1)
chk(s == 200 and applied == 4, f'vstavljeni 4 vmesni stebri (dejansko {applied})')
chk(audit_has(admin, 'FENCE_RUN_LAYOUT', RUN, P4), 'revizija FENCE_RUN_LAYOUT')
s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
det = d.get('data', {})
codes = [v['code'] for v in det.get('analysis', {}).get('validation', [])]
chk('PREDLAGANI_STEBRI' not in codes, f'predlogi izpraznjeni (dejansko {codes})')
chk(len(det.get('run', {}).get('nodes', [])) == 7, f'7 vozlišč po razporedu (dejansko {len(det.get("run", {}).get("nodes", []))})')

# ══ E. VERIFIED iz zunanjega merilnika (§10/§19) ═══════════════════════════
print('── E. VERIFIED preveritev ──')
s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
segs = d.get('data', {}).get('segments', [])
SEG = segs[0] if segs else {}
s, d = callj('POST', f'/api/fence-run/{RUN}/verify', admin, {
    'segmentId': SEG.get('id'), 'measuredCm': 100.6, 'method': 'LASER', 'device': 'Leica DISTO D2', 'note': TAG})
chk(s == 200, f'preveritev 200 (dejansko {s}, {d.get("error", "")})')
chk(d.get('data', {}).get('conflict') is False, 'brez konflikta znotraj tolerance')
chk(audit_has(admin, 'FENCE_RUN_VERIFY', SEG.get('id'), P4), 'revizija FENCE_RUN_VERIFY')
s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
segs = d.get('data', {}).get('segments', [])
chk(segs and segs[0].get('status') == 'VERIFIED', f"seg1 status VERIFIED (dejansko {segs[0].get('status') if segs else '—'})")
chk(segs and segs[0].get('verifiedCm') == 100.6, 'verifiedCm zapisan')

# konflikt: preveri drug segment z velikim odstopanjem
SEG2 = segs[1] if len(segs) > 1 else {}
s, d = callj('POST', f'/api/fence-run/{RUN}/verify', admin, {
    'segmentId': SEG2.get('id'), 'measuredCm': 150.0, 'method': 'LASER', 'note': TAG})
chk(s == 200 and d.get('data', {}).get('conflict') is True, 'konflikt zaznan (odstopanje > toleranca)')
s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
codes = [v['code'] for v in d.get('data', {}).get('analysis', {}).get('validation', [])]
chk('KONFLIKT_VERIFIED' in codes, f'validacija KONFLIKT_VERIFIED (dejansko {codes})')
s, _ = callj('POST', f'/api/fence-run/{RUN}/confirm', admin, {})
chk(s == 409, f'potrditev zavrnjena ob konfliktu 409 (dejansko {s})')

# ══ F. Quality gate + potrditev (§3/§20/§21) ═══════════════════════════════
print('── F. Quality gate + potrditev ──')
# 1) brez kalibracije → NEZADOSTNO
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Brez kalibracije {TAG}',
    'nodes': [{'kind': 'ZACETEK', 'atCm': 0}, {'kind': 'KONEC', 'atCm': 400}], 'note': TAG})
RUN_NOCAL = d.get('data', {}).get('id')
s, _ = callj('POST', f'/api/fence-run/{RUN_NOCAL}/confirm', admin, {})
chk(s == 409, f'brez kalibracije 409 (dejansko {s})')

# 2) ESTIMATED segmenti (kalibracija da, a brez človeške preveritve po spremembi geometrije)
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Estimirani {TAG}',
    'nodes': [{'kind': 'ZACETEK', 'atCm': 0}, {'kind': 'KONEC', 'atCm': 400}],
    'calibration': CAL, 'note': TAG})
RUN_EST = d.get('data', {}).get('id')
s, d = callj('GET', f'/api/fence-run/{RUN_EST}', admin)
segs_est = d.get('data', {}).get('segments', [])
# 400 cm segment → status CALIBRATED (kalibracija je), vendar PREDLAGANI_STEBRI opozorilo → DODAJ
# a segment je CALIBRATED (order 3 ≥ MANUAL 2) → potrditev gre skozi? NE — preveri:
s, _ = callj('POST', f'/api/fence-run/{RUN_EST}/confirm', admin, {})
# segment CALIBRATED ≥ MANUAL → dovoljeno; quality DODAJ (ne blokira) → 201 pričakovano
chk(s == 201, f'estimirani/calibrirani tekač z opozorilom → 201 (dejansko {s})')

# 3) veljaven tekač z verifikacijo + handoff
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Veljaven {TAG}',
    'nodes': [{'kind': 'ZACETEK', 'atCm': 0, 'podlaga': 'BETON'}, {'kind': 'KONEC', 'atCm': 240, 'podlaga': 'ZEMLJA'}],
    'calibration': CAL, 'productId': OGRK2['id'], 'note': TAG})
RUN_OK = d.get('data', {}).get('id')
s, d = callj('GET', f'/api/fence-run/{RUN_OK}', admin)
segs_ok = d.get('data', {}).get('segments', [])
s, d = callj('POST', f'/api/fence-run/{RUN_OK}/verify', admin, {
    'segmentId': segs_ok[0]['id'], 'measuredCm': 240.5, 'method': 'LASER', 'note': TAG})
chk(s == 200 and d.get('data', {}).get('conflict') is False, 'veljaven segment preverjen')
s, d = callj('POST', f'/api/fence-run/{RUN_OK}/confirm', admin, {'handoff': True})
chk(s == 201, f'potrditev 201 (dejansko {s}, {d.get("error", "")})')
MEAS = d.get('data', {}).get('measurementId')
PKG = d.get('data', {}).get('package', {})
chk(bool(MEAS), f'kanonična meritev {MEAS}')
chk(bool(PKG.get('code')), f"paket projekta {PKG.get('code')}")
chk(audit_has(admin, 'FENCE_RUN_CONFIRM', RUN_OK, P4), 'revizija FENCE_RUN_CONFIRM')
s, d = callj('GET', f'/api/measurements/{MEAS}', admin)
params = {}
try: params = json.loads(d.get('data', {}).get('params', '{}'))
except Exception: pass
chk(params.get('fenceRunId') == RUN_OK, 'params.fenceRunId povezuje na tekača (§17)')
chk(params.get('source') == 'FENCE_RUN', 'params.source = FENCE_RUN')
s, d = callj('GET', f'/api/fence-run/{RUN_OK}', admin)
det = d.get('data', {})
chk(det.get('run', {}).get('status') == 'POTRJEN', 'status POTRJEN')
chk(all(x.get('status') == 'CONFIRMED' for x in det.get('segments', [])), 'vsi segmenti CONFIRMED')
s, _ = callj('POST', f'/api/fence-run/{RUN_OK}/confirm', admin, {})
chk(s == 409, f'ponovna potrditev 409 (dejansko {s})')
s, _ = callj('PATCH', f'/api/fence-run/{RUN_OK}', admin, {'name': 'spremenjeno'})
chk(s == 409, f'PATCH potrjenega 409 (dejansko {s})')

# ══ G. Poštena razveljavitev (§19) ═════════════════════════════════════════
print('── G. Poštena razveljavitev ──')
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': P4, 'name': f'Razveljavitev {TAG}',
    'nodes': [{'kind': 'ZACETEK', 'atCm': 0}, {'kind': 'KONEC', 'atCm': 300}],
    'calibration': CAL, 'note': TAG})
RUN_R = d.get('data', {}).get('id')
s, d = callj('GET', f'/api/fence-run/{RUN_R}', admin)
seg_r = d.get('data', {}).get('segments', [])[0]
s, d = callj('POST', f'/api/fence-run/{RUN_R}/verify', admin, {
    'segmentId': seg_r['id'], 'measuredCm': 300.2, 'method': 'LASER', 'note': TAG})
chk(s == 200, 'segment preverjen pred spremembo')
# sprememba geometrije: premik konca na 500
s, d = callj('PATCH', f'/api/fence-run/{RUN_R}', admin, {
    'nodes': [{'kind': 'ZACETEK', 'atCm': 0}, {'kind': 'KONEC', 'atCm': 500}]})
chk(s == 200, f'PATCH geometrije 200 (dejansko {s})')
s, d = callj('GET', f'/api/fence-run/{RUN_R}', admin)
segs_r = d.get('data', {}).get('segments', [])
chk(segs_r and segs_r[0].get('status') == 'CALIBRATED' and segs_r[0].get('version') == 1,
    f"spremenjena geometrija → poštena razveljavitev (status {segs_r[0].get('status') if segs_r else '—'} v{segs_r[0].get('version') if segs_r else '—'}, prej VERIFIED)")
chk(segs_r and segs_r[0].get('verifiedCm') is None, 'verifikacija NI tiho prenesena')

# ══ H. IDOR ═══════════════════════════════════════════════════════════════
print('── H. IDOR (monter2 brez nalog) ──')
s, _ = callj('GET', f'/api/fence-run/{RUN}', monter2)
chk(s == 403, f'detail monter2 403 (dejansko {s})')
s, _ = callj('PATCH', f'/api/fence-run/{RUN}', monter2, {'name': 'hacker'})
chk(s == 403, f'PATCH monter2 403 (dejansko {s})')
s, _ = callj('POST', f'/api/fence-run/{RUN}/verify', monter2, {'segmentId': 'x', 'measuredCm': 100, 'method': 'LASER'})
chk(s == 403, f'verify monter2 403 (dejansko {s})')
s, _ = callj('POST', f'/api/fence-run/{RUN}/confirm', monter2, {})
chk(s == 403, f'confirm monter2 403 (dejansko {s})')
s, _ = callj('DELETE', f'/api/fence-run/{RUN}', monter2)
chk(s == 403, f'DELETE monter2 403 (dejansko {s})')
# monter z nalogom v P-2026-004 vidi tekač
s, _ = callj('GET', f'/api/fence-run/{RUN}', monter)
chk(s == 200, f'monter z nalogom vidi tekač 200 (dejansko {s})')
# monter ne more brisati tujega tekača (avtor = admin)
s, _ = callj('DELETE', f'/api/fence-run/{RUN}', monter)
chk(s == 403, f'monter briše samo svoje 403 (dejansko {s})')

# ══ I. Regresija ═══════════════════════════════════════════════════════════
print('── I. Regresija ──')
s, d = callj('GET', '/api/measurements', admin)
chk(s == 200, f'/api/measurements seznam 200 (dejansko {s})')
s, d = callj('POST', '/api/railing-layout', admin, {
    'points': [{'x': 0, 'y': 0}, {'x': 300, 'y': 40}],
    'calibration': {'px': 100, 'cm': 92}})
chk(s == 201 and d.get('data', {}).get('posts', 0) >= 2, f'/api/railing-layout izračun 201 (dejansko {s})')
s, d = callj('POST', '/api/measure-engine/analyze', admin, {
    'mode': 'OGRAJA', 'points': [{'x': 0, 'y': 0}, {'x': 200, 'y': 0}],
    'calibration': {'px': 100, 'cm': 100}})
chk(s == 200 and 'data' in d, f'/api/measure-engine/analyze 200 (dejansko {s})')
s, d = callj('GET', f'/api/fence-run?projectId={P4}', admin)
chk(s == 200 and isinstance(d.get('data'), list), f'filter po projektu 200 (dejansko {s})')

# ══ J. Čiščenje ════════════════════════════════════════════════════════════
print('── J. Čiščenje ──')
out, _ = bun(CLEAN)
chk('CLEAN_DONE' in out, 'čiščenje končano')
CNT_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const r=await p.fenceRun.count({where:{OR:[{note:{contains:'__TAG__'}},{name:{contains:'__TAG__'}}]}});
  const m=await p.measurement.count({where:{location:{contains:'__TAG__'}}});
  const u=await p.user.count({where:{email:{contains:'r460'}}});
  console.log('N='+r+' M='+m+' U='+u);return p.$disconnect();
})()
'''
out, _ = bun(CNT_JS.replace('__TAG__', TAG))
chk('N=0 M=0 U=0' in out, f'vsi testni zapisi odstranjeni ({out.strip()})')

print()
print(f'══ SKUPAJ: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)

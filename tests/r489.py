#!/usr/bin/env python3
"""tests/r489.py — R489 (GitHub issue #12 — MONTAŽA QA & PRIMOPREDAJA):
kontrolne točke (statusni stroj, podatkovno vodene iz virov), odstopanja,
korektivni ukrepi, BLOKADA zaključka (obe poti: transition + sync), verzionirano
primopredajno poročilo (primerjava načrtovano/izvedeno, fotografije, podpisa)
in PDF izvoz.

Preverja:
  A) Priprava: projekt + tekač (4×250 cm, POTRJEN s handoffom) + nalogi.
  B) PREDLOGA: POST /qa iz virov (playbook MONTAZA + segmenti tekača +
     pravila); snapshot templateVersion; ponovni POST 409; force (vse
     NI_ZACETO) regenerira; IDOR monter2 403.
  C) STATUSNI PREHODI: dovoljeni 200; nedovoljeni 409; NI_RELEVANTNO brez
     razloga 400; NAPAKA brez razloga 400; neveljaven photoId 400; revizija
     MONTAZA_CHECK_STATUS.
  D) NAPAKA → ODSTOPANJE → UKREP: samodejno odstopanje (impactSafety iz
     critical), dogodek TEZAVA, reviziji; ukrep z odgovorno osebo + rokom;
     linearni tok ODPRTO→V_OBRAVNAVI→ODRAVLJENO→PREVERJENO; preskok 409.
  E) BLOKADA ZAKLJUČKA: V_PREVERI→ZAKLJUCEN 409 z imenom točke; sync
     nalog-zakljucek CONFLICT; monter force CONFLICT; admin force brez
     razloga 400; admin force + razlog 200 + revizija WO_ZAKLJUCEK_OVERRIDE.
  F) PRIMOPREDAJA: v1 NEPOPOLNA (kritično odprto); podpis ne more
     'popolniti' kritične zadeve; po odpravi v2 + monter + stranka →
     ZAKLJUCENA; odprto nekritično → POGOJNA; verzije + zgodovina;
     diffJson seg-1..seg-4 iz tekača.
  G) PDF: /api/pdf/handover/[id] → %PDF + revizija DOC_GENERATE.
  H) RBAC/IDOR: skladišče/proizvodnja 403 na mutacijah; monter vidi svoj
     nalog 200; monter2 403; brez žetona 401.
  I) SYNC montaza-check: offline op OK; isti opId 2× → ena sprememba
     (idempotenca); nalog-zakljucek z blokado → CONFLICT.
  J) Regresija + idempotentno čiščenje ×2.
"""
import json, math, os, subprocess, sys, tempfile, urllib.request, urllib.error, uuid

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R489-MQ'
RUNUID = uuid.uuid4().hex[:8]  # unikatni opId-ji na zagon (SyncOp idempotenca preživi poganje!)
PASS, FAIL = 0, 0

def callj (method, path, token=None, body=None, timeout=60):
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

def callraw (method, path, token=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)
    except Exception as e:
        return 0, str(e).encode(), {}

def hdr (headers, name):
    for k, v in headers.items():
        if k.lower() == name.lower(): return v
    return ''

def login (email, pw):
    s, d = callj('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun (script):
    env_url = os.environ.get('DATABASE_URL') or ''
    if not env_url.startswith(('postgresql://', 'postgres://')):
        env_url = ''
    db_url = os.environ.get('TEST_DB_URL') or env_url or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO, env={**os.environ, 'DATABASE_URL': db_url})
    return r.stdout, r.stderr[:500]

def bun_out (script, marker='JSON='):
    out, err = bun(script)
    try:
        for line in out.splitlines():
            if line.startswith(marker):
                return json.loads(line[len(marker):])
    except Exception:
        pass
    return {'_err': (err or out[:400])}

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

def src_has (relpath, needle):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return needle in f.read()
    except Exception:
        return False

# ═══════════════════════════════ TEST ═══════════════════════════════════════

print('══ R489 — MONTAŽA QA & PRIMOPREDAJA: točke → odstopanja → ukrepi → '
      'blokada → primopredaja → PDF ══')

CLEAN_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const proj=await p.project.findMany({where:{title:{contains:'__TAG__'}}});
  for(const pr of proj){
    const runs=await p.fenceRun.findMany({where:{projectId:pr.id}});
    for(const r of runs){
      if(r.measurementId){
        await p.projectPackage.updateMany({where:{measurementId:r.measurementId},data:{measurementId:null}});
        await p.measurementVersion.deleteMany({where:{measurementId:r.measurementId}});
        await p.measurement.deleteMany({where:{id:r.measurementId}});
      }
      await p.fenceRunVersion.deleteMany({where:{fenceRunId:r.id}});
      await p.fenceRun.delete({where:{id:r.id}});
    }
    const pkgs=await p.projectPackage.findMany({where:{projectId:pr.id}});
    for(const k of pkgs){
      await p.bomLine.deleteMany({where:{bom:{packageId:k.id}}});
      await p.bom.deleteMany({where:{packageId:k.id}});
      await p.projectPackage.delete({where:{id:k.id}});
    }
    await p.digitalTwinSnapshot.deleteMany({where:{projectId:pr.id}});
    // R489: QA + primopredaja kaskadno prek nalogov
    await p.handoverReport.deleteMany({where:{workOrder:{projectId:pr.id}}});
    await p.workOrder.deleteMany({where:{projectId:pr.id}});
    await p.notificationEvent.deleteMany({where:{projectId:pr.id}});
    await p.measurement.deleteMany({where:{projectId:pr.id}});
    await p.project.delete({where:{id:pr.id}});
  }
  await p.user.deleteMany({where:{email:{contains:'r489'}}});
  // R542: detail je jsonb — podniz po serializiranem jsonb (ista semantika contains)
  await p.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE "detail"::text LIKE $1', '%' + '__TAG__' + '%');
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG)
out, _ = bun(CLEAN)
chk('CLEAN_DONE' in out, 'predčiščenje testnih zapisov')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
sklad = login('skladisce@roksal.si', 'Skladisce123!')
proizv = login('proizvodnja@roksal.si', 'Proizvodnja123!')
ok('prijava admin + monter + skladišče + proizvodnja')

M2_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const crypto=require('crypto');
  const salt=crypto.randomUUID().replace(/-/g,'');
  const hash=crypto.scryptSync('Monter123!',salt,64).toString('hex');
  const u=await p.user.upsert({where:{email:'monter2-r489@roksal.si'},update:{},create:{
    email:'monter2-r489@roksal.si',name:'Monter2 R489',role:'MONTER',
    passwordHash:salt+':'+hash,active:true}});
  const m=await p.user.findUnique({where:{email:'monter@roksal.si'}});
  console.log('M2='+u.id);console.log('MONTER='+m.id);return p.$disconnect();
})()
'''
out, _ = bun(M2_JS)
chk('M2=' in out and 'MONTER=' in out, 'monter2 (brez naloga) + id monterja')
monter2 = login('monter2-r489@roksal.si', 'Monter123!')
M2ID = next((l.split('=')[1] for l in out.splitlines() if l.startswith('M2=')), '')
MONTERID = next((l.split('=')[1] for l in out.splitlines() if l.startswith('MONTER=')), '')

# ══ A. PRIPRAVA ═════════════════════════════════════════════════════════════
print('── A) Priprava: projekt + tekač (POTRJEN, 4×250) + nalogi ──')
s, d = callj('POST', '/api/projects', admin, {'title': f'QA montaže {TAG}', 'address': 'Testna cesta 89'})
chk(s == 201, f'nov projekt 201 ({s})')
PROJ = d.get('data', {}).get('id')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p2['sku']: p2 for p2 in d.get('data', [])}
PROD = PRODUCTS.get('OGR-P-001')
VARIANT = next((v for v in (PROD or {}).get('variants', []) if v['sku'] == 'OGR-P-001-ANT'), None)
chk(bool(PROD) and bool(VARIANT), 'izdelek OGR-P-001 + varianta Antracit')

NODES = [
    {'kind': 'ZACETEK', 'atCm': 0, 'podlaga': 'BETON', 'heightCm': 110},
    {'kind': 'STEBER', 'atCm': 250, 'podlaga': 'BETON'},
    {'kind': 'VOGAL', 'atCm': 500, 'podlaga': 'ZEMLJA', 'interiorDeg': 90, 'manual': True},
    {'kind': 'VRATA', 'atCm': 750, 'podlaga': 'BETON', 'gateWcm': 100, 'manual': True},
    {'kind': 'KONEC', 'atCm': 1000, 'podlaga': 'ZEMLJA'},
]
TERRAIN = [{'distCm': 0, 'elevCm': 0}, {'distCm': 1000, 'elevCm': 0}]
CAL = {'method': 'ZNANA_MERA', 'refValueCm': 200, 'refObject': 'vhodna plošča'}
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': PROJ, 'name': f'QA tekač {TAG}', 'productId': PROD['id'],
    'variantId': VARIANT['id'], 'nodes': NODES, 'terrain': TERRAIN,
    'calibration': CAL, 'note': TAG})
chk(s == 201, f'tekač ustvarjen 201 ({s})')
RUN = d.get('data', {}).get('id')

s, d = callj('POST', f'/api/fence-run/{RUN}/verify', admin, {
    'segmentId': callj('GET', f'/api/fence-run/{RUN}', admin)[1].get('data', {}).get('segments', [{}])[0].get('id'),
    'measuredCm': 250.4, 'method': 'LASER', 'note': TAG})

s, d = callj('POST', f'/api/fence-run/{RUN}/confirm', admin, {'handoff': True})
chk(s == 201, f'confirm handoff 201 ({s})')
MEAS = d.get('data', {}).get('measurementId')
chk(bool(MEAS), 'kanonična meritev iz tekača')

# nalog A (glavni) dodeljen monterju
s, d = callj('POST', '/api/nalog', admin, {
    'title': f'QA montaža A {TAG}', 'projectId': PROJ, 'assigneeId': MONTERID,
    'instructions': 'Izvedi montažo po načrtu.'})
chk(s == 201, f'nalog A ustvarjen 201 ({s})')
WO = d.get('data', {}).get('id')
chk(bool(WO), f'nalog A id')

# FOTO meritev na nalogu A (dokazilo + fotografija primopredaje)
s, d = callj('POST', '/api/measure/photo', admin, {
    'projectId': PROJ, 'workOrderId': WO,
    'dataUrl': 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAAKAAsBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AIgA/9k='})
chk(s in (200, 201), f'FOTO meritev naložena na nalog ({s})')
FOTO = d.get('data', {}).get('id')
chk(bool(FOTO), 'FOTO meritev vezana na nalog A')

s, d = callj('POST', f'/api/nalog/{WO}/transition', monter, {'to': 'V_TEKU'})
chk(s == 200, 'nalog A → V_TEKU (monter, svoj nalog)')

# ══ B. PREDLOGA (podatkovno vodene točke) ════════════════════════════════════
print('── B) Priprava kontrolnih točk IZ VIROV ──')
s, d = callj('POST', f'/api/nalog/{WO}/qa', monter, {})
chk(s == 201, f'POST /qa 201 ({s}, {d.get("error","")})')
viri = d.get('data', {}).get('viri', {})
chk(viri.get('playbook', {}).get('key') == 'MONTAZA' and viri.get('segmenti') == 4,
    f"viri: playbook MONTAZA + 4 segmenti tekača ({viri.get('playbook')} / {viri.get('segmenti')})")

s, d = callj('GET', f'/api/nalog/{WO}/qa', monter)
checks = d.get('data', {}).get('checks', [])
chk(s == 200 and len(checks) > 10, f'GET /qa: {len(checks)} točk')
crit = [c for c in checks if c.get('critical')]
chk(len(crit) >= 4, f'kritične točke prisotne ({len(crit)}: varnost/kontrola/pravila)')
seg_checks = [c for c in checks if c.get('targetKey', '') in ('seg-1', 'seg-2', 'seg-3', 'seg-4')]
chk(len(seg_checks) == 4, f'4 segmentne točke seg-1..seg-4 ({len(seg_checks)})')
rule_checks = [c for c in checks if c.get('templateKey', '').startswith('rule:')]
chk(len(rule_checks) >= 1, f'točke iz inženirskih pravil ({len(rule_checks)})')
chk(all(c.get('templateVersion') == 1 for c in checks), 'vse točke nosijo templateVersion snapshot (§3)')
seg1 = next((c for c in seg_checks if c['targetKey'] == 'seg-1'), None)
chk(seg1 and '250 cm' in seg1['label'], f"segmentna točka nosi dolžino iz tekača («{seg1['label'][:60]}»)")

# ponovni POST → 409 (zgodovina se ne prepiše)
s, d = callj('POST', f'/api/nalog/{WO}/qa', monter, {})
chk(s == 409, f'ponovni POST /qa → 409 ({s})')

# force, ko je NOBENA točka obdelana → regeneracija brez izgube
s, d = callj('POST', f'/api/nalog/{WO}/qa', monter, {'force': True})
chk(s == 201, f'force regeneracija (vse NI_ZACETO) → 201 ({s})')

# IDOR: monter2 brez naloga
s, d = callj('POST', f'/api/nalog/{WO}/qa', monter2, {})
chk(s == 403, f'monter2 POST /qa na tuj nalog → 403 ({s})')
s, d = callj('GET', f'/api/nalog/{WO}/qa', monter2)
chk(s == 403, f'monter2 GET /qa na tuj nalog → 403 ({s})')
chk(audit_has(admin, 'MONTAZA_TEMPLATE_APPLY', WO, PROJ), 'revizija MONTAZA_TEMPLATE_APPLY')

# ══ C. STATUSNI PREHODI ═════════════════════════════════════════════════════
print('── C) Statusni prehodi točk ──')
checks = callj('GET', f'/api/nalog/{WO}/qa', monter)[1].get('data', {}).get('checks', [])
c_varnost = next((c for c in checks if c.get('stepId') == 'varnost'), checks[0])
c_seg1 = next((c for c in checks if c.get('targetKey') == 'seg-1'), checks[1])

s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'V_REDU'})
chk(s == 200 and d.get('data', {}).get('status') == 'V_REDU', f'seg-1 → V_REDU 200 ({s})')

# nedovoljen prehod V_REDU → NI_ZACETO
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'NI_ZACETO'})
chk(s == 409, f'V_REDU → NI_ZACETO zavrnjen 409 ({s})')

# NI_RELEVANTNO brez razloga → 400
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'NI_RELEVANTNO'})
chk(s == 400, f'NI_RELEVANTNO brez opombe → 400 ({s})')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'NI_RELEVANTNO', 'note': 'brez tega segmenta v tej izvedbi'})
chk(s == 200, f'NI_RELEVANTNO z razlogom 200 ({s})')

# ponovna odprta → NI_ZACETO
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'NI_ZACETO'})
chk(s == 200, f'NI_RELEVANTNO → NI_ZACETO (ponovna odprta) 200 ({s})')

# neveljaven photoId → 400 (dokazila ne izmišljujemo)
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'V_REDU', 'photoId': 'neobstojeci'})
chk(s == 400, f'neveljaven photoId → 400 ({s})')

# veljaven photoId (FOTO meritev) → 200 + dokaz ostane po osvežitvi
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'V_REDU', 'photoId': FOTO})
chk(s == 200, f'veljaven photoId → 200 ({s})')
s, d = callj('GET', f'/api/nalog/{WO}/qa', monter)
c_seg1b = next((c for c in d.get('data', {}).get('checks', []) if c['id'] == c_seg1['id']), {})
chk(c_seg1b.get('photoId') == FOTO, 'dokazna fotografija ostane pripeta po osvežitvi')
chk(c_seg1b.get('checkedBy', {}).get('name'), f"zapisan preverilavec ({c_seg1b.get('checkedBy', {}).get('name')})")
chk(audit_has(admin, 'MONTAZA_CHECK_STATUS', c_seg1['id'], PROJ), 'revizija MONTAZA_CHECK_STATUS')

# ══ D. NAPAKA → ODSTOPANJE → UKREP ══════════════════════════════════════════
print('── D) Napaka → odstopanje → korektivni ukrep ──')
# NAPAKA brez razloga → 400
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'NAPAKA'})
chk(s == 400, f'NAPAKA brez razloga → 400 ({s})')

# NAPAKA z razlogom na NEkritični točki (seg-1) — impactSafety izrecno
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {
    'checkId': c_seg1['id'], 'status': 'NAPAKA',
    'deviationReason': 'Pritrditev na seg-1 je zarohnjena — vpliva na varnost',
    'deviationLocation': 'vogal pri vhodu', 'deviationTargetKey': 'seg-1',
    'deviationImpactSafety': True})
chk(s == 200, f'NAPAKA z razlogom 200 ({s})')
qa = callj('GET', f'/api/nalog/{WO}/qa', monter)[1].get('data', {})
c_seg1c = next((c for c in qa.get('checks', []) if c['id'] == c_seg1['id']), {})
devs = c_seg1c.get('deviations', [])
chk(len(devs) == 1, f'samodejno ustvarjeno odstopanje na točki ({len(devs)})')
DEV = devs[0] if devs else {}
chk(DEV.get('impactSafety') is True and DEV.get('resolvedAt') is None, 'odstopanje: impactSafety, nerešeno')
chk(DEV.get('targetKey') == 'seg-1' and DEV.get('location') == 'vogal pri vhodu', 'lokacija/segment prenešena')
chk(audit_has(admin, 'MONTAZA_DEVIATION_CREATE', DEV.get('id'), PROJ), 'revizija MONTAZA_DEVIATION_CREATE (avto)')

# dogodek TEZAVA na nalogu (viden v časovnici)
wo_events = callj('GET', f'/api/nalog/{WO}', monter)[1].get('data', {}).get('events', [])
chk(any(e.get('type') == 'TEZAVA' and 'seg-1' in (e.get('note') or '') for e in wo_events),
    'dogodek TEZAVA zapisan na nalogu (kritična/varnostna napaka)')

# korektivni ukrep z odgovorno osebo + rokom
s, d = callj('POST', f'/api/nalog/{WO}/qa/action', monter, {
    'deviationId': DEV['id'], 'description': 'Zamenjaj pritrditev in privij novo',
    'assigneeId': MONTERID, 'dueAt': '2026-10-20T08:00:00.000Z'})
chk(s == 201, f'ukrep ustvarjen 201 ({s})')
ACT = d.get('data', {})
chk(ACT.get('status') == 'ODPRTO' and ACT.get('assignee', {}).get('name'), f"ukrep ODPRTO z odgovorno osebo ({ACT.get('assignee')})")
chk(audit_has(admin, 'MONTAZA_ACTION_CREATE', ACT.get('id'), PROJ), 'revizija MONTAZA_ACTION_CREATE')

# linearni tok: ODPRTO → V_OBRAVNAVI → ODRAVLJENO → PREVERJENO; preskok 409
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/action', monter, {'id': ACT['id'], 'status': 'PREVERJENO'})
chk(s == 409, f'preskok ODPRTO → PREVERJENO zavrnjen 409 ({s})')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/action', monter, {'id': ACT['id'], 'status': 'V_OBRAVNAVI'})
chk(s == 200, f'ukrep → V_OBRAVNAVI 200 ({s})')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/action', monter, {'id': ACT['id'], 'status': 'V_OBRAVNAVI'})
chk(s == 409, f'ponovni isti status zavrnjen 409 ({s})')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/action', monter, {'id': ACT['id'], 'status': 'ODRAVLJENO'})
chk(s == 200 and d.get('data', {}).get('completedAt'), 'ukrep → ODRAVLJENO (completedAt zapisan)')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/action', monter, {'id': ACT['id'], 'status': 'PREVERJENO'})
chk(s == 200 and d.get('data', {}).get('verifiedAt'), 'ukrep → PREVERJENO (verifiedAt/By zapisan)')
chk(audit_has(admin, 'MONTAZA_ACTION_STATUS', ACT.get('id'), PROJ), 'revizija MONTAZA_ACTION_STATUS')

# odprava odstopanja (ukrep PREVERJENO, vpliv odpravljen)
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/deviation', monter, {'id': DEV['id']})
chk(s == 200 and d.get('data', {}).get('resolvedAt'), 'odstopanje odpravljeno (resolvedAt/By)')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/deviation', monter, {'id': DEV['id']})
chk(s == 409, f'ponovna odprava zavrnjena 409 ({s})')

# odprava napake na točki: NAPAKA → CAKA_PREVERJANJE → V_REDU (z resolutionNote)
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'V_REDU'})
chk(s == 400, f'odprava brez resolutionNote → 400 ({s})')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'CAKA_PREVERJANJE'})
chk(s == 200, 'NAPAKA → CAKA_PREVERJANJE 200')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_seg1['id'], 'status': 'V_REDU', 'resolutionNote': 'Pritrditev zamenjana, kontrola po merilu OK'})
chk(s == 200 and d.get('data', {}).get('resolutionNote'), 'CAKA → V_REDU z opombo rešitve')

# ročno odstopanje (izvedba ≠ načrt) brez povezane točke
s, d = callj('POST', f'/api/nalog/{WO}/qa/deviation', monter, {
    'reason': 'Stranka je zahtevala premik zgornje letve za 2 cm',
    'location': 'celotna ograja', 'impactPrice': True})
chk(s == 201, f'ročno odstopanje 201 ({s})')
DEV2 = d.get('data', {})
chk(DEV2.get('impactPrice') is True and not DEV2.get('checkId'), 'ročno odstopanje: impactPrice, brez točke')
s, d = callj('POST', f'/api/nalog/{WO}/qa/deviation', monter, {'reason': 'x'})
chk(s == 400, f'odstopanje brez smiselnega razloga → 400 ({s})')

# ══ E1. BLOKADA ZAKLJUČKA ═══════════════════════════════════════════════════
print('── E1) Blokada zaključka (kritična nerešena napaka) ──')
# kritična napaka na varnostni točki
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {
    'checkId': c_varnost['id'], 'status': 'NAPAKA',
    'deviationReason': 'Delovno mesto ni zavarovano — nadaljevanje nevarno'})
chk(s == 200, f'kritična NAPAKA na varnosti 200 ({s})')

s, d = callj('POST', f'/api/nalog/{WO}/transition', monter, {'to': 'V_PREVERI'})
chk(s == 200, 'nalog A → V_PREVERI')

s, d = callj('POST', f'/api/nalog/{WO}/transition', monter, {'to': 'ZAKLJUCEN'})
chk(s == 409 and 'blokiran' in (d.get('error', '') + d.get('detail', '')),
    f'zaključek BLOKIRAN 409 ({s}: {d.get("error", "")[:70]})')
chk(c_varnost['label'][:30] in (d.get('detail', '') + d.get('error', '')),
    'razlog blokade vsebuje ime kritične točke')

# sync pot — ISTA blokada (offline zaključek ne sme obiti varovala)
opid1 = f'r489-sync-block-{RUNUID}-1'
s, d = callj('POST', '/api/sync', monter, {'deviceId': 'r489dev', 'ops': [
    {'opId': opid1, 'kind': 'nalog-zakljucek', 'payload': {'workOrderId': WO, 'summary': f'konec {TAG}'}}]})
res1 = (d.get('data', {}).get('results', [{}])[0] if s == 200 else {})
chk(s == 200 and res1.get('status') == 'CONFLICT', f"sync nalog-zakljucek → CONFLICT ({res1.get('status')})")

# monter NE more forsirati
s, d = callj('POST', f'/api/nalog/{WO}/transition', monter, {'to': 'ZAKLJUCEN', 'force': True, 'forceReason': 'test'})
chk(s == 409, f'monter force → 409 (ni vodstvo) ({s})')

# admin force brez razloga → 400
s, d = callj('POST', f'/api/nalog/{WO}/transition', admin, {'to': 'ZAKLJUCEN', 'force': True})
chk(s == 400, f'admin force brez razloga → 400 ({s})')

# ══ F. PRIMOPREDAJA ═════════════════════════════════════════════════════════
print('── F) Primopredajno poročilo (verzionirano) ──')
s, d = callj('POST', f'/api/nalog/{WO}/handover', monter, {'summary': 'Montaža izvedena po načrtu, ena odstopanja odpravljena.'})
chk(s == 201, f'izgradnja poročila 201 ({s}, {d.get("error","")})')
HO = d.get('data', {})
chk(HO.get('version') == 1 and HO.get('status') == 'NEPOPOLNA', f'v1 status NEPOPOLNA (kritično odprto) ({HO.get("status")})')

# diffJson: seg-1..seg-4 iz tekača (načrtovano); izvedeno brez AS-INSTALLED
diff = HO.get('diffJson') or {}  # R542: jsonb objekt (brez parse)
primerjava = diff.get('primerjava', [])
chk([p.get('key') for p in primerjava] == ['seg-1', 'seg-2', 'seg-3', 'seg-4'],
    f'diffJson primerjava seg-1..seg-4 ({[p.get("key") for p in primerjava]})')
chk(all(p.get('nacrtCm') == 250 and p.get('izvedenoCm') is None and p.get('ujema') is None for p in primerjava),
    'načrtovano 250 cm/segment iz tekača; izvedeno — (brez AS-INSTALLED, vir zapisan)')
photos = HO.get('photosJson') or []  # R542: jsonb objekt (brez parse)
chk(len(photos) >= 1 and all(p.get('stage') in ('PRED', 'MED', 'PO') for p in photos),
    f'fotografija naloga je v poročilu z fazo ({len(photos)}, {[p.get("stage") for p in photos]})')

# monter potrdi + stranka podpiše — a kritična zadeva še odprta → NEPOPOLNA
s, d = callj('PATCH', f'/api/nalog/{WO}/handover', monter, {'action': 'monter-confirm'})
chk(s == 200 and d.get('data', {}).get('monterConfirmedAt'), 'potrditev monterja zabeležena')
SIG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAAKAAsBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AIgA/9k='
s, d = callj('PATCH', f'/api/nalog/{WO}/handover', monter, {'action': 'sign', 'signatureDataUrl': SIG, 'signedBy': 'Jožica Prevzemnica'})
chk(s == 200 and d.get('data', {}).get('customerSignedAt'), 'podpis stranke zabeležen')
chk(d.get('data', {}).get('status') == 'NEPOPOLNA', f"status OSTANE NEPOPOLNA kljub podpisoma ({d.get('data', {}).get('status')}) — kritična zadeva")

# podpis ne sme biti prepisan (zgodovina!)
s, d = callj('PATCH', f'/api/nalog/{WO}/handover', monter, {'action': 'sign', 'signatureDataUrl': SIG, 'signedBy': 'Nekdo Drug'})
chk(s == 409, f'ponovni podpis iste verzije zavrnjen 409 ({s})')

# pripomba stranke → sledljiv zapis
s, d = callj('PATCH', f'/api/nalog/{WO}/handover', monter, {'action': 'remark', 'remark': 'Prosila bi še za lovilno ploščo pod segmentom 3.'})
chk(s == 200, 'pripomba stranke zabeležena')

# ── odprava kritične zadeve ──
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {'checkId': c_varnost['id'], 'status': 'CAKA_PREVERJANJE'})
chk(s == 200, 'varnost NAPAKA → CAKA_PREVERJANJE')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', monter, {
    'checkId': c_varnost['id'], 'status': 'V_REDU', 'resolutionNote': 'Mesto zavarovano, kontrola opravljena'})
chk(s == 200, 'varnost → V_REDU (z opombo)')
# odpravi še varnostno odstopanje (samodejno ustvarjeno na varnostni točki)
qa2 = callj('GET', f'/api/nalog/{WO}/qa', monter)[1].get('data', {})
dev_varnost = next((dv for c2 in qa2.get('checks', []) for dv in c2.get('deviations', []) if dv.get('impactSafety')), None)
if dev_varnost:
    s, d = callj('PATCH', f'/api/nalog/{WO}/qa/deviation', monter, {'id': dev_varnost['id']})
    chk(s == 200, 'varnostno odstopanje odpravljeno')
else:
    bad('varnostno odstopanje manjka')

# nova verzija poročila → v2; monter + stranka ponovno potrdita
s, d = callj('POST', f'/api/nalog/{WO}/handover', monter, {'summary': 'Popravki izvedeni, kritične zadeve odpravljene.'})
chk(s == 201 and d.get('data', {}).get('version') == 2, f'nova verzija v2 ({d.get("data", {}).get("version")})')
HO2 = d.get('data', {})
chk(HO2.get('status') == 'NEPOPOLNA', f'v2 brez podpisov → NEPOPOLNA ({HO2.get("status")})')

s, d = callj('GET', f'/api/nalog/{WO}/handover', monter)
versions = d.get('data', {}).get('versions', [])
chk(len(versions) == 2 and {v['version'] for v in versions} == {1, 2}, f'zgodovina verzij ohranjena ({len(versions)})')

s, d = callj('PATCH', f'/api/nalog/{WO}/handover', monter, {'action': 'monter-confirm'})
chk(s == 200, 'v2: potrditev monterja')
s, d = callj('PATCH', f'/api/nalog/{WO}/handover', monter, {
    'action': 'sign', 'signatureDataUrl': SIG, 'signedBy': 'Jožica Prevzemnica',
    'remark': 'Prosila bi še za lovilno ploščo pod segmentom 3.'})
chk(s == 200, 'v2: podpis stranke Z opombo (sign+remark v enem koraku)')
latest_remark = callj('GET', f'/api/nalog/{WO}/handover', monter)[1].get('data', {}).get('latest', {}).get('customerRemark')
chk((latest_remark or '').startswith('Prosila bi'), f"opomba iz podpisnega obrazca zabeležena («{(latest_remark or '')[:30]}»")

# NEPOGOJNA: ročno odstopanje (impactPrice) je še nerešeno → POGOJNA
qa3 = callj('GET', f'/api/nalog/{WO}/qa', monter)[1].get('data', {})
dev2_open = next((dv for c2 in qa3.get('checks', []) for dv in c2.get('deviations', []) if not dv.get('resolvedAt')), None)
manual_open = next((dv for dv in qa3.get('deviations', []) if not dv.get('resolvedAt')), None)
chk(dev2_open is None and manual_open is not None, 'nerešeno ostaja samo ročno odstopanje (vpliv na ceno)')
s, d = callj('GET', f'/api/nalog/{WO}/handover', monter)
latest = d.get('data', {}).get('latest', {})
chk(latest.get('status') == 'POGOJNA', f'status POGOJNA (odprta necena zadeva + pripomba iz podpisa) ({latest.get("status")})')

# odprava tudi zadnjega odstopanja → nova verzija → ZAKLJUCENA
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/deviation', monter, {'id': DEV2.get('id')})
chk(s == 200, 'ročno odstopanje odpravljeno')
s, d = callj('POST', f'/api/nalog/{WO}/handover', monter, {'summary': 'Vse zadeve odpravljene.'})
chk(s == 201 and d.get('data', {}).get('version') == 3, 'v3 zgrajena')
s, d = callj('PATCH', f'/api/nalog/{WO}/handover', monter, {'action': 'monter-confirm'})
s, d = callj('PATCH', f'/api/nalog/{WO}/handover', monter, {'action': 'sign', 'signatureDataUrl': SIG, 'signedBy': 'Jožica Prevzemnica'})
chk(s == 200 and d.get('data', {}).get('status') == 'POGOJNA', f'pripomba stranke se je prenesla → ostane POGOJNA ({d.get("data", {}).get("status")})')

# izrecni izbris pripombe (odprta postavka rešena) → ZAKLJUCENA
s, d = callj('PATCH', f'/api/nalog/{WO}/handover', monter, {'action': 'remark', 'remark': ''})
chk(s == 200, f'izbris pripombe 200 ({s})')
s, d = callj('GET', f'/api/nalog/{WO}/handover', monter)
chk(d.get('data', {}).get('latest', {}).get('status') == 'ZAKLJUCENA',
    f"po izbrisu pripombe → ZAKLJUCENA ({d.get('data', {}).get('latest', {}).get('status')})")

# ══ E2. ZAKLJUČEK PO ODPRAVI ════════════════════════════════════════════════
s, d = callj('POST', f'/api/nalog/{WO}/transition', monter, {'to': 'ZAKLJUCEN', 'note': 'Vse kontrole opravljene'})
chk(s == 200, f'zaključek po odpravi 200 ({s})')

# ══ G. PDF ══════════════════════════════════════════════════════════════════
print('── G) PDF primopredaje ──')
s, body, headers = callraw('GET', f'/api/pdf/handover/{HO2.get("id")}', admin)
chk(s == 200 and body[:4] == b'%PDF', f'PDF v1 200 + %PDF ({s}, {body[:4]})')
chk('pdf' in hdr(headers, 'Content-Type').lower(), 'Content-Type: application/pdf')
chk(audit_has(admin, 'DOC_GENERATE', HO2.get('id'), PROJ), 'revizija DOC_GENERATE (handover, projektni pogled)')

# ══ H. RBAC/IDOR ════════════════════════════════════════════════════════════
print('── H) RBAC/IDOR ──')
s, d = callj('GET', f'/api/nalog/{WO}/qa', None)
chk(s == 401, f'brez žetona → 401 ({s})')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/check', sklad, {'checkId': c_seg1['id'], 'status': 'V_REDU'})
chk(s == 403, f'skladišče (brez nalog.write) → 403 ({s})')
# proizvodnja IMA nalog.write (R425) — na svežem nalogu D lahko pripravi točke (dokumentirano)
s, d = callj('POST', '/api/nalog', admin, {
    'title': f'QA montaža D {TAG}', 'projectId': PROJ, 'assigneeId': MONTERID})
WO_D = d.get('data', {}).get('id')
s, d = callj('POST', f'/api/nalog/{WO_D}/qa', proizv, {})
chk(s == 201, f'proizvodnja (nalog.write po R425) pripravi točke na svežem nalogu D → 201 ({s})')
s, d = callj('PATCH', f'/api/nalog/{WO}/qa/action', sklad, {'id': ACT.get('id'), 'status': 'V_OBRAVNAVI'})
chk(s == 403, f'skladišče PATCH ukrep → 403 ({s})')
s, d = callj('POST', f'/api/nalog/{WO}/handover', monter2, {})
chk(s == 403, f'monter2 handover na tuj nalog → 403 ({s})')
s, d = callj('GET', f'/api/nalog/{WO}/qa', monter)
chk(s == 200, f'monter (dodeljen) GET /qa 200 ({s})')

# ══ I. SYNC montaza-check (offline + idempotenca) ═══════════════════════════
print('── I) Sync montaza-check ──')
# nov nalog B na istem projektu (za sync + force teste)
s, d = callj('POST', '/api/nalog', admin, {
    'title': f'QA montaža B {TAG}', 'projectId': PROJ, 'assigneeId': MONTERID})
WO_B = d.get('data', {}).get('id')
chk(s == 201 and bool(WO_B), f'nalog B ustvarjen ({s})')
s, d = callj('POST', f'/api/nalog/{WO_B}/transition', monter, {'to': 'V_TEKU'})
chk(s == 200, 'nalog B → V_TEKU')
s, d = callj('POST', f'/api/nalog/{WO_B}/qa', monter, {})
chk(s == 201, 'nalog B: točke pripravljene')
checks_b = callj('GET', f'/api/nalog/{WO_B}/qa', monter)[1].get('data', {}).get('checks', [])
c_b1 = next((c for c in checks_b if c.get('targetKey') == 'seg-1'), checks_b[0])

opid = f'r489-sync-check-{RUNUID}-1'
s, d = callj('POST', '/api/sync', monter, {'deviceId': 'r489dev', 'ops': [
    {'opId': opid, 'kind': 'montaza-check', 'payload': {
        'workOrderId': WO_B, 'checkId': c_b1['id'], 'status': 'V_REDU',
        'note': f'offline kontrola {TAG}'}}]})
res = (d.get('data', {}).get('results', [{}])[0] if s == 200 else {})
chk(s == 200 and res.get('status') == 'OK', f"sync montaza-check OK ({res.get('status')}, {res.get('error','')})")

# idempotenca: isti opId 2× → ena sprememba
s, d = callj('POST', '/api/sync', monter, {'deviceId': 'r489dev', 'ops': [
    {'opId': opid, 'kind': 'montaza-check', 'payload': {
        'workOrderId': WO_B, 'checkId': c_b1['id'], 'status': 'V_REDU'}}]})
res2 = (d.get('data', {}).get('results', [{}])[0] if s == 200 else {})
chk(s == 200 and res2.get('status') == 'OK', 'ponovni isti opId → OK (shranjen rezultat)')
c_b1_after = next((c for c in callj('GET', f'/api/nalog/{WO_B}/qa', monter)[1].get('data', {}).get('checks', []) if c['id'] == c_b1['id']), {})
chk(c_b1_after.get('status') == 'V_REDU' and (c_b1_after.get('note') or '').startswith('offline'),
    f"idempotentna sprememba ostaja (status {c_b1_after.get('status')}, opomba: {(c_b1_after.get('note') or '')[:30]})")

# sync NAPAKA → odstopanje + dogodek (isti pogoj kot online)
opid2 = f'r489-sync-check-{RUNUID}-2'
s, d = callj('POST', '/api/sync', monter, {'deviceId': 'r489dev', 'ops': [
    {'opId': opid2, 'kind': 'montaza-check', 'payload': {
        'workOrderId': WO_B, 'checkId': c_b1['id'], 'status': 'NAPAKA',
        'deviationReason': 'Offline zaznana napaka na seg-1'}}]})
res3 = (d.get('data', {}).get('results', [{}])[0] if s == 200 else {})
chk(s == 200 and res3.get('status') == 'OK', f"sync NAPAKA z razlogom OK ({res3.get('status')})")
c_b1_dev = next((c for c in callj('GET', f'/api/nalog/{WO_B}/qa', monter)[1].get('data', {}).get('checks', []) if c['id'] == c_b1['id']), {})
chk(len(c_b1_dev.get('deviations', [])) == 1, 'sync NAPAKA je ustvarila odstopanje')

# ── E-nalog B: blokada + FORCE override (vodstvo z razlogom) ──
crit_b = [c for c in checks_b if c.get('critical') and c['status'] == 'NI_ZACETO']
chk(len(crit_b) > 0, f'nalog B ima kritične točke ({len(crit_b)})')
c_cb = crit_b[0]
s, d = callj('PATCH', f'/api/nalog/{WO_B}/qa/check', monter, {
    'checkId': c_cb['id'], 'status': 'NAPAKA', 'deviationReason': 'Kritična odstopanja na B'})
chk(s == 200, 'nalog B: kritična NAPAKA')
s, d = callj('POST', f'/api/nalog/{WO_B}/transition', monter, {'to': 'V_PREVERI'})
chk(s == 200, 'nalog B → V_PREVERI')
s, d = callj('POST', f'/api/nalog/{WO_B}/transition', admin, {'to': 'ZAKLJUCEN'})
chk(s == 409, f'nalog B zaključek blokiran 409 ({s})')
s, d = callj('POST', f'/api/nalog/{WO_B}/transition', admin, {'to': 'ZAKLJUCEN', 'force': True, 'forceReason': 'Naročnik zahteva takojšnjo predajo, napaka se odpravi po garanciji'})
chk(s == 200, f'admin force + razlog → 200 ({s})')
chk(audit_has(admin, 'WO_ZAKLJUCEK_OVERRIDE', WO_B, PROJ, contains='garanciji'), 'revizija WO_ZAKLJUCEK_OVERRIDE z razlogom')

# ── I2: sync zaključek z blokado na novem nalogu C ──
s, d = callj('POST', '/api/nalog', admin, {
    'title': f'QA montaža C {TAG}', 'projectId': PROJ, 'assigneeId': MONTERID})
WO_C = d.get('data', {}).get('id')
s, d = callj('POST', f'/api/nalog/{WO_C}/transition', monter, {'to': 'V_TEKU'})
chk(s == 200, 'nalog C → V_TEKU')
s, d = callj('POST', f'/api/nalog/{WO_C}/transition', monter, {'to': 'V_PREVERI'})
chk(s == 200, 'nalog C → V_PREVERI (brez QA)')
s, d = callj('POST', f'/api/nalog/{WO_C}/transition', monter, {'to': 'ZAKLJUCEN'})
chk(s == 200, f'nalog C brez QA zaključen brez blokade 200 ({s})')

# ══ J. REGRESIJA + ČIŠČENJE ═════════════════════════════════════════════════
print('── J) Regresija + čiščenje ──')
# stari preprosti checklist (R444) še deluje vzporedno
s, d = callj('POST', f'/api/nalog/{WO}/checklist', monter, {'label': f'preprosta točka {TAG}'})
chk(s == 201, f'R444 checklist POST še deluje ({s})')
s, d = callj('GET', f'/api/nalog/{WO}/checklist', monter)
chk(s == 200, f'R444 checklist GET še deluje ({s})')

# kaskadno brisanje nalogov briše QA + primopredajo
cascade_js = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const wo=await p.workOrder.findUnique({where:{id:'__W__'},include:{montazaChecks:true,montazaDeviations:true,handoverReports:true}});
  console.log('JSON='+JSON.stringify({c:wo?.montazaChecks.length??-1,d:wo?.montazaDeviations.length??-1,h:wo?.handoverReports.length??-1}));
  return p.$disconnect();
})()
'''.replace('__W__', WO)
before = bun_out(cascade_js)
chk(before.get('c', -1) > 0 and before.get('d', -1) > 0 and before.get('h', -1) == 3,
    f"pred brisanjem: {before.get('c')} točk, {before.get('d')} odstopanj, {before.get('h')} verzij poročila")

out, _ = bun(CLEAN)
chk('CLEAN_DONE' in out, 'čiščenje #1 (kaskadno prek projekta)')
out, _ = bun(CLEAN)
chk('CLEAN_DONE' in out, 'čiščenje #2 (idempotentno)')
ostanek = bun_out(r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const c=await p.montazaCheck.count({where:{workOrder:{project:{title:{contains:'__TAG__'}}}}});
  const d=await p.montazaDeviation.count({where:{workOrder:{project:{title:{contains:'__TAG__'}}}}});
  const a=await p.montazaAction.count({where:{deviation:{workOrder:{project:{title:{contains:'__TAG__'}}}}}});
  const h=await p.handoverReport.count({where:{workOrder:{project:{title:{contains:'__TAG__'}}}}});
  console.log('JSON='+JSON.stringify({c,d,a,h}));return p.$disconnect();
})()
'''.replace('__TAG__', TAG))
chk(ostanek.get('c', -1) == 0 and ostanek.get('d', -1) == 0 and ostanek.get('a', -1) == 0 and ostanek.get('h', -1) == 0,
    f"nič ostankov QA po čiščenju ({ostanek})")

# vir kod (dokaz, da sta obe poti zaključka zaščiteni)
chk(src_has('src/app/api/nalog/[id]/transition/route.ts', 'preveriBlokadoZakljucka'),
    'transition ruta vsebuje blokado (preveriBlokadoZakljucka)')
chk(src_has('src/app/api/sync/route.ts', 'preveriBlokadoZakljucka'),
    'sync ruta vsebuje ISTO blokado (offline ne obide varovala)')

print(f'\n══ R489 KONEC: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)

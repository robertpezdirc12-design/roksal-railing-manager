#!/usr/bin/env python3
"""tests/r488.py — R488 (issue #9 — END-TO-END VERIGA):
POTRJEN TEKAČ → KANONIČNA MERITEV → MERILNI MODEL → PAKET (handoff) →
BOM (količine IZ SEGMENTOV) → CENE (ceniki) → PONUDBA (invalidacija) →
DVOJČEK (AS-DESIGNED/AS-PRODUCED) → PROIZVODNJA (prefab elementi).

Jedro dokaza: ključi seg-N so USKLAJENI čez celo verigo (tekač ↔ meritev ↔
model ↔ calcJson.inputs ↔ BomLine ↔ twin ↔ prefab) — EN VIR RESNICE.

Preverja:
  A) Priprava: projekt + izdelek z segmentnimi vlogami (OGR-P-001) + varianta.
  B) FAZA 1 TEKAČ: POST /api/fence-run (ZAČETEK→STEBER→VOGAL 90°→VRATA→KONEC
     + kalibracija ZNANA_MERA + teren) → 4 segmenti; quality ≠ NEZADOSTNO,
     validacije brez NAPAK; verify 1 segmenta → VERIFIED.
  C) FAZA 2 POTRDITEV: confirm {handoff:true} → meritev (params.fenceRunId +
     params.segments ≥ 2, verzija v1) + tekač POTRJEN + paket IZMERA;
     P1: calcJson.inputs.segments (m-forma, ključi seg-N) + razmikStebrovM iz
     pravila max_razdalja_stebrov; calcJson.plan NE obstaja (suhi handoff).
  D) FAZA 3 MODEL: seg-1..seg-N, totalLengthCm == summary; turns=L/D → drug
     tloris (ZAVOJ predpostavka zapisana v quality).
  E) FAZA 4 MERILNI PAKET PDF: %PDF + Content-Type (+ pdftotext: MERILNI
     PAKET / ODREZNI SEZNAM, če je na voljo).
  F) FAZA 5 BOM: (a) dry-run plan s segmenti (segmentKey/odpad/cene);
     (b) **P1 KONTROLA**: POST /bom na HANDOFF paketu → segmentsApplied = N +
     vrstice s segmentKey seg-N; (c) primerjalni paketi (R476 tier/compareCode).
  G) FAZA 6 PONUDBA: iz vrstic planBom (salePriceUnit+montazaUnit) → DDV
     preračun; regeneracija BOM → invalidacija (staleAt/staleReason/OSNUTEK);
     izvoz JSON z opozorilom ZASTARELA_PONUDBA.
  H) FAZA 7 DVOJČEK+PROIZVODNJA: BOM POTRJEN; AS-DESIGNED (P5: iz POTRJENEGA
     tekača kljub novejšemu osnutku!) → segmenti == tekačevi; AS-PRODUCED;
     from-twin → PR nalog + elementi seg-1..seg-N z merami/RAL/NAVRTEN;
     PATCH REZANJE; ponovni from-twin 409.
  I) FAZA 8 KONSISTENCA+RBAC: ISTI seg-N niz + skupna dolžina čez verigo;
     monter 403 na quotes/from-twin; monter z nalogom 200 na model (monter2
     brez naloga 403).
  J) P2 kontrola vira: konfigurator prefill prenaša segmente tekača.
  K) Idempotentno čiščenje ×2 (kaskadno, prek Prisma) + nič ostankov.
"""
import json, math, os, subprocess, sys, tempfile, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R488-E2E'
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
    # samo veljavni postgres URL-ji iz okolja (r470)
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

def js_round2 (x):
    """JS Math.round(x*100)/100 za pozitivne vrednosti (polovično navzgor)."""
    return math.floor(x * 100 + 0.5) / 100

# ═══════════════════════════════ TEST ═══════════════════════════════════════

print('══ R488 — END-TO-END VERIGA: tekač → meritev → model → paket → BOM → '
      'cene → ponudba → dvojček → proizvodnja ══')

# predčiščenje (idempotenčna varnostca)
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
    const quotes=await p.quote.findMany({where:{projectId:pr.id,note:{contains:'__TAG__'}}});
    for(const q of quotes){await p.quote.delete({where:{id:q.id}});}
    const pkgs=await p.projectPackage.findMany({where:{projectId:pr.id}});
    for(const k of pkgs){
      await p.bomLine.deleteMany({where:{bom:{packageId:k.id}}});
      await p.bom.deleteMany({where:{packageId:k.id}});
      await p.projectPackage.delete({where:{id:k.id}});
    }
    await p.digitalTwinSnapshot.deleteMany({where:{projectId:pr.id}});
    await p.productionOrder.deleteMany({where:{projectId:pr.id}});
    await p.notificationEvent.deleteMany({where:{projectId:pr.id}});
    await p.workOrder.deleteMany({where:{projectId:pr.id}});
    await p.measurement.deleteMany({where:{projectId:pr.id}});
    await p.project.delete({where:{id:pr.id}});
  }
  await p.quote.deleteMany({where:{note:{contains:'__TAG__'}}});
  await p.user.deleteMany({where:{email:{contains:'r488'}}});
  await p.auditLog.deleteMany({where:{detail:{contains:'__TAG__'}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''
CLEAN = CLEAN_JS.replace('__TAG__', TAG)
out, _ = bun(CLEAN)
chk('CLEAN_DONE' in out, 'predčiščenje testnih zapisov')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
ok('prijava admin + monter')

# monter2 brez naloga (IDOR vzorec r465)
M2_JS = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const crypto=require('crypto');
  const salt=crypto.randomUUID().replace(/-/g,'');
  const hash=crypto.scryptSync('Monter123!',salt,64).toString('hex');
  const u=await p.user.upsert({where:{email:'monter2-r488@roksal.si'},update:{},create:{
    email:'monter2-r488@roksal.si',name:'Monter2 R488',role:'MONTER',
    passwordHash:salt+':'+hash,active:true}});
  console.log('M2='+u.id);return p.$disconnect();
})()
'''
out, _ = bun(M2_JS)
chk('M2=' in out, 'monter2 (brez naloga) pripravljen')
monter2 = login('monter2-r488@roksal.si', 'Monter123!')

# ══ A. PRIPRAVA ═════════════════════════════════════════════════════════════
print('── A) Priprava: projekt + izdelek + varianta ──')
s, d = callj('POST', '/api/projects', admin, {'title': f'E2E veriga {TAG}', 'address': 'Testna cesta 88'})
chk(s == 201, f'nov projekt 201 ({s})')
PROJ = d.get('data', {}).get('id')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p2['sku']: p2 for p2 in d.get('data', [])}
PROD = PRODUCTS.get('OGR-P-001')
VARIANT = next((v for v in (PROD or {}).get('variants', []) if v['sku'] == 'OGR-P-001-ANT'), None)
chk(bool(PROD) and bool(VARIANT), 'OGR-P-001 (segmentRole) + varianta Antracit (RAL 7016)')

# ══ B. FAZA 1 — TEKAČ ═══════════════════════════════════════════════════════
print('── B) FAZA 1 — tekač (ZAČETEK→STEBER→VOGAL 90°→VRATA→KONEC) ──')
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
    'projectId': PROJ, 'name': f'E2E tekač {TAG}', 'productId': PROD['id'],
    'variantId': VARIANT['id'], 'nodes': NODES, 'terrain': TERRAIN,
    'calibration': CAL, 'note': TAG})
chk(s == 201, f'tekač ustvarjen 201 ({s}, {d.get("error", "")})')
RUN = d.get('data', {}).get('id')

s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
det = d.get('data', {})
SEGS = det.get('segments', [])
chk(s == 200 and len(SEGS) == 4, f'4 segmenti (ZAČETEK→STEBER→VOGAL→VRATA→KONEC) ({len(SEGS)})')
chk(all(abs(x.get('lengthCm', 0) - 250) < 0.01 and x.get('heightCm') == 110 for x in SEGS),
    'vsak segment 250 cm × 110 cm (raven teren, višina po vozliščih)')
quality = det.get('analysis', {}).get('quality', {})
napake = [v for v in det.get('analysis', {}).get('validation', []) if v.get('severity') == 'NAPAKA']
chk(quality.get('state') != 'NEZADOSTNO' and len(napake) == 0,
    f"quality ≠ NEZADOSTNO ({quality.get('state')}) in validacije brez NAPAK")
SUMMARY = det.get('analysis', {}).get('summary', {})
chk(abs(SUMMARY.get('totalLengthCm', 0) - 1000) < 0.01
    and any(x.get('toKind') == 'VRATA' for x in SEGS),
    'summary.totalLengthCm = 1000; segment s koncem VRATA obstaja')

s, d = callj('POST', f'/api/fence-run/{RUN}/verify', admin, {
    'segmentId': SEGS[0]['id'], 'measuredCm': 250.4, 'method': 'LASER', 'note': TAG})
segs_v = callj('GET', f'/api/fence-run/{RUN}', admin)[1].get('data', {}).get('segments', [])
chk(s == 200 and d.get('data', {}).get('conflict') is False
    and segs_v and segs_v[0].get('status') == 'VERIFIED',
    'verify segmenta 1 → VERIFIED brez konflikta (LASER 250,4 cm)')

# ══ C. FAZA 2 — POTRDITEV + HANDOFF (P1) ════════════════════════════════════
print('── C) FAZA 2 — potrditev + handoff paket (P1) ──')
s, d = callj('POST', f'/api/fence-run/{RUN}/confirm', admin, {'handoff': True})
chk(s == 201, f'confirm handoff 201 ({s}, {d.get("error", "")} {d.get("detail", "")})')
CONF = d.get('data', {})
MEAS = CONF.get('measurementId')
PKG = CONF.get('package', {})
chk(bool(MEAS) and bool(PKG.get('code')) and abs(CONF.get('summary', {}).get('totalLengthCm', 0) - 1000) < 0.01,
    f'kanonična meritev + paket {PKG.get("code")} + summary 1000')

s, d = callj('GET', f'/api/fence-run/{RUN}', admin)
det = d.get('data', {})
chk(det.get('run', {}).get('status') == 'POTRJEN'
    and all(x.get('status') == 'CONFIRMED' for x in det.get('segments', [])),
    'tekač POTRJEN, vsi segmenti CONFIRMED')

s, d = callj('GET', f'/api/measurements/{MEAS}', admin)
md = d.get('data', {})
params = {}
try: params = json.loads(md.get('params', '{}'))
except Exception: pass
chk(params.get('fenceRunId') == RUN and len(params.get('segments', [])) == 4
    and abs(md.get('lengthCm', 0) - 1000) < 0.01,
    'meritev: params.fenceRunId + 4 segmentov + lengthCm 1000 (§17 en vir)')

s, d = callj('GET', f'/api/measurements/{MEAS}/verzije', admin)
v1 = next((v for v in (d.get('data') or []) if v.get('version') == 1), None)
chk(v1 is not None and '4 segmentov' in (v1.get('note') or ''),
    f"verzija v1 omenja 4 segmente («{v1.get('note') if v1 else ''}»)")
chk(audit_has(admin, 'FENCE_RUN_CONFIRM', RUN, PROJ), 'revizija FENCE_RUN_CONFIRM')

# P1: handoff paket nosi strukturirane vhode iz segmentov tekača
pkg_db = bun_out(r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const pkg=await p.projectPackage.findUnique({where:{id:'__PKG__'}});
  const calc=pkg?JSON.parse(pkg.calcJson||'{}'):null;
  console.log('JSON='+JSON.stringify({status:pkg?.status,qty:pkg?.qty,unit:pkg?.unit,
    measurementId:pkg?.measurementId,calc}));
  return p.$disconnect();
})()
'''.replace('__PKG__', PKG.get('id', 'x')))
calc = pkg_db.get('calc') or {}
inputs = calc.get('inputs') or {}
segs_in = inputs.get('segments') or []
chk(pkg_db.get('status') == 'IZMERA' and pkg_db.get('measurementId') == MEAS
    and [x.get('kljuc') for x in segs_in] == ['seg-1', 'seg-2', 'seg-3', 'seg-4'],
    'paket IZMERA z meritvijo; calcJson.inputs.segments ključi seg-1..seg-4 (m-forma)')
chk(all(abs(x.get('dolzina', 0) - 2.5) < 0.001 and abs((x.get('visina') or 0) - 1.1) < 0.001 for x in segs_in),
    'm-forma: dolzina 2,5 m + visina 1,1 m na segment (cm → m)')
chk(inputs.get('fenceRunId') == RUN and abs((inputs.get('razmikStebrovM') or 0) - 1.2) < 0.001,
    'inputs.fenceRunId + razmikStebrovM 1,2 m (pravilo max_razdalja_stebrov)')
chk('plan' not in calc, 'calcJson.plan NI shranjen (handoff ostane suh dry-run)')

# ══ D. FAZA 3 — MERILNI MODEL ═══════════════════════════════════════════════
print('── D) FAZA 3 — merilni model (R473) ──')
s, d = callj('GET', f'/api/fence-run/{RUN}/model', admin)
model = d.get('data', {}).get('model', {})
msegs = model.get('segments', [])
chk(s == 200 and [x['key'] for x in msegs] == ['seg-1', 'seg-2', 'seg-3', 'seg-4']
    and abs(model.get('totalLengthCm', -1) - SUMMARY.get('totalLengthCm', -2)) < 0.01
    and all(abs(x.get('lengthCm', 0) - 250) < 0.01 for x in msegs),
    'model: ključi seg-1..seg-4, totalLengthCm == summary, mere 1:1 iz tekača')
assum = [a.get('code') for a in model.get('quality', {}).get('assumptions', [])]
chk('ZAVOJ_SMER_PRIVZETA' in assum and abs(model.get('totalPlanCm', -1) - 1000) < 0.01,
    f'predpostavka ZAVOJ_SMER_PRIVZETA zapisana; totalPlanCm 1000 ({assum})')
b_left = model.get('bounds', {})

s, d = callj('GET', f'/api/fence-run/{RUN}/model?turns=D', admin)
model_d = d.get('data', {}).get('model', {})
b_right = model_d.get('bounds', {})
chk(s == 200 and abs(b_left.get('maxY', 0) - 500) < 0.5 and abs(b_left.get('minY', 0)) < 0.5,
    f"turns privzeto (LEVO): vogal 90° → zgiba v +Y, maxY 500 ({b_left})")
chk(abs(b_right.get('minY', 0) + 500) < 0.5 and abs(b_right.get('maxY', 0)) < 0.5
    and abs(model_d.get('totalLengthCm', -1) - 1000) < 0.01,
    f"turns=D: tloris ZRCALJEN (minY −500), dolžine neodvisne od smeri ({b_right})")

# ══ E. FAZA 4 — MERILNI PAKET PDF ═══════════════════════════════════════════
print('── E) FAZA 4 — merilni paket PDF ──')
s, pdf, h4 = callraw('GET', f'/api/pdf/measure/{RUN}', admin)
chk(s == 200 and pdf[:5] == b'%PDF-' and hdr(h4, 'Content-Type').startswith('application/pdf'),
    f'PDF merilnega paketa 200 (%PDF + application/pdf) ({s}, {pdf[:5]})')
if s == 200 and pdf[:5] == b'%PDF-' and subprocess.run(['which', 'pdftotext'], capture_output=True).returncode == 0:
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
        f.write(pdf); pdf_path = f.name
    try:
        # `errors='replace'`: XPDF-jev pdftotext izpisuje bytes izven UTF-8, pas
        # pa izvozi PYTHONUTF8=1 — ob prvem takem byte-u sicer streli
        # UnicodeDecodeError, kar ni napaka aplikacije. Kontrola bere SAMO črke
        # brez šumnikov (MERILNI PAKET / ODREZNI SEZNAM), zato zamenjava ne more
        # prikriti resnične napake.
        r = subprocess.run(['pdftotext', pdf_path, '-'],
                           capture_output=True, text=True, errors='replace')
        # `.stdout` je lahko prazen ali None; brez normalizacije je `in txt` vrgel
        # TypeError in je skril pravi razlog — napako orodja, ne vsebino PDF-ja.
        # rc in stderr zato gresta v sporočilo kontrole.
        txt = r.stdout or ''
        chk('MERILNI PAKET' in txt and 'ODREZNI SEZNAM' in txt,
            f'pdftotext: MERILNI PAKET + ODREZNI SEZNAM (rc={r.returncode}, '
            f'znak={len(txt)}, stderr={r.stderr.strip()[:160]!r})')
    finally:
        os.unlink(pdf_path)
else:
    print('    (opomba: pdftotext ni na voljo — besedilna kontrola preskočena)')

# ══ F. FAZA 5 — BOM IZ SEGMENTOV ════════════════════════════════════════════
print('── F) FAZA 5 — kosovnica iz segmentov (R475 matematika) ──')
SEGS_M = [{'kljuc': f'seg-{i + 1}', 'dolzina': 2.5, 'visina': 1.1} for i in range(4)]
s, d = callj('POST', '/api/project-packages/plan', admin, {
    'productId': PROD['id'], 'variantId': VARIANT['id'], 'qty': 10,
    'segments': SEGS_M, 'razmikStebrovM': 1.2})
plan = d.get('data', {})
plines = plan.get('lines', [])
chk(s == 200 and plan.get('segmentsApplied') == 4, f'dry-run plan 200, segmentsApplied = 4 ({s})')
steber = [l for l in plines if l.get('sku') == 'ALU-STEBER-80']
chk(len(steber) == 4 and abs(steber[0]['qty'] - 4) < 0.01 and all(abs(x['qty'] - 3) < 0.01 for x in steber[1:]),
    'stebri: seg-1 = 4 (vmesni 2 + čelni 2), ostali 3 — veriga brez podvajanja')
prof = [l for l in plines if l.get('sku') == 'ALU-PROF-6060']
anc = next((l for l in plines if l.get('sku') == 'ANC-M12' and l.get('segmentKey') == 'seg-1'), {})
chk(len(prof) == 4 and all(abs(x['qty'] - 5.25) < 0.01 and x.get('wastePct') == 5 for x in prof)
    and abs(anc.get('qty', 0) - 8) < 0.01,
    'polnilo 2×2,5 m + 5 % odpad = 5,25; sidra seg-1: 2/steber × 4 = 8')
chk(all(l.get('segmentKey') in ('seg-1', 'seg-2', 'seg-3', 'seg-4') for l in plines if l.get('group') != 'OSTALO'),
    'vse vrstične vloge vezane na seg-N (dry-run)')
chk(plan.get('salePriceUnit', 0) > 0 and plan.get('montazaUnit', 0) > 0
    and 'cenik' in (plan.get('priceSource') or ''),
    f"cene iz cenikov (prodaja {plan.get('salePriceUnit')} + montaža {plan.get('montazaUnit')} €/m)")
warn_codes = [w.get('code') for w in plan.get('warnings', [])]
chk('BREZ_RAZMIKA' not in warn_codes and 'BREZ_ODPADA' not in warn_codes,
    f'brez opozoril o manjkajočih pravilih ({warn_codes})')

# P1 KONTROLA: BOM generacija na HANDOFF paketu — segmenti iz calcJson.inputs
s, d = callj('POST', f"/api/project-packages/{PKG.get('id')}/bom", admin, {})
bomd = d.get('data', {})
bomcalc = bomd.get('calc', {})
BOM = bomd.get('bom', {})
chk(s == 201 and bomcalc.get('segmentsApplied') == 4
    and len((bomcalc.get('inputs') or {}).get('segments') or []) == 4,
    f"** P1 ** BOM iz handoff paketa: segmentsApplied = 4 (dejansko {bomcalc.get('segmentsApplied')})")
bl_seg = [l for l in BOM.get('lines', []) if l.get('segmentKey')]
chk(len(BOM.get('lines', [])) == 15 and len(bl_seg) == 12
    and {l['segmentKey'] for l in bl_seg} == {'seg-1', 'seg-2', 'seg-3', 'seg-4'},
    f"15 vrstic (12 segmentnih s segmentKey seg-N + 3 pripadnosti) ({len(BOM.get('lines', []))}/{len(bl_seg)})")
chk(any(l.get('group') == 'STEBRI' for l in bl_seg) and any(l.get('group') == 'POLNILO' for l in bl_seg)
    and any(l.get('wastePct') == 5 for l in bl_seg) and BOM.get('status') == 'OSNUTEK',
    'skupine STEBRI/POLNILO + odpad na vrsticah; kosovnica OSNUTEK')
chk(audit_has(admin, 'BOM_GENERATE', BOM.get('id'), PROJ, contains='segmentsApplied'),
    'revizija BOM_GENERATE nosi segmentsApplied')

# primerjalni paketi (R476)
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': PROJ, 'productId': PROD['id'], 'qty': 10, 'unit': 'm',
    'name': f'{TAG} primerjava A', 'note': TAG, 'tier': 'STANDARD', 'compare': True})
CMP = d.get('data', {}).get('compareCode')
s2, d2 = callj('POST', '/api/project-packages', admin, {
    'projectId': PROJ, 'productId': PROD['id'], 'qty': 12, 'unit': 'm',
    'name': f'{TAG} primerjava B', 'note': TAG, 'tier': 'BOLJSI', 'compareCode': CMP})
s3, d3 = callj('POST', '/api/project-packages', admin, {
    'projectId': PROJ, 'productId': PROD['id'], 'qty': 12, 'unit': 'm',
    'name': f'{TAG} primerjava C', 'note': TAG, 'tier': 'PREMIUM', 'compareCode': CMP})
chk(bool(CMP and CMP.startswith('CMP-')) and s2 == 201 and s3 == 201
    and d2.get('data', {}).get('compareCode') == CMP and d3.get('data', {}).get('compareCode') == CMP,
    f'nova primerjava {CMP} + BOLJSI + PREMIUM v isti skupini')
s_dup, _ = callj('POST', '/api/project-packages', admin, {
    'projectId': PROJ, 'productId': PROD['id'], 'qty': 12, 'unit': 'm',
    'name': f'{TAG} dup', 'note': TAG, 'tier': 'BOLJSI', 'compareCode': CMP})
s, d = callj('GET', f'/api/project-packages?projectId={PROJ}', admin)
tiers = sorted(r.get('tier') for r in d.get('data', []) if r.get('compareCode') == CMP)
chk(s_dup == 409 and tiers == ['BOLJSI', 'PREMIUM', 'STANDARD'],
    f'dvojni nivo 409 ({s_dup}); nivoji skupine {CMP}: {tiers}')

# ══ G. FAZA 6 — PONUDBA + INVALIDACIJA ══════════════════════════════════════
print('── G) FAZA 6 — ponudba iz cen + invalidacija (R474) ──')
UNIT = js_round2(plan.get('salePriceUnit', 0) + plan.get('montazaUnit', 0))
line_total = js_round2(10 * UNIT)
subtotal = js_round2(line_total)
discount = js_round2(subtotal * 0.05)
base = js_round2(subtotal - discount)
vat = js_round2(base * 0.22)
total = js_round2(base + vat)
s, d = callj('POST', '/api/quotes', admin, {
    'projectId': PROJ, 'packageId': PKG.get('id'),
    'lines': [{'description': f'Prečna ograja ALU — Antracit (izmera tekača) {TAG}',
               'qty': 10, 'unitPrice': UNIT}],
    'discountPct': 5, 'note': TAG})
q = d.get('data', {})
QUOTE = q.get('id')
chk(s == 201 and abs(q.get('subtotal', -1) - subtotal) < 0.011 and abs(q.get('discount', -1) - discount) < 0.011,
    f'ponudba 201: subtotal {q.get("subtotal")} + popust 5 % {q.get("discount")} (enote iz planBom)')
chk(abs(q.get('vat', -1) - vat) < 0.011 and abs(q.get('total', -1) - total) < 0.011
    and q.get('status') == 'OSNUTEK' and q.get('packageId') == PKG.get('id'),
    f'DDV 22 % iz osnove po popustu {q.get("vat")} → total {q.get("total")}; OSNUTEK vezan na paket')

# invalidacija: regeneracija BOM → ponudba ZASTARELA
s, d = callj('POST', f"/api/project-packages/{PKG.get('id')}/bom", admin, {})
inv = d.get('data', {}).get('invalidated') or d.get('invalidated') or {}
chk(s == 201 and inv.get('reset', 0) >= 1, f'regeneracija BOM invalidira ponudbo ({s}, {inv})')
q2 = callj('GET', f'/api/quotes/{QUOTE}', admin)[1].get('data', {})
chk(q2.get('staleAt') is not None and 'ponovno generirana' in (q2.get('staleReason') or '')
    and q2.get('status') == 'OSNUTEK',
    f"staleAt + staleReason + status OSNUTEK («{(q2.get('staleReason') or '')[:60]}…»)")
s, txt, _ = callraw('GET', f'/api/export/quote/{QUOTE}?format=json', admin)
ex = json.loads(txt).get('data', {}) if s == 200 else {}
chk(s == 200 and abs((ex.get('quote') or {}).get('total', -1) - total) < 0.011
    and any(c.get('code') == 'ZASTARELA_PONUDBA' for c in ex.get('checks', [])),
    'izvoz JSON: total enak ponudbi + opozorilo ZASTARELA_PONUDBA vidno')

# ══ H. FAZA 7 — DVOJČEK + PROIZVODNJA (+ P5) ═════════════════════════════════
print('── H) FAZA 7 — dvojček + proizvodnja (+ P5 preferenca POTRJENEGA) ──')
# svež BOM (nadomeščen z regeneracijo) → POTRJEN
pkg_row = next((r for r in callj('GET', f'/api/project-packages?projectId={PROJ}', admin)[1].get('data', [])
                if r.get('id') == PKG.get('id')), {})
BOM_ID = (pkg_row.get('bom') or {}).get('id')
s, d = callj('PATCH', f'/api/bom/{BOM_ID}', admin, {'status': 'POTRJEN', 'note': TAG})
chk(s == 200 and d.get('data', {}).get('status') == 'POTRJEN', f'kosovnica POTRJEN ({s})')

# P5: DODATNI osnutkov tekač (novejši po updatedAt) — NE SME vzeti prevladati
s, d = callj('POST', '/api/fence-run', admin, {
    'projectId': PROJ, 'name': f'Osnutek {TAG}',
    'nodes': [
        {'kind': 'ZACETEK', 'atCm': 0, 'podlaga': 'BETON', 'heightCm': 110},
        {'kind': 'STEBER', 'atCm': 300, 'podlaga': 'BETON'},
        {'kind': 'VOGAL', 'atCm': 600, 'podlaga': 'ZEMLJA', 'interiorDeg': 90, 'manual': True},
        {'kind': 'KONEC', 'atCm': 900, 'podlaga': 'ZEMLJA'}],
    'calibration': CAL, 'note': f'osnutkov {TAG}'})
chk(s == 201, f'osnutkov tekač (brez potrditve, 3×300) ustvarjen ({s})')

s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': PROJ, 'kind': 'AS_DESIGNED', 'packageId': PKG.get('id'),
    'reason': f'načrt iz potrjene izmere {TAG}'})
chk(s == 201, f'AS-DESIGNED 201 ({s}, {d.get("error", "")} {d.get("detail", "")})')
DESIGNED = d.get('data', {}).get('id')

snap = bun_out(r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const s=await p.digitalTwinSnapshot.findUnique({where:{id:'__SNAP__'}});
  console.log('JSON='+JSON.stringify(s?JSON.parse(s.data):null));
  return p.$disconnect();
})()
'''.replace('__SNAP__', DESIGNED))
dsegs = snap.get('segments', []) if snap else []
chk([x.get('key') for x in dsegs] == ['seg-1', 'seg-2', 'seg-3', 'seg-4']
    and all(abs(x.get('lengthCm', 0) - 250) < 0.01 for x in dsegs)
    and abs(snap.get('totalLengthCm', 0) - 1000) < 0.01,
    '** P5 ** AS-DESIGNED iz POTRJENEGA tekača (4×250, ne osnutka 3×300)')
chk(not snap.get('runDraftWarning'),
    'brez runDraftWarning (vir je POTRJEN tekač — opozorilo samo za osnutek)')

s, d = callj('POST', '/api/digital-twin/snapshot', admin, {
    'projectId': PROJ, 'kind': 'AS_PRODUCED', 'bomId': BOM_ID,
    'spremembe': [{'opis': 'brez odstopanj — proizvodnja po načrtu', 'odobril': 'R488 test'}],
    'reason': f'proizvodnja {TAG}'})
chk(s == 201, f'AS-PRODUCED 201 ({s}, {d.get("error", "")} {d.get("detail", "")})')
PRODUCED = d.get('data', {}).get('id')

s, d = callj('POST', '/api/production/from-twin', admin, {'projectId': PROJ, 'reason': f'prefab {TAG}'})
po = d.get('data', {})
els = po.get('elements', [])
chk(s == 201 and (po.get('code') or '').startswith('PR-'),
    f'from-twin 201 → nalog {po.get("code")} ({s})')
chk([e['key'] for e in els] == ['seg-1', 'seg-2', 'seg-3', 'seg-4']
    and all(abs(e.get('lengthCm', 0) - 250) < 0.01 and e.get('heightCm') == 110 for e in els),
    'prefab lističi seg-1..seg-4, mere == segmenti tekača (ISTI niz)')
chk(all(e.get('ral') == 'RAL 7016' and 'Antracit' in (e.get('produkt') or '') for e in els),
    'RAL iz variante (Antracit) + produkt/varianta na lističu')
chk(all(e.get('status') == 'NAVRTEN' for e in els) and po.get('snapshotId') == PRODUCED
    and audit_has(admin, 'PREFAB_GENERATE', po.get('productionOrderId'), PROJ),
    'vsak listič NAVRTEN, vir = zadnji AS-PRODUCED, revizija PREFAB_GENERATE')

EL1 = els[0]['id'] if els else None
s, d = callj('PATCH', f'/api/production/elements/{EL1}', admin, {'status': 'REZANJE'})
s409 = callj('POST', '/api/production/from-twin', admin,
            {'productionOrderId': po.get('productionOrderId'), 'reason': f'ponovno {TAG}'})[0]
chk(s == 200 and d.get('data', {}).get('status') == 'REZANJE' and s409 == 409,
    f'listič seg-1 v REZANJE ({s}); ponovni from-twin istega naloga 409 ({s409})')

# ══ I. FAZA 8 — KONSISTENCA ČEZ VERIGO + RBAC ════════════════════════════════
print('── I) FAZA 8 — en vir resnice (konsistenca seg-N) + RBAC ──')
bomdb = bun_out(r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const b=await p.bom.findUnique({where:{id:'__BOM__'},include:{lines:true}});
  console.log('JSON='+JSON.stringify({keys:[...new Set((b?.lines||[]).filter(l=>l.segmentKey).map(l=>l.segmentKey))].sort(),
    status:b?.status}));
  return p.$disconnect();
})()
'''.replace('__BOM__', BOM_ID))
bom_keys = bomdb.get('keys', [])
model_keys = sorted(x['key'] for x in msegs)
twin_keys = sorted(x['key'] for x in dsegs)
prefab_keys = sorted(e['key'] for e in els)
meas_keys = sorted(f"seg-{x.get('order', 0) + 1}" for x in params.get('segments', []))
calc_keys = sorted(x.get('kljuc', '') for x in segs_in)
chk(bom_keys == model_keys == twin_keys == prefab_keys == meas_keys == calc_keys,
    f'ISTI seg-N niz: tekač ↔ meritev ↔ model ↔ calcJson ↔ BOM ↔ dvojček ↔ prefab ({bom_keys})')
chk(abs(SUMMARY.get('totalLengthCm', 0) - 1000) < 0.01 and abs(md.get('lengthCm', 0) - 1000) < 0.01
    and abs(model.get('totalLengthCm', 0) - 1000) < 0.01 and abs(snap.get('totalLengthCm', 0) - 1000) < 0.01
    and abs(sum(e.get('lengthCm', 0) for e in els) - 1000) < 0.01,
    'skupna dolžina 1000 cm: tekač == meritev == model == dvojček == Σ lističev')

sq = callj('POST', '/api/quotes', monter, {'lines': [{'description': 'x', 'qty': 1, 'unitPrice': 1}]})[0]
sft = callj('POST', '/api/production/from-twin', monter, {'projectId': PROJ})[0]
chk(sq == 403 and sft == 403, f'monter: POST /api/quotes 403 ({sq}) + from-twin 403 ({sft})')
s, _ = callj('GET', f'/api/fence-run/{RUN}/model', monter2)
chk(s == 403, f'monter2 (brez naloga) model 403 ({s})')
monter_id = next((u.get('id') for u in callj('GET', '/api/users', admin)[1].get('data', [])
                  if u.get('email') == 'monter@roksal.si'), None)
s, d = callj('POST', '/api/nalog', admin, {'title': f'Montaža {TAG}', 'projectId': PROJ, 'assigneeId': monter_id})
sm = callj('GET', f'/api/fence-run/{RUN}/model', monter)[0]
chk(s == 201 and sm == 200, f'monter z nalogom bere model 200 (nalog {s}, model {sm})')

# ══ J. P2 KONTROLA VIRA (konfigurator prefill) ══════════════════════════════
print('── J) P2 — konfiguratorjev prefill prenaša segmente tekača ──')
chk(src_has('src/components/roksal/modules/konfigurator.tsx', 'runSegmentsFromParams')
    and src_has('src/components/roksal/modules/konfigurator.tsx', 'params.fenceRunId + params.segments'),
    'KONFIGURATOR: helper za PRAVE segmente tekača (params.fenceRunId + params.segments)')
chk(src_has('src/components/roksal/modules/konfigurator.tsx', 'iz potrjenih tekačev (seg-1 … seg-N)')
    and src_has('src/app/api/fence-run/[id]/confirm/route.ts', 'calcJson: JSON.stringify({ inputs })'),
    'CONFIRM: handoff zapiše calcJson.inputs (brez plan); prefill sporoča prenos segmentov')

# ══ K. ČIŠČENJE ×2 ══════════════════════════════════════════════════════════
print('── K) Idempotentno čiščenje ×2 ──')
for i in range(2):
    out, err = bun(CLEAN)
    chk('CLEAN_DONE' in out, f'čiščenje {i + 1}. {"" if "CLEAN_DONE" in out else err[:200]}')

left = bun_out(r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const proj=await p.project.count({where:{title:{contains:'__TAG__'}}});
  const runs=await p.fenceRun.count({where:{note:{contains:'__TAG__'}}});
  const pkgs=await p.projectPackage.count({where:{note:{contains:'__TAG__'}}});
  const snaps=await p.digitalTwinSnapshot.count({where:{reason:{contains:'__TAG__'}}});
  const orders=await p.productionOrder.count({where:{title:{contains:'__TAG__'}}});
  const quotes=await p.quote.count({where:{note:{contains:'__TAG__'}}});
  const users=await p.user.count({where:{email:{contains:'r488'}}});
  console.log('JSON='+JSON.stringify({proj,runs,pkgs,snaps,orders,quotes,users}));
  return p.$disconnect();
})()
'''.replace('__TAG__', TAG))
chk(all(v == 0 for v in left.values()), f'nič ostankov ({left})')

print()
print(f'══ R488 REZULTAT: ✓ {PASS} / ✗ {FAIL} ══')
sys.exit(1 if FAIL else 0)

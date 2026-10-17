#!/usr/bin/env python3
"""tests/r475.py — R475 (issue #9 §5 HOVER PARITY F3): KOLIČINE IZ SEGMENTOV

Preverja:
  A) RBAC: PATCH komponent monter 403 (brez catalog.write); dry-run plan
     monter 403 (brez quotes.create).
  B) Vloge komponent: PATCH segmentRole veljavna / neveljavna vloga 400 /
     tuja komponenta 404; revizija COMPONENT_ROLE_SET.
  C) Dry-run (POST /api/project-packages/plan) v segmentnem režimu:
     stebri po razmiku (vnos ima prednost pred pravilom), odpad iz pravila
     odpad_rez_pct, vrstice ← segmentKey/skupina/vir; opozorila BREZ_ODPADA
     (deaktivirano pravilo), BREZ_VISINE (POLNILO_M2 brez višine),
     NEZNANA_VLOGA (neveljavna vloga iz baze) + fallback na predlogo;
     brez segmentov = nespremenjeno obnašanje (segmentsApplied 0).
  D) Paket → kosovnica: calcJson.inputs.segments z ključi → vrstice BOM
     s segmentKey/group/wastePct/sourceRule ZAPISANE; kalkulacija nosi
     segmentsApplied + segmentEngine + warnings; revizija BOM_GENERATE.
  E) Idempotentno čiščenje vseh testnih zapisov + povratek vlog/pravil.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R475-TEST'
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

def audit_has (token, action, entityId, projectId=None):
    # projektni pogled (?projectId=) ne podlega filtra action — filtriramo
    # stransko; sistemski pogled filtrira že API (projectId: null dogodki)
    if projectId:
        s, d = callj('GET', f'/api/audit?projectId={projectId}&limit=300', token)
    else:
        s, d = callj('GET', f'/api/audit?action={action}&limit=100', token)
    rows = d.get('data', []) if s == 200 else []
    return any(e.get('action') == action and e.get('entityId') == entityId for e in rows)

# ── priprava: predčiščenje ──────────────────────────────────────────────────
CLEAN = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const pkgs=await p.projectPackage.findMany({where:{name:{contains:'__TAG__'}},select:{id:true}});
  for (const g of pkgs) {
    const bom=await p.bom.findFirst({where:{packageId:g.id},select:{id:true}});
    if (bom) {
      await p.stockReservation.deleteMany({where:{bomId:bom.id}});
      await p.bomLine.deleteMany({where:{bomId:bom.id}});
      await p.bom.delete({where:{id:bom.id}});
    }
    await p.projectPackage.delete({where:{id:g.id}});
  }
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'predčiščenje')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004')
chk(bool(P4), 'projekt P-2026-004 najden')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p['sku']: p for p in d.get('data', [])}
OGR = PRODUCTS.get('OGR-P-001')
chk(bool(OGR), 'izdelek OGR-P-001 najden')

# komponente izdelka (za PATCH vlog)
s, d = callj('GET', f"/api/products/{OGR['id']}", admin)
COMPS = {c['item']['sku']: c for c in d.get('data', {}).get('components', [])}
PROF = COMPS.get('ALU-PROF-6060'); STEBER = COMPS.get('ALU-STEBER-80')
chk(bool(PROF and STEBER), 'komponenti ALU-PROF-6060/ALU-STEBER-80 najdeni')

# ── pravila: zagotovi aktiven odpad + razmik (na koncu povrati) ──────────────
RULES_BEFORE, _ = bun_ts(r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const rows=await p.engineeringRule.findMany({where:{key:{in:['max_razdalja_stebrov','odpad_rez_pct']}}});
  console.log(JSON.stringify(rows.map(r=>({key:r.key,value:r.value,active:r.active}))));
  if(!rows.find(r=>r.key==='odpad_rez_pct')) {
    await p.engineeringRule.create({data:{key:'odpad_rez_pct',label:'Odpad pri rezanju profilov in polnil',value:5,unit:'%',note:'R475 test'}});
  }
  return p.$disconnect();
})()
''')
try: RULES0 = json.loads([l for l in RULES_BEFORE.splitlines() if l.startswith('[')][0])
except Exception: RULES0 = []
chk(any(r['key'] == 'odpad_rez_pct' for r in RULES0) or 'odpad' in RULES_BEFORE, 'pravilo odpad_rez_pct pripravljeno')

# ══ A. RBAC ════════════════════════════════════════════════════════════════
print('── A. RBAC ──')
s, _ = callj('PATCH', f"/api/products/{OGR['id']}/components", monter,
             {'componentId': STEBER['id'], 'segmentRole': 'STEBER'})
chk(s == 403, f'monter (brez catalog.write) 403 (dejansko {s})')
s, _ = callj('POST', '/api/project-packages/plan', monter, {'productId': OGR['id'], 'qty': 5})
chk(s == 403, f'monter (brez quotes.create) 403 na plan (dejansko {s})')

# ══ B. Vloge komponent ══════════════════════════════════════════════════════
print('── B. Vloge ──')
s, _ = callj('PATCH', f"/api/products/{OGR['id']}/components", admin,
             {'componentId': STEBER['id'], 'segmentRole': 'NAPACNA'})
chk(s == 400, f'neveljavna vloga 400 (dejansko {s})')

s, _ = callj('PATCH', f"/api/products/{OGR['id']}/components", admin,
             {'componentId': 'neobstaja', 'segmentRole': 'STEBER'})
chk(s == 404, f'neobstoječa komponenta 404 (dejansko {s})')

# tuja komponenta (izdelek TER-WPC-001)
TER = PRODUCTS.get('TER-WPC-001')
s, d_ter = callj('GET', f"/api/products/{TER['id']}", admin)
ter_comp = (d_ter.get('data', {}).get('components') or [{}])[0]
s, _ = callj('PATCH', f"/api/products/{OGR['id']}/components", admin,
             {'componentId': ter_comp.get('id', 'x'), 'segmentRole': 'STEBER'})
chk(s == 404, f'komponenta drugega izdelka 404 (dejansko {s})')

# veljavna nastavitev (STEBER že iz seeda — ponovno določimo + preverimo zapis)
s, d = callj('PATCH', f"/api/products/{OGR['id']}/components", admin,
             {'componentId': STEBER['id'], 'segmentRole': 'STEBER', 'qty': 1})
chk(s == 200 and d.get('data', {}).get('segmentRole') == 'STEBER', f'vloga STEBER nastavljena ({s})')
chk(audit_has(admin, 'COMPONENT_ROLE_SET', STEBER['id']), 'revizija COMPONENT_ROLE_SET')

# odstranitev vloge → null
s, d = callj('PATCH', f"/api/products/{OGR['id']}/components", admin,
             {'componentId': PROF['id'], 'segmentRole': None})
chk(s == 200 and d.get('data', {}).get('segmentRole') is None, f'vloga odstranjena → null ({s})')
# povratek na POLNILO_M (demo stanje)
s, _ = callj('PATCH', f"/api/products/{OGR['id']}/components", admin,
             {'componentId': PROF['id'], 'segmentRole': 'POLNILO_M', 'qty': 2})
chk(s == 200, f'vloga POLNILO_M povrnjena ({s})')

# ══ C. Dry-run v segmentnem režimu ═════════════════════════════════════════
print('── C. Dry-run segmentni ──')
SEGS = [{'kljuc': 'seg-1', 'dolzina': 6.5, 'visina': 1.0},
        {'kljuc': 'seg-2', 'dolzina': 4.5, 'visina': 1.0}]

s, d = callj('POST', '/api/project-packages/plan', admin,
             {'productId': OGR['id'], 'qty': 11, 'segments': SEGS, 'razmikStebrovM': 1.2})
chk(s == 200, f'plan 200 (dejansko {s}, {d.get("error", "")})')
plan = d.get('data', {})
chk(plan.get('segmentsApplied') == 2, f"segmentsApplied=2 (dejansko {plan.get('segmentsApplied')})")
chk(plan.get('segmentEngine') == 'segment-bom/1.0', f"segmentEngine (dejansko {plan.get('segmentEngine')})")

lines = plan.get('lines', [])
def by (sku, seg=None):
    return [l for l in lines if l['sku'] == sku and (seg is None or l['segmentKey'] == seg)]

# stebri: seg-1 650 cm / 120 → ceil(5.42)=6 −1 = 5 vmesni + 2 čelni (prvi) = 7
s1 = by('ALU-STEBER-80', 'seg-1')
chk(len(s1) == 1 and abs(s1[0]['qty'] - 7) < 1e-9, f"stebri seg-1 = 7 kos (dejansko {s1[0]['qty'] if s1 else 'manjka'})")
chk(s1 and s1[0]['group'] == 'STEBRI' and s1[0]['sourceRule'] == 'vnos:razmik',
    f"skupina STEBRI + vir vnos:razmik (dejansko {s1[0].get('group')}/{s1[0].get('sourceRule') if s1 else '?'})")
# seg-2 450/120 → ceil(3.75)=4 −1 = 3 vmesni + 1 čelni = 4
s2 = by('ALU-STEBER-80', 'seg-2')
chk(len(s2) == 1 and abs(s2[0]['qty'] - 4) < 1e-9, f"stebri seg-2 = 4 kos (dejansko {s2[0]['qty'] if s2 else 'manjka'})")
# ANC-M12 × 2 sidra/steber
a1 = by('ANC-M12', 'seg-1')
chk(len(a1) == 1 and abs(a1[0]['qty'] - 14) < 1e-9, f"sidra seg-1 = 14 kos (dejansko {a1[0]['qty'] if a1 else 'manjka'})")

# polnilo: seg-1 6.5 m × 2 vrstici × (1 + 5 %) = 13.65 m
p1 = by('ALU-PROF-6060', 'seg-1')
chk(len(p1) == 1 and abs(p1[0]['qty'] - 13.65) < 1e-9, f"polnilo seg-1 = 13.65 m (dejansko {p1[0]['qty'] if p1 else 'manjka'})")
chk(p1 and p1[0]['group'] == 'POLNILO' and abs(p1[0]['wastePct'] - 5) < 1e-9,
    f"skupina POLNILO + wastePct 5 (dejansko {p1[0].get('group')}/{p1[0].get('wastePct') if p1 else '?'})")
chk(p1 and p1[0]['sourceRule'] == 'RULE:odpad_rez_pct', f"vir odpada RULE:odpad_rez_pct (dejansko {p1[0].get('sourceRule') if p1 else '?'})")
p2 = by('ALU-PROF-6060', 'seg-2')
chk(len(p2) == 1 and abs(p2[0]['qty'] - 9.46) < 1e-9, f"polnilo seg-2 = 9.46 m (dejansko {p2[0]['qty'] if p2 else 'manjka'})")

# pripadnosti: predloga × qty, brez segmenta, skupina OSTALO
vij = by('VIJ-INOX-M8')
chk(len(vij) == 1 and abs(vij[0]['qty'] - 88) < 1e-9 and vij[0]['segmentKey'] is None and vij[0]['group'] == 'OSTALO',
    f"vijaki predloga × 11 = 88, OSTALO, brez segmenta (dejansko {vij[0]['qty'] if vij else 'manjka'})")

# brez vnosa razmika → pravilo max_razdalja_stebrov (120 cm iz seeda)
s, d = callj('POST', '/api/project-packages/plan', admin,
             {'productId': OGR['id'], 'qty': 11, 'segments': SEGS})
plan2 = d.get('data', {})
s1b = [l for l in plan2.get('lines', []) if l['sku'] == 'ALU-STEBER-80' and l['segmentKey'] == 'seg-1']
chk(s1b and s1b[0]['sourceRule'] == 'RULE:max_razdalja_stebrov',
    f"brez vnosa → vir RULE:max_razdalja_stebrov (dejansko {s1b[0].get('sourceRule') if s1b else 'manjka'})")

# brez segmentov → nespremenjeno obnašanje
s, d = callj('POST', '/api/project-packages/plan', admin, {'productId': OGR['id'], 'qty': 11})
plan3 = d.get('data', {})
chk(plan3.get('segmentsApplied') == 0 and all(l['group'] is None for l in plan3.get('lines', [])),
    'brez segmentov: segmentsApplied 0, group null (predloga × qty)')
chk(any(abs(l['qty'] - 11) < 0.01 for l in plan3.get('lines', []) if l['sku'] == 'ALU-STEBER-80'),
    'brez segmentov: stebri predloga × 11 = 11 kos (qty 1 kos/steber po seed-r475)')

# ── opozorila: BREZ_VISINE (POLNILO_M2 brez višine) ──
s, _ = callj('PATCH', f"/api/products/{OGR['id']}/components", admin,
             {'componentId': PROF['id'], 'segmentRole': 'POLNILO_M2', 'qty': 1})
chk(s == 200, 'vloga POLNILO_M2 nastavljena')
s, d = callj('POST', '/api/project-packages/plan', admin,
             {'productId': OGR['id'], 'qty': 11,
              'segments': [{'kljuc': 'seg-1', 'dolzina': 6.5}, {'kljuc': 'seg-2', 'dolzina': 4.5, 'visina': 1.0}],
              'razmikStebrovM': 1.2})
plan4 = d.get('data', {})
w = [x for x in plan4.get('warnings', []) if x['code'] == 'BREZ_VISINE']
chk(len(w) >= 1, f'opozorilo BREZ_VISINE brez višine (dejansko {plan4.get("warnings")})')
m2 = [l for l in plan4.get('lines', []) if l['sku'] == 'ALU-PROF-6060']
chk(all(l['segmentKey'] == 'seg-2' for l in m2), f'vrstica izpuščena za seg-1 brez višine (dejansko {[l["segmentKey"] for l in m2]})')
# z višino: seg-2 4.5 × 1.0 × (1 + 5 %) = 4.725 → zaokroženo navzgor 4.73 m²
chk(any(abs(l['qty'] - 4.73) < 1e-9 for l in m2 if l['segmentKey'] == 'seg-2'),
    f"POLNILO_M2 seg-2 = 4.5×1.0×1.05 → 4.73 (dejansko {[l['qty'] for l in m2]})")

# ── opozorilo: BREZ_ODPADA (pravilo deaktivirano) ──
_, _ = bun_ts(r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{await p.engineeringRule.updateMany({where:{key:'odpad_rez_pct'},data:{active:false}});return p.$disconnect();})()
''')
s, d = callj('POST', '/api/project-packages/plan', admin,
             {'productId': OGR['id'], 'qty': 11, 'segments': SEGS, 'razmikStebrovM': 1.2})
plan5 = d.get('data', {})
w = [x for x in plan5.get('warnings', []) if x['code'] == 'BREZ_ODPADA']
chk(len(w) >= 1, f'opozorilo BREZ_ODPADA (dejansko {plan5.get("warnings")})')
p5 = [l for l in plan5.get('lines', []) if l['sku'] == 'ALU-PROF-6060' and l['segmentKey'] == 'seg-2']
chk(p5 and p5[0]['wastePct'] is None and abs(p5[0]['qty'] - 4.5) < 1e-9,
    f'brez pravila: wastePct null, količina brez odpada (dejansko {p5[0].get("wastePct")}/{p5[0].get("qty") if p5 else "?"})')
_, _ = bun_ts(r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{await p.engineeringRule.updateMany({where:{key:'odpad_rez_pct'},data:{active:true}});return p.$disconnect();})()
''')

# ── opozorilo: NEZNANA_VLOGA (neveljavna vrednost direktno v bazi) ──
_, _ = bun_ts(r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{await p.productComponent.updateMany({where:{id:'__CID__'},data:{segmentRole:'CUDEM'}});return p.$disconnect();})()
'''.replace('__CID__', PROF['id']))
s, d = callj('POST', '/api/project-packages/plan', admin,
             {'productId': OGR['id'], 'qty': 11, 'segments': SEGS, 'razmikStebrovM': 1.2})
plan6 = d.get('data', {})
w = [x for x in plan6.get('warnings', []) if x['code'] == 'NEZNANA_VLOGA']
chk(len(w) >= 1, f'opozorilo NEZNANA_VLOGA + fallback predloga (dejansko {plan6.get("warnings")})')
# povratek na POLNILO_M
s, _ = callj('PATCH', f"/api/products/{OGR['id']}/components", admin,
             {'componentId': PROF['id'], 'segmentRole': 'POLNILO_M', 'qty': 2})
chk(s == 200, 'vloga POLNILO_M povrnjena po testu')

# ══ D. Paket → kosovnica (segmentni režim shranjen) ════════════════════════
print('── D. Kosovnica paketa ──')
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGR['id'], 'name': f'{TAG} paket', 'qty': 11, 'note': TAG,
    'calcJson': {'inputs': {'familyCode': 'OGRAJA_PRECNA', 'form': 'm', 'qty': 11,
                            'segments': [{'kljuc': 'seg-1', 'dolzina': 6.5, 'visina': 1.0},
                                         {'kljuc': 'seg-2', 'dolzina': 4.5, 'visina': 1.0}],
                            'razmikStebrovM': 1.2}}})
PKG = d.get('data', {}).get('id')
chk(s == 201 and bool(PKG), f'paket s segmentnimi vhodi ustvarjen ({s})')

s, d = callj('POST', f'/api/project-packages/{PKG}/bom', admin, {})
chk(s == 201, f'kosovnica generirana 201 (dejansko {s}, {d.get("error", "")})')
BOM = d.get('data', {}).get('bom', {})
blines = BOM.get('lines', [])
chk(any(l['segmentKey'] == 'seg-1' for l in blines) and any(l['segmentKey'] == 'seg-2' for l in blines),
    f'odgovor nosi vrstice s segmentKey (dejansko {sorted({str(l.get("segmentKey")) for l in blines})})')
s1p = [l for l in blines if l['sku'] == 'ALU-STEBER-80' and l['segmentKey'] == 'seg-1']
chk(s1p and abs(s1p[0]['qty'] - 7) < 1e-9, f'stebri seg-1 zapisani = 7 (dejansko {s1p[0]["qty"] if s1p else "manjka"})')

# GET podrobnost: nova polja vzdržana
s, d = callj('GET', f"/api/bom/{BOM.get('id', '')}", admin)
det = d.get('data', {})
dl = det.get('lines', [])
chk(any(l.get('group') == 'STEBRI' and l.get('wastePct') is None for l in dl)
    and any(l.get('group') == 'POLNILO' and abs(l.get('wastePct', 0) - 5) < 1e-9 for l in dl),
    'GET /api/bom/[id] vrača group/wastePct')
chk(any(l.get('sourceRule') == 'vnos:razmik' for l in dl), 'GET vrača sourceRule')

# kalkulacija paketa nosi segmentsApplied + engine + warnings
s, d = callj('GET', f'/api/project-packages?projectId={P4}', admin)
pkgrow = next((p for p in d.get('data', []) if p['id'] == PKG), {})
calc = pkgrow.get('calcJson') or {}  # R542: calcJson je jsonb objekt (brez parse)
chk(calc.get('segmentsApplied') == 2, f"calcJson.segmentsApplied = 2 (dejansko {calc.get('segmentsApplied')})")
chk(calc.get('segmentEngine') == 'segment-bom/1.0', f"calcJson.segmentEngine (dejansko {calc.get('segmentEngine')})")
inp_segs = ((calc.get('inputs') or {}).get('segments'))
chk(isinstance(inp_segs, list) and len(inp_segs) == 2 and inp_segs[0].get('kljuc') == 'seg-1',
    'vhodi (segmenti s ključi) se ohranijo čez regeneracijo (R447 invarianta)')
chk(audit_has(admin, 'BOM_GENERATE', BOM.get('id', ''), P4), 'revizija BOM_GENERATE (projektni dnevnik)')

# ══ E. Čiščenje ═════════════════════════════════════════════════════════════
print('── E. Čiščenje ──')
CLEAN2 = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const pkgs=await p.projectPackage.findMany({where:{name:{contains:'__TAG__'}},select:{id:true}});
  for (const g of pkgs) {
    const bom=await p.bom.findFirst({where:{packageId:g.id},select:{id:true}});
    if (bom) {
      await p.stockReservation.deleteMany({where:{bomId:bom.id}});
      await p.bomLine.deleteMany({where:{bomId:bom.id}});
      await p.bom.delete({where:{id:bom.id}});
    }
    await p.projectPackage.delete({where:{id:g.id}});
  }
  // povratek vlog na demo stanje (seed-r475)
  const og=await p.product.findUnique({where:{sku:'OGR-P-001'},select:{id:true}});
  if (og) {
    const cs=await p.productComponent.findMany({where:{productId:og.id},include:{item:{select:{sku:true}}}});
    for (const c of cs) {
      if (c.item.sku==='ALU-PROF-6060') await p.productComponent.update({where:{id:c.id},data:{segmentRole:'POLNILO_M',qty:2}});
      if (c.item.sku==='ALU-STEBER-80') await p.productComponent.update({where:{id:c.id},data:{segmentRole:'STEBER',qty:1}});
      if (c.item.sku==='ANC-M12') await p.productComponent.update({where:{id:c.id},data:{segmentRole:'STEBER',qty:2}});
    }
  }
  await p.engineeringRule.updateMany({where:{key:'odpad_rez_pct'},data:{active:true}});
  console.log('CLEAN2_DONE');return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
out, _ = bun_ts(CLEAN2)
chk('CLEAN2_DONE' in out, 'čiščenje + povratek vlog/pravil')

s, d = callj('GET', '/api/public/health')
chk(s == 200 and d.get('ok') is True, 'health OK')

print()
print(f'── R475: {PASS} OK / {FAIL} NAPAK ──')
sys.exit(1 if FAIL else 0)

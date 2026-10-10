#!/usr/bin/env python3
"""tests/r474.py — R474 (issue #9 §5 HOVER PARITY F2): POVEZAVA PONUDBA ↔ PAKET + INVALIDACIJA

Preverja:
  A) RBAC: POST /api/quotes monter 403 (brez quotes.create).
  B) Povezava: packageId neobstoječ 404; paket iz DRUGEGA projekta 400;
     veljavna povezava 201 → quote.packageId zapisan; revizija QUOTE_CREATE
     nosi packageId.
  C) Invalidacija ob regeneraciji kosovnice (POST /api/project-packages/[id]/bom):
     OSNUTEK → ostane OSNUTEK + staleAt/staleReason; POSLAN → povrnjen na
     OSNUTEK + zastavica; revizija QUOTE_INVALIDATED; odgovor nosi invalidated.
  D) Invalidacija ob spremembi obsega (PATCH paket qty): SPREJET ostane SPREJET
     (podpisanega/sprejetega NE spreminjamo tiho) — SAMO zastavica + revizija.
  E) ZAVRNJEN se ne invalidira (brez poslovnega učinka).
  F) Izrecni pregled: PATCH status (POSLAN) počisti zastavico.
  G) Regresija: klasična ponudba BREZ packageId deluje; health OK.
  H) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R474-TEST'
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
    urls = [f'/api/audit?action={action}&limit=100']
    if projectId:
        urls.append(f'/api/audit?projectId={projectId}&action={action}&limit=100')
    for u in urls:
        s, d = callj('GET', u, token)
        rows = d.get('data', []) if s == 200 else []
        if any(e.get('entityId') == entityId for e in rows):
            return True
    return False

# ── priprava ────────────────────────────────────────────────────────────────
CLEAN = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const qs=await p.quote.findMany({where:{note:{contains:'__TAG__'}},select:{id:true}});
  for (const q of qs) await p.quote.delete({where:{id:q.id}}); // vrstice kaskadirajo
  const pkgs=await p.projectPackage.findMany({where:{name:{contains:'__TAG__'}},select:{id:true}});
  for (const g of pkgs) {
    const bom=await p.bom.findFirst({where:{packageId:g.id},select:{id:true}});
    if (bom) {
      await p.bomLine.deleteMany({where:{bomId:bom.id}});
      await p.bom.delete({where:{id:bom.id}});
    }
  }
  await p.projectPackage.deleteMany({where:{name:{contains:'__TAG__'}}});
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'predčiščenje')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')

s, d = callj('GET', '/api/projects', admin)
PROJ = {p['code']: p['id'] for p in d.get('data', [])}
P4 = PROJ.get('P-2026-004'); P3 = PROJ.get('P-2026-003')
chk(bool(P4 and P3), 'projekta P-2026-004/P-2026-003 najdena')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p['sku']: p for p in d.get('data', [])}
TER = PRODUCTS.get('TER-WPC-001')
chk(bool(TER), 'izdelek TER-WPC-001 (ima komponente) najden')

LINES = [{'description': f'{TAG} testna ograja', 'qty': 1, 'unitPrice': 100}]

# ══ A. RBAC ════════════════════════════════════════════════════════════════
print('── A. RBAC ──')
s, _ = callj('POST', '/api/quotes', monter, {'projectId': P4, 'lines': LINES, 'note': TAG})
chk(s == 403, f'monter (brez quotes.create) 403 (dejansko {s})')

# ══ B. Povezava ponudba ↔ paket ═════════════════════════════════════════════
print('── B. Povezava ──')
s, _ = callj('POST', '/api/quotes', admin, {'projectId': P4, 'packageId': 'neobstaja', 'lines': LINES, 'note': TAG})
chk(s == 404, f'neobstoječ paket 404 (dejansko {s})')

# paket na P3, ponudba na P4 → 400
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P3, 'productId': TER['id'], 'name': f'{TAG} paket P3', 'qty': 5, 'note': TAG})
PKG_P3 = d.get('data', {}).get('id')
chk(s == 201, f'paket na P-2026-003 ustvarjen ({s})')
s, _ = callj('POST', '/api/quotes', admin, {'projectId': P4, 'packageId': PKG_P3, 'lines': LINES, 'note': TAG})
chk(s == 400, f'paket iz drugega projekta 400 (dejansko {s})')

# veljavna povezava
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': TER['id'], 'name': f'{TAG} paket P4', 'qty': 12, 'note': TAG})
PKG = d.get('data', {}).get('id')
PKG_CODE = d.get('data', {}).get('code', '')
chk(s == 201 and bool(PKG), f'paket na P-2026-004 ustvarjen ({s})')

s, d = callj('POST', '/api/quotes', admin, {'projectId': P4, 'packageId': PKG, 'lines': LINES, 'note': TAG})
chk(s == 201, f'ponudba s packageId 201 (dejansko {s}, {d.get("error", "")})')
Q1 = d.get('data', {}).get('id'); Q1_CODE = d.get('data', {}).get('code', '')
chk(d.get('data', {}).get('packageId') == PKG, 'quote.packageId zapisan')
chk(audit_has(admin, 'QUOTE_CREATE', Q1, P4), 'revizija QUOTE_CREATE')

# ══ C. Invalidacija ob regeneraciji kosovnice ═══════════════════════════════
print('── C. Regeneracija kosovnice ──')
# Q1 najprej POSLAN, nato regen → povrnjen na OSNUTEK + zastavica
s, _ = callj('PATCH', f'/api/quotes/{Q1}', admin, {'status': 'POSLAN'})
chk(s == 200, f'Q1 → POSLAN ({s})')

s, d = callj('POST', f'/api/project-packages/{PKG}/bom', admin, {})
chk(s == 201, f'generiranje kosovnice 201 (dejansko {s}, {d.get("error", "")})')
inv = d.get('data', {}).get('invalidated', {})
chk(inv.get('reset', 0) == 1 and Q1_CODE in (inv.get('codes') or []), f'odgovor poroča invalidacijo ({inv})')

s, d = callj('GET', f'/api/quotes/{Q1}', admin)
det = d.get('data', {})
chk(det.get('status') == 'OSNUTEK', f'POSLAN povrnjen na OSNUTEK (dejansko {det.get("status")})')
chk(bool(det.get('staleAt')), 'staleAt nastavljen')
chk('ponovno generirana' in (det.get('staleReason') or ''), f'staleReason z razlogom (dejansko {det.get("staleReason")})')
chk(audit_has(admin, 'QUOTE_INVALIDATED', Q1, P4), 'revizija QUOTE_INVALIDATED')

# ponovna regeneracija NE podvoji (štejemo reset od trenutno OSNUTEK)
s, d = callj('POST', f'/api/project-packages/{PKG}/bom', admin, {})
chk(s == 201 and d.get('data', {}).get('invalidated', {}).get('reset', 0) == 1,
    f'ponovna regeneracija še vedno invalidira (dejansko {d.get("data", {}).get("invalidated")})')

# ══ D. SPREJET — samo zastavica (ne spreminjamo tiho) ═══════════════════════
print('── D. SPREJET zastavica ──')
s, d = callj('POST', '/api/quotes', admin, {'projectId': P4, 'packageId': PKG, 'lines': LINES, 'note': f'{TAG} 2'})
Q2 = d.get('data', {}).get('id')
chk(s == 201 and bool(Q2), f'druga ponudba povezana ({s})')
s, _ = callj('PATCH', f'/api/quotes/{Q2}', admin, {'status': 'SPREJET'})
chk(s == 200, f'Q2 → SPREJET ({s})')

# sprememba obsega paketa (qty) → Q2 ostane SPREJET, samo zastavica
s, d = callj('PATCH', f'/api/project-packages/{PKG}', admin, {'qty': 15})
chk(s == 200, f'PATCH paket qty ({s})')
inv = d.get('data', {}).get('invalidated', {})
chk(inv.get('flagged', 0) >= 1, f'PATCH poroča zastavico ({inv})')

s, d = callj('GET', f'/api/quotes/{Q2}', admin)
det = d.get('data', {})
chk(det.get('status') == 'SPREJET', f'Q2 ostaja SPREJET — podpisanega NE spreminjamo tiho (dejansko {det.get("status")})')
chk(bool(det.get('staleAt')) and 'Spremenjen obseg' in (det.get('staleReason') or ''),
    f'Q2 ima zastavico z razlogom (dejansko {det.get("staleReason")})')
chk(audit_has(admin, 'QUOTE_INVALIDATED', Q2, P4), 'revizija QUOTE_INVALIDATED za SPREJET')

# ══ E. ZAVRNJEN se ne invalidira ════════════════════════════════════════════
print('── E. ZAVRNJEN ──')
s, d = callj('POST', '/api/quotes', admin, {'projectId': P4, 'packageId': PKG, 'lines': LINES, 'note': f'{TAG} 3'})
Q3 = d.get('data', {}).get('id')
chk(s == 201 and bool(Q3), f'tretja ponudba povezana ({s})')
s, _ = callj('PATCH', f'/api/quotes/{Q3}', admin, {'status': 'ZAVRNJEN'})
chk(s == 200, f'Q3 → ZAVRNJEN ({s})')
s, d = callj('POST', f'/api/project-packages/{PKG}/bom', admin, {})
chk(s == 201, f'regen za ZAVRNJEN test ({s})')
s, d = callj('GET', f'/api/quotes/{Q3}', admin)
det = d.get('data', {})
chk(det.get('status') == 'ZAVRNJEN' and not det.get('staleAt'), f'ZAVRNJEN brez invalidacije (dejansko {det.get("status")}/{det.get("staleAt")})')

# ══ F. Izrecni pregled počisti zastavico ═════════════════════════════════════
print('── F. Izrecni pregled ──')
s, d = callj('GET', f'/api/quotes/{Q1}', admin)
chk(bool(d.get('data', {}).get('staleAt')), 'Q1 ima zastavico pred pregledom')
s, _ = callj('PATCH', f'/api/quotes/{Q1}', admin, {'status': 'POSLAN'})
chk(s == 200, f'Q1 → POSLAN po pregledu ({s})')
s, d = callj('GET', f'/api/quotes/{Q1}', admin)
det = d.get('data', {})
chk(not det.get('staleAt') and not det.get('staleReason'), f'zastavica počiščena z izrecnim dejanjem (dejansko {det.get("staleAt")})')

# ══ G. Regresija ════════════════════════════════════════════════════════════
print('── G. Regresija ──')
s, d = callj('POST', '/api/quotes', admin, {'projectId': P4, 'lines': LINES, 'note': f'{TAG} klasična'})
chk(s == 201 and not d.get('data', {}).get('packageId'), f'klasična ponudba brez paketa deluje (dejansko {s})')
s, _ = callj('GET', '/api/public/health')
chk(s == 200, f'health OK (dejansko {s})')

# ══ H. Čiščenje ══════════════════════════════════════════════════════════════
print('── H. Čiščenje ──')
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'čiščenje izvedeno')

CNT = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const q=await p.quote.count({where:{note:{contains:'__TAG__'}}});
  const g=await p.projectPackage.count({where:{name:{contains:'__TAG__'}}});
  const b=await p.bom.count({where:{package:{name:{contains:'__TAG__'}}}});
  console.log('Q='+q+' P='+g+' B='+b);return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
out, _ = bun_ts(CNT)
chk('Q=0 P=0 B=0' in out, f'sledi testov odstranjene ({out.strip()})')

print()
print(f'══ SKUPAJ: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)

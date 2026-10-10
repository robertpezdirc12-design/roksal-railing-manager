#!/usr/bin/env python3
"""tests/r476.py — R476 (issue #9 §5 HOVER PARITY): PRIMERJALNI PAKETI + POPUST

Preverja:
  A) RBAC: monter (brez quotes.create) 403 na tiered paket in na spremembo
     popusta.
  B) Primerjalni paketi: neveljaven tier 400; compareCode/compare brez tier 400;
     nova skupina (compare:true) dobi CMP-kodo; pridružitev BOLJSI/PREMIUM;
     podvojen nivo v skupini 409; neobstoječa skupina 404; skupina drugega
     projekta 400; GET projekta vrne tier/compareCode.
  C) Popust na ponudbo: POST z discountPct (matematika: DDV iz osnove PO
     popustu); neveljavni odstotki 400; brez popusta = nespremenjeno;
     PATCH popusta na OSNUTEK (preračun + revizija QUOTE_DISCOUNT);
     PATCH na POSLAN 400; PATCH brez statusa in popusta 400; oboje hkrati 400.
  D) Račun iz popustljene (sprejete) ponudbe: osnova = osnova PO popustu,
     zneski konsistentni (osnova + DDV = skupaj).
  E) PDF ponudbe s popustom: 200 + predpona %PDF.
  F) Revizija PACKAGE_CREATE nosi tier + compareCode.
  G) Idempotentno čiščenje vseh testnih zapisov.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R476-TEST'
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

def audit_rows (token, project_id, limit=300):
    s, d = callj('GET', f'/api/audit?projectId={project_id}&limit={limit}', token)
    return d.get('data', []) if s == 200 else []

def audit_has (token, action, entity_id, project_id):
    return any(
        e.get('action') == action and e.get('entityId') == entity_id
        for e in audit_rows(token, project_id)
    )

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
    await p.quote.deleteMany({where:{packageId:g.id}});
    await p.projectPackage.delete({where:{id:g.id}});
  }
  const quotes=await p.quote.findMany({where:{note:{contains:'__TAG__'}}});
  for (const q of quotes) {
    await p.invoice.deleteMany({where:{quoteId:q.id}});
    await p.quoteLine.deleteMany({where:{quoteId:q.id}});
    await p.quote.delete({where:{id:q.id}});
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
codes = sorted(PROJ.keys())
P4 = PROJ.get('P-2026-004')
P5 = next((c for c in codes if c != 'P-2026-004'), None)
P5 = PROJ.get(P5) if P5 else None
chk(bool(P4), 'projekt P-2026-004 najden')
chk(bool(P5), 'drug projekt za navzkrižni test najden')

s, d = callj('GET', '/api/products?family=all', admin)
PRODUCTS = {p['sku']: p for p in d.get('data', [])}
OGR = PRODUCTS.get('OGR-P-001')
TER = PRODUCTS.get('TER-WPC-001')
chk(bool(OGR and TER), 'izdelka OGR-P-001 / TER-WPC-001 najdena')

# ══ A. RBAC ════════════════════════════════════════════════════════════════
print('── A. RBAC ──')
s, _ = callj('POST', '/api/project-packages', monter, {
    'projectId': P4, 'productId': OGR['id'], 'qty': 5, 'name': f'{TAG} A', 'tier': 'STANDARD', 'compare': True,
})
chk(s == 403, f'monter (brez quotes.create) 403 na tiered paket (dejansko {s})')

# ponudba za test popusta monterja
s, d = callj('POST', '/api/quotes', admin, {
    'projectId': P4, 'note': f'{TAG} rbac',
    'lines': [{'description': 'test', 'qty': 1, 'unitPrice': 10}],
})
chk(s == 201, f'ponudba za RBAC test ustvarjena ({s})')
Q_RBAC = d.get('data', {}).get('id')
s, _ = callj('PATCH', f'/api/quotes/{Q_RBAC}', monter, {'discountPct': 5})
chk(s == 403, f'monter 403 na spremembo popusta (dejansko {s})')

# ══ B. Primerjalni paketi ══════════════════════════════════════════════════
print('── B. Primerjalni paketi ──')
s, _ = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGR['id'], 'qty': 5, 'name': f'{TAG} B0', 'tier': 'LUKSUZNO',
})
chk(s == 400, f'neveljaven tier 400 (dejansko {s})')

s, _ = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGR['id'], 'qty': 5, 'name': f'{TAG} B0', 'compareCode': 'CMP-1999-999',
})
chk(s == 400, f'compareCode brez tier 400 (dejansko {s})')

s, _ = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGR['id'], 'qty': 5, 'name': f'{TAG} B0', 'compare': True,
})
chk(s == 400, f'compare brez tier 400 (dejansko {s})')

# nova skupina: STANDARD (ograja)
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGR['id'], 'qty': 11, 'name': f'{TAG} standard',
    'tier': 'STANDARD', 'compare': True,
})
chk(s == 201, f'STANDARD paket ustvarjen ({s})')
CMP = d.get('data', {}).get('compareCode')
PKG_STD = d.get('data', {}).get('id')
chk(bool(CMP and CMP.startswith('CMP-')), f'compareCode generiran: {CMP}')

# pridružitev: BOLJSI (ista skupina)
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGR['id'], 'qty': 11, 'name': f'{TAG} boljsi',
    'tier': 'BOLJSI', 'compareCode': CMP,
})
chk(s == 201 and d.get('data', {}).get('compareCode') == CMP, f'BOLJSI pridružen skupini ({s})')

# pridružitev: PREMIUM
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': TER['id'], 'qty': 11, 'name': f'{TAG} premium',
    'tier': 'PREMIUM', 'compareCode': CMP,
})
chk(s == 201 and d.get('data', {}).get('compareCode') == CMP, f'PREMIUM pridružen skupini ({s})')

# podvojen nivo v isti skupini → 409
s, d = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGR['id'], 'qty': 5, 'name': f'{TAG} dup',
    'tier': 'STANDARD', 'compareCode': CMP,
})
chk(s == 409, f'podvojen nivo v skupini 409 (dejansko {s})')

# neobstoječa skupina → 404
s, _ = callj('POST', '/api/project-packages', admin, {
    'projectId': P4, 'productId': OGR['id'], 'qty': 5, 'name': f'{TAG} B0',
    'tier': 'STANDARD', 'compareCode': 'CMP-1999-999',
})
chk(s == 404, f'neobstoječa skupina 404 (dejansko {s})')

# skupina drugega projekta → 400
s, _ = callj('POST', '/api/project-packages', admin, {
    'projectId': P5, 'productId': OGR['id'], 'qty': 5, 'name': f'{TAG} B0',
    'tier': 'STANDARD', 'compareCode': CMP,
})
chk(s == 400, f'skupina drugega projekta 400 (dejansko {s})')

# GET projekta vrne tier/compareCode
s, d = callj('GET', f'/api/project-packages?projectId={P4}', admin)
rows = d.get('data', [])
grp = [r for r in rows if r.get('compareCode') == CMP]
chk(len(grp) == 3, f'GET: 3 člani skupine {CMP} (dejansko {len(grp)})')
tiers = sorted(r.get('tier') for r in grp)
chk(tiers == ['BOLJSI', 'PREMIUM', 'STANDARD'], f'nivoji zapisani: {tiers}')

# revizija PACKAGE_CREATE nosi tier + compareCode
audit_found = False
for e in audit_rows(admin, P4):
    if e.get('action') == 'PACKAGE_CREATE' and e.get('entityId') == PKG_STD:
        det = e.get('detail') or {}
        if isinstance(det, str):
            try: det = json.loads(det)
            except Exception: det = {}
        audit_found = det.get('tier') == 'STANDARD' and det.get('compareCode') == CMP
        break
chk(audit_found, 'revizija PACKAGE_CREATE nosi tier + compareCode')

# ══ C. Popust na ponudbo ════════════════════════════════════════════════════
print('── C. Popust ──')
# matematika: 1000 € osnova, 10 % popust → DDV 198,00, skupaj 1.098,00
s, d = callj('POST', '/api/quotes', admin, {
    'projectId': P4, 'packageId': PKG_STD, 'note': f'{TAG} popust',
    'discountPct': 10,
    'lines': [{'description': 'Testna ograja', 'qty': 1, 'unitPrice': 1000}],
})
q = d.get('data', {})
chk(s == 201, f'ponudba s popustom ustvarjena ({s})')
chk(abs(q.get('discount', 0) - 100.0) < 0.005, f"znesek popusta 100,00 (dejansko {q.get('discount')})")
chk(abs(q.get('vat', 0) - 198.0) < 0.005, f"DDV 198,00 iz osnove po popustu (dejansko {q.get('vat')})")
chk(abs(q.get('total', 0) - 1098.0) < 0.005, f"skupaj 1.098,00 (dejansko {q.get('total')})")
chk(q.get('discountPct') == 10, f"discountPct 10 (dejansko {q.get('discountPct')})")
Q1 = q.get('id')

# neveljavni odstotki (None = JSON null → obravnavano kot "brez popusta", 201)
for bad_pct in (-1, 101, 'abc'):
    s, _ = callj('POST', '/api/quotes', admin, {
        'projectId': P4, 'note': f'{TAG} bad',
        'discountPct': bad_pct,
        'lines': [{'description': 'x', 'qty': 1, 'unitPrice': 10}],
    })
    chk(s == 400, f'neveljaven discountPct {bad_pct!r} → 400 (dejansko {s})')
s, d = callj('POST', '/api/quotes', admin, {
    'projectId': P4, 'note': f'{TAG} null',
    'discountPct': None,
    'lines': [{'description': 'x', 'qty': 1, 'unitPrice': 10}],
})
chk(s == 201 and d.get('data', {}).get('discountPct') is None,
    f'discountPct null = brez popusta, 201 (dejansko {s})')

# brez popusta → DDV iz polne osnove
s, d = callj('POST', '/api/quotes', admin, {
    'projectId': P4, 'note': f'{TAG} brez',
    'lines': [{'description': 'x', 'qty': 1, 'unitPrice': 100}],
})
q2 = d.get('data', {})
chk(s == 201 and abs(q2.get('vat', 0) - 22.0) < 0.005 and q2.get('discount') == 0,
    f'brez popusta: DDV 22,00 iz polne osnove, discount 0 (dejansko vat={q2.get("vat")}, d={q2.get("discount")})')

# PATCH popusta na OSNUTEK: 10 % → 25 %
s, d = callj('PATCH', f'/api/quotes/{Q1}', admin, {'discountPct': 25})
q3 = d.get('data', {})
chk(s == 200, f'PATCH popust 25 % na osnutku ({s})')
chk(abs(q3.get('discount', 0) - 250.0) < 0.005, f"nov znesek popusta 250,00 (dejansko {q3.get('discount')})")
chk(abs(q3.get('vat', 0) - 165.0) < 0.005, f"DDV 165,00 (750 × 22 %) (dejansko {q3.get('vat')})")
chk(abs(q3.get('total', 0) - 915.0) < 0.005, f"skupaj 915,00 (dejansko {q3.get('total')})")
chk(audit_has(admin, 'QUOTE_DISCOUNT', Q1, P4), 'revizija QUOTE_DISCOUNT')

# odstranitev popusta (0)
s, d = callj('PATCH', f'/api/quotes/{Q1}', admin, {'discountPct': 0})
q3 = d.get('data', {})
chk(s == 200 and q3.get('discountPct') is None and q3.get('discount') == 0, f'popust 0 = brez (null) ({s})')

# PATCH brez statusa in popusta → 400
s, _ = callj('PATCH', f'/api/quotes/{Q1}', admin, {})
chk(s == 400, f'PATCH brez statusa/popusta 400 (dejansko {s})')

# PATCH oboje hkrati → 400
s, _ = callj('PATCH', f'/api/quotes/{Q1}', admin, {'status': 'POSLAN', 'discountPct': 5})
chk(s == 400, f'PATCH status+popust hkrati 400 (dejansko {s})')

# neveljaven PATCH popust
s, _ = callj('PATCH', f'/api/quotes/{Q1}', admin, {'discountPct': 150})
chk(s == 400, f'PATCH popust 150 → 400 (dejansko {s})')

# PATCH popust na POSLAN → 400
s, _ = callj('PATCH', f'/api/quotes/{Q1}', admin, {'status': 'POSLAN'})
chk(s == 200, f'status POSLAN ({s})')
s, _ = callj('PATCH', f'/api/quotes/{Q1}', admin, {'discountPct': 5})
chk(s == 400, f'PATCH popust na POSLAN 400 (dejansko {s})')

# ══ D. Račun iz popustljene ponudbe ═════════════════════════════════════════
print('── D. Račun ──')
# ponudba s popustom → sprejeta → račun
s, d = callj('POST', '/api/quotes', admin, {
    'projectId': P4, 'note': f'{TAG} racun',
    'discountPct': 5,
    'lines': [{'description': 'Ograja test', 'qty': 2, 'unitPrice': 500}],
})
q4 = d.get('data', {})
chk(s == 201, f'ponudba za račun ustvarjena ({s})')
# matematika: osnova 1000, popust 50, DDV 209,00, skupaj 1.159,00
chk(abs(q4.get('discount', 0) - 50.0) < 0.005 and abs(q4.get('total', 0) - 1159.0) < 0.005,
    f"5 %: popust 50,00, skupaj 1.159,00 (dejansko d={q4.get('discount')}, t={q4.get('total')})")
Q2 = q4.get('id')
s, _ = callj('PATCH', f'/api/quotes/{Q2}', admin, {'status': 'SPREJET'})
chk(s == 200, f'ponudba SPREJET ({s})')
s, d = callj('POST', '/api/invoices', admin, {'quoteId': Q2})
inv = d.get('data', {})
chk(s == 201, f'račun izdan ({s})')
# osnova računa = 950 (po popustu), konsistentno: 950 + 209 = 1159
sub, vat, tot = inv.get('subtotal', 0), inv.get('vat', 0), inv.get('total', 0)
chk(abs(sub - 950.0) < 0.005, f'osnova računa po popustu 950,00 (dejansko {sub})')
chk(abs(sub + vat - tot) < 0.005, f'osnova + DDV = skupaj ({sub} + {vat} = {tot})')
INV = inv.get('id')

# ══ E. PDF ponudbe s popustom ═══════════════════════════════════════════════
print('── E. PDF ──')
req = urllib.request.Request(f'{BASE}/api/pdf/quote/{Q2}')
req.add_header('Authorization', 'Bearer ' + admin)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read()
        chk(r.status == 200 and body[:5] == b'%PDF-', f'PDF 200 + predpona %PDF (status {r.status}, {body[:5]})')
except urllib.error.HTTPError as e:
    chk(False, f'PDF napaka {e.code}')
except Exception as e:
    chk(False, f'PDF izjema: {e}')

# ══ G. Čiščenje ═════════════════════════════════════════════════════════════
print('── G. Čiščenje ──')
out, _ = bun_ts(CLEAN)
chk('CLEAN_DONE' in out, 'ččenje testnih zapisov (1. krog)')
# ponovno (račun/invoice iz D je vezan na Q2 — pobrišemo izrecno)
CLEAN2 = r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  await p.invoice.deleteMany({where:{note:{contains:'__TAG__'}}});
  const invs=await p.invoice.findMany({where:{}});
  const quotes=await p.quote.findMany({where:{note:{contains:'__TAG__'}}});
  const qids=new Set(quotes.map(q=>q.id));
  for(const iv of invs){ if(iv.quoteId && qids.has(iv.quoteId)) await p.invoice.delete({where:{id:iv.id}}); }
  for (const q of quotes) {
    await p.quoteLine.deleteMany({where:{quoteId:q.id}});
    await p.quote.delete({where:{id:q.id}});
  }
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
  console.log('CLEAN2_DONE');return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
out, _ = bun_ts(CLEAN2)
chk('CLEAN2_DONE' in out, 'ččenje testnih zapisov (2. krog — računi/ponudbe)')

# zahtevaj ponovni GET — skupina CMP ne sme več obstajati
s, d = callj('GET', f'/api/project-packages?projectId={P4}', admin)
left = [r for r in d.get('data', []) if TAG in (r.get('name') or '')]
chk(len(left) == 0, f'ni ostankov paketov {TAG} (ostalo {len(left)})')

print()
print(f'══ R476: {PASS} OK / {FAIL} NAPAK ══')
sys.exit(1 if FAIL else 0)

#!/usr/bin/env python3
"""tests/r447.py — R447 KONFIGURATORJI e2e (issue #7 §5, P2)

Tok: PRODUCT → VARIANT → MEASUREMENTS → COLOR/OPTIONS → CALCULATE → BOM →
STOCK CHECK → PRICE/MARGIN → QUOTE.
Preverja: dry-run izračun (planBom brez pisanja v bazo, vrstice s covered/missing,
družina v odgovoru), validacije (404/400), RBAC (monter 403, brez žetona 401),
celoten tok prek API-ja (paket s strukturiranimi vhodi calcJson.inputs →
kosovnica iz predloge × qty → rezervacija/sprostitev → osnutek ponudbe),
ohranitev inputs čez regeneracijo BOM, R443 varovalko (409) in regresijo.
Na koncu počisti testne entitete (SQLite, kot r446 — revizija ostane nemutabilna).
"""
import json, os, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS, FAIL = 0, 0

def call (method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, str(e)

def jget (path, token):
    s, b = call('GET', path, token)
    return json.loads(b) if s == 200 else None

def login (email, pw):
    s, b = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return json.loads(b)['token']

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

admin = login('admin@roksal.si', 'Admin123!')
vodja = login('vodja@roksal.si', 'Vodja123!')
monter = login('monter@roksal.si', 'Monter123!')
sklad = login('skladisce@roksal.si', 'Skladisce123!')
prod = login('proizvodnja@roksal.si', 'Proizvodnja123!')
print('── prijava: admin / vodja / monter / skladišče / proizvodnja ──')
ok('prijava 5 vlog')

projects = jget('/api/projects?limit=500', admin)['data']
p006 = next(p for p in projects if p['code'] == 'P-2026-006')   # AKTIVNI

prods = jget('/api/products?family=TERASA', admin)['data']
terasa = next(p for p in prods if p['sku'] == 'TER-WPC-001')
terasa_var = next(v for v in terasa['variants'] if v['sku'] == 'TER-WPC-001-GRA')
ograje = jget('/api/products?family=OGRAJA_PRECNA', admin)['data']
ograja = next(p for p in ograje if p['sku'] == 'OGR-P-001')
detail_terasa = jget(f"/api/products/{terasa['id']}", admin)['data']
tmpl = sorted(detail_terasa['components'], key=lambda c: c['sortOrder'])

# ══ 1. PLAN — dry-run izračun ═══════════════════════════════════════════════
print('── plan: dry-run izračun (brez pisanja) ──')
QTY_T = 30.0  # terasa: 6×4 + 3×2 = 30 m²

import subprocess

def counts ():
    # R464: provider-agnostično (Prisma — PostgreSQL in SQLite)
    r = subprocess.run(['bun', '-e', r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{const pk=await p.projectPackage.count();const bm=await p.bom.count();
console.log(JSON.stringify({pk,bm}));await p.$disconnect();})();
'''], capture_output=True, text=True, cwd=REPO,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
    assert r.returncode == 0, r.stderr[:300]
    d = json.loads(r.stdout.strip().splitlines()[-1])
    return d['pk'], d['bm']

before = counts()

s, b = call('POST', '/api/project-packages/plan', admin, {'productId': terasa['id'], 'variantId': terasa_var['id'], 'qty': QTY_T})
plan = json.loads(b)['data'] if s == 200 else None
chk(s == 200 and plan is not None, f'plan dry-run 200 ({s})')
chk(plan and plan['family']['code'] == 'TERASA' and plan['family']['unit'] == 'm2', 'plan vrača družino (code/unit)')
chk(plan and plan['variant'] and plan['variant']['sku'] == 'TER-WPC-001-GRA', 'plan vrača varianto')
chk(plan and plan['qty'] == QTY_T and plan['unit'] == 'm2', 'plan qty/unit')
chk(plan and len(plan['lines']) == len(tmpl), f'vrstice = predloga ({len(plan["lines"]) if plan else 0} = {len(tmpl)})')
line_by_sku = {l['sku']: l for l in (plan['lines'] if plan else [])}
tmpl_ok = all(
    abs(line_by_sku[c['item']['sku']]['qty'] - round(c['qty'] * QTY_T, 2)) < 0.011
    for c in tmpl if c['item']['sku'] in line_by_sku
)
chk(tmpl_ok, 'količine vrstic = predloga × qty')
chk(all(('covered' in l and 'missing' in l and 'stockQty' in l) for l in (plan['lines'] if plan else [])), 'vrstice imajo zalogo (covered/missing/stockQty)')
chk(all(l['missing'] == max(0, round(l['qty'] - l['stockQty'], 2)) for l in (plan['lines'] if plan else [])), 'missing = max(0, qty − zaloga)')
chk(plan and plan['totalSale'] == round((plan['salePriceUnit'] + plan['montazaUnit']) * QTY_T, 2), 'totalSale = (prodajna + montaža) × qty')
chk(plan and plan['margin'] == round(plan['totalSale'] - plan['materialCost'], 2), 'marža = prodaja − material')
chk(plan and plan['priceSource'], f"vir cene: {plan['priceSource'] if plan else '?'}")

after = counts()
chk(after == before, 'dry-run NE piše v bazo (paketi/BOM nespremenjeni)')

# includeOptional=false → brez neobveznih vrstic
s, b = call('POST', '/api/project-packages/plan', admin, {'productId': terasa['id'], 'qty': QTY_T, 'includeOptional': False})
plan_no = json.loads(b)['data'] if s == 200 else None
n_opt = len([c for c in tmpl if c['optional']])
chk(s == 200 and plan_no and len(plan_no['lines']) == len(tmpl) - n_opt, f'includeOptional=false izpusti neobvezne ({len(plan_no["lines"]) if plan_no else "?"} = {len(tmpl)} − {n_opt})')

# validacije
s, _ = call('POST', '/api/project-packages/plan', admin, {'productId': 'ne-obstaja', 'qty': 5})
chk(s == 404, f'napačen productId → 404 ({s})')
s, _ = call('POST', '/api/project-packages/plan', admin, {'productId': terasa['id'], 'qty': 0})
chk(s == 400, f'qty ≤ 0 → 400 ({s})')
s, _ = call('POST', '/api/project-packages/plan', admin, {'productId': terasa['id']})
chk(s == 400, f'manjka qty → 400 ({s})')
s, _ = call('POST', '/api/project-packages/plan', admin, {'productId': terasa['id'], 'variantId': 'tudji', 'qty': 5})
chk(s == 400, f'tuja varianta → 400 ({s})')
s, _ = call('POST', '/api/project-packages/plan', monter, {'productId': terasa['id'], 'qty': 5})
chk(s == 403, f'MONTER 403 na plan — marža ostaja v pisarni ({s})')
s, _ = call('POST', '/api/project-packages/plan', None, {'productId': terasa['id'], 'qty': 5})
chk(s == 401, f'brez žetona 401 ({s})')
s, _ = call('POST', '/api/project-packages/plan', sklad, {'productId': terasa['id'], 'qty': 5})
chk(s == 403, f'SKLADIŠČE 403 na plan ({s})')
s, b = call('POST', '/api/project-packages/plan', vodja, {'productId': terasa['id'], 'qty': QTY_T})
chk(s == 200, f'VODJA 200 na plan ({s})')

# ══ 2. CEL OTOK: paket s strukturiranimi vhodi → BOM → rezervacija → ponudba ═
print('── celoten tok: paket → BOM → zaloga → ponudba ──')
inputs_t = {
    'familyCode': 'TERASA', 'form': 'm2', 'qty': QTY_T, 'qtySource': 'izracunano',
    'segments': [
        {'dolzina': 6, 'sirina': 4, 'povrsina': 24.0},
        {'dolzina': 3, 'sirina': 2, 'povrsina': 6.0},
    ],
    'podlaga': 'Beton', 'padecPct': 1.5, 'roboviM': 14.5,
    'visinskeRazlike': '2 stopnice × 17 cm', 'opombe': 'R447 e2e — terasa',
}
s, b = call('POST', '/api/project-packages', admin, {
    'projectId': p006['id'], 'productId': terasa['id'], 'variantId': terasa_var['id'],
    'name': 'R447 e2e — Terasa WPC Grafit', 'qty': QTY_T, 'unit': 'm2',
    'status': 'KONFIGURACIJA', 'note': 'R447 e2e testni paket (terasa)',
    'calcJson': {'inputs': inputs_t, 'plan': plan},
})
pkg_t = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and pkg_t and pkg_t['status'] == 'KONFIGURACIJA', f'paket ustvarjen v KONFIGURACIJI ({s}, {pkg_t["code"] if pkg_t else "?"})')
chk(pkg_t and pkg_t['unit'] == 'm2', 'enota paketa iz produkta (m2)')

# calcJson.inputs se vrne (pisarna z quotes.create)
pkgs = jget(f"/api/project-packages?projectId={p006['id']}", admin)['data']
mine = next(p for p in pkgs if p['id'] == pkg_t['id'])
calc = json.loads(mine['calcJson']) if mine['calcJson'] else {}
chk(calc.get('inputs', {}).get('segments') == inputs_t['segments'], 'strukturirani vhodi shranjeni v calcJson.inputs')
chk(calc.get('plan', {}).get('product', {}).get('sku') == 'TER-WPC-001', 'dry-run izračun shranjen v calcJson.plan')
chk(calc.get('inputs', {}).get('podlaga') == 'Beton', 'družinska polja (podlaga) shranjena')

# RBAC na paketih
s, _ = call('POST', '/api/project-packages', monter, {'projectId': p006['id'], 'productId': terasa['id'], 'qty': 1})
chk(s == 403, f'MONTER 403 na ustvarjanje paketa ({s})')
s, _ = call('POST', '/api/project-packages', admin, {'projectId': p006['id'], 'productId': terasa['id'], 'qty': 1, 'calcJson': [1, 2]})
chk(s == 400, f'calcJson kot tabela zavrnjen ({s})')
s, _ = call('POST', '/api/project-packages', admin, {'projectId': p006['id'], 'productId': terasa['id'], 'qty': 1, 'calcJson': {'a': 1}, 'note': 'R447 e2e — pomožni (validacija calcJson)'})
chk(s == 201, f'navadni calcJson objekt sprejet ({s})')

# monter NE vidi kalkulacije (calcJson null brez quotes.create)
pkgs_m = jget(f"/api/project-packages?projectId={p006['id']}", monter)
chk(pkgs_m is not None, 'monter dostop do seznama paketov projekta (projects.read)')

# BOM iz predloge
s, b = call('POST', f"/api/project-packages/{pkg_t['id']}/bom", admin, {})
bom_t = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and bom_t and bom_t['bom']['status'] == 'OSNUTEK', f'kosovnica generirana ({s}, {bom_t["bom"]["code"] if bom_t else "?"})')
chk(bom_t and len(bom_t['bom']['lines']) == len(tmpl), 'BOM vrstice = predloga')
if bom_t:
    bom_lines = {l['sku']: l for l in bom_t['bom']['lines']}
    chk(all(abs(bom_lines[c['item']['sku']]['qty'] - round(c['qty'] * QTY_T, 2)) < 0.011 for c in tmpl if c['item']['sku'] in bom_lines), 'BOM količine = predloga × qty')
    chk(bom_t['calc'].get('inputs', {}).get('segments') == inputs_t['segments'], 'inputs OHRANJENI čez generacijo BOM (calc.inputs)')

# GET /api/bom/[id] regresija (R443: reservedGlobal/available)
s, b = call('GET', f"/api/bom/{bom_t['bom']['id']}", admin)
d = json.loads(b)['data'] if s == 200 else None
chk(s == 200 and d and all('reservedGlobal' in l and 'available' in l for l in d['lines']), f'GET /api/bom/[id] z reservedGlobal/available ({s})')

# ══ 2b. REZERVACIJSKI SMOKE (R443 regresija) na majhno količino ═════════════
# (glavni paket 30 m² presega razpoložljivo zalogo VIJ-INOX-M8 — fail-closed
#  rezervacija bi vrnila 409; smoke zato teče na ločenem paketu 5 m²)
print('── rezervacijski smoke (R443) ──')
QTY_S = 5.0
s, b = call('POST', '/api/project-packages', admin, {
    'projectId': p006['id'], 'productId': terasa['id'],
    'name': 'R447 e2e — rezervacijski smoke', 'qty': QTY_S, 'status': 'KONFIGURACIJA',
    'note': 'R447 e2e testni paket (smoke)',
    'calcJson': {'inputs': {'familyCode': 'TERASA', 'form': 'm2', 'qty': QTY_S}, 'plan': None},
})
pkg_s = json.loads(b)['data'] if s == 201 else None
s, b = call('POST', f"/api/project-packages/{pkg_s['id']}/bom", admin, {})
bom_s = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and bom_s, f'smoke kosovnica generirana ({s})')

s, b = call('POST', f"/api/bom/{bom_s['bom']['id']}/reserve", sklad, {})
chk(s == 201, f'rezervacija kosovnice (inventory.write) ({s})')
s, _ = call('POST', f"/api/project-packages/{pkg_s['id']}/bom", admin, {})
chk(s == 409, f'varovalka R443: regeneracija z aktivnimi rezervacijami → 409 ({s})')
s, b = call('POST', f"/api/bom/{bom_s['bom']['id']}/release", sklad, {})
chk(s == 200, f'sprostitev rezervacij ({s})')
BOM_REGRESSION_ID = bom_s['bom']['id']

# osnutek ponudbe iz izračuna
unit_price = round(plan['salePriceUnit'] + plan['montazaUnit'], 2)
s, b = call('POST', '/api/quotes', admin, {
    'projectId': p006['id'],
    'note': f"R447 e2e — osnutek iz konfiguratorja ({pkg_t['code']})",
    'lines': [{'description': f"{terasa['name']} — {terasa_var['name']} ({terasa_var['sku']})", 'qty': QTY_T, 'unitPrice': unit_price}],
})
quote = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and quote, f'osnutek ponudbe ustvarjen ({s}, {quote["code"] if quote else "?"})')
chk(quote and abs(quote['subtotal'] - round(QTY_T * unit_price, 2)) < 0.011, 'subtotal ponudbe = qty × (prodajna + montaža)')
chk(quote and abs(quote['vat'] - round(quote['subtotal'] * 0.22, 2)) < 0.011, 'DDV 22 % strežniško')
chk(quote and quote['project'] and quote['project']['code'] == 'P-2026-006', 'ponudba vezana na projekt')

# ══ 3. OGRAJA tok (m obrazec: segmenti + razmik + vrata + način) ════════════
print('── ograja: m obrazec ──')
QTY_O = 16.0  # 12.5 + 3.5
inputs_o = {
    'familyCode': 'OGRAJA_PRECNA', 'form': 'm', 'qty': QTY_O, 'qtySource': 'izracunano',
    'segments': [{'dolzina': 12.5, 'visina': 1.1}, {'dolzina': 3.5, 'visina': 1.1}],
    'razmikStebrovM': 2.9, 'vrataKos': 1, 'nacinPritrditve': 'TALNA',
    'opombe': 'R447 e2e — ograja',
}
s, b = call('POST', '/api/project-packages/plan', admin, {'productId': ograja['id'], 'qty': QTY_O})
plan_o = json.loads(b)['data'] if s == 200 else None
chk(s == 200 and plan_o and plan_o['family']['code'] == 'OGRAJA_PRECNA' and plan_o['unit'] == 'm', f'plan za ograjo (m) ({s})')

s, b = call('POST', '/api/project-packages', admin, {
    'projectId': p006['id'], 'productId': ograja['id'],
    'name': 'R447 e2e — Prečna ograja ALU', 'qty': QTY_O, 'unit': 'm',
    'status': 'KONFIGURACIJA', 'note': 'R447 e2e testni paket (ograja)',
    'calcJson': {'inputs': inputs_o, 'plan': plan_o},
})
pkg_o = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and pkg_o and pkg_o['unit'] == 'm', f'ograjni paket ustvarjen ({s})')
s, b = call('POST', f"/api/project-packages/{pkg_o['id']}/bom", admin, {})
bom_o = json.loads(b)['data'] if s == 201 else None
tmpl_o = sorted(jget(f"/api/products/{ograja['id']}", admin)['data']['components'], key=lambda c: c['sortOrder'])
# R475 (issue #9 §5): paket z segmenti v vhodih → komponente s segmentno vlogo
# dobijo VRSTICO NA SEGMENT (seg-1/seg-2), brez vloge ostanejo predloga × qty.
n_seg = len(inputs_o['segments'])
exp_lines = sum((n_seg if c.get('segmentRole') else 1) for c in tmpl_o)
chk(s == 201 and bom_o and len(bom_o['bom']['lines']) == exp_lines,
    f'ograjni BOM: vloge × {n_seg} segmenti + ostalo = {exp_lines} vrstic (R475)')

# ══ 4. KALKULATOR ODSTRANJEN iz navigacije ══════════════════════════════════
print('── kalkulator odstranjen, konfigurator registriran ──')
with open('src/lib/nav-registry.ts', encoding='utf-8') as f:
    nav_src = f.read()
chk("id: 'kalkulator'" not in nav_src, 'nav-registry NE vsebuje zavihka kalkulator')
chk("id: 'konfigurator'" in nav_src, 'nav-registry vsebuje zavihek konfigurator')
chk(nav_src.index("id: 'konfigurator'") < nav_src.index("id: 'signatura'"), 'konfigurator je v sekciji ZAJEM (kjer je bil kalkulator)')
with open('src/components/roksal/module-view.tsx', encoding='utf-8') as f:
    mv_src = f.read()
chk('modules/kalkulator' not in mv_src and 'modules/konfigurator' in mv_src, 'module-view naloži konfigurator (ne kalkulatorja)')
import os
chk(not os.path.exists('src/components/roksal/modules/kalkulator.tsx'), 'datoteka kalkulator.tsx izbrisana')

# ══ 5. regresija: osnovne rute ══════════════════════════════════════════════
print('── regresija ──')
for path, tok, expect in [
    (f"/api/project-packages?projectId={p006['id']}", admin, 200),
    (f"/api/bom/{BOM_REGRESSION_ID}", admin, 200),
    ('/api/picking', sklad, 200),
    ('/api/products?family=TERASA', admin, 200),
    ('/api/product-families', admin, 200),
    ('/api/quotes', admin, 200),
    ('/api/stock', sklad, 200),
]:
    s, _ = call('GET', path, tok)
    chk(s == expect, f'{path} → {s}')

# revizija: PACKAGE_CREATE/BOM_GENERATE zapisana
audit = jget(f"/api/audit?projectId={p006['id']}&limit=200", admin)
actions = set(e['action'] for e in (audit['data'] if audit else []))
chk('PACKAGE_CREATE' in actions and 'BOM_GENERATE' in actions, 'revizija PACKAGE_CREATE + BOM_GENERATE')

# ══ 6. ČIŠČENJE testnih podatkov (SQLite; revizija ostane nemutabilna) ═══════
print('── čiščenje testnih podatkov ──')
try:
    r = subprocess.run(['bun', '-e', r'''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const pkgs=await p.projectPackage.findMany({where:{OR:[{note:{contains:'R447 e2e'}},{name:{contains:'R447 e2e'}}]},select:{id:true}});
  let nBoms=0,nLines=0;
  for (const pkg of pkgs){
    const boms=await p.bom.findMany({where:{packageId:pkg.id},select:{id:true}});
    for (const b of boms){
      await p.stockReservation.deleteMany({where:{bomId:b.id}});
      const dl=await p.bomLine.deleteMany({where:{bomId:b.id}});
      nLines+=dl.count;nBoms++;
    }
    await p.projectPackage.delete({where:{id:pkg.id}});
  }
  const quotes=await p.quote.findMany({where:{note:{contains:'R447 e2e'}},select:{id:true}});
  for (const q of quotes){
    await p.quoteLine.deleteMany({where:{quoteId:q.id}});
    await p.quote.delete({where:{id:q.id}});
  }
  console.log(JSON.stringify({pkgs:pkgs.length,boms:nBoms,lines:nLines,quotes:quotes.length}));
  await p.$disconnect();
})().catch(e=>{console.error(e);process.exit(1)});
'''], capture_output=True, text=True, cwd=REPO,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
    assert r.returncode == 0, r.stderr[:300]
    st = json.loads(r.stdout.strip().splitlines()[-1])
    ok(f"počiščeno: {st['pkgs']} paketov, {st['boms']} kosovnic ({st['lines']} vrstic), {st['quotes']} ponudb")
except Exception as e:
    bad(f'čiščenje ni uspelo: {e}')

# ══ povzetek ════════════════════════════════════════════════════════════════
print(f'\n══ R447 e2e: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)

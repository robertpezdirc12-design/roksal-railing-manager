#!/usr/bin/env python3
"""tests/r464-pricing.py — R464 ENOTEN SOURCE-OF-TRUTH ZA CENE (GitHub issue #1, P0 sklop 1)

Preverja, da viz/3D konfigurator NIČ več ne nosi poslovnih cen:
  A) Izvorna koda: v src/components/roksal/modules/viz-3d.tsx NI več konstant
     POST_PRICE / ROCNIK_PRICE_M / STEKLO_PRICE_M2 / MONTAZA_PRICE_M /
     PRIPRAVA_PCT / PROFIL_OCENA_M niti funkcije izracunajCeno; viz.tsx cene
     dobi prek POST /api/price-lists/calculate (strežniški pricing core).
  B) Izračun uporablja cene iz cenika: POST /api/price-lists/calculate vrača
     postavke, katerih unitPrice == vrednost PriceRule pravila (KONFIG:* v
     aktivnem PRODAJNA ceniku) in skupaj = vsota postavk (matematika).
  C) Sprememba cene v ceniku (POST /api/price-lists/[id]/rules — idempotentni
     upsert po key) SPREMENI rezultat izračuna (STEBER, PRIPRAVA, STEKLO).
  D) Profil: izbran profil → Profile.pricePerM iz kataloga (label z SKU);
     brez profila → KONFIG:PROFIL_OCENA pravilo; napačen profileId → 404.
  E) RBAC: brez žetona 401; monter (catalog.read) 200 na calculate;
     monter 403 na spreminjanje pravil (price.override).
  F) Validacije: napačen tip/lengthCm/posts → 400; neznan key → 400;
     key + productId hkrati → 400.
  G) Regresija: health, ceniki, katalog, planBom (r447 tok) še delujejo.
  H) Čiščenje: vsa 6 KONFIG pravila povrnjena na semenske vrednosti in
     končni izračun enak izhodiščnemu (idempotentno).
"""
import json, os, sys, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R464-PRICE'
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
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
print('── prijava: admin / monter / skladišče ──')
ok('prijava 3 vlog')

# ══ 1. IZVORNA KODA — hardcoded cene odstranjene iz UI/3D ═════════════════════
print('── izvorna koda: viz-3d čista geometrija ──')
with open(os.path.join(REPO, 'src/components/roksal/modules/viz-3d.tsx'), encoding='utf-8') as f:
    viz3d_src = f.read()
for konst in ['POST_PRICE', 'ROCNIK_PRICE_M', 'STEKLO_PRICE_M2', 'MONTAZA_PRICE_M',
              'PRIPRAVA_PCT', 'PROFIL_OCENA_M']:
    chk(konst not in viz3d_src, f'viz-3d.tsx NE vsebuje konstante {konst}')
chk('izracunajCeno' not in viz3d_src, 'viz-3d.tsx NE vsebuje izracunajCeno (funkcija odstranjena)')
chk('CenaPostavka' not in viz3d_src and 'CenaVhod' not in viz3d_src, 'viz-3d.tsx NE vsebuje cenovnih tipov')

with open(os.path.join(REPO, 'src/components/roksal/modules/viz.tsx'), encoding='utf-8') as f:
    viz_src = f.read()
chk('izracunajCeno' not in viz_src, 'viz.tsx NE uvaža izracunajCeno')
chk('/api/price-lists/calculate' in viz_src, 'viz.tsx kliče POST /api/price-lists/calculate')
chk('35 €/m' not in viz_src, 'viz.tsx nima hardcoded montažne cene v oznaki')
for konst in ['POST_PRICE', 'ROCNIK_PRICE_M', 'STEKLO_PRICE_M2', 'MONTAZA_PRICE_M',
              'PRIPRAVA_PCT', 'PROFIL_OCENA_M']:
    chk(konst not in viz_src, f'viz.tsx NE vsebuje konstante {konst}')

with open(os.path.join(REPO, 'src/components/roksal/modules/konfigurator.tsx'), encoding='utf-8') as f:
    konf_src = f.read()
for konst in ['POST_PRICE', 'ROCNIK_PRICE_M', 'STEKLO_PRICE_M2', 'MONTAZA_PRICE_M',
              'PRIPRAVA_PCT', 'PROFIL_OCENA_M']:
    chk(konst not in konf_src, f'konfigurator.tsx NE vsebuje konstante {konst}')

# ══ 2. priprava: aktivni PRODAJNA cenik + semenske vrednosti pravil ═══════════
print('── cenik: KONFIG pravila (idempotentni upsert) ──')
lists = jget('/api/price-lists', admin)
chk(lists is not None, 'GET /api/price-lists 200')
prodajna = next((l for l in (lists['data'] if lists else []) if l['type'] == 'PRODAJNA'), None)
chk(prodajna is not None, f"aktiven PRODAJNA cenik najden ({prodajna['name'] if prodajna else '?'})")
LIST_ID = prodajna['id']

# semenske (kanonske) vrednosti — enake prisma/seed-r442.cjs
CANON = {'STEBER': 45, 'ROCNIK': 15, 'STEKLO': 85, 'MONTAZA': 35, 'PRIPRAVA': 15, 'PROFIL_OCENA': 85}

def set_rule (token, key, price, expect_ok=True):
    s, b = call('POST', f'/api/price-lists/{LIST_ID}/rules', token, {'key': key, 'price': price})
    return s, (json.loads(b)['data'] if s in (200, 201) else None)

for key, price in CANON.items():
    s, rule = set_rule(admin, key, price)
    chk(s in (200, 201) and rule is not None and abs(rule['price'] - price) < 1e-9,
        f'upsert pravila {key} = {price} ({s})')
    chk(rule is not None and rule['note'] == f'KONFIG:{key}', f'{key}: note = KONFIG:{key}')

# neznan key → 400; key + productId → 400
s, _ = call('POST', f'/api/price-lists/{LIST_ID}/rules', admin, {'key': 'NEVELJAVEN', 'price': 1})
chk(s == 400, f'neznan konfiguracijski key → 400 ({s})')
s, _ = call('POST', f'/api/price-lists/{LIST_ID}/rules', admin, {'key': 'STEBER', 'price': 1, 'productId': 'x'})
chk(s == 400, f'key + productId hkrati → 400 ({s})')

# GET cenik razkrije vsa 6 generičnih pravil (brez podvajanja)
lists2 = jget('/api/price-lists', admin)
prodajna2 = next((l for l in lists2['data'] if l['id'] == LIST_ID), None)
konfig_rules = [r for r in prodajna2['rules'] if (r.get('note') or '').startswith('KONFIG:')]
chk(len(konfig_rules) == 6, f'cenik vsebuje natanko 6 KONFIG pravil, brez podvajanj ({len(konfig_rules)})')

# ══ 3. OSNOVNI IZRAČUN — cene iz cenika (OGRAJA) ══════════════════════════════
print('── izračun: postavke iz cenika (OGRAJA 4 m) ──')
CFG = {'tip': 'OGRAJA', 'lengthCm': 400, 'heightCm': 110, 'posts': 5,
       'handrail': True, 'montaza': True}
s, b = call('POST', '/api/price-lists/calculate', admin, CFG)
d = json.loads(b)['data'] if s == 200 else None
chk(s == 200 and d is not None, f'calculate 200 ({s})')
lines = {p['key']: p for p in d['postavke']} if d else {}
chk(set(lines) == {'profil', 'stebri', 'rocnik', 'priprava', 'montaza'},
    f"postavke: profil/stebri/rocnik/priprava/montaža ({sorted(lines)})")
chk(abs(lines['profil']['unitPrice'] - CANON['PROFIL_OCENA']) < 1e-9
    and abs(lines['profil']['total'] - 4 * CANON['PROFIL_OCENA']) < 1e-9, 'profil = KONFIG:PROFIL_OCENA × m')
chk(lines['profil']['label'].startswith('Profil (ocena)'), 'profil brez izbora: label „Profil (ocena)"')
chk(abs(lines['stebri']['unitPrice'] - 45) < 1e-9 and abs(lines['stebri']['total'] - 5 * 45) < 1e-9, 'stebri = KONFIG:STEBER × kos')
chk(abs(lines['rocnik']['unitPrice'] - 15) < 1e-9 and abs(lines['rocnik']['total'] - 4 * 15) < 1e-9, 'ročnik = KONFIG:ROCNIK × m')
chk(abs(lines['montaza']['unitPrice'] - 35) < 1e-9 and abs(lines['montaza']['total'] - 4 * 35) < 1e-9, 'montaža = KONFIG:MONTAZA × m')
sub = 4 * 85 + 5 * 45 + 4 * 15
chk(abs(lines['priprava']['total'] - round(sub * 0.15, 2)) < 1e-9, f'priprava = 15 % vmesne vsote ({lines["priprava"]["total"]})')
chk(abs(d['skupaj'] - round(sub * 1.15 + 4 * 35, 2)) < 1e-9, f'skupaj = vsota postavk ({d["skupaj"]})')
chk(abs(d['dolzinaM'] - 4) < 1e-9, 'dolzinaM = 4')
chk(d['unitPrices'].get('STEBER') == 45 and d['unitPrices'].get('PRIPRAVA') == 0.15, 'unitPrices: STEBER 45, PRIPRAVA 0,15')
chk('cenik' in d['priceSource'], f"priceSource omenja cenik ({d['priceSource']})")

# ══ 4. SPREMEMBA CENE V CENIKU → SPREMEMBA IZRAČUNA ═══════════════════════════
print('── mutacija cenika spreminja izračun ──')
set_rule(admin, 'STEBER', 55)
s, b = call('POST', '/api/price-lists/calculate', admin, CFG)
d2 = json.loads(b)['data'] if s == 200 else None
l2 = {p['key']: p for p in d2['postavke']}
chk(d2 and abs(l2['stebri']['unitPrice'] - 55) < 1e-9 and abs(l2['stebri']['total'] - 5 * 55) < 1e-9,
    'STEBER 45 → 55: postavka stebrov sledi ceniku')
# skupaj raste za 5×(55−45) na stebrih + 15 % priprava na ta prirastek
chk(d2 and abs(d2['skupaj'] - d['skupaj'] - round(5 * 10 * 1.15, 2)) < 1e-9,
    'skupaj se je povečal za 5 × (55−45) × (1 + 15 % priprave)')
BASELINE_SKUPAJ = d2['skupaj'] if d2 else None

set_rule(admin, 'PRIPRAVA', 20)
s, b = call('POST', '/api/price-lists/calculate', admin, CFG)
d3 = json.loads(b)['data'] if s == 200 else None
l3 = {p['key']: p for p in d3['postavke']}
sub3 = 4 * 85 + 5 * 55 + 4 * 15
chk(d3 and '20 %' in l3['priprava']['label'], 'PRIPRAVA 15 → 20: label „Priprava in rezerva (20 %)"')
chk(d3 and abs(l3['priprava']['total'] - round(sub3 * 0.20, 2)) < 1e-9, 'priprava = 20 % vmesne vsote')
chk(d3 and abs(d3['skupaj'] - round(sub3 * 1.20 + 4 * 35, 2)) < 1e-9, 'skupaj po novem pripravnem deležu')

# BALUSTRADA — steklo iz cenika + mutacija STEKLO
print('── balustrada: steklo iz cenika ──')
CFG_B = {'tip': 'BALUSTRADA', 'lengthCm': 300, 'heightCm': 100, 'posts': 4,
         'handrail': True, 'montaza': False}
s, b = call('POST', '/api/price-lists/calculate', admin, CFG_B)
db_ = json.loads(b)['data'] if s == 200 else None
lb = {p['key']: p for p in db_['postavke']}
chk(s == 200 and 'steklo' in lb and 'montaza' not in lb, 'balustrada ima steklo, brez montaže (toggle off)')
chk(abs(lb['steklo']['qty'] - 3) < 1e-9 and abs(lb['steklo']['total'] - 3 * 85) < 1e-9, 'steklo = KONFIG:STEKLO × m²')
set_rule(admin, 'STEKLO', 95)
s, b = call('POST', '/api/price-lists/calculate', admin, CFG_B)
db2 = json.loads(b)['data'] if s == 200 else None
lb2 = {p['key']: p for p in db2['postavke']}
chk(db2 and abs(lb2['steklo']['unitPrice'] - 95) < 1e-9 and abs(lb2['steklo']['total'] - 3 * 95) < 1e-9,
    'STEKLO 85 → 95: postavka stekla sledi ceniku')

# ročnik izklopljen → postavka izpuščena
CFG_H = dict(CFG, handrail=False)
s, b = call('POST', '/api/price-lists/calculate', admin, CFG_H)
dh = json.loads(b)['data'] if s == 200 else None
lh = {p['key']: p for p in dh['postavke']}
chk(s == 200 and 'rocnik' not in lh, 'handrail=false → brez postavke ročnik')

# ══ 5. PROFIL IZ KATALOGA ════════════════════════════════════════════════════
print('── profil: Profile.pricePerM iz kataloga ──')
catalog = jget('/api/catalog', admin)
profiles = catalog['data'] if catalog else []
chk(len(profiles) > 0, 'katalog profilov neprazen')
prof = profiles[0]
s, b = call('POST', '/api/price-lists/calculate', admin, dict(CFG, profileId=prof['id']))
dp = json.loads(b)['data'] if s == 200 else None
lp = {p['key']: p for p in dp['postavke']} if dp else {}
chk(s == 200 and abs(lp['profil']['unitPrice'] - prof['pricePerM']) < 1e-9,
    f"izbran profil: unitPrice = Profile.pricePerM ({prof['pricePerM']})")
chk(lp and lp['profil']['label'].startswith(prof['sku']), 'label profila nosi SKU iz kataloga')
chk('katalog' in dp['priceSource'], f"priceSource omenja katalog ({dp['priceSource']})")

s, _ = call('POST', '/api/price-lists/calculate', admin, dict(CFG, profileId='ne-obstaja'))
chk(s == 404, f'napačen profileId → 404 ({s})')

# ══ 6. RBAC ══════════════════════════════════════════════════════════════════
print('── RBAC (fail-closed) ──')
s, _ = call('POST', '/api/price-lists/calculate', None, CFG)
chk(s == 401, f'brez žetona → 401 ({s})')
s, _ = call('POST', '/api/price-lists/calculate', monter, CFG)
chk(s == 200, f'monter (catalog.read) → 200 ({s})')
s, _ = call('POST', '/api/price-lists/calculate', skladisce, CFG)
chk(s == 200, f'skladišče (catalog.read) → 200 ({s})')
s, _ = call('POST', f'/api/price-lists/{LIST_ID}/rules', monter, {'key': 'STEBER', 'price': 1})
chk(s == 403, f'monter 403 na spreminjanje pravil (price.override) ({s})')

# ══ 7. VALIDACIJE ════════════════════════════════════════════════════════════
print('── validacije ──')
for body, msg in [
    ({'tip': 'LUKNJA', 'lengthCm': 400, 'heightCm': 110, 'posts': 5}, 'napačen tip'),
    ({'lengthCm': 400, 'heightCm': 110, 'posts': 5}, 'manjka tip'),
    ({'tip': 'OGRAJA', 'lengthCm': 10, 'heightCm': 110, 'posts': 5}, 'lengthCm < 20'),
    ({'tip': 'OGRAJA', 'lengthCm': 7000, 'heightCm': 110, 'posts': 5}, 'lengthCm > 6000'),
    ({'tip': 'OGRAJA', 'lengthCm': 400, 'heightCm': 10, 'posts': 5}, 'heightCm < 20'),
    ({'tip': 'OGRAJA', 'lengthCm': 400, 'heightCm': 110}, 'manjka posts'),
    ({'tip': 'OGRAJA', 'lengthCm': 400, 'heightCm': 110, 'posts': 0}, 'posts < 1'),
    ({'tip': 'OGRAJA', 'lengthCm': 'veliko', 'heightCm': 110, 'posts': 5}, 'lengthCm ni število'),
]:
    s, _ = call('POST', '/api/price-lists/calculate', admin, body)
    chk(s == 400, f'{msg} → 400 ({s})')

# ══ 8. REGRESIJA ═════════════════════════════════════════════════════════════
print('── regresija ──')
for path, tok in [('/api/public/health', admin), ('/api/price-lists', admin),
                  ('/api/catalog', admin), ('/api/quotes', admin)]:
    s, _ = call('GET', path, tok)
    chk(s == 200, f'GET {path} → 200 ({s})')
# planBom (r447 tok) — cene iz cenika še vedno delujejo
products = jget('/api/products?family=OGRAJA_PRECNA', admin)
ogr = next(p for p in products['data'] if p['sku'] == 'OGR-P-001')
s, b = call('POST', '/api/project-packages/plan', admin, {'productId': ogr['id'], 'qty': 16})
plan = json.loads(b)['data'] if s == 200 else None
chk(s == 200 and plan and plan['priceSource'], f'planBom (r447 tok) → 200, vir: {plan["priceSource"] if plan else "?"}')
chk(plan and abs(plan['totalSale'] - round((plan['salePriceUnit'] + plan['montazaUnit']) * 16, 2)) < 1e-9, 'planBom: totalSale = (prodajna + montaža) × qty')

# ══ 9. ČIŠČENJE — povrni semenske vrednosti (idempotentno) ════════════════════
print('── čiščenje: povrnjene semenske vrednosti ──')
for key, price in CANON.items():
    s, rule = set_rule(admin, key, price)
    chk(s in (200, 201) and abs(rule['price'] - price) < 1e-9, f'{key} povrnjen na {price}')
s, b = call('POST', '/api/price-lists/calculate', admin, CFG)
dfin = json.loads(b)['data'] if s == 200 else None
chk(s == 200 and dfin and abs(dfin['skupaj'] - round((4 * 85 + 5 * 45 + 4 * 15) * 1.15 + 4 * 35, 2)) < 1e-9,
    f'končni izračun = kanonska osnova ({dfin["skupaj"] if dfin else "?"})')

# v bazi ostane natanko 6 KONFIG pravil v prodajnem ceniku (brez podvajanj)
try:
    import subprocess
    r = subprocess.run(['bun', '-e', """
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{const nAll=await p.priceRule.count({where:{note:{contains:'KONFIG:'}}});
const nProd=await p.priceRule.count({where:{note:{contains:'KONFIG:'},active:true,productId:null,itemId:null,priceList:{is:{type:'PRODAJNA'}}}});
console.log(JSON.stringify({nAll,nProd}));await p.$disconnect();})();
"""], capture_output=True, text=True, cwd=REPO,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
    assert r.returncode == 0, r.stderr[:300]
    st = json.loads(r.stdout.strip().splitlines()[-1])
    chk(st['nAll'] == 6 and st['nProd'] == 6, f"db: natanko 6 aktivnih KONFIG pravil ({st['nAll']}/{st['nProd']})")
except Exception as e:
    bad(f'db preverba ni uspela: {e}')

# ══ povzetek ════════════════════════════════════════════════════════════════
print(f'\n══ R464-pricing e2e: {PASS} ✓ / {FAIL} ✗ ══')
sys.exit(1 if FAIL else 0)

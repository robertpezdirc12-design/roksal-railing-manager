#!/usr/bin/env python3
"""tests/r452.py — R452 AVTOMATSKI PREDLOG MATERIALA e2e (issue #7 §16 P3)

Preverja: GET /api/material-suggestions (vrata inventory.read) — struktura
(items + rules z demandStatuses/replenishFactor), VSA polja vsakega itema,
math invarianta izračunana IZ ODGOVORA SAMOGA (available = max(physical −
reserved, 0); missing = max(demand − available, 0)), izbira samo manjk/nizka
zaloge, sortiranje po missing × unitCost padajoče, RBAC (brez žetona 401;
monter 200 — ima inventory.read), konzistentnost z /api/bom (povpraševanje),
/api/stock (fizična/rezervirana/reorderAt), /api/inventory/lots + /api/
material-prices (unitCost uteženo povprečje + namig dobavitelja), tok
ustvarjanja naročila prek obstoječe /api/material-orders (201, koda NAR-leto,
vrstice, revizija MATERIAL_ORDER_CREATE), monter 403 na POST, regresijo in
samočiščenje (testni BOM + lot + naročila se pobrišejo — idempotentno).
"""
import json, os, subprocess, sys, urllib.request, urllib.error
from datetime import datetime

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R452-TEST'
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

def bun (script):
    """Požene PrismaClient skripto prek bun -e (vzorec iz tests/r450.py)."""
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       env={**__import__('os').environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
    return 'FIXTURE_DONE' in r.stdout or 'CLEAN_DONE' in r.stdout, r.stderr[:300]

# ── FIXTURE: testni BOM (povpraševanje) + testni lot (unitCost/dobavitelj) ────
# deterministično: ALU-OKR-60-6M (f=8, reorder=15) → missing 17, low; LEP-MS
# (f=4, reorder=10) → missing 8, low; WPC-DES-150 (f=260) → missing 178.22 ob
# dodatnem povpraševanju 400. Lot na ALU: qty 10 × 12.5 → unitCost 12.5.
FIXTURE = '''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  // 1) more ostankov prejšnjih zagonov (idempotenca)
  await p.bom.deleteMany({where:{id:'test-bom-r452'}});
  await p.stockLot.deleteMany({where:{id:'test-lot-r452-alu'}});
  const old=await p.materialOrder.findMany({where:{note:{contains:'__TAG__'}},select:{id:true}});
  for(const o of old){await p.materialOrderLine.deleteMany({where:{orderId:o.id}});await p.materialOrder.deleteMany({where:{id:o.id}});}
  // R542: detail je jsonb — podniz po serializiranem jsonb (ista semantika contains)
  await p.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE "detail"::text LIKE ANY($1::text[])', ['%__TAG__%', '%BOM-TEST-R452%']);
  // 2) svež fixture
  const alu=await p.inventoryItem.findUnique({where:{sku:'ALU-OKR-60-6M'}});
  const lep=await p.inventoryItem.findUnique({where:{sku:'LEP-MS'}});
  const wpc=await p.inventoryItem.findUnique({where:{sku:'WPC-DES-150'}});
  const prod=await p.product.findFirst();
  if(!alu||!lep||!wpc||!prod) throw new Error('manjkajo izhodiščni artikli/produkt');
  await p.bom.create({data:{id:'test-bom-r452',code:'BOM-TEST-R452',productId:prod.id,qty:1,unit:'kos',status:'OSNUTEK',note:'__TAG__ — avtomatsko počiščen',lines:{create:[
    {itemId:alu.id,qty:25,unit:alu.unit,sortOrder:0},
    {itemId:lep.id,qty:12,unit:lep.unit,sortOrder:1},
    {itemId:wpc.id,qty:400,unit:wpc.unit,sortOrder:2},
  ]}}});
  const sup=await p.supplier.findFirst({where:{name:{contains:'AluPro'}}}) ?? await p.supplier.findFirst();
  await p.stockLot.create({data:{id:'test-lot-r452-alu',itemId:alu.id,qty:10,unitCost:12.5,supplierId:sup.id}});
  console.log('FIXTURE_DONE');return p.$disconnect();
})()
'''.replace('__TAG__', TAG)

CLEAN = '''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  await p.bom.deleteMany({where:{id:'test-bom-r452'}});
  await p.stockLot.deleteMany({where:{id:'test-lot-r452-alu'}});
  const os=await p.materialOrder.findMany({where:{note:{contains:'__TAG__'}},select:{id:true}});
  for(const o of os){await p.materialOrderLine.deleteMany({where:{orderId:o.id}});await p.materialOrder.deleteMany({where:{id:o.id}});}
  await p.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE "detail"::text LIKE ANY($1::text[])', ['%__TAG__%', '%BOM-TEST-R452%'].concat(__MREZE__));
  console.log('CLEAN_DONE');return p.$disconnect();
})()
'''.replace('__TAG__', TAG)

created_codes = []  # kode ustvarjenih testnih naročil (za brisanje revizij)

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
skladisce = login('skladisce@roksal.si', 'Skladisce123!')
print('── prijava: admin / monter / skladišče ──')
ok('prijava 3 vlog')

done, err = bun(FIXTURE)
chk(done, f'fixture (testni BOM + lot) ustvarjen {"" if done else " — " + err}')
if not done:
    print(f'═══ R452: {PASS} ✓ / {FAIL} ✗ ═══'); sys.exit(1)

# ══ 1. STRUKTURA + MATH + IZBIRA + SORTIRANJE ════════════════════════════════
print('── admin: struktura / math / izbira / sortiranje ──')
FIELDS = ['itemId', 'sku', 'name', 'unit', 'demand', 'reserved', 'physical', 'available',
          'missing', 'lowStock', 'suggestedQty', 'unitCost', 'supplierId', 'supplierName', 'boms']

s, b = call('GET', '/api/material-suggestions', admin)
chk(s == 200, f'GET /api/material-suggestions → {s} (admin)')
d = json.loads(b)['data'] if s == 200 else None
chk(d is not None and 'generatedAt' in d and 'items' in d and 'rules' in d,
    'data.generatedAt + items + rules prisotni')
chk(d and d['rules'].get('demandStatuses') == ['OSNUTEK', 'POTRJEN', 'REZERVIRAN'],
    'rules.demandStatuses = [OSNUTEK, POTRJEN, REZERVIRAN]')
chk(d and d['rules'].get('replenishFactor') == 2, 'rules.replenishFactor = 2')
chk(d and isinstance(d['generatedAt'], str) and d['generatedAt'][:2] == '20', 'generatedAt je ISO čas')

items = d['items'] if d else []
chk(len(items) >= 3, f'fixture prisoten v predlogih ({len(items)} itemov ≥ 3)')
chk(all(set(i) >= set(FIELDS) for i in items), 'vsak item ima VSA polja')
chk(all(isinstance(i['lowStock'], bool) for i in items), 'lowStock je boolean')
chk(all(isinstance(i['boms'], int) and i['boms'] >= 0 for i in items), 'boms je števec ≥ 0')

# math invarianta IZ ODGOVORA SAMOGA
math_ok = True
for i in items:
    if abs(i['available'] - max(i['physical'] - i['reserved'], 0)) > 0.011: math_ok = False; break
    if abs(i['missing'] - max(i['demand'] - i['available'], 0)) > 0.011: math_ok = False; break
chk(math_ok, 'invarianta: available = max(physical − reserved, 0) in missing = max(demand − available, 0)')

# izbira: SAMO manjk > 0 ALI lowStock
chk(all(i['missing'] > 0 or i['lowStock'] for i in items), 'izbira: vsak item ima missing > 0 ali lowStock')
by_sku = {i['sku']: i for i in items}
alu, lep, wpc = by_sku.get('ALU-OKR-60-6M'), by_sku.get('LEP-MS'), by_sku.get('WPC-DES-150')
chk(alu is not None and abs(alu['missing'] - 17) < 0.011, f'ALU-OKR-60-6M manjka 17 ({alu and alu["missing"]})')
chk(lep is not None and abs(lep['missing'] - 8) < 0.011, f'LEP-MS manjka 8 ({lep and lep["missing"]})')
chk(wpc is not None and abs(wpc['missing'] - 178.22) < 0.011, f'WPC-DES-150 manjka 178.22 ({wpc and wpc["missing"]})')
chk(alu and abs(alu['suggestedQty'] - 22) < 0.011, f'ALU predlagano 22 (2×15−8 > manjka 17) ({alu and alu["suggestedQty"]})')
chk(lep and abs(lep['suggestedQty'] - 16) < 0.011, f'LEP predlagano 16 (2×10−4) ({lep and lep["suggestedQty"]})')
chk(wpc and abs(wpc['suggestedQty'] - 178.22) < 0.011, f'WPC predlagano 178.22 (= manjka, ni low) ({wpc and wpc["suggestedQty"]})')

# sortiranje po (missing × unitCost) padajoče, nato po imenu
keys = [(i['missing'] * i['unitCost'], i['name']) for i in items]
noninc = all(keys[k][0] + 1e-9 >= keys[k + 1][0] for k in range(len(keys) - 1))
chk(noninc, 'sortirano padajoče po missing × unitCost')
tie_ok = all(not (abs(keys[k][0] - keys[k + 1][0]) < 1e-9 and keys[k][1] > keys[k + 1][1]) for k in range(len(keys) - 1))
chk(tie_ok, 'izenačeni (×0) urejeni po imenu naraščajoče')
chk(items[0]['sku'] == 'ALU-OKR-60-6M', 'ALU (17×12.5) je prvi — največja vrednost primanjkljaja')
chk(alu and alu['boms'] == 1 and wpc and wpc['boms'] == 2,
    f'boms: ALU 1 (samo testni), WPC 2 (BOM-2026-001 + testni) ({alu and alu["boms"]}/{wpc and wpc["boms"]})')

# ══ 2. RBAC ══════════════════════════════════════════════════════════════════
print('── RBAC ──')
s, _ = call('GET', '/api/material-suggestions')
chk(s == 401, f'brez žetona 401 ({s})')
s, b = call('GET', '/api/material-suggestions', monter)
chk(s == 200, f'monter (ima inventory.read) 200 — samo branje ({s})')
msug = json.loads(b)['data']['items'] if s == 200 else []
chk(len(msug) == len(items), 'monter vidi enak seznam predlogov (read-only)')

# ══ 3. KONZISTENTNOST z /api/bom (povpraševanje) ════════════════════════════
print('── konzistenca: /api/bom + /api/stock + loti/ceniki ──')
demand_sum = {}
bom_count = {}
for st in ['OSNUTEK', 'POTRJEN', 'REZERVIRAN']:
    j = jget(f'/api/bom?status={st}&limit=500', admin)
    chk(j is not None, f'GET /api/bom?status={st} 200')
    if j:
        for bom in j['data']:
            for ln in bom['lines']:
                demand_sum[ln['itemId']] = demand_sum.get(ln['itemId'], 0) + ln['qty']
                bom_count.setdefault(ln['itemId'], set()).add(bom['id'])
dem_ok = all(abs(i['demand'] - demand_sum.get(i['itemId'], 0)) < 0.011 for i in items)
chk(dem_ok, 'demand vsakega predloga = Σ vrstic odprtih BOM-ov (/api/bom)')
bomc_ok = all(i['boms'] == len(bom_count.get(i['itemId'], set())) for i in items)
chk(bomc_ok, 'boms = število odprtih kosovnic, ki povprašujejo artikel')

# fizična/rezervirana/reorderAt prek /api/stock
stock = jget('/api/stock', admin)
chk(stock is not None, 'GET /api/stock 200')
srow = {r['id']: r for r in (stock['data'] if stock else [])}
phys_ok = all(abs(i['physical'] - srow[i['itemId']]['physical']) < 0.011 for i in items if i['itemId'] in srow)
chk(phys_ok, 'physical vsakega predloga = fizična zaloga iz /api/stock')
res_ok = all(abs(i['reserved'] - srow[i['itemId']]['reserved']) < 0.011 for i in items if i['itemId'] in srow)
chk(res_ok, 'reserved vsakega predloga = rezervirano iz /api/stock')
low_ok = all(i['lowStock'] == (srow[i['itemId']]['reorderAt'] > 0 and i['physical'] <= srow[i['itemId']]['reorderAt'])
             for i in items if i['itemId'] in srow)
chk(low_ok, 'lowStock = reorderAt > 0 IN fizična ≤ reorderAt (meja iz /api/stock)')
sug_ok = all(abs(i['suggestedQty'] - round(max(i['missing'], (2 * srow[i['itemId']]['reorderAt'] - i['physical']) if i['lowStock'] else 0, 0), 2)) < 0.011
             for i in items if i['itemId'] in srow)
chk(sug_ok, 'suggestedQty = max(manjka, 2×reorderAt − fizična pri nizki zalogi, 0)')

# unitCost: uteženo povprečje pozitivnih lotov → fallback zadnja MaterialPrice
lots = jget('/api/inventory/lots?limit=200', admin)
prices = jget('/api/material-prices?limit=1000', admin)
chk(lots is not None and prices is not None, 'GET /api/inventory/lots + /api/material-prices 200')
if lots and prices:
    lots_by = {}
    for l in lots['data']:
        lots_by.setdefault(l['itemId'], []).append(l)
    price_by = {}
    for p in prices['data']:  # orderBy createdAt desc → prvi zadetek = zadnja cena
        if p['itemId'] and p['itemId'] not in price_by:
            price_by[p['itemId']] = p['price']
    uc_ok = True; sup_ok = True
    for i in items:
        pos = [l for l in lots_by.get(i['itemId'], []) if l['qty'] > 0]
        if pos:
            q = sum(l['qty'] for l in pos)
            exp = round(sum(l['qty'] * l['unitCost'] for l in pos) / q, 2) if q > 0 else 0
        else:
            exp = round(price_by.get(i['itemId'], 0), 2)
        if abs(i['unitCost'] - exp) > 0.011: uc_ok = False
        # namig dobavitelja: najpogostejši med loti (konec rute ima supplier.name)
        cnt = {}
        for l in lots_by.get(i['itemId'], []):
            sup = (l.get('supplier') or {}).get('name')
            if sup: cnt[sup] = cnt.get(sup, 0) + 1
        if cnt:
            exp_sup = sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
            if i['supplierName'] != exp_sup: sup_ok = False
        elif pos:
            if i['supplierId'] is not None: sup_ok = False  # loti brez dobavitelja → namig null
    chk(uc_ok, 'unitCost = uteženo povprečje pozitivnih lotov (fallback zadnja cena)')
    chk(sup_ok, 'supplierName = najpogostejši dobavitelj med loti')
    alu_sup = (lots_by.get(alu['itemId'], [{}])[0].get('supplier') or {}).get('name')
    chk(alu and alu['supplierName'] == alu_sup == 'AluPro d.o.o.',
        f'ALU namig: lot → AluPro d.o.o. ({alu and alu["supplierName"]})')

# ══ 4. TOK USTVARJANJA naročila (ponovna uporaba /api/material-orders) ═══════
print('── tok ustvarjanja naročila ──')
take = items[:3]
chk(len(take) >= 1 and all(i['itemId'] for i in take), 'izbranih do 3 predlogov z itemId')
note = f'{TAG} naročilo iz predlogov'
s, b = call('POST', '/api/material-orders', admin, {
    'note': note,
    'lines': [{'itemId': i['itemId'], 'itemName': i['name'], 'qty': i['suggestedQty'],
               'unit': i['unit'], 'unitPrice': i['unitCost']} for i in take],
})
chk(s == 201, f'POST /api/material-orders (admin, iz predlogov) → {s}')
order = json.loads(b).get('data') if s == 201 else None
import re
chk(order is not None and re.match(r'^NAR-\d{4}-\d{3,}$', order.get('code', '')) is not None,
    f'koda NAR-<leto>-… ({order and order.get("code")})')
chk(order is not None and order.get('note') == note, 'note shranjen')
chk(order is not None and len(order.get('lines', [])) == len(take), f'število vrstic = {len(take)}')
chk(order is not None and all(ln.get('itemId') for ln in order.get('lines', [])), 'vrstice nosijo itemId (eksplicitne povezave)')
year = str(datetime.now().year)
chk(order is not None and order['code'].startswith(f'NAR-{year}-'), f'koda nosi tekoče leto {year}')
created = order['code'] if order else None

orders = jget('/api/material-orders', admin)
chk(orders is not None and created and any(o['code'] == created for o in orders['data']),
    'GET /api/material-orders vsebuje novo naročilo')
audit = jget('/api/audit?action=MATERIAL_ORDER_CREATE&limit=50', admin)
chk(audit is not None, 'GET /api/audit?action=MATERIAL_ORDER_CREATE 200')
found_audit = False
for e in (audit['data'] if audit else []):
    det = e.get('detail') if isinstance(e.get('detail'), dict) else {}  # R542: detail objekt
    if det.get('code') == created:
        found_audit = True
        chk(e.get('entity') == 'materialOrder', 'revizija: entity = materialOrder')
        chk(det.get('positions') == len(take), f'revizija: positions = {len(take)}')
chk(found_audit, 'revizija MATERIAL_ORDER_CREATE obstaja za novo kodo')

# monter NIMA inventory.write → 403
s, _ = call('POST', '/api/material-orders', monter, {
    'note': f'{TAG} monter', 'lines': [{'itemId': items[0]['itemId'], 'itemName': items[0]['name'], 'qty': 1, 'unitPrice': 1}],
})
chk(s == 403, f'monter POST /api/material-orders → 403 ({s})')

# ══ 5. REGRESIJA ═════════════════════════════════════════════════════════════
print('── regresija ──')
for path in ['/api/bom', '/api/stock', '/api/material-orders', '/api/reports?type=zaloga',
             '/api/inventory', '/api/suppliers']:
    s, _ = call('GET', path, admin)
    chk(s == 200, f'GET {path} 200 ({s})')

# ══ 6. ČIŠČENJE (idempotenca) ═══════════════════════════════════════════════
print('── čiščenje ──')
codes = [created] if created else []
# pobriši tudi morebitna naročila iz prejšnjih zagonov (note TAG) + revizije po kodah
# R542: revizije brišemo po podnizu serializiranega jsonb detaila (ne Prisma contains)
mreze = [json.dumps(f'%{c}%') for c in codes]
clean = CLEAN.replace('__MREZE__', ','.join(mreze))
done, err = bun(clean)
chk(done, f'čiščenje (BOM + lot + naročila + revizije) {"" if done else " — " + err}')

orders = jget('/api/material-orders', admin)
chk(orders is not None and not any(o['code'] in codes or TAG in (o.get('note') or '') for o in orders['data']),
    'po čiščenju GET /api/material-orders NE vsebuje testnih kod/naročil')
sug2 = jget('/api/material-suggestions', admin)
chk(sug2 is not None and all(i['sku'] != 'WPC-DES-150' for i in sug2['data']['items']),
    'po čiščenju WPC-DES-150 ni več v predlogih (fixture povpraševanje odstranjeno)')
chk(sug2 is not None and all(i['missing'] == 0 for i in sug2['data']['items']),
    'po čiščenju noben predlog nima manjka (osnovno stanje: samo nizke zaloge)')

print(f'═══ R452: {PASS} ✓ / {FAIL} ✗ ═══')
sys.exit(1 if FAIL else 0)

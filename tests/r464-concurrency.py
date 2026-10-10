#!/usr/bin/env python3
"""tests/r464-concurrency.py — R464 ZAŠČITA STOCK/RESERVATION TOKOV e2e (issue #1, P1 sklop 4)

REALEN sočasen scenarij (python threading + barrier) proti živi API:
  1) neurje 10 vzporednih rezervacij istega materiala z omejeno zalogo
     (40 kos, vrstica po 5) → natanko 8 uspe (201), 2 zavrnjena (409);
     Σ rezervirano ≤ razpoložljivo, fizična/rezervirana/razpoložljiva
     ostanejo konzistentni, brez 5xx;
  2) vzporedna dvojna sprostitev iste kosovnice → natanko ena 200, druga 409;
  3) vzporedna sprostitev preostalih kosovnic → vse 200;
  4) vzporedno ustvarjanje pickinga iste kosovnice → ena 201, druga 409;
  5) vzporeden zaključek pickinga iste liste (isti payload) → ena 200, druga 409;
  6) delni pobir (rezervacija se zmanjša, ne porabi) — semantika R443;
  7) atomarna pogojna izdaja: zaloga zmanjšana tako, da ne pokriva vseh treh
     sočasnih zaključkov pickinga → 2 uspeta, 1 zavrnjen (409), fizična NIKOLI
     negativna;
  8) vzporedni ročni popravki (INVENTURA) čez zalogo → 3 × 200, 3 × 400;
  9) vzporeden sprejem lotov → brez izgubljenih posodobitev (vsota točna);
 10) vzporedna vračila (VRACILO) → vsa 201, seštevanje brez izgube.
Na koncu: globalna preverba invariant (fizična ≥ 0; rezervirana ≤ fizična za
testna artikel) in čiščenje vseh R464-CNC sledi (idempotentno).
"""
import json, os, subprocess, sys, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R464-CNC'
PASS, FAIL = 0, 0

ITEM_A = 'r464c-a'          # 40 kos — glavni testni artikel
ITEM_B = 'r464c-b'          # 12 kos — za picking/delni pobir
BOMS_STORM = [f'r464c-bom-s{i:02d}' for i in range(1, 11)]
BOM_PICK = 'r464c-bom-pick'
BOM_PART = 'r464c-bom-part'
BOMS_OD = [f'r464c-bom-od{i}' for i in (1, 2, 3)]
ALL_BOMS = BOMS_STORM + [BOM_PICK, BOM_PART] + BOMS_OD

def call (method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
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
    """Požene PrismaClient skripto prek bun -e (vzorec iz tests/r452.py)."""
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
    return 'FIXTURE_DONE' in r.stdout or 'CLEAN_DONE' in r.stdout, r.stderr[:400]

def db_json (script):
    """Izvede skripto in vrne zadnjo vrstico stdout kot JSON."""
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True,
                       cwd=REPO,
                       env={**os.environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
    assert r.returncode == 0, 'bun skripta: ' + r.stderr[:400]
    return json.loads(r.stdout.strip().splitlines()[-1])

def parallel (fns):
    """Zažene vse klice Vzporedno (barrier zagotovi sočasen start)."""
    with ThreadPoolExecutor(max_workers=len(fns)) as ex:
        return list(ex.map(lambda f: f(), fns))

def stock_row (token, item_id):
    for r in (jget('/api/stock?q=' + TAG, token) or {}).get('data', []):
        if r['id'] == item_id: return r
    return None

# ══ 0. prijava + ogrevanje rut (dev prevajanje izven časovno občutljivih odsekov) ══
admin = login('admin@roksal.si', 'Admin123!')
sklad = login('skladisce@roksal.si', 'Skladisce123!')
print('── prijava: admin / skladišče ──')
ok('prijava 2 vlogi (inventory.write)')

# ══ 1. FIXTURE: sveža omejena zaloga + 14 kosovnic (idempotentno) ══════════
FIXTURE = '''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
const BOMS=__BOMS__;const IDS=[__ITEM_A__,__ITEM_B__];
(async()=>{
  // 1) more ostankov prejšnjih zagonov (idempotenca)
  const picks=await p.pickingList.findMany({where:{bomId:{in:BOMS}},select:{id:true}});
  await p.auditLog.deleteMany({where:{OR:[{detail:{contains:'__TAG__'}},{detail:{contains:'r464c-'}},{entityId:{in:[...BOMS,...IDS,...picks.map(x=>x.id)]}}]}});
  await p.pickingList.deleteMany({where:{bomId:{in:BOMS}}});
  await p.stockReservation.deleteMany({where:{OR:[{bomId:{in:BOMS}},{itemId:{in:IDS}}]}});
  await p.bom.deleteMany({where:{id:{in:BOMS}}});
  await p.stockMovement.deleteMany({where:{itemId:{in:IDS}}});
  await p.stockLot.deleteMany({where:{itemId:{in:IDS}}});
  await p.materialPrice.deleteMany({where:{itemId:{in:IDS}}});
  await p.inventoryItem.deleteMany({where:{id:{in:IDS}}});
  // 2) svež fixture
  await p.inventoryItem.create({data:{id:'r464c-a',sku:'R464-CNC-A',name:'R464 CNC sočasnost A',unit:'kos',qty:40,reorderAt:0,location:'R464'}});
  await p.inventoryItem.create({data:{id:'r464c-b',sku:'R464-CNC-B',name:'R464 CNC sočasnost B',unit:'kos',qty:12,reorderAt:0,location:'R464'}});
  const prod=await p.product.findFirst();
  if(!prod) throw new Error('manjka produkt');
  const mk=(id,code,lines,status)=>p.bom.create({data:{id,code,productId:prod.id,qty:1,unit:'kos',status,note:'__TAG__ — sočasnost',lines:{create:lines}}});
  for(let i=1;i<=10;i++) await mk('r464c-bom-s'+String(i).padStart(2,'0'),'BOM-R464-CNC-S'+String(i).padStart(2,'0'),[{itemId:'r464c-a',qty:5,unit:'kos',sortOrder:0}],'OSNUTEK');
  await mk('r464c-bom-pick','BOM-R464-CNC-PICK',[{itemId:'r464c-a',qty:5,unit:'kos',sortOrder:0},{itemId:'r464c-b',qty:4,unit:'kos',sortOrder:1}],'OSNUTEK');
  await mk('r464c-bom-part','BOM-R464-CNC-PART',[{itemId:'r464c-b',qty:4,unit:'kos',sortOrder:0}],'OSNUTEK');
  for(const i of [1,2,3]) await mk('r464c-bom-od'+i,'BOM-R464-CNC-OD'+i,[{itemId:'r464c-a',qty:5,unit:'kos',sortOrder:0}],'OSNUTEK');
  console.log('FIXTURE_DONE');
})().catch(e=>{console.error(e);process.exit(1)});
'''.replace('__BOMS__', json.dumps(ALL_BOMS)).replace('__ITEM_A__', json.dumps(ITEM_A)).replace('__ITEM_B__', json.dumps(ITEM_B)).replace('__TAG__', TAG)

done, err = bun(FIXTURE)
assert done, 'fixture: ' + err
print('── fixture: 2 artikla (40 + 12 kos), 14 kosovnic ──')
ok('fixture zapisan (idempotentno čiščenje + sveži podatki)')

r = stock_row(admin, ITEM_A)
chk(r and abs(r['physical'] - 40) < 0.001 and r['reserved'] == 0, 'izhodišče A: fizična 40, rezervirana 0')

# ── ogrevanje rut (compilation on demand na dev strežniku) ──
s, _ = call('GET', '/api/stock?q=' + TAG, admin)
assert s == 200, f'warmup stock: {s}'
for m, p_, b in [
    ('POST', f'/api/bom/{BOMS_OD[0]}/reserve', None),
    ('POST', '/api/picking', {'bomId': BOMS_OD[0]}),
]:
    s, _ = call(m, p_, admin, b)
    assert s in (200, 201), f'warmup {p_}: {s}'
# picking ustvarjen zgoraj → prekliči + sprosti (PATCH picking + release topla)
pick_warm = jget('/api/picking?limit=200', admin)['data']
pw = next((x for x in pick_warm if x.get('bomId') == BOMS_OD[0]), None)
s, _ = call('PATCH', f"/api/picking/{pw['id']}", admin, {'action': 'cancel'})
assert s == 200, f'warmup cancel: {s}'
s, _ = call('POST', f'/api/bom/{BOMS_OD[0]}/release', admin)
assert s == 200, f'warmup release: {s}'
# ostale mutacijske rute ogrejemo z NEVELJAVNIMI klici (brez DB pisanja)
for m, p_, b in [
    ('PATCH', '/api/inventory', {'id': ITEM_A, 'delta': 0}),
    ('POST', '/api/inventory/lots', {'itemId': ITEM_A, 'qty': -1, 'unitCost': 1}),
    ('POST', '/api/stock/returns', {'itemId': ITEM_A, 'qty': -1}),
]:
    s, _ = call(m, p_, admin, b)
    assert s == 400, f'warmup {p_}: {s}'
ok('vse mutacijske rute ogrete (rezervacija → picking → preklic → sprostitev)')

# ══ 2. NEURJE: 10 vzporednih rezervacij istega materiala (40 kos / vrstica 5) ══
print('── neurje 10 vzporednih rezervacij (zaloga 40, vrstica 5) ──')
barrier = threading.Barrier(10)
def reserve_one (bom_id, tok):
    def run ():
        barrier.wait()
        return call('POST', f'/api/bom/{bom_id}/reserve', tok)
    return run

results = parallel([
    reserve_one(bom_id, admin if i % 2 == 0 else sklad)
    for i, bom_id in enumerate(BOMS_STORM)
])
statuses = [s for s, _ in results]
ok201 = [BOMS_STORM[i] for i, s in enumerate(statuses) if s == 201]
ok409 = [BOMS_STORM[i] for i, s in enumerate(statuses) if s == 409]

chk(all(s in (201, 409) for s in statuses), f'brez 5xx/0 (statusi: {sorted(set(statuses))})')
chk(len(ok201) == 8, f'natanko 8 uspešnih rezervacij ({len(ok201)} × 201; pričakovano 8 = 40/5)')
chk(len(ok409) == 2, f'2 zavrnjeni (409) — zaloga ne pokriva več ({len(ok409)} × 409)')
chk(all('Razpoložljiva zaloga' in json.loads(b).get('error', '') for s, b in results if s == 409),
    'zavrnjeni dobijo smiselno napako (razpoložljiva < potrebno)')

r = stock_row(admin, ITEM_A)
chk(abs(r['physical'] - 40) < 0.001, f'fizična NESPREMENJENA po rezervacijah ({r["physical"]})')
chk(abs(r['reserved'] - 40) < 0.001, f'rezervirana = 40 ({r["reserved"]})')
chk(abs(r['available']) < 0.001, f'razpoložljiva = 0 ({r["available"]})')
chk(abs(r['physical'] - r['reserved'] - r['available']) < 0.01, 'invarianta fizična − rezervirana = razpoložljiva')

db = db_json('''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const agg=await p.stockReservation.aggregate({where:{itemId:'r464c-a',status:'AKTIVNA'},_sum:{qty:true},_count:true});
  console.log(JSON.stringify({sum:agg._sum.qty??0,count:agg._count}));
  await p.$disconnect();
})();
''')
chk(abs(db['sum'] - 40) < 0.001 and db['count'] == 8, f"DB: Σ AKTIVNA rezervacij = 40 v 8 vrsticah ({db['sum']}, {db['count']})")
chk(db['sum'] <= 40, 'Σ rezervirano ≤ fizična zaloga (40)')

# ══ 3. VZPOREDNA DVODNA SPROSTITEV iste kosovnice ══════════════════════════
print('── sočasna dvojna sprostitev iste kosovnice ──')
victim = ok201[0]
b2 = threading.Barrier(2)
def release_victim ():
    b2.wait()
    return call('POST', f'/api/bom/{victim}/release', admin)
rel = parallel([release_victim, release_victim])
rel_s = sorted(s for s, _ in rel)
chk(rel_s == [200, 409], f'natanko ena sprostitev uspe, druga 409 ({rel_s})')
chk(all('REZERVIRAN' in json.loads(x).get('error', '') for s, x in rel if s == 409),
    'zavrnjena sprostitev: smiselna napaka (ni v statusu REZERVIRAN)')
r = stock_row(admin, ITEM_A)
chk(abs(r['reserved'] - 35) < 0.001, f'rezervirana zmanjšana na 35 ({r["reserved"]})')

# ══ 4. VZPOREDNA SPROSTITEV preostalih 7 kosovnic ══════════════════════════
rest = [x for x in ok201[1:]]
b7 = threading.Barrier(7)
def release_rest (bom_id):
    def run ():
        b7.wait()
        return call('POST', f'/api/bom/{bom_id}/release', admin)
    return run
rel = parallel([release_rest(b) for b in rest])
chk(all(s == 200 for s, _ in rel), f'vseh 7 sprostitev uspešnih ({sorted(set(s for s, _ in rel))})')
r = stock_row(admin, ITEM_A)
chk(r['reserved'] == 0 and abs(r['available'] - 40) < 0.001, f'po sprostitvah: rezervirana 0, razpoložljiva 40 ({r["reserved"]}/{r["available"]})')
db = db_json('''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const agg=await p.stockReservation.aggregate({where:{itemId:'r464c-a',status:'AKTIVNA'},_sum:{qty:true}});
  console.log(JSON.stringify({sum:agg._sum.qty??0}));
  await p.$disconnect();
})();
''')
chk(db['sum'] == 0, f"DB: ni aktivnih rezervacij A ({db['sum']})")

# ══ 5. VZPOREDNO USTVARJANJE PICKINGA iste kosovnice ═══════════════════════
print('── rezervacija PICK kosovnice + sočasno ustvarjanje pickinga ──')
s, _ = call('POST', f'/api/bom/{BOM_PICK}/reserve', admin)
chk(s == 201, f'kosovnica PICK rezervirana ({s})')

b2 = threading.Barrier(2)
def create_pick ():
    b2.wait()
    return call('POST', '/api/picking', admin, {'bomId': BOM_PICK})
pk = parallel([create_pick, create_pick])
pk_s = sorted(s for s, _ in pk)
chk(pk_s == [201, 409], f'natanko ena picking lista, druga 409 ({pk_s})')
chk(all('že teče picking' in json.loads(x).get('error', '') for s, x in pk if s == 409),
    'zavrnjeni picking: smiselna napaka (že teče)')
PICK_ID = next(json.loads(x)['data']['id'] for s, x in pk if s == 201)

# ══ 6. VZPOREDEN ZAKLJUČEK pickinga (isti payload — atomarna zahteva statusa) ═
print('── sočasen zaključek iste picking liste ──')
pl = jget(f'/api/picking/{PICK_ID}', admin)['data']
full_lines = [{'lineId': l['id'], 'qtyPicked': l['qtyNeeded']} for l in pl['lines']]
b2 = threading.Barrier(2)
def complete_same ():
    b2.wait()
    return call('PATCH', f'/api/picking/{PICK_ID}', admin, {'action': 'complete', 'lines': full_lines})
cp = parallel([complete_same, complete_same])
cp_s = sorted(s for s, _ in cp)
chk(cp_s == [200, 409], f'natanko en zaključek, drugi 409 ({cp_s})')
chk(all('že zaključen' in json.loads(x).get('error', '') for s, x in cp if s == 409),
    'zavrnjen zaključek: smiselna napaka (že zaključen)')
chk(jget(f'/api/bom/{BOM_PICK}', admin)['data']['status'] == 'PORABLJEN', 'kosovnica PICK = PORABLJEN')
r_a, r_b = stock_row(admin, ITEM_A), stock_row(admin, ITEM_B)
chk(abs(r_a['physical'] - 35) < 0.001 and r_a['reserved'] == 0, f'A po izdaji: fizična 35, rezervirana 0 ({r_a["physical"]}/{r_a["reserved"]})')
chk(abs(r_b['physical'] - 8) < 0.001 and r_b['reserved'] == 0, f'B po izdaji: fizična 8, rezervirana 0 ({r_b["physical"]}/{r_b["reserved"]})')

# ══ 7. DELNI POBIR (rezervacija se zmanjša, ne porabi) ══════════════════════
print('── delni pobir na PART kosovnici (2 od 4) ──')
s, _ = call('POST', f'/api/bom/{BOM_PART}/reserve', admin)
chk(s == 201, f'kosovnica PART rezervirana ({s})')
s, b = call('POST', '/api/picking', admin, {'bomId': BOM_PART})
assert s == 201, f'picking PART: {s} {b}'
PART_ID = json.loads(b)['data']['id']
pl = jget(f'/api/picking/{PART_ID}', admin)['data']
part_line = pl['lines'][0]
s, b = call('PATCH', f'/api/picking/{PART_ID}', admin, {'action': 'complete', 'lines': [{'lineId': part_line['id'], 'qtyPicked': 2}]})
done_pick = json.loads(b) if s == 200 else {}
chk(s == 200 and done_pick.get('data', {}).get('issued') == 1, 'delni pobir uspešen (izdana 1 vrstica)')
r_b = stock_row(admin, ITEM_B)
chk(abs(r_b['physical'] - 6) < 0.001, f'fizična B po delnem pobiru 6 ({r_b["physical"]})')
chk(abs(r_b['reserved'] - 2) < 0.001, f'rezervacija B zmanjšana na 2 (ne porabljena) ({r_b["reserved"]})')
mv = jget(f'/api/stock/movements?itemId={ITEM_B}', admin)['data'][0]
chk(mv['type'] == 'IZDAJA' and abs(mv['qty'] + 2) < 0.001, 'zadnje gibanje B = IZDAJA −2')

# ══ 8. ATOMARNA POGOJNA IZDAJA: 3 sočasni zaključki, zaloga pokriva samo 2 ═
print('── 3 sočasni zaključki pickingov ob zalogi 13 (vsak potrebuje 5) ──')
for b_ in BOMS_OD:
    s, x = call('POST', f'/api/bom/{b_}/reserve', admin)
    assert s == 201, f'rezervacija {b_}: {s} {x}'
    s, x = call('POST', '/api/picking', admin, {'bomId': b_})
    assert s == 201, f'picking {b_}: {s} {x}'
od_picks = {}
for b_ in BOMS_OD:
    for plst in jget('/api/picking?limit=200', admin)['data']:
        if plst.get('bomId') == b_ and plst['status'] == 'PRIPRAVLJENA':
            od_picks[b_] = plst['id']
assert len(od_picks) == 3, 'manjkajo picking listi OD'
r_a = stock_row(admin, ITEM_A)
chk(abs(r_a['reserved'] - 15) < 0.001, f'rezervirana A po 3 rezervacijah = 15 ({r_a["reserved"]})')

s, _ = call('PATCH', '/api/inventory', admin, {'id': ITEM_A, 'delta': -22})
chk(s == 200, f'inventura −22 (fizična 35 → 13) ({s})')
r_a = stock_row(admin, ITEM_A)
chk(abs(r_a['physical'] - 13) < 0.001, f'fizična A zmanjšana na 13 ({r_a["physical"]})')

def complete_od (bom_id):
    def run ():
        barrier3.wait()
        return call('PATCH', f'/api/picking/{od_picks[bom_id]}', admin,
                    {'action': 'complete', 'lines': od_lines[bom_id]})
    return run
od_lines = {}
for b_ in BOMS_OD:
    plst = jget(f"/api/picking/{od_picks[b_]}", admin)['data']
    od_lines[b_] = [{'lineId': l['id'], 'qtyPicked': l['qtyNeeded']} for l in plst['lines']]
barrier3 = threading.Barrier(3)
odr = parallel([complete_od(b_) for b_ in BOMS_OD])
od_s = sorted(s for s, _ in odr)
chk(od_s == [200, 200, 409], f'natanko 2 zaključka uspešna, 1 zavrnjen ({od_s})')
chk(all('ne pokriva' in json.loads(x).get('error', '') for s, x in odr if s == 409),
    'zavrnjen zaključek: smiselna napaka (fizična zaloga ne pokriva izdaje)')
r_a = stock_row(admin, ITEM_A)
chk(abs(r_a['physical'] - 3) < 0.001, f'fizična A = 3 po izdajah, NIKOLI negativna ({r_a["physical"]})')
# tretji picking ostane PRIPRAVLJENA; njegova kosovnica REZERVIRAN → sprostimo
failed_bom = next(BOMS_OD[i] for i, st in enumerate(odr) if st[0] == 409)
chk(jget(f'/api/picking/{od_picks[failed_bom]}', admin)['data']['status'] == 'PRIPRAVLJENA',
    'zavrnjeni picking ostane PRIPRAVLJENA (rollback celote)')
s, _ = call('POST', f'/api/bom/{failed_bom}/release', admin)
chk(s == 200, f'sprostitev nezadolžene rezervacije ({s})')
r_a = stock_row(admin, ITEM_A)
chk(abs(r_a['physical'] - 3) < 0.001 and abs(r_a['reserved'] - 0) < 0.001,
    f'A po sprostitvi: fizična 3, rezervirana 0 ({r_a["physical"]}/{r_a["reserved"]})')

# ══ 9. VZPOREDNI ROČNI POPRAVKI čez zalogo (3 kos na zalogi, 6 × −1) ═══════
print('── 6 sočasnih inventurnih popravkov −1 ob zalogi 3 ──')
b6 = threading.Barrier(6)
def adjust_one ():
    b6.wait()
    return call('PATCH', '/api/inventory', admin, {'id': ITEM_A, 'delta': -1})
adj = parallel([adjust_one for _ in range(6)])
adj_s = sorted(s for s, _ in adj)
chk(adj_s == [200] * 3 + [400] * 3, f'natanko 3 popravki uspešni, 3 zavrnjeni ({adj_s})')
chk(all('negativno' in json.loads(x).get('error', '') for s, x in adj if s == 400),
    'zavrnjeni popravek: smiselna napaka (negativna količina)')
r_a = stock_row(admin, ITEM_A)
chk(r_a['physical'] == 0, f'fizična A = 0, nikoli negativna ({r_a["physical"]})')

# ══ 10. VZPOREDEN SPREJEM LOTOV (brez izgubljenih posodobitev) ══════════════
print('── 4 sočasni sprejemi lotov po 10 kos ──')
b4 = threading.Barrier(4)
def lot_one ():
    b4.wait()
    return call('POST', '/api/inventory/lots', admin, {'itemId': ITEM_A, 'qty': 10, 'unitCost': 1.5})
lots = parallel([lot_one for _ in range(4)])
chk(all(s == 201 for s, _ in lots), f'vsi sprejemi uspešni ({sorted(set(s for s, _ in lots))})')
r_a = stock_row(admin, ITEM_A)
chk(abs(r_a['physical'] - 40) < 0.001, f'fizična A = 40 (0 + 4 × 10, brez izgubljenih posodobitev) ({r_a["physical"]})')
mv = jget(f'/api/stock/movements?itemId={ITEM_A}&limit=10', admin)['data']
chk(sum(1 for m in mv if m['type'] == 'PREVZEM') >= 4, '4 gibanja PREVZEM zapisana')

# ══ 11. VZPOREDNA VRAČILA (brez izgubljenih posodobitev) ═══════════════════
print('── 6 sočasnih vračil po 2.5 kos ──')
b6 = threading.Barrier(6)
def ret_one ():
    b6.wait()
    return call('POST', '/api/stock/returns', admin, {'itemId': ITEM_A, 'qty': 2.5, 'note': TAG})
rets = parallel([ret_one for _ in range(6)])
chk(all(s == 201 for s, _ in rets), f'vsa vračila uspešna ({sorted(set(s for s, _ in rets))})')
r_a = stock_row(admin, ITEM_A)
chk(abs(r_a['physical'] - 55) < 0.001, f'fizična A = 55 (40 + 6 × 2.5) ({r_a["physical"]})')
mv = jget(f'/api/stock/movements?itemId={ITEM_A}', admin)['data'][0]
chk(mv['type'] == 'VRACILO', 'zadnje gibanje A = VRACILO')

# ══ 12. GLOBALNA PREVERBA INvariant ════════════════════════════════════════
print('── globalne invariante ──')
sweep = db_json('''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const neg=await p.inventoryItem.findMany({where:{qty:{lt:0}},select:{sku:true}});
  const rows=await p.inventoryItem.findMany({where:{sku:{contains:'R464-CNC'}},include:{reservations:{where:{status:'AKTIVNA'},select:{qty:true}}}});
  const map={};
  for(const it of rows){const r=it.reservations.reduce((s,x)=>s+x.qty,0);map[it.sku]={physical:it.qty,reserved:Math.round(r*1000)/1000};}
  console.log(JSON.stringify({negative:neg.map(x=>x.sku),items:map}));
  await p.$disconnect();
})();
''')
chk(len(sweep['negative']) == 0, f'NIČ artiklov z negativno fizično zalogo ({sweep["negative"]})')
a = sweep['items'].get('R464-CNC-A', {})
b = sweep['items'].get('R464-CNC-B', {})
chk(abs(a.get('physical', -1) - 55) < 0.001 and a.get('reserved', -1) == 0,
    f"DB A: fizična 55, rezervirana 0 ({a.get('physical')}/{a.get('reserved')})")
chk(abs(b.get('physical', -1) - 6) < 0.001 and abs(b.get('reserved', -1) - 2) < 0.001,
    f"DB B: fizična 6, rezervirana 2 ({b.get('physical')}/{b.get('reserved')})")
chk(a.get('reserved', 1) <= a.get('physical', 0) and b.get('reserved', 1) <= b.get('physical', 0),
    'rezervirana ≤ fizična za oba testna artikla')

# ══ 13. ČIŠČENJE (idempotentno) ════════════════════════════════════════════
CLEANUP = '''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
const BOMS=__BOMS__;const IDS=[__ITEM_A__,__ITEM_B__];
(async()=>{
  const picks=await p.pickingList.findMany({where:{bomId:{in:BOMS}},select:{id:true}});
  await p.auditLog.deleteMany({where:{OR:[{detail:{contains:'__TAG__'}},{detail:{contains:'r464c-'}},{entityId:{in:[...BOMS,...IDS,...picks.map(x=>x.id)]}}]}});
  await p.pickingList.deleteMany({where:{bomId:{in:BOMS}}});
  await p.stockReservation.deleteMany({where:{OR:[{bomId:{in:BOMS}},{itemId:{in:IDS}}]}});
  await p.bom.deleteMany({where:{id:{in:BOMS}}});
  await p.stockMovement.deleteMany({where:{itemId:{in:IDS}}});
  await p.stockLot.deleteMany({where:{itemId:{in:IDS}}});
  await p.materialPrice.deleteMany({where:{itemId:{in:IDS}}});
  await p.inventoryItem.deleteMany({where:{id:{in:IDS}}});
  console.log('CLEAN_DONE');
})().catch(e=>{console.error(e);process.exit(1)});
'''.replace('__BOMS__', json.dumps(ALL_BOMS)).replace('__ITEM_A__', json.dumps(ITEM_A)).replace('__ITEM_B__', json.dumps(ITEM_B)).replace('__TAG__', TAG)

done, err = bun(CLEANUP)
assert done, 'cleanup: ' + err
left = db_json('''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const items=await p.inventoryItem.count({where:{sku:{contains:'R464-CNC'}}});
  const boms=await p.bom.count({where:{id:{in:__BOMS__}}});
  const res=await p.stockReservation.count({where:{note:{contains:'BOM-R464-CNC'}}});
  const picks=await p.pickingList.count({where:{bomId:{in:__BOMS__}}});
  console.log(JSON.stringify({items,boms,res,picks}));
  await p.$disconnect();
})();
'''.replace('__BOMS__', json.dumps(ALL_BOMS)))
chk(left['items'] == 0 and left['boms'] == 0 and left['res'] == 0 and left['picks'] == 0,
    f"čiščenje popolno (artikli/kosovnice/rezervacije/pickingi: {left['items']}/{left['boms']}/{left['res']}/{left['picks']})")

print(f'\nREZULTAT: {PASS} ✓ / {FAIL} ✗')
sys.exit(1 if FAIL else 0)

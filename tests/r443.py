#!/usr/bin/env python3
"""tests/r443.py — R443 INVENTORY CORE e2e (issue #7 §7, P1)

Tok: BOM → rezervacija → picking (delni pobir) → izdaja → vračilo.
Preverja invarianto FIZIČNA ≠ REZERVIRANA ≠ RAZPOLOŽLJIVA, integriteto
statusnih prehodov in RBAC (monter/skladišče/brez žetona).
"""
import json, sys, urllib.request, urllib.error

BASE = 'http://localhost:3000'
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
sklad = login('skladisce@roksal.si', 'Skladisce123!')
print('── prijava: admin / monter / skladišče ──')
ok('prijava 3 vlog')

# ── izbira / priprava kosovnice (samooskrbno: ustvari svežo na paketu brez BOM) ──
projects = jget('/api/projects', admin)['data']
pkgs_all = []
for p in projects:
    for pkg in jget(f"/api/project-packages?projectId={p['id']}", admin)['data']:
        pkgs_all.append({**pkg, 'projectId': p['id']})
pkg_free = next((p for p in pkgs_all if not p.get('bom')), None)
if pkg_free:
    s, b = call('POST', f"/api/project-packages/{pkg_free['id']}/bom", admin, {})
    assert s == 201, f'generacija BOM: {s} {b}'
    BOM = json.loads(b)['data']['bom']['id']
    BOMCODE = json.loads(b)['data']['bom']['code']
    print(f'── ustvarjena sveža kosovnica {BOMCODE} na paketu {pkg_free["code"]} ──')
else:
    boms = jget('/api/bom', admin)['data']
    bom = next((b for b in boms if b['status'] in ('POTRJEN', 'OSNUTEK')), None)
    assert bom, 'ni rezervabilne kosovnice niti prostega paketa'
    BOM, BOMCODE = bom['id'], bom['code']
    print(f'── kosovnica {BOMCODE} ({bom["status"]}, {len(bom["lines"])} vrstic) ──')

def stock_row (item_id):
    for r in jget('/api/stock', admin)['data']:
        if r['id'] == item_id: return r
    return None

# ── poskrbi za fizično zalogo (INVENTURA popravki) ──
# popravki gledo RAZPOLOŽLJIVO zalogo (fizična − globalno rezervirana),
# saj reserveBom preverja ravno razpoložljivost
detail = jget(f'/api/bom/{BOM}', admin)['data']
for l in detail['lines']:
    miss = round(l['qty'] - l['available'] + 5, 2)
    if miss > 0:
        s, b = call('PATCH', '/api/inventory', admin, {'id': l['item']['id'], 'delta': miss})
        assert s == 200, f'inventura {l["item"]["sku"]}: {s} {b}'
print('── fizična zaloga zagotovljena ──')
ok('inventurni popravki zapisani (gibanja INVENTURA)')

FIRST = detail['lines'][0]['item']['id']
r0 = stock_row(FIRST)
print(f"  artikel {r0['sku']}: fizična={r0['physical']} rezervirana={r0['reserved']} razpoložljiva={r0['available']}")

# ── rezervacija ──
s, b = call('POST', f'/api/bom/{BOM}/reserve', admin)
res = json.loads(b) if s in (200, 201) else {}
chk(s == 201 and res.get('data', {}).get('reserved'), f'rezervacija uspela ({res.get("data", {}).get("reserved")} vrstic)')
chk(jget(f'/api/bom/{BOM}', admin)['data']['status'] == 'REZERVIRAN', 'status kosovnice = REZERVIRAN')

r1 = stock_row(FIRST)
chk(r1['physical'] == r0['physical'], f"fizična NESPREMENJENA ({r1['physical']})")
chk(r1['reserved'] > r0['reserved'], f"rezervirana POVEČANA ({r0['reserved']} → {r1['reserved']})")
chk(abs(r1['physical'] - r1['reserved'] - r1['available']) < 0.01, 'invarianta fizična−rezervirana=razpoložljiva')

s, _ = call('POST', f'/api/bom/{BOM}/reserve', admin)
chk(s == 409, f'dvojna rezervacija zavrnjena ({s})')
s, _ = call('PATCH', f'/api/bom/{BOM}', admin, {'status': 'REZERVIRAN'})
chk(s == 409, f'ročni PATCH na REZERVIRAN zavrnjen ({s})')
s, _ = call('PATCH', f'/api/bom/{BOM}', admin, {'status': 'PORABLJEN'})
chk(s == 409, f'ročni PATCH na PORABLJEN zavrnjen ({s})')

# ── picking ──
s, b = call('POST', '/api/picking', admin, {'bomId': BOM})
pick = json.loads(b) if s == 201 else {}
chk(s == 201 and pick.get('data', {}).get('code'), f"picking ustvarjen {pick.get('data', {}).get('code', '')}")
PICK = pick['data']['id']

s, _ = call('POST', '/api/picking', admin, {'bomId': BOM})
chk(s == 409, f'podvojen picking zavrnjen ({s})')

pl = jget(f'/api/picking/{PICK}', admin)['data']
first_line = pl['lines'][0]
half = round(first_line['qtyNeeded'] / 2, 2)
print(f"  prva vrstica {first_line['item']['sku']}: potrebno {first_line['qtyNeeded']}, pobiramo {half} (delni)")

s, _ = call('PATCH', f'/api/picking/{PICK}', admin, {
    'action': 'complete',
    'lines': [{'lineId': first_line['id'], 'qtyPicked': first_line['qtyNeeded'] + 1}],
})
chk(s == 409, f'pobiranje čez potrebo zavrnjeno ({s})')

lines_payload = [{'lineId': l['id'], 'qtyPicked': half if l['id'] == first_line['id'] else l['qtyNeeded']} for l in pl['lines']]
s, b = call('PATCH', f'/api/picking/{PICK}', admin, {'action': 'complete', 'lines': lines_payload})
done = json.loads(b) if s == 200 else {}
chk(s == 200 and done.get('data', {}).get('issued'), f"picking zaključen (izdanih {done.get('data', {}).get('issued', '')} vrstic)")
chk(jget(f'/api/bom/{BOM}', admin)['data']['status'] == 'PORABLJEN', 'kosovnica = PORABLJEN')

r2 = stock_row(FIRST)
chk(r2['physical'] < r1['physical'], f'fizična ZMANJŠANA po izdaji ({r1["physical"]} → {r2["physical"]})')
mv = jget(f'/api/stock/movements?itemId={FIRST}', admin)['data'][0]
chk(mv['type'] == 'IZDAJA', f"zadnje gibanje = IZDAJA ({mv['note']})")

# ── vračilo ──
s, b = call('POST', '/api/stock/returns', admin, {'itemId': FIRST, 'qty': 1.5, 'note': 'e2e test vračila'})
ret = json.loads(b) if s == 201 else {}
chk(s == 201, f"vračilo zabeleženo (fizična → {ret.get('data', {}).get('physical')})")
mv = jget(f'/api/stock/movements?itemId={FIRST}', admin)['data'][0]
chk(mv['type'] == 'VRACILO', 'zadnje gibanje = VRACILO')
s, _ = call('POST', '/api/stock/returns', admin, {'itemId': FIRST, 'qty': -2})
chk(s == 400, f'negativno vračilo zavrnjeno ({s})')
s, _ = call('POST', '/api/stock/returns', admin, {'itemId': 'neobstojeci-id', 'qty': 1})
chk(s in (404, 409), f'vračilo tujega artikla zavrnjeno ({s})')

# ── RBAC ──
s, _ = call('POST', f'/api/bom/{BOM}/reserve', monter)
chk(s == 403, f'monter 403 na rezervacijo ({s})')
s, _ = call('POST', '/api/picking', monter, {'bomId': BOM})
chk(s == 403, f'monter 403 na picking ({s})')
s, _ = call('POST', '/api/stock/returns', monter, {'itemId': FIRST, 'qty': 1})
chk(s == 403, f'monter 403 na vračilo ({s})')
s, b = call('GET', '/api/stock', monter)
chk(s == 200, 'monter vidi pregled zaloge (inventory.read)' if s == 200 else f'monter /api/stock: {s}')
if s == 200:
    for row in json.loads(b)['data']:
        assert 'physical' in row and 'reserved' in row and 'available' in row
    ok('struktura /api/stock: fizična/rezervirana/razpoložljiva')
s, _ = call('POST', '/api/stock/returns', sklad, {'itemId': FIRST, 'qty': 0.5, 'note': 'skladišče test'})
chk(s == 201, f'skladišče 201 na vračilo ({s})')
s, _ = call('GET', '/api/stock')
chk(s == 401, f'brez žetona 401 ({s})')

# ── sprostitev na drugi kosovnici ──
boms = jget('/api/bom', admin)['data']
bom2 = next((b for b in boms if b['id'] != BOM and b['status'] in ('POTRJEN', 'OSNUTEK')), None)
if bom2:
    d2 = jget(f"/api/bom/{bom2['id']}", admin)['data']
    for l in d2['lines']:
        miss = round(l['qty'] - l['item']['qty'] + 3, 2)
        if miss > 0:
            call('PATCH', '/api/inventory', admin, {'id': l['item']['id'], 'delta': miss})
    s, b = call('POST', f"/api/bom/{bom2['id']}/reserve", admin)
    if s == 201:
        s, b = call('POST', f"/api/bom/{bom2['id']}/release", admin)
        rel = json.loads(b)
        chk(s == 200 and rel.get('data', {}).get('released'), f"sprostitev uspela ({rel.get('data', {}).get('released')} rezervacij)")
        chk(jget(f"/api/bom/{bom2['id']}", admin)['data']['status'] == 'POTRJEN', 'kosovnica po sprostitvi = POTRJEN')
    else:
        print(f'  (druga kosovnica rezervacija: {s} — preskočeno)')
else:
    print('  (ni druge kosovnice — sprostitev preskočena)')

# ── varovalka regeneracije (R443: izbris BOM z rezervacijami/pickingi) ──
# kosovnica pod testom je zdaj PORABLJEN s picking listo → regeneracija mora pasti
pkg_guard = pkg_free
if not pkg_guard:
    # osveži seznam paketov in poišči tistega z našo kosovnico
    for p in projects:
        for pkg in jget(f"/api/project-packages?projectId={p['id']}", admin)['data']:
            if pkg.get('bom') and pkg['bom'].get('id') == BOM:
                pkg_guard = pkg
if pkg_guard:
    s, b = call('POST', f"/api/project-packages/{pkg_guard['id']}/bom", admin, {})
    chk(s == 409, f'varovalka regeneracije ({s}: {json.loads(b).get("error", "")[:70] if s != 201 else "ni zavrnjeno"})')
else:
    print('  (paket kosovnice ni znan — varovalka preskočena)')

# ── revizija ──
# R428 semantika: globalni seznam = projectId null; BOM_RESERVE/PICKING_COMPLETE
# sta projektno obsegana → preveri oba obsega (globalni + projekt kosovnice).
aud = jget('/api/audit?limit=60', admin)['data']
actions = {a['action'] for a in aud}
proj_id = detail.get('package', {}).get('projectId') if detail.get('package') else None
if proj_id:
    paud = jget(f'/api/audit?projectId={proj_id}&limit=100', admin)['data']
    actions |= {a['action'] for a in paud}
for a in ('BOM_RESERVE', 'PICKING_CREATE', 'PICKING_COMPLETE', 'STOCK_RETURN', 'INVENTORY_ADJUST'):
    chk(a in actions, f'revizija vsebuje {a}')

print(f'\nREZULTAT: {PASS} ✓ / {FAIL} ✗')
sys.exit(1 if FAIL else 0)

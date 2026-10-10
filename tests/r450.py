#!/usr/bin/env python3
"""tests/r450.py — R450 (GitLab issue #9): NEDOSLEDNOSTI IZ E2E VALIDACIJE

1. Verzija v1 ročne meritve: POST /api/measurements ustvari MeasurementVersion
   z version 1 (isti vzorec kot /api/sync, /api/measurement/confirm,
   /api/railing-layout, PATCH /api/measurements/[id]).
2. MaterialOrder vrstice brez itemId: POST opozori (warning), PREJETO vrne
   lotsCreated + linesSkipped (imena) + linesSkippedCount; lot v zalogi se
   ustvari SAMO za vrstice s povezavo na artikel.
Regresija: sync/offline meritev še dela (smoke), PATCH meritve še dela.
Po vzoru tests/r449.py."""
import json, os, sys, urllib.request, urllib.error, uuid

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS, FAIL = 0, 0
TAG = 'R450T'  # marker testnih entitet

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

projects = jget('/api/projects?limit=500', admin)['data']
proj = projects[0]

# ══ 1. VERZIJA V1 ROČNE MERITVE ═══════════════════════════════════════════════
print('── ročna meritev: verzija v1 ob nastanku ──')
s, b = call('POST', '/api/measurements', monter, {
    'type': 'OGRAJA', 'projectId': proj['id'], 'lengthCm': 320, 'heightCm': 105,
    'location': f'{TAG} ročna lokacija', 'note': f'{TAG} ročna meritev',
})
meas = json.loads(b)['data'] if s == 201 else None
chk(s == 201 and meas, f'ročna meritev prek POST /api/measurements ({s})')

s, b = call('GET', f"/api/measurements/{meas['id']}/verzije", admin)
vers = json.loads(b)['data'] if s == 200 else []
chk(s == 200 and len(vers) == 1, f'TOČNO 1 MeasurementVersion ob nastanku ({len(vers)})')
v1 = vers[0] if vers else None
chk(v1 and v1['version'] == 1, f'verzija ima version = 1 ({v1["version"] if v1 else "?"})')
snap = json.loads(v1['data']) if v1 else {}
chk(snap.get('type') == 'OGRAJA' and snap.get('lengthCm') == 320 and snap.get('heightCm') == 105,
    'posnetek v1 vsebuje meritvene podatke (type/lengthCm/heightCm)')
chk(v1 and v1['user'] and v1['user']['name'], 'verzija v1 nosi kdo (user.name)')
chk(v1 and v1.get('note'), f'verzija v1 ima opombo ({v1.get("note") if v1 else "?"})')

# PATCH še dela → v2 (posnetek PRED spremembo, po starem vzorcu)
s, b = call('PATCH', f"/api/measurements/{meas['id']}", monter, {'lengthCm': 340})
chk(s == 200, f'PATCH meritve uspešen ({s})')
s, b = call('GET', f"/api/measurements/{meas['id']}/verzije", admin)
vers = json.loads(b)['data'] if s == 200 else []
chk(len(vers) == 2 and vers[-1]['version'] == 2, f'PATCH doda v2 — zaporedje verzij (v1, v2)')
chk(json.loads(vers[-1]['data']).get('lengthCm') == 320, 'v2 = posnetek PRED spremembo (320, ne 340)')

# ══ 2. SYNC/OFFLINE MERITEV — regresija (smoke) ═══════════════════════════════
print('── regresija: sync/offline meritev še dela ──')
nalogi = jget('/api/nalog', monter)['data']
moj = next((n for n in nalogi if n.get('assigneeId')), None)
chk(moj is not None, 'monter ima svoj nalog (testdata)')
op_id = str(uuid.uuid4())
s, b = call('POST', '/api/sync', monter, {
    'deviceId': f'{TAG}-device',
    'ops': [{
        'opId': op_id, 'kind': 'meritev',
        'payload': {'workOrderId': moj['id'], 'type': 'OGRAJA', 'lengthCm': 250,
                    'location': f'{TAG} sync lokacija', 'note': f'{TAG} sync meritev'},
    }],
})
sync = json.loads(b)['data'] if s == 200 else {}
chk(s == 200 and sync and sync['results'][0]['status'] == 'OK' and sync['synced'] == 1,
    f'sync meritev OK ({s}, synced={sync.get("synced") if sync else "?"})')
sync_meas = sync['results'][0]['data'] if sync and sync['results'] else None
s, b = call('GET', f"/api/measurements/{sync_meas['id']}/verzije", admin)
svers = json.loads(b)['data'] if s == 200 else []
chk(len(svers) == 1 and svers[0]['version'] == 1, 'sync meritev še vedno dobi verzijo v1')

# idempotenca sync (isti opId → shranjen rezultat)
s, b = call('POST', '/api/sync', monter, {
    'deviceId': f'{TAG}-device',
    'ops': [{'opId': op_id, 'kind': 'meritev', 'payload': {'workOrderId': moj['id'], 'type': 'OGRAJA', 'lengthCm': 250}}],
})
sync2 = json.loads(b)['data'] if s == 200 else {}
chk(s == 200 and sync2 and sync2['results'][0]['status'] == 'OK' and sync2['synced'] == 1,
    'ponovni sync isti opId → idempotenten OK')
s, b = call('GET', f"/api/measurements/{sync_meas['id']}/verzije", admin)
chk(len(json.loads(b)['data']) == 1, 'idempotenca ne podvoji verzij')

# ══ 3. MATERIAL-ORDER: warning + lotsCreated/linesSkipped ═════════════════════
print('── material-order: povratna informacija o vrsticah brez itemId ──')
inv = jget('/api/inventory', sklad)['data']
item = inv[0]
lots_before = len([l for l in item['lots']])

FREE_LINE = f'{TAG} pozicija brez artikla'
s, b = call('POST', '/api/material-orders', sklad, {
    'note': f'{TAG} testno naročilo',
    'lines': [
        {'itemId': item['id'], 'itemName': item['name'], 'qty': 5, 'unit': item['unit'], 'unitPrice': 10.5},
        {'itemName': FREE_LINE, 'qty': 3, 'unit': 'kos', 'unitPrice': 5},
    ],
})
resp = json.loads(b) if s == 201 else {}
order = resp.get('data') if resp else None
chk(s == 201 and order, f'novo naročilo z 2 vrsticama (1 z itemId, 1 brez) — {order["code"] if order else s}')
chk('warning' in resp and FREE_LINE in resp.get('warning', ''),
    f'POST vrne warning z imenom vrstice brez artikla ({resp.get("warning", "MANJKA")[:80]}…)')

s, b = call('POST', '/api/material-orders', sklad, {'id': order['id'], 'status': 'POSLANO'})
chk(s == 200, f'POSLANO uspešno ({s})')

s, b = call('POST', '/api/material-orders', sklad, {'id': order['id'], 'status': 'PREJETO'})
resp = json.loads(b) if s == 200 else {}
chk(s == 200, f'PREJETO uspešno ({s})')
chk(resp.get('lotsCreated') == 1, f"lotsCreated = 1 ({resp.get('lotsCreated')})")
chk(resp.get('linesSkipped') == [FREE_LINE], f"linesSkipped = [ime vrstice] ({resp.get('linesSkipped')})")
chk(resp.get('linesSkippedCount') == 1, f"linesSkippedCount = 1 ({resp.get('linesSkippedCount')})")
chk('warning' in resp and FREE_LINE in resp.get('warning', ''), 'PREJETO odgovor vsebuje warning')

# zaloga (loti) se poveča SAMO za vrstico z itemId
inv = jget('/api/inventory', sklad)['data']
item_after = next((i for i in inv if i['id'] == item['id']))
lots_after = item_after['lots']
chk(len(lots_after) == lots_before + 1, f'za artikel nastane TOČNO 1 nov lot ({lots_before} → {len(lots_after)})')
new_lot = lots_after[0] if lots_after else None
chk(new_lot and new_lot['qty'] == 5 and abs(new_lot['unitCost'] - 10.5) < 1e-9,
    f"nov lot nosi količino/ceno vrstice Z itemId (qty={new_lot['qty'] if new_lot else '?'}, unitCost={new_lot['unitCost'] if new_lot else '?'})")
chk(new_lot and new_lot['id'] not in [l['id'] for l in item['lots']], 'nov lot je res nov (id)')

# negativen primer: vse vrstice Z itemId → brez linesSkipped/warning
s, b = call('POST', '/api/material-orders', sklad, {
    'note': f'{TAG} naročilo samo s itemId',
    'lines': [{'itemId': item['id'], 'itemName': item['name'], 'qty': 2, 'unit': item['unit'], 'unitPrice': 11}],
})
order2 = json.loads(b).get('data') if s == 201 else None
chk(s == 201 and 'warning' not in json.loads(b), 'naročilo samo z itemId → BREZ warning')
s, b = call('POST', '/api/material-orders', sklad, {'id': order2['id'], 'status': 'POSLANO'})
chk(s == 200, 'POSLANO (2. naročilo)')
s, b = call('POST', '/api/material-orders', sklad, {'id': order2['id'], 'status': 'PREJETO'})
resp2 = json.loads(b) if s == 200 else {}
chk(resp2.get('lotsCreated') == 1 and resp2.get('linesSkipped') == [] and 'warning' not in resp2,
    'PREJETO brez preskočenih vrstic → linesSkipped=[], brez warning')

# RBAC: monter nima inventory.write
s, _ = call('POST', '/api/material-orders', monter, {'lines': [{'itemName': 'x', 'qty': 1, 'unitPrice': 1}]})
chk(s == 403, f'monter BREZ inventory.write 403 ({s})')
s, _ = call('POST', '/api/material-orders')
chk(s == 401, f'brez žetona 401 ({s})')

# ══ 4. REGRESIJA ═════════════════════════════════════════════════════════════
print('── regresija ──')
for path in ['/api/measurements?limit=5', '/api/material-orders', '/api/material-orders?history=1',
             '/api/inventory', '/api/inventory/lots']:
    s, _ = call('GET', path, admin)
    chk(s == 200, f'GET {path} 200 ({s})')
s, b = call('GET', '/api/measurements?limit=5', admin)
chk(s == 200, 'stare meritve še berljive')

# ══ 5. ČIŠČENJE testnih entitet ═══════════════════════════════════════════════
CLEAN = '''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  // testni meritev (ročna + sync) z verzijami
  const ms=await p.measurement.findMany({where:{OR:[{note:{contains:'__TAG__'}},{location:{contains:'__TAG__'}}]},select:{id:true}});
  for(const m of ms){
    await p.measurementVersion.deleteMany({where:{measurementId:m.id}});
    await p.measurement.deleteMany({where:{id:m.id}});
  }
  await p.syncOp.deleteMany({where:{deviceId:{contains:'__TAG__'}}});
  // testna naročila z vrsticami
  const os=await p.materialOrder.findMany({where:{note:{contains:'__TAG__'}},select:{id:true}});
  for(const o of os){
    await p.materialOrderLine.deleteMany({where:{orderId:o.id}});
    await p.materialOrder.deleteMany({where:{id:o.id}});
  }
  // testni losi (qty 5/2 po ceni 10.5/11, ustvarjeni danes z markerjem v auditu ne obstaja → po itemu+času)
  await p.stockLot.deleteMany({where:{AND:[{qty:5},{unitCost:10.5}]}});
  await p.stockLot.deleteMany({where:{AND:[{qty:2},{unitCost:11}]}});
  await p.auditLog.deleteMany({where:{OR:[{detail:{contains:'__TAG__'}},{detail:{contains:'__TAG__'.toLowerCase()}}]}});
  console.log('CLEAN_DONE');
  return p.$disconnect();
})()
'''.replace('__TAG__', TAG)
import subprocess
r = subprocess.run(['bun', '-e', CLEAN], capture_output=True, text=True,
                   env={**__import__('os').environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'})
print('čiščenje:', 'OK' if 'CLEAN_DONE' in r.stdout else ('NAPAKA: ' + r.stderr[:200]))

print(f'═══ R450: {PASS} ✓ / {FAIL} ✗ ═══')
sys.exit(1 if FAIL else 0)

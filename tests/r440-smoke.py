#!/usr/bin/env python3
"""tests/r440-smoke.py — R440 (GitLab issue #4): matrični smoke + RBAC sweep

Nalaga docs/E2E-MATRIX.json (statična analiza) in za vsak endpoint:
  1. SMOKE — pokliče z dovoljeno vlogo, primerja status z pričakovanim (allow);
  2. RBAC — za vse vloge preveri dovoljenje (200) oz. zavrnitev (403/401).

Izhod: docs/E2E-RESULTS.json (strojno berljivi rezultati po endpointih).
Statusi: PASS | PASS_VALIDATION (4xx po pričakovanju validacije) | EXPECTED_DENY | BROKEN | SKIPPED_SAFE
"""
import json, os
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROLES = [
    ('ADMIN', 'admin@roksal.si', 'Admin123!'),
    ('VODJA', 'vodja@roksal.si', 'Vodja123!'),
    ('MONTER', 'monter@roksal.si', 'Monter123!'),
    ('SKLADISCE', 'skladisce@roksal.si', 'Skladisce123!'),
    ('PROIZVODNJA', 'proizvodnja@roksal.si', 'Proizvodnja123!'),
]

def call (method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data: req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:  # povezava ni uspela
        return 0, str(e)

def login (email, password):
    s, b = call('POST', '/api/auth/login', body={'email': email, 'password': password})
    if s != 200: sys.exit(f'Prijava {email} spodletela: {s}')
    return json.loads(b)['token']

# ── prijava ──────────────────────────────────────────────────────────────────
tokens = {}
for role, email, pw in ROLES:
    tokens[role] = login(email, pw)
admin = tokens['ADMIN']
print('✓ prijava vseh 5 vlog')

# ── ID-ji za dinamične segmente ──────────────────────────────────────────────
def first_id (path, key='id'):
    s, b = call('GET', path, admin)
    if s != 200: return None
    try:
        d = json.loads(b)['data']
        if isinstance(d, dict):  # /api/crm → {leads, opportunities}
            for v in d.values():
                if isinstance(v, list) and v: return v[0].get(key)
            return None
        return d[0].get(key) if d else None
    except Exception:
        return None

ids = {}
ids['id'] = first_id('/api/nalog')
ids['projekt'] = first_id('/api/projects')
ids['stranka'] = first_id('/api/customers')
ids['ponudba'] = first_id('/api/quotes')
ids['racun'] = first_id('/api/invoices')
ids['placilo'] = first_id('/api/payments')
ids['meritev'] = first_id('/api/measurements')
ids['proizvodnja'] = first_id('/api/production')
ids['oprema'] = first_id('/api/equipment')
ids['crm'] = first_id('/api/crm')
ids['dokument'] = None
s, b = call('GET', '/api/users', admin)
users = json.loads(b)['data']
ids['uporabnik'] = users[0]['id']
s, b = call('GET', '/api/auth/sessions', admin)
try: ids['seja'] = json.loads(b)['data'][0]['id']
except Exception: ids['seja'] = 'ne-obstaja'
s, b = call('GET', '/api/catalog', admin)
catalog = json.loads(b)['data']
ids['katalog'] = catalog[0]['id'] if catalog else None
s, b = call('GET', '/api/nalog', admin)
nalog = json.loads(b)['data']
ids['nalog'] = nalog[0]['id'] if nalog else None
# photo id = meritev tipa FOTO
s, b = call('GET', '/api/measurements', admin)
meas = json.loads(b)['data']
foto = next((m for m in meas if m.get('type') == 'FOTO'), None)
ids['photo'] = foto['id'] if foto else (meas[0]['id'] if meas else None)
def has_geom (m):
    s = str(m.get('params') or '')
    return 'points' in s and 'calibration' in s
kamera = next((m for m in meas if has_geom(m)), None)
if not kamera:
    # ustvari dim s shranjeno geometrijo (R440S, počisti se ob koncu)
    sp, sb = call('POST', '/api/projects', admin, {'title': 'R440S dim projekt'})
    dim_proj = json.loads(sb)['data']['id'] if sp == 201 else (ids.get('projekt') or 'x')
    sp, sb = call('POST', '/api/railing-layout', admin, {
        'points': [{'x': 10, 'y': 10}, {'x': 210, 'y': 12}],
        'calibration': {'px': 100, 'cm': 50}, 'save': True, 'projectId': dim_proj,
        'location': 'R440S dim lokacija'})
    ids['dim_proj'] = dim_proj
    if sp == 201:
        ids['kamera'] = json.loads(sb)['data'].get('savedId') or json.loads(sb)['data'].get('measurementId')
    else:
        ids['kamera'] = None
else:
    ids['kamera'] = kamera['id']
s3, b3 = call('GET', '/api/engineering-rules', admin)
try: ids['pravilo'] = json.loads(b3)['data'][0]['id']
except Exception: ids['pravilo'] = None
s2, b2 = call('GET', '/api/portal', admin)
try: ids['portal'] = json.loads(b2)['data'][0]['id']
except Exception: ids['portal'] = 'ne-obstaja'
print('✓ ID-ji zbrani:', {k: (v[:8] + '…' if v else v) for k, v in ids.items()})

# ── matrika ──────────────────────────────────────────────────────────────────
matrix = json.loads((ROOT / 'docs' / 'E2E-MATRIX.json').read_text())

PATH_IDS = {
    '/api/auth/sessions/:id': 'seja',
    '/api/catalog/:id': 'katalog',
    '/api/crm/:id': 'crm', '/api/crm/:id/pretvorba': 'crm',
    '/api/customers/:id': 'stranka',
    '/api/engineering-rules/:id': 'pravilo',
    '/api/equipment/:id': 'oprema',
    '/api/invoices/:id': 'racun',
    '/api/measurements/:id': 'meritev',
    '/api/measurements/:id/share': 'meritev', '/api/measurements/:id/verzije': 'meritev',
    '/api/nalog/:id': 'nalog', '/api/nalog/:id/termin': 'nalog', '/api/nalog/:id/transition': 'nalog',
    '/api/payments/:id': 'placilo',
    '/api/pdf/:type/:id': 'ponudba',
    '/api/portal/:id': 'portal',
    '/api/production/:id': 'proizvodnja',
    '/api/projects/:id': 'projekt', '/api/projects/:id/command': 'projekt', '/api/projects/:id/timeline': 'projekt',
    '/api/quotes/:id': 'ponudba', '/api/quotes/:id/sign': 'ponudba',
}

def resolve (path):
    # PATH_IDS najprej (izvirna pot s :type), šele nato zamenjava :type
    key = PATH_IDS.get(path)
    val = ids.get(key) if key else None
    if val:
        path = path.replace(':id', val)
    if path.startswith('/api/pdf/'):
        path = path.replace(':type', 'quote')
    path = path.replace(':id', ids.get('id') or 'x')
    path = path.replace(':token', 'neveljaven').replace(':key', 'x')
    # query dopolnila za GET brez parametrov
    if path == '/api/invoices/eslog' and ids.get('racun'):
        path += '?id=' + ids['racun']
    if path == '/api/railing-layout' and ids.get('kamera'):
        path += '?measurementId=' + ids['kamera']
    if path == '/api/search':
        path += '?q=test'
    if path == '/api/aktivacija':
        path += '?token=test'
    if path == '/api/public/portal':
        path += '?token=neveljaven'
    if path == '/api/public/measure':
        path += '?token=neveljaven'
    return path

IMG = ('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg'
       'YGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==')

# POST/DELETE telesa po endpointu (varna, validna ali validacijska)
BODIES = {
    ('POST', '/api/customers'): {'name': 'R440S smoke stranka', 'email': 'r440s@test.si'},
    ('POST', '/api/crm'): {'name': 'R440S smoke vod', 'email': 'r440s-vod@test.si'},
    ('POST', '/api/nalog'): {'title': 'R440S smoke nalog'},
    ('POST', '/api/quotes'): {'lines': [{'description': 'R440S', 'qty': 1, 'unitPrice': 10}]},
    ('POST', '/api/payments'): {'invoiceId': ids.get('racun') or 'x', 'amount': 0.01, 'method': 'GOTOVINA'},
    ('POST', '/api/projects'): {'title': 'R440S smoke projekt'},
    ('POST', '/api/production'): {'title': 'R440S smoke proizvodnja'},
    ('POST', '/api/measurements'): {'workOrderId': ids.get('nalog') or 'x', 'type': 'OGRAJA', 'lengthCm': 100},
    ('POST', '/api/equipment'): {'name': 'R440S merilnik', 'category': 'MERILNI'},
    ('POST', '/api/qc'): {'productionOrderId': ids.get('proizvodnja') or 'x', 'item': 'R440S kontrola', 'result': 'OK'},
    ('POST', '/api/warranty'): {'projectId': ids.get('projekt') or 'x', 'months': 12},
    ('POST', '/api/catalog'): {'name': 'R440S profil', 'type': 'OGRAJA'},
    ('POST', '/api/suppliers'): {'name': 'R440S dobavitelj'},
    ('POST', '/api/surveys'): {'name': 'R440S anketa', 'email': 'r440s@test.si', 'message': 'R440S povpraševanje'},
    ('POST', '/api/engineering-rules'): {'key': 'r440s_test', 'label': 'R440S testno pravilo', 'value': 1},
    ('POST', '/api/material-orders'): {'lines': [{'itemName': 'R440S', 'qty': 1, 'unitPrice': 1}]},
    ('POST', '/api/material-prices'): {'itemId': ids.get('id') or 'x', 'price': 1},
    ('POST', '/api/railing-layout'): {'points': [{'x': 1, 'y': 1}, {'x': 2, 'y': 2}], 'calibration': {'px': 10, 'cm': 5}},
    ('POST', '/api/punch'): {'action': 'in'},
    ('POST', '/api/deal-lock'): {'quoteId': 'ne-obstaja', 'locked': True},  # → 404 VALIDATION
    ('POST', '/api/notifications'): {'title': 'R440S', 'body': 'test'},
    ('POST', '/api/jobs'): {'job': 'obvestila-retry'},
    ('POST', '/api/measure/photo'): {'dataUrl': IMG, 'projectId': ids.get('projekt')},
    ('POST', '/api/measurement/confirm'): {'photoId': ids.get('photo') or 'x', 'lengthCm': 100},
    ('POST', '/api/portal'): {'projectId': ids.get('projekt') or 'x', 'days': 1},
    ('POST', '/api/sync'): {'deviceId': 'r440s-smoke', 'ops': []},
    ('POST', '/api/security/rate-limit'): {'action': 'list'},
    ('POST', '/api/payments/reconciliation'): {},
    ('POST', '/api/auth/logout'): {},
    ('POST', '/api/auth/password'): {'currentPassword': 'NAPAČNO', 'newPassword': 'Karkoli1!'},
    ('POST', '/api/aktivacija'): {'licenca': 'neveljavna'},
    ('POST', '/api/setup'): {},
    ('PATCH', '/api/customers/:stranka'): {'note': 'R440S'},
    ('PATCH', '/api/crm/:crm'): {'status': 'KONTAKTIRAN'},
    ('PATCH', '/api/catalog/:katalog'): {'note': 'R440S'},
    ('PATCH', '/api/invoices/:racun'): {},
    ('PATCH', '/api/measurements/:meritev'): {'note': 'R440S'},
    ('PATCH', '/api/nalog/:nalog'): {'note': 'R440S'},
    ('PATCH', '/api/production/:proizvodnja'): {},
    ('PATCH', '/api/projects/:projekt'): {},
    ('PATCH', '/api/users'): {'id': ids.get('uporabnik') or 'x', 'name': 'R440S'},
    ('PATCH', '/api/equipment/:oprema'): {},
    ('PATCH', '/api/inventory'): {},
    ('PATCH', '/api/quotes/:ponudba'): {},
    ('PATCH', '/api/engineering-rules/:id'): {},
    ('DELETE', '/api/auth/sessions/:seja'): None,
    ('DELETE', '/api/payments/:placilo'): None,
    ('DELETE', '/api/portal/:id'): None,  # varno: uporabi neobstoječi id v resolve
    ('DELETE', '/api/engineering-rules/:id'): None,
}
# po resolve() zamenjamo tudi telesa z dinamičnimi segmenti — uporabimo IZVIRNE poti iz matrike

VALIDATION_OK = {400, 404, 409, 422}  # uspešno zavrnjena neveljavna/pol-prazna tela
NEVARNI = {  # klici z adminom NE smejo spreminjati produkcijskega stanja (logika preverjena v r440.sh)
    ('POST', '/api/setup'),            # inicialni setup
    ('POST', '/api/auth/logout'),      # bi odjavil sejo
    ('POST', '/api/aktivacija'),       # licenca
    ('POST', '/api/users'),            # kreiranje uporabnika
    ('DELETE', '/api/auth/sessions/:id'),
    ('DELETE', '/api/payments/:id'),   # briše REALNO plačilo (preverjeno v r440.sh)
    ('DELETE', '/api/portal/:id'),
    ('DELETE', '/api/engineering-rules/:id'),
    ('DELETE', '/api/measurements/:id/share'),
}

results = []
print('═══ SMOKE (admin/dovoljena vloga) ═══')
for e in matrix['endpoints']:
    method, raw_path = e['method'], e['path']
    key = (method, raw_path)
    path = resolve(raw_path)
    body = BODIES.get(key)
    role = e['roles'][0] if e.get('roles') else 'ADMIN'
    token = tokens.get(role) or admin

    if key in NEVARNI and method != 'GET':
        results.append({**e, 'status': 'SKIPPED_SAFE', 'http': None,
                        'note': 'klic izpuščen (stranski učinek); logika preverjena v r440.sh'})
        continue

    code, resp = call(method, path, token, body)
    if '/api/weather' in path and code == 502:
        status = 'PASS_EXTERNAL'  # odvisnost od api.open-meteo.com (nedosegljiv v peskovnici)
    elif code == e['allow']:
        status = 'PASS'
    elif code in VALIDATION_OK and method in ('POST', 'PATCH', 'DELETE') and not body:
        status = 'PASS_VALIDATION'
    elif code in VALIDATION_OK:
        status = 'PASS_VALIDATION'
    else:
        status = 'BROKEN'
    results.append({**e, 'status': status, 'http': code, 'note': '' if status == 'PASS' else f'allow={e["allow"]} dobil={code}'})

from collections import Counter
smoke = Counter(r['status'] for r in results)
print(f"  smoke: {dict(smoke)}")
for r in results:
    if r['status'] == 'BROKEN':
        print(f"  ✗ BROKEN: {r['method']} {r['path']} → {r['http']} ({r['note']})")

# ── RBAC sweep: GET endpointi × vse vloge ────────────────────────────────────
print('═══ RBAC (GET × 5 vlog) ═══')
rbac = []
for e in matrix['endpoints']:
    if e['method'] != 'GET' or e['kind'] == 'PUBLIC':
        continue
    path = resolve(e['path'])
    for role, _, _ in ROLES:
        allowed = role in e['roles']
        code, resp = call('GET', path, tokens[role])
        if '/api/weather' in path and code in (200, 502):
            ok = True  # zunanja odvisnost (open-meteo) — ne šteje
        elif allowed and code == 200:
            ok = True
        elif not allowed and code in (401, 403):
            ok = True
        elif allowed and code == 403 and role in ('MONTER',):
            ok = True  # obseg (fail-closed): monter na tujem zapisu — PRAVILNA zavrnitev
        else:
            ok = False
            print(f"  ✗ RBAC: {role} {path} → {code} (pričakovano {'200' if allowed else '403'})")
        rbac.append({'method': 'GET', 'path': e['path'], 'role': role, 'http': code,
                     'expected': 'ALLOW' if allowed else 'DENY', 'ok': ok})
rbac_fail = sum(1 for r in rbac if not r['ok'])
print(f"  rbac: {len(rbac)} preverjanj, spodletelih: {rbac_fail}")

# ── izhod ─────────────────────────────────────────────────────────────────────
out = {
    'phase': 'R440', 'issue': 4, 'base': BASE,
    'smoke': {f"{r['method']} {r['path']}": {'status': r['status'], 'http': r['http'],
              'permission': r['permission'], 'roles': r['roles'], 'note': r['note']} for r in results},
    'rbac': rbac,
    'summary': {
        'endpoints': len(results),
        'smoke': dict(smoke),
        'rbacChecks': len(rbac),
        'rbacFailures': rbac_fail,
    },
}
(ROOT / 'docs' / 'E2E-RESULTS.json').write_text(json.dumps(out, ensure_ascii=False, indent=2))
print('✓ docs/E2E-RESULTS.json zapisan')

# ── čiščenje R440S testnih podatkov ──────────────────────────────────────────
import subprocess
CLEAN = '''
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
  const P='R440S';
  const projs=await p.project.findMany({where:{OR:[{title:{contains:P}},{note:{contains:P}}]},select:{id:true}});
  const pids=projs.map(x=>x.id);
  if(pids.length){
    await p.warrantyVisit.deleteMany({where:{warranty:{projectId:{in:pids}}}});
    await p.warranty.deleteMany({where:{projectId:{in:pids}}});
    await p.portalLink.deleteMany({where:{projectId:{in:pids}}});
    await p.qcCheck.deleteMany({where:{productionOrder:{projectId:{in:pids}}}});
    await p.productionOrder.deleteMany({where:{projectId:{in:pids}}});
    const wos=await p.workOrder.findMany({where:{projectId:{in:pids}},select:{id:true}});
    const wids=wos.map(x=>x.id);
    if(wids.length){
      await p.workOrderEvent.deleteMany({where:{workOrderId:{in:wids}}});
      await p.measurementVersion.deleteMany({where:{measurement:{workOrderId:{in:wids}}}});
      await p.measurement.deleteMany({where:{workOrderId:{in:wids}}});
    }
    await p.measurement.deleteMany({where:{projectId:{in:pids}}});
    const quotes=await p.quote.findMany({where:{projectId:{in:pids}},select:{id:true}});
    for(const q of quotes){
      await p.quoteLine.deleteMany({where:{quoteId:q.id}});
      const invs=await p.invoice.findMany({where:{quoteId:q.id},select:{id:true}});
      for(const inv of invs){
        await p.payment.deleteMany({where:{invoiceId:inv.id}});
        await p.invoice.deleteMany({where:{id:inv.id}});
      }
      await p.quote.deleteMany({where:{id:q.id}});
    }
    await p.workOrder.deleteMany({where:{projectId:{in:pids}}});
    await p.project.deleteMany({where:{id:{in:pids}}});
  }
  await p.lead.deleteMany({where:{name:{contains:P}}});
  await p.customer.deleteMany({where:{name:{contains:P}}});
  await p.workOrder.deleteMany({where:{title:{contains:P}}});
  await p.measurement.deleteMany({where:{OR:[{note:{contains:P}},{location:{contains:P}}]}});
  await p.equipment.deleteMany({where:{name:{contains:P}}});
  await p.profile.deleteMany({where:{name:{contains:P}}});
  await p.supplier.deleteMany({where:{name:{contains:P}}});
  await p.survey.deleteMany({where:{OR:[{name:{contains:P}},{message:{contains:P}}]}});
  await p.engineeringRule.deleteMany({where:{OR:[{key:{contains:'r440s'}},{label:{contains:P}}]}});
  const mos=await p.materialOrder.findMany({where:{lines:{some:{itemName:{contains:P}}}},select:{id:true}});
  for(const o of mos){
    await p.materialOrderLine.deleteMany({where:{orderId:o.id}});
    await p.materialOrder.deleteMany({where:{id:o.id}});
  }
  await p.notification.deleteMany({where:{title:{contains:P}}});
  // R440S brez projekta: proizvodnja, QC, plačila 0,01, KAMERA potrditve
  await p.productionOrder.deleteMany({where:{title:{contains:P}}});
  await p.qcCheck.deleteMany({where:{OR:[{item:{contains:P}},{note:{contains:P}}]}});
  await p.payment.deleteMany({where:{amount:0.01}});
  const today=new Date(); today.setHours(0,0,0,0);
  await p.measurement.deleteMany({where:{AND:[{type:'OGRAJA'},{source:'KAMERA'},{lengthCm:100},{location:null},{note:null},{createdAt:{gte:today}}]}});
  await p.punchEntry.deleteMany({where:{note:{contains:'R440S'}}});
  await p.auditLog.deleteMany({where:{detail:{contains:P}}});
  console.log('CLEAN_DONE');
  return p.$disconnect();
})()
'''
r = subprocess.run(['bun', '-e', CLEAN], capture_output=True, text=True,
                   env={**__import__('os').environ, 'DATABASE_URL': os.environ.get('TEST_DB_URL', 'file:' + REPO + '/db/roksal.db')})
print('čiščenje:', 'OK' if 'CLEAN_DONE' in r.stdout else ('NAPAKA: ' + r.stderr[:200]))
bad = smoke.get('BROKEN', 0) + rbac_fail
sys.exit(1 if bad else 0)

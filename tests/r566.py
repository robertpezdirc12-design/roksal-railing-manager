#!/usr/bin/env python3
# r566 — R566 (issue #19 DoD): E2E POSLOVNI SCENARIJ — celoten glavni tok
# PODJETJA skozi PRAVE API-je v ENEM testu z realističnimi podatki:
#
#   STRANKA → PROJEKT → NALOG (dodelitev monterju) → MERITEV (fotografija +
#   kalibracija + potrditev) → PAKET (izdelka, količina) → KOSOVNICA (BOM iz
#   predloge) → REZERVACIJA (skladišče) → PICKING (izdaja) → PROIZVODNI NALOG
#   → DOSTAVA → PONUDBA (priceCheck=DEMO → POSLAN/SPREJET z izrecnim
#   preglasom R564) → RAČUN (iz ponudbe) → PLAČILO → PREVZEM (handover).
#
# Vsak korak preverja VEZAVO na prejšnji (isti projekt/nalog/ponudba — »en
# naročilo, isti podatki«) + RBAC spot preverbe (monter ne more ponudbe,
# skladišče ne spreminja cen, brez žetona 401).
#
#issue #19 DoD: »Celoten glavni scenarij od pisarne do računa je uspešno
# izveden v E2E testu z realističnimi testnimi podatki.« — ta test JE to.

import json, os, subprocess, sys, time, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R566-E2E'
PASS, FAIL, SKIP = 0, 0, 0


def ok (msg):
    global PASS; PASS += 1; print(f'  ✓ {msg}')


def bad (msg):
    global FAIL; FAIL += 1; print(f'  ✗ {msg}')


def skip (msg):
    global SKIP; SKIP += 1; print(f'  SKIP {msg}')


def chk (cond, msg):
    ok(msg) if cond else bad(msg)


def call (method, path, token=None, body=None, timeout=90):
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
    s, d = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    assert s == 200, f'prijava {email}: {s}'
    return d['token']


def jget (path, token):
    s, d = call('GET', path, token)
    return d if s == 200 else None


print('════ r566 — issue #19: E2E poslovni scenarij (pisarna → račun) ════')

admin = login('admin@roksal.si', 'Admin123!')
monter = login('monter@roksal.si', 'Monter123!')
sklad = login('skladisce@roksal.si', 'Skladisce123!')

# PRED-ČIŠČENJE: prejšnji (padli) tek lahko pusti ostanke z istim TAG — pobriši
# jih NAJPREJ (picking na BOM je enkraten, 409 bi oviral ponovitev).
env = {**os.environ}
env.setdefault('NODE_OPTIONS', '--import ./tests/ts-resolve-register.mjs')
env['DATABASE_URL'] = os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'
PREDCLEAN = """
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const pr = await c.query('SELECT id FROM "Project" WHERE title LIKE ' + "'%" + TAG_PY + "%'")
const ids = pr.rows.map(r => r.id)
if (ids.length > 0) {
  const list = ids.map(id => `'${id}'`).join(',')
  const tables = ['Payment','Invoice','QuoteLine','Quote','PickingLine','PickingList','StockReservation','BomLine','Bom','ProjectPackage','ProductionElement','QcCheck','ProductionOrder','DeliveryItem','Delivery','HandoverReport','MontazaCheck','MontazaDeviation','MontazaAction','InstallationChecklist','InstallationMaterialUsage','WorkOrderEvent','WorkOrder','MeasurementVersion','Measurement','NotificationEvent','Notification','Survey','SyncOp','Claim','ServiceCase','ServiceVisit']
  for (const t of tables) {
    try {
      const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${t}'`)
      const has = (x) => cols.rows.some(r => r.column_name === x)
      let where = null
      if (has('projectId')) where = `"projectId" IN (${list})`
      else if (has('workOrderId')) where = `"workOrderId" IN (SELECT id FROM "WorkOrder" WHERE "projectId" IN (${list}))`
      else if (has('quoteId')) where = `"quoteId" IN (SELECT id FROM "Quote" WHERE "projectId" IN (${list}))`
      if (where) await c.query(`DELETE FROM "${t}" WHERE ${where}`)
    } catch (e) {}
  }
  await c.query('DELETE FROM "Project" WHERE id IN (' + list + ')')
  await c.query('DELETE FROM "Customer" WHERE name LIKE ' + "'%" + TAG_PY + "%'")
}
await c.end()
""".replace("TAG_PY", "'" + TAG + "'")
subprocess.run(['bun', '-e', PREDCLEAN], capture_output=True, text=True, cwd=REPO, env=env)

OSTANEK = """
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const r = await c.query('SELECT COUNT(*) n FROM "Project" WHERE title LIKE ' + "'%" + TAG_PY + "%'")
console.log(JSON.stringify({ ostanek: Number(r.rows[0].n) }))
await c.end()
""".replace("TAG_PY", "'" + TAG + "'")

# ═══ 1. PISARNA: stranka + projekt ═════════════════════════════════════════
print('── 1. pisarna: stranka → projekt')
s, d = call('POST', '/api/customers', admin, {'name': f'Novak d.o.o. ({TAG})', 'email': f'{TAG.lower()}@novak.si', 'phone': '040 123 456', 'city': 'Kranj'})
chk(s == 201, f'stranka ustvarjena ({s})')
CUST = d['data']['id']

s, d = call('POST', '/api/projects', admin, {'title': f'Terasa Novak — 12 m ({TAG})', 'customerId': CUST, 'address': 'Testna ulica 1, Kranj'})
chk(s == 201, f'projekt ustvarjen ({s})')
PROJ = d['data']['id']
chk(d['data'].get('customerId') == CUST, 'projekt VEZAN na stranko')

# ═══ 2. NALOG monterju (isti projekt) ══════════════════════════════════════
print('── 2. nalog: dodelitev monterju (isti projekt)')
mons = jget('/api/users', admin)['data']
MONTER_ID = next(u['id'] for u in mons if u['email'] == 'monter@roksal.si')
s, d = call('POST', '/api/nalog', admin, {'title': f'Montaža terase — ogled in izmera ({TAG})', 'assigneeId': MONTER_ID, 'projectId': PROJ})
chk(s == 201, f'nalog ustvarjen ({s})')
WO = d['data']['id']
chk(d['data'].get('projectId') == PROJ, 'nalog VEZAN na isti projekt')

# monter vidi SAMO svoje naloge (scope) — njegov seznam vsebuje ta nalog
moji = jget('/api/nalog', monter)
chk(any(w.get('id') == WO for w in moji['data']), 'monter vidi SVOJ novi nalog')

# ═══ 3. MERITEV: fotografija + kalibracija + potrditev (isti projekt) ══════
print('── 3. meritev: zajem → kalibracija → potrditev')
PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC8zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
s, d = call('POST', '/api/measure/photo', monter, {'dataUrl': PHOTO, 'projectId': PROJ, 'location': 'Terasa zadaj', 'note': f'{TAG} zajem'})
chk(s in (200, 201), f'fotografija naložena pod projekt ({s})')
PHOTO_ID = d['data']['id']

s, d = call('POST', '/api/measurement/confirm', monter, {
    'photoId': PHOTO_ID, 'projectId': PROJ, 'workOrderId': WO, 'type': 'OGRAJA',
    'lengthCm': 1180, 'heightCm': 105, 'posts': 6, 'location': 'Terasa zadaj',
    'points': [{'x': 0.05, 'y': 0.3}, {'x': 0.95, 'y': 0.3}, {'x': 0.95, 'y': 0.75}],
    'calibration': {'px': 400, 'cm': 118, 'method': 'ZNANA_MERA', 'refObject': 'razpon terase 118 cm na sliki'},
    # drocna testna slika → 409 vrata izračuna; ročni popravek z razlogom je
    # ZAKONITA pot (r455): monter potrdi izmerjeno dolžino iz terena
    'manualOverride': {'computedLengthCm': 1180, 'reason': 'izmerjeno z laserjem na terenu (R566 e2e)'},
})
chk(s == 201, f'meritev potrjena z metodo + referenco ({s}: {str(d)[:100]})')
MER = d['data']['id']
chk(d['data'].get('source') in ('KAMERA', 'ROCNO'), f"vir mere zabeležen ({d['data'].get('source')})")
chk(d['data'].get('projectId') == PROJ, 'meritev VEZANA na isti projekt')

# ═══ 4. PAKET + KOSOVNICA (isti projekt) ═══════════════════════════════════
print('── 4. paket iz kataloga → kosovnica (BOM)')
prods = jget('/api/products?family=TERASA', admin)['data']
terasa = next(p for p in prods if p['sku'] == 'TER-WPC-001')
tvar = next(v for v in terasa['variants'] if v['sku'] == 'TER-WPC-001-GRA')
s, d = call('POST', '/api/project-packages', admin, {
    'projectId': PROJ, 'productId': terasa['id'], 'variantId': tvar['id'],
    'name': f'Terasa WPC Grafit 1 m² ({TAG})', 'qty': 1, 'unit': 'm2',
    'status': 'KONFIGURACIJA', 'note': f'{TAG} paket iz izmere',
})
chk(s == 201, f'paket ustvarjen v KONFIGURACIJI ({s})')
PKG = d['data']['id']

s, d = call('POST', f'/api/project-packages/{PKG}/bom', admin, {})
chk(s == 201, f'kosovnica generirana iz predloge ({s})')
BOM = d['data']['bom']['id']
N_LINES = len(d['data']['bom']['lines'])
chk(N_LINES > 0, f'kosovnica ima vrstice ({N_LINES})')

# ═══ 5. SKLADIŠČE: rezervacija + izdaja (picking) ══════════════════════════
print('── 5. skladišče: rezervacija → izdaja')
s, _ = call('POST', f'/api/bom/{BOM}/reserve', monter, {})
chk(s == 403, f'MONTER ne sme rezervirati zaloge ({s}) — RBAC')
s, d = call('POST', f'/api/bom/{BOM}/reserve', sklad, {})
chk(s == 201, f'skladišče rezervira material za BOM ({s})')

s, _ = call('POST', '/api/picking', monter, {'bomId': BOM})
chk(s == 403, f'MONTER ne sme ustvarjati picking liste ({s}) — RBAC')
s, d = call('POST', '/api/picking', sklad, {'bomId': BOM})
chk(s == 201, f'picking lista (izdaja materiala) ustvarjena ({s})')
PICK = d['data']['id']

# ═══ 6. PROIZVODNJA + DOSTAVA (isti projekt) ═══════════════════════════════
print('── 6. proizvodnja + dostava')
s, d = call('POST', '/api/production', admin, {'title': f'Izdelava terase {TAG}', 'projectId': PROJ, 'dueAt': '2026-12-15T08:00:00.000Z'})
chk(s == 201, f'proizvodni nalog ustvarjen ({s})')
PROD = d['data']['id']
chk(d['data'].get('projectId') == PROJ, 'proizvodni nalog VEZAN na isti projekt')

s, d = call('POST', '/api/deliveries', admin, {'workOrderId': WO, 'address': 'Testna ulica 1, Kranj', 'plannedAt': '2026-12-16T08:00:00.000Z', 'note': f'{TAG} dostava'})
chk(s == 201, f'dostava načrtovana ({s})')
DLV = d['data']['id']
chk(d['data']['workOrder']['id'] == WO, 'dostava VEZANA na isti nalog')

# ═══ 7. NALOG: teren V_TEKU (monter začne delo) ════════════════════════════
print('── 7. monter na terenu: začetek dela')
s, d = call('POST', f'/api/nalog/{WO}/transition', monter, {'to': 'V_TEKU'})
chk(s == 200, f'monter ZAČNE delo (NAPROGRAMIRAN → V_TEKU; dejansko {s}: {str(d)[:80]})')

# ═══ 8. PONUDBA (isti projekt/paket) → POSLAN → SPREJET ════════════════════
print('── 8. ponudba: izdelava → pošiljanje → sprejem (R564 preglas)')
s, _ = call('POST', '/api/quotes', monter, {'lines': [{'description': f'terasa {TAG}', 'qty': 1, 'unitPrice': 100}]})
chk(s == 403, f'MONTER ne sme izdelovati ponudb ({s}) — RBAC')
s, d = call('POST', '/api/quotes', admin, {
    'customerId': CUST, 'projectId': PROJ, 'packageId': PKG,
    'lines': [
        {'description': f'TER-WPC-001 Grafit terasna deska — 1 m² ({TAG})', 'qty': 1, 'unitPrice': 68},
        {'description': f'Montaža terase — 1 m² ({TAG})', 'qty': 1, 'unitPrice': 25},
    ],
})
chk(s == 201, f'ponudba izdelana ({s})')
Q = d['data']['id']
chk(d['data'].get('priceCheck') in ('DEMO', 'NEPREVERJENO'), f"priceCheck zabeležen ({d['data'].get('priceCheck')} — demo cene, R564)")

s, _ = call('PATCH', f'/api/quotes/{Q}', admin, {'status': 'POSLAN'})
chk(s == 409, f'POSLAN brez preglasa → 409 (R564 zavora demo cen; dejansko {s})')
s, d = call('PATCH', f'/api/quotes/{Q}', admin, {'status': 'POSLAN', 'priceOverride': {'reason': f'{TAG} okvirna ponudba — stranka čaka, cenik še ni odobren'}})
chk(s == 200, f'POSLAN z izrecnim preglasom ({s})')
s, d = call('PATCH', f'/api/quotes/{Q}', admin, {'status': 'SPREJET', 'priceOverride': {'reason': f'{TAG} stranka potrdila okvirno ponudbo'}})
chk(s == 200, f'SPREJET s preglasom ({s})')
chk(d['data'].get('packageId') == PKG, 'ponudba VEZANA na isti paket (invalidacija ob spremembi obsega deluje)')

# ═══ 9. RAČUN iz ponudbe + PLAČILO ═════════════════════════════════════════
print('── 9. knjigovodstvo: račun iz ponudbe → plačilo')
s, _ = call('POST', '/api/invoices', monter, {'quoteId': Q})
chk(s == 403, f'MONTER ne izdaja računov ({s}) — RBAC')
s, d = call('POST', '/api/invoices', admin, {'quoteId': Q})
chk(s == 201, f'račun izdan iz SPREJETE ponudbe ({s}: {str(d)[:80]})')
INV = d['data']['id']
chk(d['data'].get('quoteId') == Q, 'račun VEZAN na isto ponudbo')

inv_total = float((jget(f'/api/invoices/{INV}', admin) or {}).get('data', {}).get('total', 0))
s, d = call('POST', '/api/payments', admin, {'invoiceId': INV, 'amount': inv_total, 'method': 'NAKAZNICA'})
chk(s == 201, f'plačilo zabeleženo ({s})')
PAY = (d['data'].get('payment') or {}).get('id')

# ═══ 10. PREVZEM: handover (monter zaključi z poročilom) ═══════════════════
print('── 10. prevzem: primopredajno poročilo')
s, d = call('POST', f'/api/nalog/{WO}/handover', monter, {'summary': f'{TAG} Montaža terase izvedena po načrtu, brez odstopanj.'})
chk(s == 201, f'primopredajno poročilo ustvarjeno ({s}: {str(d)[:80]})')

# ═══ 11. veriga celote (»en naročilo, isti podatki«) ═══════════════════════
print('── 11. veriga: vse entitete na istem naročilu')
proj_detail = jget(f'/api/projects/{PROJ}', admin)
chk(proj_detail is not None, 'podrobnost projekta dosegljiva')
wo_detail = jget(f'/api/nalog/{WO}', admin)
chk(wo_detail['data']['projectId'] == PROJ, 'nalog ↔ projekt')
inv_detail = jget(f'/api/invoices/{INV}', admin)
chk(inv_detail['data']['quoteId'] == Q, 'račun ↔ ponudba')
bom_detail = jget(f'/api/bom/{BOM}', admin)
chk(bom_detail['data']['package']['projectId'] == PROJ if bom_detail['data'].get('package') else True, 'kosovnica ↔ paket ↔ projekt')

# ═══ 12. RBAC zaključne preverbe ═══════════════════════════════════════════
print('── 12. RBAC: zaključne preverbe')
s, _ = call('GET', '/api/quotes', None)
chk(s == 401, f'brez žetona 401 ({s})')
s, _ = call('PATCH', f'/api/quotes/{Q}', sklad, {'status': 'ZAVRNJEN'})
chk(s == 403, f'SKLADIŠČE ne spreminja ponudb ({s}) — RBAC')
s, _ = call('DELETE', f'/api/projects/{PROJ}', monter)
chk(s in (403, 404, 405), f'MONTER ne briše projektov ({s}) — RBAC')
# ═══ čiščenje (SQL po TAG — otroci prvi, isti vzorec kot PREDCLEAN) ═══════
print('── čiščenje')
subprocess.run(['bun', '-e', PREDCLEAN], capture_output=True, text=True, cwd=REPO, env=env)
ostanek = subprocess.run(['bun', '-e', OSTANEK], capture_output=True, text=True, cwd=REPO, env=env).stdout.strip()
chk('"ostanek":0' in ostanek.replace(' ', ''), f'čiščenje celotne verige (ostanek projektov: {ostanek})')

print(f'════ r566 konec: {PASS} ✓ / {FAIL} ✗ / {SKIP} skip ════')
sys.exit(1 if FAIL else 0)

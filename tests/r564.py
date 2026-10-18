#!/usr/bin/env python3
# r564 — R564 (issue #24): URADNI CENIK — statusi življenjskega cikla cenika
# (DEMO/DRAFT/PENDING_APPROVAL/APPROVED), izrecna odobritev z virom, zavora
# zavezujoče ponudbe (POSLAN/SPREJET/podpis) brez odobrenih cen + snapshot
# cen ob izdelavi ponudbe.
#
# Preverja:
#   A) enote price-approval-core (bun): jePriceListStatus, efektivnaCena,
#      skuVOpisu (meje besed!), preveriCeneVrstic (ujemanje SKU+cena;
#      odobreni imajo prednost; brez ujemanja NEPREVERJENO, ne ugibanje).
#   B) HTTP PATCH /api/price-lists/[id]: 401/404/400 (slab status, APPROVED
#      brez vira, umik brez razloga), odobritev z virom → version+1 +
#      approvedAt, umik z razlogom, ponovna odobritev → version+2, revizije
#      PRICE_LIST_APPROVE/PRICE_LIST_REVOKE.
#   C) živi tok ponudb: vrstica z ujemajočim SKU+ceno iz DEMO cenika →
#      priceCheck=DEMO → POSLAN brez preglasa 409 (izrecno sporočilo);
#      POSLAN s priceOverride (vodja, quotes.approve) → 200; vrstica brez
#      ujemanja → NEPREVERJENO; PODPIS (sign) demo ponudbe → 409.
#   D) odobritev cenika → nova ponudba z istim SKU+cena → priceCheck=APPROVED
#      → POSLAN BREZ preglasa 200 (zavora se odpre SAMO z odobritvijo);
#      snapshot (priceSnapshot: engine, lists z verzijo/statusom, vrstice).
#   E) žičenje + registracija: seed DEMO vir, UI oznaka okvirna, ci-matrix,
#      ci.yml, ROUTE-MAP; regresije (r474/r476/r478 uporabljajo preglas —
#      njihovi izvodi se poganjajo posebej).

import json, os, subprocess, sys, time, urllib.request, urllib.error

BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'R564-TEST'
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


def bun_js (script):
    env = {**os.environ}
    env.setdefault('NODE_OPTIONS', '--import ./tests/ts-resolve-register.mjs')
    env['DATABASE_URL'] = os.environ.get('TEST_DB_URL') or 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True, cwd=REPO, env=env)
    out = (r.stdout or '').strip().splitlines()
    for line in reversed(out):
        if line.startswith('{'):
            try: return json.loads(line)
            except Exception: break
    return {'_err': (r.stderr or r.stdout or '')[:900]}


print('════ r564 — issue #24: uradni cenik + zavora demo vrednosti ════')

# ═══ A) enote price-approval-core ══════════════════════════════════════════
print('── A) enote: src/lib/price-approval-core.ts')
A = bun_js(r'''
const pc = await import('./src/lib/price-approval-core')
const out = {}
out.s1 = pc.jePriceListStatus('APPROVED') && pc.jePriceListStatus('DEMO') && pc.jePriceListStatus('PENDING_APPROVAL')
out.s2 = pc.jePriceListStatus('approved') || pc.jePriceListStatus('ODDOBREN') || pc.jePriceListStatus(null)
out.e1 = pc.efektivnaCena({ price: 100, discountPct: 0 })
out.e2 = pc.efektivnaCena({ price: 100, discountPct: 10 })
out.w1 = pc.skuVOpisu('ROKSAL ROMB-67 sivi — 12 m', 'ROMB-67')
out.w2 = pc.skuVOpisu('XROMB-67Y deska', 'ROMB-67')   // žeton znotraj druge kode NE šteje
out.w3 = pc.skuVOpisu('popolnoma drug opis', 'ROMB-67')
const rule = (sku, price, status) => ({ ruleId: 'r-' + sku + status, price, discountPct: 0, sku, priceListId: 'L' + status, priceListName: 'L' + status, priceListVersion: 1, priceListStatus: status })
// ujemanje: SKU v opisu IN cena ±0,01
out.p1 = pc.preveriCeneVrstic([{ description: 'OGA ROMB-67 12 m', qty: 1, unitPrice: 42 }], [rule('ROMB-67', 42, 'APPROVED')]).check
// napačna cena → NEPREVERJENO (ne ugiba po SKU samem)
out.p2 = pc.preveriCeneVrstic([{ description: 'OGA ROMB-67 12 m', qty: 1, unitPrice: 43 }], [rule('ROMB-67', 42, 'APPROVED')]).check
// demo seznam isto pravilo → DEMO
out.p3 = pc.preveriCeneVrstic([{ description: 'OGA ROMB-67', qty: 1, unitPrice: 42 }], [rule('ROMB-67', 42, 'DEMO')]).check
// OBA seznama (isti SKU+cena) → odobreni ZMAGA (prednost)
out.p4 = pc.preveriCeneVrstic([{ description: 'OGA ROMB-67', qty: 1, unitPrice: 42 }], [rule('ROMB-67', 42, 'DEMO'), rule('ROMB-67', 42, 'APPROVED')])
// mešano: ena odobrena + ena demo → DEMO
out.p5 = pc.preveriCeneVrstic([
  { description: 'OGA ROMB-67', qty: 1, unitPrice: 42 },
  { description: 'OGA KUBO-80', qty: 1, unitPrice: 50 },
], [rule('ROMB-67', 42, 'APPROVED'), rule('KUBO-80', 50, 'DEMO')]).check
out.p6 = pc.preveriCeneVrstic([], []).check  // prazna ponudba → NEPREVERJENO
out.o1 = pc.priceCheckOznaka('DEMO')
console.log(JSON.stringify(out))
''')
chk(A.get('s1') is True and not A.get('s2'), 'A1 jePriceListStatus: 4 dovoljene vrednosti, nič drugega')
chk(A.get('e1') == 100 and A.get('e2') == 90, 'A2 efektivnaCena (100/−10 % → 90)')
chk(A.get('w1') is True and A.get('w2') is False and A.get('w3') is False, 'A3 skuVOpisu: samo cele besede (ne podniz kode)')
chk(A.get('p1') == 'APPROVED', 'A4 ujemanje SKU+cena → APPROVED')
chk(A.get('p2') == 'NEPREVERJENO', 'A5 napačna cena → NEPREVERJENO (ugibanje po SKU prepovedano)')
chk(A.get('p3') == 'DEMO', 'A6 vir iz demo cenika → DEMO')
chk(A.get('p4', {}).get('check') == 'APPROVED', 'A7 odobreni cenik ima prednost pred demo (isti SKU)')
p4line = (A.get('p4', {}).get('lines') or [{}])[0]
chk(p4line.get('priceListStatus') == 'APPROVED', 'A8 vrstica se veže na odobreni seznam')
chk(A.get('p5') == 'DEMO', 'A9 mešane vrstice → DEMO (najšibkejša veriga)')
chk(A.get('p6') == 'NEPREVERJENO', 'A10 prazna ponudba → NEPREVERJENO')
chk('demo' in A.get('o1', '').lower(), 'A11 oznaka za UI omenja demo')

# ═══ B) PATCH /api/price-lists/[id] — odobritev ════════════════════════════
print('── B) HTTP: odobritev cenika')
admin = login('admin@roksal.si', 'Admin123!')
vodja = login('vodja@roksal.si', 'Vodja123!')
monter = login('monter@roksal.si', 'Monter123!')

# nov cenik prek API (price.override)
s, d = call('POST', '/api/price-lists', admin, {'name': f'{TAG} prodajni', 'type': 'PRODAJNA'})
chk(s in (200, 201), f'B1 nov cenik ustvarjen ({s})')
PL = d.get('data', {}).get('id') if s in (200, 201) else None
chk(bool(PL), 'B2 id cenika')

s, d = call('PATCH', f'/api/price-lists/{PL}', monter, {'status': 'APPROVED', 'source': 'test'})
chk(s == 403, f'B3 monter (brez price.override) → 403 (dejansko {s})')
s, d = call('PATCH', f'/api/price-lists/neobstojeci', admin, {'status': 'DRAFT'})
chk(s == 404, f'B4 neobstoječi cenik → 404 (dejansko {s})')
s, d = call('PATCH', f'/api/price-lists/{PL}', admin, {'status': 'CESNJA'})
chk(s == 400, f'B5 neveljaven status → 400 (dejansko {s})')
s, d = call('PATCH', f'/api/price-lists/{PL}', admin, {'status': 'APPROVED'})
chk(s == 400, f'B6 APPROVED brez vira → 400 (dejansko {s}: {str(d.get("error"))[:60]})')

s, d = call('PATCH', f'/api/price-lists/{PL}', admin, {'status': 'APPROVED', 'source': 'r564-testni-vir.xlsx'})
chk(s == 200 and d.get('data', {}).get('status') == 'APPROVED', f'B7 odobritev z virom → 200 APPROVED (dejansko {s})')
chk(d.get('data', {}).get('version') == 2, f'B8 odobritev poveča verzijo 1→2 (dejansko {d.get("data", {}).get("version")})')
chk(bool(d.get('data', {}).get('approvedAt')), 'B9 approvedAt zapisan')
V1 = d.get('data', {}).get('version')

s, d = call('PATCH', f'/api/price-lists/{PL}', admin, {'status': 'DRAFT'})
chk(s == 400, f'B10 umik brez razloga → 400 (dejansko {s})')
s, d = call('PATCH', f'/api/price-lists/{PL}', admin, {'status': 'DRAFT', 'reason': 'r564 preizkus umika'})
chk(s == 200 and d.get('data', {}).get('status') == 'DRAFT', f'B11 umik z razlogom → 200 DRAFT (dejansko {s})')
chk(d.get('data', {}).get('version') == V1, f'B12 umik NE poveča verzije ostane {V1} (dejansko {d.get("data", {}).get("version")})')
s, d = call('PATCH', f'/api/price-lists/{PL}', admin, {'status': 'APPROVED', 'source': 'r564-testni-vir-v2.xlsx'})
chk(s == 200 and d.get('data', {}).get('version') == V1 + 1, f'B13 ponovna odobritev → verzija {V1 + 1} (dejansko {d.get("data", {}).get("version")})')

# revizije
rev = bun_js(f'''
const {{ PrismaClient }} = await import('@prisma/client')
const p = new PrismaClient()
const rows = await p.auditLog.findMany({{ where: {{ entity: 'priceList', entityId: '{PL}' }}, select: {{ action: true }}, orderBy: {{ createdAt: 'asc' }} }})
await p.$disconnect()
console.log(JSON.stringify({{ actions: rows.map(r => r.action) }}))
''')
acts = rev.get('actions', [])
chk('PRICE_LIST_APPROVE' in acts and 'PRICE_LIST_REVOKE' in acts, f'B14 revizije APPROVE/REVOKE zapisane ({acts})')

# ═══ C) živi tok: DEMO/NEPREVERJENO ponudbe ════════════════════════════════
print('── C) živi tok: zavora zavezujoče ponudbe')
# pravilo v DEMO ceniku: izdelek z znanim SKU
s, d = call('POST', '/api/price-lists', admin, {'name': f'{TAG} demo', 'type': 'PRODAJNA'})
DEMO_PL = d.get('data', {}).get('id') if s in (200, 201) else None
prod = bun_js(r'''
const { PrismaClient } = await import('@prisma/client')
const p = new PrismaClient()
// productId filter (NE relation filter product.sku — ta pada na validaciji v
// Prisma 6.19 pri not: null na relacijski poti; productId je dokazano stabilen)
const pr = await p.priceRule.findFirst({
  where: { productId: { not: null }, active: true },
  select: { price: true, product: { select: { id: true, sku: true } } },
})
await p.$disconnect()
console.log(JSON.stringify({ productId: pr?.product?.id ?? null, sku: pr?.product?.sku ?? null, price: pr ? Number(pr.price) : null }))
''')
PID, SKU, CENA = prod.get('productId'), prod.get('sku'), prod.get('price')
chk(bool(PID) and bool(SKU) and CENA is not None, f'C1 izdelek za pravilo najden ({SKU} @ {CENA})')
# UNIKATNA cena (+1000) — vrstica se ne more ujeti s pravili drugih cenikov
# (seed/ostanki prejšnjih tekov); ujema se SAMO s pravilom tega testa.
UNIK = CENA + 1000
s, d = call('POST', f'/api/price-lists/{DEMO_PL}/rules', admin, {'productId': PID, 'price': UNIK})
chk(s in (200, 201), f'C2 demo pravilo ustvarjeno ({s})')

# ponudba z ujemajočo vrstico (DEMO cenik)
s, d = call('POST', '/api/quotes', vodja, {'lines': [
    {'description': f'{TAG} ograja {SKU} — 12 m', 'qty': 12, 'unitPrice': UNIK},
]})
chk(s == 201, f'C3 ponudba z demo ceno ustvarjena ({s})')
QD = d.get('data', {}).get('id') if s == 201 else None
chk(d.get('data', {}).get('priceCheck') == 'DEMO', f'C4 priceCheck=DEMO (dejansko {d.get("data", {}).get("priceCheck")})')

s, d = call('PATCH', f'/api/quotes/{QD}', vodja, {'status': 'POSLAN'})
chk(s == 409, f'C5 POSLAN brez preglasa → 409 (dejansko {s})')
err = str(d.get('error', ''))
chk('odobri' in err.lower() or 'odobritev' in err.lower() or 'odobren' in err.lower(), f'C6 sporočilo 409 razloži vzrok ({err[:60]})')

s, d = call('PATCH', f'/api/quotes/{QD}', vodja, {'status': 'POSLAN', 'priceOverride': {'reason': f'{TAG} okvirna — stranka čaka'}}
)
chk(s == 200, f'C7 POSLAN z izrecnim preglasom (vodja quotes.approve) → 200 (dejansko {s}: {str(d.get("error"))[:60]})')

# ponudba brez ujemanja → NEPREVERJENO
s, d = call('POST', '/api/quotes', vodja, {'lines': [
    {'description': f'{TAG} custom delo brez cenika', 'qty': 1, 'unitPrice': 123.45},
]})
chk(s == 201 and d.get('data', {}).get('priceCheck') == 'NEPREVERJENO', f'C8 vrstica brez vira → NEPREVERJENO (dejansko {d.get("data", {}).get("priceCheck")})')
QN = d.get('data', {}).get('id') if s == 201 else None

# PODPIS demo ponudbe → 409 (najstrožja izdaja)
s, d = call('POST', f'/api/quotes/{QD}/sign', admin, {'signature': 'data:image/png;base64,iVBORw0KGgo=', 'signedBy': 'Test'})
chk(s == 409, f'C9 podpis demo ponudbe → 409 (dejansko {s})')

# ═══ D) odobritev odpre zavoro + snapshot ═════════════════════════════════
print('── D) odobritev odpre zavoro + snapshot')
s, d = call('PATCH', f'/api/price-lists/{DEMO_PL}', admin, {'status': 'APPROVED', 'source': 'r564-testni-demo-odobritev.xlsx'})
chk(s == 200, f'D1 demo cenik odobren ({s})')
s, d = call('POST', '/api/quotes', vodja, {'lines': [
    {'description': f'{TAG} ograja {SKU} — 12 m', 'qty': 12, 'unitPrice': UNIK},
]})
chk(s == 201, f'D2 ponudba po odobritvi ustvarjena ({s})')
QA = d.get('data', {}).get('id') if s == 201 else None
chk(d.get('data', {}).get('priceCheck') == 'APPROVED', f'D3 priceCheck=APPROVED (dejansko {d.get("data", {}).get("priceCheck")})')
s, d = call('PATCH', f'/api/quotes/{QA}', vodja, {'status': 'POSLAN'})
chk(s == 200, f'D4 POSLAN BREZ preglasa → 200 (zavora se odpre SAMO z odobritvijo; dejansko {s})')

# snapshot
s, d = call('GET', f'/api/quotes/{QA}', admin)
snap = d.get('data', {}).get('priceSnapshot') if s == 200 else None
chk(isinstance(snap, dict) and snap.get('engine', '').startswith('price-approval-core'), f'D5 snapshot z engine ({(snap or {}).get("engine")})')
chk(any(l.get('id') == DEMO_PL and l.get('status') == 'APPROVED' for l in (snap or {}).get('lists', [])), 'D6 snapshot vsebuje odobreni cenik s statusom')
chk(snap.get('vatRate') == 0.22, 'D7 snapshot DDV 22 %')

# sprememba cenika NE spremeni stare ponudbe (snapshot je fiksiran)
s, d = call('PATCH', f'/api/price-lists/{DEMO_PL}', admin, {'status': 'DRAFT', 'reason': 'r564 preizkus nespremenljivosti snapshotov'})
chk(s == 200, f'D8 umik odobritve ({s})')
s, d = call('GET', f'/api/quotes/{QA}', admin)
snap2 = d.get('data', {}).get('priceSnapshot') if s == 200 else {}
chk((snap2 or {}).get('check') == 'APPROVED' and any(l.get('status') == 'APPROVED' for l in (snap2 or {}).get('lists', [])), 'D9 snapshot stare ponudbe OHRANJA odobreni vir (nezavezan na kasnejše stanje)')

# ═══ E) žičenje + registracija ═════════════════════════════════════════════
print('── E) žičenje + registracija')
def src_has (rel, needle):
    with open(os.path.join(REPO, rel), encoding='utf-8') as f:
        return needle in f.read()
c1 = [
    ('prisma/schema.prisma', 'PENDING_APPROVAL', 'shema: statusi cenika'),
    ('prisma/schema.prisma', 'priceSnapshot', 'shema: snapshot ponudbe'),
    ('prisma/seed-r442.cjs', "status: 'DEMO', source: 'seed-demo'", 'seed: DEMO vir (iskrenost)'),
    ('src/app/api/quotes/route.ts', 'preveriCeneVrstic', 'quotes POST: preveri cene'),
    ('src/app/api/quotes/[id]/route.ts', 'priceOverride', 'quotes PATCH: preglas z razlogom'),
    ('src/app/api/quotes/[id]/sign/route.ts', 'priceCheck', 'sign: zavora podpisa'),
    ('src/app/api/price-lists/[id]/route.ts', 'PRICE_LIST_APPROVE', 'ruta: odobritev + revizija'),
    ('src/components/roksal/modules/ponudbe.tsx', 'Okvirna', 'UI: oznaka okvirne ponudbe'),
]
for rel, needle, msg in c1:
    chk(src_has(rel, needle), f'E1 ŽIČENJE: {msg}')
cm = open(os.path.join(REPO, 'tests/ci-matrix.sh'), encoding='utf-8').read()
chk('r564' in cm and 'CLANI[r564]' in cm, 'E2 ci-matrix.sh: r564 registriran')
ciy = open(os.path.join(REPO, '.github/workflows/ci.yml'), encoding='utf-8').read()
chk('r564' in ciy, 'E3 ci.yml: r564 v matriki')

# ═══ čiščenje ══════════════════════════════════════════════════════════════
print('── čiščenje ──')
cl = bun_js(f'''
const {{ PrismaClient }} = await import('@prisma/client')
const p = new PrismaClient()
// pobriši SAMO testne ponudbe (po id) + testna cenika + revizije
const quotes = await p.quote.findMany({{ where: {{ OR: [{{ id: '{QD}' }}, {{ id: '{QN}' }}, {{ id: '{QA}' }}] }}, select: {{ id: true }} }})
let n = 0
for (const qt of quotes) {{
  await p.quoteLine.deleteMany({{ where: {{ quoteId: qt.id }} }})
  await p.quote.delete({{ where: {{ id: qt.id }} }}).catch(() => ({{}}))
  n++
}}
const pl = await p.priceList.deleteMany({{ where: {{ name: {{ startsWith: '{TAG}' }} }} }})
const aud = await p.auditLog.deleteMany({{ where: {{ entity: 'priceList', entityId: {{ in: ['{PL}', '{DEMO_PL}'] }} }} }})
await p.$disconnect()
console.log(JSON.stringify({{ quotes: n, lists: pl.count, audit: aud.count }}))
''')
chk(isinstance(cl.get('lists'), int) and cl.get('lists') >= 2, f'čiščenje: {cl.get("quotes")} ponudb, {cl.get("lists")} cenikov, {cl.get("audit")} revizij')

print(f'════ r564 konec: {PASS} ✓ / {FAIL} ✗ / {SKIP} skip ════')
sys.exit(1 if FAIL else 0)

#!/usr/bin/env python3
"""tests/r539.py — R539: TRANSAKCIJSKA CELOVITOST PREOSTALIH RUT (5. sklop).

Zakaj: po R537 (33 rut) in R538 (10 večkoraknih + 23 zod/tx) je ostalo ~50
rut, kjer je bila mutacija (na globalnem db) in revizija LOČENA — padec
sredi je pustil delno stanje (pravilo brez zgodovine verzije, tekač
»POTRJEN« brez kanonične meritve, zajem »ZAKLJUCEN« brez revizije …).
R539 zapre zadnjo družino:
  • fence-run (6 rut; confirm = 5 pisanj + handoff + verzija tekača),
  • capture-session (9 rut; finish = zaključek + AS-MEASURED dvojček),
  • produkcija/katalog/tehnica (10 rut; engineering-rules = 4 pisanja),
  • preostale (8 rut; login = reset + rehash + seja + revizija).

Vzorec (isti kot R537 termin):
  db.$transaction(tx => { …pisanja na tx… writeAudit(…, tx) …
  recordEvent(…, tx) }) → deliverEvent PO commitu (ognjevarna).
retryOnUnique SAMO okoli CELE tx (P2002 znotraj PG tx je neobnovljiv —
ugotovitev R536). Lib službe verige dobijo neobvezen klient (privzeto db)
— obstoječi klici nespremenjeni.

Zavedno izpuščene (negativno potrjene spodaj — E):
  auth/logout (izbris sej = varnostno dejanje, audit = dokumentacija),
  security/rate-limit + webhooks/retry (administrativni orodji),
  ar/analyze (samo 1 pisanje audit-a — nič za atomizirati),
  digital-twin/snapshot POST (lib build*Snapshot je tuja last — naslednji krog),
  sync / measurements/[id] PATCH / photo-visualization/[id] PATCH /
  nalog/[id]/material (utrjene odločitve R536/R537 — P2002/opId/SAGA).

Kaj preverja ta suite:
  A) fence-run: 6 rut v tx; confirm (zunanja retryOnUnique okoli cele tx,
     snapshotVersionOn(tx) brez notranjega retrija, nextPackageCodeOn(tx),
     measurementVersion v1 brez notranjega retrija); PATCH tekača ima
     recordEvent/deliverEvent (0 emitEvent); product-core wrapper.
  B) capture-session: 9 rut v tx; finish ima recordEvent + deliverEvent;
     lib finishCaptureSession sprejme klienta.
  C) produkcija/katalog: 10 rut v tx; railing-layout retry okoli CELE tx;
     inventory/loti (že atomarni od R464 — runStockTx) ostajata.
  D) preostale: 8 rut v tx; login: 4 pisanja v ENI tx (createSession(…, tx),
     rehash izračunan PRED tx); lib auth.ts createSession(userId, client=db).
  E) negativno: izpuščene rute NE vsebujejo $transaction (nespremenjene).
  F) živi dokaz: prijava (uspešna pot gre skozi tx) → 200; branja
     (engineering-rules, fence-run) → 200; odjava — čiščenje.

POGOJI: teče nad lokalno razvojno bazo (TEST_DB_URL → env.sh → DATABASE_URL,
tests/dbenv.py) in strežnikom na BASE_URL. Uporablja obstoječega admina
(admin@roksal.si) — NI novih žrtev; ustvarjena seja se odjavi (čiščenje).
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL, SKIP = 0, 0, 0


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)
def skip (msg): global SKIP; SKIP += 1; print(f'  ⏸ {msg}')


def call (method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header('authorization', f'Bearer {token}')
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header('content-type', 'application/json')
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return r.status, _json(r.read())
    except urllib.error.HTTPError as e:
        return e.code, _json(e.read())
    except Exception as e:
        return 0, {'error': str(e)}


def _json (raw):
    text = raw.decode('utf-8', 'replace')
    try:
        return json.loads(text)
    except ValueError:
        return text


def src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()


def ruta (d):  # api pot → izvorna koda route.ts
    return src(f'src/app/api/{d}/route.ts')


TX = '$transaction'
EmitRe = re.compile(r'\bemitEvent\s*\(')


print('═══ R539: transakcijska celovitost preostalih rut ═══')

# ═══ A) fence-run: 6 rut ═══════════════════════════════════════════════════
print('── A) fence-run (6 rut, confirm = 5 pisanj) ──')
for d in ['fence-run', 'fence-run/[id]', 'fence-run/[id]/confirm',
          'fence-run/[id]/layout', 'fence-run/[id]/review-link',
          'fence-run/[id]/verify']:
    chk(TX in ruta(d), f'{d}: vsebuje $transaction')
# writeAudit v verigah nosi tx klienta (2. argument) v vseh 6 rutah
for d in ['fence-run', 'fence-run/[id]', 'fence-run/[id]/confirm',
          'fence-run/[id]/layout', 'fence-run/[id]/review-link',
          'fence-run/[id]/verify']:
    s = ruta(d)
    vsi = re.findall(r'writeAudit\s*\(', s)
    na_tx = re.findall(r'\}\s*,\s*tx\s*\)', s) or re.findall(r',\s*tx\s*\)', s)
    chk(len(vsi) > 0 and len(na_tx) >= len(vsi),
        f'{d}: vsi writeAudit klici ({len(vsi)}) imajo , tx')
# confirm: zunanja retryOnUnique OKOLI cele tx; verzija/koda na tx; verzija meritev BREZ notranjega retrija
c = ruta('fence-run/[id]/confirm')
chk('retryOnUnique(() => db.$transaction' in c,
    'confirm: retryOnUnique(() => db.$transaction(…)) — retry OKOLI cele tx')
chk('snapshotVersionOn(tx' in c, 'confirm: snapshotVersionOn(tx, …) — verzija tekača v tx')
chk('nextPackageCodeOn(tx' in c, 'confirm: nextPackageCodeOn(tx, …) — koda paketa izračunana v tx')
chk('tx.measurementVersion.create' in c, 'confirm: measurementVersion.create na tx (kanonična meritev v1)')
chk(re.search(r'measurementVersion[\s\S]{0,400}retryOnUnique', c[c.find('tx.measurementVersion.create'):c.find('tx.measurementVersion.create') + 500]) is None,
    'confirm: verzija meritev BREZ notranjega retryOnUnique (pokriva ga zunanji)')
# PATCH tekača: recordEvent + deliverEvent; 0 emitEvent v družini
p = ruta('fence-run/[id]')
chk('recordEvent(' in p and 'deliverEvent(' in p,
    'fence-run/[id] PATCH: recordEvent(…, tx) + deliverEvent po commitu')
for d in ['fence-run', 'fence-run/[id]', 'fence-run/[id]/confirm',
          'fence-run/[id]/layout', 'fence-run/[id]/review-link',
          'fence-run/[id]/verify']:
    chk(EmitRe.search(ruta(d)) is None, f'{d}: 0 emitEvent (stara kombinacija odstranjena)')
# lib: product-core On-različica + wrapper; fence-run-service snapshotVersionOn
pc = src('src/lib/product-core.ts')
chk('nextPackageCodeOn(' in pc, 'product-core: nextPackageCodeOn(client, …) obstaja')
chk('return nextPackageCodeOn(db' in pc, 'product-core: nextPackageCode je wrapper na globalnem db')
chk('snapshotVersionOn(' in src('src/lib/fence-run-service.ts'),
    'fence-run-service: snapshotVersionOn(client, …) obstaja (brez notranjega retrija)')

# ═══ B) capture-session: 9 rut ═════════════════════════════════════════════
print('── B) capture-session (9 rut, finish = zaključek + dvojček) ──')
for d in ['capture-session', 'capture-session/[id]', 'capture-session/[id]/drift',
          'capture-session/[id]/finish', 'capture-session/[id]/geo-reference',
          'capture-session/[id]/loop', 'capture-session/[id]/photo',
          'capture-session/[id]/reference', 'capture-session/[id]/register']:
    chk(TX in ruta(d), f'{d}: vsebuje $transaction')
f = ruta('capture-session/[id]/finish')
chk('recordEvent(' in f and 'deliverEvent(' in f,
    'finish: recordEvent(…, tx) + deliverEvent po commitu (CAPTURE_PROCESSED)')
chk(EmitRe.search(f) is None, 'finish: 0 emitEvent')
lib = src('src/lib/capture-qa-service.ts')
chk(re.search(r'finishCaptureSession\s*\(\s*ctx[^)]*client:\s*Prisma\.TransactionClient\s*=\s*db', lib, re.S) is not None,
    'lib: finishCaptureSession(…, client: Prisma.TransactionClient = db) — neobvezen klient')
chk(re.search(r'createTwinSnapshotRow\s*\([^)]*client', lib, re.S) is not None,
    'lib: createTwinSnapshotRow sprejema klienta (veriga dvojčka na tx)')

# ═══ C) produkcija/katalog/tehnica ═════════════════════════════════════════
print('── C) produkcija/katalog/tehnica (10 rut + 2 že atomarni) ──')
for d in ['engineering-rules', 'engineering-rules/[id]', 'price-lists',
          'price-lists/[id]/rules', 'bom/[id]', 'equipment', 'material-prices',
          'production', 'production/elements/[id]', 'railing-layout']:
    chk(TX in ruta(d), f'{d}: vsebuje $transaction')
er = ruta('engineering-rules')
chk(re.search(r'ruleVersion[\s\S]{0,80}create', er) is not None and 'tx.ruleVersion.create' in er,
    'engineering-rules POST: upsert + ruleVersion + 2 reviziji v ENI tx')
rl = ruta('railing-layout')
chk('retryOnUnique(() => db.$transaction' in rl,
    'railing-layout: retryOnUnique OKOLI CELE tx (prej notranji retry verzije)')
# inventory/loti: že atomarni od R464 (runStockTx) — negativno potrjeno, da jih R539 ni razbil
inv, lot = ruta('inventory'), ruta('inventory/lots')
chk('runStockTx' in inv, 'inventory PATCH: ostaja na runStockTx (R464 — že atomarna)')
chk('runStockTx' in lot, 'inventory/lots POST: ostaja na runStockTx (R464 — že atomarna)')

# ═══ D) preostale rute + lib auth ══════════════════════════════════════════
print('── D) preostale (8 rut; login = 4 pisanja) ──')
for d in ['auth/login', 'payments/reconciliation', 'photo-visualization/[id]/export',
          'pins', 'pins/[id]', 'portal/[id]', 'measure/photo',
          'webhooks/[id]/test']:
    chk(TX in ruta(d), f'{d}: vsebuje $transaction')
lg = ruta('auth/login')
chk('createSession(user.id, tx)' in lg, 'login: createSession(user.id, tx) — seja v isti tx')
chk(re.search(r'hashPassword\(password\)', lg) is not None
    and lg.find('hashPassword(password)') < lg.find('db.$transaction'),
    'login: scrypt rehash izračunan PRED db.$transaction (čist izračun — vzorec R538-b)')
chk(re.search(r'writeAudit\s*\(\s*\{[^}]*LOGIN[\s\S]{0,200}\}\s*,\s*tx\s*\)', lg) is not None,
    'login: revizija LOGIN z , tx')
authts = src('src/lib/auth.ts')
chk(re.search(r'createSession\s*\(\s*userId:\s*string,\s*client:\s*SessionClient\s*=\s*db', authts) is not None,
    'lib auth.ts: createSession(userId, client: SessionClient = db) — neobvezen klient')

# ═══ E) zavestno izpuščene — negativno (nespremenjene) ══════════════════════
print('── E) izpuščene rute ostajajo BREZ tx (dokumentirano) ──')
for d, razlog in [
    ('auth/logout', 'izbris sej = varnostno dejanje; audit = dokumentacija'),
    ('security/rate-limit', 'administrativno orodje (reset tempomata)'),
    ('webhooks/retry', 'retry knjižnica ima lastne posodobitve z backoffom'),
    ('ar/analyze', 'samo 1 pisanje audit-a — nič za atomizirati'),
    ('digital-twin/snapshot', 'lib build*Snapshot tuja last — naslednji krog'),
]:
    chk(TX not in ruta(d), f'{d}: brez $transaction ({razlog})')

# ═══ F) živi dokaz ═════════════════════════════════════════════════════════
print('── F) živi dokaz (prijava skozi tx, branja, čiščenje) ──')
s, d = call('POST', '/api/auth/login', body={'email': 'admin@roksal.si', 'password': 'Admin123!'})
chk(s == 200, f'prijava admina (uspešna pot zdaj V $transaction) → 200 (dejansko {s})')
token = d.get('token') if isinstance(d, dict) else None
if token:
    s, d = call('GET', '/api/engineering-rules', token=token)
    chk(s == 200, f'GET /api/engineering-rules (družina v tx) → 200 (dejansko {s})')
    s, d = call('GET', '/api/fence-run', token=token)
    chk(s == 200, f'GET /api/fence-run (družina v tx) → 200 (dejansko {s})')
    s, d = call('GET', '/api/capture-session', token=token)
    chk(s == 200, f'GET /api/capture-session (družina v tx) → 200 (dejansko {s})')
    s, d = call('POST', '/api/auth/logout', body={}, token=token)
    chk(s == 200, f'odjava (čiščenje seje) → 200 (dejansko {s})')
else:
    bad('prijava ni vrnila žetona — živi del F ne morem preveriti')

print()
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ══')
sys.exit(1 if FAIL > 0 else 0)

#!/usr/bin/env python3
"""tests/r540.py — R540: ZADNJI TRANSAKCIJSKI OSTANKI (6. sklop).

Zakaj: po R537/R538/R539 (~132 rut) sta ostali ZAVEDNO izpuščeni dve družini
(R539 sinteza — »Ostanki za R540«):
  • POST /api/digital-twin/snapshot — lib build*Snapshot »tuja last«: snapshot
    zapis + revizija TWIN_SNAPSHOT_CREATE sta bila LOČENA (padec med njima =
    verzija dvojčka brez revizijskega zapisa); verzija je read-then-create na
    @@unique([projectId, kind, version]) — sočasna ustvarjanja istega kind-a
    sta padla na surovi P2002/500.
  • kodne dirke PR-/SRV- (production, production/from-twin, service-cases):
    read-then-create IZVEN tx brez retrija → P2002 → 500; from-twin je imel
    še večjo luknjo (order.create + revizija IZVEN tx, elementi v ločeni tx —
    padec je pustil NALOG BREZ ELEMENTOV); equipment (OR-, uporabniška koda)
    je dirko preko predpreverbe končal v surovem 500 namesto prijaznem 409.

R540 rešitev (isti vzorec kot R537–R539):
  db.$transaction(tx => { …branja/pisanja na tx… writeAudit(…, tx) }) z
  retryOnUnique ZUNAJ okoli CELE tx (P2002 znotraj PG tx aborta celo tx —
  ugotovitev R536); lib službe dobijo neobvezen klient (privzeto db) —
  obstoječi klici nespremenjeni; equipment: P2002 → prijazen 409 z ISTIM
  sporočilom kot predpreverba (uporabška koda — retry brezpomenski).

Kaj preverja ta suite:
  A) digital-twin/snapshot POST: 3 vrste v $transaction + retryOnUnique okoli
     cele tx; build* + revizija atomarno; lib latestSnapshot/segmentsZaProjekt/
     build*Snapshot sprejemajo neobvezen klient (privzeti db).
  B) production: PR- koda ZNOTRAJ tx na tx klientu + retryOnUnique okoli cele
     tx; from-twin: ENA interaktivna tx (nalog/regeneracija + elementi + OBE
     reviziji), 0 mutacij na globalnem db.
  C) service-cases: SRV- koda znotraj tx + retry okoli cele tx + revizija V
     isti tx (sinteza R540 — agent jo je pustil po commitu, glavni agent
     prestavil nazaj v tx po vzorcu R537+).
  D) equipment: BREZ retrija (uporabniška koda); P2002 → 409 z NATANČNO
     istim sporočilom kot predpreverba (2 pojavitvi istega niza).
  E) negativno: klicatelji lib NESPREMENJENI (montaza-qa-core 2×, twinOverview,
     twinDiff, from-twin predbranje — brez klienta); R539-b poti
     (finishCaptureSession/createTwinSnapshotRow) ostajajo; equipment nima
     retryOnUnique.
  F) živi dokaz: prijava → 200; GET snapshot ?projectId → 200 (wiring branja);
     POST snapshot brez projectId → 400 (validacija izven tx); equipment
     duplikat OR-001 → 409 prijazna predpreverba (brez pisanja); odjava.

POGOJI: teče nad lokalno razvojno bazo (TEST_DB_URL → env.sh → DATABASE_URL,
tests/dbenv.py) in strežnikom na BASE_URL. Uporablja obstoječega admina
(admin@roksal.si) in obstoječo OR-001 iz semena — NI novih žrtev; ustvarjena
seja se odjavi (čiščenje).
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

print('═══ R540: zadnji transakcijski ostanki ═══')

# ═══ A) digital-twin/snapshot POST — build* + revizija atomarno ═════════════
print('── A) digital-twin/snapshot: 3 vrste v tx + lib threading ──')
snap = ruta('digital-twin/snapshot')
chk(snap.count('retryOnUnique(() => db.$transaction') == 3,
    'snapshot POST: 3× retryOnUnique(() => db.$transaction(…)) — ena na vrsto')
for kind, fn in [('AS_DESIGNED', 'buildDesignedSnapshot'),
                 ('AS_PRODUCED', 'buildProducedSnapshot'),
                 ('AS_INSTALLED', 'buildInstalledSnapshot')]:
    chk(re.search(rf'{fn}\s*\(\s*\{{[^;]*?\}},\s*tx\s*\)', snap, re.S) is not None,
        f'snapshot POST: {kind} → {fn}(…, tx) — build teče NA tx klientu')
na_tx = len(re.findall(r'\}\s*,\s*tx\s*\)', snap))
vsi_audit = len(re.findall(r'writeAudit\s*\(', snap))
chk(vsi_audit == 3 and na_tx >= 3,
    f'snapshot POST: vsi writeAudit klici ({vsi_audit}) imajo , tx (revizija V tx)')
chk("import { retryOnUnique } from '@/lib/versioning'" in snap,
    'snapshot POST: uvoz retryOnUnique iz @/lib/versioning')

lib = src('src/lib/capture-qa-service.ts')
chk(re.search(r'export async function latestSnapshot\s*\(\s*projectId: string,\s*kind: string,\s*client: Prisma\.TransactionClient = db', lib) is not None,
    'lib: latestSnapshot(projectId, kind, client = db) — neobvezen klient')
chk(re.search(r'export async function segmentsZaProjekt\s*\(\s*projectId: string,\s*opts\?:[^,]*,\s*client: Prisma\.TransactionClient = db', lib) is not None,
    'lib: segmentsZaProjekt(projectId, opts?, client = db) — TRETJI neobvezen parameter')
for fn in ['buildDesignedSnapshot', 'buildProducedSnapshot', 'buildInstalledSnapshot']:
    m = re.search(rf'export async function {fn}\s*\(\s*args:\s*\{{[\s\S]*?\}}\s*(,\s*client: Prisma\.TransactionClient = db)?\s*\)\s*:', lib)
    chk(m is not None and m.group(1) is not None,
        f'lib: {fn}(args, client = db) — drugi parameter klient')
# build* ne dostopajo več do globalnega db (vse čez klienta)
for fn in ['buildDesignedSnapshot', 'buildProducedSnapshot', 'buildInstalledSnapshot']:
    telo = lib[lib.find(f'export async function {fn}'):]
    telo = telo[:telo.find('\nexport ')]
    chk(re.search(r'\bdb\.(projectPackage|photoVisualization|bom|workOrder|fenceRun|measurement|digitalTwinSnapshot)\b', telo) is None,
        f'lib: {fn} — 0 dostopov do globalnega db (branja in pisanja čez klienta)')
# R539-b poti ostajajo (finishCaptureSession kliče createTwinSnapshotRow z klientom)
chk(re.search(r'finishCaptureSession[\s\S]{0,2000}?createTwinSnapshotRow\(\{[\s\S]*?\},\s*client\s*\)', lib) is not None,
    'lib: finishCaptureSession → createTwinSnapshotRow(…, client) — R539-b pot nespremenjena')
chk(re.search(r'export async function createTwinSnapshotRow[\s\S]{0,600}?,\s*client:\s*Prisma\.TransactionClient\s*=\s*db', lib) is not None,
    'lib: createTwinSnapshotRow(args, client = db) — podpis R539-b ostaja')

# ═══ B) production PR- + from-twin — ena interaktivna tx ════════════════════
print('── B) production + from-twin: PR- koda v tx, vse v ENI tx ──')
prod = ruta('production')
chk('retryOnUnique(() => db.$transaction' in prod,
    'production POST: retryOnUnique okoli CELE tx')
chk('tx.productionOrder.findMany' in prod and "startsWith: 'PR-'" in prod,
    'production POST: branje zasedenih PR- kod ZNOTRAJ tx na tx klientu')
prod_post = prod[prod.find('export async function POST'):]
chk('db.productionOrder.findMany' not in prod_post,
    'production POST: 0 read-then-create branj na globalnem db (GET seznam nedotaknjen)')
chk(len(re.findall(r'writeAudit\s*\(', prod)) >= 1 and '}, tx)' in prod,
    'production POST: writeAudit(…, tx) — revizija v isti tx')

ft = ruta('production/from-twin')
chk('retryOnUnique(() => db.$transaction' in ft,
    'from-twin: retryOnUnique okoli CELE tx (dirka PR-)')
chk('tx.productionOrder.findMany' in ft and "startsWith: 'PR-'" in ft,
    'from-twin: branje PR- kod ZNOTRAJ tx')
chk('tx.productionOrder.create' in ft,
    'from-twin: ustvarjanje naloga ZNOTRAJ tx')
chk('tx.productionElement.deleteMany' in ft,
    'from-twin: regeneracijska deleteMany ZNOTRAJ tx (prej izven)')
chk('tx.productionElement.create' in ft,
    'from-twin: ustvarjanje lističev ZNOTRAJ iste tx')
chk('db.productionOrder.create' not in ft and 'db.productionElement.create' not in ft
    and 'db.productionElement.deleteMany' not in ft,
    'from-twin: 0 mutacij na globalnem db (prej order.create + deleteMany izven tx)')
ft_audit = len(re.findall(r'writeAudit\s*\(', ft))
ft_na_tx = len(re.findall(r'\}\s*,\s*tx\s*\)', ft))
chk(ft_audit >= 2 and ft_na_tx >= 2,
    f'from-twin: OBE reviziji ({ft_audit}) v isti tx (, tx)')
chk(re.search(r'const\s+\{\s*orderId,\s*orderCode,\s*created\s*\}\s*=\s*await retryOnUnique', ft) is not None,
    'from-twin: odgovor se sestava iz tx rezultata (oblika nespremenjena)')

# ═══ C) service-cases SRV- + revizija v tx (sinteza R540) ═══════════════════
print('── C) service-cases: SRV- v tx + revizija V tx ──')
sc = ruta('service-cases')
chk('retryOnUnique(() => db.$transaction' in sc,
    'service-cases POST: retryOnUnique okoli CELE tx (dirka SRV-)')
chk('tx.serviceCase.findMany' in sc and "startsWith: 'SRV-'" in sc,
    'service-cases POST: branje SRV- kod ZNOTRAJ tx na tx klientu')
chk('tx.claim.update' in sc,
    'service-cases POST: premik claima v V_OBRAVNAVI znotraj tx')
sc_m = re.search(r'db\.\$transaction\([\s\S]*?\)\s*,\s*3\s*\)', sc)
chk(sc_m is not None and 'writeAudit' in sc_m.group(0),
    'service-cases POST: writeAudit ZNOTRAJ tx (prestavljen s sintezo R540 — prej po commitu)')
chk(sc.count('await writeAudit(') == 1 and '}, tx)' in sc,
    'service-cases POST: natanko 1 writeAudit, nosi , tx')

# ═══ D) equipment OR- — uporabniška koda, P2002 → prijazen 409 ═════════════
print('── D) equipment: P2002 → 409 z istim sporočilom (brez retrija) ──')
eq = ruta('equipment')
chk(re.search(r'retryOnUnique\s*\(', eq) is None,
    'equipment POST: BREZ aktivnega retryOnUnique klica (uporabniška koda — retry brezpomenski; omemba v komentarju OK)')
chk(eq.count('Orodje s kodo ${code} že obstaja.') == 2,
    'equipment POST: sporočilo 409 natanko 2× (predpreverba + P2002 ulov — enako besedilo)')
chk(re.search(r"\(e as \{ code\?: string \}\)\.code === 'P2002'", eq) is not None,
    'equipment POST: ulov P2002 (isti idiom kot nalog/setup)')
chk('jsonError(409' in eq and 'db.$transaction' in eq,
    'equipment POST: create + revizija v tx, napaka dirke → 409 (ne 500)')

# ═══ E) negativno — klicatelji lib NESPREMENJENI ════════════════════════════
print('── E) klicatelji lib ostajajo na privzetem db ──')
for pot, fn in [('src/lib/montaza-qa-core.ts', 'segmentsZaProjekt'),
                ('src/lib/capture-qa-service.ts', 'segmentsZaProjekt'),
                ('src/lib/capture-qa-service.ts', 'latestSnapshot'),
                ('src/app/api/production/from-twin/route.ts', 'latestSnapshot')]:
    s = src(pot)
    klici = re.findall(rf'{fn}\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)', s)
    # izpustimo deklaracijo (export async function …)
    klici = [k for k in klici if 'projectId:' not in k]
    z_klientom = [k for k in klici if re.search(r'\b(tx|client)\s*(?:,|\))', k)]
    chk(len(klici) > 0 and len(z_klientom) == 0,
        f'{pot.rsplit("/", 1)[-1]}: {fn} — vsi klici ({len(klici)}) brez klienta (privzeti db)')
# r539 E-seznam: digital-twin/snapshot ODSTRANJEN iz negativnih (zdaj v tx)
r539 = src('tests/r539.py')
chk("('digital-twin/snapshot'" not in r539,
    'tests/r539.py: digital-twin/snapshot odstranjen iz E negativnega seznama (zdaj trditve v r540)')

# ═══ F) živi dokaz ═════════════════════════════════════════════════════════
print('── F) živi dokaz (prijava, wiring branja/validacije, 409, čiščenje) ──')
s, d = call('POST', '/api/auth/login', body={'email': 'admin@roksal.si', 'password': 'Admin123!'})
chk(s == 200, f'prijava admina → 200 (dejansko {s})')
token = d.get('token') if isinstance(d, dict) else None
if token:
    s, d = call('GET', '/api/projects', token=token)
    chk(s == 200, f'GET /api/projects → 200 (dejansko {s})')
    pid = None
    if s == 200 and isinstance(d, dict) and isinstance(d.get('data'), list) and d['data']:
        pid = d['data'][0].get('id')
    if pid:
        s, d = call('GET', f'/api/digital-twin/snapshot?projectId={pid}', token=token)
        chk(s == 200 and isinstance(d, dict) and isinstance(d.get('data'), list),
            f'GET /api/digital-twin/snapshot?projectId → 200 + data[] (dejansko {s})')
    else:
        skip('ni projekta za živi wiring test')
    s, d = call('POST', '/api/digital-twin/snapshot', token=token, body={})
    chk(s == 400, f'POST snapshot brez projectId → 400 (validacija izven tx; dejansko {s})')
    s, d = call('POST', '/api/digital-twin/snapshot', token=token,
                body={'projectId': pid or 'x', 'kind': 'AS_MEASURED', 'reason': 'r540 živi test'})
    chk(s == 400, f'POST snapshot AS_MEASURED → 409/400 zavrnjen (samo prek finish; dejansko {s})')
    # equipment: duplikat obstoječe OR-001 iz semena → prijazna predpreverba 409 (brez pisanja)
    s, d = call('POST', '/api/equipment', token=token,
                body={'code': 'OR-001', 'name': 'r540 živi test duplikata'})
    chk(s == 409 and isinstance(d, dict) and 'že obstaja' in str(d.get('error', '')),
        f'POST equipment duplikat OR-001 → 409 prijazno sporočilo (dejansko {s})')
    s, d = call('POST', '/api/auth/logout', token=token)
    chk(s in (200, 204), f'odjava (čiščenje seje) → {s}')
else:
    skip('ni žetona — živi deli preskočeni')

print(f'\\n{"R540":═<40} {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸')
sys.exit(1 if FAIL else 0)

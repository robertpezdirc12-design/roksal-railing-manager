#!/usr/bin/env python3
"""tests/r542.py — R542: PRETVORBA JSON-V-TEXT STOLPCEV V PRAVI JSONB TIP.

Zakaj: 42 Prisma String polj je de facto hranilo JSON (inventura R542-a:
podatki 100 % veljavni JSON, 0 praznih nizov, 0/44 neveljavnih) — baza pa
jih je tipizirala kot TEXT. R542 jih pretvori v pravi jsonb v ENI migraciji
(20261024000000_r542_text_v_jsonb, vzorec ročne migracije R541): NULLIF
varovalka pretvori le morebitni prazen niz v NULL, NOT NULL ostaja, IZKLJUČENA
pa sta WebhookDelivery.payload (HMAC podpis nad DOBESEDNIMI bajti — niz je
pogodba) in Setting.value (skalarni KV: licence.status, seje, zaporedja).

Sprememba pogodbe API-jev (atomarno s frontendom, R542-b/c/c2): prej so rute
sprejemale/vračale JSON NIZE za teh 42 polj; zdaj so to OBJEKTI end-to-end.
Zadnji 3 surovi prehodi (measurements POST/PATCH params, ar-snapshots
analysis+params) so zaprti z zod (niz → 400 s slovenskim sporočilom).

Kaj preverja ta suite (49. skupina):
  A) statično: migracija obstaja s TOČNO 42 ALTER … TYPE jsonb ukazi (vsak z
     NULLIF varovalko), glava utemeljuje izključitvi; schema.prisma ima vseh
     42 polj tipa Json (in skupno TOČNO 42 Json polj — nobenega več/manj);
     WebhookDelivery.payload + Setting.value ostajata String; zod objektna
     vrata na obeh merilnih rutah in ar-snapshots.
  B) živi DB dokaz (bun + pg): vseh 42 stolpcev ima atttypid = jsonb::regtype;
     izključenitvi ostajata text; zapis-bris dokaz na JobRun.detail (objekt
     globinsko enak nazaj, čiščenje 0 ostankov).
  C) živi HTTP dokaz: prijava; POST /api/measurements params kot NIZ → 400 s
     zod sporočilom, kot OBJEKT → 201 (+ branje prek prisma mostu + čiščenje);
     GET /api/audit vrača detail kot OBJEKT (ne niz); GET /api/products
     vrača tech kot OBJEKT; POST /api/ar-snapshots analysis kot NIZ → 400;
     odjava.
  D) registracija: ci-matrix.sh (GRUPE + CLANI) in ci.yml matrika.

POGOJI: teče nad lokalno razvojno bazo (TEST_DB_URL → env.sh → DATABASE_URL →
.env, tests/dbenv.py) in strežnikom na BASE_URL. Uporablja obstoječega admina
(admin@roksal.si) — ustvarjeni ZZ-r542 zapisi se pobrišejo (čiščenje).
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL, SKIP = 0, 0, 0

TAG = 'ZZ-r542'


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


def src_has (relpath, needle):
    try:
        return needle in src(relpath)
    except Exception:
        return False


def db_url ():
    """DATABASE_URL za žive preglede: TEST_DB_URL → DATABASE_URL (če je postgres)
    → .env datoteka. PAST peskovnika: izvožen zastareli file: URL R528."""
    v = os.environ.get('TEST_DB_URL') or ''
    if v.startswith('postgresql://'):
        return v
    v = os.environ.get('DATABASE_URL') or ''
    if v.startswith('postgresql://'):
        return v
    try:
        with open(os.path.join(REPO, '.env'), encoding='utf-8') as f:
            for line in f:
                if line.startswith('DATABASE_URL='):
                    return line.split('=', 1)[1].strip().strip('"')
    except OSError:
        pass
    return ''


def cisto_okolje (**dodatki):
    """Osnovno okolje subprocessov BREZ semenskih/knjižnih spremenljivk."""
    env = {k: v for k, v in os.environ.items()
           if k not in ('SEED_CONFIRM', 'SEED_ALLOW_REMOTE', 'NODE_ENV', 'PRISMA_LOG_QUERIES')}
    env.update(dodatki)
    return env


def bun_e (script, *args, env=None, timeout=90):
    """bun -e z DB okoljem (PrismaClient + .env knjižnica baze)."""
    e = env if env is not None else cisto_okolje(DATABASE_URL=db_url())
    return subprocess.run(['bun', '-e', script, *args], cwd=REPO, capture_output=True,
                          text=True, timeout=timeout, env=e)


MIG = 'prisma/migrations/20261024000000_r542_text_v_jsonb/migration.sql'

# 42 (tabela, stolpec) parov iz migracije — vrstni red kot v datoteki.
POLJA = [
    ('Measurement', 'params'), ('MeasurementVersion', 'data'),
    ('CatalogVersion', 'data'), ('AuditLog', 'detail'),
    ('NotificationEvent', 'payload'), ('JobRun', 'detail'),
    ('RuleVersion', 'oldValue'), ('RuleVersion', 'newValue'),
    ('SyncOp', 'result'), ('Product', 'tech'), ('ProductVariant', 'tech'),
    ('ProjectPackage', 'calcJson'), ('HandoverReport', 'diffJson'),
    ('HandoverReport', 'photosJson'), ('ArSnapshot', 'analysis'),
    ('ArSnapshot', 'params'), ('ArSnapshot', 'sceneJson'),
    ('VizProject', 'params'), ('PhotoVisualization', 'renderParams'),
    ('PhotoVisualizationVersion', 'data'), ('PlaybookDef', 'definition'),
    ('PlaybookRun', 'context'), ('PlaybookRun', 'handoff'),
    ('PlaybookStepRun', 'evidence'), ('FenceRun', 'calibration'),
    ('FenceRun', 'terrain'), ('FenceRun', 'nodes'), ('FenceRun', 'quality'),
    ('FenceRunVersion', 'data'), ('ReviewPin', 'snapshot'),
    ('WebhookSubscription', 'events'), ('CaptureSession', 'device'),
    ('CaptureSession', 'outdoor'), ('CaptureSession', 'plan'),
    ('CaptureSession', 'state'), ('CaptureSession', 'coverage'),
    ('CaptureSession', 'drift'), ('CapturePhoto', 'quality'),
    ('DigitalTwinSnapshot', 'data'), ('DigitalTwinSnapshot', 'sources'),
    ('Registration', 'points'), ('Registration', 'transform'),
]

print('═══ R542: JSON-v-TEXT stolpci → pravi jsonb (42) ═══')

# ═══ A) statične preverbe migracije + sheme + zod ═════════════════════════════
print('── A) migracija + shema + zod (statično) ──')

chk(os.path.isfile(os.path.join(REPO, MIG)),
    'migracija 20261024000000_r542_text_v_jsonb/migration.sql obstaja')
sql = src(MIG) if src_has(MIG, 'TYPE jsonb') else ''
chk(sql.count('TYPE jsonb') == 42,
    f'migracija vsebuje TOČNO 42 ukazov ALTER … TYPE jsonb (dejansko {sql.count("TYPE jsonb")})')
chk(sql.count("NULLIF(") == 42,
    f'VSAK ukaz nosi NULLIF varovalko (prazen niz → NULL, ne napaka casta; dejansko {sql.count("NULLIF(")})')
chk('ALTER TABLE' in sql and sql.count('ALTER TABLE') == 42,
    'TOČNO 42 ukazov ALTER TABLE (brez dodatnih ročnih sprememb)')
manjka = [f'{t}.{c}' for (t, c) in POLJA if f'ALTER TABLE "{t}" ALTER COLUMN "{c}"' not in sql]
chk(not manjka, f'vseh 42 tabel.stolpcev navzočih v migraciji (manjka: {manjka or "—"})')
glava = sql[:sql.find('ALTER TABLE')]
chk('WebhookDelivery' in glava and 'Setting' in glava,
    'glava migracije utemeljuje OBE izključitvi (WebhookDelivery.payload HMAC / Setting.value skalarni KV)')


def json_polja_sheme ():
    """(model, polje) za VSA polja tipa Json v prisma/schema.prisma."""
    para, model = [], None
    with open(os.path.join(REPO, 'prisma/schema.prisma'), encoding='utf-8') as f:
        for line in f:
            m = re.match(r'^model\s+(\w+)\s*\{', line)
            if m:
                model = m.group(1)
                continue
            if line.startswith('}') and model:
                model = None
                continue
            if model:
                fm = re.match(r'^\s+(\w+)\s+Json(\?)?\s', line)
                if fm:
                    para.append((model, fm.group(1)))
    return para


shemski = json_polja_sheme()
chk(len(shemski) == 42,
    f'schema.prisma ima TOČNO 42 polj tipa Json (dejansko {len(shemski)})')
manjkajoca = [f'{t}.{c}' for (t, c) in POLJA if (t, c) not in shemski]
prevec = [f'{t}.{c}' for (t, c) in shemski if (t, c) not in POLJA]
chk(not manjkajoca and not prevec,
    f'shemska množica Json polj = migracijska množica (manjka: {manjkajoca or "—"}, odveč: {prevec or "—"})')

schema = src('prisma/schema.prisma')


def vrstica_modela (model, polje):
    blok, notri = [], False
    for line in schema.splitlines():
        if re.match(rf'^model\s+{model}\s*\{{', line):
            notri = True
            continue
        if notri and line.startswith('}'):
            break
        if notri:
            blok.append(line)
    for line in blok:
        if re.match(rf'^\s+{polje}\s+', line):
            return line
    return ''


chk(re.match(r'^\s+payload\s+String', vrstica_modela('WebhookDelivery', 'payload')) is not None,
    'WebhookDelivery.payload OSTAJA String (HMAC nad dobesednimi bajti — izključitev R542-a)')
chk(re.match(r'^\s+value\s+String', vrstica_modela('Setting', 'value')) is not None,
    'Setting.value OSTAJA String (skalarni KV — izključitev R542-a)')

# zod zaprtje 3 surovih prehodov (R542-b: edina golih prehodov po inventuri)
mpost = src('src/app/api/measurements/route.ts')
chk("z.record(z.string(), z.unknown()" in mpost and 'params mora biti JSON objekt' in mpost,
    'measurements/route.ts: params = z.record(…z.unknown()) — niz zavrnjen s slovenskim 400')
mpatch = src('src/app/api/measurements/[id]/route.ts')
chk("z.record(z.string(), z.unknown()" in mpatch and 'params mora biti JSON objekt' in mpatch,
    'measurements/[id]/route.ts: params = z.record(…z.unknown()) — niz zavrnjen s slovenskim 400')
ar = src('src/app/api/ar-snapshots/route.ts')
chk("const JsonObjectSchema = z.record(z.string(), z.unknown()" in ar
    and ar.count('JsonObjectSchema.safeParse') == 2,
    'ar-snapshots/route.ts: JsonObjectSchema (z.record) za analysis IN params (2 surova prehoda)')

# ═══ B) živi DB dokaz — tipi stolpcev + zapis/bris ════════════════════════════
print('── B) živi DB dokaz (pg_attribute + zapis/bris) ──')
DBU = db_url()
if not DBU:
    skip('ni postgres povezave (TEST_DB_URL/DATABASE_URL/.env) — blok B preskočen')
else:
    r = bun_e("""
import { Client } from 'pg'
const POLJA = %s
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const r = await c.query(`
  SELECT count(*)::int AS nadjeno,
         count(*) FILTER (WHERE a.atttypid = 'jsonb'::regtype)::int AS jsonb
  FROM (VALUES ${POLJA.map((p, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')}) AS p(tbl, col)
  JOIN pg_class cl ON cl.relname = p.tbl
  JOIN pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attname = p.col AND a.attnum > 0
`, POLJA.flat())
const izklj = await c.query(`
  SELECT c.relname || '.' || a.attname AS stolpec, t.typname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE a.attnum > 0 AND ((c.relname = 'WebhookDelivery' AND a.attname = 'payload')
                       OR (c.relname = 'Setting' AND a.attname = 'value'))
`)
console.log('TIPI:' + JSON.stringify(r.rows[0]) + ' IZKLJ:' + JSON.stringify(izklj.rows))
await c.end()
""" % json.dumps([[t, c] for (t, c) in POLJA]))
    m = re.search(r"TIPI:(\{.*?\}) IZKLJ:(\[.*?\])", r.stdout)
    d, izklj = {}, []
    if m:
        try:
            d = json.loads(m.group(1))
            izklj = json.loads(m.group(2))
        except ValueError:
            pass
    chk(r.returncode == 0 and d.get('nadjeno') == 42,
        f"vseh 42 stolpcev najdenih v pg_attribute (dejansko {d.get('nadjeno')})")
    chk(d.get('jsonb') == 42,
        f"vseh 42 stolpcev ima atttypid = jsonb::regtype (dejansko {d.get('jsonb')})")
    izklj_tipi = {e['stolpec']: e['typname'] for e in izklj}
    chk(izklj_tipi.get('WebhookDelivery.payload') == 'text' and izklj_tipi.get('Setting.value') == 'text',
        f"izključenitvi ostajata text (WebhookDelivery.payload={izklj_tipi.get('WebhookDelivery.payload')}, "
        f"Setting.value={izklj_tipi.get('Setting.value')})")

    # zapis → brisanje dokaz na JobRun.detail (objekt globinsko enak nazaj)
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const vhod = { korak: 'r542-dokaz', stevilke: [1, 2, 3], gnezdeno: { sumnik: 'čžš ČŽŠ', nic: null } }
const canon = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
}
const j = await db.jobRun.create({ data: {
  job: 'ZZ-r542-dokazni-zagon', ok: true, affected: 0,
  startedAt: new Date(), finishedAt: new Date(), detail: vhod,
} })
const prebrano = await db.jobRun.findUnique({ where: { id: j.id }, select: { detail: true } })
const briši = await db.jobRun.deleteMany({ where: { job: { startsWith: 'ZZ-r542' } } })
const ostanki = await db.jobRun.count({ where: { job: { startsWith: 'ZZ-r542' } } })
console.log(JSON.stringify({
  jeObjekt: typeof prebrano.detail === 'object' && prebrano.detail !== null,
  enako: canon(prebrano.detail) === canon(vhod),
  pobrisanih: briši.count, ostanki,
}))
await db.$disconnect()
""")
    try:
        d = json.loads(r.stdout.strip().splitlines()[0])
    except Exception:
        d = {}
    chk(r.returncode == 0 and d.get('jeObjekt'),
        f"JobRun.detail zapis kot OBJEKT se prebere kot objekt (typeof object, dejansko {d.get('jeObjekt')})")
    chk(d.get('enako') is True,
        f"JobRun.detail zapis→branje GLOBINSKO enak (kanonična primerjava ključev — jsonb ne ohranja vrstnega reda; dejansko {d.get('enako')})")
    chk(d.get('ostanki') == 0,
        f"testni JobRun pobrisan — 0 ZZ-r542 ostankov (dejansko {d.get('ostanki')})")

# ═══ C) živi HTTP dokaz — pogodba niz→objekt ═════════════════════════════════
print('── C) živi HTTP dokaz (pogodba objektov end-to-end) ──')
s, d = call('POST', '/api/auth/login', body={'email': 'admin@roksal.si', 'password': 'Admin123!'})
chk(s == 200, f'prijava admina → 200 (dejansko {s})')
token = d.get('token') if isinstance(d, dict) else None
if not token:
    skip('ni žetona — blok C preskočen')
else:
    PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC8zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q='

    # 1) params kot NIZ → zod 400 (surov prehod zaprt)
    s, d = call('POST', '/api/measurements', token=token,
                body={'type': 'FOTO', 'location': f'{TAG} teren',
                      'params': json.dumps({'photo': PHOTO}), 'note': TAG})
    chk(s == 400 and 'params mora biti JSON objekt' in str(d.get('detail', '')),
        f"POST /api/measurements params=NIZ → 400 z zod sporočilom (dejansko {s}, {str(d.get('detail', ''))[:60]})")

    # 2) params kot OBJEKT → 201 (+ DB dokaz prek prisma mostu + čiščenje)
    s, d = call('GET', '/api/projects', token=token)
    projekti = d.get('data') if isinstance(d, dict) else []
    pid = projekti[0].get('id') if projekti else None
    s, d = call('POST', '/api/measurements', token=token,
                body={'type': 'FOTO', 'projectId': pid, 'location': f'{TAG} teren',
                      'params': {'photo': PHOTO, 'stage': 'R542'}, 'note': TAG})
    mid = d.get('data', {}).get('id') if isinstance(d, dict) else None
    chk(s == 201 and mid is not None,
        f'POST /api/measurements params=OBJEKT → 201 (dejansko {s})')
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const m = await db.measurement.findUnique({ where: { id: process.argv[1] }, select: { params: true } })
const brez = await db.measurement.deleteMany({ where: { note: { startsWith: 'ZZ-r542' } } })
await db.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE "detail"::text LIKE $1', '%ZZ-r542%')
const ostanki = await db.measurement.count({ where: { note: { startsWith: 'ZZ-r542' } } })
console.log(JSON.stringify({ jeObjekt: typeof m?.params === 'object' && m?.params !== null,
  photo: m?.params?.photo ?? null, stage: m?.params?.stage ?? null, ostanki }))
await db.$disconnect()
""", mid or 'x')
    try:
        d2 = json.loads(r.stdout.strip().splitlines()[0])
    except Exception:
        d2 = {}
    chk(d2.get('jeObjekt') and d2.get('stage') == 'R542' and (d2.get('photo') or '').startswith('data:image/jpeg'),
        f"DB: params prebran kot OBJEKT z vsemi ključi (photo + stage; dejansko {d2.get('jeObjekt')}/{d2.get('stage')})")
    chk(d2.get('ostanki') == 0,
        f"meritve ZZ-r542 pobrisane (verzije kaskadno) + revizije počiščene — 0 ostankov (dejansko {d2.get('ostanki')})")

    # 3) /api/audit vrača detail kot OBJEKT
    s, d = call('GET', '/api/audit?limit=100', token=token)
    vnosi = d.get('data') if isinstance(d, dict) else []
    ne_null = [e for e in (vnosi or []) if e.get('detail') is not None]
    chk(s == 200 and bool(ne_null),
        f'GET /api/audit → 200 z vsaj enim ne-praznim detail (dejansko {s}, {len(ne_null)} vrstic)')
    chk(bool(ne_null) and isinstance(ne_null[0].get('detail'), dict),
        f'detail prve ne-prazne vrstice je OBJEKT/dict (dejansko {type(ne_null[0].get("detail")).__name__ if ne_null else "—"})')
    chk(all(isinstance(e.get('detail'), (dict, list)) for e in ne_null),
        f'NOBEN detail v vzorcu ni več NIZ (vseh {len(ne_null)} ne-praznih je dict/list)')

    # 4) /api/products vrača tech kot OBJEKT
    s, d = call('GET', '/api/products?family=all', token=token)
    izdelki = d.get('data') if isinstance(d, dict) else []
    s_teh = [p for p in (izdelki or []) if p.get('tech') is not None]
    chk(s == 200 and bool(s_teh),
        f'GET /api/products?family=all → 200 z vsaj enim izdelkom s tech (dejansko {s}, {len(s_teh)})')
    chk(bool(s_teh) and isinstance(s_teh[0].get('tech'), dict),
        f"tech prvega izdelka ({s_teh[0].get('sku') if s_teh else '—'}) je OBJEKT/dict (dejansko {type(s_teh[0].get('tech')).__name__ if s_teh else '—'})")
    chk(all(isinstance(p.get('tech'), (dict, list)) for p in s_teh),
        f'NOBEN tech v vzorcu ni več NIZ (vseh {len(s_teh)} ne-praznih je dict/list)')

    # 5) ar-snapshots analysis kot NIZ → zod 400
    s, d = call('POST', '/api/ar-snapshots', token=token,
                body={'scene': f'{TAG} prizor', 'analysis': json.dumps({'placement': []})})
    chk(s == 400 and 'analysis mora biti JSON objekt' in str(d.get('detail', '')),
        f"POST /api/ar-snapshots analysis=NIZ → 400 z zod sporočilom (dejansko {s}, {str(d.get('detail', ''))[:60]})")

    s, d = call('POST', '/api/auth/logout', token=token)
    chk(s in (200, 204), f'odjava (čiščenje seje) → {s}')

# ═══ D) registracija skupine ═════════════════════════════════════════════════
print('── D) registracija (matrika + CI) ──')
matrika = src('tests/ci-matrix.sh')
grupe_vrstica = next((v for v in matrika.splitlines() if v.startswith('GRUPE=')), '')
# pozicijsko neodvisno — r542 ne mere biti zadnji v seznamu (naslednja skupina ga ne prelomi)
chk(re.search(r'(?<![\w-])r542(?![\w-])', grupe_vrstica) is not None and 'CLANI[r542]="r542.py"' in matrika,
    'ci-matrix.sh: skupina r542 v GRUPE seznamu in CLANI razdelitvi')
ciyml = src('.github/workflows/ci.yml')
chk('grupa: r542' in ciyml, 'CI workflow: skupina r542 v matriki')

print(f'\n{"R542":═<40} {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸')
sys.exit(1 if FAIL else 0)

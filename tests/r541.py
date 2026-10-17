#!/usr/bin/env python3
"""tests/r541.py — R541: CHECK OMEJITVE STATUSNIH POLJ + ZOD STATUS PROJEKTA.

Zakaj: revizija v1.58.0 je ugotovila, da statusna polja (36 modelov) nimajo
NEBENE CHECK/enum omejitve v bazi — vse so TEXT in sprejmejo poljuben niz.
Inventura R541-a je dokazala: (1) 34/36 polj je API-že-zaprtih (whitelist/
fiksni literal/izračun) — CHECK je za njih čista obramba v globini;
(2) Project.status je imel EDINA 2 surova pass-through kraja (POST/PATCH
/api/projects: z.string() je spustil poljuben niz v bazo); (3) DB DISTINCT
vrednosti so VSE podmnožica dokumentiranih množic → CHECK nemoten.

R541 rešitev:
  • migracija 20261023000000_r541_status_check: 36 ukazov
    ALTER TABLE … ADD CONSTRAINT <Tabela>_<stolpec>_check CHECK (… IN (…)) —
    množice = unija shemskih komentarjev ∪ pisnih krajev v kodi ∪ dejanskih
    vrednosti (inventura R541-a; FenceSegment BREZ INVALIDATED — razlikuje se
    od Measurement §9; MontazaAction piše ODRAVLJENO; PlaybookDef vključuje
    RETIRED; PlaybookStepRun vključuje NEUSPESNO). Prisma DSL ne pozna CHECK
    constraintov — ročna dopolnitev migracije je dokumentirana pot
    (prisma migrate dev ne-modeliranih objektov ne odstrani).
  • zod: PROJECT_STATUSES v src/lib/validate.ts (ena množica za obe ruti) —
    POST/PATCH /api/projects status zdaj z.enum (neveljaven → 400, prej tiho
    zapisan); UI pošilja samo 5 veljavnih vrednosti (inventura R541-a).
  • prisma/schema.prisma: SAMO komentarji (PlaybookDef/PlaybookStepRun
    dopolnjena seznama vrednosti) — brez sprememb tipov/regeneracije klienta.

Kaj preverja ta suite (48. skupina):
  A) statično: migracija obstaja, točno 36 ADD CONSTRAINT, vsa imena tabel,
     FenceSegment BREZ INVALIDATED (semantična past §9), MontazaAction
     ODRAVLJENO, PlaybookDef RETIRED, ProjectPackage POVPRAŠEVANJE (Š),
     projects ruti uporabljata z.enum(PROJECT_STATUSES), validate.ts izvaža
     5 vrednosti, shema ima dopolnjena komentarja.
  B) živi DB dokaz: 36 CHECK constraintov v pg_constraint; neveljaven update
     Project.status ZAVRŽEN (Project_status_check) in pusti vrstico
     nepoškodovano; veljaven update uspe; testni projekt pobrisan.
  C) živi HTTP dokaz: POST /api/projects neveljaven status → 400 z zod
     sporočilom; veljaven 'TEREN' → 201; PATCH neveljaven → 400; veljaven
     'ZAKLJUCEN' → 200; vsi ZZ- projekti počiščeni (disciplina r459).
  D) registracija: ci-matrix.sh (GRUPE + CLANI) in ci.yml matrika.

POGOJI: teče nad lokalno razvojno bazo (TEST_DB_URL → env.sh → DATABASE_URL →
.env, tests/dbenv.py) in strežnikom na BASE_URL. Uporablja obstoječega admina
(admin@roksal.si) — ustvarjeni ZZ- testni projekti se pobrišejo (čiščenje).
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


MIG = 'prisma/migrations/20261023000000_r541_status_check/migration.sql'

# 36 tabel iz migracije (vrstni red kot v datoteki)
TABELE = ['Lead', 'Opportunity', 'Project', 'Quote', 'Invoice', 'WorkOrder',
          'Measurement', 'Equipment', 'ProductionOrder', 'ProductionElement',
          'Warranty', 'Claim', 'ServiceCase', 'NotificationDelivery',
          'MaterialOrder', 'ProductAsset', 'Bom', 'ProjectPackage',
          'StockReservation', 'PickingList', 'MontazaCheck', 'MontazaAction',
          'HandoverReport', 'Delivery', 'PhotoVisualization', 'PlaybookDef',
          'PlaybookRun', 'PlaybookStepRun', 'FenceRun', 'FenceSegment',
          'ReviewPin', 'WebhookDelivery', 'CaptureSession', 'CaptureReference',
          'GeoReference', 'LoopClosure']

print('═══ R541: CHECK omejitve statusnih polj + zod status projekta ═══')

# ═══ A) statične preverbe migracije in kode ══════════════════════════════════
print('── A) migracija + zod (statično) ──')

chk(os.path.isfile(os.path.join(REPO, MIG)),
    'migracija 20261023000000_r541_status_check/migration.sql obstaja')
sql = src(MIG) if src_has(MIG, 'ADD CONSTRAINT') else ''
chk(sql.count('ADD CONSTRAINT') == 36,
    f'migracija vsebuje TOČNO 36 ukazov ADD CONSTRAINT (dejansko {sql.count("ADD CONSTRAINT")})')
manjka = [t for t in TABELE if f'ALTER TABLE "{t}"' not in sql]
chk(not manjka, f'vseh 36 imen tabel navzočih (manjka: {manjka or "—"})')


def vrstica (tabela):
    for l in sql.splitlines():
        if l.startswith(f'ALTER TABLE "{tabela}"'):
            return l
    return ''


fs = vrstica('FenceSegment')
chk('INVALIDATED' not in fs and 'CONFIRMED' in fs and 'AUTO_SUGGESTED' in fs,
    'FenceSegment: BREZ INVALIDATED (razlikuje se od Measurement §9) — množica 6 vrednosti')
chk('ODRAVLJENO' in vrstica('MontazaAction') and 'OPRAVLJENO' not in vrstica('MontazaAction'),
    'MontazaAction: ODRAVLJENO (ne OPRAVLJENO — anomalija R541-a)')
pd = vrstica('PlaybookDef')
chk(all(v in pd for v in ['DRAFT', 'ACTIVE', 'RETIRED']),
    'PlaybookDef: DRAFT | ACTIVE | RETIRED (RETIRED dokazan v R541-a)')
chk('POVPRAŠEVANJE' in vrstica('ProjectPackage'),
    'ProjectPackage: POVPRAŠEVANJE (Š — UTF-8 datoteka)')

post = src('src/app/api/projects/route.ts')
chk('z.enum(PROJECT_STATUSES' in post and 'status: z.string()' not in post,
    'projects/route.ts: status = z.enum(PROJECT_STATUSES, …) — gol z.string() odstranjen')
chk("import { parseBody, PROJECT_STATUSES } from '@/lib/validate'" in post,
    'projects/route.ts: uvoz PROJECT_STATUSES iz @/lib/validate')
patch = src('src/app/api/projects/[id]/route.ts')
chk('z.enum(PROJECT_STATUSES' in patch and 'status: z.string()' not in patch,
    'projects/[id]/route.ts: status = z.enum(PROJECT_STATUSES, …) — gol z.string() odstranjen')
chk("import { parseBody, PROJECT_STATUSES } from '@/lib/validate'" in patch,
    'projects/[id]/route.ts: uvoz PROJECT_STATUSES iz @/lib/validate')

val = src('src/lib/validate.ts')
chk("export const PROJECT_STATUSES = ['NACRT', 'AKTIVNI', 'TEREN', 'ZAKLJUCEN', 'ARHIV'] as const" in val,
    'validate.ts: PROJECT_STATUSES izvožen s 5 vrednostmi (NACRT … ARHIV)')

schema = src('prisma/schema.prisma')
chk('@default("DRAFT") // DRAFT | ACTIVE | RETIRED' in schema,
    'schema.prisma: PlaybookDef.status komentar dopolnjen (DRAFT | ACTIVE | RETIRED)')
chk('@default("PENDING") // PENDING | IN_PROGRESS | COMPLETED | NI_PRIMERNO | BLOKIRANO | NEUSPESNO' in schema,
    'schema.prisma: PlaybookStepRun.status komentar dopolnjen (PENDING … NEUSPESNO)')

# ═══ B) živi DB dokaz — constrainti + zavrnitev pisanja ══════════════════════
print('── B) živi DB dokaz (pg_constraint + zavrnitev) ──')
DBU = db_url()
if not DBU:
    skip('ni postgres povezave (TEST_DB_URL/DATABASE_URL/.env) — blok B preskočen')
else:
    IMENA = [f'{t}_{"stage" if t == "Opportunity" else "status"}_check' for t in TABELE]
    r = bun_e("""
import { Client } from 'pg'
const IMENA = %s
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const r = await c.query("SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'c' AND conname = ANY($1::text[])", [IMENA])
console.log('STEVILO:' + r.rows[0].n)
await c.end()
""" % json.dumps(IMENA))
    m = re.search(r'STEVILO:(\d+)', r.stdout)
    chk(r.returncode == 0 and m is not None and m.group(1) == '36',
        f'pg_constraint: NATANČNO 36 CHECK constraintov z imeni <Tabela>_<polje>_check (izpis: {r.stdout.strip()[-40:] or r.stderr.strip()[-60:]})')

    # neveljaven update → CHECK zavrne; vrstica ostane nepoškodovana; cleanup
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const p = await db.project.create({ data: { code: 'ZZ-r541-zavrnjen', title: 'ZZ-r541 zavrnjen', status: 'NACRT' } })
let zavrnjen = false, besedilo = ''
try {
  await db.project.update({ where: { id: p.id }, data: { status: 'NEVELJAVEN_XX' } })
} catch (e) {
  zavrnjen = true
  besedilo = String(e?.message ?? '') + String(e?.cause?.message ?? '')
}
const po = await db.project.findUnique({ where: { id: p.id }, select: { status: true } })
console.log(JSON.stringify({ zavrnjen, checkImenovan: besedilo.includes('Project_status_check'), statusPo: po.status }))
await db.project.delete({ where: { id: p.id } })
const ostanki = await db.project.count({ where: { code: { startsWith: 'ZZ-r541' } } })
console.log('OSTANKI:' + ostanki)
await db.$disconnect()
""")
    d = {}
    try:
        d = json.loads(r.stdout.strip().splitlines()[0])
    except Exception:
        pass
    chk(r.returncode == 0 and d.get('zavrnjen') and d.get('checkImenovan'),
        f"neveljaven update Project.status='NEVELJAVEN_XX' → ZAVRŽEN s strani Project_status_check (zavrnjen={d.get('zavrnjen')}, ime v napaki={d.get('checkImenovan')})")
    chk(d.get('statusPo') == 'NACRT',
        f"vrstica po zavrnjenem poskusu NEPOŠKODOVANA (status={d.get('statusPo')}, pričakovano NACRT — update se ni izvedel)")
    chk('OSTANKI:0' in r.stdout,
        'veljaven update znotraj skripte uspe implicitno (create/delete OK) — testni projekt pobrisan (0 ostankov ZZ-r541)')

    # ekspliciten dokaz veljavnega update-a (TEREN → nazaj) na lastnem ZZ- projektu
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const p = await db.project.create({ data: { code: 'ZZ-r541-veljaven', title: 'ZZ-r541 veljaven', status: 'NACRT' } })
const u = await db.project.update({ where: { id: p.id }, data: { status: 'TEREN' } })
const nazaj = await db.project.update({ where: { id: p.id }, data: { status: 'NACRT' } })
await db.project.delete({ where: { id: p.id } })
console.log(JSON.stringify({ teren: u.status, nazaj: nazaj.status }))
await db.$disconnect()
""")
    try:
        d = json.loads(r.stdout.strip().splitlines()[0])
    except Exception:
        d = {}
    chk(r.returncode == 0 and d.get('teren') == 'TEREN' and d.get('nazaj') == 'NACRT',
        "veljaven update TEREN uspe (in povrnitev na NACRT) — CHECK pušča dovoljene vrednosti skozi")

# ═══ C) živi HTTP dokaz — zod 400 na obeh rutah ══════════════════════════════
print('── C) živi HTTP dokaz (POST/PATCH /api/projects) ──')
s, d = call('POST', '/api/auth/login', body={'email': 'admin@roksal.si', 'password': 'Admin123!'})
chk(s == 200, f'prijava admina → 200 (dejansko {s})')
token = d.get('token') if isinstance(d, dict) else None
if not token:
    skip('ni žetona — blok C preskočen')
else:
    s, d = call('POST', '/api/projects', token=token,
                body={'title': 'ZZ-r541 test', 'status': 'NEVELJAVEN'})
    chk(s == 400 and 'status' in str(d.get('detail', '')),
        f"POST /api/projects status='NEVELJAVEN' → 400 z zod sporočilom za polje status (dejansko {s}, odgovor: {str(d)[:90]})")

    s, d = call('POST', '/api/projects', token=token,
                body={'title': 'ZZ-r541 test', 'status': 'TEREN'})
    pid = d.get('data', {}).get('id') if isinstance(d, dict) else None
    chk(s == 201 and pid is not None and d.get('data', {}).get('status') == 'TEREN',
        f"POST /api/projects status='TEREN' → 201 + status TEREN (dejansko {s})")
    if pid:
        r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const n = await db.project.deleteMany({ where: { id: process.argv[1] } })
await db.$disconnect()
console.log('POBRISANIH:' + n.count)
""", pid)
        chk(r.returncode == 0 and 'POBRISANIH:1' in r.stdout,
            'projekt TEREN pobrisan prek bun_sub (čiščenje po id)')
    else:
        bad('POST ni vrnil id-ja — čiščenje TEREN projekta ni mogoče')

    # PATCH: lasten ZZ- projekt → neveljaven 400, veljaven 200, cleanup
    s, d = call('POST', '/api/projects', token=token,
                body={'title': 'ZZ-r541 patch test'})
    zid = d.get('data', {}).get('id') if isinstance(d, dict) else None
    if zid:
        s, d = call('PATCH', f'/api/projects/{zid}', token=token, body={'status': 'CEVRSTNO'})
        chk(s == 400 and 'status' in str(d.get('detail', '')),
            f"PATCH /api/projects/[id] status='CEVRSTNO' → 400 z zod sporočilom (dejansko {s})")
        s, d = call('PATCH', f'/api/projects/{zid}', token=token, body={'status': 'ZAKLJUCEN'})
        chk(s == 200 and isinstance(d, dict) and d.get('data', {}).get('status') == 'ZAKLJUCEN',
            f"PATCH status='ZAKLJUCEN' → 200 + status ZAKLJUCEN (dejansko {s})")
        r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const n = await db.project.deleteMany({ where: { id: process.argv[1] } })
const ostanki = await db.project.count({ where: { title: { startsWith: 'ZZ-r541' } } })
await db.$disconnect()
console.log('POBRISANIH:' + n.count + ' OSTANKI:' + ostanki)
""", zid)
        chk(r.returncode == 0 and 'POBRISANIH:1' in r.stdout and 'OSTANKI:0' in r.stdout,
            'PATCH testni projekt pobrisan — 0 ZZ-r541 ostankov v bazi (čiščenje)')
    else:
        bad('POST (privzeti status) ni vrnil id-ja — PATCH del preskočen')

    s, d = call('POST', '/api/auth/logout', token=token)
    chk(s in (200, 204), f'odjava (čiščenje seje) → {s}')

# ═══ D) registracija skupine ═════════════════════════════════════════════════
print('── D) registracija (matrika + CI) ──')
matrika = src('tests/ci-matrix.sh')
chk(' r541)' in matrika and 'CLANI[r541]="r541.py"' in matrika,
    'ci-matrix.sh: skupina r541 v GRUPE seznamu in CLANI razdelitvi')
ciyml = src('.github/workflows/ci.yml')
chk('grupa: r541' in ciyml, 'CI workflow: skupina r541 v matriki')

print(f'\n{"R541":═<40} {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸')
sys.exit(1 if FAIL else 0)

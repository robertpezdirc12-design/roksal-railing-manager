#!/usr/bin/env python3
"""tests/r543.py — R543: CSP ENFORCE NAČIN + POROČILA V BAZO + DEMO_ACCESS OPOZORILO.

Zakaj: R536 je postavil CSP glavo v načinu Report-Only, a je raziskava R543-a
pokazala tri vrzeli: (1) politika NI imela frame-src direktive — PDF predogled
(pdf.tsx prikaže blob: object URL v <iframe>) bi podedoval default-src 'self'
in bil v enforce načinu BLOKIRAN; (2) frame-ancestors 'none' bi v enforce
načinu prelomil vgrajeni (peskovniški) predogled — izpuščena je privzeto,
zaščita pred clickjackingom teče naprej prek X-Frame-Options: SAMEORIGIN;
(3) poročila so šla SAMO v dnevnik — opazovalno obdobja ni bilo mogoče
izmeriti, kar je blokiralo odločitev o preklopu v enforce.

Kaj prinese R543 (50. skupina):
  • src/lib/csp.ts — ČIST graditelj politike (brez uvozov); način
    'report' (privzeto) | 'enforce', 'unsafe-eval' SAMO v dev,
    frame-ancestors SAMO izrecno (CSP_FRAME_ANCESTORS);
  • next.config.ts — glavo gradi buildCsp iz env (CSP_MODE /
    CSP_FRAME_ANCESTORS / NODE_ENV); privzeto = R536 Report-Only
    + frame-src 'self' blob: (varen dodatek tudi v report načinu);
  • src/instrumentation.ts — register(): GLASNO opozorilo ob
    DEMO_ACCESS=on + NODE_ENV=production (demo gesla so javno znana)
    in opozorilo ob enforce brez frame-ancestors;
  • tabela CspReport (migracija 20261025000000_r543_csp_report) —
    vsako poročilo se zapiše v bazo (raw = jsonb OBJEKT, konvencija R542),
    job csp-gc briše vrstice > 7 dni.

Kaj preverja ta suite:
  A) statično: buildCsp direktive (živ klic prek bun import — frame-src
     prisoten, unsafe-eval pogojen po env, frame-ancestors izpuščen brez
     env / prisoten z njim, imeni glav po načinu); next.config.ts uvozi
     buildCsp + env stikala; instrumentation.ts opozorili; CspReport model
     v shemi; migracija obstaja; jobs csp-gc registriran (JOB_DEFS +
     CRON_JOB_KEYS + 7-dnevni cutoff).
  B) živa DB: tabela CspReport v information_schema (raw = jsonb);
     POST /api/csp-report BREZ avtentikacije z veljavnim poročilom → 204 +
     vrstica v bazi (raw je OBJEKT s ključem csp-report, userAgent shranjen)
     + cleanup; job csp-gc prek POST /api/jobs pobriše 8 dni staro vrstico,
     sveža preživi (JobRun + revizija s detail OBJEKTOM, R542).
  C) HTTP: GET / nosi glavo Content-Security-Policy-Report-Only z
     frame-src 'self' blob: in report-uri /api/csp-report; X-Frame-Options
     ostaja SAMEORIGIN.
  D) registracija: ci-matrix.sh (GRUPE + CLANI) in ci.yml matrika.

POGOJI: teče nad lokalno razvojno bazo (TEST_DB_URL → env.sh → DATABASE_URL →
.env, tests/dbenv.py) in strežnikom na BASE_URL. Uporablja obstoječega admina
(admin@roksal.si); ZZ-r543 zapisi se na koncu pobrišejo (čiščenje).
OPOZORILO: instrumentation.ts opozorila statično — v tekočem strežniku se
register() izvede ob zagonu procesa (enkrat), ne ob zahtevkih.
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

TAG = 'ZZ-r543'  # označba testnih vrstic (documentUri https://r543-csp.roksal.test/…)


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


MIG = 'prisma/migrations/20261025000000_r543_csp_report/migration.sql'

print('═══ R543: CSP enforce način + poročila v bazo ═══')

# ═══ A) statično: builder + next.config + instrumentation + shema + jobs ═════
print('── A) statično (csp.ts / next.config.ts / instrumentation / shema / jobs) ──')

# A1) buildCsp ŽIVI klic (csp.ts je čist modul brez uvozov → bun import dela)
r = bun_e("""
const m = await import('./src/lib/csp.ts')
const report = m.buildCsp({ mode: 'report', env: 'dev' })
const enforce = m.buildCsp({ mode: 'enforce', env: 'production' })
const enforceFa = m.buildCsp({ mode: 'enforce', env: 'production', frameAncestors: 'none' })
const reportFa = m.buildCsp({ mode: 'report', env: 'dev', frameAncestors: "'none'" })
const izvorFa = m.buildCsp({ mode: 'enforce', env: 'production', frameAncestors: 'https://primer.si' })
console.log(JSON.stringify({ report, enforce, enforceFa, reportFa, izvorFa }))
""")
try:
    d = json.loads(r.stdout.strip().splitlines()[-1])
except Exception:
    d = {}
rep, enf, efa, rfa, ifa = d.get('report', {}), d.get('enforce', {}), d.get('enforceFa', {}), d.get('reportFa', {}), d.get('izvorFa', {})
chk(r.returncode == 0 and rep.get('headerName') == 'Content-Security-Policy-Report-Only',
    "buildCsp(mode 'report') → glava Content-Security-Policy-Report-Only (privzeti način)")
chk(enf.get('headerName') == 'Content-Security-Policy',
    "buildCsp(mode 'enforce') → IZVRŠILNA glava Content-Security-Policy")
chk("frame-src 'self' blob:" in rep.get('policy', '') and "frame-src 'self' blob:" in enf.get('policy', ''),
    "politika vsebuje frame-src 'self' blob:' (popravek PDF predogleda — v OBEH načinih)")
chk("'unsafe-eval'" in rep.get('policy', ''),
    "env 'dev' → script-src vsebuje 'unsafe-eval' (Next dev strežnik ga rabi — kot doslej)")
chk("'unsafe-eval'" not in enf.get('policy', ''),
    "env 'production' → 'unsafe-eval' IZPUŠČEN (poostritev glede na R536 politiko)")
chk('frame-ancestors' not in rep.get('policy', '') and 'frame-ancestors' not in enf.get('policy', ''),
    'frame-ancestors IZPUŠČEN brez opts.frameAncestors (peskovniški predogled past — R543-a)')
chk("frame-ancestors 'none'" in efa.get('policy', '') and "frame-ancestors 'none'" in rfa.get('policy', ''),
    "frameAncestors podan → direktiva prisotna v obeh načinih; golo 'none' se ovije v narekovaje (CSP sintaksa)")
chk('frame-ancestors https://primer.si' in ifa.get('policy', ''),
    'izvor (https://…) gre nespremenjeno — brez vsiljenih narekovajev')
chk('report-uri /api/csp-report' in rep.get('policy', '') and 'report-uri /api/csp-report' in enf.get('policy', ''),
    'report-uri /api/csp-report velja v OBEH načinih (spodbuda za poročila ostaja)')
chk("default-src 'self'" in rep.get('policy', '') and "object-src 'none'" in rep.get('policy', ''),
    'osnovni direktivi default-src/object-src nespremenjeni (R536 izhodišče)')

# A2) next.config.ts — env stikala + uvoz buildCsp (ne hardcoded politika)
nc = src('next.config.ts')
chk('from "./src/lib/csp"' in nc or "from './src/lib/csp'" in nc,
    'next.config.ts uvaža buildCsp iz ./src/lib/csp (EN VIR politike)')
chk('CSP_MODE' in nc and "=== \"enforce\" ? \"enforce\" : \"report\"" in nc,
    "next.config.ts: CSP_MODE=enforce preklopi način (privzeto 'report')")
chk('CSP_FRAME_ANCESTORS' in nc,
    'next.config.ts: CSP_FRAME_ANCESTORS poda frame-ancestors (neobvezno)')
chk('csp.headerName' in nc and 'csp.policy' in nc,
    'next.config.ts: glava iz buildCsp (headerName + policy), ne ročno zapisan niz')
chk('{ key: "X-Frame-Options", value: "SAMEORIGIN" }' in nc,
    'X-Frame-Options: SAMEORIGIN ostaja (clickjacking zaščita brez frame-ancestors)')

# A3) instrumentation.ts — opozorili ob zagonu
ins = src('src/instrumentation.ts')
chk('export async function register' in ins,
    'src/instrumentation.ts: export async function register() (Next konvencija — enkrat ob zagonu)')
chk("DEMO_ACCESS === 'on'" in ins and "NODE_ENV === 'production'" in ins and 'console.error' in ins,
    'instrumentation: DEMO_ACCESS=on + produkcija → console.error (demo gesla javno znana)')
chk("CSP_MODE === 'enforce'" in ins and 'CSP_FRAME_ANCESTORS' in ins and 'console.warn' in ins,
    'instrumentation: enforce brez frame-ancestors → console.warn (zaščita samo prek XFO)')

# A4) shema: model CspReport (raw = Json objekt, ne String)
schema = src('prisma/schema.prisma')
m = re.search(r'^model\s+CspReport\s*\{.*?^\}', schema, re.M | re.S)
chk(m is not None, 'schema.prisma: model CspReport obstaja')
blok = m.group(0) if m else ''
chk(re.search(r'^\s+raw\s+Json\s', blok, re.M) is not None,
    'CspReport.raw je tipa Json (jsonb objekt — konvencija R542, ne String)')
chk(all(re.search(rf'^\s+{f}\s+String(\?)?\s', blok, re.M) for f in ('documentUri', 'violatedDirective', 'blockedUri', 'userAgent')),
    'CspReport polja documentUri/violatedDirective/blockedUri/userAgent so String')
chk('@@index([createdAt])' in blok, 'CspReport ima indeks na createdAt (čistilna naloga csp-gc)')

# A5) migracija: CREATE TABLE + jsonb + indeks
mig = src(MIG) if src_has(MIG, 'CREATE TABLE') else ''
chk('CREATE TABLE "CspReport"' in mig, 'migracija 20261025000000_r543_csp_report/migration.sql obstaja s CREATE TABLE')
chk('"raw" JSONB NOT NULL' in mig, 'migracija: stolpec raw je JSONB NOT NULL')
chk('CREATE INDEX "CspReport_createdAt_idx"' in mig, 'migracija: indeks CspReport_createdAt_idx')

# A6) jobs.ts: csp-gc registriran (JOB_DEFS + CRON_JOB_KEYS + 7 dni)
jobs = src('src/lib/jobs.ts')
chk("job: 'csp-gc'" in jobs, "jobs.ts: 'csp-gc' v JOB_DEFS (videz v UI Vzdrževanje)")
chk("'csp-gc'" in re.search(r'CRON_JOB_KEYS\s*=\s*\[[^\]]*\]', jobs).group(0),
    "jobs.ts: 'csp-gc' v CRON_JOB_KEYS (dnevni cron jobs/run)")
chk('7 * 86400000' in jobs and 'cspReport.deleteMany' in jobs,
    'jobs.ts: csp-gc briše CspReport vrstice > 7 dni (7 * 86400000 cutoff)')

# ═══ B) živa DB: tabela + POST → vrstica + csp-gc job ════════════════════════
print('── B) živa DB (tabela + sprevzem poročil + job csp-gc) ──')
DBU = db_url()
if not DBU:
    skip('ni postgres povezave (TEST_DB_URL/DATABASE_URL/.env) — blok B preskočen')
else:
    # B1) tabela + tipi v information_schema / pg_catalog
    r = bun_e("""
import { Client } from 'pg'
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const cols = await c.query(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'CspReport'
`)
const idx = await c.query(`
  SELECT indexname FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'CspReport'
`)
console.log('STOLPCI:' + JSON.stringify(cols.rows) + ' INDEKSI:' + JSON.stringify(idx.rows))
await c.end()
""")
    mm = re.search(r"STOLPCI:(\[.*?\]) INDEKSI:(\[.*?\])", r.stdout)
    stolpci, indeksi = [], []
    if mm:
        try:
            stolpci, indeksi = json.loads(mm.group(1)), json.loads(mm.group(2))
        except ValueError:
            pass
    tipi = {c['column_name']: (c['data_type'], c['is_nullable']) for c in stolpci}
    chk(r.returncode == 0 and len(stolpci) == 7,
        f'tabela CspReport ima 7 stolpcev (id + 6 podatkovnih; dejansko {len(stolpci)})')
    chk(tipi.get('raw', ('', ''))[0] == 'jsonb',
        f"stolpec raw je jsonb (dejansko {tipi.get('raw', ('—',))[0]})")
    chk(tipi.get('raw', ('', 'YES'))[1] == 'NO' and tipi.get('documentUri', ('', 'YES'))[1] == 'NO',
        'raw in documentUri sta NOT NULL (vsako poročilo ima telo + kraj)')
    chk(any('createdAt' in (i.get('indexname') or '') for i in indeksi),
        'indeks na createdAt obstaja v bazi (pg_indexes)')

    # B2) POST brez avtentikacije → 204 + vrstica v bazi (raw = OBJEKT)
    doc_uri = f'https://r543-csp.roksal.test/{TAG.lower()}'
    porocilo = {
        'csp-report': {
            'document-uri': doc_uri,
            'violated-directive': 'frame-src',
            'blocked-uri': 'blob:https://r543-csp.roksal.test/predogled.pdf',
            'original-policy': "default-src 'self'",
            'disposition': 'report',
        }
    }
    s, d = call('POST', '/api/csp-report', body=porocilo)
    chk(s == 204, f'POST /api/csp-report BREZ žetona z veljavnim poročilom → 204 (javna točka; dejansko {s})')

    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const vrstice = await db.cspReport.findMany({ where: { documentUri: process.argv[1] } })
const v = vrstice[0] ?? null
console.log(JSON.stringify({
  stevilo: vrstice.length,
  direktiva: v?.violatedDirective ?? null,
  blokirano: v?.blockedUri ?? null,
  rawJeObjekt: v ? typeof v.raw === 'object' && v.raw !== null : false,
  rawKluci: v ? Object.keys(v.raw ?? {}) : [],
  rawVsebina: v?.raw?.['csp-report']?.['violated-directive'] ?? null,
  userAgent: v?.userAgent ?? null,
}))
await db.$disconnect()
""", doc_uri)
    try:
        d2 = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        d2 = {}
    chk(d2.get('stevilo') == 1, f"poročilo ZAPISANO v tabelo CspReport (najdenih {d2.get('stevilo')})")
    chk(d2.get('direktiva') == 'frame-src' and d2.get('blokirano') == 'blob:https://r543-csp.roksal.test/predogled.pdf',
        'vrstica nosi violatedDirective + blockedUri (kondenzirani polji)')
    chk(d2.get('rawJeObjekt') and d2.get('rawKluci') == ['csp-report'],
        'raw je JSONB OBJEKT (ne niz!) s ključem csp-report — konvencija R542')
    chk(d2.get('rawVsebina') == 'frame-src',
        'raw vsebuje CELO telo poročila (gnezdena polja so shranjena)')
    chk(bool(d2.get('userAgent')),
        f'userAgent shranjen iz glave zahteve (python-urllib/python3; dejansko {str(d2.get("userAgent"))[:30]}…)')

    # B3) job csp-gc: stara vrstica (8 dni) pobrisana, sveža preživi
    s, admin = call('POST', '/api/auth/login', body={'email': 'admin@roksal.si', 'password': 'Admin123!'})
    admin_token = admin.get('token') if s == 200 else ''
    chk(s == 200, f'prijava admina za zagon joba → 200 (dejansko {s})')
    if admin_token:
        r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
await db.cspReport.create({ data: {
  documentUri: process.argv[1] + '/stara-8-dni',
  violatedDirective: 'img-src',
  raw: { 'csp-report': { 'document-uri': process.argv[1] + '/stara-8-dni' } },
  createdAt: new Date(Date.now() - 8 * 86400000), // 8 dni — čez 7-dnevno mejo
} })
await db.cspReport.create({ data: {
  documentUri: process.argv[1] + '/sveza',
  violatedDirective: 'style-src',
  raw: { 'csp-report': { 'document-uri': process.argv[1] + '/sveza' } },
} })
console.log('ustvarjeni 2 (stara 8 dni + sveža)')
await db.$disconnect()
""", doc_uri)
        chk(r.returncode == 0, 'semenski vrstici ustvarjeni (stara 8 dni + sveža)')

        s, d = call('POST', '/api/jobs', token=admin_token, body={'job': 'csp-gc'})
        chk(s == 200 and d.get('data', {}).get('job') == 'csp-gc',
            f"POST /api/jobs {{'csp-gc'}} → 200 (dejansko {s})")
        chk(d.get('data', {}).get('affected', 0) >= 1,
            f"job je poročal affected ≥ 1 (dejansko {d.get('data', {}).get('affected')})")

        r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const ostale = await db.cspReport.findMany({ where: { documentUri: { startsWith: process.argv[1] } },
  select: { documentUri: true } })
const run = await db.jobRun.findFirst({ where: { job: 'csp-gc' }, orderBy: { startedAt: 'desc' } })
const revizija = await db.auditLog.findFirst({ where: { action: 'MAINTENANCE_RUN', entityId: run?.id ?? 'x' } })
console.log(JSON.stringify({
  ostale: ostale.map(o => o.documentUri),
  jobRunOk: run?.ok === true,
  jobRunDetailJeObjekt: run ? typeof run.detail === 'object' && run.detail !== null : false,
  revizijaDetail: revizija?.detail ?? null,
}))
await db.$disconnect()
""", doc_uri)
        try:
            d3 = json.loads(r.stdout.strip().splitlines()[-1])
        except Exception:
            d3 = {}
        chk(d3.get('ostale') == [doc_uri, doc_uri + '/sveza'],
            f"csp-gc je pobrisal SAMO vrstico > 7 dni — obe SVEŽI preživita (dejansko: {d3.get('ostale')})")
        chk(d3.get('jobRunOk') and d3.get('jobRunDetailJeObjekt'),
            'JobRun zapis: ok=true, detail je OBJEKT (konvencija R542)')
        chk(isinstance(d3.get('revizijaDetail'), dict) and d3.get('revizijaDetail', {}).get('job') == 'csp-gc',
            'revizija MAINTENANCE_RUN s detail objektom {job, affected}')

        # čiščenje: testne vrstice + JobRun + revizija (entityId veže na run id)
        r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const csp = await db.cspReport.deleteMany({ where: { documentUri: { startsWith: process.argv[1] } } })
const runi = await db.jobRun.findMany({ where: { job: 'csp-gc' }, select: { id: true } })
const rev = await db.auditLog.deleteMany({ where: { action: 'MAINTENANCE_RUN', entityId: { in: runi.map(r => r.id) } } })
const jobi = await db.jobRun.deleteMany({ where: { job: 'csp-gc' } })
const ostanki = await db.cspReport.count({ where: { documentUri: { startsWith: process.argv[1] } } })
console.log(JSON.stringify({ csp: csp.count, revizij: rev.count, jobov: jobi.count, ostanki }))
await db.$disconnect()
""", doc_uri)
        try:
            d4 = json.loads(r.stdout.strip().splitlines()[-1])
        except Exception:
            d4 = {}
        chk(d4.get('ostanki') == 0, f"testni CspReport zapisi pobrisani — 0 ZZ-r543 ostankov (dejansko {d4.get('ostanki')})")

        s, d = call('POST', '/api/auth/logout', token=admin_token)
        chk(s in (200, 204), f'odjava admina (čiščenje seje) → {s}')

# ═══ C) HTTP: glava Report-Only z frame-src (privzeti način brez env) ═════════
print('── C) HTTP glava (privzeti report način) ──')
try:
    with urllib.request.urlopen(BASE + '/', timeout=30) as resp:
        glave = {k.lower(): v for k, v in resp.headers.items()}
except Exception as e:
    glave = {}
    bad(f'dokument / ni dosegljiv: {e}')
csp_glava = glave.get('content-security-policy-report-only', '')
chk(bool(csp_glava), 'GET / nosi glavo Content-Security-Policy-Report-Only (privzeti način brez env)')
chk("frame-src 'self' blob:" in csp_glava,
    "glava vsebuje frame-src 'self' blob:' (PDF predogled popravek je ŽIV)")
chk('report-uri /api/csp-report' in csp_glava, 'glava vsebuje report-uri /api/csp-report')
chk(glave.get('x-frame-options', '') == 'SAMEORIGIN',
    'X-Frame-Options: SAMEORIGIN ostaja (clickjacking zaščita brez frame-ancestors)')
chk('frame-ancestors' not in csp_glava, 'privzeti glava NE vsebuje frame-ancestors (izpuščen — R543-a past)')

# ═══ D) registracija skupine ═════════════════════════════════════════════════
print('── D) registracija (matrika + CI) ──')
matrika = src('tests/ci-matrix.sh')
grupe_vrstica = next((v for v in matrika.splitlines() if v.startswith('GRUPE=')), '')
# pozicijsko neodvisno — r543 ne mora biti zadnji v seznamu (naslednja skupina ga ne prelomi)
chk(re.search(r'(?<![\w-])r543(?![\w-])', grupe_vrstica) is not None and 'CLANI[r543]="r543.py"' in matrika,
    'ci-matrix.sh: skupina r543 v GRUPE seznamu in CLANI razdelitvi')
ciyml = src('.github/workflows/ci.yml')
chk('grupa: r543' in ciyml, 'CI workflow: skupina r543 v matriki')

print(f'\n{"R543":═<40} {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸')
sys.exit(1 if FAIL else 0)

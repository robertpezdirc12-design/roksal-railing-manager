#!/usr/bin/env python3
"""tests/r534.py — R534 (issue #21): ZAŠČITA PRODUKCIJSKIH PODATKOV.

Zakaj: issue #21 je potrdil tri varnostno-operativne nevarnosti in eno
neusklajenost dokumentacije: (1) `db:seed` veriga briše VSE tabele in bi jo
bilo mogoče ponesreči zagnati proti produkciji; (2) `POST /api/setup` je
števec+ustvarjanje izvedel v dveh operacijah — sočasni zahtevki ustvarijo
dva prva admina; (3) Prisma query-dnevnik je bil brezpogojno vklopljen
(vrednosti parametrov v dnevnikih); (4) SECRETS.md/README so trdili 30 dni
sej ter pepper+prstni odtis, koda pa ima 7 dni in surov žeton v bazi.

Kaj preverja ta suite (43. skupina):
  A) seed-guard enote — zavrnitvene plasti BREZ baze: manjkajoča/napačna
     potrditev, NODE_ENV=production, ne-lokalen gostitelj, izhod za
     zavedne interne baze (SEED_ALLOW_REMOTE) NE obide napačnih plasti;
  B) oznaka produkcije v SAMI bazi (Setting 'system.production') — postavitev
     z db:mark-production, zavrnitev semena OB prisotnosti, tudi z izhodnim
     ukazom SEED_ALLOW_REMOTE; odstranitev povrne dovoljenje;
  C) DOKAZ NEDOTAKNJENOSTI (sprejemni kriterij #21-2): popoln zagon
     `bun run db:seed` BREZ potrditve nad živo (demo) bazo z namestitvijo
     stražarjev (sentinel uporabnik + stranka, ki jih seed NE ustvarja) —
     zavrnjen seed pusti števce in vsebino NESPREMENJENE;
  D) ATOMARNOST prve namestitve (sprejemni kriterij #21-3): 8 sočasnih
     POST /api/setup na sveži prazni bazi prek PRAVE route handler logike
     (tests/r534-setup-race.mjs) → NATANČNO 1×201, ostalo 403, 1 ADMIN,
     1 zahtevna vrstica; po dirki zaporedna zahteva 403;
  E) query-dnevnik: privzeto IZKLOPLJEN; opt-in PRISMA_LOG_QUERIES=1 s
     časovno mejo; formatQueryEvent NIKOLI ne izpiše parametrov;
  F) žetoni sej: prijava izda surov žeton, baza hrani SAMO SHA-256;
     zgodovinska (surova) vrstica ostane veljavna in se nadgradi na mestu;
     odjava prekliče obe obliki;
  G) dokumentacija in žičenje: SECRETS.md (7 dni, SHA-256), README brez
     neresničnih trditev (pepper/prstni odtis) z novim razdelkom; setup
     transakcija; matrika 43; SEED_CONFIRM v pasu/CI/dev skriptah.

Brez AI, brez novih odvisnosti. Testi, ki potrebujejo bazo, tečejo nad
lokalno razvojno/CI bazo (postgresql://localhost) — nikoli nad produkcijo.
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL, SKIP = 0, 0, 0


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)
def skip (msg): global SKIP; SKIP += 1; print(f'  ⏸ {msg}')


def src_has (relpath, needle):
    try:
        with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
            return needle in f.read()
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


print('═══ R534: zaščita produkcijskih podatkov (issue #21) ═══')

# ═══ A) seed-guard zavrnitvene plasti (brez baze) ═══════════════════════════
print('── A) varovalo semena — zavrnitvene plasti ──')

r = subprocess.run(['node', 'prisma/seed-guard.cjs'], cwd=REPO, capture_output=True,
                   text=True, timeout=30, env=cisto_okolje())
chk(r.returncode == 1 and 'Manjka izrecna potrditev' in r.stderr,
    'brez SEED_CONFIRM → zavrnjeno z navodilom (exit 1)')

r = subprocess.run(['node', 'prisma/seed-guard.cjs'], cwd=REPO, capture_output=True,
                   text=True, timeout=30, env=cisto_okolje(SEED_CONFIRM='yes'))
chk(r.returncode == 1 and 'Manjka izrecna potrditev' in r.stderr,
    'napačna vrednost potrditve ni enaka izrecni YES_DEMO_DATA → zavrnjeno')

r = subprocess.run(['node', 'prisma/seed-guard.cjs'], cwd=REPO, capture_output=True,
                   text=True, timeout=30, env=cisto_okolje(SEED_CONFIRM='YES_DEMO_DATA', NODE_ENV='production'))
chk(r.returncode == 1 and 'NODE_ENV=production' in r.stderr,
    'NODE_ENV=production → zavrnjeno (ne glede na potrditev)')

NEON = 'postgresql://x:x@ep-demo-123.eu-central-1.aws.neon.tech/prod?sslmode=require'
r = subprocess.run(['node', 'prisma/seed-guard.cjs'], cwd=REPO, capture_output=True,
                   text=True, timeout=30, env=cisto_okolje(SEED_CONFIRM='YES_DEMO_DATA', DATABASE_URL=NEON))
chk(r.returncode == 1 and 'ni lokalni razvojni/testni' in r.stderr and 'neon.tech' in r.stderr,
    'DATABASE_URL na oddaljenega gostitelja (Neon) → zavrnjeno z imenom gostitelja')

# izhod za zavedne interne baze NE sme obiti plasti — pokaži, da se preskoči
# SAMO preverjanje gostitelja, ne pa fail-closed oznake (povezava ne doseže
# strežnika → neznan status → zavrnjeno, a NE z razlogom »ni lokalni«)
r = subprocess.run(['node', 'prisma/seed-guard.cjs'], cwd=REPO, capture_output=True,
                   text=True, timeout=60,
                   env=cisto_okolje(SEED_CONFIRM='YES_DEMO_DATA',
                                    SEED_ALLOW_REMOTE='YES_I_ACCEPT_REMOTE_SEED',
                                    DATABASE_URL='postgresql://x:x@db.invalid:5432/x'))
chk(r.returncode == 1 and 'ni lokalni razvojni/testni' not in r.stderr,
    'SEED_ALLOW_REMOTE preskoči plast gostitelja (ne zavrne z »ni lokalni«) — nadaljuje fail-closed')

r = subprocess.run(['node', 'prisma/seed-guard.cjs', '--reset'], cwd=REPO, capture_output=True,
                   text=True, timeout=30, env=cisto_okolje())
chk(r.returncode == 1 and 'db:reset' in r.stderr,
    '--reset način brez potrditve → zavrnjeno z navodilom za db:reset')

r = bun_e("const m = require('./prisma/seed-guard.cjs'); console.log(typeof m.assertSeedAllowed, m.CONFIRM_VALUE)")
chk(r.returncode == 0 and "function YES_DEMO_DATA" in r.stdout,
    'modul izvaža assertSeedAllowed + CONFIRM_VALUE (klicatelj: seed.cjs/seed-test.cjs)')

# ═══ B) oznaka produkcije v sami bazi ═══════════════════════════════════════
print('── B) oznaka produkcije (Setting system.production) ──')
DBU = db_url()
if not DBU:
    skip('ni postgres povezave (TEST_DB_URL/DATABASE_URL/.env) — blok B preskočen')
else:
    r = subprocess.run(['node', 'prisma/mark-production.cjs'], cwd=REPO, capture_output=True,
                       text=True, timeout=60, env=cisto_okolje(DATABASE_URL=DBU))
    chk(r.returncode == 1 and 'PRODUCTION_MARK' in r.stderr,
        'db:mark-production brez PRODUCTION_MARK=YES → zavrnjen (proti pomoti)')

    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
await db.setting.create({ data: { key: 'system.production', value: 'true' } })
await db.$disconnect()
console.log('marker postavljen')
""")
    chk(r.returncode == 0, 'marker produkcije vstavljen v testno bazo')

    r = subprocess.run(['node', 'prisma/seed-guard.cjs'], cwd=REPO, capture_output=True,
                       text=True, timeout=60,
                       env=cisto_okolje(DATABASE_URL=DBU, SEED_CONFIRM='YES_DEMO_DATA'))
    chk(r.returncode == 1 and 'OZNAČENA kot produkcija' in r.stderr,
        'seed z oznako produkcije → zavrnjeno (ne glede na okolje)')

    r = subprocess.run(['node', 'prisma/seed-guard.cjs'], cwd=REPO, capture_output=True,
                       text=True, timeout=60,
                       env=cisto_okolje(DATABASE_URL=DBU, SEED_CONFIRM='YES_DEMO_DATA',
                                        SEED_ALLOW_REMOTE='YES_I_ACCEPT_REMOTE_SEED'))
    chk(r.returncode == 1 and 'OZNAČENA kot produkcija' in r.stderr,
        'izhod SEED_ALLOW_REMOTE NE obide oznake produkcije (trda plast)')

    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
await db.setting.delete({ where: { key: 'system.production' } }).catch(() => {})
await db.$disconnect()
console.log('marker odstranjen')
""")
    chk(r.returncode == 0, 'marker odstranjen (čiščenje)')

    r = subprocess.run(['node', 'prisma/seed-guard.cjs'], cwd=REPO, capture_output=True,
                       text=True, timeout=60,
                       env=cisto_okolje(DATABASE_URL=DBU, SEED_CONFIRM='YES_DEMO_DATA'))
    chk(r.returncode == 0, 'po odstranitvi oznake je lokalni seed spet dovoljen (kontrola)')

# ═══ C) dokaz nedotaknjenosti ob zavrnjenem semenu ══════════════════════════
print('── C) zavrnjen db:seed pusti podatke NESPRETMENJENE ──')
if not DBU:
    skip('ni postgres povezave — blok C preskočen')
else:
    # stražarja, ki ju demo-seed NE ustvarja (uniči ju lahko le pravi izbris)
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
await db.user.create({ data: { email: 'r534-sentinel@roksal.test', passwordHash: 'x:y',
  name: 'R534 Sentinela', role: 'MONTER' } })
await db.customer.create({ data: { name: 'R534 Sentinela stranka', email: 'sentinela@roksal.test' } })
await db.$disconnect()
console.log('sentinela postavljena')
""")
    chk(r.returncode == 0, 'sentinel uporabnik + stranka nameščena')

    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const s = {
  users: await db.user.count(),
  customers: await db.customer.count(),
  projects: await db.project.count(),
  quotes: await db.quote.count(),
  sentinelUporabnik: await db.user.findUnique({ where: { email: 'r534-sentinel@roksal.test' } }) !== null,
  sentinelStranka: await db.customer.findFirst({ where: { name: 'R534 Sentinela stranka' } }) !== null,
  adminOstaja: await db.user.findUnique({ where: { email: 'admin@roksal.si' } }) !== null,
}
await db.$disconnect()
console.log(JSON.stringify(s))
""")
    PRED = json.loads(r.stdout.strip().splitlines()[-1])
    chk(PRED.get('sentinelUporabnik') and PRED.get('sentinelStranka') and PRED.get('adminOstaja'),
        'stanje PRED zajeto (sentinela + demo admin prisotni)')

    # PRAVI `bun run db:seed` — BREZ potrditve (cisto_okolje jo odstrani tudi,
    # če jo je izvozil pas — pošten preizkus, ne imitacija)
    r = subprocess.run(['bun', 'run', 'db:seed'], cwd=REPO, capture_output=True,
                       text=True, timeout=300, env=cisto_okolje(DATABASE_URL=DBU))
    chk(r.returncode != 0 and 'Manjka izrecna potrditev' in r.stderr + r.stdout,
        'popoln zagon db:seed brez potrditve → ZAVRNJEN (exit != 0)')

    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const s = {
  users: await db.user.count(),
  customers: await db.customer.count(),
  projects: await db.project.count(),
  quotes: await db.quote.count(),
  sentinelUporabnik: await db.user.findUnique({ where: { email: 'r534-sentinel@roksal.test' } }) !== null,
  sentinelStranka: await db.customer.findFirst({ where: { name: 'R534 Sentinela stranka' } }) !== null,
  adminOstaja: await db.user.findUnique({ where: { email: 'admin@roksal.si' } }) !== null,
}
await db.$disconnect()
console.log(JSON.stringify(s))
""")
    PO = json.loads(r.stdout.strip().splitlines()[-1])
    chk(PO == PRED, 'števci in vsebina PO zavrnjenem semenu SOIDENTIČNI (nič izbrisano)')

    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
await db.user.delete({ where: { email: 'r534-sentinel@roksal.test' } })
await db.customer.deleteMany({ where: { name: 'R534 Sentinela stranka' } })
await db.$disconnect()
console.log('sentinela počiščena')
""")
    chk(r.returncode == 0, 'sentinela počiščena (disciplina r459)')

# ═══ D) atomarnost prve namestitve (dirka) ═══════════════════════════════════
print('── D) 8 sočasnih POST /api/setup na sveži bazi ──')
RACE_DB = 'postgresql://roksal:roksal@localhost:54329/roksal_r534_race'
r = bun_e("""
import { Client } from 'pg'
try {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 })
  await c.connect(); await c.end(); console.log('PG OK')
} catch (e) { console.log('PG NEDOSEGLJIV') }
""", env=cisto_okolje(DATABASE_URL=db_url() or 'postgresql://roksal:roksal@localhost:54329/roksal'))
if 'PG OK' not in r.stdout:
    skip('lokalni PostgreSQL ni dosegljiv — blok D preskočen (dirka zahteva svežo bazo)')
else:
    r = bun_e("""
import { Client } from 'pg'
// POVEŽI se na razvojno bazo (DATABASE_URL) — tarčne (dirkalne) baze ne
// moreš dropniti, če si z njo povezan (past: »cannot drop the currently open database«)
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
await c.query('DROP DATABASE IF EXISTS roksal_r534_race')
await c.query('CREATE DATABASE roksal_r534_race')
await c.end()
console.log('sveža baza')
""", timeout=60)
    chk(r.returncode == 0, 'sveža dirkalna baza ustvarjena (iz razvojne povezave)')

    r = subprocess.run(['bunx', 'prisma', 'migrate', 'deploy'], cwd=REPO, capture_output=True,
                       text=True, timeout=240, env=cisto_okolje(DATABASE_URL=RACE_DB))
    chk(r.returncode == 0, 'migracije uveljavljene na dirkalni bazi (brez semena)')

    r = subprocess.run(['bun', 'tests/r534-setup-race.mjs', RACE_DB], cwd=REPO, capture_output=True,
                       text=True, timeout=180, env=cisto_okolje(DATABASE_URL=RACE_DB))
    chk(r.returncode == 0 and 'ATOMARNOST DOKAZANA' in r.stdout,
        '8 sočasnih namestitev → NATANČNO 1×201 + 7×403, 1 ADMIN, 1 zahtevna vrstica, po dirki 403')

    r = bun_e("""
import { Client } from 'pg'
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
await c.query('DROP DATABASE IF EXISTS roksal_r534_race')
await c.end()
console.log('počiščeno')
""", timeout=60)
    chk(r.returncode == 0, 'dirkalna baza počiščena')

# ═══ E) query-dnevnik — privzeto izklopljen, opt-in, brez parametrov ═════════
print('── E) Prisma query-dnevnik ──')
E_SCRIPT = """
const m = await import('./src/lib/db.ts')
const cfg = m.resolveLogConfig(process.env)
const izpis = m.formatQueryEvent({ query: 'SELECT token FROM Session WHERE id = $1', durationMs: 3, params: '["SKRIVNA-VREDNOST"]' })
console.log(JSON.stringify({ queryEvents: cfg.queryEvents, budget: cfg.queryBudgetMs, untilVPrihodnosti: cfg.queryUntil > Date.now(), izpis }))
"""
r = bun_e(E_SCRIPT, env=cisto_okolje(DATABASE_URL=db_url() or 'postgresql://roksal:roksal@localhost:54329/roksal'))
d = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
chk(r.returncode == 0 and d.get('queryEvents') is False,
    'brez PRISMA_LOG_QUERIES → query-dnevnik IZKLOPLJEN (samo error+warn)')

r = bun_e(E_SCRIPT, env=cisto_okolje(DATABASE_URL=db_url() or 'postgresql://roksal:roksal@localhost:54329/roksal',
                                     PRISMA_LOG_QUERIES='1'))
d = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
chk(r.returncode == 0 and d.get('queryEvents') is True and d.get('budget') == 15 * 60 * 1000
    and d.get('untilVPrihodnosti') is True,
    'PRISMA_LOG_QUERIES=1 → opt-in z časovno mejo 15 min (dokazljivo v prihodnosti)')

r = bun_e(E_SCRIPT, env=cisto_okolje(DATABASE_URL=db_url() or 'postgresql://roksal:roksal@localhost:54329/roksal',
                                     PRISMA_LOG_QUERIES='1', PRISMA_LOG_QUERIES_MS='60000'))
d = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
chk(r.returncode == 0 and d.get('budget') == 60000,
    'PRISMA_LOG_QUERIES_MS prilagodi časovno mejo (60 s)')

izpis = d.get('izpis', '')
chk('$1' in izpis and 'SKRIVNA-VREDNOST' not in izpis,
    'formatQueryEvent izpiše SQL z $N mestom, NIKOLI pa vrednosti parametrov')

# ═══ F) žetoni sej — SHA-256 v bazi, brezizpadni prehod ══════════════════════
print('── F) seje: zgoščeni žetoni ──')


def http_json (req):
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode())


def http_err (req):
    try:
        return http_json(req)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


try:
    req = urllib.request.Request(f'{BASE}/api/auth/login', method='POST',
                                 data=json.dumps({'email': 'admin@roksal.si', 'password': 'Admin123!'}).encode(),
                                 headers={'content-type': 'application/json'})
    status, telo = http_json(req)
    token = telo.get('token') or telo.get('data', {}).get('token') or ''
    chk(status == 200 and '.' in token and len(token) > 40, 'prijava → izdan surov nosilni žeton')
except Exception as e:
    token = ''
    bad(f'prijava ni uspela: {e}')

if token and DBU:
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const db = new PrismaClient()
const raw = process.argv[1]
const hash = crypto.createHash('sha256').update(raw).digest('hex')
const hashed = await db.session.findUnique({ where: { token: hash } })
const surova = await db.session.findUnique({ where: { token: raw } })
await db.$disconnect()
console.log(JSON.stringify({ hashedObstaja: hashed !== null, surovaObstaja: surova !== null }))
""", token)
    d = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
    chk(d.get('hashedObstaja') and not d.get('surovaObstaja'),
        'baza hrani SAMO sha256(zeton) — surova vrstica NE obstaja')

    req = urllib.request.Request(f'{BASE}/api/auth/sessions', headers={'authorization': f'Bearer {token}'})
    status, telo = http_json(req)
    cur = [s for s in telo.get('data', []) if s.get('current')]
    chk(status == 200 and len(cur) == 1, 'API sej z zgoščeno vrstico deluje (current označen)')

    LEG = 'stara-seja-r534-11112222-3333-4444-5555-666677778888.aabbccdd-1122-3344-5566-77889900aabb'
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const admin = await db.user.findUnique({ where: { email: 'admin@roksal.si' } })
await db.session.create({ data: { token: process.argv[1], userId: admin.id, expiresAt: new Date(Date.now() + 86400000) } })
await db.$disconnect()
console.log('legacy vrstica vstavljena')
""", LEG)
    chk(r.returncode == 0, 'zgodovinska (surova) seja vstavljena direktno v bazo')

    req = urllib.request.Request(f'{BASE}/api/auth/sessions', headers={'authorization': f'Bearer {LEG}'})
    status, telo = http_json(req)
    chk(status == 200, 'zgodovinska surova seja ŠE VEDNO avtenticira (brezizpadni prehod)')

    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const db = new PrismaClient()
const raw = process.argv[1]
const hash = crypto.createHash('sha256').update(raw).digest('hex')
const upgraded = await db.session.findUnique({ where: { token: hash } })
const surova = await db.session.findUnique({ where: { token: raw } })
await db.$disconnect()
console.log(JSON.stringify({ upgraded: upgraded !== null, surovaIzginila: surova === null }))
""", LEG)
    d = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
    chk(d.get('upgraded') and d.get('surovaIzginila'),
        'ob prvem branju se zgodovinska vrstica NADGRADI na mestu (surova izginie)')

    req = urllib.request.Request(f'{BASE}/api/auth/logout', method='POST', headers={'authorization': f'Bearer {LEG}'})
    status, _ = http_json(req)
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')
const db = new PrismaClient()
const raw = process.argv[1]
const hash = crypto.createHash('sha256').update(raw).digest('hex')
const a = await db.session.findUnique({ where: { token: hash } })
const b = await db.session.findUnique({ where: { token: raw } })
await db.$disconnect()
console.log(JSON.stringify({ vsePocisceno: a === null && b === null }))
""", LEG)
    d = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
    chk(status == 200 and d.get('vsePocisceno'),
        'odjava prekliče zgodovinsko sejo (obe obliki preverjeni)')

    # čiščenje prijavne seje tega testa
    req = urllib.request.Request(f'{BASE}/api/auth/logout', method='POST', headers={'authorization': f'Bearer {token}'})
    http_json(req)
    ok('prijavna seja testa odjavljena (čiščenje)')
elif not DBU:
    skip('ni postgres povezave — blok F-DB preskočen')

# ═══ G) dokumentacija in žičenje ════════════════════════════════════════════
print('── G) dokumentacija + žičenje ──')

chk(src_has('docs/SECRETS.md', '7 dni'), 'SECRETS.md: seje dokumentirane kot 7 dni (ne 30)')
chk(not re.search(r'seje \(30 dni\)', src_read := open(os.path.join(REPO, 'docs/SECRETS.md'), encoding='utf-8').read()),
    'SECRETS.md: zastarela trditev »30 dni« za seje odstranjena')
chk(src_has('docs/SECRETS.md', 'SHA-256'), 'SECRETS.md: zgoščena oblika žetona dokumentirana')
chk(src_has('docs/SECRETS.md', 'PostgreSQL'), 'SECRETS.md: DATABASE_URL opisan kot PostgreSQL (ne SQLite)')

readme = open(os.path.join(REPO, 'README.md'), encoding='utf-8').read()
chk('pepper + prstni odtis' not in readme, 'README: neresnična trditev o pepper+prstnem odtisu umaknjena')
chk('SHA-256' in readme and '7 dni' in readme, 'README: sejna resnica (SHA-256, 7 dni) zapisana')
chk('SEED_CONFIRM=YES_DEMO_DATA' in readme, 'README: postopek semena z izrecno potrditvijo')
chk('db:mark-production' in readme, 'README: oznaka produkcije dokumentirana')

setup = open(os.path.join(REPO, 'src/app/api/setup/route.ts'), encoding='utf-8').read()
chk('$transaction' in setup and 'SETUP_CLAIM_KEY' in setup and 'P2002' in setup,
    'setup route: transakcija + zahteva lastništva (PK) + obravnava P2002')
chk('system.setup.completedAt' in open(os.path.join(REPO, 'prisma/seed.cjs'), encoding='utf-8').read(),
    'demo-seed zapiše zahtevno vrstico (delno pobrisana baza ne odpre vrat znova)')

dbts = open(os.path.join(REPO, 'src/lib/db.ts'), encoding='utf-8').read()
dbts_koda = '\n'.join(l for l in dbts.splitlines() if not l.strip().startswith('//'))  # brez komentarjev (lažni zadetki)
chk("log: ['query']" not in dbts_koda, 'db.ts: brezpogojen query-dnevnik odstranjen (v kodi, ne komentarju)')
chk('resolveLogConfig' in dbts and 'formatQueryEvent' in dbts, 'db.ts: izvoženi resolveLogConfig/formatQueryEvent')

authts = open(os.path.join(REPO, 'src/lib/auth.ts'), encoding='utf-8').read()
chk('sessionTokenHash' in authts and 'findSessionByToken' in authts,
    'auth.ts: zgoščevanje + pomočnik za iskanje (nasledstvena združljivost)')
logout = open(os.path.join(REPO, 'src/app/api/auth/logout/route.ts'), encoding='utf-8').read()
chk('deleteSessionsByToken' in logout, 'logout: preklic po pomočniku (obe obliki)')

pkg = json.load(open(os.path.join(REPO, 'package.json'), encoding='utf-8'))
chk(pkg['scripts']['db:seed'].startswith('node prisma/seed-guard.cjs &&'),
    'package.json: db:seed se začne z varovalom')
chk('seed-guard.cjs --reset' in pkg['scripts']['db:reset'], 'package.json: db:reset pod varovalom')
chk('db:mark-production' in pkg['scripts'], 'package.json: ukaz db:mark-production obstaja')

chk(src_has('tests/ci-matrix.sh', 'r534'), 'matrika: skupina r534 registrirana (ci-matrix.sh)')
ciyml = open(os.path.join(REPO, '.github/workflows/ci.yml'), encoding='utf-8').read()
chk('grupa: r534' in ciyml, 'CI workflow: skupina r534 v matriki')
chk(ciyml.count('SEED_CONFIRM: YES_DEMO_DATA') == 2, 'CI workflow: obe semenski koraka nosita potrditev')
chk(src_has('tests/ci-local.sh', 'SEED_CONFIRM=YES_DEMO_DATA'), 'lokalni pas: SEED_CONFIRM viden')
chk(src_has('.zscripts/dev.sh', 'SEED_CONFIRM=YES_DEMO_DATA'), 'dev skripta: SEED_CONFIRM ob prazni bazi')

print()
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ══')
sys.exit(1 if FAIL > 0 else 0)

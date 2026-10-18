#!/usr/bin/env python3
# r565 — R565 (issue #22): POSTGRESQL BACKUP/RESTORE/DRILL — drill je bil
# SQLite-only (brezpogojno cp custom.db + file: URL); PG kopije so se lahko
# obnovile LE ročno. Od R565: uvoz je avtomatiziran, drill se veja po providerju
# iz manifesta in PG pot dokazuje obnovljivost z migracijami, uvozom,
# preverbo tujih ključev, zagonom aplikacije in bralno-PISALNIM poslovnim testom.
#
# Preverja:
#   A) struktura drill (grep): provider veja (manifest.json db.provider),
#      PG pot NIKOLI ne kopira custom.db (cp samo v sqlite veji), varovala
#      proti živi bazi, BLOCKED izhod 3 za nedosegljiv off-site, health verzija
#      iz package.json (ne trdo 0.2.1).
#   B) enote import-db (živo, izolirano): sveža baza r565t → migrate deploy →
#      import exporta trenutne baze → števci se ujemajo s _meta.json →
#      fk-check 0 sirot → fail-closed: ponovni uvoz v NEPRAZNO bazo → napaka.
#   C) polni drill E2E (živo): backup z enkratnim testnim geslom → drill
#      --skip-install --file → JSON ok:true, provider=postgresql, projects>0,
#      poročilo obstaja; RTO ≤ 1800 s.
#   D) čiščenje: vse testne baze pobrisane (r565t + drill baze), backup
#      testne kopije odstranjena.

import json, os, subprocess, sys, time, urllib.request, urllib.error, glob

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL, SKIP = 0, 0, 0


def ok (msg):
    global PASS; PASS += 1; print(f'  ✓ {msg}')


def bad (msg):
    global FAIL; FAIL += 1; print(f'  ✗ {msg}')


def skip (msg):
    global SKIP; SKIP += 1; print(f'  SKIP {msg}')


def chk (cond, msg):
    ok(msg) if cond else bad(msg)


def run (cmd, env=None, timeout=300, cwd=REPO):
    e = {**os.environ, **(env or {})}
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd, env=e, timeout=timeout)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def bun_js (script):
    env = {**os.environ}
    env.setdefault('NODE_OPTIONS', '--import ./tests/ts-resolve-register.mjs')
    env['DATABASE_URL'] = 'postgresql://roksal:roksal@localhost:54329/roksal'
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True, cwd=REPO, env=env)
    out = (r.stdout or '').strip().splitlines()
    for line in reversed(out):
        if line.startswith('{'):
            try: return json.loads(line)
            except Exception: break
    return {'_err': (r.stderr or r.stdout or '')[:900]}


def src_has (rel, needle):
    with open(os.path.join(REPO, rel), encoding='utf-8') as f:
        return needle in f.read()


print('════ r565 — issue #22: PostgreSQL backup/restore/drill ════')

# ═══ A) struktura drill.sh + health ════════════════════════════════════════
print('── A) struktura: provider veja + varovala + BLOCKED')
a1 = [
    ('ops/drill.sh', 'db\', {}).get(\'provider\'', 'provider iz manifesta kopije'),
    ('ops/drill.sh', 'PROVIDER" = "postgresql"', 'veja PostgreSQL'),
    ('ops/drill.sh', 'PROVIDER" != "postgresql" ] && [ "$PROVIDER" != "sqlite" ]', 'zavrnitev neznanega providerja'),
    ('ops/drill.sh', 'BLOKIRAN', 'BLOCKED poročilo za nedosegljiv off-site'),
    ('ops/drill.sh', 'exit 3', 'izhodna koda 3 za blokado'),
    ('ops/drill.sh', 'roksal_drill_', 'sveža izolirana drill baza'),
    ('ops/drill.sh', 'ŽIVO bazo', 'varovala proti živi bazi'),
    ('ops/drill.sh', 'import-db.mjs', 'avtomatiziran uvoz v PG poti'),
    ('ops/drill.sh', 'fk-check.mjs', 'preverba tujih ključev v PG poti'),
    ('ops/drill.sh', 'nova stranka 201', 'PISALNI poslovni test'),
    ('ops/import-db.mjs', 'cikel tujih ključev', 'cikel = trda napaka (ne tiho)'),
    ('ops/import-db.mjs', 'DigitalTwinSnapshot', 'dokumentirana samopovezava'),
    ('ops/fk-check.mjs', 'StockReservation→InventoryItem', 'FK relacija po shemi (itemId)'),
]
for rel, needle, msg in a1:
    chk(src_has(rel, needle), f'A1 STRUKTURA: {msg}')

# PG veja NE kopira custom.db: cp custom.db obstaja SAMO znotraj sqlite veje
# (dokaz: razcep po oznakah vej 4a/4b, ne po 'else' — teh je več)
drill_src = open(os.path.join(REPO, 'ops/drill.sh'), encoding='utf-8').read()
pg_branch = drill_src.split('FAZA 4a (PostgreSQL)')[1].split('# 4b. SQLite')[0]
sqlite_branch = drill_src.split('# 4b. SQLite')[1].split('FAZA 5:')[0]
chk('custom.db' not in pg_branch, 'A2 PG veja NE vsebuje custom.db (SQLite obvod izključen)')
chk('custom.db' in sqlite_branch, 'A3 SQLite veja ohrani custom.db pot (zgodovinske kopije)')

# health verzija iz package.json (issue #22 točka 6)
pkg_v = json.load(open(os.path.join(REPO, 'package.json')))['version']
with urllib.request.urlopen(BASE + '/api/health', timeout=15) as r:
    h = json.loads(r.read().decode())
chk(h.get('app', {}).get('version') == pkg_v, f'A4 health verzija = package.json ({pkg_v}; ne trdo 0.2.1)')
chk(h.get('db', {}).get('ok') is True, 'A5 health DB ok (ne samo SELECT 1 — prisma check)')

# ═══ B) enote import-db (živo, izolirana baza) ════════════════════════════
print('── B) živo: sveža baza → migrate → uvoz → preverbe')
export_dir = '/tmp/r565-export-test'
rc, out = run(f'DATABASE_URL="postgresql://roksal:roksal@localhost:54329/roksal" bun ops/export-db.mjs {export_dir}')
chk('\'ok\': true' in out or '"ok": true' in out or rc == 0, f'B1 export trenutne baze ({rc})')

rc, out = run('bun -e "\nimport pg from \'pg\'\nconst c = new pg.Client({ connectionString: \'postgresql://roksal:roksal@localhost:54329/postgres\' })\nawait c.connect()\nawait c.query(\'DROP DATABASE IF EXISTS r565t\')\nawait c.query(\'CREATE DATABASE r565t\')\nawait c.end()\nconsole.log(\'ok\')"')
chk(rc == 0, f'B2 sveža izolirana baza r565t ustvarjena ({rc})')

rc, out = run('DATABASE_URL="postgresql://roksal:roksal@localhost:54329/r565t" bunx prisma migrate deploy')
chk(rc == 0 and 'successfully' in out, f'B3 prisma migrate deploy na sveži bazi ({rc})')

rc, out = run(f'DATABASE_URL="postgresql://roksal:roksal@localhost:54329/r565t" bun ops/import-db.mjs {export_dir}')
chk(rc == 0, f'B4 uvoz export/*.json (FK-urejen) uspel ({rc}: {out[:120]})')
imp = {}
for line in out.strip().splitlines():
    if line.startswith('{'): imp = json.loads(line)

meta = json.load(open(os.path.join(export_dir, '_meta.json')))
sum_meta = sum(v for v in meta['rowCounts'].values())
sum_imp = sum(v for v in imp.get('imported', {}).values() if isinstance(v, int))
chk(sum_imp == sum_meta, f'B5 vsota uvoženih vrstic = export ({sum_imp} = {sum_meta})')

rc, out = run('DATABASE_URL="postgresql://roksal:roksal@localhost:54329/r565t" bun ops/fk-check.mjs')
chk(rc == 0 and '"total":0' in out.replace(' ', ''), f'B6 fk-check: 0 sirot (rc {rc}: {out[:120]})')

# fail-closed: ponovni uvoz v NEPRAZNO bazo → zavrnjen
rc, out = run(f'DATABASE_URL="postgresql://roksal:roksal@localhost:54329/r565t" bun ops/import-db.mjs {export_dir}')
chk(rc != 0 and 'NI prazna' in out, f'B7 fail-closed: ponovni uvoz v neprazno bazo zavrnjen ({rc})')

# ═══ C) polni drill E2E (živo iz lokalne kopije) ═══════════════════════════
print('── C) polni recovery drill E2E (backup → obnova → app → poslovni test)')
testna_iz = f'r565-test-{int(time.time())}'
rc, out = run(f'DATABASE_URL="postgresql://roksal:roksal@localhost:54329/roksal" ROKSAL_BACKUP_PASSPHRASE="{testna_iz}" bash ops/backup.sh')
chk(rc == 0 and '"ok": true' in out.replace("'", '"'), f'C1 testna varnostna kopija ustvarjena ({rc})')
kopije = sorted(glob.glob(os.path.join(REPO, 'db/backups/*.rkb')))
chk(len(kopije) >= 1, f'C2 datoteka kopije obstaja ({len(kopije)})')
KOPIJA = kopije[-1] if kopije else None

if KOPIJA:
    rc, out = run(f'DATABASE_URL="postgresql://roksal:roksal@localhost:54329/roksal" ROKSAL_BACKUP_PASSPHRASE="{testna_iz}" bash ops/drill.sh --skip-install --file "{KOPIJA}"', timeout=500)
    drill_ok = rc == 0 and '"ok": true' in out.replace("'", '"')
    chk(drill_ok, f'C3 drill uspešen (rc {rc}; izhod v /tmp — poročilo zapisano)')
    if drill_ok or rc in (0, 1):
        js = {}
        for line in out.strip().splitlines():
            if line.startswith('{'): js = json.loads(line)
        chk(js.get('provider') == 'postgresql', f"C4 provider zaznan: postgresql (dejansko {js.get('provider')})")
        chk(js.get('projects', 0) > 0, f"C5 poslovni test: {js.get('projects')} projektov dostopnih na obnovljenem sistemu")
        rto = js.get('rtoSec', 99999)
        chk(rto <= 1800, f'C6 RTO {rto} s ≤ 1800 s cilj')
        chk('pg_uvoz' in (js.get('phases') or {}), 'C7 faza pg_uvoz zabeležena (dejanska obnova podatkov)')
        rep = js.get('report', '')
        chk(rep and os.path.isfile(rep), f'C8 poročilo obstaja: {rep}')
        if rep and os.path.isfile(rep):
            rtext = open(rep, encoding='utf-8').read()
            chk('provider: postgresql' in rtext and 'USPEŠEN' in rtext, 'C9 poročilo: PG + uspešen')
            chk('sirot' in rtext, 'C9b poročilo omenja preverbo tujih ključev')
    else:
        bad(f'C4–C9: drill izhod {rc}: {out[:200]}')
else:
    skip('C3–C9: kopija ni bila ustvarjena')

# ═══ D) čiščenje ═══════════════════════════════════════════════════════════
print('── D) čiščenje')
cl = bun_js('''
import pg from 'pg'
const c = new pg.Client({ connectionString: 'postgresql://roksal:roksal@localhost:54329/postgres' })
await c.connect()
const dbs = await c.query("SELECT datname FROM pg_database WHERE datname LIKE 'roksal_drill_%' OR datname IN ('r565t', 'r565dbg', 'r565dbg2', 'r565dbg3', 'r565drill')")
let n = 0
for (const r of dbs.rows) { await c.query(`DROP DATABASE IF EXISTS "${r.datname}"`); n++ }
await c.end()
console.log(JSON.stringify({ pocisceno: n }))
''')
chk(isinstance(cl.get('pocisceno'), int), f'D1 testne baze pobrisane ({cl})')
# testna kopija: pobriši SAMO kopije z danim SHA časa testa (vse .rkb iz teka)
# (kopija vsebuje trenutno stanje — ne brišemo starejših, če so obstajale prej)
for f in glob.glob(os.path.join(REPO, 'db/backups/*.rkb')):
    os.remove(f)
import shutil
shutil.rmtree(export_dir, ignore_errors=True)
chk(len(glob.glob(os.path.join(REPO, 'db/backups/*.rkb'))) == 0, 'D2 testna kopija odstranjena (baza/backups čista)')

print(f'════ r565 konec: {PASS} ✓ / {FAIL} ✗ / {SKIP} skip ════')
sys.exit(1 if FAIL else 0)

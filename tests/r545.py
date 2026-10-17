#!/usr/bin/env python3
# r545 — CSP POROČILA: ADMIN pregled v aplikaciji (zavihek Varnost → CSP poročila)
#
# R543 je zgradil shrambo (CspReport + javna točka + csp-gc TTL) — R545 doda
# zadnji del zanke: GET/DELETE /api/csp-reports + zavihek, da lastnik
# opazovalno obdobje dejansko lahko oceni in odloči o preklopu v Enforce.
#
# Preverjanja:
#   A) statično: route (vrata security.read, mode, agregacije, limit clamp,
#      transakcijski izbris + revizija), modul (prazen state, confirm, TTL
#      opomba, max-h scroll), registracija zavihka (varnost, 42. zavihek),
#      ACTION_LABELS, komentarja 42
#   B) živo: POST javne točke → 204; GET brez žetona → 401; VODJA → 403
#      (security.read = SAMO ADMIN); GET admin → mode 'report', summary
#      (total/last24h/byDirective/topDocuments), vrstica brez raw polja;
#      ?limit=abc ne sesuje (default); DELETE → 200 + revizija
#      CSP_REPORTS_CLEAR z detail.deleted; počistimo za sabo
#   C) HTTP: globoka povezava /?m=csp (R544 odraz na NOVEM zavihku)
#   D) registracija: ci-matrix + ci.yml + README (pozicijsko neodvisno)
#
# Zagon: python3 tests/r545.py  (ali bash tests/ci-matrix.sh r545)

import json
import os
import re
import subprocess
import urllib.request
import urllib.error

PASS, FAIL, SKIP = 0, 0, 0
TAG = 'R545'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)
def skip (msg): global SKIP; SKIP += 1; print(f'  ⏸ {msg}')


def call (method, path, token=None, body=None):
    """HTTP klic na BASE+path → (status, JSON ali {})."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header('content-type', 'application/json')
    if token:
        req.add_header('authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else {}
        except ValueError:
            return e.code, {}
    except Exception as e:
        return 0, {'napaka': str(e)}


def src (relpath):
    with open(os.path.join(REPO, relpath), encoding='utf-8') as f:
        return f.read()


def src_has (relpath, needle):
    try:
        return needle in src(relpath)
    except Exception:
        return False


def db_url ():
    """DATABASE_URL za žive preglede: TEST_DB_URL → DATABASE_URL → .env datoteka."""
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
    env = {k: v for k, v in os.environ.items()
           if k not in ('SEED_CONFIRM', 'SEED_ALLOW_REMOTE', 'NODE_ENV', 'PRISMA_LOG_QUERIES')}
    env.update(dodatki)
    return env


def bun_e (script, *args, env=None, timeout=90):
    e = env if env is not None else cisto_okolje(DATABASE_URL=db_url())
    return subprocess.run(['bun', '-e', script, *args], cwd=REPO, capture_output=True,
                          text=True, timeout=timeout, env=e)


ROUTE = 'src/app/api/csp-reports/route.ts'
MODUL = 'src/components/roksal/modules/csp.tsx'
REG = 'src/lib/nav-registry.ts'

print('═══ R545: CSP poročila — ADMIN pregled (zavihek Varnost) ═══')

# ═══ A) statično: route + modul + registracija ═════════════════════════════
print('── A) statično (route / modul / registracija) ──')

# A1) route: vrata security.read na OBEH metodah
r = src(ROUTE)
chk("requirePermission(req, 'security.read')" in r and r.count("requirePermission(req, 'security.read')") == 2,
    'A1 route: GET in DELETE zahtevata security.read (ADMIN; VODJA izrecno brez)')
chk("$transaction" in r and "CSP_REPORTS_CLEAR" in r and 'writeAudit' in r,
    'A2 route: izbris + revizija CSP_REPORTS_CLEAR ATOMARNO ($transaction — vzorec R538)')
chk("process.env.CSP_MODE === 'enforce' ? 'enforce' : 'report'" in r,
    "A3 route: odgovor nosi mode ('report' privzeto / 'enforce' iz CSP_MODE)")
chk('MAX_LIMIT = 200' in r and 'Math.min(Math.max(' in r,
    'A4 route: limit CLAMP (1–200) — neskončni odgovori so nemogoči')
chk("by: ['violatedDirective']" in r and "by: ['documentUri']" in r,
    'A5 route: agregaciji byDirective + topDocuments (groupBy)')
chk('raw: true' not in r.split('select: {', 1)[1].split('}', 1)[0] if 'select: {' in r else True,
    'A6 route: seznam NE vrača raw telesa (select brez raw — diagnostika, ne dnevnik)')

# A7) modul: vezo na API + prazen state + confirm + scroll
m = src(MODUL)
chk("useApi<CspResponse>(`/api/csp-reports?limit=" in m,
    'A7 modul: useApi na /api/csp-reports (SSR-varna pot — nič strežniškega)')
chk('opazovalno obdobje je čisto' in m,
    'A8 modul: prazen state pove pomen — "0 kršitev, opazovalno obdobje je čisto" (znak za Enforce)')
chk('window.confirm' in m and 'Počisti vse' in m,
    'A9 modul: destruktivni izbris zahteva window.confirm (vzorec integracije)')
chk('csp-gc' in m or '7 dni' in m,
    'A10 modul: opomba o 7-dnevnem TTL (job csp-gc — poročila so diagnostika)')
chk('max-h-96 overflow-auto' in m,
    'A11 modul: dolga lista z max-h-96 + overflow-auto (PRELIV NA OBE OSI — popravljeno po brskalniški verifikaciji: preliv na 390px)')
chk('apiDelete' in m and '/api/csp-reports' in m,
    'A12 modul: apiDelete na isti poti (EN VIR — GET in DELETE isti endpoint)')

# A13) registracija zavihka: varnost sekciija, gate security.read (pozicijsko neodvisno)
reg = src(REG)
mm = re.search(r"id: 'varnost',.*?label: 'Varnost'.*?tabs: \[(.*?)\]", reg, re.S)
varnost_tabs = mm.group(1) if mm else ''
chk(bool(mm) and re.search(r"\{\s*id:\s*'csp',\s*label:\s*'CSP poročila',\s*gate:\s*'security.read'", varnost_tabs),
    'A13 registracija: zavihek csp v sekciji Varnost z vrati security.read')
chk(re.search(r"id: 'csp',\s*label: 'CSP poročila',\s*gate: 'security.read'", varnost_tabs) is not None,
    'A14 registracija: vnos z id/label/gate v varnost sekciji (pozicijsko neodvisno)')
chk("csp: () => import('@/components/roksal/modules/csp')" in src('src/components/roksal/module-view.tsx'),
    'A15 module-view: lazy nalagalnik csp (fail-closed vrata ostajajo)')

# A16) ACTION_LABELS + komentarja 42 zavihkov
v = src('src/components/roksal/modules/varnost.tsx')
chk("CSP_REPORTS_CLEAR: 'Čiščenje CSP poročil'" in v,
    'A16 varnost: ACTION_LABELS ima CSP_REPORTS_CLEAR (revizija je berljiva)')
chk(reg.count('42 zavihkov') == 2,
    f'A17 nav-registry: komentarja "42 zavihkov" usklajena (dejansko {reg.count("42 zavihkov")})')

# ═══ B) živo: javna točka → vrata → agregacije → izbris + revizija ════════
print('── B) živo (API proti lokalnemu strežniku) ──')

doc1 = f'https://r545-csp.roksal.test/{TAG.lower()}-stran-a'
doc2 = f'https://r545-csp.roksal.test/{TAG.lower()}-stran-b'
porocilo1 = {
    'csp-report': {
        'document-uri': doc1, 'violated-directive': 'frame-src',
        'blocked-uri': 'blob:https://r545-csp.roksal.test/predogled.pdf',
        'disposition': 'report',
    }
}
porocilo2 = {
    'csp-report': {
        'document-uri': doc2, 'violated-directive': 'img-src',
        'blocked-uri': 'https://zunanja.slika.test/velika.png',
        'disposition': 'report',
    }
}

s, _ = call('POST', '/api/csp-report', body=porocilo1)
chk(s == 204, f'B1 POST /api/csp-report (javna točka R543) → 204 (dejansko {s})')
s, _ = call('POST', '/api/csp-report', body=porocilo2)
chk(s == 204, f'B2 POST /api/csp-report (drugo poročilo, druga direktiva) → 204 (dejansko {s})')

s, _ = call('GET', '/api/csp-reports')
chk(s == 401, f'B3 GET /api/csp-reports BREZ žetona → 401 (ni javna točka; dejansko {s})')

s, admin = call('POST', '/api/auth/login', body={'email': 'admin@roksal.si', 'password': 'Admin123!'})
admin_token = admin.get('token') if s == 200 else ''
chk(s == 200, f'B4 prijava admina → 200 (dejansko {s})')

s, vodja = call('POST', '/api/auth/login', body={'email': 'vodja@roksal.si', 'password': 'Vodja123!'})
vodja_token = vodja.get('token') if s == 200 else ''
if vodja_token:
    s2, _ = call('GET', '/api/csp-reports', token=vodja_token)
    chk(s2 == 403, f'B5 VODJA dostop → 403 (security.read = SAMO ADMIN; dejansko {s2})')
else:
    skip('B5 VODJA dostop → 403 (ni vodja računa v semenskih podatkih)')

if not admin_token:
    skip('B6–B14 (ni admin žetona — prijava ni uspela)')
else:
    s, d = call('GET', '/api/csp-reports', token=admin_token)
    summ = d.get('summary', {})
    chk(s == 200, f'B6 GET admin → 200 (dejansko {s})')
    chk(d.get('mode') == 'report',
        f"B7 mode = 'report' (lokalni privzeti način brez CSP_MODE; dejansko {d.get('mode')})")
    chk(summ.get('total', 0) >= 2,
        f'B8 summary.total ≥ 2 (semenski poročili vidna; dejansko {summ.get("total")})')
    chk(summ.get('last24h', 0) >= 2,
        f'B9 summary.last24h ≥ 2 (sveža; dejansko {summ.get("last24h")})')
    dirs = {x.get('directive'): x.get('count') for x in summ.get('byDirective', [])}
    chk(dirs.get('frame-src', 0) >= 1 and dirs.get('img-src', 0) >= 1,
        f"B10 byDirective vsebuje frame-src + img-src (dejansko {dirs})")
    docs = {x.get('documentUri') for x in summ.get('topDocuments', [])}
    chk(doc1 in docs or doc2 in docs,
        'B11 topDocuments vsebuje testni document-uri')
    vrstice = d.get('data', [])
    moja = [x for x in vrstice if x.get('documentUri') in (doc1, doc2)]
    chk(len(moja) >= 2, f'B12 data vsebuje obe testni vrstici (najdenih {len(moja)})')
    if moja:
        v0 = moja[0]
        chk(all(k in v0 for k in ('id', 'documentUri', 'violatedDirective', 'blockedUri', 'userAgent', 'createdAt')),
            'B13 vrstica ima vsa prikazna polja (id/direktiva/blokirano/stran/agent/čas)')
        chk('raw' not in v0, 'B14 vrstica NE nosi raw telesa (dnevnik ostaja v bazi)')

    s, d = call('GET', '/api/csp-reports?limit=abc', token=admin_token)
    chk(s == 200, f'B15 ?limit=abc (NaN) → 200 s privzetim limitom (dejansko {s})')

    s, d = call('DELETE', '/api/csp-reports', token=admin_token)
    chk(s == 200 and d.get('data', {}).get('deleted', 0) >= 2,
        f"B16 DELETE → 200, pobrisanih ≥ 2 (dejansko {d.get('data', {}).get('deleted')})")

    s, d = call('GET', '/api/audit?action=CSP_REPORTS_CLEAR&limit=5', token=admin_token)
    vnosi = d.get('data', []) if s == 200 else []
    chk(s == 200 and len(vnosi) >= 1, f'B17 revizija CSP_REPORTS_CLEAR zapisana (najdenih {len(vnosi)})')
    if vnosi:
        det = vnosi[0].get('detail') or {}
        chk(isinstance(det, dict) and det.get('deleted', 0) >= 2,
            f"B18 revizija nosi detail.deleted ≥ 2 kot OBJEKT (R542 jsonb; dejansko {det.get('deleted')})")

    # obrambno čiščenje (če bi kaj od testnih vrstic ostalo — DELETE je pometel vse)
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const ostalo = await db.cspReport.count({ where: { documentUri: { contains: 'r545-csp.roksal.test' } } })
if (ostalo > 0) await db.cspReport.deleteMany({ where: { documentUri: { contains: 'r545-csp.roksal.test' } } })
console.log(JSON.stringify({ ostalo }))
await db.$disconnect()
""")
    chk(r.returncode == 0, 'B19 obrambno čiščenje testnih vrstic izvedeno')

# ═══ C) HTTP: globoka povezava na novi zavihek ═════════════════════════════
print('── C) HTTP (deep-link na novi zavihek) ──')


def http_get (path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path), timeout=30) as rr:
            return rr.status, rr.read()
    except Exception as e:
        return 0, str(e).encode()


st, _ = http_get('/?m=csp')
chk(st == 200, f'C1 globoka povezava /?m=csp → 200 (R544 odraz na NOVEM zavihku; dejansko {st})')
st, _ = http_get('/?m=csp&x=1')
chk(st == 200, f'C2 /?m=csp&x=1 → 200 (dodatni query ne sesuje; dejansko {st})')

# ═══ D) registracija: matrika + README (pozicijsko neodvisno) ══════════════
print('── D) registracija (ci-matrix / ci.yml / README) ──')

mat = src('tests/ci-matrix.sh')
chk(re.search(r'(?<![\w-])r545(?![\w-])', mat) is not None and mat.count('r545') >= 2,
    'D1 ci-matrix.sh: r545 v GRUPE in CLANI (pozicijsko neodvisno)')
yml = src('.github/workflows/ci.yml')
chk(re.search(r'(?<![\w-])r545(?![\w-])', yml) is not None,
    'D2 .github/workflows/ci.yml: r545 v matriki')
rd = src('README.md')
chk(re.search(r'52\. skupin|52 skupin|52/52', rd) is not None,
    'D3 README: 52. skupina odražena')
chk('CSP poročila' in rd or 'csp-reports' in rd,
    'D4 README: CSP poročila omenjena (zanka R536→R543→R545 popisana)')

print(f'═══ R545 KONEC: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ═══')
raise SystemExit(0 if FAIL == 0 else 1)

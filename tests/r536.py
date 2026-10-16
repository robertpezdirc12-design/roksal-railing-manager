#!/usr/bin/env python3
"""tests/r536.py — R536: UTRDITEV AVTENTIKACIJE (porazdeljeni tempomat,
zaklepanje računa, scrypt v2, CSP Report-Only).

Zakaj: varnostna revizija (naloga 3) je potrdila štiri šibkosti prijave:
(1) tempomat je štel v pomnilniku POSAMEZNEGA procesa — na serverless vsaka
instanca svoje, porazdeljen brute-force ni bil zaviran; (2) ni bilo zaklepa
računa — 30 poskusov/min/IP še vedno pomeni 43.200 ugibanj dnevno na račun z
več IP-ji; (3) scrypt N=16384 je pod OWASP priporočilom (2^17); (4) ni bilo
CSP glave (odloženo namensko — prvi korak je Report-Only opazovanje).

Kaj preverja ta suite:
  A) ZAKLEP RAČUNA: 4× napačno geslo → 401 (števec 4), 5. napačno → 401
     (zaklep POSTAVLJEN — failedLoginCount resetiran, lockedUntil v prihodnosti),
     nato PRAVILNO geslo → 423 (zaklep velja, geslo se ne preverja);
  B) RESET ob uspehu + TRANSPARENTNA NADGRADNJA: žrtev se seje s STARIM
     formatom hasha (sol:hash, N=16384); 3× napaka → 401, uspeh → 200;
     po uspehu je hash v bazi NADGRAJEN v scrypt v2 (scrypt:131072:8:1:…),
     števec resetiran; ponovljeno 3× napaka → uspeh → 200 — NIKOLI 423
     (uspešna prijava resetira števec, zaklep se NE sešteva med epizodami);
  C) TEMPOMAT PO BAZI: javni klic z (neveljavnim) žetonom ustvari vrstico
     RateLimitEntry ZNOTRAJ 60-s okna; /api/security/rate-limit (ADMIN) vrne
     obliko {total, items[…]} s PRIKRITIMI ključi; bucket v bazi vsebuje
     SAMO sha256 odsek žetona (raw žetona NI v bazi — disciplina R534/R536);
  D) CSP REPORT-ONLY: odgovor dokumenta nosi glavo
     'Content-Security-Policy-Report-Only' z report-uri /api/csp-report;
     POST /api/csp-report → 204 (veljavno poročilo, delno poročilo IN smeti);
  E) ENOTE auth.ts: hashPassword → v2 format; verifyPassword sprejme v2 IN
     stari format, zavrne napačno geslo in smeti; passwordNeedsRehash
     (stari → true, v2 → false).

POGOJI: teče nad lokalno razvojno bazo (TEST_DB_URL → env.sh → DATABASE_URL,
tests/dbenv.py) in strežnikom na BASE_URL. Žrtev 'r536-lock@roksal.test' se
ustvari neposredno v bazi (star format hasha — ravno prav za preizkus
transparentne nadgradnje) in se na koncu IZBRIŠE (seje kaskadirajo) — pas je
ponovljiv. OPOZORILO za pas: skupaj ~14 prijav z enega IP-ja — v sklopu CI
ga pokriva AUTH_RATE_MAX (ci-local.sh dvigne na 100000), samostojno pa je
število pod privzetimi 30/min.
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbenv import db_url  # noqa: E402  (R496: TEST_DB_URL → env.sh → DATABASE_URL)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get('BASE_URL', 'http://localhost:3000')
PASS, FAIL, SKIP = 0, 0, 0

VICTIM_EMAIL = 'r536-lock@roksal.test'
VICTIM_PW = 'R536-Lock-123!'
VICTIM_OLD_SALT = 'r536starelasisolad0d1e2f3a4b5c6d7'  # fiksna sol starega formata (hex, brez pik)
PUBLIC_TOKEN = 'r536-testtoken-abcdef'  # ≥ 8 znakov — gre čez dolžinska vrata measure


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)
def skip (msg): global SKIP; SKIP += 1; print(f'  ⏸ {msg}')


def call (method, path, token=None, body=None):
    """HTTP klic → (status, dict|str)."""
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header('authorization', f'Bearer {token}')
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header('content-type', 'application/json')
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            raw = r.read().decode('utf-8', 'replace')
            try:
                return r.status, json.loads(raw)
            except ValueError:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw
    except Exception as e:
        return 0, {'error': str(e)}


def login (email, pw):
    s, d = call('POST', '/api/auth/login', body={'email': email, 'password': pw})
    return s, d


def bun_e (script, *args):
    """bun -e nad repozitorijem z DATABASE_URL iz dbenv (vzorec r534)."""
    env = dict(os.environ)
    env['DATABASE_URL'] = db_url(REPO)
    return subprocess.run(['bun', '-e', script, *args], cwd=REPO, capture_output=True,
                          text=True, timeout=120, env=env)


def bun_json (r):
    """Zadnja JSON vrstica stdout bun skripte (ali None ob napaki)."""
    if r.returncode != 0:
        return None
    for line in reversed(r.stdout.strip().splitlines()):
        try:
            return json.loads(line)
        except ValueError:
            continue
    return None


print('═══ R536: utrditev avtentikacije ═══')

DBU = db_url(REPO)

# ═══ Priprava: žrtev s STARIM formatom hasha (sol:hash, N=16384) ═════════════
# Stari format naredimo neposredno — ravno stanje, ki ga R536 tiho nadgradi.
r = bun_e("""
const crypto = require('crypto')
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const salt = process.argv[1]
const hash = crypto.scryptSync(process.argv[2], salt, 64).toString('hex') // privzeti N=16384 — STARO
await db.user.deleteMany({ where: { email: process.argv[3] } }) // ponovljivost (ostanki prejšnjega klica)
await db.user.create({ data: {
  email: process.argv[3], passwordHash: `${salt}:${hash}`,
  name: 'R536 Lock Test', role: 'MONTER',
} })
await db.$disconnect()
console.log('zrtava ustvarjena (stari format)')
""", VICTIM_OLD_SALT, VICTIM_PW, VICTIM_EMAIL)
chk(r.returncode == 0, 'žrtev ustvarjena v bazi s STARIM formatom hasha (N=16384)')

# ═══ A) zaklep računa: 5. neuspešna prijava zaklene, prava pot nato 423 ═════
print('── A) zaklep po 5 neuspešnih prijavah ──')
zaporedje_ok = True
for i in range(1, 5):
    s, d = login(VICTIM_EMAIL, 'Napačno-geslo-' + str(i))
    if s != 401:
        zaporedje_ok = False
        bad(f'{i}. napačno geslo → pričakovan 401 (dejansko {s})')
chk(zaporedje_ok, '4× napačno geslo → 401 (števec teče, zaklep še ni)')

s, d = login(VICTIM_EMAIL, 'Napačno-geslo-5')
chk(s == 401, '5. napačno geslo → 401 (zaklep se postavi TIHO — enak odgovor kot prej)')

# dokaz v bazi: lockedUntil v prihodnosti, števec resetiran (ne začenja na robu)
r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const u = await db.user.findUnique({ where: { email: process.argv[1] } })
await db.$disconnect()
console.log(JSON.stringify({
  locked: u.lockedUntil !== null && u.lockedUntil.getTime() > Date.now(),
  skoraj15min: u.lockedUntil !== null && Math.abs((u.lockedUntil.getTime() - Date.now()) - 15 * 60000) < 5000,
  stevecResetiran: u.failedLoginCount === 0,
}))
""", VICTIM_EMAIL)
d = bun_json(r) or {}
chk(d.get('locked') and d.get('skoraj15min') and d.get('stevecResetiran'),
    'baza: lockedUntil > zdaj (≈15 min) in failedLoginCount resetiran na 0')

s, d = login(VICTIM_EMAIL, VICTIM_PW)
chk(s == 423, f'PRAVILNO geslo med zaklepom → 423 (dejansko {s}) — geslo se ne preverja')

# ═══ B) uspeh resetira števec + transparentna nadgradnja hasha ═══════════════
print('── B) reset števca ob uspehu + scrypt v2 nadgradnja ──')
# odklep žrtve (samo za ta test — simulira potek 15 min), števec že 0
r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
await db.user.update({ where: { email: process.argv[1] }, data: { lockedUntil: null } })
await db.$disconnect()
console.log('odklep (potek zaklepa simuliran)')
""", VICTIM_EMAIL)
chk(r.returncode == 0, 'zaklep potekel (simulacija čakanja 15 min)')

vsi_401 = all(login(VICTIM_EMAIL, 'Spet-napačno-' + str(i))[0] == 401 for i in range(3))
chk(vsi_401, '3× napačno geslo → 401 (pod pragom zaklepa)')

s, d = login(VICTIM_EMAIL, VICTIM_PW)
chk(s == 200, 'uspešna prijava po 3 napakah → 200 (števec se resetira)')

r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const u = await db.user.findUnique({ where: { email: process.argv[1] } })
await db.$disconnect()
console.log(JSON.stringify({
  v2: u.passwordHash.startsWith('scrypt:131072:8:1:'),
  stevecNull: u.failedLoginCount === 0 && u.lockedUntil === null,
}))
""", VICTIM_EMAIL)
d = bun_json(r) or {}
chk(d.get('v2'), 'TRANSPARENTNA NADGRADNJA: hash v bazi je sedaj scrypt:131072:8:1:… (v2)')
chk(d.get('stevecNull'), 'baza: failedLoginCount = 0 in lockedUntil = null po uspehu')

# še ena epizoda: 3 napake → uspeh — če se števec NE bi resetiral, bi 3+3 sprožilo zaklep
epizoda = [login(VICTIM_EMAIL, 'Napaka-epizoda-' + str(i))[0] for i in range(3)]
s, d = login(VICTIM_EMAIL, VICTIM_PW)
chk(all(x == 401 for x in epizoda) and s == 200,
    'ponovljena epizoda 3× napaka → uspeh 200 — NIKOLI 423 (reset deluje čez epizode)')

# ═══ C) tempomat po bazi (RateLimitEntry) ═══════════════════════════════════
print('── C) porazdeljeni tempomat (baza) ──')
s, admin = login('admin@roksal.si', 'Admin123!')
if s != 200:
    bad(f'prijava admina za pregled tempomata: {s}')
    admin_token = ''
else:
    ok('prijava admina (security.read za pregled tempomata)')
    admin_token = admin.get('token') or admin.get('data', {}).get('token') or ''

if admin_token:
    # javni klic z neveljavnim žetonom → 404, a bucket se zabeleži (tempomat teče pred DB)
    s, d = call('GET', f'/api/public/measure?token={PUBLIC_TOKEN}')
    chk(s == 404, 'javni measure z neveljavnim žetonom → 404 (bucket vseeno zabeležen)')

    s, d = call('POST', '/api/security/rate-limit', admin_token, {'action': 'list'})
    chk(s == 200, 'security/rate-limit list → 200')
    data = d.get('data', {}) if isinstance(d, dict) else {}
    chk(isinstance(data.get('total'), int) and isinstance(data.get('items'), list),
        'oblika odgovora {total, items} (UI modula Varnost ne sme pasti)')
    measure_items = [i for i in data.get('items', []) if str(i.get('bucket', '')).startswith('measure:')]
    chk(len(measure_items) >= 1, 'bucket measure: prisoten v listi (tempomat je zagnal javni klic)')
    mask = str(measure_items[0].get('bucket', '')) if measure_items else ''
    chk(PUBLIC_TOKEN not in mask, 'prikrit ključ NE razkrije surovega žetona')
    chk('hits' in (measure_items[0] if measure_items else {}) and 'lastAt' in (measure_items[0] if measure_items else {}),
        'item nosi hits + lastAt (oblika nespremenjena)')

    # dokaz v bazi: vrstica RateLimitEntry z ZGOŠČENIM bucketom (ne surovim žetonom)
    hashed_bucket = 'measure:' + hashlib.sha256(PUBLIC_TOKEN.encode()).hexdigest()[:16]
    r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const bucket = process.argv[1]
const cutoff = new Date(Math.floor(Date.now() / 60000) * 60000 - 60000)
const row = await db.rateLimitEntry.findFirst({ where: { bucket, windowStart: { gte: cutoff } } })
const raw = await db.rateLimitEntry.count({ where: { bucket: { contains: process.argv[2] } } })
await db.$disconnect()
console.log(JSON.stringify({ vrsticaObstaja: row !== null, zadetki: row ? row.hits : 0, surovihVrstic: raw }))
""", hashed_bucket, PUBLIC_TOKEN)
    d = bun_json(r) or {}
    chk(d.get('vrsticaObstaja') and d.get('zadetki', 0) >= 1,
        f'baza: RateLimitEntry {hashed_bucket[:16]}… obstaja v aktivnem/prejšnjem oknu s zadetki')
    chk(d.get('surovihVrstic') == 0, 'baza: NOBEN bucket ne vsebuje surovega žetona (sha256 odsek, disciplina R536)')

    # čistilna kontrola po lastnih artefaktih (pomembno za ponovljivost pasa)
    for key in (hashed_bucket, 'csp-report', 'login:ip:neznano'):
        s, d = call('POST', '/api/security/rate-limit', admin_token, {'action': 'clear', 'bucket': key})
        chk(s == 200, f'clear bucketa {key[:24]} → 200 (čiščenje)')

# ═══ D) CSP Report-Only + sprevzem poročil ═══════════════════════════════════
print('── D) CSP Report-Only ──')
try:
    with urllib.request.urlopen(BASE + '/', timeout=30) as resp:
        csp = resp.headers.get('Content-Security-Policy-Report-Only') or ''
except Exception as e:
    csp = ''
    bad(f'dokument / ni dosegljiv: {e}')
chk("report-uri /api/csp-report" in csp, "glava Content-Security-Policy-Report-Only z report-uri /api/csp-report")
chk("default-src 'self'" in csp and "object-src 'none'" in csp, 'politika vsebuje default-src/object-src direktive')

s, d = call('POST', '/api/csp-report', body={
    'csp-report': {
        'document-uri': 'https://app.roksal.si/',
        'violated-directive': 'script-src-elem',
        'blocked-uri': 'https://zloben-primer.com/x.js',
    }
})
chk(s == 204, f'POST /api/csp-report z veljavnim poročilom → 204 (dejansko {s})')

s, d = call('POST', '/api/csp-report', body={'csp-report': {'document-uri': 'x'}})
chk(s == 204, 'POST z delnim poročilom → 204 (sprevzemnik ne razpada)')

# smeti (neveljaven JSON) ne smejo povzročiti 5xx — telo pošljemo kot JSON niz smeti
req = urllib.request.Request(BASE + '/api/csp-report', method='POST',
                             data=b'{ne-veljaven json', headers={'content-type': 'application/json'})
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        smeti_status = resp.status
except urllib.error.HTTPError as e:
    smeti_status = e.code
chk(smeti_status == 204, f'POST z neveljavnim JSON → 204 (dejansko {smeti_status})')

# ═══ E) enote: hashPassword/verifyPassword/passwordNeedsRehash ═══════════════
print('── E) enote auth.ts (scrypt v2) ──')
r = bun_e("""
const m = await import('./src/lib/auth.ts')
const crypto = require('crypto')
const novi = await m.hashPassword('Geslo-123!')
const parts = novi.split(':')
const salt = crypto.randomBytes(16).toString('hex')
const stari = salt + ':' + crypto.scryptSync('Staro-Geslo-9!', salt, 64).toString('hex') // N=16384 privzet
console.log(JSON.stringify({
  v2format: parts.length === 6 && parts[0] === 'scrypt' && parts[1] === '131072' && parts[2] === '8' && parts[3] === '1',
  noviPreveri: await m.verifyPassword('Geslo-123!', novi),
  noviZavrne: !(await m.verifyPassword('Geslo-123?', novi)),
  stariPreveri: await m.verifyPassword('Staro-Geslo-9!', stari),
  stariZavrne: !(await m.verifyPassword('napacno', stari)),
  rehashStari: m.passwordNeedsRehash(stari),
  rehashNovi: !m.passwordNeedsRehash(novi),
  smetiZavrne: !(await m.verifyPassword('x', 'a:b')),
}))
""")
d = bun_json(r) or {}
chk(d.get('v2format'), 'hashPassword → scrypt:131072:8:1:{sol}:{hash} (6 delov, N=2^17)')
chk(d.get('noviPreveri') and d.get('noviZavrne'), 'verifyPassword: v2 sprejme pravo geslo, zavrne napačno')
chk(d.get('stariPreveri') and d.get('stariZavrne'), 'verifyPassword: STARI format (N=16384) še vedno veljaven (brezizpadni prehod)')
chk(d.get('rehashStari') and d.get('rehashNovi'), 'passwordNeedsRehash: stari → true, v2 → false')
chk(d.get('smetiZavrne'), 'verifyPassword: smeti (a:b) → false')

# ═══ Čiščenje: žrtev izbrisana (seje kaskadirajo) ═══════════════════════════
r = bun_e("""
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
const res = await db.user.deleteMany({ where: { email: process.argv[1] } })
await db.$disconnect()
console.log(JSON.stringify({ izbrisano: res.count }))
""", VICTIM_EMAIL)
d = bun_json(r) or {}
chk(d.get('izbrisano') == 1, 'žrtev izbrisana (disciplina r459 — pas ostane ponovljiv)')

if admin_token:
    s, d = call('POST', '/api/auth/logout', admin_token)
    chk(s == 200, 'admin seja testa odjavljena (čiščenje)')

print()
print(f'══ REZULTAT: {PASS} ✓ / {FAIL} ✗ / {SKIP} ⏸ ══')
sys.exit(1 if FAIL > 0 else 0)
